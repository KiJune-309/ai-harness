// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    ChatMessage,
    CollaborationDispatch,
    CollaborationNode,
    CollaborationProject,
    CollaborationSource,
    PersonMention,
} from '@ai-harness/contracts'
import { StrictMode, useCallback, useRef, useState } from 'react'
import {
    CollaborationNotifications,
    CollaborationProjectBoundary,
    CollaborationSourcePanel,
    collaborationNodeHref,
} from '../../components/collaboration-workspace'
import { MessageComposer, rebasePersonMentions, trimPersonMentions } from '../../components/message-composer'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const identity = vi.hoisted(() => ({ id: 'c5f1ec31-dacd-4eae-9661-7abdf84b6e95' }))
const api = vi.hoisted(() => ({
    projects: vi.fn(),
    project: vi.fn(),
    node: vi.fn(),
    source: vi.fn(),
    send: vi.fn(),
    people: vi.fn(),
    agents: vi.fn(),
    notifications: vi.fn(),
    messages: vi.fn(),
    cancelConversation: vi.fn(),
    cancelTask: vi.fn(),
    nodeEvents: vi.fn(),
    replace: vi.fn(),
}))
vi.mock('../../lib/collaboration-client', async importOriginal => ({
    ...(await importOriginal()),
    listCollaborationProjects: api.projects,
    getCollaborationProject: api.project,
    getCollaborationNode: api.node,
    getSourceCollaboration: api.source,
    sendCollaborationCommand: api.send,
    searchCollaborationPeople: api.people,
    getCollaborationNotificationPage: api.notifications,
    getCollaborationMessages: api.messages,
    getNodeCollaborationEvents: api.nodeEvents,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: api.replace }) }))
vi.mock('../../lib/agent-client', () => ({ listAgents: api.agents }))
vi.mock('../../lib/chat-client', async importOriginal => ({ ...(await importOriginal()), cancelConversation: api.cancelConversation }))
vi.mock('../../lib/task-client', async importOriginal => ({ ...(await importOriginal()), cancelTask: api.cancelTask }))
vi.mock('../../components/account-context', () => ({ useAccount: () => ({ user: { id: identity.id } }) }))

const projectId = '2198becb-5dc6-4672-82ec-e57e5d6588d5'
const nodeId = 'f7388f97-b94e-481a-a309-3b6b4e61dbe7'
const ownerId = 'c5f1ec31-dacd-4eae-9661-7abdf84b6e95'
const taskId = 'c4c42662-a9dc-489b-82a7-501f4bc8b7c0'
const questionId = 'da74c95e-ae36-4b36-8018-6fedeb019b1c'
const agentId = 'bcad1242-4997-4d72-a452-a221c38a26ba'
const time = '2026-10-19T06:00:00.000Z'

/**
 * Creates a safe pending assignment without a fabricated private task identifier.
 * @returns A recipient-owned node projection.
 */
function pendingNode(): CollaborationNode {
    return {
        id: nodeId,
        projectId,
        ownerId,
        ownerName: '张三',
        title: '工程评估',
        goal: '评估已共享方案',
        context: '客户需要权限隔离',
        source: null,
        upstreamNodeId: null,
        agentLabel: null,
        status: 'awaiting-activation',
        revision: 1,
        adoptions: [],
        canActivate: true,
        canManage: true,
        canWork: false,
        createdAt: time,
        updatedAt: time,
    }
}

/**
 * Creates a project projection using only authorized node and member summaries.
 * @param node - Node state shown by the project.
 * @returns A project without any private model, prompt, or message history.
 */
function project(node: CollaborationNode): CollaborationProject {
    return {
        id: projectId,
        name: '客户反馈',
        description: '同一事项',
        ownerId,
        revision: 1,
        members: [{ id: ownerId, name: '张三', role: 'member', status: 'pending' }],
        nodes: [node],
        artifacts: [],
        notes: [],
        createdAt: time,
        updatedAt: time,
    }
}

/**
 * Creates the exact saved dispatch projection reviewed by the source owner.
 * @param kind - Original work context that owns the draft.
 * @returns A pending dispatch containing full message and collaboration details.
 */
function dispatch(kind: 'conversation' | 'task' = 'conversation'): CollaborationDispatch {
    return {
        id: questionId,
        version: 2,
        source: { kind, id: taskId },
        kind: 'delegate',
        recipientId: ownerId,
        recipientName: '张三',
        title: '修复侧栏白屏',
        content: '项目：ai-harness 的 index 文件\n现象：点击侧栏按钮后页面白屏。\n期望：打开对应页面。',
        goal: '定位原因并修复，提供验证结果。',
        context: '这是用户已确认的现象，尚未提供错误日志。',
        status: 'pending',
        createdAt: time,
        updatedAt: time,
    }
}

/**
 * Mounts receipt destinations in the same commit as newly saved conversation messages.
 * @param props - Visible messages and their exact owned collaboration source.
 * @returns Message-local receipt targets and one shared collaboration poller.
 */
function TimelineHarness({
    messages,
    source = { kind: 'conversation', id: taskId },
}: {
    messages: readonly ChatMessage[]
    source?: CollaborationSource
}) {
    const anchors = useRef(new Map<string, HTMLDivElement>())
    const getAnchor = useCallback((id: string) => anchors.current.get(id) ?? null, [])
    return (
        <>
            {messages.map(message => (
                <section key={message.id}>
                    <p>{message.content}</p>
                    <div
                        data-testid={`receipt-${message.id}`}
                        ref={element => {
                            if (element) anchors.current.set(message.id, element)
                            else anchors.current.delete(message.id)
                        }}
                    />
                </section>
            ))}
            <div data-testid="dispatch-bottom">
                <CollaborationSourcePanel source={source} messages={messages} getMessageAnchor={getAnchor} />
            </div>
        </>
    )
}

/**
 * Creates one visible saved message for dispatch-position browser-component checks.
 * @param id - Stable message identity, including delivered business IDs.
 * @param second - Explicit offset from the fixture minute.
 * @returns A complete message without using body text for receipt matching.
 */
function timelineMessage(id: string, second: number): ChatMessage {
    return {
        id,
        role: 'assistant',
        kind: 'relay',
        content: `消息 ${id}`,
        status: 'complete',
        createdAt: `2026-10-19T06:00:${String(second).padStart(2, '0')}.000Z`,
    }
}

/**
 * Returns a source projection containing only the explicitly supplied saved dispatches.
 * @param drafts - Pending previews or durable terminal receipts.
 * @returns A public source page accepted by the component's authorized reader.
 */
function dispatchPage(drafts: CollaborationDispatch[]) {
    return { events: [], nodes: [], questions: [], artifacts: [], notes: [], pendingDispatches: drafts, nextCursor: 0, hasMore: false }
}

/**
 * Exercises a real controlled composer with stable person bindings.
 * @returns The editor and an observable representation of selected account bindings.
 */
function MentionEditor() {
    const [value, setValue] = useState('')
    const [mentions, setMentions] = useState<PersonMention[]>([])
    const inputRef = useRef<HTMLTextAreaElement>(null)
    return (
        <>
            <MessageComposer
                id="mention-editor"
                value={value}
                onChange={setValue}
                onSend={() => undefined}
                inputRef={inputRef}
                placeholder="消息"
                mentions={mentions}
                onMentionsChange={setMentions}
            />
            <output data-testid="bindings">{JSON.stringify(mentions)}</output>
        </>
    )
}

beforeEach(() => {
    installAcceptanceBrowser(390)
    for (const mock of Object.values(api)) mock.mockReset()
    identity.id = ownerId
    api.projects.mockResolvedValue([])
    api.people.mockResolvedValue([{ id: ownerId, name: '张三' }])
    api.agents.mockResolvedValue([{ id: agentId, name: '我的工程助手' }])
    api.notifications.mockResolvedValue({ notifications: [], unread: 0 })
    api.messages.mockResolvedValue([])
    api.nodeEvents.mockResolvedValue({ events: [], nextCursor: 0, hasMore: false })
})
afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('project-owned collaboration work surfaces', () => {
    it('restores multiple sent receipts beside their exact messages and keeps them there when chatting continues', async () => {
        const first: CollaborationDispatch = {
            ...dispatch(),
            status: 'sent',
            result: { requestId: questionId, messageId: 'sent-first', dispatchStatus: 'sent' },
        }
        const second: CollaborationDispatch = {
            ...first,
            id: taskId,
            recipientName: '李四',
            result: { requestId: taskId, messageId: 'sent-second', dispatchStatus: 'sent' },
        }
        api.source.mockResolvedValue(dispatchPage([first, second]))
        const original = [timelineMessage('sent-first', 1), timelineMessage('sent-second', 2)]
        const view = render(<TimelineHarness messages={original} />)
        const firstReceipt = await screen.findByText('已发送给 张三')
        expect(screen.getByTestId('receipt-sent-first').contains(firstReceipt)).toBe(true)
        expect(screen.getByTestId('receipt-sent-second').contains(screen.getByText('已发送给 李四'))).toBe(true)
        expect(screen.getByTestId('dispatch-bottom').textContent).toBe('')
        view.rerender(<TimelineHarness messages={[...original, timelineMessage('later-answer', 10)]} />)
        await waitFor(() => expect(screen.getByTestId('receipt-sent-first').contains(screen.getByText('已发送给 张三'))).toBe(true))
        expect(screen.getByTestId('receipt-later-answer').textContent).toBe('')
        expect(api.source).toHaveBeenCalledTimes(1)
        expect(api.send).not.toHaveBeenCalled()
        view.unmount()
        render(<TimelineHarness messages={[...original, timelineMessage('later-answer', 10)]} />)
        expect(screen.getByTestId('receipt-sent-first').contains(await screen.findByText('已发送给 张三'))).toBe(true)
    })

    it('moves only an acknowledged send out of the bottom and attaches it when the exact message mounts despite a stale draft snapshot', async () => {
        const draft = dispatch()
        api.source.mockResolvedValue(dispatchPage([draft]))
        api.send.mockResolvedValue({ requestId: questionId, messageId: 'newly-sent', dispatchStatus: 'sent' })
        const original = [timelineMessage('preview', 0)]
        const view = render(<TimelineHarness messages={original} />)
        fireEvent.click(await screen.findByRole('button', { name: '确认发送' }))
        await waitFor(() => expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull())
        expect(screen.queryByText('已发送给 张三')).toBeNull()
        view.rerender(<TimelineHarness messages={[...original, timelineMessage('newly-sent', 3), timelineMessage('later-answer', 4)]} />)
        const receipt = await screen.findByText('已发送给 张三')
        expect(screen.getByTestId('receipt-newly-sent').contains(receipt)).toBe(true)
        expect(screen.getByTestId('dispatch-bottom').textContent).toBe('')
        expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull()
        expect(api.send).toHaveBeenCalledTimes(1)
    })

    it('uses distinct stable routes for pending nodes, owned tasks, original conversations and other peoples projections', () => {
        const pending = pendingNode()
        expect(collaborationNodeHref(pending)).toBe(`/projects/${projectId}?node=${nodeId}`)
        const owned = { ...pending, canWork: true, source: { kind: 'task' as const, id: taskId } }
        expect(collaborationNodeHref(owned, questionId)).toBe(`/?conversation=${taskId}&event=${questionId}`)
        expect(collaborationNodeHref({ ...owned, source: { kind: 'conversation', id: taskId } }, questionId)).toBe(
            `/?conversation=${taskId}&event=${questionId}`
        )
        expect(collaborationNodeHref({ ...owned, canWork: false })).toBe(`/projects/${projectId}?node=${nodeId}`)
    })

    it('opens an already delivered owned Agent conversation directly without a task or model setup step', async () => {
        const node = {
            ...pendingNode(),
            source: { kind: 'task' as const, id: taskId },
            canActivate: false,
            canWork: true,
            status: 'ready' as const,
        }
        api.project.mockResolvedValue(project(node))
        api.node.mockResolvedValue({ node, events: [], questions: [], artifacts: [] })
        render(
            <CollaborationProjectBoundary projectId={projectId} nodeId={nodeId} eventId={questionId}>
                旧个人项目
            </CollaborationProjectBoundary>
        )
        await waitFor(() => expect(api.replace).toHaveBeenCalledWith(`/?conversation=${taskId}&event=${questionId}`))
        expect(api.send).not.toHaveBeenCalled()
        expect(api.agents).not.toHaveBeenCalled()
        expect(screen.queryByLabelText('选择我自己的 Agent')).toBeNull()
        expect(screen.queryByRole('button', { name: '接手并启用我的任务' })).toBeNull()
    })

    it('prepares only the legacy opening once and retains the same action identity after an uncertain failure', async () => {
        const node = pendingNode()
        api.project.mockResolvedValue(project(node))
        api.node.mockResolvedValue({ node, events: [], questions: [], artifacts: [] })
        api.send.mockRejectedValueOnce(new Error('暂时未确认保存')).mockResolvedValueOnce({ requestId: questionId, taskId })
        render(
            <StrictMode>
                <CollaborationProjectBoundary projectId={projectId} nodeId={nodeId}>
                    旧个人项目
                </CollaborationProjectBoundary>
            </StrictMode>
        )
        await screen.findByText('暂时未确认保存')
        expect(api.send).toHaveBeenCalledTimes(1)
        const first = api.send.mock.calls[0][0]
        expect(first).toEqual({ type: 'activate', nodeId, revision: 1, requestId: expect.any(String) })
        expect(screen.queryByRole('button', { name: '接手并启用我的任务' })).toBeNull()
        expect(api.agents).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: '重试打开对话' }))
        await waitFor(() => expect(api.replace).toHaveBeenCalledWith(`/?conversation=${taskId}`))
        expect(api.send).toHaveBeenCalledTimes(2)
        expect(api.send.mock.calls[1][0]).toEqual(first)
    })

    it('keeps other peoples node details in the authorized project without opening their private task', async () => {
        const node = { ...pendingNode(), canActivate: false, canManage: false, source: { kind: 'task' as const, id: taskId } }
        api.project.mockResolvedValue(project(node))
        api.node.mockResolvedValue({ node, events: [], questions: [], artifacts: [] })
        render(
            <CollaborationProjectBoundary projectId={projectId} nodeId={nodeId}>
                旧个人项目
            </CollaborationProjectBoundary>
        )
        await screen.findByRole('region', { name: '协作节点：工程评估' })
        expect(api.replace).not.toHaveBeenCalled()
        expect(api.send).not.toHaveBeenCalled()
        expect(screen.queryByRole('link', { name: '打开 Agent 对话' })).toBeNull()
    })

    it.each(['conversation', 'task'] as const)(
        'keeps pending questions in ordinary %s history without a dedicated reply form or automatic sending',
        async kind => {
            const node = {
                ...pendingNode(),
                source: { kind, id: taskId },
                canActivate: false,
                canWork: true,
                status: 'waiting-upstream' as const,
            }
            let status = 'pending'
            api.source.mockImplementation(async () => ({
                events: [],
                nodes: [node],
                questions: [
                    {
                        id: questionId,
                        projectId,
                        nodeId,
                        targetNodeId: nodeId,
                        version: 3,
                        question: '目标 QPS 是多少？',
                        context: '请确认客户事实',
                        status,
                        answer: status === 'answered' ? '目标为 300 QPS。' : null,
                        decision: null,
                        createdAt: time,
                        updatedAt: time,
                    },
                ],
                artifacts: [],
                notes: [],
                pendingDispatches: [],
                nextCursor: 0,
                hasMore: false,
            }))
            const refreshHistory = vi.fn()
            const { container } = render(<CollaborationSourcePanel source={{ kind, id: taskId }} onHistoryChange={refreshHistory} />)
            await waitFor(() => expect(refreshHistory).toHaveBeenCalledTimes(1))
            expect(container.childElementCount).toBe(0)
            expect(screen.queryByRole('textbox')).toBeNull()
            expect(screen.queryByRole('button', { name: /回复这条消息|发送回复|取消回复/ })).toBeNull()
            expect(screen.queryByText('目标 QPS 是多少？')).toBeNull()
            expect(screen.queryByRole('combobox', { name: '答复性质' })).toBeNull()
            expect(api.send).not.toHaveBeenCalled()
            status = 'answered'
            await waitFor(() => expect(refreshHistory).toHaveBeenCalledTimes(2), { timeout: 6000 })
            expect(container.childElementCount).toBe(0)
            expect(api.source.mock.calls.every(([source]) => source.kind === kind && source.id === taskId)).toBe(true)
            expect(api.send).not.toHaveBeenCalled()
        }
    )

    it('refreshes original history when a background message settles without any project or node events', async () => {
        const refreshHistory = vi.fn()
        let state = { revision: 1, activeRequestId: questionId as string | undefined, updatedAt: time }
        api.source.mockImplementation(async () => ({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            notes: [],
            sourceState: state,
            nextCursor: 0,
            hasMore: false,
        }))
        render(<CollaborationSourcePanel source={{ kind: 'conversation', id: taskId }} onHistoryChange={refreshHistory} />)
        await waitFor(() => expect(refreshHistory).toHaveBeenCalledTimes(1))
        refreshHistory.mockClear()
        state = { revision: 2, activeRequestId: undefined, updatedAt: '2026-10-19T06:01:00.000Z' }
        await waitFor(() => expect(refreshHistory).toHaveBeenCalledTimes(1), { timeout: 6000 })
        expect(screen.queryByText('最新进度已同步。')).toBeNull()
        expect(api.source.mock.calls.every(([source]) => source.kind === 'conversation' && source.id === taskId)).toBe(true)
    })

    it.each([true, false])('clears revoked source events while refreshing history with showDetails=%s', async showDetails => {
        let revoked = false
        const refreshHistory = vi.fn()
        const node = pendingNode()
        const event = {
            id: questionId,
            sequence: 1,
            projectId,
            nodeId,
            targetNodeId: null,
            source: { kind: 'task', id: taskId },
            authorId: ownerId,
            authorName: '张三',
            authorKind: 'human',
            kind: 'delegation',
            content: '撤权后必须清理的原协作正文',
            questionId: null,
            version: 1,
            createdAt: time,
        }
        api.source.mockImplementation(async () => ({
            events: revoked ? [] : [event],
            nodes: revoked ? [] : [node],
            questions: [],
            artifacts: [],
            notes: [],
            sourceState: { revision: 1, updatedAt: time },
            nextCursor: 1,
            hasMore: false,
        }))
        const { container } = render(
            <CollaborationSourcePanel
                source={{ kind: 'conversation', id: taskId }}
                showDetails={showDetails}
                onHistoryChange={refreshHistory}
            />
        )
        await waitFor(() => expect(refreshHistory).toHaveBeenCalledTimes(1))
        expect(screen.queryByText('撤权后必须清理的原协作正文')).toBeNull()
        expect(container.childElementCount).toBe(0)
        revoked = true
        await waitFor(() => expect(refreshHistory).toHaveBeenCalledTimes(2), { timeout: 6000 })
        await waitFor(() => expect(screen.queryByText('撤权后必须清理的原协作正文')).toBeNull(), { timeout: 6000 })
        expect(screen.queryByRole('link', { name: '工程评估 · 张三' })).toBeNull()
        if (!showDetails) expect(container.childElementCount).toBe(0)
    })

    it.each(['conversation', 'task'] as const)('hides a pending-only contact in its original %s while refreshing history', async kind => {
        const pendingContact = {
            requestId: questionId,
            people: [{ id: ownerId, name: '张三' }],
        }
        api.source.mockImplementation(async () => ({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            notes: [],
            pendingContact,
            sourceState: { revision: 1, updatedAt: time },
            nextCursor: 0,
            hasMore: false,
        }))
        const refreshHistory = vi.fn()
        const { container } = render(<CollaborationSourcePanel source={{ kind, id: taskId }} onHistoryChange={refreshHistory} />)
        await waitFor(() => expect(refreshHistory).toHaveBeenCalledTimes(1))
        expect(container.childElementCount).toBe(0)
        expect(screen.queryByRole('heading', { name: '上下游协作' })).toBeNull()
        expect(screen.queryByText('待联络：张三')).toBeNull()
        expect(screen.queryByRole('button', { name: '取消此次联络' })).toBeNull()
        expect(api.source).toHaveBeenCalledWith({ kind, id: taskId }, 0, expect.any(AbortSignal), undefined)
        expect(api.cancelConversation).not.toHaveBeenCalled()
        expect(api.cancelTask).not.toHaveBeenCalled()
        expect(api.send).not.toHaveBeenCalled()
    })

    it.each(['conversation', 'task'] as const)(
        'keeps the full send preview visible in %s when collaboration details are hidden',
        async kind => {
            const draft = dispatch(kind)
            api.source.mockResolvedValue({
                events: [],
                nodes: [],
                questions: [],
                artifacts: [],
                notes: [],
                pendingDispatches: [draft],
                nextCursor: 0,
                hasMore: false,
            })
            render(<CollaborationSourcePanel source={draft.source} showDetails={false} />)
            await screen.findByRole('region', { name: '发送前确认：张三' })
            expect(screen.getByText('收件人：张三')).toBeTruthy()
            expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === draft.content).textContent).toBe(
                draft.content
            )
            expect(screen.getByText(draft.title!, { exact: false })).toBeTruthy()
            expect(screen.getByText(draft.goal!, { exact: false })).toBeTruthy()
            expect(screen.getByText(draft.context!, { exact: false })).toBeTruthy()
            expect(screen.getByRole('button', { name: '确认发送' })).toBeTruthy()
            expect(screen.getByRole('button', { name: '暂不发送' })).toBeTruthy()
            expect(screen.queryByText('已发送给 张三')).toBeNull()
            expect(screen.queryByRole('heading', { name: '上下游协作' })).toBeNull()
            expect(api.send).not.toHaveBeenCalled()
        }
    )

    it.each([
        { decision: 'information' as const, label: undefined },
        { decision: 'approved' as const, label: '本人确认可接受' },
        { decision: 'rejected' as const, label: '本人判断不通过' },
    ])('previews only an actual saved answer draft with $decision before a dedicated sending confirmation', async ({ decision, label }) => {
        const draft: CollaborationDispatch = {
            ...dispatch(),
            kind: 'answer',
            title: undefined,
            goal: undefined,
            context: undefined,
            questionId,
            questionVersion: 3,
            question: '目标 QPS 是多少？',
            content: '已确认目标为 300 QPS。',
            decision,
        }
        api.source.mockResolvedValue({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            notes: [],
            pendingDispatches: [draft],
            nextCursor: 0,
            hasMore: false,
        })
        api.send.mockResolvedValue({ requestId: questionId, dispatchStatus: 'sent' })
        render(<CollaborationSourcePanel source={draft.source} />)
        await screen.findByRole('region', { name: '发送前确认：张三' })
        expect(screen.getByText(draft.content)).toBeTruthy()
        expect(screen.queryByRole('textbox')).toBeNull()
        expect(screen.queryByRole('button', { name: /回复这条消息|发送回复|取消回复/ })).toBeNull()
        if (label) expect(screen.getByText(label)).toBeTruthy()
        else expect(screen.queryByText('补充信息')).toBeNull()
        expect(api.send).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
        await screen.findByText('已发送给 张三')
        expect(api.send).toHaveBeenCalledExactlyOnceWith({
            type: 'confirm-dispatch',
            requestId: expect.any(String),
            draftId: draft.id,
            version: draft.version,
        })
    })

    it('retains a failed preview and action identity, blocks double clicks, and shows only an acknowledged receipt', async () => {
        const draft = dispatch()
        const pending = acceptanceDeferred<{ requestId: string; dispatchStatus: 'sent' }>()
        api.source.mockResolvedValue({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            notes: [],
            pendingDispatches: [draft],
            nextCursor: 0,
            hasMore: false,
        })
        api.send.mockRejectedValueOnce(new Error('发送尚未确认，请重试。')).mockReturnValueOnce(pending.promise)
        render(<CollaborationSourcePanel source={draft.source} showDetails={false} />)
        fireEvent.click(await screen.findByRole('button', { name: '确认发送' }))
        await screen.findByRole('alert')
        expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === draft.content).textContent).toBe(
            draft.content
        )
        expect(screen.queryByText('已发送给 张三')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
        const confirming = screen.getByRole('button', { name: '正在处理…' }) as HTMLButtonElement
        expect(confirming.disabled).toBe(true)
        expect((screen.getByRole('button', { name: '暂不发送' }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(confirming)
        expect(api.send).toHaveBeenCalledTimes(2)
        expect(api.send.mock.calls[0][0]).toEqual({
            type: 'confirm-dispatch',
            requestId: expect.any(String),
            draftId: draft.id,
            version: draft.version,
        })
        expect(api.send.mock.calls[1][0]).toEqual(api.send.mock.calls[0][0])
        pending.resolve({ requestId: questionId, dispatchStatus: 'sent' })
        await screen.findByText('已发送给 张三')
        expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull()
        expect(screen.queryByRole('alert')).toBeNull()
    })

    it.each([
        { content: '请定位侧栏白屏并修复。', goal: '请定位侧栏白屏并修复。', context: '请定位侧栏白屏并修复。', count: 1 },
        { content: '请补充复现步骤。', goal: '确认具体复现步骤。', context: '确认具体复现步骤。', count: 1 },
        { content: '请定位侧栏白屏并修复。', goal: '请定位侧栏白屏并修复。', context: '独立共享背景：测试环境 Firefox。', count: 1 },
    ])('deduplicates repeated preview details while retaining independent context: $context', async fields => {
        const draft = { ...dispatch(), ...fields }
        api.source.mockResolvedValue({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            notes: [],
            pendingDispatches: [draft],
            nextCursor: 0,
            hasMore: false,
        })
        render(<CollaborationSourcePanel source={draft.source} showDetails={false} />)
        const preview = await screen.findByRole('region', { name: '发送前确认：张三' })
        expect(preview.textContent?.split(draft.content).length).toBe(2)
        if (draft.goal !== draft.content) expect(preview.textContent?.split(draft.goal).length).toBe(2)
        if (draft.context !== draft.content && draft.context !== draft.goal) {
            expect(screen.getByText(draft.context, { exact: false })).toBeTruthy()
            expect(preview.textContent?.split(draft.context).length).toBe(2)
        }
        expect(api.send).not.toHaveBeenCalled()
    })

    it('cancels only the saved version after an explicit choice and keeps superseded drafts unsendable', async () => {
        const draft = dispatch()
        api.source.mockResolvedValue({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            notes: [],
            pendingDispatches: [draft],
            nextCursor: 0,
            hasMore: false,
        })
        api.send.mockResolvedValue({ requestId: questionId, dispatchStatus: 'cancelled' })
        const view = render(<CollaborationSourcePanel source={draft.source} showDetails={false} />)
        fireEvent.click(await screen.findByRole('button', { name: '暂不发送' }))
        await screen.findByText('此次内容未发送。')
        expect(api.send.mock.calls[0][0]).toEqual({
            type: 'cancel-dispatch',
            requestId: expect.any(String),
            draftId: draft.id,
            version: draft.version,
        })
        api.source.mockResolvedValue({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            notes: [],
            pendingDispatches: [{ ...draft, version: 3, status: 'superseded' }],
            nextCursor: 0,
            hasMore: false,
        })
        view.rerender(<CollaborationSourcePanel source={{ kind: 'task', id: taskId }} showDetails={false} />)
        await screen.findByText('内容已更新，请核对最新内容。')
        expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull()
        expect(api.send).toHaveBeenCalledTimes(1)
    })

    it('prevents confirmation while the source Agent is still revising its saved preview', async () => {
        const draft = dispatch()
        api.source.mockResolvedValue({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            notes: [],
            pendingDispatches: [draft],
            sourceState: { revision: 1, activeRequestId: agentId, updatedAt: time },
            nextCursor: 0,
            hasMore: false,
        })
        render(<CollaborationSourcePanel source={draft.source} showDetails={false} />)
        const confirm = await screen.findByRole('button', { name: '确认发送' })
        expect((confirm as HTMLButtonElement).disabled).toBe(true)
        expect(screen.getByText('Agent 正在整理内容，完成后即可确认。')).toBeTruthy()
        fireEvent.click(confirm)
        expect(api.send).not.toHaveBeenCalled()
    })

    it('changes a failed owned model route only after an explicit default or personal configuration retry', async () => {
        const node = {
            ...pendingNode(),
            canActivate: false,
            canWork: true,
            status: 'failed' as const,
            source: { kind: 'task' as const, id: taskId },
        }
        api.project.mockResolvedValue(project(node))
        api.node.mockResolvedValue({ node, events: [], questions: [], artifacts: [] })
        api.send.mockResolvedValue({ requestId: questionId })
        render(
            <CollaborationProjectBoundary projectId={projectId} nodeId={nodeId}>
                旧个人项目
            </CollaborationProjectBoundary>
        )
        const picker = await screen.findByLabelText('用我自己的可用配置恢复工作')
        await screen.findByRole('option', { name: '我的工程助手' })
        expect(screen.getByRole('option', { name: '默认模型（无需配置）' })).toBeTruthy()
        expect(api.send).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: '重试原配置' }))
        await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
        expect(api.send.mock.calls[0][0]).toMatchObject({ type: 'retry', nodeId, revision: 1 })
        expect(api.send.mock.calls[0][0]).not.toHaveProperty('useDefaultModel')
        fireEvent.click(screen.getByRole('button', { name: '使用本人所选配置重试' }))
        await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2))
        expect(api.send.mock.calls[1][0]).toMatchObject({ type: 'retry', nodeId, useDefaultModel: true })
        fireEvent.change(picker, { target: { value: agentId } })
        fireEvent.click(screen.getByRole('button', { name: '使用本人所选配置重试' }))
        await waitFor(() => expect(api.send).toHaveBeenCalledTimes(3))
        expect(api.send.mock.calls[2][0]).toMatchObject({ type: 'retry', nodeId, agentId })
        expect(api.send.mock.calls[2][0]).not.toHaveProperty('useDefaultModel')
    })

    it('locates a late node event while retaining every chronological page and its original content', async () => {
        const node = { ...pendingNode(), canActivate: false, canManage: false }
        const history = Array.from({ length: 120 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            sequence: index + 1,
            projectId,
            nodeId,
            targetNodeId: null,
            source: null,
            authorId: ownerId,
            authorName: '张三',
            authorKind: 'human' as const,
            kind: 'message' as const,
            content: `原始协作正文 ${index + 1}`,
            questionId: null,
            version: 1,
            createdAt: time,
        }))
        api.project.mockResolvedValue(project(node))
        api.node.mockResolvedValue({ node, events: history.slice(0, 50), questions: [], artifacts: [] })
        api.nodeEvents.mockImplementation(async (_id, cursor = 0, _signal, anchor) => {
            const remaining = history.filter(event => event.sequence > (anchor ? 114 : cursor))
            const events = remaining.slice(0, 50)
            return { events, nextCursor: events.at(-1)?.sequence ?? cursor, hasMore: remaining.length > events.length }
        })
        render(
            <CollaborationProjectBoundary projectId={projectId} nodeId={nodeId} eventId={history[114]!.id}>
                旧个人项目
            </CollaborationProjectBoundary>
        )
        // Project, node and anchored event reads must finish before asserting the rendered history.
        await screen.findByText('原始协作正文 115', {}, { timeout: 5000 })
        expect(screen.getByText('原始协作正文 1')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: '加载更多事件' }))
        await screen.findByText('原始协作正文 51', {}, { timeout: 5000 })
        fireEvent.click(screen.getByRole('button', { name: '加载更多事件' }))
        await screen.findByText('原始协作正文 101', {}, { timeout: 5000 })
        await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多事件' })).toBeNull())
        expect(document.querySelectorAll('[id^="collaboration-event-"]')).toHaveLength(120)
        expect(api.nodeEvents).toHaveBeenCalledWith(nodeId, 50, expect.any(AbortSignal))
        expect(api.nodeEvents).toHaveBeenCalledWith(nodeId, 100, expect.any(AbortSignal))
        expect(api.nodeEvents).toHaveBeenCalledWith(nodeId, 0, expect.any(AbortSignal), history[114]!.id)
    }, 15_000)

    it('keeps older notification and thread pages after recent polling and marks only retrieved incoming messages read', async () => {
        /**
         * Creates an authorized lightweight notification fixture with a stable chronological sequence.
         * @param sequence - Saved notification sequence.
         * @returns A minimal notification pointing to the one two-party thread.
         */
        function notification(sequence: number) {
            return {
                id: `notification-${sequence}`,
                sequence,
                title: `通知 ${sequence}`,
                content: `通知正文 ${sequence}`,
                projectId: null,
                nodeId: null,
                eventId: null,
                questionId: null,
                threadId: taskId,
                source: null,
                read: false,
                createdAt: time,
            }
        }
        /**
         * Creates one received message without private task access.
         * @param sequence - Saved message sequence.
         * @returns A real-participant thread message fixture.
         */
        function message(sequence: number) {
            return {
                id: `message-${sequence}`,
                sequence,
                threadId: taskId,
                senderId: agentId,
                recipientId: ownerId,
                senderName: '李四',
                recipientName: '张三',
                content: `转告正文 ${sequence}`,
                authorKind: 'human',
                createdAt: time,
            }
        }
        const latest = Array.from({ length: 100 }, (_, index) => notification(index + 101))
        const latestMessages = Array.from({ length: 100 }, (_, index) => message(index + 101))
        api.notifications.mockImplementation(async (_cursor, _signal, before) => ({
            notifications: before ? [notification(99), notification(100)] : latest,
            unread: 102,
        }))
        api.messages.mockImplementation(async (_threadId, _signal, before) => (before ? [message(99), message(100)] : latestMessages))
        api.send.mockImplementation(async command => ({ requestId: command.requestId }))
        render(<CollaborationNotifications />)
        const opener = await screen.findByRole('button', { name: '消息102' })
        fireEvent.click(opener)
        fireEvent.click(await screen.findByRole('button', { name: '加载更早通知' }))
        await screen.findByText('通知正文 99')
        expect(screen.getByText('通知正文 200')).toBeTruthy()
        expect(api.notifications).toHaveBeenCalledWith(0, expect.any(AbortSignal), 101)
        fireEvent.click(screen.getAllByRole('button', { name: '查看转告' })[0]!)
        await screen.findByText('转告正文 200')
        fireEvent.click(await screen.findByRole('button', { name: '加载更早转告' }))
        await screen.findByText('转告正文 99')
        expect(screen.getByText('转告正文 200')).toBeTruthy()
        await waitFor(() =>
            expect(api.send.mock.calls.some(([command]) => command.type === 'read' && command.messageIds?.includes('message-99'))).toBe(
                true
            )
        )
        const readIds = api.send.mock.calls.flatMap(([command]) => (command.type === 'read' ? command.messageIds : []))
        expect(readIds).toContain('message-99')
        expect(readIds).not.toContain('message-98')
        expect(api.messages).toHaveBeenCalledWith(taskId, expect.any(AbortSignal), 101)
    })

    it('uses messages only as an auxiliary direct link to the recipients Agent conversation', async () => {
        api.notifications.mockResolvedValue({
            notifications: [
                {
                    id: questionId,
                    sequence: 1,
                    title: '来自张三的工作',
                    content: '请评估已共享方案。',
                    projectId,
                    nodeId,
                    eventId: agentId,
                    questionId: null,
                    threadId: nodeId,
                    source: { kind: 'task', id: taskId },
                    read: false,
                    createdAt: time,
                },
            ],
            unread: 1,
            authorizedProjectIds: [projectId],
        })
        api.send.mockImplementation(async command => ({ requestId: command.requestId }))
        render(<CollaborationNotifications />)
        fireEvent.click(await screen.findByRole('button', { name: '消息1' }))
        const link = await screen.findByRole('link', { name: '打开 Agent 对话' })
        expect(link.getAttribute('href')).toBe(`/?conversation=${taskId}&event=${agentId}`)
        expect(api.send).not.toHaveBeenCalled()
        expect(api.messages).not.toHaveBeenCalled()
        expect(screen.getByText('请评估已共享方案。')).toBeTruthy()
        fireEvent.click(link)
        await waitFor(() =>
            expect(api.send).toHaveBeenCalledWith({
                type: 'read',
                requestId: expect.any(String),
                notificationIds: [questionId],
                messageIds: [],
            })
        )
    })

    it('removes revoked project notification summaries while preserving delivered two-party messages', async () => {
        let authorizedProjectIds = [projectId]
        const shared = {
            id: questionId,
            sequence: 1,
            title: '项目受控摘要',
            content: '撤销后应移除的协作内容',
            projectId,
            nodeId,
            eventId: null,
            questionId: null,
            threadId: null,
            source: null,
            read: false,
            createdAt: time,
        }
        const ordinary = {
            ...shared,
            id: agentId,
            sequence: 2,
            title: '普通转告',
            content: '普通已投递消息仍保留',
            projectId: null,
            nodeId: null,
            threadId: taskId,
        }
        api.notifications.mockImplementation(async () => ({
            notifications: authorizedProjectIds.length ? [shared, ordinary] : [ordinary],
            unread: 1,
            authorizedProjectIds,
        }))
        render(<CollaborationNotifications />)
        fireEvent.click(await screen.findByRole('button', { name: '消息1' }))
        await screen.findByText('撤销后应移除的协作内容')
        authorizedProjectIds = []
        await waitFor(() => expect(screen.queryByText('撤销后应移除的协作内容')).toBeNull(), { timeout: 6000 })
        expect(screen.getByText('普通已投递消息仍保留')).toBeTruthy()
    })

    it('binds a real colleague only after candidate selection and drops identity when text is changed', async () => {
        render(<MentionEditor />)
        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        fireEvent.change(input, { target: { value: '@张', selectionStart: 2, selectionEnd: 2 } })
        fireEvent.click(await screen.findByRole('button', { name: `同事 · 张三 · ${ownerId.slice(0, 8)}` }))
        expect(input.value).toBe('@张三')
        expect(JSON.parse(screen.getByTestId('bindings').textContent!)).toEqual([{ userId: ownerId, name: '张三', start: 0, end: 3 }])
        fireEvent.change(input, { target: { value: '@李四', selectionStart: 3 } })
        expect(screen.getByTestId('bindings').textContent).toBe('[]')
    })

    it('rebases UTF-16 offsets and normalizes whitespace without rebinding changed names', () => {
        const binding = { userId: ownerId, name: '张三', start: 2, end: 5 }
        expect(trimPersonMentions('  @张三 请评估 ', [binding])).toEqual([{ ...binding, start: 0, end: 3 }])
        expect(rebasePersonMentions('  @张三', '新增  @张三', [binding])).toEqual([{ ...binding, start: 4, end: 7 }])
        expect(rebasePersonMentions('  @张三', '  @李四', [binding])).toEqual([])
    })
})
