import { takeEmbeddingBatch } from '@ai-harness/chat-runtime/embeddings'
import {
    knowledgeSearchResultSchema,
    type KnowledgeIndexAction,
    type KnowledgeSearch,
    type KnowledgeSearchResult,
    type KnowledgeVectorIndex,
    type VectorStatus,
} from '@ai-harness/contracts'
import {
    EmbeddingConflictError,
    VectorUnavailableError,
    embeddingSpace,
    sameEmbeddingSpace,
    type ChatScope,
    type EmbeddingStore,
    type VectorLease,
} from '@ai-harness/db'
import { ConflictException } from '@nestjs/common'
import { EmbeddingService, embeddingHttpError } from './embedding-service.js'

export interface VectorWorkerOptions {
    autoStart?: boolean
    pollIntervalMs?: number
    leaseMs?: number
    heartbeatMs?: number
}

/**
 * Coordinates durable single-worker vector jobs and authorized explicit cosine retrieval.
 */
export class VectorService {
    private timer?: ReturnType<typeof setInterval>
    private active?: Promise<void>
    private abort?: AbortController
    private closing = false
    private closingPromise?: Promise<void>
    private readonly leaseMs: number
    private readonly heartbeatMs: number
    /**
     * Retains shared vector persistence and starts at most one process-owned worker.
     * @param store - Application-owned persistent vector and model store.
     * @param models - Private embedding authority and bounded provider adapter.
     * @param options - Explicit isolated test timing overrides.
     */
    constructor(
        private readonly store: EmbeddingStore | undefined,
        private readonly models: EmbeddingService,
        options: VectorWorkerOptions = {}
    ) {
        this.leaseMs = options.leaseMs ?? 60_000
        this.heartbeatMs = options.heartbeatMs ?? 10_000
        if (store?.vectorAvailable && options.autoStart !== false) {
            this.timer = setInterval(() => this.wake(), options.pollIntervalMs ?? 1000)
            this.timer.unref()
            this.wake()
        }
    }
    /**
     * Requires a real persistent vector capability before accepting paid or database vector work.
     * @returns The actual PostgreSQL-backed vector store.
     * @throws VectorUnavailableError when no real vector capability exists.
     */
    private persistence(): EmbeddingStore {
        if (!this.store?.vectorAvailable || this.closing) throw new VectorUnavailableError()
        return this.store
    }
    /**
     * Reports actual vector capability and independent current default without provider calls.
     * @param scope - Authenticated ownership.
     * @returns Safe capability and model configuration.
     */
    async status(scope: ChatScope): Promise<VectorStatus> {
        try {
            return {
                available: Boolean(this.store?.vectorAvailable),
                defaultModel: this.store ? await this.models.defaultModel(scope) : null,
                ...(!this.store?.vectorAvailable ? { reason: '向量数据库尚未就绪，请检查 PostgreSQL 的 pgvector 扩展。' } : {}),
            }
        } catch (error) {
            throw embeddingHttpError(error)
        }
    }
    /**
     * Reads an owned document's independent indexing state without changing parsing or creating work.
     * @param scope - Authenticated ownership.
     * @param id - Validated document UUID.
     * @returns Actual none/processing/ready/failed/stale state.
     */
    async index(scope: ChatScope, id: string): Promise<KnowledgeVectorIndex> {
        try {
            if (!this.store) throw new VectorUnavailableError()
            return await this.store.getIndex(scope, id)
        } catch (error) {
            throw embeddingHttpError(error)
        }
    }
    /**
     * Accepts an explicit confirmed-default action and queues a new generation or compatible retry.
     * @param scope - Authenticated ownership.
     * @param id - Owned ready document UUID.
     * @param action - Persistent action and the model/revision actually confirmed by the user.
     * @param retry - Resume a compatible failed generation instead of explicitly rebuilding.
     * @returns The committed queued or matching replay state.
     */
    async start(scope: ChatScope, id: string, action: KnowledgeIndexAction, retry = false): Promise<KnowledgeVectorIndex> {
        try {
            const index = await this.persistence().startIndex(scope, id, action, retry)
            this.wake()
            return index
        } catch (error) {
            throw embeddingHttpError(error)
        }
    }
    /**
     * Embeds one explicit user query only after finding a scoped complete compatible index.
     * @param scope - Authenticated ownership.
     * @param input - Validated query, Top K, and optional source filter.
     * @param signal - Browser response disconnect cancellation.
     * @returns Real SQL cosine hits with complete original source chunks.
     */
    async search(scope: ChatScope, input: KnowledgeSearch, signal?: AbortSignal): Promise<KnowledgeSearchResult> {
        try {
            const store = this.persistence()
            if (input.documentId) await store.getIndex(scope, input.documentId)
            const model = await this.models.defaultModel(scope)
            const space = embeddingSpace(model ?? undefined)
            if (!space) throw new ConflictException('请先配置并测试默认向量模型，再建立资料索引。')
            if (!(await store.searchable(scope, space, input.documentId)))
                throw new ConflictException('没有与当前默认向量模型相容的完整索引，请先建立或重建资料索引。')
            const result = await this.models.embed(scope, space, [input.query], signal)
            const current = embeddingSpace((await this.models.defaultModel(scope)) ?? undefined)
            if (!sameEmbeddingSpace(current, space)) throw new EmbeddingConflictError('默认向量模型已变化，请重新提交查询。')
            const hits = await store.search(scope, space, result.vectors[0]!, input.topK, input.documentId)
            if (!sameEmbeddingSpace(embeddingSpace((await this.models.defaultModel(scope)) ?? undefined), space))
                throw new EmbeddingConflictError('默认向量模型已变化，请重新提交查询。')
            return knowledgeSearchResultSchema.parse({ query: input.query, model: space, hits })
        } catch (error) {
            throw embeddingHttpError(error)
        }
    }
    /**
     * Starts at most one bounded job while PostgreSQL coordinates all processes.
     * @returns Nothing; errors leave a durable lease recoverable.
     */
    wake(): void {
        if (this.closing || this.active || !this.store?.vectorAvailable) return
        this.active = this.processOne()
            .catch(() => undefined)
            .finally(() => {
                this.active = undefined
            })
    }
    /**
     * Processes missing batches without retaining the whole document's vector array in memory.
     * @returns After a job completes, fails safely, or no work is available.
     */
    private async processOne(): Promise<void> {
        const job = await this.store!.claim(this.leaseMs)
        if (!job) return
        if (this.closing) {
            await this.store!.release(job)
            return
        }
        const controller = new AbortController()
        this.abort = controller
        let lost = false
        let renewing = false
        /**
         * Renews only this attempt and stops publication when ownership is uncertain.
         * @returns Nothing after scheduling one bounded renewal.
         */
        const renew = (): void => {
            if (renewing || lost) return
            renewing = true
            void this.store!.heartbeat(job, this.leaseMs)
                .then(owned => {
                    if (!owned) {
                        lost = true
                        controller.abort()
                    }
                })
                .catch(() => {
                    lost = true
                    controller.abort()
                })
                .finally(() => {
                    renewing = false
                })
        }
        const heartbeat = setInterval(renew, this.heartbeatMs)
        heartbeat.unref()
        try {
            await this.processBatches(job, controller.signal, () => lost)
        } catch (error) {
            if (!this.closing && !lost) await this.store!.fail(job, embeddingHttpError(error).message)
        } finally {
            clearInterval(heartbeat)
            if (this.closing) await this.store!.release(job).catch(() => undefined)
            this.abort = undefined
        }
    }
    /**
     * Calls the provider only for uncheckpointed chunks in the still-current verified default space.
     * @param job - Claimed persistent generation and source identity.
     * @param signal - Shutdown or lost-lease cancellation.
     * @param lost - Current ownership predicate.
     * @returns After the complete generation is ready or publication loses its lease.
     */
    private async processBatches(job: VectorLease, signal: AbortSignal, lost: () => boolean): Promise<void> {
        const space = job.index.model
        if (!space) throw new EmbeddingConflictError('索引缺少有效向量模型，请重新建立索引。')
        while (!this.closing && !lost()) {
            const current = embeddingSpace((await this.models.defaultModel(job.scope)) ?? undefined)
            if (!sameEmbeddingSpace(current, space)) throw new EmbeddingConflictError('默认向量模型已变化，请重新建立索引。')
            const pending = await this.store!.pendingChunks(job)
            if (!pending.length) throw new EmbeddingConflictError('索引检查点不完整，请重新建立索引。')
            const texts = takeEmbeddingBatch(
                { model: space.model },
                pending.map(chunk => chunk.content)
            )
            const chunks = pending.slice(0, texts.length)
            const result = await this.models.embed(job.scope, space, texts, signal)
            if (this.closing || lost()) return
            const saved = await this.store!.saveBatch(job, chunks, result.vectors)
            if (!saved || saved.status === 'ready') return
        }
    }
    /**
     * Releases vector work before ChatService's later application-shutdown hook closes the shared pool.
     * @returns The same bounded shutdown promise for repeated lifecycle calls.
     */
    onModuleDestroy(): Promise<void> {
        return this.close()
    }
    /**
     * Idempotently cancels the current provider request and drains its persistent lease release.
     * @returns After all vector-owned execution resources have stopped.
     */
    close(): Promise<void> {
        this.closingPromise ??= this.shutdown()
        return this.closingPromise
    }
    /**
     * Stops polling and aborts the bounded current request before waiting for its worker.
     * @returns After lease cleanup completes or remains durable for expiry recovery.
     */
    private async shutdown(): Promise<void> {
        this.closing = true
        if (this.timer) clearInterval(this.timer)
        this.abort?.abort()
        await this.active
    }
}
