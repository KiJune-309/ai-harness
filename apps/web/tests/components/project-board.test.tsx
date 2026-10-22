// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CollaborationProject, CollaborationProjectProgress } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectBoardView } from '../../components/project-board'
import { useProjectProgress } from '../../components/project-progress'
import { TeamProjectOverview } from '../../components/team-project'
import { CollaborationRequestError } from '../../lib/collaboration-client'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    progress: vi.fn(),
    send: vi.fn(),
    read: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    saved: vi.fn(),
    query: 'view=board',
    scope: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, workspaceId: 'scope-a' },
}))
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: api.push, replace: api.replace }),
    useSearchParams: () => new URLSearchParams(api.query),
}))
vi.mock('../../components/account-context', () => ({ useAccount: () => api.scope }))
vi.mock('../../lib/collaboration-client', async () => ({
    ...(await vi.importActual<typeof import('../../lib/collaboration-client')>('../../lib/collaboration-client')),
    getCollaborationProjectProgress: api.progress,
    sendCollaborationCommand: api.send,
    getCollaborationProject: api.read,
}))
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const now = '2026-10-20T00:00:00.000Z'

/**
 * Generates deterministic identities for complete pagination and exact-source assertions.
 * @param index - Stable fixture sequence.
 * @returns A canonical UUID.
 */
function id(index: number): string {
    return `${String(index).padStart(8, '0')}-2020-4020-8020-202020202020`
}

/**
 * Builds a safe complete node without private source data.
 * @param index - Stable identity.
 * @param changes - Explicit public metadata variations.
 * @returns Complete progress work metadata.
 */
function node(
    index: number,
    changes: Partial<CollaborationProjectProgress['nodes'][number]> = {}
): CollaborationProjectProgress['nodes'][number] {
    return {
        id: id(index),
        title: `工作${index}`,
        ownerId: owner,
        ownerName: '同名负责人',
        upstreamNodeId: null,
        status: 'ready',
        authorized: true,
        sourceAvailable: true,
        started: true,
        canContinue: true,
        ownHref: `/?conversation=${id(index + 1000)}`,
        createdAt: now,
        updatedAt: now,
        ...changes,
    }
}

/**
 * Builds one untruncated project snapshot from safe fixture metadata.
 * @param nodes - Entire collection.
 * @param waits - Actual same-project relationships.
 * @param projectId - Optional route scope.
 * @returns Complete progress.
 */
function projection(
    nodes: CollaborationProjectProgress['nodes'],
    waits: CollaborationProjectProgress['waits'] = [],
    projectId = id(900)
): CollaborationProjectProgress {
    return { projectId, revision: 1, updatedAt: now, nodes, waits }
}

/**
 * Connects the actual serialized reader and board without replacing either implementation.
 * @param props - Current exact project scope.
 * @returns Board state and an independent refresh trigger to exercise the reader's coalescing contract.
 */
function LiveBoard({ projectId = id(900) }: { projectId?: string }) {
    const progress = useProjectProgress(projectId)
    return (
        <>
            <button onClick={progress.refresh}>直接重读</button>
            <ProjectBoardView progress={progress} userId={owner} onStart={api.send} onRefresh={progress.refresh} />
        </>
    )
}

/**
 * Builds shared metadata required by the actual parent tabs and common sections.
 * @param projectId - Stable current project.
 * @returns An authorized project independent of private work metadata.
 */
function project(projectId = id(900)): CollaborationProject {
    return {
        id: projectId,
        name: '实际父级项目',
        description: '共享说明',
        revision: 1,
        ownerId: owner,
        members: [{ id: owner, name: '本人', role: 'owner', status: 'active' }],
        nodes: [],
        notes: [],
        artifacts: [],
        createdAt: now,
        updatedAt: now,
    }
}

beforeEach(() => {
    vi.resetAllMocks()
    installAcceptanceBrowser()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    api.query = 'view=board'
    api.scope = { user: { id: owner }, workspaceId: 'scope-a' }
    api.progress.mockImplementation(async (projectId: string) => projection([node(1)], [], projectId))
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe('independent complete project board components and reader', () => {
    it('shows twenty then forty then all forty-one and filters the complete set before resetting visual limits', async () => {
        const user = userEvent.setup()
        const data = projection(Array.from({ length: 41 }, (_, index) => node(index + 1)))
        render(<ProjectBoardView progress={{ data, error: '', refresh: vi.fn() }} userId={owner} onStart={api.send} onRefresh={api.read} />)
        const list = screen.getByRole('list', { name: '可继续工作' })
        expect(within(list).getAllByRole('listitem')).toHaveLength(20)
        expect(screen.getByText('当前获授权项目进度 · 全部 41 项工作')).toBeTruthy()
        const scrollRegion = screen.getByRole('region', { name: '可继续工作列表' })
        expect(scrollRegion.getAttribute('tabindex')).toBe('0')
        expect(screen.getByRole('navigation', { name: '跳到看板状态组' })).toBeTruthy()
        await user.click(screen.getByRole('button', { name: '再显示20项（剩余21项）' }))
        expect(within(list).getAllByRole('listitem')).toHaveLength(40)
        await user.click(screen.getByRole('button', { name: '再显示20项（剩余1项）' }))
        expect(within(list).getAllByRole('listitem')).toHaveLength(41)
        fireEvent.change(screen.getByRole('searchbox', { name: '搜索工作' }), { target: { value: '工作41' } })
        expect(screen.getByText('当前匹配 1 项')).toBeTruthy()
        expect(within(screen.getByRole('list', { name: '可继续工作' })).getAllByRole('listitem')).toHaveLength(1)
        await user.click(screen.getByRole('button', { name: '清除筛选' }))
        expect(within(screen.getByRole('list', { name: '可继续工作' })).getAllByRole('listitem')).toHaveLength(20)
        expect(api.send).not.toHaveBeenCalled()
        expect(api.read).not.toHaveBeenCalled()
    })

    it('expands every real direction once and uses only the actual target owner for pending filters', async () => {
        const user = userEvent.setup()
        const a = node(1, { status: 'running' }),
            b = node(2, { ownerId: other, upstreamNodeId: id(1), status: 'failed' }),
            c = node(3, { ownerId: other, upstreamNodeId: id(1) })
        const pairs = [
            [a, b, 'downstream'],
            [b, a, 'upstream'],
            [a, c, 'downstream'],
            [a, a, 'self'],
            [c, a, 'upstream'],
        ] as const
        const waits = pairs.map(([from, target, kind], index) => ({
            id: id(index + 100),
            version: 1,
            fromNodeId: from.id,
            targetNodeId: target.id,
            kind,
            createdAt: now,
            updatedAt: now,
        }))
        render(
            <ProjectBoardView
                progress={{ data: projection([a, b, c], waits), error: '', refresh: vi.fn() }}
                userId={owner}
                onStart={api.send}
                onRefresh={api.read}
            />
        )
        const running = screen.getByRole('region', { name: '执行中' })
        expect(within(running).getByText('5 项关联请求 · 入站 2 · 出站 2 · 本人判断 1')).toBeTruthy()
        expect(within(running).getAllByRole('region', { name: '关联协作请求' })[0]!.querySelectorAll('li')).toHaveLength(3)
        await user.click(within(running).getByRole('button', { name: '展开其余 2 项' }))
        expect(within(running).getByRole('region', { name: '关联协作请求' }).querySelectorAll('li')).toHaveLength(5)
        await user.click(screen.getByRole('checkbox', { name: '仅看待我处理' }))
        expect(screen.getByText('当前匹配 1 项')).toBeTruthy()
        await user.selectOptions(screen.getByRole('combobox', { name: '负责人' }), other)
        expect(screen.getByText('没有符合当前筛选的工作。')).toBeTruthy()
        expect(screen.getByText('当前获授权项目进度 · 全部 3 项工作')).toBeTruthy()
        expect(api.send).not.toHaveBeenCalled()
    })

    it('offers only exact own history/repair links and keeps loading failure empty and no-match states distinct', async () => {
        const data = projection([
            node(1),
            node(2, { ownerId: other }),
            node(3, { status: 'failed' }),
            node(4, { status: 'cancelled', canContinue: false }),
            node(5, { sourceAvailable: false, started: null }),
        ])
        const { rerender } = render(
            <ProjectBoardView
                progress={{ data, error: '', refresh: vi.fn(), readAt: now }}
                userId={owner}
                onStart={api.send}
                onRefresh={api.read}
            />
        )
        expect(screen.getByRole('link', { name: '继续我的聊天' }).getAttribute('href')).toBe(`/?conversation=${id(1001)}`)
        expect(screen.getByRole('link', { name: '查看我的聊天' }).getAttribute('href')).toBe(`/?conversation=${id(1004)}`)
        expect(screen.getByRole('link', { name: '查看失败与修复' }).getAttribute('href')).toBe(`/projects/${id(900)}?node=${id(3)}`)
        expect(document.querySelector(`a[href="/?conversation=${id(1002)}"]`)).toBeNull()
        expect(document.querySelector(`a[href="/?conversation=${id(1005)}"]`)).toBeNull()
        rerender(
            <ProjectBoardView
                progress={{ data: null, error: '', refresh: vi.fn() }}
                userId={owner}
                onStart={api.send}
                onRefresh={api.read}
            />
        )
        expect(screen.getByRole('status').textContent).toContain('正在读取')
        expect(screen.queryByText('还没有协作工作')).toBeNull()
        rerender(
            <ProjectBoardView
                progress={{ data: null, error: '真实503失败', refresh: vi.fn() }}
                userId={owner}
                onStart={api.send}
                onRefresh={api.read}
            />
        )
        expect(screen.getByText('真实503失败')).toBeTruthy()
        expect(screen.queryByText('还没有协作工作')).toBeNull()
        rerender(
            <ProjectBoardView
                progress={{ data: projection([]), error: '', refresh: vi.fn() }}
                userId={owner}
                onStart={api.send}
                onRefresh={api.read}
            />
        )
        expect(screen.getByText('还没有协作工作')).toBeTruthy()
    })

    it('coalesces a burst of refreshes into one follow-up without aborting or overlapping a slow current read', async () => {
        const first = acceptanceDeferred<CollaborationProjectProgress>(),
            second = acceptanceDeferred<CollaborationProjectProgress>()
        api.progress.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
        render(<LiveBoard />)
        expect(api.progress).toHaveBeenCalledTimes(1)
        for (let index = 0; index < 6; index++) fireEvent.click(screen.getByRole('button', { name: '直接重读' }))
        expect(api.progress).toHaveBeenCalledTimes(1)
        expect(api.progress.mock.calls[0]![1].aborted).toBe(false)
        await act(async () => first.resolve(projection([node(1)])))
        await waitFor(() => expect(api.progress).toHaveBeenCalledTimes(2))
        await act(async () => second.resolve(projection([node(2)])))
        expect(api.progress).toHaveBeenCalledTimes(2)
        expect(screen.getByRole('link', { name: '继续我的聊天' }).getAttribute('href')).toBe(`/?conversation=${id(1002)}`)
    })

    it.each([401, 403, 404])(
        'retains the last confirmed snapshot and timestamp for 503 but clears links for %i and permits a fresh retry',
        async status => {
            api.progress
                .mockReset()
                .mockResolvedValueOnce(projection([node(1)]))
                .mockRejectedValueOnce(new CollaborationRequestError('暂时不可用', 503))
                .mockRejectedValueOnce(new CollaborationRequestError('当前已失权', status))
                .mockResolvedValueOnce(projection([node(2)]))
            render(<LiveBoard />)
            await screen.findByRole('link', { name: '继续我的聊天' })
            const previous = document.querySelector('time')?.dateTime
            fireEvent.click(screen.getByRole('button', { name: '直接重读' }))
            expect(await screen.findByText('刷新失败，当前仅上次成功读取的数据。')).toBeTruthy()
            expect(screen.getByRole('link', { name: '继续我的聊天' })).toBeTruthy()
            expect(document.querySelector('time')?.dateTime).toBe(previous)
            fireEvent.click(screen.getByRole('button', { name: '直接重读' }))
            await screen.findByText('当前已失权')
            expect(screen.queryByRole('link', { name: '继续我的聊天' })).toBeNull()
            expect(document.querySelector('time')).toBeNull()
            fireEvent.click(screen.getByRole('button', { name: '直接重读' }))
            await waitFor(() =>
                expect(screen.getByRole('link', { name: '继续我的聊天' }).getAttribute('href')).toBe(`/?conversation=${id(1002)}`)
            )
        }
    )

    it('does not resurrect an old A snapshot across A-B-A and ignores obsolete delayed responses', async () => {
        const b = acceptanceDeferred<CollaborationProjectProgress>(),
            nextA = acceptanceDeferred<CollaborationProjectProgress>()
        api.progress
            .mockReset()
            .mockResolvedValueOnce(projection([node(1)]))
            .mockReturnValueOnce(b.promise)
            .mockReturnValueOnce(nextA.promise)
        const { rerender } = render(<LiveBoard projectId={id(900)} />)
        await screen.findByRole('link', { name: '继续我的聊天' })
        rerender(<LiveBoard projectId={id(901)} />)
        expect(screen.queryByRole('link', { name: '继续我的聊天' })).toBeNull()
        rerender(<LiveBoard projectId={id(900)} />)
        expect(screen.queryByRole('link', { name: '继续我的聊天' })).toBeNull()
        await act(async () => b.resolve(projection([node(2)], [], id(901))))
        expect(screen.queryByRole('link', { name: '继续我的聊天' })).toBeNull()
        await act(async () => nextA.resolve(projection([node(3)])))
        expect(screen.getByRole('link', { name: '继续我的聊天' }).getAttribute('href')).toBe(`/?conversation=${id(1003)}`)
        expect(api.progress.mock.calls[1]![1].aborted).toBe(true)
    })

    it('pauses hidden polling and resumes a single visible read on the next schedule', async () => {
        vi.useFakeTimers()
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        render(<LiveBoard />)
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9000)
        })
        expect(api.progress).not.toHaveBeenCalled()
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000)
        })
        expect(api.progress).toHaveBeenCalledTimes(1)
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9000)
        })
        expect(api.progress).toHaveBeenCalledTimes(1)
    })

    it('keeps one parent reader and common members across shared tabs, retains filters there and clears them on scope changes', async () => {
        const user = userEvent.setup()
        const data = project()
        const { rerender } = render(<TeamProjectOverview project={data} onSaved={api.saved} />)
        await screen.findByRole('heading', { name: '项目看板' })
        await screen.findByRole('link', { name: '继续我的聊天' })
        expect(api.progress).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('heading', { name: '项目成员' })).toBeTruthy()
        fireEvent.change(screen.getByRole('searchbox', { name: '搜索工作' }), { target: { value: '本地筛选' } })
        await user.click(screen.getByRole('tab', { name: '概览' }))
        expect(api.replace).toHaveBeenCalledWith(`/projects/${data.id}`, { scroll: false })
        api.query = ''
        rerender(<TeamProjectOverview project={data} onSaved={api.saved} />)
        await user.click(screen.getByRole('tab', { name: '看板' }))
        expect(api.replace).toHaveBeenCalledWith(`/projects/${data.id}?view=board`, { scroll: false })
        api.query = 'view=board'
        rerender(<TeamProjectOverview project={data} onSaved={api.saved} />)
        expect((screen.getByRole('searchbox', { name: '搜索工作' }) as HTMLInputElement).value).toBe('本地筛选')
        expect(api.progress).toHaveBeenCalledTimes(1)
        api.scope = { user: { id: owner }, workspaceId: 'scope-b' }
        rerender(<TeamProjectOverview project={data} onSaved={api.saved} />)
        await screen.findByRole('link', { name: '继续我的聊天' })
        expect((screen.getByRole('searchbox', { name: '搜索工作' }) as HTMLInputElement).value).toBe('')
        expect(api.progress).toHaveBeenCalledTimes(2)
        expect(api.send).not.toHaveBeenCalled()
    })
})
