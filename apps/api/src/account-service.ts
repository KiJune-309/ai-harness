import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import {
    createAccountModelSchema,
    loginAccountSchema,
    registerAccountSchema,
    updateAccountModelSchema,
    updateEmailSchema,
    updatePasswordSchema,
    updateUsernameSchema,
    type AccountModel,
    type AccountUser,
    type CreateAccountModel,
    type LoginAccount,
    type RegisterAccount,
    type UpdateAccountModel,
    type UpdateEmail,
    type UpdatePassword,
    type UpdateUsername,
} from '@ai-harness/contracts'
import { validateModelBaseUrl } from '@ai-harness/chat-runtime'
import {
    AccountConflictError,
    type AccountStore,
    type ChatScope,
    type StoredAccount,
    type StoredAccountModel,
    type WorkspaceStore,
} from '@ai-harness/db'
import {
    BadRequestException,
    ConflictException,
    HttpException,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common'
import type { ApiConfig } from './config.js'

export interface AccountModelConnection {
    apiKey: string
    baseUrl: string
    model: string
}
export type AccountModelTester = (connection: AccountModelConnection, signal?: AbortSignal) => Promise<void>
export interface AccountLoginResult {
    user: AccountUser
    session: string
}
const sessionLifetime = 7 * 24 * 60 * 60 * 1000
const rateWindow = 15 * 60 * 1000
let activeHashes = 0
const dummyHash = `scrypt$131072$8$1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(32).toString('base64url')}`

/**
 * Derives a bounded-memory salted password key without blocking the event loop.
 * @param password - Unmodified password including intentional whitespace.
 * @param salt - Sixteen random salt bytes.
 * @returns Thirty-two derived key bytes.
 * @throws HttpException when four expensive hashes are already active.
 * @throws Error when the cryptographic primitive fails.
 */
async function passwordKey(password: string, salt: Buffer): Promise<Buffer> {
    if (activeHashes >= 4) throw new HttpException('登录请求较多，请稍后重试。', 429)
    activeHashes += 1
    try {
        return await new Promise<Buffer>((resolve, reject) =>
            scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) =>
                error ? reject(error) : resolve(key)
            )
        )
    } finally {
        activeHashes -= 1
    }
}
/**
 * Hashes a password with an independent random salt and explicit scrypt parameters.
 * @param password - Validated untrimmed password.
 * @returns A versioned private password verifier.
 */
export async function hashAccountPassword(password: string): Promise<string> {
    const salt = randomBytes(16)
    const key = await passwordKey(password, salt)
    return `scrypt$131072$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`
}
/**
 * Performs equal-cost password verification for present and missing accounts.
 * @param password - Candidate untrimmed password.
 * @param hash - Stored verifier or the valid dummy verifier for an absent account.
 * @returns Whether the derived key matches.
 */
async function verifiesPassword(password: string, hash: string): Promise<boolean> {
    const parts = hash.split('$')
    const valid = parts.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$131072$8$1'
    const salt = valid ? Buffer.from(parts[4]!, 'base64url') : Buffer.alloc(16)
    const expected = valid ? Buffer.from(parts[5]!, 'base64url') : Buffer.alloc(32)
    const actual = await passwordKey(password, salt.length === 16 ? salt : Buffer.alloc(16))
    return valid && salt.length === 16 && expected.length === actual.length && timingSafeEqual(expected, actual)
}
/**
 * Converts an opaque session secret into a non-reusable database lookup identity.
 * @param session - Browser cookie secret.
 * @returns Lowercase SHA256 digest.
 */
export function hashAccountSession(session: string): string {
    return createHash('sha256').update(session).digest('hex')
}

/**
 * Conceals authentication bucket identities while retaining a stable deployment scope.
 * @param key - Internal category and normalized source or email identity.
 * @param workspaceId - Deployment workspace owning the bucket.
 * @param encryptionKey - Stable server-only account key.
 * @returns Non-reversible HMAC-SHA256 bucket identity for private persistence.
 */
export function hashAccountRateLimit(key: string, workspaceId: string, encryptionKey: Buffer): string {
    return createHmac('sha256', encryptionKey)
        .update(JSON.stringify([workspaceId, key]))
        .digest('hex')
}

/** Coordinates real account sessions and user-owned encrypted model configurations. */
export class AccountService {
    private readonly encryptionKey: Buffer
    /**
     * Retains private persistence, deployment secrets and the Cordis connection tester.
     * @param store - Account persistence from the shared application store.
     * @param config - Server-only configuration.
     * @param testConnection - Actual bounded OpenAI-compatible Cordis test callback.
     * @throws Error when the stable private encryption key is missing or malformed.
     */
    constructor(
        private readonly store: AccountStore | undefined,
        private readonly config: ApiConfig,
        private readonly testConnection?: AccountModelTester,
        private readonly workspaces?: WorkspaceStore
    ) {
        if (!config.accountEncryptionKey || !/^[0-9a-f]{64}$/i.test(config.accountEncryptionKey))
            throw new Error('Set a stable ACCOUNT_ENCRYPTION_KEY before initializing account storage.')
        this.encryptionKey = Buffer.from(config.accountEncryptionKey, 'hex')
    }
    /**
     * Requires initialized account persistence.
     * @returns The private account store.
     * @throws ServiceUnavailableException when the provided store lacks account support.
     */
    private persistence(): AccountStore {
        if (!this.store) throw new ServiceUnavailableException('账户存储暂时不可用。')
        return this.store
    }
    /**
     * Applies a shared persistent fixed-window authentication rate limit.
     * @param key - Non-secret source or normalized account identity.
     * @param maximum - Permitted requests within fifteen minutes.
     * @returns Nothing after recording the permitted attempt.
     * @throws HttpException when the bucket is exhausted.
     * @throws ServiceUnavailableException when the shared limit cannot be verified.
     */
    private async limit(key: string, maximum: number): Promise<void> {
        let permitted: boolean
        try {
            permitted = await this.persistence().consumeRateLimit(
                hashAccountRateLimit(key, this.config.workspaceId, this.encryptionKey),
                maximum,
                rateWindow,
                Date.now()
            )
        } catch {
            throw new ServiceUnavailableException('账户服务暂时不可用，请稍后重试。')
        }
        if (!permitted) throw new HttpException('尝试次数过多，请稍后再试。', 429)
    }
    /**
     * Issues a new opaque seven-day session while guarding concurrent credential changes.
     * @param account - Current verified private account.
     * @returns Public account and secret for the private BFF response header.
     * @throws UnauthorizedException after a competing credential change.
     */
    private async issue(account: StoredAccount): Promise<AccountLoginResult> {
        const session = randomBytes(32).toString('base64url')
        const createdAt = new Date().toISOString()
        const saved = await this.persistence().saveSession({
            tokenHash: hashAccountSession(session),
            userId: account.user.id,
            credentialVersion: account.credentialVersion,
            createdAt,
            expiresAt: new Date(Date.parse(createdAt) + sessionLifetime).toISOString(),
        })
        if (!saved) throw new UnauthorizedException('账户凭据已更新，请重新登录。')
        return { user: account.user, session }
    }
    /**
     * Creates a globally unique account and its first server session.
     * @param input - Strict registration fields.
     * @param source - Trusted network source used only for bounded rate limiting.
     * @returns Public account plus a private session secret.
     * @throws BadRequestException for invalid fields.
     * @throws ConflictException when the normalized email is already registered.
     */
    async register(input: RegisterAccount, source = 'local'): Promise<AccountLoginResult> {
        await this.limit(`register:${source}`, 10)
        const parsed = registerAccountSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '注册信息不正确。')
        const now = new Date().toISOString()
        const account: StoredAccount = {
            user: { id: randomUUID(), username: parsed.data.username, email: parsed.data.email, createdAt: now, updatedAt: now },
            workspaceId: this.config.workspaceId,
            passwordHash: await hashAccountPassword(parsed.data.password),
            credentialVersion: 1,
        }
        try {
            await this.persistence().createUser(account)
        } catch (error) {
            if (error instanceof AccountConflictError) throw new ConflictException('该邮箱已注册，请登录或使用其他邮箱。')
            throw error
        }
        return this.issue(account)
    }
    /**
     * Verifies email/password uniformly and creates an independent session.
     * @param input - Strict normalized login fields.
     * @param source - Trusted request source for throttling.
     * @returns Public user and a private opaque session.
     * @throws UnauthorizedException for either an absent account or incorrect password.
     */
    async login(input: LoginAccount, source = 'local'): Promise<AccountLoginResult> {
        await this.limit(`login:${source}`, 60)
        const parsed = loginAccountSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('请输入有效邮箱和 12–128 字符密码。')
        const account = await this.persistence().getByEmail(parsed.data.email)
        let result: 'limited' | 'failed' | 'verified'
        try {
            result = await this.persistence().verifyLogin(
                hashAccountRateLimit(`failed:${parsed.data.email}`, this.config.workspaceId, this.encryptionKey),
                10,
                rateWindow,
                Date.now(),
                async () => {
                    const matches = await verifiesPassword(parsed.data.password, account?.passwordHash ?? dummyHash)
                    return Boolean(account && matches && account.workspaceId === this.config.workspaceId)
                }
            )
        } catch (error) {
            if (error instanceof HttpException) throw error
            throw new ServiceUnavailableException('账户服务暂时不可用，请稍后重试。')
        }
        if (result === 'limited') throw new HttpException('尝试次数过多，请稍后再试。', 429)
        if (result !== 'verified' || !account) throw new UnauthorizedException('邮箱或密码不正确。')
        return this.issue(account)
    }
    /**
     * Authenticates only a persisted, unexpired, current-version opaque session.
     * @param session - Untrusted opaque browser token.
     * @returns Trusted user and deployment workspace or undefined.
     */
    async authenticate(session: string): Promise<ChatScope | undefined> {
        if (!/^[A-Za-z0-9_-]{43}$/.test(session)) return undefined
        const account = await this.persistence().getSession(hashAccountSession(session), new Date().toISOString())
        return account?.workspaceId === this.config.workspaceId ? { userId: account.user.id, workspaceId: account.workspaceId } : undefined
    }
    /**
     * Revokes a current opaque session by its irreversible hash.
     * @param session - Secret supplied only by the trusted BFF header.
     * @returns After revocation succeeds.
     */
    async logout(session: string): Promise<void> {
        await this.persistence().revokeSession(hashAccountSession(session))
    }
    /**
     * Resolves public profile data while verifying both ownership dimensions.
     * @param scope - Authenticated scope.
     * @returns Current public account.
     * @throws UnauthorizedException for a missing account.
     */
    async user(scope: ChatScope): Promise<AccountUser> {
        return (await this.account(scope)).user
    }
    /**
     * Reads the current private account for a trusted scope.
     * @param scope - Authenticated user and workspace.
     * @returns Current private account.
     * @throws UnauthorizedException when either ownership field does not match.
     */
    private async account(scope: ChatScope): Promise<StoredAccount> {
        const account = await this.persistence().getById(scope.userId)
        if (
            !account ||
            account.workspaceId !== this.config.workspaceId ||
            (account.workspaceId !== scope.workspaceId && !(await this.workspaces?.access(scope)))
        )
            throw new UnauthorizedException('登录已失效，请重新登录。')
        return account
    }
    /**
     * Updates a display name without changing credentials or business ownership.
     * @param scope - Authenticated scope.
     * @param input - Candidate display name.
     * @returns Updated public user.
     */
    async updateUsername(scope: ChatScope, input: UpdateUsername): Promise<AccountUser> {
        const parsed = updateUsernameSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '用户名不正确。')
        await this.account(scope)
        const user = await this.persistence().updateUsername(scope.userId, parsed.data.username, new Date().toISOString())
        if (!user) throw new UnauthorizedException('登录已失效，请重新登录。')
        return user
    }
    /**
     * Verifies current credentials before an atomic sensitive account change.
     * @param scope - Authenticated scope.
     * @param currentPassword - Untrimmed candidate password.
     * @returns The private account whose credentials were verified.
     * @throws BadRequestException for an incorrect current password.
     */
    private async verifiedAccount(scope: ChatScope, currentPassword: string): Promise<StoredAccount> {
        const account = await this.account(scope)
        if (!(await verifiesPassword(currentPassword, account.passwordHash))) throw new BadRequestException('当前密码不正确。')
        return account
    }
    /**
     * Changes a unique login email and atomically revokes every session.
     * @param scope - Authenticated ownership context.
     * @param input - New email and current password.
     * @returns Updated public account after all sessions are revoked.
     * @throws ConflictException for an occupied email or competing credential change.
     */
    async updateEmail(scope: ChatScope, input: UpdateEmail): Promise<AccountUser> {
        const parsed = updateEmailSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '邮箱信息不正确。')
        const account = await this.verifiedAccount(scope, parsed.data.currentPassword)
        try {
            const result = await this.persistence().updateCredentials(scope.userId, account.passwordHash, {
                email: parsed.data.email,
                now: new Date().toISOString(),
            })
            if (!result) throw new ConflictException('账户已更新，请重新登录。')
            return result
        } catch (error) {
            if (error instanceof AccountConflictError) throw new ConflictException('该邮箱已被使用。')
            throw error
        }
    }
    /**
     * Changes a password verifier and atomically revokes all previous sessions.
     * @param scope - Authenticated ownership context.
     * @param input - Current and new untrimmed passwords.
     * @returns Updated public account after successful revocation.
     * @throws ConflictException after a competing credential update.
     */
    async updatePassword(scope: ChatScope, input: UpdatePassword): Promise<AccountUser> {
        const parsed = updatePasswordSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '密码信息不正确。')
        const account = await this.verifiedAccount(scope, parsed.data.currentPassword)
        const result = await this.persistence().updateCredentials(scope.userId, account.passwordHash, {
            passwordHash: await hashAccountPassword(parsed.data.newPassword),
            now: new Date().toISOString(),
        })
        if (!result) throw new ConflictException('账户已更新，请重新登录。')
        return result
    }
    /**
     * Binds encrypted model credentials to their user, workspace and stable configuration ID.
     * @param scope - Trusted ownership tuple.
     * @param id - Stable configuration UUID.
     * @returns Authenticated encryption context bytes.
     */
    private aad(scope: ChatScope, id: string): Buffer {
        return Buffer.from(JSON.stringify([scope.workspaceId, scope.userId, id]))
    }
    /**
     * Encrypts a write-only API key with randomized AES-256-GCM.
     * @param scope - Trusted ownership tuple.
     * @param id - Stable configuration UUID.
     * @param apiKey - Plaintext used only inside the API process.
     * @returns Versioned ciphertext containing nonce and authentication tag.
     */
    private encrypt(scope: ChatScope, id: string, apiKey: string): string {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)
        cipher.setAAD(this.aad(scope, id))
        const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
        return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
    }
    /**
     * Decrypts credentials only within the original ownership context.
     * @param scope - Trusted ownership tuple.
     * @param record - Encrypted owned configuration.
     * @returns Private API key for one server-side execution.
     * @throws ServiceUnavailableException for corrupted or misconfigured encryption.
     */
    private decrypt(scope: ChatScope, record: StoredAccountModel): string {
        try {
            const [version, iv, tag, data] = record.encryptedApiKey.split('.')
            if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted key.')
            const cipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'))
            cipher.setAAD(this.aad(scope, record.model.id))
            cipher.setAuthTag(Buffer.from(tag, 'base64url'))
            return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8')
        } catch {
            throw new ServiceUnavailableException('模型凭据不可用，请重新保存 API key。')
        }
    }
    /**
     * Normalizes a model URL using the runtime's shared network policy without touching the network.
     * @param value - Candidate base URL.
     * @returns Canonical allowed base URL.
     * @throws BadRequestException for unsupported or forbidden targets.
     */
    private baseUrl(value: string): string {
        try {
            return validateModelBaseUrl(value, { allowedLocalOrigins: this.config.allowedLocalOrigins })
        } catch {
            throw new BadRequestException('Base URL 不符合安全要求，请使用 HTTPS 公网地址；本地接口需由管理员允许。')
        }
    }
    /**
     * Lists only safe public configurations owned by the current account.
     * @param scope - Trusted ownership tuple.
     * @returns Public model metadata without ciphertext or plaintext keys.
     */
    async listModels(scope: ChatScope): Promise<AccountModel[]> {
        await this.account(scope)
        return (await this.persistence().listModels(scope)).map(record => record.model)
    }
    /**
     * Reads the current user-selected default without selecting an arbitrary replacement.
     * @param scope - Trusted ownership tuple.
     * @returns Public default model when explicitly selected.
     */
    async defaultModel(scope: ChatScope): Promise<AccountModel | undefined> {
        return (await this.listModels(scope)).find(model => model.isDefault)
    }
    /**
     * Resolves one complete current configuration for a server-side runtime call.
     * @param scope - Trusted ownership tuple.
     * @param id - Stable model UUID.
     * @returns Current public configuration and decrypted key only when owned.
     */
    async getModel(scope: ChatScope, id: string): Promise<{ public: AccountModel; apiKey: string } | undefined> {
        await this.account(scope)
        const record = await this.persistence().getModel(scope, id)
        return record ? { public: record.model, apiKey: this.decrypt(scope, record) } : undefined
    }
    /**
     * Creates an encrypted connection with idempotent request identity and no provider call.
     * @param scope - Trusted ownership tuple.
     * @param input - New connection fields and stable retry UUID.
     * @returns Current safe metadata for the newly created or replayed connection.
     * @throws ConflictException for a reused UUID with different original parameters.
     */
    async createModel(scope: ChatScope, input: CreateAccountModel): Promise<AccountModel> {
        const parsed = createAccountModelSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '模型配置不正确。')
        await this.account(scope)
        const data = { ...parsed.data, baseUrl: this.baseUrl(parsed.data.baseUrl) }
        const creationFingerprint = createHmac('sha256', this.encryptionKey)
            .update(JSON.stringify([scope.workspaceId, scope.userId, data.name, data.baseUrl, data.model, data.apiKey]))
            .digest('hex')
        const existing = await this.persistence().getModel(scope, data.requestId)
        if (existing) {
            if (existing.creationFingerprint !== creationFingerprint) throw new ConflictException('该创建请求已用于其他配置。')
            return existing.model
        }
        const now = new Date().toISOString()
        const model: AccountModel = {
            id: data.requestId,
            modelId: `account:${data.requestId}`,
            name: data.name,
            baseUrl: data.baseUrl,
            model: data.model,
            hasApiKey: true,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
        }
        try {
            return (
                await this.persistence().saveModel(
                    scope,
                    { model, creationFingerprint, encryptedApiKey: this.encrypt(scope, model.id, data.apiKey) },
                    true
                )
            ).model
        } catch (error) {
            if (error instanceof AccountConflictError) {
                const replay = await this.persistence().getModel(scope, model.id)
                if (replay?.creationFingerprint === creationFingerprint) return replay.model
                throw new ConflictException('该创建请求已用于其他配置。')
            }
            throw error
        }
    }
    /**
     * Updates public routing fields and optionally replaces the key without any model request.
     * @param scope - Trusted ownership tuple.
     * @param id - Owned configuration UUID.
     * @param input - Replacement fields; blank or omitted key retains the existing ciphertext.
     * @returns Safe updated configuration.
     * @throws NotFoundException for foreign or absent configurations.
     */
    async updateModel(scope: ChatScope, id: string, input: UpdateAccountModel): Promise<AccountModel> {
        const parsed = updateAccountModelSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '模型配置不正确。')
        await this.account(scope)
        const previous = await this.persistence().getModel(scope, id)
        if (!previous) throw new NotFoundException('未找到这个模型连接。')
        const model = {
            ...previous.model,
            name: parsed.data.name,
            baseUrl: this.baseUrl(parsed.data.baseUrl),
            model: parsed.data.model,
            updatedAt: new Date().toISOString(),
        }
        try {
            return (
                await this.persistence().saveModel(scope, {
                    ...previous,
                    model,
                    encryptedApiKey: parsed.data.apiKey ? this.encrypt(scope, id, parsed.data.apiKey) : previous.encryptedApiKey,
                })
            ).model
        } catch (error) {
            if (error instanceof AccountConflictError) throw new NotFoundException('未找到这个模型连接。')
            throw error
        }
    }
    /**
     * Sets exactly one owned connection as default without invoking a model.
     * @param scope - Trusted ownership tuple.
     * @param id - Owned configuration UUID.
     * @returns Safe selected configuration.
     * @throws NotFoundException for foreign or absent configurations.
     */
    async setDefaultModel(scope: ChatScope, id: string): Promise<AccountModel> {
        await this.account(scope)
        const record = await this.persistence().setDefaultModel(scope, id, new Date().toISOString())
        if (!record) throw new NotFoundException('未找到这个模型连接。')
        return record.model
    }
    /**
     * Deletes a connection without altering old resource histories or selecting another private default.
     * @param scope - Trusted ownership tuple.
     * @param id - Owned configuration UUID.
     * @returns After deletion succeeds.
     * @throws NotFoundException for foreign or absent configurations.
     */
    async deleteModel(scope: ChatScope, id: string): Promise<void> {
        await this.account(scope)
        if (!(await this.persistence().deleteModel(scope, id))) throw new NotFoundException('未找到这个模型连接。')
    }
    /**
     * Explicitly tests the saved owned connection with a bounded cancellable Cordis request.
     * @param scope - Trusted ownership tuple.
     * @param id - Owned configuration UUID.
     * @param signal - Browser disconnect or explicit cancellation signal.
     * @returns Safe success feedback only after the provider test succeeds.
     * @throws HttpException with redacted authentication, timeout, cancellation or protocol feedback.
     */
    async testModel(scope: ChatScope, id: string, signal?: AbortSignal): Promise<{ success: true; message: string }> {
        const connection = await this.getModel(scope, id)
        if (!connection) throw new NotFoundException('未找到这个模型连接。')
        if (!this.testConnection) throw new ServiceUnavailableException('连接测试暂时不可用。')
        const bounded = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
        try {
            await this.testConnection(
                { apiKey: connection.apiKey, baseUrl: connection.public.baseUrl, model: connection.public.model },
                bounded
            )
            return { success: true, message: '连接成功。' }
        } catch (error) {
            if (bounded.aborted) throw new HttpException(signal?.aborted ? '连接测试已取消。' : '连接测试超时，请重试。', 408)
            const kind = typeof error === 'object' && error !== null && 'kind' in error ? error.kind : undefined
            throw new BadRequestException(
                kind === 'authentication' ? '模型鉴权失败，请检查 API key。' : '连接测试失败，请检查地址、模型标识和服务状态。'
            )
        }
    }
}
