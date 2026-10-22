// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../../components/workspace'
import { PrivatePortalProvider } from '../../components/private-portal'
import { installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const fixture = vi.hoisted(() => ({ route: vi.fn(), logout: vi.fn(), clear: vi.fn() }))

vi.mock('next/navigation', () => ({
    usePathname: () => '/templates',
    useRouter: () => ({ push: fixture.route }),
    useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../components/account-context', () => ({
    useAccount: () => ({
        user: { username: '真实移动工作区验收' },
        clearAccount: fixture.clear,
        modelLabel: (value: string | undefined) => value ?? '默认模型',
    }),
}))
vi.mock('../../lib/account-client', () => ({ logoutAccount: fixture.logout }))

beforeEach(() => {
    installAcceptanceBrowser(390)
    fixture.route.mockReset()
    fixture.logout.mockReset()
    fixture.clear.mockReset()
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => {
            if (input === '/api/account/workspaces')
                return Response.json({
                    currentId: 'personal',
                    workspaces: [
                        {
                            id: 'personal',
                            name: '默认工作空间',
                            description: '',
                            kind: 'legacy',
                            role: 'member',
                            createdAt: '2026-10-20T00:00:00.000Z',
                            updatedAt: '2026-10-20T00:00:00.000Z',
                        },
                    ],
                    invitations: [],
                })
            if (input === '/api/chat/conversations') return Response.json({ conversations: [] })
            if (input === '/api/chat/project-folders') return Response.json({ projects: [] })
            if (input === '/api/chat/collaboration/notifications?cursor=0&limit=100') return Response.json({ notifications: [] })
            throw new Error('本验收不应请求任务或模型服务。')
        })
    )
})

afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent real workspace mobile composition', () => {
    it('starts a new conversation from the Sheet and bottom navigation without creating or cancelling work', async () => {
        const user = userEvent.setup()
        const host = document.createElement('div')
        document.body.append(host)
        render(
            <PrivatePortalProvider container={host}>
                <Workspace>隔离模板页面内容</Workspace>
            </PrivatePortalProvider>,
            { container: host }
        )

        expect(screen.queryByRole('link', { name: '工作台' })).toBeNull()
        expect(screen.queryByRole('button', { name: '工作台' })).toBeNull()
        await user.click(screen.getByRole('button', { name: '打开导航' }))
        const sheet = await screen.findByRole('dialog', { name: '工作区导航' })
        expect(within(sheet).queryByRole('link', { name: '工作台' })).toBeNull()
        await user.click(within(sheet).getByRole('button', { name: '开始新对话' }))
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '工作区导航' })).toBeNull()
            expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
        })
        expect(fixture.route).toHaveBeenCalledExactlyOnceWith('/')

        const navigation = within(screen.getByRole('navigation', { name: '应用导航' }))
        expect(navigation.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/rag', '/agents', '/templates', '/inbox'])
        await user.click(navigation.getByRole('button', { name: '开始新对话' }))
        expect(fixture.route).toHaveBeenCalledTimes(2)
        expect(fixture.route).toHaveBeenLastCalledWith('/')
        expect(
            vi
                .mocked(fetch)
                .mock.calls.every(
                    ([input, init]) =>
                        (!init?.method || init.method === 'GET') &&
                        [
                            '/api/account/workspaces',
                            '/api/chat/conversations',
                            '/api/chat/project-folders',
                            '/api/chat/collaboration/notifications?cursor=0&limit=100',
                        ].includes(input as string)
                )
        ).toBe(true)
    })

    it('uses the real responsive Sidebar hook and account menu, retains template navigation, and opens help after closing the Sheet', async () => {
        const user = userEvent.setup()
        const host = document.createElement('div')
        document.body.append(host)
        render(
            <PrivatePortalProvider container={host}>
                <Workspace>隔离模板页面内容</Workspace>
            </PrivatePortalProvider>,
            { container: host }
        )
        const opener = screen.getByRole('button', { name: '打开导航' })
        expect(screen.queryByRole('button', { name: '真实移动工作区验收的用户菜单' })).toBeNull()
        await user.click(opener)
        const sheet = await screen.findByRole('dialog', { name: '工作区导航' })
        expect(within(sheet).getByRole('link', { name: '任务模板' }).getAttribute('href')).toBe('/templates')
        expect(within(sheet).queryByRole('button', { name: '更多' })).toBeNull()
        expect(within(sheet).queryByRole('button', { name: '退出登录' })).toBeNull()
        const avatar = within(sheet).getByRole('button', { name: '真实移动工作区验收的用户菜单' })
        await user.click(avatar)
        await screen.findByRole('menu')
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        expect(screen.getByRole('dialog', { name: '工作区导航' })).toBe(sheet)
        await waitFor(() => expect(document.activeElement).toBe(avatar))
        await user.click(avatar)
        await user.click(await screen.findByRole('menuitem', { name: '使用帮助' }))
        await screen.findByRole('dialog', { name: '从这里开始' })
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '工作区导航' })).toBeNull()
            expect(screen.queryByRole('menu')).toBeNull()
            expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
        })
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(screen.getByText('隔离模板页面内容')).toBeTruthy()
        expect(fixture.logout).not.toHaveBeenCalled()
        expect(
            vi
                .mocked(fetch)
                .mock.calls.every(([input]) =>
                    [
                        '/api/account/workspaces',
                        '/api/chat/conversations',
                        '/api/chat/project-folders',
                        '/api/chat/collaboration/notifications?cursor=0&limit=100',
                    ].includes(input as string)
                )
        ).toBe(true)
    })
})
