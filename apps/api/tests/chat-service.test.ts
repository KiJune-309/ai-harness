import { randomUUID } from 'node:crypto'
import { ChatRuntimeError, type ChatRunInput, type ChatRuntime } from '@ai-harness/chat-runtime'
import type { ChatStreamEvent } from '@ai-harness/contracts'
import { createMemoryChatStore, type ChatStore } from '@ai-harness/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatService } from '../src/chat-service.js'
import type { CollaborationService } from '../src/collaboration-service.js'
import { readTestApiConfig as readApiConfig } from './config-fixture.js'

const scope = { userId: randomUUID(), workspaceId: 'personal' }
const config = readApiConfig({ HARNESS_API_TOKEN: 'local-test-transport-token-of-sufficient-length', CHAT_STORE: 'memory' })
const services: ChatService[] = []

/**
 * Create a service with explicit temporary storage and an observable runtime.
 * @param run - Runtime behavior for the current test.
 * @returns The owned service, store, and recorded runtime calls.
 */
async function fixture(run: ChatRuntime['run'] = async () => ({ content: '回答', reasoning: '', status: 'complete' })) {
    const store = await createMemoryChatStore()
    const runtime = { run: vi.fn(run), dispose: vi.fn(async () => undefined) }
    const service = new ChatService(store, runtime, config)
    services.push(service)
    return { service, store, runtime }
}

/**
 * Wait for request cancellation without leaving an event listener behind.
 * @param signal - Runtime-owned cancellation signal.
 * @returns A promise resolved when this signal is aborted.
 */
async function untilAborted(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
}

/**
 * Record a complete service stream for an idempotent user message.
 * @param service - Initialized chat coordinator.
 * @param id - Owned conversation UUID.
 * @param requestId - Stable user-turn identifier.
 * @param content - User question.
 * @param signal - Optional disconnect signal.
 * @returns Public stream events emitted after durable settlement.
 */
async function send(service: ChatService, id: string, requestId: string, content = '你好', signal = new AbortController().signal) {
    const events: ChatStreamEvent[] = []
    await service.send(scope, id, { requestId, content }, signal, event => events.push(event))
    return events
}

afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()))
})

describe('ChatService durable user-turn coordination', () => {
    it('opens legacy bound collaboration Tasks through normal chat APIs while isolating ordinary private Tasks', async () => {
        const { store, runtime, service: original } = await fixture()
        const incoming = await original.createTask(scope, { requestId: randomUUID(), title: '同事来信', goal: '请评估问题' })
        const personal = await original.createTask(scope, { requestId: randomUUID(), title: '个人任务', goal: '个人计划' })
        const accept = vi.fn(async () => incoming)
        const collaboration = {
            isBound: vi.fn<CollaborationService['isBound']>(async (_scope, source) => source.kind === 'task' && source.id === incoming.id),
            accept,
        } as unknown as CollaborationService
        const chat = new ChatService(store, runtime, config, undefined, undefined, collaboration)
        services.push(chat)
        // Historical received Tasks were already started, unlike ordinary manually created Tasks.
        incoming.task.started = true
        incoming.task.status = 'in-progress'
        await store.save(scope, incoming)
        expect((await chat.list(scope)).map(item => item.id)).toContain(incoming.id)
        expect((await chat.list(scope)).map(item => item.id)).not.toContain(personal.id)
        expect((await chat.get(scope, incoming.id)).id).toBe(incoming.id)
        await expect(chat.get(scope, personal.id)).rejects.toMatchObject({ status: 404 })
        await expect(chat.get({ ...scope, userId: randomUUID() }, incoming.id)).rejects.toMatchObject({ status: 404 })
        const requestId = randomUUID()
        await send(chat, incoming.id, requestId, '帮我问一下发件人')
        expect(accept).toHaveBeenCalledWith(scope, { kind: 'task', id: incoming.id }, { requestId, content: '帮我问一下发件人' })
        expect(runtime.run).not.toHaveBeenCalled()
    })

    it('replays completed request IDs after recreating the service without duplicate model calls or messages', async () => {
        const { service, store, runtime } = await fixture()
        const conversation = await service.create(scope)
        const requestId = randomUUID()
        const first = await send(service, conversation.id, requestId)
        expect(first.map(event => event.type)).toEqual(['start', 'done'])
        const restarted = new ChatService(store, runtime, config)
        const replay = await send(restarted, conversation.id, requestId)
        expect(replay).toEqual([first.at(-1)])
        expect(runtime.run).toHaveBeenCalledOnce()
        expect((await service.get(scope, conversation.id)).messages.map(message => message.role)).toEqual(['user', 'assistant'])
        await expect(send(restarted, conversation.id, requestId, '不同的问题')).rejects.toMatchObject({ status: 409 })
        expect(runtime.run).toHaveBeenCalledOnce()
    })

    it('saves partial reasoning and text when the HTTP disconnect signal aborts', async () => {
        const disconnected = new AbortController()
        const { service, runtime } = await fixture(async input => {
            input.onDelta({ type: 'reasoning', text: '正在思考' })
            input.onDelta({ type: 'delta', text: '已生成的部分' })
            disconnected.abort()
            await untilAborted(input.signal)
            return { content: '已生成的部分', reasoning: '正在思考', status: 'cancelled' }
        })
        const conversation = await service.create(scope)
        const requestId = randomUUID()
        const events = await send(service, conversation.id, requestId, '请回答', disconnected.signal)
        expect(events.map(event => event.type)).toEqual(['start', 'reasoning', 'delta', 'cancelled'])
        expect(runtime.run.mock.calls[0]?.[0].signal.aborted).toBe(true)
        const saved = await service.get(scope, conversation.id)
        expect(saved.activeRequestId).toBeUndefined()
        expect(saved.messages.at(-1)).toMatchObject({
            role: 'assistant',
            content: '已生成的部分',
            reasoning: '正在思考',
            status: 'cancelled',
            requestId,
        })
    })

    it('joins explicit cancellation, rejects simultaneous turns, and retries the same request without duplicates', async () => {
        const started = Promise.withResolvers<void>()
        let runs = 0
        const { service, runtime } = await fixture(async input => {
            runs += 1
            if (runs > 1) return { content: '重试完成', reasoning: '', status: 'complete' }
            input.onDelta({ type: 'delta', text: '部分回答' })
            started.resolve()
            await untilAborted(input.signal)
            return { content: '部分回答', reasoning: '', status: 'cancelled' }
        })
        const conversation = await service.create(scope)
        const requestId = randomUUID()
        const pending = send(service, conversation.id, requestId)
        await started.promise
        expect((await service.get(scope, conversation.id)).activeRequestId).toBe(requestId)
        expect((await service.list(scope))[0]?.activeRequestId).toBe(requestId)
        await expect(send(service, conversation.id, randomUUID())).rejects.toMatchObject({ status: 409 })
        await expect(send(service, conversation.id, requestId)).rejects.toMatchObject({ status: 409 })
        await expect(service.cancel(scope, conversation.id, randomUUID())).rejects.toMatchObject({ status: 409 })
        const cancelled = await service.cancel(scope, conversation.id, requestId)
        expect(cancelled.messages.at(-1)?.status).toBe('cancelled')
        expect((await pending).at(-1)?.type).toBe('cancelled')
        const retried = await send(service, conversation.id, requestId)
        expect(retried.at(-1)?.type).toBe('done')
        expect(runtime.run).toHaveBeenCalledTimes(2)
        expect(runtime.run.mock.calls[1]?.[0].history).toEqual([])
        expect((await service.get(scope, conversation.id)).messages.map(message => message.content)).toEqual(['你好', '重试完成'])
    })

    it('sanitizes unexpected errors, saves failed attempts, and retries from the prior successful history', async () => {
        let runs = 0
        const { service, runtime } = await fixture(async input => {
            runs += 1
            if (runs === 2) {
                input.onDelta({ type: 'delta', text: '部分' })
                throw new Error('postgresql://secret:password@private.invalid/provider-key')
            }
            return { content: `回答${runs}`, reasoning: '', status: 'complete' }
        })
        const conversation = await service.create(scope)
        await send(service, conversation.id, randomUUID(), '第一轮')
        const requestId = randomUUID()
        const failed = await send(service, conversation.id, requestId, '第二轮')
        expect(failed.at(-1)?.type).toBe('error')
        expect(JSON.stringify(failed)).not.toContain('password')
        expect(JSON.stringify(failed)).not.toContain('provider-key')
        expect((await service.get(scope, conversation.id)).messages.at(-1)).toMatchObject({ content: '部分', status: 'error' })
        await send(service, conversation.id, requestId, '第二轮')
        expect(runtime.run.mock.calls[2]?.[0].history.map(message => message.content)).toEqual(['第一轮', '回答1'])
        expect((await service.get(scope, conversation.id)).messages.map(message => message.content)).toEqual([
            '第一轮',
            '回答1',
            '第二轮',
            '回答3',
        ])
    })

    it('refuses retrying an interrupted older turn after a newer question exists', async () => {
        let runs = 0
        const { service } = await fixture(async () => ({
            content: `回答${++runs}`,
            reasoning: '',
            status: runs === 1 ? 'cancelled' : 'complete',
        }))
        const conversation = await service.create(scope)
        const oldRequest = randomUUID()
        await send(service, conversation.id, oldRequest, '旧问题')
        await send(service, conversation.id, randomUUID(), '新问题')
        await expect(send(service, conversation.id, oldRequest, '旧问题')).rejects.toMatchObject({ status: 409 })
        expect((await service.get(scope, conversation.id)).messages).toHaveLength(4)
    })

    it('removes stale process activity and hides other ownership scopes', async () => {
        const { service, store } = await fixture()
        const conversation = await service.create(scope)
        await store.save(scope, { ...conversation, activeRequestId: randomUUID() })
        expect((await service.get(scope, conversation.id)).activeRequestId).toBeUndefined()
        expect((await service.list(scope))[0]?.activeRequestId).toBeUndefined()
        const otherUser = { ...scope, userId: randomUUID() }
        const otherWorkspace = { ...scope, workspaceId: 'another-workspace' }
        for (const identity of [otherUser, otherWorkspace]) {
            expect(await service.list(identity)).toEqual([])
            await expect(service.get(identity, conversation.id)).rejects.toMatchObject({ status: 404 })
            await expect(service.cancel(identity, conversation.id, randomUUID())).rejects.toMatchObject({ status: 404 })
        }
    })

    it('refuses unconfigured model execution before changing the saved conversation', async () => {
        const store: ChatStore = await createMemoryChatStore()
        const service = new ChatService(store, undefined, config)
        services.push(service)
        const conversation = await service.create(scope)
        await expect(send(service, conversation.id, randomUUID())).rejects.toMatchObject({ status: 503 })
        expect(await service.get(scope, conversation.id)).toEqual(conversation)
        expect(service.status()).toEqual({ configured: false, model: config.model, storage: 'postgres' })
    })

    it('passes only trusted ownership and saved prior messages to the runtime', async () => {
        const { service, runtime } = await fixture()
        const conversation = await service.create(scope)
        await send(service, conversation.id, randomUUID(), '第一轮')
        await send(service, conversation.id, randomUUID(), '第二轮')
        const second: ChatRunInput = runtime.run.mock.calls[1]![0]
        expect(second.scope).toEqual(scope)
        expect(second.conversationId).toBe(conversation.id)
        expect(second.history.map(message => [message.role, message.content])).toEqual([
            ['user', '第一轮'],
            ['assistant', '回答'],
        ])
        expect(second.content).toBe('第二轮')
    })

    it('exposes safe categorized runtime refusals without changing their public message', async () => {
        const { service } = await fixture(async () => {
            throw new ChatRuntimeError('DeepSeek is busy. Please try again shortly.', 'DEEPSEEK_RATE_LIMIT')
        })
        const conversation = await service.create(scope)
        const events = await send(service, conversation.id, randomUUID())
        expect(events.at(-1)).toEqual({ type: 'error', message: 'DeepSeek is busy. Please try again shortly.' })
    })

    it('reserves a turn before a delayed storage read so concurrent requests cannot overwrite its history', async () => {
        const { service, store, runtime } = await fixture()
        const conversation = await service.create(scope)
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const originalGet = store.get.bind(store)
        let reads = 0
        vi.spyOn(store, 'get').mockImplementation(async (identity, id) => {
            const snapshot = await originalGet(identity, id)
            if (++reads === 1) {
                started.resolve()
                await release.promise
            }
            return snapshot
        })
        const pending = send(service, conversation.id, randomUUID(), '第一轮')
        await started.promise
        try {
            await expect(send(service, conversation.id, randomUUID(), '不应覆盖的并发请求')).rejects.toMatchObject({ status: 409 })
            expect(runtime.run).not.toHaveBeenCalled()
        } finally {
            release.resolve()
        }
        await pending
        await send(service, conversation.id, randomUUID(), '第二轮')
        expect(runtime.run.mock.calls[1]?.[0].history.map(message => message.content)).toEqual(['第一轮', '回答'])
        expect((await service.get(scope, conversation.id)).messages.map(message => message.content)).toEqual([
            '第一轮',
            '回答',
            '第二轮',
            '回答',
        ])
    })

    it('joins a delayed storage read during shutdown without starting the runtime or changing saved history', async () => {
        const { service, store, runtime } = await fixture()
        const conversation = await service.create(scope)
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const originalGet = store.get.bind(store)
        vi.spyOn(store, 'get').mockImplementation(async (identity, id) => {
            const snapshot = await originalGet(identity, id)
            started.resolve()
            await release.promise
            return snapshot
        })
        const save = vi.spyOn(store, 'save')
        const close = vi.spyOn(store, 'close')
        const pending = send(service, conversation.id, randomUUID())
        await started.promise
        const closing = service.close()
        try {
            expect(runtime.run).not.toHaveBeenCalled()
            expect(runtime.dispose).not.toHaveBeenCalled()
            expect(close).not.toHaveBeenCalled()
            await expect(send(service, conversation.id, randomUUID())).rejects.toMatchObject({ status: 503 })
        } finally {
            release.resolve()
        }
        expect(await pending).toEqual([])
        await closing
        expect(runtime.run).not.toHaveBeenCalled()
        expect(save).not.toHaveBeenCalled()
        expect(runtime.dispose).toHaveBeenCalledOnce()
        expect(close).toHaveBeenCalledOnce()
    })
})
