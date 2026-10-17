import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createChatRuntime, type ChatRuntime } from '@ai-harness/chat-runtime'
import { agentDefinitionSchema, personalProjectSchema, personalTaskSchema, projectDetailSchema } from '@ai-harness/contracts'
import { createChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readApiConfig } from '../src/config.js'

const token = 'project-http-test-token-of-sufficient-length'
const config = readApiConfig({ HARNESS_API_TOKEN: token, CHAT_STORE: 'memory' })
const userId = randomUUID()
const applications: NestExpressApplication[] = []

/**
 * Start actual Nest routes using real scoped temporary persistence.
 * @param runtime - Optional controlled Cordis execution dependency.
 * @returns The loopback chat API prefix.
 * @throws Error if application initialization or port binding fails.
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
 * Construct trusted Web-to-API claims for a browser identity.
 * @param identity - Authenticated user identifier.
 * @returns Headers accepted by the shared API guard.
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
 * Send one public JSON mutation to the actual application.
 * @param base - Application API prefix.
 * @param path - Relative project, task or Agent route.
 * @param body - Public JSON input.
 * @param method - Mutation HTTP method.
 * @param identity - Browser identity passed through trusted claims.
 * @returns The unconsumed HTTP response.
 */
function mutate(base: string, path: string, body: unknown, method = 'POST', identity = userId): Promise<Response> {
    return fetch(`${base}/${path}`, { method, headers: headers(identity), body: JSON.stringify(body) })
}

/**
 * Create and validate a public project snapshot.
 * @param base - Application API prefix.
 * @param fields - Replacement creation fields.
 * @returns The complete public project record.
 */
async function createProject(base: string, fields: Record<string, unknown> = {}) {
    const response = await mutate(base, 'projects', {
        requestId: randomUUID(),
        name: '项目A',
        description: 'PROJECT_DESCRIPTION_SENTINEL',
        ...fields,
    })
    expect(response.status).toBe(201)
    return personalProjectSchema.parse(await response.json())
}

/**
 * Create and validate a public task snapshot.
 * @param base - Application API prefix.
 * @param fields - Replacement creation fields.
 * @returns The complete public task record.
 */
async function createTask(base: string, fields: Record<string, unknown> = {}) {
    const response = await mutate(base, 'tasks', { requestId: randomUUID(), title: '任务A', goal: 'TASK_A_GOAL', ...fields })
    expect(response.status).toBe(201)
    return personalTaskSchema.parse(await response.json())
}

/**
 * Produce a native DeepSeek provider SSE completion for the real Cordis adapter.
 * @returns A successful streaming provider response.
 */
function providerResponse(): Response {
    const content = JSON.stringify({ choices: [{ index: 0, delta: { content: 'TASK_A_ANSWER' }, finish_reason: null }] })
    const stop = JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    return new Response(`data: ${content}\n\ndata: ${stop}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

afterEach(async () => {
    await Promise.all(applications.splice(0).map(app => app.close()))
})

describe('personal project HTTP boundary and Cordis context isolation', () => {
    it('validates project routes, safely replays after edits and creates project tasks without credentials', async () => {
        const base = await start()
        expect((await fetch(`${base}/projects`)).status).toBe(401)
        expect(await (await fetch(`${base}/projects`, { headers: headers() })).json()).toEqual({ projects: [] })
        for (const invalid of [{ name: ' ' }, { name: 'a'.repeat(121) }, { description: 'a'.repeat(2001) }, { userId }])
            expect((await mutate(base, 'projects', { requestId: randomUUID(), name: 'valid', description: '', ...invalid })).status).toBe(
                400
            )
        const input = { requestId: randomUUID(), name: '  项目A  ', description: '  初始说明  ' }
        const created = personalProjectSchema.parse(await (await mutate(base, 'projects', input)).json())
        const edited = personalProjectSchema.parse(
            await (await mutate(base, `projects/${created.id}`, { name: '修改名称', description: '修改说明' }, 'PUT')).json()
        )
        expect(personalProjectSchema.parse(await (await mutate(base, 'projects', input)).json())).toEqual(edited)
        expect((await mutate(base, 'projects', { ...input, name: 'different' })).status).toBe(409)
        expect((await fetch(`${base}/projects/not-uuid`, { headers: headers() })).status).toBe(400)
        expect((await mutate(base, `projects/${created.id}`, { name: ' ', description: '' }, 'PUT')).status).toBe(400)
        const task = await createTask(base, { projectId: created.id })
        expect(task.task).toMatchObject({ projectId: created.id, creationProjectId: created.id, started: false })
        expect((await mutate(base, `tasks/${task.id}/start`, { requestId: randomUUID() })).status).toBe(503)
        const detail = projectDetailSchema.parse(await (await fetch(`${base}/projects/${created.id}`, { headers: headers() })).json())
        expect(detail).toEqual({ project: edited, tasks: [task] })
        expect(JSON.stringify(detail)).not.toContain('"creation":')
        expect((await mutate(base, `tasks/${task.id}/project`, { projectId: 'bad' }, 'PUT')).status).toBe(400)
        expect((await mutate(base, `tasks/${task.id}/project`, { projectId: null, userId }, 'PUT')).status).toBe(400)
    })

    it('checks association sides and returns the same private-safe response for absent and foreign projects', async () => {
        const runtime = {
            run: vi.fn<ChatRuntime['run']>(async () => ({ content: 'answer', reasoning: '', status: 'complete' })),
            dispose: vi.fn(async () => undefined),
        }
        const base = await start(runtime)
        const privateProject = await createProject(base, { name: 'PRIVATE_PROJECT_SENTINEL' })
        const privateTask = await createTask(base, { projectId: privateProject.id, title: 'PRIVATE_TASK_SENTINEL' })
        const foreignUser = randomUUID()
        const foreignProject = personalProjectSchema.parse(
            await (
                await mutate(base, 'projects', { requestId: randomUUID(), name: 'foreign', description: '' }, 'POST', foreignUser)
            ).json()
        )
        const foreignTask = personalTaskSchema.parse(
            await (await mutate(base, 'tasks', { requestId: randomUUID(), title: 'foreign', goal: 'foreign' }, 'POST', foreignUser)).json()
        )
        expect(await (await fetch(`${base}/projects`, { headers: headers(foreignUser) })).json()).toEqual({ projects: [foreignProject] })
        for (const id of [privateProject.id, randomUUID()]) {
            const responses = [
                await fetch(`${base}/projects/${id}`, { headers: headers(foreignUser) }),
                await mutate(base, `projects/${id}`, { name: 'overwrite', description: '' }, 'PUT', foreignUser),
                await mutate(base, `tasks/${foreignTask.id}/project`, { projectId: id }, 'PUT', foreignUser),
                await mutate(
                    base,
                    'tasks',
                    { requestId: randomUUID(), title: 'orphan', goal: 'forbidden', projectId: id },
                    'POST',
                    foreignUser
                ),
            ]
            for (const response of responses) {
                expect(response.status).toBe(404)
                expect(await response.json()).toMatchObject({ message: '未找到这个项目。' })
            }
        }
        const crossTask = await mutate(base, `tasks/${privateTask.id}/project`, { projectId: foreignProject.id }, 'PUT', foreignUser)
        expect(crossTask.status).toBe(404)
        expect(await crossTask.json()).toMatchObject({ message: '未找到这个任务。' })
        const wrongWorkspace = await fetch(`${base}/projects/${privateProject.id}`, {
            headers: { ...headers(), 'x-harness-workspace-id': 'other' },
        })
        expect(wrongWorkspace.status).toBe(401)
        expect(await (await fetch(`${base}/tasks`, { headers: headers(foreignUser) })).json()).toEqual({ tasks: [foreignTask] })
        expect(personalTaskSchema.parse(await (await fetch(`${base}/tasks/${privateTask.id}`, { headers: headers() })).json())).toEqual(
            privateTask
        )
        expect(runtime.run).not.toHaveBeenCalled()
    })

    it('continues actual Cordis history after movement without injecting project details or another task', async () => {
        const providerFetch = vi.fn<typeof fetch>(async () => providerResponse())
        const runtime = await createChatRuntime({
            apiKey: 'private-project-provider-fixture-key',
            model: config.model,
            systemPrompt: 'fallback',
            fetch: providerFetch,
        })
        const base = await start(runtime)
        const first = await createProject(base)
        const second = await createProject(base, { name: '项目B', description: 'PROJECT_B_DESCRIPTION_SENTINEL' })
        const agent = agentDefinitionSchema.parse(
            await (
                await mutate(base, 'agents', {
                    name: '研究助手',
                    description: '',
                    modelId: config.model,
                    systemPrompt: 'FROZEN_SYSTEM_PROMPT',
                    toolIds: ['calculator'],
                    openingMessages: ['OPENING_SENTINEL'],
                })
            ).json()
        )
        const task = await createTask(base, { projectId: first.id, agentId: agent.id })
        const other = await createTask(base, { projectId: first.id, title: '任务B', goal: 'OTHER_TASK_GOAL_SENTINEL' })
        expect(providerFetch).not.toHaveBeenCalled()
        const initialRequest = randomUUID()
        const initialResponse = await mutate(base, `tasks/${task.id}/start`, { requestId: initialRequest })
        expect(initialResponse.status).toBe(201)
        await initialResponse.text()
        const started = personalTaskSchema.parse(await (await fetch(`${base}/tasks/${task.id}`, { headers: headers() })).json())
        expect(started.activeRequestId).toBeUndefined()
        expect(started.messages.at(-1)?.content).toBe('TASK_A_ANSWER')
        const moved = personalTaskSchema.parse(
            await (await mutate(base, `tasks/${task.id}/project`, { projectId: second.id }, 'PUT')).json()
        )
        expect(moved.messages).toEqual(started.messages)
        expect(moved.agent).toEqual(task.agent)
        expect(providerFetch).toHaveBeenCalledOnce()
        await (await mutate(base, `tasks/${task.id}/messages`, { requestId: randomUUID(), content: 'CONTINUE_TASK_A' })).text()
        expect(providerFetch).toHaveBeenCalledTimes(2)
        const calls = providerFetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)))
        expect(calls[0].messages.map((message: { content?: string }) => message.content)).toEqual([
            'FROZEN_SYSTEM_PROMPT',
            'OPENING_SENTINEL',
            'TASK_A_GOAL',
        ])
        expect(calls[1].messages.map((message: { content?: string }) => message.content)).toEqual([
            'FROZEN_SYSTEM_PROMPT',
            'OPENING_SENTINEL',
            'TASK_A_GOAL',
            'TASK_A_ANSWER',
            'CONTINUE_TASK_A',
        ])
        expect(JSON.stringify(calls)).not.toContain('PROJECT_DESCRIPTION_SENTINEL')
        expect(JSON.stringify(calls)).not.toContain('PROJECT_B_DESCRIPTION_SENTINEL')
        expect(JSON.stringify(calls)).not.toContain('OTHER_TASK_GOAL_SENTINEL')
        expect(calls[1].tools).toHaveLength(1)
        const firstDetail = projectDetailSchema.parse(await (await fetch(`${base}/projects/${first.id}`, { headers: headers() })).json())
        expect(firstDetail.tasks.map(value => value.id)).toEqual([other.id])
        await mutate(base, `tasks/${task.id}/status`, { status: 'completed' }, 'PUT')
        await mutate(base, `tasks/${task.id}/project`, { projectId: first.id }, 'PUT')
        expect((await mutate(base, `tasks/${task.id}/messages`, { requestId: randomUUID(), content: 'requires restore' })).status).toBe(409)
        expect(providerFetch).toHaveBeenCalledTimes(2)
        await mutate(base, `tasks/${task.id}/status`, { restore: true }, 'PUT')
        await (await mutate(base, `tasks/${task.id}/messages`, { requestId: randomUUID(), content: 'RESTORED_CONTINUATION' })).text()
        expect(providerFetch).toHaveBeenCalledTimes(3)
    })

    it('refuses membership changes through HTTP while a task reply is generating', async () => {
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const runtime = {
            run: vi.fn<ChatRuntime['run']>(async input => {
                input.onDelta({ type: 'delta', text: 'partial' })
                entered.resolve()
                await release.promise
                return { content: 'finished', reasoning: '', status: 'complete' }
            }),
            dispose: vi.fn(async () => undefined),
        }
        const base = await start(runtime)
        const first = await createProject(base)
        const second = await createProject(base)
        const task = await createTask(base, { projectId: first.id })
        const running = mutate(base, `tasks/${task.id}/start`, { requestId: randomUUID() })
        await entered.promise
        const refusal = await mutate(base, `tasks/${task.id}/project`, { projectId: second.id }, 'PUT')
        expect(refusal.status).toBe(409)
        release.resolve()
        await (await running).text()
        const saved = personalTaskSchema.parse(await (await fetch(`${base}/tasks/${task.id}`, { headers: headers() })).json())
        expect(saved.task.projectId).toBe(first.id)
        expect(saved.messages.at(-1)?.content).toBe('finished')
    })
})
