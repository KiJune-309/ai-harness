import type pg from 'pg'

export interface LegacyProjectCleanupResult {
    alreadyApplied: boolean
    projects: number
    conversations: number
}

type JsonRecord = Record<string, unknown>
type EffectKind = 'draft' | 'event' | 'notification' | 'message' | 'job'
type OwnedSources = Map<string, Set<string>>

/**
 * Reads only plain JSON records without interpreting document text as references.
 * @param value - Persisted JSON value.
 * @returns The record or an empty object for absent values.
 */
function record(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

/**
 * Reads a persisted JSON collection without evaluating its contents.
 * @param value - Candidate collection.
 * @returns The original collection or an empty array.
 */
function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

/**
 * Identifies structural references to removed projects, nodes, threads or exact sources.
 * @param value - Event, notification, command or committed result.
 * @param sources - Exact retired source identities in this workspace.
 * @param threads - Exact communication threads linked to retired sources.
 * @returns Whether the record belongs to the removed project model.
 */
function related(value: unknown, sources: Set<string>, threads: Set<string>): boolean {
    const item = record(value)
    if (item.projectId || item.nodeId || item.targetNodeId || item.upstreamNodeId || item.artifactId || item.questionId || item.noteId)
        return true
    if (typeof item.threadId === 'string' && threads.has(item.threadId)) return true
    if (typeof item.sourceId === 'string' && sources.has(item.sourceId)) return true
    if (typeof item.conversationId === 'string' && sources.has(item.conversationId)) return true
    if (typeof item.taskId === 'string' && sources.has(item.taskId)) return true
    const source = record(item.source)
    return typeof source.id === 'string' && sources.has(source.id)
}

/**
 * Removes project-owned content while preserving unrelated private message activity.
 * @param candidate - One locked collaboration aggregate.
 * @param owners - Exact retired source IDs grouped by their real owner in this workspace.
 * @param threads - Exact old communication thread IDs within this workspace.
 * @returns A detached aggregate without any project model records or their action snapshots.
 */
function cleanState(candidate: unknown, owners: OwnedSources, threads: Set<string>): JsonRecord {
    const state = record(candidate)
    const sources = new Set([...owners.values()].flatMap(values => [...values]))
    const events = array(state.events).filter(item => !related(item, sources, threads))
    const removedEventIds = new Set(
        array(state.events)
            .filter(item => related(item, sources, threads))
            .map(item => record(item).id)
    )
    const notifications = array(state.notifications).filter(item => {
        const notification = record(item)
        return !related(item, sources, threads) && !removedEventIds.has(notification.eventId)
    })
    const actions = Object.fromEntries(
        Object.entries(record(state.actions)).filter(([key, value]) => {
            const action = record(value)
            const command = record(action.command)
            const actorSources = owners.get(key.split(':')[0]!) ?? new Set<string>()
            const recipientSources =
                typeof command.recipientId === 'string' ? (owners.get(command.recipientId) ?? new Set<string>()) : actorSources
            return (
                ['message', 'read', 'confirm-dispatch', 'cancel-dispatch'].includes(String(command.type)) &&
                !related(command, actorSources, threads) &&
                !related(action.result, recipientSources, threads)
            )
        })
    )
    return {
        ...state,
        projects: {},
        nodes: {},
        questions: {},
        artifacts: [],
        events,
        notifications,
        messages: array(state.messages).filter(item => !threads.has(String(record(item).threadId))),
        actions,
    }
}

/**
 * Collects only typed effect-reference fields, without searching free text or arbitrary nested values.
 * @param candidate - A command, committed result or action envelope.
 * @returns Explicit draft, event, notification, message and job identities.
 */
function effectReferences(candidate: unknown): { kind: EffectKind; id: string }[] {
    const value = record(candidate)
    const references: { kind: EffectKind; id: string }[] = []
    for (const [field, kind] of [
        ['draftId', 'draft'],
        ['eventId', 'event'],
        ['notificationId', 'notification'],
        ['messageId', 'message'],
        ['jobId', 'job'],
    ] as const) {
        if (typeof value[field] === 'string') references.push({ kind, id: value[field] })
    }
    for (const [field, kind] of [
        ['notificationIds', 'notification'],
        ['messageIds', 'message'],
    ] as const)
        for (const id of array(value[field])) if (typeof id === 'string') references.push({ kind, id })
    return references
}

/**
 * Removes action-ledger references to precisely retired effects, including upgrades after the first cleanup ran.
 * @param connection - Active schema initialization transaction.
 * @returns After stale reference actions are removed and retirement metadata is durable.
 * @throws Error when reconciliation cannot complete atomically.
 */
async function reconcileRetiredProjectActions(connection: Pick<pg.PoolClient, 'query'>): Promise<void> {
    const applied = await connection.query("SELECT 1 FROM harness_feature_migrations WHERE id='sf021-project-action-cleanup'")
    if (applied.rowCount) return
    await connection.query('LOCK TABLE harness_collaboration_state,harness_collaboration_dispatches IN ACCESS EXCLUSIVE MODE')
    const states = await connection.query<{ workspace_id: string; data: JsonRecord }>(
        'SELECT workspace_id,data FROM harness_collaboration_state'
    )
    for (const row of states.rows) {
        const state = record(row.data)
        const drafts = await connection.query<{ id: string }>('SELECT id FROM harness_collaboration_dispatches WHERE workspace_id=$1', [
            row.workspace_id,
        ])
        const jobs = await connection.query<{ id: string }>('SELECT id FROM harness_collaboration_jobs WHERE workspace_id=$1', [
            row.workspace_id,
        ])
        const live: Record<EffectKind, Set<string>> = {
            draft: new Set(drafts.rows.map(item => item.id)),
            job: new Set(jobs.rows.map(item => item.id)),
            event: new Set(array(state.events).map(item => String(record(item).id))),
            notification: new Set(array(state.notifications).map(item => String(record(item).id))),
            message: new Set(array(state.messages).map(item => String(record(item).id))),
        }
        const retired = await connection.query<{ kind: EffectKind; id: string }>(
            'SELECT kind,id FROM harness_retired_project_effects WHERE workspace_id=$1',
            [row.workspace_id]
        )
        const retiredKeys = new Set(retired.rows.map(item => `${item.kind}:${item.id}`))
        const removed: { kind: EffectKind; id: string }[] = []
        const actions = Object.fromEntries(
            Object.entries(record(state.actions)).filter(([, action]) => {
                const value = record(action)
                const references = [...effectReferences(value), ...effectReferences(value.command), ...effectReferences(value.result)]
                let retain = true
                for (const reference of references) {
                    // Effect collections were append-only before retirement: a missing typed target is an old removed effect.
                    if (!live[reference.kind].has(reference.id) || retiredKeys.has(`${reference.kind}:${reference.id}`)) {
                        removed.push(reference)
                        retain = false
                    }
                }
                return retain
            })
        )
        for (const effect of removed)
            await connection.query(
                'INSERT INTO harness_retired_project_effects(workspace_id,kind,id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
                [row.workspace_id, effect.kind, effect.id]
            )
        await connection.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
            row.workspace_id,
            JSON.stringify({ ...state, actions }),
        ])
    }
    await connection.query("INSERT INTO harness_feature_migrations(id) VALUES('sf021-project-action-cleanup')")
}

/**
 * Installs durable write fences after old content has been removed under table locks.
 * @param connection - The schema initialization transaction.
 * @returns After stale snapshots and old project creation paths are fenced in PostgreSQL.
 * @throws Error when the persistent protections cannot be installed.
 */
async function installRetirementFences(connection: Pick<pg.PoolClient, 'query'>): Promise<void> {
    await connection.query(`CREATE OR REPLACE FUNCTION harness_reject_retired_project_source() RETURNS trigger AS $$
        BEGIN
            IF NULLIF(NEW.task_data->>'projectId','') IS NOT NULL OR
                NULLIF(NEW.task_data->>'creationProjectId','') IS NOT NULL OR
                EXISTS(SELECT 1 FROM harness_retired_project_sources r
                WHERE r.workspace_id=NEW.workspace_id AND r.user_id=NEW.user_id AND r.source_id=NEW.id) THEN
                RAISE EXCEPTION '旧项目对话已删除，不能重新写入。' USING ERRCODE='55000';
            END IF;
            RETURN NEW;
        END;
    $$ LANGUAGE plpgsql`)
    await connection.query('DROP TRIGGER IF EXISTS harness_retired_project_source_guard ON harness_chat_conversations')
    await connection.query(`CREATE TRIGGER harness_retired_project_source_guard BEFORE INSERT OR UPDATE ON harness_chat_conversations
        FOR EACH ROW EXECUTE FUNCTION harness_reject_retired_project_source()`)
    await connection.query(`CREATE OR REPLACE FUNCTION harness_reject_legacy_project_write() RETURNS trigger AS $$
        BEGIN
            IF TG_TABLE_NAME='harness_personal_projects' OR
                COALESCE(NEW.data->'projects','{}'::jsonb)<>'{}'::jsonb OR
                COALESCE(NEW.data->'nodes','{}'::jsonb)<>'{}'::jsonb THEN
                RAISE EXCEPTION '旧项目功能已移除，请使用个人项目文件夹。' USING ERRCODE='55000';
            END IF;
            RETURN NEW;
        END;
    $$ LANGUAGE plpgsql`)
    await connection.query('DROP TRIGGER IF EXISTS harness_legacy_project_write_guard ON harness_personal_projects')
    await connection.query(`CREATE TRIGGER harness_legacy_project_write_guard BEFORE INSERT OR UPDATE ON harness_personal_projects
        FOR EACH ROW EXECUTE FUNCTION harness_reject_legacy_project_write()`)
    await connection.query('DROP TRIGGER IF EXISTS harness_legacy_project_state_guard ON harness_collaboration_state')
    await connection.query(`CREATE TRIGGER harness_legacy_project_state_guard BEFORE INSERT OR UPDATE ON harness_collaboration_state
        FOR EACH ROW EXECUTE FUNCTION harness_reject_legacy_project_write()`)
}

/**
 * Deletes the retired project model once while preserving unrelated user business records.
 * @param connection - Schema initialization connection inside an active transaction, before workers start.
 * @returns Counts of deleted old projects and precisely related conversations, or a completed-migration replay.
 * @throws Error when cleanup cannot finish atomically; the caller must roll back initialization.
 */
export async function cleanupLegacyProjects(connection: Pick<pg.PoolClient, 'query'>): Promise<LegacyProjectCleanupResult> {
    await connection.query(`CREATE TABLE IF NOT EXISTS harness_feature_migrations (
        id text PRIMARY KEY,completed_at timestamptz NOT NULL DEFAULT clock_timestamp())`)
    await connection.query(`CREATE TABLE IF NOT EXISTS harness_retired_project_sources (
        workspace_id text NOT NULL,user_id text NOT NULL,source_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,user_id,source_id))`)
    await connection.query(`CREATE TABLE IF NOT EXISTS harness_retired_project_effects (
        workspace_id text NOT NULL,kind text NOT NULL,id text NOT NULL,PRIMARY KEY(workspace_id,kind,id))`)
    const completed = await connection.query("SELECT 1 FROM harness_feature_migrations WHERE id='sf021-project-folders'")
    if (completed.rowCount) {
        await reconcileRetiredProjectActions(connection)
        return { alreadyApplied: true, projects: 0, conversations: 0 }
    }

    // Startup holds the shared schema advisory lock; table locks also fence older running processes.
    await connection.query(`LOCK TABLE harness_chat_conversations,harness_personal_projects,harness_template_launches,
        harness_collaboration_state,harness_collaboration_sources,harness_collaboration_thread_sources,
        harness_collaboration_jobs,harness_collaboration_job_intents,harness_collaboration_dispatches,
        harness_collaboration_contact_intents,harness_workflow_previews,harness_workflow_launches,
        harness_workflow_contact_intents IN ACCESS EXCLUSIVE MODE`)
    await connection.query(`CREATE TEMP TABLE sf021_retired_sources (
        workspace_id text NOT NULL,user_id text NOT NULL,source_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,user_id,source_id)) ON COMMIT DROP`)
    await connection.query(`INSERT INTO sf021_retired_sources
        SELECT workspace_id,user_id,id FROM harness_chat_conversations
        WHERE NULLIF(task_data->>'projectId','') IS NOT NULL OR NULLIF(task_data->>'creationProjectId','') IS NOT NULL
        ON CONFLICT DO NOTHING`)
    await connection.query(`INSERT INTO sf021_retired_sources
        SELECT c.workspace_id,c.user_id,c.id FROM harness_collaboration_state s
        CROSS JOIN LATERAL jsonb_each(COALESCE(s.data->'nodes','{}')) n
        JOIN harness_chat_conversations c ON c.workspace_id=s.workspace_id
            AND c.user_id=n.value->>'ownerId' AND c.id::text=n.value->'source'->>'id'
        ON CONFLICT DO NOTHING`)
    await connection.query(`INSERT INTO sf021_retired_sources
        SELECT c.workspace_id,c.user_id,c.id FROM harness_template_launches l
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(l.data->'taskIds','[]')) task_id
        JOIN harness_chat_conversations c ON c.workspace_id=l.workspace_id AND c.user_id=l.user_id AND c.id::text=task_id
        ON CONFLICT DO NOTHING`)
    await connection.query(`CREATE TEMP TABLE sf021_retired_threads ON COMMIT DROP AS
        SELECT DISTINCT t.workspace_id,t.thread_id FROM harness_collaboration_thread_sources t
        JOIN sf021_retired_sources r ON r.workspace_id=t.workspace_id AND r.user_id=t.user_id AND r.source_id=t.source_id`)
    // One exact thread hop includes the recipient copy and its journal without following unrelated later threads.
    await connection.query(`INSERT INTO sf021_retired_sources
        SELECT t.workspace_id,t.user_id,t.source_id FROM harness_collaboration_thread_sources t
        JOIN sf021_retired_threads r ON r.workspace_id=t.workspace_id AND r.thread_id=t.thread_id
        ON CONFLICT DO NOTHING`)
    await connection.query(`CREATE TEMP TABLE sf021_retired_jobs ON COMMIT DROP AS
        SELECT j.id FROM harness_collaboration_jobs j LEFT JOIN sf021_retired_sources r
        ON r.workspace_id=j.workspace_id AND r.user_id=j.user_id AND r.source_id=j.source_id
        WHERE j.node_id IS NOT NULL OR r.source_id IS NOT NULL`)
    const states = await connection.query<{ workspace_id: string; data: JsonRecord }>(
        'SELECT workspace_id,data FROM harness_collaboration_state'
    )
    const projectCount = await connection.query<{ count: string }>('SELECT count(*)::text AS count FROM harness_personal_projects')
    let projects = Number(projectCount.rows[0]?.count ?? 0)
    for (const state of states.rows) {
        projects += Object.keys(record(state.data.projects)).length
        const sources = await connection.query<{ user_id: string; source_id: string }>(
            'SELECT user_id,source_id FROM sf021_retired_sources WHERE workspace_id=$1',
            [state.workspace_id]
        )
        const threads = await connection.query<{ thread_id: string }>('SELECT thread_id FROM sf021_retired_threads WHERE workspace_id=$1', [
            state.workspace_id,
        ])
        const owners: OwnedSources = new Map()
        for (const source of sources.rows) {
            if (!owners.has(source.user_id)) owners.set(source.user_id, new Set())
            owners.get(source.user_id)!.add(source.source_id)
        }
        const next = cleanState(state.data, owners, new Set(threads.rows.map(item => item.thread_id)))
        for (const [kind, field] of [
            ['event', 'events'],
            ['notification', 'notifications'],
            ['message', 'messages'],
        ] as const) {
            const retained = new Set(array(next[field]).map(item => record(item).id))
            for (const item of array(state.data[field])) {
                const id = record(item).id
                if (typeof id === 'string' && !retained.has(id))
                    await connection.query(
                        'INSERT INTO harness_retired_project_effects(workspace_id,kind,id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
                        [state.workspace_id, kind, id]
                    )
            }
        }
        await connection.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
            state.workspace_id,
            JSON.stringify(next),
        ])
    }
    await connection.query(`INSERT INTO harness_retired_project_sources SELECT * FROM sf021_retired_sources ON CONFLICT DO NOTHING`)
    await connection.query(`INSERT INTO harness_retired_project_effects(workspace_id,kind,id)
        SELECT d.workspace_id,'draft',d.id::text FROM harness_collaboration_dispatches d WHERE
        d.job_id IN(SELECT id FROM sf021_retired_jobs) OR d.source_node_id IS NOT NULL OR d.target_node_id IS NOT NULL OR
        EXISTS(SELECT 1 FROM sf021_retired_sources r WHERE r.workspace_id=d.workspace_id AND r.user_id=d.user_id AND r.source_id=d.source_id)
        ON CONFLICT DO NOTHING`)
    await connection.query(`INSERT INTO harness_retired_project_effects(workspace_id,kind,id)
        SELECT j.workspace_id,'job',j.id::text FROM harness_collaboration_jobs j WHERE j.id IN(SELECT id FROM sf021_retired_jobs)
        ON CONFLICT DO NOTHING`)
    await connection.query(`DELETE FROM harness_collaboration_dispatches d WHERE
        d.job_id IN(SELECT id FROM sf021_retired_jobs) OR d.source_node_id IS NOT NULL OR d.target_node_id IS NOT NULL OR
        EXISTS(SELECT 1 FROM sf021_retired_sources r WHERE r.workspace_id=d.workspace_id AND r.user_id=d.user_id AND r.source_id=d.source_id)`)
    await connection.query(`DELETE FROM harness_workflow_contact_intents`)
    await connection.query(`DELETE FROM harness_collaboration_job_intents m WHERE m.job_id IN(SELECT id FROM sf021_retired_jobs)
        OR m.intent_id IN(SELECT i.id FROM harness_collaboration_contact_intents i JOIN sf021_retired_sources r
            ON r.workspace_id=i.workspace_id AND r.user_id=i.user_id AND r.source_id=i.source_id)`)
    await connection.query(`DELETE FROM harness_collaboration_jobs WHERE id IN(SELECT id FROM sf021_retired_jobs)`)
    await connection.query(`DELETE FROM harness_collaboration_contact_intents i USING sf021_retired_sources r
        WHERE r.workspace_id=i.workspace_id AND r.user_id=i.user_id AND r.source_id=i.source_id`)
    await connection.query(`DELETE FROM harness_collaboration_thread_sources t WHERE
        EXISTS(SELECT 1 FROM sf021_retired_threads r WHERE r.workspace_id=t.workspace_id AND r.thread_id=t.thread_id) OR
        EXISTS(SELECT 1 FROM sf021_retired_sources r WHERE r.workspace_id=t.workspace_id AND r.user_id=t.user_id AND r.source_id=t.source_id)`)
    await connection.query(`DELETE FROM harness_collaboration_sources s USING sf021_retired_sources r
        WHERE r.workspace_id=s.workspace_id AND r.user_id=s.user_id AND r.source_id=s.source_id`)
    const removed = await connection.query(`DELETE FROM harness_chat_conversations c USING sf021_retired_sources r
        WHERE r.workspace_id=c.workspace_id AND r.user_id=c.user_id AND r.source_id=c.id RETURNING c.id`)
    await connection.query('DELETE FROM harness_personal_projects')
    await connection.query('DELETE FROM harness_template_launches')
    await connection.query('DELETE FROM harness_workflow_launches')
    await connection.query('DELETE FROM harness_workflow_previews')
    await installRetirementFences(connection)
    await connection.query("INSERT INTO harness_feature_migrations(id) VALUES('sf021-project-folders')")
    await reconcileRetiredProjectActions(connection)
    return { alreadyApplied: false, projects, conversations: removed.rowCount ?? 0 }
}
