import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
})

describe('verified browser workspace context', () => {
    it('binds business requests to the verified workspace and blocks requests after invalidation', async () => {
        const context = await import('../../lib/workspace-context')
        const { requestChatResponse } = await import('../../lib/chat-client')
        const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
        vi.stubGlobal('fetch', transport)
        context.setVerifiedWorkspace('team-one')
        await requestChatResponse('/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Harness-Context': 'forged' },
            body: '{}',
        })
        const headers = new Headers(transport.mock.calls[0]?.[1]?.headers)
        expect(headers.get('X-Harness-Context')).toBe('team-one')
        expect(headers.get('Content-Type')).toBe('application/json')
        context.setVerifiedWorkspace(undefined)
        await expect(requestChatResponse('/conversations')).rejects.toThrow()
        expect(transport).toHaveBeenCalledTimes(1)
        context.setVerifiedWorkspace('team-two')
        await requestChatResponse('/conversations')
        expect(new Headers(transport.mock.calls[1]?.[1]?.headers).get('X-Harness-Context')).toBe('team-two')
    })

    it('retains multipart content handling while marking the workspace and only reacts to explicit context conflicts', async () => {
        const context = await import('../../lib/workspace-context')
        const events = new EventTarget()
        const changed = vi.fn()
        events.addEventListener('harness:workspace-changed', changed)
        vi.stubGlobal('window', { dispatchEvent: events.dispatchEvent.bind(events) })
        context.setVerifiedWorkspace('team-one')
        expect(new Headers(context.workspaceHeaders()).has('Content-Type')).toBe(false)
        context.observeWorkspaceResponse(Response.json({ message: 'version conflict' }, { status: 409 }))
        expect(changed).not.toHaveBeenCalled()
        context.observeWorkspaceResponse(Response.json({}, { status: 409, headers: { 'X-Harness-Context-Changed': '1' } }))
        expect(changed).toHaveBeenCalledOnce()
    })
})
