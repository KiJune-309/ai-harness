'use client'

import {
    inviteWorkspaceMemberSchema,
    workspaceInputSchema,
    type TeamWorkspace,
    type WorkspaceDetail,
    type WorkspaceDirectory,
    type WorkspaceInvitation,
    type WorkspaceMember,
} from '@ai-harness/contracts'
import { Building2, Check, ChevronsUpDown, LoaderCircle, Plus, Settings, Users, X } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { notifyWorkspaceChange } from '../lib/account-session'
import {
    createWorkspace,
    getWorkspace,
    inviteWorkspaceMember,
    leaveWorkspace,
    listWorkspaces,
    removeWorkspaceMember,
    respondWorkspaceInvitation,
    revokeWorkspaceInvitation,
    switchWorkspace,
} from '../lib/workspace-client'
import { useAccount } from './account-context'
import { FeedbackMessage } from './ui/feedback-message'
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from './ui/alert-dialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const directoryEvent = 'harness:workspace-directory'
const invitationLabels: Record<WorkspaceInvitation['status'], string> = {
    pending: '等待接受',
    accepted: '已接受',
    declined: '已拒绝',
    revoked: '已撤销',
    expired: '已过期',
}

/**
 * Produces safe feedback for an untrusted service failure.
 * @param cause - Unknown request failure.
 * @returns A useful public error message.
 */
function message(cause: unknown): string {
    return cause instanceof Error ? cause.message : '操作未完成，请重试。'
}

/**
 * Associates contract validation feedback with its labeled input.
 * @param issues - Shared-contract issues for the submitted fields.
 * @returns The first public validation message for each field.
 */
function validationFields(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
    const fields: Record<string, string> = {}
    for (const issue of issues) fields[String(issue.path[0])] ??= issue.message
    return fields
}

/**
 * Announces confirmed directory changes to other workspace controls in this document.
 * @returns Nothing; never announces an unconfirmed mutation.
 */
function refreshDirectory(): void {
    window.dispatchEvent(new Event(directoryEvent))
}

/**
 * Reads permitted workspace memberships and ignores superseded responses.
 * @returns Directory state, useful loading feedback, and an explicit reload operation.
 */
function useWorkspaceDirectory() {
    const { workspaceId } = useAccount()
    const [directory, setDirectory] = useState<WorkspaceDirectory | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const request = useRef<AbortController | null>(null)
    const reload = useCallback(() => {
        request.current?.abort()
        const controller = new AbortController()
        request.current = controller
        setLoading(true)
        setError('')
        void listWorkspaces(controller.signal)
            .then(result => {
                if (!controller.signal.aborted) {
                    if (workspaceId && result.currentId !== workspaceId) {
                        notifyWorkspaceChange()
                        return
                    }
                    setDirectory(result)
                }
            })
            .catch(cause => {
                if (!controller.signal.aborted) setError(message(cause))
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })
    }, [workspaceId])
    useEffect(() => {
        const timer = window.setTimeout(reload, 0)
        window.addEventListener(directoryEvent, reload)
        window.addEventListener('focus', reload)
        return () => {
            request.current?.abort()
            window.clearTimeout(timer)
            window.removeEventListener(directoryEvent, reload)
            window.removeEventListener('focus', reload)
        }
    }, [reload])
    return { directory, loading, error, reload }
}

/**
 * Creates a team through the same labeled form from navigation and management.
 * @param props - Controlled dialog state without a workspace-switch or navigation callback.
 * @returns A retryable workspace creation dialog.
 */
function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [fields, setFields] = useState<Record<string, string>>({})
    const pending = useRef(false)
    const action = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const [created, setCreated] = useState<TeamWorkspace | null>(null)
    const nameInput = useRef<HTMLInputElement>(null)
    const descriptionInput = useRef<HTMLTextAreaElement>(null)
    const successTitle = useRef<HTMLHeadingElement>(null)

    useEffect(() => {
        if (created) successTitle.current?.focus()
    }, [created])

    /**
     * Closes a completed creation without changing the current page or active workspace.
     * @param next - Requested dialog visibility.
     * @returns Nothing; resets the successful form only after its result is dismissed.
     */
    function changeOpen(next: boolean): void {
        if (pending.current) return
        if (!next && created) {
            setCreated(null)
            setName('')
            setDescription('')
            setError('')
            setFields({})
            action.current = null
        }
        onOpenChange(next)
    }

    /**
     * Saves a validated team and retains its creation identity across uncertain retries.
     * @param event - Explicit create form submission.
     * @returns After creation is confirmed or a visible retryable failure.
     */
    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault()
        if (pending.current || created) return
        const parsed = workspaceInputSchema.safeParse({ name, description })
        setFields({})
        if (!parsed.success) {
            setFields(validationFields(parsed.error.issues))
            if (parsed.error.issues[0]?.path[0] === 'description') descriptionInput.current?.focus()
            else nameInput.current?.focus()
            return
        }
        const fingerprint = JSON.stringify(parsed.data)
        if (action.current?.fingerprint !== fingerprint) action.current = { fingerprint, requestId: crypto.randomUUID() }
        pending.current = true
        setBusy(true)
        setError('')
        try {
            const result = await createWorkspace({ ...parsed.data, requestId: action.current.requestId })
            setCreated(result)
            refreshDirectory()
        } catch (cause) {
            setError(message(cause))
        } finally {
            pending.current = false
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={changeOpen}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>创建工作空间</DialogTitle>
                    <DialogDescription>为团队创建独立的协作空间。创建后保留当前工作空间，可从工作空间目录手动选择进入。</DialogDescription>
                </DialogHeader>
                {created ? (
                    <div className="grid min-w-0 gap-4">
                        <h3 ref={successTitle} tabIndex={-1} className="font-medium outline-none">
                            工作空间已创建
                        </h3>
                        <dl className="grid min-w-0 gap-4 text-sm">
                            <div className="grid min-w-0 gap-1">
                                <dt className="text-muted-foreground">名称</dt>
                                <dd className="[overflow-wrap:anywhere]">{created.name}</dd>
                            </div>
                            <div className="grid min-w-0 gap-1">
                                <dt className="text-muted-foreground">说明</dt>
                                <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{created.description || '暂无说明。'}</dd>
                            </div>
                        </dl>
                        <FeedbackMessage variant="info">当前工作空间不变，可从目录手动进入新空间。</FeedbackMessage>
                        <DialogFooter>
                            <Button type="button" disabled={busy} onClick={() => changeOpen(false)}>
                                完成
                            </Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <form className="grid gap-4" noValidate onSubmit={event => void submit(event)}>
                        <div className="grid gap-2">
                            <Label htmlFor="workspace-create-name">名称</Label>
                            <Input
                                id="workspace-create-name"
                                ref={nameInput}
                                value={name}
                                onChange={event => setName(event.target.value)}
                                maxLength={60}
                                required
                                aria-invalid={Boolean(fields.name)}
                                aria-describedby={fields.name ? 'workspace-create-name-error' : undefined}
                                disabled={busy}
                            />
                            <p className="text-xs text-muted-foreground">1–60 个字</p>
                            {fields.name && (
                                <p id="workspace-create-name-error" role="alert" className="text-sm text-error-foreground">
                                    {fields.name}
                                </p>
                            )}
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="workspace-create-description">说明（选填）</Label>
                            <Textarea
                                id="workspace-create-description"
                                ref={descriptionInput}
                                value={description}
                                onChange={event => setDescription(event.target.value)}
                                maxLength={500}
                                aria-invalid={Boolean(fields.description)}
                                aria-describedby={fields.description ? 'workspace-create-description-error' : undefined}
                                disabled={busy}
                            />
                            <p className="text-xs text-muted-foreground">最多 500 个字</p>
                            {fields.description && (
                                <p id="workspace-create-description-error" role="alert" className="text-sm text-error-foreground">
                                    {fields.description}
                                </p>
                            )}
                        </div>
                        {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
                        <DialogFooter>
                            <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>
                                取消
                            </Button>
                            <Button type="submit" disabled={busy}>
                                {busy ? '正在创建…' : '创建'}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    )
}

/**
 * Confirms that switching clears unsent content before changing the persisted active workspace.
 * @param props - Selected destination and close callback.
 * @returns A cancellable switch confirmation that retains failures for retry.
 */
function SwitchWorkspaceDialog({ workspace, onClose }: { workspace: TeamWorkspace | null; onClose: () => void }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const pending = useRef(false)

    /**
     * Persists the chosen workspace and clears private state in every observing tab.
     * @returns After confirmation or an actionable failure.
     */
    async function confirm(): Promise<void> {
        if (!workspace || pending.current) return
        pending.current = true
        setBusy(true)
        setError('')
        try {
            await switchWorkspace(workspace.id)
            notifyWorkspaceChange()
        } catch (cause) {
            setError(message(cause))
            pending.current = false
            setBusy(false)
        }
    }

    return (
        <AlertDialog open={Boolean(workspace)} onOpenChange={next => !next && !pending.current && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>切换到“{workspace?.name}”？</AlertDialogTitle>
                    <AlertDialogDescription>
                        当前标签页未发送或未保存的内容将被清除。同一登录会话的其他标签页也将返回新空间的工作台。已保存内容会留在原工作空间。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>留在当前空间</AlertDialogCancel>
                    <Button disabled={busy} onClick={() => void confirm()}>
                        {busy ? '正在切换…' : '确认切换'}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

/**
 * Places the workspace selector below the existing sidebar brand on desktop and mobile.
 * @param props - Closes the mobile navigation after entering management.
 * @returns Current workspace, membership switching, invitations, and creation entries.
 */
export function WorkspaceSelector({ onNavigate }: { onNavigate: () => void }) {
    const { workspaceId } = useAccount()
    const { directory, loading, error, reload } = useWorkspaceDirectory()
    const [createOpen, setCreateOpen] = useState(false)
    const [destination, setDestination] = useState<TeamWorkspace | null>(null)
    const current = directory?.workspaces.find(item => item.id === (workspaceId ?? directory.currentId))
    const invitationCount = directory?.invitations.filter(item => item.status === 'pending').length ?? 0
    return (
        <>
            <DropdownMenu onOpenChange={open => open && reload()}>
                <DropdownMenuTrigger
                    render={<Button variant="ghost" className="h-auto min-h-11 w-full justify-start p-2" />}
                    aria-label={`工作空间：${current?.name ?? '正在载入'}`}
                >
                    <Building2 aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-left">{current?.name ?? '工作空间'}</span>
                    {invitationCount > 0 && <Badge variant="secondary">{invitationCount}</Badge>}
                    <ChevronsUpDown aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-64 max-w-[calc(100vw-2rem)]">
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>我的工作空间</DropdownMenuLabel>
                        {loading && !directory && (
                            <p className="p-2 text-sm text-muted-foreground" role="status">
                                正在载入工作空间…
                            </p>
                        )}
                        {error && (
                            <FeedbackMessage variant="error" className="p-2">
                                {error}
                            </FeedbackMessage>
                        )}
                        {directory?.workspaces.map(item => (
                            <DropdownMenuItem
                                key={item.id}
                                className="min-h-11"
                                onClick={() => item.id !== directory.currentId && setDestination(item)}
                            >
                                <Building2 aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate" title={item.name}>
                                    {item.name}
                                    <span className="block text-xs text-muted-foreground">
                                        {item.kind === 'legacy'
                                            ? '默认空间'
                                            : `${item.role === 'owner' ? '拥有者' : '成员'} · ${item.id.slice(0, 8)}`}
                                    </span>
                                </span>
                                {item.id === directory.currentId && (
                                    <>
                                        <Check aria-hidden="true" />
                                        <span className="sr-only">当前空间</span>
                                    </>
                                )}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="min-h-11" render={<Link href="/workspaces" />} onClick={onNavigate}>
                        <Settings aria-hidden="true" />
                        工作空间与成员{invitationCount > 0 && <Badge variant="secondary">{invitationCount} 份邀请</Badge>}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onClick={() => setCreateOpen(true)}>
                        <Plus aria-hidden="true" />
                        创建工作空间
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
            <SwitchWorkspaceDialog key={destination?.id ?? 'none'} workspace={destination} onClose={() => setDestination(null)} />
        </>
    )
}

/**
 * Displays incoming invitations with equally reachable accept and decline actions.
 * @param props - Real invitation records and a confirmed-mutation callback.
 * @returns Invitation feedback, expiry, and explicit response controls.
 */
function IncomingInvitations({
    invitations,
    workspaces,
    onEnter,
}: {
    invitations: WorkspaceInvitation[]
    workspaces: TeamWorkspace[]
    onEnter: (workspace: TeamWorkspace) => void
}) {
    const [busy, setBusy] = useState<{ id: string; accept: boolean } | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [outcomes, setOutcomes] = useState<Record<string, 'accepted' | 'declined'>>({})
    const [acceptedInvitations, setAcceptedInvitations] = useState<WorkspaceInvitation[]>([])
    const pending = useRef(false)
    const invitationById = new Map([...acceptedInvitations, ...invitations].map(item => [item.id, item]))
    const visible = [...invitationById.values()].filter(
        item =>
            outcomes[item.id] !== 'declined' &&
            (item.status === 'pending' || item.status === 'accepted' || outcomes[item.id] === 'accepted')
    )

    /**
     * Submits exactly one invitation choice and reloads only after server confirmation.
     * @param invitation - Actual invitation selected by its recipient.
     * @param accept - Explicit membership decision.
     * @returns After confirmed membership or visible failure.
     */
    async function respond(invitation: WorkspaceInvitation, accept: boolean): Promise<void> {
        if (pending.current) return
        pending.current = true
        setBusy({ id: invitation.id, accept })
        setError('')
        setNotice('')
        try {
            await respondWorkspaceInvitation(invitation.id, accept)
            setOutcomes(previous => ({ ...previous, [invitation.id]: accept ? 'accepted' : 'declined' }))
            if (accept)
                setAcceptedInvitations(previous => [
                    ...previous.filter(item => item.id !== invitation.id),
                    { ...invitation, status: 'accepted' },
                ])
            setNotice(accept ? `已加入“${invitation.workspaceName}”，可选择进入工作空间。` : `已拒绝“${invitation.workspaceName}”的邀请。`)
            refreshDirectory()
        } catch (cause) {
            setError(message(cause))
        } finally {
            pending.current = false
            setBusy(null)
        }
    }

    return (
        <>
            {notice && <FeedbackMessage variant="success">{notice}</FeedbackMessage>}
            {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
            {visible.length > 0 && (
                <section className="grid min-w-0 gap-3" aria-label="工作空间邀请">
                    {visible.map(invitation => (
                        <Card key={invitation.id}>
                            <CardContent className="flex min-w-0 flex-wrap items-start justify-between gap-4">
                                <div className="min-w-0 grid gap-1">
                                    <h2 className="font-medium [overflow-wrap:anywhere]">{invitation.workspaceName}</h2>
                                    {invitation.workspaceDescription && (
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                                            {invitation.workspaceDescription}
                                        </p>
                                    )}
                                    <p className="text-sm text-muted-foreground break-words">{invitation.inviterName} 邀请你加入</p>
                                    <p className="text-xs text-muted-foreground">
                                        有效期至 {new Date(invitation.expiresAt).toLocaleString('zh-CN')}
                                    </p>
                                </div>
                                {invitation.status === 'accepted' || outcomes[invitation.id] === 'accepted' ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="success">已加入</Badge>
                                        <Button
                                            variant="outline"
                                            disabled={!workspaces.some(workspace => workspace.id === invitation.workspaceId)}
                                            onClick={() => {
                                                const workspace = workspaces.find(item => item.id === invitation.workspaceId)
                                                if (workspace) onEnter(workspace)
                                            }}
                                        >
                                            进入工作空间
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex shrink-0 gap-1" aria-busy={busy?.id === invitation.id}>
                                        <Tooltip>
                                            <TooltipTrigger
                                                render={
                                                    <Button variant="outline" size="icon" className="size-11" disabled={Boolean(busy)} />
                                                }
                                                type="button"
                                                aria-label="接受邀请"
                                                disabled={Boolean(busy)}
                                                onClick={() => void respond(invitation, true)}
                                            >
                                                {busy?.id === invitation.id && busy.accept ? (
                                                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                                ) : (
                                                    <Check aria-hidden="true" />
                                                )}
                                            </TooltipTrigger>
                                            <TooltipContent>接受邀请</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger
                                                render={
                                                    <Button variant="outline" size="icon" className="size-11" disabled={Boolean(busy)} />
                                                }
                                                type="button"
                                                aria-label="拒绝邀请"
                                                disabled={Boolean(busy)}
                                                onClick={() => void respond(invitation, false)}
                                            >
                                                {busy?.id === invitation.id && !busy.accept ? (
                                                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                                ) : (
                                                    <X aria-hidden="true" />
                                                )}
                                            </TooltipTrigger>
                                            <TooltipContent>拒绝邀请</TooltipContent>
                                        </Tooltip>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </section>
            )}
        </>
    )
}

/**
 * Shows one team's name, description and permission-aware membership controls.
 * @param props - A joined team, active-workspace identity, and explicit switch callback.
 * @returns A member-visible management view with owner-only mutation forms.
 */
function TeamWorkspaceDetails({ workspace, currentId, onSwitch }: { workspace: TeamWorkspace; currentId: string; onSwitch: () => void }) {
    const [detail, setDetail] = useState<WorkspaceDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [fields, setFields] = useState<Record<string, string>>({})
    const emailInput = useRef<HTMLInputElement>(null)
    const [notice, setNotice] = useState('')
    const [revision, setRevision] = useState(0)
    const [email, setEmail] = useState('')
    const [busy, setBusy] = useState('')
    const [confirmation, setConfirmation] = useState<{ kind: 'remove'; member: WorkspaceMember } | { kind: 'leave' } | null>(null)
    const pending = useRef(false)
    const inviteAction = useRef<{ email: string; requestId: string } | null>(null)
    const owner = detail?.workspace.role === 'owner'

    useEffect(() => {
        const controller = new AbortController()
        void getWorkspace(workspace.id, controller.signal)
            .then(result => {
                if (!controller.signal.aborted) {
                    setDetail(result)
                    setError('')
                }
            })
            .catch(cause => {
                if (!controller.signal.aborted) {
                    setDetail(null)
                    setError(message(cause))
                }
            })
            .finally(() => !controller.signal.aborted && setLoading(false))
        return () => controller.abort()
    }, [workspace.id, revision])

    /**
     * Runs one explicit management action while preserving forms after failed persistence.
     * @param kind - Operation label used for loading feedback.
     * @param operation - Already authorized API mutation.
     * @param success - Public confirmed-result message.
     * @returns After confirmed mutation and real-data refresh, or a retryable failure.
     */
    async function perform(kind: string, operation: () => Promise<void>, success: string): Promise<void> {
        if (pending.current) return
        pending.current = true
        setBusy(kind)
        setError('')
        setFields({})
        setNotice('')
        try {
            await operation()
            setNotice(success)
            setConfirmation(null)
            setLoading(true)
            setRevision(value => value + 1)
            refreshDirectory()
        } catch (cause) {
            if (kind === 'invite') setFields({ email: message(cause) })
            else setError(message(cause))
        } finally {
            pending.current = false
            setBusy('')
        }
    }

    /**
     * Validates an existing-account recipient and preserves the action identity on retries.
     * @param event - Explicit invitation form submission.
     * @returns Nothing after starting one serialized invitation.
     */
    function invite(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault()
        const normalizedEmail = email.trim().toLowerCase()
        if (inviteAction.current?.email !== normalizedEmail)
            inviteAction.current = { email: normalizedEmail, requestId: crypto.randomUUID() }
        const parsed = inviteWorkspaceMemberSchema.safeParse({ ...inviteAction.current })
        if (!parsed.success) {
            setFields(validationFields(parsed.error.issues))
            emailInput.current?.focus()
            return
        }
        void perform(
            'invite',
            async () => {
                await inviteWorkspaceMember(workspace.id, parsed.data)
                setEmail('')
                inviteAction.current = null
            },
            '邀请已发送，对方可在“工作空间与成员”中接受。'
        )
    }

    /**
     * Applies only the currently displayed member-removal or exit confirmation.
     * @returns Nothing after starting the selected explicit action.
     */
    function confirmMembershipChange(): void {
        if (!confirmation) return
        const selected = confirmation
        void perform(
            selected.kind,
            async () => {
                if (selected.kind === 'remove') await removeWorkspaceMember(workspace.id, selected.member.userId)
                else {
                    await leaveWorkspace(workspace.id)
                    if (workspace.id === currentId) notifyWorkspaceChange()
                }
            },
            selected.kind === 'remove' ? '成员已移除。' : '已退出工作空间。'
        )
    }

    if (loading && !detail) return <p role="status">正在载入工作空间与成员…</p>
    if (!detail)
        return (
            <FeedbackMessage variant="error">
                {error || '无法读取该工作空间。'}
                <Button variant="outline" onClick={() => setRevision(value => value + 1)}>
                    重新载入
                </Button>
            </FeedbackMessage>
        )
    return (
        <div className="grid gap-6 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{detail.workspace.name}</h2>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {detail.workspace.description || '暂无说明。'}
                    </p>
                </div>
                {currentId !== workspace.id && (
                    <Button variant="outline" onClick={onSwitch}>
                        切换到此空间
                    </Button>
                )}
            </div>
            {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
            {notice && <FeedbackMessage variant="success">{notice}</FeedbackMessage>}
            <Card className="rounded-none border-0 border-t bg-transparent pt-6 shadow-none">
                <CardHeader className="px-0">
                    <CardTitle className="flex items-center gap-2">
                        <Users className="size-4" aria-hidden="true" />
                        成员 <Badge variant="secondary">{detail.members.length}</Badge>
                    </CardTitle>
                    <CardDescription>成员加入团队后仍保有各自的私有聊天，加入工作空间不会公开私人内容。</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 px-0">
                    {owner && (
                        <form className="grid gap-2" noValidate onSubmit={invite}>
                            <Label htmlFor="workspace-invite-email">同事的注册邮箱</Label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                    id="workspace-invite-email"
                                    ref={emailInput}
                                    aria-invalid={Boolean(fields.email)}
                                    aria-describedby={fields.email ? 'workspace-invite-email-error' : undefined}
                                    type="email"
                                    value={email}
                                    onChange={event => setEmail(event.target.value)}
                                    onBlur={() => setEmail(value => value.trim().toLowerCase())}
                                    placeholder="name@example.com"
                                    autoComplete="email"
                                    required
                                    disabled={Boolean(busy)}
                                    className="min-w-0"
                                />
                                <Button type="submit" disabled={Boolean(busy)}>
                                    {busy === 'invite' ? '正在邀请…' : '邀请成员'}
                                </Button>
                            </div>
                            {fields.email && (
                                <p id="workspace-invite-email-error" role="alert" className="text-sm text-error-foreground">
                                    {fields.email}
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                仅支持邀请已注册账户。发送站内邀请，不会发送邮件；对方接受后加入，7 天内有效。
                            </p>
                        </form>
                    )}
                    <ul className="grid divide-y">
                        {detail.members.map(member => (
                            <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium break-words">{member.name}</p>
                                    <p className="text-sm text-muted-foreground break-all">{member.email}</p>
                                </div>
                                <Badge variant="secondary">{member.role === 'owner' ? '拥有者' : '成员'}</Badge>
                                {owner && member.role !== 'owner' && (
                                    <Button
                                        variant="outline"
                                        disabled={Boolean(busy)}
                                        aria-label={`移除成员 ${member.name}`}
                                        onClick={() => setConfirmation({ kind: 'remove', member })}
                                    >
                                        移除
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                    {owner && detail.invitations.length > 0 && (
                        <section className="grid gap-2" aria-label="已发送的邀请">
                            <h3 className="font-medium">已发送的邀请</h3>
                            <ul className="grid divide-y">
                                {detail.invitations.map(invitation => (
                                    <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="break-all text-sm">{invitation.email}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {invitationLabels[invitation.status]} ·{' '}
                                                {new Date(invitation.expiresAt).toLocaleDateString('zh-CN')} 到期
                                            </p>
                                        </div>
                                        {invitation.status === 'pending' && (
                                            <Button
                                                variant="outline"
                                                disabled={Boolean(busy)}
                                                aria-label={`撤销邀请 ${invitation.email}`}
                                                onClick={() =>
                                                    void perform(
                                                        'revoke',
                                                        () => revokeWorkspaceInvitation(workspace.id, invitation.id),
                                                        '邀请已撤销。'
                                                    )
                                                }
                                            >
                                                撤销邀请
                                            </Button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </CardContent>
            </Card>
            {owner ? (
                <p className="text-sm text-muted-foreground">拥有者负责维护工作空间，暂不支持退出或转移所有权。</p>
            ) : (
                <div>
                    <Button variant="outline" disabled={Boolean(busy)} onClick={() => setConfirmation({ kind: 'leave' })}>
                        退出工作空间
                    </Button>
                </div>
            )}
            <AlertDialog open={Boolean(confirmation)} onOpenChange={next => !next && !pending.current && setConfirmation(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirmation?.kind === 'remove' ? `移除“${confirmation.member.name}”？` : `退出“${workspace.name}”？`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmation?.kind === 'remove'
                                ? `${confirmation.member.email} 将无法继续访问此空间。已有记录会保留，进行中的协作和待发送确认也会重新检查权限。`
                                : '退出后将失去此空间的访问权限，已有记录会保留。重新加入需要拥有者再次邀请。'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={Boolean(busy)}>取消</AlertDialogCancel>
                        <Button variant="destructive" disabled={Boolean(busy)} onClick={confirmMembershipChange}>
                            {busy ? '正在处理…' : confirmation?.kind === 'remove' ? '确认移除' : '确认退出'}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

/**
 * Renders the workspace directory, received invitations, and team membership management.
 * @returns The authenticated responsive workspace management page.
 */
export function TeamWorkspaces() {
    const { directory, loading, error, reload } = useWorkspaceDirectory()
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [createOpen, setCreateOpen] = useState(false)
    const [destination, setDestination] = useState<TeamWorkspace | null>(null)
    const selected =
        directory?.workspaces.find(item => item.id === selectedId) ?? directory?.workspaces.find(item => item.id === directory.currentId)
    return (
        <section className="workspace-page grid min-w-0 gap-8" aria-labelledby="workspace-page-title">
            <header className="workspace-page-header flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 id="workspace-page-title">工作空间与成员</h1>
                    <p className="mt-2 text-sm text-muted-foreground">管理团队、邀请同事，并在不同工作空间之间切换。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" aria-label="刷新工作空间" disabled={loading} onClick={reload}>
                        {loading ? '正在刷新…' : '刷新'}
                    </Button>
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus aria-hidden="true" />
                        创建工作空间
                    </Button>
                </div>
            </header>
            {error && (
                <FeedbackMessage variant="error">
                    {error}
                    <Button variant="outline" onClick={reload}>
                        重新载入
                    </Button>
                </FeedbackMessage>
            )}
            {loading && !directory && <p role="status">正在载入工作空间…</p>}
            {directory && (
                <>
                    <IncomingInvitations invitations={directory.invitations} workspaces={directory.workspaces} onEnter={setDestination} />
                    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] lg:gap-8">
                        <section
                            className="grid min-w-0 gap-4 border-b pb-6 lg:border-r lg:border-b-0 lg:pr-6 lg:pb-0"
                            aria-labelledby="workspace-directory-title"
                        >
                            <h2 id="workspace-directory-title" className="text-[15px] font-semibold">
                                我的工作空间
                            </h2>
                            <div className="workspace-collection grid min-w-0 gap-1">
                                {directory.workspaces.map(workspace => (
                                    <Button
                                        key={workspace.id}
                                        variant={selected?.id === workspace.id ? 'secondary' : 'ghost'}
                                        aria-pressed={selected?.id === workspace.id}
                                        aria-controls="workspace-selected-details"
                                        className="h-auto min-h-16 w-full justify-start gap-3 px-3 py-3 whitespace-normal text-left"
                                        onClick={() => setSelectedId(workspace.id)}
                                    >
                                        <Building2 className="shrink-0" aria-hidden="true" />
                                        <span className="min-w-0 flex-1 break-words">
                                            {workspace.name}
                                            <span className="mt-1 block text-xs font-normal text-muted-foreground">
                                                {workspace.kind === 'legacy' ? '默认空间' : workspace.role === 'owner' ? '拥有者' : '成员'}
                                                {directory.currentId === workspace.id ? ' · 当前空间' : ''}
                                                {workspace.kind === 'team' ? ` · ${workspace.id.slice(0, 8)}` : ''}
                                            </span>
                                        </span>
                                        {selected?.id === workspace.id && <Check className="shrink-0" aria-hidden="true" />}
                                    </Button>
                                ))}
                            </div>
                        </section>
                        <section id="workspace-selected-details" className="min-w-0" aria-label="工作空间详情">
                            {selected?.kind === 'legacy' ? (
                                <Card className="gap-4 rounded-none border-0 bg-transparent py-0 shadow-none">
                                    <CardHeader className="px-0">
                                        <CardTitle className="text-lg">{selected.name}</CardTitle>
                                        <CardDescription>
                                            历史工作内容保留在默认空间。新团队可通过创建工作空间并邀请成员开始协作。
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="px-0">
                                        <p className="text-sm text-muted-foreground">默认空间不开放成员管理。</p>
                                        {selected.id !== directory.currentId && (
                                            <Button className="mt-4" variant="outline" onClick={() => setDestination(selected)}>
                                                切换到此空间
                                            </Button>
                                        )}
                                    </CardContent>
                                </Card>
                            ) : (
                                selected && (
                                    <TeamWorkspaceDetails
                                        key={selected.id}
                                        workspace={selected}
                                        currentId={directory.currentId}
                                        onSwitch={() => setDestination(selected)}
                                    />
                                )
                            )}
                        </section>
                    </div>
                </>
            )}
            <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
            <SwitchWorkspaceDialog key={destination?.id ?? 'none'} workspace={destination} onClose={() => setDestination(null)} />
        </section>
    )
}
