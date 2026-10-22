import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { proxyKnowledgeRequest } from '../../server/knowledge-proxy'

const token = 'knowledge-private-service-fixture-token-2026'
const session = randomBytes(32).toString('base64url')
const id = randomUUID()

/**
 * Creates one same-origin knowledge request with a real opaque session fixture.
 * @param method - Allowed or deliberately rejected HTTP method.
 * @param body - Multipart or JSON request bytes.
 * @param headers - Explicit untrusted browser header overrides.
 * @returns A browser-facing request for the proxy boundary.
 */
function browser(method = 'GET', body?: BodyInit, headers: Record<string, string> = {}): Request {
    return new Request('https://harness.example/api/knowledge/documents?page=2&pageSize=20&query=hello', {
        method,
        headers: {
            origin: 'https://harness.example',
            cookie: `harness_account_session=${session}`,
            ...(method === 'POST' ? { 'content-type': 'multipart/form-data; boundary=fixture-boundary' } : {}),
            ...headers,
        },
        ...(body === undefined ? {} : { body }),
    })
}

/**
 * Binds a private upstream without making its credentials browser-visible.
 * @param upstream - Observable isolated HTTP transport.
 * @returns The proxy's private fixture configuration.
 */
function configuration(upstream: typeof fetch) {
    return { token, apiUrl: 'http://private-api.example/', fetch: upstream }
}

describe('knowledge same-origin boundary', () => {
    it('forwards only private service and account headers while preserving exact multipart bytes', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ saved: true }, { headers: { 'x-private-key': token } }))
        const bytes = new Uint8Array([0, 1, 2, 255, 42])
        const response = await proxyKnowledgeRequest(
            browser('POST', bytes, { 'x-harness-user-id': randomUUID(), authorization: 'Bearer attacker' }),
            ['documents'],
            configuration(upstream)
        )
        expect(response.status).toBe(200)
        expect(upstream.mock.calls[0]![0]).toBe('http://private-api.example/api/knowledge/documents?page=2&pageSize=20&query=hello')
        const options = upstream.mock.calls[0]![1]!
        const headers = new Headers(options.headers)
        expect(headers.get('authorization')).toBe(`Bearer ${token}`)
        expect(headers.get('x-harness-session')).toBe(session)
        expect(headers.get('content-type')).toBe('multipart/form-data; boundary=fixture-boundary')
        expect(headers.get('cookie')).toBeNull()
        expect(headers.get('x-harness-user-id')).toBeNull()
        expect(new Uint8Array(options.body as ArrayBuffer)).toEqual(bytes)
        expect(options.cache).toBe('no-store')
        expect(options.redirect).toBe('error')
        expect(response.headers.get('x-private-key')).toBeNull()
        expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('rejects unlisted paths, methods, malformed IDs, session impersonation and cross-origin mutations', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({}))
        for (const segments of [['private'], ['documents', 'wrong-id'], ['documents', id, 'delete'], ['documents', id, '..', 'file']]) {
            expect((await proxyKnowledgeRequest(browser(), segments, configuration(upstream))).status).toBe(404)
        }
        expect((await proxyKnowledgeRequest(browser('DELETE'), ['documents', id], configuration(upstream))).status).toBe(404)
        expect(
            (
                await proxyKnowledgeRequest(
                    browser('POST', '{}', { origin: 'https://attacker.example' }),
                    ['documents'],
                    configuration(upstream)
                )
            ).status
        ).toBe(403)
        expect(
            (
                await proxyKnowledgeRequest(
                    browser('GET', undefined, { cookie: '', 'x-harness-user-id': randomUUID() }),
                    ['documents'],
                    configuration(upstream)
                )
            ).status
        ).toBe(401)
        expect((await proxyKnowledgeRequest(browser(), ['documents'], { ...configuration(upstream), token: '' })).status).toBe(503)
        expect(upstream).not.toHaveBeenCalled()
    })

    it('rejects oversized declared bodies and incorrect content types before reading or forwarding', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({}))
        for (const [headers, expected] of [
            [{ 'content-length': String(10 * 1024 * 1024 + 64 * 1024 + 1) }, 413],
            [{ 'content-type': 'application/json' }, 415],
        ] as [Record<string, string>, number][]) {
            const request = browser('POST', '{}', headers)
            const read = vi.spyOn(request, 'body', 'get')
            expect((await proxyKnowledgeRequest(request, ['documents'], configuration(upstream))).status).toBe(expected)
            expect(read).not.toHaveBeenCalled()
        }
        expect(upstream).not.toHaveBeenCalled()
    })

    it('preserves retry identifiers and never treats JSON retry as a multipart upload', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ status: 'queued' }))
        const requestId = randomUUID()
        const response = await proxyKnowledgeRequest(
            browser('POST', JSON.stringify({ requestId }), { 'content-type': 'application/json' }),
            ['documents', id, 'retry'],
            configuration(upstream)
        )
        expect(response.ok).toBe(true)
        expect(JSON.parse(new TextDecoder().decode(upstream.mock.calls[0]![1]!.body as ArrayBuffer))).toEqual({ requestId })
        expect(new Headers(upstream.mock.calls[0]![1]!.headers).get('content-type')).toBe('application/json')
    })

    it('downloads original binary bytes with only safe attachment headers and clears rejected sessions', async () => {
        const bytes = new Uint8Array([37, 80, 68, 70, 0, 255])
        const response = await proxyKnowledgeRequest(
            browser(),
            ['documents', id, 'file'],
            configuration(
                async () =>
                    new Response(bytes, {
                        headers: {
                            'content-type': 'application/pdf',
                            'content-disposition': 'attachment; filename="source.pdf"',
                            'x-private-session': session,
                        },
                    })
            )
        )
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="source.pdf"')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(response.headers.get('x-private-session')).toBeNull()
        const expired = await proxyKnowledgeRequest(
            browser(),
            ['documents'],
            configuration(async () => Response.json({ message: 'expired' }, { status: 401 }))
        )
        expect(expired.headers.get('set-cookie')).toContain('Max-Age=0')
        const failed = await proxyKnowledgeRequest(
            browser(),
            ['documents'],
            configuration(async () => {
                throw new Error(token)
            })
        )
        expect(failed.status).toBe(502)
        expect(await failed.text()).not.toContain(token)
    })

    it('bounds upload buffering to four requests and releases admission after failure', async () => {
        const releases: (() => void)[] = []
        const upstream = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => releases.push(() => resolve(Response.json({})))))
        const uploads = Array.from({ length: 4 }, () =>
            proxyKnowledgeRequest(browser('POST', 'file'), ['documents'], configuration(upstream))
        )
        await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(4))
        const extra = browser('POST', 'unread')
        const read = vi.spyOn(extra, 'body', 'get')
        expect((await proxyKnowledgeRequest(extra, ['documents'], configuration(upstream))).status).toBe(429)
        expect(read).not.toHaveBeenCalled()
        expect(
            (
                await proxyKnowledgeRequest(
                    browser(),
                    ['status'],
                    configuration(async () => Response.json({}))
                )
            ).ok
        ).toBe(true)
        for (const release of releases) release()
        await Promise.all(uploads)
        expect(
            (
                await proxyKnowledgeRequest(
                    browser('POST', 'next'),
                    ['documents'],
                    configuration(async () => {
                        throw new Error('failure')
                    })
                )
            ).status
        ).toBe(502)
        expect(
            (
                await proxyKnowledgeRequest(
                    browser('POST', 'next'),
                    ['documents'],
                    configuration(async () => Response.json({}))
                )
            ).ok
        ).toBe(true)
    })
})
