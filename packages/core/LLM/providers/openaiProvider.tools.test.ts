import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Message, ToolCall, ToolDefinition } from '../types.ts'
import { OpenAIProvider } from './openaiProvider.ts'

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const config = { apiKey: 'test-key', model: 'configured-model', baseUrl: 'https://example.invalid/v1/' }
const messages: Message[] = [
    { role: 'system', content: 'Be helpful' },
    { role: 'user', content: 'What is the weather?' },
]
const tool: ToolDefinition = {
    name: 'get_weather',
    description: 'Look up the weather in a city',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
}
const toolCall: ToolCall = { id: 'call_weather', type: 'function', function: { name: tool.name, arguments: '{"city":"Shanghai"}' } }

const mockChat = (
    message: { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] } = { role: 'assistant', content: 'Hello' }
) => {
    const response = {
        id: 'chat_test',
        choices: [{ index: 0, finish_reason: message.tool_calls?.length ? 'tool_calls' : 'stop', message }],
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response))
    vi.stubGlobal('fetch', fetch)
    return { fetch, response }
}

const mockStream = () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetch)
    return fetch
}

describe('OpenAIProvider tool requests', () => {
    test.each([undefined, []])('keeps plain chat requests compatible when tools are %j', async tools => {
        const { fetch } = mockChat()
        await new OpenAIProvider(config).chat(messages, { tools })

        expect(fetch.mock.calls[0][0]).toBe('https://example.invalid/v1/chat/completions')
        expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ model: config.model, messages, stream: false })
    })

    test('sends function definitions and preserves assistant/tool history without internal provider content', async () => {
        const { fetch } = mockChat()
        const history: Message[] = [
            ...messages,
            {
                role: 'assistant',
                content: null,
                tool_calls: [toolCall],
                providerContent: [{ type: 'thinking', thinking: 'Internal reasoning', signature: 'signature' }],
            },
            { role: 'tool', content: '{"temperature":22}', tool_call_id: toolCall.id },
        ]
        await new OpenAIProvider(config).chat(history, { tools: [tool] })

        expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
            model: config.model,
            messages: [
                ...messages,
                { role: 'assistant', content: null, tool_calls: [toolCall] },
                { role: 'tool', content: '{"temperature":22}', tool_call_id: toolCall.id },
            ],
            tools: [{ type: 'function', function: tool }],
            stream: false,
        })
    })

    test('returns tool-only responses with null content and intact tool calls', async () => {
        const { response } = mockChat({ role: 'assistant', content: null, tool_calls: [toolCall] })
        const result = await new OpenAIProvider(config).chat(messages, { tools: [tool] })

        expect(result).toEqual(response)
    })

    test('uses the same message and tool serialization for streaming requests', async () => {
        const fetch = mockStream()
        const history: Message[] = [
            ...messages,
            { role: 'assistant', content: 'Checking', tool_calls: [toolCall] },
            { role: 'tool', content: '22°C', tool_call_id: toolCall.id },
        ]
        const stream = new OpenAIProvider(config).stream(history, { tools: [tool] })
        expect(await stream.next()).toEqual({ value: undefined, done: true })

        expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
            model: config.model,
            messages: history,
            tools: [{ type: 'function', function: tool }],
            stream: true,
        })
    })

    test('passes caller cancellation through to chat requests', async () => {
        const { fetch } = mockChat()
        const abort = new AbortController()
        await new OpenAIProvider(config).chat(messages, { signal: abort.signal, tools: [tool] })
        const requestSignal = fetch.mock.calls[0][1]!.signal!

        expect(requestSignal.aborted).toBe(false)
        abort.abort()
        expect(requestSignal.aborted).toBe(true)
    })

    test('passes caller cancellation through to streaming requests', async () => {
        const fetch = mockStream()
        const abort = new AbortController()
        await new OpenAIProvider(config).stream(messages, { signal: abort.signal, tools: [tool] }).next()
        const requestSignal = fetch.mock.calls[0][1]!.signal!

        expect(requestSignal.aborted).toBe(false)
        abort.abort()
        expect(requestSignal.aborted).toBe(true)
    })
})
