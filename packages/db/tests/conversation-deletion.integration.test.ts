import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { ChatConversation } from '@ai-harness/contracts'
import { createChatStore, type ChatScope, type ChatStore } from '../src/index.js'

/**
 * Runs deletion checks only in a newly created test-owned schema with independently reopened stores.
 * @param scenario - Assertions against real isolated PostgreSQL stores.
 * @returns After every pool closes and only the disposable schema is removed.
 */
async function database(scenario: (store: ChatStore, pool: pg.Pool, reopen: () => Promise<ChatStore>) => Promise<void>): Promise<void> {
    const url = new URL(process.env.TEST_DATABASE_URL!)
    const admin = new pg.Pool({ connectionString: url.toString() })
    const schema = `chat_deletion_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE SCHEMA ${schema}`)
    url.searchParams.set('options', `-c search_path=${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    const stores: ChatStore[] = []
    /**
     * Opens a separate process-equivalent application pool in the same isolated schema.
     * @returns A tracked complete persistent store.
     */
    async function reopen(): Promise<ChatStore> {
        const store = await createChatStore({ databaseUrl: url.toString() })
        stores.push(store)
        return store
    }
    try {
        await scenario(await reopen(), pool, reopen)
    } finally {
        await Promise.allSettled([...stores.map(store => store.close()), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Persists a genuine account with a known authorized historical workspace.
 * @param store - Isolated test repository.
 * @param workspaceId - Exact workspace for this account.
 * @returns A trusted owner scope accepted by the real persistence layer.
 */
async function account(store: ChatStore, workspaceId: string): Promise<ChatScope> {
    const userId = randomUUID()
    const now = new Date().toISOString()
    await store.accounts!.createUser({
        user: { id: userId, username: '删除验收用户', email: `${userId}@example.test`, createdAt: now, updatedAt: now },
        workspaceId,
        passwordHash: 'isolated-verifier',
        credentialVersion: 1,
    })
    return { userId, workspaceId }
}

/**
 * Builds a private ordinary chat with content that must disappear after deletion.
 * @returns A valid independent conversation snapshot.
 */
function conversation(): ChatConversation {
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        title: '私人聊天',
        messages: [{ id: randomUUID(), role: 'user', content: '必须实际清理的私人正文', status: 'complete', createdAt: now }],
        createdAt: now,
        updatedAt: now,
    }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('ordinary chat durable deletion', () => {
    it('deletes only the actual owner chat and persists an idempotent identity-only barrier across restart', async () => {
        await database(async (store, pool, reopen) => {
            const workspaceId = randomUUID()
            const owner = await account(store, workspaceId)
            const peer = await account(store, workspaceId)
            const otherWorkspace = await account(store, randomUUID())
            const original = conversation()
            const retained = conversation()
            await store.create!(owner, original, { title: original.title })
            await store.save(peer, retained)
            expect(await store.remove!(peer, original.id)).toBe(false)
            expect(await store.remove!(otherWorkspace, original.id)).toBe(false)
            expect(await store.get(owner, original.id)).toEqual(original)
            expect(await store.remove!(owner, original.id)).toBe(true)
            const restarted = await reopen()
            expect(await restarted.get(owner, original.id)).toBeUndefined()
            expect(await restarted.list(owner)).toEqual([])
            expect(await restarted.remove!(owner, original.id)).toBe(true)
            expect(await restarted.remove!(peer, original.id)).toBe(false)
            await expect(restarted.save(owner, original)).rejects.toThrow('Conversation was deleted')
            await expect(restarted.create!(owner, original, { title: original.title })).rejects.toThrow('Conversation was deleted')
            expect(await restarted.get(peer, retained.id)).toEqual(retained)
            const barrier = await pool.query('SELECT * FROM harness_deleted_conversations WHERE id=$1', [original.id])
            expect(Object.keys(barrier.rows[0]).sort()).toEqual(['deleted_at', 'id', 'user_id', 'workspace_id'])
        })
    })

    it('purges the exact journal, jobs and human decisions, rejects late workers and preserves the peer source and delivered messages', async () => {
        await database(async (store, pool, reopen) => {
            const workspaceId = randomUUID()
            const owner = await account(store, workspaceId)
            const peer = await account(store, workspaceId)
            const original = conversation()
            const recipient = conversation()
            await store.save(owner, original)
            await store.save(peer, recipient)
            const source = { kind: 'conversation' as const, id: original.id }
            const recipientSource = { kind: 'conversation' as const, id: recipient.id }
            const db = store.collaboration!
            const reservation = await db.reserveSource(peer, recipientSource, randomUUID(), 30_000)
            await db.releaseSource(peer, recipientSource, reservation.token)
            const delivered = await db.mutate(owner, {
                type: 'message',
                requestId: randomUUID(),
                recipientId: peer.userId,
                content: '已投递正文应保留',
            })
            await db.enqueue(owner, { requestId: randomUUID(), source, content: '开始私人执行' })
            const job = (await db.claim(30_000))!
            await db.createJournal(job, { privateHeader: '私人会话头' }, 0)
            await db.appendJournal(job, [{ seq: 0, privateText: '私人 journal 正文' }])
            const request = await db.waitForHuman(job, { kind: 'question', callId: randomUUID(), question: { text: '一条私人问题？' } })
            await db.settle(job, { status: 'waiting' })
            await db.decideHuman(owner, source, {
                requestId: randomUUID(),
                humanRequestId: request.id,
                version: request.version,
                decision: 'answer',
                answer: '私人答案',
            })
            const resumed = (await db.claim(30_000))!
            const restarted = await reopen()
            expect(await restarted.remove!(owner, original.id)).toBe(true)
            await expect(db.assertLease(resumed)).rejects.toThrow()
            await expect(db.appendJournal(resumed, [{ seq: 1, privateText: '迟到正文' }])).rejects.toThrow()
            expect(await db.settle(resumed, { status: 'complete', conversation: original })).toBe(false)
            for (const table of ['harness_collaboration_jobs', 'harness_collaboration_sources', 'harness_human_requests']) {
                const result = await pool.query(
                    `SELECT count(*)::integer AS count FROM ${table} WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3`,
                    [workspaceId, owner.userId, original.id]
                )
                expect(result.rows[0].count).toBe(0)
            }
            const decisions = await pool.query('SELECT count(*)::integer AS count FROM harness_human_decisions WHERE request_id=$1', [
                request.id,
            ])
            expect(decisions.rows[0].count).toBe(0)
            expect((await db.messages(peer)).map(item => item.id)).toContain(delivered.messageId)
            expect(await restarted.get(peer, recipient.id)).toEqual(recipient)
            expect((await db.loadSource(peer, recipientSource))?.sessionId).toBe(reservation.sessionId)
        })
    })
})
