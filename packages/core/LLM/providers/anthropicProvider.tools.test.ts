import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AnthropicChatResponse, AnthropicContentBlock, Message, ToolDefinition } from '../types.ts'
import { AnthropicProvider } from './anthropicProvider.ts'

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const config = { apiKey: 'test-key', model: 'test-model', baseUrl: 'https://example.invalid/v1' }
const messages: Message[] = [{ role: 'user', content: 'Compare the weather in Shanghai and Beijing.' }]
const tools: ToolDefinition[] = [
    {
        name: 'weather',
        description: 'Get weather for a city.',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    },
]

const nativeResponse = (content: AnthropicContentBlock[], stopReason: AnthropicChatResponse['stop_reason']): AnthropicChatResponse => ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: config.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
})

describe('Anthropic tool conversation', () => {
    test('round-trips two tool calls, their results and the original signed content before returning text', async () => {
        const nativeContent: AnthropicContentBlock[] = [
            { type: 'thinking', thinking: 'Reasoning from the model.', signature: 'signed-by-provider' },
            { type: 'redacted_thinking', data: 'opaque-data' },
            { type: 'text', text: 'Checking both cities.' },
            { type: 'tool_use', id: 'call_shanghai', name: 'weather', input: { city: 'Shanghai' } },
            { type: 'tool_use', id: 'call_beijing', name: 'weather', input: { city: 'Beijing' } },
        ]
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(Response.json(nativeResponse(nativeContent, 'tool_use')))
            .mockResolvedValueOnce(Response.json(nativeResponse([{ type: 'text', text: 'Shanghai is warmer.' }], 'end_turn')))
        vi.stubGlobal('fetch', fetch)
        const provider = new AnthropicProvider(config)

        const first = await provider.chat(messages, { tools })
        expect(first.choices[0]).toMatchObject({
            finish_reason: 'tool_calls',
            message: {
                role: 'assistant',
                content: 'Checking both cities.',
                tool_calls: [
                    { id: 'call_shanghai', type: 'function', function: { name: 'weather', arguments: '{"city":"Shanghai"}' } },
                    { id: 'call_beijing', type: 'function', function: { name: 'weather', arguments: '{"city":"Beijing"}' } },
                ],
                providerContent: nativeContent,
            },
        })
        const history: Message[] = [
            ...messages,
            first.choices[0].message,
            { role: 'tool', tool_call_id: 'call_shanghai', content: '24 degrees' },
            { role: 'tool', tool_call_id: 'call_beijing', content: '18 degrees' },
        ]
        const snapshot = structuredClone(history)
        const final = await provider.chat(history, { tools })

        expect(final.choices[0]).toMatchObject({ finish_reason: 'stop', message: { role: 'assistant', content: 'Shanghai is warmer.' } })
        const firstRequest = JSON.parse(fetch.mock.calls[0][1]!.body as string)
        expect(firstRequest.tools).toEqual([{ name: 'weather', description: 'Get weather for a city.', input_schema: tools[0].parameters }])
        const secondRequest = JSON.parse(fetch.mock.calls[1][1]!.body as string)
        expect(secondRequest.messages).toEqual([
            ...messages,
            { role: 'assistant', content: nativeContent },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'call_shanghai', content: '24 degrees' },
                    { type: 'tool_result', tool_use_id: 'call_beijing', content: '18 degrees' },
                ],
            },
        ])
        expect(history).toEqual(snapshot)
    })

    test('reconstructs shared assistant calls when native provider content is absent', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () =>
            Response.json(nativeResponse([{ type: 'text', text: 'Done.' }], 'end_turn'))
        )
        vi.stubGlobal('fetch', fetch)
        const history: Message[] = [
            ...messages,
            {
                role: 'assistant',
                content: 'Checking Shanghai.',
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Shanghai"}' } }],
            },
            { role: 'tool', tool_call_id: 'call_1', content: '24 degrees' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'weather', arguments: '{"city":"Beijing"}' } }],
            },
            { role: 'tool', tool_call_id: 'call_2', content: '18 degrees' },
        ]

        await new AnthropicProvider(config).chat(history)
        expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).messages).toEqual([
            ...messages,
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Checking Shanghai.' },
                    { type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Shanghai' } },
                ],
            },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '24 degrees' }] },
            { role: 'assistant', content: [{ type: 'tool_use', id: 'call_2', name: 'weather', input: { city: 'Beijing' } }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_2', content: '18 degrees' }] },
        ])
    })

    test('streams a text answer from a conversation that already contains tool results', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(
            async () =>
                new Response(
                    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Warm."}}\n\n' +
                        'data: {"type":"message_stop"}\n\n'
                )
        )
        vi.stubGlobal('fetch', fetch)
        const history: Message[] = [
            ...messages,
            {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Shanghai"}' } }],
            },
            { role: 'tool', tool_call_id: 'call_1', content: '24 degrees' },
        ]
        const chunks = []
        for await (const chunk of new AnthropicProvider(config).stream(history)) chunks.push(chunk)

        expect(chunks.map(chunk => chunk.choices[0].delta.content)).toEqual(['Warm.'])
        expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).messages).toEqual([
            ...messages,
            { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Shanghai' } }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '24 degrees' }] },
        ])
    })

    test.each(['null', '[]', '42'])('rejects tool arguments that are not JSON objects: %s', async args => {
        const fetch = vi.fn<typeof globalThis.fetch>()
        vi.stubGlobal('fetch', fetch)
        const history: Message[] = [
            ...messages,
            {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: args } }],
            },
        ]

        await expect(new AnthropicProvider(config).chat(history)).rejects.toThrow("Tool call 'call_1' arguments must be a JSON object")
        expect(fetch).not.toHaveBeenCalled()
    })
})
