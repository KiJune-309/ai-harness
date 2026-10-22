import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspace, listWorkspaces, respondWorkspaceInvitation, switchWorkspace } from '../../lib/workspace-client'
import { setVerifiedWorkspace } from '../../lib/workspace-context'

const workspace = {
    id: '519a4f75-a362-4fcf-a317-6c70cd0a52f0',
    name: '产品研发',
    description: '',
    kind: 'team',
    role: 'owner',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('workspace browser management client', () => {
    it('reads recovery directories without a stale context and validates private-field-free contracts', async () => {
        setVerifiedWorkspace('old-workspace')
        const transport = vi
            .fn<typeof fetch>()
            .mockResolvedValue(Response.json({ currentId: workspace.id, workspaces: [workspace], invitations: [] }))
        vi.stubGlobal('fetch', transport)
        expect((await listWorkspaces()).workspaces[0]?.id).toBe(workspace.id)
        expect(new Headers(transport.mock.calls[0]?.[1]?.headers).has('X-Harness-Context')).toBe(false)
        transport.mockResolvedValueOnce(
            Response.json({ currentId: workspace.id, workspaces: [{ ...workspace, secret: 'never-render' }], invitations: [] })
        )
        await expect(listWorkspaces()).rejects.toThrow('无效的数据')
    })

    it('sends normalized creation fields with a retained action and never switches implicitly during acceptance', async () => {
        const transport = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json(workspace))
            .mockImplementation(async () => Response.json({ success: true }))
        vi.stubGlobal('fetch', transport)
        const requestId = '66875a85-8283-4fde-877f-ce26b1c293e9'
        await createWorkspace({ name: '  产品研发  ', description: ' 团队 ', requestId })
        expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({ name: '产品研发', description: '团队', requestId })
        await respondWorkspaceInvitation('239d47ae-2c17-401e-a274-20a222b04f1a', true)
        expect(transport).toHaveBeenCalledTimes(2)
        expect(transport.mock.calls[1]?.[0]).toBe('/api/account/workspaces/invitations/239d47ae-2c17-401e-a274-20a222b04f1a/respond')
        await switchWorkspace(workspace.id)
        expect(transport.mock.calls[2]?.[0]).toBe(`/api/account/workspaces/${workspace.id}/switch`)
    })
})
