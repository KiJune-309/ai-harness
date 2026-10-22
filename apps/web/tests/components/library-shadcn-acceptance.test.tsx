// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Link from 'next/link'
import type { KnowledgeChunk, KnowledgeDocument } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryWorkspace } from '../../components/library-workspace'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    status: vi.fn(),
    list: vi.fn(),
    document: vi.fn(),
    chunks: vi.fn(),
    upload: vi.fn(),
    retry: vi.fn(),
    download: vi.fn(),
    navigate: vi.fn(),
    search: new URLSearchParams(),
    index: vi.fn(),
}))

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: api.navigate }),
    useSearchParams: () => api.search,
}))
vi.mock('../../lib/knowledge-client', () => ({
    getKnowledgeStatus: api.status,
    listKnowledgeDocuments: api.list,
    getKnowledgeDocument: api.document,
    getKnowledgeChunks: api.chunks,
    uploadKnowledgeDocument: api.upload,
    retryKnowledgeDocument: api.retry,
    downloadKnowledgeFile: api.download,
}))
vi.mock('../../components/knowledge-index', () => ({ KnowledgeIndexCard: api.index }))

const documentId = '4d892a8a-07e0-4273-bb63-b8a4bcd99fc1'
const time = '2026-10-18T00:00:00.000Z'
const sourceText = '<img src=x onerror="alert(1)">纯文本😀'
const lastLength = Array.from(sourceText).length
const ready: KnowledgeDocument = {
    id: documentId,
    fileName: '非敏感来源资料.txt',
    format: 'txt',
    size: 9000,
    status: 'ready',
    chunkSize: 200,
    overlap: 0,
    characterCount: 4000 + lastLength,
    chunkCount: 21,
    attempt: 1,
    createdAt: time,
    updatedAt: time,
}

/**
 * Builds exact public chunk intervals for the isolated source-pagination fixture.
 * @param index - One-based source chunk index.
 * @returns A public chunk with literal text and exact Unicode source coordinates.
 */
function sourceChunk(index: number): KnowledgeChunk {
    const content = index === 21 ? sourceText : '文'.repeat(200)
    return {
        id: `99a6d8a3-a8b2-4c87-bcac-${String(index).padStart(12, '0')}`,
        documentId,
        index,
        content,
        characterCount: Array.from(content).length,
        charStart: (index - 1) * 200,
        charEnd: (index - 1) * 200 + Array.from(content).length,
    }
}

beforeEach(() => {
    installAcceptanceBrowser()
    for (const mock of [api.status, api.list, api.document, api.chunks, api.upload, api.retry, api.download, api.navigate]) mock.mockReset()
    api.search = new URLSearchParams()
    api.index.mockReset().mockReturnValue(
        <section aria-label="独立向量索引">
            <p>尚未配置默认向量模型。</p>
            <Link href="/account#embedding-models">配置或测试向量模型</Link>
            <button type="button">开始建立索引</button>
            <Link href="/rag/search">检索此资料</Link>
        </section>
    )
    api.status.mockResolvedValue({
        configured: true,
        supportedFormats: ['txt', 'md', 'pdf', 'docx'],
        maxFileSize: 10 * 1024 * 1024,
        defaultChunkSize: 1000,
        defaultOverlap: 200,
    })
    api.list.mockResolvedValue({ documents: [], total: 0, page: 1, pageSize: 20 })
    api.document.mockResolvedValue(ready)
    api.chunks.mockImplementation(async (_id: string, page: number) => ({
        chunks: page === 2 ? [sourceChunk(21)] : Array.from({ length: 20 }, (_, index) => sourceChunk(index + 1)),
        total: 21,
        page,
        pageSize: 20,
    }))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('隔离控件验收不应请求外部服务。')))
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent shadcn knowledge upload and source controls', () => {
    it('retains an actual File and numeric settings after failure and retries the exact creation action using real official inputs', async () => {
        const user = userEvent.setup()
        render(<LibraryWorkspace />)
        await screen.findByRole('heading', { name: '上传你的第一份资料' })
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(screen.queryByLabelText(/原始文件/)).toBeNull()
        await user.click(screen.getByRole('button', { name: '上传资料' }))
        const dialog = await screen.findByRole('dialog', { name: '上传并分片' })
        const fileInput = within(dialog).getByLabelText(/原始文件/) as HTMLInputElement
        await waitFor(() => expect(document.activeElement).toBe(fileInput))
        expect(fileInput.getAttribute('data-slot')).toBe('input')
        expect(fileInput.type).toBe('file')
        expect(fileInput.accept).toBe('.txt,.md,.pdf,.docx')
        await user.click(screen.getByRole('button', { name: '上传并开始分片' }))
        await waitFor(() => expect(document.activeElement).toBe(fileInput))
        expect(api.upload).not.toHaveBeenCalled()
        const original = new File(['完整原文😀\n下一段。'], '段落资料.txt', { type: 'text/plain' })
        await user.upload(fileInput, original)
        const size = screen.getByRole('spinbutton', { name: /最大分片长度/ }) as HTMLInputElement
        const overlap = screen.getByRole('spinbutton', { name: /最大重叠长度/ }) as HTMLInputElement
        expect(size.getAttribute('data-slot')).toBe('input')
        await user.clear(size)
        await user.type(size, '200')
        await user.click(screen.getByRole('button', { name: '上传并开始分片' }))
        await waitFor(() => expect(document.activeElement).toBe(overlap))
        expect(fileInput.files?.[0]).toBe(original)
        expect(api.upload).not.toHaveBeenCalled()
        await user.clear(overlap)
        await user.type(overlap, '40')
        api.upload.mockRejectedValueOnce(new Error('受控原文件保存失败'))
        await user.click(screen.getByRole('button', { name: '上传并开始分片' }))
        await screen.findByText(/受控原文件保存失败/)
        expect(api.navigate).not.toHaveBeenCalled()
        expect(fileInput.files?.[0]).toBe(original)
        expect(size.value).toBe('200')
        expect(overlap.value).toBe('40')
        expect(api.upload).toHaveBeenCalledTimes(1)
        const firstAction = api.upload.mock.calls[0]![1]
        expect(firstAction).toEqual({ chunkSize: 200, overlap: 40, requestId: expect.any(String) })
        expect(firstAction.requestId).toMatch(/^[0-9a-f-]{36}$/i)
        api.upload.mockResolvedValueOnce({ ...ready, status: 'queued', chunkCount: 0, characterCount: 0, attempt: 0 })
        await user.click(screen.getByRole('button', { name: '上传并开始分片' }))
        await waitFor(() => expect(api.navigate).toHaveBeenCalledExactlyOnceWith(`/rag/${documentId}`))
        expect(api.upload).toHaveBeenCalledTimes(2)
        expect(api.upload.mock.calls[1]![0]).toBe(original)
        expect(api.upload.mock.calls[1]![1]).toEqual(firstAction)
        expect(fetch).not.toHaveBeenCalled()
    })

    it.each(['上传资料', '选择资料'])('opens a modal from %s and restores the actual opener after dismissal', async name => {
        const user = userEvent.setup()
        render(<LibraryWorkspace />)
        await screen.findByRole('heading', { name: '上传你的第一份资料' })
        const opener = screen.getByRole('button', { name })
        for (const dismissal of ['close', 'escape']) {
            await user.click(opener)
            const dialog = await screen.findByRole('dialog', { name: '上传并分片' })
            const fileInput = within(dialog).getByLabelText(/原始文件/)
            await waitFor(() => expect(document.activeElement).toBe(fileInput))
            if (dismissal === 'close') await user.click(within(dialog).getByRole('button', { name: '关闭上传表单' }))
            else await user.keyboard('{Escape}')
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
            expect(screen.queryByLabelText(/原始文件/)).toBeNull()
            await waitFor(() => expect(document.activeElement, `${name} after ${dismissal}`).toBe(opener))
        }
        expect(api.upload).not.toHaveBeenCalled()
    })

    it('keeps an in-flight upload open through close paths and submits the original file only once', async () => {
        const upload = acceptanceDeferred<KnowledgeDocument>()
        api.upload.mockReturnValueOnce(upload.promise)
        const user = userEvent.setup()
        render(<LibraryWorkspace />)
        await screen.findByRole('heading', { name: '上传你的第一份资料' })
        await user.click(screen.getByRole('button', { name: '上传资料' }))
        const dialog = await screen.findByRole('dialog', { name: '上传并分片' })
        const fileInput = within(dialog).getByLabelText(/原始文件/) as HTMLInputElement
        const original = new File(['待上传的完整原文'], '上传中资料.txt', { type: 'text/plain' })
        await user.upload(fileInput, original)
        const form = fileInput.closest('form')!
        act(() => {
            fireEvent.submit(form)
            fireEvent.submit(form)
        })
        expect(api.upload).toHaveBeenCalledTimes(1)
        expect(api.upload.mock.calls[0]![0]).toBe(original)
        expect(fileInput.matches(':disabled')).toBe(true)
        const close = within(dialog).getByRole('button', { name: '关闭上传表单' }) as HTMLButtonElement
        expect(close.disabled).toBe(true)
        await user.click(close)
        await user.keyboard('{Escape}')
        await user.click(document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!)
        expect(screen.getByRole('dialog', { name: '上传并分片' })).toBe(dialog)
        expect(api.upload).toHaveBeenCalledTimes(1)
        expect(api.upload.mock.calls[0]![2].aborted).toBe(false)
        expect(api.navigate).not.toHaveBeenCalled()
        await act(async () => upload.resolve({ ...ready, status: 'queued', chunkCount: 0, characterCount: 0, attempt: 0 }))
        await waitFor(() => expect(api.navigate).toHaveBeenCalledExactlyOnceWith(`/rag/${documentId}`))
        expect(api.upload).toHaveBeenCalledTimes(1)
        expect(fetch).not.toHaveBeenCalled()
    })

    it('loads the requested source page, keeps literal markup inert, preserves source focus and paginates without altering the document', async () => {
        api.search = new URLSearchParams('chunk=21')
        const user = userEvent.setup()
        render(<LibraryWorkspace documentId={documentId} />)
        const literal = await screen.findByText(sourceText)
        const source = document.getElementById('chunk-21')
        expect(source?.contains(literal)).toBe(true)
        expect(source?.querySelector('img')).toBeNull()
        expect(source?.textContent).toContain(`字符位置 [4000, ${4000 + lastLength})`)
        await waitFor(() => expect(document.activeElement).toBe(source))
        expect(api.chunks.mock.calls[0]!.slice(0, 2)).toEqual([documentId, 2])
        const next = screen.getByRole('button', { name: /下一页/ })
        expect(next.hasAttribute('disabled') || next.getAttribute('aria-disabled') === 'true').toBe(true)
        await user.click(screen.getByRole('button', { name: /上一页/ }))
        await screen.findByRole('heading', { name: '分片 001' })
        expect(api.chunks.mock.lastCall?.slice(0, 2)).toEqual([documentId, 1])
        await user.click(screen.getByRole('button', { name: /下一页/ }))
        await screen.findByText(sourceText)
        expect(api.chunks.mock.lastCall?.slice(0, 2)).toEqual([documentId, 2])
        api.download.mockRejectedValueOnce(new Error('受控对象读取失败'))
        await user.click(screen.getByRole('button', { name: '下载原文件' }))
        await screen.findByText('受控对象读取失败')
        expect(screen.getByText(sourceText)).toBeTruthy()
        expect(api.navigate).not.toHaveBeenCalled()
        expect(api.upload).not.toHaveBeenCalled()
        expect(api.retry).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
    })
})

it('keeps independent vector tools on global sources while project sources retain only their text, source focus and download', async () => {
    const global = render(<LibraryWorkspace documentId={documentId} />)
    await screen.findByRole('heading', { name: ready.fileName })
    expect(screen.getByRole('region', { name: '独立向量索引' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '配置或测试向量模型' })).toBeTruthy()
    global.unmount()

    const projectFolderId = '642f7bcd-c9ce-4ac0-985a-45b1e8378a79'
    api.search = new URLSearchParams({ projectFolderId, chunk: '21' })
    api.document.mockResolvedValue({ ...ready, projectFolderId })
    api.index.mockClear()
    const user = userEvent.setup()
    render(<LibraryWorkspace documentId={documentId} />)
    await screen.findByText(sourceText)
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('chunk-21')))
    expect(api.index).not.toHaveBeenCalled()
    expect(screen.queryByText('尚未配置默认向量模型。')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始建立索引' })).toBeNull()
    expect(screen.queryByRole('link', { name: /配置或测试向量模型|检索此资料|检索调试/ })).toBeNull()
    expect(api.document.mock.lastCall).toEqual([documentId, expect.any(AbortSignal), projectFolderId])
    expect(api.chunks.mock.lastCall).toEqual([documentId, 2, expect.any(AbortSignal), projectFolderId])
    await user.click(screen.getByRole('button', { name: /上一页/ }))
    await screen.findByRole('heading', { name: '分片 001' })
    api.download.mockRejectedValueOnce(new Error('受控对象读取失败'))
    await user.click(screen.getByRole('button', { name: '下载原文件' }))
    await screen.findByText('受控对象读取失败')
    expect(api.download).toHaveBeenLastCalledWith(documentId, expect.any(AbortSignal), projectFolderId)
})
