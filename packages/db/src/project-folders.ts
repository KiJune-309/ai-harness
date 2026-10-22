import type pg from 'pg'
import { createProjectFolderSchema, projectFolderSchema, type CreateProjectFolder, type ProjectFolder } from '@ai-harness/contracts'
import type { ChatScope } from './index.js'
import { workspaceAccess } from './workspaces.js'

export class ProjectFolderAccessError extends Error {}
export class ProjectFolderConflictError extends Error {}

export interface ProjectFolderStore {
    /**
     * Lists personal project folders within the actual account's current workspace.
     * @param scope - API-verified human account and selected workspace.
     * @returns Only owned folders ordered by most recent update and stable identifier.
     * @throws ProjectFolderAccessError for missing or revoked workspace membership.
     * @throws Error when durable storage is unavailable.
     */
    list(scope: ChatScope): Promise<ProjectFolder[]>
    /**
     * Reads one personal folder without exposing whether another scope owns its identity.
     * @param scope - API-verified human account and selected workspace.
     * @param id - Exact folder identifier.
     * @returns The owned folder, or undefined when absent or foreign.
     * @throws ProjectFolderAccessError for missing or revoked workspace membership.
     * @throws Error when durable storage is unavailable.
     */
    get(scope: ChatScope, id: string): Promise<ProjectFolder | undefined>
    /**
     * Creates one private folder and persistently replays a matching creation action.
     * @param scope - API-verified human account and selected workspace.
     * @param input - Stable action identifier and normalized folder name.
     * @returns The saved folder, retaining its identity and timestamps on retry.
     * @throws ProjectFolderConflictError when an action is reused with a different name.
     * @throws ProjectFolderAccessError for missing or revoked workspace membership.
     * @throws Error for invalid input or unavailable durable storage.
     */
    create(scope: ChatScope, input: CreateProjectFolder): Promise<ProjectFolder>
}

interface FolderRow {
    id: string
    name: string
    creation_name: string
    created_at: Date | string
    updated_at: Date | string
}

/**
 * Initializes private folder records separately from retired task and collaboration projects.
 * @param connection - Existing schema transaction connection owned by the application.
 * @returns After the durable table and scope index exist.
 * @throws Error when schema initialization fails.
 */
export async function initializeProjectFolderTables(connection: Pick<pg.Pool, 'query'>): Promise<void> {
    await connection.query(`CREATE TABLE IF NOT EXISTS harness_project_folders (
        workspace_id text NOT NULL,user_id text NOT NULL,id uuid NOT NULL,
        name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),creation_name text NOT NULL,
        created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
        PRIMARY KEY(workspace_id,user_id,id)
    )`)
    await connection.query(
        'CREATE INDEX IF NOT EXISTS harness_project_folders_owner_idx ON harness_project_folders(workspace_id,user_id,updated_at DESC,id)'
    )
}

/**
 * Converts one owned database row to a strict public folder without internal creation fields.
 * @param row - Durable folder and original normalized creation name.
 * @returns A detached public folder snapshot.
 * @throws Error for corrupt persisted metadata.
 */
function folderFromRow(row: FolderRow): ProjectFolder {
    return projectFolderSchema.parse({
        id: row.id,
        name: row.name,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
    })
}

/**
 * Protects every folder operation with the actual current membership inside one transaction.
 * @param pool - Shared initialized PostgreSQL pool.
 * @param scope - Actual owner and currently selected workspace.
 * @param operation - Complete scope-filtered read or mutation.
 * @returns The operation's committed result.
 * @throws ProjectFolderAccessError when identity or current membership is missing.
 * @throws Error after rollback when storage or validation fails.
 */
async function folderTransaction<T>(pool: pg.Pool, scope: ChatScope, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (!scope?.userId?.trim() || !scope.workspaceId?.trim()) throw new ProjectFolderAccessError('未找到此项目。')
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        if (!(await workspaceAccess(client, scope, true))) throw new ProjectFolderAccessError('未找到此项目。')
        const result = await operation(client)
        await client.query('COMMIT')
        return result
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}

/**
 * Creates durable personal folder operations on the process-owned database pool.
 * @param pool - Initialized shared PostgreSQL pool whose lifecycle remains with the application.
 * @returns Scope-filtered folder operations without an in-memory fallback.
 */
export function createPostgresProjectFolderStore(pool: pg.Pool): ProjectFolderStore {
    return {
        /**
         * Lists only folders owned by the current account and workspace.
         * @param scope - Server-established account and workspace.
         * @returns Stable newest-first owned folder snapshots.
         * @throws Error when authorization or durable persistence fails.
         */
        async list(scope) {
            return folderTransaction(pool, scope, async client => {
                const rows = await client.query<FolderRow>(
                    'SELECT * FROM harness_project_folders WHERE workspace_id=$1 AND user_id=$2 ORDER BY updated_at DESC,id ASC',
                    [scope.workspaceId, scope.userId]
                )
                return rows.rows.map(folderFromRow)
            })
        },
        /**
         * Reads an exact folder using all trusted ownership predicates.
         * @param scope - Server-established account and workspace.
         * @param id - Exact requested folder identity.
         * @returns The owned folder or undefined.
         * @throws Error when authorization or durable persistence fails.
         */
        async get(scope, id) {
            const canonicalId = projectFolderSchema.shape.id.parse(id)
            return folderTransaction(pool, scope, async client => {
                const rows = await client.query<FolderRow>(
                    'SELECT * FROM harness_project_folders WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                    [scope.workspaceId, scope.userId, canonicalId]
                )
                return rows.rows[0] ? folderFromRow(rows.rows[0]) : undefined
            })
        },
        /**
         * Serializes a normalized stable action before creating or replaying one private folder.
         * @param scope - Server-established account and workspace.
         * @param input - Stable creation action and normalized name.
         * @returns The exact persisted folder for a matching retry.
         * @throws ProjectFolderConflictError for changed creation parameters.
         * @throws Error when authorization or durable persistence fails.
         */
        async create(scope, input) {
            const parsed = createProjectFolderSchema.parse(input)
            return folderTransaction(pool, scope, async client => {
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
                    JSON.stringify(['project-folder-create', scope.workspaceId, scope.userId, parsed.requestId]),
                ])
                const existing = await client.query<FolderRow>(
                    'SELECT * FROM harness_project_folders WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                    [scope.workspaceId, scope.userId, parsed.requestId]
                )
                if (existing.rows[0]) {
                    if (existing.rows[0].creation_name !== parsed.name)
                        throw new ProjectFolderConflictError('该操作已用于不同的项目名称，请重新提交。')
                    return folderFromRow(existing.rows[0])
                }
                const rows = await client.query<FolderRow>(
                    `INSERT INTO harness_project_folders(workspace_id,user_id,id,name,creation_name,created_at,updated_at)
                    VALUES($1,$2,$3,$4,$4,clock_timestamp(),clock_timestamp()) RETURNING *`,
                    [scope.workspaceId, scope.userId, parsed.requestId, parsed.name]
                )
                return folderFromRow(rows.rows[0]!)
            })
        },
    }
}
