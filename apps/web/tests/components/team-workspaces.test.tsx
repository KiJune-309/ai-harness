// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TeamWorkspace, WorkspaceDetail, WorkspaceDirectory, WorkspaceInvitation } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamWorkspaces, WorkspaceSelector } from '../../components/team-workspaces'
import { TooltipProvider } from '../../components/ui/tooltip'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    invite: vi.fn(),
    respond: vi.fn(),
    revoke: vi.fn(),
    remove: vi.fn(),
    leave: vi.fn(),
    notify: vi.fn(),
    clear: vi.fn(),
}))

vi.mock('../../lib/workspace-client', () => ({
    listWorkspaces: api.list,
    getWorkspace: api.get,
    createWorkspace: api.create,
    switchWorkspace: api.select,
    updateWorkspace: api.update,
    inviteWorkspaceMember: api.invite,
    respondWorkspaceInvitation: api.respond,
    revokeWorkspaceInvitation: api.revoke,
    removeWorkspaceMember: api.remove,
    leaveWorkspace: api.leave,
}))
vi.mock('../../lib/account-session', () => ({ notifyWorkspaceChange: api.notify }))
vi.mock('../../components/account-context', () => ({ useAccount: () => ({ workspaceId: undefined, clearAccount: api.clear }) }))

const now = '2026-10-20T01:00:00.000Z'
const home: TeamWorkspace = {
    id: 'legacy',
    kind: 'legacy',
    name: '默认工作空间',
    description: '',
    role: 'member',
    createdAt: now,
    updatedAt: now,
}
const team: TeamWorkspace = {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'team',
    name: '产品研发',
    description: '团队说明',
    role: 'owner',
    createdAt: now,
    updatedAt: now,
}
const invitation: WorkspaceInvitation = {
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: team.id,
    workspaceName: team.name,
    workspaceDescription: team.description,
    email: 'member@example.test',
    inviterName: '团队拥有者',
    status: 'pending',
    createdAt: now,
    expiresAt: '2026-10-27T01:00:00.000Z',
}
const ownerId = '33333333-3333-4333-8333-333333333333'
const memberId = '44444444-4444-4444-8444-444444444444'

/**
 * Builds an owner or member detail fixture with the same real component contract.
 * @param role - Current caller role.
 * @returns Safe team metadata, actual member identities and owner-only invite records.
 */
function detail(role: 'owner' | 'member' = 'owner'): WorkspaceDetail {
    return {
        workspace: { ...team, role },
        members: [
            { userId: ownerId, name: '团队拥有者', email: 'owner@example.test', role: 'owner', joinedAt: now },
            { userId: memberId, name: '真实成员', email: 'member@example.test', role: 'member', joinedAt: now },
        ],
        invitations: role === 'owner' ? [invitation] : [],
    }
}

beforeEach(() => {
    installAcceptanceBrowser(390)
    for (const mock of Object.values(api)) mock.mockReset()
    api.list.mockResolvedValue({ currentId: home.id, workspaces: [home, team], invitations: [] } satisfies WorkspaceDirectory)
    api.get.mockResolvedValue(detail())
    api.create.mockResolvedValue(team)
    api.select.mockResolvedValue(undefined)
    api.update.mockResolvedValue(team)
    api.invite.mockResolvedValue(invitation)
    api.respond.mockResolvedValue(undefined)
    api.revoke.mockResolvedValue(undefined)
    api.remove.mockResolvedValue(undefined)
    api.leave.mockResolvedValue(undefined)
})

afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent real workspace form and dialog interactions at 390px', () => {
    it('refreshes received invitations on window focus and manual refresh and releases its listener on unmount', async () => {
        const user = userEvent.setup()
        const rendered = render(<TeamWorkspaces />)
        await screen.findByText('默认空间不开放成员管理。')
        expect(screen.queryByText('收到的邀请')).toBeNull()
        expect(screen.queryByText('目前没有等待处理的工作空间邀请。')).toBeNull()
        expect(screen.queryByRole('region', { name: '工作空间邀请' })).toBeNull()
        api.list.mockResolvedValue({ currentId: home.id, workspaces: [home, team], invitations: [invitation] })
        fireEvent.focus(window)
        expect(await screen.findByRole('button', { name: '接受邀请' })).toBeTruthy()
        expect(api.list).toHaveBeenCalledTimes(2)
        await user.click(screen.getByRole('button', { name: '刷新工作空间' }))
        await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3))
        rendered.unmount()
        fireEvent.focus(window)
        expect(api.list).toHaveBeenCalledTimes(3)
    })

    it('keeps failed creation fields and request identity, then refreshes without switching or clearing the current page', async () => {
        const user = userEvent.setup()
        const save = acceptanceDeferred<TeamWorkspace>()
        api.create.mockReturnValueOnce(save.promise)
        const href = window.location.href
        render(
            <>
                <input aria-label="当前页面未保存的内容" defaultValue="创建前的私人草稿" />
                <TeamWorkspaces />
            </>
        )
        await screen.findByText('默认空间不开放成员管理。')
        await user.click(screen.getByRole('button', { name: '创建工作空间' }))
        const dialog = await screen.findByRole('dialog', { name: '创建工作空间' })
        const name = within(dialog).getByLabelText('名称')
        const description = within(dialog).getByLabelText('说明（选填）')
        await user.type(name, '产品研发')
        await user.type(description, '保留的创建说明')
        const submit = within(dialog).getByRole('button', { name: /^创建(工作空间)?$/ })
        await user.dblClick(submit)
        expect(api.create).toHaveBeenCalledTimes(1)
        expect(api.select).not.toHaveBeenCalled()
        expect(api.notify).not.toHaveBeenCalled()
        expect((submit as HTMLButtonElement).disabled).toBe(true)
        expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
        await act(async () => save.reject(new Error('数据库暂时不可用')))
        expect(await within(dialog).findByText('数据库暂时不可用')).toBeTruthy()
        expect((name as HTMLInputElement).value).toBe('产品研发')
        expect((description as HTMLTextAreaElement).value).toBe('保留的创建说明')
        const original = api.create.mock.calls[0]![0]
        await user.click(within(dialog).getByRole('button', { name: /^创建(工作空间)?$/ }))
        const done = await within(dialog).findByRole('button', { name: '完成' })
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: '工作空间已创建' })))
        expect(within(dialog).getByText(team.name)).toBeTruthy()
        expect(within(dialog).getByText(team.description)).toBeTruthy()
        expect(dialog.querySelector('form, input, textarea')).toBeNull()
        expect(within(dialog).queryByRole('button', { name: /^创建(工作空间)?$/ })).toBeNull()
        expect(within(dialog).queryByRole('button', { name: /进入/ })).toBeNull()
        expect(api.create.mock.calls[1]![0]).toEqual(original)
        await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
        expect(api.create).toHaveBeenCalledTimes(2)
        expect(api.select).not.toHaveBeenCalled()
        expect(api.notify).not.toHaveBeenCalled()
        expect(window.location.href).toBe(href)
        expect((screen.getByLabelText('当前页面未保存的内容') as HTMLInputElement).value).toBe('创建前的私人草稿')
        await user.click(done)
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(screen.getByText('默认空间不开放成员管理。')).toBeTruthy()
        await user.click(screen.getByRole('button', { name: '创建工作空间' }))
        const reopened = await screen.findByRole('dialog', { name: '创建工作空间' })
        expect((within(reopened).getByLabelText('名称') as HTMLInputElement).value).toBe('')
        expect((within(reopened).getByLabelText('说明（选填）') as HTMLTextAreaElement).value).toBe('')
        expect(within(reopened).queryByRole('button', { name: '完成' })).toBeNull()
        expect(within(reopened).queryByText('数据库暂时不可用')).toBeNull()
        expect(api.create).toHaveBeenCalledTimes(2)
        await user.type(within(reopened).getByLabelText('名称'), '产品研发')
        await user.type(within(reopened).getByLabelText('说明（选填）'), '保留的创建说明')
        await user.click(within(reopened).getByRole('button', { name: /^创建(工作空间)?$/ }))
        await within(reopened).findByRole('button', { name: '完成' })
        expect(api.create).toHaveBeenCalledTimes(3)
        expect(api.create.mock.calls[2]![0]).toEqual({ ...original, requestId: expect.any(String) })
        expect(api.create.mock.calls[2]![0].requestId).not.toBe(original.requestId)
        expect(api.select).not.toHaveBeenCalled()
        expect(api.notify).not.toHaveBeenCalled()
    })

    it('uses the same create-only dialog from the sidebar without navigating or changing its active workspace', async () => {
        const user = userEvent.setup()
        const onNavigate = vi.fn()
        const href = window.location.href
        api.list.mockResolvedValue({ currentId: home.id, workspaces: [home], invitations: [] })
        render(<WorkspaceSelector onNavigate={onNavigate} />)
        await user.click(await screen.findByRole('button', { name: `工作空间：${home.name}` }))
        await user.click(await screen.findByRole('menuitem', { name: '创建工作空间' }))
        const dialog = await screen.findByRole('dialog', { name: '创建工作空间' })
        await user.type(within(dialog).getByLabelText('名称'), '侧栏创建的新空间')
        api.list.mockResolvedValue({ currentId: home.id, workspaces: [home, team], invitations: [] })
        await user.click(within(dialog).getByRole('button', { name: /^创建(工作空间)?$/ }))
        const done = await within(dialog).findByRole('button', { name: '完成' })
        expect(dialog.querySelector('form, input, textarea')).toBeNull()
        expect(within(dialog).queryByRole('button', { name: /^创建(工作空间)?$/ })).toBeNull()
        await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3))
        expect(api.create).toHaveBeenCalledExactlyOnceWith({ name: '侧栏创建的新空间', description: '', requestId: expect.any(String) })
        expect(api.select).not.toHaveBeenCalled()
        expect(api.notify).not.toHaveBeenCalled()
        expect(onNavigate).not.toHaveBeenCalled()
        expect(window.location.href).toBe(href)
        await user.click(done)
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(screen.getByRole('button', { name: `工作空间：${home.name}` })).toBeTruthy()
    })

    it('retains a confirmed creation when directory refresh fails and retries only the directory read', async () => {
        const user = userEvent.setup()
        api.list
            .mockResolvedValueOnce({ currentId: home.id, workspaces: [home], invitations: [] })
            .mockRejectedValueOnce(new Error('目录刷新失败，请重新载入'))
            .mockResolvedValue({ currentId: home.id, workspaces: [home, team], invitations: [] })
        render(<TeamWorkspaces />)
        await screen.findByText('默认空间不开放成员管理。')
        await user.click(screen.getByRole('button', { name: '创建工作空间' }))
        const dialog = await screen.findByRole('dialog', { name: '创建工作空间' })
        await user.type(within(dialog).getByLabelText('名称'), team.name)
        await user.click(within(dialog).getByRole('button', { name: /^创建(工作空间)?$/ }))
        const done = await within(dialog).findByRole('button', { name: '完成' })
        expect(await screen.findByText('目录刷新失败，请重新载入')).toBeTruthy()
        expect(dialog.querySelector('form, input, textarea')).toBeNull()
        expect(api.create).toHaveBeenCalledTimes(1)
        await user.click(done)
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        await user.click(screen.getByRole('button', { name: '重新载入' }))
        await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3))
        await waitFor(() => expect(screen.queryByText('目录刷新失败，请重新载入')).toBeNull())
        expect(screen.getByText('默认空间不开放成员管理。')).toBeTruthy()
        expect(api.create).toHaveBeenCalledTimes(1)
        expect(api.select).not.toHaveBeenCalled()
        expect(api.notify).not.toHaveBeenCalled()
    })

    it('shows local field errors with focus and preserves the default-space boundary', async () => {
        const user = userEvent.setup()
        render(<TeamWorkspaces />)
        await screen.findByText('默认空间不开放成员管理。')
        expect(screen.queryByRole('button', { name: '退出工作空间' })).toBeNull()
        expect(screen.queryByLabelText('同事的注册邮箱')).toBeNull()
        await user.click(screen.getByRole('button', { name: '创建工作空间' }))
        const dialog = await screen.findByRole('dialog')
        const name = within(dialog).getByLabelText('名称')
        const description = within(dialog).getByLabelText('说明（选填）')
        fireEvent.change(name, { target: { value: ' '.repeat(2) } })
        fireEvent.submit(name.closest('form')!)
        await waitFor(() => expect(document.activeElement).toBe(name))
        expect(name.getAttribute('aria-invalid')).toBe('true')
        expect(within(dialog).getByText('请填写工作空间名称。')).toBeTruthy()
        fireEvent.change(name, { target: { value: '有效名称' } })
        fireEvent.change(description, { target: { value: '说'.repeat(501) } })
        fireEvent.submit(name.closest('form')!)
        await waitFor(() => expect(document.activeElement).toBe(description))
        expect(description.getAttribute('aria-invalid')).toBe('true')
        expect(within(dialog).getByText('工作空间说明最多 500 个字。')).toBeTruthy()
        expect(api.create).not.toHaveBeenCalled()
    })

    it('shows inviter context and accepts without switching, then makes entering an explicit cancellable action', async () => {
        const user = userEvent.setup()
        const response = acceptanceDeferred<void>()
        api.list.mockResolvedValue({ currentId: home.id, workspaces: [home, team], invitations: [invitation] })
        api.respond.mockReturnValueOnce(response.promise)
        render(
            <TooltipProvider>
                <TeamWorkspaces />
            </TooltipProvider>
        )
        expect(await screen.findByText('团队拥有者 邀请你加入')).toBeTruthy()
        expect(screen.getByText('团队说明')).toBeTruthy()
        expect(screen.getByText(/有效期至/)).toBeTruthy()
        expect(screen.queryByText('收到的邀请')).toBeNull()
        const accept = screen.getByRole('button', { name: '接受邀请' })
        const decline = screen.getByRole('button', { name: '拒绝邀请' })
        expect(accept.textContent?.trim()).toBe('')
        expect(decline.textContent?.trim()).toBe('')
        await user.keyboard('{Tab}{Tab}{Tab}')
        expect(document.activeElement).toBe(accept)
        const acceptTooltip = await screen.findByText('接受邀请')
        expect(acceptTooltip.getAttribute('data-slot')).toBe('tooltip-content')
        expect(acceptTooltip.hasAttribute('data-open')).toBe(true)
        await user.dblClick(accept)
        expect(api.respond).toHaveBeenCalledExactlyOnceWith(invitation.id, true)
        expect((accept as HTMLButtonElement).disabled).toBe(true)
        expect((decline as HTMLButtonElement).disabled).toBe(true)
        await user.click(decline)
        expect(api.respond).toHaveBeenCalledTimes(1)
        expect(screen.queryByText('已加入')).toBeNull()
        expect(api.select).not.toHaveBeenCalled()
        api.list.mockResolvedValue({ currentId: home.id, workspaces: [home, team], invitations: [] })
        await act(async () => response.resolve())
        expect(await screen.findByText('已加入')).toBeTruthy()
        expect(api.select).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '进入工作空间' }))
        const confirmation = await screen.findByRole('alertdialog')
        const cancel = within(confirmation).getByRole('button', { name: '留在当前空间' })
        await waitFor(() => expect(document.activeElement).toBe(cancel))
        await user.click(cancel)
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(api.select).not.toHaveBeenCalled()
    })

    it('keeps icon invitation actions retryable after failure and hides the whole invitation area after declining the last card', async () => {
        const user = userEvent.setup()
        const response = acceptanceDeferred<void>()
        api.list.mockResolvedValue({ currentId: home.id, workspaces: [home, team], invitations: [invitation] })
        api.respond.mockReturnValueOnce(response.promise)
        render(
            <TooltipProvider>
                <TeamWorkspaces />
            </TooltipProvider>
        )
        const decline = await screen.findByRole('button', { name: '拒绝邀请' })
        const accept = screen.getByRole('button', { name: '接受邀请' })
        await user.keyboard('{Tab}{Tab}{Tab}{Tab}')
        expect(document.activeElement).toBe(decline)
        const declineTooltip = await screen.findByText('拒绝邀请')
        expect(declineTooltip.getAttribute('data-slot')).toBe('tooltip-content')
        expect(declineTooltip.hasAttribute('data-open')).toBe(true)
        await user.dblClick(decline)
        expect(api.respond).toHaveBeenCalledExactlyOnceWith(invitation.id, false)
        expect((accept as HTMLButtonElement).disabled).toBe(true)
        expect((decline as HTMLButtonElement).disabled).toBe(true)
        await act(async () => response.reject(new Error('拒绝未保存，请重试')))
        expect(await screen.findByText('拒绝未保存，请重试')).toBeTruthy()
        expect((accept as HTMLButtonElement).disabled).toBe(false)
        expect((decline as HTMLButtonElement).disabled).toBe(false)
        api.list.mockResolvedValue({ currentId: home.id, workspaces: [home, team], invitations: [] })
        await user.click(decline)
        await waitFor(() => expect(api.respond).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(screen.queryByRole('button', { name: '拒绝邀请' })).toBeNull())
        expect(api.respond.mock.calls[1]).toEqual([invitation.id, false])
        expect(screen.queryByText('团队拥有者 邀请你加入')).toBeNull()
        expect(screen.queryByText('收到的邀请')).toBeNull()
        expect(screen.queryByText('目前没有等待处理的工作空间邀请。')).toBeNull()
        expect(screen.queryByRole('region', { name: '工作空间邀请' })).toBeNull()
        expect(api.select).not.toHaveBeenCalled()
        expect(api.notify).not.toHaveBeenCalled()
    })

    it('shows the description below the team name without a duplicate information block and retains member-management controls', async () => {
        const user = userEvent.setup()
        api.list.mockResolvedValue({ currentId: team.id, workspaces: [home, team], invitations: [] })
        render(<TeamWorkspaces />)
        const information = await screen.findByRole('region', { name: '工作空间详情' })
        const title = await within(information).findByRole('heading', { name: team.name })
        expect(title.nextElementSibling?.textContent).toBe(team.description)
        expect(within(information).queryByText('基本信息')).toBeNull()
        expect(screen.queryByRole('button', { name: '保存信息' })).toBeNull()
        expect(screen.queryByLabelText('名称')).toBeNull()
        expect(screen.getByRole('button', { name: '邀请成员' })).toBeTruthy()
        expect(screen.getByRole('button', { name: '移除成员 真实成员' })).toBeTruthy()
        expect(api.update).not.toHaveBeenCalled()
        api.get.mockResolvedValueOnce({ ...detail(), invitations: [] })
        await user.click(screen.getByRole('button', { name: `撤销邀请 ${invitation.email}` }))
        expect(api.revoke).toHaveBeenCalledExactlyOnceWith(team.id, invitation.id)
        expect(await screen.findByText('邀请已撤销。')).toBeTruthy()
        await waitFor(() => expect(screen.queryByRole('button', { name: `撤销邀请 ${invitation.email}` })).toBeNull())
        expect(api.update).not.toHaveBeenCalled()
    })

    it('normalizes invitation email, preserves failed input and confirms actual member removal with cancel focused', async () => {
        const user = userEvent.setup()
        api.list.mockResolvedValue({ currentId: team.id, workspaces: [home, team], invitations: [] })
        api.invite.mockRejectedValueOnce(new Error('该邮箱尚未注册'))
        render(<TeamWorkspaces />)
        const email = await screen.findByLabelText('同事的注册邮箱')
        await user.type(email, 'NEXT@EXAMPLE.TEST')
        await user.click(screen.getByRole('button', { name: '邀请成员' }))
        expect(await screen.findByText('该邮箱尚未注册')).toBeTruthy()
        expect((email as HTMLInputElement).value).toBe('next@example.test')
        expect(api.invite).toHaveBeenCalledWith(team.id, { email: 'next@example.test', requestId: expect.any(String) })
        expect(screen.queryByRole('button', { name: '退出工作空间' })).toBeNull()
        expect(screen.queryByRole('button', { name: '移除成员 团队拥有者' })).toBeNull()
        await user.click(screen.getByRole('button', { name: '移除成员 真实成员' }))
        const confirmation = await screen.findByRole('alertdialog', { name: '移除“真实成员”？' })
        expect(within(confirmation).getByText(/member@example.test/)).toBeTruthy()
        const cancel = within(confirmation).getByRole('button', { name: '取消' })
        await waitFor(() => expect(document.activeElement).toBe(cancel))
        await user.click(cancel)
        expect(api.remove).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '移除成员 真实成员' }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认移除' }))
        await waitFor(() => expect(api.remove).toHaveBeenCalledExactlyOnceWith(team.id, memberId))
    })

    it('gives members read-only details and retains a failed leave confirmation without a false redirect', async () => {
        const user = userEvent.setup()
        api.list.mockResolvedValue({ currentId: team.id, workspaces: [home, { ...team, role: 'member' }], invitations: [] })
        api.get.mockResolvedValue(detail('member'))
        api.leave.mockRejectedValueOnce(new Error('退出未保存，请重试'))
        render(<TeamWorkspaces />)
        const leave = await screen.findByRole('button', { name: '退出工作空间' })
        expect(screen.queryByLabelText('名称')).toBeNull()
        expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull()
        expect(screen.queryByRole('button', { name: '移除成员 真实成员' })).toBeNull()
        await user.click(leave)
        const confirmation = await screen.findByRole('alertdialog', { name: `退出“${team.name}”？` })
        await waitFor(() => expect(document.activeElement).toBe(within(confirmation).getByRole('button', { name: '取消' })))
        await user.click(within(confirmation).getByRole('button', { name: '确认退出' }))
        expect(await within(confirmation).findByText('退出未保存，请重试')).toBeTruthy()
        expect(api.notify).not.toHaveBeenCalled()
        await user.click(within(confirmation).getByRole('button', { name: '确认退出' }))
        await waitFor(() => expect(api.notify).toHaveBeenCalledTimes(1))
        expect(api.leave).toHaveBeenCalledTimes(2)
    })

    it('uses the shared selector with a full accessible name, role labels, short identifiers and explicit switch confirmation', async () => {
        const user = userEvent.setup()
        const name = '用于测试完整可访问名称的团队'.repeat(3)
        api.list.mockResolvedValue({ currentId: team.id, workspaces: [home, { ...team, name }], invitations: [invitation] })
        render(<WorkspaceSelector onNavigate={vi.fn()} />)
        const trigger = await screen.findByRole('button', { name: `工作空间：${name}` })
        await user.click(trigger)
        expect(await screen.findByRole('menuitem', { name: /工作空间与成员/ })).toBeTruthy()
        expect(screen.getByText(`拥有者 · ${team.id.slice(0, 8)}`)).toBeTruthy()
        await user.click(screen.getByRole('menuitem', { name: /默认工作空间/ }))
        const confirmation = await screen.findByRole('alertdialog', { name: '切换到“默认工作空间”？' })
        await user.click(within(confirmation).getByRole('button', { name: '确认切换' }))
        await waitFor(() => expect(api.select).toHaveBeenCalledExactlyOnceWith(home.id))
        expect(api.notify).toHaveBeenCalledTimes(1)
    })
})
