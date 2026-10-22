'use client'

import type { CollaborationProject, CollaborationProjectProgress } from '@ai-harness/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
    CollaborationRequestError,
    getCollaborationProject,
    getCollaborationProjectProgress,
    sendCollaborationCommand,
} from '../lib/collaboration-client'
import { groupProjectRelations } from '../lib/project-relations'
import { FeedbackMessage } from './ui/feedback-message'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import { Textarea } from './ui/textarea'

type ProgressNode = CollaborationProjectProgress['nodes'][number]
type ProgressWait = CollaborationProjectProgress['waits'][number]
export interface WorkTemplateOrigin {
    templateId: string
    version: number
    nodeId: string
}

/**
 * Extracts only public template identities from full project metadata.
 * @param project - Authorized project response containing optional frozen origins.
 * @returns Node-indexed immutable identity labels without goals, context, or private sources.
 */
export function projectTemplateOrigins(project: CollaborationProject): Record<string, WorkTemplateOrigin> {
    const origins: Record<string, WorkTemplateOrigin> = {}
    for (const node of project.nodes) {
        const origin = node.workflowOrigin
        if (origin) origins[node.id] = { templateId: origin.templateId, version: origin.version, nodeId: origin.nodeId }
    }
    return origins
}

/**
 * Converts a failed progress read or explicit action into public feedback.
 * @param cause - Unknown application error.
 * @returns A short actionable message without private transport diagnostics.
 */
function failure(cause: unknown): string {
    return cause instanceof Error ? cause.message : '暂时无法读取协作进度，请重试。'
}

/**
 * Repeatedly reads one safe project projection while cancelling obsolete account or project reads.
 * @param projectId - Current authorized project identity.
 * @returns The last successful metadata, honest failure state, and explicit refresh operation.
 */
export function useProjectProgress(projectId: string) {
    const scope = useMemo(() => ({ projectId }), [projectId])
    const [snapshot, setSnapshot] = useState<{ scope: typeof scope; data: CollaborationProjectProgress; readAt: string } | null>(null)
    const [failureState, setFailureState] = useState<{ scope: typeof scope; message: string; status: number | null } | null>(null)
    const [reading, setReading] = useState<typeof scope | null>(null)
    const manualRead = useRef<{ scope: typeof scope; request(): void } | null>(null)
    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        let inFlight = false
        let queued = false
        /**
         * Schedules one future check without making hidden-page requests.
         * @returns Nothing; replaces any existing automatic timer.
         */
        function schedule(): void {
            clearTimeout(timer)
            if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
        }
        /**
         * Reads one safe projection and drains at most one coalesced refresh after it settles.
         * @returns After one visible-page read; automatic and manual reads never overlap in this scope.
         */
        async function poll(): Promise<void> {
            if (controller.signal.aborted) return
            if (inFlight) {
                queued = true
                return
            }
            clearTimeout(timer)
            if (document.visibilityState === 'hidden') {
                schedule()
                return
            }
            inFlight = true
            setReading(scope)
            try {
                const saved = await getCollaborationProjectProgress(projectId, controller.signal)
                if (saved.projectId !== projectId) throw new Error('协作进度与当前项目不匹配，请重新读取。')
                if (!controller.signal.aborted) {
                    setSnapshot({ scope, data: saved, readAt: new Date().toISOString() })
                    setFailureState(null)
                }
            } catch (cause) {
                if (!controller.signal.aborted) {
                    const status = cause instanceof CollaborationRequestError ? cause.status : null
                    if (status !== null && [401, 403, 404].includes(status)) setSnapshot(null)
                    setFailureState({ scope, message: failure(cause), status })
                }
            } finally {
                inFlight = false
                if (!controller.signal.aborted) {
                    setReading(null)
                    if (queued) {
                        queued = false
                        void poll()
                    } else schedule()
                }
            }
        }
        /**
         * Coalesces repeated human refreshes while retaining the current slow read and confirmed snapshot.
         * @returns Nothing; requests one immediate subsequent read when one is already active.
         */
        function request(): void {
            if (controller.signal.aborted) return
            if (inFlight) queued = true
            else void poll()
        }
        const reader = { scope, request }
        manualRead.current = reader
        void poll()
        return () => {
            controller.abort()
            clearTimeout(timer)
            if (manualRead.current === reader) manualRead.current = null
        }
    }, [projectId, scope])
    /**
     * Requests a serialized refresh without dropping confirmed data or overlapping the current request.
     * @returns Nothing; repeated requests during a read are coalesced into one follow-up.
     */
    const refresh = useCallback(() => {
        if (manualRead.current?.scope === scope) manualRead.current.request()
    }, [scope])
    const current = snapshot?.scope === scope ? snapshot : null
    const currentFailure = failureState?.scope === scope ? failureState : null
    return {
        data: current?.data ?? null,
        readAt: current?.readAt ?? null,
        error: currentFailure?.message ?? '',
        errorStatus: currentFailure?.status ?? null,
        loading: reading === scope,
        refresh,
    }
}

export interface ProjectProgressReadState {
    data: CollaborationProjectProgress | null
    error: string
    refresh(): void
    readAt?: string | null
    loading?: boolean
    errorStatus?: number | null
}

/**
 * Presents actual receipt time, stale snapshots, and read failures without inventing empty progress.
 * @param props - Shared parent reader and the visible progress presentation.
 * @returns Honest read feedback and an explicit read-only retry action.
 */
export function ProjectProgressFeedback({ progress, board = false }: { progress: ProjectProgressReadState; board?: boolean }) {
    return (
        <div className="grid min-w-0 gap-3">
            {progress.readAt && (
                <p className="text-xs text-muted-foreground">
                    最后确认读取：<time dateTime={progress.readAt}>{new Date(progress.readAt).toLocaleString('zh-CN')}</time>
                </p>
            )}
            {progress.error && (
                <FeedbackMessage variant="error">
                    {progress.error}
                    {progress.data && <p>{board ? '刷新失败，当前仅上次成功读取的数据。' : '未能刷新，以下仅为上次成功读取的进度。'}</p>}
                    <Button variant="outline" disabled={progress.loading} onClick={progress.refresh}>
                        {board ? '重新读取看板' : '重新读取协作进度'}
                    </Button>
                </FeedbackMessage>
            )}
            {!progress.data && !progress.error && (
                <p role="status" className="text-sm text-muted-foreground">
                    正在读取协作进度…
                </p>
            )}
            {progress.data && progress.loading && (
                <p role="status" className="text-xs text-muted-foreground">
                    正在刷新{board ? '看板' : '协作进度'}…
                </p>
            )}
        </div>
    )
}

/**
 * Accepts a server-projected own-chat route only for its actual source owner.
 * @param node - Safe work projection with an optional authorized own link.
 * @param userId - Authenticated viewer identity.
 * @returns A bounded local conversation URL or null without a private navigation grant.
 */
function ownHref(node: ProgressNode, userId: string | undefined): string | null {
    if (node.ownerId !== userId || !node.ownHref || !/^\/\?conversation=[0-9a-f-]{36}(?:&event=[0-9a-f-]{36})?$/i.test(node.ownHref))
        return null
    return node.ownHref
}

/**
 * Labels only actual stored execution states, leaving waiting targets to real pending requests.
 * @param node - Safe node metadata.
 * @param waits - All legitimate pending requests for this project.
 * @param byId - Visible safe nodes indexed by actual identifier.
 * @returns The actual state or a precise pending target, never an inferred waiting-owner actor.
 */
function stateLabel(node: ProgressNode, waits: ProgressWait[], byId: Map<string, ProgressNode>): string {
    if (!node.authorized) return '授权已撤销'
    const terminal: Record<string, string> = { running: '正在执行', failed: '执行失败', cancelled: '已取消', completed: '已完成' }
    if (terminal[node.status]) return terminal[node.status]!
    const outgoing = waits.filter(wait => wait.fromNodeId === node.id)
    if (outgoing.length > 1) return `有 ${outgoing.length} 项协作等待`
    const waiting = outgoing[0]
    const target = waiting && byId.get(waiting.targetNodeId)
    if (waiting && target)
        return waiting.kind === 'self'
            ? `等待${target.ownerName}本人判断`
            : `等待${target.ownerName}${waiting.kind === 'upstream' ? '补充信息' : '处理'}`
    return node.status === 'awaiting-activation' ? '正在准备聊天' : '可继续'
}

/**
 * Renders one exact own work without silently choosing another work or restoring an old grant.
 * @param props - Safe node, actual viewer, real waits, and visible node metadata.
 * @returns One labeled work with its exact continue or historical-view route.
 */
function OwnWork({
    node,
    userId,
    waits,
    byId,
    origin,
}: {
    node: ProgressNode
    userId: string | undefined
    waits: ProgressWait[]
    byId: Map<string, ProgressNode>
    origin?: WorkTemplateOrigin
}) {
    const href = ownHref(node, userId)
    const canContinue = node.authorized && node.canContinue && !['cancelled', 'completed'].includes(node.status)
    return (
        <li className="workspace-item grid min-w-0 gap-2 border-b py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <h4 className="min-w-0 max-w-full font-medium [overflow-wrap:anywhere]">{node.title}</h4>
                <Badge variant="secondary" className="h-auto min-h-5 max-w-full whitespace-normal [overflow-wrap:anywhere] text-left">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{stateLabel(node, waits, byId)}</span>
                </Badge>
            </div>
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {node.ownerName} · 人员 {node.ownerId.slice(0, 8)} · 工作 {node.id.slice(0, 8)}
            </p>
            {origin && (
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    协作模板 {origin.templateId.slice(0, 8)} · v{origin.version} · 原节点 {origin.nodeId.slice(0, 8)}
                </p>
            )}
            {href ? (
                <Link href={href} className="text-sm underline">
                    {canContinue ? '继续我的聊天' : '查看我的聊天'}
                </Link>
            ) : (
                <p className="text-xs text-muted-foreground">当前没有可进入的本人聊天。</p>
            )}
        </li>
    )
}

/**
 * Presents independent own work, real pending targets, and finite vertical responsibility chains.
 * @param props - Safe progress read state and the authenticated viewer.
 * @returns The project-only progress interface without private goals, questions, or another person's links.
 */
export function ProjectProgressView({
    progress,
    userId,
    origins = {},
}: {
    progress: ProjectProgressReadState
    userId: string | undefined
    origins?: Record<string, WorkTemplateOrigin>
}) {
    const [filter, setFilter] = useState<'all' | 'mine' | 'waiting' | 'other'>('all')
    const data = progress.data
    const byId = new Map((data?.nodes ?? []).map(node => [node.id, node]))
    const waits = (data?.waits ?? [])
        .filter(wait => byId.has(wait.fromNodeId) && byId.has(wait.targetNodeId))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    const mine = (data?.nodes ?? []).filter(node => node.ownerId === userId)
    const ongoing = mine.filter(node => node.authorized && !['cancelled', 'completed'].includes(node.status))
    const ended = mine.filter(node => !node.authorized || ['cancelled', 'completed'].includes(node.status))
    const relation = groupProjectRelations(data?.nodes ?? [])
    const visibleWaits = waits.filter(wait => {
        const kind =
            byId.get(wait.targetNodeId)?.ownerId === userId ? 'mine' : byId.get(wait.fromNodeId)?.ownerId === userId ? 'waiting' : 'other'
        return filter === 'all' || filter === kind
    })

    /**
     * Displays a safe responsibility entry without indenting by depth or duplicating its identity.
     * @param node - One unique visible work record.
     * @returns A fixed-width entry with an explicit visible upstream or an honest unavailable marker.
     */
    function relationEntry(node: ProgressNode) {
        const upstream = node.upstreamNodeId ? byId.get(node.upstreamNodeId) : null
        return (
            <li key={node.id} className="workspace-item grid min-w-0 gap-2 border-b py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="min-w-0 max-w-full font-medium [overflow-wrap:anywhere]">{node.title}</h4>
                    <Badge variant="secondary" className="h-auto min-h-5 max-w-full whitespace-normal [overflow-wrap:anywhere] text-left">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{stateLabel(node, waits, byId)}</span>
                    </Badge>
                </div>
                <p className="[overflow-wrap:anywhere] text-sm">
                    负责人：{node.ownerName} · {node.ownerId.slice(0, 8)}
                </p>
                <p className="text-xs text-muted-foreground">工作 {node.id.slice(0, 8)}</p>
                {origins[node.id] && (
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        原节点 {origins[node.id]!.nodeId.slice(0, 8)} · 模板 v{origins[node.id]!.version}
                    </p>
                )}
                <p className="[overflow-wrap:anywhere] text-sm text-muted-foreground">
                    {!node.upstreamNodeId
                        ? '根工作，无上游'
                        : upstream
                          ? `上游：${upstream.title}（${upstream.ownerName} · ${upstream.id.slice(0, 8)}）`
                          : '原上游当前不可用'}
                </p>
            </li>
        )
    }

    return (
        <section className="grid min-w-0 gap-8" aria-labelledby="team-project-overview-title">
            <h2 id="team-project-overview-title" className="text-[length:var(--type-subheading)] font-semibold">
                项目概览
            </h2>
            <ProjectProgressFeedback progress={progress} />
            {data && (
                <>
                    <section className="grid min-w-0 gap-3" aria-labelledby="project-own-work-title">
                        <h3 id="project-own-work-title" className="text-[length:var(--type-subheading)] font-semibold">
                            我的工作
                        </h3>
                        {ongoing.length === 0 ? (
                            <p className="text-sm text-muted-foreground">还没有可继续的本人工作，可从“开始我的工作”创建一项新工作。</p>
                        ) : (
                            <ul className="workspace-collection grid min-w-0">
                                {ongoing.map(node => (
                                    <OwnWork
                                        key={node.id}
                                        node={node}
                                        userId={userId}
                                        waits={waits}
                                        byId={byId}
                                        origin={origins[node.id]}
                                    />
                                ))}
                            </ul>
                        )}
                        {ended.length > 0 && (
                            <Collapsible>
                                <CollapsibleTrigger render={<Button variant="ghost" />}>已结束的工作（{ended.length}）</CollapsibleTrigger>
                                <CollapsibleContent>
                                    <ul className="workspace-collection grid min-w-0 pt-3">
                                        {ended.map(node => (
                                            <OwnWork
                                                key={node.id}
                                                node={node}
                                                userId={userId}
                                                waits={waits}
                                                byId={byId}
                                                origin={origins[node.id]}
                                            />
                                        ))}
                                    </ul>
                                </CollapsibleContent>
                            </Collapsible>
                        )}
                    </section>
                    <section className="grid min-w-0 gap-3" aria-labelledby="project-waits-title">
                        <h3 id="project-waits-title" className="text-[length:var(--type-subheading)] font-semibold">
                            待处理
                        </h3>
                        <p className="text-sm text-muted-foreground">{waits.length} 项协作请求；这是等待中的请求数，不表示项目完成率。</p>
                        <RadioGroup
                            value={filter}
                            onValueChange={value => setFilter(value as typeof filter)}
                            aria-label="协作请求筛选"
                            className="flex flex-wrap gap-3"
                        >
                            {[
                                { value: 'all', label: '全部' },
                                { value: 'mine', label: '待我处理' },
                                { value: 'waiting', label: '我在等待' },
                                { value: 'other', label: '其他协作' },
                            ].map(option => (
                                <Label
                                    key={option.value}
                                    htmlFor={`project-waits-${option.value}`}
                                    className="flex min-h-11 items-center gap-2"
                                >
                                    <RadioGroupItem id={`project-waits-${option.value}`} value={option.value} />
                                    {option.label}
                                </Label>
                            ))}
                        </RadioGroup>
                        {waits.length === 0 ? (
                            <p className="text-sm text-muted-foreground">当前没有待处理的协作请求。</p>
                        ) : visibleWaits.length === 0 ? (
                            <p className="text-sm text-muted-foreground">此分类中没有待处理的协作请求。</p>
                        ) : (
                            <ul className="grid min-w-0 gap-3">
                                {visibleWaits.map(wait => {
                                    const from = byId.get(wait.fromNodeId)!
                                    const target = byId.get(wait.targetNodeId)!
                                    const processing = target.ownerId === userId
                                    const requester = from.ownerId === userId
                                    const targetHref = ownHref(target, userId)
                                    const fromHref = ownHref(from, userId)
                                    return (
                                        <li key={`${wait.id}:${wait.version}`}>
                                            <Card className="min-w-0 gap-3 rounded-none border-0 border-b bg-transparent py-4 shadow-none">
                                                <CardHeader className="px-0">
                                                    <CardTitle className="min-w-0 max-w-full text-[length:var(--type-subheading)] [overflow-wrap:anywhere]">
                                                        {wait.kind === 'self'
                                                            ? `等待${target.ownerName}本人判断`
                                                            : `${from.ownerName}正在等待${target.ownerName}${wait.kind === 'upstream' ? '补充信息' : '处理协作请求'}`}
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent className="grid min-w-0 gap-2 px-0">
                                                    <p className="[overflow-wrap:anywhere] text-sm">
                                                        请求方：{from.title} · {from.id.slice(0, 8)}（{from.ownerName} ·{' '}
                                                        {from.ownerId.slice(0, 8)}）
                                                    </p>
                                                    <p className="[overflow-wrap:anywhere] text-sm">
                                                        应处理方：{target.title} · {target.id.slice(0, 8)}（{target.ownerName} ·{' '}
                                                        {target.ownerId.slice(0, 8)}）
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {wait.kind === 'self'
                                                            ? '本人判断'
                                                            : wait.kind === 'upstream'
                                                              ? '向上游补充信息'
                                                              : '下游处理请求'}{' '}
                                                        · {new Date(wait.createdAt).toLocaleString('zh-CN')} · 请求 {wait.id.slice(0, 8)} v
                                                        {wait.version}
                                                    </p>
                                                    {processing && target.authorized && target.canContinue && targetHref ? (
                                                        <Link className="text-sm underline" href={targetHref}>
                                                            去我的聊天处理
                                                        </Link>
                                                    ) : requester && fromHref ? (
                                                        <Link className="text-sm underline" href={fromHref}>
                                                            查看我的聊天
                                                        </Link>
                                                    ) : null}
                                                </CardContent>
                                            </Card>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </section>
                    <section className="grid min-w-0 gap-3" aria-labelledby="project-relations-title">
                        <h3 id="project-relations-title" className="text-[length:var(--type-subheading)] font-semibold">
                            协作关系
                        </h3>
                        {data.nodes.length === 0 && <p className="text-sm text-muted-foreground">还没有关联的协作工作。</p>}
                        {relation.roots.map((group, index) => (
                            <section className="grid min-w-0 gap-2" key={group.rootId} aria-label={`责任链 ${index + 1}`}>
                                <h4 className="text-sm font-medium">责任链 {index + 1}</h4>
                                <ol className="grid min-w-0 gap-2">{group.nodes.map(relationEntry)}</ol>
                            </section>
                        ))}
                        {relation.unresolved.length > 0 && (
                            <section className="grid min-w-0 gap-2" aria-label="关系待整理">
                                <h4 className="font-medium">关系待整理</h4>
                                <p className="text-sm text-muted-foreground">
                                    这些历史工作存在无效引用或环，保留真实记录，不猜测或自动修复关系。
                                </p>
                                <ul className="grid min-w-0 gap-2">{relation.unresolved.map(relationEntry)}</ul>
                            </section>
                        )}
                    </section>
                </>
            )}
        </section>
    )
}

/**
 * Explicitly creates a new own root work and empty ordinary conversation in the chosen project.
 * @param props - Confirmed project, safe existing works, viewer identity, and close/reload callbacks.
 * @returns A private-goal form that never preloads project descriptions or automatically resumes old work.
 */
export function ProjectStartDialog({
    project,
    progress,
    userId,
    onClose,
    onSaved,
}: {
    project: CollaborationProject
    progress: CollaborationProjectProgress | null
    userId: string | undefined
    onClose: () => void
    onSaved: () => void
}) {
    const router = useRouter()
    const [baseline, setBaseline] = useState(project.revision)
    const [title, setTitle] = useState('')
    const [goal, setGoal] = useState('')
    const [fields, setFields] = useState<Record<string, string>>({})
    const [error, setError] = useState('')
    const [feedbackVariant, setFeedbackVariant] = useState<'info' | 'error'>('error')
    const [busy, setBusy] = useState(false)
    const [conflict, setConflict] = useState(false)
    const pending = useRef(false)
    const action = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const titleRef = useRef<HTMLInputElement>(null)
    const goalRef = useRef<HTMLTextAreaElement>(null)
    const existing = (progress?.nodes ?? []).filter(node => node.ownerId === userId)
    const origins = projectTemplateOrigins(project)
    const byId = new Map((progress?.nodes ?? []).map(node => [node.id, node]))

    /**
     * Reloads the current project authorization revision without replacing the human's unsaved goal.
     * @returns After an explicit review checkpoint, leaving resubmission to the human.
     */
    async function reread(): Promise<void> {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        try {
            const saved = await getCollaborationProject(project.id)
            setBaseline(saved.revision)
            setConflict(false)
            setFeedbackVariant('info')
            setError('已读取最新项目，本地名称和目标已保留。请核对后再次提交。')
            onSaved()
        } catch (cause) {
            setFeedbackVariant('error')
            setError(failure(cause))
        } finally {
            pending.current = false
            setBusy(false)
        }
    }

    /**
     * Persists one retained human creation action before navigating to its actual own conversation.
     * @param event - Explicit create-and-enter form submission.
     * @returns After a confirmed empty chat is created, or a visible failure preserving all draft fields.
     */
    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault()
        if (pending.current || conflict) return
        setFields({})
        const normalizedTitle = title.trim()
        const normalizedGoal = goal.trim()
        if (!normalizedTitle || normalizedTitle.length > 120) {
            setFields({ title: '工作名称须为 1–120 个字。' })
            titleRef.current?.focus()
            return
        }
        if (!normalizedGoal || normalizedGoal.length > 32000) {
            setFields({ goal: '工作目标须为 1–32,000 个字。' })
            goalRef.current?.focus()
            return
        }
        const input = {
            type: 'project-start' as const,
            projectId: project.id,
            revision: baseline,
            title: normalizedTitle,
            goal: normalizedGoal,
        }
        const fingerprint = JSON.stringify(input)
        if (action.current?.fingerprint !== fingerprint) action.current = { fingerprint, requestId: crypto.randomUUID() }
        pending.current = true
        setBusy(true)
        setError('')
        try {
            const result = await sendCollaborationCommand({ ...input, requestId: action.current.requestId })
            if (!result.conversationId) throw new Error('未能确认聊天编号，请保留当前输入后重试。')
            onSaved()
            onClose()
            router.push(`/?${new URLSearchParams({ conversation: result.conversationId })}`)
        } catch (cause) {
            setFeedbackVariant('error')
            setError(failure(cause))
            if (cause instanceof CollaborationRequestError && cause.status === 409) setConflict(true)
        } finally {
            pending.current = false
            setBusy(false)
        }
    }

    return (
        <Dialog open onOpenChange={open => !open && !pending.current && onClose()}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto" initialFocus={titleRef}>
                <DialogHeader>
                    <DialogTitle>开始我的工作</DialogTitle>
                    <DialogDescription>
                        名称、负责人和协作进度对项目成员可见；目标供你与自己的 Agent
                        工作，不会自动发给同事。创建和查看空聊天不执行模型，首次本人输入后才运行。
                    </DialogDescription>
                </DialogHeader>
                {existing.length > 0 && (
                    <section className="grid gap-3" aria-label="已有的本人工作">
                        <h3 className="font-medium">继续已有工作</h3>
                        <ul className="grid min-w-0 gap-2">
                            {existing.map(node => (
                                <OwnWork
                                    key={node.id}
                                    node={node}
                                    userId={userId}
                                    waits={progress?.waits ?? []}
                                    byId={byId}
                                    origin={origins[node.id]}
                                />
                            ))}
                        </ul>
                        <h3 className="border-t pt-3 font-medium">新建另一项工作</h3>
                    </section>
                )}
                <form className="grid min-w-0 gap-4" noValidate onSubmit={event => void submit(event)}>
                    <div className="grid gap-2">
                        <Label htmlFor="project-work-title">工作名称</Label>
                        <Input
                            id="project-work-title"
                            ref={titleRef}
                            value={title}
                            onChange={event => setTitle(event.target.value)}
                            maxLength={120}
                            required
                            disabled={busy}
                            aria-invalid={Boolean(fields.title)}
                            aria-describedby={fields.title ? 'project-work-title-error' : undefined}
                        />
                        {fields.title && (
                            <p id="project-work-title-error" role="alert" className="text-sm text-error-foreground">
                                {fields.title}
                            </p>
                        )}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="project-work-goal">工作目标</Label>
                        <Textarea
                            id="project-work-goal"
                            ref={goalRef}
                            value={goal}
                            onChange={event => setGoal(event.target.value)}
                            maxLength={32000}
                            rows={7}
                            required
                            disabled={busy}
                            aria-invalid={Boolean(fields.goal)}
                            aria-describedby={fields.goal ? 'project-work-goal-error' : undefined}
                        />
                        {fields.goal && (
                            <p id="project-work-goal-error" role="alert" className="text-sm text-error-foreground">
                                {fields.goal}
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {goal.length.toLocaleString()} / 32,000 字。目标不会自动公开给其他项目成员。
                        </p>
                    </div>
                    {error && <FeedbackMessage variant={feedbackVariant}>{error}</FeedbackMessage>}
                    {conflict && (
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void reread()}>
                            重新读取项目，保留本地输入
                        </Button>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="submit" disabled={busy || conflict}>
                            {busy ? '正在创建…' : '创建并进入聊天'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
