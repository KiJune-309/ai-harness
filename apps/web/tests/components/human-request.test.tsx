// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatConversation, HumanRequest } from '@ai-harness/contracts'
import { HumanRequestPanel } from '../../components/human-request-panel'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({ decide: vi.fn(), read: vi.fn() }))
vi.mock('../../lib/chat-client', () => ({ decideHumanRequest: api.decide, getConversation: api.read }))

const question: HumanRequest = {
    id: '6e544e1c-a6a9-4651-9f5d-a47c60f6d38f',
    version: 2,
    callId: 'question-call',
    kind: 'question',
    status: 'pending',
    question: { text: '这份方案面向谁？', context: '目标读者决定细节。', options: ['产品经理', '工程团队'] },
    createdAt: '2026-10-22T02:00:00.000Z',
    updatedAt: '2026-10-22T02:00:00.000Z',
}
const approval: HumanRequest = {
    ...question,
    kind: 'approval',
    callId: 'write-call',
    approval: {
        toolId: 'isolated-write-fixture',
        toolVersion: '1',
        action: '更新隔离测试记录',
        target: '测试记录 abc',
        scope: '仅此测试记录',
        arguments: { id: 'abc', content: '完整正文，不能被摘要替代。' },
    },
}

/**
 * Creates a persisted owned conversation with the exact human request under test.
 * @param request - Question, operation preview, or terminal request to display.
 * @returns The ordinary conversation fixture returned by the simulated API.
 */
function conversation(request: HumanRequest): ChatConversation {
    return {
        id: 'acc4c80b-cc5f-4b62-9321-24fbad03d301',
        title: '原工作',
        messages: [],
        humanRequests: [request],
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
    }
}

beforeEach(() => {
    installAcceptanceBrowser()
    api.decide.mockReset()
    api.read.mockReset().mockResolvedValue(conversation(approval))
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe('ordinary chat human request cards', () => {
    it.each(['answered', 'cancelled', 'superseded', 'invalid'] as const)(
        'hides a %s question without rendering a terminal question card',
        status => {
            const view = render(
                <HumanRequestPanel conversation={conversation({ ...question, status })} onSuggestion={vi.fn()} onSaved={vi.fn()} />
            )
            expect(view.container.textContent).toBe('')
            expect(screen.queryByRole('region', { name: 'Agent 等待本人回答' })).toBeNull()
        }
    )

    it('displays only the first active question while leaving saved operation results available', () => {
        const saved = conversation(question)
        saved.humanRequests = [
            { ...question, id: '30d920b4-ac1d-4c72-8ff8-325b8c581c72', status: 'answered' },
            question,
            { ...question, id: 'a84eef67-a1eb-411e-9f21-14ef4c1a74b8', question: { text: '稍后再问的问题' } },
            { ...approval, id: 'c06504fc-600b-4ef5-be6e-349b6cdc81a9', status: 'unknown', result: '需要核验的操作结果。' },
        ]
        render(<HumanRequestPanel conversation={saved} onSuggestion={vi.fn()} onSaved={vi.fn()} />)
        expect(screen.getAllByText('这份方案面向谁？')).toHaveLength(1)
        expect(screen.queryByText('稍后再问的问题')).toBeNull()
        expect(screen.getByText('需要核验的操作结果。')).toBeTruthy()
    })

    it('shows the full question and suggestions without creating a second answer editor or submitting a decision', () => {
        const suggest = vi.fn()
        render(<HumanRequestPanel conversation={conversation(question)} onSuggestion={suggest} onSaved={vi.fn()} />)
        expect(screen.getByText('这份方案面向谁？')).toBeTruthy()
        expect(screen.getByText('目标读者决定细节。')).toBeTruthy()
        expect(screen.queryAllByRole('textbox')).toHaveLength(0)
        fireEvent.click(screen.getByRole('button', { name: '工程团队' }))
        expect(suggest).toHaveBeenCalledExactlyOnceWith(question, '工程团队')
        expect(api.decide).not.toHaveBeenCalled()
    })

    it('previews exact operation details and shows approved state without claiming execution success', async () => {
        const saved = {
            ...conversation({ ...approval, status: 'approved' as const }),
            activeRequestId: 'c246dc67-159e-43c3-b750-a05ed0c19d08',
        }
        api.decide.mockResolvedValue(saved)
        const applied = vi.fn()
        const view = render(<HumanRequestPanel conversation={conversation(approval)} onSuggestion={vi.fn()} onSaved={applied} />)
        expect(screen.getByText('测试记录 abc')).toBeTruthy()
        expect(screen.getByText('仅此测试记录')).toBeTruthy()
        expect(screen.getByText(/完整正文，不能被摘要替代/)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
        await waitFor(() => expect(applied).toHaveBeenCalledWith(saved))
        expect(api.decide).toHaveBeenCalledWith(saved.id, approval.id, {
            actionId: expect.any(String),
            version: approval.version,
            decision: 'approve',
        })
        view.rerender(<HumanRequestPanel conversation={saved} onSuggestion={vi.fn()} onSaved={applied} />)
        expect(screen.getByText('已批准，等待执行')).toBeTruthy()
        expect(screen.queryByText('操作已成功')).toBeNull()
        expect(screen.queryByRole('button', { name: '批准本次操作' })).toBeNull()
    })

    it('reconciles a lost decision response and retains the same action identity for an unresolved retry', async () => {
        const pending = acceptanceDeferred<ChatConversation>()
        api.decide.mockRejectedValueOnce(new Error('网络中断')).mockReturnValueOnce(pending.promise)
        const applied = vi.fn()
        render(<HumanRequestPanel conversation={conversation(approval)} onSuggestion={vi.fn()} onSaved={applied} />)
        fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
        await screen.findByText('网络中断')
        expect(api.read).toHaveBeenCalledWith(conversation(approval).id)
        const first = api.decide.mock.calls[0]![2]
        fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
        expect(api.decide.mock.calls[1]![2]).toEqual(first)
        expect(screen.getByRole('button', { name: '正在保存决定…' }).hasAttribute('disabled')).toBe(true)
        await act(async () => pending.resolve(conversation({ ...approval, status: 'approved' })))
    })

    it('uses durable readback after a lost success and does not emit a second conflicting decision', async () => {
        api.decide.mockRejectedValue(new Error('响应丢失'))
        const committed = conversation({ ...approval, status: 'succeeded', result: '测试记录已更新。' })
        api.read.mockResolvedValue(committed)
        const applied = vi.fn()
        render(<HumanRequestPanel conversation={conversation(approval)} onSuggestion={vi.fn()} onSaved={applied} />)
        fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
        await waitFor(() => expect(applied).toHaveBeenCalledWith(committed))
        expect(api.decide).toHaveBeenCalledTimes(1)
        expect(screen.queryByText('响应丢失')).toBeNull()
    })

    it.each(['reject', 'cancel'] as const)('submits %s only as a dedicated human action', async decision => {
        const saved = conversation({ ...approval, status: decision === 'reject' ? 'rejected' : 'cancelled' })
        api.decide.mockResolvedValue(saved)
        const applied = vi.fn()
        render(<HumanRequestPanel conversation={conversation(approval)} onSuggestion={vi.fn()} onSaved={applied} />)
        fireEvent.click(screen.getByRole('button', { name: decision === 'reject' ? '拒绝' : '取消等待' }))
        await waitFor(() => expect(applied).toHaveBeenCalledWith(saved))
        expect(api.decide.mock.calls[0]![2]).toMatchObject({ decision, version: approval.version })
    })

    it('keeps unknown outcomes visible and exposes no approval retry for a terminal request', () => {
        render(
            <HumanRequestPanel
                conversation={conversation({ ...approval, status: 'unknown', result: '副作用结果尚不能核验。' })}
                onSuggestion={vi.fn()}
                onSaved={vi.fn()}
            />
        )
        expect(screen.getByText('结果不明，已停止自动重试')).toBeTruthy()
        expect(screen.getByText('副作用结果尚不能核验。')).toBeTruthy()
        expect(screen.queryAllByRole('button')).toHaveLength(0)
        expect(api.decide).not.toHaveBeenCalled()
    })

    it('shows the actual completed tool text without leaking its transport envelope into the interface', () => {
        const saved = conversation({
            ...approval,
            status: 'succeeded',
            result: JSON.stringify({ isError: false, content: [{ type: 'text', text: '隔离记录已保存。' }] }),
        })
        render(<HumanRequestPanel conversation={saved} onSuggestion={vi.fn()} onSaved={vi.fn()} />)
        expect(screen.getByText('隔离记录已保存。')).toBeTruthy()
        expect(screen.queryByText(/"isError"/)).toBeNull()
        expect(screen.getByText('操作已成功')).toBeTruthy()
    })
})
