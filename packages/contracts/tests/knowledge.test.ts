import { describe, expect, it } from 'vitest'
import {
    knowledgeChunkingSchema,
    knowledgeDocumentSchema,
    knowledgeUploadSchema,
    knowledgePageQuerySchema,
    KNOWLEDGE_MAX_FILE_SIZE,
} from '../src/index.js'

describe('public knowledge boundaries', () => {
    it('accepts character settings while refusing ambiguous and excessive overlap', () => {
        expect(knowledgeChunkingSchema.parse({ chunkSize: 1000, overlap: 200 })).toEqual({ chunkSize: 1000, overlap: 200 })
        for (const value of [
            { chunkSize: 199, overlap: 0 },
            { chunkSize: 4001, overlap: 0 },
            { chunkSize: 200, overlap: 101 },
            { chunkSize: 1000, overlap: 501 },
            { chunkSize: 200, overlap: -1 },
        ])
            expect(knowledgeChunkingSchema.safeParse(value).success).toBe(false)
    })
    it('requires stable action IDs and bounds pagination before database queries', () => {
        expect(knowledgeUploadSchema.safeParse({ requestId: 'forged', chunkSize: 1000, overlap: 200 }).success).toBe(false)
        expect(knowledgePageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, query: '' })
        for (const value of [{ page: -1 }, { pageSize: 101 }, { page: '1 OR 1=1' }, { query: 'x'.repeat(181) }])
            expect(knowledgePageQuerySchema.safeParse(value).success).toBe(false)
    })
    it('never admits internal object fields or secrets into public document responses', () => {
        const document = {
            id: '9e1366b1-58fc-405c-a0b0-07ae76ba99db',
            fileName: '资料.md',
            format: 'md',
            size: 10,
            status: 'queued',
            chunkSize: 1000,
            overlap: 200,
            characterCount: 0,
            chunkCount: 0,
            attempt: 0,
            createdAt: '2026-10-17T01:00:00.000Z',
            updatedAt: '2026-10-17T01:00:00.000Z',
        }
        expect(knowledgeDocumentSchema.safeParse(document).success).toBe(true)
        for (const key of ['objectKey', 'secretAccessKey', 'sha256', 'leaseToken'])
            expect(knowledgeDocumentSchema.safeParse({ ...document, [key]: 'private-value' }).success).toBe(false)
        expect(knowledgeDocumentSchema.safeParse({ ...document, size: KNOWLEDGE_MAX_FILE_SIZE + 1 }).success).toBe(false)
    })
})
