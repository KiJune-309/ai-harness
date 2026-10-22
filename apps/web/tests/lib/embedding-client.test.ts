import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    createEmbeddingModel,
    deleteEmbeddingModel,
    listEmbeddingModels,
    setDefaultEmbeddingModel,
    testEmbeddingModel,
    updateEmbeddingModel,
} from '../../lib/embedding-client'

const id = '6e999601-dff1-4f0e-a65e-bf5f67a829fc'
const model = {
    id,
    name: '向量服务',
    baseUrl: 'https://embedding.example/v1',
    model: 'embed-stable-v1',
    revision: 2,
    hasApiKey: true,
    isDefault: true,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
}
const verified = { ...model, dimensions: 3, providerModel: 'actual-embed-v1', verifiedAt: model.updatedAt }
afterEach(() => vi.unstubAllGlobals())

describe('independent embedding account client', () => {
    it('reads only the embedding directory and rejects credentials in public metadata', async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ models: [model] }))
            .mockResolvedValueOnce(Response.json({ models: [{ ...model, apiKey: 'secret' }] }))
        vi.stubGlobal('fetch', request)
        await expect(listEmbeddingModels()).resolves.toEqual([model])
        await expect(listEmbeddingModels()).rejects.toThrow('无效的数据')
        expect(request.mock.calls[0]![0]).toBe('/api/account/embedding-models')
        expect(request.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' })
    })

    it('preserves create identity and sends update revision without replacing a blank key', async () => {
        const request = vi.fn<typeof fetch>(async () => Response.json(model))
        vi.stubGlobal('fetch', request)
        await createEmbeddingModel({ requestId: id, name: ' 向量服务 ', baseUrl: model.baseUrl, model: model.model, apiKey: ' secret ' })
        expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({
            requestId: id,
            name: model.name,
            baseUrl: model.baseUrl,
            model: model.model,
            apiKey: 'secret',
        })
        await updateEmbeddingModel(id, { name: model.name, baseUrl: model.baseUrl, model: model.model, revision: 2, apiKey: '' })
        expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toMatchObject({ revision: 2, apiKey: '' })
        expect(request.mock.calls[1]![1]!.method).toBe('PUT')
    })

    it('tests and sets default only on explicit calls with no request body', async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ success: true, message: '3维', model: verified }))
            .mockResolvedValueOnce(Response.json(verified))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
        vi.stubGlobal('fetch', request)
        const signal = new AbortController().signal
        await expect(testEmbeddingModel(id, signal)).resolves.toMatchObject({ model: verified })
        await setDefaultEmbeddingModel(id)
        await deleteEmbeddingModel(id)
        expect(request.mock.calls.map(call => call[0])).toEqual([
            `/api/account/embedding-models/${id}/test`,
            `/api/account/embedding-models/${id}/default`,
            `/api/account/embedding-models/${id}`,
        ])
        expect(request.mock.calls[0]![1]).toMatchObject({ method: 'POST' })
        expect(request.mock.calls[1]![1]).toMatchObject({ method: 'POST' })
        for (const call of request.mock.calls) expect(call[1]!.body).toBeUndefined()
    })

    it('rejects stale or malformed writes before transport and notifies session invalidation', async () => {
        const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: '请先登录' }, { status: 401 }))
        const dispatchEvent = vi.fn()
        vi.stubGlobal('fetch', request)
        vi.stubGlobal('window', { dispatchEvent })
        await expect(
            updateEmbeddingModel(id, { name: model.name, baseUrl: model.baseUrl, model: model.model, revision: 0 })
        ).rejects.toThrow()
        expect(request).not.toHaveBeenCalled()
        await expect(listEmbeddingModels()).rejects.toThrow('请先登录')
        expect(dispatchEvent.mock.calls[0]![0].type).toBe('harness:unauthorized')
    })
})
