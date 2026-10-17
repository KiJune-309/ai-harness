import type { AgentDefinition, ChatConversation } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatStore, type ChatStore } from '../src/index.js'

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), configurations: [] as unknown[] }))

vi.mock('pg', () => ({
    default: {
        Pool: class {
            /**
             * Record connection settings while replacing network persistence in tests.
             * @param configuration - Application pool settings.
             */
            constructor(configuration: unknown) {
                database.configurations.push(configuration)
            }
            query = database.query
            end = database.end
        },
    },
}))

const scope = { userId: 'user-one', workspaceId: 'workspace-one' }
const otherUser = { ...scope, userId: 'user-two' }
const otherWorkspace = { ...scope, workspaceId: 'workspace-two' }
const stores: ChatStore[] = []

/**
 * Build a complete agent definition fixture accepted by public contracts.
 * @param changes - Fields overridden by a test case.
 * @returns An independent agent configuration with stable identity and timestamps.
 */
function agent(changes: Partial<AgentDefinition> = {}): AgentDefinition {
    return {
        id: 'b4dd9b15-83e2-4a3d-87c8-046fcdbe8fa7',
        name: '数学助手',
        description: '帮助完成计算。',
        modelId: 'deepseek-chat',
        systemPrompt: 'Use the configured tools.',
        toolIds: ['calculator'],
        openingMessages: ['你好，需要计算什么？'],
        createdAt: '2026-10-17T02:00:00.000Z',
        updatedAt: '2026-10-17T02:01:00.000Z',
        ...changes,
    }
}

/**
 * Build a conversation containing the immutable configuration chosen at creation.
 * @param definition - Agent snapshot assigned to the conversation.
 * @returns A complete persisted conversation fixture.
 */
function conversation(definition: AgentDefinition): ChatConversation {
    return {
        id: 'f91ad878-3c69-4f20-8c14-5bdf0f743ab4',
        title: '数学讨论',
        createdAt: definition.createdAt,
        updatedAt: definition.updatedAt,
        messages: [],
        agentId: definition.id,
        agent: definition,
    }
}

beforeEach(() => {
    database.query.mockReset().mockResolvedValue({ rows: [] })
    database.end.mockReset().mockResolvedValue(undefined)
    database.configurations.length = 0
})

afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close()))
})

describe('scoped memory agent persistence', () => {
    it('roundtrips independent definitions and filters both ownership dimensions', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const original = agent()
        await store.agents!.save(scope, original)
        original.openingMessages[0] = 'Mutated after save'
        original.toolIds.length = 0

        expect(await store.agents!.get(otherUser, original.id)).toBeUndefined()
        expect(await store.agents!.get(otherWorkspace, original.id)).toBeUndefined()
        expect(await store.agents!.list(otherUser)).toEqual([])
        expect(await store.agents!.list(otherWorkspace)).toEqual([])
        const loaded = (await store.agents!.get(scope, original.id))!
        expect(loaded).toEqual(agent())
        loaded.openingMessages.length = 0
        const listed = await store.agents!.list(scope)
        listed[0]!.toolIds.length = 0
        expect(await store.agents!.get(scope, original.id)).toEqual(agent())

        await store.agents!.save(otherUser, agent({ name: 'Other user' }))
        await store.agents!.save(otherWorkspace, agent({ name: 'Other workspace' }))
        expect((await store.agents!.get(scope, original.id))!.name).toBe('数学助手')
        expect((await store.agents!.get(otherUser, original.id))!.name).toBe('Other user')
        expect((await store.agents!.get(otherWorkspace, original.id))!.name).toBe('Other workspace')
    })

    it('updates configurations, sorts by activity, and closes with the parent store', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        await store.agents!.save(scope, agent())
        await store.agents!.save(scope, agent({ name: 'Updated', toolIds: [], updatedAt: '2026-10-17T02:02:00.000Z' }))
        await store.agents!.save(scope, agent({ id: '059e8d56-193e-4a18-b530-39e345869418', name: 'Older' }))
        expect((await store.agents!.list(scope)).map(item => item.name)).toEqual(['Updated', 'Older'])
        expect((await store.agents!.get(scope, agent().id))!.toolIds).toEqual([])
        await store.close()
        expect(await store.agents!.list(scope)).toEqual([])
    })

    it('validates ownership and agent data before storing a definition', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const missingScope = { userId: '', workspaceId: scope.workspaceId }
        await expect(store.agents!.list(missingScope)).rejects.toThrow('trusted userId and workspaceId')
        await expect(store.agents!.get(missingScope, agent().id)).rejects.toThrow('trusted userId and workspaceId')
        await expect(store.agents!.save(missingScope, agent())).rejects.toThrow('trusted userId and workspaceId')
        await expect(store.agents!.save(scope, agent({ id: 'invalid' }))).rejects.toThrow()
        await expect(store.agents!.save(scope, agent({ toolIds: ['unregistered' as 'calculator'] }))).rejects.toThrow()
        expect(await store.agents!.list(scope)).toEqual([])
    })

    it('retains the chosen conversation snapshot after the saved agent changes', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const original = agent()
        const snapshot = conversation(original)
        await store.agents!.save(scope, original)
        await store.save(scope, snapshot)
        await store.agents!.save(scope, agent({ systemPrompt: 'A replacement prompt.', toolIds: [] }))
        expect((await store.get(scope, snapshot.id))!.agent).toEqual(original)
    })
})

describe('PostgreSQL agent persistence', () => {
    it('shares the initialized conversation pool and parameterizes every ownership filter', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/agents' })
        stores.push(store)
        expect(database.configurations).toHaveLength(1)
        expect(database.query.mock.calls[4]![0]).toContain('harness_agent_definitions')
        database.query.mockClear()
        await store.agents!.list(scope)
        await store.agents!.get(scope, agent().id)
        expect(database.query.mock.calls[0]![0]).toContain('WHERE workspace_id = $1 AND user_id = $2')
        expect(database.query.mock.calls[0]![1]).toEqual([scope.workspaceId, scope.userId])
        expect(database.query.mock.calls[1]![0]).toContain('WHERE workspace_id = $1 AND user_id = $2 AND id = $3')
        expect(database.query.mock.calls[1]![1]).toEqual([scope.workspaceId, scope.userId, agent().id])
        expect(await store.agents!.get(otherUser, agent().id)).toBeUndefined()
    })

    it('validates stored JSON and parameterizes complete snapshot replacement', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/agents' })
        stores.push(store)
        const snapshot = agent({ systemPrompt: "Prompt with SQL ' character" })
        database.query.mockClear()
        await store.agents!.save(scope, snapshot)
        const [sql, parameters] = database.query.mock.calls[0]!
        expect(sql).toContain('ON CONFLICT (workspace_id, user_id, id) DO UPDATE SET data = EXCLUDED.data')
        expect(sql).not.toContain(snapshot.systemPrompt)
        expect(parameters.slice(0, 3)).toEqual([scope.workspaceId, scope.userId, snapshot.id])
        expect(JSON.parse(parameters[3])).toEqual(snapshot)
        database.query.mockResolvedValueOnce({ rows: [{ data: snapshot }] })
        expect(await store.agents!.get(scope, snapshot.id)).toEqual(snapshot)
        database.query.mockResolvedValueOnce({ rows: [{ data: { ...snapshot, id: 'invalid' } }] })
        await expect(store.agents!.list(scope)).rejects.toThrow()
    })

    it('persists the immutable conversation agent snapshot and restores its identifier', async () => {
        const store = await createChatStore({ databaseUrl: 'postgresql://test.invalid/agents' })
        stores.push(store)
        const snapshot = conversation(agent())
        database.query.mockClear()
        await store.save(scope, snapshot)
        expect(database.query.mock.calls[0]![0]).toContain('agent_definition = EXCLUDED.agent_definition')
        expect(JSON.parse(database.query.mock.calls[0]![1][8])).toEqual(snapshot.agent)
        database.query.mockResolvedValueOnce({
            rows: [
                {
                    id: snapshot.id,
                    title: snapshot.title,
                    created_at: new Date(snapshot.createdAt),
                    updated_at: snapshot.updatedAt,
                    messages: snapshot.messages,
                    active_request_id: null,
                    agent_definition: snapshot.agent,
                },
            ],
        })
        expect(await store.get(scope, snapshot.id)).toEqual(snapshot)
    })
})
