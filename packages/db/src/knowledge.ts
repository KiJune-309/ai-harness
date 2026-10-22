import { randomUUID } from 'node:crypto'
import { knowledgeChunkSchema, knowledgeDocumentSchema, type KnowledgeChunk, type KnowledgeDocument } from '@ai-harness/contracts'
import type pg from 'pg'
import type { ChatScope } from './index.js'
import { workspaceAccess } from './workspaces.js'

const currentProjectOwnerSql = `(EXISTS(
    SELECT 1 FROM harness_workspaces w JOIN harness_workspace_members m ON m.workspace_id=w.id
    WHERE w.id=d.workspace_id AND w.kind='team' AND m.user_id::text=d.user_id
) OR (NOT EXISTS(SELECT 1 FROM harness_workspaces w WHERE w.id=d.workspace_id AND w.kind='team')
    AND EXISTS(SELECT 1 FROM harness_accounts a WHERE a.workspace_id=d.workspace_id AND a.id::text=d.user_id)))`

export interface StoredKnowledgeDocument {
    document: KnowledgeDocument
    objectKey: string
    sha256: string
    fingerprint: string
}

export interface KnowledgeLease {
    scope: ChatScope
    record: StoredKnowledgeDocument
    leaseToken: string
    generation: number
}

export interface ProjectKnowledgeChunk {
    documentId: string
    fileName: string
    chunk: KnowledgeChunk
}

export interface KnowledgeStore {
    /**
     * Lists scoped document metadata without exposing internal object references.
     * @param scope - Authenticated ownership context.
     * @param input - Validated pagination and literal filename query.
     * @returns One ordered page and the total matching document count.
     * @throws Error when ownership or storage is unavailable.
     */
    list(
        scope: ChatScope,
        input: { page: number; pageSize: number; query: string; projectFolderId?: string }
    ): Promise<{ documents: KnowledgeDocument[]; total: number; page: number; pageSize: number }>
    /**
     * Reads a document and its private source reference inside its ownership scope.
     * @param scope - Authenticated ownership context.
     * @param id - Stable document identifier.
     * @param projectFolderId - Optional exact project boundary, supplied by the trusted conversation.
     * @returns The owned record or undefined for absent or foreign identifiers.
     * @throws Error when ownership or storage is unavailable.
     */
    get(scope: ChatScope, id: string, projectFolderId?: string): Promise<StoredKnowledgeDocument | undefined>
    /**
     * Serializes upload replay checks and source persistence before inserting queued metadata.
     * @param scope - Authenticated ownership context.
     * @param record - Complete original document and immutable creation fingerprint.
     * @param persistSource - Bounded private object write executed only for a new action.
     * @returns The current existing record for matching replays or the newly queued record.
     * @throws KnowledgeConflictError for a mismatched action, or Error for persistence failure.
     */
    create(scope: ChatScope, record: StoredKnowledgeDocument, persistSource: () => Promise<void>): Promise<StoredKnowledgeDocument>
    /**
     * Returns only committed complete chunks belonging to an owned ready document.
     * @param scope - Authenticated ownership context.
     * @param id - Stable document identifier.
     * @param page - One-based page number.
     * @param pageSize - Bounded number of chunks per page.
     * @param projectFolderId - Optional exact project boundary, supplied by the trusted conversation.
     * @returns A page, or undefined when the document is absent or foreign.
     * @throws Error for invalid arguments or storage failure.
     */
    chunks(
        scope: ChatScope,
        id: string,
        page: number,
        pageSize: number,
        projectFolderId?: string
    ): Promise<{ chunks: KnowledgeChunk[]; total: number; page: number; pageSize: number } | undefined>
    /**
     * Searches or reads bounded complete chunks using a mandatory private project boundary in SQL.
     * @param scope - Actual account and workspace resolved by the API.
     * @param projectFolderId - Current conversation's trusted project identity.
     * @param input - Literal query, optional exact document and bounded chunk pagination.
     * @returns Only matching ready chunks from the current owned project, with public source metadata.
     * @throws Error for missing scope, invalid bounds, or unavailable storage.
     */
    searchProjectChunks(
        scope: ChatScope,
        projectFolderId: string,
        input: { query: string; limit?: number; offset?: number; documentId?: string }
    ): Promise<ProjectKnowledgeChunk[]>
    /**
     * Atomically claims one queued or expired processing job across all trusted scopes.
     * @param leaseMs - Bounded lease lifetime in milliseconds.
     * @returns A new generation and token, or undefined when no work is available.
     * @throws Error when persistent job coordination is unavailable.
     */
    claim(leaseMs: number): Promise<KnowledgeLease | undefined>
    /**
     * Extends an active lease without reviving expired ownership.
     * @param job - Previously claimed generation and token.
     * @param leaseMs - Bounded extension lifetime in milliseconds.
     * @returns Whether this worker still owns the unexpired job.
     * @throws Error when storage is unavailable.
     */
    heartbeat(job: KnowledgeLease, leaseMs: number): Promise<boolean>
    /**
     * Commits a whole validated chunk batch and ready metadata atomically under a lease CAS.
     * @param job - Claimed generation and token.
     * @param result - Complete parsed text metrics and identified chunks.
     * @returns Whether the current lease committed the result.
     * @throws Error for invalid chunks or transactional storage failure.
     */
    complete(job: KnowledgeLease, result: { characterCount: number; pageCount?: number; chunks: KnowledgeChunk[] }): Promise<boolean>
    /**
     * Records a safe processing failure only for the current unexpired lease.
     * @param job - Claimed generation and token.
     * @param message - Safe public failure text.
     * @returns Whether this lease recorded the failure.
     * @throws Error when storage is unavailable.
     */
    fail(job: KnowledgeLease, message: string): Promise<boolean>
    /**
     * Releases an owned processing lease into the durable queue during graceful shutdown.
     * @param job - Claimed generation and token.
     * @returns Whether this lease was released.
     * @throws Error when storage is unavailable.
     */
    release(job: KnowledgeLease): Promise<boolean>
    /**
     * Requeues an owned failed document using a persistent idempotent retry action.
     * @param scope - Authenticated ownership context.
     * @param id - Stable document identifier.
     * @param requestId - Stable retry action identifier.
     * @returns The current document, or undefined when absent or foreign.
     * @throws KnowledgeConflictError for a conflicting action or nonfailed document.
     * @throws Error when transactional storage is unavailable.
     */
    retry(scope: ChatScope, id: string, requestId: string): Promise<KnowledgeDocument | undefined>
}

export class KnowledgeConflictError extends Error {
    /**
     * Creates a public-safe conflict without reflecting file contents or credentials.
     * @param message - Safe conflict explanation.
     */
    constructor(message = '该操作标识已用于不同的资料或参数，请重新选择文件后提交。') {
        super(message)
        this.name = 'KnowledgeConflictError'
    }
}

interface DocumentRow {
    workspace_id: string
    user_id: string
    id: string
    document: KnowledgeDocument
    object_key: string
    sha256: string
    fingerprint: string
    status: KnowledgeDocument['status']
    attempt: number
    character_count: number
    chunk_count: number
    page_count: number | null
    error: string | null
    created_at: Date | string
    updated_at: Date | string
    lease_token: string | null
    project_folder_id?: string | null
}

/**
 * Rejects missing trusted ownership before executing any scoped query.
 * @param scope - Server-established account and workspace.
 * @returns Nothing when both identity components are nonempty.
 * @throws Error when the ownership context is missing.
 */
function validateScope(scope: ChatScope): void {
    if (!scope?.userId?.trim() || !scope.workspaceId?.trim()) throw new Error('Knowledge storage requires trusted userId and workspaceId.')
}

/**
 * Validates bounded database pagination before query construction.
 * @param page - One-based page number.
 * @param pageSize - Maximum records returned in this page.
 * @returns Nothing for accepted bounds.
 * @throws Error for unbounded or invalid pagination.
 */
function validatePage(page: number, pageSize: number): void {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new Error('Invalid knowledge pagination.')
}

/**
 * Validates a short lease used for recoverable background work.
 * @param leaseMs - Requested lease lifetime.
 * @returns Nothing when the lease is positive and bounded.
 * @throws Error for invalid lease configuration.
 */
function validateLease(leaseMs: number): void {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 120_000) throw new Error('Invalid knowledge lease lifetime.')
}

/**
 * Converts mutable database state into a validated public document plus private source reference.
 * @param row - Complete PostgreSQL document row.
 * @returns An independent public snapshot and server-only source fields.
 * @throws Error for corrupt persisted metadata.
 */
function recordFromRow(row: DocumentRow): StoredKnowledgeDocument {
    const original = { ...row.document }
    delete original.error
    delete original.pageCount
    delete original.projectFolderId
    return {
        document: knowledgeDocumentSchema.parse({
            ...original,
            id: row.id,
            status: row.status,
            attempt: row.attempt,
            characterCount: row.character_count,
            chunkCount: row.chunk_count,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
            ...(row.error ? { error: row.error } : {}),
            ...(row.page_count === null ? {} : { pageCount: row.page_count }),
            ...(row.project_folder_id ? { projectFolderId: row.project_folder_id } : {}),
        }),
        objectKey: row.object_key,
        sha256: row.sha256,
        fingerprint: row.fingerprint,
    }
}

/**
 * Creates additive durable document, chunk, and retry tables inside the caller's schema transaction.
 * @param connection - Shared advisory-locked schema transaction client.
 * @returns After all knowledge tables and indexes exist.
 * @throws Error when schema initialization fails.
 */
export async function initializeKnowledgeTables(connection: Pick<pg.Pool, 'query'>): Promise<void> {
    await connection.query(`CREATE TABLE IF NOT EXISTS harness_knowledge_documents (
        workspace_id text NOT NULL, user_id text NOT NULL, id uuid NOT NULL,
        document jsonb NOT NULL, object_key text NOT NULL, sha256 text NOT NULL, fingerprint text NOT NULL,
        status text NOT NULL CHECK(status IN ('queued','processing','ready','failed')),
        attempt integer NOT NULL DEFAULT 0, character_count integer NOT NULL DEFAULT 0,
        chunk_count integer NOT NULL DEFAULT 0, page_count integer, error text,
        lease_token uuid, lease_until timestamptz,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(workspace_id,user_id,id)
    )`)
    await connection.query('ALTER TABLE harness_knowledge_documents ADD COLUMN IF NOT EXISTS project_folder_id uuid')
    await connection.query(`DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='harness_knowledge_project_folder_fk'
            AND conrelid='harness_knowledge_documents'::regclass) THEN
            ALTER TABLE harness_knowledge_documents ADD CONSTRAINT harness_knowledge_project_folder_fk
            FOREIGN KEY(workspace_id,user_id,project_folder_id) REFERENCES harness_project_folders(workspace_id,user_id,id);
        END IF;
    END $$`)
    await connection.query(
        'CREATE INDEX IF NOT EXISTS harness_knowledge_project_folder_idx ON harness_knowledge_documents(workspace_id,user_id,project_folder_id,created_at DESC,id)'
    )
    await connection.query(`CREATE TABLE IF NOT EXISTS harness_knowledge_chunks (
        workspace_id text NOT NULL, user_id text NOT NULL, document_id uuid NOT NULL,
        chunk_index integer NOT NULL, data jsonb NOT NULL,
        PRIMARY KEY(workspace_id,user_id,document_id,chunk_index),
        FOREIGN KEY(workspace_id,user_id,document_id) REFERENCES harness_knowledge_documents(workspace_id,user_id,id) ON DELETE CASCADE
    )`)
    await connection.query(`CREATE TABLE IF NOT EXISTS harness_knowledge_retry_actions (
        workspace_id text NOT NULL, user_id text NOT NULL, request_id uuid NOT NULL, document_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,user_id,request_id),
        FOREIGN KEY(workspace_id,user_id,document_id) REFERENCES harness_knowledge_documents(workspace_id,user_id,id) ON DELETE CASCADE
    )`)
    await connection.query(
        'CREATE INDEX IF NOT EXISTS harness_knowledge_pending_idx ON harness_knowledge_documents(status,lease_until,created_at)'
    )
}

/**
 * Creates scoped durable knowledge operations using the application-owned PostgreSQL pool.
 * @param pool - Initialized shared pool, whose lifecycle remains with the parent store.
 * @returns Persistent document and job operations without a memory fallback.
 */
export function createPostgresKnowledgeStore(pool: pg.Pool): KnowledgeStore {
    return {
        /**
         * Lists filename-matching document snapshots in deterministic creation order.
         * @param scope - Authenticated ownership context.
         * @param input - Validated pagination and literal query.
         * @returns Matching public documents and total count.
         * @throws Error when ownership, pagination, or persistence is unavailable.
         */
        async list(scope, input) {
            validateScope(scope)
            validatePage(input.page, input.pageSize)
            const where = `d.workspace_id=$1 AND d.user_id=$2 AND strpos(lower(d.document->>'fileName'),lower($3))>0
                AND ($4::uuid IS NULL OR (d.project_folder_id=$4 AND ${currentProjectOwnerSql}))`
            const values = [scope.workspaceId, scope.userId, input.query, input.projectFolderId ?? null]
            const total = await pool.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM harness_knowledge_documents d WHERE ${where}`,
                values
            )
            const rows = await pool.query<DocumentRow>(
                `SELECT d.* FROM harness_knowledge_documents d WHERE ${where} ORDER BY d.created_at DESC,d.id ASC LIMIT $5 OFFSET $6`,
                [...values, input.pageSize, (input.page - 1) * input.pageSize]
            )
            return {
                documents: rows.rows.map(row => recordFromRow(row).document),
                total: Number(total.rows[0]?.count ?? 0),
                page: input.page,
                pageSize: input.pageSize,
            }
        },
        /**
         * Reads an original source reference only within its complete ownership scope.
         * @param scope - Authenticated ownership context.
         * @param id - Stable document identifier.
         * @param projectFolderId - Optional trusted project to constrain this read.
         * @returns The owned record or undefined.
         * @throws Error when ownership or storage is unavailable.
         */
        async get(scope, id, projectFolderId) {
            validateScope(scope)
            const result = await pool.query<DocumentRow>(
                `SELECT d.* FROM harness_knowledge_documents d WHERE d.workspace_id=$1 AND d.user_id=$2 AND d.id=$3
                    AND ($4::uuid IS NULL OR (d.project_folder_id=$4 AND ${currentProjectOwnerSql}))`,
                [scope.workspaceId, scope.userId, id, projectFolderId ?? null]
            )
            return result.rows[0] ? recordFromRow(result.rows[0]) : undefined
        },
        /**
         * Holds the upload action lock while persisting one immutable private source.
         * @param scope - Authenticated ownership context.
         * @param record - Queued public metadata and immutable private fingerprint.
         * @param persistSource - Bounded private object writer.
         * @returns Existing matching record or committed new record.
         * @throws KnowledgeConflictError for mismatched replay, or Error after rollback.
         */
        async create(scope, record, persistSource) {
            validateScope(scope)
            const document = knowledgeDocumentSchema.parse(record.document)
            if (
                document.status !== 'queued' ||
                document.attempt !== 0 ||
                document.chunkCount !== 0 ||
                document.characterCount !== 0 ||
                !/^[a-f0-9]{64}$/.test(record.sha256) ||
                !/^[a-f0-9]{64}$/.test(record.fingerprint) ||
                !record.objectKey
            )
                throw new Error('Invalid original knowledge upload record.')
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                if (document.projectFolderId && !(await workspaceAccess(client, scope, true)))
                    throw new KnowledgeConflictError('未找到此项目，无法上传资料。')
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
                    JSON.stringify(['knowledge-upload', scope.workspaceId, scope.userId, document.id]),
                ])
                const existing = await client.query<DocumentRow>(
                    'SELECT * FROM harness_knowledge_documents WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                    [scope.workspaceId, scope.userId, document.id]
                )
                if (existing.rows[0]) {
                    const found = recordFromRow(existing.rows[0])
                    if (found.fingerprint !== record.fingerprint || found.document.projectFolderId !== document.projectFolderId)
                        throw new KnowledgeConflictError()
                    await client.query('COMMIT')
                    return found
                }
                if (document.projectFolderId) {
                    const folder = await client.query(
                        'SELECT id FROM harness_project_folders WHERE workspace_id=$1 AND user_id=$2 AND id=$3 FOR KEY SHARE',
                        [scope.workspaceId, scope.userId, document.projectFolderId]
                    )
                    if (!folder.rowCount) throw new KnowledgeConflictError('未找到此项目，无法上传资料。')
                }
                await persistSource()
                const result = await client.query<DocumentRow>(
                    `INSERT INTO harness_knowledge_documents (workspace_id,user_id,id,document,object_key,sha256,fingerprint,status,created_at,updated_at,project_folder_id)
                    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,'queued',$8,$9,$10) RETURNING *`,
                    [
                        scope.workspaceId,
                        scope.userId,
                        document.id,
                        JSON.stringify(document),
                        record.objectKey,
                        record.sha256,
                        record.fingerprint,
                        document.createdAt,
                        document.updatedAt,
                        document.projectFolderId ?? null,
                    ]
                )
                await client.query('COMMIT')
                return recordFromRow(result.rows[0]!)
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined)
                throw error
            } finally {
                client.release()
            }
        },
        /**
         * Reads only a complete committed batch from a ready owned document.
         * @param scope - Authenticated ownership context.
         * @param id - Stable document identifier.
         * @param page - One-based page number.
         * @param pageSize - Bounded page size.
         * @param projectFolderId - Optional trusted project to constrain every chunk read.
         * @returns A public page or undefined for an absent/foreign document.
         * @throws Error when ownership, pagination, or storage is unavailable.
         */
        async chunks(scope, id, page, pageSize, projectFolderId) {
            validateScope(scope)
            validatePage(page, pageSize)
            const document = await this.get(scope, id, projectFolderId)
            if (!document) return undefined
            if (document.document.status !== 'ready') return { chunks: [], total: 0, page, pageSize }
            const rows = await pool.query<{ data: KnowledgeChunk }>(
                `SELECT c.data FROM harness_knowledge_chunks c INNER JOIN harness_knowledge_documents d ON d.workspace_id=c.workspace_id AND d.user_id=c.user_id AND d.id=c.document_id
                WHERE c.workspace_id=$1 AND c.user_id=$2 AND c.document_id=$3 AND d.status='ready'
                AND ($6::uuid IS NULL OR (d.project_folder_id=$6 AND ${currentProjectOwnerSql})) ORDER BY c.chunk_index ASC LIMIT $4 OFFSET $5`,
                [scope.workspaceId, scope.userId, id, pageSize, (page - 1) * pageSize, projectFolderId ?? null]
            )
            return {
                chunks: rows.rows.map(row => knowledgeChunkSchema.parse(row.data)),
                total: document.document.chunkCount,
                page,
                pageSize,
            }
        },
        /**
         * Retrieves bounded reference chunks directly from one owned project and committed ready documents.
         * @param scope - Actual account and workspace resolved by the API.
         * @param projectFolderId - Mandatory server-resolved current project identity.
         * @param input - Literal query, optional exact source identity and bounded offset/limit.
         * @returns Matching chunks with public filenames and source identifiers.
         * @throws Error for missing scope, invalid input or unavailable persistence.
         */
        async searchProjectChunks(scope, projectFolderId, input) {
            validateScope(scope)
            const limit = input.limit ?? 8
            const offset = input.offset ?? 0
            if (
                !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(projectFolderId) ||
                typeof input.query !== 'string' ||
                input.query.length > 180 ||
                !Number.isSafeInteger(limit) ||
                limit < 1 ||
                limit > 20 ||
                !Number.isSafeInteger(offset) ||
                offset < 0 ||
                offset > 4999
            )
                throw new Error('Invalid project knowledge query.')
            const rows = await pool.query<{ document_id: string; file_name: string; data: unknown }>(
                `SELECT d.id AS document_id,d.document->>'fileName' AS file_name,c.data
                FROM harness_knowledge_documents d
                JOIN harness_project_folders f ON f.workspace_id=d.workspace_id AND f.user_id=d.user_id AND f.id=d.project_folder_id
                JOIN harness_knowledge_chunks c ON c.workspace_id=d.workspace_id AND c.user_id=d.user_id AND c.document_id=d.id
                WHERE d.workspace_id=$1 AND d.user_id=$2 AND d.project_folder_id=$3 AND d.status='ready'
                    AND ${currentProjectOwnerSql}
                    AND ($5::uuid IS NULL OR d.id=$5)
                    AND ($4='' OR strpos(lower(c.data->>'content'),lower($4))>0
                        OR strpos(lower(d.document->>'fileName'),lower($4))>0)
                ORDER BY d.created_at DESC,d.id ASC,c.chunk_index ASC LIMIT $6 OFFSET $7`,
                [scope.workspaceId, scope.userId, projectFolderId, input.query.trim(), input.documentId ?? null, limit, offset]
            )
            return rows.rows.map(row => ({
                documentId: row.document_id,
                fileName: row.file_name,
                chunk: knowledgeChunkSchema.parse(row.data),
            }))
        },
        /**
         * Claims one durable queued or expired job for a current team member or a legacy workspace.
         * @param leaseMs - Validated lease lifetime.
         * @returns A claimed job and independent ownership token, or undefined.
         * @throws Error when database coordination is unavailable.
         */
        async claim(leaseMs) {
            validateLease(leaseMs)
            const leaseToken = randomUUID()
            const result = await pool.query<DocumentRow>(
                `WITH candidate AS (
                SELECT d.workspace_id,d.user_id,d.id FROM harness_knowledge_documents d
                WHERE (d.status='queued' OR (d.status='processing' AND d.lease_until<=clock_timestamp()))
                AND (NOT EXISTS(SELECT 1 FROM harness_workspaces w WHERE w.id=d.workspace_id AND w.kind='team')
                    OR EXISTS(SELECT 1 FROM harness_workspace_members m WHERE m.workspace_id=d.workspace_id AND m.user_id::text=d.user_id))
                ORDER BY d.created_at ASC FOR UPDATE OF d SKIP LOCKED LIMIT 1
            ) UPDATE harness_knowledge_documents d SET status='processing',attempt=d.attempt+1,error=NULL,
                lease_token=$1,lease_until=clock_timestamp()+($2::integer*interval '1 millisecond'),updated_at=clock_timestamp()
                FROM candidate c WHERE d.workspace_id=c.workspace_id AND d.user_id=c.user_id AND d.id=c.id RETURNING d.*`,
                [leaseToken, leaseMs]
            )
            const row = result.rows[0]
            return row
                ? {
                      scope: { workspaceId: row.workspace_id, userId: row.user_id },
                      record: recordFromRow(row),
                      leaseToken,
                      generation: row.attempt,
                  }
                : undefined
        },
        /**
         * Renews only the unexpired matching generation and lease token.
         * @param job - Claimed job ownership.
         * @param leaseMs - Bounded lease extension.
         * @returns Whether this worker still owns the job.
         * @throws Error when database coordination is unavailable.
         */
        async heartbeat(job, leaseMs) {
            validateScope(job.scope)
            validateLease(leaseMs)
            const result = await pool.query(
                `UPDATE harness_knowledge_documents SET lease_until=clock_timestamp()+($6::integer*interval '1 millisecond')
                WHERE workspace_id=$1 AND user_id=$2 AND id=$3 AND lease_token=$4 AND attempt=$5 AND status='processing' AND lease_until>clock_timestamp()`,
                [job.scope.workspaceId, job.scope.userId, job.record.document.id, job.leaseToken, job.generation, leaseMs]
            )
            return result.rowCount === 1
        },
        /**
         * Atomically inserts a whole batch and marks its document ready under a lease CAS.
         * @param job - Claimed job ownership.
         * @param result - Complete identified chunk batch and extracted text metrics.
         * @returns Whether this generation committed the result.
         * @throws Error for invalid batches or transaction failure.
         */
        async complete(job, result) {
            validateScope(job.scope)
            if (
                !Number.isSafeInteger(result.characterCount) ||
                result.characterCount < 1 ||
                result.characterCount > 2_000_000 ||
                !result.chunks.length ||
                result.chunks.length > 5000
            )
                throw new Error('Invalid complete knowledge batch.')
            const chunks = result.chunks.map(chunk => knowledgeChunkSchema.parse(chunk))
            const source = job.record.document
            for (let index = 0; index < chunks.length; index++) {
                const chunk = chunks[index]!
                const prior = chunks[index - 1]
                const actualOverlap = prior ? prior.charEnd - chunk.charStart : 0
                if (
                    chunk.documentId !== source.id ||
                    chunk.index !== index + 1 ||
                    chunk.characterCount !== Array.from(chunk.content).length ||
                    chunk.characterCount !== chunk.charEnd - chunk.charStart ||
                    chunk.characterCount > source.chunkSize ||
                    (!prior && chunk.charStart !== 0) ||
                    (prior &&
                        (chunk.charStart <= prior.charStart ||
                            chunk.charEnd <= prior.charEnd ||
                            actualOverlap < 0 ||
                            actualOverlap > source.overlap ||
                            actualOverlap >= prior.characterCount)) ||
                    chunk.charEnd > result.characterCount ||
                    (prior && prior.charEnd >= result.characterCount) ||
                    (prior &&
                        actualOverlap > 0 &&
                        Array.from(prior.content).slice(-actualOverlap).join('') !==
                            Array.from(chunk.content).slice(0, actualOverlap).join(''))
                )
                    throw new Error('Knowledge chunks must form one complete ordered source batch.')
            }
            if (
                chunks.at(-1)!.charEnd !== result.characterCount ||
                (result.pageCount !== undefined &&
                    (!Number.isSafeInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 500))
            )
                throw new Error('Invalid knowledge source coverage.')
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                const claimed = await client.query(
                    `UPDATE harness_knowledge_documents SET status='ready',chunk_count=$6,character_count=$7,page_count=$8,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
                    WHERE workspace_id=$1 AND user_id=$2 AND id=$3 AND lease_token=$4 AND attempt=$5 AND status='processing' AND lease_until>clock_timestamp() RETURNING id`,
                    [
                        job.scope.workspaceId,
                        job.scope.userId,
                        source.id,
                        job.leaseToken,
                        job.generation,
                        chunks.length,
                        result.characterCount,
                        result.pageCount ?? null,
                    ]
                )
                if (claimed.rowCount !== 1) {
                    await client.query('ROLLBACK')
                    return false
                }
                await client.query('DELETE FROM harness_knowledge_chunks WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3', [
                    job.scope.workspaceId,
                    job.scope.userId,
                    source.id,
                ])
                await client.query(
                    `INSERT INTO harness_knowledge_chunks(workspace_id,user_id,document_id,chunk_index,data)
                    SELECT $1,$2,$3,(value->>'index')::integer,value FROM jsonb_array_elements($4::jsonb)`,
                    [job.scope.workspaceId, job.scope.userId, source.id, JSON.stringify(chunks)]
                )
                await client.query('COMMIT')
                return true
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined)
                throw error
            } finally {
                client.release()
            }
        },
        /**
         * Stores a safe failure only for the unexpired current generation.
         * @param job - Claimed job ownership.
         * @param message - Bounded public-safe reason.
         * @returns Whether the failure was recorded by this lease.
         * @throws Error when persistence is unavailable.
         */
        async fail(job, message) {
            validateScope(job.scope)
            const result = await pool.query(
                `UPDATE harness_knowledge_documents SET status='failed',error=$6,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
                WHERE workspace_id=$1 AND user_id=$2 AND id=$3 AND lease_token=$4 AND attempt=$5 AND status='processing' AND lease_until>clock_timestamp()`,
                [job.scope.workspaceId, job.scope.userId, job.record.document.id, job.leaseToken, job.generation, message.slice(0, 500)]
            )
            return result.rowCount === 1
        },
        /**
         * Returns a current job to the durable queue before process resources close.
         * @param job - Claimed job ownership.
         * @returns Whether this generation was released.
         * @throws Error when persistence is unavailable.
         */
        async release(job) {
            validateScope(job.scope)
            const result = await pool.query(
                `UPDATE harness_knowledge_documents SET status='queued',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
                WHERE workspace_id=$1 AND user_id=$2 AND id=$3 AND lease_token=$4 AND attempt=$5 AND status='processing'`,
                [job.scope.workspaceId, job.scope.userId, job.record.document.id, job.leaseToken, job.generation]
            )
            return result.rowCount === 1
        },
        /**
         * Requeues a failed owned source and remembers its retry action atomically.
         * @param scope - Authenticated ownership context.
         * @param id - Owned source identifier.
         * @param requestId - Stable retry action identifier.
         * @returns Current public metadata, or undefined when absent or foreign.
         * @throws KnowledgeConflictError for conflicting actions or nonfailed state.
         * @throws Error when database transactions fail.
         */
        async retry(scope, id, requestId) {
            validateScope(scope)
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
                    JSON.stringify(['knowledge-retry', scope.workspaceId, scope.userId, requestId]),
                ])
                const result = await client.query<DocumentRow>(
                    'SELECT * FROM harness_knowledge_documents WHERE workspace_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE',
                    [scope.workspaceId, scope.userId, id]
                )
                if (!result.rows[0]) {
                    await client.query('COMMIT')
                    return undefined
                }
                const action = await client.query<{ document_id: string }>(
                    'SELECT document_id FROM harness_knowledge_retry_actions WHERE workspace_id=$1 AND user_id=$2 AND request_id=$3',
                    [scope.workspaceId, scope.userId, requestId]
                )
                if (action.rows[0]) {
                    if (action.rows[0].document_id !== id) throw new KnowledgeConflictError()
                    await client.query('COMMIT')
                    return recordFromRow(result.rows[0]).document
                }
                if (result.rows[0].status !== 'failed') throw new KnowledgeConflictError('仅处理失败的资料可以重试，请等待当前处理完成。')
                await client.query(
                    'INSERT INTO harness_knowledge_retry_actions(workspace_id,user_id,request_id,document_id) VALUES($1,$2,$3,$4)',
                    [scope.workspaceId, scope.userId, requestId, id]
                )
                const updated = await client.query<DocumentRow>(
                    `UPDATE harness_knowledge_documents SET status='queued',error=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
                    WHERE workspace_id=$1 AND user_id=$2 AND id=$3 RETURNING *`,
                    [scope.workspaceId, scope.userId, id]
                )
                await client.query('COMMIT')
                return recordFromRow(updated.rows[0]!).document
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined)
                throw error
            } finally {
                client.release()
            }
        },
    }
}
