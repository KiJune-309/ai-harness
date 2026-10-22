import type { ChatConversation } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryChatStore, createChatStore, type ChatStore } from '../src/index.js'

const database = vi.hoisted(() => ({
    query: vi.fn(),
    end: vi.fn(),
    configurations: [] as unknown[],
}))

vi.mock('pg', () => ({
    default: {
        Pool: class {
            on = vi.fn()
            /**
             * Records database configuration while replacing the driver in tests.
             * @param configuration - Pool configuration provided by the application.
             */
            constructor(configuration: unknown) {
                database.configurations.push(configuration)
            }
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

const scope = { userId: 'user-one', workspaceId: 'workspace-one' }
const otherUser = { ...scope, userId: 'user-two' }
const otherWorkspace = { ...scope, workspaceId: 'workspace-two' }
const stores: ChatStore[] = []

/**
 * Creates a complete public conversation fixture.
 * @param changes - Fixture fields to replace for a test case.
 * @returns A conversation accepted by the shared public schema.
 */
function conversation(changes: Partial<ChatConversation> = {}): ChatConversation {
    return {
        id: '7daaf9a8-2ee8-4cc3-8b48-6d1766c40bac',
        title: 'DeepSeek conversation',
        createdAt: '2026-10-17T01:00:00.000Z',
        updatedAt: '2026-10-17T01:00:01.000Z',
        messages: [
            {
                id: 'a398b15d-3c4c-4328-9132-c8c12b094010',
                role: 'user',
                content: 'Hello',
                status: 'complete',
                createdAt: '2026-10-17T01:00:00.000Z',
            },
        ],
        ...changes,
    }
}

beforeEach(() => {
    database.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 })
    database.end.mockReset().mockResolvedValue(undefined)
    database.configurations.length = 0
})

afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close()))
})

describe('explicit memory chat storage', () => {
    it('requires PostgreSQL rather than an environment-selected memory fallback', async () => {
        await expect(createChatStore({})).rejects.toThrow('DATABASE_URL')
        await expect(createChatStore({ databaseUrl: '   ' })).rejects.toThrow('DATABASE_URL')
        expect(database.configurations).toHaveLength(0)
    })

    it('scopes ownership for every read and allows independent scoped identifiers', async () => {
        const store = await createMemoryChatStore()
        stores.push(store)
        const original = conversation()
        await store.save(scope, original)

        expect(await store.get(otherUser, original.id)).toBeUndefined()
        expect(await store.get(otherWorkspace, original.id)).toBeUndefined()
        expect(await store.list(otherUser)).toEqual([])
        expect(await store.list(otherWorkspace)).toEqual([])

        await store.save(otherUser, conversation({ title: 'Other user' }))
        await store.save(otherWorkspace, conversation({ title: 'Other workspace' }))
        expect((await store.get(scope, original.id))?.title).toBe(original.title)
        expect((await store.get(otherUser, original.id))?.title).toBe('Other user')
        expect((await store.get(otherWorkspace, original.id))?.title).toBe('Other workspace')
        expect(await store.list(scope)).toHaveLength(1)
    })

    it('saves independent snapshots, replaces messages, and sorts by update time', async () => {
        const store = await createMemoryChatStore()
        stores.push(store)
        const original = conversation()
        await store.save(scope, original)
        original.messages[0]!.content = 'Changed after save'

        const loaded = (await store.get(scope, original.id))!
        expect(loaded.messages[0]?.content).toBe('Hello')
        loaded.messages[0]!.content = 'Changed after read'
        const listed = await store.list(scope)
        listed[0]!.messages[0]!.content = 'Changed after list'
        expect((await store.get(scope, original.id))?.messages[0]?.content).toBe('Hello')

        await store.save(scope, conversation({ title: 'Replaced', messages: [], updatedAt: '2026-10-17T01:01:00.000Z' }))
        await store.save(scope, conversation({ id: '86670683-e688-4374-a541-e52b9533cf3d', title: 'Older' }))
        expect((await store.get(scope, original.id))?.messages).toEqual([])
        expect((await store.list(scope)).map(item => item.title)).toEqual(['Replaced', 'Older'])
    })

    it('validates scope and conversation data before storing records', async () => {
        const store = await createMemoryChatStore()
        stores.push(store)
        await expect(store.list({ userId: '', workspaceId: 'workspace-one' })).rejects.toThrow('trusted userId and workspaceId')
        await expect(store.get({ userId: 'user-one', workspaceId: ' ' }, conversation().id)).rejects.toThrow(
            'trusted userId and workspaceId'
        )
        await expect(store.save(scope, conversation({ id: 'invalid' }))).rejects.toThrow()
        expect(await store.list(scope)).toEqual([])
    })
})

describe('PostgreSQL chat storage', () => {
    it('opens one pool and initializes durable storage before returning', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/chat' })
        stores.push(store)
        expect(database.configurations).toEqual([{ connectionString: 'postgresql://test.invalid/chat', connectionTimeoutMillis: 5000 }])
        expect(database.query.mock.calls[0]?.[0]).toBe('BEGIN')
        expect(database.query.mock.calls[1]?.[0]).toContain('pg_advisory_xact_lock')
        const statements = database.query.mock.calls.slice(2, -1).map(call => String(call[0]))
        for (const name of [
            'harness_chat_conversations',
            'harness_agent_definitions',
            'harness_skills',
            'harness_skill_versions',
            'harness_skill_actions',
            'harness_personal_projects',
            'harness_project_templates',
            'harness_template_launches',
            'harness_accounts',
            'harness_account_sessions',
            'harness_account_models',
            'harness_knowledge_documents',
            'harness_knowledge_chunks',
            'harness_knowledge_retry_actions',
            'harness_embedding_models',
            'harness_embedding_create_actions',
            'harness_vector_jobs',
            'harness_vector_actions',
        ]) {
            expect(statements.some(sql => sql.includes(`CREATE TABLE IF NOT EXISTS ${name}`))).toBe(true)
        }
        expect(statements.filter(sql => sql.includes('ADD COLUMN IF NOT EXISTS'))).toEqual(
            expect.arrayContaining([
                'ALTER TABLE harness_chat_conversations ADD COLUMN IF NOT EXISTS active_request_id text',
                'ALTER TABLE harness_chat_conversations ADD COLUMN IF NOT EXISTS agent_definition jsonb',
                'ALTER TABLE harness_chat_conversations ADD COLUMN IF NOT EXISTS task_data jsonb',
                'ALTER TABLE harness_workspaces ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp()',
                'ALTER TABLE harness_workspace_invitations ADD COLUMN IF NOT EXISTS recipient_id uuid REFERENCES harness_accounts(id)',
                'ALTER TABLE harness_collaboration_sources ADD COLUMN IF NOT EXISTS request_id uuid',
            ])
        )
        expect(statements).toContain('ALTER TABLE harness_collaboration_sources ADD COLUMN IF NOT EXISTS request_id uuid')
        expect(statements.some(sql => sql.includes('harness_account_sessions_user_idx'))).toBe(true)
        expect(database.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
        expect(statements.some(sql => sql.includes('SAVEPOINT harness_optional_vector'))).toBe(true)
    })

    it('uses both trusted ownership parameters on every read', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/chat' })
        stores.push(store)
        database.query.mockClear()
        await store.list(scope)
        expect(database.query.mock.calls[0]?.[0]).toContain('WHERE workspace_id = $1 AND user_id = $2')
        expect(database.query.mock.calls[0]?.[1]).toEqual([scope.workspaceId, scope.userId])
        await store.get(scope, conversation().id)
        expect(database.query.mock.calls[1]?.[0]).toContain('WHERE workspace_id = $1 AND user_id = $2 AND id = $3')
        expect(database.query.mock.calls[1]?.[1]).toEqual([scope.workspaceId, scope.userId, conversation().id])
    })

    it('normalizes database records and preserves the active request across reloads', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/chat' })
        stores.push(store)
        const expected = conversation({ activeRequestId: 'd50eac80-b479-4cd1-a4ab-35628dbdd1e0' })
        database.query.mockResolvedValueOnce({
            rows: [
                {
                    id: expected.id,
                    title: expected.title,
                    created_at: new Date(expected.createdAt),
                    updated_at: expected.updatedAt,
                    messages: expected.messages,
                    active_request_id: expected.activeRequestId,
                },
            ],
        })
        expect(await store.get(scope, expected.id)).toEqual(expected)
    })

    it('parameterizes replacement writes and confines conflicts to the ownership tuple', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/chat' })
        stores.push(store)
        database.query.mockClear()
        const snapshot = conversation({
            title: "Title ' with SQL-looking characters",
            activeRequestId: 'd50eac80-b479-4cd1-a4ab-35628dbdd1e0',
        })
        await store.save(scope, snapshot)
        const [sql, parameters] = database.query.mock.calls[0]!
        expect(sql).toContain('ON CONFLICT (workspace_id, user_id, id) DO UPDATE SET')
        expect(sql).toContain('messages = EXCLUDED.messages')
        expect(sql).not.toContain(snapshot.title)
        expect(parameters).toEqual([
            scope.workspaceId,
            scope.userId,
            snapshot.id,
            snapshot.title,
            snapshot.createdAt,
            snapshot.updatedAt,
            JSON.stringify(snapshot.messages),
            snapshot.activeRequestId,
            null,
            null,
        ])
    })

    it('closes the pool if initialization fails and does not silently switch to memory', async () => {
        database.query.mockRejectedValueOnce(new Error('database unavailable'))
        await expect(createChatStore({ databaseUrl: 'postgresql://test.invalid/chat' })).rejects.toThrow('database unavailable')
        expect(database.end).toHaveBeenCalledOnce()
    })
})
