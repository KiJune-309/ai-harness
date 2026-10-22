import { KNOWLEDGE_MAX_BODY_SIZE } from '@ai-harness/contracts'
import { accountCookie, contextExpectation, hasSameOrigin, readAccountSession } from './account-proxy'

interface KnowledgeProxyConfig {
    token: string
    apiUrl: string
    fetch: typeof fetch
}

const uploadBodyLimit = KNOWLEDGE_MAX_BODY_SIZE
// This counter bounds only concurrent request buffering; PostgreSQL owns all saved document records.
let activeUploads = 0
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * Returns an uncached public failure without reflecting private upstream details.
 * @param message - Safe actionable explanation.
 * @param status - HTTP status code.
 * @returns The browser-facing JSON failure.
 */
function failure(message: string, status: number): Response {
    return Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Reads a bounded request body without trusting its declared Content-Length.
 * @param request - Untrusted browser request.
 * @param limit - Maximum accepted bytes, including multipart framing.
 * @param signal - Combined browser disconnect and transfer deadline signal.
 * @returns The complete body, or null after cancelling an oversized stream.
 * @throws Error if reading the browser stream fails.
 */
async function readBody(request: Request, limit: number, signal: AbortSignal): Promise<ArrayBuffer | null> {
    if (!request.body) return new ArrayBuffer(0)
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    /**
     * Releases a stalled local body reader when its browser or deadline is cancelled.
     * @returns Nothing after cancelling queued stream reads.
     */
    function cancel(): void {
        void reader.cancel().catch(() => undefined)
    }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try {
        while (true) {
            const result = await reader.read()
            if (signal.aborted) throw new Error('Upload cancelled.')
            if (result.done) break
            length += result.value.byteLength
            if (length > limit) {
                void reader.cancel().catch(() => undefined)
                return null
            }
            chunks.push(result.value)
        }
    } finally {
        signal.removeEventListener('abort', cancel)
        reader.releaseLock()
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }
    return bytes.buffer
}

/**
 * Forwards fixed knowledge operations with a verified account session and bounded uploads.
 * @param request - Same-origin browser request without trusted identity headers.
 * @param segments - Decoded route components under /api/knowledge.
 * @param overrides - Explicit private server configuration for isolated tests.
 * @returns The safe JSON or attachment response, without private service headers.
 */
export async function proxyKnowledgeRequest(
    request: Request,
    segments: string[],
    overrides: Partial<KnowledgeProxyConfig> = {}
): Promise<Response> {
    const config: KnowledgeProxyConfig = {
        token: process.env.HARNESS_API_TOKEN?.trim() ?? '',
        apiUrl: process.env.HARNESS_API_URL ?? 'http://127.0.0.1:3001',
        fetch,
        ...overrides,
    }
    const path = segments.join('/')
    const allowedRead = new RegExp(`^(status|vector-status|documents(?:/${uuidPattern}(?:/(?:chunks|file|index))?)?)$`, 'i').test(path)
    const upload = request.method === 'POST' && path === 'documents'
    const retry = request.method === 'POST' && new RegExp(`^documents/${uuidPattern}/(?:retry|index(?:/retry)?)$`, 'i').test(path)
    const search = request.method === 'POST' && path === 'search'
    if (!((request.method === 'GET' && allowedRead) || upload || retry || search)) return failure('未找到该资料库接口。', 404)
    if (config.token.length < 32) return failure('资料库服务尚未连接。', 503)
    if (request.method !== 'GET' && !hasSameOrigin(request)) return failure('无法验证请求来源，请刷新后重试。', 403)
    const session = readAccountSession(request)
    if (!session) return failure('请先登录。', 401)
    const url = new URL(request.url)
    if ([...url.searchParams.keys()].some(key => !['page', 'pageSize', 'query', 'projectFolderId'].includes(key)))
        return failure('资料库查询参数无效。', 400)
    const contentType = request.headers.get('content-type') ?? ''
    if (upload && !/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) return failure('请选择文件后上传。', 415)
    if ((retry || search) && !/^application\/json(?:\s*;|$)/i.test(contentType)) return failure('重试参数无效。', 415)
    const limit = upload ? uploadBodyLimit : search ? 32 * 1024 : 1024
    if (request.method === 'POST' && Number(request.headers.get('content-length')) > limit)
        return failure('提交内容超过大小限制，请缩小文件后重试。', 413)
    if (upload && activeUploads >= 4) return failure('同时上传的资料较多，请稍后重试。', 429)
    if (upload) activeUploads += 1
    const controller = new AbortController()
    /**
     * Cancels the upstream transfer when the browser disconnects.
     * @returns Nothing after signalling cancellation.
     */
    function abort(): void {
        controller.abort()
    }
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) controller.abort()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
        const body = request.method === 'POST' ? await readBody(request, limit, controller.signal) : undefined
        if (body === null) return failure('提交内容超过大小限制，请缩小文件后重试。', 413)
        const upstream = await config.fetch(`${config.apiUrl.replace(/\/$/, '')}/api/knowledge/${path}${url.search}`, {
            method: request.method,
            headers: {
                Authorization: `Bearer ${config.token}`,
                'X-Harness-Session': session,
                ...contextExpectation(request),
                ...(request.method === 'POST' ? { 'Content-Type': contentType } : {}),
            },
            ...(body === undefined ? {} : { body }),
            signal: controller.signal,
            cache: 'no-store',
            redirect: 'error',
        })
        const headers = new Headers({
            'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...(upstream.headers.get('X-Harness-Context-Changed') === '1' ? { 'X-Harness-Context-Changed': '1' } : {}),
            ...(upstream.status === 401 ? { 'Set-Cookie': accountCookie(request) } : {}),
        })
        if (path.endsWith('/file') && upstream.ok) {
            const disposition = upstream.headers.get('content-disposition') ?? ''
            headers.set('Content-Disposition', /^attachment(?:;|$)/i.test(disposition) ? disposition : 'attachment')
        }
        return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers })
    } catch {
        return failure(request.signal.aborted ? '请求已取消。' : '暂时无法连接资料库服务，请稍后重试。', 502)
    } finally {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', abort)
        if (upload) activeUploads -= 1
    }
}
