import { describe, expect, it, vi } from 'vitest'
import { proxyChatRequest } from '../../server/chat-proxy'
const id = '79cc2fe3-050b-4b18-8b25-3b7c43198728'
/**
 * Builds one signed-cookie same-origin template request without browser authorization claims.
 * @param path - Fixed resource under the existing chat BFF.
 * @param method - Tested HTTP method.
 * @returns The browser request carrying the old-page workspace expectation.
 */
function request(path: string, method = 'GET') {
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
describe('workflow template proxy allowlist', () => {
    it('forwards only explicit catalog and workflow routes with session and context', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}))
        const config = { fetch, token: 't'.repeat(40), apiUrl: 'http://api.example:3001' }
        for (const [path, method] of [
            ['template-catalog', 'GET'],
            [`template-catalog/${id}`, 'GET'],
            [`workflow-templates/${id}`, 'GET'],
            ['workflow-templates', 'POST'],
            [`workflow-templates/${id}`, 'PUT'],
            [`workflow-templates/${id}/preview`, 'POST'],
            [`workflow-templates/${id}/launch`, 'POST'],
        ]) {
            expect((await proxyChatRequest(request(path, method), path.split('/'), config)).status).toBe(200)
        }
        expect(fetch).toHaveBeenCalledTimes(7)
        expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-harness-context')).toBe('workspace-test')
        for (const [path, method] of [
            [`workflow-templates/${id}/preview`, 'GET'],
            [`workflow-templates/${id}/launch`, 'PUT'],
            [`template-catalog/${id}/private`, 'GET'],
            [`workflow-templates/${id}/secrets`, 'GET'],
        ]) {
            expect((await proxyChatRequest(request(path, method), path.split('/'), config)).status).toBe(404)
        }
        expect(fetch).toHaveBeenCalledTimes(7)
    })
})
