import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestChatResponse } from '../../lib/chat-client'
import { createSkill, getSkill, listSkills, listSkillVersions, updateSkill } from '../../lib/skill-client'
vi.mock('../../lib/chat-client', () => ({ requestChatResponse: vi.fn() }))
const request = vi.mocked(requestChatResponse)
const id = '79cc2fe3-050b-4b18-8b25-3b7c43198728'
const input = { title: '检查清单', description: '完整说明', content: '第一行\n\n${literal}\n<script>never()</script>' }
const record = { ...input, id, version: 1, createdAt: '2026-10-20T04:00:00.000Z', updatedAt: '2026-10-20T04:00:00.000Z' }
afterEach(() => vi.resetAllMocks())
describe('private skill browser boundary', () => {
    it('reads summaries and exact historical bodies through the scoped chat client', async () => {
        const summary = {
            id,
            version: record.version,
            title: input.title,
            description: input.description,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        }
        request
            .mockResolvedValueOnce(Response.json({ skills: [summary] }))
            .mockResolvedValueOnce(Response.json(record))
            .mockResolvedValueOnce(Response.json({ versions: [{ version: 1, title: input.title, updatedAt: record.updatedAt }] }))
        await expect(listSkills()).resolves.toEqual([summary])
        await expect(getSkill(id, 1)).resolves.toEqual(record)
        await expect(listSkillVersions(id)).resolves.toHaveLength(1)
        expect(request.mock.calls.map(call => call[0])).toEqual(['/skills', `/skills/${id}/versions/1`, `/skills/${id}/versions`])
    })
    it('retains exact literal body, action identity, and version in validated mutations', async () => {
        request
            .mockResolvedValueOnce(Response.json(record))
            .mockRejectedValueOnce(new Error('lost response'))
            .mockResolvedValueOnce(Response.json({ ...record, version: 2 }))
        await createSkill({ ...input, requestId: id })
        const update = { ...input, requestId: id, version: 1 }
        await expect(updateSkill(id, update)).rejects.toThrow('lost response')
        await expect(updateSkill(id, update)).resolves.toMatchObject({ version: 2 })
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ ...input, requestId: id })
        expect(request.mock.calls[1][1]?.body).toBe(request.mock.calls[2][1]?.body)
        await expect(createSkill({ ...input, requestId: id, skillSnapshots: [] } as never)).rejects.toThrow()
        expect(request).toHaveBeenCalledTimes(3)
    })
    it('preserves conflict status and never hides service failure as an empty library', async () => {
        request
            .mockResolvedValueOnce(Response.json({ message: '版本已变化' }, { status: 409 }))
            .mockResolvedValueOnce(Response.json({ message: '技能库不可用' }, { status: 503 }))
            .mockResolvedValueOnce(Response.json({}))
        await expect(updateSkill(id, { ...input, requestId: id, version: 1 })).rejects.toMatchObject({ status: 409, message: '版本已变化' })
        await expect(listSkills()).rejects.toMatchObject({ status: 503 })
        await expect(listSkills()).rejects.toThrow('技能列表返回无效')
    })
})
