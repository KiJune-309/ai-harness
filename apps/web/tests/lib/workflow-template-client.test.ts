import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestChatResponse } from '../../lib/chat-client'
import {
    createWorkflowTemplate,
    getTemplateCatalogEntry,
    launchWorkflowTemplate,
    listTemplateCatalog,
    previewWorkflowTemplate,
    updateWorkflowTemplate,
} from '../../lib/workflow-template-client'
vi.mock('../../lib/chat-client', () => ({ requestChatResponse: vi.fn() }))
const request = vi.mocked(requestChatResponse)
const id = '79cc2fe3-050b-4b18-8b25-3b7c43198728'
const nodeId = 'a320b6ee-534f-44ac-8b54-a1a69bf87cc0'
const second = '8dcf68bf-950c-4db8-84e0-71d2ea8ce94e'
const time = '2026-10-20T04:00:00.000Z'
const nodes = [
    { id: nodeId, title: '销售整理', goal: '完整目标\n第二行', assigneeId: id, upstreamNodeId: null, position: { x: 0, y: 0 } },
    { id: second, title: '产品判断', goal: '判断范围', assigneeId: id, upstreamNodeId: nodeId, position: { x: 1000, y: 1000 } },
]
const input = { name: '协作流程', description: '完整说明', nodes }
const template = {
    ...input,
    id,
    version: 1,
    createdAt: time,
    updatedAt: time,
    nodes: nodes.map(node => ({ ...node, assigneeName: '同事', assigneeActive: true })),
}
afterEach(() => vi.resetAllMocks())
describe('workflow template browser boundary', () => {
    it('uses the discriminated catalog and never falls back after real failures', async () => {
        request
            .mockResolvedValueOnce(Response.json([{ kind: 'workflow', template }]))
            .mockResolvedValueOnce(Response.json({ message: '没有模板权限' }, { status: 403 }))
        await expect(listTemplateCatalog()).resolves.toEqual([{ kind: 'workflow', template }])
        await expect(getTemplateCatalogEntry(id)).rejects.toMatchObject({ status: 403 })
        expect(request).toHaveBeenCalledTimes(2)
        expect(request.mock.calls[1][0]).toBe(`/template-catalog/${id}`)
    })
    it('validates every tree before mutation and preserves exact layout and baseline version', async () => {
        request.mockResolvedValueOnce(Response.json(template)).mockResolvedValueOnce(Response.json({ ...template, version: 2 }))
        await createWorkflowTemplate({ ...input, requestId: id })
        await updateWorkflowTemplate(id, { ...input, version: 1 })
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ ...input, requestId: id })
        expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ ...input, version: 1 })
        await expect(
            createWorkflowTemplate({ ...input, requestId: id, nodes: [nodes[0]!, { ...nodes[1]!, upstreamNodeId: second }] })
        ).rejects.toThrow()
        expect(request).toHaveBeenCalledTimes(2)
    })
    it('returns exact frozen opening bytes and confirms only its preview identity', async () => {
        const preview = {
            previewId: id,
            templateId: id,
            version: 1,
            project: { name: input.name, description: input.description },
            nodes: template.nodes.map(node => ({ ...node, opening: '来自同事的实际前缀\n完整目标\n第二行' })),
            members: [{ userId: id, displayName: '同事', role: 'owner' }],
            scope: '仅列出的实际项目成员可见。',
            createdAt: time,
        }
        request
            .mockResolvedValueOnce(Response.json(preview))
            .mockRejectedValueOnce(new TypeError('lost response'))
            .mockResolvedValueOnce(Response.json({ projectId: id, nodeIds: [nodeId, second] }))
        await expect(
            previewWorkflowTemplate(id, {
                version: 1,
                name: input.name,
                description: input.description,
                assignees: nodes.map(node => ({ nodeId: node.id, assigneeId: node.assigneeId })),
            })
        ).resolves.toEqual(preview)
        const confirmation = { requestId: second, previewId: id }
        await expect(launchWorkflowTemplate(id, confirmation)).rejects.toThrow('lost response')
        await expect(launchWorkflowTemplate(id, confirmation)).resolves.toMatchObject({ projectId: id })
        expect(request.mock.calls[1][1]?.body).toBe(request.mock.calls[2][1]?.body)
        expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual(confirmation)
        await expect(launchWorkflowTemplate(id, { ...confirmation, opening: 'hidden changes' } as never)).rejects.toThrow()
        expect(request).toHaveBeenCalledTimes(3)
    })
    it('rejects unknown kinds and server-only fields rather than rendering a false empty collection', async () => {
        request
            .mockResolvedValueOnce(Response.json([{ kind: 'unknown', template }]))
            .mockResolvedValueOnce(Response.json({ kind: 'workflow', template, privateKey: 'secret' }))
        await expect(listTemplateCatalog()).rejects.toThrow()
        await expect(getTemplateCatalogEntry(id)).rejects.toThrow()
    })
})
