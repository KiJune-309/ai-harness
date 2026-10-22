import {
    EMBEDDING_MAX_CONCURRENCY,
    EMBEDDING_MAX_DIMENSIONS,
    EMBEDDING_MAX_INPUTS,
    EMBEDDING_MAX_REQUEST_BYTES,
    EMBEDDING_MAX_RESPONSE_BYTES,
    EMBEDDING_TIMEOUT_MS,
} from '@ai-harness/contracts'
import { createModelFetch, validateModelBaseUrl, type ModelAddressOptions } from './model-connection.js'

export interface EmbeddingConnection {
    baseUrl: string
    apiKey: string
    model: string
}

export interface EmbeddingResult {
    model: string
    dimensions: number
    vectors: number[][]
}

export interface EmbeddingOptions extends ModelAddressOptions {
    signal?: AbortSignal
    transport?: typeof fetch
    timeoutMs?: number
}

export type EmbeddingFailureKind = 'input' | 'authentication' | 'rate_limit' | 'timeout' | 'cancelled' | 'connection' | 'protocol'

/**
 * Carries a safe embedding failure without provider response bodies or credentials.
 */
export class EmbeddingError extends Error {
    /**
     * Labels a bounded public error for API status selection.
     * @param kind - Safe failure category.
     * @param message - Public text without provider payloads.
     */
    constructor(
        public readonly kind: EmbeddingFailureKind,
        message: string
    ) {
        super(message)
        this.name = 'EmbeddingError'
    }
}

let activeEmbeddingRequests = 0

/**
 * Validates an embedding API root without resolving DNS or making a provider request.
 * @param value - User-supplied API root, commonly ending in /v1.
 * @param options - Server-owned exact local-origin exceptions.
 * @returns A safe normalized root without a trailing slash.
 * @throws EmbeddingError for invalid roots or complete endpoint addresses.
 */
export function validateEmbeddingBaseUrl(value: string, options: ModelAddressOptions = {}): string {
    try {
        if (!value.trim() || value.length > 2048) throw new Error('Invalid root')
        const baseUrl = validateModelBaseUrl(value, options)
        if (/\/(embeddings|chat\/completions|responses)$/i.test(new URL(baseUrl).pathname))
            throw new EmbeddingError('input', '请填写 API 根地址，例如 https://服务商域名/v1，不要包含 /embeddings 或聊天接口路径。')
        return baseUrl
    } catch (cause) {
        if (cause instanceof EmbeddingError) throw cause
        throw new EmbeddingError('input', '向量模型地址无效，请使用 HTTPS API 根地址；本地服务须由服务器明确授权。')
    }
}

/**
 * Serializes the exact provider request used for both planning and transmission.
 * @param model - Saved embedding model identifier.
 * @param inputs - Complete unmodified source texts.
 * @returns The OpenAI-compatible JSON request without a dimensions override.
 */
function embeddingBody(model: string, inputs: readonly string[]): string {
    return JSON.stringify({ model, input: inputs, encoding_format: 'float' })
}

/**
 * Rejects empty texts without truncating or otherwise changing their source content.
 * @param value - Source text supplied for embedding.
 * @returns Nothing for a nonempty string.
 * @throws EmbeddingError for empty or invalid text inputs.
 */
function requireText(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) throw new EmbeddingError('input', '向量输入不能为空，请检查原分片或查询文本。')
}

/**
 * Selects the largest bounded prefix of source texts for one actual provider request.
 * @param connection - Trusted saved connection whose model contributes to body size.
 * @param inputs - Remaining source texts in their original order.
 * @returns At most sixteen complete texts fitting the request byte limit.
 * @throws EmbeddingError when a single source cannot fit without truncation.
 */
export function takeEmbeddingBatch(connection: Pick<EmbeddingConnection, 'model'>, inputs: readonly string[]): string[] {
    const batch: string[] = []
    for (const input of inputs.slice(0, EMBEDDING_MAX_INPUTS)) {
        requireText(input)
        const candidate = [...batch, input]
        if (Buffer.byteLength(embeddingBody(connection.model, candidate), 'utf8') > EMBEDDING_MAX_REQUEST_BYTES) {
            if (!batch.length) throw new EmbeddingError('input', '单个分片超过向量请求大小限制，请用较小分片重新上传。')
            break
        }
        batch.push(input)
    }
    return batch
}

/**
 * Distinguishes JSON objects from arrays and scalar protocol fields.
 * @param value - Parsed JSON field.
 * @returns Whether named properties may be read from the value.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Produces a generic protocol error that never includes the remote payload.
 * @returns A safe response validation failure.
 */
function protocolFailure(): EmbeddingError {
    return new EmbeddingError('protocol', '向量接口响应不兼容：需要完整的 model、结果序号和同维有效向量，请检查是否选择了 Embedding 模型。')
}

/**
 * Validates every result and rounds to the actual PostgreSQL vector storage precision.
 * @param value - Decoded provider JSON.
 * @param count - Exact number of requested texts.
 * @returns Ordered finite, nonzero float32 vectors and their declared model.
 * @throws EmbeddingError for malformed, incomplete, excessive, or unusable vectors.
 */
function parseEmbeddingResult(value: unknown, count: number): EmbeddingResult {
    if (
        !isRecord(value) ||
        typeof value.model !== 'string' ||
        !value.model.trim() ||
        value.model.length > 512 ||
        !Array.isArray(value.data) ||
        value.data.length !== count
    )
        throw protocolFailure()
    const vectors: number[][] = new Array(count)
    const seen = new Set<number>()
    let dimensions = 0
    for (const item of value.data) {
        if (
            !isRecord(item) ||
            typeof item.index !== 'number' ||
            !Number.isInteger(item.index) ||
            item.index < 0 ||
            item.index >= count ||
            seen.has(item.index) ||
            !Array.isArray(item.embedding) ||
            !item.embedding.length ||
            item.embedding.length > EMBEDDING_MAX_DIMENSIONS
        )
            throw protocolFailure()
        const vector: number[] = []
        for (const component of item.embedding) {
            if (typeof component !== 'number' || !Number.isFinite(component)) throw protocolFailure()
            const stored = Math.fround(component)
            if (!Number.isFinite(stored)) throw protocolFailure()
            vector.push(stored)
        }
        if (!vector.some(component => component !== 0) || (dimensions && dimensions !== vector.length)) throw protocolFailure()
        dimensions = vector.length
        vectors[item.index] = vector
        seen.add(item.index)
    }
    if (seen.size !== count) throw protocolFailure()
    return { model: value.model.trim(), dimensions, vectors }
}

/**
 * Reads a strict UTF-8 JSON response within the embedding-specific byte ceiling.
 * @param response - Successful provider response with an unread body.
 * @param signal - Combined caller and deadline cancellation.
 * @returns Parsed JSON without exposing it to public responses.
 * @throws EmbeddingError for oversized or malformed response bodies.
 */
async function readEmbeddingResponse(response: Response, signal: AbortSignal): Promise<unknown> {
    if (!response.body) throw protocolFailure()
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    /**
     * Stops an in-flight response read when its caller or deadline aborts.
     * @returns Nothing after requesting cancellation of the owned reader.
     */
    function abortRead(): void {
        void reader.cancel().catch(() => undefined)
    }
    signal.addEventListener('abort', abortRead, { once: true })
    try {
        signal.throwIfAborted()
        for (;;) {
            const chunk = await reader.read()
            signal.throwIfAborted()
            if (chunk.done) break
            size += chunk.value.byteLength
            if (size > EMBEDDING_MAX_RESPONSE_BYTES) {
                await reader.cancel()
                throw new EmbeddingError('protocol', '向量接口响应超过 2 MiB，请减少批次或使用合适的向量模型。')
            }
            chunks.push(chunk.value)
        }
        try {
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)))
        } catch {
            throw protocolFailure()
        }
    } finally {
        signal.removeEventListener('abort', abortRead)
        reader.releaseLock()
    }
}

/**
 * Calls a real OpenAI-compatible embedding endpoint using the existing protected transport.
 * @param connection - Authorized private embedding configuration, separate from chat models.
 * @param inputs - Complete source texts fitting one bounded batch.
 * @param options - Cancellation, trusted address policy, and explicitly injected test transport.
 * @returns The provider's declared model and ordered PostgreSQL-compatible vectors.
 * @throws EmbeddingError for input, authentication, concurrency, provider, or protocol failures.
 */
export async function createEmbeddings(
    connection: EmbeddingConnection,
    inputs: readonly string[],
    options: EmbeddingOptions = {}
): Promise<EmbeddingResult> {
    const baseUrl = validateEmbeddingBaseUrl(connection.baseUrl, options)
    if (!connection.model.trim() || connection.model.length > 120 || !connection.apiKey.trim() || connection.apiKey.length > 8192)
        throw new EmbeddingError('input', '请配置有效的向量模型标识和 API Key。')
    if (!inputs.length || inputs.length > EMBEDDING_MAX_INPUTS) throw new EmbeddingError('input', '每次向量请求须包含 1–16 条文本。')
    for (const input of inputs) requireText(input)
    const body = embeddingBody(connection.model, inputs)
    if (Buffer.byteLength(body, 'utf8') > EMBEDDING_MAX_REQUEST_BYTES)
        throw new EmbeddingError('input', '向量请求超过 64 KiB，请减少批次或用较小分片重新上传。')
    if (options.signal?.aborted) throw new EmbeddingError('cancelled', '向量请求已取消。')
    if (activeEmbeddingRequests >= EMBEDDING_MAX_CONCURRENCY) throw new EmbeddingError('rate_limit', '向量请求较多，请稍后重试。')
    const controller = new AbortController()
    let timedOut = false
    /**
     * Propagates caller cancellation without reflecting its potentially private reason.
     * @returns Nothing after aborting the owned request.
     */
    function abortRequest(): void {
        controller.abort()
    }
    options.signal?.addEventListener('abort', abortRequest, { once: true })
    const requestedTimeout = options.timeoutMs ?? EMBEDDING_TIMEOUT_MS
    const timeoutMs = Number.isFinite(requestedTimeout)
        ? Math.max(1, Math.min(requestedTimeout, EMBEDDING_TIMEOUT_MS))
        : EMBEDDING_TIMEOUT_MS
    const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
    }, timeoutMs)
    timer.unref()
    activeEmbeddingRequests += 1
    try {
        const send = options.transport ?? createModelFetch(options)
        const response = await send(`${baseUrl}/embeddings`, {
            method: 'POST',
            headers: { authorization: `Bearer ${connection.apiKey}`, 'content-type': 'application/json' },
            body,
            signal: controller.signal,
        })
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined)
            if (response.status === 401 || response.status === 403)
                throw new EmbeddingError('authentication', '向量模型鉴权失败，请检查 API Key 和模型访问权限。')
            if (response.status === 429) throw new EmbeddingError('rate_limit', '向量服务限流，请稍后重试。')
            if (response.status === 400 || response.status === 413 || response.status === 422)
                throw new EmbeddingError('input', '向量服务拒绝了请求，请检查模型标识或输入长度；可缩短查询，或用较小分片重新上传。')
            if (response.status === 404 || response.status === 405)
                throw new EmbeddingError('connection', '未找到 Embedding 接口或模型，请检查 API 根地址和专用向量模型标识。')
            throw new EmbeddingError('connection', '向量服务暂时不可用，请稍后重试。')
        }
        return parseEmbeddingResult(await readEmbeddingResponse(response, controller.signal), inputs.length)
    } catch (cause) {
        if (options.signal?.aborted) throw new EmbeddingError('cancelled', '向量请求已取消。')
        if (timedOut) throw new EmbeddingError('timeout', '向量请求超时，请稍后重试。')
        if (cause instanceof EmbeddingError) throw cause
        throw new EmbeddingError('connection', '无法连接向量服务，请检查接口地址、网络和服务状态后重试。')
    } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', abortRequest)
        activeEmbeddingRequests -= 1
    }
}
