import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

interface ChatProxyConfig {
    token: string
    apiUrl: string
    workspaceId: string
    fetch: typeof fetch
}

const sessionCookie = 'harness_chat_session'

/**
 * Sign one anonymous local-user identity with the server-only credential.
 * @param id - Cryptographically random browser identity.
 * @param token - Private Web/API credential.
 * @returns A signature that cannot be changed by browser-controlled headers.
 */
function signature(id: string, token: string): string {
    return createHmac('sha256', token).update(`harness-chat-session:${id}`).digest('hex')
}

/**
 * Recover a valid signed browser identity or mint a new isolated one.
 * @param request - Browser request whose cookies are untrusted input.
 * @param token - Private signing credential.
 * @returns An identity and its signed cookie value.
 */
function browserIdentity(request: Request, token: string): { id: string; cookie: string } {
    const value = (request.headers.get('cookie') || '')
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${sessionCookie}=`))
        ?.slice(sessionCookie.length + 1)
    if (value) {
        const [id, proof, extra] = value.split('.')
        if (id && /^[0-9a-f-]{36}$/i.test(id) && proof && /^[0-9a-f]{64}$/.test(proof) && extra === undefined) {
            const expected = Buffer.from(signature(id, token), 'hex')
            const actual = Buffer.from(proof, 'hex')
            if (actual.length === expected.length && timingSafeEqual(actual, expected)) return { id, cookie: value }
        }
    }
    const id = randomUUID()
    return { id, cookie: `${id}.${signature(id, token)}` }
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
    const allowedGet =
        /^(status|conversations(?:\/[0-9a-f-]{36})?|agents(?:\/catalog|\/[0-9a-f-]{36})?|tasks(?:\/[0-9a-f-]{36})?|projects(?:\/[0-9a-f-]{36})?|templates(?:\/[0-9a-f-]{36})?)$/i.test(
            path
        )
    const allowedPost =
        /^(conversations|conversations\/[0-9a-f-]{36}\/(messages|cancel)|agents|projects|templates|templates\/[0-9a-f-]{36}\/launch|tasks|tasks\/[0-9a-f-]{36}\/(start|messages|cancel))$/i.test(
            path
        )
    const allowedPut =
        /^(agents\/[0-9a-f-]{36}|projects\/[0-9a-f-]{36}|templates\/[0-9a-f-]{36}|tasks\/[0-9a-f-]{36}\/(status|project))$/i.test(path)
    if (!(
        (request.method === 'GET' && allowedGet) ||
        (request.method === 'POST' && allowedPost) ||
        (request.method === 'PUT' && allowedPut)
    ))
        return failure('未找到该聊天接口。', 404)
    // Next may construct request.url with its internal hostname; Host retains the browser-facing origin.
    const browserUrl = new URL(request.url)
    if (request.headers.get('host')) browserUrl.host = request.headers.get('host')!
    if (request.method !== 'GET' && request.headers.get('origin') !== browserUrl.origin)
        return failure('无法验证请求来源，请刷新页面后重试。', 403)
    const identity = browserIdentity(request, config.token)
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
        const upstream = await config.fetch(`${config.apiUrl.replace(/\/$/, '')}/api/chat/${path}`, {
            method: request.method,
            headers: {
                Authorization: `Bearer ${config.token}`,
                'X-Harness-User-Id': identity.id,
                'X-Harness-Workspace-Id': config.workspaceId,
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
            'X-Accel-Buffering': 'no',
            'Set-Cookie': `${sessionCookie}=${identity.cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
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
