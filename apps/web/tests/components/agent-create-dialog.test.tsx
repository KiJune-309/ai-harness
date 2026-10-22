// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountMe, AgentCatalog, AgentDefinition, AgentInput } from '@ai-harness/contracts'
import { agentInputSchema } from '@ai-harness/contracts'
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

vi.mock('next/navigation', () => ({ usePathname: () => '/agents', useRouter: () => ({ push: api.push }) }))
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
     * Keeps the actual authentication and portal boundaries while excluding unrelated shell requests.
     * @param props - Private route children passed by the real account boundary.
     * @returns The actual Agent editor without a replacement dialog implementation.
     */
    function Workspace({ children }: { children: ReactNode }) {
        return <>{children}</>
    }
    return { Workspace }
})

const time = '2026-10-18T00:00:00.000Z'
const savedId = '9fd957a5-180c-42df-8ae0-2a94e625635c'
const createdId = 'a37082ce-203f-4968-9a37-d2e0de86cc19'
const me: AccountMe = {
    storage: 'postgres',
    user: {
        id: '55cbdb10-93ef-4602-927b-6fd720e092a1',
        username: '弹窗验收账户',
        email: 'agent-dialog@example.invalid',
        createdAt: time,
        updatedAt: time,
    },
}
const catalog: AgentCatalog = {
    defaultModelId: 'stable-default-model',
    models: [
        { id: 'stable-default-model', label: '默认连接', provider: 'deepseek', available: true },
        { id: 'stable-other-model', label: '个人连接名称', provider: 'openai', available: true },
    ],
    tools: [
        { id: 'calculator', label: '计算器', description: '仅配置，不执行计算。' },
        { id: 'current-time', label: '当前时间', description: '仅配置，不调用工具。' },
    ],
}
const saved: AgentDefinition = {
    id: savedId,
    name: '已保存的原助手',
    description: '原始简介',
    modelId: 'stable-default-model',
    systemPrompt: '原始角色',
    toolIds: [],
    openingMessages: [],
    createdAt: time,
    updatedAt: time,
}
const fullInput: AgentInput = {
    skillRefs: [],
    name: 'SF011 独立创建助手',
    description: '不包含秘密的完整配置',
    modelId: 'stable-other-model',
    systemPrompt: '先说明已知事实。\n资料不足时明确说明。',
    toolIds: ['calculator', 'current-time'],
    openingMessages: ['第二条开场', '第一条开场', '第三条开场', '第四条开场', '第五条开场'],
}

/**
 * Mounts the production editor under the actual authenticated private portal provider.
 * @returns Testing-library handles for the mounted route.
 */
function mountEditor() {
    return render(
        <AuthBoundary>
            <TooltipProvider>
                <AgentEditor />
            </TooltipProvider>
        </AuthBoundary>
    )
}

/**
 * Opens the real creation entry and waits for its initial focus transition.
 * @param user - Real user-event input controller.
 * @returns The visible production shadcn creation dialog.
 */
async function openCreation(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '新建 Agent' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText(/^名称/)))
    return dialog
}

/**
 * Verifies that step focus survives the primitive's queued restoration frames.
 * @param target - Mounted field or heading belonging to the visible step.
 * @returns After checking focus without moving it on behalf of the production component.
 */
async function expectSettledStepFocus(target: HTMLElement) {
    await waitFor(() => expect(document.activeElement).toBe(target))
    await act(async () => {
        await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
    })
    expect(document.activeElement).toBe(target)
}

/**
 * Fills all editable configuration through actual shared input, select, checkbox and ordering controls.
 * @param user - Real user-event input controller.
 * @param dialog - The visible production creation popup.
 * @returns After the complete non-secret configuration and greeting order have been entered.
 */
async function fillCreation(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    const fields = within(dialog)
    await user.type(fields.getByLabelText(/^名称/), fullInput.name)
    await user.type(fields.getByLabelText(/^简介/), fullInput.description)
    await user.selectOptions(fields.getByRole('combobox', { name: /LLM 模型/ }), fullInput.modelId)
    await user.click(fields.getByRole('button', { name: '下一步' }))
    expect(fields.queryByLabelText(/^名称/)).toBeNull()
    await expectSettledStepFocus(fields.getByRole('textbox', { name: /系统提示词/ }))
    await user.type(fields.getByRole('textbox', { name: /系统提示词/ }), fullInput.systemPrompt)
    await user.click(fields.getByRole('checkbox', { name: /计算器/ }))
    await user.click(fields.getByRole('checkbox', { name: /当前时间/ }))
    await user.click(fields.getByRole('button', { name: '下一步' }))
    expect(fields.queryByRole('textbox', { name: /系统提示词/ })).toBeNull()
    await expectSettledStepFocus(fields.getByRole('heading', { name: '开场消息与确认' }))
    await user.click(fields.getByRole('button', { name: /添加开场消息/ }))
    await user.type(fields.getByLabelText('消息 1'), '第一条开场')
    await user.click(fields.getByRole('button', { name: /添加开场消息/ }))
    await user.type(fields.getByLabelText('消息 2'), '第二条开场')
    await user.click(fields.getByRole('button', { name: '上移开场消息 2' }))
    await user.click(fields.getByRole('button', { name: /添加开场消息/ }))
    await user.type(fields.getByLabelText('消息 3'), '应当被移除的开场')
    await user.click(fields.getByRole('button', { name: '删除开场消息 3' }))
    for (let index = 2; index < fullInput.openingMessages.length; index++) {
        await user.click(fields.getByRole('button', { name: /添加开场消息/ }))
        await user.type(fields.getByLabelText(`消息 ${index + 1}`), fullInput.openingMessages[index])
    }
    expect((fields.getByRole('button', { name: /添加开场消息/ }) as HTMLButtonElement).disabled).toBe(true)
}

/**
 * Checks the draft without reading implementation state or substituting API success for user interaction.
 * @param user - Real user-event input controller.
 * @param dialog - Actual popup currently displaying the confirmation step.
 * @returns After navigating back through the actual steps, checking all values, and returning to confirmation.
 */
async function expectCompleteDraft(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    const fields = within(dialog)
    for (let index = 0; index < fullInput.openingMessages.length; index++) {
        expect((fields.getByLabelText(`消息 ${index + 1}`) as HTMLTextAreaElement).value).toBe(fullInput.openingMessages[index])
    }
    await user.click(fields.getByRole('button', { name: '上一步' }))
    await expectSettledStepFocus(fields.getByRole('textbox', { name: /系统提示词/ }))
    expect((fields.getByRole('textbox', { name: /系统提示词/ }) as HTMLTextAreaElement).value).toBe(fullInput.systemPrompt)
    expect(fields.getByRole('checkbox', { name: /计算器/ }).getAttribute('aria-checked')).toBe('true')
    expect(fields.getByRole('checkbox', { name: /当前时间/ }).getAttribute('aria-checked')).toBe('true')
    await user.click(fields.getByRole('button', { name: '上一步' }))
    await expectSettledStepFocus(fields.getByLabelText(/^名称/))
    expect((fields.getByLabelText(/^名称/) as HTMLInputElement).value).toBe(fullInput.name)
    expect((fields.getByLabelText(/^简介/) as HTMLTextAreaElement).value).toBe(fullInput.description)
    expect((fields.getByRole('combobox', { name: /LLM 模型/ }) as HTMLSelectElement).value).toBe(fullInput.modelId)
    await user.click(fields.getByRole('button', { name: '下一步' }))
    await expectSettledStepFocus(fields.getByRole('textbox', { name: /系统提示词/ }))
    await user.click(fields.getByRole('button', { name: '下一步' }))
    await expectSettledStepFocus(fields.getByLabelText('消息 1'))
    for (let index = 0; index < fullInput.openingMessages.length; index++) {
        expect((fields.getByLabelText(`消息 ${index + 1}`) as HTMLTextAreaElement).value).toBe(fullInput.openingMessages[index])
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
    api.create.mockImplementation(async (input: AgentInput) => ({ ...input, id: createdId, createdAt: time, updatedAt: time }))
    api.update.mockImplementation(async (id: string, input: AgentInput) => ({ ...input, id, createdAt: time, updatedAt: time }))
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent Agent creation dialog lifecycle', () => {
    it('starts with a real list or empty state and only mounts a single named form after an explicit creation action', async () => {
        const user = userEvent.setup()
        mountEditor()
        const trigger = await screen.findByRole('button', { name: '新建 Agent' })
        expect(screen.queryByLabelText(/^名称/)).toBeNull()
        expect(screen.queryByRole('dialog')).toBeNull()
        const dialog = await openCreation(user)
        expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
        expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
        expect(dialog.closest('[data-private-workspace]')).not.toBeNull()
        expect(document.querySelectorAll('#agent-name').length).toBe(1)
        expect(within(dialog).queryByLabelText(/API key|密钥/i)).toBeNull()
        await user.click(within(dialog).getByRole('button', { name: '取消' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(trigger))
        await openCreation(user)
        expect(api.create).not.toHaveBeenCalled()
        expect(api.update).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
    })

    it('keeps validation and first-error focus within the popup and does not create an invalid name or greeting', async () => {
        const user = userEvent.setup()
        mountEditor()
        const dialog = await openCreation(user)
        const name = within(dialog).getByLabelText(/^名称/)
        await user.click(within(dialog).getByRole('button', { name: '下一步' }))
        await waitFor(() => expect(document.activeElement).toBe(name))
        expect(name.getAttribute('aria-invalid')).toBe('true')
        expect(api.create).not.toHaveBeenCalled()
        await user.type(name, '有效的名称')
        await user.click(within(dialog).getByRole('button', { name: '下一步' }))
        await user.click(within(dialog).getByRole('button', { name: '下一步' }))
        await user.click(within(dialog).getByRole('button', { name: /添加开场消息/ }))
        const opening = within(dialog).getByLabelText('消息 1')
        await user.click(within(dialog).getByRole('button', { name: '确定创建' }))
        await waitFor(() => expect(document.activeElement).toBe(opening))
        expect(opening.getAttribute('aria-invalid')).toBe('true')
        expect(api.create).not.toHaveBeenCalled()
        expect(api.push).not.toHaveBeenCalled()
    })

    it('never creates from early submit or composing Enter, keeps step headings read-only, and preserves multiline input', async () => {
        const user = userEvent.setup()
        mountEditor()
        const dialog = await openCreation(user)
        const fields = within(dialog)
        const progress = fields.getByRole('list', { name: '创建步骤' })
        expect(within(progress).queryByRole('button')).toBeNull()
        expect(within(progress).queryByRole('link')).toBeNull()
        await user.click(within(progress).getByText('开场消息与确认'))
        const name = fields.getByLabelText(/^名称/)
        expect(fields.queryByRole('textbox', { name: /系统提示词/ })).toBeNull()
        name.focus()
        await user.keyboard('{Enter}')
        fireEvent.submit(name.closest('form')!)
        await waitFor(() => expect(document.activeElement).toBe(name))
        expect(name.getAttribute('aria-invalid')).toBe('true')
        expect(api.create).not.toHaveBeenCalled()
        await user.type(name, '键盘分步助手')
        fireEvent.keyDown(name, { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
        fireEvent.keyUp(name, { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
        expect(fields.queryByRole('textbox', { name: /系统提示词/ })).toBeNull()
        await user.keyboard('{Enter}')
        expect(api.create).not.toHaveBeenCalled()
        if (fields.queryByLabelText(/^名称/)) await user.click(fields.getByRole('button', { name: '下一步' }))
        const prompt = fields.getByRole('textbox', { name: /系统提示词/ })
        await user.type(prompt, '第一行{Enter}第二行')
        expect((prompt as HTMLTextAreaElement).value).toBe('第一行\n第二行')
        expect(fields.queryByLabelText('消息 1')).toBeNull()
        expect(api.create).not.toHaveBeenCalled()
        fireEvent.change(prompt, { target: { value: 'x'.repeat(32_001) } })
        await user.click(fields.getByRole('button', { name: '下一步' }))
        await waitFor(() => expect(document.activeElement).toBe(prompt))
        expect(prompt.getAttribute('aria-invalid')).toBe('true')
        expect(fields.queryByRole('button', { name: '确定创建' })).toBeNull()
        expect(api.create).not.toHaveBeenCalled()
        fireEvent.change(prompt, { target: { value: '第一行\n第二行' } })
        fireEvent.submit(prompt.closest('form')!)
        await waitFor(() => expect(fields.getByRole('button', { name: '确定创建' })).toBeTruthy())
        expect(fields.queryByRole('textbox', { name: /系统提示词/ })).toBeNull()
        expect(api.create).not.toHaveBeenCalled()
        fireEvent.submit(dialog.querySelector('form')!)
        expect(api.create).not.toHaveBeenCalled()
        expect(screen.getByRole('dialog')).toBe(dialog)
        expect(api.push).not.toHaveBeenCalled()
    })

    it('routes a controlled final-schema rejection to an earlier mounted field and refreshes the complete confirmation without losing later data', async () => {
        const user = userEvent.setup()
        mountEditor()
        const dialog = await openCreation(user)
        await fillCreation(user, dialog)
        const summary = within(dialog).getByRole('complementary', { name: '完整配置摘要' })
        expect(summary.textContent).toContain(fullInput.name)
        expect(summary.textContent).toContain(fullInput.systemPrompt)
        expect(summary.textContent).toContain('个人连接名称')
        for (const message of fullInput.openingMessages) expect(summary.textContent).toContain(message)
        const rejectedEarlierField = agentInputSchema.safeParse({ ...fullInput, name: '' })
        expect(rejectedEarlierField.success).toBe(false)
        const finalConfirm = within(dialog).getByRole('button', { name: '确定创建' })
        act(() => finalConfirm.focus())
        const validation = vi.spyOn(agentInputSchema, 'safeParse').mockReturnValueOnce(rejectedEarlierField)
        await user.click(finalConfirm)
        const name = await within(dialog).findByLabelText(/^名称/)
        await expectSettledStepFocus(name)
        expect(name.getAttribute('aria-invalid')).toBe('true')
        expect(within(dialog).queryByLabelText('消息 1')).toBeNull()
        expect(api.create).not.toHaveBeenCalled()
        validation.mockRestore()
        await user.clear(name)
        await user.type(name, '重新核对后的助手')
        await user.click(within(dialog).getByRole('button', { name: '下一步' }))
        expect((within(dialog).getByRole('textbox', { name: /系统提示词/ }) as HTMLTextAreaElement).value).toBe(fullInput.systemPrompt)
        await user.click(within(dialog).getByRole('button', { name: '下一步' }))
        const refreshed = within(dialog).getByRole('complementary', { name: '完整配置摘要' })
        expect(refreshed.textContent).toContain('重新核对后的助手')
        expect(refreshed.textContent).toContain(fullInput.systemPrompt)
        for (let index = 0; index < fullInput.openingMessages.length; index++) {
            expect((within(dialog).getByLabelText(`消息 ${index + 1}`) as HTMLTextAreaElement).value).toBe(fullInput.openingMessages[index])
        }
        expect(api.create).not.toHaveBeenCalled()
    })

    it('serializes complete configuration, blocks in-flight duplicate and close paths, preserves failed drafts, and only publishes a confirmed result', async () => {
        const first = acceptanceDeferred<AgentDefinition>()
        const retry = acceptanceDeferred<AgentDefinition>()
        api.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
        const user = userEvent.setup()
        mountEditor()
        const dialog = await openCreation(user)
        await fillCreation(user, dialog)
        await expectCompleteDraft(user, dialog)
        const form = within(dialog).getByLabelText('消息 1').closest('form')!
        const confirm = within(dialog).getByRole('button', { name: '确定创建' }) as HTMLButtonElement
        act(() => {
            fireEvent(form, new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: confirm }))
            fireEvent(form, new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: confirm }))
        })
        await waitFor(() => expect(api.create).toHaveBeenCalledExactlyOnceWith(fullInput))
        expect((within(dialog).getByRole('button', { name: '正在创建' }) as HTMLButtonElement).disabled).toBe(true)
        expect(within(dialog).getByLabelText('消息 1').matches(':disabled')).toBe(true)
        expect((within(dialog).getByRole('button', { name: '上一步' }) as HTMLButtonElement).disabled).toBe(true)
        expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
        const close = within(dialog).getByRole('button', { name: /^Close$|关闭/ }) as HTMLButtonElement
        expect(close.disabled).toBe(true)
        await user.click(close)
        await user.keyboard('{Escape}')
        const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!
        await user.click(overlay)
        expect(screen.getByRole('dialog')).toBe(dialog)
        expect(screen.queryByRole('alertdialog')).toBeNull()
        expect(screen.queryByRole('link', { name: fullInput.name })).toBeNull()
        expect(api.create).toHaveBeenCalledTimes(1)
        expect(api.push).not.toHaveBeenCalled()

        await act(async () => first.reject(new Error('受控创建失败，请重试。')))
        expect(await within(dialog).findByText('受控创建失败，请重试。')).toBeTruthy()
        await expectCompleteDraft(user, dialog)
        expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false)
        await user.click(within(dialog).getByRole('button', { name: '确定创建' }))
        await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2))
        expect(api.create.mock.lastCall?.[0]).toEqual(fullInput)
        expect(screen.getByRole('dialog')).toBe(dialog)
        expect(screen.queryByRole('link', { name: fullInput.name })).toBeNull()
        const confirmed = { ...fullInput, name: '服务端确认后的名称', id: createdId, createdAt: time, updatedAt: time }
        await act(async () => retry.resolve(confirmed))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        const created = await screen.findByRole('link', { name: confirmed.name })
        expect(created.getAttribute('href')).toBe(`/agents/${createdId}`)
        expect(screen.queryByLabelText(/^名称/)).toBeNull()
        expect(document.querySelectorAll('#agent-name').length).toBe(0)
        expect(api.update).not.toHaveBeenCalled()
        expect(api.push).toHaveBeenCalledExactlyOnceWith(`/agents/${createdId}`)
        expect(fetch).not.toHaveBeenCalled()
        await openCreation(user)
        expect((screen.getByRole('dialog').querySelector('#agent-name') as HTMLInputElement).value).toBe('')
    })

    // This case walks all four real close paths and rereads the complete three-step draft after each one.
    it('protects one complete dirty draft through each close path and only resets it after explicit discard', async () => {
        const user = userEvent.setup()
        mountEditor()
        const dialog = await openCreation(user)
        await fillCreation(user, dialog)
        await user.click(within(dialog).getByRole('button', { name: '上一步' }))
        for (const action of ['cancel', 'escape', 'close', 'backdrop'] as const) {
            if (action === 'cancel') await user.click(within(dialog).getByRole('button', { name: '取消' }))
            else if (action === 'escape') await user.keyboard('{Escape}')
            else if (action === 'close') await user.click(within(dialog).getByRole('button', { name: /^Close$|关闭/ }))
            else await user.click(document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!)
            const confirmation = await screen.findByRole('alertdialog')
            const keep = within(confirmation).getByRole('button', { name: /继续填写|继续编辑/ })
            await waitFor(() => expect(document.activeElement).toBe(keep))
            await user.click(keep)
            await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
            if (action === 'cancel') {
                expect((within(dialog).getByRole('textbox', { name: /系统提示词/ }) as HTMLTextAreaElement).value).toBe(
                    fullInput.systemPrompt
                )
                expect(within(dialog).queryByLabelText('消息 1')).toBeNull()
                await expectSettledStepFocus(within(dialog).getByRole('textbox', { name: /系统提示词/ }))
                await user.click(within(dialog).getByRole('button', { name: '下一步' }))
            }
            await expectCompleteDraft(user, screen.getByRole('dialog'))
            await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
        }
        await user.click(within(dialog).getByRole('button', { name: '取消' }))
        const discard = await screen.findByRole('alertdialog')
        await user.click(within(discard).getByRole('button', { name: /放弃/ }))
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull()
            expect(screen.queryByRole('alertdialog')).toBeNull()
        })
        const trigger = screen.getByRole('button', { name: '新建 Agent' })
        await waitFor(() => expect(document.activeElement).toBe(trigger))
        const fresh = await openCreation(user)
        expect((within(fresh).getByLabelText(/^名称/) as HTMLInputElement).value).toBe('')
        expect((within(fresh).getByRole('combobox', { name: /LLM 模型/ }) as HTMLSelectElement).value).toBe(catalog.defaultModelId)
        expect(within(fresh).queryByLabelText('消息 1')).toBeNull()
        await user.type(within(fresh).getByLabelText(/^名称/), '重开后的干净助手')
        await user.click(within(fresh).getByRole('button', { name: '下一步' }))
        expect(
            within(fresh)
                .getByRole('checkbox', { name: /计算器/ })
                .getAttribute('aria-checked')
        ).toBe('false')
        expect(api.create).not.toHaveBeenCalled()
        expect(api.update).not.toHaveBeenCalled()
    }, 15_000)

    it('links saved square cards to their own detail routes without mounting an inline editor or changing a saved Agent during creation', async () => {
        api.agents.mockResolvedValue([saved])
        const user = userEvent.setup()
        mountEditor()
        const card = await screen.findByRole('link', { name: saved.name })
        expect(card.getAttribute('href')).toBe(`/agents/${savedId}`)
        expect(within(card).queryByRole('button')).toBeNull()
        expect(screen.queryByLabelText(/^名称/)).toBeNull()
        expect(screen.queryByRole('button', { name: '保存 Agent' })).toBeNull()
        expect(api.get).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '新建 Agent' }))
        const creation = await screen.findByRole('dialog')
        await waitFor(() => expect(document.activeElement).toBe(within(creation).getByLabelText(/^名称/)))
        expect((within(creation).getByLabelText(/^名称/) as HTMLInputElement).value).toBe('')
        expect(document.querySelectorAll('#agent-name').length).toBe(1)
        await user.click(within(creation).getByRole('button', { name: '取消' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(screen.getByRole('link', { name: saved.name }).getAttribute('href')).toBe(`/agents/${savedId}`)
        expect(screen.queryByLabelText(/^名称/)).toBeNull()
        expect(api.create).not.toHaveBeenCalled()
        expect(api.update).not.toHaveBeenCalled()
        expect(api.push).not.toHaveBeenCalled()
    })

    it('suspends nested creation portals on verification failure, restores the same draft and focus, and clears every private layer on session loss', async () => {
        const user = userEvent.setup()
        mountEditor()
        const dialog = await openCreation(user)
        await fillCreation(user, dialog)
        await user.click(within(dialog).getByRole('button', { name: '取消' }))
        const confirmation = await screen.findByRole('alertdialog')
        await waitFor(() => expect(confirmation.contains(document.activeElement)).toBe(true))
        expect(dialog.closest('[data-slot="dialog-portal"]')?.contains(confirmation)).toBe(true)
        expect(confirmation.closest('[data-private-workspace]')).not.toBeNull()
        const verification = acceptanceDeferred<AccountMe>()
        api.account.mockReturnValueOnce(verification.promise)
        fireEvent.focus(window)
        await waitFor(() => {
            expect(document.querySelector('[data-private-workspace][inert][aria-hidden="true"]')).not.toBeNull()
            expect(document.querySelector('[data-slot="dialog-content"],[data-slot="alert-dialog-content"]')).toBeNull()
        })
        await act(async () => verification.reject(new Error('受控账户连接失败')))
        const reconnect = await screen.findByRole('button', { name: '重新连接账户' })
        expect(reconnect.closest('[inert]')).toBeNull()
        await user.click(reconnect)
        const recovered = await screen.findByRole('alertdialog')
        await waitFor(() => expect(recovered.contains(document.activeElement)).toBe(true))
        expect(document.querySelector('[data-slot="dialog-portal"]')?.contains(recovered)).toBe(true)
        expect(recovered.closest('[data-private-workspace]')).not.toBeNull()
        expect(recovered.closest('[aria-hidden="true"],[inert],[data-base-ui-inert]')).toBeNull()
        await user.click(within(recovered).getByRole('button', { name: /继续填写|继续编辑/ }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        const restored = await screen.findByRole('dialog')
        expect((within(restored).getByLabelText('消息 1') as HTMLInputElement).value).toBe(fullInput.openingMessages[0])
        expect(within(restored).queryByLabelText(/^名称/)).toBeNull()
        await expectSettledStepFocus(within(restored).getByLabelText('消息 1'))
        expect(restored.closest('[data-private-workspace]')).not.toBeNull()
        expect(restored.closest('[inert]')).toBeNull()
        await user.click(within(restored).getByRole('button', { name: '取消' }))
        await screen.findByRole('alertdialog')
        fireEvent(window, new Event('harness:unauthorized'))
        await waitFor(() => {
            expect(document.querySelector('[data-private-workspace]')).toBeNull()
            expect(document.querySelector('[data-slot="dialog-content"],[data-slot="alert-dialog-content"]')).toBeNull()
            expect(screen.queryByDisplayValue(fullInput.openingMessages[0])).toBeNull()
        })
        expect(api.create).not.toHaveBeenCalled()
        expect(api.update).not.toHaveBeenCalled()
    })
})
