// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStatus, PersonalProject, PersonalTask } from '@ai-harness/contracts'
import { TaskWorkspace } from '../../components/task-workspace'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    agents: vi.fn(),
    status: vi.fn(),
    projects: vi.fn(),
    tasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateStatus: vi.fn(),
    updateProject: vi.fn(),
    start: vi.fn(),
    message: vi.fn(),
    cancel: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    source: vi.fn(),
    collaborationCommand: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.push, replace: api.replace }) }))
vi.mock('../../components/account-context', () => ({ useAccount: () => ({ modelLabel: (id?: string) => id ?? '默认模型' }) }))
vi.mock('../../lib/agent-client', () => ({ listAgents: api.agents }))
vi.mock('../../lib/chat-client', () => ({ getChatStatus: api.status }))
vi.mock('../../lib/project-client', () => ({ listProjects: api.projects }))
vi.mock('../../lib/collaboration-client', async importOriginal => ({
    ...(await importOriginal()),
    getSourceCollaboration: api.source,
    sendCollaborationCommand: api.collaborationCommand,
}))
vi.mock('../../lib/task-client', () => ({
    listTasks: api.tasks,
    getTask: api.getTask,
    createTask: api.createTask,
    updateTaskStatus: api.updateStatus,
    updateTaskProject: api.updateProject,
    startTask: api.start,
    streamTaskMessage: api.message,
    cancelTask: api.cancel,
}))

const id = 'a77f40d3-4147-4161-a4a9-d65cb2a7a5bf'
const requestId = '42b715b8-4aad-4c9f-9f41-9c90a9b9814b'
const createdAt = '2026-10-18T00:00:00.000Z'
const connection: ChatStatus = { configured: true, model: 'stable-model-id', storage: 'postgres' }
const task: PersonalTask = {
    id,
    title: '比较三个候选方案',
    task: { goal: '比较成本与维护难度，给出选择依据。', status: 'not-started', started: false },
    agent: {
        id: 'f55e9ba7-d97b-4c6d-9000-6048a1839f54',
        name: '稳定助手名称',
        description: '',
        modelId: 'stable-model-id',
        systemPrompt: '保留创建时的配置。',
        toolIds: [],
        openingMessages: [],
        createdAt,
        updatedAt: createdAt,
    },
    messages: [],
    createdAt,
    updatedAt: createdAt,
}
const project: PersonalProject = {
    id: 'a69bb85d-749f-48c3-ab4a-44dac1b88f63',
    name: '项目显示名称',
    description: '',
    createdAt,
    updatedAt: createdAt,
}

beforeEach(() => {
    installAcceptanceBrowser()
    sessionStorage.clear()
    for (const mock of Object.values(api)) mock.mockReset()
    api.status.mockResolvedValue(connection)
    api.agents.mockResolvedValue([task.agent])
    api.tasks.mockResolvedValue([task])
    api.getTask.mockResolvedValue(task)
    api.projects.mockResolvedValue([project])
    api.source.mockResolvedValue({
        events: [],
        nodes: [],
        questions: [],
        artifacts: [],
        pendingDispatches: [],
        nextCursor: 0,
        hasMore: false,
    })
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('shadcn task controls preserve task behavior', () => {
    it('focuses the first invalid input and retains the creation draft after cancel and reopen', async () => {
        const user = userEvent.setup()
        render(<TaskWorkspace />)
        const opener = await screen.findByRole('button', { name: '新建任务' })
        await user.click(opener)
        const dialog = await screen.findByRole('dialog', { name: '新建个人任务' })
        const title = within(dialog).getByRole('textbox', { name: '任务名称' })
        await waitFor(() => expect(document.activeElement).toBe(title))
        await user.click(within(dialog).getByRole('button', { name: '创建任务' }))
        await waitFor(() => expect(document.activeElement).toBe(title))
        expect(title.getAttribute('aria-invalid')).toBe('true')
        expect(api.createTask).not.toHaveBeenCalled()
        await user.type(title, '保留的任务草稿')
        await user.type(within(dialog).getByRole('textbox', { name: '任务目标' }), '取消后仍然保留的目标。')
        await user.selectOptions(within(dialog).getByLabelText('使用的 Agent'), task.agent.id)
        await user.click(within(dialog).getByRole('button', { name: '暂时取消' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(opener))
        await user.click(opener)
        const reopened = await screen.findByRole('dialog')
        expect((within(reopened).getByRole('textbox', { name: '任务名称' }) as HTMLInputElement).value).toBe('保留的任务草稿')
        expect((within(reopened).getByRole('textbox', { name: '任务目标' }) as HTMLTextAreaElement).value).toBe('取消后仍然保留的目标。')
        expect((within(reopened).getByLabelText('使用的 Agent') as HTMLSelectElement).value).toBe(task.agent.id)
        expect(api.start).not.toHaveBeenCalled()
        expect(api.message).not.toHaveBeenCalled()
    })

    it('keeps failed creation text and the same UUID, preserves the empty agent choice, and blocks closing while saving', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<PersonalTask>()
        api.createTask.mockRejectedValueOnce(new Error('创建暂时失败。')).mockReturnValueOnce(pending.promise)
        render(<TaskWorkspace />)
        await user.click(await screen.findByRole('button', { name: '新建任务' }))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByRole('textbox', { name: '任务名称' }), task.title)
        await user.type(within(dialog).getByRole('textbox', { name: '任务目标' }), task.task.goal)
        const agentSelect = within(dialog).getByLabelText('使用的 Agent')
        await user.selectOptions(agentSelect, task.agent.id)
        await user.selectOptions(agentSelect, '')
        await user.click(within(dialog).getByRole('button', { name: '创建任务' }))
        expect(await within(dialog).findByText('创建暂时失败。')).toBeTruthy()
        expect((within(dialog).getByRole('textbox', { name: '任务名称' }) as HTMLInputElement).value).toBe(task.title)
        expect((within(dialog).getByRole('textbox', { name: '任务目标' }) as HTMLTextAreaElement).value).toBe(task.task.goal)
        const firstInput = api.createTask.mock.calls[0][0]
        expect(firstInput).toEqual({ title: task.title, goal: task.task.goal, requestId: expect.any(String) })
        expect(firstInput.requestId).toMatch(/^[\da-f-]{36}$/)
        await user.click(within(dialog).getByRole('button', { name: '创建任务' }))
        expect(api.createTask).toHaveBeenNthCalledWith(2, firstInput)
        expect((within(dialog).getByRole('button', { name: '正在保存' }) as HTMLButtonElement).disabled).toBe(true)
        await user.keyboard('{Escape}')
        expect(screen.getByRole('dialog')).toBe(dialog)
        expect((within(dialog).getByRole('button', { name: '暂时取消' }) as HTMLButtonElement).disabled).toBe(true)
        await act(async () => pending.resolve(task))
        await waitFor(() => expect(api.push).toHaveBeenCalledExactlyOnceWith(`/inbox/${id}`))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(api.createTask).toHaveBeenCalledTimes(2)
        expect(api.start).not.toHaveBeenCalled()
        expect(api.message).not.toHaveBeenCalled()
    })

    it('uses the actual checkbox with confirmed completion and restore semantics after a failed save', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<PersonalTask>()
        const completed: PersonalTask = { ...task, task: { ...task.task, status: 'completed' } }
        api.updateStatus.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(completed).mockResolvedValueOnce(task)
        render(<TaskWorkspace />)
        const checkbox = await screen.findByRole('checkbox', { name: `完成任务：${task.title}` })
        await user.click(checkbox)
        expect(api.updateStatus).toHaveBeenCalledExactlyOnceWith(id, { status: 'completed' })
        expect(checkbox.getAttribute('aria-checked')).toBe('false')
        expect(checkbox.getAttribute('aria-disabled')).toBe('true')
        await act(async () => pending.reject(new Error('状态保存失败。')))
        expect(await screen.findByText('状态保存失败。')).toBeTruthy()
        expect(checkbox.getAttribute('aria-checked')).toBe('false')
        await user.click(checkbox)
        await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull())
        await user.click(screen.getByRole('button', { name: /已完成/ }))
        const restore = await screen.findByRole('checkbox', { name: `恢复任务：${task.title}` })
        expect(restore.getAttribute('aria-checked')).toBe('true')
        await user.click(restore)
        await waitFor(() => expect(api.updateStatus).toHaveBeenLastCalledWith(id, { restore: true }))
        expect(api.start).not.toHaveBeenCalled()
    })

    it('keeps ordinary task controls without the removed project grouping or project reads', async () => {
        const user = userEvent.setup()
        api.projects.mockRejectedValue(new Error('旧项目入口已停用'))
        api.updateStatus.mockResolvedValue({ ...task, task: { ...task.task, status: 'needs-input' } })
        render(<TaskWorkspace taskId={id} />)
        await screen.findByRole('button', { name: '任务目标' })
        expect(screen.queryByRole('region', { name: '任务项目归属' })).toBeNull()
        expect(api.projects).not.toHaveBeenCalled()
        expect(api.updateProject).not.toHaveBeenCalled()
        const state = screen.getByLabelText('任务工作状态') as HTMLSelectElement
        await user.selectOptions(state, 'needs-input')
        await waitFor(() => expect(api.updateStatus).toHaveBeenCalledExactlyOnceWith(id, { status: 'needs-input' }))
        await waitFor(() => expect(state.value).toBe('needs-input'))
        const goal = screen.getByRole('button', { name: '任务目标' })
        expect(goal.getAttribute('aria-expanded')).toBe('true')
        await user.click(goal)
        expect(goal.getAttribute('aria-expanded')).toBe('false')
        const agent = screen.getByRole('button', { name: '查看助手配置' })
        await user.click(agent)
        expect(agent.getAttribute('aria-expanded')).toBe('true')
        expect(await screen.findByText(task.agent.systemPrompt)).toBeTruthy()
        expect(api.start).not.toHaveBeenCalled()
        expect(api.message).not.toHaveBeenCalled()
    })

    it('shows a received Agent opening before collapsed task details and accepts a natural language upstream request', async () => {
        const user = userEvent.setup()
        const received: PersonalTask = {
            ...task,
            task: { ...task.task, started: true },
            messages: [
                {
                    id: 'opening',
                    kind: 'opening',
                    role: 'assistant',
                    status: 'complete',
                    content: '来自张三：请评估这个权限隔离方案。',
                    createdAt,
                },
            ],
        }
        api.getTask.mockResolvedValue(received)
        api.message.mockResolvedValue(undefined)
        render(<TaskWorkspace taskId={id} />)
        const opening = await screen.findByText('来自张三：请评估这个权限隔离方案。')
        const details = screen.getByRole('button', { name: '任务详情' })
        expect(details.getAttribute('aria-expanded')).toBe('false')
        expect(opening.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.queryByRole('button', { name: '开始执行' })).toBeNull()
        expect(api.start).not.toHaveBeenCalled()
        expect(api.message).not.toHaveBeenCalled()
        await user.type(screen.getByLabelText('补充消息'), '帮我问上游具体的复现步骤。')
        await user.click(screen.getByRole('button', { name: '发送补充消息' }))
        await waitFor(() =>
            expect(api.message).toHaveBeenCalledWith(
                id,
                '帮我问上游具体的复现步骤。',
                expect.any(String),
                expect.any(Function),
                expect.any(AbortSignal),
                undefined
            )
        )
        expect(api.start).not.toHaveBeenCalled()
        await user.click(details)
        expect(details.getAttribute('aria-expanded')).toBe('true')
        expect(screen.queryByRole('region', { name: '任务项目归属' })).toBeNull()
    })

    it('redirects a legacy received task straight to its ordinary Agent chat without running a model', async () => {
        api.source.mockResolvedValue({
            events: [],
            questions: [],
            artifacts: [],
            pendingDispatches: [],
            nextCursor: 0,
            hasMore: false,
            nodes: [{ id: requestId, canWork: true, upstreamNodeId: project.id, source: { kind: 'task', id } }],
        })
        render(<TaskWorkspace taskId={id} />)
        await waitFor(() => expect(api.replace).toHaveBeenCalledWith(`/?conversation=${id}`))
        expect(screen.queryByRole('button', { name: '任务详情' })).toBeNull()
        expect(api.start).not.toHaveBeenCalled()
        expect(api.message).not.toHaveBeenCalled()
    })

    it('shows an upstream send confirmation outside collapsed task details while using one saved-state reader', async () => {
        const user = userEvent.setup()
        api.getTask.mockResolvedValue({
            ...task,
            task: { ...task.task, started: true },
            messages: [
                { id: 'opening', kind: 'opening', role: 'assistant', status: 'complete', content: '来自张三的工作说明。', createdAt },
            ],
        })
        api.source.mockResolvedValue({
            events: [],
            nodes: [],
            questions: [],
            artifacts: [],
            nextCursor: 0,
            hasMore: false,
            sourceState: { revision: 1, updatedAt: createdAt },
            pendingDispatches: [
                {
                    id: requestId,
                    version: 1,
                    source: { kind: 'task', id },
                    kind: 'ask',
                    recipientId: task.agent.id,
                    recipientName: '张三',
                    content: '请补充出现白屏的复现步骤。',
                    status: 'pending',
                    createdAt,
                    updatedAt: createdAt,
                },
            ],
        })
        render(<TaskWorkspace taskId={id} />)
        const preview = await screen.findByRole('region', { name: '发送前确认：张三' })
        const details = screen.getByRole('button', { name: '任务详情' })
        expect(details.getAttribute('aria-expanded')).toBe('false')
        expect(preview.closest('[data-slot="collapsible-content"]')).toBeNull()
        expect(preview.compareDocumentPosition(screen.getByLabelText('补充消息')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.getByText('请补充出现白屏的复现步骤。')).toBeTruthy()
        expect(screen.queryByRole('heading', { name: '上下游协作' })).toBeNull()
        expect(api.source).toHaveBeenCalledTimes(2)
        await user.click(details)
        expect(screen.queryByRole('heading', { name: '上下游协作' })).toBeNull()
        expect(screen.getByRole('button', { name: '确认发送' })).toBeTruthy()
        expect(api.source).toHaveBeenCalledTimes(2)
        expect(api.collaborationCommand).not.toHaveBeenCalled()
        expect(api.start).not.toHaveBeenCalled()
        expect(api.message).not.toHaveBeenCalled()
    })

    it('stops the saved active request exactly once and retains a supplemental textarea draft', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<PersonalTask>()
        const running: PersonalTask = {
            ...task,
            activeRequestId: requestId,
            task: { ...task.task, started: true, status: 'in-progress' },
            messages: [
                { id: 'user', role: 'user', content: task.task.goal, status: 'complete', requestId, createdAt },
                { id: 'assistant', role: 'assistant', content: '已有部分结果', status: 'complete', requestId, createdAt },
            ],
        }
        api.getTask.mockResolvedValue(running)
        api.cancel.mockReturnValue(pending.promise)
        render(<TaskWorkspace taskId={id} />)
        const draft = (await screen.findByLabelText('补充消息')) as HTMLTextAreaElement
        await user.type(draft, '停止后继续保留的草稿')
        await user.dblClick(screen.getByRole('button', { name: '停止生成' }))
        expect(api.cancel).toHaveBeenCalledExactlyOnceWith(id, requestId)
        expect((screen.getByRole('button', { name: '正在停止' }) as HTMLButtonElement).disabled).toBe(true)
        expect((screen.getByLabelText('任务工作状态') as HTMLSelectElement).disabled).toBe(true)
        expect(screen.queryByLabelText('移动到项目')).toBeNull()
        const stopped: PersonalTask = {
            ...running,
            activeRequestId: undefined,
            messages: running.messages.map(message => (message.role === 'assistant' ? { ...message, status: 'cancelled' } : message)),
        }
        await act(async () => pending.resolve(stopped))
        expect(await screen.findByText('已停止生成，已生成的内容已保留。')).toBeTruthy()
        expect(draft.value).toBe('停止后继续保留的草稿')
        expect(sessionStorage.getItem(`orbit.task-draft.${id}`)).toBe(draft.value)
        expect(screen.getByText('已有部分结果')).toBeTruthy()
        expect(api.message).not.toHaveBeenCalled()
        expect(api.start).not.toHaveBeenCalled()
    })
})
