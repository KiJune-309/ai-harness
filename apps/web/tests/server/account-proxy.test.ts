import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { proxyAccountRequest } from '../../server/account-proxy'

const token = 'private-account-bff-fixture-token-2026'
const session = randomBytes(32).toString('base64url')

/**
 * Create a real same-origin account request with an optional session.
 * @param method - HTTP operation.
 * @param headers - Explicit untrusted browser header overrides.
 * @returns The incoming request used by the BFF.
 */
function browser(method = 'GET', headers: Record<string, string> = {}): Request {
    return new Request('https://harness.example/api/account/me', {
        method,
        headers: { origin: 'https://harness.example', cookie: `harness_account_session=${session}`, ...headers },
        ...(!['GET', 'DELETE'].includes(method) ? { body: '{}' } : {}),
    })
}

/**
 * Bind a private upstream fixture without exposing its service credential.
 * @param request - Observable provider-independent API transport.
 * @returns Explicit BFF server configuration.
 */
function configuration(request: typeof fetch) {
    return { token, apiUrl: 'http://private-api.example', fetch: request }
}

describe('account BFF session boundary', () => {
    it('moves the private login token into a secure HttpOnly cookie and strips private upstream headers', async () => {
        const upstream = vi.fn<typeof fetch>(async () =>
            Response.json(
                { username: 'A' },
                { headers: { 'x-harness-session': session, 'x-private-secret': token, 'set-cookie': 'unexpected=secret' } }
            )
        )
        const response = await proxyAccountRequest(
            browser('POST', { cookie: '', 'x-harness-user-id': randomUUID() }),
            ['login'],
            configuration(upstream)
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('set-cookie')).toContain(
            `harness_account_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800; Secure`
        )
        expect(response.headers.get('x-harness-session')).toBeNull()
        expect(response.headers.get('x-private-secret')).toBeNull()
        expect(JSON.stringify(await response.json())).not.toContain(session)
        const headers = new Headers(upstream.mock.calls[0]![1]!.headers)
        expect(headers.get('authorization')).toBe(`Bearer ${token}`)
        expect(headers.get('x-harness-user-id')).toBeNull()
        expect(upstream.mock.calls[0]![1]!.redirect).toBe('error')
    })

    it('rejects private reads without a real account cookie and never accepts an anonymous identity', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({}))
        for (const cookie of ['', `harness_chat_session=${randomUUID()}.old-proof`, 'harness_account_session=malformed']) {
            expect((await proxyAccountRequest(browser('GET', { cookie }), ['me'], configuration(upstream))).status).toBe(401)
        }
        expect(upstream).not.toHaveBeenCalled()
    })

    it('protects every mutation from cross-origin calls and rejects unlisted paths before forwarding', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({}))
        for (const path of ['login', 'register', 'password', 'models'])
            expect(
                (
                    await proxyAccountRequest(
                        browser(path === 'password' ? 'PUT' : 'POST', { origin: 'https://attacker.example' }),
                        [path],
                        configuration(upstream)
                    )
                ).status
            ).toBe(403)
        expect((await proxyAccountRequest(browser('GET'), ['private-settings'], configuration(upstream))).status).toBe(404)
        expect(
            (await proxyAccountRequest(browser('POST', { 'content-length': '262145' }), ['login'], configuration(upstream))).status
        ).toBe(413)
        expect(upstream).not.toHaveBeenCalled()
    })

    it('only clears cookies after confirmed logout or sensitive updates and after API session rejection', async () => {
        for (const path of ['logout', 'email', 'password']) {
            const method = path === 'logout' ? 'POST' : 'PUT'
            const response = await proxyAccountRequest(
                browser(method),
                [path],
                configuration(async () => Response.json({ success: true }))
            )
            expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
            const failed = await proxyAccountRequest(
                browser(method),
                [path],
                configuration(async () => Response.json({ message: 'failed' }, { status: 400 }))
            )
            expect(failed.headers.get('set-cookie')).toBeNull()
        }
        const expired = await proxyAccountRequest(
            browser(),
            ['me'],
            configuration(async () => Response.json({ message: 'expired' }, { status: 401 }))
        )
        expect(expired.headers.get('set-cookie')).toContain('Max-Age=0')
    })

    it('allows only fixed owned model operations and passes the account cookie instead of identity headers', async () => {
        const id = randomUUID()
        for (const [method, segments] of [
            ['GET', ['models']],
            ['POST', ['models']],
            ['PUT', ['models', id]],
            ['DELETE', ['models', id]],
            ['POST', ['models', id, 'default']],
            ['POST', ['models', id, 'test']],
        ] as [string, string[]][]) {
            const upstream = vi.fn<typeof fetch>(async () => Response.json({ success: true }))
            const response = await proxyAccountRequest(browser(method), segments, configuration(upstream))
            expect(response.ok).toBe(true)
            const headers = new Headers(upstream.mock.calls[0]![1]!.headers)
            expect(headers.get('x-harness-session')).toBe(session)
            expect(headers.has('cookie')).toBe(false)
            expect(headers.has('x-harness-user-id')).toBe(false)
        }
    })

    it('redacts connection failures and cancels a disconnected browser request', async () => {
        const failed = await proxyAccountRequest(
            browser(),
            ['me'],
            configuration(async () => {
                throw new Error(`private: ${token}`)
            })
        )
        expect(failed.status).toBe(502)
        expect(await failed.text()).not.toContain(token)
        const controller = new AbortController()
        let upstreamSignal: AbortSignal | undefined
        const request = new Request(browser('POST'), { signal: controller.signal })
        const response = proxyAccountRequest(
            request,
            ['models', randomUUID(), 'test'],
            configuration(async (_url, init) => {
                upstreamSignal = init!.signal!
                controller.abort()
                return Response.json({ success: true })
            })
        )
        await response
        expect(upstreamSignal?.aborted).toBe(true)
    })
})
