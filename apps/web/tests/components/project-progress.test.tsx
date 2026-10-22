// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CollaborationProject, CollaborationProjectProgress } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectProgressView, ProjectStartDialog, useProjectProgress } from '../../components/project-progress'
import { CollaborationRequestError } from '../../lib/collaboration-client'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn(), progress: vi.fn(), route: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.route }) }))
vi.mock('../../lib/collaboration-client', async () => ({
    ...(await vi.importActual<typeof import('../../lib/collaboration-client')>('../../lib/collaboration-client')),
    sendCollaborationCommand: api.send,
    getCollaborationProject: api.get,
    getCollaborationProjectProgress: api.progress,
}))

const ownerId = '17171717-1717-4717-8717-171717171717'
const memberId = '27272727-2727-4727-8727-272727272727'
const thirdId = '37373737-3737-4737-8737-373737373737'
const projectId = '47474747-4747-4747-8747-474747474747'
const now = '2026-10-20T01:00:00.000Z'
const project: CollaborationProject = {
    id: projectId,
    name: '三人协作',
    description: 'PRIVATE_PROJECT_DESCRIPTION',
    revision: 5,
    ownerId,
    members: [{ id: ownerId, name: '同名', role: 'owner', status: 'active' }],
    nodes: [],
    notes: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
}

/**
 * Creates stable distinct work IDs without randomizing visual assertions.
 * @param ordinal - Fixture identity.
 * @returns A valid UUID with a visible unique short identity.
 */
function id(ordinal: number): string {
    return `${String(ordinal).padStart(8, '0')}-1717-4717-8717-171717171717`
}

/**
 * Builds only safe progress fields without a private node, source, goal or question body.
 * @param ordinal - Exact fixture work identity.
 * @param fields - Public metadata overrides.
 * @returns A public progress node.
 */
function node(ordinal: number, fields: Partial<CollaborationProjectProgress['nodes'][number]> = {}) {
    return {
        id: id(ordinal),
        title: `工作${ordinal}`,
        ownerId,
        ownerName: '同名',
        upstreamNodeId: null,
        status: 'ready' as const,
        authorized: true,
        sourceAvailable: true,
        started: false,
        canContinue: true,
        ownHref: `/?conversation=${id(ordinal + 100)}`,
        createdAt: now,
        updatedAt: now,
        ...fields,
    }
}

/**
 * Wraps test-owned safe records in the actual endpoint projection.
 * @param nodes - Realistic public work metadata.
 * @param waits - Public pending dependency metadata.
 * @returns A complete safe project projection.
 */
function projection(nodes = [node(1)], waits: CollaborationProjectProgress['waits'] = []): CollaborationProjectProgress {
    return { projectId, revision: 5, updatedAt: now, nodes, waits }
}

/**
 * Exercises the real polling hook through its real progress view.
 * @param props - Current project identity.
 * @returns Actual hook-driven content, error feedback and refresh action.
 */
function LiveProgress({ projectId: current }: { projectId: string }) {
    return <ProjectProgressView progress={useProjectProgress(current)} userId={ownerId} />
}

beforeEach(() => {
    installAcceptanceBrowser(390)
    for (const mock of Object.values(api)) mock.mockReset()
    api.get.mockResolvedValue({ ...project, revision: 6 })
    api.progress.mockResolvedValue(projection())
    api.send.mockImplementation(async command => ({ requestId: command.requestId, projectId, conversationId: id(500) }))
})
afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('independent project work and progress interactions', () => {
    it('preserves every exact same-name work and separates terminal or revoked history without another person’s chat link', async () => {
        const user = userEvent.setup()
        const data = projection([
            node(1, { title: '同名工作' }),
            node(2, { title: '同名工作' }),
            node(3, { status: 'completed', canContinue: false }),
            node(4, { status: 'cancelled', canContinue: false }),
            node(5, { authorized: false, canContinue: false }),
            node(6, { ownerId: memberId, ownHref: `/?conversation=${id(106)}` }),
        ])
        render(<ProjectProgressView progress={{ data, error: '', refresh: vi.fn() }} userId={ownerId} />)
        const own = screen.getByRole('region', { name: '我的工作' })
        expect(
            within(own)
                .getAllByRole('link', { name: '继续我的聊天' })
                .map(link => link.getAttribute('href'))
        ).toEqual([`/?conversation=${id(101)}`, `/?conversation=${id(102)}`])
        await user.click(within(own).getByRole('button', { name: '已结束的工作（3）' }))
        expect(
            within(own)
                .getAllByRole('link', { name: '查看我的聊天' })
                .map(link => link.getAttribute('href'))
        ).toEqual([`/?conversation=${id(103)}`, `/?conversation=${id(104)}`, `/?conversation=${id(105)}`])
        expect(within(own).getByText('授权已撤销')).toBeTruthy()
        expect(screen.queryByRole('link', { name: /work6/ })).toBeNull()
        expect(document.querySelector(`a[href="/?conversation=${id(106)}"]`)).toBeNull()
    })

    it('lists each actual waiting target, direction and request separately and filters by the real target owner', async () => {
        const user = userEvent.setup()
        const data = projection(
            [
                node(1),
                node(2, { ownerId: memberId, ownerName: '李四', upstreamNodeId: id(1), canContinue: false }),
                node(3, { ownerId: thirdId, ownerName: '王五', upstreamNodeId: id(2), canContinue: false }),
            ],
            [
                { id: id(11), version: 1, fromNodeId: id(1), targetNodeId: id(2), kind: 'downstream', createdAt: now, updatedAt: now },
                { id: id(12), version: 1, fromNodeId: id(2), targetNodeId: id(1), kind: 'upstream', createdAt: now, updatedAt: now },
                { id: id(13), version: 1, fromNodeId: id(1), targetNodeId: id(1), kind: 'self', createdAt: now, updatedAt: now },
                { id: id(14), version: 1, fromNodeId: id(2), targetNodeId: id(3), kind: 'downstream', createdAt: now, updatedAt: now },
            ]
        )
        const { rerender } = render(<ProjectProgressView progress={{ data, error: '', refresh: vi.fn() }} userId={ownerId} />)
        const pending = screen.getByRole('region', { name: '待处理' })
        expect(within(pending).getByText(/4 项协作请求/)).toBeTruthy()
        expect(within(pending).getByText('李四正在等待同名补充信息')).toBeTruthy()
        expect(within(pending).getByText('等待同名本人判断')).toBeTruthy()
        expect(within(pending).getAllByRole('link', { name: '去我的聊天处理' })).toHaveLength(2)
        await user.click(within(pending).getByRole('radio', { name: '我在等待' }))
        expect(within(pending).getByText('同名正在等待李四处理协作请求')).toBeTruthy()
        expect(within(pending).getAllByRole('link', { name: '查看我的聊天' })).toHaveLength(1)
        await user.click(within(pending).getByRole('radio', { name: '其他协作' }))
        expect(within(pending).getByText('李四正在等待王五处理协作请求')).toBeTruthy()
        expect(within(pending).queryByRole('link')).toBeNull()
        rerender(<ProjectProgressView progress={{ data: { ...data, waits: [] }, error: '', refresh: vi.fn() }} userId={ownerId} />)
        expect(within(pending).getByText('当前没有待处理的协作请求。')).toBeTruthy()
        expect(screen.queryByText('项目已完成')).toBeNull()
    })

    it('renders roots, branches, missing parents and historical loops once in finite responsibility groups', () => {
        const data = projection([
            node(1),
            node(2, { upstreamNodeId: id(1) }),
            node(3, { upstreamNodeId: id(1) }),
            node(4),
            node(5, { upstreamNodeId: id(999) }),
            node(6, { upstreamNodeId: id(7) }),
            node(7, { upstreamNodeId: id(6) }),
        ])
        render(<ProjectProgressView progress={{ data, error: '', refresh: vi.fn() }} userId={thirdId} />)
        const first = screen.getByRole('region', { name: '责任链 1' })
        expect(
            within(first)
                .getAllByRole('heading', { level: 4 })
                .map(heading => heading.textContent)
        ).toEqual(['责任链 1', '工作1', '工作2', '工作3'])
        expect(screen.getByRole('region', { name: '责任链 2' })).toBeTruthy()
        const unresolved = screen.getByRole('region', { name: '关系待整理' })
        expect(
            within(unresolved)
                .getAllByRole('heading', { level: 4 })
                .map(heading => heading.textContent)
        ).toEqual(['关系待整理', '工作5', '工作6', '工作7'])
        expect(screen.getByText('原上游当前不可用')).toBeTruthy()
        expect(screen.getAllByText(/^负责人：/)).toHaveLength(7)
        expect(api.send).not.toHaveBeenCalled()
    })

    it('keeps private goals blank, focuses invalid fields, preserves failed creation identity and suppresses double submits', async () => {
        const user = userEvent.setup()
        const saving = acceptanceDeferred<{ requestId: string; conversationId: string }>()
        api.send.mockReturnValueOnce(saving.promise)
        const close = vi.fn()
        render(
            <ProjectStartDialog
                project={project}
                progress={projection([node(1), node(2, { title: '工作1' })])}
                userId={ownerId}
                onClose={close}
                onSaved={vi.fn()}
            />
        )
        const dialog = screen.getByRole('dialog', { name: '开始我的工作' })
        const title = within(dialog).getByLabelText('工作名称') as HTMLInputElement
        const goal = within(dialog).getByLabelText('工作目标') as HTMLTextAreaElement
        expect(title.value).toBe('')
        expect(goal.value).toBe('')
        expect(within(dialog).getAllByRole('link', { name: '继续我的聊天' })).toHaveLength(2)
        await user.click(within(dialog).getByRole('button', { name: '创建并进入聊天' }))
        expect(document.activeElement).toBe(title)
        fireEvent.change(title, { target: { value: '名'.repeat(121) } })
        await user.click(within(dialog).getByRole('button', { name: '创建并进入聊天' }))
        expect(api.send).not.toHaveBeenCalled()
        fireEvent.change(title, { target: { value: '名'.repeat(120) } })
        await user.click(within(dialog).getByRole('button', { name: '创建并进入聊天' }))
        expect(document.activeElement).toBe(goal)
        fireEvent.change(goal, { target: { value: '目'.repeat(32001) } })
        await user.click(within(dialog).getByRole('button', { name: '创建并进入聊天' }))
        expect(api.send).not.toHaveBeenCalled()
        fireEvent.change(goal, { target: { value: '目'.repeat(32000) } })
        await user.dblClick(within(dialog).getByRole('button', { name: '创建并进入聊天' }))
        expect(api.send).toHaveBeenCalledTimes(1)
        expect(close).not.toHaveBeenCalled()
        await act(async () => saving.reject(new Error('创建响应丢失')))
        expect(await within(dialog).findByText('创建响应丢失')).toBeTruthy()
        expect(goal.value).toHaveLength(32000)
        const original = api.send.mock.calls[0]![0]
        await user.click(within(dialog).getByRole('button', { name: '创建并进入聊天' }))
        await waitFor(() => expect(api.route).toHaveBeenCalledWith(`/?conversation=${id(500)}`))
        expect(api.send.mock.calls[1]![0]).toEqual(original)
        expect(original).toMatchObject({ type: 'project-start', projectId, revision: 5 })
        expect(original).not.toHaveProperty('ownerId')
    })

    it('requires an explicit project reread after conflict while retaining unsaved goal before a new human submit', async () => {
        const user = userEvent.setup()
        api.send.mockRejectedValueOnce(new CollaborationRequestError('项目版本已变化', 409))
        render(<ProjectStartDialog project={project} progress={null} userId={ownerId} onClose={vi.fn()} onSaved={vi.fn()} />)
        fireEvent.change(screen.getByLabelText('工作名称'), { target: { value: '同名新工作' } })
        fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '不能丢失的本人目标' } })
        await user.click(screen.getByRole('button', { name: '创建并进入聊天' }))
        await screen.findByText('项目版本已变化')
        expect((screen.getByRole('button', { name: '创建并进入聊天' }) as HTMLButtonElement).disabled).toBe(true)
        expect(api.get).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '重新读取项目，保留本地输入' }))
        expect(await screen.findByText(/已读取最新项目/)).toBeTruthy()
        expect((screen.getByLabelText('工作目标') as HTMLTextAreaElement).value).toBe('不能丢失的本人目标')
        expect(api.send).toHaveBeenCalledTimes(1)
        await user.click(screen.getByRole('button', { name: '创建并进入聊天' }))
        await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2))
        expect(api.send.mock.calls[1]![0]).toMatchObject({ revision: 6 })
        expect(api.send.mock.calls[1]![0].requestId).not.toBe(api.send.mock.calls[0]![0].requestId)
    })

    it('ignores obsolete in-flight project reads and shows an honest failed-refresh warning', async () => {
        const stale = acceptanceDeferred<CollaborationProjectProgress>()
        api.progress.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(projection([node(2)]))
        const { rerender } = render(<LiveProgress projectId="old-project" />)
        rerender(<LiveProgress projectId={projectId} />)
        await waitFor(() => expect(screen.getAllByText('工作2').length).toBeGreaterThan(0))
        await act(async () => stale.resolve({ ...projection([node(99)]), projectId: 'old-project' }))
        expect(screen.queryByText('工作99')).toBeNull()
        const refresh = vi.fn()
        rerender(<ProjectProgressView progress={{ data: projection([node(2)]), error: '暂时无法刷新', refresh }} userId={ownerId} />)
        expect(screen.getByText('未能刷新，以下仅为上次成功读取的进度。')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: '重新读取协作进度' }))
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('clears stale safe data after a real polling authorization rejection', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        api.progress
            .mockResolvedValueOnce(projection([node(1)]))
            .mockRejectedValueOnce(new CollaborationRequestError('项目权限已失效', 403))
        render(<LiveProgress projectId={projectId} />)
        await act(async () => {
            await Promise.resolve()
        })
        expect(screen.getAllByText('工作1')).toHaveLength(2)
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000)
        })
        expect(screen.getByText('项目权限已失效')).toBeTruthy()
        expect(screen.queryByText('工作1')).toBeNull()
        expect(screen.queryByText('当前没有待处理的协作请求。')).toBeNull()
    })
})
