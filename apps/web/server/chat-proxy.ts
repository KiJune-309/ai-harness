import { accountCookie, contextExpectation, hasSameOrigin, readAccountSession } from './account-proxy'

interface ChatProxyConfig {
    token: string
    apiUrl: string
    workspaceId: string
    fetch: typeof fetch
}

/**
 * Return a safe JSON failure without reflecting upstream errors or credentials.
 * @param message - Actionable public error.
 * @param status - HTTP status.
 * @returns An uncached error response.
 */
function failure(message: string, status: number): Response {
    return Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Forward an allowed chat request with signed server-established identity.
 * @param request - Same-origin browser request.
 * @param segments - Chat route segments already decoded by Next.
 * @param overrides - Explicit server configuration for integration tests.
 * @returns The streaming API response with a private signed browser cookie.
 */
export async function proxyChatRequest(request: Request, segments: string[], overrides: Partial<ChatProxyConfig> = {}): Promise<Response> {
    const config: ChatProxyConfig = {
        token: process.env.HARNESS_API_TOKEN?.trim() || '',
        apiUrl: process.env.HARNESS_API_URL || 'http://127.0.0.1:3001',
        workspaceId: process.env.HARNESS_WORKSPACE_ID?.trim() || 'personal',
        fetch,
        ...overrides,
    }
    if (config.token.length < 32) return failure('聊天服务尚未连接。请使用 pnpm dev 启动完整服务。', 503)
    const path = segments.join('/')
    const collaborationGet =
        /^collaboration\/(people|projects(?:\/[0-9a-f-]{36}(?:\/progress)?)?|nodes(?:\/[0-9a-f-]{36}(?:\/events)?)?|events|source-events|notifications|messages(?:\/[0-9a-f-]{36})?|actions\/[0-9a-f-]{36})$/i.test(
            path
        )
    const allowedGet =
        /^(status|project-folders(?:\/[0-9a-f-]{36})?|skills(?:\/[0-9a-f-]{36}(?:\/versions(?:\/[1-9][0-9]*)?)?)?|conversations(?:\/[0-9a-f-]{36})?|agents(?:\/catalog|\/[0-9a-f-]{36})?|tasks(?:\/[0-9a-f-]{36})?|projects(?:\/[0-9a-f-]{36})?|templates(?:\/[0-9a-f-]{36})?|template-catalog(?:\/[0-9a-f-]{36})?|workflow-templates\/[0-9a-f-]{36})$/i.test(
            path
        )
    const allowedPost =
        /^(project-folders|skills|conversations|conversations\/[0-9a-f-]{36}\/(messages|cancel|human-requests\/[0-9a-f-]{36}\/decisions)|agents|projects|templates|templates\/[0-9a-f-]{36}\/launch|workflow-templates|workflow-templates\/[0-9a-f-]{36}\/(preview|launch)|tasks|tasks\/[0-9a-f-]{36}\/(start|messages|cancel))$/i.test(
            path
        )
    const allowedPut =
        /^(skills\/[0-9a-f-]{36}|agents\/[0-9a-f-]{36}|projects\/[0-9a-f-]{36}|templates\/[0-9a-f-]{36}|workflow-templates\/[0-9a-f-]{36}|tasks\/[0-9a-f-]{36}\/(status|project))$/i.test(
            path
        )
    const allowedDelete = /^conversations\/[0-9a-f-]{36}$/i.test(path)
    if (!(
        (request.method === 'GET' && (allowedGet || collaborationGet)) ||
        (request.method === 'POST' && (allowedPost || path === 'collaboration/commands')) ||
        (request.method === 'PUT' && allowedPut) ||
        (request.method === 'DELETE' && allowedDelete)
    ))
        return failure('未找到该聊天接口。', 404)
    // Next may construct request.url with its internal hostname; Host retains the browser-facing origin.
    if (request.method !== 'GET' && !hasSameOrigin(request)) return failure('无法验证请求来源，请刷新页面后重试。', 403)
    const session = readAccountSession(request)
    if (!session) return failure('请先登录。', 401)
    const controller = new AbortController()
    /**
     * Abort the upstream request when Next observes a disconnected browser.
     * @returns Nothing.
     */
    function abort(): void {
        controller.abort()
    }
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) controller.abort()
    try {
        let body: string | undefined
        if (request.method === 'POST' || request.method === 'PUT') {
            const length = Number(request.headers.get('content-length'))
            if (length > 262144) return failure('消息内容过长，请缩短后重试。', 413)
            body = await request.text()
            if (Buffer.byteLength(body) > 262144) return failure('消息内容过长，请缩短后重试。', 413)
        }
        const query = collaborationGet ? new URL(request.url).search : ''
        const upstream = await config.fetch(`${config.apiUrl.replace(/\/$/, '')}/api/chat/${path}${query}`, {
            method: request.method,
            headers: {
                Authorization: `Bearer ${config.token}`,
                'X-Harness-Session': session,
                ...contextExpectation(request),
                'Content-Type': 'application/json',
                Accept: 'text/event-stream, application/json',
            },
            ...(body === undefined ? {} : { body }),
            signal: controller.signal,
            cache: 'no-store',
            redirect: 'error',
        })
        const headers = new Headers({
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
            'Cache-Control': 'no-store, no-transform',
            ...(upstream.headers.get('X-Harness-Context-Changed') === '1' ? { 'X-Harness-Context-Changed': '1' } : {}),
            'X-Accel-Buffering': 'no',
            ...(upstream.status === 401 ? { 'Set-Cookie': accountCookie(request) } : {}),
        })
        if (!upstream.body) {
            request.signal.removeEventListener('abort', abort)
            return new Response(null, { status: upstream.status, headers })
        }
        const reader = upstream.body.getReader()
        const stream = new ReadableStream<Uint8Array>({
            /**
             * Pull one upstream chunk while preserving streaming backpressure.
             * @param destination - Browser-facing stream controller.
             * @returns After a chunk or terminal state is forwarded.
             */
            async pull(destination): Promise<void> {
                try {
                    const result = await reader.read()
                    if (result.done) {
                        request.signal.removeEventListener('abort', abort)
                        reader.releaseLock()
                        destination.close()
                    } else destination.enqueue(result.value)
                } catch {
                    request.signal.removeEventListener('abort', abort)
                    controller.abort()
                    destination.error(new Error('聊天连接已中断。'))
                }
            },
            /**
             * Cancel upstream generation when the response consumer stops reading.
             * @returns After the provider-facing response reader has been cancelled.
             */
            async cancel(): Promise<void> {
                request.signal.removeEventListener('abort', abort)
                controller.abort()
                await reader.cancel().catch(() => undefined)
            },
        })
        return new Response(stream, { status: upstream.status, headers })
    } catch {
        request.signal.removeEventListener('abort', abort)
        return failure('聊天服务连接失败，请确认 API 已启动后重试。', 502)
    }
}
