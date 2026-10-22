import { createHash, randomUUID } from 'node:crypto'
import {
    KNOWLEDGE_DEFAULT_CHUNK_SIZE,
    KNOWLEDGE_DEFAULT_OVERLAP,
    KNOWLEDGE_MAX_FILE_SIZE,
    knowledgeFormatSchema,
    knowledgeProcessingResultSchema,
    type KnowledgeDocument,
    type KnowledgePageQuery,
    type KnowledgeProcessingResult,
    type KnowledgeStatus,
    type KnowledgeUpload,
} from '@ai-harness/contracts'
import { KnowledgeProcessingError, processKnowledgeDocument, type KnowledgeObjectStore } from '@ai-harness/chat-runtime/knowledge'
import { KnowledgeConflictError, type ChatScope, type KnowledgeLease, type KnowledgeStore, type ProjectFolderStore } from '@ai-harness/db'
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'

export type KnowledgeProcessor = typeof processKnowledgeDocument
export interface KnowledgeWorkerOptions {
    pollIntervalMs?: number
    leaseMs?: number
    heartbeatMs?: number
    autoStart?: boolean
}

/**
 * Computes an immutable fingerprint without exposing source bytes or account identifiers.
 * @param value - Bytes or normalized internal identity parameters.
 * @returns A lowercase SHA-256 digest.
 */
function digest(value: string | Uint8Array): string {
    return createHash('sha256').update(value).digest('hex')
}

/**
 * Selects a safe public parser failure while suppressing database and storage internals.
 * @param error - Failure raised by isolated document processing.
 * @returns A bounded safe explanation users can act on.
 */
function processingFailure(error: unknown): string {
    if (error instanceof KnowledgeProcessingError) return error.message.slice(0, 500)
    return '资料处理失败，原文件已保存。请稍后重试；若仍失败，请检查文件是否损坏或使用支持的文本格式。'
}

/** Coordinates authorized durable knowledge records, private originals, and leased background processing. */
export class KnowledgeService {
    private timer?: ReturnType<typeof setInterval>
    private active?: Promise<void>
    private currentJob?: KnowledgeLease
    private activeAbort?: AbortController
    private closing = false
    private closePromise?: Promise<void>
    private readonly leaseMs: number
    private readonly heartbeatMs: number

    /**
     * Retains shared persistence and starts a bounded durable queue poller when configured.
     * @param store - Application-owned PostgreSQL knowledge operations.
     * @param objects - Process-owned private object client, or absent for unconfigured knowledge.
     * @param processor - Bounded isolated parser, explicitly replaceable by tests.
     * @param options - Explicit isolated test timing controls.
     * @param folders - Persistent private project authorization for folder-scoped operations.
     */
    constructor(
        private readonly store: KnowledgeStore | undefined,
        private readonly objects: KnowledgeObjectStore | undefined,
        private readonly processor: KnowledgeProcessor = processKnowledgeDocument,
        options: KnowledgeWorkerOptions = {},
        private readonly folders?: ProjectFolderStore
    ) {
        this.leaseMs = options.leaseMs ?? 60_000
        this.heartbeatMs = options.heartbeatMs ?? 10_000
        if (store && objects && options.autoStart !== false) {
            this.timer = setInterval(() => this.wake(), options.pollIntervalMs ?? 1000)
            this.timer.unref()
            this.wake()
        }
    }

    /**
     * Exposes actual feature configuration and supported limits without secrets.
     * @returns Public knowledge status independent of LLM configuration.
     */
    status(): KnowledgeStatus {
        return {
            configured: Boolean(this.store && this.objects),
            supportedFormats: ['txt', 'md', 'pdf', 'docx'],
            maxFileSize: KNOWLEDGE_MAX_FILE_SIZE,
            defaultChunkSize: KNOWLEDGE_DEFAULT_CHUNK_SIZE,
            defaultOverlap: KNOWLEDGE_DEFAULT_OVERLAP,
        }
    }

    /**
     * Rejects writes before reading upload bodies when durable dependencies are unconfigured.
     * @returns Nothing when the PostgreSQL store and private object client are configured.
     * @throws ServiceUnavailableException when the feature is not configured.
     */
    assertConfigured(): void {
        if (!this.store || !this.objects || this.closing)
            throw new ServiceUnavailableException('资料库服务尚未连接，请配置持久对象存储后重试。')
    }

    /**
     * Translates persistence failures to safe public errors without a volatile fallback.
     * @param action - Scoped operation against the configured persistent store.
     * @returns The operation result after its actual storage operation succeeds.
     * @throws ConflictException for action conflicts or ServiceUnavailableException for dependency failures.
     */
    private async persist<T>(action: (store: KnowledgeStore) => Promise<T>): Promise<T> {
        this.assertConfigured()
        try {
            return await action(this.store!)
        } catch (error) {
            if (error instanceof KnowledgeConflictError) throw new ConflictException(error.message)
            throw new ServiceUnavailableException('资料库暂时无法保存或读取，请稍后重试。')
        }
    }

    /**
     * Revalidates a requested project using its trusted owner and workspace before knowledge operations.
     * @param scope - Authenticated account and workspace.
     * @param projectFolderId - Optional private folder identity.
     * @returns Nothing after current authorization succeeds.
     * @throws NotFoundException for missing projects, or ServiceUnavailableException for failed persistence.
     */
    private async authorizeProject(scope: ChatScope, projectFolderId?: string): Promise<void> {
        if (!projectFolderId) return
        if (!this.folders) throw new ServiceUnavailableException('项目服务暂时不可用。')
        try {
            if (!(await this.folders.get(scope, projectFolderId))) throw new NotFoundException('未找到该项目。')
        } catch (error) {
            if (error instanceof NotFoundException) throw error
            throw new ServiceUnavailableException('项目服务暂时无法读取。')
        }
    }

    /**
     * Lists only real documents within the authenticated scope.
     * @param scope - Trusted account and workspace.
     * @param query - Validated page and literal filename search.
     * @returns A deterministic public document page.
     * @throws ServiceUnavailableException when durable dependencies fail.
     */
    async list(scope: ChatScope, query: KnowledgePageQuery) {
        await this.authorizeProject(scope, query.projectFolderId)
        return this.persist(store => store.list(scope, query))
    }

    /**
     * Reads one authorized public document without internal source fields.
     * @param scope - Trusted account and workspace.
     * @param id - Validated document UUID.
     * @param projectFolderId - Optional private project boundary.
     * @returns Only the public metadata for the owned document.
     * @throws NotFoundException for absent or foreign identifiers.
     * @throws ServiceUnavailableException when durable dependencies fail.
     */
    async get(scope: ChatScope, id: string, projectFolderId?: string): Promise<KnowledgeDocument> {
        await this.authorizeProject(scope, projectFolderId)
        const record = await this.persist(store => store.get(scope, id, projectFolderId))
        if (!record) throw new NotFoundException('未找到该资料。')
        return record.document
    }

    /**
     * Returns one page from the complete ready batch belonging to an authorized source.
     * @param scope - Trusted account and workspace.
     * @param id - Validated document UUID.
     * @param query - Validated one-based pagination.
     * @returns Public chunk bodies and actual complete-batch count.
     * @throws NotFoundException for absent or foreign identifiers.
     * @throws ServiceUnavailableException when durable dependencies fail.
     */
    async chunks(scope: ChatScope, id: string, query: KnowledgePageQuery) {
        await this.authorizeProject(scope, query.projectFolderId)
        const page = await this.persist(store => store.chunks(scope, id, query.page, query.pageSize, query.projectFolderId))
        if (!page) throw new NotFoundException('未找到该资料。')
        return page
    }

    /**
     * Saves immutable original bytes before atomically accepting one queued upload action.
     * @param scope - Trusted account and workspace.
     * @param input - Validated action UUID and character-based chunk settings.
     * @param file - Size-limited multipart file held only during the request.
     * @returns Current matching replay or newly persisted queued metadata.
     * @throws BadRequestException for invalid filename, format, or bytes.
     * @throws ConflictException for mismatched actions and ServiceUnavailableException for durable failures.
     */
    async upload(scope: ChatScope, input: KnowledgeUpload, file: { originalname: string; buffer: Uint8Array }): Promise<KnowledgeDocument> {
        this.assertConfigured()
        await this.authorizeProject(scope, input.projectFolderId)
        const fileName = file.originalname.normalize('NFC').trim()
        if (
            !fileName ||
            fileName.length > 180 ||
            [...fileName].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
            /[\\/]/.test(fileName)
        )
            throw new BadRequestException('请使用不超过 180 字符且不含路径或控制字符的文件名。')
        const format = knowledgeFormatSchema.safeParse(fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase())
        if (!format.success) throw new BadRequestException('暂时仅支持 TXT、MD、PDF 和 DOCX 文件。')
        if (!file.buffer.byteLength || file.buffer.byteLength > KNOWLEDGE_MAX_FILE_SIZE)
            throw new BadRequestException('文件不能为空，且不能超过 10 MiB。')
        const sha256 = digest(file.buffer)
        const fingerprint = digest(
            JSON.stringify({
                fileName,
                format: format.data,
                size: file.buffer.byteLength,
                chunkSize: input.chunkSize,
                overlap: input.overlap,
                ...(input.projectFolderId ? { projectFolderId: input.projectFolderId } : {}),
                sha256,
            })
        )
        const now = new Date().toISOString()
        const document: KnowledgeDocument = {
            id: input.requestId,
            ...(input.projectFolderId ? { projectFolderId: input.projectFolderId } : {}),
            fileName,
            format: format.data,
            size: file.buffer.byteLength,
            status: 'queued',
            chunkSize: input.chunkSize,
            overlap: input.overlap,
            characterCount: 0,
            chunkCount: 0,
            attempt: 0,
            createdAt: now,
            updatedAt: now,
        }
        const objectKey = `knowledge/${digest(JSON.stringify([scope.workspaceId, scope.userId]))}/${document.id}/${fingerprint}`
        const contentTypes = {
            txt: 'text/plain',
            md: 'text/markdown',
            pdf: 'application/pdf',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }
        const record = await this.persist(store =>
            store.create(scope, { document, objectKey, sha256, fingerprint }, () =>
                this.objects!.put(objectKey, file.buffer, contentTypes[format.data])
            )
        )
        this.wake()
        return record.document
    }

    /**
     * Requeues a failed authorized original without copying source bytes or changing its parameters.
     * @param scope - Trusted account and workspace.
     * @param id - Validated document UUID.
     * @param requestId - Persistent retry action UUID.
     * @returns Current document for the same action or newly queued metadata.
     * @throws NotFoundException for absent or foreign records.
     * @throws ConflictException for mismatched actions or incompatible state.
     * @throws ServiceUnavailableException when persistence fails.
     */
    async retry(scope: ChatScope, id: string, requestId: string): Promise<KnowledgeDocument> {
        const document = await this.persist(store => store.retry(scope, id, requestId))
        if (!document) throw new NotFoundException('未找到该资料。')
        this.wake()
        return document
    }

    /**
     * Reads authorized immutable source bytes and verifies their original checksum before download.
     * @param scope - Trusted account and workspace.
     * @param id - Validated document UUID.
     * @param projectFolderId - Optional private project boundary.
     * @returns Public metadata and the exact original bytes, without an object URL.
     * @throws NotFoundException for absent or foreign records.
     * @throws ServiceUnavailableException for unavailable or corrupt originals.
     */
    async file(scope: ChatScope, id: string, projectFolderId?: string): Promise<{ document: KnowledgeDocument; file: Uint8Array }> {
        await this.authorizeProject(scope, projectFolderId)
        const record = await this.persist(store => store.get(scope, id, projectFolderId))
        if (!record) throw new NotFoundException('未找到该资料。')
        try {
            const file = await this.objects!.get(record.objectKey)
            if (file.byteLength !== record.document.size || digest(file) !== record.sha256) throw new Error('Invalid source checksum.')
            return { document: record.document, file }
        } catch {
            throw new ServiceUnavailableException('原文件暂时无法读取，请稍后重试。')
        }
    }

    /**
     * Starts at most one bounded processor while durable leases coordinate all API instances.
     * @returns Nothing; all background failures remain recoverable in persistent job state.
     */
    wake(): void {
        if (this.closing || this.active || !this.store || !this.objects) return
        this.active = this.processOne()
            .catch(() => undefined)
            .finally(() => {
                this.active = undefined
            })
    }

    /**
     * Processes a single durable job with lease renewal and atomic complete-batch visibility.
     * @returns After one job finishes, fails safely, or no work is available.
     * @throws Error for dependency failures that leave the durable lease recoverable.
     */
    private async processOne(): Promise<void> {
        const job = await this.store!.claim(this.leaseMs)
        if (!job) return
        if (this.closing) {
            await this.store!.release(job)
            return
        }
        this.currentJob = job
        const abort = new AbortController()
        this.activeAbort = abort
        let lostLease = false
        let renewing = false
        /**
         * Extends this worker's ownership without overlapping renewal requests.
         * @returns Nothing; uncertainty stops this worker from committing a stale result.
         */
        const renew = (): void => {
            if (renewing || lostLease) return
            renewing = true
            void this.store!.heartbeat(job, this.leaseMs)
                .then(owned => {
                    if (!owned) lostLease = true
                })
                .catch(() => {
                    lostLease = true
                })
                .finally(() => {
                    renewing = false
                })
        }
        const heartbeat = setInterval(renew, this.heartbeatMs)
        heartbeat.unref()
        try {
            const file = await this.objects!.get(job.record.objectKey)
            if (file.byteLength !== job.record.document.size || digest(file) !== job.record.sha256)
                throw new Error('Invalid source checksum.')
            const document = job.record.document
            const parsed: KnowledgeProcessingResult = knowledgeProcessingResultSchema.parse(
                await this.processor(
                    { file, format: document.format, chunkSize: document.chunkSize, overlap: document.overlap },
                    abort.signal
                )
            )
            if (!lostLease && !this.closing)
                await this.store!.complete(job, {
                    ...parsed,
                    chunks: parsed.chunks.map(chunk => ({ ...chunk, id: randomUUID(), documentId: document.id })),
                })
        } catch (error) {
            if (!lostLease && !this.closing) await this.store!.fail(job, processingFailure(error))
        } finally {
            clearInterval(heartbeat)
            if (this.closing) await this.store!.release(job).catch(() => undefined)
            this.currentJob = undefined
            this.activeAbort = undefined
        }
    }

    /**
     * Stops accepting work, drains the bounded processor, and closes the private object client.
     * @returns After active ownership is released and process resources are closed.
     */
    close(): Promise<void> {
        this.closePromise ??= this.shutdownResources()
        return this.closePromise
    }

    /**
     * Drains background processing before ChatService's application-shutdown hook closes the shared pool.
     * @returns The idempotent knowledge shutdown promise.
     */
    onModuleDestroy(): Promise<void> {
        return this.close()
    }

    /**
     * Aborts current isolated processing and returns its lease before closing source connections.
     * @returns After all knowledge-owned execution resources have been released.
     */
    private async shutdownResources(): Promise<void> {
        this.closing = true
        if (this.timer) clearInterval(this.timer)
        this.activeAbort?.abort()
        await this.active
        if (this.currentJob) await this.store?.release(this.currentJob).catch(() => undefined)
        await this.objects?.close()
    }
}
