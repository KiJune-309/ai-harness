import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    downloadKnowledgeFile,
    getKnowledgeChunks,
    getKnowledgeDocument,
    getKnowledgeStatus,
    listKnowledgeDocuments,
    retryKnowledgeDocument,
    uploadKnowledgeDocument,
} from '../../lib/knowledge-client'

const id = '329044e6-368b-4da4-9eda-a69b403bbda2'
const document = {
    id,
    fileName: '资料.md',
    format: 'md',
    size: 120,
    status: 'ready',
    chunkSize: 1000,
    overlap: 200,
    chunkCount: 1,
    characterCount: 4,
    attempt: 1,
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
}
const chunk = { id, documentId: id, index: 1, content: '中文😀资料', charStart: 0, charEnd: 5, characterCount: 5 }
afterEach(() => vi.unstubAllGlobals())

describe('knowledge client', () => {
    it('reads encoded stable records, filename pages, chunks and explicit service capabilities', async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                Response.json({
                    configured: true,
                    supportedFormats: ['txt', 'md', 'pdf', 'docx'],
                    maxFileSize: 10 * 1024 * 1024,
                    defaultChunkSize: 1000,
                    defaultOverlap: 200,
                })
            )
            .mockResolvedValueOnce(Response.json({ documents: [document], page: 2, pageSize: 20, total: 21 }))
            .mockResolvedValueOnce(Response.json(document))
            .mockResolvedValueOnce(Response.json({ chunks: [chunk], page: 1, pageSize: 20, total: 1 }))
        vi.stubGlobal('fetch', request)
        await expect(getKnowledgeStatus()).resolves.toMatchObject({ configured: true })
        await expect(listKnowledgeDocuments({ page: 2, pageSize: 20, query: '中文 & hi' })).resolves.toMatchObject({
            total: 21,
            documents: [document],
        })
        await expect(getKnowledgeDocument('path/segment?')).resolves.toEqual(document)
        await expect(getKnowledgeChunks(id, 1)).resolves.toMatchObject({ chunks: [chunk] })
        expect(request.mock.calls[1]![0]).toBe('/api/knowledge/documents?page=2&pageSize=20&query=%E4%B8%AD%E6%96%87+%26+hi')
        expect(request.mock.calls[2]![0]).toBe('/api/knowledge/documents/path%2Fsegment%3F')
        for (const call of request.mock.calls) expect(call[1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' })
    })

    it('sends actual original files and retains exact upload and retry action IDs', async () => {
        const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(document))
        vi.stubGlobal('fetch', request)
        const file = new File(['真实内容'], '资料.md', { type: 'text/markdown' })
        await uploadKnowledgeDocument(file, { requestId: id, chunkSize: 1000, overlap: 200 })
        const options = request.mock.calls[0]![1]!
        const form = options.body as FormData
        expect(form.get('requestId')).toBe(id)
        expect(form.get('chunkSize')).toBe('1000')
        expect(form.get('overlap')).toBe('200')
        expect(await (form.get('file') as File).text()).toBe('真实内容')
        expect(options.headers).toBeUndefined()
        request
            .mockResolvedValueOnce(Response.json({ message: '暂时不可用' }, { status: 503 }))
            .mockResolvedValueOnce(Response.json(document))
        await expect(retryKnowledgeDocument(id, id)).rejects.toThrow('暂时不可用')
        await retryKnowledgeDocument(id, id)
        expect(request.mock.calls[1]![1]!.body).toBe(JSON.stringify({ requestId: id }))
        expect(request.mock.calls[2]![1]!.body).toBe(JSON.stringify({ requestId: id }))
    })

    it('rejects invalid files and shared parameter bounds before sending upload bytes', async () => {
        const request = vi.fn<typeof fetch>()
        vi.stubGlobal('fetch', request)
        const input = { requestId: id, chunkSize: 1000, overlap: 200 }
        await expect(uploadKnowledgeDocument(new File([], 'empty.txt'), input)).rejects.toThrow('大于 0')
        await expect(uploadKnowledgeDocument(new File(['no'], 'image.png'), input)).rejects.toThrow('请选择 TXT')
        await expect(uploadKnowledgeDocument(new File(['yes'], 'notes.txt'), { ...input, chunkSize: 200, overlap: 101 })).rejects.toThrow()
        await expect(uploadKnowledgeDocument(new File(['yes'], 'notes.txt'), { ...input, requestId: 'wrong' })).rejects.toThrow()
        expect(request).not.toHaveBeenCalled()
    })

    it('rejects malformed successful records instead of presenting a false empty or saved state', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn<typeof fetch>()
                .mockResolvedValueOnce(Response.json({ documents: [], total: 0 }))
                .mockResolvedValueOnce(Response.json({ ...document, objectKey: 'private/file' }))
                .mockResolvedValueOnce(Response.json({ chunks: [{ ...chunk, content: '' }], total: 1, page: 1, pageSize: 20 }))
        )
        await expect(listKnowledgeDocuments({ page: 1, pageSize: 20, query: '' })).rejects.toThrow('无效的数据')
        await expect(getKnowledgeDocument(id)).rejects.toThrow('无效的数据')
        await expect(getKnowledgeChunks(id, 1)).rejects.toThrow('无效的数据')
    })

    it('preserves original binary downloads and keeps failures in the current page', async () => {
        const bytes = new Uint8Array([0, 255, 37, 80, 68, 70])
        vi.stubGlobal(
            'fetch',
            vi
                .fn<typeof fetch>()
                .mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'application/pdf' } }))
                .mockResolvedValueOnce(new Response('upstream html', { status: 502 }))
                .mockRejectedValueOnce(new TypeError('private transport address'))
        )
        const blob = await downloadKnowledgeFile(id)
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
        await expect(downloadKnowledgeFile(id)).rejects.toThrow('资料库请求失败（502）')
        await expect(getKnowledgeStatus()).rejects.toThrow('暂时无法连接资料库')
    })

    it('notifies the account boundary on session loss and forwards caller cancellation', async () => {
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { dispatchEvent })
        const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: '请登录' }, { status: 401 }))
        vi.stubGlobal('fetch', request)
        const controller = new AbortController()
        await expect(getKnowledgeStatus(controller.signal)).rejects.toThrow('请登录')
        expect(dispatchEvent.mock.calls[0]![0].type).toBe('harness:unauthorized')
        controller.abort()
        expect(request.mock.calls[0]![1]!.signal!.aborted).toBe(true)
    })
})

describe('personal project knowledge request boundaries', () => {
    it('preserves the exact project in list, metadata, chunks, source download and upload requests', async () => {
        const folderId = '642f7bcd-c9ce-4ac0-985a-45b1e8378a79'
        const scoped = { ...document, projectFolderId: folderId }
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ documents: [scoped], total: 1, page: 1, pageSize: 20 }))
            .mockResolvedValueOnce(Response.json(scoped))
            .mockResolvedValueOnce(Response.json({ chunks: [chunk], total: 1, page: 1, pageSize: 20 }))
            .mockResolvedValueOnce(new Response('原件'))
            .mockResolvedValueOnce(Response.json(scoped))
        vi.stubGlobal('fetch', request)
        await listKnowledgeDocuments({ page: 1, pageSize: 20, query: '', projectFolderId: folderId })
        await getKnowledgeDocument(id, undefined, folderId)
        await getKnowledgeChunks(id, 1, undefined, folderId)
        await downloadKnowledgeFile(id, undefined, folderId)
        await uploadKnowledgeDocument(new File(['项目资料'], '资料.md'), {
            requestId: id,
            chunkSize: 1000,
            overlap: 200,
            projectFolderId: folderId,
        })
        for (const call of request.mock.calls.slice(0, 4))
            expect(new URL(String(call[0]), 'http://localhost').searchParams.get('projectFolderId')).toBe(folderId)
        expect((request.mock.calls[4]![1]!.body as FormData).get('projectFolderId')).toBe(folderId)
    })
})

it('does not display successful-looking documents from a different project response', async () => {
    const folderId = '642f7bcd-c9ce-4ac0-985a-45b1e8378a79'
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ documents: [document], total: 1, page: 1, pageSize: 20 }))
        .mockResolvedValueOnce(Response.json(document))
    vi.stubGlobal('fetch', request)
    await expect(listKnowledgeDocuments({ page: 1, pageSize: 20, query: '', projectFolderId: folderId })).rejects.toThrow('所属项目不一致')
    await expect(getKnowledgeDocument(id, undefined, folderId)).rejects.toThrow('所属项目不一致')
})
