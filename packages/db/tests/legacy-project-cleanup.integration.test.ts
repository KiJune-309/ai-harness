import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { createChatStore } from '../src/index.js'
import { cleanupLegacyProjects } from '../src/legacy-project-cleanup.js'

/**
 * Creates isolated initialized storage without touching the user's application schema.
 * @param run - Assertions against the disposable database pool.
 * @returns After connections and the exclusively test-owned schema are removed.
 */
async function database(run: (pool: pg.Pool) => Promise<void>): Promise<void> {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const schema = `sf021_cleanup_${randomUUID().replaceAll('-', '')}`
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    const store = await createChatStore({ databaseUrl: url.toString() })
    try {
        // Reconstruct a pre-upgrade fixture only inside this disposable schema.
        await pool.query('DROP TRIGGER harness_retired_project_source_guard ON harness_chat_conversations')
        await pool.query('DROP TRIGGER harness_legacy_project_write_guard ON harness_personal_projects')
        await pool.query('DROP TRIGGER harness_legacy_project_state_guard ON harness_collaboration_state')
        await pool.query("DELETE FROM harness_feature_migrations WHERE id IN('sf021-project-folders','sf021-project-action-cleanup')")
        await run(pool)
    } finally {
        await Promise.allSettled([store.close(), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Persists a source snapshot and its journal using exact ownership identifiers.
 * @param pool - Disposable database pool.
 * @param scope - Explicit fixture owner and workspace.
 * @param id - Exact conversation identity.
 * @param projectId - Optional old task project relation.
 * @returns After both conversation and durable journal exist.
 */
async function source(pool: pg.Pool, scope: { workspaceId: string; userId: string }, id: string, projectId?: string): Promise<void> {
    const now = new Date().toISOString()
    await pool.query(
        `INSERT INTO harness_chat_conversations(workspace_id,user_id,id,title,created_at,updated_at,messages,task_data)
         VALUES($1,$2,$3,'同名测试聊天',$4,$4,$5::jsonb,$6::jsonb)`,
        [
            scope.workspaceId,
            scope.userId,
            id,
            now,
            JSON.stringify([{ id: randomUUID(), role: 'user', content: 'SOURCE_PRIVATE_BODY', status: 'complete', createdAt: now }]),
            projectId
                ? JSON.stringify({ goal: 'OLD_TASK_BODY', status: 'not-started', started: false, creationProjectId: projectId })
                : null,
        ]
    )
    await pool.query(
        `INSERT INTO harness_collaboration_sources(workspace_id,user_id,source_id,kind,session_id,bound,header,events)
         VALUES($1,$2,$3,'conversation',$4,true,'{"old":"JOURNAL_BODY"}','[{"content":"JOURNAL_BODY"}]')`,
        [scope.workspaceId, scope.userId, id, `session-${id}`]
    )
}

/**
 * Applies the cleanup within the same transaction contract used by schema initialization.
 * @param pool - Disposable database pool.
 * @returns The committed cleanup result.
 */
async function migrate(pool: pg.Pool) {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await cleanupLegacyProjects(client)
        await client.query('COMMIT')
        return result
    } catch (error) {
        await client.query('ROLLBACK')
        throw error
    } finally {
        client.release()
    }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('retired project cleanup with real PostgreSQL', () => {
    it('removes exact old sources and one thread hop while preserving unrelated content and fencing late writes', async () => {
        await database(async pool => {
            const scope = { workspaceId: 'cleanup-workspace', userId: randomUUID() }
            const peer = { workspaceId: scope.workspaceId, userId: randomUUID() }
            const foreign = { workspaceId: 'unrelated-workspace', userId: scope.userId }
            const projectId = randomUUID()
            const nodeId = randomUUID()
            const direct = randomUUID()
            const oldTask = randomUUID()
            const oneHop = randomUUID()
            const secondHop = randomUUID()
            const unrelated = randomUUID()
            const firstThread = randomUUID()
            const secondThread = randomUUID()
            const oldJob = randomUUID()
            const unrelatedJob = randomUUID()
            const oldIntent = randomUUID()
            const previewId = randomUUID()
            const messageId = randomUUID()
            const eventId = randomUUID()
            const notificationId = randomUUID()
            const draftId = randomUUID()
            const keptDraftId = randomUUID()
            const keptMessageId = randomUUID()
            const keptNotificationId = randomUUID()
            const peerActionKey = `${peer.userId}:${randomUUID()}`
            await source(pool, scope, direct)
            await source(pool, scope, oldTask, projectId)
            await source(pool, peer, oneHop)
            await source(pool, scope, secondHop)
            await source(pool, scope, unrelated)
            await source(pool, foreign, direct)
            await source(pool, peer, direct)
            const state = {
                sequence: 9,
                projects: { [projectId]: { id: projectId, name: 'OLD_PROJECT', notes: [{ content: 'OLD_NOTE_BODY' }] } },
                nodes: { [nodeId]: { id: nodeId, projectId, ownerId: scope.userId, source: { kind: 'conversation', id: direct } } },
                questions: { [randomUUID()]: { projectId, question: 'OLD_QUESTION_BODY' } },
                artifacts: [{ projectId, content: 'OLD_ARTIFACT_BODY' }],
                events: [{ id: eventId, projectId, nodeId, content: 'OLD_EVENT_BODY' }],
                notifications: [
                    { id: notificationId, projectId, nodeId, content: 'OLD_NOTIFICATION_BODY' },
                    { id: keptNotificationId, projectId: null, nodeId: null, eventId: null, content: 'UNRELATED_NOTIFICATION' },
                ],
                messages: [
                    { id: messageId, threadId: firstThread, content: 'OLD_THREAD_BODY' },
                    { id: keptMessageId, threadId: secondThread, content: 'UNRELATED_SECOND_THREAD' },
                ],
                actions: {
                    old: { command: { type: 'delegate', source: { id: direct } }, result: { projectId, nodeId }, fingerprint: 'old' },
                    preserved: { command: { type: 'read', notificationIds: [] }, result: { requestId: randomUUID() }, fingerprint: 'keep' },
                    cancelledOld: { command: { type: 'cancel-dispatch', draftId }, result: { draftId }, fingerprint: 'old' },
                    confirmedOld: { command: { type: 'confirm-dispatch', draftId }, result: { draftId }, fingerprint: 'old' },
                    readOldNotification: { command: { type: 'read', notificationIds: [notificationId] }, result: {}, fingerprint: 'old' },
                    readOldMessage: { command: { type: 'read', messageIds: [messageId] }, result: {}, fingerprint: 'old' },
                    oldEventResult: { command: { type: 'read' }, result: { eventId }, fingerprint: 'old' },
                    keptCancel: {
                        command: { type: 'cancel-dispatch', draftId: keptDraftId },
                        result: { draftId: keptDraftId },
                        fingerprint: 'keep',
                    },
                    keptRead: {
                        command: { type: 'read', notificationIds: [keptNotificationId], messageIds: [keptMessageId] },
                        result: {},
                        fingerprint: 'keep',
                    },
                    [peerActionKey]: {
                        command: { type: 'message', source: { id: direct } },
                        result: { messageId: keptMessageId },
                        fingerprint: 'keep',
                    },
                },
            }
            await pool.query('INSERT INTO harness_collaboration_state(workspace_id,data) VALUES($1,$2::jsonb)', [
                scope.workspaceId,
                JSON.stringify(state),
            ])
            await pool.query('INSERT INTO harness_personal_projects(workspace_id,user_id,id,data) VALUES($1,$2,$3,$4::jsonb)', [
                scope.workspaceId,
                scope.userId,
                projectId,
                JSON.stringify({ project: { id: projectId, name: 'OLD_PROJECT_BODY' }, creation: { name: 'OLD_PROJECT_BODY' } }),
            ])
            for (const [thread, owner, target] of [
                [firstThread, scope.userId, direct],
                [firstThread, peer.userId, oneHop],
                [secondThread, peer.userId, oneHop],
                [secondThread, scope.userId, secondHop],
            ])
                await pool.query(
                    `INSERT INTO harness_collaboration_thread_sources(workspace_id,thread_id,user_id,peer_id,source_id,source_kind)
                     VALUES($1,$2,$3,$4,$5,'conversation')`,
                    [scope.workspaceId, thread, owner, owner === scope.userId ? peer.userId : scope.userId, target]
                )
            for (const [id, sourceId, node] of [
                [oldJob, direct, nodeId],
                [unrelatedJob, unrelated, null],
            ])
                await pool.query(
                    `INSERT INTO harness_collaboration_jobs(id,workspace_id,user_id,source_id,source_kind,node_id,session_id,trigger_id,content,mentions,fingerprint,status,token,lease_until)
                     VALUES($1,$2,$3,$4,'conversation',$5,$6,$7,$8,'[]',$9,'running',$10,clock_timestamp()+interval '1 minute')`,
                    [
                        id,
                        scope.workspaceId,
                        scope.userId,
                        sourceId,
                        node,
                        `session-${sourceId}`,
                        randomUUID(),
                        'JOB_BODY',
                        'digest',
                        randomUUID(),
                    ]
                )
            await pool.query(
                `INSERT INTO harness_collaboration_contact_intents(id,workspace_id,user_id,source_id,trigger_id,people)
                 VALUES($1,$2,$3,$4,$5,'[]')`,
                [oldIntent, scope.workspaceId, scope.userId, direct, randomUUID()]
            )
            await pool.query(
                `INSERT INTO harness_collaboration_job_intents(job_id,intent_id,original_mentions,explicit) VALUES($1,$2,'[]',true)`,
                [oldJob, oldIntent]
            )
            await pool.query(
                `INSERT INTO harness_workflow_contact_intents(id,workspace_id,user_id,source_id,node_id,source_grant,job_id,data)
                 VALUES($1,$2,$3,$4,$5,1,$6,'{"content":"OLD_FIXED_CONTACT_BODY"}')`,
                [randomUUID(), scope.workspaceId, scope.userId, direct, nodeId, oldJob]
            )
            await pool.query(
                `INSERT INTO harness_collaboration_dispatches(id,workspace_id,user_id,source_id,source_kind,session_id,job_id,intent_id,source_node_id,version,status,command,preview)
                 VALUES($1,$2,$3,$4,'conversation',$5,$6,$7,$8,1,'pending','{"content":"OLD_DRAFT_BODY"}','{"content":"OLD_DRAFT_BODY"}')`,
                [draftId, scope.workspaceId, scope.userId, direct, `session-${direct}`, oldJob, oldIntent, nodeId]
            )
            await pool.query(
                `INSERT INTO harness_collaboration_dispatches(id,workspace_id,user_id,source_id,source_kind,session_id,job_id,version,status,command,preview)
                 VALUES($1,$2,$3,$4,'conversation',$5,$6,1,'cancelled','{"type":"message","content":"UNRELATED_DRAFT"}','{"content":"UNRELATED_DRAFT"}')`,
                [keptDraftId, scope.workspaceId, scope.userId, unrelated, `session-${unrelated}`, unrelatedJob]
            )
            const templateId = randomUUID()
            await pool.query(
                'INSERT INTO harness_project_templates(workspace_id,user_id,id,data) VALUES($1,$2,$3,\'{"keep":"TEMPLATE_BODY"}\')',
                [scope.workspaceId, scope.userId, templateId]
            )
            await pool.query('INSERT INTO harness_template_launches(workspace_id,user_id,id,data) VALUES($1,$2,$3,$4::jsonb)', [
                scope.workspaceId,
                scope.userId,
                randomUUID(),
                JSON.stringify({ taskIds: [oldTask], input: { name: 'OLD_LAUNCH_BODY' } }),
            ])
            await pool.query(
                `INSERT INTO harness_workflow_previews(id,workspace_id,user_id,template_id,data,generations)
                 VALUES($1,$2,$3,$4,'{"opening":"OLD_PREVIEW_BODY"}','{}')`,
                [previewId, scope.workspaceId, scope.userId, templateId]
            )
            await pool.query(
                `INSERT INTO harness_workflow_launches(workspace_id,user_id,id,template_id,preview_id,result)
                 VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
                [scope.workspaceId, scope.userId, randomUUID(), templateId, previewId, JSON.stringify({ projectId, nodeIds: [nodeId] })]
            )
            const documentId = randomUUID()
            await pool.query(
                `INSERT INTO harness_knowledge_documents(workspace_id,user_id,id,document,object_key,sha256,fingerprint,status,created_at,updated_at)
                 VALUES($1,$2,$3,'{"fileName":"same-project-name.txt"}','PRIVATE_UNRELATED_OBJECT','sha','keep','ready',clock_timestamp(),clock_timestamp())`,
                [scope.workspaceId, scope.userId, documentId]
            )
            await pool.query(
                `INSERT INTO harness_knowledge_chunks(workspace_id,user_id,document_id,chunk_index,data) VALUES($1,$2,$3,1,'{"content":"UNRELATED_FILE_BODY"}')`,
                [scope.workspaceId, scope.userId, documentId]
            )

            const result = await migrate(pool)
            expect(result.conversations).toBe(3)
            expect(result.alreadyApplied).toBe(false)
            const preserved = await pool.query<{ id: string; workspace_id: string }>(
                'SELECT id,workspace_id FROM harness_chat_conversations'
            )
            expect(preserved.rows).toEqual(
                expect.arrayContaining([
                    { id: unrelated, workspace_id: scope.workspaceId },
                    { id: secondHop, workspace_id: scope.workspaceId },
                    { id: direct, workspace_id: foreign.workspaceId },
                    { id: direct, workspace_id: scope.workspaceId },
                ])
            )
            expect(preserved.rowCount).toBe(4)
            expect(
                (
                    await pool.query(
                        'SELECT 1 FROM harness_collaboration_sources WHERE workspace_id=$1 AND ((user_id=$2 AND source_id=ANY($3::uuid[])) OR (user_id=$4 AND source_id=$5))',
                        [scope.workspaceId, scope.userId, [direct, oldTask], peer.userId, oneHop]
                    )
                ).rowCount
            ).toBe(0)
            const aggregate = (await pool.query<{ data: typeof state }>('SELECT data FROM harness_collaboration_state')).rows[0].data
            expect(aggregate.projects).toEqual({})
            expect(aggregate.nodes).toEqual({})
            expect(aggregate.actions).toHaveProperty('preserved')
            expect(Object.keys(aggregate.actions).sort()).toEqual(['preserved', 'keptCancel', 'keptRead', peerActionKey].sort())
            expect(aggregate.messages.map(item => item.content)).toEqual(['UNRELATED_SECOND_THREAD'])
            expect(JSON.stringify(aggregate)).not.toContain('OLD_')
            expect((await pool.query('SELECT id FROM harness_collaboration_jobs')).rows).toEqual([{ id: unrelatedJob }])
            expect((await pool.query('SELECT id FROM harness_collaboration_dispatches')).rows).toEqual([{ id: keptDraftId }])
            expect(
                (await pool.query('SELECT kind,id FROM harness_retired_project_effects WHERE workspace_id=$1', [scope.workspaceId])).rows
            ).toEqual(
                expect.arrayContaining([
                    { kind: 'draft', id: draftId },
                    { kind: 'event', id: eventId },
                    { kind: 'notification', id: notificationId },
                    { kind: 'message', id: messageId },
                ])
            )
            expect((await pool.query('SELECT 1 FROM harness_collaboration_contact_intents')).rowCount).toBe(0)
            expect((await pool.query('SELECT 1 FROM harness_workflow_contact_intents')).rowCount).toBe(0)
            expect((await pool.query('SELECT 1 FROM harness_workflow_previews')).rowCount).toBe(0)
            expect((await pool.query('SELECT 1 FROM harness_workflow_launches')).rowCount).toBe(0)
            expect((await pool.query('SELECT 1 FROM harness_template_launches')).rowCount).toBe(0)
            expect((await pool.query('SELECT id FROM harness_project_templates')).rows).toEqual([{ id: templateId }])
            expect((await pool.query('SELECT object_key FROM harness_knowledge_documents')).rows).toEqual([
                { object_key: 'PRIVATE_UNRELATED_OBJECT' },
            ])
            expect((await pool.query('SELECT data FROM harness_knowledge_chunks')).rows).toEqual([
                { data: { content: 'UNRELATED_FILE_BODY' } },
            ])
            await expect(source(pool, scope, direct)).rejects.toMatchObject({ code: '55000' })
            await expect(source(pool, scope, randomUUID(), projectId)).rejects.toMatchObject({ code: '55000' })
            await expect(
                pool.query('UPDATE harness_collaboration_state SET data=$1::jsonb', [JSON.stringify(state)])
            ).rejects.toMatchObject({ code: '55000' })
            await expect(
                pool.query("INSERT INTO harness_personal_projects(workspace_id,user_id,id,data) VALUES($1,$2,$3,'{}')", [
                    scope.workspaceId,
                    scope.userId,
                    randomUUID(),
                ])
            ).rejects.toMatchObject({ code: '55000' })
            expect(await migrate(pool)).toEqual({ alreadyApplied: true, projects: 0, conversations: 0 })
        })
    }, 30_000)

    it('upgrades an already applied v1 cleanup and preserves valid unrelated message and read ledgers', async () => {
        await database(async pool => {
            const scope = { workspaceId: 'v1-upgrade', userId: randomUUID() }
            const sourceId = randomUUID()
            const jobId = randomUUID()
            const liveDraft = randomUUID()
            const removedDraft = randomUUID()
            const liveMessage = randomUUID()
            const liveNotification = randomUUID()
            const removedMessage = randomUUID()
            const removedNotification = randomUUID()
            const removedEvent = randomUUID()
            await source(pool, scope, sourceId)
            await pool.query(
                `INSERT INTO harness_collaboration_jobs(id,workspace_id,user_id,source_id,source_kind,session_id,trigger_id,content,mentions,fingerprint,status)
                 VALUES($1,$2,$3,$4,'conversation',$5,$6,'UNRELATED_JOB','[]','keep','completed')`,
                [jobId, scope.workspaceId, scope.userId, sourceId, `session-${sourceId}`, randomUUID()]
            )
            await pool.query(
                `INSERT INTO harness_collaboration_dispatches(id,workspace_id,user_id,source_id,source_kind,session_id,job_id,version,status,command,preview)
                 VALUES($1,$2,$3,$4,'conversation',$5,$6,1,'sent','{"type":"message"}','{"content":"UNRELATED_MESSAGE"}')`,
                [liveDraft, scope.workspaceId, scope.userId, sourceId, `session-${sourceId}`, jobId]
            )
            const actions = {
                oldCancel: { command: { type: 'cancel-dispatch', draftId: removedDraft }, result: { draftId: removedDraft } },
                oldConfirm: { command: { type: 'confirm-dispatch', draftId: removedDraft }, result: { draftId: removedDraft } },
                oldRead: { command: { type: 'read', notificationIds: [removedNotification], messageIds: [removedMessage] }, result: {} },
                oldEvent: { command: { type: 'read' }, result: { eventId: removedEvent } },
                keepMessage: { command: { type: 'message', source: { id: sourceId } }, result: { messageId: liveMessage }, jobId },
                keepConfirm: {
                    command: { type: 'confirm-dispatch', draftId: liveDraft },
                    result: { draftId: liveDraft, messageId: liveMessage },
                },
                keepRead: { command: { type: 'read', notificationIds: [liveNotification], messageIds: [liveMessage] }, result: {} },
            }
            const state = {
                sequence: 2,
                projects: {},
                nodes: {},
                questions: {},
                artifacts: [],
                events: [],
                notifications: [{ id: liveNotification, content: 'UNRELATED_NOTIFICATION' }],
                messages: [{ id: liveMessage, threadId: randomUUID(), content: 'UNRELATED_MESSAGE' }],
                actions,
            }
            await pool.query('INSERT INTO harness_collaboration_state(workspace_id,data) VALUES($1,$2::jsonb)', [
                scope.workspaceId,
                JSON.stringify(state),
            ])
            await pool.query("INSERT INTO harness_feature_migrations(id) VALUES('sf021-project-folders')")
            expect(await migrate(pool)).toEqual({ alreadyApplied: true, projects: 0, conversations: 0 })
            const result = (
                await pool.query<{ data: typeof state }>('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [
                    scope.workspaceId,
                ])
            ).rows[0].data
            expect(Object.keys(result.actions).sort()).toEqual(['keepMessage', 'keepConfirm', 'keepRead'].sort())
            expect(result.messages).toEqual(state.messages)
            expect(result.notifications).toEqual(state.notifications)
            expect((await pool.query('SELECT id FROM harness_collaboration_dispatches')).rows).toEqual([{ id: liveDraft }])
            expect(
                (await pool.query('SELECT kind,id FROM harness_retired_project_effects WHERE workspace_id=$1', [scope.workspaceId])).rows
            ).toEqual(
                expect.arrayContaining([
                    { kind: 'draft', id: removedDraft },
                    { kind: 'event', id: removedEvent },
                    { kind: 'notification', id: removedNotification },
                    { kind: 'message', id: removedMessage },
                ])
            )
            expect(await migrate(pool)).toEqual({ alreadyApplied: true, projects: 0, conversations: 0 })
        })
    }, 30_000)
})
