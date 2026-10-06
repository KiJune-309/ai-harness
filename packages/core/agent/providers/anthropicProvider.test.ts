import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AnthropicChatResponse, AnthropicStopReason, AnthropicStreamResponse, Message, StreamResponse } from '../types.ts'
import { AnthropicProvider } from './anthropicProvider.ts'

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const config = { apiKey: 'test-key', model: 'configured-model', baseUrl: 'https://example.invalid/v1/' }
const messages: Message[] = [
    { role: 'system', content: 'Be helpful' },
    { role: 'user', content: 'Hello' },
]
const response: AnthropicChatResponse = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'response-model',
    content: [
        { type: 'text', text: '你好' },
        { type: 'thinking', thinking: 'Private reasoning', signature: 'signature' },
        { type: 'text', text: ' world' },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2, service_tier: 'standard' },
}

const encoder = new TextEncoder()
const encodeEvents = (events: AnthropicStreamResponse[], newline = '\n') =>
    events.map(event => `event: ${event.type}${newline}data: ${JSON.stringify(event)}${newline}${newline}`).join('')

const mockStream = (chunks: Uint8Array[]) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
            new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        chunks.forEach(chunk => controller.enqueue(chunk))
                        controller.close()
                    },
                })
            )
    )
    vi.stubGlobal('fetch', fetch)
    return fetch
}

const collect = async (provider = new AnthropicProvider(config)) => {
    const result: StreamResponse[] = []
    for await (const item of provider.stream(messages)) result.push(item)
    return result
}

describe('AnthropicProvider.chat', () => {
    test('sends an Anthropic request and converts the response to ChatResponse', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response))
        vi.stubGlobal('fetch', fetch)
        const abort = new AbortController()
        const result = await new AnthropicProvider(config).chat(messages, { signal: abort.signal })

        expect(fetch).toHaveBeenCalledWith(
            'https://example.invalid/v1/messages',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'x-api-key': 'test-key',
                    'anthropic-version': '2023-06-01',
                    Accept: 'application/json',
                }),
            })
        )
        const request = fetch.mock.calls[0][1]!
        expect(JSON.parse(request.body as string)).toEqual({
            model: 'configured-model',
            system: [{ type: 'text', text: 'Be helpful' }],
            messages: [{ role: 'user', content: 'Hello' }],
            max_tokens: 4096,
            stream: false,
        })
        abort.abort()
        expect(request.signal?.aborted).toBe(true)
        expect(result).toMatchObject({
            id: 'msg_test',
            model: 'response-model',
            object: 'chat.completion',
            service_tier: 'standard',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '你好 world' } }],
            usage: {
                prompt_tokens: 15,
                completion_tokens: 5,
                total_tokens: 20,
                prompt_tokens_details: { cached_tokens: 3 },
            },
        })
        expect(result.created).toBeGreaterThan(0)
    })

    test.each<[AnthropicStopReason | null, string | null]>([
        ['end_turn', 'stop'],
        ['stop_sequence', 'stop'],
        ['max_tokens', 'length'],
        ['model_context_window_exceeded', 'length'],
        ['tool_use', 'tool_calls'],
        ['refusal', 'content_filter'],
        ['pause_turn', 'pause_turn'],
        [null, null],
    ])('maps stop_reason %s to %s', async (reason, expected) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => Response.json({ ...response, stop_reason: reason }))
        )
        expect((await new AnthropicProvider(config).chat(messages)).choices[0].finish_reason).toBe(expected)
    })

    test('handles absent cache usage and a response containing only tool blocks', async () => {
        const native: AnthropicChatResponse = {
            ...response,
            content: [{ type: 'tool_use', id: 'tool_test', name: 'lookup', input: { query: 'hello' } }],
            usage: { input_tokens: 10, output_tokens: 5 },
        }
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => Response.json(native))
        )
        const result = await new AnthropicProvider(config).chat(messages)
        expect(result.choices[0].message.content).toBe('')
        expect(result.usage.prompt_tokens).toBe(10)
        expect(result.usage.total_tokens).toBe(15)
        expect(result.usage.prompt_tokens_details.cached_tokens).toBe(0)
        expect(result.service_tier).toBe('default')
    })
})

describe('AnthropicProvider.stream', () => {
    const events: AnthropicStreamResponse[] = [
        { type: 'ping' },
        { type: 'message_start', message: { ...response, content: [], stop_reason: null } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'A' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'private' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'B' } },
        { type: 'content_block_stop', index: 3 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
    ]

    const expectChunks = (chunks: StreamResponse[]) => {
        expect(chunks.map(chunk => chunk.choices[0].delta.content)).toEqual(['', 'A', '你好', 'B'])
        for (const chunk of chunks) {
            expect(chunk).toMatchObject({
                id: 'msg_test',
                model: 'response-model',
                object: 'chat.completion.chunk',
                service_tier: 'standard',
                usage: null,
                choices: [{ index: 0, delta: { role: 'assistant' } }],
            })
            expect(chunk.created).toBe(chunks[0].created)
        }
    }

    test('converts coalesced events, ignores non-text events and stops at message_stop', async () => {
        const fetch = mockStream([encoder.encode(encodeEvents(events) + 'data: invalid\n\n')])
        expectChunks(await collect())
        const request = fetch.mock.calls[0][1]!
        expect(JSON.parse(request.body as string).stream).toBe(true)
        expect(request.headers).toMatchObject({ Accept: 'text/event-stream' })
    })

    test.each(['\n', '\r\n', '\r'])('handles every byte boundary and UTF-8 with newline %j', async newline => {
        const bytes = encoder.encode(encodeEvents(events, newline))
        for (let split = 1; split < bytes.length; split++) {
            mockStream([bytes.slice(0, split), bytes.slice(split)])
            expectChunks(await collect())
        }
        mockStream(Array.from(bytes, byte => new Uint8Array([byte])))
        expectChunks(await collect())
    })

    test('accepts a final event without a trailing blank line', async () => {
        mockStream([
            encoder.encode(
                encodeEvents([events[1]]) + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"tail"}}'
            ),
        ])
        expect((await collect()).map(chunk => chunk.choices[0].delta.content)).toEqual(['', 'tail'])
    })

    test.each([
        ['data: invalid\n\n', SyntaxError],
        [encodeEvents([{ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }]), /overloaded_error.*busy/],
    ])('propagates parsing/API errors and releases the reader: %s', async (payload, error) => {
        const cancel = vi.fn()
        const body = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(encoder.encode(payload as string))
            },
            cancel,
        })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(body))
        )
        await expect(collect()).rejects.toThrow(error)
        expect(cancel).toHaveBeenCalledOnce()
        expect(body.locked).toBe(false)
    })

    test('cancels and releases the reader when the caller stops early', async () => {
        const cancel = vi.fn()
        const body = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(encoder.encode(encodeEvents([events[1]])))
            },
            cancel,
        })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(body))
        )
        const stream = new AnthropicProvider(config).stream(messages)
        await stream.next()
        await stream.return(undefined)
        expect(cancel).toHaveBeenCalledOnce()
        expect(body.locked).toBe(false)
    })

    test('rejects a response without a stream body', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null))
        )
        await expect(collect()).rejects.toThrow('no stream body')
    })
})

test.each(['chat', 'stream'] as const)('%s propagates HTTP errors and cancels the response body', async method => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body, { status: 429 }))
    )
    const provider = new AnthropicProvider(config)
    await expect(method === 'chat' ? provider.chat(messages) : collect(provider)).rejects.toThrow('HTTP 429')
    expect(cancel).toHaveBeenCalledOnce()
})
