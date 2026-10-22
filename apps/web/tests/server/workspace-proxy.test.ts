import { describe, expect, it, vi } from 'vitest'
import { proxyAccountRequest } from '../../server/account-proxy'
import { proxyChatRequest } from '../../server/chat-proxy'
import { proxyKnowledgeRequest } from '../../server/knowledge-proxy'

const session = 'A'.repeat(43)
const token = 'private-workspace-proxy-test-token-2026'
const workspaceId = '519a4f75-a362-4fcf-a317-6c70cd0a52f0'
const invitationId = '239d47ae-2c17-401e-a274-20a222b04f1a'

/**
 * Builds a same-origin real-session request without any trusted identity claims.
 * @param method - Browser HTTP method.
 * @returns An authenticated browser request for the fixed BFF test.
 */
function browser(method = 'GET'): Request {
    return new Request('https://harness.example/api/account/workspaces', {
        method,
        headers: {
            origin: 'https://harness.example',
            cookie: `harness_account_session=${session}`,
            'X-Harness-Context': workspaceId,
            'X-Harness-User-Id': 'forged',
        },
        ...(!['GET', 'DELETE'].includes(method) ? { body: '{}' } : {}),
    })
}

describe('workspace BFF boundaries', () => {
    it('allows every fixed management operation while rejecting unlisted nested paths', async () => {
        const upstream = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ success: true }))
        const config = { token, apiUrl: 'http://private.example', fetch: upstream }
        const routes = [
            ['GET', 'workspaces'],
            ['GET', `workspaces/${workspaceId}`],
            ['POST', 'workspaces'],
            ['PUT', `workspaces/${workspaceId}`],
            ['POST', `workspaces/${workspaceId}/switch`],
            ['POST', `workspaces/${workspaceId}/invitations`],
            ['POST', `workspaces/invitations/${invitationId}/respond`],
            ['DELETE', `workspaces/${workspaceId}/invitations/${invitationId}`],
            ['DELETE', `workspaces/${workspaceId}/members/${invitationId}`],
            ['POST', `workspaces/${workspaceId}/leave`],
        ]
        for (const [method, path] of routes) expect((await proxyAccountRequest(browser(method), path!.split('/'), config)).status).toBe(200)
        expect(upstream).toHaveBeenCalledTimes(routes.length)
        expect((await proxyAccountRequest(browser('DELETE'), ['workspaces', workspaceId], config)).status).toBe(404)
        expect((await proxyAccountRequest(browser(), ['workspaces', workspaceId, 'private-users'], config)).status).toBe(404)
    })

    it('forwards only the expected context and explicit recovery marker across all business proxies', async () => {
        for (const [proxy, path] of [
            [proxyAccountRequest, ['models']],
            [proxyChatRequest, ['conversations']],
            [proxyKnowledgeRequest, ['status']],
        ] as const) {
            const upstream = vi
                .fn<typeof fetch>()
                .mockImplementation(async () =>
                    Response.json(
                        { message: '空间已变化' },
                        { status: 409, headers: { 'X-Harness-Context-Changed': '1', 'X-Private-Secret': 'hidden' } }
                    )
                )
            const result = await proxy(browser(), [...path], { token, apiUrl: 'http://private.example', fetch: upstream })
            const headers = new Headers(upstream.mock.calls[0]?.[1]?.headers)
            expect(headers.get('X-Harness-Context')).toBe(workspaceId)
            expect(headers.get('X-Harness-Session')).toBe(session)
            expect(headers.has('X-Harness-User-Id')).toBe(false)
            expect(result.status).toBe(409)
            expect(result.headers.get('X-Harness-Context-Changed')).toBe('1')
            expect(result.headers.has('X-Private-Secret')).toBe(false)
            expect(result.headers.has('Set-Cookie')).toBe(false)
        }
    })
})
