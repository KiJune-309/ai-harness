import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createProjectFolderSchema, projectFolderSchema } from '../src/project-folders.js'
import { knowledgeDocumentSchema, knowledgePageQuerySchema, knowledgeUploadSchema } from '../src/knowledge.js'

describe('private project folder contracts', () => {
    it('normalizes human folder names while rejecting client-supplied ownership and unknown fields', () => {
        const input = { requestId: randomUUID(), name: ' 网站改版 ' }
        expect(createProjectFolderSchema.parse(input)).toEqual({ ...input, name: '网站改版' })
        expect(createProjectFolderSchema.parse({ ...input, requestId: input.requestId.toUpperCase() }).requestId).toBe(input.requestId)
        for (const change of [{ name: '' }, { name: '  ' }, { name: '字'.repeat(121) }, { userId: randomUUID() }, { shared: true }])
            expect(createProjectFolderSchema.safeParse({ ...input, ...change }).success).toBe(false)
        const folder = {
            id: input.requestId,
            name: '网站改版',
            createdAt: '2026-10-22T00:00:00.000Z',
            updatedAt: '2026-10-22T00:00:00.000Z',
        }
        expect(projectFolderSchema.parse(folder)).toEqual(folder)
        expect(projectFolderSchema.safeParse({ ...folder, creation_name: '内部创建信息' }).success).toBe(false)
    })

    it('accepts only exact project identities in uploads, queries and public file metadata', () => {
        const projectFolderId = randomUUID()
        const upload = { requestId: randomUUID(), projectFolderId, chunkSize: 1000, overlap: 200 }
        expect(knowledgeUploadSchema.parse(upload)).toEqual(upload)
        expect(knowledgeUploadSchema.parse({ ...upload, projectFolderId: projectFolderId.toUpperCase() }).projectFolderId).toBe(
            projectFolderId
        )
        expect(knowledgePageQuerySchema.parse({ projectFolderId })).toEqual({ page: 1, pageSize: 20, query: '', projectFolderId })
        expect(knowledgeUploadSchema.safeParse({ ...upload, projectFolderId: 'forged-folder' }).success).toBe(false)
        expect(knowledgePageQuerySchema.safeParse({ projectFolderId: '' }).success).toBe(false)
        const document = {
            id: randomUUID(),
            projectFolderId,
            fileName: '资料.md',
            format: 'md',
            size: 10,
            status: 'queued',
            chunkSize: 1000,
            overlap: 200,
            characterCount: 0,
            chunkCount: 0,
            attempt: 0,
            createdAt: '2026-10-22T00:00:00.000Z',
            updatedAt: '2026-10-22T00:00:00.000Z',
        }
        expect(knowledgeDocumentSchema.parse(document)).toEqual(document)
        expect(knowledgeDocumentSchema.safeParse({ ...document, projectFolderId: 'invalid' }).success).toBe(false)
    })
})
