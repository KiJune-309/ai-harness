// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountMe } from '@ai-harness/contracts'
import { AuthBoundary } from '../../components/auth-boundary'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const fixture = vi.hoisted(() => ({
    pathname: '/account',
    account: vi.fn(),
    models: vi.fn(),
    layer: 'menu' as 'menu' | 'dialog' | 'sheet',
    cancelClosing: false,
    dialogChanges: vi.fn(),
}))

vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname }))
vi.mock('../../lib/account-client', () => ({ getAccount: fixture.account, listAccountModels: fixture.models }))
vi.mock('../../components/workspace', async () => {
    const React = await import('react')
    const { Button } = await import('../../components/ui/button')
    const { Input } = await import('../../components/ui/input')
    const { Label } = await import('../../components/ui/label')
    const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } = await import('../../components/ui/dropdown-menu')
    const { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } = await import('../../components/ui/dialog')
    const { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } = await import('../../components/ui/sheet')

    /**
     * Mounts real shared overlay components under the actual authentication boundary without unrelated data requests.
     * @returns A non-secret draft and an initially closed menu, dialog, or sheet.
     */
    function Workspace() {
        const [draft, setDraft] = React.useState('')
        return (
            <main>
                <Label htmlFor="acceptance-draft">未提交草稿</Label>
                <Input id="acceptance-draft" value={draft} onChange={event => setDraft(event.target.value)} />
                {fixture.layer === 'menu' ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger render={<Button />}>打开私有菜单</DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem>旧账户浮层内容</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : fixture.layer === 'dialog' ? (
                    <Dialog
                        onOpenChange={(open, details) => {
                            fixture.dialogChanges(open, details)
                            if (!open && fixture.cancelClosing) details.cancel()
                        }}
                    >
                        <DialogTrigger render={<Button />}>打开私有对话框</DialogTrigger>
                        <DialogContent>
                            <DialogTitle>旧账户浮层内容</DialogTitle>
                            <DialogDescription>隔离的非秘密确认信息。</DialogDescription>
                            <Button>私有操作</Button>
                        </DialogContent>
                    </Dialog>
                ) : (
                    <Sheet>
                        <SheetTrigger render={<Button />}>打开私有抽屉</SheetTrigger>
                        <SheetContent>
                            <SheetTitle>旧账户浮层内容</SheetTitle>
                            <SheetDescription>隔离的非秘密导航信息。</SheetDescription>
                            <Button>私有操作</Button>
                        </SheetContent>
                    </Sheet>
                )}
            </main>
        )
    }
    return { Workspace }
})

const me: AccountMe = {
    storage: 'postgres',
    user: {
        id: 'a88e0720-49d6-4c5c-8a94-6640dd107afd',
        username: '验收账户',
        email: 'acceptance@example.invalid',
        createdAt: '2026-10-18T00:00:00.000Z',
        updatedAt: '2026-10-18T00:00:00.000Z',
    },
}

beforeEach(() => {
    installAcceptanceBrowser()
    fixture.pathname = '/account'
    fixture.account.mockReset().mockResolvedValue(me)
    fixture.models.mockReset().mockResolvedValue([])
    fixture.cancelClosing = false
    fixture.dialogChanges.mockReset()
    localStorage.clear()
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent shadcn private portal authorization', () => {
    it('opens the exact public landing route without verifying an account or mounting the private workspace', () => {
        fixture.pathname = '/landing'
        render(<AuthBoundary>公开产品介绍</AuthBoundary>)
        expect(screen.getByText('公开产品介绍')).toBeTruthy()
        expect(screen.queryByLabelText('未提交草稿')).toBeNull()
        expect(fixture.account).not.toHaveBeenCalled()
        expect(fixture.models).not.toHaveBeenCalled()
        fireEvent.focus(window)
        expect(fixture.account).not.toHaveBeenCalled()
    })

    it.each(['/', '/landing/private', '/landing-old'])('keeps %s behind real account verification', async pathname => {
        fixture.pathname = pathname
        const initial = acceptanceDeferred<AccountMe>()
        fixture.account.mockReturnValueOnce(initial.promise)
        render(<AuthBoundary>私有业务内容</AuthBoundary>)
        expect(fixture.account).toHaveBeenCalledTimes(1)
        expect(screen.queryByText('私有业务内容')).toBeNull()
        expect(screen.queryByLabelText('未提交草稿')).toBeNull()
        await act(async () => initial.resolve(me))
        expect(await screen.findByRole('textbox', { name: '未提交草稿' })).toBeTruthy()
    })

    for (const layer of ['menu', 'dialog', 'sheet'] as const) {
        it(`suspends the real ${layer} portal during pending verification and service failure while retaining the draft on same-account recovery`, async () => {
            fixture.layer = layer
            const user = userEvent.setup()
            render(<AuthBoundary>业务内容</AuthBoundary>)
            const draft = await screen.findByRole('textbox', { name: '未提交草稿' })
            await user.type(draft, '只在当前表单中的草稿')
            await user.click(screen.getByRole('button', { name: /打开私有/ }))
            const privateContent = await screen.findByText('旧账户浮层内容')
            expect(privateContent.closest('main')).toBeNull()

            const verification = acceptanceDeferred<AccountMe>()
            fixture.account.mockReturnValueOnce(verification.promise)
            fireEvent.focus(window)
            await waitFor(() => {
                const visibleContent = screen.queryByText('旧账户浮层内容')
                if (visibleContent) {
                    expect(visibleContent.closest('[inert][aria-hidden="true"]')).not.toBeNull()
                } else expect(screen.getByDisplayValue('只在当前表单中的草稿').closest('[inert]')).not.toBeNull()
            })
            await act(async () => verification.reject(new Error('受控账户连接故障')))
            const reconnect = await screen.findByRole('button', { name: '重新连接账户' })
            expect(reconnect.closest('[inert]')).toBeNull()
            expect(reconnect.closest('[aria-hidden="true"]')).toBeNull()
            reconnect.focus()
            await waitFor(() => expect(document.activeElement).toBe(reconnect))
            await user.click(reconnect)
            await waitFor(() => expect(screen.queryByText('受控账户连接故障')).toBeNull())
            expect((draft as HTMLInputElement).value).toBe('只在当前表单中的草稿')
            expect(document.body.contains(draft)).toBe(true)
            expect(draft.closest('[inert]')).toBeNull()
            const recoveredPopup = await screen.findByRole(layer === 'menu' ? 'menu' : 'dialog')
            await waitFor(() => expect(recoveredPopup.contains(document.activeElement)).toBe(true))
            await user.keyboard('{Escape}')
            await waitFor(() => expect(screen.queryByText('旧账户浮层内容')).toBeNull())
            expect((screen.getByRole('textbox', { name: '未提交草稿' }) as HTMLInputElement).value).toBe('只在当前表单中的草稿')
        })

        it(`unmounts every private ${layer} node immediately on an unauthorized response`, async () => {
            fixture.layer = layer
            const user = userEvent.setup()
            render(<AuthBoundary>业务内容</AuthBoundary>)
            await screen.findByRole('textbox', { name: '未提交草稿' })
            await user.click(screen.getByRole('button', { name: /打开私有/ }))
            await screen.findByText('旧账户浮层内容')
            fireEvent(window, new Event('harness:unauthorized'))
            await waitFor(() => {
                expect(screen.queryByText('旧账户浮层内容')).toBeNull()
                expect(screen.queryByLabelText('未提交草稿')).toBeNull()
                expect(
                    document.querySelector('[data-slot="dropdown-menu-content"],[data-slot="dialog-content"],[data-slot="sheet-content"]')
                ).toBeNull()
            })
        })
    }

    it('does not mount private UI before the first real account check completes', async () => {
        fixture.layer = 'menu'
        const initial = acceptanceDeferred<AccountMe>()
        fixture.account.mockReturnValueOnce(initial.promise)
        render(<AuthBoundary>业务内容</AuthBoundary>)
        expect(screen.queryByLabelText('未提交草稿')).toBeNull()
        expect(document.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull()
        await act(async () => initial.resolve(me))
        expect(await screen.findByRole('textbox', { name: '未提交草稿' })).toBeTruthy()
    })

    it('clears an open portal after a real cross-tab identity epoch and never reuses the former draft', async () => {
        fixture.layer = 'menu'
        const user = userEvent.setup()
        render(<AuthBoundary>业务内容</AuthBoundary>)
        await user.type(await screen.findByRole('textbox', { name: '未提交草稿' }), '旧账户未提交内容')
        await user.click(screen.getByRole('button', { name: '打开私有菜单' }))
        await screen.findByText('旧账户浮层内容')
        fireEvent(
            window,
            new StorageEvent('storage', { key: 'ai-harness.account-session-epoch', newValue: '5838bf61-9042-46ae-a66e-a9e5652b3e1c' })
        )
        await waitFor(() => {
            expect(screen.queryByText('旧账户浮层内容')).toBeNull()
            expect(screen.queryByDisplayValue('旧账户未提交内容')).toBeNull()
        })
    })

    it('rejects a different verified account before it can inherit the former workspace or open portal', async () => {
        fixture.layer = 'dialog'
        const user = userEvent.setup()
        render(<AuthBoundary>业务内容</AuthBoundary>)
        await user.type(await screen.findByRole('textbox', { name: '未提交草稿' }), '不能给另一账户的草稿')
        await user.click(screen.getByRole('button', { name: '打开私有对话框' }))
        await screen.findByText('旧账户浮层内容')
        fixture.account.mockResolvedValueOnce({
            ...me,
            user: { ...me.user, id: 'c9d37d20-97cc-4adc-8b01-738c731b6efd', username: '另一个账户' },
        })
        fireEvent.focus(window)
        await waitFor(() => {
            expect(screen.queryByText('旧账户浮层内容')).toBeNull()
            expect(screen.queryByLabelText('未提交草稿')).toBeNull()
            expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
        })
    })

    it('discards restored browser snapshots and their portals before rechecking the live cookie', async () => {
        fixture.layer = 'sheet'
        const user = userEvent.setup()
        render(<AuthBoundary>业务内容</AuthBoundary>)
        await user.type(await screen.findByRole('textbox', { name: '未提交草稿' }), '缓存快照中不可继续信任的草稿')
        await user.click(screen.getByRole('button', { name: '打开私有抽屉' }))
        await screen.findByText('旧账户浮层内容')
        const verification = acceptanceDeferred<AccountMe>()
        fixture.account.mockReturnValueOnce(verification.promise)
        fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }))
        await waitFor(() => {
            expect(screen.queryByText('旧账户浮层内容')).toBeNull()
            expect(screen.queryByLabelText('未提交草稿')).toBeNull()
            expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
        })
        await act(async () => verification.resolve(me))
        const draft = (await screen.findByRole('textbox', { name: '未提交草稿' })) as HTMLInputElement
        expect(draft.value).toBe('')
        expect(screen.queryByText('旧账户浮层内容')).toBeNull()
    })

    it('preserves the primitive cancellation details for an uncontrolled dialog close', async () => {
        fixture.layer = 'dialog'
        fixture.cancelClosing = true
        const user = userEvent.setup()
        render(<AuthBoundary>业务内容</AuthBoundary>)
        await screen.findByRole('textbox', { name: '未提交草稿' })
        await user.click(screen.getByRole('button', { name: '打开私有对话框' }))
        const dialog = await screen.findByRole('dialog')
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
        await user.keyboard('{Escape}')
        expect(screen.getByRole('dialog')).toBe(dialog)
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
        expect(fixture.dialogChanges.mock.lastCall?.[0]).toBe(false)
        expect(fixture.dialogChanges.mock.lastCall?.[1].isCanceled).toBe(true)
        expect(fixture.dialogChanges.mock.lastCall?.[1].event).toBeInstanceOf(KeyboardEvent)
        fixture.cancelClosing = false
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })
})
