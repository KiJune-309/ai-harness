'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronsUpDown, CircleHelp, Grid2X2, Layers, LogOut, Settings } from 'lucide-react'
import { logoutAccount } from '../lib/account-client'
import { useAccount } from './account-context'
import { FeedbackMessage } from './ui/feedback-message'
import { Avatar, AvatarFallback } from './ui/avatar'
import { Button } from './ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu'

/**
 * Renders the shared authenticated account menu and confirms logout with the server before clearing private state.
 * @param props - Navigation, informational panel, and successful logout callbacks from the workspace.
 * @returns The avatar trigger, official dropdown items, and any retryable logout error.
 */
export function UserMenu({
    onOpenPanel,
    onNavigate,
    onSignedOut,
}: {
    onOpenPanel: (panel: 'plugins' | 'help') => void
    onNavigate: () => void
    onSignedOut: () => void
}) {
    const { user, clearAccount } = useAccount()
    const [loggingOut, setLoggingOut] = useState(false)
    const [error, setError] = useState('')
    const pending = useRef(false)

    /**
     * Revokes the server session exactly once while preserving the current account after a failed request.
     * @returns After confirmed logout and private-state cleanup, or a visible retryable failure.
     */
    async function signOut(): Promise<void> {
        if (pending.current) return
        pending.current = true
        setLoggingOut(true)
        setError('')
        try {
            await logoutAccount()
            onSignedOut()
            clearAccount()
            window.setTimeout(() => window.location.assign('/login'), 0)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '退出未完成，请重试。')
            pending.current = false
            setLoggingOut(false)
        }
    }

    return (
        <div className="grid min-w-0 gap-2">
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={<Button variant="ghost" className="h-auto w-full justify-start p-2" />}
                    disabled={loggingOut}
                    aria-label={`${user.username}的用户菜单`}
                >
                    <Avatar>
                        <AvatarFallback>{Array.from(user.username)[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-left" title={user.username}>
                        {loggingOut ? '正在退出…' : user.username}
                    </span>
                    <ChevronsUpDown className="ml-auto" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="min-w-56">
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>个人工作区</DropdownMenuLabel>
                        <DropdownMenuItem render={<Link href="/account" />} onClick={onNavigate}>
                            <Settings aria-hidden="true" />
                            账户设置
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>更多</DropdownMenuLabel>
                        <DropdownMenuItem render={<Link href="/components" />} onClick={onNavigate}>
                            <Grid2X2 aria-hidden="true" />
                            组件展示
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onOpenPanel('plugins')}>
                            <Layers aria-hidden="true" />
                            插件与能力
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onOpenPanel('help')}>
                            <CircleHelp aria-hidden="true" />
                            使用帮助
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={loggingOut} onClick={() => void signOut()}>
                        <LogOut aria-hidden="true" />
                        {loggingOut ? '正在退出…' : '退出登录'}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {error && <FeedbackMessage variant="error">{error} 重新打开用户菜单可重试退出。</FeedbackMessage>}
        </div>
    )
}
