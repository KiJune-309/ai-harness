import { createHash } from 'node:crypto'
import type pg from 'pg'
import {
    createSkillSchema,
    updateSkillSchema,
    skillRecordSchema,
    skillSummarySchema,
    skillVersionSummarySchema,
    skillRefsSchema,
    skillSnapshotsSchema,
    type CreateSkill,
    type UpdateSkill,
    type SkillRecord,
    type SkillSummary,
    type SkillVersionSummary,
    type SkillRef,
    type SkillSnapshot,
} from '@ai-harness/contracts'
import type { ChatScope } from './index.js'
import { workspaceAccess } from './workspaces.js'

export class SkillAccessError extends Error {}
export class SkillConflictError extends Error {}
export class SkillValidationError extends Error {}

export interface SkillStore {
    /**
     * Lists only current owned summaries without exposing complete bodies in the directory.
     * @param scope - API-verified current account and workspace.
     * @returns Latest summaries ordered by update time and stable identity.
     */
    list(scope: ChatScope): Promise<SkillSummary[]>
    /**
     * Reads an owned current or exact immutable historical skill version.
     * @param scope - API-verified current ownership scope.
     * @param id - Stable skill identity.
     * @param version - Exact historical version, omitted for the current version.
     * @returns The complete owned record or undefined when it does not exist in this scope.
     */
    get(scope: ChatScope, id: string, version?: number): Promise<SkillRecord | undefined>
    /**
     * Lists immutable history metadata only for an owned existing skill.
     * @param scope - API-verified current ownership scope.
     * @param id - Stable skill identity.
     * @returns Newest-first version summaries, or undefined for an absent or foreign skill.
     */
    versions(scope: ChatScope, id: string): Promise<SkillVersionSummary[] | undefined>
    /**
     * Creates a first immutable version and its persistent idempotency outcome atomically.
     * @param scope - Actual human owner and workspace.
     * @param input - Normalized fields and stable creation request.
     * @returns The exact original committed version on a matching retry.
     * @throws SkillConflictError for a reused action with different normalized parameters.
     */
    create(scope: ChatScope, input: CreateSkill): Promise<SkillRecord>
    /**
     * Appends one complete immutable version against an expected current version.
     * @param scope - Actual human owner and workspace.
     * @param id - Existing owned skill.
     * @param input - Full fields, expected version and stable update request.
     * @returns The exact original new version on a matching action retry.
     * @throws SkillConflictError for stale versions or changed retry parameters.
     */
    update(scope: ChatScope, id: string, input: UpdateSkill): Promise<SkillRecord>
    /**
     * Resolves exact private versions into ordered server-owned Agent snapshots.
     * @param scope - Actual Agent owner's current workspace and identity.
     * @param refs - Explicit unique version references in selection order.
     * @returns Detached complete snapshots within the shared count and body limits.
     * @throws SkillAccessError for a foreign or absent exact version.
     * @throws SkillValidationError for excessive combined content.
     */
    resolve(scope: ChatScope, refs: SkillRef[]): Promise<SkillSnapshot[]>
}

interface SkillActionRow {
    kind: string
    skill_id: string
    version: number
    fingerprint: string
}

/**
 * Creates additive skill parent, immutable version and action-ledger tables on the existing initialization client.
 * @param client - Application schema initialization transaction.
 * @returns After all required tables exist, without creating accounts or a second pool.
 */
export async function initializeSkillTables(client: Pick<pg.Pool, 'query'>): Promise<void> {
    await client.query(`CREATE TABLE IF NOT EXISTS harness_skills(
        workspace_id text NOT NULL,user_id text NOT NULL,id uuid NOT NULL,current_version integer NOT NULL,
        created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,user_id,id))`)
    await client.query(`CREATE TABLE IF NOT EXISTS harness_skill_versions(
        workspace_id text NOT NULL,user_id text NOT NULL,skill_id uuid NOT NULL,version integer NOT NULL,data jsonb NOT NULL,
        PRIMARY KEY(workspace_id,user_id,skill_id,version),FOREIGN KEY(workspace_id,user_id,skill_id) REFERENCES harness_skills(workspace_id,user_id,id))`)
    await client.query(`CREATE TABLE IF NOT EXISTS harness_skill_actions(
        workspace_id text NOT NULL,user_id text NOT NULL,request_id uuid NOT NULL,kind text NOT NULL,skill_id uuid NOT NULL,
        version integer NOT NULL,fingerprint text NOT NULL,PRIMARY KEY(workspace_id,user_id,request_id),
        FOREIGN KEY(workspace_id,user_id,skill_id,version) REFERENCES harness_skill_versions(workspace_id,user_id,skill_id,version))`)
}

/**
 * Requires a real current membership while retaining its workspace and member locks through a transaction.
 * @param client - Current skill transaction.
 * @param scope - API-verified actual identity and selected workspace.
 * @returns Nothing while the scope remains authorized.
 * @throws SkillAccessError for incomplete, removed or foreign scope.
 */
async function requireSkillScope(client: pg.PoolClient, scope: ChatScope): Promise<void> {
    if (!scope?.userId || !scope.workspaceId || !(await workspaceAccess(client, scope, true))) throw new SkillAccessError('未找到此技能。')
}

/**
 * Runs one business operation on the application-owned pool without volatile state or partial commits.
 * @param pool - Shared initialized PostgreSQL pool.
 * @param scope - Actual skill owner and current workspace.
 * @param action - Complete scoped read or mutation.
 * @returns Its committed result.
 * @throws Error after rollback on authorization, validation or persistence failure.
 */
async function skillTransaction<T>(pool: pg.Pool, scope: ChatScope, action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        await requireSkillScope(client, scope)
        const result = await action(client)
        await client.query('COMMIT')
        return result
    } catch (error) {
        try {
            await client.query('ROLLBACK')
        } catch {
            // Preserve the operation's original failure if the disconnected client cannot roll back.
        }
        throw error
    } finally {
        client.release()
    }
}

/**
 * Reads only the requested owned current or exact version inside an authorized transaction.
 * @param client - Membership-protected transaction.
 * @param scope - Actual owner and workspace.
 * @param id - Canonical skill identity.
 * @param version - Exact version or current-version selection.
 * @returns A strict complete owned version, or undefined.
 */
async function skillVersion(client: pg.PoolClient, scope: ChatScope, id: string, version?: number): Promise<SkillRecord | undefined> {
    const rows = await client.query<{ data: unknown }>(
        `SELECT v.data FROM harness_skills s JOIN harness_skill_versions v
        ON v.workspace_id=s.workspace_id AND v.user_id=s.user_id AND v.skill_id=s.id AND v.version=COALESCE($4::bigint,s.current_version)
        WHERE s.workspace_id=$1 AND s.user_id=$2 AND s.id=$3`,
        [scope.workspaceId, scope.userId, id, version ?? null]
    )
    return rows.rows[0] ? skillRecordSchema.parse(rows.rows[0].data) : undefined
}

/**
 * Hashes a canonical tuple, avoiding dependence on PostgreSQL JSON object key order.
 * @param kind - Create or update operation.
 * @param id - Exact skill identity.
 * @param input - Strict normalized action fields.
 * @returns A content-independent opaque persisted comparison digest.
 */
function skillFingerprint(kind: 'create' | 'update', id: string, input: CreateSkill | UpdateSkill): string {
    return createHash('sha256')
        .update(JSON.stringify([kind, id, 'version' in input ? input.version : null, input.title, input.description, input.content]))
        .digest('hex')
}

/**
 * Serializes one action across processes and checks its immutable stored outcome before a version comparison.
 * @param client - Owning mutation transaction.
 * @param scope - Actual owner and workspace.
 * @param requestId - Stable normalized action.
 * @param kind - Required action kind.
 * @param id - Expected skill identity.
 * @param digest - Canonical normalized parameter digest.
 * @returns The exact original committed version or undefined for a new action.
 * @throws SkillConflictError when the same action is reused for different parameters.
 */
async function replaySkillAction(
    client: pg.PoolClient,
    scope: ChatScope,
    requestId: string,
    kind: 'create' | 'update',
    id: string,
    digest: string
): Promise<SkillRecord | undefined> {
    // This transaction-only lock serializes the stable action before any parent-row lock; hash collisions only serialize unrelated work.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [scope.workspaceId, `${scope.userId}:${requestId}`])
    const rows = await client.query<SkillActionRow>(
        'SELECT kind,skill_id,version,fingerprint FROM harness_skill_actions WHERE workspace_id=$1 AND user_id=$2 AND request_id=$3',
        [scope.workspaceId, scope.userId, requestId]
    )
    const old = rows.rows[0]
    if (!old) return undefined
    if (old.kind !== kind || old.skill_id !== id || old.fingerprint !== digest)
        throw new SkillConflictError('同一动作标识不能用于不同技能内容。')
    const record = await skillVersion(client, scope, old.skill_id, old.version)
    if (!record) throw new Error('Committed skill action has no immutable version.')
    return record
}

/**
 * Appends one immutable version and its original action outcome in the same transaction.
 * @param client - Owning skill mutation transaction.
 * @param scope - Actual owner.
 * @param requestId - Stable action identity.
 * @param kind - Action type.
 * @param record - Complete immutable new version.
 * @param digest - Normalized parameter digest.
 * @returns Nothing until both immutable records have been inserted.
 */
async function persistSkillVersion(
    client: pg.PoolClient,
    scope: ChatScope,
    requestId: string,
    kind: 'create' | 'update',
    record: SkillRecord,
    digest: string
): Promise<void> {
    await client.query('INSERT INTO harness_skill_versions(workspace_id,user_id,skill_id,version,data) VALUES($1,$2,$3,$4,$5::jsonb)', [
        scope.workspaceId,
        scope.userId,
        record.id,
        record.version,
        JSON.stringify(record),
    ])
    await client.query(
        'INSERT INTO harness_skill_actions(workspace_id,user_id,request_id,kind,skill_id,version,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [scope.workspaceId, scope.userId, requestId, kind, record.id, record.version, digest]
    )
}

/**
 * Creates actual private skill persistence using the parent application's initialized PostgreSQL pool.
 * @param pool - Shared process-owned pool.
 * @returns Durable skill, history, action and snapshot resolution operations.
 */
export function createPostgresSkillStore(pool: pg.Pool): SkillStore {
    return {
        /**
         * Lists current owned summaries with stable time and identity ordering.
         * @param scope - Actual current ownership scope.
         * @returns Current summaries without full bodies.
         */
        list(scope) {
            return skillTransaction(pool, scope, async client => {
                const rows = await client.query<{ data: unknown }>(
                    `SELECT v.data-'content' AS data FROM harness_skills s JOIN harness_skill_versions v
                    ON v.workspace_id=s.workspace_id AND v.user_id=s.user_id AND v.skill_id=s.id AND v.version=s.current_version
                    WHERE s.workspace_id=$1 AND s.user_id=$2 ORDER BY s.updated_at DESC,s.id ASC`,
                    [scope.workspaceId, scope.userId]
                )
                return rows.rows.map(row => skillSummarySchema.parse(row.data))
            })
        },
        /**
         * Reads an owned complete current or precise historical version.
         * @param scope - Actual current owner.
         * @param id - Stable skill identity.
         * @param version - Optional exact version.
         * @returns The complete owned version or undefined.
         */
        get(scope, id, version) {
            return skillTransaction(pool, scope, client => skillVersion(client, scope, id.toLowerCase(), version))
        },
        /**
         * Lists retained immutable versions newest first for one owned skill.
         * @param scope - Actual current owner.
         * @param id - Stable skill identity.
         * @returns Version summaries or undefined when the owned parent does not exist.
         */
        versions(scope, id) {
            return skillTransaction(pool, scope, async client => {
                const parent = await client.query('SELECT 1 FROM harness_skills WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                    scope.workspaceId,
                    scope.userId,
                    id,
                ])
                if (!parent.rowCount) return undefined
                const rows = await client.query<{ data: unknown }>(
                    'SELECT data FROM harness_skill_versions WHERE workspace_id=$1 AND user_id=$2 AND skill_id=$3 ORDER BY version DESC',
                    [scope.workspaceId, scope.userId, id]
                )
                return rows.rows.map(row => {
                    const record = skillRecordSchema.parse(row.data)
                    return skillVersionSummarySchema.parse({ version: record.version, title: record.title, updatedAt: record.updatedAt })
                })
            })
        },
        /**
         * Creates one first version and durable action after complete normalization.
         * @param scope - Actual current human owner.
         * @param candidate - Full skill fields and stable action.
         * @returns The exact first version or its committed replay.
         * @throws SkillConflictError for a reused identity or changed action parameters.
         */
        create(scope, candidate) {
            const input = createSkillSchema.parse(candidate)
            const id = input.requestId
            const digest = skillFingerprint('create', id, input)
            return skillTransaction(pool, scope, async client => {
                const replay = await replaySkillAction(client, scope, input.requestId, 'create', id, digest)
                if (replay) return replay
                const now = new Date().toISOString()
                const record = skillRecordSchema.parse({
                    id,
                    version: 1,
                    title: input.title,
                    description: input.description,
                    content: input.content,
                    createdAt: now,
                    updatedAt: now,
                })
                const inserted = await client.query(
                    'INSERT INTO harness_skills(workspace_id,user_id,id,current_version,created_at,updated_at) VALUES($1,$2,$3,1,$4,$4) ON CONFLICT DO NOTHING RETURNING id',
                    [scope.workspaceId, scope.userId, id, now]
                )
                if (!inserted.rowCount) throw new SkillConflictError('该技能标识已使用，请重读后核对。')
                await persistSkillVersion(client, scope, input.requestId, 'create', record, digest)
                return record
            })
        },
        /**
         * Appends exactly one version after checking the durable action before the parent revision.
         * @param scope - Actual current human owner.
         * @param id - Owned skill identity.
         * @param candidate - Complete new contents, expected revision and stable action.
         * @returns The exact new immutable version or its original replay.
         * @throws SkillConflictError for stale versions or changed action parameters.
         */
        update(scope, id, candidate) {
            const input = updateSkillSchema.parse(candidate)
            id = id.toLowerCase()
            const digest = skillFingerprint('update', id, input)
            return skillTransaction(pool, scope, async client => {
                const replay = await replaySkillAction(client, scope, input.requestId, 'update', id, digest)
                if (replay) return replay
                const current = await client.query<{ current_version: number; created_at: Date }>(
                    'SELECT current_version,created_at FROM harness_skills WHERE workspace_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE',
                    [scope.workspaceId, scope.userId, id]
                )
                if (!current.rows[0]) throw new SkillAccessError('未找到此技能。')
                if (current.rows[0].current_version !== input.version) throw new SkillConflictError('技能版本已变化，请重读并核对后保存。')
                const now = new Date().toISOString()
                const record = skillRecordSchema.parse({
                    id,
                    version: input.version + 1,
                    title: input.title,
                    description: input.description,
                    content: input.content,
                    createdAt: current.rows[0].created_at.toISOString(),
                    updatedAt: now,
                })
                await persistSkillVersion(client, scope, input.requestId, 'update', record, digest)
                await client.query(
                    'UPDATE harness_skills SET current_version=$4,updated_at=$5 WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                    [scope.workspaceId, scope.userId, id, record.version, now]
                )
                return record
            })
        },
        /**
         * Resolves only precise owner-approved history without reading latest versions implicitly.
         * @param scope - Actual Agent owner and current workspace.
         * @param candidate - Explicit ordered version references.
         * @returns Ordered complete frozen snapshots.
         * @throws SkillAccessError for a foreign or missing requested version.
         * @throws SkillValidationError for combined content exceeding the binding limit.
         */
        resolve(scope, candidate) {
            const refs = skillRefsSchema.parse(candidate)
            return skillTransaction(pool, scope, async client => {
                const snapshots: SkillSnapshot[] = []
                for (const ref of refs) {
                    const record = await skillVersion(client, scope, ref.skillId, ref.version)
                    if (!record) throw new SkillAccessError('未找到此技能版本。')
                    snapshots.push({
                        skillId: record.id,
                        version: record.version,
                        title: record.title,
                        description: record.description,
                        content: record.content,
                    })
                }
                const parsed = skillSnapshotsSchema.safeParse(snapshots)
                if (!parsed.success) throw new SkillValidationError('最多选择5个不同技能，正文合计不能超过32000字。')
                return parsed.data
            })
        },
    }
}
