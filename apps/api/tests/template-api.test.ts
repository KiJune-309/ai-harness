import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createChatRuntime, type ChatRuntime } from '@ai-harness/chat-runtime'
import {
    agentDefinitionSchema,
    personalProjectSchema,
    personalTaskSchema,
    projectDetailSchema,
    projectTemplateSchema,
    templateLaunchResultSchema,
} from '@ai-harness/contracts'
import { createMemoryChatStore, type ChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig as readApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

const token = 'template-http-test-token-of-sufficient-length'
const providerKey = 'template-provider-fixture-private-key'
const config = readApiConfig({ HARNESS_API_TOKEN: token, CHAT_STORE: 'memory' })
const userId = randomUUID()
const applications: NestExpressApplication[] = []
let currentStore: ChatStore

/**
 * Start actual guarded Nest routes with real scoped temporary persistence.
 * @param runtime - Optional Cordis runtime or observable execution fixture.
 * @returns The local application chat API prefix.
 * @throws Error if application initialization or port binding fails.
 */
async function start(runtime?: ChatRuntime): Promise<string> {
    const store = await createMemoryChatStore()
    currentStore = store
    const app = await createApiApp({ ...config, apiKey: runtime ? 'private-runtime-fixture-key' : '' }, { store, runtime, logger: false })
    applications.push(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    return `http://127.0.0.1:${address.port}/api/chat`
}

/**
 * Persist a real fixture account session and construct private HTTP headers.
 * @param identity - Browser identity established by the Web server.
 * @returns Headers accepted by the application guard.
 */
async function headers(identity = userId): Promise<Record<string, string>> {
    return sessionHeaders(currentStore, config, identity)
}

/**
 * Send a public JSON mutation through the actual HTTP boundary.
 * @param base - Application API prefix.
 * @param path - Relative template, project, Agent or task route.
 * @param body - Public JSON request fields.
 * @param method - Requested mutation method.
 * @param identity - Browser ownership identity.
 * @returns The unconsumed HTTP response.
 */
async function mutate(base: string, path: string, body: unknown, method = 'POST', identity = userId): Promise<Response> {
    return fetch(`${base}/${path}`, { method, headers: await headers(identity), body: JSON.stringify(body) })
}

/**
 * Build a stable ordered task blueprint creation input.
 * @param fields - Replacement public fields for one scenario.
 * @returns A valid independent creation action.
 */
function creation(fields: Record<string, unknown> = {}) {
    return {
        requestId: randomUUID(),
        name: '产品回顾',
        description: 'TEMPLATE_DESCRIPTION_SENTINEL',
        tasks: [
            { id: randomUUID(), title: '任务A', goal: 'TASK_A_GOAL' },
            { id: randomUUID(), title: '任务B', goal: 'OTHER_TASK_GOAL_SENTINEL' },
        ],
        ...fields,
    }
}

/**
 * Build stable project launch parameters for an initial template preview.
 * @param fields - Replacement public fields for one scenario.
 * @returns A valid independent launch action.
 */
function launch(fields: Record<string, unknown> = {}) {
    return { requestId: randomUUID(), version: 1, name: '第42周回顾', description: 'PROJECT_DESCRIPTION_SENTINEL', ...fields }
}

/**
 * Produce a native DeepSeek SSE response accepted by the actual Cordis adapter.
 * @returns A successful complete provider response.
 */
function providerResponse(): Response {
    const delta = JSON.stringify({ choices: [{ index: 0, delta: { content: 'TASK_A_ANSWER' }, finish_reason: null }] })
    const end = JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    return new Response(`data: ${delta}\n\ndata: ${end}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

afterEach(async () => {
    await Promise.all(applications.splice(0).map(app => app.close()))
})

describe('personal template HTTP lifecycle and actual Cordis isolation', () => {
    it('validates the public boundary, keeps edited creation replay and generates without model configuration', async () => {
        const base = await start()
        expect((await fetch(`${base}/templates`)).status).toBe(401)
        expect(await (await fetch(`${base}/templates`, { headers: await headers() })).json()).toEqual({ templates: [] })
        for (const invalid of [
            { name: ' ' },
            { tasks: [] },
            { tasks: [{ id: randomUUID(), title: 'valid', goal: ' ' }] },
            { userId },
            { tasks: Array.from({ length: 9 }, () => ({ id: randomUUID(), title: 'a', goal: 'b' })) },
        ])
            expect((await mutate(base, 'templates', creation(invalid))).status).toBe(400)
        const input = creation()
        const response = await mutate(base, 'templates', input)
        expect(response.status).toBe(201)
        const template = projectTemplateSchema.parse(await response.json())
        expect((await fetch(`${base}/templates/not-uuid`, { headers: await headers() })).status).toBe(400)
        expect((await mutate(base, `templates/${template.id}`, { ...input, version: 1 }, 'PUT')).status).toBe(400)
        const edit = { name: '修改名称', description: '修改说明', tasks: [...template.tasks].reverse(), version: 1 }
        const updated = projectTemplateSchema.parse(await (await mutate(base, `templates/${template.id}`, edit, 'PUT')).json())
        expect(updated.version).toBe(2)
        expect(projectTemplateSchema.parse(await (await mutate(base, 'templates', input)).json())).toEqual(updated)
        expect((await mutate(base, 'templates', { ...input, name: 'different' })).status).toBe(409)
        expect((await mutate(base, `templates/${template.id}`, edit, 'PUT')).status).toBe(409)
        expect((await mutate(base, `templates/${template.id}/launch`, launch())).status).toBe(409)
        expect((await mutate(base, `templates/${template.id}/launch`, launch({ version: 0 }))).status).toBe(400)
        const result = templateLaunchResultSchema.parse(
            await (await mutate(base, `templates/${template.id}/launch`, launch({ version: 2 }))).json()
        )
        const detail = projectDetailSchema.parse(
            await (await fetch(`${base}/projects/${result.project.id}`, { headers: await headers() })).json()
        )
        expect(detail.tasks.map(task => task.title)).toEqual(updated.tasks.map(item => item.title))
        expect(detail.tasks.map(task => task.task.status)).toEqual(['not-started', 'not-started'])
        expect(detail.tasks.every(task => task.messages.length === 0)).toBe(true)
        expect((await mutate(base, `tasks/${result.taskIds[0]}/start`, { requestId: randomUUID() })).status).toBe(503)
        expect(JSON.stringify({ template, result, detail })).not.toContain(token)
        expect(JSON.stringify({ template, result, detail })).not.toContain('"creation":')
    })

    it('rejects foreign and missing templates and Agent references without leaking or creating orphan instances', async () => {
        const base = await start()
        const agent = agentDefinitionSchema.parse(
            await (
                await mutate(base, 'agents', {
                    name: 'PRIVATE_AGENT',
                    description: '',
                    modelId: config.model,
                    systemPrompt: 'PRIVATE_PROMPT',
                    toolIds: [],
                    openingMessages: [],
                })
            ).json()
        )
        const template = projectTemplateSchema.parse(
            await (
                await mutate(
                    base,
                    'templates',
                    creation({
                        name: 'PRIVATE_TEMPLATE',
                        tasks: [{ id: randomUUID(), title: 'private', goal: 'PRIVATE_GOAL', agentId: agent.id }],
                    })
                )
            ).json()
        )
        const input = launch()
        await mutate(base, `templates/${template.id}/launch`, input)
        const foreign = randomUUID()
        expect(await (await fetch(`${base}/templates`, { headers: await headers(foreign) })).json()).toEqual({ templates: [] })
        for (const id of [template.id, randomUUID()]) {
            const responses = [
                await fetch(`${base}/templates/${id}`, { headers: await headers(foreign) }),
                await mutate(
                    base,
                    `templates/${id}`,
                    { name: 'fake', description: '', tasks: creation().tasks, version: 1 },
                    'PUT',
                    foreign
                ),
                await mutate(base, `templates/${id}/launch`, input, 'POST', foreign),
            ]
            for (const response of responses) {
                expect(response.status).toBe(404)
                expect(await response.json()).toMatchObject({ message: '未找到这个模板。' })
            }
        }
        for (const agentId of [agent.id, randomUUID()]) {
            const response = await mutate(
                base,
                'templates',
                creation({ tasks: [{ id: randomUUID(), title: 'fake', goal: 'fake', agentId }] }),
                'POST',
                foreign
            )
            expect(response.status).toBe(404)
            expect(await response.json()).toMatchObject({ message: '未找到这个 Agent。' })
        }
        expect(await (await fetch(`${base}/projects`, { headers: await headers(foreign) })).json()).toEqual({ projects: [] })
        expect(await (await fetch(`${base}/tasks`, { headers: await headers(foreign) })).json()).toEqual({ tasks: [] })
        const wrongWorkspace = await fetch(`${base}/templates/${template.id}`, {
            headers: { ...(await headers()), 'x-harness-workspace-id': 'another', 'x-harness-user-id': randomUUID() },
        })
        expect(wrongWorkspace.status).toBe(200)
        expect(projectTemplateSchema.parse(await wrongWorkspace.json())).toEqual(template)
    })

    it('rejects ordinary project action collisions and replays original instance after rename and task removal', async () => {
        const runtime = {
            run: vi.fn<ChatRuntime['run']>(async () => ({ content: 'answer', reasoning: '', status: 'complete' })),
            dispose: vi.fn(async () => undefined),
        }
        const base = await start(runtime)
        const template = projectTemplateSchema.parse(await (await mutate(base, 'templates', creation())).json())
        const ordinaryInput = { requestId: randomUUID(), name: '普通项目', description: '' }
        await mutate(base, 'projects', ordinaryInput)
        expect((await mutate(base, `templates/${template.id}/launch`, launch(ordinaryInput))).status).toBe(409)
        const input = launch()
        const result = templateLaunchResultSchema.parse(await (await mutate(base, `templates/${template.id}/launch`, input)).json())
        expect(
            (await mutate(base, 'projects', { requestId: result.project.id, name: input.name, description: input.description })).status
        ).toBe(409)
        const edited = personalProjectSchema.parse(
            await (await mutate(base, `projects/${result.project.id}`, { name: '当前项目名称', description: '现在的说明' }, 'PUT')).json()
        )
        await mutate(base, `tasks/${result.taskIds[0]}/project`, { projectId: null }, 'PUT')
        const replay = templateLaunchResultSchema.parse(await (await mutate(base, `templates/${template.id}/launch`, input)).json())
        expect(replay).toEqual({ project: edited, taskIds: result.taskIds })
        expect((await mutate(base, `templates/${template.id}/launch`, { ...input, name: 'changed' })).status).toBe(409)
        const removed = personalTaskSchema.parse(
            await (await fetch(`${base}/tasks/${result.taskIds[0]}`, { headers: await headers() })).json()
        )
        expect(removed.task.projectId).toBeUndefined()
        expect(runtime.run).not.toHaveBeenCalled()
    })

    it('runs actual Cordis only after explicit task start and isolates items, instances and project metadata', async () => {
        const providerFetch = vi.fn<typeof fetch>(async () => providerResponse())
        const runtime = await createChatRuntime({
            apiKey: providerKey,
            model: config.model,
            systemPrompt: 'fallback',
            fetch: providerFetch,
        })
        const base = await start(runtime)
        const agent = agentDefinitionSchema.parse(
            await (
                await mutate(base, 'agents', {
                    name: '研究助手',
                    description: '',
                    modelId: config.model,
                    systemPrompt: 'FROZEN_SYSTEM_PROMPT',
                    toolIds: ['calculator'],
                    openingMessages: ['OPENING_ONE', 'OPENING_TWO'],
                })
            ).json()
        )
        const template = projectTemplateSchema.parse(
            await (
                await mutate(
                    base,
                    'templates',
                    creation({
                        tasks: [
                            { id: randomUUID(), title: '任务A', goal: 'TASK_A_GOAL', agentId: agent.id },
                            { id: randomUUID(), title: '任务B', goal: 'OTHER_TASK_GOAL_SENTINEL' },
                        ],
                    })
                )
            ).json()
        )
        const input = launch()
        const first = templateLaunchResultSchema.parse(await (await mutate(base, `templates/${template.id}/launch`, input)).json())
        const second = templateLaunchResultSchema.parse(
            await (await mutate(base, `templates/${template.id}/launch`, launch({ name: 'ANOTHER_INSTANCE_SENTINEL' }))).json()
        )
        expect(providerFetch).not.toHaveBeenCalled()
        const taskId = first.taskIds[0]!
        const initialRequest = randomUUID()
        await (await mutate(base, `tasks/${taskId}/start`, { requestId: initialRequest })).text()
        await (await mutate(base, `tasks/${taskId}/start`, { requestId: initialRequest })).text()
        await mutate(base, `tasks/${taskId}/project`, { projectId: second.project.id }, 'PUT')
        await (await mutate(base, `tasks/${taskId}/messages`, { requestId: randomUUID(), content: 'CONTINUE_TASK_A' })).text()
        expect(providerFetch).toHaveBeenCalledTimes(2)
        const calls = providerFetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)))
        expect(calls[0].messages.map((message: { content?: string }) => message.content)).toEqual([
            'FROZEN_SYSTEM_PROMPT',
            'OPENING_ONE',
            'OPENING_TWO',
            'TASK_A_GOAL',
        ])
        expect(calls[1].messages.map((message: { content?: string }) => message.content)).toEqual([
            'FROZEN_SYSTEM_PROMPT',
            'OPENING_ONE',
            'OPENING_TWO',
            'TASK_A_GOAL',
            'TASK_A_ANSWER',
            'CONTINUE_TASK_A',
        ])
        expect(calls[1].tools).toHaveLength(1)
        for (const sentinel of [
            'TEMPLATE_DESCRIPTION_SENTINEL',
            'PROJECT_DESCRIPTION_SENTINEL',
            'OTHER_TASK_GOAL_SENTINEL',
            'ANOTHER_INSTANCE_SENTINEL',
        ])
            expect(JSON.stringify(calls)).not.toContain(sentinel)
        const otherTask = personalTaskSchema.parse(
            await (await fetch(`${base}/tasks/${first.taskIds[1]}`, { headers: await headers() })).json()
        )
        expect(otherTask.messages).toEqual([])
        const otherInstance = personalTaskSchema.parse(
            await (await fetch(`${base}/tasks/${second.taskIds[0]}`, { headers: await headers() })).json()
        )
        expect(otherInstance.messages.map(message => message.content)).toEqual(['OPENING_ONE', 'OPENING_TWO'])
        await mutate(base, `tasks/${taskId}/status`, { status: 'completed' }, 'PUT')
        expect((await mutate(base, `tasks/${taskId}/messages`, { requestId: randomUUID(), content: 'cannot run' })).status).toBe(409)
        expect((await mutate(base, `conversations/${taskId}/messages`, { requestId: randomUUID(), content: 'cannot bypass' })).status).toBe(
            404
        )
        await mutate(base, `tasks/${taskId}/status`, { restore: true }, 'PUT')
        await (await mutate(base, `tasks/${taskId}/messages`, { requestId: randomUUID(), content: 'RESTORED' })).text()
        expect(providerFetch).toHaveBeenCalledTimes(3)
        const replay = templateLaunchResultSchema.parse(await (await mutate(base, `templates/${template.id}/launch`, input)).json())
        expect(replay.taskIds).toEqual(first.taskIds)
        expect((await (await fetch(`${base}/tasks/${taskId}`, { headers: await headers() })).json()).task.projectId).toBe(second.project.id)
        expect(providerFetch).toHaveBeenCalledTimes(3)
        expect(JSON.stringify({ template, first, second, otherTask, otherInstance })).not.toContain(providerKey)
    })
})
