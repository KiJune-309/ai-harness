// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState, type ReactNode } from 'react'
import type { AccountMe, AccountModel } from '@ai-harness/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthBoundary } from '../../components/auth-boundary'
import { useAccount } from '../../components/account-context'
import { observeWorkspaceResponse, setVerifiedWorkspace, workspaceHeaders } from '../../lib/workspace-context'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({ account: vi.fn(), models: vi.fn(), unmount: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/agents/detail' }))
vi.mock('../../lib/account-client', () => ({ getAccount: api.account, listAccountModels: api.models }))
vi.mock('../../components/workspace', () => {
    /**
     * Preserves the production authentication boundary while omitting unrelated navigation data.
     * @param props - Real private descendants owned by AuthBoundary.
     * @returns The original private descendants.
     */
    function Workspace({ children }: { children: ReactNode }) {
        return <>{children}</>
    }
    return { Workspace }
})

const now = '2026-10-20T01:00:00.000Z'
const me: AccountMe = {
    storage: 'postgres',
    workspaceId: 'old-team',
    user: {
        id: '15151515-1515-4515-8515-151515151515',
        username: 'Workspace owner',
        email: 'scope@example.test',
        createdAt: now,
        updatedAt: now,
    },
}

/**
 * Gives the actual boundary a stateful private descendant whose destruction can be observed.
 * @returns A controlled unsent draft and the boundary's real model-name projection.
 */
function PrivatePane() {
    const account = useAccount()
    const [draft, setDraft] = useState('')
    useEffect(() => () => api.unmount(), [])
    return (
        <div>
            <label htmlFor="scope-draft">未发送草稿</label>
            <input id="scope-draft" value={draft} onChange={event => setDraft(event.target.value)} />
            <p>{account.workspaceId}</p>
            <p>{account.modelLabel('account:51515151-5151-4151-8151-515151515151')}</p>
        </div>
    )
}

beforeEach(() => {
    installAcceptanceBrowser()
    api.account.mockReset().mockResolvedValue(me)
    api.models.mockReset().mockResolvedValue([])
    api.unmount.mockReset()
    setVerifiedWorkspace(undefined)
    localStorage.clear()
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setVerifiedWorkspace(undefined)
})

describe('independent active workspace authentication races', () => {
    it('makes the old form inert during foreground verification and unmounts it when the same user now has another workspace', async () => {
        const user = userEvent.setup()
        render(
            <AuthBoundary>
                <PrivatePane />
            </AuthBoundary>
        )
        const input = await screen.findByLabelText('未发送草稿')
        await user.type(input, '只属于旧空间的未发送内容')
        localStorage.setItem('ai-harness.active-conversation', 'old-private-id')
        const verification = acceptanceDeferred<AccountMe>()
        api.account.mockReturnValueOnce(verification.promise)
        fireEvent.focus(window)
        await waitFor(() => expect(document.querySelector('[data-private-workspace][inert][aria-hidden="true"]')).not.toBeNull())
        expect((input as HTMLInputElement).value).toBe('只属于旧空间的未发送内容')
        const redirect = vi.spyOn(window, 'setTimeout').mockReturnValueOnce(0 as unknown as ReturnType<typeof setTimeout>)
        await act(async () => verification.resolve({ ...me, workspaceId: 'new-team' }))
        await waitFor(() => expect(screen.queryByLabelText('未发送草稿')).toBeNull())
        expect(api.unmount).toHaveBeenCalledTimes(1)
        expect(localStorage.getItem('ai-harness.active-conversation')).toBeNull()
        expect(redirect).toHaveBeenCalledWith(expect.any(Function), 0)
        expect(() => workspaceHeaders()).toThrow()
    })

    it('clears private content on an actual stale-context marker and ignores late account and model responses after a clean remount', async () => {
        const oldModels = acceptanceDeferred<AccountModel[]>()
        api.models.mockReturnValueOnce(oldModels.promise)
        const oldVerify = acceptanceDeferred<AccountMe>()
        const first = render(
            <AuthBoundary>
                <PrivatePane />
            </AuthBoundary>
        )
        await screen.findByLabelText('未发送草稿')
        api.account.mockReturnValueOnce(oldVerify.promise)
        fireEvent.focus(window)
        await waitFor(() => expect(api.account).toHaveBeenCalledTimes(2))
        const redirect = vi.spyOn(window, 'setTimeout').mockReturnValueOnce(0 as unknown as ReturnType<typeof setTimeout>)
        act(() => observeWorkspaceResponse(Response.json({}, { status: 409, headers: { 'X-Harness-Context-Changed': '1' } })))
        await waitFor(() => expect(screen.queryByLabelText('未发送草稿')).toBeNull())
        expect(redirect).toHaveBeenCalledWith(expect.any(Function), 0)
        first.unmount()
        api.account.mockResolvedValue({ ...me, workspaceId: 'new-team' })
        api.models.mockResolvedValue([])
        render(
            <AuthBoundary>
                <PrivatePane />
            </AuthBoundary>
        )
        await screen.findByText('new-team')
        const oldModel: AccountModel = {
            id: '51515151-5151-4151-8151-515151515151',
            modelId: 'account:51515151-5151-4151-8151-515151515151',
            name: '禁止迟到混入的新空间旧模型',
            baseUrl: 'https://example.test/v1',
            model: 'old',
            hasApiKey: true,
            isDefault: true,
            createdAt: now,
            updatedAt: now,
        }
        await act(async () => {
            oldVerify.resolve(me)
            oldModels.resolve([oldModel])
        })
        expect(screen.getByText('new-team')).toBeTruthy()
        expect(screen.queryByText('old-team')).toBeNull()
        expect(screen.queryByText(oldModel.name)).toBeNull()
        expect((screen.getByLabelText('未发送草稿') as HTMLInputElement).value).toBe('')
        expect(new Headers(workspaceHeaders()).get('X-Harness-Context')).toBe('new-team')
    })

    it('clears an open private form immediately after a remote workspace storage announcement', async () => {
        const user = userEvent.setup()
        render(
            <AuthBoundary>
                <PrivatePane />
            </AuthBoundary>
        )
        await user.type(await screen.findByLabelText('未发送草稿'), '远端切换前的草稿')
        const redirect = vi.spyOn(window, 'setTimeout').mockReturnValueOnce(0 as unknown as ReturnType<typeof setTimeout>)
        fireEvent(window, new StorageEvent('storage', { key: 'ai-harness.workspace-epoch', newValue: crypto.randomUUID() }))
        await waitFor(() => expect(screen.queryByLabelText('未发送草稿')).toBeNull())
        expect(api.unmount).toHaveBeenCalledTimes(1)
        expect(redirect).toHaveBeenCalledWith(expect.any(Function), 0)
    })
})
