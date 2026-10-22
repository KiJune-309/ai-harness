import type { ChatConversation, PersonalTask } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryChatStore, createChatStore, type ChatStore } from '../src/index.js'

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }))

vi.mock('pg', () => ({
    default: {
        Pool: class {
            on = vi.fn()
            query = database.query
            end = database.end
            /**
             * Supplies one shared transaction client for serialized schema initialization.
             * @returns A client using the mock pool transport.
             */
            async connect() {
                return { query: database.query, release: vi.fn() }
            }
        },
    },
}))

const scope = { userId: 'task-owner', workspaceId: 'task-workspace' }
const otherUser = { ...scope, userId: 'another-owner' }
const otherWorkspace = { ...scope, workspaceId: 'another-workspace' }
const stores: ChatStore[] = []

/**
 * Creates a full task snapshot with its fixed agent and recorded goal message.
 * @param changes - Complete snapshot fields replaced by the test.
 * @returns An independent task accepted by the public conversation schema.
 */
function task(changes: Partial<PersonalTask> = {}): PersonalTask {
    return {
        id: 'ab181238-880b-442d-aa16-b9d5e5c6bebf',
        title: 'Compare the proposals',
        createdAt: '2026-10-17T03:00:00.000Z',
        updatedAt: '2026-10-17T03:01:00.000Z',
        agentId: 'e4ad35ef-dde9-4d57-9769-508ec147b61b',
        agent: {
            id: 'e4ad35ef-dde9-4d57-9769-508ec147b61b',
            name: 'Research assistant',
            description: 'Compare the provided evidence.',
            modelId: 'deepseek-flash',
            systemPrompt: 'Use the selected tools and summarize evidence.',
            toolIds: ['calculator'],
            openingMessages: ['What shall we investigate?'],
            createdAt: '2026-10-17T02:00:00.000Z',
            updatedAt: '2026-10-17T02:00:00.000Z',
        },
        task: {
            goal: 'Compare the costs and explain the tradeoffs.',
            status: 'in-progress',
            started: true,
            sourceAgentId: 'e4ad35ef-dde9-4d57-9769-508ec147b61b',
        },
        messages: [
            {
                id: '0ba66c5c-0bdb-42ed-8ada-fbe1206bdc2e',
                role: 'user',
                content: 'Compare the costs and explain the tradeoffs.',
                status: 'complete',
                createdAt: '2026-10-17T03:00:01.000Z',
                requestId: '1f455f48-8703-48f8-bc35-f45e5e2b53b9',
            },
        ],
        ...changes,
    }
}

/**
 * Maps one fixture to the PostgreSQL driver's column names.
 * @param snapshot - Full conversation snapshot being restored.
 * @returns A row with independently nullable task and agent JSON values.
 */
function row(snapshot: ChatConversation) {
    return {
        id: snapshot.id,
        title: snapshot.title,
        created_at: new Date(snapshot.createdAt),
        updated_at: snapshot.updatedAt,
        messages: snapshot.messages,
        active_request_id: snapshot.activeRequestId ?? null,
        agent_definition: snapshot.agent ?? null,
        task_data: snapshot.task ?? null,
    }
}

beforeEach(() => {
    database.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 })
    database.end.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close()))
})

describe('memory task snapshots', () => {
    it('preserves current and original project identifiers independently while keeping legacy ungrouped tasks valid', async () => {
        const store = await createMemoryChatStore()
        stores.push(store)
        const original = task()
        await store.save(scope, original)
        expect((await store.get(scope, original.id))?.task).toEqual(original.task)
        const creationProjectId = '61a36fee-27c7-49dc-8d7a-81953597b0dd'
        const projectId = '31c10861-df45-45ac-bf01-44298212afdc'
        const moved = task({ task: { ...original.task, projectId, creationProjectId } })
        await store.save(scope, moved)
        expect(await store.get(scope, original.id)).toEqual(moved)
        const removed = task({ task: { ...original.task, creationProjectId } })
        await store.save(scope, removed)
        expect(await store.get(scope, original.id)).toEqual(removed)
        await expect(store.save(scope, task({ task: { ...original.task, projectId: 'invalid' } }))).rejects.toThrow()
        expect(await store.get(scope, original.id)).toEqual(removed)
    })
    it('roundtrips task, agent, and messages together without leaking ownership or mutable references', async () => {
        const store = await createMemoryChatStore()
        stores.push(store)
        const original = task()
        await store.save(scope, original)
        original.task.goal = 'Changed after save'
        original.agent.systemPrompt = 'Changed after save'
        original.messages.length = 0

        expect(await store.get(scope, original.id)).toEqual(task())
        expect(await store.get(otherUser, original.id)).toBeUndefined()
        expect(await store.get(otherWorkspace, original.id)).toBeUndefined()
        expect(await store.list(otherUser)).toEqual([])
        expect(await store.list(otherWorkspace)).toEqual([])
        const listed = await store.list(scope)
        listed[0]!.task!.status = 'completed'
        expect((await store.get(scope, original.id))?.task?.status).toBe('in-progress')
    })

    it('replaces a complete task atomically and preserves its previous snapshot on validation failure', async () => {
        const store = await createMemoryChatStore()
        stores.push(store)
        const original = task()
        await store.save(scope, original)
        const completed = task({
            task: { ...original.task, status: 'completed', previousStatus: 'needs-input' },
            messages: [...original.messages, { ...original.messages[0]!, id: 'answer', role: 'assistant', content: 'Recorded result' }],
            updatedAt: '2026-10-17T03:02:00.000Z',
        })
        await store.save(scope, completed)
        expect(await store.get(scope, completed.id)).toEqual(completed)

        await expect(store.save(scope, task({ task: { ...original.task, goal: '' }, messages: [] }))).rejects.toThrow()
        expect(await store.get(scope, completed.id)).toEqual(completed)
        await store.close()
        expect(await store.list(scope)).toEqual([])
    })

    it('rejects task snapshots without frozen agents before replacing the original record', async () => {
        const store = await createMemoryChatStore()
        stores.push(store)
        const original = task()
        await store.save(scope, original)
        const missingAgent: ChatConversation = { ...original, agent: undefined, messages: [] }
        delete missingAgent.agent
        await expect(store.save(scope, missingAgent)).rejects.toThrow()
        expect(await store.get(scope, original.id)).toEqual(original)
        expect(await store.list(scope)).toEqual([original])
    })
})

describe('PostgreSQL task mapping', () => {
    it('roundtrips current and initial task membership in the same task_data snapshot', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/tasks' })
        stores.push(store)
        const snapshot = task({
            task: {
                ...task().task,
                projectId: '31c10861-df45-45ac-bf01-44298212afdc',
                creationProjectId: '61a36fee-27c7-49dc-8d7a-81953597b0dd',
            },
        })
        database.query.mockClear()
        await store.save(scope, snapshot)
        expect(JSON.parse(database.query.mock.calls[0]![1][9])).toEqual(snapshot.task)
        database.query.mockResolvedValueOnce({ rows: [row(snapshot)] })
        expect(await store.get(scope, snapshot.id)).toEqual(snapshot)
    })
    it('uses one scoped parameterized write for metadata, agent snapshot, and messages', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/tasks' })
        stores.push(store)
        const snapshot = task({ task: { ...task().task, status: 'completed', previousStatus: 'needs-input' } })
        database.query.mockClear()
        await store.save(scope, snapshot)
        expect(database.query).toHaveBeenCalledOnce()
        const [sql, parameters] = database.query.mock.calls[0]!
        expect(sql).toContain('ON CONFLICT (workspace_id, user_id, id) DO UPDATE SET')
        expect(sql).toContain('messages = EXCLUDED.messages')
        expect(sql).toContain('agent_definition = EXCLUDED.agent_definition')
        expect(sql).toContain('task_data = EXCLUDED.task_data')
        expect(sql).not.toContain(snapshot.task.goal)
        expect(parameters.slice(0, 3)).toEqual([scope.workspaceId, scope.userId, snapshot.id])
        expect(JSON.parse(parameters[6])).toEqual(snapshot.messages)
        expect(JSON.parse(parameters[8])).toEqual(snapshot.agent)
        expect(JSON.parse(parameters[9])).toEqual(snapshot.task)
    })

    it('restores the complete task through list and get while retaining both ownership predicates', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/tasks' })
        stores.push(store)
        const expected = task({ activeRequestId: '1f455f48-8703-48f8-bc35-f45e5e2b53b9' })
        database.query.mockClear().mockResolvedValue({ rows: [row(expected)] })
        expect(await store.list(scope)).toEqual([expected])
        expect(await store.get(scope, expected.id)).toEqual(expected)
        expect(database.query.mock.calls[0]![0]).toContain('agent_definition, task_data')
        expect(database.query.mock.calls[0]![0]).toContain('WHERE workspace_id = $1 AND user_id = $2')
        expect(database.query.mock.calls[0]![1]).toEqual([scope.workspaceId, scope.userId])
        expect(database.query.mock.calls[1]![0]).toContain('WHERE workspace_id = $1 AND user_id = $2 AND id = $3')
        expect(database.query.mock.calls[1]![1]).toEqual([scope.workspaceId, scope.userId, expected.id])
    })

    it('keeps legacy conversations compatible with null task data and rejects invalid persisted metadata', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/tasks' })
        stores.push(store)
        const legacy: ChatConversation = { ...task(), task: undefined }
        delete legacy.task
        database.query.mockResolvedValueOnce({ rows: [row(legacy)] })
        expect(await store.get(scope, legacy.id)).toEqual(legacy)

        database.query.mockResolvedValueOnce({ rows: [{ ...row(task()), task_data: { ...task().task, status: 'unknown' } }] })
        await expect(store.list(scope)).rejects.toThrow()
        database.query.mockClear()
        await expect(store.save(scope, task({ task: { ...task().task, goal: '' } }))).rejects.toThrow()
        expect(database.query).not.toHaveBeenCalled()
    })

    it('rejects missing task agents before writes and when restoring damaged task rows', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/tasks' })
        stores.push(store)
        const missingAgent: ChatConversation = { ...task(), agent: undefined }
        delete missingAgent.agent
        database.query.mockClear()
        await expect(store.save(scope, missingAgent)).rejects.toThrow()
        expect(database.query).not.toHaveBeenCalled()

        database.query.mockResolvedValue({ rows: [row(missingAgent)] })
        await expect(store.get(scope, missingAgent.id)).rejects.toThrow()
        await expect(store.list(scope)).rejects.toThrow()
    })
})
