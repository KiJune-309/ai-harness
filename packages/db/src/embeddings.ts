import { createHash, randomUUID } from 'node:crypto'
import {
    embeddingModelSchema,
    knowledgeChunkSchema,
    embeddingSpaceSchema,
    knowledgeVectorIndexSchema,
    type EmbeddingModel,
    type EmbeddingSpace,
    type KnowledgeChunk,
    type KnowledgeIndexAction,
    type KnowledgeSearchResult,
    type KnowledgeVectorIndex,
} from '@ai-harness/contracts'
import type pg from 'pg'
import type { ChatScope } from './index.js'

export interface StoredEmbeddingModel {
    model: EmbeddingModel
    encryptedApiKey: string
}
export interface VectorLease {
    scope: ChatScope
    index: KnowledgeVectorIndex
    sourceDigest: string
    leaseToken: string
}
interface ModelRow {
    data: StoredEmbeddingModel
}
interface IndexRow {
    workspace_id: string
    user_id: string
    document_id: string
    generation: number
    attempt: number
    status: 'queued' | 'indexing' | 'ready' | 'failed'
    completed_chunks: number
    total_chunks: number
    model: EmbeddingSpace
    source_digest: string
    error: string | null
    lease_token: string | null
    created_at: Date | string
    updated_at: Date | string
}
interface SourceInfo {
    count: number
    digest: string
    ready: boolean
}

export class EmbeddingConflictError extends Error {
    /**
     * Creates a safe conflict for stale configuration, actions, or vector spaces.
     * @param message - Public explanation without private provider details.
     */
    constructor(message = '向量配置或操作已变化，请刷新后重试。') {
        super(message)
        this.name = 'EmbeddingConflictError'
    }
}
export class EmbeddingNotFoundError extends Error {
    /**
     * Hides absent and foreign document or connection identifiers behind the same error.
     */
    constructor() {
        super('未找到该向量连接或资料。')
        this.name = 'EmbeddingNotFoundError'
    }
}
export class VectorUnavailableError extends Error {
    /**
     * Reports missing persistent vector capability without offering a volatile fallback.
     */
    constructor() {
        super('向量数据库尚未就绪，请检查 PostgreSQL 的 pgvector 扩展。')
        this.name = 'VectorUnavailableError'
    }
}

/**
 * Validates a trusted ownership tuple before accessing private model or vector records.
 * @param scope - Account and workspace established by the API.
 * @returns Nothing for complete ownership.
 * @throws Error when either ownership component is missing.
 */
function scopeRequired(scope: ChatScope): void {
    if (!scope?.workspaceId?.trim() || !scope.userId?.trim()) throw new Error('Embedding ownership is required.')
}
/**
 * Compares immutable vector-space identities while permitting display-name changes.
 * @param first - First verified space.
 * @param second - Second verified space.
 * @returns Whether both identities represent the same cosine vector space.
 */
export function sameEmbeddingSpace(first: EmbeddingSpace | undefined, second: EmbeddingSpace | undefined): boolean {
    return Boolean(
        first &&
        second &&
        first.id === second.id &&
        first.revision === second.revision &&
        first.model === second.model &&
        first.providerModel === second.providerModel &&
        first.dimensions === second.dimensions
    )
}
/**
 * Derives a verified nonsecret space from public connection metadata.
 * @param model - A saved public connection.
 * @returns Its immutable usable space or undefined before successful verification.
 */
export function embeddingSpace(model: EmbeddingModel | undefined): EmbeddingSpace | undefined {
    return model?.dimensions && model.providerModel && model.verifiedAt
        ? embeddingSpaceSchema.parse({
              id: model.id,
              name: model.name,
              revision: model.revision,
              model: model.model,
              providerModel: model.providerModel,
              dimensions: model.dimensions,
          })
        : undefined
}
/**
 * Validates physical float32 values and stably normalizes their direction for cosine storage and queries.
 * @param values - Provider-produced vector.
 * @param dimensions - Verified expected dimension count.
 * @returns Finite nonzero float32 unit-direction values without changing dimensionality.
 * @throws Error for malformed, overflowing, underflowed-zero, or mismatched vectors.
 */
function vectorValues(values: number[], dimensions: number): number[] {
    if (!Array.isArray(values) || values.length !== dimensions || dimensions < 1 || dimensions > 4096)
        throw new Error('Invalid embedding dimensions.')
    const converted = values.map(value => (typeof value === 'number' ? Math.fround(value) : NaN))
    if (converted.some(value => !Number.isFinite(value)) || !converted.some(value => value !== 0))
        throw new Error('Invalid pgvector float32 values.')
    // Scale before squaring so extreme valid float32 magnitudes cannot overflow or underflow pgvector's norm.
    const maximum = converted.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0)
    const scaled = converted.map(value => value / maximum)
    const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0))
    const normalized = scaled.map(value => Math.fround(value / norm))
    if (normalized.some(value => !Number.isFinite(value)) || !normalized.some(value => value !== 0))
        throw new Error('Invalid normalized pgvector values.')
    return normalized
}
/**
 * Runs one pool-owned transaction and preserves its original failure after rollback.
 * @param pool - Shared application pool.
 * @param operation - Transactional persistence operation.
 * @param scope - Optional owner whose model/default mutations must be serialized.
 * @returns The operation result after commit.
 * @throws Error after rollback when persistence or validation fails.
 */
async function transaction<T>(pool: pg.Pool, operation: (client: pg.PoolClient) => Promise<T>, scope?: ChatScope): Promise<T> {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        if (scope) {
            scopeRequired(scope)
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
                JSON.stringify(['embedding-owner', scope.workspaceId, scope.userId]),
            ])
        }
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
 * Reads the immutable source identity from already-authorized persistent document rows.
 * @param client - Pool or transaction query transport.
 * @param scope - Trusted ownership tuple.
 * @param id - Document UUID.
 * @returns Source state and an ordered digest, or undefined for absent/foreign documents.
 */
async function sourceInfo(client: Pick<pg.Pool, 'query'>, scope: ChatScope, id: string): Promise<SourceInfo | undefined> {
    const result = await client.query<{ status: string; chunk_count: number; actual_count: string; digest: string }>(
        `SELECT d.status,d.chunk_count,
        (SELECT count(*)::text FROM harness_knowledge_chunks c WHERE c.workspace_id=d.workspace_id AND c.user_id=d.user_id AND c.document_id=d.id) AS actual_count,
        (SELECT md5(string_agg(c.data::text,E'\\n' ORDER BY c.chunk_index)) FROM harness_knowledge_chunks c WHERE c.workspace_id=d.workspace_id AND c.user_id=d.user_id AND c.document_id=d.id) AS digest
        FROM harness_knowledge_documents d WHERE d.workspace_id=$1 AND d.user_id=$2 AND d.id=$3`,
        [scope.workspaceId, scope.userId, id]
    )
    const row = result.rows[0]
    return row
        ? {
              count: Number(row.actual_count),
              digest: row.digest,
              ready: row.status === 'ready' && row.chunk_count > 0 && Number(row.actual_count) === row.chunk_count,
          }
        : undefined
}
/**
 * Reads public metadata and ciphertext only inside its exact ownership scope.
 * @param client - Shared pool or owner-locked transaction.
 * @param scope - Trusted ownership.
 * @param id - Optional model UUID, otherwise select the default.
 * @returns The private model or undefined.
 */
async function readModel(client: Pick<pg.Pool, 'query'>, scope: ChatScope, id?: string): Promise<StoredEmbeddingModel | undefined> {
    const result = await client.query<ModelRow>(
        `SELECT data FROM harness_embedding_models WHERE workspace_id=$1 AND user_id=$2 ${id ? 'AND id=$3' : "AND data->'model'->>'isDefault'='true'"}`,
        id ? [scope.workspaceId, scope.userId, id] : [scope.workspaceId, scope.userId]
    )
    const data = result.rows[0]?.data
    return data ? { model: embeddingModelSchema.parse(data.model), encryptedApiKey: data.encryptedApiKey } : undefined
}
/**
 * Converts persistent job counters into the strict public index schema.
 * @param row - Complete durable job row.
 * @returns A public independent index snapshot.
 */
function indexFromRow(row: IndexRow): KnowledgeVectorIndex {
    return knowledgeVectorIndexSchema.parse({
        documentId: row.document_id,
        status: row.status,
        generation: row.generation,
        attempt: row.attempt,
        completedChunks: row.completed_chunks,
        totalChunks: row.total_chunks,
        model: row.model,
        ...(row.error ? { error: row.error } : {}),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
    })
}
/**
 * Detects a live lease without permitting an expired owner to publish a batch.
 * @param client - Current transaction.
 * @param job - Claimed job ownership.
 * @returns The locked current row or undefined when ownership is stale.
 */
async function ownedJob(client: Pick<pg.Pool, 'query'>, job: VectorLease): Promise<IndexRow | undefined> {
    const result = await client.query<IndexRow>(
        `SELECT * FROM harness_vector_jobs WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3 AND generation=$4 AND attempt=$5 AND lease_token=$6 AND status='indexing' AND lease_until>clock_timestamp() FOR UPDATE`,
        [job.scope.workspaceId, job.scope.userId, job.index.documentId, job.index.generation, job.index.attempt, job.leaseToken]
    )
    return result.rows[0]
}
/**
 * Initializes independent credential/actions/jobs and optionally the true pgvector capability.
 * @param client - Application schema transaction already protected by its advisory lock.
 * @returns Whether public.vector and its persistent vector table are usable.
 * @throws Error for real database failures; optional extension availability is isolated by savepoint.
 */
export async function initializeEmbeddingTables(client: Pick<pg.Pool, 'query'>): Promise<boolean> {
    await client.query(
        `CREATE TABLE IF NOT EXISTS harness_embedding_models (workspace_id text NOT NULL,user_id text NOT NULL,id uuid NOT NULL,data jsonb NOT NULL,PRIMARY KEY(workspace_id,user_id,id))`
    )
    await client.query(
        `CREATE TABLE IF NOT EXISTS harness_embedding_create_actions (workspace_id text NOT NULL,user_id text NOT NULL,id uuid NOT NULL,fingerprint text NOT NULL,PRIMARY KEY(workspace_id,user_id,id))`
    )
    await client.query(
        `CREATE TABLE IF NOT EXISTS harness_vector_jobs (workspace_id text NOT NULL,user_id text NOT NULL,document_id uuid NOT NULL,generation integer NOT NULL,attempt integer NOT NULL DEFAULT 0,status text NOT NULL,completed_chunks integer NOT NULL DEFAULT 0,total_chunks integer NOT NULL,model jsonb NOT NULL,source_digest text NOT NULL,error text,lease_token uuid,lease_until timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,user_id,document_id),FOREIGN KEY(workspace_id,user_id,document_id) REFERENCES harness_knowledge_documents(workspace_id,user_id,id) ON DELETE CASCADE)`
    )
    await client.query(
        `CREATE TABLE IF NOT EXISTS harness_vector_actions (workspace_id text NOT NULL,user_id text NOT NULL,request_id uuid NOT NULL,document_id uuid NOT NULL,fingerprint text NOT NULL,PRIMARY KEY(workspace_id,user_id,request_id))`
    )
    await client.query('CREATE INDEX IF NOT EXISTS harness_vector_pending_idx ON harness_vector_jobs(status,lease_until,created_at)')
    await client.query('SAVEPOINT harness_optional_vector')
    try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public')
        const type = await client.query<{ present: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='vector') AS present"
        )
        if (!type.rows[0]?.present) {
            await client.query('ROLLBACK TO SAVEPOINT harness_optional_vector')
            await client.query('RELEASE SAVEPOINT harness_optional_vector')
            return false
        }
        await client.query(
            `CREATE TABLE IF NOT EXISTS harness_knowledge_vectors (workspace_id text NOT NULL,user_id text NOT NULL,document_id uuid NOT NULL,generation integer NOT NULL,chunk_index integer NOT NULL,chunk_id uuid NOT NULL,model_id uuid NOT NULL,revision integer NOT NULL,dimensions integer NOT NULL,provider_model text NOT NULL,embedding public.vector NOT NULL,PRIMARY KEY(workspace_id,user_id,document_id,generation,chunk_index),FOREIGN KEY(workspace_id,user_id,document_id) REFERENCES harness_knowledge_documents(workspace_id,user_id,id) ON DELETE CASCADE)`
        )
        await client.query('RELEASE SAVEPOINT harness_optional_vector')
        return true
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        await client.query('ROLLBACK TO SAVEPOINT harness_optional_vector')
        await client.query('RELEASE SAVEPOINT harness_optional_vector')
        if (['0A000', '42501', '58P01', '42704'].includes(String(code))) return false
        throw error
    }
}

/**
 * Durable credential, job, checkpoint, and true cosine retrieval operations sharing one application pool.
 */
class PostgresEmbeddingStore {
    /**
     * Retains the parent-owned pool without allocating another database connection manager.
     * @param pool - Application-owned PostgreSQL pool.
     * @param vectorAvailable - Whether optional vector initialization actually succeeded.
     */
    constructor(
        private readonly pool: pg.Pool,
        readonly vectorAvailable: boolean
    ) {}
    /**
     * Requires the actual vector capability before reading or writing its physical table.
     * @returns Nothing when pgvector is available.
     * @throws VectorUnavailableError when the extension is unconfigured or unavailable.
     */
    private requireVector(): void {
        if (!this.vectorAvailable) throw new VectorUnavailableError()
    }
    /**
     * Lists safe private model records only in the authenticated ownership scope.
     * @param scope - Trusted ownership tuple.
     * @returns Independent model metadata and encrypted credentials.
     */
    async listModels(scope: ChatScope): Promise<StoredEmbeddingModel[]> {
        scopeRequired(scope)
        const rows = await this.pool.query<ModelRow>(
            'SELECT data FROM harness_embedding_models WHERE workspace_id=$1 AND user_id=$2 ORDER BY id',
            [scope.workspaceId, scope.userId]
        )
        return rows.rows.map(row => ({ model: embeddingModelSchema.parse(row.data.model), encryptedApiKey: row.data.encryptedApiKey }))
    }
    /**
     * Reads one scoped model or the scoped current default.
     * @param scope - Trusted ownership tuple.
     * @param id - Optional owned UUID.
     * @returns The private record or undefined.
     */
    async getModel(scope: ChatScope, id?: string): Promise<StoredEmbeddingModel | undefined> {
        scopeRequired(scope)
        return readModel(this.pool, scope, id)
    }
    /**
     * Creates one model action without allowing deleted creation actions to resurrect records.
     * @param scope - Trusted ownership tuple.
     * @param record - Initial encrypted model snapshot.
     * @param fingerprint - Server HMAC of the normalized original parameters.
     * @returns Authoritative current metadata for a matching replay or new model.
     * @throws EmbeddingConflictError for reused or deleted actions.
     */
    async createModel(scope: ChatScope, record: StoredEmbeddingModel, fingerprint: string): Promise<EmbeddingModel> {
        scopeRequired(scope)
        return transaction(
            this.pool,
            async client => {
                const action = await client.query<{ fingerprint: string }>(
                    'SELECT fingerprint FROM harness_embedding_create_actions WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                    [scope.workspaceId, scope.userId, record.model.id]
                )
                if (action.rows[0]) {
                    if (action.rows[0].fingerprint !== fingerprint) throw new EmbeddingConflictError('该创建操作已用于不同的向量配置。')
                    const existing = await readModel(client, scope, record.model.id)
                    if (!existing) throw new EmbeddingConflictError('该连接已被删除，请用新的操作重新创建。')
                    return existing.model
                }
                const models = await client.query('SELECT 1 FROM harness_embedding_models WHERE workspace_id=$1 AND user_id=$2 LIMIT 1', [
                    scope.workspaceId,
                    scope.userId,
                ])
                const model = embeddingModelSchema.parse({ ...record.model, isDefault: models.rows.length === 0 })
                await client.query(
                    'INSERT INTO harness_embedding_create_actions(workspace_id,user_id,id,fingerprint) VALUES($1,$2,$3,$4)',
                    [scope.workspaceId, scope.userId, model.id, fingerprint]
                )
                await client.query('INSERT INTO harness_embedding_models(workspace_id,user_id,id,data) VALUES($1,$2,$3,$4::jsonb)', [
                    scope.workspaceId,
                    scope.userId,
                    model.id,
                    JSON.stringify({ ...record, model }),
                ])
                return model
            },
            scope
        )
    }
    /**
     * Updates a connection under revision CAS and invalidates only real routing or key changes.
     * @param scope - Trusted ownership tuple.
     * @param id - Owned model UUID.
     * @param revision - Revision the user actually edited.
     * @param replacement - Normalized public fields and retained/replaced encrypted key.
     * @returns The authoritative updated public model.
     * @throws EmbeddingNotFoundError or EmbeddingConflictError for foreign or stale records.
     */
    async updateModel(scope: ChatScope, id: string, revision: number, replacement: StoredEmbeddingModel): Promise<EmbeddingModel> {
        return transaction(
            this.pool,
            async client => {
                const current = await readModel(client, scope, id)
                if (!current) throw new EmbeddingNotFoundError()
                if (current.model.revision !== revision) throw new EmbeddingConflictError()
                const changed =
                    current.model.baseUrl !== replacement.model.baseUrl ||
                    current.model.model !== replacement.model.model ||
                    current.encryptedApiKey !== replacement.encryptedApiKey
                const model = {
                    ...current.model,
                    name: replacement.model.name,
                    baseUrl: replacement.model.baseUrl,
                    model: replacement.model.model,
                    revision: revision + Number(changed),
                    updatedAt: new Date().toISOString(),
                }
                if (changed) {
                    delete model.dimensions
                    delete model.providerModel
                    delete model.verifiedAt
                }
                const record = { model: embeddingModelSchema.parse(model), encryptedApiKey: replacement.encryptedApiKey }
                await client.query('UPDATE harness_embedding_models SET data=$4::jsonb WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                    scope.workspaceId,
                    scope.userId,
                    id,
                    JSON.stringify(record),
                ])
                return record.model
            },
            scope
        )
    }
    /**
     * Commits actual verification only when the probed revision still exists unchanged.
     * @param scope - Trusted ownership tuple.
     * @param id - Probed connection UUID.
     * @param revision - Revision captured before the network operation.
     * @param dimensions - Actual validated provider dimension count.
     * @param providerModel - Actual nonempty provider response model.
     * @returns Current verified metadata with a new revision when a previous identity drifted.
     * @throws EmbeddingConflictError when a newer edit superseded the probe.
     */
    async verifyModel(scope: ChatScope, id: string, revision: number, dimensions: number, providerModel: string): Promise<EmbeddingModel> {
        return transaction(
            this.pool,
            async client => {
                const current = await readModel(client, scope, id)
                if (!current) throw new EmbeddingNotFoundError()
                if (current.model.revision !== revision) throw new EmbeddingConflictError('连接在测试期间已修改，请重新测试当前配置。')
                const drift = Boolean(
                    current.model.verifiedAt && (current.model.dimensions !== dimensions || current.model.providerModel !== providerModel)
                )
                const model = embeddingModelSchema.parse({
                    ...current.model,
                    revision: revision + Number(drift),
                    dimensions,
                    providerModel,
                    verifiedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                })
                await client.query('UPDATE harness_embedding_models SET data=$4::jsonb WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                    scope.workspaceId,
                    scope.userId,
                    id,
                    JSON.stringify({ ...current, model }),
                ])
                return model
            },
            scope
        )
    }
    /**
     * Makes one owned connection the unique default without calling its provider.
     * @param scope - Trusted ownership tuple.
     * @param id - Connection UUID selected by the user.
     * @returns The selected public metadata.
     */
    async setDefaultModel(scope: ChatScope, id: string): Promise<EmbeddingModel> {
        return transaction(
            this.pool,
            async client => {
                const current = await readModel(client, scope, id)
                if (!current) throw new EmbeddingNotFoundError()
                await client.query(
                    `UPDATE harness_embedding_models SET data=jsonb_set(data,'{model,isDefault}','false'::jsonb) WHERE workspace_id=$1 AND user_id=$2`,
                    [scope.workspaceId, scope.userId]
                )
                const model = { ...current.model, isDefault: true, updatedAt: new Date().toISOString() }
                await client.query('UPDATE harness_embedding_models SET data=$4::jsonb WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                    scope.workspaceId,
                    scope.userId,
                    id,
                    JSON.stringify({ ...current, model }),
                ])
                return model
            },
            scope
        )
    }
    /**
     * Deletes an owned configuration while preserving its creation tombstone and frozen job identities.
     * @param scope - Trusted ownership tuple.
     * @param id - Owned connection UUID.
     * @returns Whether a model was removed.
     */
    async deleteModel(scope: ChatScope, id: string): Promise<boolean> {
        return transaction(
            this.pool,
            async client =>
                (
                    await client.query('DELETE FROM harness_embedding_models WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                        scope.workspaceId,
                        scope.userId,
                        id,
                    ])
                ).rowCount === 1,
            scope
        )
    }
    /**
     * Reads document ownership and derived index compatibility against the current unique default.
     * @param scope - Trusted ownership tuple.
     * @param id - Document UUID.
     * @returns An owned public index, including truthful none/stale states.
     * @throws EmbeddingNotFoundError for absent or foreign documents.
     */
    async getIndex(scope: ChatScope, id: string): Promise<KnowledgeVectorIndex> {
        scopeRequired(scope)
        const source = await sourceInfo(this.pool, scope, id)
        if (!source) throw new EmbeddingNotFoundError()
        const rows = await this.pool.query<IndexRow>(
            'SELECT * FROM harness_vector_jobs WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3',
            [scope.workspaceId, scope.userId, id]
        )
        if (!rows.rows[0])
            return knowledgeVectorIndexSchema.parse({
                documentId: id,
                status: 'none',
                generation: 0,
                attempt: 0,
                completedChunks: 0,
                totalChunks: source.count,
            })
        const index = indexFromRow(rows.rows[0])
        const current = embeddingSpace((await readModel(this.pool, scope))?.model)
        return !source.ready || source.digest !== rows.rows[0].source_digest || !sameEmbeddingSpace(current, index.model)
            ? { ...index, status: 'stale' }
            : index
    }
    /**
     * Starts an explicit new index generation or resumes a compatible failed generation idempotently.
     * @param scope - Trusted ownership tuple.
     * @param id - Owned ready document UUID.
     * @param action - Stable action and the default identity confirmed by the user.
     * @param retry - Resume a failed generation rather than explicitly rebuild.
     * @returns Current authoritative index for matching action replays or the queued generation.
     * @throws EmbeddingConflictError for stale defaults, actions, sources, or incompatible retries.
     */
    async startIndex(scope: ChatScope, id: string, action: KnowledgeIndexAction, retry = false): Promise<KnowledgeVectorIndex> {
        this.requireVector()
        const fingerprint = createHash('sha256')
            .update(JSON.stringify([id, action.modelId, action.revision, retry]))
            .digest('hex')
        return transaction(
            this.pool,
            async client => {
                const source = await sourceInfo(client, scope, id)
                if (!source) throw new EmbeddingNotFoundError()
                const prior = await client.query<IndexRow>(
                    'SELECT * FROM harness_vector_jobs WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3 FOR UPDATE',
                    [scope.workspaceId, scope.userId, id]
                )
                const replay = await client.query<{ fingerprint: string }>(
                    'SELECT fingerprint FROM harness_vector_actions WHERE workspace_id=$1 AND user_id=$2 AND request_id=$3',
                    [scope.workspaceId, scope.userId, action.requestId]
                )
                if (replay.rows[0]) {
                    if (replay.rows[0].fingerprint !== fingerprint || !prior.rows[0])
                        throw new EmbeddingConflictError('该索引操作已用于不同的资料或参数。')
                    const snapshot = indexFromRow(prior.rows[0])
                    const currentSpace = embeddingSpace((await readModel(client, scope))?.model)
                    return !source.ready ||
                        source.digest !== prior.rows[0].source_digest ||
                        !sameEmbeddingSpace(currentSpace, snapshot.model)
                        ? { ...snapshot, status: 'stale' }
                        : snapshot
                }
                const current = (await readModel(client, scope))?.model
                const space = embeddingSpace(current)
                if (!space || space.id !== action.modelId || space.revision !== action.revision)
                    throw new EmbeddingConflictError('默认向量模型已变化或未通过测试，请刷新并确认当前配置。')
                if (!source.ready) throw new EmbeddingConflictError('资料尚未完成分片，不能建立向量索引。')
                const previous = prior.rows[0]
                if (
                    retry &&
                    (!previous ||
                        previous.status !== 'failed' ||
                        !sameEmbeddingSpace(previous.model, space) ||
                        previous.source_digest !== source.digest)
                )
                    throw new EmbeddingConflictError('原索引与当前默认模型或资料不相容，请明确重新建立索引。')
                if (
                    !retry &&
                    previous &&
                    ['queued', 'indexing'].includes(previous.status) &&
                    sameEmbeddingSpace(previous.model, space) &&
                    previous.source_digest === source.digest
                )
                    throw new EmbeddingConflictError('该资料正在建立索引，请等待当前处理完成。')
                if (retry) {
                    await client.query(
                        `UPDATE harness_vector_jobs SET status='queued',error=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3`,
                        [scope.workspaceId, scope.userId, id]
                    )
                } else {
                    await client.query(
                        `INSERT INTO harness_vector_jobs(workspace_id,user_id,document_id,generation,status,total_chunks,model,source_digest,created_at,updated_at) VALUES($1,$2,$3,$4,'queued',$5,$6::jsonb,$7,clock_timestamp(),clock_timestamp())
                    ON CONFLICT(workspace_id,user_id,document_id) DO UPDATE SET generation=EXCLUDED.generation,status='queued',attempt=0,completed_chunks=0,total_chunks=EXCLUDED.total_chunks,model=EXCLUDED.model,source_digest=EXCLUDED.source_digest,error=NULL,lease_token=NULL,lease_until=NULL,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`,
                        [
                            scope.workspaceId,
                            scope.userId,
                            id,
                            (previous?.generation ?? 0) + 1,
                            source.count,
                            JSON.stringify(space),
                            source.digest,
                        ]
                    )
                    await client.query('DELETE FROM harness_knowledge_vectors WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3', [
                        scope.workspaceId,
                        scope.userId,
                        id,
                    ])
                }
                await client.query(
                    'INSERT INTO harness_vector_actions(workspace_id,user_id,request_id,document_id,fingerprint) VALUES($1,$2,$3,$4,$5)',
                    [scope.workspaceId, scope.userId, action.requestId, id, fingerprint]
                )
                const saved = await client.query<IndexRow>(
                    'SELECT * FROM harness_vector_jobs WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3',
                    [scope.workspaceId, scope.userId, id]
                )
                return indexFromRow(saved.rows[0]!)
            },
            scope
        )
    }
    /**
     * Claims one queued or expired indexing job for a current team member or a legacy workspace.
     * @param leaseMs - Positive bounded lease lifetime in milliseconds.
     * @returns A new ownership token and increased attempt, or undefined when idle.
     */
    async claim(leaseMs: number): Promise<VectorLease | undefined> {
        this.requireVector()
        if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 120000) throw new Error('Invalid vector lease.')
        const result = await this.pool.query<IndexRow>(
            `WITH candidate AS (SELECT j.workspace_id,j.user_id,j.document_id FROM harness_vector_jobs j
                WHERE (j.status='queued' OR(j.status='indexing' AND j.lease_until<=clock_timestamp()))
                AND (NOT EXISTS(SELECT 1 FROM harness_workspaces w WHERE w.id=j.workspace_id AND w.kind='team')
                    OR EXISTS(SELECT 1 FROM harness_workspace_members m WHERE m.workspace_id=j.workspace_id AND m.user_id::text=j.user_id))
                ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1)
            UPDATE harness_vector_jobs j SET status='indexing',attempt=j.attempt+1,lease_token=$1,lease_until=clock_timestamp()+($2::int*interval '1 millisecond'),updated_at=clock_timestamp(),error=NULL FROM candidate c WHERE j.workspace_id=c.workspace_id AND j.user_id=c.user_id AND j.document_id=c.document_id RETURNING j.*`,
            [randomUUID(), leaseMs]
        )
        const row = result.rows[0]
        return row
            ? {
                  scope: { workspaceId: row.workspace_id, userId: row.user_id },
                  index: indexFromRow(row),
                  sourceDigest: row.source_digest,
                  leaseToken: row.lease_token!,
              }
            : undefined
    }
    /**
     * Renews only a live current attempt without reviving expired ownership.
     * @param job - Claimed generation, attempt, and token.
     * @param leaseMs - Positive lease extension in milliseconds.
     * @returns Whether the caller remains the owner.
     */
    async heartbeat(job: VectorLease, leaseMs: number): Promise<boolean> {
        const result = await this.pool.query(
            `UPDATE harness_vector_jobs SET lease_until=clock_timestamp()+($7::int*interval '1 millisecond') WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3 AND generation=$4 AND attempt=$5 AND lease_token=$6 AND status='indexing' AND lease_until>clock_timestamp()`,
            [
                job.scope.workspaceId,
                job.scope.userId,
                job.index.documentId,
                job.index.generation,
                job.index.attempt,
                job.leaseToken,
                leaseMs,
            ]
        )
        return result.rowCount === 1
    }
    /**
     * Returns at most sixteen source chunks without a persisted checkpoint in this exact generation.
     * @param job - Current claimed generation.
     * @returns Ordered unindexed source chunks.
     */
    async pendingChunks(job: VectorLease): Promise<KnowledgeChunk[]> {
        const result = await this.pool.query<{ data: KnowledgeChunk }>(
            `SELECT c.data FROM harness_knowledge_chunks c WHERE c.workspace_id=$1 AND c.user_id=$2 AND c.document_id=$3 AND NOT EXISTS(SELECT 1 FROM harness_knowledge_vectors v WHERE v.workspace_id=c.workspace_id AND v.user_id=c.user_id AND v.document_id=c.document_id AND v.generation=$4 AND v.chunk_index=c.chunk_index) ORDER BY c.chunk_index LIMIT 16`,
            [job.scope.workspaceId, job.scope.userId, job.index.documentId, job.index.generation]
        )
        return result.rows.map(row => row.data)
    }
    /**
     * Commits one bounded checkpoint and atomically publishes ready only after the complete source is present.
     * @param job - Claimed generation, attempt, and token.
     * @param chunks - Immutable source chunks matching the returned vector order.
     * @param vectors - Actual provider vectors, revalidated for physical float32 storage.
     * @returns Updated index, or undefined when this worker lost ownership.
     * @throws EmbeddingConflictError when source/default identity changed.
     */
    async saveBatch(job: VectorLease, chunks: KnowledgeChunk[], vectors: number[][]): Promise<KnowledgeVectorIndex | undefined> {
        this.requireVector()
        if (!chunks.length || chunks.length > 16 || vectors.length !== chunks.length || !job.index.model)
            throw new Error('Invalid vector checkpoint batch.')
        const converted = vectors.map(vector => vectorValues(vector, job.index.model!.dimensions))
        chunks = chunks.map(chunk => knowledgeChunkSchema.parse(chunk))
        return transaction(
            this.pool,
            async client => {
                const row = await ownedJob(client, job)
                if (!row) return undefined
                const current = embeddingSpace((await readModel(client, job.scope))?.model)
                const source = await sourceInfo(client, job.scope, job.index.documentId)
                if (!sameEmbeddingSpace(current, row.model) || !source?.ready || source.digest !== row.source_digest)
                    throw new EmbeddingConflictError('向量模型或源分片已变化，请重新建立索引。')
                const actual = await client.query<{ data: KnowledgeChunk }>(
                    'SELECT data FROM harness_knowledge_chunks WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3 AND chunk_index=ANY($4::int[])',
                    [job.scope.workspaceId, job.scope.userId, job.index.documentId, chunks.map(chunk => chunk.index)]
                )
                if (
                    actual.rows.length !== chunks.length ||
                    chunks.some(
                        chunk =>
                            !actual.rows.some(
                                candidate => JSON.stringify(knowledgeChunkSchema.parse(candidate.data)) === JSON.stringify(chunk)
                            )
                    )
                )
                    throw new EmbeddingConflictError('资料分片已变化，请重新建立索引。')
                for (let index = 0; index < chunks.length; index++) {
                    const chunk = chunks[index]!
                    await client.query(
                        `INSERT INTO harness_knowledge_vectors(workspace_id,user_id,document_id,generation,chunk_index,chunk_id,model_id,revision,dimensions,provider_model,embedding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::public.vector) ON CONFLICT DO NOTHING`,
                        [
                            job.scope.workspaceId,
                            job.scope.userId,
                            job.index.documentId,
                            row.generation,
                            chunk.index,
                            chunk.id,
                            row.model.id,
                            row.model.revision,
                            row.model.dimensions,
                            row.model.providerModel,
                            JSON.stringify(converted[index]),
                        ]
                    )
                }
                const count = await client.query<{ count: string }>(
                    'SELECT count(*)::text AS count FROM harness_knowledge_vectors WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3 AND generation=$4',
                    [job.scope.workspaceId, job.scope.userId, job.index.documentId, row.generation]
                )
                const completed = Number(count.rows[0]!.count)
                const ready = completed === row.total_chunks
                const result = await client.query<IndexRow>(
                    `UPDATE harness_vector_jobs SET completed_chunks=$4,status=$5,lease_token=CASE WHEN $6 THEN NULL ELSE lease_token END,lease_until=CASE WHEN $6 THEN NULL ELSE lease_until END,updated_at=clock_timestamp() WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3 RETURNING *`,
                    [job.scope.workspaceId, job.scope.userId, job.index.documentId, completed, ready ? 'ready' : 'indexing', ready]
                )
                return indexFromRow(result.rows[0]!)
            },
            job.scope
        )
    }
    /**
     * Records a safe failure for only the current unexpired indexing attempt.
     * @param job - Claimed job ownership.
     * @param message - Public-safe bounded failure explanation.
     * @returns Whether this owner recorded the failure.
     */
    async fail(job: VectorLease, message: string): Promise<boolean> {
        const result = await this.pool.query(
            `UPDATE harness_vector_jobs SET status='failed',error=$7,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3 AND generation=$4 AND attempt=$5 AND lease_token=$6 AND status='indexing' AND lease_until>clock_timestamp()`,
            [
                job.scope.workspaceId,
                job.scope.userId,
                job.index.documentId,
                job.index.generation,
                job.index.attempt,
                job.leaseToken,
                message.slice(0, 500),
            ]
        )
        return result.rowCount === 1
    }
    /**
     * Releases a current attempt to the durable queue while preserving generation and checkpoints.
     * @param job - Claimed job ownership.
     * @returns Whether the token was released.
     */
    async release(job: VectorLease): Promise<boolean> {
        const result = await this.pool.query(
            `UPDATE harness_vector_jobs SET status='queued',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=$1 AND user_id=$2 AND document_id=$3 AND generation=$4 AND attempt=$5 AND lease_token=$6 AND status='indexing'`,
            [job.scope.workspaceId, job.scope.userId, job.index.documentId, job.index.generation, job.index.attempt, job.leaseToken]
        )
        return result.rowCount === 1
    }
    /**
     * Checks ready compatible source generations before paying for a query embedding.
     * @param scope - Trusted ownership tuple.
     * @param space - Expected verified default space.
     * @param documentId - Optional already-scoped document filter.
     * @returns Whether at least one whole compatible generation is queryable.
     */
    async searchable(scope: ChatScope, space: EmbeddingSpace, documentId?: string): Promise<boolean> {
        this.requireVector()
        return transaction(
            this.pool,
            async client => {
                if (documentId && !(await sourceInfo(client, scope, documentId))) throw new EmbeddingNotFoundError()
                if (!sameEmbeddingSpace(embeddingSpace((await readModel(client, scope))?.model), space))
                    throw new EmbeddingConflictError('默认向量模型已变化，请重新提交查询。')
                const result = await client.query(
                    `SELECT 1 FROM harness_vector_jobs j JOIN harness_knowledge_documents d ON d.workspace_id=j.workspace_id AND d.user_id=j.user_id AND d.id=j.document_id WHERE j.workspace_id=$1 AND j.user_id=$2 AND j.status='ready' AND d.status='ready' AND j.model->>'id'=$3 AND (j.model->>'revision')::int=$4 AND (j.model->>'dimensions')::int=$5 AND j.model->>'providerModel'=$6 AND j.completed_chunks=j.total_chunks AND d.chunk_count=j.total_chunks
                    AND (SELECT count(*) FROM harness_knowledge_vectors whole WHERE whole.workspace_id=j.workspace_id AND whole.user_id=j.user_id AND whole.document_id=j.document_id AND whole.generation=j.generation)=j.total_chunks
                    AND j.source_digest=(SELECT md5(string_agg(source.data::text,E'\\n' ORDER BY source.chunk_index)) FROM harness_knowledge_chunks source WHERE source.workspace_id=j.workspace_id AND source.user_id=j.user_id AND source.document_id=j.document_id)
                    ${documentId ? 'AND j.document_id=$7' : ''} LIMIT 1`,
                    [
                        scope.workspaceId,
                        scope.userId,
                        space.id,
                        space.revision,
                        space.dimensions,
                        space.providerModel,
                        ...(documentId ? [documentId] : []),
                    ]
                )
                return result.rows.length > 0
            },
            scope
        )
    }
    /**
     * Computes true PostgreSQL cosine distance after materializing only compatible owned vectors.
     * @param scope - Trusted ownership tuple.
     * @param space - Same verified default identity used for the query embedding.
     * @param queryVector - Actual finite nonzero float32 query vector.
     * @param topK - Maximum result count from one through twenty.
     * @param documentId - Optional owned source filter.
     * @returns Scoped source chunks with real SQL distance and cosine similarity.
     */
    async search(
        scope: ChatScope,
        space: EmbeddingSpace,
        queryVector: number[],
        topK: number,
        documentId?: string
    ): Promise<KnowledgeSearchResult['hits']> {
        this.requireVector()
        if (!Number.isSafeInteger(topK) || topK < 1 || topK > 20) throw new Error('Invalid vector result limit.')
        const vector = vectorValues(queryVector, space.dimensions)
        return transaction(
            this.pool,
            async client => {
                if (documentId && !(await sourceInfo(client, scope, documentId))) throw new EmbeddingNotFoundError()
                if (!sameEmbeddingSpace(embeddingSpace((await readModel(client, scope))?.model), space))
                    throw new EmbeddingConflictError('默认向量模型已变化，请重新提交查询。')
                const result = await client.query<{ document_id: string; file_name: string; data: KnowledgeChunk; distance: number }>(
                    `WITH compatible AS MATERIALIZED (
                SELECT v.embedding,v.document_id,c.data,d.document->>'fileName' AS file_name,c.chunk_index FROM harness_knowledge_vectors v
                JOIN harness_vector_jobs j ON j.workspace_id=v.workspace_id AND j.user_id=v.user_id AND j.document_id=v.document_id AND j.generation=v.generation
                JOIN harness_knowledge_documents d ON d.workspace_id=v.workspace_id AND d.user_id=v.user_id AND d.id=v.document_id
                JOIN harness_knowledge_chunks c ON c.workspace_id=v.workspace_id AND c.user_id=v.user_id AND c.document_id=v.document_id AND c.chunk_index=v.chunk_index AND c.data->>'id'=v.chunk_id::text
                WHERE v.workspace_id=$1 AND v.user_id=$2 AND j.status='ready' AND d.status='ready' AND j.completed_chunks=j.total_chunks AND d.chunk_count=j.total_chunks
                AND (SELECT count(*) FROM harness_knowledge_vectors whole WHERE whole.workspace_id=j.workspace_id AND whole.user_id=j.user_id AND whole.document_id=j.document_id AND whole.generation=j.generation)=j.total_chunks
                AND v.model_id=$3 AND v.revision=$4 AND v.dimensions=$5 AND v.provider_model=$6
                AND j.model->>'id'=$3::text AND (j.model->>'revision')::int=$4 AND (j.model->>'dimensions')::int=$5 AND j.model->>'providerModel'=$6
                AND j.source_digest=(SELECT md5(string_agg(source.data::text,E'\\n' ORDER BY source.chunk_index)) FROM harness_knowledge_chunks source WHERE source.workspace_id=j.workspace_id AND source.user_id=j.user_id AND source.document_id=j.document_id)
                ${documentId ? 'AND v.document_id=$9' : ''}
            ) SELECT document_id,file_name,data,embedding OPERATOR(public.<=>) $7::public.vector AS distance FROM compatible ORDER BY distance ASC,document_id ASC,chunk_index ASC LIMIT $8`,
                    [
                        scope.workspaceId,
                        scope.userId,
                        space.id,
                        space.revision,
                        space.dimensions,
                        space.providerModel,
                        JSON.stringify(vector),
                        topK,
                        ...(documentId ? [documentId] : []),
                    ]
                )
                return result.rows.map(row => ({
                    documentId: row.document_id,
                    fileName: row.file_name,
                    chunk: row.data,
                    distance: row.distance,
                    score: 1 - row.distance,
                }))
            },
            scope
        )
    }
}

export type EmbeddingStore = Pick<PostgresEmbeddingStore, keyof PostgresEmbeddingStore>
/**
 * Creates embedding persistence using the parent-owned initialized pool.
 * @param pool - Shared application PostgreSQL pool.
 * @param vectorAvailable - Actual optional extension capability.
 * @returns Independent model and persistent vector operations.
 */
export function createPostgresEmbeddingStore(pool: pg.Pool, vectorAvailable: boolean): EmbeddingStore {
    return new PostgresEmbeddingStore(pool, vectorAvailable)
}
