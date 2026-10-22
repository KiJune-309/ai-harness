import { randomUUID } from 'node:crypto'
import type { ChatRuntime } from '@ai-harness/chat-runtime'
import type { CreateProject, CreateTask, PersonalTask } from '@ai-harness/contracts'
import { createMemoryChatStore } from '@ai-harness/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatService } from '../src/chat-service.js'
import { readTestApiConfig as readApiConfig } from './config-fixture.js'

const scope = { userId: randomUUID(), workspaceId: 'personal' }
const config = readApiConfig({ HARNESS_API_TOKEN: 'project-service-test-token-of-sufficient-length', CHAT_STORE: 'memory' })
const services: ChatService[] = []

/**
 * Initialize real memory persistence and observable model execution.
 * @param run - Optional runtime behavior; null simulates unconfigured credentials.
 * @returns The shared task coordinator and its dependencies.
 */
async function fixture(run: ChatRuntime['run'] | null = async () => ({ content: 'answer', reasoning: '', status: 'complete' })) {
    const store = await createMemoryChatStore()
    const runtime = run ? { run: vi.fn(run), dispose: vi.fn(async () => undefined) } : undefined
    const service = new ChatService(store, runtime, config)
    services.push(service)
    return { service, store, runtime }
}

/**
 * Build a fresh stable project creation action.
 * @param fields - Fields replaced for one scenario.
 * @returns A valid independent project input.
 */
function project(fields: Partial<CreateProject> = {}): CreateProject {
    return { requestId: randomUUID(), name: '研究项目', description: '管理信息，不注入模型。', ...fields }
}

/**
 * Build a fresh stable task creation action.
 * @param fields - Fields replaced for one scenario.
 * @returns A valid independent task input.
 */
function task(fields: Partial<CreateTask> = {}): CreateTask {
    return { requestId: randomUUID(), title: '核对研究结论', goal: 'TASK_GOAL_SENTINEL', ...fields }
}

/**
 * Remove fields intentionally changed by a membership action for exact context comparison.
 * @param value - Complete task snapshot.
 * @returns All task context, excluding current membership and update timestamp.
 */
function context(value: PersonalTask) {
    const result = structuredClone(value)
    delete result.task.projectId
    return { ...result, updatedAt: '' }
}

afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()))
})

describe('personal project idempotency, isolation and atomic membership', () => {
    it('creates real projects without execution, allows namesakes and replays original fields after edits', async () => {
        const { service, runtime, store } = await fixture()
        expect(await service.listProjects(scope)).toEqual([])
        const input = project({ name: '  研究项目  ', description: '  原始说明  ' })
        const created = await service.createProject(scope, input)
        expect(created).toMatchObject({ id: input.requestId, name: '研究项目', description: '原始说明' })
        expect(await service.getProject(scope, created.id)).toEqual({ project: created, tasks: [] })
        const edited = await service.updateProject(scope, created.id, { name: '修改后名称', description: '修改后说明' })
        expect(edited.createdAt).toBe(created.createdAt)
        expect(await service.createProject(scope, input)).toEqual(edited)
        await expect(service.createProject(scope, { ...input, name: edited.name })).rejects.toMatchObject({ status: 409 })
        const namesake = await service.createProject(scope, project({ name: edited.name, description: edited.description }))
        expect(namesake.id).not.toBe(edited.id)
        expect(await service.listProjects(scope)).toHaveLength(2)
        expect(await store.projects!.get(scope, created.id)).toMatchObject({
            project: edited,
            creation: { name: '研究项目', description: '原始说明' },
        })
        expect(runtime!.run).not.toHaveBeenCalled()
    })

    it('rejects invalid fields and failed create/edit storage leaves original records intact', async () => {
        const { service, store } = await fixture()
        for (const fields of [{ name: ' ' }, { name: 'a'.repeat(121) }, { description: 'a'.repeat(2001) }]) {
            await expect(service.createProject(scope, project(fields))).rejects.toMatchObject({ status: 400 })
            await expect(service.updateProject(scope, randomUUID(), { name: 'valid', description: '', ...fields })).rejects.toMatchObject({
                status: 400,
            })
        }
        vi.spyOn(store.projects!, 'save').mockRejectedValueOnce(new Error('create storage failure'))
        const input = project()
        await expect(service.createProject(scope, input)).rejects.toThrow('create storage failure')
        expect(await service.listProjects(scope)).toEqual([])
        const created = await service.createProject(scope, input)
        vi.spyOn(store.projects!, 'save').mockRejectedValueOnce(new Error('edit storage failure'))
        await expect(service.updateProject(scope, created.id, { name: 'unsaved', description: '' })).rejects.toThrow('edit storage failure')
        expect((await service.getProject(scope, created.id)).project).toEqual(created)
    })

    it('saves initial membership atomically without credentials and keeps current membership on creation replay', async () => {
        const { service, store } = await fixture(null)
        const first = await service.createProject(scope, project())
        const second = await service.createProject(scope, project({ name: '另一项目' }))
        const input = task({ projectId: first.id })
        vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('task save failure'))
        await expect(service.createTask(scope, input)).rejects.toThrow('task save failure')
        expect(await service.listTasks(scope)).toEqual([])
        expect((await service.getProject(scope, first.id)).tasks).toEqual([])
        const created = await service.createTask(scope, input)
        expect(created.task).toMatchObject({ projectId: first.id, creationProjectId: first.id, started: false })
        expect((await service.getProject(scope, first.id)).tasks).toEqual([created])
        const moved = await service.updateTaskProject(scope, created.id, { projectId: second.id })
        expect(await service.createTask(scope, input)).toEqual(moved)
        expect(context(moved)).toEqual(context(created))
        await expect(service.createTask(scope, { ...input, projectId: second.id })).rejects.toMatchObject({ status: 409 })
        const removed = await service.updateTaskProject(scope, created.id, { projectId: null })
        expect(await service.createTask(scope, input)).toEqual(removed)
        expect(removed.task.creationProjectId).toBe(first.id)
        expect(removed.task.projectId).toBeUndefined()
        expect((await service.getProject(scope, first.id)).tasks).toEqual([])
        expect((await service.getProject(scope, second.id)).tasks).toEqual([])
        await expect(
            service.startTask(scope, created.id, randomUUID(), new AbortController().signal, () => undefined)
        ).rejects.toMatchObject({ status: 503 })
    })

    it('supports completed task membership and aggregates all real states without changing task context', async () => {
        const { service, runtime } = await fixture()
        const target = await service.createProject(scope, project())
        for (const status of ['not-started', 'in-progress', 'needs-input', 'completed'] as const) {
            const created = await service.createTask(scope, task())
            const original = status === 'not-started' ? created : await service.updateTaskStatus(scope, created.id, { status })
            const grouped = await service.updateTaskProject(scope, original.id, { projectId: target.id })
            expect(context(grouped)).toEqual(context(original))
            expect(await service.updateTaskProject(scope, original.id, { projectId: target.id })).toEqual(grouped)
        }
        const detail = await service.getProject(scope, target.id)
        expect(detail.tasks).toHaveLength(4)
        expect(new Set(detail.tasks.map(value => value.task.status))).toEqual(
            new Set(['not-started', 'in-progress', 'needs-input', 'completed'])
        )
        expect(await service.listTasks(scope)).toHaveLength(4)
        expect(await service.list(scope)).toEqual([])
        expect(runtime!.run).not.toHaveBeenCalled()
    })

    it('validates both ownership dimensions and association sides without orphans or private content', async () => {
        const { service } = await fixture()
        const ownedProject = await service.createProject(scope, project({ name: 'PRIVATE_PROJECT' }))
        const ownedTask = await service.createTask(scope, task({ projectId: ownedProject.id }))
        for (const foreignScope of [
            { ...scope, userId: randomUUID() },
            { ...scope, workspaceId: 'other-workspace' },
        ]) {
            const foreignProject = await service.createProject(foreignScope, project({ name: 'foreign' }))
            const foreignTask = await service.createTask(foreignScope, task())
            expect(await service.listProjects(foreignScope)).toEqual([foreignProject])
            for (const id of [ownedProject.id, randomUUID()]) {
                await expect(service.getProject(foreignScope, id)).rejects.toMatchObject({ status: 404, message: '未找到这个项目。' })
                await expect(service.updateProject(foreignScope, id, { name: 'overwrite', description: '' })).rejects.toMatchObject({
                    status: 404,
                })
                await expect(service.createTask(foreignScope, task({ projectId: id }))).rejects.toMatchObject({ status: 404 })
                await expect(service.updateTaskProject(foreignScope, foreignTask.id, { projectId: id })).rejects.toMatchObject({
                    status: 404,
                })
            }
            await expect(service.updateTaskProject(foreignScope, ownedTask.id, { projectId: foreignProject.id })).rejects.toMatchObject({
                status: 404,
                message: '未找到这个任务。',
            })
            expect(await service.listTasks(foreignScope)).toEqual([foreignTask])
        }
        expect(await service.getTask(scope, ownedTask.id)).toEqual(ownedTask)
        const ordinary = await service.create(scope)
        await expect(service.updateTaskProject(scope, ordinary.id, { projectId: ownedProject.id })).rejects.toMatchObject({ status: 404 })
    })

    it('preserves original membership and counts when a scoped task save fails', async () => {
        const { service, store } = await fixture()
        const first = await service.createProject(scope, project())
        const second = await service.createProject(scope, project())
        const created = await service.createTask(scope, task({ projectId: first.id }))
        vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('membership failure'))
        await expect(service.updateTaskProject(scope, created.id, { projectId: second.id })).rejects.toThrow('membership failure')
        expect(await service.getTask(scope, created.id)).toEqual(created)
        expect((await service.getProject(scope, first.id)).tasks).toEqual([created])
        expect((await service.getProject(scope, second.id)).tasks).toEqual([])
        const moved = await service.updateTaskProject(scope, created.id, { projectId: second.id })
        expect(context(moved)).toEqual(context(created))
    })

    it('reserves project writes before asynchronous reads and permits safe replay after concurrent refusal', async () => {
        const { service, store } = await fixture()
        const input = project()
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const get = store.projects!.get.bind(store.projects)
        vi.spyOn(store.projects!, 'get').mockImplementationOnce(async (identity, id) => {
            const snapshot = await get(identity, id)
            entered.resolve()
            await release.promise
            return snapshot
        })
        const pending = service.createProject(scope, input)
        await entered.promise
        await expect(service.createProject(scope, input)).rejects.toMatchObject({ status: 409 })
        await expect(service.updateProject(scope, input.requestId, { name: 'race', description: '' })).rejects.toMatchObject({
            status: 409,
        })
        release.resolve()
        const created = await pending
        expect(await service.createProject(scope, input)).toEqual(created)
        expect(await service.listProjects(scope)).toEqual([created])
    })

    it('shares task locks with generation, status and concurrent movement so newer messages survive', async () => {
        const enteredRuntime = Promise.withResolvers<void>()
        const finishRuntime = Promise.withResolvers<void>()
        const { service, store } = await fixture(async () => {
            enteredRuntime.resolve()
            await finishRuntime.promise
            return { content: 'NEWER_ANSWER', reasoning: '', status: 'complete' }
        })
        const first = await service.createProject(scope, project())
        const second = await service.createProject(scope, project())
        const created = await service.createTask(scope, task({ projectId: first.id }))
        const generating = service.startTask(scope, created.id, randomUUID(), new AbortController().signal, () => undefined)
        await enteredRuntime.promise
        await expect(service.updateTaskProject(scope, created.id, { projectId: second.id })).rejects.toMatchObject({ status: 409 })
        finishRuntime.resolve()
        await generating
        const afterGeneration = await service.getTask(scope, created.id)
        const enteredRead = Promise.withResolvers<void>()
        const releaseRead = Promise.withResolvers<void>()
        const get = store.get.bind(store)
        vi.spyOn(store, 'get').mockImplementationOnce(async (identity, id) => {
            const snapshot = await get(identity, id)
            enteredRead.resolve()
            await releaseRead.promise
            return snapshot
        })
        const moving = service.updateTaskProject(scope, created.id, { projectId: second.id })
        await enteredRead.promise
        await expect(service.updateTaskProject(scope, created.id, { projectId: null })).rejects.toMatchObject({ status: 409 })
        await expect(service.updateTaskStatus(scope, created.id, { status: 'completed' })).rejects.toMatchObject({ status: 409 })
        await expect(
            service.sendTask(scope, created.id, { requestId: randomUUID(), content: 'race' }, new AbortController().signal, () => undefined)
        ).rejects.toMatchObject({ status: 409 })
        releaseRead.resolve()
        const moved = await moving
        expect(moved.task.projectId).toBe(second.id)
        expect(context(moved)).toEqual(context(afterGeneration))
        expect(moved.messages.at(-1)?.content).toBe('NEWER_ANSWER')
        expect((await service.getProject(scope, first.id)).tasks).toEqual([])
        expect((await service.getProject(scope, second.id)).tasks).toEqual([moved])
    })
})
