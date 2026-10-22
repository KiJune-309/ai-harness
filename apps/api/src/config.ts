import type { KnowledgeObjectStorageConfig } from '@ai-harness/chat-runtime/knowledge'

export interface ApiConfig {
    collaborationPollMs?: number
    collaborationLeaseMs?: number
    collaborationWaitMs?: number
    knowledgeObjectStorage?: KnowledgeObjectStorageConfig
    token: string
    workspaceId: string
    host: string
    port: number
    databaseUrl: string
    apiKey: string
    model: string
    baseUrl: string
    systemPrompt: string
    maxTokens: number
    timeoutMs: number
    agentModels?: string[]
    accountEncryptionKey: string
    allowedLocalOrigins?: string[]
}

/**
 * Reads an optional complete private object configuration without enabling a volatile fallback.
 * @param env - Trusted process environment.
 * @returns Validated private settings, or undefined when the feature is unconfigured.
 * @throws Error for partial credentials, unsafe endpoints, buckets, or boolean values.
 */
function knowledgeObjectStorage(env: NodeJS.ProcessEnv): KnowledgeObjectStorageConfig | undefined {
    const names = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const
    const hasConfiguration = names.some(name => Boolean(env[name]?.trim()))
    if (!hasConfiguration) return undefined
    if (names.some(name => !env[name]?.trim()))
        throw new Error('Configure all S3 endpoint, region, bucket, and private credentials together.')
    let endpoint: URL
    try {
        endpoint = new URL(env.S3_ENDPOINT!.trim())
    } catch {
        throw new Error('Invalid private S3 endpoint configuration.')
    }
    if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        (endpoint.pathname && endpoint.pathname !== '/')
    )
        throw new Error('Invalid private S3 endpoint configuration.')
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET!.trim())) throw new Error('Invalid private S3 bucket configuration.')
    for (const name of ['S3_FORCE_PATH_STYLE', 'S3_CREATE_BUCKET'])
        if (env[name] && !['true', 'false'].includes(env[name]!.trim())) throw new Error('S3 boolean configuration must be true or false.')
    return {
        endpoint: endpoint.origin,
        region: env.S3_REGION?.trim() || 'us-east-1',
        bucket: env.S3_BUCKET!.trim(),
        accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
        forcePathStyle: env.S3_FORCE_PATH_STYLE?.trim() !== 'false',
        createBucket: env.S3_CREATE_BUCKET?.trim() === 'true',
    }
}

/**
 * Read a bounded positive integer from server-owned configuration.
 * @param value - Optional environment value.
 * @param fallback - Default when no value was configured.
 * @param maximum - Highest accepted value.
 * @returns A validated positive integer.
 * @throws Error for invalid configuration without exposing the supplied value.
 */
function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
    const parsed = value === undefined || value === '' ? fallback : Number(value)
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) throw new Error('Invalid positive integer in API configuration.')
    return parsed
}

/**
 * Resolve immutable server configuration without exposing credentials.
 * @param env - Process environment supplied by the launcher or deployment.
 * @returns Settings for the local HTTP server and process-owned runtime.
 * @throws Error when the server token or numeric settings are invalid.
 */
export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
    const token = env.HARNESS_API_TOKEN?.trim() ?? ''
    if (token.length < 32) throw new Error('Set HARNESS_API_TOKEN to at least 32 characters, or start both apps with pnpm dev.')
    const databaseUrl = env.DATABASE_URL?.trim()
    if (!databaseUrl) throw new Error('Set DATABASE_URL for persistent PostgreSQL storage, or start both apps with pnpm dev.')
    const accountEncryptionKey = env.ACCOUNT_ENCRYPTION_KEY?.trim()
    if (accountEncryptionKey && !/^[0-9a-f]{64}$/i.test(accountEncryptionKey))
        throw new Error('ACCOUNT_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.')
    if (!accountEncryptionKey) throw new Error('Set a stable ACCOUNT_ENCRYPTION_KEY before using persistent account storage.')
    return {
        knowledgeObjectStorage: knowledgeObjectStorage(env),
        token,
        collaborationPollMs: positiveInteger(env.COLLABORATION_POLL_MS, 500, 30_000),
        collaborationLeaseMs: positiveInteger(env.COLLABORATION_LEASE_MS, 30_000, 300_000),
        collaborationWaitMs: positiveInteger(env.COLLABORATION_WAIT_MS, 7 * 86_400_000, 365 * 86_400_000),
        accountEncryptionKey,
        allowedLocalOrigins:
            env.OPENAI_ALLOWED_LOCAL_ORIGINS?.split(',')
                .map(origin => origin.trim())
                .filter(Boolean) ?? [],
        workspaceId: env.HARNESS_WORKSPACE_ID?.trim() || 'personal',
        host: env.API_HOST || '127.0.0.1',
        port: positiveInteger(env.API_PORT, 3001, 65535),
        databaseUrl,
        apiKey: env.DEEPSEEK_API_KEY?.trim() || '',
        model: env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash',
        ...(env.DEEPSEEK_MODELS
            ? {
                  agentModels: env.DEEPSEEK_MODELS.split(',')
                      .map(model => model.trim())
                      .filter(Boolean),
              }
            : {}),
        baseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
        systemPrompt: env.DEEPSEEK_SYSTEM_PROMPT || '你是一个认真、清晰、可靠的助手。请根据用户使用的语言回答。',
        maxTokens: positiveInteger(env.DEEPSEEK_MAX_TOKENS, 8192, 393216),
        timeoutMs: positiveInteger(env.DEEPSEEK_TIMEOUT_MS, 120000, 600000),
    }
}
