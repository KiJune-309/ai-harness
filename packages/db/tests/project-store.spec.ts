import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatStore, type ChatStore, type StoredProject } from '../src/index.js'

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), poolCount: 0 }))

vi.mock('pg', () => ({
    default: {
        Pool: class {
            /**
             * Counts pools to verify that projects share the parent lifecycle.
             */
            constructor() {
                database.poolCount += 1
            }
            query = database.query
            end = database.end
        },
    },
}))

const scope = { userId: 'project-owner', workspaceId: 'project-workspace' }
const otherUser = { ...scope, userId: 'other-owner' }
const otherWorkspace = { ...scope, workspaceId: 'other-workspace' }
const stores: ChatStore[] = []

/**
 * Creates an edited project with separate original creation parameters.
 * @param changes - Current project fields to replace for the scenario.
 * @returns A complete internal project record accepted by storage.
 */
function project(changes: Partial<StoredProject['project']> = {}): StoredProject {
    return {
        project: {
            id: 'a260b1a3-3394-454a-bc70-497065950d2e',
            name: 'Edited research project',
            description: 'Current project description',
            createdAt: '2026-10-17T01:00:00.000Z',
            updatedAt: '2026-10-17T02:00:00.000Z',
            ...changes,
        },
        creation: { name: 'Original research project', description: 'Original project description' },
    }
}

beforeEach(() => {
    database.query.mockReset().mockResolvedValue({ rows: [] })
    database.end.mockReset().mockResolvedValue(undefined)
    database.poolCount = 0
})

afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close()))
})

describe('memory project records', () => {
    it('isolates both ownership fields and allows duplicate names and independent scoped identifiers', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const first = project()
        const second = project({ id: '6155f4d2-81c1-4aef-a6ad-14bbfa5b2409', updatedAt: '2026-10-17T03:00:00.000Z' })
        await store.projects!.save(scope, first)
        await store.projects!.save(scope, second)
        expect(await store.projects!.get(otherUser, first.project.id)).toBeUndefined()
        expect(await store.projects!.get(otherWorkspace, first.project.id)).toBeUndefined()
        expect(await store.projects!.list(otherUser)).toEqual([])
        expect(await store.projects!.list(otherWorkspace)).toEqual([])
        expect(await store.projects!.list(scope)).toEqual([second, first])

        const other = project({ name: 'Another owner project' })
        await store.projects!.save(otherUser, other)
        expect(await store.projects!.get(otherUser, first.project.id)).toEqual(other)
        expect(await store.projects!.get(scope, first.project.id)).toEqual(first)
    })

    it('preserves independent current and creation snapshots and clears projects with the parent store', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const input = project()
        await store.projects!.save(scope, input)
        input.project.name = 'Mutated current input'
        input.creation.name = 'Mutated original input'
        const result = (await store.projects!.get(scope, input.project.id))!
        expect(result).toEqual(project())
        result.project.name = 'Mutated read'
        result.creation.description = 'Mutated original read'
        const listed = await store.projects!.list(scope)
        listed[0]!.creation.name = 'Mutated list'
        expect(await store.projects!.get(scope, input.project.id)).toEqual(project())
        await store.close()
        expect(await store.projects!.list(scope)).toEqual([])
        expect(await store.projects!.get(scope, input.project.id)).toBeUndefined()
    })

    it('rejects invalid or unknown current and creation data without replacing the last saved record', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const saved = project()
        await store.projects!.save(scope, saved)
        const invalidRecords = [
            { ...saved, project: { ...saved.project, name: ' ' } },
            { ...saved, project: { ...saved.project, secret: 'unexpected' } },
            { ...saved, creation: { ...saved.creation, name: '' } },
            { ...saved, creation: { ...saved.creation, requestId: saved.project.id } },
            { ...saved, secret: 'unexpected' },
        ]
        for (const record of invalidRecords) {
            await expect(store.projects!.save(scope, record)).rejects.toThrow()
            expect(await store.projects!.get(scope, saved.project.id)).toEqual(saved)
        }
    })

    it('requires complete trusted ownership before project reads and writes', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        for (const invalidScope of [
            { userId: '', workspaceId: scope.workspaceId },
            { ...scope, workspaceId: ' ' },
        ]) {
            await expect(store.projects!.list(invalidScope)).rejects.toThrow('trusted userId and workspaceId')
            await expect(store.projects!.get(invalidScope, project().project.id)).rejects.toThrow('trusted userId and workspaceId')
            await expect(store.projects!.save(invalidScope, project())).rejects.toThrow('trusted userId and workspaceId')
        }
    })
})

describe('PostgreSQL project records', () => {
    it('shares one initialized pool and stores current and original data in a single scoped statement', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/projects' })
        stores.push(store)
        expect(database.poolCount).toBe(1)
        const initializeSql = database.query.mock.calls.map(call => call[0]).join('\n')
        expect(initializeSql).toContain('CREATE TABLE IF NOT EXISTS harness_personal_projects')
        expect(initializeSql).toContain('PRIMARY KEY (workspace_id, user_id, id)')
        database.query.mockClear()
        const record = project({ name: "Project'); DROP TABLE projects; --" })
        await store.projects!.save(scope, record)
        expect(database.query).toHaveBeenCalledOnce()
        const [sql, parameters] = database.query.mock.calls[0]!
        expect(sql).toContain('ON CONFLICT (workspace_id, user_id, id) DO UPDATE SET data = EXCLUDED.data')
        expect(sql).not.toContain(record.project.name)
        expect(parameters.slice(0, 3)).toEqual([scope.workspaceId, scope.userId, record.project.id])
        expect(JSON.parse(parameters[3])).toEqual(record)
    })

    it('validates and restores both sections while parameterizing both ownership predicates', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/projects' })
        stores.push(store)
        const record = project()
        database.query.mockClear().mockResolvedValue({ rows: [{ data: record }] })
        expect(await store.projects!.list(scope)).toEqual([record])
        expect(await store.projects!.get(scope, record.project.id)).toEqual(record)
        const [listSql, listParameters] = database.query.mock.calls[0]!
        const [getSql, getParameters] = database.query.mock.calls[1]!
        expect(listSql).toContain('WHERE workspace_id = $1 AND user_id = $2')
        expect(listSql).toContain("ORDER BY data->'project'->>'updatedAt' DESC, id ASC")
        expect(listParameters).toEqual([scope.workspaceId, scope.userId])
        expect(getSql).toContain('WHERE workspace_id = $1 AND user_id = $2 AND id = $3')
        expect(getParameters).toEqual([scope.workspaceId, scope.userId, record.project.id])
        database.query.mockResolvedValueOnce({ rows: [] })
        expect(await store.projects!.get(scope, record.project.id)).toBeUndefined()
    })

    it('rejects corrupt original creation parameters and malformed current projects on reads and writes', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/projects' })
        stores.push(store)
        const invalidRecords = [
            { ...project(), project: { ...project().project, id: 'invalid' } },
            { ...project(), creation: { ...project().creation, description: 'x'.repeat(2001) } },
            { ...project(), creation: { ...project().creation, unexpected: true } },
            { project: project().project },
        ]
        for (const record of invalidRecords) {
            database.query.mockClear().mockResolvedValue({ rows: [{ data: record }] })
            await expect(store.projects!.get(scope, project().project.id)).rejects.toThrow()
            await expect(store.projects!.list(scope)).rejects.toThrow()
            database.query.mockClear()
            await expect(store.projects!.save(scope, record as StoredProject)).rejects.toThrow()
            expect(database.query).not.toHaveBeenCalled()
        }
    })

    it('requires ownership before querying and propagates storage failures without false success', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/projects' })
        stores.push(store)
        database.query.mockClear()
        const invalidScope = { ...scope, userId: '' }
        await expect(store.projects!.get(invalidScope, project().project.id)).rejects.toThrow()
        await expect(store.projects!.list(invalidScope)).rejects.toThrow()
        await expect(store.projects!.save(invalidScope, project())).rejects.toThrow()
        expect(database.query).not.toHaveBeenCalled()

        database.query.mockRejectedValue(new Error('Database temporarily unavailable'))
        await expect(store.projects!.get(scope, project().project.id)).rejects.toThrow('Database temporarily unavailable')
        await expect(store.projects!.list(scope)).rejects.toThrow('Database temporarily unavailable')
        await expect(store.projects!.save(scope, project())).rejects.toThrow('Database temporarily unavailable')
    })
})
