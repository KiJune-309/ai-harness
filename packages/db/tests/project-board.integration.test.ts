import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { ChatConversation } from '@ai-harness/contracts'
import { createChatStore, type ChatScope, type ChatStore } from '../src/index.js'

/**
 * Provides two independent real PostgreSQL stores in a disposable schema.
 * @param run - Assertions against the test-owned scope and pools.
 * @returns After all stores, connections and the schema are released.
 */
async function database(run: (first: ChatStore, second: ChatStore, pool: pg.Pool) => Promise<void>): Promise<void> {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const schema = `sf020_db_${randomUUID().replaceAll('-', '')}`
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
    const scope: ChatScope = { userId, workspaceId: 'sf020-home' }
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

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent real PostgreSQL board source metadata', () => {
    it('requires the exact workspace owner identity and source kind and counts only durable user input', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            const created = await first.collaboration!.mutate(people.owner, {
                type: 'project-create',
                requestId: randomUUID(),
                name: '安全来源事实',
                description: 'PRIVATE_PROJECT_BODY',
                memberIds: [people.member.userId],
            })
            const project = (await first.collaboration!.project(people.owner, created.projectId!))!
            const sources: { chat: ChatConversation; nodeId: string }[] = []
            for (const kind of ['empty', 'opening', 'user']) {
                const chat = dialogue(kind)
                if (kind !== 'empty')
                    chat.messages.push({
                        id: randomUUID(),
                        role: kind === 'user' ? 'user' : 'assistant',
                        content: 'PRIVATE_SOURCE_BODY_NEVER_PROJECT',
                        ...(kind === 'opening' ? { kind: 'opening' as const } : {}),
                        status: 'complete',
                        createdAt: chat.createdAt,
                    })
                const result = await first.collaboration!.mutate(
                    people.owner,
                    {
                        type: 'project-start',
                        requestId: randomUUID(),
                        projectId: project.id,
                        revision: (await first.collaboration!.project(people.owner, project.id))!.revision,
                        title: kind,
                        goal: 'PRIVATE_GOAL',
                    },
                    { ownerConversation: { ...chat, messages: [] } }
                )
                if (kind !== 'empty')
                    await pool.query('UPDATE harness_chat_conversations SET messages=$2::jsonb WHERE id=$1 AND user_id=$3', [
                        chat.id,
                        JSON.stringify(chat.messages),
                        people.owner.userId,
                    ])
                sources.push({ chat, nodeId: result.nodeId! })
            }
            const otherOwner = {
                ...sources[0]!.chat,
                messages: [
                    {
                        id: randomUUID(),
                        role: 'user' as const,
                        content: 'PRIVATE_OTHER_OWNER_USER',
                        status: 'complete' as const,
                        createdAt: project.createdAt,
                    },
                ],
            }
            await first.save(people.member, otherOwner)
            let progress = await second.collaboration!.progress(people.owner, project.id)
            expect(progress.nodes.map(node => node.started)).toEqual([false, false, true])
            expect(progress.nodes.every(node => node.sourceAvailable)).toBe(true)
            const state = (
                await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [people.owner.workspaceId])
            ).rows[0].data
            state.nodes[sources[0]!.nodeId].source.kind = 'task'
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(state),
            ])
            progress = await second.collaboration!.progress(people.owner, project.id)
            expect(progress.nodes.find(node => node.id === sources[0]!.nodeId)).toMatchObject({
                sourceAvailable: false,
                started: null,
                canContinue: false,
            })
            expect(progress.nodes.find(node => node.id === sources[0]!.nodeId)?.ownHref).toBeUndefined()
            await pool.query('UPDATE harness_chat_conversations SET task_data=$3::jsonb WHERE id=$1 AND user_id=$2', [
                sources[1]!.chat.id,
                people.owner.userId,
                JSON.stringify({ goal: 'PRIVATE_OLD_TASK_GOAL', status: 'in-progress', started: true }),
            ])
            progress = await second.collaboration!.progress(people.owner, project.id)
            expect(progress.nodes.find(node => node.id === sources[1]!.nodeId)).toMatchObject({ sourceAvailable: false, started: null })
            state.nodes[sources[1]!.nodeId].source.kind = 'task'
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(state),
            ])
            progress = await second.collaboration!.progress(people.owner, project.id)
            expect(progress.nodes.find(node => node.id === sources[1]!.nodeId)).toMatchObject({ sourceAvailable: true, started: false })
            // This deliberately controlled legacy fixture can retain a pending dependency beside an already completed old Task.
            const legacyQuestionId = randomUUID()
            state.nodes[sources[1]!.nodeId].upstreamNodeId = sources[2]!.nodeId
            state.questions[legacyQuestionId] = {
                id: legacyQuestionId,
                projectId: project.id,
                nodeId: sources[1]!.nodeId,
                targetNodeId: sources[2]!.nodeId,
                version: 1,
                question: 'PRIVATE_LEGACY_PENDING',
                context: '',
                status: 'pending',
                answer: null,
                decision: null,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
            }
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(state),
            ])
            expect((await second.collaboration!.progress(people.owner, project.id)).waits.some(wait => wait.id === legacyQuestionId)).toBe(
                true
            )
            await pool.query(
                "UPDATE harness_chat_conversations SET task_data=jsonb_set(task_data,'{status}',$3::jsonb) WHERE id=$1 AND user_id=$2",
                [sources[1]!.chat.id, people.owner.userId, JSON.stringify('completed')]
            )
            const completedView = await second.collaboration!.progress(people.owner, project.id)
            expect(completedView.nodes.find(node => node.id === sources[1]!.nodeId)).toMatchObject({
                status: 'completed',
                canContinue: false,
            })
            expect(completedView.waits.some(wait => wait.id === legacyQuestionId)).toBe(false)
            expect(
                (await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [people.owner.workspaceId])).rows[0]
                    .data
            ).toEqual(state)
            state.nodes[sources[1]!.nodeId].status = 'cancelled'
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(state),
            ])
            expect(
                (await second.collaboration!.progress(people.owner, project.id)).nodes.find(node => node.id === sources[1]!.nodeId)?.status
            ).toBe('cancelled')
            state.nodes[sources[1]!.nodeId].status = 'ready'
            state.nodes[sources[1]!.nodeId].revoked = true
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(state),
            ])
            expect(
                (await second.collaboration!.progress(people.owner, project.id)).nodes.find(node => node.id === sources[1]!.nodeId)
            ).toMatchObject({ authorized: false, status: 'ready', canContinue: false })
            const missingId = randomUUID()
            state.nodes[sources[2]!.nodeId].source.id = missingId
            await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                people.owner.workspaceId,
                JSON.stringify(state),
            ])
            await first.save(people.member, { ...otherOwner, id: missingId })
            progress = await second.collaboration!.progress(people.owner, project.id)
            expect(progress.nodes.find(node => node.id === sources[2]!.nodeId)).toMatchObject({ sourceAvailable: false, started: null })
            expect(JSON.stringify(progress)).not.toMatch(/PRIVATE_|goal|context|messages|skill|agent|sourceId|source_id/)
            const memberView = await second.collaboration!.progress(people.member, project.id)
            expect(memberView.nodes.every(node => !node.ownHref)).toBe(true)
        })
    })

    it('returns every one of forty-one works without writes or a board record and does not collapse them by owner', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            const created = await first.collaboration!.mutate(people.owner, {
                type: 'project-create',
                requestId: randomUUID(),
                name: '完整集合',
                description: '',
                memberIds: [],
            })
            for (let index = 0; index < 41; index++)
                await first.collaboration!.mutate(
                    people.owner,
                    {
                        type: 'project-start',
                        requestId: randomUUID(),
                        projectId: created.projectId!,
                        revision: (await first.collaboration!.project(people.owner, created.projectId!))!.revision,
                        title: `同名工作${index}`,
                        goal: 'PRIVATE_GOAL',
                    },
                    { ownerConversation: dialogue() }
                )
            const before = (
                await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [people.owner.workspaceId])
            ).rows[0].data
            for (let index = 0; index < 4; index++) {
                const result = await second.collaboration!.progress(people.owner, created.projectId!)
                expect(result.nodes).toHaveLength(41)
                expect(new Set(result.nodes.map(node => node.id)).size).toBe(41)
                expect(result.nodes.every(node => node.sourceAvailable && node.started === false)).toBe(true)
            }
            expect(
                (await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [people.owner.workspaceId])).rows[0]
                    .data
            ).toEqual(before)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(41)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_jobs')).rows[0].n).toBe(0)
            expect(
                (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE '%board%'")).rows
            ).toEqual([])
        })
    }, 30000)
})
