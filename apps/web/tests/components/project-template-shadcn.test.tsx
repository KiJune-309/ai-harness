// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinition, CollaborationProject, PersonalProject, PersonalTask, ProjectTemplate } from '@ai-harness/contracts'
import { collaborationProjectSchema } from '@ai-harness/contracts'
import { CollaborationRequestError } from '../../lib/collaboration-client'
import { ProjectWorkspace } from '../../components/project-workspace'
import { TemplateWorkspace } from '../../components/template-workspace'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    status: vi.fn(),
    agents: vi.fn(),
    listProjects: vi.fn(),
    listCollaborationProjects: vi.fn(),
    sharedProject: vi.fn(),
    getProject: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    listTasks: vi.fn(),
    moveTask: vi.fn(),
    listTemplates: vi.fn(),
    catalog: vi.fn(),
    catalogGet: vi.fn(),
    getTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    launch: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.push, replace: api.replace }) }))
vi.mock('../../components/account-context', () => ({
    useAccount: () => ({
        user: { id: '48484848-4848-4848-8848-484848484848', username: '真实本人' },
        modelLabel: (value: string) => value,
    }),
}))
vi.mock('../../components/task-workspace', () => ({ TaskCreationDialog: () => null }))
vi.mock('../../lib/chat-client', () => ({ getChatStatus: api.status }))
vi.mock('../../lib/agent-client', () => ({ listAgents: api.agents }))
vi.mock('../../lib/project-client', () => ({
    listProjects: api.listProjects,
    getProject: api.getProject,
    createProject: api.createProject,
    updateProject: api.updateProject,
}))
vi.mock('../../lib/collaboration-client', async importOriginal => ({
    ...(await importOriginal()),
    listCollaborationProjects: api.listCollaborationProjects,
    getCollaborationProject: api.sharedProject,
}))
vi.mock('../../lib/task-client', () => ({ listTasks: api.listTasks, updateTaskProject: api.moveTask }))
vi.mock('../../lib/workflow-template-client', async () => ({
    ...(await vi.importActual<typeof import('../../lib/workflow-template-client')>('../../lib/workflow-template-client')),
    listTemplateCatalog: api.catalog,
    getTemplateCatalogEntry: api.catalogGet,
}))
vi.mock('../../lib/template-client', () => ({
    listTemplates: api.listTemplates,
    getTemplate: api.getTemplate,
    createTemplate: api.createTemplate,
    updateTemplate: api.updateTemplate,
    launchTemplate: api.launch,
}))

const projectId = '8474a14c-c80b-44f7-853f-623b2c9839c6'
const templateId = '7b595589-e074-4159-9c83-4287684508ee'
const taskId = 'ab9fbba2-2875-43d6-a616-e77601e041aa'
const agentId = 'b4328021-1344-4216-bda6-39f230a8441b'
const time = '2026-10-18T00:00:00.000Z'
const project: PersonalProject = { id: projectId, name: '真实项目', description: '原项目说明', createdAt: time, updatedAt: time }
const collaborationProject: CollaborationProject = collaborationProjectSchema.parse({
    id: '35e6d916-61fa-4b35-a79d-fbb22958ec8c',
    name: '团队协作项目',
    description: '协作专属检索线索',
    ownerId: '52b9c5da-b9ca-46d7-911a-572721e51f06',
    revision: 1,
    members: [{ id: '52b9c5da-b9ca-46d7-911a-572721e51f06', name: '项目负责人', role: 'owner', status: 'active' }],
    nodes: [],
    artifacts: [],
    createdAt: time,
    updatedAt: time,
})
const agent: AgentDefinition = {
    id: agentId,
    name: '研究助手',
    description: '',
    modelId: 'stable-model',
    systemPrompt: '原提示',
    toolIds: [],
    openingMessages: [],
    createdAt: time,
    updatedAt: time,
}
const template: ProjectTemplate = {
    id: templateId,
    version: 3,
    name: '原始模板',
    description: '原说明',
    tasks: [{ id: taskId, title: '第一项任务', goal: '第一个完整目标', agentId }],
    createdAt: time,
    updatedAt: time,
}
const task: PersonalTask = {
    id: taskId,
    title: '已有待归组任务',
    task: { goal: '原目标', status: 'not-started', started: false },
    agent,
    messages: [],
    createdAt: time,
    updatedAt: time,
}

beforeEach(() => {
    installAcceptanceBrowser()
    for (const mock of Object.values(api)) mock.mockReset()
    api.status.mockResolvedValue({ configured: true, model: 'stable-model', storage: 'postgres' })
    api.agents.mockResolvedValue([agent])
    api.listProjects.mockResolvedValue([project])
    api.listCollaborationProjects.mockResolvedValue([])
    api.sharedProject.mockRejectedValue(new CollaborationRequestError('未找到共享项目。', 404))
    api.getProject.mockResolvedValue({ project, tasks: [] })
    api.listTasks.mockResolvedValue([task])
    api.listTemplates.mockResolvedValue([template])
    api.catalog.mockResolvedValue([{ kind: 'personal', template }])
    api.catalogGet.mockResolvedValue({ kind: 'personal', template })
    api.getTemplate.mockResolvedValue(template)
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('shadcn project and template workflows', () => {
    it('places collection controls before collaboration projects and avoids a first-project invitation when only shared projects exist', async () => {
        api.listProjects.mockResolvedValue([])
        api.listCollaborationProjects.mockResolvedValue([collaborationProject])
        render(<ProjectWorkspace />)

        const shared = await screen.findByLabelText('项目列表')
        expect(
            within(shared)
                .getByRole('link', { name: new RegExp(collaborationProject.name) })
                .getAttribute('href')
        ).toBe(`/projects/${collaborationProject.id}`)
        const count = screen.getByText('1 个项目')
        const search = screen.getByRole('searchbox', { name: '搜索项目名称或说明' })
        const refresh = screen.getByRole('button', { name: '刷新项目列表' })
        for (const control of [count, search, refresh]) {
            expect(control.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        }
        expect(screen.queryByText('为长期主题建一个项目')).toBeNull()
        expect(screen.queryByRole('button', { name: '创建第一个项目' })).toBeNull()
    })

    it('shows the first-project invitation only after both project collections are confirmed empty', async () => {
        const pending = acceptanceDeferred<CollaborationProject[]>()
        api.listProjects.mockResolvedValue([])
        api.listCollaborationProjects.mockReturnValueOnce(pending.promise)
        render(<ProjectWorkspace />)

        await waitFor(() => expect(api.listCollaborationProjects).toHaveBeenCalledTimes(1))
        await act(async () => undefined)
        expect(screen.queryByText('为长期主题建一个项目')).toBeNull()
        expect(screen.queryByRole('button', { name: '创建第一个项目' })).toBeNull()
        expect(screen.queryByText('没有找到相关项目')).toBeNull()

        await act(async () => pending.resolve([]))
        expect(await screen.findByRole('heading', { name: '为长期主题建一个项目' })).toBeTruthy()
        expect(screen.getByRole('button', { name: '创建第一个项目' })).toBeTruthy()
        expect(screen.getByText('0 个项目')).toBeTruthy()
    })

    it('searches names and descriptions across personal and shared projects and clears a combined no-match result', async () => {
        const user = userEvent.setup()
        api.listCollaborationProjects.mockResolvedValue([collaborationProject])
        render(<ProjectWorkspace />)
        await screen.findByRole('link', { name: new RegExp(collaborationProject.name) })
        const search = screen.getByRole('searchbox', { name: '搜索项目名称或说明' })
        expect(screen.getByText('2 个项目')).toBeTruthy()

        await user.type(search, collaborationProject.description)
        expect(screen.getByRole('link', { name: new RegExp(collaborationProject.name) })).toBeTruthy()
        expect(screen.queryByRole('heading', { name: project.name })).toBeNull()
        expect(screen.queryByText('没有找到相关项目')).toBeNull()
        expect(screen.queryByText('为长期主题建一个项目')).toBeNull()
        expect(screen.getByText('2 个项目')).toBeTruthy()

        await user.clear(search)
        await user.type(search, project.description)
        expect(screen.getByRole('heading', { name: project.name })).toBeTruthy()
        expect(screen.queryByRole('link', { name: new RegExp(collaborationProject.name) })).toBeNull()
        expect(screen.queryByText('没有找到相关项目')).toBeNull()

        await user.clear(search)
        await user.type(search, '没有任何项目会匹配的关键词')
        expect(screen.getByRole('heading', { name: '没有找到相关项目' })).toBeTruthy()
        expect(screen.queryByRole('heading', { name: project.name })).toBeNull()
        expect(screen.queryByRole('link', { name: new RegExp(collaborationProject.name) })).toBeNull()
        expect(screen.queryByRole('button', { name: '创建第一个项目' })).toBeNull()

        await user.click(screen.getByRole('button', { name: '清空搜索' }))
        expect((search as HTMLInputElement).value).toBe('')
        expect(screen.getByRole('heading', { name: project.name })).toBeTruthy()
        expect(screen.getByRole('link', { name: new RegExp(collaborationProject.name) })).toBeTruthy()
        expect(screen.queryByText('没有找到相关项目')).toBeNull()
    })

    it('counts a project present in both collections once and refreshes both collections together', async () => {
        const user = userEvent.setup()
        api.listCollaborationProjects.mockResolvedValue([
            { ...collaborationProject, id: project.id, name: '同一项目的共享投影' },
            collaborationProject,
        ])
        render(<ProjectWorkspace />)
        await screen.findByRole('link', { name: new RegExp(collaborationProject.name) })
        expect(screen.getByText('2 个项目')).toBeTruthy()
        expect(screen.queryByText('3 个项目')).toBeNull()
        expect(screen.getByRole('heading', { name: '同一项目的共享投影' })).toBeTruthy()
        expect(screen.queryByRole('heading', { name: project.name })).toBeNull()
        expect(screen.getAllByRole('link').filter(link => link.getAttribute('href') === `/projects/${projectId}`)).toHaveLength(1)

        await user.click(screen.getByRole('button', { name: '刷新项目列表' }))
        await waitFor(() => {
            expect(api.listProjects).toHaveBeenCalledTimes(2)
            expect(api.listCollaborationProjects).toHaveBeenCalledTimes(2)
        })
        expect(await screen.findByText('2 个项目')).toBeTruthy()
        expect(screen.queryByText('为长期主题建一个项目')).toBeNull()
    })

    it('keeps a failed collaboration read separate from a confirmed empty collection', async () => {
        api.listProjects.mockResolvedValue([])
        api.listCollaborationProjects.mockRejectedValueOnce(new Error('受控协作项目读取失败'))
        render(<ProjectWorkspace />)

        expect(await screen.findByText('受控协作项目读取失败')).toBeTruthy()
        expect(screen.queryByText('为长期主题建一个项目')).toBeNull()
        expect(screen.queryByRole('button', { name: '创建第一个项目' })).toBeNull()
        expect(screen.queryByText('没有找到相关项目')).toBeNull()
    })

    it('keeps a project creation dialog open during a request, preserves failed fields and UUID, and navigates only after confirmed save', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<PersonalProject>()
        api.createProject
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValueOnce({ ...project, name: '新项目', description: '完整说明' })
        render(<ProjectWorkspace />)
        const opener = await screen.findByRole('button', { name: '新建项目' })
        await user.click(opener)
        const dialog = await screen.findByRole('dialog', { name: '新建项目' })
        const name = within(dialog).getByLabelText(/项目名称/)
        await waitFor(() => expect(document.activeElement).toBe(name))
        await user.click(within(dialog).getByRole('button', { name: '创建项目' }))
        expect(api.createProject).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(name)
        await user.type(name, '新项目')
        await user.type(within(dialog).getByLabelText(/项目说明/), '完整说明')
        await user.click(within(dialog).getByRole('button', { name: '创建项目' }))
        await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1))
        await user.keyboard('{Escape}')
        expect(screen.getByRole('dialog', { name: '新建项目' })).toBe(dialog)
        expect(api.push).not.toHaveBeenCalled()
        await act(async () => pending.reject(new Error('受控创建失败')))
        expect(await within(dialog).findByText('受控创建失败')).toBeTruthy()
        expect((name as HTMLInputElement).value).toBe('新项目')
        await user.click(within(dialog).getByRole('button', { name: '创建项目' }))
        await waitFor(() => expect(api.push).toHaveBeenCalledExactlyOnceWith(`/projects/${projectId}`))
        expect(api.createProject.mock.calls[0]?.[0]).toEqual(api.createProject.mock.calls[1]?.[0])
        expect(api.createProject.mock.calls[0]?.[0]).toMatchObject({
            name: '新项目',
            description: '完整说明',
            requestId: expect.any(String),
        })
        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('retains project edit fields after failure and restores the editor opener when cancelled', async () => {
        const user = userEvent.setup()
        api.updateProject.mockRejectedValueOnce(new Error('受控编辑失败'))
        render(<ProjectWorkspace />)
        const opener = await screen.findByRole('button', { name: /编辑项目：真实项目/ })
        await user.click(opener)
        const dialog = await screen.findByRole('dialog', { name: '编辑项目' })
        const name = within(dialog).getByLabelText(/项目名称/)
        await user.clear(name)
        await user.type(name, '修改后的名称')
        await user.click(within(dialog).getByRole('button', { name: '保存修改' }))
        expect(await within(dialog).findByText('受控编辑失败')).toBeTruthy()
        expect(api.updateProject).toHaveBeenCalledExactlyOnceWith(projectId, { name: '修改后的名称', description: project.description })
        await user.click(within(dialog).getByRole('button', { name: '暂时取消' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(opener))
        expect(api.push).not.toHaveBeenCalled()
    })

    it('uses the selected task UUID for membership and applies only confirmed project state', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<PersonalTask>()
        api.moveTask.mockReturnValueOnce(pending.promise)
        render(<ProjectWorkspace projectId={projectId} />)
        const select = await screen.findByRole('combobox', { name: '归入已有任务' })
        await user.selectOptions(select, taskId)
        await user.click(screen.getByRole('button', { name: '归入项目' }))
        expect(api.moveTask).toHaveBeenCalledExactlyOnceWith(taskId, { projectId })
        expect(screen.getByText('项目里还没有任务')).toBeTruthy()
        await act(async () => pending.resolve({ ...task, task: { ...task.task, projectId } }))
        expect(await screen.findByRole('link', { name: /已有待归组任务/ })).toBeTruthy()
        expect((screen.getByRole('combobox', { name: '归入已有任务' }) as HTMLSelectElement).value).toBe('')
    })

    it('opens only the workflow editor at the new-template route without loading legacy tasks or Agent choices', async () => {
        const user = userEvent.setup()
        render(<TemplateWorkspace editing />)
        expect(await screen.findByLabelText('模板名称')).toBeTruthy()
        expect(screen.queryByLabelText('节点名称')).toBeNull()
        expect(screen.queryByLabelText('工作说明')).toBeNull()
        expect(document.querySelectorAll('.react-flow__node-boundary')).toHaveLength(2)
        expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(2)
        expect(screen.getByRole('button', { name: '添加节点（2/8）' })).toBeTruthy()
        expect(screen.queryByRole('radio', { name: '完整节点列表' })).toBeNull()
        expect(screen.queryByLabelText(/任务名称/)).toBeNull()
        expect(screen.queryByLabelText(/任务目标/)).toBeNull()
        expect(screen.queryByRole('combobox', { name: '使用的 Agent' })).toBeNull()
        expect(screen.queryByRole('radio', { name: '个人清单' })).toBeNull()
        expect(api.getTemplate).not.toHaveBeenCalled()
        expect(api.listTemplates).not.toHaveBeenCalled()
        expect(api.agents).not.toHaveBeenCalled()
        expect(api.status).not.toHaveBeenCalled()
        expect(api.createTemplate).not.toHaveBeenCalled()
        expect(api.launch).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '编辑节点' }))
        const editor = await screen.findByRole('dialog', { name: '编辑节点' })
        expect(within(editor).getByLabelText('节点名称')).toBeTruthy()
        expect(within(editor).getByLabelText('工作说明')).toBeTruthy()
    })

    it('keeps a legacy personal deep link informational without editing or launching', async () => {
        render(<TemplateWorkspace editing templateId={templateId} />)
        expect(await screen.findByRole('heading', { name: '此模板为旧个人清单' })).toBeTruthy()
        expect(screen.getByText('当前任务模板仅支持协作流程，历史个人模板数据已保留。')).toBeTruthy()
        expect(screen.getByText('返回任务模板').closest('a')?.getAttribute('href')).toBe('/templates')
        expect(screen.queryByText(template.name)).toBeNull()
        expect(screen.queryByLabelText(/模板名称/)).toBeNull()
        expect(screen.queryByRole('button', { name: '保存模板' })).toBeNull()
        expect(screen.queryByRole('button', { name: '启动预览' })).toBeNull()
        expect(screen.queryByRole('link', { name: /编辑/ })).toBeNull()
        expect(api.catalogGet.mock.calls[0]?.[0]).toBe(templateId)
        for (const request of [api.getTemplate, api.createTemplate, api.updateTemplate, api.launch, api.agents, api.status])
            expect(request).not.toHaveBeenCalled()
        expect(api.push).not.toHaveBeenCalled()
        expect(api.replace).not.toHaveBeenCalled()
    })

    it.each([403, 404, 500])('does not fall back to legacy private reads when the typed template lookup fails with %s', async status => {
        api.catalogGet.mockRejectedValueOnce(Object.assign(new Error('受控模板读取失败'), { status }))
        render(<TemplateWorkspace editing templateId={templateId} />)
        expect(await screen.findByText('受控模板读取失败')).toBeTruthy()
        expect(screen.queryByLabelText(/模板名称/)).toBeNull()
        expect(screen.queryByRole('button', { name: '启动预览' })).toBeNull()
        for (const request of [api.getTemplate, api.createTemplate, api.updateTemplate, api.launch, api.agents, api.status])
            expect(request).not.toHaveBeenCalled()
        expect(api.replace).not.toHaveBeenCalled()
    })

    it('rejects a typed response for a different template identity without exposing legacy contents or actions', async () => {
        api.catalogGet.mockResolvedValueOnce({ kind: 'personal', template: { ...template, id: taskId } })
        render(<TemplateWorkspace editing templateId={templateId} />)
        expect(await screen.findByText(/返回的模板与当前地址不匹配/)).toBeTruthy()
        expect(screen.queryByText(template.name)).toBeNull()
        expect(screen.queryByLabelText(/模板名称/)).toBeNull()
        expect(screen.queryByRole('button', { name: '启动预览' })).toBeNull()
        expect(api.getTemplate).not.toHaveBeenCalled()
        expect(api.updateTemplate).not.toHaveBeenCalled()
        expect(api.launch).not.toHaveBeenCalled()
    })
})
