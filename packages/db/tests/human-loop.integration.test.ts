import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { ChatConversation, HumanWaitInput } from '@ai-harness/contracts'
import {
    createChatStore,
    createPostgresCollaborationStore,
    CollaborationAccessError,
    CollaborationConflictError,
    type CollaborationStore,
    type ChatScope,
} from '../src/index.js'

/**
 * Runs assertions only in a newly created disposable PostgreSQL schema.
 * @param run - Assertions receiving the isolated real stores.
 * @returns After closing clients and deleting only this test's schema.
 */
async function database(
    run: (fixture: { store: Awaited<ReturnType<typeof createChatStore>>; pool: pg.Pool; db: CollaborationStore }) => Promise<void>
): Promise<void> {
    const url = new URL(process.env.TEST_DATABASE_URL!)
    const admin = new pg.Pool({ connectionString: url.toString() })
    const schema = `sf022_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE SCHEMA ${schema}`)
    url.searchParams.set('options', `-c search_path=${schema},public`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    const store = await createChatStore({ databaseUrl: url.toString() })
    try {
        await run({ store, pool, db: store.collaboration! })
    } finally {
        await store.close()
        await pool.end()
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Persists real accounts and one private ordinary conversation without a project or Task.
 * @param store - Isolated PostgreSQL store.
 * @returns Its real owner, another account and exact private source.
 */
async function seed(store: Awaited<ReturnType<typeof createChatStore>>) {
    const workspaceId = randomUUID()
    const owner = { workspaceId, userId: randomUUID() }
    const other = { workspaceId, userId: randomUUID() }
    const now = new Date().toISOString()
    for (const [index, scope] of [owner, other].entries())
        await store.accounts!.createUser({
            user: { id: scope.userId, username: `Human ${index}`, email: `${scope.userId}@example.test`, createdAt: now, updatedAt: now },
            workspaceId,
            passwordHash: 'isolated-verifier',
            credentialVersion: 1,
        })
    const conversation: ChatConversation = { id: randomUUID(), title: 'Private HITL', messages: [], createdAt: now, updatedAt: now }
    await store.save(owner, conversation)
    return { owner, other, source: { kind: 'conversation' as const, id: conversation.id } }
}

/**
 * Creates a bounded test-only operation preview without registering any production tool.
 * @returns An exact immutable test write request.
 */
function approval(): HumanWaitInput {
    return {
        kind: 'approval',
        callId: randomUUID(),
        approval: {
            toolId: 'isolated-test-write',
            toolVersion: '1',
            action: '保存隔离测试记录',
            target: 'test-owned-row',
            scope: '仅此隔离schema',
            arguments: { content: '完整测试正文', target: 'test-owned-row' },
        },
    }
}

/**
 * Starts and durably waits one real original job.
 * @param db - Persistent execution coordinator.
 * @param owner - Trusted source owner.
 * @param source - Exact private source.
 * @param input - Question or isolated approval preview.
 * @returns The original job and its persistent request.
 */
async function waiting(db: CollaborationStore, owner: ChatScope, source: { kind: 'conversation'; id: string }, input: HumanWaitInput) {
    await db.enqueue(owner, { requestId: randomUUID(), source, content: '请继续原工作' })
    const job = (await db.claim(30_000))!
    const request = await db.waitForHuman(job, input)
    expect(await db.settle(job, { status: 'waiting' })).toBe(true)
    return { job, request }
}

/**
 * Creates a manually released test barrier without changing PostgreSQL transaction behavior.
 * @returns A waiting promise and its one-way release operation.
 */
function barrier(): { promise: Promise<void>; release: () => void } {
    let release!: () => void
    const promise = new Promise<void>(resolve => {
        release = resolve
    })
    return { promise, release }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('real PostgreSQL human request decisions', () => {
    it('persists one exact question, accepts one bottom-composer answer and queues only the original job across reconnect', async () => {
        await database(async ({ store, pool, db }) => {
            const { owner, other, source } = await seed(store)
            await db.enqueue(owner, { requestId: randomUUID(), source, content: '请写方案' })
            const job = (await db.claim(30_000))!
            const input: HumanWaitInput = {
                kind: 'question',
                callId: randomUUID(),
                question: { text: '目标读者是谁？', options: ['用户', '开发者'] },
            }
            const request = await db.waitForHuman(job, input)
            expect((await db.waitForHuman(job, input)).id).toBe(request.id)
            await expect(db.waitForHuman(job, { ...input, question: { text: 'changed' } })).rejects.toBeInstanceOf(
                CollaborationConflictError
            )
            const decision = {
                requestId: randomUUID(),
                humanRequestId: request.id,
                version: 1,
                decision: 'answer' as const,
                answer: '开发者；确认不是工具批准。',
            }
            await expect(db.decideHuman(owner, source, decision)).rejects.toBeInstanceOf(CollaborationConflictError)
            await db.settle(job, { status: 'waiting' })
            const reconnected = createPostgresCollaborationStore(pool)
            expect((await reconnected.loadSource(owner, source))!.conversation.humanRequests).toEqual([request])
            expect(await reconnected.claim(30_000)).toBeUndefined()
            await expect(
                reconnected.enqueue(owner, { requestId: randomUUID(), source, content: '未绑定的问题答案' })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            await expect(reconnected.humanRequests(other, source)).rejects.toBeInstanceOf(CollaborationAccessError)
            const results = await Promise.all([db.decideHuman(owner, source, decision), reconnected.decideHuman(owner, source, decision)])
            for (const result of results)
                expect(result.messages.filter(message => message.requestId === decision.requestId)).toHaveLength(1)
            await expect(db.decideHuman(owner, source, { ...decision, answer: 'changed' })).rejects.toBeInstanceOf(
                CollaborationConflictError
            )
            await expect(db.decideHuman(owner, source, { ...decision, requestId: randomUUID() })).rejects.toBeInstanceOf(
                CollaborationConflictError
            )
            const resumed = (await db.claim(30_000))!
            expect(resumed.id).toBe(job.id)
            expect(await reconnected.claim(30_000)).toBeUndefined()
            expect(await db.humanRequestsForJob(resumed)).toMatchObject([{ id: request.id, status: 'answered', answer: decision.answer }])
            expect((await pool.query('SELECT count(*)::int AS count FROM harness_human_decisions')).rows[0].count).toBe(1)
            expect((await pool.query('SELECT count(*)::int AS count FROM harness_collaboration_jobs')).rows[0].count).toBe(1)
        })
    })

    it('freezes approvals, resolves concurrent approve/reject once and persists the actual tool outcome', async () => {
        await database(async ({ store, pool, db }) => {
            const { owner, source } = await seed(store)
            const { job, request } = await waiting(db, owner, source, approval())
            const approve = { requestId: randomUUID(), humanRequestId: request.id, version: request.version, decision: 'approve' as const }
            await expect(db.decideHuman(owner, source, { ...approve, version: 2 })).rejects.toBeInstanceOf(CollaborationConflictError)
            const decisions = await Promise.allSettled([
                db.decideHuman(owner, source, approve),
                db.decideHuman(owner, source, { ...approve, requestId: randomUUID(), decision: 'reject' }),
            ])
            expect(decisions.filter(result => result.status === 'fulfilled')).toHaveLength(1)
            const current = (await db.humanRequests(owner, source))[0]!
            const resumed = (await db.claim(30_000))!
            expect(resumed.id).toBe(job.id)
            if (current.status === 'approved') {
                expect((await db.beginHumanEffect(resumed, request.id, 1)).status).toBe('executing')
                expect(
                    (
                        await db.finishHumanEffect(resumed, request.id, 1, {
                            status: 'succeeded',
                            result: '{"content":[{"type":"text","text":"saved"}],"isError":false}',
                        })
                    ).status
                ).toBe('succeeded')
                expect((await db.beginHumanEffect(resumed, request.id, 1)).status).toBe('succeeded')
            } else {
                expect(current.status).toBe('rejected')
                await expect(db.beginHumanEffect(resumed, request.id, 1)).rejects.toBeInstanceOf(CollaborationConflictError)
            }
            expect((await pool.query('SELECT count(*)::int AS count FROM harness_human_decisions')).rows[0].count).toBe(1)
        })
    })

    it('supersedes a pending approval atomically on a new ordinary instruction and rejects its late approval', async () => {
        await database(async ({ store, db }) => {
            const { owner, source } = await seed(store)
            const { job, request } = await waiting(db, owner, source, approval())
            await db.enqueue(owner, { requestId: randomUUID(), source, content: '修改要求，先不要写入。' })
            expect((await db.humanRequests(owner, source))[0]!.status).toBe('superseded')
            await expect(
                db.decideHuman(owner, source, { requestId: randomUUID(), humanRequestId: request.id, version: 1, decision: 'approve' })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            expect((await db.claim(30_000))!.id).not.toBe(job.id)
        })
    })

    it('retains a successful exact approved result and reports oversized effect results as uncertain', async () => {
        await database(async ({ store, db }) => {
            const { owner, source } = await seed(store)
            const { request } = await waiting(db, owner, source, approval())
            const decision = { requestId: randomUUID(), humanRequestId: request.id, version: 1, decision: 'approve' as const }
            await db.decideHuman(owner, source, decision)
            const resumed = (await db.claim(30_000))!
            expect((await db.beginHumanEffect(resumed, request.id, 1)).status).toBe('executing')
            const outcome = '{"content":[{"type":"text","text":"saved"}],"isError":false}'
            expect(await db.finishHumanEffect(resumed, request.id, 1, { status: 'succeeded', result: outcome })).toMatchObject({
                status: 'succeeded',
                result: outcome,
            })
            expect((await db.beginHumanEffect(resumed, request.id, 1)).status).toBe('succeeded')
            await db.settle(resumed, { status: 'complete' })
            const next = await waiting(db, owner, source, approval())
            await db.decideHuman(owner, source, {
                requestId: randomUUID(),
                humanRequestId: next.request.id,
                version: 1,
                decision: 'approve',
            })
            const second = (await db.claim(30_000))!
            await db.beginHumanEffect(second, next.request.id, 1)
            expect(
                (await db.finishHumanEffect(second, next.request.id, 1, { status: 'succeeded', result: 'x'.repeat(32_001) })).status
            ).toBe('unknown')
            expect((await db.beginHumanEffect(second, next.request.id, 1)).status).toBe('unknown')
        })
    })

    it('reads messages, human results and activity from one locked source snapshot when settlement wins the initial read race', async () => {
        await database(async ({ store, pool, db }) => {
            const { owner, source } = await seed(store)
            const { request } = await waiting(db, owner, source, approval())
            await db.decideHuman(owner, source, {
                requestId: randomUUID(),
                humanRequestId: request.id,
                version: 1,
                decision: 'approve',
            })
            const resumed = (await db.claim(30_000))!
            await db.beginHumanEffect(resumed, request.id, 1)
            const oldMessagesRead = barrier()
            const allowReadToContinue = barrier()
            let interceptFirstRead = true
            const racingPool = {
                query: pool.query.bind(pool),
                /**
                 * Intercept only the first ordinary conversation read before its source lock.
                 * @returns A real PostgreSQL client whose initial read waits for the competing writer.
                 */
                async connect() {
                    const client = await pool.connect()
                    return new Proxy(client, {
                        /**
                         * Retain real database operations while exposing a deterministic race barrier.
                         * @param target - Actual pooled PostgreSQL client.
                         * @param property - Requested client operation.
                         * @returns The real bound method or the one instrumented read method.
                         */
                        get(target, property) {
                            if (property === 'query')
                                return async (sql: string, parameters?: unknown[]) => {
                                    const result = await target.query(sql, parameters)
                                    if (interceptFirstRead && sql.startsWith('SELECT * FROM harness_chat_conversations WHERE')) {
                                        interceptFirstRead = false
                                        oldMessagesRead.release()
                                        await allowReadToContinue.promise
                                    }
                                    return result
                                }
                            const value: unknown = Reflect.get(target, property)
                            return typeof value === 'function' ? value.bind(target) : value
                        },
                    })
                },
            } as unknown as pg.Pool
            const racingReader = createPostgresCollaborationStore(racingPool)
            const reading = racingReader.loadSource(owner, source)
            try {
                await oldMessagesRead.promise
                await db.finishHumanEffect(resumed, request.id, 1, { status: 'succeeded', result: 'saved' })
                const now = new Date().toISOString()
                expect(
                    await db.settle(resumed, {
                        status: 'complete',
                        conversation: {
                            ...resumed.conversation,
                            messages: [
                                ...resumed.conversation.messages,
                                {
                                    id: `${resumed.triggerId}:assistant:human:${request.id}`,
                                    role: 'assistant',
                                    content: '实际批准操作已完成，最终回复必须与完成状态同时可见。',
                                    status: 'complete',
                                    requestId: resumed.triggerId,
                                    createdAt: now,
                                },
                            ],
                            updatedAt: now,
                        },
                    })
                ).toBe(true)
            } finally {
                allowReadToContinue.release()
            }
            const snapshot = (await reading)!.conversation
            expect(snapshot.activeRequestId).toBeUndefined()
            expect(snapshot.humanRequests).toMatchObject([{ id: request.id, status: 'succeeded' }])
            expect(snapshot.messages.at(-1)?.content).toBe('实际批准操作已完成，最终回复必须与完成状态同时可见。')
        })
    })

    it('marks an interrupted non-idempotent effect unknown and never starts it again', async () => {
        await database(async ({ store, db }) => {
            const { owner, source } = await seed(store)
            const { request } = await waiting(db, owner, source, approval())
            await db.decideHuman(owner, source, { requestId: randomUUID(), humanRequestId: request.id, version: 1, decision: 'approve' })
            const resumed = (await db.claim(30_000))!
            expect((await db.beginHumanEffect(resumed, request.id, 1)).status).toBe('executing')
            await db.release(resumed)
            const recovered = (await db.claim(30_000))!
            expect((await db.beginHumanEffect(recovered, request.id, 1)).status).toBe('unknown')
            expect((await db.beginHumanEffect(recovered, request.id, 1)).status).toBe('unknown')
            await expect(
                db.finishHumanEffect(resumed, request.id, 1, { status: 'succeeded', result: 'late old writer' })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
        })
    })

    it('cancels the exact waiting job and leaves later normal discussion independent', async () => {
        await database(async ({ store, db }) => {
            const { owner, source } = await seed(store)
            const { job, request } = await waiting(db, owner, source, {
                kind: 'question',
                callId: randomUUID(),
                question: { text: '继续吗？' },
            })
            await db.cancelSource(owner, source, job.triggerId)
            expect((await db.humanRequests(owner, source))[0]!.status).toBe('cancelled')
            await expect(
                db.decideHuman(owner, source, {
                    requestId: randomUUID(),
                    humanRequestId: request.id,
                    version: 1,
                    decision: 'answer',
                    answer: '确认',
                })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            expect(await db.claim(30_000)).toBeUndefined()
            await db.enqueue(owner, { requestId: randomUUID(), source, content: '另一项讨论' })
            expect((await db.claim(30_000))!.id).not.toBe(job.id)
        })
    })

    it('invalidates node-free private requests on member removal and never revives them after rejoining', async () => {
        await database(async ({ store, db }) => {
            const { owner, other } = await seed(store)
            const team = await store.workspaces!.create(owner, { requestId: randomUUID(), name: 'HITL team', description: '' })
            const invitation = await store.workspaces!.invite(owner, team.id, {
                requestId: randomUUID(),
                email: `${other.userId}@example.test`,
            })
            await store.workspaces!.respond(other, invitation.id, true)
            const member = { userId: other.userId, workspaceId: team.id }
            const now = new Date().toISOString()
            const conversation: ChatConversation = {
                id: randomUUID(),
                title: 'Member private chat',
                createdAt: now,
                updatedAt: now,
                messages: [],
            }
            await store.save(member, conversation)
            const source = { kind: 'conversation' as const, id: conversation.id }
            const { request } = await waiting(db, member, source, approval())
            await store.workspaces!.remove(owner, team.id, other.userId)
            const next = await store.workspaces!.invite(owner, team.id, { requestId: randomUUID(), email: `${other.userId}@example.test` })
            await store.workspaces!.respond(other, next.id, true)
            expect((await db.humanRequests(member, source))[0]!.status).toBe('invalid')
            await expect(
                db.decideHuman(member, source, { requestId: randomUUID(), humanRequestId: request.id, version: 1, decision: 'approve' })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            expect(await db.claim(30_000)).toBeUndefined()
        })
    })

    it('invalidates old communication drafts when the owner answers a coexisting private question', async () => {
        await database(async ({ store, db }) => {
            const { owner, other, source } = await seed(store)
            await db.enqueue(owner, {
                requestId: randomUUID(),
                source,
                content: '@Human 1 请整理发送',
                mentions: [{ userId: other.userId, name: 'Human 1', start: 0, end: 8 }],
            })
            const job = (await db.claim(30_000))!
            const draft = await db.propose(
                owner,
                { type: 'message', requestId: randomUUID(), source, recipientId: other.userId, content: '完整待发正文' },
                { authorKind: 'agent', lease: job }
            )
            const request = await db.waitForHuman(job, { kind: 'question', callId: randomUUID(), question: { text: '需要补充什么？' } })
            await db.settle(job, { status: 'waiting' })
            await db.decideHuman(owner, source, {
                requestId: randomUUID(),
                humanRequestId: request.id,
                version: 1,
                decision: 'answer',
                answer: '请调整内容',
            })
            expect((await db.dispatch(owner, draft.draftId!))!.proposal.status).toBe('superseded')
        })
    })
})
