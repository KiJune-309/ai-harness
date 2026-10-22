import { describe, expect, it, vi } from 'vitest'
import { proxyChatRequest } from '../../server/chat-proxy'

const id = '352f6036-8545-4dd5-8573-636877687ee9'
const token = 'server-private-token-with-at-least-32-characters'
const session = 's'.repeat(43)

/**
 * Constructs a signed, same-origin collaboration request for the real proxy.
 * @param path - Resource path and optional query string.
 * @param method - Browser HTTP method.
 * @param origin - Browser origin used to test forgery rejection.
 * @returns A request containing only an opaque account cookie.
 */
function browserRequest(path: string, method = 'GET', origin = 'https://harness.example') {
    return new Request(`https://harness.example/api/chat/collaboration/${path}`, {
        method,
        headers: { cookie: `harness_account_session=${session}`, origin },
        ...(method === 'POST' ? { body: JSON.stringify({ type: 'message', requestId: id, recipientId: id, content: '正文' }) } : {}),
    })
}

describe('collaboration BFF allowlist', () => {
    it('preserves exact source queries and forwards the strict command endpoint with server identity', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ notifications: [] }))
        const config = { token, apiUrl: 'http://api.example:3001', fetch }
        const response = await proxyChatRequest(
            browserRequest(`source-events?sourceKind=task&sourceId=${id}&cursor=7`),
            ['collaboration', 'source-events'],
            config
        )
        await response.json()
        expect(fetch.mock.calls[0][0]).toBe(
            `http://api.example:3001/api/chat/collaboration/source-events?sourceKind=task&sourceId=${id}&cursor=7`
        )
        expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-harness-session')).toBe(session)
        const sent = await proxyChatRequest(browserRequest('commands', 'POST'), ['collaboration', 'commands'], config)
        await sent.json()
        expect(fetch.mock.calls[1][1]?.body).toContain('"type":"message"')
        await proxyChatRequest(
            browserRequest(`nodes/${id}/events?cursor=50&eventId=${id}`),
            ['collaboration', 'nodes', id, 'events'],
            config
        )
        expect(fetch.mock.calls[2][0]).toBe(`http://api.example:3001/api/chat/collaboration/nodes/${id}/events?cursor=50&eventId=${id}`)
        await proxyChatRequest(browserRequest(`projects/${id}/progress`), ['collaboration', 'projects', id, 'progress'], config)
        expect(fetch.mock.calls[3][0]).toBe(`http://api.example:3001/api/chat/collaboration/projects/${id}/progress`)
    })

    it('rejects arbitrary proxy paths, remote hosts, unsupported methods, and cross-origin commands', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}))
        const config = { token, apiUrl: 'http://api.example:3001', fetch }
        for (const segments of [
            ['collaboration', 'private'],
            ['collaboration', 'nodes', id, 'secrets'],
            ['collaboration', 'https://elsewhere.example'],
            ['collaboration', 'commands', id],
            ['collaboration', 'projects', id, 'progress', 'private'],
            ['collaboration', 'projects', id, 'journal'],
        ]) {
            expect((await proxyChatRequest(browserRequest('private'), segments, config)).status).toBe(404)
        }
        expect(
            (await proxyChatRequest(browserRequest('commands', 'POST', 'https://attacker.example'), ['collaboration', 'commands'], config))
                .status
        ).toBe(403)
        expect(fetch).not.toHaveBeenCalled()
    })
})
