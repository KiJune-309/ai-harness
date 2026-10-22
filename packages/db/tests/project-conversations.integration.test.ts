import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { AgentDefinition, ChatConversation } from '@ai-harness/contracts'
import { describe, expect, it } from 'vitest'
import { ConversationCreationConflictError, createChatStore, type ChatScope, type ChatStore } from '../src/index.js'

/**
 * Runs ordinary project conversation checks in a schema owned solely by this test.
 * @param scenario - Real-pool checks and an explicit reopen operation for restart verification.
 * @returns After all application pools and the test schema have been closed and removed.
 * @throws Error for unavailable PostgreSQL or a failed persistence assertion.
 */
async function database(
    scenario: (context: { first: ChatStore; second: ChatStore; pool: pg.Pool; reopen: () => Promise<ChatStore> }) => Promise<void>
): Promise<void> {
    const schema = `sf021_chats_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    const stores: ChatStore[] = []
    /**
     * Opens another complete application store against the same committed isolated schema.
     * @returns A separately initialized pool tracked for cleanup.
     */
    async function reopen(): Promise<ChatStore> {
        const store = await createChatStore({ databaseUrl: url.toString() })
        stores.push(store)
        return store
    }
    try {
        const first = await reopen()
        const second = await reopen()
        await scenario({ first, second, pool, reopen })
    } finally {
        await Promise.allSettled([...stores.map(store => store.close()), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Persists an actual account authorized for its historical private workspace.
 * @param store - Initialized account repository in the isolated schema.
 * @param workspaceId - Exact historical workspace of the fixture account.
 * @returns A trusted account ownership scope.
 */
async function account(store: ChatStore, workspaceId = 'sf021-chat-home'): Promise<ChatScope> {
    const id = randomUUID()
    const now = new Date().toISOString()
    await store.accounts!.createUser({
        user: { id, username: '聊天用户', email: `${id}@example.test`, createdAt: now, updatedAt: now },
        passwordHash: 'isolated-test-verifier',
        workspaceId,
        credentialVersion: 1,
    })
    return { userId: id, workspaceId }
}

/**
 * Creates one valid frozen Agent without any provider credential or live model execution.
 * @returns A private deterministic-shape Agent snapshot.
 */
function agent(): AgentDefinition {
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        name: '原助手',
        description: '',
        modelId: 'fixture-route',
        systemPrompt: '私人系统提示词',
        toolIds: [],
        openingMessages: [],
        createdAt: now,
        updatedAt: now,
    }
}

/**
 * Creates an ordinary empty conversation snapshot with its immutable initial project.
 * @param projectFolderId - Optional owned folder, omitted for an ungrouped conversation.
 * @returns A valid ordinary conversation with a frozen private Agent.
 */
function conversation(projectFolderId?: string): ChatConversation {
    const now = new Date().toISOString()
    const selected = agent()
    return {
        id: randomUUID(),
        title: '项目内对话',
        createdAt: now,
        updatedAt: now,
        messages: [],
        agentId: selected.id,
        agent: selected,
        ...(projectFolderId ? { projectFolderId } : {}),
    }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('ordinary project conversation PostgreSQL acceptance', () => {
    it('serializes creation retries, rejects changed project or Agent parameters and returns the current saved conversation', async () => {
        await database(async ({ first, second, pool }) => {
            const scope = await account(first)
            const a = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: 'A' })
            const b = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: 'B' })
            const original = conversation(a.id)
            const input = { title: original.title, projectFolderId: a.id, agentId: original.agentId! }
            const created = await Promise.all([
                first.create!(scope, original, input),
                second.create!(scope, { ...original, updatedAt: new Date().toISOString() }, input),
            ])
            expect(created[0]).toEqual(created[1])
            expect(created[0]?.projectFolderId).toBe(a.id)
            await expect(second.create!(scope, original, { ...input, projectFolderId: b.id })).rejects.toBeInstanceOf(
                ConversationCreationConflictError
            )
            await expect(second.create!(scope, original, { ...input, agentId: randomUUID() })).rejects.toBeInstanceOf(
                ConversationCreationConflictError
            )
            const updated: ChatConversation = {
                ...created[0]!,
                title: '已有多轮历史',
                messages: [
                    { id: randomUUID(), role: 'user', content: '已保存的本人输入', status: 'complete', createdAt: original.createdAt },
                ],
            }
            await first.save(scope, updated)
            expect(await second.create!(scope, original, input)).toEqual(updated)
            const rows = await pool.query<{ project_folder_id: string; creation_input: unknown }>(
                'SELECT project_folder_id,creation_input FROM harness_chat_conversations WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                [scope.workspaceId, scope.userId, original.id]
            )
            expect(rows.rows).toEqual([{ project_folder_id: a.id, creation_input: input }])
            expect((await first.list(scope)).map(item => item.id)).toEqual([original.id])
        })
    })

    it('preserves the independent folder column across stale ordinary snapshots and versioned source writes, including a reopened store', async () => {
        await database(async ({ first, second, reopen }) => {
            const scope = await account(first)
            const a = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: 'A' })
            const b = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: 'B' })
            const original = conversation(a.id)
            const input = { title: original.title, projectFolderId: a.id, agentId: original.agentId! }
            await first.create!(scope, original, input)
            const stale = { ...original }
            delete stale.projectFolderId
            await second.save(scope, { ...stale, title: '旧快照不抹掉项目' })
            expect((await first.get(scope, original.id))?.projectFolderId).toBe(a.id)
            await second.save(scope, { ...stale, projectFolderId: b.id })
            expect((await first.get(scope, original.id))?.projectFolderId).toBe(a.id)

            const source = { kind: 'conversation' as const, id: original.id }
            const reserved = await first.collaboration!.reserveSource(scope, source, randomUUID(), 30_000)
            expect(reserved.conversation.projectFolderId).toBe(a.id)
            const versioned = { ...reserved.conversation, title: '持久来源保存后的标题' }
            delete versioned.projectFolderId
            const revision = await second.collaboration!.saveSource(scope, source, versioned, reserved.revision, reserved.token)
            expect(revision).toBe(reserved.revision + 1)
            await first.collaboration!.releaseSource(scope, source, reserved.token)
            expect((await second.get(scope, original.id))?.projectFolderId).toBe(a.id)
            expect((await second.collaboration!.loadSource(scope, source))?.conversation.projectFolderId).toBe(a.id)
            const restarted = await reopen()
            expect((await restarted.get(scope, original.id))?.projectFolderId).toBe(a.id)
            expect((await restarted.get(scope, original.id))?.title).toBe(versioned.title)
            expect((await restarted.collaboration!.loadSource(scope, source))?.conversation.projectFolderId).toBe(a.id)
            expect((await restarted.create!(scope, original, input)).title).toBe(versioned.title)
        })
    })

    it('rejects foreign, missing and revoked project scopes before creating any conversation row', async () => {
        await database(async ({ first, second, pool }) => {
            const scope = await account(first)
            const other = await account(first)
            const otherWorkspace = await account(first, 'sf021-other-home')
            const folder = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: '私人项目' })
            const original = conversation(folder.id)
            const input = { title: original.title, projectFolderId: folder.id, agentId: original.agentId! }
            for (const unauthorized of [other, otherWorkspace, { ...scope, workspaceId: 'foreign-workspace' }]) {
                await expect(second.create!(unauthorized, original, input)).rejects.toThrow()
                expect(await second.get(unauthorized, original.id)).toBeUndefined()
            }
            const missing = conversation(randomUUID())
            await expect(
                first.create!(scope, missing, { title: missing.title, projectFolderId: missing.projectFolderId! })
            ).rejects.toThrow()
            const team = await first.workspaces!.create(scope, { requestId: randomUUID(), name: '共享空间', description: '' })
            await pool.query('INSERT INTO harness_workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [
                team.id,
                other.userId,
                'member',
            ])
            const memberScope = { ...other, workspaceId: team.id }
            const memberFolder = await first.projectFolders!.create(memberScope, { requestId: randomUUID(), name: '成员的私人项目' })
            await pool.query('DELETE FROM harness_workspace_members WHERE workspace_id=$1 AND user_id=$2', [team.id, other.userId])
            const revoked = conversation(memberFolder.id)
            await expect(first.create!(memberScope, revoked, { title: revoked.title, projectFolderId: memberFolder.id })).rejects.toThrow()
            expect((await first.list(scope)).length).toBe(0)
            await first.create!(scope, original, input)
            const ungrouped = conversation()
            await first.create!(scope, ungrouped, { title: ungrouped.title, agentId: ungrouped.agentId! })
            expect((await first.get(scope, ungrouped.id))?.projectFolderId).toBeUndefined()
            expect(await first.get(other, original.id)).toBeUndefined()
            const count = await pool.query<{ count: number }>('SELECT count(*)::integer AS count FROM harness_chat_conversations')
            expect(count.rows[0]?.count).toBe(2)
        })
    })
})
