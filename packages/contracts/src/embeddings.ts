import { z } from 'zod'
import { KNOWLEDGE_MAX_CHUNKS, knowledgeChunkSchema } from './knowledge.js'

export const EMBEDDING_MAX_DIMENSIONS = 4096
export const EMBEDDING_MAX_INPUTS = 16
export const EMBEDDING_MAX_REQUEST_BYTES = 64 * 1024
export const EMBEDDING_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const EMBEDDING_TIMEOUT_MS = 30_000
export const EMBEDDING_MAX_CONCURRENCY = 4
export const KNOWLEDGE_SEARCH_MAX_CHARACTERS = 2000
export const KNOWLEDGE_SEARCH_MAX_TOP_K = 20
export const KNOWLEDGE_SEARCH_DEFAULT_TOP_K = 5

const embeddingFields = {
    name: z.string().trim().min(1, '请填写连接名称。').max(60, '连接名称最多 60 个字。'),
    baseUrl: z.string().trim().min(1, '请填写 API 基础地址。').max(2048, '地址过长。'),
    model: z.string().trim().min(1, '请填写 embedding 模型标识。').max(120, '模型标识最多 120 个字符。'),
}
const revisionSchema = z.number().int().positive('配置版本无效，请重新载入连接。')
const dimensionsSchema = z.number().int().min(1).max(EMBEDDING_MAX_DIMENSIONS)
const providerModelSchema = z.string().trim().min(1).max(512)

export const createEmbeddingModelSchema = z
    .object({ ...embeddingFields, requestId: z.uuid(), apiKey: z.string().trim().min(1, '请填写 API key。').max(8192, 'API key 过长。') })
    .strict()
export const updateEmbeddingModelSchema = z
    .object({ ...embeddingFields, revision: revisionSchema, apiKey: z.string().trim().max(8192, 'API key 过长。').optional() })
    .strict()

/**
 * Keeps actual dimensions, provider identity, and verification time as one public verification record.
 * @param model - Safe embedding connection metadata.
 * @returns Whether all three verification fields are present together or absent together.
 */
function completeVerification(model: { dimensions?: number; providerModel?: string; verifiedAt?: string }): boolean {
    const present = [model.dimensions, model.providerModel, model.verifiedAt].filter(value => value !== undefined).length
    return present === 0 || present === 3
}

export const embeddingModelSchema = z
    .object({
        ...embeddingFields,
        id: z.uuid(),
        hasApiKey: z.boolean(),
        isDefault: z.boolean(),
        revision: revisionSchema,
        dimensions: dimensionsSchema.optional(),
        providerModel: providerModelSchema.optional(),
        verifiedAt: z.iso.datetime().optional(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
    .refine(completeVerification, '向量连接的验证信息不完整，请重新载入。')
export const embeddingModelsSchema = z.object({ models: z.array(embeddingModelSchema) }).strict()
/**
 * Requires a successful test to include the complete verified identity rather than only a success label.
 * @param result - Public saved model returned after an explicit provider probe.
 * @returns Whether the model actually has its verification record.
 */
function verifiedTestResult(result: { model: { verifiedAt?: string } }): boolean {
    return result.model.verifiedAt !== undefined
}

export const embeddingModelTestSchema = z
    .object({ success: z.literal(true), message: z.string().max(500), model: embeddingModelSchema })
    .strict()
    .refine(verifiedTestResult, '向量模型测试未返回完整验证结果。')
export const embeddingSpaceSchema = z
    .object({
        id: z.uuid(),
        name: embeddingFields.name,
        revision: revisionSchema,
        model: embeddingFields.model,
        providerModel: providerModelSchema,
        dimensions: dimensionsSchema,
    })
    .strict()
export const vectorStatusSchema = z
    .object({ available: z.boolean(), defaultModel: embeddingModelSchema.nullable(), reason: z.string().max(500).optional() })
    .strict()

/**
 * Validates bounded progress and the absence of a fabricated job for an unindexed source.
 * @param index - Public index status and durable progress counters.
 * @returns Whether progress is consistent with its source and its unindexed state.
 */
function validIndexProgress(index: {
    status: string
    generation: number
    attempt: number
    completedChunks: number
    totalChunks: number
}): boolean {
    return (
        index.completedChunks <= index.totalChunks &&
        (index.status !== 'none' || (index.generation === 0 && index.attempt === 0 && index.completedChunks === 0))
    )
}

export const knowledgeVectorIndexSchema = z
    .object({
        documentId: z.uuid(),
        status: z.enum(['none', 'queued', 'indexing', 'ready', 'failed', 'stale']),
        generation: z.number().int().nonnegative(),
        attempt: z.number().int().nonnegative(),
        completedChunks: z.number().int().min(0).max(KNOWLEDGE_MAX_CHUNKS),
        totalChunks: z.number().int().min(0).max(KNOWLEDGE_MAX_CHUNKS),
        model: embeddingSpaceSchema.optional(),
        error: z.string().max(500).optional(),
        createdAt: z.iso.datetime().optional(),
        updatedAt: z.iso.datetime().optional(),
    })
    .strict()
    .refine(validIndexProgress, '向量索引进度无效，请重新载入。')
export const knowledgeIndexActionSchema = z.object({ requestId: z.uuid(), modelId: z.uuid(), revision: revisionSchema }).strict()

/**
 * Counts query code points without cutting or miscounting a Unicode surrogate pair.
 * @param query - Trimmed user query text.
 * @returns Whether the query meets the explicit Unicode character limit.
 */
function validQueryLength(query: string): boolean {
    const length = Array.from(query).length
    return length >= 1 && length <= KNOWLEDGE_SEARCH_MAX_CHARACTERS
}

const querySchema = z.string().trim().refine(validQueryLength, '查询须为 1–2000 个 Unicode 字符。')
export const knowledgeSearchSchema = z
    .object({
        query: querySchema,
        topK: z
            .number()
            .int()
            .min(1, 'Top K 至少为 1。')
            .max(KNOWLEDGE_SEARCH_MAX_TOP_K, 'Top K 最多为 20。')
            .default(KNOWLEDGE_SEARCH_DEFAULT_TOP_K),
        documentId: z.uuid().optional(),
    })
    .strict()

/**
 * Keeps a returned source identity and its explicitly defined cosine score consistent.
 * @param hit - Public nearest-neighbor result containing a complete original chunk.
 * @returns Whether its source matches the chunk and its score equals one minus distance.
 */
function validSearchHit(hit: { documentId: string; chunk: { documentId: string }; distance: number; score: number }): boolean {
    return hit.documentId === hit.chunk.documentId && Math.abs(hit.score - (1 - hit.distance)) <= 1e-9
}

export const knowledgeSearchHitSchema = z
    .object({
        documentId: z.uuid(),
        fileName: z.string().min(1).max(180),
        chunk: knowledgeChunkSchema,
        distance: z.number().min(0).max(2),
        score: z.number().min(-1).max(1),
    })
    .strict()
    .refine(validSearchHit, '召回结果的来源或余弦分数不一致。')
export const knowledgeSearchResultSchema = z
    .object({ query: querySchema, model: embeddingSpaceSchema, hits: z.array(knowledgeSearchHitSchema).max(KNOWLEDGE_SEARCH_MAX_TOP_K) })
    .strict()

export type EmbeddingModel = z.infer<typeof embeddingModelSchema>
export type CreateEmbeddingModel = z.infer<typeof createEmbeddingModelSchema>
export type UpdateEmbeddingModel = z.infer<typeof updateEmbeddingModelSchema>
export type EmbeddingModels = z.infer<typeof embeddingModelsSchema>
export type EmbeddingModelTest = z.infer<typeof embeddingModelTestSchema>
export type EmbeddingSpace = z.infer<typeof embeddingSpaceSchema>
export type VectorStatus = z.infer<typeof vectorStatusSchema>
export type KnowledgeVectorIndex = z.infer<typeof knowledgeVectorIndexSchema>
export type KnowledgeIndexAction = z.infer<typeof knowledgeIndexActionSchema>
export type KnowledgeSearch = z.infer<typeof knowledgeSearchSchema>
export type KnowledgeSearchHit = z.infer<typeof knowledgeSearchHitSchema>
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>
