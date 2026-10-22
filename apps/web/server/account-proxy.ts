interface AccountProxyConfig {
    token: string
    apiUrl: string
    fetch: typeof fetch
}

const sessionCookie = 'harness_account_session'

/**
 * Forwards an expected workspace as a consistency check, never an authorization claim.
 * @param request - Browser request whose workspace will be verified again by the API.
 * @returns The bounded optional context header for the authenticated upstream request.
 */
export function contextExpectation(request: Request): Record<string, string> {
    const context = request.headers.get('X-Harness-Context')
    return context && /^[A-Za-z0-9_-]{1,128}$/.test(context) ? { 'X-Harness-Context': context } : {}
}

/**
 * Extract only the opaque account cookie without accepting anonymous identities.
 * @param request - Incoming browser request with untrusted cookies.
 * @returns The session token, or an empty string for missing or malformed cookies.
 */
export function readAccountSession(request: Request): string {
    const value =
        (request.headers.get('cookie') ?? '')
            .split(';')
            .map(item => item.trim())
            .find(item => item.startsWith(`${sessionCookie}=`))
            ?.slice(sessionCookie.length + 1) ?? ''
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''
}

/**
 * Serialize a private account cookie with matching deletion attributes.
 * @param request - Browser-facing request used to determine secure transport.
 * @param token - Opaque server token, empty to delete an expired session.
 * @returns A HttpOnly cookie that JavaScript cannot read.
 */
export function accountCookie(request: Request, token = ''): string {
    const secure = process.env.NODE_ENV === 'production' || new URL(request.url).protocol === 'https:'
    return `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 604800 : 0}${secure ? '; Secure' : ''}`
}

/**
 * Verify browser mutation origin while accounting for Next's internal hostname.
 * @param request - Incoming same-origin request.
 * @returns Whether its Origin matches the browser-facing Host.
 */
export function hasSameOrigin(request: Request): boolean {
    const url = new URL(request.url)
    if (request.headers.get('host')) url.host = request.headers.get('host')!
    return request.headers.get('origin') === url.origin
}

/**
 * Reads bounded account JSON while cancelling stalled transfers on disconnect or timeout.
 * @param request - Untrusted browser mutation.
 * @param signal - Browser and proxy deadline cancellation.
 * @returns UTF-8 body text, or null for an oversized transfer.
 * @throws Error when reading fails or the transfer is cancelled.
 */
async function readBoundedAccountBody(request: Request, signal: AbortSignal): Promise<string | null> {
    if (!request.body) return ''
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    /**
     * Releases a stalled body read without waiting for an untrusted producer.
     * @returns Nothing after signalling reader cancellation.
     */
    function cancel(): void {
        void reader.cancel().catch(() => undefined)
    }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try {
        while (true) {
            const result = await reader.read()
            if (signal.aborted) throw new Error('Account transfer cancelled.')
            if (result.done) break
            length += result.value.byteLength
            if (length > 262144) {
                cancel()
                return null
            }
            chunks.push(result.value)
        }
        return Buffer.concat(chunks, length).toString('utf8')
    } finally {
        signal.removeEventListener('abort', cancel)
        reader.releaseLock()
    }
}

/**
 * Forward a fixed account operation without exposing private service headers.
 * @param request - Incoming browser request.
 * @param segments - Decoded route components under /api/account.
 * @param overrides - Explicit private configuration for integration tests.
 * @returns A safe API response and, when needed, an HttpOnly account cookie.
 */
export async function proxyAccountRequest(
    request: Request,
    segments: string[],
    overrides: Partial<AccountProxyConfig> = {}
): Promise<Response> {
    const config: AccountProxyConfig = {
        token: process.env.HARNESS_API_TOKEN?.trim() ?? '',
        apiUrl: process.env.HARNESS_API_URL ?? 'http://127.0.0.1:3001',
        fetch,
        ...overrides,
    }
    const path = segments.join('/')
    const workspaceRoute =
        (request.method === 'GET' && /^workspaces(?:\/[A-Za-z0-9_-]{1,128})?$/.test(path)) ||
        (request.method === 'POST' &&
            /^workspaces(?:\/[A-Za-z0-9_-]{1,128}\/(?:switch|invitations|leave)|\/invitations\/[0-9a-f-]{36}\/respond)?$/i.test(path)) ||
        (request.method === 'PUT' && /^workspaces\/[A-Za-z0-9_-]{1,128}$/.test(path)) ||
        (request.method === 'DELETE' && /^workspaces\/[A-Za-z0-9_-]{1,128}\/(?:invitations|members)\/[0-9a-f-]{36}$/i.test(path))
    const allowed =
        request.method === 'GET'
            ? /^(me|(?:models|embedding-models)(?:\/[0-9a-f-]{36})?)$/i.test(path)
            : request.method === 'POST'
              ? /^(register|login|logout|(?:models|embedding-models)(?:\/[0-9a-f-]{36}\/(default|test))?)$/i.test(path)
              : request.method === 'PUT'
                ? /^(username|email|password|(?:models|embedding-models)\/[0-9a-f-]{36})$/i.test(path)
                : request.method === 'DELETE' && /^(?:models|embedding-models)\/[0-9a-f-]{36}$/i.test(path)
    if (!allowed && !workspaceRoute) return Response.json({ message: '未找到该账户接口。' }, { status: 404 })
    if (config.token.length < 32) return Response.json({ message: '账户服务尚未连接。' }, { status: 503 })
    if (request.method !== 'GET' && !hasSameOrigin(request))
        return Response.json({ message: '无法验证请求来源，请刷新后重试。' }, { status: 403 })
    const session = readAccountSession(request)
    if (!session && !['register', 'login'].includes(path))
        return Response.json(
            { message: '请先登录。' },
            { status: 401, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': accountCookie(request) } }
        )
    const controller = new AbortController()
    /**
     * Cancel the account request when its browser consumer disconnects.
     * @returns Nothing after signalling upstream cancellation.
     */
    function abort(): void {
        controller.abort()
    }
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) controller.abort()
    const timer = setTimeout(
        () => controller.abort(),
        path.startsWith('embedding-models/') && path.endsWith('/test') ? 35_000 : path.endsWith('/test') ? 20_000 : 30_000
    )
    try {
        let body: string | undefined
        if (!['GET', 'DELETE'].includes(request.method)) {
            if (Number(request.headers.get('content-length')) > 262144) return Response.json({ message: '提交内容过长。' }, { status: 413 })
            const bytes = await readBoundedAccountBody(request, controller.signal)
            if (bytes === null) return Response.json({ message: '提交内容过长。' }, { status: 413 })
            if (bytes) body = bytes
        }
        const upstream = await config.fetch(`${config.apiUrl.replace(/\/$/, '')}/api/account/${path}`, {
            method: request.method,
            headers: {
                authorization: `Bearer ${config.token}`,
                'X-Harness-Session': session,
                'content-type': 'application/json',
                ...contextExpectation(request),
            },
            ...(body === undefined ? {} : { body }),
            signal: controller.signal,
            cache: 'no-store',
            redirect: 'error',
        })
        const headers = new Headers({
            'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
            'Cache-Control': 'no-store',
            ...(upstream.headers.get('X-Harness-Context-Changed') === '1' ? { 'X-Harness-Context-Changed': '1' } : {}),
        })
        const issued = upstream.headers.get('x-harness-session')
        if (upstream.ok && issued && /^[A-Za-z0-9_-]{43}$/.test(issued)) headers.set('Set-Cookie', accountCookie(request, issued))
        else if (upstream.status === 401 || (upstream.ok && ['logout', 'email', 'password'].includes(path)))
            headers.set('Set-Cookie', accountCookie(request))
        return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers })
    } catch {
        return Response.json(
            { message: request.signal.aborted ? '请求已取消。' : '暂时无法连接账户服务，请稍后重试。' },
            { status: 502, headers: { 'Cache-Control': 'no-store' } }
        )
    } finally {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', abort)
    }
}
