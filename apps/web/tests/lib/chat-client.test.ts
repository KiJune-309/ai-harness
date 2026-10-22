import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatConversation, ChatStreamEvent } from '@ai-harness/contracts'
import {
    cancelConversation,
    decideHumanRequest,
    deleteConversation,
    createConversation,
    getChatStatus,
    listConversations,
    streamMessage,
    requestChatResponse,
} from '../../lib/chat-client'

const conversationId = '64e34de2-6999-4986-8a6c-0f4cc56b4e8a'
const requestId = '93ff4454-dc55-4ac6-9c88-d733fe16935b'
const conversation: ChatConversation = {
    id: conversationId,
    title: '测试对话',
    messages: [],
    createdAt: '2026-10-17T03:00:00.000Z',
    updatedAt: '2026-10-17T03:00:00.000Z',
}

/**
 * Creates an SSE response using exact byte chunks to exercise stream boundaries.
 * @param chunks - Byte chunks delivered by the simulated HTTP connection.
 * @returns A readable HTTP response containing the scripted event stream.
 */
function eventResponse(chunks: Uint8Array[]) {
    return new Response(
        new ReadableStream<Uint8Array>({
            /**
             * Supplies the scripted stream bytes and closes the fixture.
             * @param controller - Reader-facing controller for this fixture.
             * @returns Nothing; enqueues all fixture chunks.
             */
            start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk)
                controller.close()
            },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
    )
}

/**
 * Encodes chat events in the server's SSE format.
 * @param events - Ordered events emitted by the simulated server.
 * @returns UTF-8 bytes for complete SSE frames.
 */
function encodeEvents(...events: ChatStreamEvent[]) {
    return new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('chat client', () => {
    it('deletes only the selected chat and requires its matching durable receipt', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ id: conversationId, deleted: true }))
            .mockResolvedValueOnce(Response.json({ id: requestId, deleted: true }))
        vi.stubGlobal('fetch', fetchMock)
        await deleteConversation(conversationId)
        expect(fetchMock.mock.calls[0]![0]).toBe(`/api/chat/conversations/${conversationId}`)
        expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE')
        await expect(deleteConversation(conversationId)).rejects.toThrow('未能确认对话删除结果')
    })
    it('binds a bottom-composer answer to the exact persisted question without granting approval', async () => {
        const humanResponse = { requestId: 'e8acbd9e-613f-4dd6-aab4-ffb5ce2fa3bf', version: 3 }
        const fetchMock = vi.fn().mockResolvedValue(eventResponse([encodeEvents({ type: 'done', conversation })]))
        vi.stubGlobal('fetch', fetchMock)
        await streamMessage(conversationId, '确认', requestId, vi.fn(), new AbortController().signal, [], humanResponse)
        expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ content: '确认', requestId, humanResponse })
    })

    it('submits only a dedicated action identity and saved version for a human decision', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(conversation))
        vi.stubGlobal('fetch', fetchMock)
        const humanRequestId = 'e8acbd9e-613f-4dd6-aab4-ffb5ce2fa3bf'
        const action = { actionId: requestId, version: 2, decision: 'approve' as const }
        expect(await decideHumanRequest(conversationId, humanRequestId, action)).toEqual(conversation)
        expect(fetchMock.mock.calls[0]![0]).toBe(`/api/chat/conversations/${conversationId}/human-requests/${humanRequestId}/decisions`)
        expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual(action)
    })

    it('decodes split UTF-8 characters, multiple frames, and reasoning without losing text', async () => {
        const events: ChatStreamEvent[] = [
            { type: 'start', conversationId, requestId },
            { type: 'reasoning', text: '先思考' },
            { type: 'delta', text: '你好，DeepSeek' },
            { type: 'done', conversation },
        ]
        const bytes = encodeEvents(...events)
        const chunks = Array.from(bytes, byte => new Uint8Array([byte]))
        const fetchMock = vi.fn().mockResolvedValue(eventResponse(chunks))
        vi.stubGlobal('fetch', fetchMock)
        const received: ChatStreamEvent[] = []
        const controller = new AbortController()

        await streamMessage(conversationId, '你好', requestId, event => received.push(event), controller.signal)

        expect(received).toEqual(events)
        expect(fetchMock).toHaveBeenCalledWith(
            `/api/chat/conversations/${conversationId}/messages`,
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
                body: JSON.stringify({ content: '你好', requestId }),
                signal: expect.any(AbortSignal),
            })
        )
        controller.abort()
        expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true)
    })

    it('times out stalled connection setup without aborting the caller signal', async () => {
        vi.useFakeTimers()
        const caller = new AbortController()
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (_url, options: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
                    })
            )
        )
        const pending = requestChatResponse('/tasks', { signal: caller.signal })
        const rejected = expect(pending).rejects.toThrow('连接超时')
        await vi.advanceTimersByTimeAsync(15_000)
        await rejected
        expect(caller.signal.aborted).toBe(false)
    })

    it('clears the connection deadline once headers arrive so long model streams remain usable', async () => {
        vi.useFakeTimers()
        let signal: AbortSignal | undefined
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url, options: RequestInit) => {
                signal = options.signal as AbortSignal
                return new Response(new ReadableStream())
            })
        )
        const response = await requestChatResponse('/tasks/id/start', { method: 'POST' })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(signal?.aborted).toBe(false)
        await response.body?.cancel()
    })

    it('reports a localized network failure without reflecting raw transport messages', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('private transport diagnostics')))
        await expect(requestChatResponse('/tasks')).rejects.toThrow('请检查网络后重试')
        await expect(requestChatResponse('/tasks')).rejects.not.toThrow('private transport')
    })

    it('accepts CRLF and keep-alives even when CRLF is split across chunks', async () => {
        const bytes = new TextEncoder().encode(`: keepalive\r\n\r\ndata: ${JSON.stringify({ type: 'done', conversation })}\r\n\r\n`)
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(eventResponse(Array.from(bytes, byte => new Uint8Array([byte])))))
        const receive = vi.fn()

        await streamMessage(conversationId, '继续', requestId, receive, new AbortController().signal)

        expect(receive).toHaveBeenCalledExactlyOnceWith({ type: 'done', conversation })
    })

    it('reports a connection closed before the terminal event instead of treating partial text as complete', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(eventResponse([encodeEvents({ type: 'delta', text: '部分回答' })])))

        await expect(streamMessage(conversationId, '继续', requestId, vi.fn(), new AbortController().signal)).rejects.toThrow('连接已中断')
    })

    it('rejects malformed event bodies using the shared contracts', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(eventResponse([new TextEncoder().encode('data: {"type":"delta","text":7}\n\n')])))

        await expect(streamMessage(conversationId, '继续', requestId, vi.fn(), new AbortController().signal)).rejects.toThrow('无效的数据')
    })

    it('rejects a malformed completion conversation before it can enter UI state', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(eventResponse([new TextEncoder().encode('data: {"type":"done","conversation":{}}\n\n')]))
        )

        await expect(streamMessage(conversationId, '继续', requestId, vi.fn(), new AbortController().signal)).rejects.toThrow('无效的数据')
    })

    it('delivers a terminal provider error for the UI recovery flow', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(eventResponse([encodeEvents({ type: 'error', message: 'DeepSeek 请求超时' })])))
        const receive = vi.fn()

        await streamMessage(conversationId, '继续', requestId, receive, new AbortController().signal)

        expect(receive).toHaveBeenCalledExactlyOnceWith({ type: 'error', message: 'DeepSeek 请求超时' })
    })

    it('preserves useful HTTP error messages', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: '请先配置 DEEPSEEK_API_KEY' }, { status: 503 })))

        await expect(streamMessage(conversationId, '你好', requestId, vi.fn(), new AbortController().signal)).rejects.toThrow(
            '请先配置 DEEPSEEK_API_KEY'
        )
    })

    it('returns a safe fallback for a non-JSON proxy failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>unavailable</html>', { status: 502 })))

        await expect(getChatStatus()).rejects.toThrow('聊天服务请求失败（502）')
    })

    it('validates persisted history before displaying it', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ conversations: [{ id: 'invalid' }] })))

        await expect(listConversations()).rejects.toThrow('无效的数据')
    })

    it('creates a server conversation using the prompt title', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(conversation))
        vi.stubGlobal('fetch', fetchMock)

        await expect(createConversation('测试对话')).resolves.toEqual(conversation)
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/chat/conversations',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ title: '测试对话' }),
            })
        )
    })

    it('explicitly cancels the matching request and returns settled history', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(conversation))
        vi.stubGlobal('fetch', fetchMock)

        await expect(cancelConversation(conversationId, requestId)).resolves.toEqual(conversation)
        expect(fetchMock).toHaveBeenCalledWith(
            `/api/chat/conversations/${conversationId}/cancel`,
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ requestId }),
            })
        )
    })
})
