import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { AgentDefinition, ChatConversation, CollaborationSource, PersonalTask } from '@ai-harness/contracts'
import { CollaborationConflictError, createChatStore, type ChatScope } from '../src/index.js'

type Store = Awaited<ReturnType<typeof createChatStore>>

/**
 * Create an explicitly isolated Agent snapshot without any live model credential.
 * @returns A valid private Agent definition used only by real-database tests.
 */
function agent(): AgentDefinition {
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        name: 'Race fixture assistant',
        description: '',
        modelId: `account:${randomUUID()}`,
        systemPrompt: 'Private owner prompt',
        toolIds: [],
        openingMessages: [],
        createdAt: now,
        updatedAt: now,
    }
}

/**
 * Run against a fresh test-owned schema and two independent PostgreSQL store pools.
 * @param run - Assertions using only this fixture's schema and public repositories.
 * @returns After both stores, the query pool and schema have been released.
 */
async function database(run: (fixture: { first: Store; second: Store; pool: pg.Pool }) => Promise<void>): Promise<void> {
    const url = new URL(process.env.TEST_DATABASE_URL!)
    const admin = new pg.Pool({ connectionString: url.toString() })
    const schema = `sf014_races_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE SCHEMA ${schema}`)
    url.searchParams.set('options', `-c search_path=${schema},public`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    let first: Store | undefined
    let second: Store | undefined
    try {
        first = await createChatStore({ databaseUrl: url.toString() })
        second = await createChatStore({ databaseUrl: url.toString() })
        await run({ first, second, pool })
    } finally {
        await Promise.allSettled([first?.close(), second?.close(), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Persist real same-workspace accounts for separate responsibility chains.
 * @param store - Real PostgreSQL application store.
 * @returns Two distinct upstream owners and one shared downstream account.
 */
async function accounts(store: Store): Promise<{ a: ChatScope; b: ChatScope; c: ChatScope }> {
    const workspaceId = randomUUID()
    const a = { workspaceId, userId: randomUUID() }
    const b = { workspaceId, userId: randomUUID() }
    const c = { workspaceId, userId: randomUUID() }
    const now = new Date().toISOString()
    for (const [index, scope] of [a, b, c].entries()) {
        await store.accounts!.createUser({
            user: {
                id: scope.userId,
                username: `Race person ${index}`,
                email: `${scope.userId}@example.test`,
                createdAt: now,
                updatedAt: now,
            },
            workspaceId,
            passwordHash: 'isolated-test-verifier',
            credentialVersion: 1,
        })
    }
    return { a, b, c }
}

/**
 * Create a private source and activate a genuine downstream owner Task through public operations.
 * @param store - Real PostgreSQL application store.
 * @param upstream - Owner of the original private conversation.
 * @param downstream - Owner accepting the delegated responsibility.
 * @param label - Distinct project context used to detect cross-project routing.
 * @returns Stable public project, root, node and private task/source identities.
 */
async function project(store: Store, upstream: ChatScope, downstream: ChatScope, label: string) {
    const db = store.collaboration!
    const now = new Date().toISOString()
    const original: ChatConversation = { id: randomUUID(), title: label, createdAt: now, updatedAt: now, messages: [], agent: agent() }
    await store.save(upstream, original)
    const source: CollaborationSource = { kind: 'conversation', id: original.id }
    const delegated = await db.mutate(upstream, {
        type: 'delegate',
        requestId: randomUUID(),
        source,
        recipientId: downstream.userId,
        title: label,
        goal: `${label} goal`,
        context: `${label} authorized context`,
    })
    const task: PersonalTask = {
        id: randomUUID(),
        title: `${label} downstream`,
        createdAt: now,
        updatedAt: now,
        messages: [],
        agent: agent(),
        task: { goal: `${label} goal`, status: 'not-started', started: false },
    }
    await db.mutate(downstream, { type: 'activate', requestId: randomUUID(), nodeId: delegated.nodeId!, revision: 1 }, { task })
    const root = (await db.sourceEvents(upstream, source)).nodes[0]!
    return {
        projectId: delegated.projectId!,
        rootId: root.id,
        nodeId: delegated.nodeId!,
        taskId: task.id,
        source,
        taskSource: { kind: 'task' as const, id: task.id },
    }
}

/**
 * Settle exactly one activation without using a model or fake business repository.
 * @param store - Real PostgreSQL application store.
 * @param taskId - Expected downstream private source.
 * @returns After the activation job releases its durable writer.
 */
async function settleActivation(store: Store, taskId: string): Promise<void> {
    const job = (await store.collaboration!.claim(30_000))!
    expect(job.source.id).toBe(taskId)
    expect(await store.collaboration!.settle(job, { status: 'complete' })).toBe(true)
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('real PostgreSQL collaboration races and independent projects', () => {
    it('lets only one of two independent stores claim a single job and advances another project while its peer waits', async () => {
        await database(async ({ first, second, pool }) => {
            const { a, b, c } = await accounts(first)
            const one = await project(first, a, b, 'Project one')
            const claims = await Promise.all([first.collaboration!.claim(30_000), second.collaboration!.claim(30_000)])
            const owned = claims.filter(job => job !== undefined)
            expect(owned).toHaveLength(1)
            expect(owned[0]!.source).toEqual(one.taskSource)
            expect(
                (await pool.query("SELECT count(*) AS total FROM harness_collaboration_jobs WHERE status='running'")).rows[0].total
            ).toBe('1')
            expect(await first.collaboration!.settle(owned[0]!, { status: 'complete' })).toBe(true)
            expect(await second.collaboration!.claim(30_000)).toBeUndefined()
            const node = (await first.collaboration!.node(b, one.nodeId))!.node
            const question = await first.collaboration!.mutate(b, {
                type: 'ask',
                requestId: randomUUID(),
                nodeId: one.nodeId,
                revision: node.revision,
                targetNodeId: one.rootId,
                question: 'Question only for project one',
                context: 'First project facts',
            })
            const two = await project(second, c, b, 'Project two')
            const independent = (await second.collaboration!.claim(30_000))!
            expect(independent.source).toEqual(two.taskSource)
            expect((await first.collaboration!.node(b, one.nodeId))!.node.status).toBe('waiting-upstream')
            expect(await second.collaboration!.settle(independent, { status: 'complete' })).toBe(true)
            await first.collaboration!.mutate(a, {
                type: 'answer',
                requestId: randomUUID(),
                questionId: question.questionId!,
                version: 1,
                content: 'Answer belonging only to project one',
                decision: 'information',
            })
            const continuation = (await second.collaboration!.claim(30_000))!
            expect(continuation.source).toEqual(one.taskSource)
            expect(continuation.nodeId).toBe(one.nodeId)
            expect(continuation.content).toContain('Answer belonging only to project one')
            expect((await second.collaboration!.node(b, two.nodeId))!.questions.some(item => item.id === question.questionId)).toBe(false)
            expect(await second.collaboration!.settle(continuation, { status: 'complete' })).toBe(true)
            expect(await first.collaboration!.claim(30_000)).toBeUndefined()
        })
    }, 30_000)

    it.each(['revise', 'cancel'] as const)(
        'serializes a real answer against %s and preserves the other project question',
        async operation => {
            await database(async ({ first, second, pool }) => {
                const { a, b, c } = await accounts(first)
                const db = first.collaboration!
                const peer = second.collaboration!
                const one = await project(first, a, b, 'Race project one')
                await settleActivation(first, one.taskId)
                const two = await project(second, c, b, 'Race project two')
                await settleActivation(second, two.taskId)
                const firstNode = (await db.node(b, one.nodeId))!.node
                const firstQuestion = await db.mutate(b, {
                    type: 'ask',
                    requestId: randomUUID(),
                    nodeId: one.nodeId,
                    revision: firstNode.revision,
                    targetNodeId: one.rootId,
                    question: 'Original question before the race',
                    context: 'Old project one context',
                })
                const secondNode = (await peer.node(b, two.nodeId))!.node
                const secondQuestion = await peer.mutate(b, {
                    type: 'ask',
                    requestId: randomUUID(),
                    nodeId: two.nodeId,
                    revision: secondNode.revision,
                    targetNodeId: two.rootId,
                    question: 'Independent second project question',
                    context: 'Second project context',
                })
                const before = (await db.node(b, one.nodeId))!.node
                const answer = {
                    type: 'answer' as const,
                    requestId: randomUUID(),
                    questionId: firstQuestion.questionId!,
                    version: 1,
                    content: 'Answer racing with old-node revision',
                    decision: 'information' as const,
                }
                const change =
                    operation === 'revise'
                        ? {
                              type: 'revise' as const,
                              requestId: randomUUID(),
                              nodeId: one.nodeId,
                              revision: before.revision,
                              goal: 'Revised project one goal',
                              context: 'New context invalidates the old question',
                          }
                        : { type: 'cancel' as const, requestId: randomUUID(), nodeId: one.nodeId, revision: before.revision }
                const results = await Promise.allSettled([db.mutate(a, answer), peer.mutate(b, change)])
                expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
                const loser = results.find(result => result.status === 'rejected') as PromiseRejectedResult
                expect(loser.reason).toBeInstanceOf(CollaborationConflictError)
                const answered = results[0]!.status === 'fulfilled'
                const current = (await db.node(b, one.nodeId))!
                const oldQuestion = current.questions.find(item => item.id === firstQuestion.questionId)!
                expect(oldQuestion.status).toBe(answered ? 'answered' : 'cancelled')
                expect(await db.action(a, answer.requestId)).toEqual(
                    answered ? (results[0] as PromiseFulfilledResult<unknown>).value : undefined
                )
                expect(await peer.action(b, change.requestId)).toEqual(
                    answered ? undefined : (results[1] as PromiseFulfilledResult<unknown>).value
                )
                const expectedJobs = answered || operation === 'revise' ? 1 : 0
                expect(
                    (await pool.query("SELECT count(*) AS total FROM harness_collaboration_jobs WHERE status IN ('queued','running')"))
                        .rows[0].total
                ).toBe(String(expectedJobs))
                const continuation = await peer.claim(30_000)
                if (expectedJobs) {
                    expect(continuation!.source).toEqual(one.taskSource)
                    expect(continuation!.nodeId).toBe(one.nodeId)
                    expect(continuation!.content).toContain(answered ? answer.content : 'Revised project one goal')
                    expect(await peer.settle(continuation!, { status: 'complete' })).toBe(true)
                } else expect(continuation).toBeUndefined()
                expect(await db.claim(30_000)).toBeUndefined()
                const untouched = (await peer.node(b, two.nodeId))!.questions.find(item => item.id === secondQuestion.questionId)!
                expect(untouched.status).toBe('pending')
                expect(untouched.answer).toBeNull()
                const unrelatedAnswer = await peer.mutate(c, {
                    type: 'answer',
                    requestId: randomUUID(),
                    questionId: untouched.id,
                    version: 1,
                    content: 'Independent project two answer',
                    decision: 'information',
                })
                const unrelated = (await db.claim(30_000))!
                expect(unrelated.triggerId).toBe(unrelatedAnswer.eventId)
                expect(unrelated.source).toEqual(two.taskSource)
                expect(unrelated.content).toContain('Independent project two answer')
                expect(await db.settle(unrelated, { status: 'complete' })).toBe(true)
                expect(await peer.claim(30_000)).toBeUndefined()
            })
        },
        30_000
    )
})
