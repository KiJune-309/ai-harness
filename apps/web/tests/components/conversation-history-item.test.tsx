// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationHistoryItem } from '../../components/conversation-history-item'
import { PrivatePortalProvider } from '../../components/private-portal'
import { SidebarProvider, SidebarMenu } from '../../components/ui/sidebar'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({ remove: vi.fn() }))
vi.mock('../../lib/chat-client', () => ({ deleteConversation: api.remove }))
const conversation = {
    id: '642f7bcd-c9ce-4ac0-985a-45b1e8378a79',
    title: '需要删除的聊天',
    messages: [],
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
}

/**
 * Mounts the actual sidebar row inside its authorized confirmation portal.
 * @param onDeleted - Observer called only after a durable deletion receipt.
 * @param onSelect - Observer for ordinary conversation navigation.
 * @returns The mounted row's testing controls.
 */
function mount(onDeleted = vi.fn(), onSelect = vi.fn()) {
    const host = document.createElement('div')
    document.body.append(host)
    return render(
        <PrivatePortalProvider container={host}>
            <SidebarProvider>
                <SidebarMenu>
                    <ConversationHistoryItem conversation={conversation} isActive={false} onSelect={onSelect} onDeleted={onDeleted} />
                </SidebarMenu>
            </SidebarProvider>
        </PrivatePortalProvider>,
        { container: host }
    )
}

beforeEach(() => {
    installAcceptanceBrowser()
    api.remove.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
})

describe('sidebar conversation deletion', () => {
    it('requires explicit confirmation and never selects or removes the chat when cancelling', async () => {
        const user = userEvent.setup()
        const selected = vi.fn()
        mount(vi.fn(), selected)
        await user.click(screen.getByRole('button', { name: `删除对话“${conversation.title}”` }))
        expect(screen.getByRole('alertdialog')).toBeTruthy()
        expect(api.remove).not.toHaveBeenCalled()
        expect(selected).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '取消' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(api.remove).not.toHaveBeenCalled()
    })

    it('keeps the confirmation and row on failure, then removes only the confirmed identity after a retry', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<void>()
        api.remove.mockRejectedValueOnce(new Error('服务暂时不可用')).mockReturnValueOnce(pending.promise)
        const deleted = vi.fn()
        mount(deleted)
        await user.click(screen.getByRole('button', { name: `删除对话“${conversation.title}”` }))
        await user.click(screen.getByRole('button', { name: '删除对话' }))
        await screen.findByText('服务暂时不可用')
        expect(screen.getByRole('alertdialog')).toBeTruthy()
        expect(deleted).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '删除对话' }))
        expect(screen.getByRole('button', { name: '正在删除…' }).hasAttribute('disabled')).toBe(true)
        expect(api.remove).toHaveBeenNthCalledWith(2, conversation.id)
        pending.resolve()
        await waitFor(() => expect(deleted).toHaveBeenCalledExactlyOnceWith(conversation.id))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    })
})
