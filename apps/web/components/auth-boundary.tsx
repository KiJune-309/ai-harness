'use client'

import type { AccountMe, AccountModel } from '@ai-harness/contracts'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getAccount, listAccountModels } from '../lib/account-client'
import { subscribeAccountChanges, subscribeWorkspaceChanges } from '../lib/account-session'
import { setVerifiedWorkspace } from '../lib/workspace-context'
import { Workspace } from './workspace'
import { Button } from './ui/button'
import { FeedbackMessage } from './ui/feedback-message'
import { PrivatePortalProvider } from './private-portal'
import { AccountContext } from './account-context'

/**
 * Prevents private components from mounting until the real account session is verified.
 * @param props - Current route content, including public authentication and product pages.
 * @returns The public page, loading feedback, or an authenticated workspace.
 */
export function AuthBoundary({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const isPublic = pathname === '/login' || pathname === '/register' || pathname === '/landing'
    const [account, setAccount] = useState<AccountMe | null>(null)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)
    const [checking, setChecking] = useState(false)
    const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)
    const [modelDirectory, setModelDirectory] = useState<{ identity: string; models: AccountModel[] } | null>(null)
    const [modelRevision, setModelRevision] = useState(0)
    const verifiedUserId = useRef<string | null>(null)
    const verifiedWorkspaceId = useRef<string | undefined>(undefined)
    const userId = account?.user.id
    const identity = `${userId ?? ''}:${account?.workspaceId ?? ''}`

    useEffect(() => {
        if (!userId || isPublic) return
        const controller = new AbortController()
        listAccountModels(controller.signal)
            .then(models => {
                if (!controller.signal.aborted) setModelDirectory({ identity, models })
            })
            .catch(() => {
                if (!controller.signal.aborted) setModelDirectory(null)
            })
        return () => controller.abort()
    }, [userId, identity, isPublic, modelRevision])

    /**
     * Resolves a public connection name without exposing its routing identifier.
     * @param modelId - Frozen route reference or an ordinary server model name.
     * @returns A readable connection name, safe unavailable label, or server model name.
     */
    function modelLabel(modelId: string | undefined): string {
        if (!modelId) return '默认模型'
        if (!modelId.startsWith('account:')) return modelId
        if (!modelDirectory || modelDirectory.identity !== identity) return '个人模型连接'
        return modelDirectory.models.find(model => model.modelId === modelId)?.name ?? '个人模型连接不可用'
    }

    useEffect(() => {
        if (isPublic) return
        let controller: AbortController | null = null
        let active = true
        let pending = false
        let redirecting = false
        /**
         * Removes all mounted private state and opens the login page after session loss.
         * @param reason - Whether a session expired or changed in another tab.
         * @returns Nothing; clears profile state and replaces browser navigation.
         */
        function invalidate(reason = 'expired') {
            if (!active || redirecting) return
            redirecting = true
            verifiedUserId.current = null
            verifiedWorkspaceId.current = undefined
            setVerifiedWorkspace(undefined)
            setAccount(null)
            setChecking(false)
            controller?.abort()
            try {
                localStorage.removeItem('ai-harness.active-conversation')
            } catch {
                // Session invalidation does not depend on browser storage availability.
            }
            const destination = `/login?reason=${reason}&returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`
            window.setTimeout(() => window.location.replace(destination), 0)
        }

        /**
         * Removes old workspace forms and opens a clean home in the persisted current workspace.
         * @returns Nothing; never carries a private conversation or unsent form into another workspace.
         */
        function workspaceChanged() {
            if (!active || redirecting) return
            redirecting = true
            setVerifiedWorkspace(undefined)
            setAccount(null)
            setModelDirectory(null)
            setChecking(false)
            controller?.abort()
            try {
                localStorage.removeItem('ai-harness.active-conversation')
            } catch {
                // Removing mounted private state does not depend on browser storage.
            }
            window.setTimeout(() => window.location.replace('/'), 0)
        }

        /**
         * Verifies the current cookie before enabling a foreground private interface.
         * @returns After verification without ever merging a different user's profile into the old workspace.
         */
        async function verify() {
            if (!active || pending || redirecting) return
            pending = true
            const request = new AbortController()
            controller = request
            setChecking(true)
            try {
                const result = await getAccount(request.signal)
                if (!active || request.signal.aborted || redirecting) return
                if (verifiedUserId.current && result.user.id !== verifiedUserId.current) {
                    invalidate('changed')
                    return
                }
                if (verifiedWorkspaceId.current && result.workspaceId !== verifiedWorkspaceId.current) {
                    workspaceChanged()
                    return
                }
                verifiedUserId.current = result.user.id
                verifiedWorkspaceId.current = result.workspaceId
                setVerifiedWorkspace(result.workspaceId)
                setAccount(result)
                setError('')
            } catch (cause) {
                if (!active || request.signal.aborted || redirecting) return
                if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 401) invalidate()
                else {
                    setError(cause instanceof Error ? cause.message : '账户暂时无法载入。')
                }
            } finally {
                pending = false
                if (active && !redirecting) setChecking(false)
            }
        }

        /**
         * Handles actual unauthorized responses without trusting their old UI state.
         * @returns Nothing; invalidates the mounted account.
         */
        function unauthorized() {
            invalidate()
        }

        /**
         * Clears private state immediately after another tab changes its shared cookie.
         * @returns Nothing; forces a fresh explicit login page.
         */
        function remoteChange() {
            invalidate('changed')
        }

        /**
         * Rechecks identity when the browser window regains focus.
         * @returns Nothing; starts bounded session verification.
         */
        function foreground() {
            void verify()
        }

        /**
         * Treats a restored browser snapshot as untrusted until the current session is read.
         * @param event - Browser page restoration event.
         * @returns Nothing; clears restored private state and verifies the live cookie.
         */
        function restored(event: PageTransitionEvent) {
            if (event.persisted) {
                setAccount(null)
                verifiedUserId.current = null
                verifiedWorkspaceId.current = undefined
                setVerifiedWorkspace(undefined)
            }
            void verify()
        }

        const unsubscribe = subscribeAccountChanges(remoteChange)
        const unsubscribeWorkspace = subscribeWorkspaceChanges(workspaceChanged)
        window.addEventListener('harness:unauthorized', unauthorized)
        window.addEventListener('focus', foreground)
        window.addEventListener('pageshow', restored)
        void verify()
        return () => {
            active = false
            controller?.abort()
            unsubscribe()
            unsubscribeWorkspace()
            window.removeEventListener('harness:unauthorized', unauthorized)
            window.removeEventListener('focus', foreground)
            window.removeEventListener('pageshow', restored)
        }
    }, [isPublic, revision])

    if (isPublic) return children
    if (!account)
        return (
            <main className="workspace-loading">
                <div className="w-full max-w-xl p-6">
                    <FeedbackMessage variant={error ? 'error' : 'loading'}>
                        <p>{error || '正在确认登录状态…'}</p>
                        {error && (
                            <Button
                                onClick={() => {
                                    setChecking(true)
                                    setError('')
                                    setRevision(value => value + 1)
                                }}
                            >
                                重新载入账户
                            </Button>
                        )}
                    </FeedbackMessage>
                </div>
            </main>
        )
    return (
        <AccountContext.Provider
            value={{
                ...account,
                updateUser: user => setAccount(current => (current ? { ...current, user } : null)),
                clearAccount: () => {
                    verifiedUserId.current = null
                    verifiedWorkspaceId.current = undefined
                    setVerifiedWorkspace(undefined)
                    setAccount(null)
                },
                modelLabel,
                refreshModelNames: () => {
                    setModelDirectory(null)
                    setModelRevision(value => value + 1)
                },
            }}
        >
            <PrivatePortalProvider container={portalContainer} paused={checking || Boolean(error)}>
                <div
                    ref={setPortalContainer}
                    inert={checking || Boolean(error)}
                    aria-hidden={checking || Boolean(error) || undefined}
                    data-private-workspace=""
                >
                    <Workspace key={`${account.user.id}:${account.workspaceId ?? ''}`}>{children}</Workspace>
                </div>
            </PrivatePortalProvider>
            {(checking || error) && (
                <div className="workspace-loading" style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
                    <div className="w-full max-w-xl p-6">
                        <FeedbackMessage variant={error ? 'error' : 'loading'}>
                            <p>{error || '正在确认登录状态…'}</p>
                            {error && (
                                <>
                                    <p>未提交的内容仍保留在当前页面。恢复连接并确认账户后可继续。</p>
                                    <Button
                                        onClick={() => {
                                            setChecking(true)
                                            setError('')
                                            setRevision(value => value + 1)
                                        }}
                                    >
                                        重新连接账户
                                    </Button>
                                </>
                            )}
                        </FeedbackMessage>
                    </div>
                </div>
            )}
        </AccountContext.Provider>
    )
}
