import { describe, expect, it, vi } from 'vitest'
import { proxyChatRequest } from '../../server/chat-proxy'
const id = '79cc2fe3-050b-4b18-8b25-3b7c43198728'
/**
 * Constructs one authenticated same-origin request with an old-page scope expectation.
 * @param path - Explicit private skill endpoint.
 * @param method - Tested HTTP method.
 * @returns A request containing no client identity authority.
 */
function request(path: string, method: string) {
    return new Request(`https://harness.example/api/chat/${path}`, {
        method,
        headers: {
            origin: 'https://harness.example',
            cookie: `harness_account_session=${'s'.repeat(43)}`,
            'X-Harness-Context': 'workspace-test',
        },
        ...(method === 'GET' ? {} : { body: '{}' }),
    })
}
describe('skill BFF allowlist', () => {
    it('forwards only the six private routes and preserves session and workspace expectation', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}))
        const config = { fetch, token: 't'.repeat(40), apiUrl: 'http://api.example:3001' }
        for (const [path, method] of [
            ['skills', 'GET'],
            ['skills', 'POST'],
            [`skills/${id}`, 'GET'],
            [`skills/${id}`, 'PUT'],
            [`skills/${id}/versions`, 'GET'],
            [`skills/${id}/versions/2`, 'GET'],
        ])
            expect((await proxyChatRequest(request(path, method), path.split('/'), config)).status).toBe(200)
        expect(fetch).toHaveBeenCalledTimes(6)
        const headers = new Headers(fetch.mock.calls[0][1]?.headers)
        expect(headers.get('X-Harness-Context')).toBe('workspace-test')
        expect(headers.get('X-Harness-Session')).toBe('s'.repeat(43))
        for (const [path, method] of [
            [`skills/${id}`, 'DELETE'],
            [`skills/${id}/versions/0`, 'GET'],
            [`skills/${id}/versions/1`, 'PUT'],
            ['skills/private', 'GET'],
        ])
            expect((await proxyChatRequest(request(path, method), path.split('/'), config)).status).toBe(404)
        expect(fetch).toHaveBeenCalledTimes(6)
    })
})
