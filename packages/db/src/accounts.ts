import { accountModelSchema, accountUserSchema, type AccountModel, type AccountUser } from '@ai-harness/contracts'
import type pg from 'pg'
import type { ChatScope } from './index.js'
import { initializeWorkspaceTables, workspaceAccess } from './workspaces.js'

export interface StoredAccount {
    user: AccountUser
    workspaceId: string
    passwordHash: string
    credentialVersion: number
}
export interface StoredAccountSession {
    tokenHash: string
    userId: string
    credentialVersion: number
    createdAt: string
    expiresAt: string
}
export interface StoredAccountModel {
    model: AccountModel
    encryptedApiKey: string
    creationFingerprint: string
}
export interface AccountStore {
    /**
     * Consumes one request within a persistent fixed-window authentication bucket.
     * @param key - Server-HMAC authentication identity without raw email or address.
     * @param maximum - Maximum permitted requests per window.
     * @param windowMs - Fixed-window lifetime in milliseconds.
     * @param now - Current epoch milliseconds.
     * @returns Whether the request was counted and permitted.
     * @throws Error for invalid inputs or storage failures, never permitting a bypass.
     */
    consumeRateLimit(key: string, maximum: number, windowMs: number, now: number): Promise<boolean>
    /**
     * Serializes password verification and its failure bucket across application processes.
     * @param key - Server-HMAC normalized email identity.
     * @param maximum - Maximum failed verifications per window.
     * @param windowMs - Fixed-window lifetime in milliseconds.
     * @param now - Current epoch milliseconds.
     * @param verify - Password-only calculation that never accesses the database.
     * @returns Limited without verifying, failed after counting, or verified after clearing failures.
     * @throws Error for verification or storage failures, releasing the verification lock.
     */
    verifyLogin(
        key: string,
        maximum: number,
        windowMs: number,
        now: number,
        verify: () => Promise<boolean>
    ): Promise<'limited' | 'failed' | 'verified'>
    /**
     * Inserts one globally unique normalized account.
     * @param account - Private validated account record.
     * @returns After persistence succeeds.
     * @throws AccountConflictError for a duplicate email or identifier.
     */
    createUser(account: StoredAccount): Promise<void>
    /**
     * Finds private credential material by normalized email.
     * @param email - Lowercase normalized email.
     * @returns The private account when present.
     */
    getByEmail(email: string): Promise<StoredAccount | undefined>
    /**
     * Reads one private account by stable identifier.
     * @param id - Stable user identifier.
     * @returns The private account when present.
     */
    getById(id: string): Promise<StoredAccount | undefined>
    /**
     * Changes only a user's display name and update timestamp.
     * @param id - Stable user identifier.
     * @param username - Validated display name.
     * @param now - ISO timestamp.
     * @returns Updated public account or undefined for an absent user.
     */
    updateUsername(id: string, username: string, now: string): Promise<AccountUser | undefined>
    /**
     * Compare-and-swaps credentials and revokes every session atomically.
     * @param id - User identifier.
     * @param expectedHash - Previously verified password hash.
     * @param changes - Optional new email or password hash and update timestamp.
     * @returns Updated public account, or undefined after a competing credential change.
     * @throws AccountConflictError for an occupied email.
     */
    updateCredentials(
        id: string,
        expectedHash: string,
        changes: { email?: string; passwordHash?: string; now: string }
    ): Promise<AccountUser | undefined>
    /**
     * Creates a session only while the verified credential version is current.
     * @param session - Hashed opaque token and bounded lifetime.
     * @returns Whether the account version still matched.
     */
    saveSession(session: StoredAccountSession): Promise<boolean>
    /**
     * Resolves an unexpired hashed session and current account version.
     * @param tokenHash - SHA256 of the browser's opaque secret.
     * @param now - Current ISO timestamp.
     * @returns Current private account for a valid session.
     */
    getSession(tokenHash: string, now: string): Promise<StoredAccount | undefined>
    /**
     * Revokes one hashed session without affecting other devices.
     * @param tokenHash - SHA256 session identity.
     * @returns After revocation succeeds.
     */
    revokeSession(tokenHash: string): Promise<void>
    /**
     * Lists private model records in a complete trusted ownership scope.
     * @param scope - Authenticated user and workspace.
     * @returns Independent private model records.
     */
    listModels(scope: ChatScope): Promise<StoredAccountModel[]>
    /**
     * Reads a model within both ownership dimensions.
     * @param scope - Authenticated ownership context.
     * @param id - Model configuration UUID.
     * @returns Private configuration when owned.
     */
    getModel(scope: ChatScope, id: string): Promise<StoredAccountModel | undefined>
    /**
     * Saves a model while serializing default selection per account.
     * @param scope - Authenticated ownership context.
     * @param record - Public metadata and encrypted secret.
     * @param create - Require a fresh identifier; first model becomes default.
     * @returns Persisted model with authoritative default state.
     * @throws AccountConflictError for an existing creation identifier.
     */
    saveModel(scope: ChatScope, record: StoredAccountModel, create?: boolean): Promise<StoredAccountModel>
    /**
     * Makes one owned model the unique default atomically.
     * @param scope - Authenticated ownership context.
     * @param id - Owned model UUID.
     * @param now - ISO update timestamp.
     * @returns The selected model when present.
     */
    setDefaultModel(scope: ChatScope, id: string, now: string): Promise<StoredAccountModel | undefined>
    /**
     * Deletes an owned configuration without selecting a replacement default.
     * @param scope - Authenticated ownership context.
     * @param id - Owned configuration UUID.
     * @returns Whether a record was removed.
     */
    deleteModel(scope: ChatScope, id: string): Promise<boolean>
}

export class AccountConflictError extends Error {
    /**
     * Signals a safe unique account or model conflict.
     */
    constructor() {
        super('Account or model conflicts with existing data.')
        this.name = 'AccountConflictError'
    }
}

/**
 * Validates a trusted ownership tuple before any model access.
 * @param scope - API-verified ownership tuple.
 * @returns Stable map prefix.
 * @throws Error for missing ownership fields.
 */
function scopeKey(scope: ChatScope): string {
    if (!scope.userId || !scope.workspaceId) throw new Error('Account ownership is required.')
    return JSON.stringify([scope.workspaceId, scope.userId])
}
/**
 * Copies and validates one private account without exposing its secrets.
 * @param account - Candidate stored account.
 * @returns Independent validated record.
 * @throws Error for missing private credential metadata.
 */
function checkedAccount(account: StoredAccount): StoredAccount {
    if (!account.workspaceId || !account.passwordHash || !Number.isSafeInteger(account.credentialVersion) || account.credentialVersion < 1)
        throw new Error('Invalid private account.')
    return { ...account, user: accountUserSchema.parse(account.user) }
}
/**
 * Validates encrypted model metadata and returns a detached snapshot.
 * @param record - Private model record.
 * @returns Validated private record.
 * @throws Error for malformed metadata or missing encryption material.
 */
function checkedModel(record: StoredAccountModel): StoredAccountModel {
    const model = accountModelSchema.parse(record.model)
    if (model.modelId !== `account:${model.id}` || !record.encryptedApiKey || !record.creationFingerprint)
        throw new Error('Invalid private model.')
    return { ...record, model }
}

/**
 * Validates private rate-limit inputs before accessing a shared bucket.
 * @param key - HMAC-SHA256 identity.
 * @param maximum - Positive request ceiling.
 * @param windowMs - Positive window duration.
 * @param now - Finite epoch milliseconds.
 * @returns Nothing when every input is supported.
 * @throws Error for malformed identity, ceiling, duration or clock.
 */
function checkedRateLimit(key: string, maximum: number, windowMs: number, now: number): void {
    if (
        !/^[a-f0-9]{64}$/.test(key) ||
        !Number.isSafeInteger(maximum) ||
        maximum <= 0 ||
        !Number.isSafeInteger(windowMs) ||
        windowMs <= 0 ||
        !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(now + windowMs) ||
        !Number.isFinite(new Date(now + windowMs).getTime())
    )
        throw new Error('Invalid authentication rate-limit input.')
}

/**
 * Creates isolated account persistence only for explicitly injected test fixtures.
 * @returns Test-only in-memory users, hashed sessions and encrypted model records.
 */
export function createMemoryAccountStore(): AccountStore {
    const users = new Map<string, StoredAccount>()
    const sessions = new Map<string, StoredAccountSession>()
    const models = new Map<string, StoredAccountModel>()
    const limits = new Map<string, { count: number; expires: number }>()
    const verificationLocks = new Map<string, Promise<void>>()
    /**
     * Removes a bounded number of expired test-only authentication buckets.
     * @param now - Current fixture clock.
     * @returns Nothing after removing at most 128 expired entries.
     */
    function cleanupLimits(now: number): void {
        let removed = 0
        for (const [key, bucket] of limits)
            if (bucket.expires <= now) {
                limits.delete(key)
                if (++removed === 128) break
            }
    }
    /**
     * Lists model map entries in an owned scope.
     * @param scope - Trusted ownership scope.
     * @returns Matching internal map tuples.
     */
    function entries(scope: ChatScope): [string, StoredAccountModel][] {
        const prefix = `${scopeKey(scope)}:`
        return [...models].filter(([key]) => key.startsWith(prefix))
    }
    return {
        /**
         * Counts a request atomically in explicitly injected test persistence.
         * @param key - HMAC authentication identity.
         * @param maximum - Request ceiling.
         * @param windowMs - Window lifetime.
         * @param now - Current fixture clock.
         * @returns Whether another request was accepted.
         */
        async consumeRateLimit(key, maximum, windowMs, now) {
            checkedRateLimit(key, maximum, windowMs, now)
            cleanupLimits(now)
            const previous = limits.get(key)
            if (previous && previous.expires > now && previous.count >= maximum) return false
            limits.set(key, {
                count: previous && previous.expires > now ? previous.count + 1 : 1,
                expires: previous && previous.expires > now ? previous.expires : now + windowMs,
            })
            return true
        },
        /**
         * Serializes a fixture verification while preserving counted authentication failures.
         * @param key - HMAC normalized email identity.
         * @param maximum - Failure ceiling.
         * @param windowMs - Window lifetime.
         * @param now - Current fixture clock.
         * @param verify - Password-only fixture calculation.
         * @returns Whether verification was limited, failed, or successful.
         * @throws Error when the verifier rejects, releasing queued attempts.
         */
        async verifyLogin(key, maximum, windowMs, now, verify) {
            checkedRateLimit(key, maximum, windowMs, now)
            const previousLock = verificationLocks.get(key)
            let release!: () => void
            const lock = new Promise<void>(resolve => {
                release = resolve
            })
            verificationLocks.set(key, lock)
            try {
                await previousLock
                cleanupLimits(now)
                const bucket = limits.get(key)
                if (bucket && bucket.expires > now && bucket.count >= maximum) return 'limited'
                if (await verify()) {
                    limits.delete(key)
                    return 'verified'
                }
                limits.set(key, {
                    count: bucket && bucket.expires > now ? bucket.count + 1 : 1,
                    expires: bucket && bucket.expires > now ? bucket.expires : now + windowMs,
                })
                return 'failed'
            } finally {
                release()
                if (verificationLocks.get(key) === lock) verificationLocks.delete(key)
            }
        },
        /**
         * Inserts a unique account without yielding between conflict check and publication.
         * @param account - Private account record.
         * @returns After insertion.
         * @throws AccountConflictError for existing email or ID.
         */
        async createUser(account) {
            const record = checkedAccount(account)
            if (users.has(record.user.id) || [...users.values()].some(value => value.user.email === record.user.email))
                throw new AccountConflictError()
            users.set(record.user.id, structuredClone(record))
        },
        /**
         * Reads an independent account by normalized email.
         * @param email - Normalized email.
         * @returns Private account snapshot when found.
         */
        async getByEmail(email) {
            return structuredClone([...users.values()].find(value => value.user.email === email))
        },
        /**
         * Reads an independent account by stable ID.
         * @param id - User identifier.
         * @returns Private account when found.
         */
        async getById(id) {
            return structuredClone(users.get(id))
        },
        /**
         * Changes a display name without replacing credentials or ownership.
         * @param id - Account identifier.
         * @param username - Validated display name.
         * @param now - Update timestamp.
         * @returns Independent updated public user.
         */
        async updateUsername(id, username, now) {
            const account = users.get(id)
            if (!account) return undefined
            account.user = accountUserSchema.parse({ ...account.user, username, updatedAt: now })
            return structuredClone(account.user)
        },
        /**
         * Atomically compare-and-swaps credentials and deletes all old sessions.
         * @param id - Account identifier.
         * @param expectedHash - Previously verified password hash.
         * @param changes - Replacement credentials and timestamp.
         * @returns Updated public account when the hash still matches.
         * @throws AccountConflictError for duplicate email.
         */
        async updateCredentials(id, expectedHash, changes) {
            const account = users.get(id)
            if (!account || account.passwordHash !== expectedHash) return undefined
            if (changes.email && [...users.values()].some(value => value.user.id !== id && value.user.email === changes.email))
                throw new AccountConflictError()
            const user = accountUserSchema.parse({
                ...account.user,
                ...(changes.email ? { email: changes.email } : {}),
                updatedAt: changes.now,
            })
            users.set(id, {
                ...account,
                user,
                passwordHash: changes.passwordHash ?? account.passwordHash,
                credentialVersion: account.credentialVersion + 1,
            })
            for (const [key, session] of sessions) if (session.userId === id) sessions.delete(key)
            return structuredClone(user)
        },
        /**
         * Saves a hashed session only for the current credential version.
         * @param session - Hashed token metadata.
         * @returns Whether the version is still current.
         */
        async saveSession(session) {
            if (users.get(session.userId)?.credentialVersion !== session.credentialVersion) return false
            sessions.set(session.tokenHash, structuredClone(session))
            return true
        },
        /**
         * Resolves only current unexpired session metadata.
         * @param tokenHash - Hashed opaque token.
         * @param now - Current time.
         * @returns Independent account snapshot for a valid session.
         */
        async getSession(tokenHash, now) {
            const session = sessions.get(tokenHash)
            const account = session && users.get(session.userId)
            return session && session.expiresAt > now && account?.credentialVersion === session.credentialVersion
                ? structuredClone(account)
                : undefined
        },
        /**
         * Revokes a session idempotently.
         * @param tokenHash - Hashed session identity.
         * @returns After deletion.
         */
        async revokeSession(tokenHash) {
            sessions.delete(tokenHash)
        },
        /**
         * Lists encrypted model snapshots in one owned scope.
         * @param scope - Trusted ownership tuple.
         * @returns Independent records ordered by creation time.
         */
        async listModels(scope) {
            return entries(scope)
                .map(([, record]) => structuredClone(record))
                .sort((a, b) => a.model.createdAt.localeCompare(b.model.createdAt) || a.model.id.localeCompare(b.model.id))
        },
        /**
         * Reads one encrypted configuration by its scoped key.
         * @param scope - Trusted ownership tuple.
         * @param id - Configuration UUID.
         * @returns Independent record when owned.
         */
        async getModel(scope, id) {
            return structuredClone(models.get(`${scopeKey(scope)}:${id}`))
        },
        /**
         * Saves metadata while retaining authoritative default and immutable creation fingerprint.
         * @param scope - Trusted ownership tuple.
         * @param record - Encrypted private configuration.
         * @param create - Require a new ID.
         * @returns Saved independent record.
         * @throws AccountConflictError for a duplicate creation ID or absent update.
         */
        async saveModel(scope, record, create = false) {
            const checked = checkedModel(record)
            const key = `${scopeKey(scope)}:${checked.model.id}`
            const current = models.get(key)
            if (create ? Boolean(current) : !current) throw new AccountConflictError()
            const saved = {
                ...checked,
                creationFingerprint: current?.creationFingerprint ?? checked.creationFingerprint,
                model: { ...checked.model, isDefault: current?.model.isDefault ?? entries(scope).length === 0 },
            }
            models.set(key, structuredClone(saved))
            return structuredClone(saved)
        },
        /**
         * Switches the default without yielding between records.
         * @param scope - Trusted ownership tuple.
         * @param id - Configuration UUID.
         * @param now - Update timestamp.
         * @returns Selected independent record when owned.
         */
        async setDefaultModel(scope, id, now) {
            const key = `${scopeKey(scope)}:${id}`
            if (!models.has(key)) return undefined
            for (const [, record] of entries(scope))
                record.model = {
                    ...record.model,
                    isDefault: record.model.id === id,
                    updatedAt: record.model.id === id ? now : record.model.updatedAt,
                }
            return structuredClone(models.get(key))
        },
        /**
         * Deletes an owned configuration and leaves remaining defaults unchanged.
         * @param scope - Trusted ownership tuple.
         * @param id - Configuration UUID.
         * @returns Whether one record was deleted.
         */
        async deleteModel(scope, id) {
            return models.delete(`${scopeKey(scope)}:${id}`)
        },
    }
}

interface AccountRow {
    id: string
    workspace_id: string
    username: string
    email: string
    password_hash: string
    credential_version: number
    created_at: Date | string
    updated_at: Date | string
}
/**
 * Converts a database row into private account state.
 * @param row - PostgreSQL account row.
 * @returns Validated private account.
 */
function accountFromRow(row: AccountRow): StoredAccount {
    return checkedAccount({
        user: {
            id: row.id,
            username: row.username,
            email: row.email,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
        },
        workspaceId: row.workspace_id,
        passwordHash: row.password_hash,
        credentialVersion: row.credential_version,
    })
}
/**
 * Runs a transaction on the already shared application pool.
 * @param pool - Process-owned pool.
 * @param operation - Work sharing the transaction client.
 * @returns Committed operation result.
 * @throws AccountConflictError for unique-key conflicts.
 * @throws Error after rolling back failed operations.
 */
async function transaction<T>(pool: pg.Pool, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await operation(client)
        await client.query('COMMIT')
        return result
    } catch (error) {
        try {
            await client.query('ROLLBACK')
        } catch {
            /* Preserve the original failure. */
        }
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new AccountConflictError()
        throw error
    } finally {
        client.release()
    }
}
/**
 * Initializes account tables in the same PostgreSQL database and pool.
 * @param pool - Shared process pool.
 * @returns After all private account tables are available.
 */
export async function initializeAccountTables(pool: Pick<pg.Pool, 'query'>): Promise<void> {
    await pool.query(
        `CREATE TABLE IF NOT EXISTS harness_account_rate_limits (key text PRIMARY KEY, attempts integer NOT NULL CHECK(attempts >= 0), expires_at timestamptz NOT NULL)`
    )
    await pool.query(`CREATE INDEX IF NOT EXISTS harness_account_rate_limits_expiry_idx ON harness_account_rate_limits(expires_at)`)
    await pool.query(
        `CREATE TABLE IF NOT EXISTS harness_accounts (id uuid PRIMARY KEY, workspace_id text NOT NULL, username text NOT NULL, email text UNIQUE NOT NULL, password_hash text NOT NULL, credential_version integer NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL)`
    )
    await pool.query(
        `CREATE TABLE IF NOT EXISTS harness_account_sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES harness_accounts(id) ON DELETE CASCADE, credential_version integer NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL)`
    )
    await pool.query(`CREATE INDEX IF NOT EXISTS harness_account_sessions_user_idx ON harness_account_sessions(user_id)`)
    await pool.query(
        `CREATE TABLE IF NOT EXISTS harness_account_models (workspace_id text NOT NULL, user_id uuid NOT NULL REFERENCES harness_accounts(id) ON DELETE CASCADE, id uuid NOT NULL, data jsonb NOT NULL, PRIMARY KEY(workspace_id,user_id,id))`
    )
    await initializeWorkspaceTables(pool)
}
/**
 * Creates PostgreSQL account persistence without allocating another connection pool.
 * @param pool - Initialized shared process pool.
 * @returns Transactional private account persistence.
 */
export function createPostgresAccountStore(pool: pg.Pool): AccountStore {
    /**
     * Deletes a bounded expired set without waiting for another request's row locks.
     * @param client - Shared pool or the current verification transaction client.
     * @param now - Current epoch milliseconds.
     * @returns After at most 128 expired buckets have been removed.
     */
    async function cleanupLimits(client: Pick<pg.Pool, 'query'>, now: number): Promise<void> {
        await client.query(
            `DELETE FROM harness_account_rate_limits WHERE key IN
             (SELECT key FROM harness_account_rate_limits WHERE expires_at <= $1 ORDER BY expires_at LIMIT 128 FOR UPDATE SKIP LOCKED)`,
            [new Date(now).toISOString()]
        )
    }
    /**
     * Atomically counts one accepted request without exceeding an active bucket ceiling.
     * @param client - Shared pool or a verification transaction client.
     * @param key - HMAC authentication identity.
     * @param maximum - Request ceiling.
     * @param windowMs - Window lifetime.
     * @param now - Current epoch milliseconds.
     * @returns Whether PostgreSQL accepted and counted the request.
     */
    async function consume(client: Pick<pg.Pool, 'query'>, key: string, maximum: number, windowMs: number, now: number): Promise<boolean> {
        const result = await client.query(
            `INSERT INTO harness_account_rate_limits(key,attempts,expires_at) VALUES($1,1,$3)
             ON CONFLICT(key) DO UPDATE SET
               attempts=CASE WHEN harness_account_rate_limits.expires_at <= $2 THEN 1 ELSE harness_account_rate_limits.attempts+1 END,
               expires_at=CASE WHEN harness_account_rate_limits.expires_at <= $2 THEN $3 ELSE harness_account_rate_limits.expires_at END
             WHERE harness_account_rate_limits.expires_at <= $2 OR harness_account_rate_limits.attempts < $4
             RETURNING key`,
            [key, new Date(now).toISOString(), new Date(now + windowMs).toISOString(), maximum]
        )
        return Boolean(result.rowCount)
    }
    /**
     * Fences current workspace membership and locks the owner to serialize model/default mutations.
     * @param client - Transaction client.
     * @param scope - Trusted ownership tuple.
     * @returns After the owned account row is locked.
     * @throws Error for missing or mismatched ownership.
     */
    async function lockOwner(client: pg.PoolClient, scope: ChatScope): Promise<void> {
        scopeKey(scope)
        if (!(await workspaceAccess(client, scope, true))) throw new Error('Account ownership is unavailable.')
        const result = await client.query('SELECT id FROM harness_accounts WHERE id=$1 FOR UPDATE', [scope.userId])
        if (!result.rows.length) throw new Error('Account ownership is unavailable.')
    }
    return {
        /**
         * Persists a fixed-window request count atomically across processes.
         * @param key - HMAC authentication identity.
         * @param maximum - Request ceiling.
         * @param windowMs - Window lifetime.
         * @param now - Current epoch milliseconds.
         * @returns Whether another request was counted and permitted.
         * @throws Error when storage is unavailable, never falling back to memory.
         */
        async consumeRateLimit(key, maximum, windowMs, now) {
            checkedRateLimit(key, maximum, windowMs, now)
            await cleanupLimits(pool, now)
            return consume(pool, key, maximum, windowMs, now)
        },
        /**
         * Checks and updates an email failure bucket while holding a shared transaction lock.
         * @param key - HMAC normalized email identity.
         * @param maximum - Failure ceiling.
         * @param windowMs - Window lifetime.
         * @param now - Current epoch milliseconds.
         * @param verify - Password calculation without further database work.
         * @returns Limited without hashing, failed after a committed increment, or verified after clearing.
         * @throws Error when storage or verification fails; the transaction lock is released.
         */
        async verifyLogin(key, maximum, windowMs, now, verify) {
            checkedRateLimit(key, maximum, windowMs, now)
            // Release unrelated expired row locks before taking the per-email transaction lock.
            await cleanupLimits(pool, now)
            return transaction(pool, async client => {
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`account-login:${key}`])
                const result = await client.query<{ attempts: number }>(
                    'SELECT attempts FROM harness_account_rate_limits WHERE key=$1 AND expires_at>$2',
                    [key, new Date(now).toISOString()]
                )
                if (result.rows[0] && result.rows[0].attempts >= maximum) return 'limited'
                if (await verify()) {
                    await client.query('DELETE FROM harness_account_rate_limits WHERE key=$1', [key])
                    return 'verified'
                }
                await consume(client, key, maximum, windowMs, now)
                return 'failed'
            })
        },
        /**
         * Inserts an account under database-enforced global email uniqueness.
         * @param account - Private account record.
         * @returns After insertion commits.
         * @throws AccountConflictError for duplicate identifiers or email.
         */
        async createUser(account) {
            const value = checkedAccount(account)
            await transaction(pool, async client => {
                await client.query(
                    'INSERT INTO harness_accounts(id,workspace_id,username,email,password_hash,credential_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
                    [
                        value.user.id,
                        value.workspaceId,
                        value.user.username,
                        value.user.email,
                        value.passwordHash,
                        value.credentialVersion,
                        value.user.createdAt,
                        value.user.updatedAt,
                    ]
                )
            })
        },
        /**
         * Reads account credentials by normalized email.
         * @param email - Normalized email.
         * @returns Private account when found.
         */
        async getByEmail(email) {
            const result = await pool.query<AccountRow>('SELECT * FROM harness_accounts WHERE email=$1', [email])
            return result.rows[0] ? accountFromRow(result.rows[0]) : undefined
        },
        /**
         * Reads private account credentials by stable ID.
         * @param id - User identifier.
         * @returns Private account when found.
         */
        async getById(id) {
            const result = await pool.query<AccountRow>('SELECT * FROM harness_accounts WHERE id=$1', [id])
            return result.rows[0] ? accountFromRow(result.rows[0]) : undefined
        },
        /**
         * Updates only the public display name and timestamp.
         * @param id - User identifier.
         * @param username - Validated display name.
         * @param now - Update timestamp.
         * @returns Updated public account when found.
         */
        async updateUsername(id, username, now) {
            const result = await pool.query<AccountRow>('UPDATE harness_accounts SET username=$2,updated_at=$3 WHERE id=$1 RETURNING *', [
                id,
                username,
                now,
            ])
            return result.rows[0] ? accountFromRow(result.rows[0]).user : undefined
        },
        /**
         * Atomically changes verified credentials and revokes all sessions.
         * @param id - User identifier.
         * @param expectedHash - Verified password hash.
         * @param changes - New credentials and timestamp.
         * @returns Updated public account while the expected credentials still match.
         * @throws AccountConflictError for duplicate email.
         */
        async updateCredentials(id, expectedHash, changes) {
            return transaction(pool, async client => {
                const result = await client.query<AccountRow>(
                    'UPDATE harness_accounts SET email=COALESCE($3,email),password_hash=COALESCE($4,password_hash),credential_version=credential_version+1,updated_at=$5 WHERE id=$1 AND password_hash=$2 RETURNING *',
                    [id, expectedHash, changes.email ?? null, changes.passwordHash ?? null, changes.now]
                )
                if (!result.rows[0]) return undefined
                await client.query('DELETE FROM harness_account_sessions WHERE user_id=$1', [id])
                return accountFromRow(result.rows[0]).user
            })
        },
        /**
         * Locks current credentials before saving a hashed opaque session.
         * @param session - Token hash and verified credential version.
         * @returns Whether the credential version was still current.
         */
        async saveSession(session) {
            return transaction(pool, async client => {
                const result = await client.query('SELECT id FROM harness_accounts WHERE id=$1 AND credential_version=$2 FOR SHARE', [
                    session.userId,
                    session.credentialVersion,
                ])
                if (!result.rows.length) return false
                await client.query('DELETE FROM harness_account_sessions WHERE user_id=$1 AND expires_at<=$2', [
                    session.userId,
                    session.createdAt,
                ])
                await client.query(
                    'INSERT INTO harness_account_sessions(token_hash,user_id,credential_version,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
                    [session.tokenHash, session.userId, session.credentialVersion, session.createdAt, session.expiresAt]
                )
                return true
            })
        },
        /**
         * Resolves an unexpired session against the account's current version.
         * @param tokenHash - SHA256 opaque token hash.
         * @param now - Current timestamp.
         * @returns Current account only for a valid session.
         */
        async getSession(tokenHash, now) {
            const result = await pool.query<AccountRow>(
                'SELECT a.* FROM harness_accounts a JOIN harness_account_sessions s ON s.user_id=a.id AND s.credential_version=a.credential_version WHERE s.token_hash=$1 AND s.expires_at>$2',
                [tokenHash, now]
            )
            return result.rows[0] ? accountFromRow(result.rows[0]) : undefined
        },
        /**
         * Deletes one session by its irreversible identity.
         * @param tokenHash - Hashed session token.
         * @returns After revocation.
         */
        async revokeSession(tokenHash) {
            await pool.query('DELETE FROM harness_account_sessions WHERE token_hash=$1', [tokenHash])
        },
        /**
         * Lists private model records filtered by both ownership fields.
         * @param scope - Trusted ownership tuple.
         * @returns Independent validated model records.
         */
        async listModels(scope) {
            scopeKey(scope)
            if (!(await workspaceAccess(pool, scope))) return []
            const result = await pool.query<{ data: StoredAccountModel }>(
                "SELECT data FROM harness_account_models WHERE workspace_id=$1 AND user_id=$2 ORDER BY data->'model'->>'createdAt',id",
                [scope.workspaceId, scope.userId]
            )
            return result.rows.map(row => checkedModel(row.data))
        },
        /**
         * Reads one private configuration within its ownership tuple.
         * @param scope - Trusted ownership tuple.
         * @param id - Configuration UUID.
         * @returns Validated encrypted record when owned.
         */
        async getModel(scope, id) {
            scopeKey(scope)
            if (!(await workspaceAccess(pool, scope))) return undefined
            const result = await pool.query<{ data: StoredAccountModel }>(
                'SELECT data FROM harness_account_models WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                [scope.workspaceId, scope.userId, id]
            )
            return result.rows[0] ? checkedModel(result.rows[0].data) : undefined
        },
        /**
         * Saves metadata while serializing first-default selection and preserving creation identity.
         * @param scope - Trusted ownership tuple.
         * @param record - Validated encrypted configuration.
         * @param create - Require a fresh identifier.
         * @returns Saved authoritative model record.
         * @throws AccountConflictError for duplicate creation or absent update.
         */
        async saveModel(scope, record, create = false) {
            const value = checkedModel(record)
            return transaction(pool, async client => {
                await lockOwner(client, scope)
                const result = await client.query<{ id: string; data: StoredAccountModel }>(
                    'SELECT id,data FROM harness_account_models WHERE workspace_id=$1 AND user_id=$2',
                    [scope.workspaceId, scope.userId]
                )
                const previous = result.rows.find(row => row.id === value.model.id)?.data
                if (create ? Boolean(previous) : !previous) throw new AccountConflictError()
                const saved = {
                    ...value,
                    creationFingerprint: previous?.creationFingerprint ?? value.creationFingerprint,
                    model: { ...value.model, isDefault: previous?.model.isDefault ?? result.rows.length === 0 },
                }
                await client.query(
                    'INSERT INTO harness_account_models(workspace_id,user_id,id,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(workspace_id,user_id,id) DO UPDATE SET data=EXCLUDED.data',
                    [scope.workspaceId, scope.userId, value.model.id, JSON.stringify(saved)]
                )
                return saved
            })
        },
        /**
         * Changes the unique default inside one owner-row transaction.
         * @param scope - Trusted ownership tuple.
         * @param id - Configuration UUID.
         * @param now - Update timestamp.
         * @returns Selected owned configuration when found.
         */
        async setDefaultModel(scope, id, now) {
            return transaction(pool, async client => {
                await lockOwner(client, scope)
                const result = await client.query<{ data: StoredAccountModel }>(
                    'SELECT data FROM harness_account_models WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                    [scope.workspaceId, scope.userId, id]
                )
                if (!result.rows[0]) return undefined
                await client.query(
                    `UPDATE harness_account_models SET data=jsonb_set(data,'{model,isDefault}','false'::jsonb) WHERE workspace_id=$1 AND user_id=$2 AND data->'model'->>'isDefault'='true'`,
                    [scope.workspaceId, scope.userId]
                )
                const selected = checkedModel(result.rows[0].data)
                selected.model = { ...selected.model, isDefault: true, updatedAt: now }
                await client.query('UPDATE harness_account_models SET data=$4::jsonb WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                    scope.workspaceId,
                    scope.userId,
                    id,
                    JSON.stringify(selected),
                ])
                return selected
            })
        },
        /**
         * Deletes one owned configuration without changing another default.
         * @param scope - Trusted ownership tuple.
         * @param id - Configuration UUID.
         * @returns Whether one configuration existed.
         */
        async deleteModel(scope, id) {
            return transaction(pool, async client => {
                await lockOwner(client, scope)
                const result = await client.query('DELETE FROM harness_account_models WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                    scope.workspaceId,
                    scope.userId,
                    id,
                ])
                return Boolean(result.rowCount)
            })
        },
    }
}
