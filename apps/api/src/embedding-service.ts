import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import {
    createEmbeddingModelSchema,
    updateEmbeddingModelSchema,
    type CreateEmbeddingModel,
    type UpdateEmbeddingModel,
    type EmbeddingModel,
    type EmbeddingSpace,
} from '@ai-harness/contracts'
import { createEmbeddings, EmbeddingError, validateEmbeddingBaseUrl } from '@ai-harness/chat-runtime/embeddings'
import {
    EmbeddingConflictError,
    EmbeddingNotFoundError,
    VectorUnavailableError,
    sameEmbeddingSpace,
    embeddingSpace,
    type EmbeddingStore,
    type ChatScope,
    type StoredEmbeddingModel,
} from '@ai-harness/db'
import { BadRequestException, ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { AccountService } from './account-service.js'
import type { ApiConfig } from './config.js'

export type EmbeddingGenerator = typeof createEmbeddings

/**
 * Converts only controlled embedding failures into safe HTTP feedback.
 * @param error - Internal persistence, validation, or provider failure.
 * @returns A public exception without raw provider responses or credentials.
 */
export function embeddingHttpError(error: unknown): HttpException {
    if (error instanceof HttpException) return error
    if (error instanceof EmbeddingConflictError) return new ConflictException(error.message)
    if (error instanceof EmbeddingNotFoundError) return new NotFoundException(error.message)
    if (error instanceof VectorUnavailableError) return new ServiceUnavailableException(error.message)
    if (error instanceof EmbeddingError) {
        const status = { input: 400, authentication: 400, rate_limit: 429, timeout: 504, cancelled: 499, connection: 503, protocol: 502 }[
            error.kind
        ]
        return new HttpException(error.message, status)
    }
    return new ServiceUnavailableException('向量服务暂时不可用，请稍后重试。')
}

/**
 * Owns independent encrypted embedding connections and immutable provider verification.
 */
export class EmbeddingService {
    private readonly key: Buffer
    /**
     * Retains private model persistence, account authority, and the bounded core embedding adapter.
     * @param store - Persistent embedding operations, absent only in explicitly injected legacy tests.
     * @param config - Stable server encryption and network configuration.
     * @param accounts - Existing authenticated account coordinator.
     * @param generate - Actual adapter or an explicitly injected protocol test dependency.
     */
    constructor(
        private readonly store: EmbeddingStore | undefined,
        private readonly config: ApiConfig,
        private readonly accounts: AccountService,
        private readonly generate: EmbeddingGenerator = createEmbeddings
    ) {
        this.key = Buffer.from(config.accountEncryptionKey, 'hex')
    }
    /**
     * Requires persistent connection storage without a browser or process-memory fallback.
     * @returns The shared durable model store.
     * @throws ServiceUnavailableException when this responsibility is unconfigured.
     */
    private persistence(): EmbeddingStore {
        if (!this.store) throw new ServiceUnavailableException('向量模型存储尚未连接。')
        return this.store
    }
    /**
     * Runs a scoped model operation with safe error classification.
     * @param action - Private operation after account authorization.
     * @returns The actual committed operation result.
     * @throws HttpException with safe public feedback.
     */
    private async safe<T>(action: () => Promise<T>): Promise<T> {
        try {
            return await action()
        } catch (error) {
            throw embeddingHttpError(error)
        }
    }
    /**
     * Binds new ciphertext to embedding purpose, account, workspace, and connection identity.
     * @param scope - Trusted account and workspace.
     * @param id - Stable model UUID.
     * @returns Authenticated associated-data bytes distinct from legacy chat encryption.
     */
    private aad(scope: ChatScope, id: string): Buffer {
        return Buffer.from(JSON.stringify(['embedding', scope.workspaceId, scope.userId, id]))
    }
    /**
     * Encrypts a write-only key with a fresh nonce and embedding-specific authentication.
     * @param scope - Trusted ownership.
     * @param id - Stable model UUID.
     * @param value - Plaintext key retained only inside this request.
     * @returns Versioned authenticated ciphertext.
     */
    private encrypt(scope: ChatScope, id: string, value: string): string {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', this.key, iv)
        cipher.setAAD(this.aad(scope, id))
        const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
        return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
    }
    /**
     * Decrypts only a verified owner's embedding-purpose credential.
     * @param scope - Trusted ownership.
     * @param record - Private persistent record.
     * @returns Plaintext only for the same server-side operation.
     * @throws ServiceUnavailableException for missing or incompatible encryption material.
     */
    private decrypt(scope: ChatScope, record: StoredEmbeddingModel): string {
        try {
            const [version, iv, tag, data, extra] = record.encryptedApiKey.split('.')
            if (version !== 'v1' || !iv || !tag || !data || extra !== undefined) throw new Error('Invalid ciphertext.')
            const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'))
            cipher.setAAD(this.aad(scope, record.model.id))
            cipher.setAuthTag(Buffer.from(tag, 'base64url'))
            return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8')
        } catch {
            throw new ServiceUnavailableException('向量模型凭据不可用，请重新保存 API key。')
        }
    }
    /**
     * Validates an embedding API root without making a provider request.
     * @param value - User-supplied base address.
     * @returns Canonical root accepted by the shared network policy.
     * @throws BadRequestException for unsafe targets or full nonroot endpoints.
     */
    private baseUrl(value: string): string {
        try {
            return validateEmbeddingBaseUrl(value, { allowedLocalOrigins: this.config.allowedLocalOrigins })
        } catch {
            throw new BadRequestException(
                '请填写安全的 HTTPS API 基础地址（通常以 /v1 结尾），不要填写完整 embeddings 或 chat 接口；本地服务需管理员允许。'
            )
        }
    }
    /**
     * Lists public independent embedding metadata without decrypting credentials.
     * @param scope - Authenticated account and workspace.
     * @returns Safe models for this owner only.
     */
    async list(scope: ChatScope): Promise<EmbeddingModel[]> {
        return this.safe(async () => {
            await this.accounts.user(scope)
            return (await this.persistence().listModels(scope)).map(record => record.model)
        })
    }
    /**
     * Reads safe public metadata for one owned connection.
     * @param scope - Authenticated ownership.
     * @param id - Validated connection UUID.
     * @returns Safe public connection fields.
     * @throws NotFoundException for both foreign and nonexistent identifiers.
     */
    async get(scope: ChatScope, id: string): Promise<EmbeddingModel> {
        return this.safe(async () => {
            await this.accounts.user(scope)
            const record = await this.persistence().getModel(scope, id)
            if (!record) throw new EmbeddingNotFoundError()
            return record.model
        })
    }
    /**
     * Reads the unique user-selected default without selecting any chat or arbitrary replacement.
     * @param scope - Trusted ownership.
     * @returns Public current default or null.
     */
    async defaultModel(scope: ChatScope): Promise<EmbeddingModel | null> {
        return this.safe(async () => {
            await this.accounts.user(scope)
            return (await this.persistence().getModel(scope))?.model ?? null
        })
    }
    /**
     * Creates one encrypted connection with durable action identity and no provider call.
     * @param scope - Authenticated ownership.
     * @param input - Strict creation fields and stable action UUID.
     * @returns Current matching replay or newly committed safe model.
     */
    async create(scope: ChatScope, input: CreateEmbeddingModel): Promise<EmbeddingModel> {
        const parsed = createEmbeddingModelSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('请填写有效的向量模型名称、API 基础地址、模型标识和 API key。')
        return this.safe(async () => {
            await this.accounts.user(scope)
            const data = { ...parsed.data, baseUrl: this.baseUrl(parsed.data.baseUrl) }
            const fingerprint = createHmac('sha256', this.key)
                .update(
                    JSON.stringify(['embedding-create', scope.workspaceId, scope.userId, data.name, data.baseUrl, data.model, data.apiKey])
                )
                .digest('hex')
            const now = new Date().toISOString()
            const model: EmbeddingModel = {
                id: data.requestId,
                name: data.name,
                baseUrl: data.baseUrl,
                model: data.model,
                revision: 1,
                hasApiKey: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
            }
            return this.persistence().createModel(
                scope,
                { model, encryptedApiKey: this.encrypt(scope, model.id, data.apiKey) },
                fingerprint
            )
        })
    }
    /**
     * Updates a confirmed revision without changing the vector space for display-only edits.
     * @param scope - Authenticated ownership.
     * @param id - Validated model UUID.
     * @param input - Strict replacement fields; blank key retains existing ciphertext.
     * @returns The authoritative safe metadata with verification cleared on route or key changes.
     */
    async update(scope: ChatScope, id: string, input: UpdateEmbeddingModel): Promise<EmbeddingModel> {
        const parsed = updateEmbeddingModelSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('向量模型配置或版本无效，请重新载入后提交。')
        return this.safe(async () => {
            await this.accounts.user(scope)
            const previous = await this.persistence().getModel(scope, id)
            if (!previous) throw new EmbeddingNotFoundError()
            const data = parsed.data
            let changedKey = false
            if (data.apiKey) {
                try {
                    changedKey = data.apiKey !== this.decrypt(scope, previous)
                } catch {
                    // An explicit replacement repairs corrupt credentials; a blank field still retains the original ciphertext.
                    changedKey = true
                }
            }
            return this.persistence().updateModel(scope, id, data.revision, {
                model: { ...previous.model, name: data.name, baseUrl: this.baseUrl(data.baseUrl), model: data.model },
                encryptedApiKey: changedKey ? this.encrypt(scope, id, data.apiKey!) : previous.encryptedApiKey,
            })
        })
    }
    /**
     * Selects one independent default without any provider request.
     * @param scope - Authenticated ownership.
     * @param id - Owned model UUID.
     * @returns Safe selected model metadata.
     */
    async setDefault(scope: ChatScope, id: string): Promise<EmbeddingModel> {
        return this.safe(async () => {
            await this.accounts.user(scope)
            return this.persistence().setDefaultModel(scope, id)
        })
    }
    /**
     * Deletes a connection while retaining its creation tombstone and old source records.
     * @param scope - Authenticated ownership.
     * @param id - Owned connection UUID.
     * @returns Nothing after actual deletion.
     */
    async delete(scope: ChatScope, id: string): Promise<void> {
        return this.safe(async () => {
            await this.accounts.user(scope)
            if (!(await this.persistence().deleteModel(scope, id))) throw new EmbeddingNotFoundError()
        })
    }
    /**
     * Explicitly probes two fixed nonsecret texts outside the database transaction, then CAS-verifies the revision.
     * @param scope - Authenticated ownership.
     * @param id - Saved connection UUID.
     * @param signal - Browser disconnect or explicit cancellation.
     * @returns Actual public verification metadata and safe success feedback.
     */
    async test(scope: ChatScope, id: string, signal?: AbortSignal): Promise<{ success: true; message: string; model: EmbeddingModel }> {
        return this.safe(async () => {
            await this.accounts.user(scope)
            const record = await this.persistence().getModel(scope, id)
            if (!record) throw new EmbeddingNotFoundError()
            const result = await this.generate(
                { baseUrl: record.model.baseUrl, model: record.model.model, apiKey: this.decrypt(scope, record) },
                ['向量连接测试', 'Embedding connection verification'],
                { signal, allowedLocalOrigins: this.config.allowedLocalOrigins }
            )
            const model = await this.persistence().verifyModel(scope, id, record.model.revision, result.dimensions, result.model)
            return { success: true, message: `连接成功，实际维度为 ${result.dimensions}。`, model }
        })
    }
    /**
     * Embeds authorized source or query texts in exactly one verified immutable vector space.
     * @param scope - Trusted ownership.
     * @param space - Frozen nonsecret verified identity.
     * @param inputs - Bounded original source texts, never silently truncated.
     * @param signal - Worker shutdown or query disconnect cancellation.
     * @returns Actual vectors only while the same current configuration remains unchanged.
     * @throws EmbeddingConflictError when configuration or provider identity drifted.
     */
    async embed(scope: ChatScope, space: EmbeddingSpace, inputs: readonly string[], signal?: AbortSignal) {
        const record = await this.persistence().getModel(scope, space.id)
        if (!record || !sameEmbeddingSpace(embeddingSpace(record.model), space))
            throw new EmbeddingConflictError('向量连接已变化或删除，请重新验证并建立索引。')
        const result = await this.generate(
            { baseUrl: record.model.baseUrl, model: record.model.model, apiKey: this.decrypt(scope, record) },
            inputs,
            { signal, allowedLocalOrigins: this.config.allowedLocalOrigins }
        )
        if (result.model !== space.providerModel || result.dimensions !== space.dimensions)
            throw new EmbeddingConflictError('向量服务返回的模型身份或维度已变化，请重新测试连接并重建索引。')
        const current = await this.persistence().getModel(scope, space.id)
        if (!current || !sameEmbeddingSpace(embeddingSpace(current.model), space))
            throw new EmbeddingConflictError('向量连接在请求期间已变化，请重新建立索引或提交查询。')
        return result
    }
}
