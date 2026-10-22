import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { AgentDefinition, ChatConversation, PersonalTask, CollaborationActionResult } from '@ai-harness/contracts'
import {
    createChatStore,
    CollaborationAccessError,
    CollaborationConflictError,
    type CollaborationStore,
    type ChatScope,
} from '../src/index.js'

/**
 * Creates a private Agent fixture without any live provider credential.
 * @param label - Distinct owner label.
 * @returns One valid immutable Agent snapshot.
 */
function agent(label: string): AgentDefinition {
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        name: label,
        description: '',
        modelId: `account:${randomUUID()}`,
        systemPrompt: `${label} PRIVATE PROMPT`,
        toolIds: [],
        openingMessages: [],
        createdAt: now,
        updatedAt: now,
    }
}

/**
 * Creates a fresh owner Task before the real activation transaction.
 * @param goal - Delegated work goal.
 * @returns One unstarted valid private Task.
 */
function task(goal: string): PersonalTask {
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        title: 'B private task',
        createdAt: now,
        updatedAt: now,
        messages: [],
        agent: agent('B'),
        task: { goal, status: 'not-started', started: false },
    }
}

/**
 * Creates and later removes only this test's isolated PostgreSQL schema.
 * @param run - Real-database assertions.
 * @returns After assertions and test-owned schema cleanup.
 */
async function database(
    run: (fixture: { store: Awaited<ReturnType<typeof createChatStore>>; url: string; pool: pg.Pool }) => Promise<void>
): Promise<void> {
    const url = new URL(process.env.TEST_DATABASE_URL!)
    const admin = new pg.Pool({ connectionString: url.toString() })
    const schema = `sf014_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE SCHEMA ${schema}`)
    url.searchParams.set('options', `-c search_path=${schema},public`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    const store = await createChatStore({ databaseUrl: url.toString() })
    try {
        await run({ store, url: url.toString(), pool })
    } finally {
        await store.close()
        await pool.end()
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Persists real account rows and an original private conversation.
 * @param store - Real PostgreSQL store.
 * @returns Distinct trusted owners and one private source.
 */
async function seed(store: Awaited<ReturnType<typeof createChatStore>>) {
    const workspaceId = randomUUID()
    const a = { workspaceId, userId: randomUUID() }
    const b = { workspaceId, userId: randomUUID() }
    const c = { workspaceId, userId: randomUUID() }
    const d = { workspaceId: randomUUID(), userId: randomUUID() }
    const now = new Date().toISOString()
    for (const [index, scope] of [a, b, c, d].entries())
        await store.accounts!.createUser({
            user: { id: scope.userId, username: `Person ${index}`, email: `${scope.userId}@example.test`, createdAt: now, updatedAt: now },
            workspaceId: scope.workspaceId,
            passwordHash: 'isolated-verifier',
            credentialVersion: 1,
        })
    const original: ChatConversation = {
        id: randomUUID(),
        title: 'Original private conversation',
        messages: [{ id: randomUUID(), role: 'user', content: 'UNRELATED PRIVATE HISTORY', status: 'complete', createdAt: now }],
        agent: agent('A'),
        createdAt: now,
        updatedAt: now,
    }
    await store.save(a, original)
    return { a, b, c, d, original, source: { kind: 'conversation' as const, id: original.id } }
}

/**
 * Builds an explicit human review command for an immutable proposal.
 * @param draft - Persisted proposal outcome.
 * @returns Only its original immutable identity and preview version.
 */
function confirm(draft: CollaborationActionResult) {
    return { type: 'confirm-dispatch' as const, requestId: randomUUID(), draftId: draft.draftId!, version: draft.draftVersion! }
}

/**
 * Stages one original message under a real current sender execution.
 * @param db - PostgreSQL collaboration store.
 * @param scope - Trusted sender identity.
 * @param source - Existing private conversation.
 * @param recipientId - Real same-workspace recipient.
 * @returns The current job, full original command and staged result.
 */
async function stagedMessage(db: CollaborationStore, scope: ChatScope, source: { kind: 'conversation'; id: string }, recipientId: string) {
    await db.enqueue(scope, {
        requestId: randomUUID(),
        source,
        content: '@Recipient please contact',
        mentions: [{ userId: recipientId, name: 'Recipient', start: 0, end: 10 }],
    })
    const job = (await db.claim(30_000))!
    const command = { type: 'message' as const, requestId: randomUUID(), source, recipientId, content: '  完整原文\n不改标点。  ' }
    const draft = await db.propose(scope, command, { lease: job, authorKind: 'agent' })
    return { job, command, draft }
}

/**
 * Opens an actual receiver-owned normal conversation with an exact pending handoff question.
 * @param store - Real PostgreSQL account and conversation store.
 * @returns Both owners, their independent conversations and the unresolved question identity.
 */
async function pendingReply(store: Awaited<ReturnType<typeof createChatStore>>) {
    const fixture = await seed(store)
    const now = new Date().toISOString()
    const receiver: ChatConversation = {
        id: randomUUID(),
        title: 'Received normal chat',
        messages: [],
        agent: agent('B'),
        createdAt: now,
        updatedAt: now,
    }
    const delegated = await store.collaboration!.mutate(
        fixture.a,
        {
            type: 'delegate',
            requestId: randomUUID(),
            source: fixture.source,
            recipientId: fixture.b.userId,
            title: '排查白屏',
            goal: '定位原因并给出修复建议',
            context: '点击侧边导航后页面白屏',
        },
        { recipientConversation: receiver }
    )
    const question = (await store.collaboration!.node(fixture.b, delegated.nodeId!))!.questions.find(
        item => item.id === delegated.questionId
    )!
    return { ...fixture, delegated, question, receiver, receiverSource: { kind: 'conversation' as const, id: receiver.id } }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('real PostgreSQL owner-confirmed Agent dispatch', () => {
    it('keeps normal owner discussion private and only answers the exact question after an explicit reviewed reply, once across restart', async () => {
        await database(async ({ store, pool, url }) => {
            const { a, b, c, source, receiverSource, delegated, question } = await pendingReply(store)
            const db = store.collaboration!
            for (const content of ['确认', '我知道了', '请先分析']) {
                await db.enqueue(b, { requestId: randomUUID(), source: receiverSource, content })
                const discussion = (await db.claim(30_000))!
                expect(discussion.scope.userId).toBe(b.userId)
                expect(discussion.origin).toBe('human')
                await db.settle(discussion, { status: 'complete' })
                expect((await db.node(b, delegated.nodeId!))!.questions.find(item => item.id === question.id)).toMatchObject({
                    status: 'pending',
                    answer: null,
                })
                expect((await db.sourceEvents(b, receiverSource)).pendingDispatches).toEqual([])
                expect((await db.notifications(a)).unread).toBe(0)
            }
            const reply = {
                type: 'answer' as const,
                requestId: randomUUID(),
                questionId: question.id,
                version: question.version,
                content: '根因是侧边栏路由失配；请补充出错按钮名称。',
                decision: 'information' as const,
            }
            await db.enqueue(b, { requestId: randomUUID(), source: receiverSource, content: '把目前结论回复给上游，先给我确认' })
            const job = (await db.claim(30_000))!
            const beforeDraft = (await db.node(b, delegated.nodeId!))!
            const hiddenPublication = {
                type: 'publish' as const,
                requestId: randomUUID(),
                nodeId: beforeDraft.node.id,
                revision: beforeDraft.node.revision,
                title: '不应自动共享的私人分析',
                content: 'PRIVATE ANALYSIS MUST NOT BECOME A SHARED ARTIFACT',
            }
            for (const authority of [{ lease: job, authorKind: 'agent' as const }, { lease: job }])
                await expect(db.mutate(b, hiddenPublication, authority)).rejects.toThrow('工作结论默认保留在本人聊天中')
            expect((await db.node(a, delegated.nodeId!))!.artifacts).toEqual([])
            expect(await db.action(b, hiddenPublication.requestId)).toBeUndefined()
            expect((await db.sourceEvents(b, receiverSource)).pendingDispatches).toEqual([])
            await expect(db.mutate(b, reply, { lease: job, authorKind: 'agent' })).rejects.toThrow('本人预览并确认')
            await expect(db.propose(c, reply, { lease: job, authorKind: 'agent' })).rejects.toBeInstanceOf(CollaborationAccessError)
            await expect(
                db.propose(b, { ...reply, version: question.version + 1 }, { lease: job, authorKind: 'agent' })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            const proposed = await db.propose(b, reply, { lease: job, authorKind: 'agent' })
            expect(await db.propose(b, reply, { lease: job, authorKind: 'agent' })).toEqual(proposed)
            expect((await db.dispatch(b, proposed.draftId!))!.proposal).toMatchObject({
                kind: 'answer',
                source: receiverSource,
                recipientId: a.userId,
                recipientName: 'Person 0',
                content: reply.content,
                questionId: question.id,
                questionVersion: question.version,
                question: question.question,
                decision: 'information',
                status: 'pending',
            })
            await expect(db.mutate(b, confirm(proposed))).rejects.toThrow('Agent 正在整理内容')
            expect((await db.notifications(a)).unread).toBe(0)
            expect((await store.get(a, source.id))!.messages.some(message => message.content.includes(reply.content))).toBe(false)
            await db.settle(job, { status: 'complete' })
            await expect(db.mutate(a, confirm(proposed))).rejects.toBeInstanceOf(CollaborationAccessError)
            const peer = await createChatStore({ databaseUrl: url })
            try {
                const first = confirm(proposed)
                const second = confirm(proposed)
                const outcomes = await Promise.all([db.mutate(b, first), peer.collaboration!.mutate(b, second)])
                expect(outcomes.every(result => result.dispatchStatus === 'sent' && result.questionId === question.id)).toBe(true)
                expect(outcomes[0].eventId).toBe(outcomes[1].eventId)
                expect(await peer.collaboration!.mutate(b, first)).toEqual(outcomes[0])
                expect((await peer.get(a, source.id))!.messages.filter(message => message.content.includes(reply.content))).toHaveLength(1)
                expect(
                    (await peer.get(b, receiverSource.id))!.messages.filter(message => message.content.includes(reply.content))
                ).toHaveLength(1)
                const answered = (await peer.collaboration!.node(b, delegated.nodeId!))!
                expect(answered.questions.find(item => item.id === question.id)).toMatchObject({
                    status: 'answered',
                    answer: reply.content,
                    decision: 'information',
                })
                expect(answered.events.find(event => event.id === outcomes[0].eventId)).toMatchObject({
                    authorId: b.userId,
                    authorKind: 'human',
                    kind: 'answer',
                })
                expect((await peer.collaboration!.notifications(a)).unread).toBe(1)
                expect((await pool.query('SELECT id FROM harness_collaboration_jobs WHERE source_id=$1', [source.id])).rows).toHaveLength(1)
                const evidence = (
                    await pool.query('SELECT job_id,confirmed_request_id,confirmed_at FROM harness_collaboration_dispatches WHERE id=$1', [
                        proposed.draftId,
                    ])
                ).rows[0]
                expect(evidence.job_id).toBe(job.id)
                expect([first.requestId, second.requestId]).toContain(evidence.confirmed_request_id)
                expect(evidence.confirmed_at).toBeInstanceOf(Date)
            } finally {
                await peer.close()
            }
        })
    }, 30_000)

    it('invalidates reply drafts on cancellation, new owner input, stale questions and revoked access without consuming the question', async () => {
        await database(async ({ store }) => {
            const { a, b, receiverSource, delegated, question } = await pendingReply(store)
            const db = store.collaboration!
            const reply = {
                type: 'answer' as const,
                requestId: randomUUID(),
                questionId: question.id,
                version: question.version,
                content: '待本人确认的回复',
                decision: 'information' as const,
            }
            await db.enqueue(b, { requestId: randomUUID(), source: receiverSource, content: '整理一份发给上游的结论' })
            const firstJob = (await db.claim(30_000))!
            const cancelled = await db.propose(b, reply, { lease: firstJob, authorKind: 'agent' })
            await db.settle(firstJob, { status: 'complete' })
            await db.mutate(b, { ...confirm(cancelled), type: 'cancel-dispatch' })
            await expect(db.mutate(b, confirm(cancelled))).rejects.toBeInstanceOf(CollaborationConflictError)
            await db.enqueue(b, { requestId: randomUUID(), source: receiverSource, content: '重新准备一份回复' })
            const secondJob = (await db.claim(30_000))!
            const superseded = await db.propose(b, { ...reply, requestId: randomUUID() }, { lease: secondJob, authorKind: 'agent' })
            await db.settle(secondJob, { status: 'complete' })
            await db.enqueue(b, { requestId: randomUUID(), source: receiverSource, content: '确认' })
            expect((await db.dispatch(b, superseded.draftId!))!.proposal.status).toBe('superseded')
            await expect(db.mutate(b, confirm(superseded))).rejects.toBeInstanceOf(CollaborationConflictError)
            const thirdJob = (await db.claim(30_000))!
            await db.settle(thirdJob, { status: 'complete' })
            expect((await db.node(b, delegated.nodeId!))!.questions.find(item => item.id === question.id)!.status).toBe('pending')
            expect((await db.notifications(a)).unread).toBe(0)
            await db.enqueue(b, { requestId: randomUUID(), source: receiverSource, content: '只整理草稿' })
            const lastJob = (await db.claim(30_000))!
            const stale = await db.propose(b, { ...reply, requestId: randomUUID() }, { lease: lastJob, authorKind: 'agent' })
            await db.settle(lastJob, { status: 'complete' })
            await db.mutate(b, { ...reply, requestId: randomUUID(), content: '本人通过旧版精确表单提交的答案' })
            await expect(db.mutate(b, confirm(stale))).rejects.toThrow('此问题已经失效')
            expect((await db.notifications(a)).unread).toBe(1)
            expect((await db.node(b, delegated.nodeId!))!.events.filter(event => event.kind === 'answer')).toHaveLength(1)
        })
        await database(async ({ store }) => {
            const { a, b, receiverSource, delegated, question } = await pendingReply(store)
            const db = store.collaboration!
            await db.enqueue(b, { requestId: randomUUID(), source: receiverSource, content: '准备回复' })
            const job = (await db.claim(30_000))!
            const draft = await db.propose(
                b,
                {
                    type: 'answer',
                    requestId: randomUUID(),
                    questionId: question.id,
                    version: question.version,
                    content: '未发回复',
                    decision: 'information',
                },
                { lease: job, authorKind: 'agent' }
            )
            await db.settle(job, { status: 'complete' })
            const project = (await db.project(a, delegated.projectId!))!
            await db.mutate(a, {
                type: 'revoke',
                requestId: randomUUID(),
                projectId: project.id,
                userId: b.userId,
                revision: project.revision,
            })
            expect((await db.dispatch(b, draft.draftId!))!.proposal.status).toBe('cancelled')
            await expect(db.mutate(b, confirm(draft))).rejects.toBeInstanceOf(CollaborationConflictError)
            expect((await db.notifications(a)).unread).toBe(0)
        })
    }, 30_000)

    it('binds reply authority to its exact source and requires real confirmation even for an approval to the owner themselves', async () => {
        await database(async ({ store }) => {
            const { a, b, receiverSource, delegated, question, original } = await pendingReply(store)
            const db = store.collaboration!
            const unrelated = {
                ...original,
                id: randomUUID(),
                title: 'Unrelated private B chat',
                agent: agent('B unrelated'),
                messages: [],
            }
            await store.save(b, unrelated)
            await db.enqueue(b, { requestId: randomUUID(), source: { kind: 'conversation', id: unrelated.id }, content: '确认' })
            const wrongSource = (await db.claim(30_000))!
            await expect(
                db.propose(
                    b,
                    {
                        type: 'answer',
                        requestId: randomUUID(),
                        questionId: question.id,
                        version: question.version,
                        content: '不能跨私有聊天作答',
                        decision: 'approved',
                    },
                    { lease: wrongSource, authorKind: 'agent' }
                )
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            await db.settle(wrongSource, { status: 'complete' })
            const node = (await db.node(b, delegated.nodeId!))!.node
            const judgment = await db.mutate(b, {
                type: 'ask',
                requestId: randomUUID(),
                nodeId: node.id,
                revision: node.revision,
                targetNodeId: node.id,
                question: '是否批准发布？',
                context: '需要本人决定',
            })
            await db.enqueue(b, { requestId: randomUUID(), source: receiverSource, content: '先整理批准说明给我看' })
            const ownJob = (await db.claim(30_000))!
            const approval = {
                type: 'answer' as const,
                requestId: randomUUID(),
                questionId: judgment.questionId!,
                version: 1,
                content: '批准此版本发布',
                decision: 'approved' as const,
            }
            const draft = await db.propose(b, approval, { lease: ownJob, authorKind: 'agent' })
            expect((await db.dispatch(b, draft.draftId!))!.proposal).toMatchObject({
                kind: 'answer',
                recipientId: b.userId,
                decision: 'approved',
                question: '是否批准发布？',
            })
            await db.settle(ownJob, { status: 'complete' })
            expect((await db.node(b, node.id))!.questions.find(item => item.id === judgment.questionId)!.status).toBe('pending')
            const sent = await db.mutate(b, confirm(draft))
            expect((await db.node(b, node.id))!.questions.find(item => item.id === judgment.questionId)).toMatchObject({
                status: 'answered',
                decision: 'approved',
            })
            expect((await db.node(b, node.id))!.events.find(event => event.id === sent.eventId)).toMatchObject({
                authorId: b.userId,
                authorKind: 'human',
                kind: 'decision',
            })
            expect((await db.notifications(a)).unread).toBe(0)
            const continuation = (await db.claim(30_000))!
            expect(continuation.scope.userId).toBe(b.userId)
            expect(continuation.origin).toBe('collaboration')
        })
    }, 30_000)

    it('keeps proposals private and side-effect free, rejects premature and forged confirmations, and sends once after restart and double clicks', async () => {
        await database(async ({ store, pool, url }) => {
            const { a, b, c, source } = await seed(store)
            const db = store.collaboration!
            const { job, command, draft } = await stagedMessage(db, a, source, b.userId)
            expect(draft.dispatchStatus).toBe('pending')
            expect(await db.propose(a, command, { lease: job, authorKind: 'agent' })).toEqual(draft)
            expect((await db.effects(job))[0].result).toEqual(draft)
            expect(await db.messages(b)).toEqual([])
            expect((await db.notifications(b)).unread).toBe(0)
            expect(await db.projects(a)).toEqual([])
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations WHERE user_id=$1', [b.userId])).rows[0].n
            ).toBe(0)
            expect((await db.sourceEvents(a, source)).pendingContact).not.toBeNull()
            expect((await db.sourceEvents(a, source)).pendingDispatches[0]).toMatchObject({
                recipientId: b.userId,
                content: command.content,
                status: 'pending',
            })
            expect(await db.dispatch(c, draft.draftId!)).toBeUndefined()
            await expect(db.mutate(c, confirm(draft))).rejects.toBeInstanceOf(CollaborationAccessError)
            await expect(db.mutate(a, confirm(draft))).rejects.toThrow('Agent 正在整理内容')
            await expect(db.mutate(a, { ...confirm(draft), version: draft.draftVersion! + 1 })).rejects.toBeInstanceOf(
                CollaborationConflictError
            )
            await expect(db.mutate(a, command, { lease: job, authorKind: 'agent' })).rejects.toThrow('本人预览并确认')
            expect(await db.settle(job, { status: 'complete' })).toBe(true)
            const peerStore = await createChatStore({ databaseUrl: url })
            try {
                const peer = peerStore.collaboration!
                const review = confirm(draft)
                const repeatedReview = confirm(draft)
                const outcomes = await Promise.all([db.mutate(a, review), peer.mutate(a, review), peer.mutate(a, repeatedReview)])
                expect(await peer.action(a, repeatedReview.requestId)).toEqual(outcomes[2])
                await expect(peer.mutate(a, { ...repeatedReview, draftId: randomUUID() })).rejects.toBeInstanceOf(
                    CollaborationConflictError
                )
                expect(outcomes.every(result => result.dispatchStatus === 'sent')).toBe(true)
                expect(new Set(outcomes.map(result => result.messageId)).size).toBe(1)
                expect((await db.messages(b))[0]).toMatchObject({ content: command.content, authorKind: 'agent' })
                expect(await db.messages(b)).toHaveLength(1)
                expect((await db.notifications(b)).unread).toBe(1)
                expect((await db.sourceEvents(a, source)).pendingContact).toBeNull()
                expect((await peer.dispatch(a, draft.draftId!))!.proposal.status).toBe('sent')
                const evidence = (
                    await pool.query('SELECT confirmed_request_id,confirmed_at FROM harness_collaboration_dispatches WHERE id=$1', [
                        draft.draftId,
                    ])
                ).rows[0]
                expect([review.requestId, repeatedReview.requestId]).toContain(evidence.confirmed_request_id)
                expect(evidence.confirmed_at).toBeInstanceOf(Date)
                await peer.mutate(a, confirm(draft))
                expect(
                    (
                        await pool.query('SELECT confirmed_request_id,confirmed_at FROM harness_collaboration_dispatches WHERE id=$1', [
                            draft.draftId,
                        ])
                    ).rows[0]
                ).toEqual(evidence)
                const next = await stagedMessage(db, a, source, b.userId)
                expect(next.draft.draftId).not.toBe(draft.draftId)
                expect(next.draft.dispatchStatus).toBe('pending')
                expect(await db.messages(b)).toHaveLength(1)
                expect(await db.settle(next.job, { status: 'complete' })).toBe(true)
                await peer.mutate(a, review)
                await peer.mutate(a, confirm(draft))
                expect(await db.messages(b)).toHaveLength(1)
                expect((await peer.dispatch(a, next.draft.draftId!))!.proposal.status).toBe('pending')
                const nextDelivery = await peer.mutate(a, confirm(next.draft))
                expect(nextDelivery.dispatchStatus).toBe('sent')
                expect(nextDelivery.messageId).not.toBe(outcomes[0]!.messageId)
                expect(await db.messages(b)).toHaveLength(2)
                expect((await db.notifications(b)).unread).toBe(2)
            } finally {
                await peerStore.close()
            }
        })
    }, 30_000)

    it('invalidates the exact old preview on later human input, cancels without sending and fences expired proposal leases', async () => {
        await database(async ({ store }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const { job, command, draft } = await stagedMessage(db, a, source, b.userId)
            await db.settle(job, { status: 'complete' })
            await db.enqueue(a, { requestId: randomUUID(), source, content: 'Please revise the deadline before sending.' })
            expect((await db.dispatch(a, draft.draftId!))!.proposal.status).toBe('superseded')
            await expect(db.mutate(a, confirm(draft))).rejects.toBeInstanceOf(CollaborationConflictError)
            await expect(
                db.propose(a, { ...command, requestId: randomUUID() }, { lease: job, authorKind: 'agent' })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            const revisionJob = (await db.claim(30_000))!
            const replacement = await db.propose(
                a,
                { ...command, requestId: randomUUID(), content: 'Revised complete message' },
                { lease: revisionJob, authorKind: 'agent' }
            )
            await db.settle(revisionJob, { status: 'complete' })
            const cancelled = await db.mutate(a, { ...confirm(replacement), type: 'cancel-dispatch' })
            expect(cancelled.dispatchStatus).toBe('cancelled')
            const duplicateCancel = { ...confirm(replacement), type: 'cancel-dispatch' as const }
            const cancellationReplay = await db.mutate(a, duplicateCancel)
            expect(await db.action(a, duplicateCancel.requestId)).toEqual(cancellationReplay)
            await expect(db.mutate(a, { ...duplicateCancel, draftId: randomUUID() })).rejects.toBeInstanceOf(CollaborationConflictError)
            await expect(db.mutate(a, confirm(replacement))).rejects.toBeInstanceOf(CollaborationConflictError)
            expect(await db.messages(b)).toEqual([])
            expect((await db.notifications(b)).unread).toBe(0)
        })
    }, 30_000)

    it('creates the recipient private Agent opening only in the confirmed transaction and preserves original Agent authorship', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const { job } = await stagedMessage(db, a, source, b.userId)
            const goal = '修复侧边栏白屏'
            const command = {
                type: 'delegate' as const,
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: '排查白屏',
                goal,
                context: '项目：ai-harness，点击侧边栏按钮后出现，期望打开正确页面。',
            }
            const draft = await db.propose(a, command, { lease: job, authorKind: 'agent' })
            expect((await db.dispatch(a, draft.draftId!))!.proposal).toMatchObject({
                title: command.title,
                goal,
                context: command.context,
                status: 'pending',
            })
            expect(await db.projects(a)).toEqual([])
            expect((await db.notifications(b)).unread).toBe(0)
            await db.settle(job, { status: 'complete' })
            const recipientTask = task(goal)
            const sent = await db.mutate(a, confirm(draft), { recipientTask })
            expect(sent.taskId).toBe(recipientTask.id)
            const own = (await store.get(b, sent.taskId!))!
            expect(own.messages[0]).toMatchObject({ role: 'assistant', kind: 'opening' })
            expect(own.messages[0].content).toContain(command.context)
            expect((await db.sourceEvents(a, source)).events[0].authorKind).toBe('agent')
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_jobs WHERE user_id=$1', [b.userId])).rows[0].n
            ).toBe(0)
        })
    }, 30_000)

    it('does not create upstream questions or waits before review and accepts normal post-settlement revision changes', async () => {
        await database(async ({ store }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const delegated = await db.mutate(
                a,
                {
                    type: 'delegate',
                    requestId: randomUUID(),
                    source,
                    recipientId: b.userId,
                    title: '白屏协作',
                    goal: '排查白屏',
                    context: '已知页面变成空白',
                },
                { recipientTask: task('排查白屏') }
            )
            const ownSource = { kind: 'task' as const, id: delegated.taskId! }
            await db.enqueue(b, { requestId: randomUUID(), source: ownSource, content: '帮我问上游缺少的错误信息' })
            const job = (await db.claim(30_000))!
            const node = (await db.node(b, delegated.nodeId!))!.node
            const draft = await db.propose(
                b,
                {
                    type: 'ask',
                    requestId: randomUUID(),
                    nodeId: node.id,
                    revision: node.revision,
                    targetNodeId: node.upstreamNodeId!,
                    question: '具体哪个按钮？',
                    context: '排查白屏需要准确复现入口',
                },
                { lease: job, authorKind: 'agent' }
            )
            expect((await db.notifications(a)).unread).toBe(0)
            expect((await db.node(b, node.id))!.questions).toHaveLength(1)
            expect((await db.node(b, node.id))!.node.status).toBe('running')
            await db.settle(job, { status: 'complete' })
            const asked = await db.mutate(b, confirm(draft))
            expect(asked.questionId).toBeDefined()
            expect((await db.node(b, node.id))!.node.status).toBe('waiting-upstream')
            expect((await db.notifications(a)).unread).toBe(1)
            expect((await db.sourceEvents(a, source)).events.find(event => event.id === asked.eventId)?.authorKind).toBe('agent')
        })
    }, 30_000)
    it('rolls back recipient opening, intent consumption, notification and confirmation together on database failure, then safely retries', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const { job } = await stagedMessage(db, a, source, b.userId)
            const goal = 'Investigate only after human approval'
            const proposed = await db.propose(
                a,
                {
                    type: 'delegate',
                    requestId: randomUUID(),
                    source,
                    recipientId: b.userId,
                    title: 'Pending work',
                    goal,
                    context: 'All reviewed context',
                },
                { lease: job, authorKind: 'agent' }
            )
            await db.settle(job, { status: 'complete' })
            const review = confirm(proposed)
            const recipientTask = task(goal)
            await pool.query(
                "CREATE FUNCTION fail_dispatch_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled confirmation persistence failure'; END $$"
            )
            await pool.query(
                'CREATE TRIGGER fail_dispatch_save BEFORE UPDATE ON harness_collaboration_state FOR EACH ROW EXECUTE FUNCTION fail_dispatch_save()'
            )
            await expect(db.mutate(a, review, { recipientTask })).rejects.toThrow('controlled confirmation persistence failure')
            expect(await store.get(b, recipientTask.id)).toBeUndefined()
            expect((await db.dispatch(a, proposed.draftId!))!.proposal.status).toBe('pending')
            expect((await db.sourceEvents(a, source)).pendingContact).not.toBeNull()
            expect((await db.notifications(b)).unread).toBe(0)
            expect(await db.projects(a)).toEqual([])
            await pool.query('DROP TRIGGER fail_dispatch_save ON harness_collaboration_state')
            await pool.query('DROP FUNCTION fail_dispatch_save()')
            const sent = await db.mutate(a, review, { recipientTask })
            expect(sent.taskId).toBe(recipientTask.id)
            expect((await db.notifications(b)).unread).toBe(1)
            expect((await db.sourceEvents(a, source)).pendingContact).toBeNull()
        })
    }, 30_000)

    it('cancels finished-turn proposals through their original request and rejects draft confirmation after project revocation', async () => {
        await database(async ({ store }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const delegated = await db.mutate(
                a,
                {
                    type: 'delegate',
                    requestId: randomUUID(),
                    source,
                    recipientId: b.userId,
                    title: 'Question context',
                    goal: 'Investigate',
                    context: 'Shared details',
                },
                { recipientTask: task('Investigate') }
            )
            const ownSource = { kind: 'task' as const, id: delegated.taskId! }
            const input = { requestId: randomUUID(), source: ownSource, content: 'Ask upstream which version fails' }
            await db.enqueue(b, input)
            const job = (await db.claim(30_000))!
            const node = (await db.node(b, delegated.nodeId!))!.node
            const ask = {
                type: 'ask' as const,
                requestId: randomUUID(),
                nodeId: node.id,
                revision: node.revision,
                targetNodeId: node.upstreamNodeId!,
                question: 'Which version fails?',
                context: 'Need the affected version',
            }
            const draft = await db.propose(b, ask, { lease: job, authorKind: 'agent' })
            await db.settle(job, { status: 'complete' })
            await db.cancelSource(b, ownSource, input.requestId)
            expect((await db.dispatch(b, draft.draftId!))!.proposal.status).toBe('cancelled')
            await expect(db.mutate(b, confirm(draft))).rejects.toBeInstanceOf(CollaborationConflictError)
            await db.enqueue(b, { ...input, requestId: randomUUID(), content: 'Prepare a fresh upstream question' })
            const newJob = (await db.claim(30_000))!
            const current = (await db.node(b, node.id))!.node
            const replacement = await db.propose(
                b,
                { ...ask, requestId: randomUUID(), revision: current.revision },
                { lease: newJob, authorKind: 'agent' }
            )
            await db.settle(newJob, { status: 'complete' })
            const project = (await db.project(a, delegated.projectId!))!
            await db.mutate(a, {
                type: 'revoke',
                requestId: randomUUID(),
                projectId: project.id,
                userId: b.userId,
                revision: project.revision,
            })
            expect((await db.dispatch(b, replacement.draftId!))!.proposal.status).toBe('cancelled')
            await expect(db.mutate(b, confirm(replacement))).rejects.toBeInstanceOf(CollaborationConflictError)
            expect((await db.notifications(a)).unread).toBe(0)
        })
    }, 30_000)
})
