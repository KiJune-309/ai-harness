// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CollaborationCommand, CollaborationProject, PersonalProject } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectWorkspace } from '../../components/project-workspace'
import { TeamProjectOverview } from '../../components/team-project'
import { CollaborationRequestError } from '../../lib/collaboration-client'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    status: vi.fn(),
    shared: vi.fn(),
    sharedGet: vi.fn(),
    progress: vi.fn(),
    send: vi.fn(),
    search: vi.fn(),
    route: vi.fn(),
    tasks: vi.fn(),
    agents: vi.fn(),
    node: vi.fn(),
    userId: '16161616-1616-4616-8616-161616161616',
}))
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: api.route, replace: api.route }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/projects',
}))
vi.mock('../../components/account-context', () => ({ useAccount: () => ({ user: { id: api.userId, username: '项目拥有者' } }) }))
vi.mock('../../lib/project-client', () => ({
    listProjects: api.list,
    getProject: api.get,
    createProject: api.create,
    updateProject: api.update,
}))
vi.mock('../../lib/chat-client', async () => ({
    ...(await vi.importActual<typeof import('../../lib/chat-client')>('../../lib/chat-client')),
    getChatStatus: api.status,
}))
vi.mock('../../lib/task-client', async () => ({
    ...(await vi.importActual<typeof import('../../lib/task-client')>('../../lib/task-client')),
    listTasks: api.tasks,
}))
vi.mock('../../lib/agent-client', async () => ({
    ...(await vi.importActual<typeof import('../../lib/agent-client')>('../../lib/agent-client')),
    listAgents: api.agents,
}))
vi.mock('../../lib/collaboration-client', async () => ({
    ...(await vi.importActual<typeof import('../../lib/collaboration-client')>('../../lib/collaboration-client')),
    listCollaborationProjects: api.shared,
    getCollaborationProject: api.sharedGet,
    getCollaborationProjectProgress: api.progress,
    sendCollaborationCommand: api.send,
    searchCollaborationPeople: api.search,
    getCollaborationNode: api.node,
}))

const ownerId = '16161616-1616-4616-8616-161616161616'
const memberId = '26262626-2626-4626-8626-262626262626'
const candidateId = '36363636-3636-4636-8636-363636363636'
const sharedId = '46464646-4646-4646-8646-464646464646'
const now = '2026-10-20T01:00:00.000Z'
const shared: CollaborationProject = {
    id: sharedId,
    name: '共享项目权威名称',
    description: '完整说明\n第二行共享目标',
    ownerId,
    revision: 3,
    members: [
        { id: ownerId, name: '项目拥有者', role: 'owner', status: 'active' },
        { id: memberId, name: '真实成员', role: 'member', status: 'active' },
    ],
    nodes: [],
    artifacts: [],
    notes: [],
    createdAt: now,
    updatedAt: '2026-10-20T02:00:00.000Z',
}
const privateProject: PersonalProject = {
    id: '56565656-5656-4656-8656-565656565656',
    name: '仅自己研究',
    description: '本人私有说明',
    createdAt: now,
    updatedAt: '2026-10-20T03:00:00.000Z',
}

beforeEach(() => {
    installAcceptanceBrowser(390)
    for (const mock of Object.values(api)) if (typeof mock !== 'string') mock.mockReset()
    api.userId = ownerId
    api.list.mockResolvedValue([
        privateProject,
        { ...privateProject, id: sharedId, name: '过时个人壳不得显示', updatedAt: '2026-10-20T05:00:00.000Z' },
    ])
    api.shared.mockResolvedValue([
        shared,
        {
            ...shared,
            id: '66666666-6666-4666-8666-666666666666',
            name: '他人创建的协作事项',
            description: '他人事项说明',
            ownerId: memberId,
            updatedAt: now,
        },
    ])
    api.status.mockResolvedValue({ configured: true, model: 'system-fixture', storage: 'postgres' })
    api.tasks.mockResolvedValue([])
    api.agents.mockResolvedValue([])
    api.sharedGet.mockResolvedValue(shared)
    api.progress.mockResolvedValue({ projectId: sharedId, revision: shared.revision, updatedAt: now, nodes: [], waits: [] })
    api.search.mockResolvedValue([{ id: candidateId, name: '新同事' }])
    api.send.mockImplementation(async (command: CollaborationCommand) => ({ requestId: command.requestId, projectId: sharedId }))
})
afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent real team project component interactions', () => {
    it('keeps legacy artifact versions visibly separate from project notes and never grants owners another author’s edit button', async () => {
        const user = userEvent.setup()
        const artifact = {
            id: 'b6b6b6b6-b6b6-46b6-86b6-b6b6b6b6b6b6',
            projectId: sharedId,
            nodeId: 'c6c6c6c6-c6c6-46c6-86c6-c6c6c6c6c6c6',
            title: '旧成果第一版',
            content: '保留的旧成果正文v1',
            version: 1,
            authorId: memberId,
            createdAt: now,
        }
        const note = {
            id: 'd6d6d6d6-d6d6-46d6-86d6-d6d6d6d6d6d6',
            projectId: sharedId,
            title: '成员项目资料',
            content: '成员人工共享正文',
            version: 1,
            authorId: memberId,
            authorName: '真实成员',
            createdAt: now,
            updatedAt: now,
        }
        render(
            <TeamProjectOverview
                project={{
                    ...shared,
                    notes: [note],
                    artifacts: [artifact, { ...artifact, title: '旧成果最新版', content: '保存的旧成果正文v2', version: 2 }],
                }}
                onSaved={vi.fn()}
            />
        )
        expect(screen.getByRole('heading', { name: '项目资料' })).toBeTruthy()
        expect(screen.getByRole('heading', { name: '已发布成果' })).toBeTruthy()
        expect(screen.getByText('成员人工共享正文')).toBeTruthy()
        expect(screen.getByText('保存的旧成果正文v2')).toBeTruthy()
        expect(screen.queryByRole('button', { name: '更新资料' })).toBeNull()
        await user.click(screen.getByRole('button', { name: '查看成果历史版本' }))
        expect(await screen.findByText('保留的旧成果正文v1')).toBeTruthy()
    })

    it('uses one sorted collection with authoritative shared deduplication, stable counts, search and type filters', async () => {
        const user = userEvent.setup()
        render(<ProjectWorkspace />)
        const grid = await screen.findByLabelText('项目列表')
        expect(
            within(grid)
                .getAllByRole('heading', { level: 2 })
                .map(heading => heading.textContent)
        ).toEqual(['仅自己研究', shared.name, '他人创建的协作事项'])
        expect(screen.queryByText('过时个人壳不得显示')).toBeNull()
        expect(screen.getByText('3 个项目')).toBeTruthy()
        await user.type(screen.getByRole('searchbox'), '第二行共享目标')
        expect(within(screen.getByLabelText('项目列表')).getAllByRole('heading', { level: 2 })).toHaveLength(1)
        expect(screen.getByText('3 个项目')).toBeTruthy()
        await user.clear(screen.getByRole('searchbox'))
        await user.click(screen.getByRole('radio', { name: '协作' }))
        expect(within(screen.getByLabelText('项目列表')).getAllByRole('heading', { level: 2 })).toHaveLength(2)
        await user.click(screen.getByRole('radio', { name: '仅自己' }))
        expect(within(screen.getByLabelText('项目列表')).getByRole('heading', { level: 2 }).textContent).toBe(privateProject.name)
    })

    it('does not describe a shared read failure as a complete private list or empty project collection', async () => {
        const user = userEvent.setup()
        api.shared.mockRejectedValueOnce(new Error('共享集合暂时不可用'))
        render(<ProjectWorkspace />)
        expect(await screen.findByText('共享集合暂时不可用')).toBeTruthy()
        expect(screen.getByText('项目数量暂不可用')).toBeTruthy()
        expect(screen.queryByLabelText('项目列表')).toBeNull()
        expect(screen.queryByText('为长期主题建一个项目')).toBeNull()
        await user.click(screen.getByRole('button', { name: '重新载入项目' }))
        expect(await screen.findByLabelText('项目列表')).toBeTruthy()
        expect(screen.getByText('3 个项目')).toBeTruthy()
    })

    it('defaults creation to private and previews actual members and all shared text while retaining failed action identity', async () => {
        const user = userEvent.setup()
        const saving = acceptanceDeferred<{ requestId: string; projectId: string }>()
        api.send.mockReturnValueOnce(saving.promise)
        render(<ProjectWorkspace />)
        await screen.findByLabelText('项目列表')
        await user.click(screen.getByRole('button', { name: '新建项目' }))
        const dialog = await screen.findByRole('dialog', { name: '新建项目' })
        expect(within(dialog).getByRole('radio', { name: '仅自己' }).getAttribute('aria-checked')).toBe('true')
        await user.type(within(dialog).getByLabelText(/^项目名称/), '协作新事项')
        await user.type(within(dialog).getByLabelText(/项目说明/), '完整共享说明\n保留换行')
        await user.click(within(dialog).getByRole('radio', { name: '指定成员协作' }))
        expect(within(dialog).getByText('当前仅你可见，可稍后添加成员。', { exact: false })).toBeTruthy()
        await user.type(within(dialog).getByLabelText('搜索当前工作空间的同事'), '新同事')
        await user.click(await within(dialog).findByRole('button', { name: new RegExp(`新同事.*${candidateId.slice(0, 8)}`) }))
        expect(within(dialog).getByText(/这些成员可看项目说明/)).toBeTruthy()
        expect(within(dialog).getByLabelText('协作项目完整预览').textContent).toContain('完整共享说明\n保留换行')
        await user.dblClick(within(dialog).getByRole('button', { name: '创建协作项目' }))
        expect(api.send).toHaveBeenCalledTimes(1)
        expect(api.create).not.toHaveBeenCalled()
        expect(api.route).not.toHaveBeenCalled()
        await act(async () => saving.reject(new Error('保存响应未完成')))
        expect(await within(dialog).findByText('保存响应未完成')).toBeTruthy()
        expect((within(dialog).getByLabelText(/^项目名称/) as HTMLInputElement).value).toBe('协作新事项')
        const original = api.send.mock.calls[0]![0]
        await user.click(within(dialog).getByRole('button', { name: '创建协作项目' }))
        await waitFor(() => expect(api.route).toHaveBeenCalledWith(`/projects/${sharedId}`))
        expect(api.send.mock.calls[1]![0]).toEqual(original)
        expect(original).toMatchObject({ type: 'project-create', memberIds: [candidateId], description: '完整共享说明\n保留换行' })
        expect(api.tasks).not.toHaveBeenCalled()
        expect(api.agents).not.toHaveBeenCalled()
    })

    it('opens a node-free project overview without redirecting to private chat and gives members only allowed controls', async () => {
        api.userId = memberId
        render(<ProjectWorkspace projectId={sharedId} />)
        expect(await screen.findByRole('heading', { level: 1, name: shared.name })).toBeTruthy()
        expect(await screen.findByText('还没有关联的协作工作。')).toBeTruthy()
        expect(screen.getByRole('button', { name: '发布资料' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: '编辑项目' })).toBeNull()
        expect(screen.queryByRole('button', { name: '管理成员' })).toBeNull()
        expect(api.route).not.toHaveBeenCalled()
        expect(api.get).not.toHaveBeenCalled()
        expect(api.node).not.toHaveBeenCalled()
    })

    it('keeps an owned work item on the overview and exposes only the current person’s authorized continuation link', async () => {
        const ownSource = '86868686-8686-4686-8686-868686868686'
        const node = {
            id: '96969696-9696-4696-8696-969696969696',
            projectId: sharedId,
            ownerId,
            ownerName: '项目拥有者',
            title: '本人工作',
            goal: '安全共享目标',
            context: '',
            source: { kind: 'conversation' as const, id: ownSource },
            upstreamNodeId: null,
            agentLabel: '本人 Agent',
            status: 'ready' as const,
            revision: 1,
            adoptions: [],
            canActivate: false,
            canManage: true,
            canWork: true,
            createdAt: now,
            updatedAt: now,
        }
        api.sharedGet.mockResolvedValue({
            ...shared,
            nodes: [
                node,
                {
                    ...node,
                    id: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
                    ownerId: memberId,
                    ownerName: '真实成员',
                    title: '同事工作',
                    source: null,
                    canWork: false,
                },
            ],
        })
        api.progress.mockResolvedValue({
            projectId: sharedId,
            revision: shared.revision,
            updatedAt: now,
            nodes: [
                {
                    ...node,
                    authorized: true,
                    sourceAvailable: true,
                    started: false,
                    canContinue: true,
                    ownHref: `/?conversation=${ownSource}`,
                },
                {
                    ...node,
                    id: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
                    ownerId: memberId,
                    title: '同事工作',
                    authorized: true,
                    sourceAvailable: true,
                    started: false,
                    canContinue: false,
                },
            ],
            waits: [],
        })
        render(<ProjectWorkspace projectId={sharedId} />)
        await screen.findByRole('heading', { level: 1, name: shared.name })
        await screen.findByRole('link', { name: '继续我的聊天' })
        const links = screen.getAllByRole('link', { name: '继续我的聊天' })
        expect(links).toHaveLength(1)
        expect(links[0]!.getAttribute('href')).toBe(`/?conversation=${ownSource}`)
        expect(within(screen.getByRole('tabpanel', { name: '概览' })).getByText('同事工作')).toBeTruthy()
        expect(api.route).not.toHaveBeenCalled()
        expect(api.node).not.toHaveBeenCalled()
    })

    it.each([403, 500])('does not mount a private project fallback when the shared route fails with %s', async status => {
        api.sharedGet.mockRejectedValue(new CollaborationRequestError('共享详情不可读', status))
        render(<ProjectWorkspace projectId={sharedId} />)
        expect(await screen.findByText('共享详情不可读')).toBeTruthy()
        expect(api.get).not.toHaveBeenCalled()
        expect(api.tasks).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: '发布资料' })).toBeNull()
    })

    it('confirms the actual removed member with cancel focused and shows the full scope before adding teammates', async () => {
        const user = userEvent.setup()
        const saved = vi.fn()
        render(<TeamProjectOverview project={shared} onSaved={saved} />)
        await user.click(screen.getByRole('button', { name: `移除项目成员 真实成员 ${memberId.slice(0, 8)}` }))
        const confirmation = await screen.findByRole('alertdialog', { name: '移除“真实成员”？' })
        await waitFor(() => expect(document.activeElement).toBe(within(confirmation).getByRole('button', { name: '取消' })))
        expect(within(confirmation).getByText(/已投递的本人聊天和私有历史会保留/)).toBeTruthy()
        await user.click(within(confirmation).getByRole('button', { name: '取消' }))
        expect(api.send).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '管理成员' }))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('搜索当前工作空间的同事'), '新同事')
        await user.click(await within(dialog).findByRole('button', { name: new RegExp(`新同事.*${candidateId.slice(0, 8)}`) }))
        expect(within(dialog).getByText(/将向这些人开放：/).textContent).toContain(candidateId.slice(0, 8))
        expect(within(dialog).getByText(/后续内容也可见；聊天和个人资料保持私有/)).toBeTruthy()
        await user.click(within(dialog).getByRole('button', { name: '确认添加成员' }))
        await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
        expect(api.send).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'project-members-add',
                projectId: sharedId,
                revision: shared.revision,
                memberIds: [candidateId],
            })
        )
    })

    it('publishes complete node-free material with validation focus, failure preservation and duplicate prevention', async () => {
        const user = userEvent.setup()
        api.userId = memberId
        const saved = vi.fn()
        const request = acceptanceDeferred<{ requestId: string; projectId: string }>()
        api.send.mockReturnValueOnce(request.promise)
        render(<TeamProjectOverview project={shared} onSaved={saved} />)
        await user.click(screen.getByRole('button', { name: '发布资料' }))
        const dialog = await screen.findByRole('dialog', { name: '发布资料' })
        const title = within(dialog).getByLabelText('资料标题')
        const content = within(dialog).getByLabelText('资料正文')
        await user.click(within(dialog).getByRole('button', { name: '发布资料' }))
        await waitFor(() => expect(document.activeElement).toBe(title))
        expect(title.getAttribute('aria-invalid')).toBe('true')
        await user.type(title, '实现约束')
        await user.click(within(dialog).getByRole('button', { name: '发布资料' }))
        await waitFor(() => expect(document.activeElement).toBe(content))
        fireEvent.change(content, { target: { value: '完整正文\n\n@同事 这不是发送授权。<script>throw</script>' } })
        expect(within(dialog).getByLabelText('完整共享预览').textContent).toContain('<script>throw</script>')
        expect(within(dialog).getByText(/后加入成员也可见/)).toBeTruthy()
        await user.dblClick(within(dialog).getByRole('button', { name: '发布资料' }))
        expect(api.send).toHaveBeenCalledTimes(1)
        expect(saved).not.toHaveBeenCalled()
        await act(async () => request.reject(new Error('资料写入暂不可用')))
        expect(await within(dialog).findByText('资料写入暂不可用')).toBeTruthy()
        expect((content as HTMLTextAreaElement).value).toContain('完整正文\n\n@同事')
        const original = api.send.mock.calls[0]![0]
        await user.click(within(dialog).getByRole('button', { name: '发布资料' }))
        await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
        expect(api.send.mock.calls[1]![0]).toEqual(original)
        expect(api.route).not.toHaveBeenCalled()
        expect(api.agents).not.toHaveBeenCalled()
    })

    it('retains note edits after a version conflict, requires rereading and an explicit new submit, and preserves history', async () => {
        const user = userEvent.setup()
        api.userId = memberId
        const note = {
            id: '76767676-7676-4676-8676-767676767676',
            projectId: sharedId,
            title: '版本一',
            content: '第一版完整正文',
            version: 1,
            authorId: memberId,
            authorName: '真实成员',
            createdAt: now,
            updatedAt: now,
        }
        const note2 = { ...note, title: '其他窗口第二版', content: '当前已保存第二版', version: 2 }
        api.send.mockRejectedValueOnce(new CollaborationRequestError('版本已变化', 409))
        api.sharedGet.mockResolvedValue({ ...shared, revision: 8, notes: [note, note2] })
        const saved = vi.fn()
        render(<TeamProjectOverview project={{ ...shared, notes: [note] }} onSaved={saved} />)
        await user.click(screen.getByRole('button', { name: '更新资料' }))
        const dialog = await screen.findByRole('dialog', { name: '更新资料' })
        const content = within(dialog).getByLabelText('资料正文')
        await user.clear(content)
        await user.type(content, '我的未保存修订')
        await user.click(within(dialog).getByRole('button', { name: '提交新版本' }))
        expect(await within(dialog).findByText('版本已变化')).toBeTruthy()
        expect(within(dialog).getByRole('button', { name: '提交新版本' }).hasAttribute('disabled')).toBe(true)
        await user.click(within(dialog).getByRole('button', { name: '重新读取最新资料，保留本地草稿' }))
        expect(await within(dialog).findByText('当前已保存第二版')).toBeTruthy()
        expect((content as HTMLTextAreaElement).value).toBe('我的未保存修订')
        expect(api.send).toHaveBeenCalledTimes(1)
        await user.click(within(dialog).getByRole('button', { name: '提交新版本' }))
        await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
        expect(api.send.mock.calls[1]![0]).toMatchObject({
            type: 'note-edit',
            noteId: note.id,
            revision: 8,
            version: 2,
            content: '我的未保存修订',
        })
    })
})
