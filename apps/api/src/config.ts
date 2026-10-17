export interface ApiConfig {
    token: string
    workspaceId: string
    host: string
    port: number
    databaseUrl?: string
    allowMemory: boolean
    apiKey: string
    model: string
    baseUrl: string
    systemPrompt: string
    maxTokens: number
    timeoutMs: number
    agentModels?: string[]
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
    return {
        token,
        workspaceId: env.HARNESS_WORKSPACE_ID?.trim() || 'personal',
        host: env.API_HOST || '127.0.0.1',
        port: positiveInteger(env.API_PORT, 3001, 65535),
        ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
        allowMemory: env.NODE_ENV !== 'production' && env.CHAT_STORE === 'memory',
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
