import { createHash } from 'node:crypto'
import type pg from 'pg'
import type {
    CreateWorkspace,
    InviteWorkspaceMember,
    TeamWorkspace,
    WorkspaceDetail,
    WorkspaceDirectory,
    WorkspaceInput,
    WorkspaceInvitation,
} from '@ai-harness/contracts'
import type { ChatScope } from './index.js'
import { revokeWorkspaceCollaboration } from './collaboration.js'

export class WorkspaceAccessError extends Error {}
export class WorkspaceConflictError extends Error {}

export interface WorkspaceStore {
    /**
     * Resolves the session's active authorized workspace, falling back to its historical scope.
     * @param scope - Authenticated account identity.
     * @param tokenHash - Persisted session hash.
     * @returns The currently authorized workspace identifier.
     */
    current(scope: ChatScope, tokenHash: string): Promise<string>
    /**
     * Lists joined spaces and actionable invitations for the current account.
     * @param scope - Authenticated identity.
     * @param tokenHash - Current session hash.
     * @returns Safe directory with its current selection.
     */
    directory(scope: ChatScope, tokenHash: string): Promise<WorkspaceDirectory>
    /**
     * Checks current membership without exposing another user's records.
     * @param scope - Trusted requested ownership scope.
     * @returns Whether the user can currently access this space.
     */
    access(scope: ChatScope): Promise<boolean>
    /**
     * Creates one team with its owner atomically and idempotently.
     * @param scope - Authenticated creator.
     * @param input - Validated original creation and retry identity.
     * @returns Persisted team with the caller's role.
     */
    create(scope: ChatScope, input: CreateWorkspace): Promise<TeamWorkspace>
    /**
     * Reads member-visible team settings and owner-visible invitations.
     * @param scope - Authenticated requester.
     * @param id - Requested workspace identifier.
     * @returns The authorized roster and settings.
     */
    detail(scope: ChatScope, id: string): Promise<WorkspaceDetail>
    /**
     * Updates a team's name and description after checking its owner.
     * @param scope - Authenticated requester.
     * @param id - Team identifier.
     * @param input - Validated editable fields.
     * @returns Updated team.
     */
    update(scope: ChatScope, id: string, input: WorkspaceInput): Promise<TeamWorkspace>
    /**
     * Persists a verified current-session selection without moving any business data.
     * @param scope - Authenticated requester.
     * @param tokenHash - Current session hash.
     * @param id - Joined workspace identifier.
     * @returns After selection is persisted.
     */
    select(scope: ChatScope, tokenHash: string, id: string): Promise<void>
    /**
     * Creates a bounded, email-bound invitation to an existing account.
     * @param scope - Authenticated owner.
     * @param id - Target team.
     * @param input - Normalized email and stable action identifier.
     * @returns The persisted invitation, including an original replay result.
     */
    invite(scope: ChatScope, id: string, input: InviteWorkspaceMember): Promise<WorkspaceInvitation>
    /**
     * Accepts or declines only the current account's unexpired invitation atomically.
     * @param scope - Authenticated invitee.
     * @param id - Invitation identifier.
     * @param accept - Explicit membership decision.
     * @returns After the decision and optional membership commit.
     */
    respond(scope: ChatScope, id: string, accept: boolean): Promise<void>
    /**
     * Revokes an invitation while preserving its retry record.
     * @param scope - Authenticated team owner.
     * @param id - Team identifier.
     * @param invitationId - Invitation identifier.
     * @returns After revocation commits.
     */
    revoke(scope: ChatScope, id: string, invitationId: string): Promise<void>
    /**
     * Removes a non-owner or lets a member leave, invalidating their background collaboration.
     * @param scope - Authenticated owner or leaving member.
     * @param id - Team identifier.
     * @param userId - Member to remove.
     * @returns After authorization and membership revocation commit.
     */
    remove(scope: ChatScope, id: string, userId: string): Promise<void>
}

type Queryable = Pick<pg.Pool, 'query'>
type WorkspaceRow = {
    id: string
    name: string
    description: string
    kind: 'legacy' | 'team'
    created_at: Date
    updated_at: Date
    role: 'owner' | 'member'
}
type InvitationRow = {
    id: string
    workspace_id: string
    workspace_name: string
    workspace_description: string
    email: string
    inviter_name: string
    status: WorkspaceInvitation['status']
    created_at: Date
    expires_at: Date
}

/**
 * Checks managed membership while preserving only the account's existing historical workspace.
 * @param client - Shared pool or transaction connection.
 * @param scope - API-verified identity and requested workspace.
 * @param lock - Retain membership through the current transaction's write.
 * @returns Whether the user is currently authorized.
 * @throws Error when PostgreSQL is unavailable; no volatile fallback is used.
 */
export async function workspaceAccess(client: Queryable, scope: ChatScope, lock = false): Promise<boolean> {
    const workspace = await client.query<{ kind: string }>(
        `SELECT kind FROM harness_workspaces WHERE id=$1${lock ? ' FOR KEY SHARE' : ''}`,
        [scope.workspaceId]
    )
    if (workspace.rows[0]?.kind === 'team') {
        const result = await client.query(
            `SELECT user_id FROM harness_workspace_members WHERE workspace_id=$1 AND user_id=$2${lock ? ' FOR KEY SHARE' : ''}`,
            [scope.workspaceId, scope.userId]
        )
        return Boolean(result.rowCount)
    }
    const account = await client.query('SELECT id FROM harness_accounts WHERE workspace_id=$1 AND id=$2', [scope.workspaceId, scope.userId])
    return Boolean(account.rowCount)
}

/**
 * Adds durable team, membership, invitation and session-selection tables without rewriting old scopes.
 * @param pool - Existing process-owned PostgreSQL connection.
 * @returns After the additive schema and historical directory are ready.
 */
export async function initializeWorkspaceTables(pool: Queryable): Promise<void> {
    await pool.query(`CREATE TABLE IF NOT EXISTS harness_workspaces (
        id text PRIMARY KEY,name text NOT NULL,description text NOT NULL,kind text NOT NULL CHECK(kind IN ('legacy','team')),
        created_by uuid REFERENCES harness_accounts(id),creation_fingerprint text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`)
    await pool.query('ALTER TABLE harness_workspaces ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp()')
    await pool.query(`CREATE TABLE IF NOT EXISTS harness_workspace_members (
        workspace_id text NOT NULL REFERENCES harness_workspaces(id),user_id uuid NOT NULL REFERENCES harness_accounts(id),
        role text NOT NULL CHECK(role IN ('owner','member')),joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,user_id))`)
    await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS harness_workspace_owner ON harness_workspace_members(workspace_id) WHERE role='owner'`
    )
    await pool.query(`CREATE TABLE IF NOT EXISTS harness_workspace_invitations (
        id uuid PRIMARY KEY,workspace_id text NOT NULL REFERENCES harness_workspaces(id),email text NOT NULL,
        inviter_id uuid NOT NULL REFERENCES harness_accounts(id),recipient_id uuid NOT NULL REFERENCES harness_accounts(id),fingerprint text NOT NULL,status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days')`)
    await pool.query('ALTER TABLE harness_workspace_invitations ADD COLUMN IF NOT EXISTS recipient_id uuid REFERENCES harness_accounts(id)')
    // Incomplete development invitations must not acquire a new recipient through a later email match.
    await pool.query("UPDATE harness_workspace_invitations SET status='revoked' WHERE recipient_id IS NULL AND status='pending'")
    await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS harness_workspace_pending_invite ON harness_workspace_invitations(workspace_id,email) WHERE status='pending'`
    )
    await pool.query(`UPDATE harness_workspace_invitations SET status='revoked' WHERE id IN (
        SELECT id FROM (SELECT id,row_number() OVER (PARTITION BY workspace_id,recipient_id ORDER BY created_at,id) AS position
        FROM harness_workspace_invitations WHERE status='pending' AND recipient_id IS NOT NULL) duplicates WHERE position>1)`)
    await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS harness_workspace_pending_recipient ON harness_workspace_invitations(workspace_id,recipient_id) WHERE status='pending'`
    )
    await pool.query(`CREATE TABLE IF NOT EXISTS harness_workspace_sessions (
        token_hash text PRIMARY KEY REFERENCES harness_account_sessions(token_hash) ON DELETE CASCADE,
        workspace_id text NOT NULL REFERENCES harness_workspaces(id))`)
    await pool.query(`INSERT INTO harness_workspaces(id,name,description,kind,created_at)
        SELECT workspace_id,'默认工作空间','历史兼容空间；原有内容按本人隔离。','legacy',min(created_at) FROM harness_accounts GROUP BY workspace_id
        ON CONFLICT DO NOTHING`)
}

/**
 * Converts a database workspace and trusted role to public metadata.
 * @param row - Scoped workspace row.
 * @returns Safe workspace summary.
 */
function publicWorkspace(row: WorkspaceRow): TeamWorkspace {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind,
        role: row.role,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    }
}

/**
 * Converts an invitation without exposing internal hashes or account secrets.
 * @param row - Scoped invitation with current names.
 * @returns Safe invitation including derived expiration.
 */
function publicInvitation(row: InvitationRow): WorkspaceInvitation {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        workspaceDescription: row.workspace_description,
        email: row.email,
        inviterName: row.inviter_name,
        status: row.status === 'pending' && row.expires_at.getTime() <= Date.now() ? 'expired' : row.status,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
    }
}

/**
 * Hashes canonical creation fields for durable idempotency comparison.
 * @param value - Non-secret normalized action data.
 * @returns Stable SHA256 fingerprint.
 */
function fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const invitationSelect = `SELECT i.*,w.name AS workspace_name,w.description AS workspace_description,a.username AS inviter_name FROM harness_workspace_invitations i
    JOIN harness_workspaces w ON w.id=i.workspace_id JOIN harness_accounts a ON a.id=i.inviter_id`

/**
 * Creates team persistence using the existing PostgreSQL pool.
 * @param pool - Shared initialized database pool.
 * @returns Persistent membership and invitation coordinator.
 */
export function createPostgresWorkspaceStore(pool: pg.Pool): WorkspaceStore {
    /**
     * Serializes a membership-changing transaction and safely releases its connection.
     * @param action - Transactional operation.
     * @returns Its committed result.
     * @throws Error after rolling back a failed operation.
     */
    async function transaction<T>(action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const result = await action(client)
            await client.query('COMMIT')
            return result
        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    }
    /**
     * Ensures an account's historical directory entry without granting another team membership.
     * @param client - Current connection.
     * @param userId - Verified account identifier.
     * @returns The stable home workspace identifier.
     * @throws WorkspaceAccessError for a deleted account.
     */
    async function home(client: Queryable, userId: string): Promise<string> {
        const result = await client.query<{ workspace_id: string }>('SELECT workspace_id FROM harness_accounts WHERE id=$1', [userId])
        const id = result.rows[0]?.workspace_id
        if (!id) throw new WorkspaceAccessError('账户不可用。')
        await client.query(
            `INSERT INTO harness_workspaces(id,name,description,kind)
            VALUES($1,'默认工作空间','历史兼容空间；原有内容按本人隔离。','legacy') ON CONFLICT DO NOTHING`,
            [id]
        )
        return id
    }
    /**
     * Reads and optionally locks an authorized team's current role.
     * @param client - Current transaction connection.
     * @param scope - Authenticated requester.
     * @param id - Team identifier.
     * @param owner - Require ownership for a management mutation.
     * @returns Authorized team row.
     * @throws WorkspaceAccessError for absent membership, legacy management or insufficient role.
     */
    async function team(client: Queryable, scope: ChatScope, id: string, owner = false): Promise<WorkspaceRow> {
        const result = await client.query<WorkspaceRow>(
            `SELECT w.*,m.role FROM harness_workspaces w
            JOIN harness_workspace_members m ON m.workspace_id=w.id AND m.user_id=$2 WHERE w.id=$1 AND w.kind='team' FOR UPDATE OF w`,
            [id, scope.userId]
        )
        const row = result.rows[0]
        if (!row || (owner && row.role !== 'owner')) throw new WorkspaceAccessError('没有管理这个工作空间的权限。')
        return row
    }
    /**
     * Resolves only a selection still joined by this valid session's account.
     * @param scope - Verified identity.
     * @param tokenHash - Hash of its current opaque session.
     * @returns Selected accessible scope or historical home.
     */
    async function current(scope: ChatScope, tokenHash: string): Promise<string> {
        const homeId = await home(pool, scope.userId)
        const selected = await pool.query<{ workspace_id: string }>(
            `SELECT s.workspace_id FROM harness_workspace_sessions s
            JOIN harness_account_sessions a ON a.token_hash=s.token_hash WHERE s.token_hash=$1 AND a.user_id=$2`,
            [tokenHash, scope.userId]
        )
        const id = selected.rows[0]?.workspace_id
        return id && (await workspaceAccess(pool, { userId: scope.userId, workspaceId: id })) ? id : homeId
    }
    return {
        current,
        /**
         * Checks the latest persisted membership.
         * @param scope - Trusted requested scope.
         * @returns Whether access remains valid.
         */
        access: scope => workspaceAccess(pool, scope),
        /**
         * Reads joined spaces and current-email invitations without selecting a new scope.
         * @param scope - Verified account.
         * @param tokenHash - Current session hash.
         * @returns Safe account directory.
         */
        async directory(scope, tokenHash) {
            const homeId = await home(pool, scope.userId)
            const spaces = await pool.query<WorkspaceRow>(
                `SELECT w.*,COALESCE(m.role,'member') AS role FROM harness_workspaces w
                LEFT JOIN harness_workspace_members m ON m.workspace_id=w.id AND m.user_id=$1
                WHERE (w.id=$2 AND w.kind='legacy') OR m.user_id=$1 ORDER BY w.kind,w.created_at,w.id`,
                [scope.userId, homeId]
            )
            const invitations = await pool.query<InvitationRow>(
                `${invitationSelect} WHERE i.recipient_id=$1
                AND i.status='pending' AND i.expires_at>clock_timestamp() ORDER BY i.created_at DESC`,
                [scope.userId]
            )
            return {
                currentId: await current(scope, tokenHash),
                workspaces: spaces.rows.map(publicWorkspace),
                invitations: invitations.rows.map(publicInvitation),
            }
        },
        /**
         * Persists an idempotent team and its sole owner in one transaction.
         * @param scope - Verified creator.
         * @param input - Normalized fields and action identity.
         * @returns Created team or its original replay.
         */
        async create(scope, input) {
            return transaction(async client => {
                await home(client, scope.userId)
                const digest = fingerprint([scope.userId, input.name, input.description])
                await client.query(
                    `INSERT INTO harness_workspaces(id,name,description,kind,created_by,creation_fingerprint)
                    VALUES($1,$2,$3,'team',$4,$5) ON CONFLICT DO NOTHING`,
                    [input.requestId, input.name, input.description, scope.userId, digest]
                )
                const result = await client.query<WorkspaceRow & { created_by: string; creation_fingerprint: string }>(
                    `SELECT *,'owner'::text AS role FROM harness_workspaces WHERE id=$1 FOR UPDATE`,
                    [input.requestId]
                )
                const row = result.rows[0]!
                if (row.kind !== 'team' || row.created_by !== scope.userId || row.creation_fingerprint !== digest)
                    throw new WorkspaceConflictError('创建动作已用于其他内容，请重新创建。')
                await client.query(
                    `INSERT INTO harness_workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING`,
                    [row.id, scope.userId]
                )
                return publicWorkspace(row)
            })
        },
        /**
         * Reads current member-visible metadata and owner-only invitation history.
         * @param scope - Verified requester.
         * @param id - Requested space.
         * @returns Authorized settings and roster.
         */
        async detail(scope, id) {
            const homeId = await home(pool, scope.userId)
            if (!(await workspaceAccess(pool, { workspaceId: id, userId: scope.userId })))
                throw new WorkspaceAccessError('无法访问这个工作空间。')
            const spaces = await pool.query<WorkspaceRow>(
                `SELECT w.*,COALESCE(m.role,'member') AS role FROM harness_workspaces w
                LEFT JOIN harness_workspace_members m ON m.workspace_id=w.id AND m.user_id=$2 WHERE w.id=$1`,
                [id, scope.userId]
            )
            const row = spaces.rows[0]!
            const members =
                row.kind === 'legacy'
                    ? await pool.query(
                          `SELECT id AS user_id,username,email,'member'::text AS role,created_at AS joined_at FROM harness_accounts WHERE workspace_id=$1 ORDER BY created_at,id`,
                          [homeId]
                      )
                    : await pool.query(
                          `SELECT a.id AS user_id,a.username,a.email,m.role,m.joined_at FROM harness_workspace_members m
                    JOIN harness_accounts a ON a.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.role DESC,m.joined_at,a.id`,
                          [id]
                      )
            const invitations =
                row.role === 'owner'
                    ? (
                          await pool.query<InvitationRow>(`${invitationSelect} WHERE i.workspace_id=$1 ORDER BY i.created_at DESC`, [id])
                      ).rows.map(publicInvitation)
                    : []
            return {
                workspace: publicWorkspace(row),
                members: members.rows.map(member => ({
                    userId: member.user_id,
                    name: member.username,
                    email: member.email,
                    role: member.role,
                    joinedAt: member.joined_at.toISOString(),
                })),
                invitations,
            }
        },
        /**
         * Edits only owner-managed team settings.
         * @param scope - Verified owner.
         * @param id - Target team.
         * @param input - Validated editable fields.
         * @returns Saved summary.
         */
        async update(scope, id, input) {
            return transaction(async client => {
                const row = await team(client, scope, id, true)
                const saved = await client.query<WorkspaceRow>(
                    `UPDATE harness_workspaces SET name=$2,description=$3,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
                    [id, input.name, input.description]
                )
                return publicWorkspace({ ...saved.rows[0]!, role: row.role })
            })
        },
        /**
         * Selects a joined space on only this account's actual session.
         * @param scope - Verified account.
         * @param tokenHash - Current session hash.
         * @param id - Desired joined space.
         * @returns After the durable selection is saved.
         */
        async select(scope, tokenHash, id) {
            await transaction(async client => {
                await home(client, scope.userId)
                if (!(await workspaceAccess(client, { userId: scope.userId, workspaceId: id }, true)))
                    throw new WorkspaceAccessError('你已不在这个工作空间中。')
                const saved = await client.query(
                    `INSERT INTO harness_workspace_sessions(token_hash,workspace_id)
                    SELECT token_hash,$3 FROM harness_account_sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>clock_timestamp()
                    ON CONFLICT(token_hash) DO UPDATE SET workspace_id=EXCLUDED.workspace_id RETURNING token_hash`,
                    [tokenHash, scope.userId, id]
                )
                if (!saved.rowCount) throw new WorkspaceAccessError('当前登录已失效。')
            })
        },
        /**
         * Creates a seven-day invitation with owner authorization and durable retry identity.
         * @param scope - Verified owner.
         * @param id - Target team.
         * @param input - Existing account email and action identity.
         * @returns Original or newly persisted invitation.
         */
        async invite(scope, id, input) {
            return transaction(async client => {
                await team(client, scope, id, true)
                const digest = fingerprint([scope.userId, id, input.email])
                const prior = await client.query<{ fingerprint: string }>(
                    'SELECT fingerprint FROM harness_workspace_invitations WHERE id=$1',
                    [input.requestId]
                )
                if (prior.rows[0]) {
                    if (prior.rows[0].fingerprint !== digest) throw new WorkspaceConflictError('邀请动作已用于其他内容。')
                } else {
                    const account = await client.query<{ id: string }>('SELECT id FROM harness_accounts WHERE email=$1', [input.email])
                    if (!account.rows[0]) throw new WorkspaceConflictError('该邮箱尚未注册，请让同事先注册。')
                    const member = await client.query('SELECT 1 FROM harness_workspace_members WHERE workspace_id=$1 AND user_id=$2', [
                        id,
                        account.rows[0].id,
                    ])
                    if (member.rowCount) throw new WorkspaceConflictError('这位同事已经是工作空间成员。')
                    await client.query(
                        `UPDATE harness_workspace_invitations SET status='expired' WHERE workspace_id=$1 AND (email=$2 OR recipient_id=$3) AND status='pending' AND expires_at<=clock_timestamp()`,
                        [id, input.email, account.rows[0].id]
                    )
                    const pending = await client.query(
                        `SELECT id FROM harness_workspace_invitations WHERE workspace_id=$1 AND (email=$2 OR recipient_id=$3) AND status='pending'`,
                        [id, input.email, account.rows[0].id]
                    )
                    if (pending.rowCount) throw new WorkspaceConflictError('已有待处理邀请，请等待同事接受或先撤销。')
                    await client.query(
                        `INSERT INTO harness_workspace_invitations(id,workspace_id,email,inviter_id,recipient_id,fingerprint,status) VALUES($1,$2,$3,$4,$5,$6,'pending')`,
                        [input.requestId, id, input.email, scope.userId, account.rows[0].id, digest]
                    )
                }
                return publicInvitation(
                    (await client.query<InvitationRow>(`${invitationSelect} WHERE i.id=$1`, [input.requestId])).rows[0]!
                )
            })
        },
        /**
         * Applies an explicit invitee decision while serializing owner revocation and duplicate accepts.
         * @param scope - Verified invitee.
         * @param id - Invitation identifier.
         * @param accept - The invitee's explicit decision.
         * @returns After the atomic decision.
         */
        async respond(scope, id, accept) {
            await transaction(async client => {
                const target = await client.query<{ workspace_id: string }>(
                    'SELECT workspace_id FROM harness_workspace_invitations WHERE id=$1',
                    [id]
                )
                if (!target.rows[0]) throw new WorkspaceAccessError('邀请不存在或无权处理。')
                await client.query('SELECT id FROM harness_workspaces WHERE id=$1 FOR UPDATE', [target.rows[0].workspace_id])
                const result = await client.query<{ workspace_id: string; status: string; valid: boolean }>(
                    `SELECT i.workspace_id,i.status,i.expires_at>clock_timestamp() AS valid FROM harness_workspace_invitations i
                    WHERE i.id=$1 AND i.recipient_id=$2 FOR UPDATE OF i`,
                    [id, scope.userId]
                )
                const invitation = result.rows[0]
                if (!invitation) throw new WorkspaceAccessError('邀请不存在或无权处理。')
                if (invitation.status === (accept ? 'accepted' : 'declined')) return
                if (invitation.status !== 'pending' || !invitation.valid)
                    throw new WorkspaceConflictError('邀请已失效，请联系负责人重新邀请。')
                if (accept)
                    await client.query(
                        `INSERT INTO harness_workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`,
                        [invitation.workspace_id, scope.userId]
                    )
                await client.query('UPDATE harness_workspace_invitations SET status=$2 WHERE id=$1', [id, accept ? 'accepted' : 'declined'])
            })
        },
        /**
         * Revokes a still-pending invitation under the team's management lock.
         * @param scope - Verified owner.
         * @param id - Team identifier.
         * @param invitationId - Target invitation.
         * @returns After durable revocation.
         */
        async revoke(scope, id, invitationId) {
            await transaction(async client => {
                await team(client, scope, id, true)
                const result = await client.query(
                    `UPDATE harness_workspace_invitations SET status='revoked' WHERE workspace_id=$1 AND id=$2 AND ((status='pending' AND expires_at>clock_timestamp()) OR status='revoked') RETURNING id`,
                    [id, invitationId]
                )
                if (!result.rowCount) throw new WorkspaceConflictError('邀请已被处理，请刷新成员列表。')
            })
        },
        /**
         * Revokes non-owner membership and the removed member's outstanding background writes atomically.
         * @param scope - Verified owner or leaving member.
         * @param id - Team identifier.
         * @param userId - Target non-owner.
         * @returns After revocation commits; private historical records remain stored.
         */
        async remove(scope, id, userId) {
            await transaction(async client => {
                const row = await team(client, scope, id)
                if (scope.userId !== userId && row.role !== 'owner') throw new WorkspaceAccessError('只有负责人可以移除其他成员。')
                const target = await client.query<{ role: string }>(
                    'SELECT role FROM harness_workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE',
                    [id, userId]
                )
                if (target.rows[0]?.role === 'owner') throw new WorkspaceConflictError('负责人不能退出或被移除。')
                if (!target.rows[0]) return
                await revokeWorkspaceCollaboration(client, id, userId)
                await client.query('DELETE FROM harness_workspace_members WHERE workspace_id=$1 AND user_id=$2', [id, userId])
                await client.query(
                    `DELETE FROM harness_workspace_sessions s USING harness_account_sessions a
                    WHERE s.token_hash=a.token_hash AND s.workspace_id=$1 AND a.user_id=$2::uuid`,
                    [id, userId]
                )
                await client.query(
                    `UPDATE harness_collaboration_jobs SET status='cancelled',token=NULL,lease_until=NULL,error='工作空间成员权限已失效。'
                    WHERE workspace_id=$1 AND user_id=$2 AND status IN ('queued','running')`,
                    [id, userId]
                )
                await client.query(
                    `UPDATE harness_collaboration_sources SET active_token=NULL,lease_until=NULL WHERE workspace_id=$1 AND user_id=$2`,
                    [id, userId]
                )
                await client.query(
                    `UPDATE harness_collaboration_dispatches SET status='cancelled',preview=jsonb_set(preview,'{status}','"cancelled"'::jsonb)
                    WHERE workspace_id=$1 AND (user_id=$2::text OR preview->>'recipientId'=$2::text) AND status='pending'`,
                    [id, userId]
                )
                await client.query(
                    `UPDATE harness_collaboration_contact_intents SET status='cancelled' WHERE workspace_id=$1 AND status='active'
                    AND (user_id=$2::text OR people @> jsonb_build_array(jsonb_build_object('userId',$2::text)))`,
                    [id, userId]
                )
                await client.query(
                    `UPDATE harness_knowledge_documents SET status='failed',error='工作空间成员权限已失效。',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
                    WHERE workspace_id=$1 AND user_id=$2 AND status IN ('queued','processing')`,
                    [id, userId]
                )
                await client.query(
                    `UPDATE harness_vector_jobs SET status='failed',error='工作空间成员权限已失效。',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
                    WHERE workspace_id=$1 AND user_id=$2 AND status IN ('queued','indexing')`,
                    [id, userId]
                )
            })
        },
    }
}
