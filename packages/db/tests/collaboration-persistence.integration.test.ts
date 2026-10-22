import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { AgentDefinition, ChatConversation, PersonalTask, CollaborationActionResult } from '@ai-harness/contracts'
import { createChatStore, CollaborationAccessError, CollaborationConflictError, CollaborationRateLimitError } from '../src/index.js'

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
 * Creates an explicit human review of the exact persisted Agent proposal.
 * @param result - Durable immutable proposal identity.
 * @returns The versioned confirmation command with no editable recipient or content.
 */
function confirmDispatch(result: CollaborationActionResult) {
    return { type: 'confirm-dispatch' as const, requestId: randomUUID(), draftId: result.draftId!, version: result.draftVersion! }
}

/**
 * Creates an ordinary private chat without Task metadata or model execution.
 * @param title - Receiver-visible chat title.
 * @returns An empty API-prepared Agent conversation.
 */
function dialogue(title: string): ChatConversation {
    const now = new Date().toISOString()
    return { id: randomUUID(), title, createdAt: now, updatedAt: now, messages: [], agent: agent('Receiver') }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('real PostgreSQL collaboration transactions', () => {
    it('opens confirmed handoffs as normal chats and persists questions and replies in both actual conversations', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, c, source } = await seed(store)
            const db = store.collaboration!
            await db.enqueue(a, {
                requestId: randomUUID(),
                source,
                content: 'Please investigate',
                mentions: [{ userId: b.userId, name: 'Person 1', start: 0, end: 1 }],
            })
            const ownerJob = (await db.claim(30_000))!
            const draft = await db.propose(
                a,
                {
                    type: 'delegate',
                    requestId: randomUUID(),
                    source,
                    recipientId: b.userId,
                    title: 'Investigate blank page',
                    goal: 'Find the broken sidebar route',
                    context: 'index file',
                },
                { authorKind: 'agent', lease: ownerJob }
            )
            expect(await store.list(b)).toHaveLength(0)
            await db.settle(ownerJob, { status: 'complete' })
            const command = confirmDispatch(draft)
            const prepared = dialogue('Investigate blank page')
            const sent = await db.mutate(a, command, { recipientConversation: prepared })
            expect(sent).toMatchObject({ conversationId: prepared.id, dispatchStatus: 'sent' })
            expect(sent.taskId).toBeUndefined()
            const receivedSource = { kind: 'conversation' as const, id: prepared.id }
            const received = (await store.get(b, prepared.id))!
            expect(received.task).toBeUndefined()
            expect(received.messages).toHaveLength(1)
            expect(received.messages[0]).toMatchObject({ id: sent.eventId, role: 'assistant', kind: 'opening' })
            expect(received.messages[0].content).toContain('Person 0')
            expect(received.messages[0].content).toContain('Find the broken sidebar route')
            expect(await store.get(a, prepared.id)).toBeUndefined()
            expect(await store.get(c, prepared.id)).toBeUndefined()
            expect((await store.list(b)).some(chat => chat.id === prepared.id && !chat.task)).toBe(true)
            expect((await db.notifications(b)).notifications[0].source).toEqual(receivedSource)
            expect(await db.claim(30_000)).toBeUndefined()
            expect(await db.mutate(a, command, { recipientConversation: dialogue('Unused retry') })).toEqual(sent)
            await db.enqueue(b, { requestId: randomUUID(), source: receivedSource, content: 'Ask which route is broken' })
            const worker = (await db.claim(30_000))!
            const node = (await db.node(b, sent.nodeId!))!.node
            expect(node.source).toEqual(receivedSource)
            const questionDraft = await db.propose(
                b,
                {
                    type: 'ask',
                    requestId: randomUUID(),
                    nodeId: node.id,
                    revision: node.revision,
                    targetNodeId: node.upstreamNodeId!,
                    question: 'Which sidebar entry?',
                    context: 'Need reproduction details',
                },
                { authorKind: 'agent', lease: worker }
            )
            await db.settle(worker, { status: 'complete', conversation: received })
            expect((await store.get(a, source.id))!.messages.some(message => message.content.includes('Which sidebar entry?'))).toBe(false)
            const asked = await db.mutate(b, confirmDispatch(questionDraft))
            expect((await store.get(a, source.id))!.messages.find(message => message.id === asked.eventId)).toMatchObject({
                kind: 'relay',
                content: expect.stringContaining('Person 1'),
            })
            for (const [scope, ownSource] of [
                [a, source],
                [b, receivedSource],
            ] as const) {
                await db.enqueue(scope, { requestId: randomUUID(), source: ownSource, content: '确认。继续讨论，但这不是问题答复。' })
                const discussion = (await db.claim(30_000))!
                expect(discussion.origin).toBe('human')
                expect(discussion.scope).toEqual(scope)
                expect(await db.claim(30_000)).toBeUndefined()
                expect((await db.node(b, node.id))!.questions.find(question => question.id === asked.questionId)!.status).toBe('pending')
                await db.settle(discussion, { status: 'complete' })
            }
            const answered = await db.mutate(a, {
                type: 'answer',
                requestId: randomUUID(),
                questionId: asked.questionId!,
                version: 1,
                content: 'The knowledge link',
                decision: 'information',
            })
            expect((await store.get(b, prepared.id))!.messages.find(message => message.id === answered.eventId)).toMatchObject({
                role: 'assistant',
                kind: 'relay',
                content: expect.stringContaining('The knowledge link'),
            })
            const continuation = (await db.claim(30_000))!
            expect(continuation.source).toEqual(receivedSource)
            expect(continuation.conversation.messages.some(message => message.id === answered.eventId)).toBe(true)
            await db.settle(continuation, { status: 'complete', conversation: received })
            expect((await store.get(b, prepared.id))!.messages.some(message => message.id === answered.eventId)).toBe(true)
            await pool.query(
                "UPDATE harness_chat_conversations SET messages=(SELECT jsonb_agg(message) FROM jsonb_array_elements(messages) message WHERE message->>'id'<>$4) WHERE workspace_id=$1 AND user_id=$2 AND id=$3",
                [a.workspaceId, a.userId, source.id, asked.eventId]
            )
            expect((await store.get(a, source.id))!.messages.some(message => message.id === asked.eventId)).toBe(false)
            const historicalProjection = await db.loadSource(a, source)
            expect(historicalProjection!.conversation.messages.find(message => message.id === asked.eventId)).toMatchObject({
                kind: 'relay',
                content: expect.stringContaining('Which sidebar entry?'),
            })
            expect(await db.loadSource(c, source)).toBeUndefined()
        })
    })

    it('delivers messages to normal chats, permits only the persisted correspondent reply, and preserves incoming messages across a live writer', async () => {
        await database(async ({ store, url }) => {
            const { a, b, c, source } = await seed(store)
            const db = store.collaboration!
            await db.enqueue(a, {
                requestId: randomUUID(),
                source,
                content: 'Tell B hello',
                mentions: [{ userId: b.userId, name: 'Person 1', start: 0, end: 1 }],
            })
            const first = (await db.claim(30_000))!
            const draft = await db.propose(
                a,
                { type: 'message', requestId: randomUUID(), source, recipientId: b.userId, content: 'Hello with exact original body' },
                { authorKind: 'agent', lease: first }
            )
            expect(await store.list(b)).toHaveLength(0)
            await db.settle(first, { status: 'complete' })
            const sent = await db.mutate(a, confirmDispatch(draft), { recipientConversation: dialogue('Message from Person 0') })
            const recipientSource = { kind: 'conversation' as const, id: sent.conversationId! }
            expect((await store.get(b, recipientSource.id))!.messages[0]).toMatchObject({
                id: sent.messageId,
                kind: 'opening',
                role: 'assistant',
                content: expect.stringContaining('Hello with exact original body'),
            })
            expect((await db.sourceEvents(b, recipientSource)).correspondent?.id).toBe(a.userId)
            expect((await db.sourceEvents(a, source)).correspondent?.id).toBe(b.userId)
            expect(await db.projects(b)).toHaveLength(0)
            expect(await db.claim(30_000)).toBeUndefined()
            await db.enqueue(a, { requestId: randomUUID(), source, content: 'Continue my own analysis' })
            const liveOwner = (await db.claim(30_000))!
            const staleConversation = liveOwner.conversation
            await db.enqueue(b, { requestId: randomUUID(), source: recipientSource, content: 'Reply to sender' })
            const replyOwner = (await db.claim(30_000))!
            await expect(
                db.propose(
                    b,
                    {
                        type: 'message',
                        requestId: randomUUID(),
                        source: recipientSource,
                        recipientId: c.userId,
                        content: 'Unrelated recipient',
                    },
                    { authorKind: 'agent', lease: replyOwner }
                )
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            const replyDraft = await db.propose(
                b,
                {
                    type: 'message',
                    requestId: randomUUID(),
                    source: recipientSource,
                    recipientId: a.userId,
                    content: 'Reply to the original sender',
                },
                { authorKind: 'agent', lease: replyOwner }
            )
            await db.settle(replyOwner, { status: 'complete' })
            const confirmation = confirmDispatch(replyDraft)
            const peer = await createChatStore({ databaseUrl: url })
            try {
                const replied = await peer.collaboration!.mutate(b, confirmation, {
                    recipientConversation: dialogue('Unused because source exists'),
                })
                expect(replied.conversationId).toBe(source.id)
                expect((await store.get(a, source.id))!.messages.find(message => message.id === replied.messageId)).toMatchObject({
                    kind: 'relay',
                    content: expect.stringContaining('Reply to the original sender'),
                })
                expect(await db.settle(liveOwner, { status: 'complete', conversation: staleConversation })).toBe(true)
                expect((await store.get(a, source.id))!.messages.filter(message => message.id === replied.messageId)).toHaveLength(1)
                expect(await peer.collaboration!.mutate(b, confirmation)).toEqual(replied)
                expect(await store.list(a)).toHaveLength(1)
                expect(await store.list(b)).toHaveLength(1)
                expect((await db.messages(a)).filter(message => message.content === 'Reply to the original sender')).toHaveLength(1)
            } finally {
                await peer.close()
            }
        })
    })

    it('restores historical unactivated invitations as normal chats without a model job', async () => {
        await database(async ({ store }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const invited = await db.mutate(a, {
                type: 'delegate',
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'Historical request',
                goal: 'Original request body',
                context: 'Original context',
            })
            const command = { type: 'activate' as const, requestId: randomUUID(), nodeId: invited.nodeId!, revision: 1 }
            const opened = await db.mutate(b, command, { openingOnly: true, recipientConversation: dialogue('Historical request') })
            expect(opened.conversationId).toBeDefined()
            expect(opened.taskId).toBeUndefined()
            expect((await store.get(b, opened.conversationId!))!.messages[0]).toMatchObject({
                id: invited.eventId,
                role: 'assistant',
                kind: 'opening',
                content: expect.stringContaining('Original request body'),
            })
            expect(await db.claim(30_000)).toBeUndefined()
            expect(await db.mutate(b, command, { openingOnly: true })).toEqual(opened)
        })
    })
    it('opens one recipient-owned Agent dialogue atomically without invoking or scheduling its model, and replays the original handoff', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, c, source } = await seed(store)
            const db = store.collaboration!
            const command = {
                type: 'delegate' as const,
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'Investigate the customer issue',
                goal: 'Find why the shared export fails',
                context: 'Authorized details: the customer sees error 42 on export.',
            }
            const recipientTask = task(command.goal)
            recipientTask.messages.push({
                id: randomUUID(),
                role: 'assistant',
                kind: 'opening',
                status: 'complete',
                content: 'API-created initial text must not replace the recorded sender or context.',
                createdAt: recipientTask.createdAt,
            })
            const delegated = await db.mutate(a, command, { recipientTask })
            expect(delegated.taskId).toBe(recipientTask.id)
            expect(await db.mutate(a, command, { recipientTask: task(command.goal) })).toEqual(delegated)
            const own = (await store.get(b, delegated.taskId!))!
            expect(own.messages).toHaveLength(1)
            expect(own.messages[0]).toMatchObject({ role: 'assistant', kind: 'opening', status: 'complete' })
            expect(own.messages[0].content).toContain('Person 0')
            expect(own.messages[0].content).toContain(command.title)
            expect(own.messages[0].content).toContain(command.goal)
            expect(own.messages[0].content).toContain(command.context)
            expect(own.messages[0].content).not.toContain('API-created initial text')
            expect(own.messages[0].content).not.toContain('UNRELATED PRIVATE HISTORY')
            expect(own.messages[0].content).not.toContain('PRIVATE PROMPT')
            expect(own.agent!.modelId).toBe(recipientTask.agent.modelId)
            expect(own.task).toMatchObject({ started: true, status: 'in-progress' })
            expect(await store.get(a, delegated.taskId!)).toBeUndefined()
            expect(await store.get(c, delegated.taskId!)).toBeUndefined()
            const detail = (await db.node(b, delegated.nodeId!))!
            expect(detail.node).toMatchObject({ status: 'ready', canActivate: false, canWork: true, source: { kind: 'task', id: own.id } })
            expect((await db.project(b, delegated.projectId!))!.members.find(member => member.id === b.userId)?.status).toBe('active')
            expect((await db.notifications(b)).notifications[0].source).toEqual({ kind: 'task', id: own.id })
            expect((await db.loadSource(b, { kind: 'task', id: own.id }))!.bound).toBe(true)
            expect(
                (await pool.query('SELECT count(*)::int AS count FROM harness_chat_conversations WHERE user_id=$1', [b.userId])).rows[0]
                    .count
            ).toBe(1)
            expect((await pool.query('SELECT count(*)::int AS count FROM harness_collaboration_jobs')).rows[0].count).toBe(0)
            expect(await db.claim(30_000)).toBeUndefined()
            expect(JSON.stringify(await db.project(a, delegated.projectId!))).not.toContain('PRIVATE PROMPT')
            const rolledBackTask = task(command.goal)
            await expect(db.mutate(a, { ...command, requestId: randomUUID() }, { recipientTask: rolledBackTask })).rejects.toBeInstanceOf(
                CollaborationConflictError
            )
            expect(await store.get(b, rolledBackTask.id)).toBeUndefined()
            expect((await db.notifications(b)).notifications).toHaveLength(1)

            const open = { type: 'activate' as const, requestId: randomUUID(), nodeId: delegated.nodeId!, revision: 999 }
            const opened = await db.mutate(b, open, { openingOnly: true })
            expect(opened.taskId).toBe(own.id)
            expect(await db.mutate(b, open, { openingOnly: true })).toEqual(opened)
            expect(await db.action(b, open.requestId)).toEqual(opened)
            await expect(db.mutate(a, { ...open, requestId: randomUUID() }, { openingOnly: true })).rejects.toBeInstanceOf(
                CollaborationAccessError
            )
            expect(await db.claim(30_000)).toBeUndefined()
        })
    }, 30_000)

    it('runs only after the recipient speaks and routes the Agent question and upstream reply back to the same private dialogue once', async () => {
        await database(async ({ store }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const goal = 'Investigate the missing export details'
            const delegated = await db.mutate(
                a,
                {
                    type: 'delegate',
                    requestId: randomUUID(),
                    source,
                    recipientId: b.userId,
                    title: 'Export collaboration',
                    goal,
                    context: 'Only the shared issue context.',
                },
                { recipientTask: task(goal) }
            )
            const ownSource = { kind: 'task' as const, id: delegated.taskId! }
            const firstInput = { requestId: randomUUID(), source: ownSource, content: 'Please ask upstream which account is affected.' }
            await db.enqueue(b, firstInput)
            const firstJob = (await db.claim(30_000))!
            expect(firstJob.scope).toEqual(b)
            expect(firstJob.source).toEqual(ownSource)
            expect(firstJob.origin).toBe('human')
            expect(firstJob.conversation.messages.map(message => message.role)).toEqual(['assistant', 'user'])
            const node = (await db.node(b, delegated.nodeId!))!.node
            const ask = {
                type: 'ask' as const,
                requestId: randomUUID(),
                nodeId: node.id,
                revision: node.revision,
                targetNodeId: node.upstreamNodeId!,
                question: 'Which account is affected?',
                context: 'Need this to investigate the export.',
            }
            const proposed = await db.propose(b, ask, { lease: firstJob, authorKind: 'agent' })
            expect(await db.propose(b, ask, { lease: firstJob, authorKind: 'agent' })).toEqual(proposed)
            expect(await db.settle(firstJob, { status: 'waiting' })).toBe(true)
            const asked = await db.mutate(b, confirmDispatch(proposed))
            expect((await db.node(b, node.id))!.node.status).toBe('waiting-upstream')
            const upstreamNotification = (await db.notifications(a)).notifications.find(item => item.questionId === asked.questionId)!
            expect(upstreamNotification.source).toEqual(source)
            expect(upstreamNotification.content).toContain(ask.question)
            expect(await db.claim(30_000)).toBeUndefined()
            const answer = {
                type: 'answer' as const,
                requestId: randomUUID(),
                questionId: asked.questionId!,
                version: 1,
                content: 'The affected account is Shared Customer 17.',
                decision: 'information' as const,
            }
            const answered = await db.mutate(a, answer)
            expect(await db.mutate(a, answer)).toEqual(answered)
            const continued = (await db.claim(30_000))!
            expect(continued.scope).toEqual(b)
            expect(continued.source).toEqual(ownSource)
            expect(continued.sessionId).toBe(firstJob.sessionId)
            expect(continued.origin).toBe('collaboration')
            expect(continued.content).toContain(answer.content)
            expect(continued.content).toContain('Person 0')
            expect(await db.settle(continued, { status: 'complete' })).toBe(true)
            expect(await db.claim(30_000)).toBeUndefined()
            expect((await db.node(b, node.id))!.questions.find(item => item.id === asked.questionId)?.status).toBe('answered')
        })
    }, 30_000)

    it('migrates historical pending handoffs to an attributed opening without a synthetic user turn, and opens them safely from concurrent windows', async () => {
        await database(async ({ store, url, pool }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const goal = 'Continue this historical handoff'
            const delegated = await db.mutate(a, {
                type: 'delegate',
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'Historical collaboration',
                goal,
                context: 'The recorded upstream handoff.',
            })
            const peer = await createChatStore({ databaseUrl: url })
            try {
                const opened = await Promise.all(
                    [db, peer.collaboration!].map(repository =>
                        repository.mutate(
                            b,
                            {
                                type: 'activate',
                                requestId: randomUUID(),
                                nodeId: delegated.nodeId!,
                                revision: 1,
                            },
                            { task: task(goal), openingOnly: true }
                        )
                    )
                )
                expect(opened[0].taskId).toBe(opened[1].taskId)
                const own = (await store.get(b, opened[0].taskId!))!
                expect(own.messages).toHaveLength(1)
                expect(own.messages[0]).toMatchObject({ role: 'assistant', kind: 'opening' })
                expect(own.messages[0].content).toContain('Person 0')
                expect(own.messages[0].content).toContain('The recorded upstream handoff.')
                expect(own.activeRequestId).toBeUndefined()
                expect((await db.notifications(b)).notifications[0].source).toEqual({ kind: 'task', id: own.id })
                expect(
                    (await pool.query('SELECT count(*)::int AS count FROM harness_chat_conversations WHERE user_id=$1', [b.userId])).rows[0]
                        .count
                ).toBe(1)
                expect(await db.claim(30_000)).toBeUndefined()
                const project = (await db.project(a, delegated.projectId!))!
                await db.mutate(a, {
                    type: 'revoke',
                    requestId: randomUUID(),
                    projectId: project.id,
                    revision: project.revision,
                    userId: b.userId,
                })
                await expect(
                    db.mutate(
                        b,
                        {
                            type: 'activate',
                            requestId: randomUUID(),
                            nodeId: delegated.nodeId!,
                            revision: 1,
                        },
                        { openingOnly: true }
                    )
                ).rejects.toBeInstanceOf(CollaborationAccessError)
            } finally {
                await peer.close()
            }
        })
    }, 30_000)

    it('carries one unconsumed contact through clarification, rejects duplicate snapshots and replays refreshed requests without re-resolving names', async () => {
        await database(async ({ store }) => {
            const { a, b, c, source } = await seed(store)
            const db = store.collaboration!
            const mentions = [{ userId: b.userId, name: 'Person 1', start: 0, end: 9 }]
            const initial = randomUUID()
            await db.enqueue(a, { requestId: initial, source, content: '@Person 1 please assess the incomplete plan', mentions })
            const clarifying = (await db.claim(30_000))!
            await db.settle(clarifying, { status: 'complete' })
            expect((await db.sourceEvents(a, source)).pendingContact?.requestId).toBe(initial)
            const secondId = randomUUID()
            const thirdId = randomUUID()
            await db.enqueue(a, { requestId: secondId, source, content: 'Here is the missing scale.' })
            await db.enqueue(a, { requestId: thirdId, source, content: 'And the deadline.' })
            const second = (await db.claim(30_000))!
            expect(second.mentions).toEqual(mentions)
            const message = {
                type: 'message' as const,
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                content: 'The completed plan',
            }
            await db.propose(a, message, { lease: second, authorKind: 'agent' })
            await db.settle(second, { status: 'failed', error: 'post-effect journal boundary' })
            await db.enqueue(a, { requestId: secondId, source, content: 'Here is the missing scale.' })
            const restored = (await db.claim(30_000))!
            expect(restored.id).toBe(second.id)
            expect(restored.mentions).toEqual(mentions)
            expect(await db.propose(a, message, { lease: restored, authorKind: 'agent' })).toEqual((await db.effects(restored))[0].result)
            await db.settle(restored, { status: 'complete' })
            const third = (await db.claim(30_000))!
            expect(third.triggerId).toBe(thirdId)
            expect(third.mentions).toEqual(mentions)
            const latestProposal = await db.propose(a, { ...message, requestId: randomUUID() }, { lease: third, authorKind: 'agent' })
            await db.settle(third, { status: 'complete' })
            await db.mutate(a, confirmDispatch(latestProposal))
            expect(await db.messages(b)).toHaveLength(1)
            expect((await db.sourceEvents(a, source)).pendingContact).toBeNull()
            const explicitId = randomUUID()
            await db.enqueue(a, { requestId: explicitId, source, content: '@Person 1 more work', mentions })
            const explicit = (await db.claim(30_000))!
            await db.settle(explicit, { status: 'failed', error: 'clarification failed' })
            expect((await db.enqueue(a, { requestId: explicitId, source, content: '@Person 1 more work' })).jobId).toBe(explicit.id)
            await expect(
                db.enqueue(a, { requestId: explicitId, source, content: '@Person 1 more work', mentions: [] })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            const retried = (await db.claim(30_000))!
            expect(retried.mentions).toEqual(mentions)
            await db.settle(retried, { status: 'complete' })
            const replaceId = randomUUID()
            const cMentions = [{ userId: c.userId, name: 'Person 2', start: 0, end: 9 }]
            await db.enqueue(a, { requestId: replaceId, source, content: '@Person 2 another explicit contact', mentions: cMentions })
            const replacement = (await db.claim(30_000))!
            expect(replacement.mentions).toEqual(cMentions)
            const replacementProposal = await db.propose(
                a,
                { type: 'message', requestId: randomUUID(), source, recipientId: c.userId, content: 'Only C' },
                { lease: replacement, authorKind: 'agent' }
            )
            await db.settle(replacement, { status: 'complete' })
            await db.mutate(a, confirmDispatch(replacementProposal))
            await db.enqueue(a, { requestId: randomUUID(), source, content: 'A plain follow-up must not resurrect older B' })
            const plain = (await db.claim(30_000))!
            expect(plain.mentions).toEqual([])
            await db.settle(plain, { status: 'complete' })
            const cancelId = randomUUID()
            await db.enqueue(a, { requestId: cancelId, source, content: '@Person 1 needs clarification again', mentions })
            const pending = (await db.claim(30_000))!
            await db.settle(pending, { status: 'complete' })
            await db.cancelSource(a, source, cancelId)
            expect((await db.sourceEvents(a, source)).pendingContact).toBeNull()
            await db.enqueue(a, { requestId: randomUUID(), source, content: 'Do not contact the cancelled person' })
            const cancelledPlain = (await db.claim(30_000))!
            expect(cancelledPlain.mentions).toEqual([])
            await db.settle(cancelledPlain, { status: 'complete' })
            await db.enqueue(a, { requestId: randomUUID(), source, content: '@Person 1 a new pending contact', mentions })
            const toClear = (await db.claim(30_000))!
            await db.settle(toClear, { status: 'complete' })
            await db.enqueue(a, { requestId: randomUUID(), source, content: 'Explicitly clear contacts', mentions: [] })
            const cleared = (await db.claim(30_000))!
            expect(cleared.mentions).toEqual([])
            await db.settle(cleared, { status: 'complete' })
            expect((await db.sourceEvents(a, source)).pendingContact).toBeNull()
            await db.enqueue(a, { requestId: randomUUID(), source, content: 'No older contact should return' })
            const afterClear = (await db.claim(30_000))!
            expect(afterClear.mentions).toEqual([])
            await db.settle(afterClear, { status: 'complete' })
        })
    }, 30_000)

    it('attaches queued turns to a new root and fairly claims another source beyond twenty blocked background continuations', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, c, source, original } = await seed(store)
            const db = store.collaboration!
            const mentions = [{ userId: b.userId, name: 'Person 1', start: 0, end: 9 }]
            await db.enqueue(a, { requestId: randomUUID(), source, content: '@Person 1 evaluate', mentions })
            const first = (await db.claim(30_000))!
            await db.settle(first, { status: 'complete' })
            await db.enqueue(a, { requestId: randomUUID(), source, content: 'The needed details' })
            for (let index = 0; index < 21; index += 1)
                await db.enqueue(a, { requestId: randomUUID(), source, content: `Queued supplement ${index}` })
            const current = (await db.claim(30_000))!
            await db.mutate(
                a,
                {
                    type: 'delegate',
                    requestId: randomUUID(),
                    source,
                    recipientId: b.userId,
                    title: 'One matter',
                    goal: 'Please assess',
                    context: 'Enough facts now',
                },
                {}
            )
            await db.settle(current, { status: 'waiting' })
            expect(
                (
                    await pool.query(
                        "SELECT node_id FROM harness_collaboration_jobs WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3 AND status='queued'",
                        [a.workspaceId, a.userId, source.id]
                    )
                ).rows.every(row => row.node_id)
            ).toBe(true)
            // Internal continuations remain blocked by the unresolved dependency; explicit owner input is tested separately.
            await pool.query(
                "UPDATE harness_collaboration_jobs SET origin='collaboration' WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3 AND status='queued'",
                [a.workspaceId, a.userId, source.id]
            )
            expect(await db.claim(30_000)).toBeUndefined()
            const otherSource = { kind: 'conversation' as const, id: randomUUID() }
            await store.save(c, { ...original, id: otherSource.id, agent: agent('C') })
            await db.enqueue(c, { requestId: randomUUID(), source: otherSource, content: 'Independent ready work' })
            const ready = (await db.claim(30_000))!
            expect(ready.scope).toEqual(c)
            expect(ready.source).toEqual(otherSource)
            await db.settle(ready, { status: 'complete' })
            expect(await db.claim(30_000)).toBeUndefined()
        })
    }, 30_000)

    it('retains and authorizes node event pages beyond the initial fifty with exact event anchors', async () => {
        await database(async ({ store }) => {
            const { a, b, c, source } = await seed(store)
            const db = store.collaboration!
            const delegated = await db.mutate(a, {
                type: 'delegate',
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'Long work',
                goal: 'Review',
                context: 'Shared',
            })
            const root = (await db.sourceEvents(a, source)).nodes[0]
            for (let index = 0; index < 110; index += 1) {
                const current = (await db.node(a, root.id))!.node
                await db.mutate(a, {
                    type: 'publish',
                    requestId: randomUUID(),
                    nodeId: root.id,
                    revision: current.revision,
                    title: `Result ${index}`,
                    content: `Retained original ${index}`,
                })
            }
            expect((await db.node(a, root.id))!.events).toHaveLength(50)
            const first = await db.nodeEvents(a, root.id)
            expect(first.events).toHaveLength(50)
            expect(first.hasMore).toBe(true)
            const second = await db.nodeEvents(a, root.id, first.nextCursor)
            expect(second.events).toHaveLength(50)
            const third = await db.nodeEvents(a, root.id, second.nextCursor)
            expect(third.events).toHaveLength(11)
            expect(third.hasMore).toBe(false)
            const anchor = third.events.at(-1)!
            expect((await db.nodeEvents(a, root.id, 0, anchor.id)).events[0].id).toBe(anchor.id)
            await expect(db.nodeEvents(c, root.id, 0, anchor.id)).rejects.toBeInstanceOf(CollaborationAccessError)
            expect((await db.nodeEvents(b, delegated.nodeId!)).events).toHaveLength(1)
            expect((await db.notifications(b)).authorizedProjectIds).toContain(delegated.projectId)
            const project = (await db.project(a, delegated.projectId!))!
            await db.mutate(a, {
                type: 'revoke',
                requestId: randomUUID(),
                projectId: project.id,
                userId: b.userId,
                revision: project.revision,
            })
            expect((await db.notifications(b)).authorizedProjectIds).not.toContain(project.id)
        })
    }, 30_000)

    it('repairs only the owner model snapshot while retrying the same failed job and committed effects', async () => {
        await database(async ({ store }) => {
            const { a, b, source, original } = await seed(store)
            const db = store.collaboration!
            const delegated = await db.mutate(a, {
                type: 'delegate',
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'Model repair',
                goal: 'Review with my own model',
                context: 'Scoped work',
            })
            const ownTask = task('Review with my own model')
            await db.mutate(b, { type: 'activate', requestId: randomUUID(), nodeId: delegated.nodeId!, revision: 1 }, { task: ownTask })
            const job = (await db.claim(30_000))!
            const node = (await db.node(b, delegated.nodeId!))!.node
            const judgmentCommand = {
                type: 'ask' as const,
                requestId: randomUUID(),
                nodeId: node.id,
                revision: node.revision,
                targetNodeId: node.id,
                question: '请本人判断是否继续此版本。',
                context: 'Must remain a single exact owner judgment after model repair',
            }
            const judgment = await db.mutate(b, judgmentCommand, { lease: job, authorKind: 'agent' })
            await db.settle(job, { status: 'failed', error: 'old model route unavailable' })
            const failed = (await db.node(b, node.id))!.node
            const replacement = agent('B replacement')
            const repair = {
                type: 'retry' as const,
                requestId: randomUUID(),
                nodeId: node.id,
                revision: failed.revision,
                useDefaultModel: true as const,
            }
            const repaired = await db.mutate(b, repair, { agent: replacement })
            expect(await db.mutate(b, repair, { agent: replacement })).toEqual(repaired)
            expect((await store.get(b, ownTask.id))!.agent!.modelId).toBe(replacement.modelId)
            expect((await store.get(a, original.id))!.agent!.modelId).toBe(original.agent!.modelId)
            const recovered = (await db.claim(30_000))!
            expect(recovered.id).toBe(job.id)
            expect(recovered.triggerId).toBe(job.triggerId)
            expect(await db.effects(recovered)).toHaveLength(1)
            expect((await db.effects(recovered))[0].result).toEqual(judgment)
            expect(await db.mutate(b, judgmentCommand, { lease: recovered, authorKind: 'agent' })).toEqual(judgment)
            expect(recovered.conversation.agent!.name).toBe('B replacement')
            const afterRepair = (await db.node(b, node.id))!
            expect(afterRepair.questions.filter(question => question.id === judgment.questionId)).toHaveLength(1)
            expect(afterRepair.questions.find(question => question.id === judgment.questionId)).toMatchObject({
                status: 'pending',
                answer: null,
            })
            expect(afterRepair.events.filter(event => event.id === judgment.eventId)).toHaveLength(1)
            expect((await db.project(a, delegated.projectId!))!.artifacts).toHaveLength(0)
            expect(JSON.stringify(await db.project(a, delegated.projectId!))).not.toContain('PRIVATE PROMPT')
            await db.settle(recovered, { status: 'complete' })
        })
    }, 30_000)

    it('rolls back message/read/answer and journal/job mutations on real PostgreSQL write failures, then replays original actions', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, source, original } = await seed(store)
            const db = store.collaboration!
            const delegated = await db.mutate(a, {
                type: 'delegate',
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'Fault-bound review',
                goal: 'Need a human decision',
                context: 'Scoped preceding work',
            })
            const initialNotifications = await db.notifications(b)
            const initialState = (await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [a.workspaceId]))
                .rows[0].data
            const message = { type: 'message' as const, requestId: randomUUID(), recipientId: b.userId, content: 'atomic message' }
            const read = {
                type: 'read' as const,
                requestId: randomUUID(),
                notificationIds: initialNotifications.notifications.map(notification => notification.id),
                messageIds: [],
            }
            const answer = {
                type: 'answer' as const,
                requestId: randomUUID(),
                questionId: delegated.questionId!,
                version: 1,
                content: 'A real human answer',
                decision: 'information' as const,
            }
            const suffix = randomUUID().replaceAll('-', '')
            await pool.query(
                `CREATE FUNCTION sf014_state_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled state write failure'; END $$`
            )
            await pool.query(
                `CREATE TRIGGER sf014_state_failure_${suffix} BEFORE UPDATE ON harness_collaboration_state FOR EACH ROW EXECUTE FUNCTION sf014_state_failure_${suffix}()`
            )
            await expect(db.mutate(a, message)).rejects.toThrow('controlled state write failure')
            await expect(db.mutate(b, read)).rejects.toThrow('controlled state write failure')
            await expect(db.mutate(b, answer)).rejects.toThrow('controlled state write failure')
            expect(
                (await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [a.workspaceId])).rows[0].data
            ).toEqual(initialState)
            expect(await db.messages(b)).toEqual([])
            expect((await db.notifications(b)).unread).toBe(initialNotifications.unread)
            expect((await db.node(b, delegated.nodeId!))!.questions.find(question => question.id === delegated.questionId)!.status).toBe(
                'pending'
            )
            expect(await db.action(a, message.requestId)).toBeUndefined()
            expect(await db.action(b, read.requestId)).toBeUndefined()
            expect(await db.action(b, answer.requestId)).toBeUndefined()
            expect((await pool.query('SELECT count(*) FROM harness_collaboration_jobs')).rows[0].count).toBe('0')
            await pool.query(`DROP TRIGGER sf014_state_failure_${suffix} ON harness_collaboration_state`)
            await pool.query(`DROP FUNCTION sf014_state_failure_${suffix}()`)
            const sent = await db.mutate(a, message)
            const readResult = await db.mutate(b, read)
            const answered = await db.mutate(b, answer)
            expect(await db.mutate(a, message)).toEqual(sent)
            expect(await db.mutate(b, read)).toEqual(readResult)
            expect(await db.mutate(b, answer)).toEqual(answered)
            expect(await db.messages(b)).toHaveLength(1)
            expect((await db.notifications(b)).unread).toBe(1)
            expect((await pool.query('SELECT count(*) FROM harness_collaboration_jobs')).rows[0].count).toBe('1')
            const job = (await db.claim(30_000))!
            expect(job.scope).toEqual(a)
            await db.createJournal(job, { id: job.sessionId }, 0)
            await pool.query(
                `CREATE FUNCTION sf014_source_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled source write failure'; END $$`
            )
            await pool.query(
                `CREATE TRIGGER sf014_source_failure_${suffix} BEFORE UPDATE ON harness_collaboration_sources FOR EACH ROW EXECUTE FUNCTION sf014_source_failure_${suffix}()`
            )
            await expect(db.appendJournal(job, [{ type: 'test', seq: 0 }])).rejects.toThrow('controlled source write failure')
            const projection = {
                ...job.conversation,
                messages: [
                    ...job.conversation.messages,
                    {
                        id: randomUUID(),
                        role: 'assistant' as const,
                        content: 'Must not be visible',
                        status: 'complete' as const,
                        createdAt: new Date().toISOString(),
                    },
                ],
            }
            await expect(db.settle(job, { status: 'complete', conversation: projection })).rejects.toThrow(
                'controlled source write failure'
            )
            await expect(db.release(job)).rejects.toThrow('controlled source write failure')
            expect((await db.readJournal(job))!.events).toEqual([])
            expect((await store.get(a, original.id))!.messages).toEqual(job.conversation.messages)
            expect((await pool.query('SELECT status FROM harness_collaboration_jobs WHERE id=$1', [job.id])).rows[0].status).toBe('running')
            await pool.query(`DROP TRIGGER sf014_source_failure_${suffix} ON harness_collaboration_sources`)
            await pool.query(`DROP FUNCTION sf014_source_failure_${suffix}()`)
            expect(await db.release(job)).toBe(true)
            const recovered = (await db.claim(30_000))!
            expect(recovered.id).toBe(job.id)
            expect(recovered.attempt).toBe(job.attempt + 1)
            await db.appendJournal(recovered, [{ type: 'test', seq: 0 }])
            expect(await db.settle(recovered, { status: 'complete' })).toBe(true)
            expect(await db.claim(30_000)).toBeUndefined()
        })
    }, 30_000)

    it('paginates older messages and notifications without dropping history or marking new arrivals read', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, c } = await seed(store)
            const db = store.collaboration!
            let threadId = ''
            for (let index = 0; index < 120; index += 1) {
                if (index === 60)
                    await pool.query(
                        "UPDATE harness_collaboration_rate_limits SET expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND user_id=$2 AND kind='send'",
                        [a.workspaceId, a.userId]
                    )
                const result = await db.mutate(a, {
                    type: 'message',
                    requestId: randomUUID(),
                    recipientId: b.userId,
                    content: `Message ${index}`,
                })
                threadId = result.threadId!
            }
            const recentMessages = await db.messages(b, threadId)
            expect(recentMessages).toHaveLength(100)
            expect(recentMessages[0].content).toBe('Message 20')
            const olderMessages = await db.messages(b, threadId, recentMessages[0].sequence)
            expect(olderMessages.map(message => message.content)).toEqual(Array.from({ length: 20 }, (_, index) => `Message ${index}`))
            const recentNotifications = await db.notifications(b)
            expect(recentNotifications.unread).toBe(120)
            expect(recentNotifications.notifications).toHaveLength(100)
            const olderNotifications = await db.notifications(b, recentNotifications.notifications[0].sequence)
            expect(olderNotifications.notifications).toHaveLength(20)
            expect(olderNotifications.unread).toBe(120)
            await pool.query(
                "UPDATE harness_collaboration_rate_limits SET expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND user_id=$2 AND kind='send'",
                [a.workspaceId, a.userId]
            )
            await db.mutate(a, { type: 'message', requestId: randomUUID(), recipientId: b.userId, content: 'New arrival' })
            await db.mutate(b, {
                type: 'read',
                requestId: randomUUID(),
                notificationIds: recentNotifications.notifications.map(notification => notification.id),
                messageIds: [],
            })
            expect((await db.notifications(b)).unread).toBe(21)
            expect(await db.messages(c, threadId, recentMessages[0].sequence)).toEqual([])
            expect((await db.notifications(c, recentNotifications.notifications[0].sequence)).notifications).toEqual([])
            await expect(db.messages(b, threadId, 0)).rejects.toBeInstanceOf(CollaborationConflictError)
            const stored = (await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [a.workspaceId])).rows[0]
                .data
            expect(stored.messages).toHaveLength(121)
            expect(stored.notifications).toHaveLength(121)
        })
    }, 30_000)

    it('persists search/send limits across stores, does not recharge replays, and fences exact source cancellation', async () => {
        await database(async ({ store, pool, url }) => {
            const { a, b, source, original } = await seed(store)
            const db = store.collaboration!
            await pool.query(
                "INSERT INTO harness_collaboration_rate_limits(workspace_id,user_id,kind,attempts,expires_at) VALUES($1,$2,'people',60,clock_timestamp()+interval '1 minute')",
                [a.workspaceId, a.userId]
            )
            await expect(db.people(a, 'Person')).rejects.toBeInstanceOf(CollaborationRateLimitError)
            const reopened = await createChatStore({ databaseUrl: url })
            try {
                await expect(reopened.collaboration!.people(a, 'Person')).rejects.toBeInstanceOf(CollaborationRateLimitError)
            } finally {
                await reopened.close()
            }
            expect((await db.people(b, 'Person 0'))[0].id).toBe(a.userId)
            await pool.query(
                "INSERT INTO harness_collaboration_rate_limits(workspace_id,user_id,kind,attempts,expires_at) VALUES($1,$2,'send',59,clock_timestamp()+interval '1 minute')",
                [a.workspaceId, a.userId]
            )
            const message = { type: 'message' as const, requestId: randomUUID(), recipientId: b.userId, content: 'limited original' }
            const sent = await db.mutate(a, message)
            expect(await db.mutate(a, message)).toEqual(sent)
            await expect(db.mutate(a, { ...message, requestId: randomUUID() })).rejects.toBeInstanceOf(CollaborationRateLimitError)
            expect(await db.messages(b)).toHaveLength(1)
            const ordinaryId = randomUUID()
            const reserved = await db.reserveSource(a, source, ordinaryId, 30_000)
            await expect(db.cancelSource(a, source, randomUUID())).rejects.toBeInstanceOf(CollaborationConflictError)
            await db.cancelSource(a, source, ordinaryId)
            await expect(db.saveSource(a, source, original, reserved.revision, reserved.token)).rejects.toBeInstanceOf(
                CollaborationConflictError
            )
            const requestId = randomUUID()
            await db.enqueue(a, { requestId, source, content: 'Queued work' })
            const work = (await db.claim(30_000))!
            await expect(db.cancelSource(a, source, randomUUID())).rejects.toBeInstanceOf(CollaborationConflictError)
            await db.cancelSource(a, source, requestId)
            expect(await db.settle(work, { status: 'complete' })).toBe(false)
            expect((await db.loadSource(a, source))!.conversation.activeRequestId).toBeUndefined()
        })
    }, 30_000)

    it('allows a model-free pending assignee to answer or reject and expires waits only once', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const delegated = await db.mutate(a, {
                type: 'delegate',
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'Human review',
                goal: 'Please decide',
                context: 'Scoped context',
            })
            const replied = await db.mutate(b, {
                type: 'answer',
                requestId: randomUUID(),
                questionId: delegated.questionId!,
                version: 1,
                content: 'Not feasible',
                decision: 'rejected',
            })
            expect(replied.questionId).toBe(delegated.questionId)
            expect((await db.node(b, delegated.nodeId!))!.node.source).toBeNull()
            expect(await db.claim(30_000)).toBeUndefined()
            await db.mutate(b, { type: 'cancel', requestId: randomUUID(), nodeId: delegated.nodeId!, revision: 1 })
            const root = (await db.sourceEvents(a, source)).nodes[0]
            await db.mutate(a, {
                type: 'revise',
                requestId: randomUUID(),
                nodeId: root.id,
                revision: root.revision,
                goal: 'Revised',
                context: 'More facts',
            })
            const revised = (await db.claim(30_000))!
            expect(revised.scope).toEqual(a)
            await db.settle(revised, { status: 'complete' })
            const rootNow = (await db.sourceEvents(a, source)).nodes[0]
            const asked = await db.mutate(a, {
                type: 'ask',
                requestId: randomUUID(),
                nodeId: rootNow.id,
                revision: rootNow.revision,
                targetNodeId: rootNow.id,
                question: '本人确认？',
                context: '',
            })
            const stored = (await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [a.workspaceId])).rows[0]
                .data
            stored.questions[asked.questionId!].createdAt = new Date(0).toISOString()
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                a.workspaceId,
                JSON.stringify(stored),
            ])
            expect(await db.expireQuestions(1000)).toBe(1)
            const unread = (await db.notifications(a)).unread
            expect(await db.expireQuestions(1000)).toBe(0)
            expect((await db.notifications(a)).unread).toBe(unread)
            await expect(
                db.mutate(a, {
                    type: 'answer',
                    requestId: randomUUID(),
                    questionId: asked.questionId!,
                    version: 1,
                    content: 'late',
                    decision: 'approved',
                })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
        })
    }, 30_000)

    it('recovers the same effect slots after failure and atomically rolls back failed notifications', async () => {
        await database(async ({ store, pool, url }) => {
            const { a, b, source } = await seed(store)
            const db = store.collaboration!
            const requestId = randomUUID()
            const mentions = [{ userId: b.userId, name: 'Person 1', start: 0, end: 9 }]
            const accepted = await db.enqueue(a, { requestId, source, content: 'Tell B the original message.', mentions })
            const job = (await db.claim(30_000))!
            const message = {
                type: 'message' as const,
                requestId: randomUUID(),
                recipientId: b.userId,
                content: '  原文\n标点。  ',
                source,
            }
            const staged = await db.propose(a, message, { lease: job, authorKind: 'agent' })
            expect(await db.settle(job, { status: 'failed', error: 'controlled post-effect failure' })).toBe(true)
            expect(await db.enqueue(a, { requestId, source, content: 'Tell B the original message.', mentions })).toEqual(accepted)
            const recovered = (await db.claim(30_000))!
            expect(recovered.id).toBe(job.id)
            expect((await db.effects(recovered))[0].slotId).toBe(message.requestId)
            await db.propose(a, message, { lease: recovered, authorKind: 'agent' })
            expect(await db.messages(b)).toHaveLength(0)
            await db.settle(recovered, { status: 'complete' })
            await db.mutate(a, confirmDispatch(staged))
            expect(await db.messages(b)).toHaveLength(1)
            expect((await db.messages(b))[0].content).toBe('  原文\n标点。  ')
            const notifications = await db.notifications(b)
            expect(notifications.unread).toBe(1)
            await db.mutate(b, {
                type: 'read',
                requestId: randomUUID(),
                notificationIds: notifications.notifications.map(item => item.id),
                messageIds: [],
            })
            expect((await db.notifications(b)).unread).toBe(0)
            await db.settle(recovered, { status: 'complete' })
            const stateBefore = (await pool.query('SELECT data FROM harness_collaboration_state')).rows[0].data
            const suffix = randomUUID().replaceAll('-', '')
            await pool.query(
                `CREATE FUNCTION sf014_fail_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled transaction failure'; END $$`
            )
            await pool.query(
                `CREATE TRIGGER sf014_fail_${suffix} BEFORE UPDATE ON harness_collaboration_state FOR EACH ROW EXECUTE FUNCTION sf014_fail_${suffix}()`
            )
            const failed = {
                type: 'delegate' as const,
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'rollback',
                goal: 'rollback',
                context: '',
            }
            await expect(db.mutate(a, failed)).rejects.toThrow('controlled transaction failure')
            expect((await pool.query('SELECT data FROM harness_collaboration_state')).rows[0].data).toEqual(stateBefore)
            expect(await db.action(a, failed.requestId)).toBeUndefined()
            expect((await pool.query('SELECT count(*) FROM harness_personal_projects')).rows[0].count).toBe('0')
            await pool.query(`DROP TRIGGER sf014_fail_${suffix} ON harness_collaboration_state`)
            await pool.query(`DROP FUNCTION sf014_fail_${suffix}()`)
            const reopened = await createChatStore({ databaseUrl: url })
            try {
                expect(await reopened.collaboration!.messages(b)).toHaveLength(1)
                expect((await reopened.collaboration!.notifications(b)).unread).toBe(0)
            } finally {
                await reopened.close()
            }
        })
    }, 30_000)

    it('keeps shared projects separate from private Tasks, supports own-Agent activation and precise upstream answers', async () => {
        await database(async ({ store }) => {
            const { a, b, c, d, original, source } = await seed(store)
            const db = store.collaboration!
            const command = {
                type: 'delegate' as const,
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: '评估方案',
                goal: '评估方案并给出结论',
                context: 'SHARED SCOPED REPORT',
            }
            const delegated = await db.mutate(a, command)
            expect(await db.mutate(a, command)).toEqual(delegated)
            await expect(db.mutate(a, { ...command, goal: 'different' })).rejects.toBeInstanceOf(CollaborationConflictError)
            await expect(db.mutate(a, { ...command, requestId: randomUUID(), recipientId: d.userId })).rejects.toBeInstanceOf(
                CollaborationAccessError
            )
            expect(await db.projects(c)).toEqual([])
            expect(JSON.stringify(await db.project(b, delegated.projectId!))).not.toContain('PRIVATE PROMPT')
            expect(JSON.stringify(await db.project(b, delegated.projectId!))).not.toContain('UNRELATED PRIVATE HISTORY')
            expect((await db.node(b, delegated.nodeId!))!.node.canActivate).toBe(true)
            expect(await db.claim(30_000)).toBeUndefined()
            const ownTask = task(command.goal)
            await db.mutate(b, { type: 'activate', requestId: randomUUID(), nodeId: delegated.nodeId!, revision: 1 }, { task: ownTask })
            expect((await store.get(b, ownTask.id))!.agent!.name).toBe('B')
            expect(await store.get(a, ownTask.id)).toBeUndefined()
            const work = (await db.claim(30_000))!
            expect(work.scope).toEqual(b)
            expect(work.origin).toBe('collaboration')
            const root = (await db.project(a, delegated.projectId!))!.nodes.find(node => node.ownerId === a.userId)!
            const node = (await db.node(b, delegated.nodeId!))!.node
            const ask = {
                type: 'ask' as const,
                requestId: randomUUID(),
                nodeId: node.id,
                revision: node.revision,
                targetNodeId: root.id,
                question: '实际使用规模？',
                context: '需要容量数据',
            }
            const proposedQuestion = await db.propose(b, ask, { lease: work, authorKind: 'agent' })
            expect(await db.propose(b, ask, { lease: work, authorKind: 'agent' })).toEqual(proposedQuestion)
            expect((await db.effects(work))[0].slotId).toBe(ask.requestId)
            expect(await db.release(work)).toBe(true)
            const recoveringWait = (await db.claim(30_000))!
            expect(recoveringWait.id).toBe(work.id)
            expect(recoveringWait.attempt).toBe(work.attempt + 1)
            expect((await db.effects(recoveringWait))[0].slotId).toBe(ask.requestId)
            await db.settle(recoveringWait, { status: 'waiting' })
            const questioned = await db.mutate(b, confirmDispatch(proposedQuestion))
            const aEvents = await db.sourceEvents(a, source)
            expect(aEvents.events.some(event => event.questionId === questioned.questionId)).toBe(true)
            await expect(
                db.mutate(c, {
                    type: 'answer',
                    requestId: randomUUID(),
                    questionId: questioned.questionId!,
                    version: 1,
                    content: 'forged',
                    decision: 'information',
                })
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            const answer = {
                type: 'answer' as const,
                requestId: randomUUID(),
                questionId: questioned.questionId!,
                version: 1,
                content: '每日一万次',
                decision: 'information' as const,
            }
            const answered = await db.mutate(a, answer)
            expect(await db.mutate(a, answer)).toEqual(answered)
            const next = (await db.claim(30_000))!
            expect(next.nodeId).toBe(node.id)
            expect(next.scope).toEqual(b)
            expect(next.content).toContain('每日一万次')
            expect((await store.get(b, ownTask.id))!.messages.filter(message => message.role === 'user')).toHaveLength(1)
            const originalWithReplies = (await store.get(a, original.id))!.messages
            expect(originalWithReplies.filter(message => !message.kind)).toEqual(original.messages)
            expect(originalWithReplies.find(message => message.id === questioned.eventId)).toMatchObject({
                kind: 'relay',
                content: expect.stringContaining('实际使用规模？'),
            })
            expect(originalWithReplies.find(message => message.id === answered.eventId)).toMatchObject({
                kind: 'relay',
                content: expect.stringContaining('每日一万次'),
            })
            await db.settle(next, { status: 'complete' })
            expect(await db.claim(30_000)).toBeUndefined()
        })
    }, 30_000)

    it('fences stale source writes, canonical logs and running jobs on revocation without deleting private ownership', async () => {
        await database(async ({ store, pool }) => {
            const { a, b, source, original } = await seed(store)
            const db = store.collaboration!
            const before = (await db.loadSource(a, source))!
            const delegated = await db.mutate(a, {
                type: 'delegate',
                requestId: randomUUID(),
                source,
                recipientId: b.userId,
                title: 'Review',
                goal: 'Review the work',
                context: 'Allowed context',
            })
            await expect(db.saveSource(a, source, original, before.revision)).rejects.toBeInstanceOf(CollaborationConflictError)
            await expect(store.save(a, original)).rejects.toThrow('durable writer')
            const ownTask = task('Review the work')
            await db.mutate(b, { type: 'activate', requestId: randomUUID(), nodeId: delegated.nodeId!, revision: 1 }, { task: ownTask })
            const first = (await db.claim(30_000))!
            await db.createJournal(first, { id: first.sessionId }, 0)
            await db.appendJournal(first, [{ type: 'test', seq: 0 }])
            await expect(db.appendJournal(first, [{ type: 'test', seq: 0 }])).rejects.toBeInstanceOf(CollaborationConflictError)
            await pool.query("UPDATE harness_collaboration_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [
                first.id,
            ])
            await pool.query(
                "UPDATE harness_collaboration_sources SET lease_until=clock_timestamp()-interval '1 second' WHERE source_id=$1",
                [ownTask.id]
            )
            const second = (await db.claim(30_000))!
            expect(second.id).toBe(first.id)
            expect(second.attempt).toBe(first.attempt + 1)
            await expect(db.appendJournal(first, [{ type: 'test', seq: 1 }])).rejects.toBeInstanceOf(CollaborationConflictError)
            expect((await db.readJournal(second))!.events).toEqual([{ type: 'test', seq: 0 }])
            const project = (await db.project(a, delegated.projectId!))!
            await db.mutate(a, {
                type: 'revoke',
                requestId: randomUUID(),
                projectId: project.id,
                userId: b.userId,
                revision: project.revision,
            })
            expect(await db.project(b, project.id)).toBeUndefined()
            await expect(db.appendJournal(second, [{ type: 'test', seq: 1 }])).rejects.toBeInstanceOf(CollaborationConflictError)
            expect(await db.settle(second, { status: 'complete', conversation: ownTask })).toBe(false)
            expect((await store.get(b, ownTask.id))!.id).toBe(ownTask.id)
            expect(await db.claim(30_000)).toBeUndefined()
        })
    }, 30_000)
})
