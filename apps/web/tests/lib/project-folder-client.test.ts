import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectFolder, getProjectFolder, listProjectFolders } from '../../lib/project-folder-client'

const folder = {
    id: '642f7bcd-c9ce-4ac0-985a-45b1e8378a79',
    name: '网站改版',
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
}
afterEach(() => vi.unstubAllGlobals())

describe('personal project folder client', () => {
    it('uses authenticated fixed routes and retains normalized creation actions', async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ projects: [folder] }))
            .mockImplementation(async () => Response.json(folder))
        vi.stubGlobal('fetch', request)
        await expect(listProjectFolders()).resolves.toEqual([folder])
        await expect(getProjectFolder(folder.id)).resolves.toEqual(folder)
        await expect(createProjectFolder({ requestId: folder.id, name: ' 网站改版 ' })).resolves.toEqual(folder)
        expect(request.mock.calls[0]![0]).toBe('/api/chat/project-folders')
        expect(request.mock.calls[1]![0]).toBe(`/api/chat/project-folders/${folder.id}`)
        expect(request.mock.calls[2]![1]).toMatchObject({
            method: 'POST',
            body: JSON.stringify({ requestId: folder.id, name: folder.name }),
        })
    })

    it('rejects malformed public records and preserves useful persistence failures', async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ projects: [folder], secret: 'unexpected' }))
            .mockResolvedValueOnce(Response.json({ ...folder, ownerKey: 'private' }))
            .mockResolvedValueOnce(Response.json({ message: '项目未保存' }, { status: 503 }))
        vi.stubGlobal('fetch', request)
        await expect(listProjectFolders()).rejects.toThrow('格式无效')
        await expect(getProjectFolder(folder.id)).rejects.toThrow()
        await expect(createProjectFolder({ requestId: folder.id, name: folder.name })).rejects.toThrow('项目未保存')
    })
})
