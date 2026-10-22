import { z } from 'zod'
import { projectFolderIdSchema } from './project-folders.js'

export const KNOWLEDGE_MAX_FILE_SIZE = 10 * 1024 * 1024
export const KNOWLEDGE_MAX_BODY_SIZE = KNOWLEDGE_MAX_FILE_SIZE + 64 * 1024
export const KNOWLEDGE_MAX_CHARACTERS = 2_000_000
export const KNOWLEDGE_MAX_CHUNKS = 5000
export const KNOWLEDGE_MAX_PAGES = 500
export const KNOWLEDGE_DEFAULT_CHUNK_SIZE = 1000
export const KNOWLEDGE_DEFAULT_OVERLAP = 200
export const knowledgeFormatSchema = z.enum(['txt', 'md', 'pdf', 'docx'])
export const knowledgeDocumentStatusSchema = z.enum(['queued', 'processing', 'ready', 'failed'])

const chunkingFields = {
    chunkSize: z.number().int().min(200, '最大分片长度至少为 200 字符。').max(4000, '最大分片长度最多为 4000 字符。'),
    overlap: z.number().int().min(0, '最大重叠长度不能为负数。').max(500, '最大重叠长度最多为 500 字符。'),
}
/**
 * Checks the shared overlap bound after the individual numeric fields are validated.
 * @param value - Validated numeric chunk settings.
 * @returns Whether the configured overlap budget is at most half the maximum chunk length.
 */
function boundedOverlap(value: { chunkSize: number; overlap: number }): boolean {
    return value.overlap <= Math.floor(value.chunkSize / 2)
}
const overlapIssue = { message: '最大重叠长度不能超过最大分片长度的一半。', path: ['overlap'] }
export const knowledgeChunkingSchema = z.object(chunkingFields).strict().refine(boundedOverlap, overlapIssue)
export const knowledgeUploadSchema = z
    .object({ requestId: z.uuid(), projectFolderId: projectFolderIdSchema.optional(), ...chunkingFields })
    .strict()
    .refine(boundedOverlap, overlapIssue)
export const knowledgeRetrySchema = z.object({ requestId: z.uuid() }).strict()
export const knowledgePageQuerySchema = z
    .object({
        page: z.coerce.number().int().min(1).max(100_000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        query: z.string().trim().max(180).default(''),
        projectFolderId: projectFolderIdSchema.optional(),
    })
    .strict()
export const knowledgeDocumentSchema = z
    .object({
        id: z.uuid(),
        projectFolderId: projectFolderIdSchema.optional(),
        fileName: z.string().min(1).max(180),
        format: knowledgeFormatSchema,
        size: z.number().int().positive().max(KNOWLEDGE_MAX_FILE_SIZE),
        status: knowledgeDocumentStatusSchema,
        ...chunkingFields,
        characterCount: z.number().int().min(0).max(KNOWLEDGE_MAX_CHARACTERS),
        chunkCount: z.number().int().min(0).max(KNOWLEDGE_MAX_CHUNKS),
        pageCount: z.number().int().positive().max(KNOWLEDGE_MAX_PAGES).optional(),
        attempt: z.number().int().nonnegative(),
        error: z.string().max(500).optional(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
    .refine(boundedOverlap, overlapIssue)
export const knowledgeChunkDraftSchema = z
    .object({
        index: z.number().int().min(1).max(KNOWLEDGE_MAX_CHUNKS),
        content: z.string().min(1).max(8000),
        characterCount: z.number().int().positive().max(4000),
        charStart: z.number().int().nonnegative().max(KNOWLEDGE_MAX_CHARACTERS),
        charEnd: z.number().int().positive().max(KNOWLEDGE_MAX_CHARACTERS),
        pageStart: z.number().int().positive().max(KNOWLEDGE_MAX_PAGES).optional(),
        pageEnd: z.number().int().positive().max(KNOWLEDGE_MAX_PAGES).optional(),
    })
    .strict()
export const knowledgeChunkSchema = knowledgeChunkDraftSchema.extend({ id: z.uuid(), documentId: z.uuid() }).strict()
export const knowledgeProcessingResultSchema = z
    .object({
        characterCount: z.number().int().positive().max(KNOWLEDGE_MAX_CHARACTERS),
        pageCount: z.number().int().positive().max(KNOWLEDGE_MAX_PAGES).optional(),
        chunks: z.array(knowledgeChunkDraftSchema).min(1).max(KNOWLEDGE_MAX_CHUNKS),
    })
    .strict()
const pageFields = { total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().min(1).max(100) }
export const knowledgeDocumentsSchema = z.object({ documents: z.array(knowledgeDocumentSchema), ...pageFields }).strict()
export const knowledgeChunksSchema = z.object({ chunks: z.array(knowledgeChunkSchema), ...pageFields }).strict()
export const knowledgeStatusSchema = z
    .object({
        configured: z.boolean(),
        supportedFormats: z.array(knowledgeFormatSchema),
        maxFileSize: z.literal(KNOWLEDGE_MAX_FILE_SIZE),
        defaultChunkSize: z.literal(KNOWLEDGE_DEFAULT_CHUNK_SIZE),
        defaultOverlap: z.literal(KNOWLEDGE_DEFAULT_OVERLAP),
    })
    .strict()
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>
export type KnowledgeChunk = z.infer<typeof knowledgeChunkSchema>
export type KnowledgeChunkDraft = z.infer<typeof knowledgeChunkDraftSchema>
export type KnowledgeProcessingResult = z.infer<typeof knowledgeProcessingResultSchema>
export type KnowledgeFormat = z.infer<typeof knowledgeFormatSchema>
export type KnowledgeChunking = z.infer<typeof knowledgeChunkingSchema>
export type KnowledgeUpload = z.infer<typeof knowledgeUploadSchema>
export type KnowledgeRetry = z.infer<typeof knowledgeRetrySchema>
export type KnowledgePageQuery = z.infer<typeof knowledgePageQuerySchema>
export type KnowledgeDocuments = z.infer<typeof knowledgeDocumentsSchema>
export type KnowledgeChunks = z.infer<typeof knowledgeChunksSchema>
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>
