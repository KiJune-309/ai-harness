// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinition, ChatConversation, ChatStreamEvent, HumanRequest } from '@ai-harness/contracts'
import { Workspace } from '../../components/workspace'
import { PrivatePortalProvider } from '../../components/private-portal'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const fixture = vi.hoisted(() => ({
    pathname: '/',
    search: '',
    route: vi.fn(),
    create: vi.fn(),
    history: vi.fn(),
    conversation: vi.fn(),
    agents: vi.fn(),
    stream: vi.fn(),
    cancel: vi.fn(),
    decide: vi.fn(),
    remove: vi.fn(),
    folders: vi.fn(),
    collaboration: null as {
        onHistoryChange?: () => void
        showDetails?: boolean
        source?: { kind: string; id: string }
        messages?: ChatConversation['messages']
        getMessageAnchor?: (id: string) => HTMLElement | null
    } | null,
}))

vi.mock('next/navigation', () => ({
    usePathname: () => fixture.pathname,
    useRouter: () => ({ push: fixture.route }),
    useSearchParams: () => new URLSearchParams(fixture.search),
}))
vi.mock('../../components/account-context', () => ({
    useAccount: () => ({ modelLabel: (value: string | undefined) => value ?? '默认模型' }),
}))
vi.mock('../../components/user-menu', () => ({ UserMenu: () => null }))
vi.mock('../../lib/project-folder-client', () => ({ listProjectFolders: fixture.folders, createProjectFolder: vi.fn() }))
vi.mock('../../components/collaboration-workspace', () => ({
    CollaborationNotifications: () => null,
    /**
     * Captures background history synchronization without replacing workspace behavior.
     * @param props - Current source panel refresh callback and visibility setting.
     * @returns No visible collaboration fixture.
     */
    CollaborationSourcePanel: (props: {
        onHistoryChange?: () => void
        showDetails?: boolean
        source?: { kind: string; id: string }
        messages?: ChatConversation['messages']
        getMessageAnchor?: (id: string) => HTMLElement | null
    }) => {
        fixture.collaboration = props
        return null
    },
}))
vi.mock('../../lib/agent-client', () => ({ listAgents: fixture.agents, getAgent: vi.fn() }))
vi.mock('../../lib/chat-client', () => ({
    getChatStatus: async () => ({ configured: true, model: '验收模型', storage: 'postgres' }),
    createConversation: fixture.create,
    listConversations: fixture.history,
    getConversation: fixture.conversation,
    cancelConversation: fixture.cancel,
    streamMessage: fixture.stream,
    decideHumanRequest: fixture.decide,
    deleteConversation: fixture.remove,
}))

const oldAgent: AgentDefinition = {
    id: 'a0b835e4-4c28-46e7-843d-024e68935dd8',
    name: '已有助手',
    description: '',
    modelId: 'existing-model',
    systemPrompt: '',
    toolIds: [],
    openingMessages: [],
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
}
const oldConversation: ChatConversation = {
    id: 'a5143e76-2e26-4b04-884d-c4159dcdcb7d',
    title: '已有讨论',
    agentId: oldAgent.id,
    agent: oldAgent,
    messages: [
        {
            id: 'old-message',
            role: 'user',
            content: '旧会话已经保存的内容',
            status: 'complete',
            createdAt: '2026-10-19T00:00:00.000Z',
        },
    ],
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
}
const newConversation: ChatConversation = {
    id: '577b37fc-56b8-43d7-a993-f4a55b811880',
    title: '新对话',
    messages: [],
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
}
const laterConversation: ChatConversation = {
    ...newConversation,
    title: '更新更晚的讨论',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-19T01:00:00.000Z',
}
const pickerFolderA = {
    id: '0b3269ca-cc7d-491b-a93f-d081d0e339fa',
    name: '网站改版',
    createdAt: newConversation.createdAt,
    updatedAt: newConversation.updatedAt,
}
const pickerFolderB = { ...pickerFolderA, id: 'b2dadc83-8d1c-4d5b-90c8-2da0a7aa66f7', name: '客户方案' }

const humanQuestion: HumanRequest = {
    id: 'bf165546-370c-445a-9dcb-3a18462b2e9d',
    version: 1,
    kind: 'question',
    callId: 'ask-human-1',
    status: 'pending',
    question: { text: '方案面向哪类读者？', options: ['工程团队', '产品团队'] },
    createdAt: oldConversation.createdAt,
    updatedAt: oldConversation.updatedAt,
}

/**
 * Mounts the actual workspace with private overlays in an isolated account-owned host.
 * @returns The rendered workspace and its cleanup controls.
 */
function renderWorkspace() {
    const host = document.createElement('div')
    document.body.append(host)
    return render(
        <PrivatePortalProvider container={host}>
            <Workspace>项目页面内容</Workspace>
        </PrivatePortalProvider>,
        { container: host }
    )
}

/**
 * Reads the visible saved conversations from the actual workspace sidebar.
 * @returns Conversation titles in their displayed navigation order.
 */
function sidebarConversationTitles() {
    return within(screen.getByLabelText('工作区侧栏'))
        .getAllByRole('button')
        .filter(button => button.getAttribute('data-slot') === 'sidebar-menu-button')
        .map(button => button.getAttribute('title'))
        .filter((title): title is string => title !== null)
}

/**
 * Opens the shared assistant menu and starts a draft with the selected assistant.
 * @param user - Simulated user interacting with the workspace.
 * @param name - Visible assistant name in the selection menu.
 * @returns A promise resolved once the menu closes after selection.
 */
async function chooseAssistant(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole('button', { name: '选择助手' }))
    await user.click(await screen.findByRole('menuitemradio', { name }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

/**
 * Chooses a real project or the ungrouped option from the composer menu.
 * @param user - Simulated user interacting with the workspace.
 * @param name - Visible project name or the ungrouped option label.
 * @returns A promise resolved after the selection menu closes.
 */
async function chooseComposerProject(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole('button', { name: '选择项目' }))
    await user.click(await screen.findByRole('menuitemradio', { name }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

beforeEach(() => {
    installAcceptanceBrowser()
    fixture.pathname = '/'
    fixture.search = ''
    fixture.route.mockReset()
    fixture.create.mockReset().mockResolvedValue(newConversation)
    fixture.history.mockReset().mockResolvedValue([oldConversation])
    fixture.conversation.mockReset().mockResolvedValue(oldConversation)
    fixture.agents.mockReset().mockResolvedValue([oldAgent])
    fixture.collaboration = null
    fixture.folders.mockReset().mockResolvedValue([])
    fixture.cancel.mockReset()
    fixture.decide.mockReset()
    fixture.remove.mockReset().mockResolvedValue(undefined)
    let savedConversation = newConversation
    fixture.stream
        .mockReset()
        .mockImplementation(async (id: string, content: string, requestId: string, receiveEvent: (event: ChatStreamEvent) => void) => {
            savedConversation = {
                ...savedConversation,
                id,
                messages: [
                    ...savedConversation.messages,
                    { id: `${requestId}:user`, requestId, role: 'user', content, status: 'complete', createdAt: newConversation.createdAt },
                    {
                        id: `${requestId}:assistant`,
                        requestId,
                        role: 'assistant',
                        content: `已收到：${content}`,
                        status: 'complete',
                        createdAt: newConversation.createdAt,
                    },
                ],
            }
            receiveEvent({ type: 'done', conversation: savedConversation })
        })
    localStorage.clear()
    localStorage.setItem('ai-harness.active-conversation', oldConversation.id)
})

afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('workspace human questions and durable execution', () => {
    it('separates consecutive visible assistant messages and gives receipts stable historical slots', async () => {
        const messages: ChatConversation['messages'] = [
            ...oldConversation.messages,
            { id: 'reply-before', role: 'assistant', content: '第一条回复', status: 'complete', createdAt: oldConversation.createdAt },
            { id: 'empty-tool', role: 'assistant', content: '', status: 'complete', createdAt: oldConversation.createdAt },
            {
                id: 'relay-reply',
                role: 'assistant',
                kind: 'relay',
                content: '同事发来的完整正文',
                status: 'complete',
                createdAt: oldConversation.updatedAt,
            },
            { id: 'next-input', role: 'user', content: '继续讨论这件事', status: 'complete', createdAt: oldConversation.updatedAt },
            { id: 'reply-after', role: 'assistant', content: '最后一条回复', status: 'complete', createdAt: oldConversation.updatedAt },
        ]
        const saved = { ...oldConversation, messages }
        fixture.history.mockResolvedValue([saved])
        fixture.conversation.mockResolvedValue(saved)
        renderWorkspace()
        const relay = await screen.findByRole('article', { name: '协作消息' })
        expect(relay.getAttribute('data-consecutive')).toBe('true')
        expect(relay.querySelector('time')?.getAttribute('datetime')).toBe(oldConversation.updatedAt)
        expect(screen.getByText('第一条回复').closest('article')?.hasAttribute('data-consecutive')).toBe(false)
        expect(screen.getByText('最后一条回复').closest('article')?.hasAttribute('data-consecutive')).toBe(false)
        expect(fixture.collaboration?.messages?.map(message => message.id)).toEqual(
            messages.filter(message => message.id !== 'empty-tool').map(message => message.id)
        )
        expect(fixture.collaboration?.getMessageAnchor?.('relay-reply')).toBe(
            document.querySelector('[data-chat-message-id="relay-reply"] .chat-message-receipt')
        )
        expect(fixture.collaboration?.getMessageAnchor?.('empty-tool')).toBeNull()
        expect(document.querySelectorAll('.chat-message-receipt')).toHaveLength(5)
    })

    it('removes the current chat and ignores late stream results and stale history after confirmed deletion', async () => {
        const user = userEvent.setup()
        const stream = acceptanceDeferred<void>()
        let receive: ((event: ChatStreamEvent) => void) | undefined
        fixture.stream.mockImplementationOnce(async (_id, _text, _requestId, onEvent) => {
            receive = onEvent
            await stream.promise
        })
        renderWorkspace()
        await user.type(await screen.findByRole('textbox', { name: '描述你的任务' }), '继续已有讨论')
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalledTimes(1))
        const sidebar = within(screen.getByLabelText('工作区侧栏'))
        await user.click(sidebar.getByRole('button', { name: `删除对话“${oldConversation.title}”` }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '删除对话' }))
        await screen.findByRole('heading', { name: '新对话' })
        expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(oldConversation.id)
        expect(screen.queryByText('旧会话已经保存的内容')).toBeNull()
        expect(localStorage.getItem('ai-harness.active-conversation')).toBeNull()
        await act(async () => {
            receive?.({ type: 'done', conversation: oldConversation })
            stream.resolve()
            document.dispatchEvent(new Event('visibilitychange'))
        })
        await waitFor(() => expect(fixture.history.mock.calls.length).toBeGreaterThan(1))
        expect(sidebar.queryByRole('button', { name: oldConversation.title })).toBeNull()
        expect(screen.queryByText('旧会话已经保存的内容')).toBeNull()
        expect(screen.getByRole('textbox', { name: '描述你的任务' })).toHaveProperty('value', '')
    })

    it('cycles one question above the same editor, hides each answered question, and ends clarification when work continues', async () => {
        const user = userEvent.setup()
        const nextQuestion: HumanRequest = {
            ...humanQuestion,
            id: 'e68a6f90-11f7-4a57-a2ce-03526d670fd5',
            callId: 'ask-human-2',
            question: { text: '希望什么时候完成？' },
        }
        let saved: ChatConversation = { ...oldConversation, humanRequests: [humanQuestion] }
        fixture.history.mockImplementation(async () => [saved])
        fixture.conversation.mockImplementation(async () => saved)
        fixture.stream.mockImplementation(async (_id, content, requestId, receive, _signal, _mentions, response) => {
            const next = response.requestId === humanQuestion.id ? nextQuestion : undefined
            saved = {
                ...saved,
                humanRequests: [
                    ...(saved.humanRequests ?? []).map(request =>
                        request.id === response.requestId ? { ...request, status: 'answered' as const, answer: content } : request
                    ),
                    ...(next ? [next] : []),
                ],
                messages: [
                    ...saved.messages,
                    { id: `${requestId}:user`, requestId, role: 'user', content, status: 'complete', createdAt: saved.updatedAt },
                    ...(!next
                        ? [
                              {
                                  id: `${requestId}:assistant`,
                                  role: 'assistant' as const,
                                  content: '信息齐了，开始整理方案。',
                                  status: 'complete' as const,
                                  createdAt: saved.updatedAt,
                              },
                          ]
                        : []),
                ],
            }
            receive({ type: 'done', conversation: saved })
        })
        renderWorkspace()
        const editor = await screen.findByRole('textbox', { name: '回答当前问题' })
        expect(screen.getAllByText(humanQuestion.question.text)).toHaveLength(1)
        expect(editor.getAttribute('aria-describedby')).toBe(`human-question-${humanQuestion.id}`)
        expect(document.querySelector('.compose-area')?.contains(screen.getByText(humanQuestion.question.text))).toBe(true)
        await user.type(editor, '工程团队')
        await user.click(screen.getByRole('button', { name: '发送答案' }))
        await screen.findByText('希望什么时候完成？')
        expect(screen.queryByText(humanQuestion.question.text)).toBeNull()
        expect(screen.queryByText('答案已保存')).toBeNull()
        expect(screen.getAllByRole('textbox')).toHaveLength(1)
        expect(editor).toHaveProperty('value', '')
        await user.type(editor, '下周五')
        await user.click(screen.getByRole('button', { name: '发送答案' }))
        await screen.findByText('信息齐了，开始整理方案。')
        expect(screen.queryByRole('region', { name: 'Agent 等待本人回答' })).toBeNull()
        expect(screen.getByRole('textbox', { name: '描述你的任务' })).toBe(editor)
        expect(editor.getAttribute('aria-describedby')).toBeNull()
        expect(fixture.stream.mock.calls.map(call => call[6])).toEqual([
            { requestId: humanQuestion.id, version: humanQuestion.version },
            { requestId: nextQuestion.id, version: nextQuestion.version },
        ])
        expect(fixture.decide).not.toHaveBeenCalled()
    })

    it('keeps one bottom editor, appends suggestions without sending, and binds the submitted answer to its exact question', async () => {
        const user = userEvent.setup()
        const saved: ChatConversation = {
            ...oldConversation,
            messages: [
                ...oldConversation.messages,
                {
                    id: 'empty-tool-reply',
                    requestId: '2fa772b9-e999-4c06-b987-cfc75864e49e',
                    role: 'assistant',
                    content: '',
                    status: 'complete',
                    createdAt: oldConversation.createdAt,
                },
            ],
            humanRequests: [humanQuestion],
        }
        fixture.history.mockResolvedValue([saved])
        fixture.conversation.mockResolvedValue(saved)
        renderWorkspace()
        const editor = await screen.findByRole('textbox', { name: '回答当前问题' })
        expect(screen.queryByText('已停止生成，可以继续提问。')).toBeNull()
        await user.type(editor, '已有补充')
        await user.click(screen.getByRole('button', { name: '工程团队' }))
        expect(editor).toHaveProperty('value', '已有补充\n工程团队')
        expect(screen.getAllByRole('textbox')).toHaveLength(1)
        expect(fixture.stream).not.toHaveBeenCalled()
        expect(fixture.decide).not.toHaveBeenCalled()
        fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
        expect(fixture.stream).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '发送答案' }))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalledTimes(1))
        expect(fixture.stream.mock.calls[0]![1]).toBe('已有补充\n工程团队')
        expect(fixture.stream.mock.calls[0]![6]).toEqual({ requestId: humanQuestion.id, version: humanQuestion.version })
        expect(fixture.decide).not.toHaveBeenCalled()
    })

    it('preserves an old answer draft when polling reveals another question and requires an explicit new binding', async () => {
        const user = userEvent.setup()
        const saved = { ...oldConversation, humanRequests: [humanQuestion] }
        fixture.history.mockResolvedValue([saved])
        fixture.conversation.mockResolvedValue(saved)
        renderWorkspace()
        const editor = await screen.findByRole('textbox', { name: '回答当前问题' })
        await user.type(editor, '给原问题的答案')
        const nextQuestion: HumanRequest = {
            ...humanQuestion,
            id: 'e68a6f90-11f7-4a57-a2ce-03526d670fd5',
            question: { text: '新的问题，是否按季度交付？' },
        }
        fixture.conversation.mockResolvedValue({ ...saved, humanRequests: [{ ...humanQuestion, status: 'answered' }, nextQuestion] })
        await act(async () => fixture.collaboration?.onHistoryChange?.())
        await screen.findByText('新的问题，是否按季度交付？')
        expect(editor).toHaveProperty('value', '给原问题的答案')
        expect(screen.getByRole('button', { name: '发送答案' }).hasAttribute('disabled')).toBe(true)
        expect(fixture.stream).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '已核对，将草稿用于当前问题' }))
        await user.click(screen.getByRole('button', { name: '发送答案' }))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalledTimes(1))
        expect(fixture.stream.mock.calls[0]![6]).toEqual({ requestId: nextQuestion.id, version: nextQuestion.version })
    })

    it('cancels a question through its dedicated action before allowing ordinary discussion', async () => {
        const user = userEvent.setup()
        const saved = { ...oldConversation, humanRequests: [humanQuestion] }
        fixture.history.mockResolvedValue([saved])
        fixture.conversation.mockResolvedValue(saved)
        fixture.decide.mockResolvedValue({ ...saved, humanRequests: [{ ...humanQuestion, status: 'cancelled' }] })
        renderWorkspace()
        await user.click(await screen.findByRole('button', { name: '取消此问题' }))
        const editor = await screen.findByRole('textbox', { name: '描述你的任务' })
        await user.type(editor, '开始另一项讨论')
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalledTimes(1))
        expect(fixture.decide.mock.calls[0]![2]).toMatchObject({ decision: 'cancel', version: humanQuestion.version })
        expect(fixture.stream.mock.calls[0]![6]).toBeUndefined()
    })

    it('retains an unanswered draft and its original action identity when both submission and readback disconnect', async () => {
        const user = userEvent.setup()
        const saved = { ...oldConversation, humanRequests: [humanQuestion] }
        fixture.history.mockResolvedValue([saved])
        fixture.conversation.mockRejectedValue(new Error('读取也已断开'))
        fixture.stream.mockRejectedValue(new Error('提交响应已断开'))
        renderWorkspace()
        const editor = await screen.findByRole('textbox', { name: '回答当前问题' })
        await user.type(editor, '必须保留的完整答案')
        await user.click(screen.getByRole('button', { name: '发送答案' }))
        await screen.findByText('提交响应已断开')
        await waitFor(() => expect(editor).toHaveProperty('value', '必须保留的完整答案'))
        const originalAction = fixture.stream.mock.calls[0]![2]
        await user.click(screen.getByRole('button', { name: '重试这条消息' }))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalledTimes(2))
        expect(fixture.stream.mock.calls[1]![2]).toBe(originalAction)
        expect(fixture.stream.mock.calls[1]![6]).toEqual({ requestId: humanQuestion.id, version: humanQuestion.version })
        expect(fixture.decide).not.toHaveBeenCalled()
    })

    it('retains an accepted background execution after the response ends and applies its later durable result', async () => {
        const user = userEvent.setup()
        let running: ChatConversation | undefined
        fixture.stream.mockImplementationOnce(async (_id, content, requestId, receive) => {
            running = {
                ...oldConversation,
                activeRequestId: requestId,
                messages: [
                    ...oldConversation.messages,
                    { id: `${requestId}:user`, requestId, role: 'user', content, status: 'complete', createdAt: oldConversation.createdAt },
                ],
            }
            receive({ type: 'done', conversation: running })
        })
        renderWorkspace()
        await user.type(await screen.findByRole('textbox', { name: '描述你的任务' }), '后台工作')
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await screen.findByText('Agent 正在后台执行，结果将自动更新')
        expect(screen.getByRole('button', { name: '停止生成' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: '发送任务' })).toBeNull()
        const finished: ChatConversation = {
            ...running!,
            activeRequestId: undefined,
            messages: [
                ...running!.messages,
                {
                    id: 'background-result',
                    role: 'assistant',
                    content: '持久后台结果',
                    status: 'complete',
                    createdAt: oldConversation.createdAt,
                },
            ],
        }
        fixture.history.mockResolvedValue([finished])
        await act(async () => document.dispatchEvent(new Event('visibilitychange')))
        await screen.findByText('持久后台结果')
        expect(screen.queryByRole('button', { name: '停止生成' })).toBeNull()
        expect(fixture.stream).toHaveBeenCalledTimes(1)
    })
})

describe('workspace ordinary conversations and assistant selection', () => {
    it('shows saved conversations in the initially expanded history and retains manual collapse and expand controls', async () => {
        const user = userEvent.setup()
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        const sidebar = within(screen.getByLabelText('工作区侧栏'))
        const history = sidebar.getByRole('button', { name: '全部对话' })
        expect(history.getAttribute('aria-expanded')).toBe('true')
        await user.click(sidebar.getByRole('button', { name: oldConversation.title }))
        await waitFor(() => expect(fixture.conversation).toHaveBeenCalledWith(oldConversation.id))

        await user.click(history)
        await waitFor(() => {
            expect(history.getAttribute('aria-expanded')).toBe('false')
            expect(sidebar.queryByRole('button', { name: oldConversation.title })).toBeNull()
        })
        await user.click(history)
        await waitFor(() => {
            expect(history.getAttribute('aria-expanded')).toBe('true')
            expect(sidebar.getByRole('button', { name: oldConversation.title })).toBeTruthy()
        })
        expect(fixture.create).not.toHaveBeenCalled()
        expect(fixture.stream).not.toHaveBeenCalled()
        expect(fixture.cancel).not.toHaveBeenCalled()
    })

    it('starts a blank conversation from navigation while retaining saved history and deferring creation', async () => {
        const user = userEvent.setup()
        fixture.agents.mockResolvedValue([{ ...oldAgent, openingMessages: ['助手原有开场内容'] }])
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        const sidebar = within(screen.getByLabelText('工作区侧栏'))
        expect(sidebar.queryByRole('link', { name: '工作台' })).toBeNull()
        await user.type(screen.getByRole('textbox', { name: '描述你的任务' }), '尚未发送的草稿')
        await user.click(sidebar.getByRole('button', { name: '开始新对话' }))

        await screen.findByRole('heading', { name: '新对话' })
        expect(screen.queryByText('旧会话已经保存的内容')).toBeNull()
        expect(screen.queryByText('助手原有开场内容')).toBeNull()
        expect((screen.getByRole('textbox', { name: '描述你的任务' }) as HTMLTextAreaElement).value).toBe('')
        expect(screen.getByRole('button', { name: '选择助手' }).textContent).toBe('通用助手')
        expect(localStorage.getItem('ai-harness.active-conversation')).toBeNull()
        expect(fixture.route).toHaveBeenCalledExactlyOnceWith('/')
        expect(sidebar.getByRole('button', { name: oldConversation.title })).toBeTruthy()
        expect(fixture.create).not.toHaveBeenCalled()
        expect(fixture.stream).not.toHaveBeenCalled()
        expect(fixture.cancel).not.toHaveBeenCalled()
    })

    it('opens a blank conversation from another page without restoring its remembered chat', async () => {
        const user = userEvent.setup()
        fixture.pathname = '/projects'
        const view = renderWorkspace()
        await waitFor(() => expect(fixture.history).toHaveBeenCalled())
        await user.click(within(screen.getByLabelText('工作区侧栏')).getByRole('button', { name: '开始新对话' }))
        expect(fixture.route).toHaveBeenCalledExactlyOnceWith('/')
        expect(localStorage.getItem('ai-harness.active-conversation')).toBeNull()

        fixture.pathname = '/'
        view.rerender(
            <PrivatePortalProvider container={view.container}>
                <Workspace>项目页面内容</Workspace>
            </PrivatePortalProvider>
        )
        await screen.findByRole('heading', { name: '新对话' })
        await waitFor(() => expect(fixture.agents).toHaveBeenCalled())
        expect(screen.queryByText('旧会话已经保存的内容')).toBeNull()
        expect(screen.getByRole('button', { name: '选择助手' }).textContent).toBe('通用助手')
        expect(fixture.create).not.toHaveBeenCalled()
        expect(fixture.stream).not.toHaveBeenCalled()
    })

    it('keeps an existing reply running without taking over the new empty conversation when it finishes', async () => {
        const user = userEvent.setup()
        const reply = acceptanceDeferred<void>()
        let receiveEvent!: (event: ChatStreamEvent) => void
        let streamSignal!: AbortSignal
        fixture.stream.mockImplementation(async (_id, _content, _requestId, receive, signal) => {
            receiveEvent = receive
            streamSignal = signal
            await reply.promise
        })
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        await user.type(screen.getByRole('textbox', { name: '描述你的任务' }), '继续旧讨论')
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalledTimes(1))
        const sidebar = within(screen.getByLabelText('工作区侧栏'))
        await user.click(sidebar.getByRole('button', { name: '开始新对话' }))
        await screen.findByRole('heading', { name: '新对话' })
        expect(streamSignal.aborted).toBe(false)
        expect(fixture.cancel).not.toHaveBeenCalled()

        await act(async () => {
            receiveEvent({
                type: 'done',
                conversation: {
                    ...oldConversation,
                    messages: [
                        ...oldConversation.messages,
                        {
                            id: 'late-reply',
                            role: 'assistant',
                            content: '旧讨论完成的回答',
                            status: 'complete',
                            createdAt: oldConversation.updatedAt,
                        },
                    ],
                },
            })
            reply.resolve()
        })
        expect(screen.getByRole('heading', { name: '新对话' })).toBeTruthy()
        expect(screen.queryByText('旧讨论完成的回答')).toBeNull()
        expect(localStorage.getItem('ai-harness.active-conversation')).toBeNull()
        expect(sidebar.getByRole('button', { name: `${oldConversation.title}，未读消息` })).toBeTruthy()
        expect(fixture.create).not.toHaveBeenCalled()
    })

    it('shows received Agent messages in the ordinary conversation list and opens their complete text', async () => {
        const user = userEvent.setup()
        const received: ChatConversation = {
            ...newConversation,
            title: '来自李四的消息',
            updatedAt: '2026-10-19T02:00:00.000Z',
            messages: [
                {
                    id: 'received-opening',
                    role: 'assistant',
                    kind: 'opening',
                    status: 'complete',
                    createdAt: newConversation.createdAt,
                    content: '李四发来消息：请补充复现步骤。',
                },
            ],
        }
        fixture.history.mockResolvedValue([oldConversation, received])
        fixture.conversation.mockImplementation(async id => (id === received.id ? received : oldConversation))
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        expect(screen.queryByText('同事发来的对话')).toBeNull()
        await user.click(within(screen.getByLabelText('工作区侧栏')).getByRole('button', { name: received.title }))
        await screen.findByText('李四发来消息：请补充复现步骤。')
        expect(screen.queryByText('任务详情与协作记录')).toBeNull()
        expect(screen.queryByText('上下游协作')).toBeNull()
        expect(fixture.stream).not.toHaveBeenCalled()
    })

    it('polls received conversations into the normal list without requiring a page refresh', async () => {
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        fixture.history.mockResolvedValue([oldConversation, { ...newConversation, title: '刚收到的同事消息' }])
        await waitFor(
            () => expect(within(screen.getByLabelText('工作区侧栏')).getByRole('button', { name: '刚收到的同事消息' })).toBeTruthy(),
            { timeout: 6000 }
        )
        expect(fixture.history.mock.calls.every(([signal]) => signal instanceof AbortSignal)).toBe(true)
    })

    it('loads ordinary received conversation history immediately while viewing another workspace page', async () => {
        fixture.pathname = '/agents'
        fixture.history.mockResolvedValue([{ ...newConversation, title: '其他页面也能看到的消息' }])
        renderWorkspace()
        await screen.findByRole('button', { name: '其他页面也能看到的消息' })
        expect(fixture.history).toHaveBeenCalledTimes(1)
        expect(fixture.agents).not.toHaveBeenCalled()
    })

    it('retains streamed assistant text when a saved-history poll returns an older version', async () => {
        const user = userEvent.setup()
        const reply = acceptanceDeferred<void>()
        fixture.stream.mockImplementation(async (_id, _content, _requestId, receiveEvent) => {
            receiveEvent({ type: 'delta', text: '尚未保存的生成片段' })
            await reply.promise
        })
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        await user.type(screen.getByRole('textbox', { name: '描述你的任务' }), '继续讨论')
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await screen.findByText('尚未保存的生成片段')
        await waitFor(() => expect(fixture.history.mock.calls.length).toBeGreaterThan(1), { timeout: 6000 })
        expect(screen.getByText('尚未保存的生成片段')).toBeTruthy()
        await act(async () => reply.resolve())
    })

    it('uses the stored task source for a legacy received conversation displayed in ordinary chat', async () => {
        const received = { ...oldConversation, task: { goal: '同事原文', status: 'in-progress' as const, started: true } }
        fixture.history.mockResolvedValue([received])
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        expect(fixture.collaboration?.source).toEqual({ kind: 'task', id: oldConversation.id })
    })

    it('chooses an assistant through the private menu and waits for explicit message submission', async () => {
        const user = userEvent.setup()
        const { container } = renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        const selector = screen.getByRole('button', { name: '选择助手' })
        await user.click(selector)
        const menu = await screen.findByRole('menu')
        expect(container.contains(menu)).toBe(true)
        expect(within(menu).getByRole('menuitemradio', { name: oldAgent.name }).getAttribute('aria-checked')).toBe('true')
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        expect(document.activeElement).toBe(selector)

        await user.click(selector)
        await user.click(await screen.findByRole('menuitemradio', { name: '通用助手' }))
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        expect(selector.textContent).toBe('通用助手')
        expect(screen.queryByText('旧会话已经保存的内容')).toBeNull()
        await user.click(selector)
        await user.click(await screen.findByRole('menuitemradio', { name: oldAgent.name }))
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        expect(selector.textContent).toBe(oldAgent.name)
        expect(fixture.create).not.toHaveBeenCalled()
        expect(fixture.stream).not.toHaveBeenCalled()

        await user.type(screen.getByRole('textbox', { name: '描述你的任务' }), '请帮我整理计划')
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await waitFor(() =>
            expect(fixture.create).toHaveBeenCalledExactlyOnceWith('请帮我整理计划', expect.any(AbortSignal), oldAgent.id, {
                requestId: expect.any(String),
            })
        )
    })

    it('saves a new conversation on its first nonempty message and reuses its identifier for later messages', async () => {
        const user = userEvent.setup()
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        await user.click(within(screen.getByLabelText('工作区侧栏')).getByRole('button', { name: '开始新对话' }))
        const editor = screen.getByRole('textbox', { name: '描述你的任务' }) as HTMLTextAreaElement
        await user.type(editor, '   ')
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        expect(fixture.create).not.toHaveBeenCalled()
        expect(fixture.stream).not.toHaveBeenCalled()
        await user.clear(editor)
        const firstMessage = '帮我梳理产品发布计划'
        await user.type(editor, firstMessage)
        expect(fixture.create).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '发送任务' }))

        await screen.findByText(`已收到：${firstMessage}`)
        expect(fixture.create).toHaveBeenCalledExactlyOnceWith(firstMessage, expect.any(AbortSignal), undefined, {
            requestId: expect.any(String),
        })
        expect(fixture.stream.mock.calls[0]?.slice(0, 6)).toEqual([
            newConversation.id,
            firstMessage,
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            [],
        ])
        expect(fixture.stream.mock.calls[0]?.[6]).toBeUndefined()
        expect(localStorage.getItem('ai-harness.active-conversation')).toBe(newConversation.id)
        const secondMessage = '再补充一下时间安排'
        await user.type(editor, secondMessage)
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await screen.findByText(`已收到：${secondMessage}`)
        expect(fixture.create).toHaveBeenCalledTimes(1)
        expect(fixture.stream.mock.calls[1]?.slice(0, 6)).toEqual([
            newConversation.id,
            secondMessage,
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            [],
        ])
        expect(fixture.stream.mock.calls[1]?.[6]).toBeUndefined()
    })

    it.each(['success', 'failure'] as const)(
        'preserves the new empty draft when a previous first-message creation settles with %s',
        async outcome => {
            const user = userEvent.setup()
            const creation = acceptanceDeferred<ChatConversation>()
            fixture.create.mockReturnValueOnce(creation.promise)
            renderWorkspace()
            await screen.findByText('旧会话已经保存的内容')
            await chooseAssistant(user, '通用助手')
            const editor = screen.getByRole('textbox', { name: '描述你的任务' }) as HTMLTextAreaElement
            const firstMessage = '这个请求正在等待保存'
            await user.type(editor, firstMessage)
            await user.click(screen.getByRole('button', { name: '发送任务' }))
            expect(fixture.create).toHaveBeenCalledTimes(1)
            expect(fixture.stream).not.toHaveBeenCalled()
            await chooseAssistant(user, oldAgent.name)
            expect(editor.value).toBe('')
            expect(localStorage.getItem('ai-harness.active-conversation')).toBeNull()

            await act(async () => {
                if (outcome === 'success') creation.resolve(newConversation)
                else creation.reject(new Error('之前的会话创建失败'))
            })

            const main = within(screen.getByRole('main'))
            expect(main.getByRole('heading', { name: '新对话' })).toBeTruthy()
            expect(main.queryByText(firstMessage)).toBeNull()
            expect(main.queryByText(`已收到：${firstMessage}`)).toBeNull()
            expect(main.queryByRole('alert')).toBeNull()
            expect(main.queryByRole('button', { name: '重试这条消息' })).toBeNull()
            expect(editor.value).toBe('')
            expect(localStorage.getItem('ai-harness.active-conversation')).toBeNull()
            expect(fixture.route.mock.calls.every(([url]) => url === '/')).toBe(true)
            if (outcome === 'success') {
                expect(fixture.stream).toHaveBeenCalledExactlyOnceWith(
                    newConversation.id,
                    firstMessage,
                    expect.any(String),
                    expect.any(Function),
                    expect.any(AbortSignal),
                    []
                )
                const sidebar = within(screen.getByLabelText('工作区侧栏'))
                expect(sidebar.getByRole('button', { name: /^新对话(?:，未读消息)?$/ })).toBeTruthy()
            } else expect(fixture.stream).not.toHaveBeenCalled()
        }
    )
})

describe('workspace conversation update ordering', () => {
    it.each(['history', 'deep link'] as const)('orders unsorted %s by updatedAt instead of creation or selection', async source => {
        const user = userEvent.setup()
        fixture.history.mockResolvedValue([oldConversation, laterConversation])
        if (source === 'deep link') fixture.search = `conversation=${oldConversation.id}`
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')

        expect(sidebarConversationTitles()).toEqual([laterConversation.title, oldConversation.title])
        await user.click(within(screen.getByLabelText('工作区侧栏')).getByRole('button', { name: oldConversation.title }))
        await waitFor(() => expect(fixture.conversation).toHaveBeenCalled())
        expect(sidebarConversationTitles()).toEqual([laterConversation.title, oldConversation.title])
    })

    it('reorders hidden collaboration history refreshes by their saved update time', async () => {
        fixture.history.mockResolvedValue([oldConversation, laterConversation])
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        expect(fixture.collaboration?.showDetails).toBe(false)
        fixture.conversation.mockResolvedValueOnce({ ...oldConversation, updatedAt: '2026-10-19T02:00:00.000Z' })

        await act(async () => fixture.collaboration?.onHistoryChange?.())

        expect(sidebarConversationTitles()).toEqual([oldConversation.title, laterConversation.title])
        fixture.conversation.mockResolvedValueOnce(oldConversation)
        await act(async () => fixture.collaboration?.onHistoryChange?.())
        expect(sidebarConversationTitles()).toEqual([laterConversation.title, oldConversation.title])
    })

    it('promotes a sent turn during streaming and applies the persisted updatedAt when the reply settles', async () => {
        const user = userEvent.setup()
        const streamFinished = acceptanceDeferred<void>()
        let receiveEvent!: (event: ChatStreamEvent) => void
        let streamedRequestId = ''
        fixture.history.mockResolvedValue([oldConversation, laterConversation])
        fixture.stream.mockImplementation(
            async (_id: string, _content: string, requestId: string, receive: (event: ChatStreamEvent) => void) => {
                receiveEvent = receive
                streamedRequestId = requestId
                await streamFinished.promise
            }
        )
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        expect(sidebarConversationTitles()).toEqual([laterConversation.title, oldConversation.title])
        await user.type(screen.getByRole('textbox', { name: '描述你的任务' }), '继续这个讨论')
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalled())
        expect(sidebarConversationTitles()).toEqual([oldConversation.title, laterConversation.title])

        act(() => {
            receiveEvent({ type: 'reasoning', text: '先考虑上下文' })
            receiveEvent({ type: 'delta', text: '流式回复' })
        })
        expect(sidebarConversationTitles()).toEqual([oldConversation.title, laterConversation.title])
        await act(async () => {
            receiveEvent({
                type: 'done',
                conversation: {
                    ...oldConversation,
                    updatedAt: '2026-10-19T00:30:00.000Z',
                    messages: [
                        ...oldConversation.messages,
                        {
                            id: `${streamedRequestId}:assistant`,
                            requestId: streamedRequestId,
                            role: 'assistant',
                            content: '最终回复',
                            status: 'complete',
                            createdAt: '2026-10-19T00:30:00.000Z',
                        },
                    ],
                },
            })
            streamFinished.resolve()
        })
        expect(sidebarConversationTitles()).toEqual([laterConversation.title, oldConversation.title])
    })
})

describe('workspace personal project conversation boundaries', () => {
    it('preserves draft text and its assistant when choosing or clearing the composer project without saving or running a model', async () => {
        const user = userEvent.setup()
        fixture.folders.mockResolvedValue([pickerFolderA, pickerFolderB])
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        await chooseAssistant(user, oldAgent.name)
        const editor = screen.getByRole('textbox', { name: '描述你的任务' })
        await user.type(editor, '先保留这段尚未发送的讨论')

        await chooseComposerProject(user, pickerFolderA.name)
        expect(editor).toHaveProperty('value', '先保留这段尚未发送的讨论')
        expect(screen.getByRole('button', { name: '选择助手' }).textContent).toBe(oldAgent.name)
        expect(screen.getByRole('button', { name: '选择项目' }).textContent).toContain(pickerFolderA.name)
        expect(fixture.create).not.toHaveBeenCalled()
        expect(fixture.stream).not.toHaveBeenCalled()

        await chooseComposerProject(user, '不选择项目')
        expect(editor).toHaveProperty('value', '先保留这段尚未发送的讨论')
        expect(screen.getByRole('button', { name: '选择助手' }).textContent).toBe(oldAgent.name)
        expect(fixture.create).not.toHaveBeenCalled()
        expect(fixture.stream).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await waitFor(() =>
            expect(fixture.create).toHaveBeenCalledExactlyOnceWith('先保留这段尚未发送的讨论', expect.any(AbortSignal), oldAgent.id, {
                requestId: expect.any(String),
            })
        )
    })

    it('freezes the chosen composer project during creation and reuses that project and action identity after a failed creation', async () => {
        const user = userEvent.setup()
        const creation = acceptanceDeferred<ChatConversation>()
        const created = { ...newConversation, title: '项目中的首条输入', projectFolderId: pickerFolderA.id }
        fixture.folders.mockResolvedValue([pickerFolderA, pickerFolderB])
        fixture.history.mockResolvedValue([])
        fixture.create.mockReturnValueOnce(creation.promise).mockResolvedValue(created)
        localStorage.clear()
        renderWorkspace()
        await screen.findByRole('heading', { name: '新对话' })
        await chooseComposerProject(user, pickerFolderA.name)
        await user.type(screen.getByRole('textbox', { name: '描述你的任务' }), created.title)
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        await waitFor(() => expect(fixture.create).toHaveBeenCalledTimes(1))
        const originalCreation = fixture.create.mock.calls[0]![3]
        expect(originalCreation).toEqual({ projectFolderId: pickerFolderA.id, requestId: expect.any(String) })
        expect(screen.getByRole('button', { name: '选择项目' })).toHaveProperty('disabled', true)
        await act(async () => creation.reject(new Error('项目对话创建暂时断开')))
        await screen.findByText('项目对话创建暂时断开')
        expect(screen.getByRole('textbox', { name: '描述你的任务' })).toHaveProperty('value', created.title)
        expect(screen.getByRole('button', { name: '选择项目' })).toHaveProperty('disabled', true)

        await user.click(screen.getByRole('button', { name: '重试这条消息' }))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalledTimes(1))
        expect(fixture.create.mock.calls[1]![3]).toEqual(originalCreation)
        expect(fixture.create).toHaveBeenCalledTimes(2)
    })

    it('shows the saved conversation project while preventing the composer from moving an existing conversation', async () => {
        const user = userEvent.setup()
        const saved = { ...oldConversation, projectFolderId: pickerFolderA.id }
        fixture.folders.mockResolvedValue([pickerFolderA, pickerFolderB])
        fixture.history.mockResolvedValue([saved])
        fixture.conversation.mockResolvedValue(saved)
        renderWorkspace()
        await screen.findByText('旧会话已经保存的内容')
        const selector = await screen.findByRole('button', { name: '选择项目' })
        await waitFor(() => expect(selector.textContent).toContain(pickerFolderA.name))
        expect(selector).toHaveProperty('disabled', true)
        await user.click(selector)
        expect(screen.queryByRole('menu')).toBeNull()
        expect(fixture.create).not.toHaveBeenCalled()
        expect(fixture.stream).not.toHaveBeenCalled()
    })

    it('freezes a new conversation project while navigation switches to another empty project', async () => {
        const user = userEvent.setup()
        const folderA = {
            id: '0b3269ca-cc7d-491b-a93f-d081d0e339fa',
            name: '网站改版',
            createdAt: newConversation.createdAt,
            updatedAt: newConversation.updatedAt,
        }
        const folderB = { ...folderA, id: 'b2dadc83-8d1c-4d5b-90c8-2da0a7aa66f7', name: '客户方案' }
        const created = { ...newConversation, title: 'A 项目的首次消息', projectFolderId: folderA.id }
        const creation = acceptanceDeferred<ChatConversation>()
        fixture.folders.mockResolvedValue([folderA, folderB])
        fixture.history.mockResolvedValue([])
        fixture.create.mockReturnValueOnce(creation.promise)
        fixture.stream.mockImplementationOnce(
            async (_id: string, _text: string, _requestId: string, receive: (event: ChatStreamEvent) => void) => {
                receive({
                    type: 'done',
                    conversation: {
                        ...created,
                        messages: [
                            {
                                id: 'result-a',
                                role: 'assistant',
                                content: 'A 项目完成的回答',
                                status: 'complete',
                                createdAt: created.createdAt,
                            },
                        ],
                    },
                })
            }
        )
        renderWorkspace()
        await user.click(await screen.findByRole('button', { name: `在“${folderA.name}”中新建对话` }))
        await user.type(screen.getByRole('textbox', { name: '描述你的任务' }), created.title)
        await user.click(screen.getByRole('button', { name: '发送任务' }))
        expect(fixture.create).toHaveBeenCalledWith(created.title, expect.any(AbortSignal), undefined, {
            projectFolderId: folderA.id,
            requestId: expect.any(String),
        })
        await user.click(screen.getByRole('button', { name: `在“${folderB.name}”中新建对话` }))
        await act(async () => creation.resolve(created))
        await waitFor(() => expect(fixture.stream).toHaveBeenCalledTimes(1))
        expect(screen.queryByText('A 项目完成的回答')).toBeNull()
        expect(screen.getByRole('textbox', { name: '描述你的任务' })).toHaveProperty('value', '')
        const header = document.querySelector('.main-panel > .hidden.h-14')
        expect(header?.textContent).toContain(folderB.name)
        const sidebar = within(screen.getByLabelText('工作区侧栏'))
        await user.click(sidebar.getByRole('button', { name: folderA.name }))
        expect(sidebar.getAllByRole('button').filter(button => button.getAttribute('title') === created.title)).toHaveLength(2)
    })
})
