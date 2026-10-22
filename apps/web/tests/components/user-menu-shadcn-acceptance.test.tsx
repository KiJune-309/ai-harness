// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserMenu } from '../../components/user-menu'
import { PrivatePortalProvider } from '../../components/private-portal'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../../components/ui/sheet'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const fixture = vi.hoisted(() => ({
    username: '很长的真实账户名称用于验证菜单可访问名称不被截断',
    clear: vi.fn(),
    logout: vi.fn(),
    panel: vi.fn(),
    navigate: vi.fn(),
    signedOut: vi.fn(),
}))

vi.mock('../../components/account-context', () => ({
    useAccount: () => ({ user: { username: fixture.username }, clearAccount: fixture.clear }),
}))
vi.mock('../../lib/account-client', () => ({ logoutAccount: fixture.logout }))

/**
 * Mounts the real shared user menu in a test-owned authenticated portal target.
 * @returns Testing Library controls and the menu's private host.
 */
function renderMenu() {
    const host = document.createElement('div')
    document.body.append(host)
    const view = render(
        <PrivatePortalProvider container={host}>
            <UserMenu onOpenPanel={fixture.panel} onNavigate={fixture.navigate} onSignedOut={fixture.signedOut} />
        </PrivatePortalProvider>,
        { container: host }
    )
    return { ...view, host }
}

/**
 * Exercises real menu, sheet, and dialog primitives together without routing or backend side effects.
 * @returns A controlled mobile navigation and informational panel using the production user menu.
 */
function MobileMenuLayers() {
    const [open, setOpen] = useState(false)
    const [panel, setPanel] = useState<'plugins' | 'help' | null>(null)
    return (
        <>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger render={<Button />}>打开移动导航</SheetTrigger>
                <SheetContent>
                    <SheetTitle>移动导航</SheetTitle>
                    <SheetDescription>同一账户菜单的隔离移动交互验收。</SheetDescription>
                    <UserMenu
                        onOpenPanel={value => {
                            setOpen(false)
                            setPanel(value)
                        }}
                        onNavigate={() => setOpen(false)}
                        onSignedOut={fixture.signedOut}
                    />
                </SheetContent>
            </Sheet>
            <Dialog open={panel !== null} onOpenChange={value => !value && setPanel(null)}>
                <DialogContent>
                    <DialogTitle>{panel === 'help' ? '使用帮助说明' : '插件能力说明'}</DialogTitle>
                    <DialogDescription>隔离测试说明，不代表新的业务能力。</DialogDescription>
                </DialogContent>
            </Dialog>
        </>
    )
}

/**
 * Mounts the real mobile overlay layers under one account-owned container.
 * @returns Nothing; installs the test-owned component tree.
 */
function renderMobileMenu(): void {
    installAcceptanceBrowser(390)
    const host = document.createElement('div')
    document.body.append(host)
    render(
        <PrivatePortalProvider container={host}>
            <MobileMenuLayers />
        </PrivatePortalProvider>,
        { container: host }
    )
}

beforeEach(() => {
    installAcceptanceBrowser()
    fixture.username = '很长的真实账户名称用于验证菜单可访问名称不被截断'
    for (const callback of [fixture.clear, fixture.logout, fixture.panel, fixture.navigate, fixture.signedOut]) callback.mockReset()
    fixture.logout.mockResolvedValue(undefined)
})

afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent shadcn authenticated avatar menu', () => {
    it('uses one fully named avatar trigger, all five existing actions, real links, and the private portal container', async () => {
        const user = userEvent.setup()
        const { host } = renderMenu()
        const trigger = screen.getByRole('button', { name: `${fixture.username}的用户菜单` })
        expect(screen.queryByRole('menu')).toBeNull()
        expect(screen.queryByRole('button', { name: '更多' })).toBeNull()
        expect(screen.queryByRole('link', { name: '账户设置' })).toBeNull()
        await user.click(trigger)
        const menu = await screen.findByRole('menu')
        expect(host.contains(menu)).toBe(true)
        expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
            '账户设置',
            '组件展示',
            '插件与能力',
            '使用帮助',
            '退出登录',
        ])
        expect(screen.getByRole('menuitem', { name: '账户设置' }).getAttribute('href')).toBe('/account')
        expect(screen.getByRole('menuitem', { name: '组件展示' }).getAttribute('href')).toBe('/components')
        expect(host.querySelector('button button,button a,a button,a a')).toBeNull()
        expect(fixture.logout).not.toHaveBeenCalled()
    })

    it('supports Enter, Home/End, arrow movement and keyboard selection without leaving a stale menu', async () => {
        const user = userEvent.setup()
        renderMenu()
        const trigger = screen.getByRole('button', { name: /的用户菜单$/ })
        trigger.focus()
        await user.keyboard('{Enter}')
        await screen.findByRole('menu')
        await user.keyboard('{Home}')
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '账户设置' })))
        await user.keyboard('{End}')
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '退出登录' })))
        await user.keyboard('{ArrowUp}{Enter}')
        await waitFor(() => expect(fixture.panel).toHaveBeenCalledExactlyOnceWith('help'))
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        expect(fixture.logout).not.toHaveBeenCalled()
    })

    it('supports Space opening and Escape dismissal with focus restored to the avatar trigger', async () => {
        const user = userEvent.setup()
        renderMenu()
        const trigger = screen.getByRole('button', { name: /的用户菜单$/ })
        trigger.focus()
        await user.keyboard(' ')
        await screen.findByRole('menu')
        await user.keyboard('{ArrowDown}{Escape}')
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(trigger))
        expect(fixture.panel).not.toHaveBeenCalled()
    })

    it('updates the full accessible username after a verified profile change', async () => {
        const user = userEvent.setup()
        const { rerender, host } = renderMenu()
        fixture.username = '😀修改后的账户名称'
        rerender(
            <PrivatePortalProvider container={host}>
                <UserMenu onOpenPanel={fixture.panel} onNavigate={fixture.navigate} onSignedOut={fixture.signedOut} />
            </PrivatePortalProvider>
        )
        expect(screen.queryByRole('button', { name: /很长的真实账户/ })).toBeNull()
        const renamedTrigger = screen.getByRole('button', { name: '😀修改后的账户名称的用户菜单' })
        expect(renamedTrigger.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('😀')
        await user.click(renamedTrigger)
        expect(await screen.findByRole('menu')).toBeTruthy()
        expect(fixture.logout).not.toHaveBeenCalled()
    })

    it('keeps the account after delayed logout failure, prevents duplicate requests, then clears only after confirmed retry', async () => {
        const user = userEvent.setup()
        const first = acceptanceDeferred<void>()
        fixture.logout.mockReturnValueOnce(first.promise)
        renderMenu()
        const trigger = screen.getByRole('button', { name: /的用户菜单$/ })
        await user.click(trigger)
        const logout = await screen.findByRole('menuitem', { name: '退出登录' })
        fireEvent.click(logout)
        fireEvent.click(logout)
        expect(fixture.logout).toHaveBeenCalledTimes(1)
        expect(fixture.clear).not.toHaveBeenCalled()
        expect(fixture.signedOut).not.toHaveBeenCalled()
        await waitFor(() => expect(trigger.hasAttribute('disabled') || trigger.getAttribute('aria-disabled') === 'true').toBe(true))
        await act(async () => first.reject(new Error('受控退出失败，请重试')))
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('受控退出失败'))
        expect(fixture.clear).not.toHaveBeenCalled()
        expect(fixture.signedOut).not.toHaveBeenCalled()
        expect(trigger.hasAttribute('disabled')).toBe(false)
        await user.click(trigger)
        await user.click(await screen.findByRole('menuitem', { name: '退出登录' }))
        await waitFor(() => expect(fixture.logout).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(fixture.clear).toHaveBeenCalledTimes(1))
        expect(fixture.signedOut).toHaveBeenCalledTimes(1)
    })

    it('dismisses the nested mobile menu before its sheet and restores focus at both keyboard layers', async () => {
        const user = userEvent.setup()
        renderMobileMenu()
        const opener = screen.getByRole('button', { name: '打开移动导航' })
        await user.click(opener)
        await screen.findByRole('dialog', { name: '移动导航' })
        const avatar = screen.getByRole('button', { name: /的用户菜单$/ })
        await user.click(avatar)
        await screen.findByRole('menu')
        await user.keyboard('{ArrowDown}{Escape}')
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        expect(screen.getByRole('dialog', { name: '移动导航' })).toBeTruthy()
        await waitFor(() => expect(document.activeElement).toBe(avatar))
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog', { name: '移动导航' })).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(opener))
        expect(document.querySelector('[data-slot="sheet-overlay"],[data-slot="dropdown-menu-content"]')).toBeNull()
    })

    it('transitions from a mobile account menu into help without leaving the sheet or menu overlay behind', async () => {
        const user = userEvent.setup()
        renderMobileMenu()
        await user.click(screen.getByRole('button', { name: '打开移动导航' }))
        await screen.findByRole('dialog', { name: '移动导航' })
        await user.click(screen.getByRole('button', { name: /的用户菜单$/ }))
        await user.click(await screen.findByRole('menuitem', { name: '使用帮助' }))
        await screen.findByRole('dialog', { name: '使用帮助说明' })
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '移动导航' })).toBeNull()
            expect(screen.queryByRole('menu')).toBeNull()
            expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
        })
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(document.querySelector('[data-slot="dialog-overlay"],[data-slot="sheet-overlay"]')).toBeNull()
    })
})
