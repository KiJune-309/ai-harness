import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { collaborationCommandSchema, type ChatConversation } from '@ai-harness/contracts'
import { CollaborationAccessError, CollaborationConflictError, createChatStore, type ChatScope, type ChatStore } from '../src/index.js'

/**
 * Provides two independent real PostgreSQL stores in a disposable schema.
 * @param run - Assertions against the test-owned scope and pools.
 * @returns After all stores, connections and the schema are released.
 */
async function database(run: (first: ChatStore, second: ChatStore, pool: pg.Pool) => Promise<void>): Promise<void> {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const schema = `sf017_db_${randomUUID().replaceAll('-', '')}`
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    let first: ChatStore | undefined
    let second: ChatStore | undefined
    try {
        first = await createChatStore({ databaseUrl: url.toString() })
        second = await createChatStore({ databaseUrl: url.toString() })
        await run(first, second, pool)
    } finally {
        await Promise.allSettled([first?.close(), second?.close(), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Seeds an account without any model connection or private business records.
 * @param store - Real account persistence.
 * @param name - Public identity used by safe projections.
 * @returns The stable historical scope and normalized email.
 */
async function account(store: ChatStore, name: string) {
    const userId = randomUUID()
    const scope: ChatScope = { userId, workspaceId: 'sf017-home' }
    const email = `${userId}@example.test`
    const now = new Date().toISOString()
    await store.accounts!.createUser({
        user: { id: userId, username: name, email, createdAt: now, updatedAt: now },
        passwordHash: 'explicit-isolated-test-verifier',
        credentialVersion: 1,
        workspaceId: scope.workspaceId,
    })
    return { scope, email }
}

/**
 * Separates Workspace ownership, project ownership, project membership and outsider identities.
 * @param store - Real shared-pool persistence.
 * @returns Four effective teammates and a nonmember, with deliberately different owners.
 */
async function teammates(store: ChatStore) {
    const workspaceOwner = await account(store, 'Workspace owner')
    const owner = await account(store, 'Project owner')
    const member = await account(store, 'Project member')
    const candidate = await account(store, 'Candidate')
    const outsider = await account(store, 'Outsider')
    const team = await store.workspaces!.create(workspaceOwner.scope, { requestId: randomUUID(), name: '团队项目测试', description: '' })
    for (const person of [owner, member, candidate]) {
        const invitation = await store.workspaces!.invite(workspaceOwner.scope, team.id, { requestId: randomUUID(), email: person.email })
        await store.workspaces!.respond(person.scope, invitation.id, true)
    }
    return {
        workspaceOwner: { ...workspaceOwner.scope, workspaceId: team.id },
        owner: { ...owner.scope, workspaceId: team.id },
        member: { ...member.scope, workspaceId: team.id },
        candidate: { ...candidate.scope, workspaceId: team.id },
        outsider: { ...outsider.scope, workspaceId: team.id },
        home: owner.scope,
        memberHome: member.scope,
        memberEmail: member.email,
    }
}

/**
 * Prepares only the API's non-secret empty owner dialogue snapshot.
 * @param title - Explicit private work title.
 * @returns A valid ordinary empty conversation without model execution.
 */
function dialogue(title = '本人工作'): ChatConversation {
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        title,
        messages: [],
        createdAt: now,
        updatedAt: now,
        agent: {
            id: randomUUID(),
            name: '本人 Agent',
            description: '',
            modelId: 'system-fixture',
            systemPrompt: 'PRIVATE_PROMPT',
            toolIds: [],
            openingMessages: [],
            createdAt: now,
            updatedAt: now,
        },
    }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent real PostgreSQL project progress acceptance', () => {
    it('atomically creates only one private empty dialogue, root and bound source, with retained actions and rollback', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            const created = await first.collaboration!.mutate(people.owner, {
                type: 'project-create',
                requestId: randomUUID(),
                name: '进度项目',
                description: 'PRIVATE_PROJECT_DESCRIPTION',
                memberIds: [people.member.userId],
            })
            const id = created.projectId!
            const project = (await first.collaboration!.project(people.owner, id))!
            const start = {
                type: 'project-start' as const,
                requestId: randomUUID(),
                projectId: id,
                revision: project.revision,
                title: '同名工作',
                goal: 'PRIVATE_OWNER_GOAL',
            }
            const results = await Promise.all([
                first.collaboration!.mutate(people.owner, start, { ownerConversation: dialogue() }),
                second.collaboration!.mutate(people.owner, start, { ownerConversation: dialogue() }),
            ])
            expect(results[0]).toEqual(results[1])
            const conversation = (await second.get(people.owner, results[0]!.conversationId!))!
            expect(conversation.messages).toEqual([])
            expect(conversation.task).toBeUndefined()
            expect(conversation.activeRequestId).toBeUndefined()
            expect(await second.get(people.member, conversation.id)).toBeUndefined()
            expect((await pool.query('SELECT bound FROM harness_collaboration_sources')).rows).toEqual([{ bound: true }])
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(1)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_jobs')).rows[0].n).toBe(0)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_personal_projects')).rows[0].n).toBe(0)
            expect((await first.collaboration!.notifications(people.member)).notifications).toEqual([])
            await expect(
                first.collaboration!.mutate(people.owner, { ...start, goal: '异内容' }, { ownerConversation: dialogue() })
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            await expect(
                first.collaboration!.mutate(
                    people.owner,
                    { ...start, requestId: randomUUID() },
                    { authorKind: 'agent', ownerConversation: dialogue() }
                )
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            await expect(
                first.collaboration!.mutate(people.workspaceOwner, { ...start, requestId: randomUUID() }, { ownerConversation: dialogue() })
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            const before = (await first.collaboration!.project(people.owner, id))!
            const secondStart = { ...start, requestId: randomUUID(), revision: before.revision }
            await pool.query(
                "CREATE FUNCTION sf017_reject_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled source transaction failure'; END $$"
            )
            await pool.query(
                'CREATE TRIGGER sf017_source_failure BEFORE INSERT ON harness_collaboration_sources FOR EACH ROW EXECUTE FUNCTION sf017_reject_source()'
            )
            await expect(first.collaboration!.mutate(people.owner, secondStart, { ownerConversation: dialogue() })).rejects.toThrow()
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(1)
            expect((await first.collaboration!.project(people.owner, id))!.nodes).toHaveLength(1)
            expect(await first.collaboration!.action(people.owner, secondStart.requestId)).toBeUndefined()
            await pool.query('DROP TRIGGER sf017_source_failure ON harness_collaboration_sources')
            const secondWork = await first.collaboration!.mutate(people.owner, secondStart, { ownerConversation: dialogue() })
            expect(secondWork.conversationId).not.toBe(conversation.id)
            expect((await second.collaboration!.progress(people.owner, id)).nodes).toHaveLength(2)
            for (const fields of [
                { title: '' },
                { title: ' '.repeat(2) },
                { title: '名'.repeat(121) },
                { goal: '' },
                { goal: '目'.repeat(32001) },
                { ownerId: people.member.userId },
            ]) {
                expect(collaborationCommandSchema.safeParse({ ...start, ...fields }).success).toBe(false)
            }
        })
    }, 30000)

    it('keeps old root grants revoked across both project and Workspace removal and preserves only private historical chat access', async () => {
        await database(async (first, second) => {
            const people = await teammates(first)
            const created = await first.collaboration!.mutate(people.owner, {
                type: 'project-create',
                requestId: randomUUID(),
                name: '撤权进度',
                description: '',
                memberIds: [people.member.userId],
            })
            const projectId = created.projectId!
            const start = {
                type: 'project-start' as const,
                requestId: randomUUID(),
                projectId,
                revision: (await first.collaboration!.project(people.member, projectId))!.revision,
                title: '名'.repeat(120),
                goal: '目'.repeat(32000),
            }
            const started = await first.collaboration!.mutate(people.member, start, { ownerConversation: dialogue() })
            expect((await second.collaboration!.progress(people.member, projectId)).nodes[0]?.canContinue).toBe(true)
            await first.collaboration!.mutate(people.owner, {
                type: 'revoke',
                requestId: randomUUID(),
                projectId,
                revision: (await first.collaboration!.project(people.owner, projectId))!.revision,
                userId: people.member.userId,
            })
            await expect(second.collaboration!.progress(people.member, projectId)).rejects.toBeInstanceOf(CollaborationAccessError)
            await expect(second.collaboration!.mutate(people.member, start, { ownerConversation: dialogue() })).rejects.toBeInstanceOf(
                CollaborationAccessError
            )
            await first.collaboration!.mutate(people.owner, {
                type: 'project-members-add',
                requestId: randomUUID(),
                projectId,
                revision: (await first.collaboration!.project(people.owner, projectId))!.revision,
                memberIds: [people.member.userId],
            })
            expect(await second.collaboration!.mutate(people.member, start, { ownerConversation: dialogue() })).toEqual(started)
            const restored = await second.collaboration!.progress(people.member, projectId)
            expect(restored.nodes).toHaveLength(1)
            expect(restored.nodes[0]).toMatchObject({ authorized: false, canContinue: false })
            expect((await second.get(people.member, started.conversationId!))?.messages).toEqual([])
            const fresh = { ...start, requestId: randomUUID(), revision: restored.revision }
            const secondWork = await first.collaboration!.mutate(people.member, fresh, { ownerConversation: dialogue() })
            expect(secondWork.nodeId).not.toBe(started.nodeId)
            await first.workspaces!.remove(people.workspaceOwner, people.owner.workspaceId, people.member.userId)
            await expect(second.collaboration!.progress(people.member, projectId)).rejects.toBeInstanceOf(CollaborationAccessError)
            await expect(second.collaboration!.mutate(people.member, fresh, { ownerConversation: dialogue() })).rejects.toBeInstanceOf(
                CollaborationAccessError
            )
            const invitation = await first.workspaces!.invite(people.workspaceOwner, people.owner.workspaceId, {
                requestId: randomUUID(),
                email: people.memberEmail,
            })
            await first.workspaces!.respond(people.memberHome, invitation.id, true)
            expect(await second.collaboration!.mutate(people.member, fresh, { ownerConversation: dialogue() })).toEqual(secondWork)
            const returned = await second.collaboration!.progress(people.member, projectId)
            expect(returned.nodes).toHaveLength(2)
            expect(returned.nodes.every(node => !node.authorized && !node.canContinue)).toBe(true)
            expect(returned.waits).toEqual([])
            expect((await second.get(people.member, secondWork.conversationId!))?.messages).toEqual([])
        })
    }, 30000)

    it('derives safe complete multi-target waits from persisted facts, independently of generic node status, and removes terminal or unauthorized waits', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            const created = await first.collaboration!.mutate(people.owner, {
                type: 'project-create',
                requestId: randomUUID(),
                name: '责任链',
                description: 'PRIVATE_PROJECT_DESCRIPTION',
                memberIds: [people.member.userId, people.candidate.userId],
            })
            const id = created.projectId!
            const initial = (await first.collaboration!.project(people.owner, id))!
            const sourceA = dialogue('A根')
            const started = await first.collaboration!.mutate(
                people.owner,
                {
                    type: 'project-start',
                    requestId: randomUUID(),
                    projectId: id,
                    revision: initial.revision,
                    title: 'A根',
                    goal: 'PRIVATE_ROOT_GOAL',
                },
                { ownerConversation: sourceA }
            )
            const bChat = dialogue('B工作')
            const b = await first.collaboration!.mutate(
                people.owner,
                {
                    type: 'delegate',
                    requestId: randomUUID(),
                    source: { kind: 'conversation', id: sourceA.id },
                    recipientId: people.member.userId,
                    title: 'B工作',
                    goal: 'PRIVATE_B_GOAL',
                    context: 'PRIVATE_B_CONTEXT',
                },
                { recipientConversation: bChat }
            )
            const c = await second.collaboration!.mutate(
                people.member,
                {
                    type: 'delegate',
                    requestId: randomUUID(),
                    source: { kind: 'conversation', id: bChat.id },
                    recipientId: people.candidate.userId,
                    title: 'C工作',
                    goal: 'PRIVATE_C_GOAL',
                    context: 'PRIVATE_C_CONTEXT',
                },
                { recipientConversation: dialogue('C工作') }
            )
            expect(b.projectId).toBe(id)
            expect(c.projectId).toBe(id)
            const stored = (
                await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [people.owner.workspaceId])
            ).rows[0].data
            const original = Object.values(stored.questions)[0] as { [key: string]: unknown }
            const upstreamId = randomUUID(),
                selfId = randomUUID(),
                endedId = randomUUID(),
                crossId = randomUUID()
            stored.questions[upstreamId] = {
                ...original,
                id: upstreamId,
                projectId: id,
                nodeId: b.nodeId,
                targetNodeId: started.nodeId,
                question: 'PRIVATE_QUESTION',
                answer: 'PRIVATE_ANSWER',
                status: 'pending',
            }
            stored.questions[selfId] = {
                ...original,
                id: selfId,
                projectId: id,
                nodeId: started.nodeId,
                targetNodeId: started.nodeId,
                question: 'PRIVATE_SELF_JUDGMENT',
                status: 'pending',
            }
            stored.questions[endedId] = { ...original, id: endedId, status: 'answered', answer: 'PRIVATE_ANSWER' }
            stored.questions[crossId] = { ...original, id: crossId, projectId: randomUUID(), status: 'pending' }
            stored.nodes[b.nodeId!].status = 'waiting-owner'
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(stored),
            ])
            for (const scope of [people.owner, people.member, people.candidate]) {
                const progress = await second.collaboration!.progress(scope, id)
                expect(progress.nodes).toHaveLength(3)
                expect(progress.waits).toHaveLength(4)
                expect(progress.waits.find(wait => wait.id === upstreamId)).toMatchObject({
                    fromNodeId: b.nodeId,
                    targetNodeId: started.nodeId,
                    kind: 'upstream',
                })
                expect(progress.waits.find(wait => wait.id === selfId)?.kind).toBe('self')
                expect(progress.waits.filter(wait => wait.kind === 'downstream')).toHaveLength(2)
                expect(progress.nodes.filter(node => node.ownHref)).toHaveLength(1)
                expect(progress.nodes.filter(node => node.ownHref).every(node => node.ownerId === scope.userId)).toBe(true)
                const text = JSON.stringify(progress)
                expect(text).not.toMatch(/PRIVATE_|goal|context|question|answer|systemPrompt|apiKey|sourceId|source_id/)
                for (const node of progress.nodes)
                    expect(Object.keys(node).sort()).toEqual(
                        [
                            'authorized',
                            'canContinue',
                            'sourceAvailable',
                            'started',
                            'createdAt',
                            'id',
                            'ownerId',
                            'ownerName',
                            'status',
                            'title',
                            'updatedAt',
                            'upstreamNodeId',
                            ...(node.ownHref ? ['ownHref'] : []),
                        ].sort()
                    )
            }
            await expect(first.collaboration!.progress(people.workspaceOwner, id)).rejects.toBeInstanceOf(CollaborationAccessError)
            stored.questions[upstreamId].status = 'answered'
            stored.questions[selfId].status = 'rejected'
            stored.questions[b.questionId!].status = 'cancelled'
            stored.questions[c.questionId!].status = 'expired'
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(stored),
            ])
            expect((await second.collaboration!.progress(people.member, id)).waits).toEqual([])
            expect((await second.collaboration!.progress(people.member, id)).nodes.find(node => node.id === b.nodeId)?.status).toBe(
                'waiting-owner'
            )
            stored.questions[upstreamId].status = 'pending'
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(stored),
            ])
            await pool.query('DELETE FROM harness_collaboration_sources WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3', [
                people.owner.workspaceId,
                people.owner.userId,
                sourceA.id,
            ])
            await pool.query('DELETE FROM harness_chat_conversations WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                people.owner.workspaceId,
                people.owner.userId,
                sourceA.id,
            ])
            expect((await second.collaboration!.progress(people.member, id)).waits).toEqual([])
        })
    }, 30000)
})
