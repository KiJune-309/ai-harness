import type { ChatMessage } from '@ai-harness/contracts'
import { describe, expect, it } from 'vitest'
import { ChatRuntimeError, createChatRuntime, type ChatRunInput } from '../src/index.ts'

/**
 * Encode one provider delta into the standard SSE wire format.
 * @param delta - OpenAI-compatible streamed delta.
 * @param finish - Optional terminal finish reason.
 * @returns A complete SSE data event.
 */
function event(delta: Record<string, unknown>, finish: string | null = null): string {
    return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\r\n\r\n`
}

/**
 * Create a provider response whose chunks split UTF-8 and CRLF boundaries.
 * @param payload - Entire SSE text for one provider request.
 * @returns A fetch-compatible stream response.
 */
function response(payload: string): Response {
    const bytes = new TextEncoder().encode(payload)
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3))
                controller.close()
            },
        }),
        { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
    )
}

/**
 * Create a complete normal response for the real Cordis loop.
 * @param text - Assistant text to return.
 * @returns A standard DeepSeek stream including a terminal finish marker.
 */
function completed(text: string): Response {
    return response(event({ content: text }) + event({}, 'stop') + 'data: [DONE]\r\n\r\n')
}

/**
 * Construct an authenticated runtime invocation with an observable delta list.
 * @param changes - Optional invocation overrides.
 * @returns A complete runtime input and its accumulated streaming observations.
 */
function input(changes: Partial<ChatRunInput> = {}): ChatRunInput & { deltas: { type: string; text: string }[] } {
    const deltas: { type: string; text: string }[] = []
    return {
        scope: { userId: 'user-a', workspaceId: 'workspace-a' },
        conversationId: 'conversation',
        history: [],
        content: '你好',
        signal: new AbortController().signal,
        onDelta: delta => deltas.push(delta),
        ...changes,
        deltas,
    }
}

/**
 * Construct a persisted conversation message accepted by shared contracts.
 * @param role - Conversation role.
 * @param content - Persisted text.
 * @returns A complete prior message.
 */
function message(role: 'user' | 'assistant', content: string): ChatMessage {
    return { id: `${role}-${content}`, role, content, status: 'complete', createdAt: new Date(0).toISOString() }
}

describe('Cordis DeepSeek chat runtime', () => {
    it('streams reasoning and UTF-8 text through the real agent loop with ordered history and attribution', async () => {
        const requests: { url: string; init: RequestInit }[] = []
        const runtime = await createChatRuntime({
            apiKey: 'test-secret',
            baseUrl: 'https://provider.example/v1/',
            model: 'deepseek-flash',
            systemPrompt: 'Follow the conversation.',
            maxTokens: 128,
            fetch: async (url, init) => {
                requests.push({ url: String(url), init: init! })
                return response(
                    ': keepalive\r\n\r\n' +
                        event({ reasoning_content: '想一想' }) +
                        'data: {"choices":\r\ndata: [{"index":0,"delta":{"content":"你好，世界"},"finish_reason":null}]}\r\n\r\n' +
                        event({}, 'stop') +
                        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\r\n\r\n' +
                        'data: [DONE]\r\n\r\n'
                )
            },
        })
        try {
            const turn = input({
                history: [message('user', '先前的问题'), { ...message('assistant', '先前的回复'), reasoning: '先前的思考' }],
            })
            expect(await runtime.run(turn)).toEqual({ content: '你好，世界', reasoning: '想一想', status: 'complete' })
            expect(turn.deltas).toEqual([
                { type: 'reasoning', text: '想一想' },
                { type: 'delta', text: '你好，世界' },
            ])
            expect(requests[0]!.url).toBe('https://provider.example/v1/chat/completions')
            const body = JSON.parse(String(requests[0]!.init.body))
            expect(body).toMatchObject({ model: 'deepseek-flash', stream: true, max_tokens: 128 })
            expect(body.messages).toEqual([
                { role: 'system', content: 'Follow the conversation.' },
                { role: 'user', content: '先前的问题' },
                { role: 'assistant', content: '先前的回复', reasoning_content: '先前的思考' },
                { role: 'user', content: '你好' },
            ])
            expect(new Headers(requests[0]!.init.headers).get('authorization')).toBe('Bearer test-secret')
            expect(new Headers(requests[0]!.init.headers).get('user-agent')).toContain('deepseek-harness')
        } finally {
            await runtime.dispose()
        }
    })

    it('reconstructs every turn from authorized history without sharing another workspace or stale cancelled output', async () => {
        const histories: unknown[] = []
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async (_url, init) => {
                histories.push(JSON.parse(String(init!.body)).messages)
                return completed('answer')
            },
        })
        try {
            await runtime.run(input({ history: [message('user', 'private-a'), message('assistant', 'answer-a')] }))
            await runtime.run(input({ scope: { userId: 'user-a', workspaceId: 'workspace-b' }, history: [] }))
            await runtime.run(input({ history: [] }))
            expect(JSON.stringify(histories[0])).toContain('private-a')
            expect(JSON.stringify(histories[1])).not.toContain('private-a')
            expect(JSON.stringify(histories[2])).not.toContain('private-a')
        } finally {
            await runtime.dispose()
        }
    })

    it('cancels pending stream reads and keeps the delivered prefix, then permits a fresh retry', async () => {
        let fetches = 0
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async () => {
                fetches += 1
                if (fetches > 1) return completed('retry')
                return new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode(event({ content: 'prefix' })))
                        },
                    }),
                    { headers: { 'content-type': 'text/event-stream' } }
                )
            },
        })
        const controller = new AbortController()
        try {
            const turn = input({ signal: controller.signal, onDelta: () => controller.abort() })
            expect(await runtime.run(turn)).toEqual({ content: 'prefix', reasoning: '', status: 'cancelled' })
            expect(await runtime.run(input())).toEqual({ content: 'retry', reasoning: '', status: 'complete' })
        } finally {
            await runtime.dispose()
        }
    })

    it('does not turn an interrupted provider stream into a successful assistant message', async () => {
        const runtime = await createChatRuntime({ apiKey: 'key', fetch: async () => response(event({ content: 'partial' })) })
        try {
            await expect(runtime.run(input())).rejects.toMatchObject({ code: 'DEEPSEEK_REQUEST_FAILED' })
        } finally {
            await runtime.dispose()
        }
    })

    it('isolates simultaneous workspace scopes while refusing duplicate active turns in one scope', async () => {
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        let fetches = 0
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async () => {
                fetches += 1
                if (fetches === 1) {
                    started.resolve()
                    await release.promise
                }
                return completed('answer')
            },
        })
        try {
            const first = runtime.run(input())
            await started.promise
            await expect(runtime.run(input())).rejects.toMatchObject({ code: 'CONVERSATION_BUSY' })
            expect((await runtime.run(input({ scope: { userId: 'user-a', workspaceId: 'workspace-b' } }))).status).toBe('complete')
            release.resolve()
            expect((await first).status).toBe('complete')
        } finally {
            release.resolve()
            await runtime.dispose()
        }
    })

    it('joins active cancellation during shutdown and refuses new work afterward', async () => {
        const started = Promise.withResolvers<void>()
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async () =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode(event({ content: 'prefix' })))
                        },
                    }),
                    { headers: { 'content-type': 'text/event-stream' } }
                ),
        })
        const active = runtime.run(input({ onDelta: () => started.resolve() }))
        await started.promise
        await runtime.dispose()
        expect(await active).toEqual({ content: 'prefix', reasoning: '', status: 'cancelled' })
        await expect(runtime.run(input())).rejects.toMatchObject({ code: 'RUNTIME_CLOSED' })
    })

    it('redacts provider response bodies and rejects tools in text-only chat', async () => {
        for (const providerResponse of [
            new Response('secret-key should never escape', { status: 401 }),
            response(event({ tool_calls: [{ id: 'call-secret' }] })),
        ]) {
            const runtime = await createChatRuntime({ apiKey: 'secret-key', fetch: async () => providerResponse })
            try {
                const failure = await runtime.run(input()).catch(error => error)
                expect(failure).toBeInstanceOf(ChatRuntimeError)
                expect(String(failure)).not.toContain('secret-key')
                expect(String(failure)).not.toContain('call-secret')
            } finally {
                await runtime.dispose()
            }
        }
    })

    it('times out a stalled stream and cancels its reader', async () => {
        let cancelled = false
        const runtime = await createChatRuntime({
            apiKey: 'key',
            timeoutMs: 20,
            fetch: async () =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        cancel() {
                            cancelled = true
                        },
                    }),
                    { headers: { 'content-type': 'text/event-stream' } }
                ),
        })
        try {
            await expect(runtime.run(input())).rejects.toMatchObject({ code: 'DEEPSEEK_TIMEOUT' })
            expect(cancelled).toBe(true)
        } finally {
            await runtime.dispose()
        }
    })
})
