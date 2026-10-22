import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { proxyChatRequest } from '../../server/chat-proxy'

const token = 'local-bff-test-server-token-with-more-than-32-characters'
const session = 's'.repeat(43)
const accountCookie = `harness_account_session=${session}`

/**
 * Create a same-origin browser request with optional untrusted headers.
 * @param method - Browser HTTP method.
 * @param headers - Browser-supplied headers to merge with normal request headers.
 * @param signal - Optional browser disconnect signal.
 * @returns A request that exercises the real BFF boundary.
 */
function browserRequest(method = 'GET', headers: Record<string, string> = {}, signal?: AbortSignal): Request {
    return new Request('https://harness.example/api/chat/conversations', {
        method,
        headers: { cookie: accountCookie, origin: 'https://harness.example', ...headers },
        ...(method === 'POST' ? { body: '{}' } : {}),
        ...(signal ? { signal } : {}),
    })
}

/**
 * Provide deterministic server configuration while preserving private defaults.
 * @param request - Observable upstream fetch implementation.
 * @returns Explicit BFF deployment settings for one isolated test.
 */
function configuration(request: typeof fetch) {
    return { token, apiUrl: 'http://private-api.example:3001/', workspaceId: 'trusted-workspace', fetch: request }
}

describe('chat BFF authorization and streaming boundary', () => {
    it('forwards only exact same-origin conversation deletion with the authenticated session', async () => {
        const id = randomUUID()
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ id, deleted: true }))
        const response = await proxyChatRequest(browserRequest('DELETE'), ['conversations', id], configuration(upstream))
        expect(response.status).toBe(200)
        await response.text()
        expect(upstream.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' })
        expect(
            (
                await proxyChatRequest(
                    browserRequest('DELETE', { origin: 'https://attacker.example' }),
                    ['conversations', id],
                    configuration(upstream)
                )
            ).status
        ).toBe(403)
        expect((await proxyChatRequest(browserRequest('DELETE'), ['tasks', id], configuration(upstream))).status).toBe(404)
        expect((await proxyChatRequest(browserRequest('DELETE'), ['conversations'], configuration(upstream))).status).toBe(404)
        expect(upstream).toHaveBeenCalledTimes(1)
    })
    it('only forwards the approved task routes and preserves mutation bodies', async () => {
        const id = randomUUID()
        const cases: [string, string[]][] = [
            ['GET', ['project-folders']],
            ['GET', ['project-folders', id]],
            ['POST', ['project-folders']],
            ['POST', ['conversations', id, 'human-requests', id, 'decisions']],
            ['GET', ['tasks']],
            ['GET', ['tasks', id]],
            ['POST', ['tasks']],
            ['PUT', ['tasks', id, 'status']],
            ['POST', ['tasks', id, 'start']],
            ['POST', ['tasks', id, 'messages']],
            ['POST', ['tasks', id, 'cancel']],
        ]
        for (const [method, segments] of cases) {
            const body = method === 'GET' ? undefined : JSON.stringify({ requestId: randomUUID() })
            const request = new Request(`https://harness.example/api/chat/${segments.join('/')}`, {
                method,
                headers: { cookie: accountCookie, origin: 'https://harness.example' },
                ...(body ? { body } : {}),
            })
            const upstream = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
            const response = await proxyChatRequest(request, segments, configuration(upstream))
            expect(response.status).toBe(200)
            await response.text()
            expect(upstream.mock.calls[0]?.[0]).toBe(`http://private-api.example:3001/api/chat/${segments.join('/')}`)
            expect(upstream.mock.calls[0]?.[1]).toMatchObject({ method, ...(body ? { body } : {}) })
        }
        const upstream = vi.fn<typeof fetch>(async () => Response.json({}))
        for (const segments of [
            ['tasks', id, 'delete'],
            ['tasks', 'all'],
            ['tasks', id, 'private'],
            ['conversations', id, 'human-requests', id, 'approve'],
            ['conversations', id, 'human-requests', id, 'decisions', 'extra'],
        ])
            expect((await proxyChatRequest(browserRequest('POST'), segments, configuration(upstream))).status).toBe(404)
        expect(upstream).not.toHaveBeenCalled()
    })

    it('rejects old anonymous identities and missing account cookies without minting a replacement', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ conversations: [] }))
        for (const cookie of ['', `harness_chat_session=${randomUUID()}.${'0'.repeat(64)}`, 'harness_account_session=forged']) {
            const response = await proxyChatRequest(browserRequest('GET', { cookie }), ['conversations'], configuration(upstream))
            expect(response.status).toBe(401)
            expect(response.headers.get('set-cookie')).toBeNull()
        }
        expect(upstream).not.toHaveBeenCalled()
    })

    it('forwards only the opaque account session and server token while stripping browser identity claims', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ conversations: [] }))
        const response = await proxyChatRequest(
            browserRequest('GET', {
                authorization: 'Bearer browser-controlled',
                'x-harness-user-id': randomUUID(),
                'x-harness-workspace-id': 'forged',
                'x-harness-session': 'browser-header',
            }),
            ['conversations'],
            configuration(upstream)
        )
        expect(response.status).toBe(200)
        const headers = new Headers(upstream.mock.calls[0]![1]!.headers)
        expect(headers.get('authorization')).toBe(`Bearer ${token}`)
        expect(headers.get('x-harness-session')).toBe(session)
        expect(headers.has('x-harness-user-id')).toBe(false)
        expect(headers.has('x-harness-workspace-id')).toBe(false)
        expect(response.headers.get('set-cookie')).toBeNull()
        expect(await response.json()).toEqual({ conversations: [] })
    })

    it('clears an expired account cookie after the real API rejects its session', async () => {
        const response = await proxyChatRequest(
            browserRequest(),
            ['conversations'],
            configuration(async () => Response.json({ message: 'expired' }, { status: 401 }))
        )
        expect(response.status).toBe(401)
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
        expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict')
        expect(response.headers.get('set-cookie')).toContain('Secure')
    })

    it('refuses cross-origin mutations, unsupported paths, and oversized bodies before contacting the API', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({}))
        expect(
            (
                await proxyChatRequest(
                    browserRequest('POST', { origin: 'https://attacker.example' }),
                    ['conversations'],
                    configuration(upstream)
                )
            ).status
        ).toBe(403)
        const noOrigin = new Request('https://harness.example/api/chat/conversations', { method: 'POST', body: '{}' })
        expect((await proxyChatRequest(noOrigin, ['conversations'], configuration(upstream))).status).toBe(403)
        expect((await proxyChatRequest(browserRequest(), ['configuration'], configuration(upstream))).status).toBe(404)
        expect(
            (await proxyChatRequest(browserRequest('POST', { 'content-length': '262145' }), ['conversations'], configuration(upstream)))
                .status
        ).toBe(413)
        expect(upstream).not.toHaveBeenCalled()
    })

    it('validates the browser-facing Host when Next uses a different internal hostname', async () => {
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ id: randomUUID() }))
        const sameOrigin = new Request('http://localhost:3000/api/chat/conversations', {
            method: 'POST',
            headers: { cookie: accountCookie, host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
            body: '{}',
        })
        const allowed = await proxyChatRequest(sameOrigin, ['conversations'], configuration(upstream))
        expect(allowed.status).toBe(200)
        await allowed.text()
        expect(upstream).toHaveBeenCalledOnce()
        for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3001', 'https://attacker.example']) {
            const crossOrigin = new Request('http://localhost:3000/api/chat/conversations', {
                method: 'POST',
                headers: { cookie: accountCookie, host: '127.0.0.1:3000', origin },
                body: '{}',
            })
            const denied = await proxyChatRequest(crossOrigin, ['conversations'], configuration(upstream))
            expect(denied.status).toBe(403)
        }
        expect(upstream).toHaveBeenCalledOnce()
    })

    it('forwards Agent updates with their JSON body and refuses cross-origin edits', async () => {
        const id = randomUUID()
        const body = JSON.stringify({ name: '研究助手', modelId: 'deepseek-flash' })
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ id }))
        const request = new Request(`https://harness.example/api/chat/agents/${id}`, {
            method: 'PUT',
            headers: { cookie: accountCookie, origin: 'https://harness.example', 'content-type': 'application/json' },
            body,
        })
        const response = await proxyChatRequest(request, ['agents', id], configuration(upstream))
        expect(response.status).toBe(200)
        await response.text()
        expect(upstream.mock.calls[0]?.[0]).toBe(`http://private-api.example:3001/api/chat/agents/${id}`)
        expect(upstream.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT', body })
        const foreign = new Request(request.url, {
            method: 'PUT',
            headers: { cookie: accountCookie, origin: 'https://attacker.example' },
            body,
        })
        expect((await proxyChatRequest(foreign, ['agents', id], configuration(upstream))).status).toBe(403)
        expect(upstream).toHaveBeenCalledOnce()
    })

    it('preserves streaming chunks and safe response headers without forwarding private upstream headers', async () => {
        const payload = 'data: {"type":"delta","text":"hello"}\n\n'
        const upstream: typeof fetch = async () =>
            new Response(payload, {
                headers: {
                    'content-type': 'text/event-stream',
                    'x-private-secret': token,
                    'set-cookie': 'upstream-private=secret',
                },
            })
        const response = await proxyChatRequest(
            browserRequest('POST'),
            ['conversations', randomUUID(), 'messages'],
            configuration(upstream)
        )
        expect(response.headers.get('content-type')).toBe('text/event-stream')
        expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
        expect(response.headers.get('x-accel-buffering')).toBe('no')
        expect(response.headers.get('x-private-secret')).toBeNull()
        expect(response.headers.get('set-cookie')).toBeNull()
        expect(await response.text()).toBe(payload)
    })

    it('aborts the API request and cancels its body when the downstream reader is cancelled', async () => {
        let signal: AbortSignal | undefined
        let cancelled = false
        const upstream: typeof fetch = async (_url, init) => {
            signal = init!.signal as AbortSignal
            return new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('prefix'))
                    },
                    cancel() {
                        cancelled = true
                    },
                })
            )
        }
        const response = await proxyChatRequest(browserRequest(), ['conversations'], configuration(upstream))
        const reader = response.body!.getReader()
        expect(new TextDecoder().decode((await reader.read()).value)).toBe('prefix')
        await reader.cancel()
        expect(signal!.aborted).toBe(true)
        expect(cancelled).toBe(true)
    })

    it('propagates browser request cancellation to the upstream signal', async () => {
        const browser = new AbortController()
        let signal: AbortSignal | undefined
        const upstream: typeof fetch = async (_url, init) => {
            signal = init!.signal as AbortSignal
            return new Response(new ReadableStream<Uint8Array>())
        }
        const response = await proxyChatRequest(browserRequest('GET', {}, browser.signal), ['conversations'], configuration(upstream))
        browser.abort()
        expect(signal!.aborted).toBe(true)
        await response.body!.cancel()
    })

    it('redacts connection and stream errors instead of exposing secret-bearing upstream exceptions', async () => {
        const connectionFailure = await proxyChatRequest(
            browserRequest(),
            ['conversations'],
            configuration(async () => {
                throw new Error(`connection failed with ${token}`)
            })
        )
        expect(connectionFailure.status).toBe(502)
        expect(await connectionFailure.text()).not.toContain(token)
        const streamFailure = await proxyChatRequest(
            browserRequest(),
            ['conversations'],
            configuration(
                async () =>
                    new Response(
                        new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.error(new Error(`upstream body failed with ${token}`))
                            },
                        })
                    )
            )
        )
        const failure = await streamFailure.text().catch(error => error)
        expect(failure).toBeInstanceOf(Error)
        expect(failure.message).toBe('聊天连接已中断。')
        expect(String(failure)).not.toContain(token)
    })
    it('forwards only fixed project and membership methods with same-origin write protection', async () => {
        const id = randomUUID()
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ id }))
        const routes: [string, string[]][] = [
            ['GET', ['projects']],
            ['GET', ['projects', id]],
            ['POST', ['projects']],
            ['PUT', ['projects', id]],
            ['PUT', ['tasks', id, 'project']],
        ]
        for (const [method, segments] of routes) {
            const request = new Request(`https://harness.example/api/chat/${segments.join('/')}`, {
                method,
                headers: { cookie: accountCookie, origin: 'https://harness.example' },
                ...(method === 'GET' ? {} : { body: '{"projectId":null}' }),
            })
            const response = await proxyChatRequest(request, segments, configuration(upstream))
            expect(response.status).toBe(200)
            await response.text()
        }
        expect(upstream).toHaveBeenCalledTimes(routes.length)
        const denied = new Request(`https://harness.example/api/chat/projects/${id}`, {
            method: 'PUT',
            headers: { cookie: accountCookie, origin: 'https://attacker.example' },
            body: '{}',
        })
        expect((await proxyChatRequest(denied, ['projects', id], configuration(upstream))).status).toBe(403)
        for (const [method, segments] of [
            ['DELETE', ['projects', id]],
            ['POST', ['projects', id]],
            ['PUT', ['projects']],
            ['GET', ['tasks', id, 'project']],
        ] as [string, string[]][]) {
            const request = new Request('https://harness.example/api/chat/forbidden', { method })
            expect((await proxyChatRequest(request, segments, configuration(upstream))).status).toBe(404)
        }
        expect(upstream).toHaveBeenCalledTimes(routes.length)
    })
    it('limits template writes and launches to fixed same-origin routes', async () => {
        const id = randomUUID()
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ id }))
        const routes: [string, string[]][] = [
            ['GET', ['templates']],
            ['GET', ['templates', id]],
            ['POST', ['templates']],
            ['PUT', ['templates', id]],
            ['POST', ['templates', id, 'launch']],
        ]
        for (const [method, segments] of routes) {
            const request = new Request(`https://harness.example/api/chat/${segments.join('/')}`, {
                method,
                headers: { cookie: accountCookie, origin: 'https://harness.example' },
                ...(method === 'GET' ? {} : { body: '{}' }),
            })
            const response = await proxyChatRequest(request, segments, configuration(upstream))
            expect(response.status).toBe(200)
            await response.text()
        }
        const foreign = new Request('https://harness.example/api/chat/templates', {
            method: 'POST',
            headers: { cookie: accountCookie, origin: 'https://attacker.example' },
            body: '{}',
        })
        expect((await proxyChatRequest(foreign, ['templates'], configuration(upstream))).status).toBe(403)
        for (const [method, segments] of [
            ['GET', ['templates', id, 'launch']],
            ['POST', ['templates', id]],
            ['PUT', ['templates']],
            ['POST', ['templates', id, 'execute']],
        ] as [string, string[]][]) {
            expect(
                (
                    await proxyChatRequest(
                        new Request('https://harness.example/api/chat/forbidden', { method }),
                        segments,
                        configuration(upstream)
                    )
                ).status
            ).toBe(404)
        }
        expect(upstream).toHaveBeenCalledTimes(routes.length)
    })
})
