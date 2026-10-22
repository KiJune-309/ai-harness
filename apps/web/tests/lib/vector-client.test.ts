import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    getKnowledgeVectorIndex,
    getVectorStatus,
    knowledgeChunkSource,
    searchKnowledgeVectors,
    startKnowledgeVectorIndex,
} from '../../lib/vector-client'

const id = 'bc867502-e10c-4acf-8d8a-f8f7a99efaae'
const space = { id, name: '向量服务', model: 'embed', revision: 2, dimensions: 3, providerModel: 'actual-embed' }
const index = { documentId: id, status: 'queued', generation: 1, attempt: 0, completedChunks: 0, totalChunks: 22, model: space }
const action = { requestId: id, modelId: id, revision: 2 }
const hit = {
    documentId: id,
    fileName: '来源.md',
    distance: 0.1,
    score: 0.9,
    chunk: { id, documentId: id, index: 22, content: '完整原始资料', characterCount: 6, charStart: 40, charEnd: 46 },
}
afterEach(() => vi.unstubAllGlobals())

describe('vector document client', () => {
    it('loads actual capabilities and durable index state without provider action requests', async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ available: false, defaultModel: null, reason: '未启用扩展' }))
            .mockResolvedValueOnce(Response.json(index))
        vi.stubGlobal('fetch', request)
        await expect(getVectorStatus()).resolves.toMatchObject({ available: false })
        await expect(getKnowledgeVectorIndex(id)).resolves.toEqual(index)
        expect(request.mock.calls.map(call => call[0])).toEqual(['/api/knowledge/vector-status', `/api/knowledge/documents/${id}/index`])
        for (const call of request.mock.calls) expect(call[1]!.method).toBeUndefined()
    })

    it('retains the confirmed default identity and same UUID across an uncertain index response', async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ message: '暂时不可用' }, { status: 503 }))
            .mockResolvedValueOnce(Response.json(index))
            .mockResolvedValueOnce(Response.json(index))
        vi.stubGlobal('fetch', request)
        await expect(startKnowledgeVectorIndex(id, action)).rejects.toThrow('暂时不可用')
        await startKnowledgeVectorIndex(id, action)
        await startKnowledgeVectorIndex(id, action, true)
        for (const call of request.mock.calls) expect(JSON.parse(call[1]!.body as string)).toEqual(action)
        expect(request.mock.calls[2]![0]).toBe(`/api/knowledge/documents/${id}/index/retry`)
    })

    it('uses validated Unicode queries and renders exact original source links including later chunk pages', async () => {
        const result = { query: '中文😀', model: space, hits: [hit] }
        const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result))
        vi.stubGlobal('fetch', request)
        await expect(searchKnowledgeVectors({ query: ' 中文😀 ', topK: 5, documentId: id })).resolves.toEqual(result)
        expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ query: '中文😀', topK: 5, documentId: id })
        expect(knowledgeChunkSource(id, 22)).toBe(`/rag/${id}?chunk=22#chunk-22`)
        await expect(searchKnowledgeVectors({ query: '😀'.repeat(2001), topK: 5 })).rejects.toThrow()
        expect(request).toHaveBeenCalledTimes(1)
    })

    it('refuses private vectors and inconsistent source scores instead of showing misleading results', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn<typeof fetch>()
                .mockResolvedValueOnce(Response.json({ query: '问题', model: space, hits: [{ ...hit, score: 90 }] }))
                .mockResolvedValueOnce(Response.json({ ...index, vectors: [[1, 0, 0]] }))
        )
        await expect(searchKnowledgeVectors({ query: '问题', topK: 5 })).rejects.toThrow('无效的数据')
        await expect(getKnowledgeVectorIndex(id)).rejects.toThrow('无效的数据')
    })
})
