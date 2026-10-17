import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, getProject, listProjects, updateProject } from '../../lib/project-client'
import { requestChatResponse } from '../../lib/chat-client'

vi.mock('../../lib/chat-client', () => ({ requestChatResponse: vi.fn() }))
const id = 'b36630fb-d199-4ff6-83c5-290c314e1714'
const project = {
    id,
    name: '秋季调研',
    description: '原说明',
    createdAt: '2026-10-17T08:00:00.000Z',
    updatedAt: '2026-10-17T08:00:00.000Z',
}

beforeEach(() => vi.mocked(requestChatResponse).mockReset())
afterEach(() => vi.restoreAllMocks())

describe('project client', () => {
    it('loads uncached real collections and stable details with caller cancellation', async () => {
        vi.mocked(requestChatResponse)
            .mockResolvedValueOnce(Response.json({ projects: [project] }))
            .mockResolvedValueOnce(Response.json({ project, tasks: [] }))
        const signal = new AbortController().signal
        await expect(listProjects(signal)).resolves.toEqual([project])
        await expect(getProject('path/segment?', signal)).resolves.toEqual({ project, tasks: [] })
        expect(requestChatResponse).toHaveBeenNthCalledWith(1, '/projects', { cache: 'no-store', signal })
        expect(requestChatResponse).toHaveBeenNthCalledWith(2, '/projects/path%2Fsegment%3F', { cache: 'no-store', signal })
    })

    it('preserves creation UUID across failures and normalizes only public fields', async () => {
        const failure = new Error('请求等待超时，请检查网络后重试。')
        vi.mocked(requestChatResponse).mockRejectedValueOnce(failure).mockResolvedValueOnce(Response.json(project))
        const input = { requestId: id, name: ' 秋季调研 ', description: ' 原说明 ' }
        await expect(createProject(input)).rejects.toBe(failure)
        await expect(createProject(input)).resolves.toEqual(project)
        const options = { method: 'POST', body: JSON.stringify({ name: project.name, description: project.description, requestId: id }) }
        expect(requestChatResponse).toHaveBeenNthCalledWith(1, '/projects', expect.objectContaining(options))
        expect(requestChatResponse).toHaveBeenNthCalledWith(2, '/projects', expect.objectContaining(options))
    })

    it('saves edits as a PUT without replacing project identity', async () => {
        vi.mocked(requestChatResponse).mockResolvedValue(Response.json({ ...project, name: '新名称' }))
        await expect(updateProject(id, { name: ' 新名称 ', description: '' })).resolves.toMatchObject({ id, name: '新名称' })
        expect(requestChatResponse).toHaveBeenCalledWith(
            `/projects/${id}`,
            expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: '新名称', description: '' }) })
        )
    })

    it('rejects invalid inputs before sending a mutation', async () => {
        await expect(createProject({ requestId: id, name: ' ', description: '' })).rejects.toThrow()
        await expect(updateProject(id, { name: '合法', description: 'a'.repeat(2001) })).rejects.toThrow()
        expect(requestChatResponse).not.toHaveBeenCalled()
    })

    it('rejects malformed records and task-less details instead of presenting false empty success', async () => {
        vi.mocked(requestChatResponse)
            .mockResolvedValueOnce(Response.json({ projects: null }))
            .mockResolvedValueOnce(Response.json({ projects: [{ ...project, id: 'bad' }] }))
            .mockResolvedValueOnce(Response.json({ project }))
            .mockResolvedValueOnce(Response.json({ ...project, creation: {} }))
        await expect(listProjects()).rejects.toThrow('无效的列表')
        await expect(listProjects()).rejects.toThrow('无效的数据')
        await expect(getProject(id)).rejects.toThrow('无效的详情')
        await expect(updateProject(id, { name: '合法', description: '' })).rejects.toThrow('无效的数据')
    })

    it('preserves actionable refusals and provides safe text for non-JSON proxy errors', async () => {
        vi.mocked(requestChatResponse)
            .mockResolvedValueOnce(Response.json({ message: '未找到这个项目。' }, { status: 404 }))
            .mockResolvedValueOnce(new Response('<html>error</html>', { status: 502 }))
        await expect(getProject(id)).rejects.toThrow('未找到这个项目')
        await expect(listProjects()).rejects.toThrow('项目服务请求失败（502）')
    })
})
