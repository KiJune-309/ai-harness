// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountMe, AgentCatalog, AgentDefinition, AgentInput } from '@ai-harness/contracts'
import { AgentEditor } from '../../components/agent-editor'
import { AuthBoundary } from '../../components/auth-boundary'
import { TooltipProvider } from '../../components/ui/tooltip'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    account: vi.fn(),
    models: vi.fn(),
    catalog: vi.fn(),
    agents: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    push: vi.fn(),
}))

vi.mock('../../lib/skill-client', () => ({ listSkills: vi.fn(async () => []), getSkill: vi.fn() }))

vi.mock('next/navigation', () => ({ usePathname: () => '/agents/detail', useRouter: () => ({ push: api.push }) }))
vi.mock('../../lib/account-client', () => ({ getAccount: api.account, listAccountModels: api.models }))
vi.mock('../../lib/agent-client', () => ({
    getAgentCatalog: api.catalog,
    listAgents: api.agents,
    getAgent: api.get,
    createAgent: api.create,
    updateAgent: api.update,
}))
vi.mock('../../components/workspace', () => {
    /**
     * Keeps production authentication and private portals without unrelated navigation requests.
     * @param props - Real private content provided by AuthBoundary.
     * @returns The mounted production Agent detail.
     */
    function Workspace({ children }: { children: ReactNode }) {
        return <>{children}</>
    }
    return { Workspace }
})

const firstId = '307511cc-f74c-4702-8088-04737b1b29cb'
const secondId = '91741604-6f55-408f-9fd6-9772d1f7a35a'
const createdAt = '2026-10-17T03:00:00.000Z'
const updatedAt = '2026-10-19T06:00:00.000Z'
const me: AccountMe = {
    storage: 'postgres',
    user: {
        id: 'b1c34b0e-1eec-4647-aacd-eb649e91f6a3',
        username: '详情验收账户',
        email: 'agent-detail@example.invalid',
        createdAt,
        updatedAt,
    },
}
const catalog: AgentCatalog = {
    defaultModelId: 'public-model',
    models: [{ id: 'public-model', label: '公开模型名称', provider: 'openai', available: true }],
    tools: [
        { id: 'calculator', label: '计算器', description: '仅查看配置，不执行工具。' },
        { id: 'current-time', label: '当前时间', description: '仅查看配置，不执行工具。' },
    ],
}
const input: AgentInput = {
    skillRefs: [],
    name: 'SF013 独立详情助手',
    description: '完整简介\n第二行简介',
    modelId: 'public-model',
    systemPrompt: `${'长提示词应完整保留。\n'.repeat(40)}<img src=x onerror="neverRun()">\n最后一行。`,
    toolIds: ['calculator', 'current-time'],
    openingMessages: ['第一条\n第二行', '第二条开场', '第三条开场', '第四条开场', '第五条开场'],
}
const saved: AgentDefinition = { ...input, id: firstId, createdAt, updatedAt }

/**
 * Mounts a URL-selected Agent under the actual account and portal boundary.
 * @param props - Requested Agent identifier.
 * @returns The authenticated production detail without a fake editor or dialog.
 */
function DetailRoute({ id }: { id: string }) {
    return (
        <AuthBoundary>
            <TooltipProvider>
                <AgentEditor agentId={id} />
            </TooltipProvider>
        </AuthBoundary>
    )
}

/**
 * Opens the explicit full editor after the independently loaded detail appears.
 * @param user - Real user-event input controller.
 * @returns The mounted editable name field after focus settles.
 */
async function editDetail(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '编辑 Agent' }))
    const name = await screen.findByLabelText(/^名称/)
    await waitFor(() => expect(document.activeElement).toBe(name))
    return name
}

/**
 * Checks all draft values after a rejected update or account verification recovery.
 * @param expected - Complete expected settings from actual field interactions.
 * @returns Nothing after checking the mounted form and greeting order.
 */
function expectDraft(expected: AgentInput) {
    expect((screen.getByLabelText(/^名称/) as HTMLInputElement).value).toBe(expected.name)
    expect((screen.getByLabelText(/^简介/) as HTMLTextAreaElement).value).toBe(expected.description)
    expect((screen.getByRole('combobox', { name: /LLM 模型/ }) as HTMLSelectElement).value).toBe(expected.modelId)
    expect((screen.getByRole('textbox', { name: /系统提示词/ }) as HTMLTextAreaElement).value).toBe(expected.systemPrompt)
    for (const tool of catalog.tools) {
        expect(screen.getByRole('checkbox', { name: new RegExp(tool.label) }).getAttribute('aria-checked')).toBe(
            expected.toolIds.includes(tool.id) ? 'true' : 'false'
        )
    }
    for (const [index, message] of expected.openingMessages.entries()) {
        expect((screen.getByLabelText(`消息 ${index + 1}`) as HTMLTextAreaElement).value).toBe(message)
    }
}

beforeEach(() => {
    installAcceptanceBrowser()
    for (const mock of Object.values(api)) mock.mockReset()
    api.account.mockResolvedValue(me)
    api.models.mockResolvedValue([])
    api.catalog.mockResolvedValue(catalog)
    api.agents.mockResolvedValue([])
    api.get.mockResolvedValue(saved)
    api.update.mockImplementation(async (id: string, draft: AgentInput) => ({ ...draft, id, createdAt, updatedAt }))
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent Agent detail route', () => {
    it('loads the URL identifier without a list and displays complete saved configuration as text before explicit editing', async () => {
        const view = render(<DetailRoute id={firstId} />)
        await screen.findByRole('heading', { level: 1, name: saved.name })
        expect(api.get).toHaveBeenCalledExactlyOnceWith(firstId, expect.any(AbortSignal))
        expect(api.agents).not.toHaveBeenCalled()
        expect(screen.queryByRole('textbox')).toBeNull()
        expect(screen.queryByRole('combobox')).toBeNull()
        expect(screen.queryByRole('checkbox')).toBeNull()
        expect(screen.getByText('简介').nextElementSibling?.textContent).toBe(saved.description)
        expect(screen.getByText('公开模型名称')).toBeTruthy()
        expect(screen.getByRole('region', { name: '系统提示词' }).textContent).toContain(input.systemPrompt)
        const openings = screen.getByRole('region', { name: '开场消息' })
        expect(
            within(openings)
                .getAllByRole('listitem')
                .map(item => item.textContent)
        ).toEqual(input.openingMessages)
        expect(screen.getByRole('region', { name: '工具' }).textContent).toContain('计算器')
        expect(screen.getByRole('region', { name: '工具' }).textContent).toContain('当前时间')
        const timestamps = Array.from(document.querySelectorAll('time')).map(element => element.dateTime)
        expect(timestamps).toEqual([createdAt, updatedAt])
        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(screen.getByRole('link', { name: '返回 Agents' }).getAttribute('href')).toBe('/agents')
        expect(api.create).not.toHaveBeenCalled()
        expect(api.update).not.toHaveBeenCalled()
        expect(api.push).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()

        const privateModelId = 'account:255f2fae-456b-47ab-bb6b-502642b9fac3'
        const empty = {
            ...saved,
            id: secondId,
            name: '空配置助手',
            modelId: privateModelId,
            description: '',
            systemPrompt: '',
            toolIds: [],
            openingMessages: [],
        }
        api.get.mockResolvedValueOnce(empty)
        view.rerender(<DetailRoute id={secondId} />)
        expect(screen.queryByRole('heading', { name: saved.name })).toBeNull()
        await screen.findByRole('heading', { level: 1, name: empty.name })
        await screen.findByText('个人模型连接不可用')
        expect(document.body.textContent).not.toContain(privateModelId)
        expect(screen.getByRole('region', { name: '系统提示词' }).textContent).toMatch(/默认|未配置/)
        expect(screen.getByRole('region', { name: '开场消息' }).textContent).toMatch(/未配置|暂无/)
        expect(screen.getByRole('region', { name: '工具' }).textContent).toMatch(/未启用|未配置/)
    })

    it('keeps failed and mismatched records out of view, retries only the current ID, and ignores a late response after changing IDs', async () => {
        api.get.mockRejectedValueOnce(new Error('找不到这个 Agent。'))
        const user = userEvent.setup()
        const view = render(<DetailRoute id={firstId} />)
        expect(await screen.findByText('找不到这个 Agent。')).toBeTruthy()
        expect(screen.queryByRole('heading', { name: saved.name })).toBeNull()
        expect(screen.queryByLabelText(/^名称/)).toBeNull()
        expect(screen.getByRole('link', { name: '返回 Agents' }).getAttribute('href')).toBe('/agents')
        api.get.mockRejectedValueOnce(new Error('受控服务故障'))
        await user.click(screen.getByRole('button', { name: '重新连接' }))
        expect(await screen.findByText('受控服务故障')).toBeTruthy()
        api.get.mockResolvedValueOnce({ ...saved, id: secondId, name: '不能显示的错误ID记录' })
        await user.click(screen.getByRole('button', { name: '重新连接' }))
        expect(await screen.findByRole('alert')).toBeTruthy()
        await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3))
        expect(screen.queryByText('不能显示的错误ID记录')).toBeNull()
        expect(screen.queryByRole('button', { name: '编辑 Agent' })).toBeNull()
        expect(api.get.mock.calls.every(call => call[0] === firstId)).toBe(true)

        const late = acceptanceDeferred<AgentDefinition>()
        api.get.mockReturnValueOnce(late.promise)
        await user.click(screen.getByRole('button', { name: '重新连接' }))
        await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4))
        const firstSignal = api.get.mock.lastCall![1] as AbortSignal
        const second = { ...saved, id: secondId, name: '当前B详情' }
        api.get.mockResolvedValueOnce(second)
        view.rerender(<DetailRoute id={secondId} />)
        await screen.findByRole('heading', { level: 1, name: second.name })
        expect(firstSignal.aborted).toBe(true)
        await act(async () => late.resolve(saved))
        expect(screen.getByRole('heading', { level: 1, name: second.name })).toBeTruthy()
        expect(screen.queryByRole('heading', { name: saved.name })).toBeNull()
        expect(api.get.mock.lastCall?.[0]).toBe(secondId)
        expect(api.agents).not.toHaveBeenCalled()
        expect(api.update).not.toHaveBeenCalled()
        expect(api.push).not.toHaveBeenCalled()
    })

    it('validates and serializes full edits once, retains failed or mismatched updates, and publishes only a confirmed matching saved record', async () => {
        const user = userEvent.setup()
        const view = render(<DetailRoute id={firstId} />)
        const name = await editDetail(user)
        expect(screen.queryByRole('list', { name: '创建步骤' })).toBeNull()
        await user.clear(name)
        await user.click(screen.getByRole('button', { name: '保存 Agent' }))
        await waitFor(() => expect(document.activeElement).toBe(name))
        expect(name.getAttribute('aria-invalid')).toBe('true')
        expect(api.update).not.toHaveBeenCalled()
        await user.type(name, '完整编辑后的助手')
        await user.click(screen.getByRole('button', { name: '下移开场消息 1' }))
        const revised = {
            ...input,
            name: '完整编辑后的助手',
            openingMessages: [input.openingMessages[1], input.openingMessages[0], ...input.openingMessages.slice(2)],
        }
        const failed = acceptanceDeferred<AgentDefinition>()
        api.update.mockReturnValueOnce(failed.promise)
        const form = name.closest('form')!
        const save = screen.getByRole('button', { name: '保存 Agent' }) as HTMLButtonElement
        act(() => {
            fireEvent(form, new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: save }))
            fireEvent(form, new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: save }))
        })
        await waitFor(() => expect(api.update).toHaveBeenCalledExactlyOnceWith(firstId, revised))
        expect(name.matches(':disabled')).toBe(true)
        expect((screen.getByRole('button', { name: '取消编辑' }) as HTMLButtonElement).disabled).toBe(true)
        await user.click(screen.getByRole('link', { name: '返回 Agents' }))
        expect(api.push).not.toHaveBeenCalled()
        expect(screen.queryByRole('alertdialog')).toBeNull()
        await act(async () => failed.reject(new Error('受控更新失败')))
        expect(await screen.findByText('受控更新失败')).toBeTruthy()
        expectDraft(revised)
        api.update.mockResolvedValueOnce({ ...saved, ...revised, id: secondId, name: '错误记录不可发布' })
        await user.click(screen.getByRole('button', { name: '保存并开始对话' }))
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2))
        await waitFor(() => expect((screen.getByRole('button', { name: '保存 Agent' }) as HTMLButtonElement).disabled).toBe(false))
        expectDraft(revised)
        expect(screen.queryByRole('heading', { name: '错误记录不可发布' })).toBeNull()
        expect(api.push).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '保存 Agent' }))
        await waitFor(() => expect(screen.queryByLabelText(/^名称/)).toBeNull())
        await screen.findByRole('heading', { level: 1, name: revised.name })
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑 Agent' })))
        expect(screen.getByRole('region', { name: '系统提示词' }).textContent).toContain(revised.systemPrompt)
        expect(
            within(screen.getByRole('region', { name: '开场消息' }))
                .getAllByRole('listitem')
                .map(item => item.textContent)
        ).toEqual(revised.openingMessages)
        expect(api.push).not.toHaveBeenCalled()
        await editDetail(user)
        await user.click(screen.getByRole('button', { name: '保存并开始对话' }))
        await waitFor(() => expect(api.push).toHaveBeenCalledExactlyOnceWith(`/?agent=${firstId}`))
        expect(api.update.mock.lastCall).toEqual([firstId, revised])
        api.push.mockClear()
        await editDetail(user)
        const staleSave = acceptanceDeferred<AgentDefinition>()
        api.update.mockReturnValueOnce(staleSave.promise)
        await user.click(screen.getByRole('button', { name: '保存并开始对话' }))
        const second = { ...saved, id: secondId, name: '切换后的B详情' }
        api.get.mockResolvedValueOnce(second)
        view.rerender(<DetailRoute id={secondId} />)
        await screen.findByRole('heading', { level: 1, name: second.name })
        await act(async () => staleSave.resolve({ ...saved, ...revised }))
        expect(screen.getByRole('heading', { level: 1, name: second.name })).toBeTruthy()
        expect(screen.queryByRole('heading', { level: 1, name: revised.name })).toBeNull()
        expect(api.push).not.toHaveBeenCalled()
        expect(api.create).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
    })

    it('protects dirty cancel and list return, restores the saved baseline only after discard, and keeps the existing browser unload guard', async () => {
        const user = userEvent.setup()
        render(<DetailRoute id={firstId} />)
        await editDetail(user)
        await user.click(screen.getByRole('button', { name: '取消编辑' }))
        expect(screen.queryByRole('alertdialog')).toBeNull()
        expect(screen.queryByLabelText(/^名称/)).toBeNull()
        const name = await editDetail(user)
        await user.type(name, '未保存')
        const expected = { ...input, name: `${input.name}未保存` }
        const unload = new Event('beforeunload', { cancelable: true })
        fireEvent(window, unload)
        expect(unload.defaultPrevented).toBe(true)
        await user.click(screen.getByRole('button', { name: '取消编辑' }))
        const cancel = await screen.findByRole('alertdialog')
        const keep = within(cancel).getByRole('button', { name: '继续编辑' })
        await waitFor(() => expect(document.activeElement).toBe(keep))
        await user.click(keep)
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expectDraft(expected)
        await waitFor(() => expect(document.activeElement).toBe(name))
        await user.click(screen.getByRole('button', { name: '取消编辑' }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '放弃更改' }))
        await waitFor(() => expect(screen.queryByLabelText(/^名称/)).toBeNull())
        expect(screen.getByRole('heading', { level: 1, name: input.name })).toBeTruthy()
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑 Agent' })))
        const cleanUnload = new Event('beforeunload', { cancelable: true })
        fireEvent(window, cleanUnload)
        expect(cleanUnload.defaultPrevented).toBe(false)
        const nextName = await editDetail(user)
        await user.type(nextName, '返回草稿')
        await user.click(screen.getByRole('link', { name: '返回 Agents' }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '继续编辑' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expectDraft({ ...input, name: `${input.name}返回草稿` })
        expect(api.push).not.toHaveBeenCalled()
        await user.click(screen.getByRole('link', { name: '返回 Agents' }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '放弃更改并返回' }))
        await waitFor(() => expect(api.push).toHaveBeenCalledExactlyOnceWith('/agents'))
        expect(api.update).not.toHaveBeenCalled()
        expect(api.create).not.toHaveBeenCalled()
    })

    it('pauses a dirty detail confirmation during account verification, restores the same draft and usable focus, and clears private content on a real 401', async () => {
        const user = userEvent.setup()
        render(<DetailRoute id={firstId} />)
        const name = await editDetail(user)
        await user.type(name, '保留草稿')
        await user.click(screen.getByRole('button', { name: '取消编辑' }))
        const original = await screen.findByRole('alertdialog')
        expect(original.closest('[data-private-workspace]')).not.toBeNull()
        const verification = acceptanceDeferred<AccountMe>()
        api.account.mockReturnValueOnce(verification.promise)
        fireEvent.focus(window)
        await waitFor(() => {
            expect(document.querySelector('[data-private-workspace][inert][aria-hidden="true"]')).not.toBeNull()
            expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull()
        })
        await act(async () => verification.reject(new Error('受控账户连接失败')))
        const reconnect = await screen.findByRole('button', { name: '重新连接账户' })
        await user.click(reconnect)
        const recovered = await screen.findByRole('alertdialog')
        const keep = within(recovered).getByRole('button', { name: '继续编辑' })
        await waitFor(() => expect(document.activeElement).toBe(keep))
        expect(recovered.closest('[data-private-workspace]')).not.toBeNull()
        expect(recovered.closest('[aria-hidden="true"],[inert],[data-base-ui-inert]')).toBeNull()
        await user.click(keep)
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expectDraft({ ...input, name: `${input.name}保留草稿` })
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^名称/)))
        await user.click(screen.getByRole('button', { name: '取消编辑' }))
        await screen.findByRole('alertdialog')
        api.account.mockRejectedValueOnce(Object.assign(new Error('账户会话已失效'), { status: 401 }))
        fireEvent.focus(window)
        await waitFor(() => {
            expect(document.querySelector('[data-private-workspace]')).toBeNull()
            expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull()
            expect(screen.queryByDisplayValue(`${input.name}保留草稿`)).toBeNull()
            expect(screen.queryByRole('heading', { name: input.name })).toBeNull()
        })
        expect(api.update).not.toHaveBeenCalled()
        expect(api.create).not.toHaveBeenCalled()
        expect(api.agents).not.toHaveBeenCalled()
    })
})
