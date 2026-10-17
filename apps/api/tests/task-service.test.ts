import { randomUUID } from 'node:crypto'
import type { ChatRuntime } from '@ai-harness/chat-runtime'
import type { ChatStreamEvent, CreateTask } from '@ai-harness/contracts'
import { createChatStore } from '@ai-harness/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from '../src/agent-service.js'
import { createAgentCatalog } from '../src/agent-catalog.js'
import { ChatService } from '../src/chat-service.js'
import { readApiConfig, type ApiConfig } from '../src/config.js'

const scope = { userId: randomUUID(), workspaceId: 'personal' }
const config = readApiConfig({ HARNESS_API_TOKEN: 'task-test-transport-token-of-sufficient-length', CHAT_STORE: 'memory' })
const services: ChatService[] = []

/**
 * Produce a complete successful model response without a network connection.
 * @returns A settled runtime result used by lifecycle tests.
 */
async function success() {
    return { content: '任务回答', reasoning: '', status: 'complete' as const }
}

/**
 * Initialize scoped temporary persistence, real Agent validation and observable execution.
 * @param run - Runtime behavior, or null to simulate missing model credentials.
 * @param settings - Deployment settings overridden for snapshot tests.
 * @returns The initialized service and its observable dependencies.
 */
async function fixture(run: ChatRuntime['run'] | null = success, settings: Partial<ApiConfig> = {}) {
    const store = await createChatStore({ allowMemory: true })
    const runtime = run ? { run: vi.fn(run), dispose: vi.fn(async () => undefined) } : undefined
    const deployment = { ...config, ...settings }
    const agents = new AgentService(store.agents, createAgentCatalog(deployment, Boolean(runtime)))
    const service = new ChatService(store, runtime, deployment, agents)
    services.push(service)
    return { service, store, runtime, agents }
}

/**
 * Build a valid idempotent task creation request.
 * @param changes - Request fields replaced for one scenario.
 * @returns Independent task creation input with a new stable identifier.
 */
function creation(changes: Partial<CreateTask> = {}): CreateTask {
    return { requestId: randomUUID(), title: '比较候选方案', goal: '记住项目代号为海风，并比较三个候选方案。', ...changes }
}

/**
 * Execute or replay an initial task goal and collect public stream events.
 * @param service - Initialized task coordinator.
 * @param id - Stable task identifier.
 * @param requestId - Stable initial-turn identifier.
 * @returns Events emitted after accepted execution or replay.
 */
async function start(service: ChatService, id: string, requestId = randomUUID()): Promise<ChatStreamEvent[]> {
    const events: ChatStreamEvent[] = []
    await service.startTask(scope, id, requestId, new AbortController().signal, event => events.push(event))
    return events
}

/**
 * Execute or replay a supplementary task message and collect public stream events.
 * @param service - Initialized task coordinator.
 * @param id - Stable task identifier.
 * @param requestId - Stable supplementary-turn identifier.
 * @param content - User-supplied supplementary message.
 * @returns Events emitted after accepted execution or replay.
 */
async function send(service: ChatService, id: string, requestId = randomUUID(), content = '请根据前面的项目背景继续。') {
    const events: ChatStreamEvent[] = []
    await service.sendTask(scope, id, { requestId, content }, new AbortController().signal, event => events.push(event))
    return events
}

/**
 * Await model cancellation while avoiding a listener for an already-aborted signal.
 * @param signal - Runtime-owned cancellation signal.
 * @returns After the request has been cancelled.
 */
async function untilAborted(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
}

afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()))
})

describe('personal task creation, ownership and frozen context', () => {
    it('creates without model execution and replays only identical normalized creation input', async () => {
        const { service, runtime, agents, store } = await fixture()
        const request = creation({ title: '  比较候选方案  ', goal: '  记录稳定目标。  ' })
        const created = await service.createTask(scope, request)
        expect(created.id).toBe(request.requestId)
        expect(created.title).toBe('比较候选方案')
        expect(created.task).toEqual({ goal: '记录稳定目标。', status: 'not-started', started: false })
        expect(created.agent).toMatchObject({ name: '通用助手', modelId: config.model, systemPrompt: config.systemPrompt, toolIds: [] })
        expect(created.messages).toEqual([])
        const lookup = vi.spyOn(agents, 'get').mockRejectedValue(new Error('Agent settings have changed'))
        expect(await service.createTask(scope, { ...request, title: '比较候选方案', goal: '记录稳定目标。' })).toEqual(created)
        expect(lookup).not.toHaveBeenCalled()
        await expect(service.createTask(scope, { ...request, goal: '不同目标' })).rejects.toMatchObject({ status: 409 })
        const ordinary = await service.create(scope)
        await expect(service.createTask(scope, { ...request, requestId: ordinary.id })).rejects.toMatchObject({ status: 409 })
        expect(await service.listTasks(scope)).toEqual([created])
        expect(await service.list(scope)).toEqual([ordinary])
        expect(await store.get(scope, created.id)).toEqual(created)
        expect(runtime!.run).not.toHaveBeenCalled()
    })

    it('rejects malformed fields before persistence and resolves concurrent create retries without duplicates', async () => {
        const { service, store } = await fixture()
        for (const invalid of [
            creation({ title: ' ' }),
            creation({ goal: ' ' }),
            creation({ title: 'a'.repeat(121) }),
            creation({ goal: 'a'.repeat(32_001) }),
        ])
            await expect(service.createTask(scope, invalid)).rejects.toMatchObject({ status: 400 })
        expect(await service.listTasks(scope)).toEqual([])
        const request = creation()
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const get = store.get.bind(store)
        vi.spyOn(store, 'get').mockImplementationOnce(async (identity, id) => {
            const snapshot = await get(identity, id)
            entered.resolve()
            await release.promise
            return snapshot
        })
        const pending = service.createTask(scope, request)
        await entered.promise
        await expect(service.createTask(scope, request)).rejects.toMatchObject({ status: 409 })
        release.resolve()
        const created = await pending
        expect(await service.createTask(scope, request)).toEqual(created)
        expect(await service.listTasks(scope)).toEqual([created])
    })

    it('freezes actual custom and default settings, ordered openings, tools and fallback prompts across service recreation', async () => {
        const { service, store, runtime, agents } = await fixture()
        const original = await agents.create(scope, {
            name: '研究助手',
            description: '使用已授权工具研究。',
            modelId: config.model,
            systemPrompt: '',
            toolIds: ['calculator', 'current-time'],
            openingMessages: ['第一条开场。', '第二条开场。'],
        })
        const custom = await service.createTask(scope, creation({ agentId: original.id }))
        const common = await service.createTask(scope, creation())
        expect(custom.agent.systemPrompt).toBe(config.systemPrompt)
        expect(custom.task.sourceAgentId).toBe(original.id)
        expect(custom.messages.map(message => [message.content, message.kind])).toEqual([
            ['第一条开场。', 'opening'],
            ['第二条开场。', 'opening'],
        ])
        await agents.update(scope, original.id, {
            name: '研究助手',
            description: '',
            modelId: config.model,
            systemPrompt: '新提示词',
            toolIds: [],
            openingMessages: [],
        })
        expect(
            await service.createTask(scope, { requestId: custom.id, title: custom.title, goal: custom.task.goal, agentId: original.id })
        ).toEqual(custom)
        const changed = new ChatService(store, runtime, { ...config, model: 'changed-model', systemPrompt: '新的默认提示词。' }, agents)
        await start(changed, custom.id)
        await send(changed, custom.id)
        await start(changed, common.id)
        expect(runtime!.run.mock.calls[0]![0].agent).toEqual(custom.agent)
        expect(runtime!.run.mock.calls[0]![0].history.map(message => message.content)).toEqual(original.openingMessages)
        expect(runtime!.run.mock.calls[1]![0].history.map(message => message.content)).toEqual([
            ...original.openingMessages,
            custom.task.goal,
            '任务回答',
        ])
        expect(runtime!.run.mock.calls[2]![0].agent).toEqual(common.agent)
        expect((await changed.getTask(scope, custom.id)).messages.filter(message => message.kind === 'opening')).toHaveLength(2)
    })

    it('saves without a configured model, refuses execution unchanged, and starts after a configured restart', async () => {
        const { service, store, agents } = await fixture(null)
        const created = await service.createTask(scope, creation())
        await expect(start(service, created.id)).rejects.toMatchObject({ status: 503 })
        expect(await service.getTask(scope, created.id)).toEqual(created)
        const runtime = { run: vi.fn(success), dispose: vi.fn(async () => undefined) }
        const configured = new ChatService(store, runtime, config, agents)
        await start(configured, created.id)
        expect((await configured.getTask(scope, created.id)).task).toMatchObject({ started: true, status: 'in-progress' })
        expect(runtime.run).toHaveBeenCalledOnce()
    })

    it('does not create partial tasks for inaccessible Agents or failed storage and isolates every task operation', async () => {
        const { service, agents, store, runtime } = await fixture()
        const otherUser = { ...scope, userId: randomUUID() }
        const otherWorkspace = { ...scope, workspaceId: 'another-workspace' }
        const foreign = await agents.create(otherUser, {
            name: '私人助手',
            description: '',
            modelId: config.model,
            systemPrompt: '私人配置',
            toolIds: [],
            openingMessages: [],
        })
        for (const agentId of [foreign.id, randomUUID()])
            await expect(service.createTask(scope, creation({ agentId }))).rejects.toMatchObject({ status: 404 })
        const failing = vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('storage failure'))
        await expect(service.createTask(scope, creation())).rejects.toThrow('storage failure')
        failing.mockRestore()
        expect(await service.listTasks(scope)).toEqual([])
        const created = await service.createTask(scope, creation())
        for (const identity of [otherUser, otherWorkspace]) {
            expect(await service.listTasks(identity)).toEqual([])
            await expect(service.getTask(identity, created.id)).rejects.toMatchObject({ status: 404 })
            await expect(service.updateTaskStatus(identity, created.id, { status: 'completed' })).rejects.toMatchObject({ status: 404 })
            await expect(
                service.startTask(identity, created.id, randomUUID(), new AbortController().signal, () => undefined)
            ).rejects.toMatchObject({ status: 404 })
            await expect(
                service.sendTask(
                    identity,
                    created.id,
                    { content: 'private', requestId: randomUUID() },
                    new AbortController().signal,
                    () => undefined
                )
            ).rejects.toMatchObject({ status: 404 })
            await expect(service.cancelTask(identity, created.id, randomUUID())).rejects.toMatchObject({ status: 404 })
        }
        expect(await service.getTask(scope, created.id)).toEqual(created)
        expect(runtime!.run).not.toHaveBeenCalled()
    })
})

describe('personal task execution and explicit work state', () => {
    it('records the goal exactly once, replays successful turns, rejects new starts and preserves user title', async () => {
        const { service, runtime } = await fixture()
        const task = await service.createTask(scope, creation())
        await expect(send(service, task.id)).rejects.toMatchObject({ status: 409 })
        const firstId = randomUUID()
        const first = await start(service, task.id, firstId)
        expect(first.map(event => event.type)).toEqual(['start', 'done'])
        expect(await start(service, task.id, firstId)).toEqual([first.at(-1)])
        await expect(start(service, task.id)).rejects.toMatchObject({ status: 409 })
        await expect(send(service, task.id, firstId, '以相同请求替换目标')).rejects.toMatchObject({ status: 409 })
        const nextId = randomUUID()
        const next = await send(service, task.id, nextId)
        expect(await send(service, task.id, nextId)).toEqual([next.at(-1)])
        expect(runtime!.run).toHaveBeenCalledTimes(2)
        expect(runtime!.run.mock.calls[1]![0].history.map(message => message.content)).toEqual([task.task.goal, '任务回答'])
        const saved = await service.getTask(scope, task.id)
        expect(saved.title).toBe(task.title)
        expect(saved.task.goal).toBe(task.task.goal)
        expect(saved.messages.filter(message => message.role === 'user' && message.content === task.task.goal)).toHaveLength(1)
        expect(await service.list(scope)).toEqual([])
        await expect(service.get(scope, task.id)).rejects.toMatchObject({ status: 404 })
        await expect(
            service.send(scope, task.id, { content: '绕过任务', requestId: randomUUID() }, new AbortController().signal, () => undefined)
        ).rejects.toMatchObject({ status: 404 })
        await expect(service.cancel(scope, task.id, randomUUID())).rejects.toMatchObject({ status: 404 })
    })

    it('keeps all explicitly selected unfinished states after subsequent model answers', async () => {
        const { service } = await fixture()
        const task = await service.createTask(scope, creation())
        await service.updateTaskStatus(scope, task.id, { status: 'needs-input' })
        await start(service, task.id)
        expect((await service.getTask(scope, task.id)).task.status).toBe('in-progress')
        for (const status of ['in-progress', 'needs-input', 'not-started'] as const) {
            await service.updateTaskStatus(scope, task.id, { status })
            await send(service, task.id)
            expect((await service.getTask(scope, task.id)).task).toMatchObject({ status, started: true })
        }
    })

    it('preserves completed history, blocks both execution surfaces and restores the original state and context', async () => {
        const { service, runtime } = await fixture()
        const task = await service.createTask(scope, creation())
        await start(service, task.id)
        await service.updateTaskStatus(scope, task.id, { status: 'needs-input' })
        const completed = await service.updateTaskStatus(scope, task.id, { status: 'completed' })
        expect(completed.task).toMatchObject({ status: 'completed', previousStatus: 'needs-input' })
        expect(await service.updateTaskStatus(scope, task.id, { status: 'completed' })).toEqual(completed)
        await expect(start(service, task.id)).rejects.toMatchObject({ status: 409 })
        await expect(send(service, task.id)).rejects.toMatchObject({ status: 409 })
        await expect(
            service.send(scope, task.id, { content: '绕过完成', requestId: randomUUID() }, new AbortController().signal, () => undefined)
        ).rejects.toMatchObject({ status: 404 })
        await expect(service.updateTaskStatus(scope, task.id, { status: 'in-progress' })).rejects.toMatchObject({ status: 409 })
        expect(runtime!.run).toHaveBeenCalledOnce()
        const restored = await service.updateTaskStatus(scope, task.id, { restore: true })
        expect(restored.task.status).toBe('needs-input')
        expect(restored.task.previousStatus).toBeUndefined()
        expect(restored.messages).toEqual(completed.messages)
        await send(service, task.id)
        expect(runtime!.run.mock.calls[1]![0].history).toEqual(completed.messages)
        expect((await service.getTask(scope, task.id)).task.status).toBe('needs-input')
    })

    it('rejects status changes and concurrent starts while generating and retains partial cancelled answers for retry', async () => {
        const entered = Promise.withResolvers<void>()
        let runs = 0
        const { service, runtime } = await fixture(async input => {
            if (++runs > 1) return success()
            input.onDelta({ type: 'delta', text: '已生成部分' })
            entered.resolve()
            await untilAborted(input.signal)
            return { content: '已生成部分', reasoning: '', status: 'cancelled' }
        })
        const task = await service.createTask(scope, creation())
        const requestId = randomUUID()
        const running = start(service, task.id, requestId)
        await entered.promise
        expect((await service.getTask(scope, task.id)).activeRequestId).toBe(requestId)
        await expect(service.updateTaskStatus(scope, task.id, { status: 'completed' })).rejects.toMatchObject({ status: 409 })
        await expect(start(service, task.id, requestId)).rejects.toMatchObject({ status: 409 })
        await expect(service.cancelTask(scope, task.id, randomUUID())).rejects.toMatchObject({ status: 409 })
        const cancelled = await service.cancelTask(scope, task.id, requestId)
        expect(cancelled.messages.at(-1)).toMatchObject({ status: 'cancelled', content: '已生成部分' })
        expect(cancelled.task.status).toBe('in-progress')
        expect((await running).at(-1)!.type).toBe('cancelled')
        await service.updateTaskStatus(scope, task.id, { status: 'needs-input' })
        await start(service, task.id, requestId)
        const retried = await service.getTask(scope, task.id)
        expect(retried.task.status).toBe('needs-input')
        expect(retried.messages).toHaveLength(2)
        expect(runtime!.run).toHaveBeenCalledTimes(2)
    })

    it('retries only the latest failed message without duplicate user input and rejects old failures after a later turn', async () => {
        let runs = 0
        const { service, runtime } = await fixture(async input => {
            if (++runs === 2 || runs === 4) {
                input.onDelta({ type: 'delta', text: '失败前的部分' })
                throw new Error('provider secret must stay private')
            }
            return success()
        })
        const task = await service.createTask(scope, creation())
        await start(service, task.id)
        await service.updateTaskStatus(scope, task.id, { status: 'needs-input' })
        const latest = randomUUID()
        const failure = await send(service, task.id, latest, '失败的补充')
        expect(failure.at(-1)!.type).toBe('error')
        expect(JSON.stringify(failure)).not.toContain('provider secret')
        expect((await service.getTask(scope, task.id)).messages.at(-1)).toMatchObject({ status: 'error', content: '失败前的部分' })
        await send(service, task.id, latest, '失败的补充')
        expect((await service.getTask(scope, task.id)).messages.filter(message => message.requestId === latest)).toHaveLength(2)
        const older = randomUUID()
        await send(service, task.id, older, '旧失败消息')
        await send(service, task.id)
        const snapshot = await service.getTask(scope, task.id)
        await expect(send(service, task.id, older, '旧失败消息')).rejects.toMatchObject({ status: 409 })
        expect(await service.getTask(scope, task.id)).toEqual(snapshot)
        expect(snapshot.task.status).toBe('needs-input')
        expect(runtime!.run).toHaveBeenCalledTimes(5)
    })

    it('reloads a settled task when generation finishes between cancellation ownership read and activity lookup', async () => {
        const generating = Promise.withResolvers<void>()
        const result = Promise.withResolvers<{ content: string; reasoning: string; status: 'complete' }>()
        const { service, runtime } = await fixture(async () => {
            generating.resolve()
            return result.promise
        })
        const task = await service.createTask(scope, creation())
        const requestId = randomUUID()
        const running = start(service, task.id, requestId)
        await generating.promise
        const read = Promise.withResolvers<void>()
        const releaseRead = Promise.withResolvers<void>()
        const getTask = service.getTask.bind(service)
        vi.spyOn(service, 'getTask').mockImplementationOnce(async (identity, id) => {
            const snapshot = await getTask(identity, id)
            expect(snapshot.activeRequestId).toBe(requestId)
            expect(snapshot.messages).toHaveLength(1)
            read.resolve()
            await releaseRead.promise
            return snapshot
        })
        const cancellation = service.cancelTask(scope, task.id, requestId)
        await read.promise
        result.resolve({ content: '生成已经完成。', reasoning: '', status: 'complete' })
        await running
        const settled = await getTask(scope, task.id)
        releaseRead.resolve()
        const returned = await cancellation
        expect(returned).toEqual(settled)
        expect(returned.activeRequestId).toBeUndefined()
        expect(returned.messages.at(-1)).toMatchObject({ role: 'assistant', content: '生成已经完成。', status: 'complete' })
        expect(runtime!.run).toHaveBeenCalledOnce()
    })

    it('reserves status writes before delayed reads and leaves the original task unchanged after save failures', async () => {
        const { service, store, runtime } = await fixture()
        const task = await service.createTask(scope, creation())
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const get = store.get.bind(store)
        vi.spyOn(store, 'get').mockImplementationOnce(async (identity, id) => {
            const snapshot = await get(identity, id)
            entered.resolve()
            await release.promise
            return snapshot
        })
        const changing = service.updateTaskStatus(scope, task.id, { status: 'needs-input' })
        await entered.promise
        await expect(start(service, task.id)).rejects.toMatchObject({ status: 409 })
        await expect(service.updateTaskStatus(scope, task.id, { status: 'completed' })).rejects.toMatchObject({ status: 409 })
        release.resolve()
        const changed = await changing
        const save = vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('status save failed'))
        await expect(service.updateTaskStatus(scope, task.id, { status: 'completed' })).rejects.toThrow('status save failed')
        expect(await service.getTask(scope, task.id)).toEqual(changed)
        save.mockRejectedValueOnce(new Error('initial save failed'))
        await expect(start(service, task.id)).rejects.toThrow('initial save failed')
        expect(await service.getTask(scope, task.id)).toEqual(changed)
        expect(runtime!.run).not.toHaveBeenCalled()
    })

    it('reserves starts before delayed reads so state changes cannot overwrite accepted goal history', async () => {
        const { service, store } = await fixture()
        const task = await service.createTask(scope, creation())
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const get = store.get.bind(store)
        vi.spyOn(store, 'get').mockImplementationOnce(async (identity, id) => {
            const snapshot = await get(identity, id)
            entered.resolve()
            await release.promise
            return snapshot
        })
        const running = start(service, task.id)
        await entered.promise
        await expect(service.updateTaskStatus(scope, task.id, { status: 'completed' })).rejects.toMatchObject({ status: 409 })
        release.resolve()
        await running
        expect((await service.getTask(scope, task.id)).task).toMatchObject({ started: true, status: 'in-progress' })
        expect((await service.getTask(scope, task.id)).messages).toHaveLength(2)
    })
})
