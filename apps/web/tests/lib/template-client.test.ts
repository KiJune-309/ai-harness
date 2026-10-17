import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTemplate, getTemplate, launchTemplate, listTemplates, updateTemplate } from '../../lib/template-client'
import { requestChatResponse } from '../../lib/chat-client'

vi.mock('../../lib/chat-client', () => ({ requestChatResponse: vi.fn() }))
const id = 'a9463f65-93c4-48e3-9583-8c138e8732eb'
const taskId = 'd0a6af8b-abce-4e27-b092-ef8d1fc3f89b'
const time = '2026-10-17T08:00:00.000Z'
const input = { name: '调研清单', description: '', tasks: [{ id: taskId, title: '核对方案', goal: '明确结论' }] }
const template = { ...input, id, version: 1, createdAt: time, updatedAt: time }
const project = { id, name: '本周调研', description: '', createdAt: time, updatedAt: time }

beforeEach(() => vi.mocked(requestChatResponse).mockReset())

describe('template client', () => {
    it('loads uncached collections and encodes identifiers with caller cancellation', async () => {
        vi.mocked(requestChatResponse)
            .mockResolvedValueOnce(Response.json({ templates: [template] }))
            .mockResolvedValueOnce(Response.json(template))
        const signal = new AbortController().signal
        await expect(listTemplates(signal)).resolves.toEqual([template])
        await expect(getTemplate('path/part?', signal)).resolves.toEqual(template)
        expect(requestChatResponse).toHaveBeenNthCalledWith(1, '/templates', { cache: 'no-store', signal })
        expect(requestChatResponse).toHaveBeenNthCalledWith(2, '/templates/path%2Fpart%3F', { cache: 'no-store', signal })
    })

    it('preserves creation and launch identifiers across an interrupted response and retry', async () => {
        const error = new Error('连接已中断。')
        vi.mocked(requestChatResponse)
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(Response.json(template))
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(Response.json({ project, taskIds: [taskId] }))
        const creation = { ...input, requestId: id }
        await expect(createTemplate(creation)).rejects.toBe(error)
        await expect(createTemplate(creation)).resolves.toEqual(template)
        const launch = { name: project.name, description: '', requestId: id, version: 1 }
        await expect(launchTemplate(id, launch)).rejects.toBe(error)
        await expect(launchTemplate(id, launch)).resolves.toEqual({ project, taskIds: [taskId] })
        expect(vi.mocked(requestChatResponse).mock.calls[0]?.[1]?.body).toBe(vi.mocked(requestChatResponse).mock.calls[1]?.[1]?.body)
        expect(vi.mocked(requestChatResponse).mock.calls[2]?.[1]?.body).toBe(vi.mocked(requestChatResponse).mock.calls[3]?.[1]?.body)
        expect(requestChatResponse).toHaveBeenLastCalledWith(
            `/templates/${id}/launch`,
            expect.objectContaining({ method: 'POST', body: JSON.stringify(launch) })
        )
    })

    it('sends explicit edited versions and preserves actionable conflict status', async () => {
        vi.mocked(requestChatResponse)
            .mockResolvedValueOnce(Response.json({ message: '模板版本已变化，请重新载入。' }, { status: 409 }))
            .mockResolvedValueOnce(Response.json({ ...template, version: 2 }))
        await expect(updateTemplate(id, { ...input, version: 1 })).rejects.toMatchObject({
            status: 409,
            message: expect.stringContaining('版本'),
        })
        await expect(updateTemplate(id, { ...input, version: 1 })).resolves.toMatchObject({ version: 2 })
        expect(requestChatResponse).toHaveBeenLastCalledWith(
            `/templates/${id}`,
            expect.objectContaining({ method: 'PUT', body: JSON.stringify({ ...input, version: 1 }) })
        )
    })

    it('refuses malformed collections, private fields, and missing original task identities', async () => {
        vi.mocked(requestChatResponse)
            .mockResolvedValueOnce(Response.json({ templates: null }))
            .mockResolvedValueOnce(Response.json({ ...template, creation: input }))
            .mockResolvedValueOnce(Response.json({ project, taskIds: [] }))
        await expect(listTemplates()).rejects.toThrow('无效的列表')
        await expect(getTemplate(id)).rejects.toThrow('无效的数据')
        await expect(launchTemplate(id, { name: project.name, description: '', requestId: id, version: 1 })).rejects.toThrow(
            '无效的项目结果'
        )
    })

    it('validates edits and launches before sending them and handles non-JSON failures', async () => {
        await expect(createTemplate({ ...input, tasks: [], requestId: id })).rejects.toThrow()
        await expect(updateTemplate(id, { ...input, version: 0 })).rejects.toThrow()
        await expect(launchTemplate(id, { name: ' ', description: '', requestId: id, version: 1 })).rejects.toThrow()
        expect(requestChatResponse).not.toHaveBeenCalled()
        vi.mocked(requestChatResponse).mockResolvedValueOnce(new Response('<html>failure</html>', { status: 502 }))
        await expect(listTemplates()).rejects.toThrow('模板服务请求失败（502）')
    })
})
