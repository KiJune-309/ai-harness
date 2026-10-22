// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCatalog, AgentDefinition, AgentInput } from '@ai-harness/contracts'
import { AccountModels } from '../../components/account-models'
import { AccountWorkspace } from '../../components/account-workspace'
import { AgentEditor } from '../../components/agent-editor'
import { AuthForm } from '../../components/auth-form'
import { EmbeddingModels } from '../../components/embedding-models'
import { TooltipProvider } from '../../components/ui/tooltip'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    listModels: vi.fn(),
    createModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    testModel: vi.fn(),
    defaultModel: vi.fn(),
    listEmbeddings: vi.fn(),
    createEmbedding: vi.fn(),
    updateEmbedding: vi.fn(),
    deleteEmbedding: vi.fn(),
    testEmbedding: vi.fn(),
    defaultEmbedding: vi.fn(),
    catalog: vi.fn(),
    agents: vi.fn(),
    agent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    push: vi.fn(),
    updateUsername: vi.fn(),
    updateEmail: vi.fn(),
    updatePassword: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    updateUser: vi.fn(),
    clearAccount: vi.fn(),
    refreshNames: vi.fn(),
}))

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: api.push }),
    useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../components/account-context', () => ({
    useAccount: () => ({
        user: { id: 'account', username: '原用户名', email: 'user@example.invalid' },
        storage: 'postgres',
        updateUser: api.updateUser,
        clearAccount: api.clearAccount,
        refreshModelNames: api.refreshNames,
        modelLabel: (id: string) => id,
    }),
}))
vi.mock('../../lib/account-client', () => ({
    listAccountModels: api.listModels,
    createAccountModel: api.createModel,
    updateAccountModel: api.updateModel,
    deleteAccountModel: api.deleteModel,
    testAccountModel: api.testModel,
    setDefaultAccountModel: api.defaultModel,
    updateAccountUsername: api.updateUsername,
    updateAccountEmail: api.updateEmail,
    updateAccountPassword: api.updatePassword,
    registerAccount: api.register,
    loginAccount: api.login,
    safeReturnTo: () => '/',
}))
vi.mock('../../lib/embedding-client', () => ({
    listEmbeddingModels: api.listEmbeddings,
    createEmbeddingModel: api.createEmbedding,
    updateEmbeddingModel: api.updateEmbedding,
    deleteEmbeddingModel: api.deleteEmbedding,
    testEmbeddingModel: api.testEmbedding,
    setDefaultEmbeddingModel: api.defaultEmbedding,
}))
vi.mock('../../lib/agent-client', () => ({
    getAgentCatalog: api.catalog,
    listAgents: api.agents,
    getAgent: api.agent,
    createAgent: api.createAgent,
    updateAgent: api.updateAgent,
}))

const id = 'c23bc05e-3bb1-48fd-8b4f-4e7e96dc6863'
const time = '2026-10-18T00:00:00.000Z'
const model = {
    id,
    modelId: `account:${id}`,
    name: '已有连接',
    baseUrl: 'https://provider.example.invalid/v1',
    model: 'stable-model-id',
    hasApiKey: true,
    isDefault: true,
    createdAt: time,
    updatedAt: time,
}
const embedding = { ...model, revision: 7 }
const agentInput: AgentInput = {
    name: '已保存助手',
    description: '',
    modelId: 'stable-second-id',
    systemPrompt: '',
    toolIds: [],
    openingMessages: [],
}
const savedAgent: AgentDefinition = { ...agentInput, id, createdAt: time, updatedAt: time }
const catalog: AgentCatalog = {
    defaultModelId: 'stable-first-id',
    models: [
        { id: 'stable-first-id', label: '第一个模型名称', provider: 'deepseek', available: true },
        { id: 'stable-second-id', label: '第二个模型名称', provider: 'openai', available: true },
    ],
    tools: [{ id: 'calculator', label: '计算器', description: '计算表达式。' }],
}

beforeEach(() => {
    installAcceptanceBrowser()
    for (const mock of Object.values(api)) mock.mockReset()
    api.listModels.mockResolvedValue([model])
    api.listEmbeddings.mockResolvedValue([embedding])
    api.catalog.mockResolvedValue(catalog)
    api.agents.mockResolvedValue([])
    api.agent.mockResolvedValue(savedAgent)
    api.createAgent.mockImplementation(async (input: AgentInput) => ({ ...savedAgent, ...input }))
    api.updateAgent.mockImplementation(async (_id: string, input: AgentInput) => ({ ...savedAgent, ...input }))
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('shadcn account and agent form behavior', () => {
    it('starts the private Agent list while its independent model catalog is still pending', async () => {
        const capabilities = acceptanceDeferred<AgentCatalog>()
        const records = acceptanceDeferred<AgentDefinition[]>()
        api.catalog.mockReturnValueOnce(capabilities.promise)
        api.agents.mockReturnValueOnce(records.promise)
        render(
            <TooltipProvider>
                <AgentEditor />
            </TooltipProvider>
        )

        await waitFor(() => {
            expect(api.catalog).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
            expect(api.agents).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
        })
        expect(api.catalog.mock.calls[0][0]).toBe(api.agents.mock.calls[0][0])
        await act(async () => records.resolve([savedAgent]))
        expect(screen.getByText('正在读取可用模型、工具和已保存的 Agent。')).toBeTruthy()
        expect(screen.queryByText(savedAgent.name)).toBeNull()

        await act(async () => capabilities.resolve(catalog))
        expect(await screen.findByText(savedAgent.name)).toBeTruthy()
        expect(screen.queryByText('正在读取可用模型、工具和已保存的 Agent。')).toBeNull()
        expect(api.agent).not.toHaveBeenCalled()
    })

    it('shows the available system model without requiring or creating a personal connection', async () => {
        api.listModels.mockResolvedValue([])
        render(<AccountModels />)
        expect(await screen.findByText('第一个模型名称')).toBeTruthy()
        expect(screen.getByText('可直接使用')).toBeTruthy()
        expect(await screen.findByText('尚无个人连接')).toBeTruthy()
        expect(screen.getByText('无需添加个人连接，可直接聊天、创建任务和参与协作。')).toBeTruthy()
        expect(api.catalog).toHaveBeenCalledTimes(1)
        expect(api.createModel).not.toHaveBeenCalled()
        expect(api.testModel).not.toHaveBeenCalled()
        expect(api.defaultModel).not.toHaveBeenCalled()
    })

    it('keeps personal configuration optional while reporting unavailable system setup accurately', async () => {
        api.catalog.mockResolvedValue({
            ...catalog,
            defaultModelId: model.modelId,
            models: [
                { id: model.modelId, label: model.name, provider: 'OpenAI 兼容', available: true },
                ...catalog.models.map(item => ({ ...item, available: false })),
            ],
        })
        render(<AccountModels />)
        expect(await screen.findByText('暂不可用')).toBeTruthy()
        expect(screen.getByText('请联系管理员检查系统模型配置，或按需添加个人连接。')).toBeTruthy()
        expect(screen.queryByText('无需添加个人连接，可直接聊天、创建任务和参与协作。')).toBeNull()
        expect(await screen.findByText('已有连接')).toBeTruthy()
        expect(api.testModel).not.toHaveBeenCalled()
    })

    it('retries a failed system catalog read without hiding existing personal connections', async () => {
        const user = userEvent.setup()
        api.catalog.mockRejectedValueOnce(new Error('受控读取故障'))
        render(<AccountModels />)
        expect(await screen.findByText('已有连接')).toBeTruthy()
        await user.click(await screen.findByRole('button', { name: '重新读取系统默认模型' }))
        expect(await screen.findByText('可直接使用')).toBeTruthy()
        expect(api.catalog).toHaveBeenCalledTimes(2)
        expect(api.testModel).not.toHaveBeenCalled()
    })

    it('focuses the first invalid real registration field without sending credentials', async () => {
        const user = userEvent.setup()
        render(<AuthForm register />)
        await user.click(screen.getByRole('button', { name: '创建账户' }))
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('用户名')))
        expect(screen.getByLabelText('用户名').getAttribute('aria-invalid')).toBe('true')
        expect(screen.getByLabelText('密码').getAttribute('type')).toBe('password')
        expect(screen.getByLabelText('确认密码').getAttribute('autocomplete')).toBe('new-password')
        expect(api.register).not.toHaveBeenCalled()
    })

    it('submits only the chosen account section and updates the confirmed username', async () => {
        const user = userEvent.setup()
        api.updateUsername.mockResolvedValue({ id: 'account', username: '新的用户名', email: 'user@example.invalid' })
        render(<AccountWorkspace />)
        const username = screen.getByLabelText('用户名')
        await user.clear(username)
        await user.type(username, '新的用户名')
        await user.click(screen.getByRole('button', { name: '保存用户名' }))
        await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith(expect.objectContaining({ username: '新的用户名' })))
        expect(api.updateUsername).toHaveBeenCalledExactlyOnceWith({ username: '新的用户名' })
        expect(api.updateEmail).not.toHaveBeenCalled()
        expect(api.updatePassword).not.toHaveBeenCalled()
        expect(api.testModel).not.toHaveBeenCalled()
        expect(api.testEmbedding).not.toHaveBeenCalled()
    })

    for (const kind of ['chat', 'embedding'] as const) {
        it(`preserves the write-only blank key and stable fields when editing a ${kind} connection without testing it`, async () => {
            const user = userEvent.setup()
            const update = kind === 'chat' ? api.updateModel : api.updateEmbedding
            update.mockResolvedValue(kind === 'chat' ? { ...model, name: '新的连接' } : { ...embedding, name: '新的连接' })
            render(kind === 'chat' ? <AccountModels /> : <EmbeddingModels />)
            await user.click(await screen.findByRole('button', { name: '编辑' }))
            const name = screen.getByLabelText('连接名称')
            await user.clear(name)
            await user.type(name, '新的连接')
            const key = screen.getByLabelText(/API key/)
            expect((key as HTMLInputElement).value).toBe('')
            expect(key.getAttribute('type')).toBe('password')
            await user.click(screen.getByRole('button', { name: '保存连接' }))
            await waitFor(() =>
                expect(update).toHaveBeenCalledExactlyOnceWith(id, {
                    name: '新的连接',
                    baseUrl: model.baseUrl,
                    model: model.model,
                    apiKey: '',
                    ...(kind === 'embedding' ? { revision: 7 } : {}),
                })
            )
            expect(api.testModel).not.toHaveBeenCalled()
            expect(api.testEmbedding).not.toHaveBeenCalled()
        })

        it(`keeps a failed asynchronous ${kind} deletion open and initially focuses the safe cancel action`, async () => {
            const user = userEvent.setup()
            const deletion = acceptanceDeferred<void>()
            const remove = kind === 'chat' ? api.deleteModel : api.deleteEmbedding
            remove.mockReturnValueOnce(deletion.promise)
            render(kind === 'chat' ? <AccountModels /> : <EmbeddingModels />)
            await user.click(await screen.findByRole('button', { name: '删除连接 已有连接' }))
            const dialog = await screen.findByRole('alertdialog')
            const cancel = within(dialog).getByRole('button', { name: '保留连接' })
            await waitFor(() => expect(document.activeElement).toBe(cancel))
            await user.click(within(dialog).getByRole('button', { name: '确认删除' }))
            await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith(id))
            expect((cancel as HTMLButtonElement).disabled).toBe(true)
            await user.keyboard('{Escape}')
            expect(screen.getByRole('alertdialog')).toBe(dialog)
            await act(async () => deletion.reject(new Error('受控删除失败，请重试。')))
            expect(await within(dialog).findByText('受控删除失败，请重试。')).toBeTruthy()
            expect(screen.getByRole('alertdialog')).toBe(dialog)
            await user.click(cancel)
            await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
            expect(screen.getByText('已有连接')).toBeTruthy()
        })
    }

    it('retains NativeSelect IDs, real checkbox state, greeting order, and separate save versus chat submitters', async () => {
        const user = userEvent.setup()
        const view = render(
            <TooltipProvider>
                <AgentEditor />
            </TooltipProvider>
        )
        await user.click(await screen.findByRole('button', { name: '新建 Agent' }))
        const name = await screen.findByLabelText(/名称/)
        await user.type(name, '自定义助手')
        await user.selectOptions(screen.getByRole('combobox', { name: /LLM 模型/ }), 'stable-second-id')
        await user.click(screen.getByRole('button', { name: '下一步' }))
        await user.click(screen.getByRole('checkbox', { name: /计算器/ }))
        await user.click(screen.getByRole('button', { name: '下一步' }))
        await user.click(screen.getByRole('button', { name: /添加开场消息/ }))
        await user.type(screen.getByLabelText('消息 1'), '第一条开场')
        await user.click(screen.getByRole('button', { name: /添加开场消息/ }))
        await user.type(screen.getByLabelText('消息 2'), '第二条开场')
        await user.click(screen.getByRole('button', { name: '上移开场消息 2' }))
        await user.click(screen.getByRole('button', { name: '确定创建' }))
        await waitFor(() =>
            expect(api.createAgent).toHaveBeenCalledWith(
                expect.objectContaining({
                    modelId: 'stable-second-id',
                    toolIds: ['calculator'],
                    openingMessages: ['第二条开场', '第一条开场'],
                })
            )
        )
        await waitFor(() => expect(api.push).toHaveBeenCalledExactlyOnceWith(`/agents/${id}`))
        expect(api.push).not.toHaveBeenCalledWith(`/?agent=${id}`)
        const created = { ...savedAgent, ...(api.createAgent.mock.lastCall![0] as AgentInput) }
        api.agent.mockResolvedValue(created)
        view.rerender(
            <TooltipProvider>
                <AgentEditor agentId={id} />
            </TooltipProvider>
        )
        await user.click(await screen.findByRole('button', { name: '编辑 Agent' }))
        await user.type(await screen.findByLabelText(/名称/), '更新')
        await user.click(screen.getByRole('button', { name: '保存并开始对话' }))
        await waitFor(() => expect(api.push).toHaveBeenLastCalledWith(`/?agent=${id}`))
        expect(api.push).toHaveBeenCalledTimes(2)
        expect(api.updateAgent).toHaveBeenCalledWith(id, expect.objectContaining({ name: '自定义助手更新' }))
    })

    it('preserves dirty detail edits on continue and only restores the saved definition after explicit discard', async () => {
        const user = userEvent.setup()
        render(
            <TooltipProvider>
                <AgentEditor agentId={id} />
            </TooltipProvider>
        )
        await user.click(await screen.findByRole('button', { name: '编辑 Agent' }))
        await user.clear(screen.getByLabelText(/名称/))
        await user.type(screen.getByLabelText(/名称/), '未保存草稿')
        await user.click(screen.getByRole('button', { name: '取消编辑' }))
        const dialog = await screen.findByRole('alertdialog')
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '继续编辑' })))
        await user.click(within(dialog).getByRole('button', { name: '继续编辑' }))
        expect((screen.getByLabelText(/名称/) as HTMLInputElement).value).toBe('未保存草稿')
        await user.click(screen.getByRole('button', { name: '取消编辑' }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '放弃更改' }))
        await waitFor(() => expect(screen.queryByLabelText(/名称/)).toBeNull())
        expect(screen.getByRole('heading', { name: savedAgent.name, level: 1 })).toBeTruthy()
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑 Agent' })))
        expect(api.createAgent).not.toHaveBeenCalled()
        expect(api.updateAgent).not.toHaveBeenCalled()
        expect(api.push).not.toHaveBeenCalled()
    })

    it('keeps first-error focus on the real agent input before any save', async () => {
        const user = userEvent.setup()
        render(
            <TooltipProvider>
                <AgentEditor />
            </TooltipProvider>
        )
        await user.click(await screen.findByRole('button', { name: '新建 Agent' }))
        await screen.findByLabelText(/名称/)
        fireEvent.click(screen.getByRole('button', { name: '下一步' }))
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/名称/)))
        expect(screen.getByLabelText(/名称/).getAttribute('aria-invalid')).toBe('true')
        expect(api.createAgent).not.toHaveBeenCalled()
    })
})
