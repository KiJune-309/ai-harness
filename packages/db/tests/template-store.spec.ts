import type { PersonalTask, TemplateInput } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    createChatStore,
    TemplateConflictError,
    type ChatStore,
    type StoredProjectTemplate,
    type TemplateProjectBatch,
} from '../src/index.js'

const database = vi.hoisted(() => ({
    query: vi.fn(),
    end: vi.fn(),
    connect: vi.fn(),
    clientQuery: vi.fn(),
    release: vi.fn(),
    poolCount: 0,
}))

vi.mock('pg', () => ({
    default: {
        Pool: class {
            /**
             * Records use of one pool for conversations, templates, and transactional launches.
             */
            constructor() {
                database.poolCount += 1
            }
            query = database.query
            end = database.end
            connect = database.connect
        },
    },
}))

const scope = { userId: 'template-owner', workspaceId: 'template-workspace' }
const otherUser = { ...scope, userId: 'other-owner' }
const otherWorkspace = { ...scope, workspaceId: 'other-workspace' }
const templateId = 'fb8944f0-fadc-48b7-84b6-68c4f695a940'
const requestId = 'f55b0693-484c-43c9-83ac-5f4cb3f9f3bc'
const secondRequestId = '72eea7b9-15c7-40cb-8779-7fc7d98b6b23'
const taskIds = ['4197fc8e-2c48-4326-b29e-9e02c4e814fc', 'd4244133-6d9b-4aae-950f-153aac063ef8', '945f7bf4-f370-4f26-91eb-864098f10c07']
const stores: ChatStore[] = []

/**
 * Creates a three-entry template input in a recognizable stable order.
 * @returns Valid original template creation parameters.
 */
function templateInput(): TemplateInput {
    return {
        name: 'Weekly research',
        description: 'Repeat the review process.',
        tasks: taskIds.map((id, index) => ({ id, title: `Stage ${index + 1}`, goal: `Investigate stage ${index + 1}.` })),
    }
}

/**
 * Builds a stored template with independent current and original input sections.
 * @param changes - Current template fields to replace for a scenario.
 * @returns A complete versioned template storage record.
 */
function template(changes: Partial<StoredProjectTemplate['template']> = {}): StoredProjectTemplate {
    return {
        template: {
            ...templateInput(),
            id: templateId,
            version: 1,
            createdAt: '2026-10-17T01:00:00.000Z',
            updatedAt: '2026-10-17T01:00:00.000Z',
            ...changes,
        },
        creation: templateInput(),
    }
}

/**
 * Builds an unstarted task with one frozen opening message for a template batch.
 * @param id - Generated task identifier.
 * @param index - Initial template entry position.
 * @param projectId - New project identifier shared with the launch action.
 * @returns A complete independently executable task snapshot.
 */
function task(id: string, index: number, projectId: string): PersonalTask {
    return {
        id,
        title: `Stage ${index + 1}`,
        createdAt: '2026-10-17T02:00:00.000Z',
        updatedAt: '2026-10-17T02:00:00.000Z',
        agent: {
            id: '8436a9f1-d8e9-4e9a-861a-a052053bd301',
            name: 'Research assistant',
            description: '',
            modelId: 'deepseek-flash',
            systemPrompt: 'Keep each task independent.',
            toolIds: [],
            openingMessages: ['What shall we investigate?'],
            createdAt: '2026-10-17T01:00:00.000Z',
            updatedAt: '2026-10-17T01:00:00.000Z',
        },
        task: { goal: `Investigate stage ${index + 1}.`, status: 'not-started', started: false, projectId, creationProjectId: projectId },
        messages: [
            {
                id: `opening-${id}`,
                role: 'assistant',
                content: 'What shall we investigate?',
                kind: 'opening',
                status: 'complete',
                createdAt: '2026-10-17T02:00:00.000Z',
            },
        ],
    }
}

/**
 * Creates an internally consistent project, ordered task, and launch transaction batch.
 * @param projectId - New project identifier, also used as the launch request identifier.
 * @param ids - Ordered generated task identifiers for the instance.
 * @returns A complete initial project batch with frozen agent snapshots.
 */
function batch(projectId = requestId, ids = taskIds): TemplateProjectBatch {
    const input = { name: 'Week 42 research', description: 'Project management information.' }
    return {
        project: {
            project: {
                ...input,
                id: projectId,
                createdAt: '2026-10-17T02:00:00.000Z',
                updatedAt: '2026-10-17T02:00:00.000Z',
                templateOrigin: { templateId, version: 1, taskIds: [...ids] },
            },
            creation: { ...input },
        },
        tasks: ids.map((id, index) => task(id, index, projectId)),
        launch: { requestId: projectId, templateId, version: 1, input: { ...input }, taskIds: [...ids] },
    }
}

/**
 * Makes the mocked transaction return a valid template only for its locked read.
 * @param current - Template record visible to the transaction.
 * @returns Nothing after configuring the mocked client.
 */
function transactionTemplate(current = template()): void {
    database.clientQuery.mockImplementation(async (sql: string) => ({ rows: sql.includes('FOR SHARE') ? [{ data: current }] : [] }))
}

beforeEach(() => {
    database.query.mockReset().mockResolvedValue({ rows: [] })
    database.end.mockReset().mockResolvedValue(undefined)
    database.clientQuery.mockReset().mockResolvedValue({ rows: [] })
    database.release.mockReset()
    database.connect.mockReset().mockResolvedValue({ query: database.clientQuery, release: database.release })
    database.poolCount = 0
})

afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close()))
})

describe('memory template persistence', () => {
    it('isolates both scope fields, returns deep copies, and orders templates by update', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const original = template()
        await store.templates!.save(scope, original)
        original.template.tasks[0]!.goal = 'Mutated input'
        original.creation.tasks[0]!.goal = 'Mutated original input'
        expect(await store.templates!.get(scope, templateId)).toEqual(template())
        expect(await store.templates!.get(otherUser, templateId)).toBeUndefined()
        expect(await store.templates!.get(otherWorkspace, templateId)).toBeUndefined()
        expect(await store.templates!.list(otherUser)).toEqual([])
        expect(await store.templates!.list(otherWorkspace)).toEqual([])
        const later = template({ id: secondRequestId, updatedAt: '2026-10-17T03:00:00.000Z' })
        await store.templates!.save(scope, later)
        const list = await store.templates!.list(scope)
        expect(list).toEqual([later, template()])
        list[1]!.template.tasks.reverse()
        const read = (await store.templates!.get(scope, templateId))!
        read.creation.tasks.length = 0
        expect(await store.templates!.get(scope, templateId)).toEqual(template())
        await store.templates!.save(otherUser, template({ name: 'Other owner' }))
        expect((await store.templates!.get(scope, templateId))?.template.name).toBe('Weekly research')
    })

    it('compare-and-swaps once, rejects stale or duplicate writes, and preserves original creation input', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        await store.templates!.save(scope, template())
        await expect(store.templates!.save(scope, template())).rejects.toBeInstanceOf(TemplateConflictError)
        const first = template({ version: 2, name: 'First update' })
        first.creation.name = 'Attempted creation overwrite'
        const second = template({ version: 2, name: 'Concurrent update' })
        const results = await Promise.allSettled([store.templates!.save(scope, first, 1), store.templates!.save(scope, second, 1)])
        expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
        const saved = (await store.templates!.get(scope, templateId))!
        expect(saved.template.name).toBe('First update')
        expect(saved.template.version).toBe(2)
        expect(saved.creation).toEqual(templateInput())
        await expect(store.templates!.save(scope, template({ version: 4 }), 2)).rejects.toBeInstanceOf(TemplateConflictError)
        await expect(store.templates!.save(otherWorkspace, template({ version: 2 }), 1)).rejects.toBeInstanceOf(TemplateConflictError)
        expect(await store.templates!.get(scope, templateId)).toEqual(saved)
    })

    it('rejects invalid current and original sections before publication and requires trusted scope', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const invalid = template()
        invalid.creation.tasks[2]!.goal = ''
        await expect(store.templates!.save(scope, invalid)).rejects.toThrow()
        await expect(store.templates!.save(scope, { ...template(), secret: 'unexpected' } as StoredProjectTemplate)).rejects.toThrow()
        expect(await store.templates!.list(scope)).toEqual([])
        const invalidScope = { ...scope, userId: '' }
        await expect(store.templates!.save(invalidScope, template())).rejects.toThrow('trusted userId and workspaceId')
        await expect(store.templates!.get(invalidScope, templateId)).rejects.toThrow('trusted userId and workspaceId')
        await expect(store.templates!.list(invalidScope)).rejects.toThrow('trusted userId and workspaceId')
        await expect(store.templates!.getLaunch(invalidScope, requestId)).rejects.toThrow('trusted userId and workspaceId')
    })

    it('publishes one complete batch with copies and clears templates and launch actions with the parent lifecycle', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        await store.templates!.save(scope, template())
        const initial = batch()
        const results = await Promise.allSettled([
            store.instantiateTemplateProject!(scope, initial),
            store.instantiateTemplateProject!(scope, batch()),
        ])
        expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
        initial.tasks[0]!.agent.systemPrompt = 'Mutated input'
        initial.launch.taskIds.reverse()
        initial.project.project.name = 'Mutated input'
        expect(await store.projects!.get(scope, requestId)).toEqual(batch().project)
        expect(await store.get(scope, taskIds[0]!)).toEqual(batch().tasks[0])
        expect(await store.list(scope)).toHaveLength(3)
        const launch = (await store.templates!.getLaunch(scope, requestId))!
        expect(launch).toEqual(batch().launch)
        launch.taskIds.reverse()
        expect(await store.templates!.getLaunch(scope, requestId)).toEqual(batch().launch)
        expect(await store.templates!.getLaunch(otherUser, requestId)).toBeUndefined()
        expect(await store.templates!.getLaunch(otherWorkspace, requestId)).toBeUndefined()
        await expect(store.instantiateTemplateProject!(scope, batch())).rejects.toBeInstanceOf(TemplateConflictError)
        await store.close()
        expect(await store.templates!.list(scope)).toEqual([])
        expect(await store.projects!.list(scope)).toEqual([])
        expect(await store.list(scope)).toEqual([])
        expect(await store.templates!.getLaunch(scope, requestId)).toBeUndefined()
    })

    it('leaves no partial project, earlier tasks, or launch when a later item is invalid or collides', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        await store.templates!.save(scope, template())
        const malformed = batch()
        malformed.tasks[2]!.task.goal = ''
        await expect(store.instantiateTemplateProject!(scope, malformed)).rejects.toThrow()
        expect(await store.projects!.list(scope)).toEqual([])
        expect(await store.list(scope)).toEqual([])
        expect(await store.templates!.getLaunch(scope, requestId)).toBeUndefined()

        const existing = task(taskIds[2]!, 2, secondRequestId)
        await store.save(scope, existing)
        await expect(store.instantiateTemplateProject!(scope, batch())).rejects.toBeInstanceOf(TemplateConflictError)
        expect(await store.projects!.list(scope)).toEqual([])
        expect(await store.get(scope, taskIds[0]!)).toBeUndefined()
        expect(await store.get(scope, taskIds[1]!)).toBeUndefined()
        expect(await store.get(scope, taskIds[2]!)).toEqual(existing)
        expect(await store.templates!.getLaunch(scope, requestId)).toBeUndefined()
    })

    it('rejects stale or foreign template versions and inconsistent relationships without changing records', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        await store.templates!.save(scope, template())
        await expect(store.instantiateTemplateProject!(otherUser, batch())).rejects.toBeInstanceOf(TemplateConflictError)
        await expect(store.instantiateTemplateProject!(otherWorkspace, batch())).rejects.toBeInstanceOf(TemplateConflictError)
        const inconsistent = batch()
        inconsistent.tasks[1]!.task.creationProjectId = secondRequestId
        await expect(store.instantiateTemplateProject!(scope, inconsistent)).rejects.toThrow('one complete unstarted project')
        await store.templates!.save(scope, template({ version: 2 }), 1)
        await expect(store.instantiateTemplateProject!(scope, batch())).rejects.toBeInstanceOf(TemplateConflictError)
        expect(await store.projects!.list(scope)).toEqual([])
        expect(await store.list(scope)).toEqual([])
        expect(await store.templates!.getLaunch(scope, requestId)).toBeUndefined()
    })

    it('can retry the same launch after a later validation failure and publishes exactly one complete result', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        await store.templates!.save(scope, template())
        const invalid = batch()
        invalid.tasks[2]!.task.goal = ''
        await expect(store.instantiateTemplateProject!(scope, invalid)).rejects.toThrow()
        await store.instantiateTemplateProject!(scope, batch())
        expect(await store.projects!.list(scope)).toEqual([batch().project])
        expect(await store.list(scope)).toEqual(batch().tasks)
        expect(await store.templates!.getLaunch(scope, requestId)).toEqual(batch().launch)
    })
})

describe('PostgreSQL template persistence', () => {
    it('shares one pool, scopes every read, and restores current, creation, and launch records', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/templates' })
        stores.push(store)
        expect(database.poolCount).toBe(1)
        expect(database.query.mock.calls.map(call => call[0]).join('\n')).toContain('harness_template_launches')
        database.query.mockClear().mockResolvedValue({ rows: [{ data: template() }] })
        expect(await store.templates!.list(scope)).toEqual([template()])
        expect(await store.templates!.get(scope, templateId)).toEqual(template())
        database.query.mockResolvedValueOnce({ rows: [{ data: batch().launch }] })
        expect(await store.templates!.getLaunch(scope, requestId)).toEqual(batch().launch)
        expect(database.query.mock.calls[0]![0]).toContain("ORDER BY data->'template'->>'updatedAt' DESC, id ASC")
        expect(database.query.mock.calls[0]![1]).toEqual([scope.workspaceId, scope.userId])
        for (const [index, id] of [
            [1, templateId],
            [2, requestId],
        ] as const) {
            expect(database.query.mock.calls[index]![0]).toContain('WHERE workspace_id = $1 AND user_id = $2 AND id = $3')
            expect(database.query.mock.calls[index]![1]).toEqual([scope.workspaceId, scope.userId, id])
        }
    })

    it('inserts without overwrite and compare-and-swaps the scoped version while preserving original creation input', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/templates' })
        stores.push(store)
        database.query.mockClear()
        await store.templates!.save(scope, template())
        expect(database.query.mock.calls[0]![0]).not.toContain('ON CONFLICT')
        expect(database.query.mock.calls[0]![1].slice(0, 3)).toEqual([scope.workspaceId, scope.userId, templateId])
        database.query.mockResolvedValueOnce({ rows: [{ id: templateId }] })
        await store.templates!.save(scope, template({ version: 2, name: 'Updated' }), 1)
        const [sql, parameters] = database.query.mock.calls[1]!
        expect(sql).toContain("jsonb_set($4::jsonb, '{creation}', data->'creation')")
        expect(sql).toContain("AND (data->'template'->>'version')::integer = $5")
        expect(parameters.slice(0, 3)).toEqual([scope.workspaceId, scope.userId, templateId])
        expect(parameters[4]).toBe(1)
        await expect(store.templates!.save(scope, template({ version: 2 }), 1)).rejects.toBeInstanceOf(TemplateConflictError)
        database.query.mockRejectedValueOnce(Object.assign(new Error('Unique key conflict'), { code: '23505' }))
        await expect(store.templates!.save(scope, template())).rejects.toBeInstanceOf(TemplateConflictError)
    })

    it('rejects malformed persisted template and launch data and validates input before querying', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/templates' })
        stores.push(store)
        const invalid = template()
        invalid.creation.tasks[1]!.goal = ''
        database.query.mockResolvedValueOnce({ rows: [{ data: invalid }] })
        await expect(store.templates!.get(scope, templateId)).rejects.toThrow()
        database.query.mockResolvedValueOnce({ rows: [{ data: { ...batch().launch, taskIds: [taskIds[0], taskIds[0]] } }] })
        await expect(store.templates!.getLaunch(scope, requestId)).rejects.toThrow('must be unique')
        database.query.mockClear()
        await expect(store.templates!.save(scope, invalid)).rejects.toThrow()
        await expect(store.templates!.save({ ...scope, userId: '' }, template())).rejects.toThrow()
        expect(database.query).not.toHaveBeenCalled()
    })

    it('holds the scoped template version and writes project, ordered tasks, and launch on one transaction client', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/templates' })
        stores.push(store)
        transactionTemplate()
        database.query.mockClear()
        const initial = batch()
        await store.instantiateTemplateProject!(scope, initial)
        expect(database.connect).toHaveBeenCalledOnce()
        expect(database.query).not.toHaveBeenCalled()
        const calls = database.clientQuery.mock.calls
        expect(calls[0]![0]).toBe('BEGIN')
        expect(calls[1]![0]).toContain('WHERE workspace_id = $1 AND user_id = $2 AND id = $3 FOR SHARE')
        expect(calls[1]![1]).toEqual([scope.workspaceId, scope.userId, templateId])
        expect(calls[2]![0]).toContain('INSERT INTO harness_personal_projects')
        expect(JSON.parse(calls[2]![1][3])).toEqual(initial.project)
        for (let index = 0; index < initial.tasks.length; index += 1) {
            const [sql, parameters] = calls[index + 3]!
            expect(sql).toContain('INSERT INTO harness_chat_conversations')
            expect(sql).not.toContain('ON CONFLICT')
            expect(parameters.slice(0, 3)).toEqual([scope.workspaceId, scope.userId, initial.tasks[index]!.id])
            expect(JSON.parse(parameters[8])).toEqual(initial.tasks[index]!.agent)
            expect(JSON.parse(parameters[9])).toEqual(initial.tasks[index]!.task)
        }
        expect(calls[6]![0]).toContain('INSERT INTO harness_template_launches')
        expect(JSON.parse(calls[6]![1][3])).toEqual(initial.launch)
        expect(calls[7]![0]).toBe('COMMIT')
        expect(calls.some(call => String(call[0]).includes('ON CONFLICT'))).toBe(false)
        expect(database.release).toHaveBeenCalledOnce()
    })

    it('rolls back after a later task write fails and does not write a successful launch or commit', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/templates' })
        stores.push(store)
        const failure = new Error('Second task write failed')
        database.clientQuery.mockImplementation(async (sql: string, parameters?: unknown[]) => {
            if (sql.includes('FOR SHARE')) return { rows: [{ data: template() }] }
            if (sql.includes('harness_chat_conversations') && parameters?.[2] === taskIds[1]) throw failure
            return { rows: [] }
        })
        await expect(store.instantiateTemplateProject!(scope, batch())).rejects.toBe(failure)
        const statements = database.clientQuery.mock.calls.map(call => String(call[0]))
        expect(statements.filter(sql => sql.includes('INSERT INTO harness_chat_conversations'))).toHaveLength(2)
        expect(statements.some(sql => sql.includes('INSERT INTO harness_personal_projects'))).toBe(true)
        expect(statements.some(sql => sql.includes('INSERT INTO harness_template_launches'))).toBe(false)
        expect(statements).not.toContain('COMMIT')
        expect(statements.at(-1)).toBe('ROLLBACK')
        expect(database.release).toHaveBeenCalledOnce()
    })

    it('rejects stale locked versions before writing, maps unique conflicts, and always releases its client', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/templates' })
        stores.push(store)
        transactionTemplate(template({ version: 2 }))
        await expect(store.instantiateTemplateProject!(scope, batch())).rejects.toBeInstanceOf(TemplateConflictError)
        expect(database.clientQuery.mock.calls.map(call => call[0])).toHaveLength(3)
        expect(database.clientQuery.mock.calls.at(-1)![0]).toBe('ROLLBACK')
        database.clientQuery.mockClear()
        transactionTemplate()
        database.clientQuery.mockImplementationOnce(async () => ({ rows: [] }))
        database.clientQuery.mockImplementationOnce(async () => ({ rows: [{ data: template() }] }))
        database.clientQuery.mockRejectedValueOnce(Object.assign(new Error('Existing project id'), { code: '23505' }))
        await expect(store.instantiateTemplateProject!(scope, batch())).rejects.toBeInstanceOf(TemplateConflictError)
        expect(database.clientQuery.mock.calls.at(-1)![0]).toBe('ROLLBACK')
        expect(database.release).toHaveBeenCalledTimes(2)
    })

    it('retains the original commit failure if rollback also fails and still releases the client', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/templates' })
        stores.push(store)
        const failure = new Error('Commit failed')
        database.clientQuery.mockImplementation(async (sql: string) => {
            if (sql === 'COMMIT') throw failure
            if (sql === 'ROLLBACK') throw new Error('Connection closed')
            return { rows: sql.includes('FOR SHARE') ? [{ data: template() }] : [] }
        })
        await expect(store.instantiateTemplateProject!(scope, batch())).rejects.toBe(failure)
        expect(database.clientQuery.mock.calls.at(-1)![0]).toBe('ROLLBACK')
        expect(database.release).toHaveBeenCalledOnce()
    })

    it('does not acquire a transaction client for an invalid later task or missing ownership', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/templates' })
        stores.push(store)
        const invalid = batch()
        invalid.tasks[2]!.task.goal = ''
        await expect(store.instantiateTemplateProject!(scope, invalid)).rejects.toThrow()
        await expect(store.instantiateTemplateProject!({ ...scope, workspaceId: '' }, batch())).rejects.toThrow()
        expect(database.connect).not.toHaveBeenCalled()
        expect(database.clientQuery).not.toHaveBeenCalled()
    })
})
