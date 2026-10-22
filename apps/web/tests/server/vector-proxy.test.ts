import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { proxyAccountRequest } from '../../server/account-proxy'
import { proxyKnowledgeRequest } from '../../server/knowledge-proxy'

const token = 'private-vector-service-fixture-token-2026'
const session = randomBytes(32).toString('base64url')
const id = randomUUID()

/**
 * Builds a private same-origin JSON mutation or read without forged identity privileges.
 * @param method - Explicit HTTP operation.
 * @param body - Optional actual JSON body bytes.
 * @param headers - Untrusted header overrides.
 * @returns The incoming browser request.
 */
function browser(method = 'GET', body?: string, headers: Record<string, string> = {}) {
    return new Request('https://harness.example/api/knowledge/search', {
        method,
        headers: {
            origin: 'https://harness.example',
            cookie: `harness_account_session=${session}`,
            'content-type': 'application/json',
            ...headers,
        },
        ...(body === undefined ? {} : { body }),
    })
}

/**
 * Creates isolated server credentials and an observable upstream.
 * @param upstream - Private API HTTP transport fixture.
 * @returns Explicit server-only configuration.
 */
function configuration(upstream: typeof fetch) {
    return { token, apiUrl: 'http://private-api.example', fetch: upstream }
}

describe('embedding and vector BFF boundaries', () => {
    it('allows only fixed independent embedding operations with no secret headers returned', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ safe: true }, { headers: { 'x-private-key': token } }))
        for (const [method, path, body] of [
            ['GET', ['embedding-models']],
            ['GET', ['embedding-models', id]],
            ['POST', ['embedding-models'], '{}'],
            ['PUT', ['embedding-models', id], '{}'],
            ['POST', ['embedding-models', id, 'test']],
            ['POST', ['embedding-models', id, 'default']],
            ['DELETE', ['embedding-models', id]],
        ] as [string, string[], string?][]) {
            const response = await proxyAccountRequest(browser(method, body), path, configuration(upstream))
            expect(response.status).toBe(200)
            expect(response.headers.get('x-private-key')).toBeNull()
            const options = upstream.mock.calls.at(-1)![1]!
            expect(new Headers(options.headers).get('x-harness-session')).toBe(session)
            if (path.at(-1) === 'test' || path.at(-1) === 'default') expect(options.body).toBeUndefined()
        }
        expect(
            (await proxyAccountRequest(browser('POST', '{}'), ['embedding-models', id, 'arbitrary'], configuration(upstream))).status
        ).toBe(404)
    })

    it('forwards confirmed index and search JSON through the account session with exact resource paths', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ safe: true }))
        for (const [method, path, body] of [
            ['GET', ['vector-status']],
            ['GET', ['documents', id, 'index']],
            ['POST', ['documents', id, 'index'], JSON.stringify({ requestId: id, modelId: id, revision: 1 })],
            ['POST', ['documents', id, 'index', 'retry'], JSON.stringify({ requestId: id, modelId: id, revision: 1 })],
            ['POST', ['search'], JSON.stringify({ query: '资料😀', topK: 5 })],
        ] as [string, string[], string?][]) {
            const response = await proxyKnowledgeRequest(browser(method, body), path, configuration(upstream))
            expect(response.status).toBe(200)
            expect(upstream.mock.calls.at(-1)![0]).toBe(`http://private-api.example/api/knowledge/${path.join('/')}`)
            const options = upstream.mock.calls.at(-1)![1]!
            expect(new Headers(options.headers).get('authorization')).toBe(`Bearer ${token}`)
            if (body) expect(new TextDecoder().decode(options.body as ArrayBuffer)).toBe(body)
        }
    })

    it('rejects cross-origin, anonymous, oversized actual JSON and unlisted vector paths without forwarding', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({}))
        expect(
            (
                await proxyKnowledgeRequest(
                    browser('POST', '{}', { origin: 'https://attacker.example' }),
                    ['search'],
                    configuration(upstream)
                )
            ).status
        ).toBe(403)
        expect((await proxyKnowledgeRequest(browser('POST', '{}', { cookie: '' }), ['search'], configuration(upstream))).status).toBe(401)
        expect(
            (
                await proxyKnowledgeRequest(
                    browser('POST', 'x'.repeat(32769), { 'content-length': '1' }),
                    ['search'],
                    configuration(upstream)
                )
            ).status
        ).toBe(413)
        expect(
            (
                await proxyAccountRequest(
                    browser('POST', 'x'.repeat(262145), { 'content-length': '1' }),
                    ['embedding-models'],
                    configuration(upstream)
                )
            ).status
        ).toBe(413)
        expect((await proxyKnowledgeRequest(browser('GET'), ['documents', id, 'vectors'], configuration(upstream))).status).toBe(404)
        expect(upstream).not.toHaveBeenCalled()
    })

    it('cancels a stalled account JSON reader when the browser disconnects', async () => {
        const controller = new AbortController()
        const cancel = vi.fn()
        const body = new ReadableStream<Uint8Array>({ cancel })
        const request = new Request('https://harness.example/api/account/embedding-models', {
            method: 'POST',
            headers: {
                origin: 'https://harness.example',
                cookie: `harness_account_session=${session}`,
                'content-type': 'application/json',
            },
            body,
            signal: controller.signal,
            duplex: 'half',
        } as RequestInit)
        const upstream = vi.fn<typeof fetch>(async () => Response.json({}))
        const pending = proxyAccountRequest(request, ['embedding-models'], configuration(upstream))
        controller.abort()
        expect((await pending).status).toBe(502)
        expect(cancel).toHaveBeenCalledOnce()
        expect(upstream).not.toHaveBeenCalled()
    })
})
