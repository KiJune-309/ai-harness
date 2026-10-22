// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vectorStatusSchema, type KnowledgeSearchResult, type VectorStatus } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeSearchWorkspace } from '../../components/knowledge-search'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({ status: vi.fn(), list: vi.fn(), document: vi.fn(), source: vi.fn(), search: vi.fn(), fetch: vi.fn() }))

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('../../lib/knowledge-client', () => ({ getKnowledgeDocument: api.document, listKnowledgeDocuments: api.list }))
vi.mock('../../lib/vector-client', () => ({
    getVectorStatus: api.status,
    knowledgeChunkSource: api.source,
    searchKnowledgeVectors: api.search,
}))

const validVectorStatus: VectorStatus = vectorStatusSchema.parse({
    available: true,
    defaultModel: {
        id: 'bc867502-e10c-4acf-8d8a-f8f7a99efaae',
        name: '已验证的向量连接',
        baseUrl: 'https://embeddings.example.test/v1',
        model: 'embed',
        hasApiKey: true,
        isDefault: true,
        revision: 2,
        dimensions: 3,
        providerModel: 'actual-embed',
        verifiedAt: '2026-10-20T00:00:00.000Z',
        createdAt: '2026-10-19T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
    },
})

beforeEach(() => {
    vi.resetAllMocks()
    installAcceptanceBrowser()
    api.status.mockResolvedValue(validVectorStatus)
    api.list.mockResolvedValue({ documents: [], total: 0, page: 1, pageSize: 100 })
    api.document.mockResolvedValue(null)
    api.fetch.mockRejectedValue(new Error('组件验收禁止真实网络或模型调用。'))
    vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
    cleanup()
    expect(api.fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('explicit semantic search through the shared search input', () => {
    it('calls the provider only on submit, disables edits while busy, and retains a failed query that can be cleared safely', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<KnowledgeSearchResult>()
        api.search.mockReturnValue(pending.promise)
        render(<KnowledgeSearchWorkspace />)
        const input = (await screen.findByRole('searchbox', { name: '查询文本' })) as HTMLInputElement
        await user.type(input, '先编辑但不提交😀')
        expect(api.search).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '清空搜索内容' }))
        expect(input.value).toBe('')
        expect(api.search).not.toHaveBeenCalled()
        await user.type(input, '需要保留的问题😀')
        expect(api.search).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '查询分片' }))
        expect(api.search).toHaveBeenCalledExactlyOnceWith({ query: '需要保留的问题😀', topK: 5 }, expect.any(AbortSignal))
        expect(input.disabled).toBe(true)
        expect((screen.getByRole('button', { name: '清空搜索内容' }) as HTMLButtonElement).disabled).toBe(true)
        expect((screen.getByRole('button', { name: '正在检索…' }) as HTMLButtonElement).disabled).toBe(true)
        await user.click(screen.getByRole('button', { name: '清空搜索内容' }))
        await user.type(input, '不能追加')
        fireEvent.submit(input.closest('form')!)
        expect(input.value).toBe('需要保留的问题😀')
        expect(api.search).toHaveBeenCalledTimes(1)
        await act(async () => pending.reject(new Error('向量服务暂时不可用')))
        expect(await screen.findByText('向量服务暂时不可用')).toBeTruthy()
        expect(input.value).toBe('需要保留的问题😀')
        expect(input.disabled).toBe(false)
        await user.click(screen.getByRole('button', { name: '清空搜索内容' }))
        expect(input.value).toBe('')
        expect(document.activeElement).toBe(input)
        expect(api.search).toHaveBeenCalledTimes(1)
    })

    it('disables the query and refuses form submission when vector search is unavailable', async () => {
        const user = userEvent.setup()
        api.status.mockResolvedValue({ available: false, defaultModel: null, reason: '向量数据库尚未启用。' } satisfies VectorStatus)
        render(<KnowledgeSearchWorkspace />)
        const input = (await screen.findByRole('searchbox', { name: '查询文本' })) as HTMLInputElement
        expect(input.disabled).toBe(true)
        expect((screen.getByRole('button', { name: '查询分片' }) as HTMLButtonElement).disabled).toBe(true)
        await user.type(input, '不能查询')
        fireEvent.submit(input.closest('form')!)
        expect(input.value).toBe('')
        expect(api.search).not.toHaveBeenCalled()
    })
})
