import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createChatRuntime, type ChatRuntime } from '@ai-harness/chat-runtime'
import { agentDefinitionSchema, chatStreamEventSchema, personalTaskSchema, type ChatStreamEvent } from '@ai-harness/contracts'
import { createChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readApiConfig } from '../src/config.js'

const token = 'task-http-test-api-token-with-at-least-32-characters'
const providerKey = 'private-task-provider-key'
const config = readApiConfig({ HARNESS_API_TOKEN: token, CHAT_STORE: 'memory' })
const userId = randomUUID()
const applications: NestExpressApplication[] = []

/**
 * Start the actual Nest application with process-owned scoped memory persistence.
 * @param runtime - Optional observable Cordis or fake runtime, absent for configuration tests.
 * @returns The application's loopback API endpoint prefix.
 * @throws Error when initialization or local port binding fails.
 */
async function start(runtime?: ChatRuntime): Promise<string> {
    const store = await createChatStore({ allowMemory: true })
    const app = await createApiApp(config, { store, runtime, logger: false })
    applications.push(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    return `http://127.0.0.1:${address.port}/api/chat`
}

/**
 * Construct the trusted server-to-server authentication and ownership claims.
 * @param identity - Authenticated browser-session identity.
 * @returns Request headers accepted by the API guard.
 */
function headers(identity = userId): Record<string, string> {
    return {
        authorization: `Bearer ${token}`,
        'x-harness-user-id': identity,
        'x-harness-workspace-id': config.workspaceId,
        'content-type': 'application/json',
    }
}

/**
 * Send one scoped JSON operation through the actual HTTP boundary.
 * @param base - Application API endpoint prefix.
 * @param path - Task, Agent or ordinary-conversation route.
 * @param body - Untrusted public JSON input.
 * @param method - Requested mutation method.
 * @param identity - Authenticated browser-session identity.
 * @returns The unconsumed HTTP response.
 */
function mutate(base: string, path: string, body: unknown, method = 'POST', identity = userId): Promise<Response> {
    return fetch(`${base}/${path}`, { method, headers: headers(identity), body: JSON.stringify(body) })
}

/**
 * Create a complete personal task through its public HTTP route.
 * @param base - Application API endpoint prefix.
 * @param fields - Optional task creation fields replaced for a test.
 * @returns The validated persisted task.
 */
async function create(base: string, fields: Record<string, unknown> = {}) {
    const response = await mutate(base, 'tasks', {
        requestId: randomUUID(),
        title: '任务标题',
        goal: '记录海风项目并比较候选方案。',
        ...fields,
    })
    expect(response.status).toBe(201)
    return personalTaskSchema.parse(await response.json())
}

/**
 * Parse and validate every public application event in an HTTP SSE payload.
 * @param payload - Complete SSE response body.
 * @returns The ordered application events emitted by the task coordinator.
 */
function events(payload: string): ChatStreamEvent[] {
    return payload.split(/\r?\n\r?\n/).flatMap(frame => {
        const data = frame
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
        return data ? [chatStreamEventSchema.parse(JSON.parse(data))] : []
    })
}

/**
 * Build a successful DeepSeek Chat Completions provider response.
 * @param content - Assistant text delivered as a provider delta.
 * @returns A terminated provider SSE response accepted by the real Cordis runtime.
 */
function providerResponse(content: string): Response {
    const delta = JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })
    const terminal = JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    return new Response(`data: ${delta}\n\ndata: ${terminal}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

afterEach(async () => {
    await Promise.all(applications.splice(0).map(application => application.close()))
})

describe('personal task HTTP lifecycle and isolation', () => {
    it('validates creation, saves without model configuration and replays creation without changing snapshots', async () => {
        const base = await start()
        for (const invalid of [
            { title: ' ', goal: 'goal' },
            { title: 'title', goal: ' ' },
            { title: 'a'.repeat(121), goal: 'goal' },
            { title: 'title', goal: 'a'.repeat(32_001) },
            { title: 'title', goal: 'goal', userId },
        ])
            expect((await mutate(base, 'tasks', { requestId: randomUUID(), ...invalid })).status).toBe(400)
        const task = await create(base)
        expect(task.task.status).toBe('not-started')
        expect(task.task.started).toBe(false)
        const replay = await mutate(base, 'tasks', { requestId: task.id, title: task.title, goal: task.task.goal })
        expect(personalTaskSchema.parse(await replay.json())).toEqual(task)
        expect((await mutate(base, 'tasks', { requestId: task.id, title: task.title, goal: '不同目标' })).status).toBe(409)
        expect((await mutate(base, `tasks/${task.id}/start`, { requestId: randomUUID() })).status).toBe(503)
        expect(await (await fetch(`${base}/tasks/${task.id}`, { headers: headers() })).json()).toEqual(task)
        expect(await (await fetch(`${base}/tasks`, { headers: headers() })).json()).toEqual({ tasks: [task] })
        expect(await (await fetch(`${base}/conversations`, { headers: headers() })).json()).toEqual({ conversations: [] })
        expect((await fetch(`${base}/tasks/not-a-uuid`, { headers: headers() })).status).toBe(400)
        expect((await mutate(base, `tasks/${task.id}/start`, { requestId: 'invalid' })).status).toBe(400)
        expect((await mutate(base, `tasks/${task.id}/status`, { status: 'unsupported' }, 'PUT')).status).toBe(400)
    })

    it('runs two rounds through actual Cordis using the frozen Agent, goal, tools and ordered opening history', async () => {
        const providerFetch = vi.fn<typeof fetch>(async () => providerResponse('记住了海风项目。'))
        const runtime = await createChatRuntime({
            apiKey: providerKey,
            model: config.model,
            systemPrompt: '部署默认提示词。',
            fetch: providerFetch,
        })
        const base = await start(runtime)
        const agentInput = {
            name: '研究助手',
            description: '',
            modelId: config.model,
            systemPrompt: '保留这个原始系统提示词。',
            toolIds: ['calculator'],
            openingMessages: ['第一条开场。', '第二条开场。'],
        }
        const agent = agentDefinitionSchema.parse(await (await mutate(base, 'agents', agentInput)).json())
        const task = await create(base, { agentId: agent.id })
        await mutate(
            base,
            `agents/${agent.id}`,
            { ...agentInput, systemPrompt: '后来修改的提示词。', toolIds: [], openingMessages: [] },
            'PUT'
        )
        const firstId = randomUUID()
        const firstResponse = await mutate(base, `tasks/${task.id}/start`, { requestId: firstId })
        expect(firstResponse.headers.get('content-type')).toContain('text/event-stream')
        const first = events(await firstResponse.text())
        expect(first.map(event => event.type)).toEqual(['start', 'delta', 'done'])
        const replay = events(await (await mutate(base, `tasks/${task.id}/start`, { requestId: firstId })).text())
        expect(replay).toEqual([first.at(-1)])
        expect((await mutate(base, `tasks/${task.id}/messages`, { requestId: firstId, content: '更改原始目标' })).status).toBe(409)
        const second = events(
            await (await mutate(base, `tasks/${task.id}/messages`, { requestId: randomUUID(), content: '这个项目的代号是什么？' })).text()
        )
        expect(second.at(-1)).toMatchObject({
            type: 'done',
            conversation: { title: task.title, task: { goal: task.task.goal, status: 'in-progress' } },
        })
        expect(providerFetch).toHaveBeenCalledTimes(2)
        const firstBody = JSON.parse(String(providerFetch.mock.calls[0]![1]!.body))
        const secondBody = JSON.parse(String(providerFetch.mock.calls[1]![1]!.body))
        expect(firstBody.model).toBe(agent.modelId)
        expect(firstBody.messages).toEqual([
            { role: 'system', content: agent.systemPrompt },
            { role: 'assistant', content: '第一条开场。' },
            { role: 'assistant', content: '第二条开场。' },
            { role: 'user', content: task.task.goal },
        ])
        expect(firstBody.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['calculator'])
        expect(secondBody.messages.filter((message: { content: string }) => message.content === task.task.goal)).toHaveLength(1)
        expect(secondBody.messages.at(-2)).toEqual({ role: 'assistant', content: '记住了海风项目。' })
        const loaded = personalTaskSchema.parse(await (await fetch(`${base}/tasks/${task.id}`, { headers: headers() })).json())
        expect(loaded.agent).toEqual(task.agent)
        expect(loaded.messages).toHaveLength(6)
        expect(JSON.stringify({ loaded, first, second })).not.toContain(providerKey)
        expect(JSON.stringify({ loaded, first, second })).not.toContain(token)
    })

    it('requires authentication and refuses every foreign task and Agent operation without leaking content', async () => {
        const runtime = {
            run: vi.fn(async () => ({ content: 'answer', reasoning: '', status: 'complete' as const })),
            dispose: vi.fn(async () => undefined),
        }
        const base = await start(runtime)
        expect((await fetch(`${base}/tasks`)).status).toBe(401)
        const task = await create(base, { title: 'PRIVATE_TASK_SENTINEL', goal: 'PRIVATE_GOAL_SENTINEL' })
        const foreign = randomUUID()
        const list = await fetch(`${base}/tasks`, { headers: headers(foreign) })
        expect(await list.json()).toEqual({ tasks: [] })
        const responses = [
            await fetch(`${base}/tasks/${task.id}`, { headers: headers(foreign) }),
            await mutate(base, `tasks/${task.id}/status`, { status: 'completed' }, 'PUT', foreign),
            await mutate(base, `tasks/${task.id}/start`, { requestId: randomUUID() }, 'POST', foreign),
            await mutate(base, `tasks/${task.id}/messages`, { requestId: randomUUID(), content: 'foreign' }, 'POST', foreign),
            await mutate(base, `tasks/${task.id}/cancel`, { requestId: randomUUID() }, 'POST', foreign),
        ]
        for (const response of responses) {
            expect(response.status).toBe(404)
            const body = await response.text()
            expect(body).not.toContain('PRIVATE_')
            expect(body).not.toContain(task.agent.systemPrompt)
        }
        const wrongWorkspace = await fetch(`${base}/tasks/${task.id}`, {
            headers: { ...headers(), 'x-harness-workspace-id': 'different-workspace' },
        })
        expect(wrongWorkspace.status).toBe(401)
        const privateAgent = agentDefinitionSchema.parse(
            await (
                await mutate(base, 'agents', {
                    name: '私有助手',
                    description: '',
                    modelId: config.model,
                    systemPrompt: 'PRIVATE_AGENT',
                    toolIds: [],
                    openingMessages: [],
                })
            ).json()
        )
        expect(
            (
                await mutate(
                    base,
                    'tasks',
                    { requestId: randomUUID(), title: 'foreign Agent', goal: 'goal', agentId: privateAgent.id },
                    'POST',
                    foreign
                )
            ).status
        ).toBe(404)
        expect(await (await fetch(`${base}/tasks`, { headers: headers(foreign) })).json()).toEqual({ tasks: [] })
        expect(runtime.run).not.toHaveBeenCalled()
    })

    it('enforces completed-task read-only rules and ordinary-chat isolation then restores the same context', async () => {
        const runtime = {
            run: vi.fn(async () => ({ content: 'answer', reasoning: '', status: 'complete' as const })),
            dispose: vi.fn(async () => undefined),
        }
        const base = await start(runtime)
        const task = await create(base)
        expect((await mutate(base, `tasks/${task.id}/messages`, { requestId: randomUUID(), content: 'not started' })).status).toBe(409)
        await (await mutate(base, `tasks/${task.id}/start`, { requestId: randomUUID() })).text()
        await mutate(base, `tasks/${task.id}/status`, { status: 'needs-input' }, 'PUT')
        const complete = personalTaskSchema.parse(
            await (await mutate(base, `tasks/${task.id}/status`, { status: 'completed' }, 'PUT')).json()
        )
        expect(complete.task.previousStatus).toBe('needs-input')
        expect((await mutate(base, `tasks/${task.id}/start`, { requestId: randomUUID() })).status).toBe(409)
        expect((await mutate(base, `tasks/${task.id}/messages`, { requestId: randomUUID(), content: 'completed' })).status).toBe(409)
        expect((await fetch(`${base}/conversations/${task.id}`, { headers: headers() })).status).toBe(404)
        expect((await mutate(base, `conversations/${task.id}/messages`, { requestId: randomUUID(), content: 'bypass' })).status).toBe(404)
        expect((await mutate(base, `conversations/${task.id}/cancel`, { requestId: randomUUID() })).status).toBe(404)
        const restored = personalTaskSchema.parse(await (await mutate(base, `tasks/${task.id}/status`, { restore: true }, 'PUT')).json())
        expect(restored.id).toBe(task.id)
        expect(restored.task.status).toBe('needs-input')
        expect(restored.messages).toEqual(complete.messages)
        await (await mutate(base, `tasks/${task.id}/messages`, { requestId: randomUUID(), content: '恢复后继续' })).text()
        expect(runtime.run).toHaveBeenCalledTimes(2)
        expect(runtime.run.mock.calls[1]![0].history).toEqual(complete.messages)
        const ordinary = await (await mutate(base, 'conversations', {})).json()
        expect((await fetch(`${base}/tasks/${ordinary.id}`, { headers: headers() })).status).toBe(404)
        expect((await mutate(base, `tasks/${ordinary.id}/start`, { requestId: randomUUID() })).status).toBe(404)
    })

    it('rejects generation-state races, cancels the exact HTTP turn and retries its saved partial response', async () => {
        let runs = 0
        const runtime = {
            run: vi.fn<ChatRuntime['run']>(async input => {
                if (++runs > 1) return { content: 'retry complete', reasoning: '', status: 'complete' }
                input.onDelta({ type: 'delta', text: 'partial task output' })
                await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
                return { content: 'partial task output', reasoning: '', status: 'cancelled' }
            }),
            dispose: vi.fn(async () => undefined),
        }
        const base = await start(runtime)
        const task = await create(base)
        const requestId = randomUUID()
        const running = await mutate(base, `tasks/${task.id}/start`, { requestId })
        const reader = running.body!.getReader()
        const decoder = new TextDecoder()
        let payload = ''
        while (!payload.includes('partial task output')) {
            const chunk = await reader.read()
            expect(chunk.done).toBe(false)
            payload += decoder.decode(chunk.value, { stream: true })
        }
        expect((await mutate(base, `tasks/${task.id}/status`, { status: 'completed' }, 'PUT')).status).toBe(409)
        expect((await mutate(base, `tasks/${task.id}/start`, { requestId })).status).toBe(409)
        expect((await mutate(base, `tasks/${task.id}/cancel`, { requestId: randomUUID() })).status).toBe(409)
        const cancelled = personalTaskSchema.parse(await (await mutate(base, `tasks/${task.id}/cancel`, { requestId })).json())
        expect(cancelled.task.status).toBe('in-progress')
        expect(cancelled.messages.at(-1)).toMatchObject({ content: 'partial task output', status: 'cancelled', requestId })
        while (true) {
            const chunk = await reader.read()
            payload += decoder.decode(chunk.value, { stream: !chunk.done })
            if (chunk.done) break
        }
        reader.releaseLock()
        expect(events(payload).at(-1)!.type).toBe('cancelled')
        const retry = events(await (await mutate(base, `tasks/${task.id}/start`, { requestId })).text())
        expect(retry.at(-1)).toMatchObject({
            type: 'done',
            conversation: { messages: [{ content: task.task.goal }, { content: 'retry complete' }] },
        })
        expect(runtime.run).toHaveBeenCalledTimes(2)
    })
})
