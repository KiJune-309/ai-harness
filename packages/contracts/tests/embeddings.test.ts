import { describe, expect, it } from 'vitest'
import {
    createEmbeddingModelSchema,
    updateEmbeddingModelSchema,
    embeddingModelSchema,
    embeddingSpaceSchema,
    knowledgeVectorIndexSchema,
    knowledgeIndexActionSchema,
    knowledgeSearchSchema,
    knowledgeSearchResultSchema,
    vectorStatusSchema,
    embeddingModelTestSchema,
} from '../src/index.js'

const id = 'bfb0ddae-4a94-4e0d-8bd7-20e19ac887f0'
const model = {
    id,
    name: '向量连接',
    baseUrl: 'https://embedding.example/v1',
    model: 'embedding-stable-v1',
    hasApiKey: true,
    isDefault: true,
    revision: 1,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
}
const verified = { ...model, dimensions: 3, providerModel: 'provider-embedding-v1', verifiedAt: model.updatedAt }
const space = { id, name: model.name, revision: 1, model: model.model, dimensions: 3, providerModel: verified.providerModel }
const chunk = { id, documentId: id, index: 1, content: '真实原片', characterCount: 4, charStart: 0, charEnd: 4 }
const hit = { documentId: id, fileName: '来源.txt', chunk, distance: 0.25, score: 0.75 }

describe('embedding public contracts', () => {
    it('keeps creation identifiers and update revisions explicit while preserving blank replacement keys', () => {
        expect(
            createEmbeddingModelSchema.parse({
                name: ' 向量 ',
                baseUrl: ' https://cloud.example/v1 ',
                model: ' embed ',
                apiKey: ' private ',
                requestId: id,
            })
        ).toEqual({ name: '向量', baseUrl: 'https://cloud.example/v1', model: 'embed', apiKey: 'private', requestId: id })
        expect(
            updateEmbeddingModelSchema.parse({ name: '向量', baseUrl: model.baseUrl, model: model.model, revision: 1, apiKey: ' ' }).apiKey
        ).toBe('')
        expect(updateEmbeddingModelSchema.safeParse({ name: model.name, baseUrl: model.baseUrl, model: model.model }).success).toBe(false)
        expect(
            createEmbeddingModelSchema.safeParse({
                name: model.name,
                baseUrl: model.baseUrl,
                model: model.model,
                apiKey: '',
                requestId: id,
            }).success
        ).toBe(false)
        expect(
            updateEmbeddingModelSchema.safeParse({ name: model.name, baseUrl: model.baseUrl, model: model.model, revision: 0 }).success
        ).toBe(false)
    })

    it('requires verification dimensions, provider model and timestamp together', () => {
        expect(embeddingModelSchema.safeParse(model).success).toBe(true)
        expect(embeddingModelSchema.safeParse(verified).success).toBe(true)
        for (const patch of [
            { dimensions: 3 },
            { providerModel: 'provider' },
            { verifiedAt: model.updatedAt },
            { dimensions: 3, providerModel: 'provider' },
            { dimensions: 0, providerModel: 'provider', verifiedAt: model.updatedAt },
            { dimensions: 4097, providerModel: 'provider', verifiedAt: model.updatedAt },
        ])
            expect(embeddingModelSchema.safeParse({ ...model, ...patch }).success).toBe(false)
        expect(embeddingSpaceSchema.safeParse(space).success).toBe(true)
        expect(embeddingModelTestSchema.safeParse({ success: true, message: '已验证', model: verified }).success).toBe(true)
        expect(embeddingModelTestSchema.safeParse({ success: true, message: '假成功', model }).success).toBe(false)
        expect(vectorStatusSchema.safeParse({ available: false, defaultModel: null, reason: '未配置' }).success).toBe(true)
    })

    it('rejects private credentials, vectors, fingerprints and routing details in safe responses', () => {
        for (const key of ['apiKey', 'encryptedApiKey', 'creationFingerprint', 'vectors', 'allowedLocalOrigins']) {
            expect(embeddingModelSchema.safeParse({ ...verified, [key]: 'secret' }).success).toBe(false)
            expect(embeddingSpaceSchema.safeParse({ ...space, [key]: 'secret' }).success).toBe(false)
        }
        expect(knowledgeSearchResultSchema.safeParse({ query: '问题', model: space, hits: [{ ...hit, vector: [1, 0, 0] }] }).success).toBe(
            false
        )
    })

    it('counts query Unicode characters, normalizes edge whitespace and bounds Top K', () => {
        expect(knowledgeSearchSchema.parse({ query: ' 问题😀 ' })).toEqual({ query: '问题😀', topK: 5 })
        expect(knowledgeSearchSchema.safeParse({ query: '😀'.repeat(2000), topK: 20, documentId: id }).success).toBe(true)
        for (const input of [
            { query: ' ' },
            { query: '😀'.repeat(2001) },
            { query: 'x', topK: 0 },
            { query: 'x', topK: 21 },
            { query: 'x', topK: 1.5 },
            { query: 'x', documentId: 'wrong' },
            { query: 'x', modelId: id },
        ])
            expect(knowledgeSearchSchema.safeParse(input).success).toBe(false)
    })

    it('requires confirmed default identity and rejects invented unindexed progress', () => {
        expect(knowledgeIndexActionSchema.parse({ requestId: id, modelId: id, revision: 1 })).toEqual({
            requestId: id,
            modelId: id,
            revision: 1,
        })
        expect(knowledgeIndexActionSchema.safeParse({ requestId: id }).success).toBe(false)
        const index = { documentId: id, status: 'none', generation: 0, attempt: 0, completedChunks: 0, totalChunks: 4 }
        expect(knowledgeVectorIndexSchema.safeParse(index).success).toBe(true)
        expect(knowledgeVectorIndexSchema.safeParse({ ...index, generation: 1 }).success).toBe(false)
        expect(knowledgeVectorIndexSchema.safeParse({ ...index, status: 'indexing', generation: 1, completedChunks: 5 }).success).toBe(
            false
        )
        expect(
            knowledgeVectorIndexSchema.safeParse({ ...index, status: 'ready', generation: 1, completedChunks: 4, model: space }).success
        ).toBe(true)
    })

    it('validates real cosine score meaning and exact source identities without exposing vectors', () => {
        expect(knowledgeSearchResultSchema.safeParse({ query: '问题', model: space, hits: [hit] }).success).toBe(true)
        for (const patch of [
            { distance: -0.1 },
            { distance: 2.1 },
            { score: 90 },
            { score: 0.5 },
            { documentId: 'a66e1e92-1717-4eb0-8a70-10c7b7925862' },
        ])
            expect(knowledgeSearchResultSchema.safeParse({ query: '问题', model: space, hits: [{ ...hit, ...patch }] }).success).toBe(false)
        expect(
            knowledgeSearchResultSchema.safeParse({ query: '问题', model: space, hits: [{ ...hit, distance: 2, score: -1 }] }).success
        ).toBe(true)
    })
})
