import { randomUUID } from 'node:crypto'
import type { ChatRuntime } from '@ai-harness/chat-runtime'
import type { CreateTemplate, LaunchTemplate, TemplateInput } from '@ai-harness/contracts'
import { createMemoryChatStore, TemplateConflictError } from '@ai-harness/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from '../src/agent-service.js'
import { createAgentCatalog } from '../src/agent-catalog.js'
import { ChatService } from '../src/chat-service.js'
import { readTestApiConfig as readApiConfig } from './config-fixture.js'

const scope = { userId: randomUUID(), workspaceId: 'personal' }
const config = readApiConfig({ HARNESS_API_TOKEN: 'template-service-test-token-of-sufficient-length', CHAT_STORE: 'memory' })
const services: ChatService[] = []

/**
 * Initialize real scoped memory storage and observable execution dependencies.
 * @param configured - Whether a model runtime is available.
 * @returns The shared service, real Agent validation and persistence.
 */
async function fixture(configured = true) {
    const store = await createMemoryChatStore()
    const runtime = configured
        ? {
              run: vi.fn<ChatRuntime['run']>(async () => ({ content: 'MODEL_ANSWER', reasoning: '', status: 'complete' })),
              dispose: vi.fn(async () => undefined),
          }
        : undefined
    const agents = new AgentService(store.agents, createAgentCatalog(config, Boolean(runtime)))
    const service = new ChatService(store, runtime, config, agents)
    services.push(service)
    return { service, store, runtime, agents }
}

/**
 * Build a normalized template blueprint with independent stable item identifiers.
 * @param fields - Optional replacement template fields.
 * @returns A valid three-item blueprint.
 */
function blueprint(fields: Partial<TemplateInput> = {}): TemplateInput {
    return {
        name: '每周产品回顾',
        description: 'TEMPLATE_DESCRIPTION_SENTINEL',
        tasks: [1, 2, 3].map(index => ({ id: randomUUID(), title: `任务${index}`, goal: `GOAL_${index}` })),
        ...fields,
    }
}

/**
 * Build a creation action retaining the supplied blueprint fields.
 * @param fields - Optional replacement creation fields.
 * @returns A fresh stable template creation action.
 */
function creation(fields: Partial<CreateTemplate> = {}): CreateTemplate {
    return { ...blueprint(), requestId: randomUUID(), ...fields }
}

/**
 * Build a fresh project launch action for the first template revision.
 * @param fields - Optional replacement launch fields.
 * @returns Valid independent launch parameters.
 */
function launch(fields: Partial<LaunchTemplate> = {}): LaunchTemplate {
    return { requestId: randomUUID(), version: 1, name: '第42周回顾', description: 'PROJECT_DESCRIPTION_SENTINEL', ...fields }
}

afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()))
})

describe('versioned template management and atomic project instances', () => {
    it('creates without execution, permits namesakes and replays current revisions using original parameters', async () => {
        const { service, runtime } = await fixture()
        expect(await service.listTemplates(scope)).toEqual([])
        const input = creation({ name: '  每周回顾  ', description: '  初始说明  ' })
        const template = await service.createTemplate(scope, input)
        expect(template).toMatchObject({ id: input.requestId, version: 1, name: '每周回顾', description: '初始说明' })
        const edited = await service.updateTemplate(scope, template.id, {
            ...blueprint({ name: '修改后模板', tasks: [...template.tasks].reverse() }),
            version: 1,
        })
        expect(edited.version).toBe(2)
        expect(edited.createdAt).toBe(template.createdAt)
        expect(await service.createTemplate(scope, input)).toEqual(edited)
        await expect(service.createTemplate(scope, { ...input, description: 'different' })).rejects.toMatchObject({ status: 409 })
        await service.createTemplate(scope, creation({ name: edited.name }))
        expect(await service.listTemplates(scope)).toHaveLength(2)
        await expect(service.updateTemplate(scope, template.id, { ...blueprint(), version: 1 })).rejects.toMatchObject({ status: 409 })
        expect(await service.getTemplate(scope, template.id)).toEqual(edited)
        expect(runtime!.run).not.toHaveBeenCalled()
    })

    it('rejects malformed blueprints before saving and maps persistence CAS conflicts to409', async () => {
        const { service, store } = await fixture()
        const repeated = randomUUID()
        const invalid = [
            creation({ name: ' ' }),
            creation({ tasks: [] }),
            creation({ tasks: Array.from({ length: 9 }, () => ({ id: randomUUID(), title: 'valid', goal: 'valid' })) }),
            creation({
                tasks: [
                    { id: repeated, title: 'one', goal: 'one' },
                    { id: repeated, title: 'two', goal: 'two' },
                ],
            }),
            creation({ tasks: [{ id: randomUUID(), title: ' ', goal: 'valid' }] }),
            creation({ tasks: [{ id: randomUUID(), title: 'valid', goal: 'a'.repeat(8001) }] }),
            creation({ tasks: Array.from({ length: 5 }, () => ({ id: randomUUID(), title: 'valid', goal: 'a'.repeat(8000) })) }),
        ]
        for (const input of invalid) await expect(service.createTemplate(scope, input)).rejects.toMatchObject({ status: 400 })
        expect(await service.listTemplates(scope)).toEqual([])
        const input = creation()
        vi.spyOn(store.templates!, 'save').mockRejectedValueOnce(new Error('save failed'))
        await expect(service.createTemplate(scope, input)).rejects.toThrow('save failed')
        expect(await service.listTemplates(scope)).toEqual([])
        const created = await service.createTemplate(scope, input)
        vi.spyOn(store.templates!, 'save').mockRejectedValueOnce(new TemplateConflictError())
        await expect(service.updateTemplate(scope, created.id, { ...blueprint(), version: 1 })).rejects.toMatchObject({ status: 409 })
        expect(await service.getTemplate(scope, created.id)).toEqual(created)
    })

    it('saves and launches without a runtime, leaving all tasks unstarted and explicit execution refused', async () => {
        const { service, agents } = await fixture(false)
        const agent = await agents.create(scope, {
            name: '离线研究助手',
            description: '',
            modelId: config.model,
            systemPrompt: 'SAVED_WITHOUT_KEY',
            toolIds: ['calculator'],
            openingMessages: ['离线开场一', '离线开场二'],
        })
        const input = creation()
        input.tasks[0]!.agentId = agent.id
        const template = await service.createTemplate(scope, input)
        const result = await service.launchTemplate(scope, template.id, launch())
        const detail = await service.getProject(scope, result.project.id)
        expect(detail.tasks.map(task => task.id)).toEqual(result.taskIds)
        expect(detail.tasks.map(task => task.title)).toEqual(template.tasks.map(task => task.title))
        for (const task of detail.tasks) {
            expect(task.task).toMatchObject({
                projectId: result.project.id,
                creationProjectId: result.project.id,
                status: 'not-started',
                started: false,
            })
            expect(task.messages.map(message => message.content)).toEqual(task.agent.openingMessages)
            expect(task.messages.every(message => message.kind === 'opening' && message.role === 'assistant')).toBe(true)
            await expect(
                service.startTask(scope, task.id, randomUUID(), new AbortController().signal, () => undefined)
            ).rejects.toMatchObject({ status: 503 })
            expect(await service.getTask(scope, task.id)).toEqual(task)
        }
        expect((await service.listTasks(scope)).map(task => task.id).sort()).toEqual([...result.taskIds].sort())
        expect(await service.list(scope)).toEqual([])
    })

    it('resolves each repeated Agent and default exactly once while allocating independent histories', async () => {
        const { service, agents, runtime, store } = await fixture()
        const original = {
            name: '研究助手',
            description: '',
            modelId: config.model,
            systemPrompt: 'OLD_PROMPT',
            toolIds: ['calculator'] as const,
            openingMessages: ['OPENING_ONE', 'OPENING_TWO'],
        }
        const agent = await agents.create(scope, { ...original, toolIds: [...original.toolIds] })
        const template = await service.createTemplate(
            scope,
            creation({
                tasks: [0, 1, 2, 3].map(index => ({
                    id: randomUUID(),
                    title: `任务${index}`,
                    goal: `GOAL_${index}`,
                    ...(index < 2 ? { agentId: agent.id } : {}),
                })),
            })
        )
        await agents.update(scope, agent.id, { ...original, toolIds: [...original.toolIds], systemPrompt: 'LAUNCH_TIME_PROMPT' })
        const get = vi.spyOn(agents, 'get')
        const result = await service.launchTemplate(scope, template.id, launch())
        expect(get).toHaveBeenCalledTimes(1)
        const tasks = (await service.getProject(scope, result.project.id)).tasks
        expect(tasks).toHaveLength(4)
        expect(tasks[0]!.agent).toEqual(tasks[1]!.agent)
        expect(tasks[2]!.agent).toEqual(tasks[3]!.agent)
        expect(tasks[0]!.agent.systemPrompt).toBe('LAUNCH_TIME_PROMPT')
        expect(tasks[2]!.agent).toMatchObject({ systemPrompt: config.systemPrompt, modelId: config.model })
        expect(tasks[0]!.messages.map(message => message.content)).toEqual(original.openingMessages)
        expect(new Set(tasks.flatMap(task => task.messages.map(message => message.id))).size).toBe(4)
        tasks[0]!.messages[0]!.content = 'local mutation'
        expect(tasks[1]!.messages[0]!.content).toBe('OPENING_ONE')
        expect((await service.getTask(scope, tasks[0]!.id)).messages[0]!.content).toBe('OPENING_ONE')
        await agents.update(scope, agent.id, { ...original, toolIds: [], systemPrompt: 'AFTER_LAUNCH_PROMPT', openingMessages: [] })
        expect((await store.get(scope, tasks[1]!.id))!.agent).toEqual(tasks[1]!.agent)
        expect(runtime!.run).not.toHaveBeenCalled()
    })

    it('rejects old preview versions and collisions with ordinary project creation in both directions', async () => {
        const { service } = await fixture()
        const template = await service.createTemplate(scope, creation())
        const versionTwo = await service.updateTemplate(scope, template.id, { ...blueprint(), version: 1 })
        await expect(service.launchTemplate(scope, template.id, launch())).rejects.toMatchObject({ status: 409 })
        expect(await service.listProjects(scope)).toEqual([])
        const ordinaryInput = { requestId: randomUUID(), name: 'same', description: '' }
        const ordinary = await service.createProject(scope, ordinaryInput)
        await expect(service.launchTemplate(scope, template.id, launch({ ...ordinaryInput, version: 2 }))).rejects.toMatchObject({
            status: 409,
        })
        expect((await service.getProject(scope, ordinary.id)).project).toEqual(ordinary)
        const result = await service.launchTemplate(scope, template.id, launch({ version: versionTwo.version }))
        await expect(
            service.createProject(scope, {
                requestId: result.project.id,
                name: result.project.name,
                description: result.project.description,
            })
        ).rejects.toMatchObject({ status: 409 })
    })

    it('replays original launch after rename, execution, movement and template/Agent changes without rollback', async () => {
        const { service, agents, runtime } = await fixture()
        const agent = await agents.create(scope, {
            name: '研究助手',
            description: '',
            modelId: config.model,
            systemPrompt: 'FROZEN',
            toolIds: [],
            openingMessages: ['OPENING'],
        })
        const template = await service.createTemplate(
            scope,
            creation({ tasks: [{ id: randomUUID(), title: '记住目标', goal: 'ORIGINAL_GOAL', agentId: agent.id }] })
        )
        const input = launch()
        const result = await service.launchTemplate(scope, template.id, input)
        const taskId = result.taskIds[0]!
        await service.startTask(scope, taskId, randomUUID(), new AbortController().signal, () => undefined)
        await service.updateTaskProject(scope, taskId, { projectId: null })
        const latestTask = await service.getTask(scope, taskId)
        const currentProject = await service.updateProject(scope, result.project.id, { name: '现在的项目名称', description: '现在的说明' })
        await service.updateTemplate(scope, template.id, { ...blueprint({ name: '新模板' }), version: 1 })
        await agents.update(scope, agent.id, {
            name: 'changed',
            description: '',
            modelId: config.model,
            systemPrompt: 'CHANGED',
            toolIds: [],
            openingMessages: [],
        })
        const lookup = vi.spyOn(agents, 'get').mockRejectedValue(new Error('must not resolve on replay'))
        expect(await service.launchTemplate(scope, template.id, input)).toEqual({ project: currentProject, taskIds: result.taskIds })
        expect(lookup).not.toHaveBeenCalled()
        expect(await service.getTask(scope, taskId)).toEqual(latestTask)
        expect((await service.getProject(scope, result.project.id)).tasks).toEqual([])
        expect(runtime!.run).toHaveBeenCalledOnce()
        for (const changed of [{ name: 'different' }, { description: 'different' }, { version: 2 }])
            await expect(service.launchTemplate(scope, template.id, { ...input, ...changed })).rejects.toMatchObject({ status: 409 })
        const other = await service.createTemplate(scope, creation())
        await expect(service.launchTemplate(scope, other.id, input)).rejects.toMatchObject({ status: 409 })
    })

    it('publishes no partial project, tasks or successful action when a later memory item fails validation', async () => {
        const { service, store } = await fixture()
        const template = await service.createTemplate(scope, creation())
        const input = launch()
        const instantiate = store.instantiateTemplateProject!.bind(store)
        vi.spyOn(store, 'instantiateTemplateProject').mockImplementationOnce((identity, batch) =>
            instantiate(identity, { ...batch, tasks: batch.tasks.map((task, index) => (index === 1 ? { ...task, title: '' } : task)) })
        )
        await expect(service.launchTemplate(scope, template.id, input)).rejects.toThrow()
        expect(await service.listProjects(scope)).toEqual([])
        expect(await service.listTasks(scope)).toEqual([])
        expect(await store.templates!.getLaunch(scope, input.requestId)).toBeUndefined()
        const result = await service.launchTemplate(scope, template.id, input)
        expect((await service.getProject(scope, result.project.id)).tasks).toHaveLength(3)
        expect(await service.launchTemplate(scope, template.id, input)).toEqual(result)
    })

    it('locks launch and edits before async reads, then permits independent actions using one coherent version', async () => {
        const { service, store } = await fixture()
        const template = await service.createTemplate(scope, creation())
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const get = store.templates!.get.bind(store.templates)
        vi.spyOn(store.templates!, 'get').mockImplementationOnce(async (identity, id) => {
            const snapshot = await get(identity, id)
            entered.resolve()
            await release.promise
            return snapshot
        })
        const input = launch()
        const pending = service.launchTemplate(scope, template.id, input)
        await entered.promise
        await expect(service.launchTemplate(scope, template.id, input)).rejects.toMatchObject({ status: 409 })
        await expect(service.updateTemplate(scope, template.id, { ...blueprint(), version: 1 })).rejects.toMatchObject({ status: 409 })
        await expect(
            service.createProject(scope, { requestId: input.requestId, name: input.name, description: input.description })
        ).rejects.toMatchObject({ status: 409 })
        release.resolve()
        const first = await pending
        expect(await service.launchTemplate(scope, template.id, input)).toEqual(first)
        const second = await service.launchTemplate(scope, template.id, launch())
        expect(second.project.id).not.toBe(first.project.id)
        expect(new Set([...first.taskIds, ...second.taskIds]).size).toBe(6)
        expect((await service.getProject(scope, second.project.id)).tasks.map(task => task.task.goal)).toEqual(
            template.tasks.map(item => item.goal)
        )
    })

    it('refuses a concurrent old preview during an edit and later launches only the complete new revision', async () => {
        const { service, store } = await fixture()
        const template = await service.createTemplate(scope, creation())
        const next = blueprint({
            tasks: [
                { id: randomUUID(), title: '新任务甲', goal: 'NEW_GOAL_A' },
                { id: randomUUID(), title: '新任务乙', goal: 'NEW_GOAL_B' },
            ],
        })
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const save = store.templates!.save.bind(store.templates)
        vi.spyOn(store.templates!, 'save').mockImplementationOnce(async (identity, record, expected) => {
            entered.resolve()
            await release.promise
            return save(identity, record, expected)
        })
        const editing = service.updateTemplate(scope, template.id, { ...next, version: 1 })
        await entered.promise
        const input = launch()
        await expect(service.launchTemplate(scope, template.id, input)).rejects.toMatchObject({ status: 409 })
        expect(await service.listProjects(scope)).toEqual([])
        release.resolve()
        const updated = await editing
        await expect(service.launchTemplate(scope, template.id, input)).rejects.toMatchObject({
            status: 409,
            message: '模板版本已发生变化，请重新载入预览后再启动。',
        })
        const result = await service.launchTemplate(scope, template.id, { ...input, version: updated.version })
        const detail = await service.getProject(scope, result.project.id)
        expect(detail.tasks.map(task => task.task.goal)).toEqual(['NEW_GOAL_A', 'NEW_GOAL_B'])
        expect(detail.project.templateOrigin?.version).toBe(2)
    })

    it('enforces both scope dimensions on templates, Agents and first launches without exposing private results', async () => {
        const { service, agents } = await fixture()
        const agent = await agents.create(scope, {
            name: 'PRIVATE_AGENT',
            description: '',
            modelId: config.model,
            systemPrompt: 'PRIVATE_PROMPT',
            toolIds: [],
            openingMessages: [],
        })
        const template = await service.createTemplate(
            scope,
            creation({ name: 'PRIVATE_TEMPLATE', tasks: [{ id: randomUUID(), title: 'private', goal: 'PRIVATE_GOAL', agentId: agent.id }] })
        )
        const input = launch()
        const result = await service.launchTemplate(scope, template.id, input)
        for (const identity of [
            { ...scope, userId: randomUUID() },
            { ...scope, workspaceId: 'other' },
        ]) {
            expect(await service.listTemplates(identity)).toEqual([])
            for (const id of [template.id, randomUUID()]) {
                await expect(service.getTemplate(identity, id)).rejects.toMatchObject({ status: 404, message: '未找到这个模板。' })
                await expect(service.updateTemplate(identity, id, { ...blueprint(), version: 1 })).rejects.toMatchObject({ status: 404 })
                await expect(service.launchTemplate(identity, id, input)).rejects.toMatchObject({
                    status: 404,
                    message: '未找到这个模板。',
                })
            }
            for (const agentId of [agent.id, randomUUID()])
                await expect(
                    service.createTemplate(identity, creation({ tasks: [{ id: randomUUID(), title: 'fake', goal: 'fake', agentId }] }))
                ).rejects.toMatchObject({ status: 404 })
            expect(await service.listProjects(identity)).toEqual([])
            expect(await service.listTasks(identity)).toEqual([])
        }
        const get = vi.spyOn(agents, 'get').mockRejectedValueOnce(Object.assign(new Error('未找到这个 Agent。'), { status: 404 }))
        await expect(service.launchTemplate(scope, template.id, launch())).rejects.toMatchObject({ status: 404 })
        get.mockRestore()
        expect(await service.listProjects(scope)).toEqual([result.project])
        expect(await service.listTasks(scope)).toHaveLength(1)
    })

    it('retains template order after task activity and appends later membership without rewriting origin', async () => {
        const { service } = await fixture()
        const template = await service.createTemplate(scope, creation())
        const result = await service.launchTemplate(scope, template.id, launch())
        await service.startTask(scope, result.taskIds[2]!, randomUUID(), new AbortController().signal, () => undefined)
        const extra = await service.createTask(scope, {
            requestId: randomUUID(),
            title: 'later',
            goal: 'later',
            projectId: result.project.id,
        })
        expect((await service.getProject(scope, result.project.id)).tasks.map(task => task.id)).toEqual([...result.taskIds, extra.id])
        await service.updateTaskProject(scope, result.taskIds[1]!, { projectId: null })
        const detail = await service.getProject(scope, result.project.id)
        expect(detail.tasks.map(task => task.id)).toEqual([result.taskIds[0], result.taskIds[2], extra.id])
        expect(detail.project.templateOrigin?.taskIds).toEqual(result.taskIds)
    })
})
