'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
    AgentDefinition,
    ChatMessage,
    CollaborationArtifact,
    CollaborationCommand,
    CollaborationDispatch,
    CollaborationEvent,
    CollaborationNode,
    CollaborationNodeDetail,
    CollaborationNotification,
    CollaborationProject,
    CollaborationQuestion,
    CollaborationSource,
} from '@ai-harness/contracts'
import {
    getCollaborationMessages,
    getCollaborationNode,
    getCollaborationProject,
    getNodeCollaborationEvents,
    getSourceCollaboration,
    getCollaborationNotificationPage,
    listCollaborationProjects,
    sendCollaborationCommand,
    CollaborationRequestError,
} from '../lib/collaboration-client'
import { listAgents } from '../lib/agent-client'
import { collaborationDispatchAnchor } from '../lib/collaboration-timeline'
import { useAccount } from './account-context'
import { FeedbackMessage } from './ui/feedback-message'
import { Disclosure } from './ui/disclosure'
import { Badge } from './ui/badge'
import { Button, buttonVariants } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Textarea } from './ui/textarea'
import { TeamProjectOverview } from './team-project'

const nodeLabels: Record<CollaborationNode['status'], string> = {
    'awaiting-activation': '正在准备对话',
    ready: '可处理',
    running: '正在执行',
    'waiting-upstream': '等待上游',
    'waiting-owner': '等待负责人判断',
    failed: '执行失败',
    cancelled: '已取消',
    completed: '本轮已结束',
}
const eventLabels: Record<CollaborationEvent['kind'], string> = {
    delegation: '工作交接',
    question: '协作追问',
    answer: '问题答复',
    artifact: '共享成果',
    adoption: '采用成果',
    decision: '负责人判断',
    revision: '协作修订',
    cancelled: '协作取消',
    message: '消息',
}

/**
 * Describes a failure using only safe application feedback.
 * @param error - Request or shared schema failure.
 * @returns A short message suitable for an inline alert.
 */
function failureText(error: unknown): string {
    return error instanceof Error ? error.message : '协作服务暂不可用，请重试。'
}

/**
 * Links an owned work source without confusing a pending node identifier with a task identifier.
 * @param node - Authorized node projection and its current work source.
 * @param eventId - Optional event to focus in the original context.
 * @returns A stable private source or shared node URL.
 */
export function collaborationNodeHref(node: CollaborationNode, eventId?: string): string {
    if (node.canWork && node.source) {
        return `/?${new URLSearchParams({ conversation: node.source.id, ...(eventId ? { event: eventId } : {}) })}`
    }
    return `/projects/${node.projectId}?${new URLSearchParams({ node: node.id, ...(eventId ? { event: eventId } : {}) })}`
}

/**
 * Polls saved state with one request at a time and pauses while the document is hidden.
 * @param read - Stable request function for the currently selected resource.
 * @param enabled - Whether this resource is visible and meaningful.
 * @returns Confirmed data, safe error feedback, and an explicit reload action.
 */
function useSavedCollaboration<T>(read: (signal: AbortSignal) => Promise<T>, enabled = true) {
    const [snapshot, setSnapshot] = useState<{ reader: typeof read; data: T } | null>(null)
    const [error, setError] = useState('')
    const [errorStatus, setErrorStatus] = useState<number | null>(null)
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        if (!enabled) return
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        /**
         * Reads one bounded snapshot and schedules the next read only after settling.
         * @returns A promise settled after this request and its state update.
         */
        async function poll() {
            if (controller.signal.aborted) return
            if (document.visibilityState !== 'hidden') {
                try {
                    const saved = await read(controller.signal)
                    if (!controller.signal.aborted) {
                        setSnapshot({ reader: read, data: saved })
                        setError('')
                        setErrorStatus(null)
                    }
                } catch (cause) {
                    if (!controller.signal.aborted) {
                        if (cause instanceof CollaborationRequestError && [401, 403, 404].includes(cause.status)) setSnapshot(null)
                        setError(failureText(cause))
                        setErrorStatus(cause instanceof CollaborationRequestError ? cause.status : 0)
                    }
                }
            }
            if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
        }
        void poll()
        return () => {
            controller.abort()
            clearTimeout(timer)
        }
    }, [read, enabled, revision])
    /**
     * Explicitly reloads this resource while retaining form drafts.
     * @returns Nothing; invalidates the previous request before starting another.
     */
    const refresh = useCallback(function refresh() {
        setRevision(value => value + 1)
    }, [])
    return { data: enabled && snapshot?.reader === read ? snapshot.data : null, error, errorStatus, refresh }
}

/**
 * Merges bounded recent reads with explicitly requested older pages for one exact account resource.
 * @param key - Account and resource identity, preventing cross-thread history reuse.
 * @param readPage - Stable authorized reader accepting an optional older-page cursor.
 * @param enabled - Whether the history is currently visible.
 * @param permits - Optional current authorization projection used to remove revoked cached records.
 * @returns Chronological saved history, bounded pagination, and nearby safe error feedback.
 */
function useCollaborationHistory<T extends { id: string; sequence: number }>(
    key: string,
    readPage: (signal: AbortSignal, before?: number) => Promise<T[]>,
    enabled = true,
    permits?: (item: T) => boolean
) {
    const cache = useRef<{ key: string; items: T[]; hasEarlier: boolean; paged: boolean }>({
        key: '',
        items: [],
        hasEarlier: false,
        paged: false,
    })
    const pagingController = useRef<AbortController | null>(null)
    const [paging, setPaging] = useState({ key: '', pending: false, error: '' })
    const read = useCallback(
        async (signal: AbortSignal) => {
            let page: T[]
            try {
                page = await readPage(signal)
            } catch (cause) {
                if (!signal.aborted && cause instanceof CollaborationRequestError && [401, 403, 404].includes(cause.status))
                    cache.current = { key, items: [], hasEarlier: false, paged: false }
                throw cause
            }
            if (signal.aborted) return { items: [] as T[], hasEarlier: false }
            if (cache.current.key !== key) cache.current = { key, items: [], hasEarlier: false, paged: false }
            const items = new Map(cache.current.items.map(item => [item.id, item]))
            for (const item of page) items.set(item.id, item)
            cache.current.items = [...items.values()]
                .filter(item => !permits || permits(item))
                .sort((left, right) => left.sequence - right.sequence)
            if (!cache.current.paged) cache.current.hasEarlier = page.length === 100
            return { items: cache.current.items, hasEarlier: cache.current.hasEarlier }
        },
        [key, readPage, permits]
    )
    const saved = useSavedCollaboration(read, enabled)
    useEffect(
        () => () => {
            pagingController.current?.abort()
            pagingController.current = null
        },
        [key, enabled]
    )
    /**
     * Loads one earlier authorized page without discarding already visible or newly polled records.
     * @returns A promise settled after a saved page or recoverable inline failure.
     */
    async function loadEarlier() {
        if (pagingController.current || cache.current.key !== key || !cache.current.hasEarlier || !enabled) return
        const before = cache.current.items[0]?.sequence
        if (!before) return
        const controller = new AbortController()
        pagingController.current = controller
        setPaging({ key, pending: true, error: '' })
        try {
            const page = await readPage(controller.signal, before)
            if (controller.signal.aborted || cache.current.key !== key) return
            const items = new Map([...cache.current.items, ...page].map(item => [item.id, item]))
            cache.current.items = [...items.values()]
                .filter(item => !permits || permits(item))
                .sort((left, right) => left.sequence - right.sequence)
            cache.current.hasEarlier = page.length === 100
            cache.current.paged = true
            saved.refresh()
        } catch (cause) {
            if (!controller.signal.aborted) {
                if (cause instanceof CollaborationRequestError && [401, 403, 404].includes(cause.status)) {
                    cache.current = { key, items: [], hasEarlier: false, paged: false }
                    saved.refresh()
                }
                setPaging({ key, pending: false, error: failureText(cause) })
            }
        } finally {
            if (!controller.signal.aborted) setPaging(current => ({ ...current, pending: false }))
            if (pagingController.current === controller) pagingController.current = null
        }
    }
    return { ...saved, loadEarlier, paging: paging.key === key ? paging : { pending: false, error: '' } }
}

/**
 * Keeps a failed mutation's action identity stable until its exact content changes.
 * @returns Command execution, pending state, and nearby failure or success feedback.
 */
function useCollaborationAction() {
    const [pending, setPending] = useState(false)
    const [error, setError] = useState('')
    const action = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const busy = useRef(false)
    /**
     * Executes one command while preserving its idempotency identity after failure.
     * @param make - Produces the strict command from the retained action identifier.
     * @param fingerprint - Exact logical content identifying this form submission.
     * @returns The committed result, or null with visible feedback after failure.
     */
    async function run(make: (requestId: string) => CollaborationCommand, fingerprint: string) {
        if (busy.current) return null
        if (action.current?.fingerprint !== fingerprint) action.current = { fingerprint, requestId: crypto.randomUUID() }
        busy.current = true
        setPending(true)
        setError('')
        try {
            const saved = await sendCollaborationCommand(make(action.current.requestId))
            action.current = null
            return saved
        } catch (cause) {
            setError(failureText(cause))
            return null
        } finally {
            busy.current = false
            setPending(false)
        }
    }
    return { run, pending, error }
}

/**
 * Presents the exact saved recipient and message before a human chooses whether to send it.
 * @param props - An authorized saved draft, source execution state, and a refresh callback.
 * @returns An inline confirmation card with durable success feedback and retained retry identity.
 */
function CollaborationDispatchCard({
    draft,
    sourceActive,
    onSaved,
    onResolved,
}: {
    draft: CollaborationDispatch
    sourceActive: boolean
    onSaved: () => void
    onResolved?: (draft: CollaborationDispatch) => void
}) {
    const action = useCollaborationAction()
    const [settledStatus, setSettledStatus] = useState<'sent' | 'cancelled' | null>(null)
    const status = settledStatus ?? draft.status
    const pending = status === 'pending'
    /**
     * Confirms or cancels only the exact server-saved version without resubmitting editable content.
     * @param type - Explicit action chosen by the person reviewing this draft.
     * @returns A promise settled after server acknowledgement and the saved state refresh.
     */
    async function resolve(type: 'confirm-dispatch' | 'cancel-dispatch') {
        if (!pending || sourceActive) return
        const result = await action.run(
            requestId => ({ type, requestId, draftId: draft.id, version: draft.version }),
            `${type}:${draft.id}:${draft.version}`
        )
        if (!result) return
        if (result.dispatchStatus === 'sent' || result.dispatchStatus === 'cancelled') {
            setSettledStatus(result.dispatchStatus)
            onResolved?.({ ...draft, status: result.dispatchStatus, result })
        }
        onSaved()
    }
    if (!pending)
        return (
            <FeedbackMessage variant={status === 'sent' ? 'success' : status === 'superseded' ? 'warning' : 'info'}>
                {status === 'sent'
                    ? `已发送给 ${draft.recipientName}`
                    : status === 'superseded'
                      ? '内容已更新，请核对最新内容。'
                      : '此次内容未发送。'}
            </FeedbackMessage>
        )
    return (
        <section role="region" aria-label={`发送前确认：${draft.recipientName}`} className="min-w-0 space-y-3 text-sm">
            <p className="[overflow-wrap:anywhere]">收件人：{draft.recipientName}</p>
            {draft.kind === 'fixed-contact' && draft.targetNodeId && (
                <p className="[overflow-wrap:anywhere]">
                    目标工作：{draft.targetTitle} · {draft.targetNodeId.slice(0, 8)}（
                    {draft.fixedKind === 'question'
                        ? '向上游补问'
                        : draft.fixedKind === 'reply'
                          ? '回复实际问题'
                          : draft.fixedKind === 'handoff'
                            ? '交给固定下游'
                            : '转告固定同事'}
                    ）
                </p>
            )}
            {draft.kind === 'answer' && draft.decision && draft.decision !== 'information' && (
                <p>{draft.decision === 'approved' ? '本人确认可接受' : '本人判断不通过'}</p>
            )}
            <div className="space-y-3 border-l-2 border-border pl-4">
                {[...new Set([draft.title, draft.content, draft.goal, draft.context].filter(value => value?.trim()))].map(content => (
                    <p key={content} className="whitespace-pre-wrap break-words">
                        {content}
                    </p>
                ))}
            </div>
            <p className="text-muted-foreground">
                {sourceActive
                    ? 'Agent 正在整理内容，完成后即可确认。'
                    : `以上内容将发送给 ${draft.recipientName}${draft.kind === 'delegate' ? '，并保存在本次协作记录中。' : '。'}需要修改时，直接在对话中告诉 Agent。`}
            </p>
            <div className="flex flex-wrap gap-2">
                <Button disabled={action.pending || sourceActive} onClick={() => void resolve('confirm-dispatch')}>
                    {action.pending ? '正在处理…' : '确认发送'}
                </Button>
                <Button variant="outline" disabled={action.pending || sourceActive} onClick={() => void resolve('cancel-dispatch')}>
                    暂不发送
                </Button>
            </div>
            {action.error && (
                <FeedbackMessage variant="error" role="alert">
                    {action.error}
                </FeedbackMessage>
            )}
        </section>
    )
}

/**
 * Displays saved events as attributed collaboration facts without executing their text.
 * @param props - Authorized events and an optional deep-linked event identifier.
 * @returns Accessible event cards with stable anchors.
 */
function CollaborationEvents({ events, eventId }: { events: CollaborationEvent[]; eventId?: string }) {
    const focusedEvent = useRef<string | undefined>(undefined)
    useEffect(() => {
        if (!eventId) {
            focusedEvent.current = undefined
            return
        }
        if (focusedEvent.current === eventId || !events.some(event => event.id === eventId)) return
        const element = document.getElementById(`collaboration-event-${eventId}`)
        element?.scrollIntoView({ block: 'center' })
        element?.focus({ preventScroll: true })
        if (element) focusedEvent.current = eventId
    }, [events, eventId])
    return (
        <div className="grid min-w-0 gap-3">
            {events.map(event => (
                <Card
                    key={event.id}
                    id={`collaboration-event-${event.id}`}
                    tabIndex={-1}
                    className="rounded-none border-0 border-l-2 bg-transparent py-3 shadow-none"
                >
                    <CardHeader className="pb-2">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant="outline">{eventLabels[event.kind]}</Badge>
                            {event.authorName}
                            {event.authorKind === 'agent' && <span className="text-muted-foreground">Agent 代发</span>}
                            <span className="text-xs text-muted-foreground">v{event.version}</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <p className="whitespace-pre-wrap break-words text-sm">{event.content}</p>
                        <time className="text-xs text-muted-foreground" dateTime={event.createdAt}>
                            {new Date(event.createdAt).toLocaleString('zh-CN')}
                        </time>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}

/**
 * Keeps a node's full chronological history reachable while locating authorized event deep links directly.
 * @param props - Exact node, its first saved event page and optional event anchor.
 * @returns Saved event cards and an explicit continuation action without losing earlier pages.
 */
function CollaborationNodeEvents({
    nodeId,
    initialEvents,
    eventId,
}: {
    nodeId: string
    initialEvents: CollaborationEvent[]
    eventId?: string
}) {
    const cache = useRef<{ key: string; events: CollaborationEvent[]; cursor: number; hasMore: boolean }>({
        key: '',
        events: [],
        cursor: 0,
        hasMore: false,
    })
    const pageController = useRef<AbortController | null>(null)
    const [loading, setLoading] = useState(false)
    const [pageError, setPageError] = useState('')
    const read = useCallback(
        async (signal: AbortSignal) => {
            const key = `${nodeId}:${eventId ?? ''}`
            if (cache.current.key !== key) cache.current = { key, events: [], cursor: 0, hasMore: false }
            const after = cache.current.hasMore ? 0 : cache.current.cursor
            try {
                const page = await getNodeCollaborationEvents(nodeId, after, signal)
                if (signal.aborted) return { events: [] as CollaborationEvent[], hasMore: false }
                const events = new Map(cache.current.events.map(event => [event.id, event]))
                for (const event of page.events) events.set(event.id, event)
                if (page.nextCursor >= cache.current.cursor) {
                    cache.current.cursor = page.nextCursor
                    cache.current.hasMore = page.hasMore
                }
                if (eventId && !events.has(eventId)) {
                    const anchor = await getNodeCollaborationEvents(nodeId, 0, signal, eventId)
                    if (signal.aborted) return { events: [] as CollaborationEvent[], hasMore: false }
                    for (const event of anchor.events) events.set(event.id, event)
                }
                cache.current.events = [...events.values()].sort((left, right) => left.sequence - right.sequence)
                return { events: cache.current.events, hasMore: cache.current.hasMore }
            } catch (cause) {
                if (!signal.aborted && cause instanceof CollaborationRequestError && [401, 403, 404].includes(cause.status))
                    cache.current = { key, events: [], cursor: 0, hasMore: false }
                throw cause
            }
        },
        [nodeId, eventId]
    )
    const saved = useSavedCollaboration(read)
    useEffect(
        () => () => {
            pageController.current?.abort()
            pageController.current = null
        },
        [nodeId, eventId]
    )
    /**
     * Loads the next sequential event page without advancing the cursor to a separately fetched anchor.
     * @returns A promise settled after a committed read or recoverable inline feedback.
     */
    async function loadMore() {
        if (pageController.current || !cache.current.hasMore) return
        const controller = new AbortController()
        pageController.current = controller
        setLoading(true)
        setPageError('')
        try {
            const page = await getNodeCollaborationEvents(nodeId, cache.current.cursor, controller.signal)
            if (controller.signal.aborted) return
            const events = new Map([...cache.current.events, ...page.events].map(event => [event.id, event]))
            cache.current.events = [...events.values()].sort((left, right) => left.sequence - right.sequence)
            cache.current.cursor = page.nextCursor
            cache.current.hasMore = page.hasMore
            saved.refresh()
        } catch (cause) {
            if (!controller.signal.aborted) {
                setPageError(failureText(cause))
                saved.refresh()
            }
        } finally {
            if (!controller.signal.aborted) setLoading(false)
            if (pageController.current === controller) pageController.current = null
        }
    }
    return (
        <div className="space-y-3">
            <CollaborationEvents events={saved.data?.events ?? (saved.error ? [] : initialEvents)} eventId={eventId} />
            {saved.data?.hasMore && (
                <Button variant="outline" disabled={loading} onClick={() => void loadMore()}>
                    加载更多事件
                </Button>
            )}
            {(saved.error || pageError) && (
                <FeedbackMessage variant="error">
                    {saved.error || pageError}
                    <Button variant="link" onClick={saved.refresh}>
                        重新读取事件
                    </Button>
                </FeedbackMessage>
            )}
        </div>
    )
}

/**
 * Answers one precise question without treating the global composer as an implicit answer.
 * @param props - Current question version, authorization, and confirmed-save callback.
 * @returns A question card with an independently retained reply draft.
 */
function CollaborationQuestionCard({
    question,
    canAnswer,
    onSaved,
}: {
    question: CollaborationQuestion
    canAnswer: boolean
    onSaved: () => void
}) {
    const [content, setContent] = useState('')
    const [decision, setDecision] = useState<'information' | 'approved' | 'rejected'>('information')
    const action = useCollaborationAction()
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-[length:var(--type-subheading)]">{question.question}</CardTitle>
                <p className="text-xs text-muted-foreground">
                    问题 {question.id.slice(0, 8)} · v{question.version} ·{' '}
                    {question.status === 'pending' ? '等待答复' : question.status === 'answered' ? '已答复' : '该等待已结束'}
                </p>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap break-words text-sm">{question.context}</p>
                {question.answer && <p className="whitespace-pre-wrap break-words text-sm">答复：{question.answer}</p>}
                {canAnswer && question.status === 'pending' && (
                    <form
                        className="space-y-3"
                        onSubmit={async event => {
                            event.preventDefault()
                            if (!content.trim()) return
                            const saved = await action.run(
                                requestId => ({
                                    type: 'answer',
                                    requestId,
                                    questionId: question.id,
                                    version: question.version,
                                    content,
                                    decision,
                                }),
                                JSON.stringify({ content, decision, version: question.version })
                            )
                            if (saved) {
                                setContent('')
                                onSaved()
                            }
                        }}
                    >
                        <Label htmlFor={`answer-${question.id}`}>回答此问题</Label>
                        <Textarea
                            id={`answer-${question.id}`}
                            value={content}
                            maxLength={32000}
                            disabled={action.pending}
                            onChange={event => setContent(event.target.value)}
                        />
                        <Label htmlFor={`decision-${question.id}`}>答复性质</Label>
                        <NativeSelect
                            id={`decision-${question.id}`}
                            value={decision}
                            disabled={action.pending}
                            onChange={event => setDecision(event.target.value as typeof decision)}
                        >
                            <NativeSelectOption value="information">补充事实</NativeSelectOption>
                            <NativeSelectOption value="approved">本人确认可接受</NativeSelectOption>
                            <NativeSelectOption value="rejected">本人判断不通过</NativeSelectOption>
                        </NativeSelect>
                        <Button type="submit" disabled={!content.trim() || action.pending}>
                            {action.pending ? '正在保存答复' : '回答并接回协作'}
                        </Button>
                        {action.error && <FeedbackMessage variant="error">{action.error}</FeedbackMessage>}
                    </form>
                )}
            </CardContent>
        </Card>
    )
}

/**
 * Renders full published text and each selected node's actual adopted version.
 * @param props - Published materials, an optional working node, and a confirmed update callback.
 * @returns Versioned artifacts that never expose a private source conversation.
 */
function CollaborationArtifacts({
    artifacts,
    node,
    onSaved,
}: {
    artifacts: CollaborationArtifact[]
    node?: CollaborationNode
    onSaved: () => void
}) {
    const action = useCollaborationAction()
    return (
        <div className="space-y-3">
            {artifacts.map(artifact => {
                const adopted = node?.adoptions.find(item => item.artifactId === artifact.id)?.version
                return (
                    <Card key={`${artifact.id}-${artifact.version}`}>
                        <CardHeader>
                            <CardTitle className="text-[length:var(--type-subheading)]">
                                {artifact.title} · v{artifact.version}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground">
                                来源节点 {artifact.nodeId.slice(0, 8)} · 作者 {artifact.authorId.slice(0, 8)}
                                {adopted ? ` · 本节点采用 v${adopted}` : ' · 尚未被本节点采用'}
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <p className="whitespace-pre-wrap break-words text-sm">{artifact.content}</p>
                            {node?.canWork && adopted !== artifact.version && (
                                <Button
                                    variant="outline"
                                    disabled={action.pending}
                                    onClick={async () => {
                                        if (
                                            await action.run(
                                                requestId => ({
                                                    type: 'adopt',
                                                    requestId,
                                                    nodeId: node.id,
                                                    revision: node.revision,
                                                    artifactId: artifact.id,
                                                    version: artifact.version,
                                                }),
                                                `${node.id}:${node.revision}:${artifact.id}:${artifact.version}`
                                            )
                                        )
                                            onSaved()
                                    }}
                                >
                                    采用此版本
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                )
            })}
            {action.error && <FeedbackMessage variant="error">{action.error}</FeedbackMessage>}
        </div>
    )
}

/**
 * Opens an owned Agent conversation, preparing only the saved opening for older invitations.
 * @param props - Authorized recipient node and optional event anchor.
 * @returns A short loading or recoverable error state before the private conversation opens.
 */
function CollaborationConversationEntry({ node, eventId }: { node: CollaborationNode; eventId?: string }) {
    const router = useRouter()
    const [error, setError] = useState('')
    const [attempt, setAttempt] = useState(0)
    const preparation = useRef<Promise<Awaited<ReturnType<typeof sendCollaborationCommand>>> | null>(null)
    const requestId = useRef<string | null>(null)
    useEffect(() => {
        let current = true
        if (node.canWork && node.source) {
            router.replace(collaborationNodeHref(node, eventId))
            return
        }
        if (!node.canActivate) return
        requestId.current ??= crypto.randomUUID()
        preparation.current ??= sendCollaborationCommand({
            type: 'activate',
            requestId: requestId.current,
            nodeId: node.id,
            revision: node.revision,
        })
        void preparation.current
            .then(saved => {
                if (!current) return
                if (!saved.taskId) throw new Error('暂未确认对话已准备好，请重试。')
                router.replace(`/?${new URLSearchParams({ conversation: saved.taskId, ...(eventId ? { event: eventId } : {}) })}`)
            })
            .catch(cause => {
                if (current) setError(failureText(cause))
            })
        return () => {
            current = false
        }
    }, [node, eventId, router, attempt])
    return (
        <section className="workspace-page min-w-0 space-y-3" aria-label="打开 Agent 对话">
            {error ? (
                <FeedbackMessage variant="error">
                    <p>{error}</p>
                    <Button
                        variant="link"
                        onClick={() => {
                            preparation.current = null
                            setError('')
                            setAttempt(value => value + 1)
                        }}
                    >
                        重试打开对话
                    </Button>
                </FeedbackMessage>
            ) : (
                <p role="status" className="text-sm text-muted-foreground">
                    正在打开你的 Agent 对话…
                </p>
            )}
        </section>
    )
}

/**
 * Displays shared work details and explicit recovery controls for a failed owned Agent.
 * @param props - Authorized node detail and a callback for refreshing saved projections.
 * @returns Precise questions, actual shared materials, and authorized owner actions.
 */
function CollaborationNodeView({ detail, eventId, onSaved }: { detail: CollaborationNodeDetail; eventId?: string; onSaved: () => void }) {
    const { node } = detail
    const [agents, setAgents] = useState<AgentDefinition[]>([])
    const [agentId, setAgentId] = useState('')
    const [agentError, setAgentError] = useState('')
    const [publication, setPublication] = useState({ title: '', content: '' })
    const [questionDraft, setQuestionDraft] = useState('')
    const [revisionDraft, setRevisionDraft] = useState({ goal: node.goal, context: node.context })
    const action = useCollaborationAction()
    useEffect(() => {
        if (!(node.canWork && node.status === 'failed')) return
        const controller = new AbortController()
        listAgents(controller.signal)
            .then(saved => {
                if (!controller.signal.aborted) setAgents(saved)
            })
            .catch(cause => {
                if (!controller.signal.aborted) setAgentError(failureText(cause))
            })
        return () => controller.abort()
    }, [node.id, node.canActivate, node.canWork, node.status])
    return (
        <section className="min-w-0 space-y-4" aria-label={`协作节点：${node.title}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[length:var(--type-subheading)] font-semibold">{node.title}</h2>
                <Badge variant="secondary">{nodeLabels[node.status]}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
                负责人 {node.ownerName} · {node.agentLabel ?? '尚未选择本人 Agent'}
            </p>
            <p className="whitespace-pre-wrap break-words">{node.goal}</p>
            {node.context && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-[length:var(--type-subheading)]">收到的协作上下文</CardTitle>
                    </CardHeader>
                    <CardContent className="whitespace-pre-wrap break-words text-sm">{node.context}</CardContent>
                </Card>
            )}
            {node.canWork && node.source && (
                <Link className={buttonVariants({ variant: 'outline' })} href={collaborationNodeHref(node)}>
                    打开 Agent 对话
                </Link>
            )}
            {detail.questions.map(question => (
                <CollaborationQuestionCard
                    key={`${question.id}:${question.version}`}
                    question={question}
                    canAnswer={question.targetNodeId === node.id && (node.canWork || node.canActivate)}
                    onSaved={onSaved}
                />
            ))}
            <CollaborationNodeEvents nodeId={node.id} initialEvents={detail.events} eventId={eventId} />
            {node.canWork && node.upstreamNodeId && (
                <Disclosure title="向上游补问事实" className="rounded-xl border p-4">
                    <form
                        className="mt-3 space-y-3"
                        onSubmit={async event => {
                            event.preventDefault()
                            if (!questionDraft.trim() || !node.upstreamNodeId) return
                            if (
                                await action.run(
                                    requestId => ({
                                        type: 'ask',
                                        requestId,
                                        nodeId: node.id,
                                        revision: node.revision,
                                        targetNodeId: node.upstreamNodeId!,
                                        question: questionDraft,
                                        context: node.context,
                                    }),
                                    `ask:${node.id}:${node.revision}:${questionDraft}`
                                )
                            ) {
                                setQuestionDraft('')
                                onSaved()
                            }
                        }}
                    >
                        <Label htmlFor={`ask-upstream-${node.id}`}>需要上游回答的问题</Label>
                        <Textarea
                            id={`ask-upstream-${node.id}`}
                            value={questionDraft}
                            maxLength={32000}
                            disabled={action.pending}
                            onChange={event => setQuestionDraft(event.target.value)}
                        />
                        <Button type="submit" disabled={action.pending || !questionDraft.trim()}>
                            发回上游原对话
                        </Button>
                    </form>
                </Disclosure>
            )}
            {node.canManage && !['cancelled', 'completed'].includes(node.status) && (
                <Disclosure title="修订协作目标与上下文" className="rounded-xl border p-4">
                    <form
                        className="mt-3 space-y-3"
                        onSubmit={async event => {
                            event.preventDefault()
                            if (!revisionDraft.goal.trim()) return
                            if (
                                await action.run(
                                    requestId => ({
                                        type: 'revise',
                                        requestId,
                                        nodeId: node.id,
                                        revision: node.revision,
                                        ...revisionDraft,
                                    }),
                                    JSON.stringify({ nodeId: node.id, revision: node.revision, revisionDraft })
                                )
                            )
                                onSaved()
                        }}
                    >
                        <p className="text-sm text-muted-foreground">保存新版本会使旧的待答问题失效；已投递消息仍保留。</p>
                        <Label htmlFor={`revise-goal-${node.id}`}>工作目标</Label>
                        <Textarea
                            id={`revise-goal-${node.id}`}
                            value={revisionDraft.goal}
                            maxLength={32000}
                            disabled={action.pending}
                            onChange={event => setRevisionDraft(current => ({ ...current, goal: event.target.value }))}
                        />
                        <Label htmlFor={`revise-context-${node.id}`}>共享上下文</Label>
                        <Textarea
                            id={`revise-context-${node.id}`}
                            value={revisionDraft.context}
                            maxLength={64000}
                            disabled={action.pending}
                            onChange={event => setRevisionDraft(current => ({ ...current, context: event.target.value }))}
                        />
                        <Button type="submit" disabled={action.pending || !revisionDraft.goal.trim()}>
                            保存修订
                        </Button>
                    </form>
                </Disclosure>
            )}
            <h3 className="font-semibold">共享成果与采用版本</h3>
            <CollaborationArtifacts artifacts={detail.artifacts} node={node} onSaved={onSaved} />
            {node.canWork && (
                <form
                    className="space-y-3 rounded-xl border p-4"
                    onSubmit={async event => {
                        event.preventDefault()
                        if (!publication.title.trim() || !publication.content.trim()) return
                        if (
                            await action.run(
                                requestId => ({ type: 'publish', requestId, nodeId: node.id, revision: node.revision, ...publication }),
                                JSON.stringify({ node: node.id, revision: node.revision, publication })
                            )
                        ) {
                            setPublication({ title: '', content: '' })
                            onSaved()
                        }
                    }}
                >
                    <h3 className="font-semibold">发布工作成果</h3>
                    <Label htmlFor={`artifact-title-${node.id}`}>成果名称</Label>
                    <Input
                        id={`artifact-title-${node.id}`}
                        value={publication.title}
                        maxLength={120}
                        disabled={action.pending}
                        onChange={event => setPublication(current => ({ ...current, title: event.target.value }))}
                    />
                    <Label htmlFor={`artifact-body-${node.id}`}>共享正文</Label>
                    <Textarea
                        id={`artifact-body-${node.id}`}
                        value={publication.content}
                        maxLength={128000}
                        disabled={action.pending}
                        onChange={event => setPublication(current => ({ ...current, content: event.target.value }))}
                    />
                    <Button type="submit" disabled={action.pending || !publication.title.trim() || !publication.content.trim()}>
                        发布到本项目
                    </Button>
                </form>
            )}
            {node.canManage && (
                <div className="flex flex-wrap gap-2">
                    {node.status === 'failed' && (
                        <Button
                            variant="outline"
                            disabled={action.pending}
                            onClick={async () => {
                                if (
                                    await action.run(
                                        requestId => ({ type: 'retry', requestId, nodeId: node.id, revision: node.revision }),
                                        `retry:${node.id}:${node.revision}`
                                    )
                                )
                                    onSaved()
                            }}
                        >
                            重试原配置
                        </Button>
                    )}
                    {!['cancelled', 'completed'].includes(node.status) && (
                        <Button
                            variant="outline"
                            disabled={action.pending}
                            onClick={async () => {
                                if (
                                    await action.run(
                                        requestId => ({ type: 'cancel', requestId, nodeId: node.id, revision: node.revision }),
                                        `cancel:${node.id}:${node.revision}`
                                    )
                                )
                                    onSaved()
                            }}
                        >
                            取消此节点协作
                        </Button>
                    )}
                </div>
            )}
            {node.status === 'failed' && node.canWork && (
                <form
                    className="space-y-3 rounded-xl border p-4"
                    onSubmit={async event => {
                        event.preventDefault()
                        if (
                            await action.run(
                                requestId => ({
                                    type: 'retry',
                                    requestId,
                                    nodeId: node.id,
                                    revision: node.revision,
                                    ...(agentId ? { agentId } : { useDefaultModel: true as const }),
                                }),
                                `repair:${node.id}:${node.revision}:${agentId || 'default'}`
                            )
                        )
                            onSaved()
                    }}
                >
                    <Label htmlFor={`retry-agent-${node.id}`}>用我自己的可用配置恢复工作</Label>
                    <NativeSelect
                        id={`retry-agent-${node.id}`}
                        value={agentId}
                        disabled={action.pending}
                        onChange={event => setAgentId(event.target.value)}
                    >
                        <NativeSelectOption value="">默认模型（无需配置）</NativeSelectOption>
                        {agents.map(agent => (
                            <NativeSelectOption key={agent.id} value={agent.id}>
                                {agent.name}
                            </NativeSelectOption>
                        ))}
                    </NativeSelect>
                    <p className="text-xs text-muted-foreground">
                        未设个人默认连接时将使用系统默认模型。仅在你确认重试后采用所选配置，继续尚未完成的工作。
                    </p>
                    <Link className="block text-sm underline" href="/account#models">
                        管理个人模型（可选）
                    </Link>
                    <Button type="submit" disabled={action.pending || Boolean(agentError)}>
                        使用本人所选配置重试
                    </Button>
                    {agentError && <FeedbackMessage variant="error">{agentError}</FeedbackMessage>}
                </form>
            )}
            {action.error && <FeedbackMessage variant="error">{action.error}</FeedbackMessage>}
        </section>
    )
}

/**
 * Resolves an optional shared-project route before rendering existing personal-project UI.
 * @param props - Exact project selection, optional node/event deep link, and legacy fallback.
 * @returns Authorized shared work or the unchanged personal project implementation.
 */
export function CollaborationProjectBoundary({
    projectId,
    nodeId,
    eventId,
    children,
}: {
    projectId: string
    nodeId?: string
    eventId?: string
    children: ReactNode
}) {
    const read = useCallback((signal: AbortSignal) => getCollaborationProject(projectId, signal), [projectId])
    const saved = useSavedCollaboration(read)
    if (!saved.data)
        return saved.errorStatus === 404 ? (
            children
        ) : saved.error ? (
            <section className="grid gap-4 p-6">
                <FeedbackMessage variant="error">{saved.error}</FeedbackMessage>
                <Button variant="outline" onClick={saved.refresh}>
                    重新读取项目
                </Button>
                <Link className="text-sm underline" href="/projects">
                    返回项目
                </Link>
            </section>
        ) : (
            <p role="status" className="p-6">
                正在读取项目…
            </p>
        )
    if (!nodeId && !eventId)
        return (
            <>
                {saved.error && (
                    <FeedbackMessage variant="error" className="m-4">
                        {saved.error}
                        <Button variant="outline" onClick={saved.refresh}>
                            重新读取项目
                        </Button>
                    </FeedbackMessage>
                )}
                <TeamProjectOverview project={saved.data} onSaved={saved.refresh} />
            </>
        )
    return <CollaborationProjectView project={saved.data} selectedNodeId={nodeId} eventId={eventId} onSaved={saved.refresh} />
}

/**
 * Shows a shared project's actual responsibility chain, materials, and authorized node views.
 * @param props - Safe project projection and an optional deep-linked node.
 * @returns A project work overview rather than a separate messaging application.
 */
function CollaborationProjectView({
    project,
    selectedNodeId,
    eventId,
    onSaved,
}: {
    project: CollaborationProject
    selectedNodeId?: string
    eventId?: string
    onSaved: () => void
}) {
    const selected = project.nodes.find(node => node.id === selectedNodeId)
    const read = useCallback((signal: AbortSignal) => getCollaborationNode(selectedNodeId!, signal), [selectedNodeId])
    const detail = useSavedCollaboration(read, Boolean(selectedNodeId && selected))
    const owned = detail.data?.node.id === selected?.id ? detail.data?.node : selected
    if (owned && owned.status !== 'failed' && (owned.canActivate || (owned.canWork && owned.source)))
        return <CollaborationConversationEntry key={owned.id} node={owned} eventId={eventId} />
    return (
        <section className="workspace-page min-w-0 space-y-6">
            <Link href="/projects" className="text-sm underline">
                返回项目
            </Link>
            <header className="workspace-page-header">
                <div className="min-w-0 flex-1 space-y-2">
                    <h1 className="[overflow-wrap:anywhere]">{project.name}</h1>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere] text-muted-foreground">
                        {project.description}
                    </p>
                    <p className="text-sm [overflow-wrap:anywhere]">
                        参与者：
                        {project.members
                            .filter(member => member.status !== 'revoked')
                            .map(member => member.name)
                            .join('、')}
                    </p>
                </div>
            </header>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {project.nodes.map(node => (
                    <Card key={node.id}>
                        <CardHeader>
                            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-[length:var(--type-subheading)]">
                                <Link className="underline" href={collaborationNodeHref(node)}>
                                    {node.title}
                                </Link>
                                <Badge variant="secondary">{nodeLabels[node.status]}</Badge>
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                                {node.ownerName} · {node.agentLabel ?? '通用助手'}
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <p className="whitespace-pre-wrap break-words text-sm">{node.goal}</p>
                            <p className="text-xs text-muted-foreground">
                                上游：{project.nodes.find(item => item.id === node.upstreamNodeId)?.title ?? '事项来源'} · 下游：
                                {project.nodes
                                    .filter(item => item.upstreamNodeId === node.id)
                                    .map(item => item.title)
                                    .join('、') || '暂无'}
                            </p>
                            <Link className="text-sm underline" href={`/projects/${project.id}?node=${node.id}`}>
                                查看协作内容
                            </Link>
                        </CardContent>
                    </Card>
                ))}
            </div>
            {selectedNodeId && !selected && <FeedbackMessage variant="error">此节点不存在或当前未获授权。</FeedbackMessage>}
            {detail.error && (
                <FeedbackMessage variant="error">
                    {detail.error}
                    <Button variant="link" onClick={detail.refresh}>
                        重试节点
                    </Button>
                </FeedbackMessage>
            )}
            {detail.data && selected && detail.data.node.id === selected.id && (
                <CollaborationNodeView
                    key={selected.id}
                    detail={detail.data}
                    eventId={eventId}
                    onSaved={() => {
                        detail.refresh()
                        onSaved()
                    }}
                />
            )}
            <section className="space-y-3">
                <h2 className="text-[length:var(--type-subheading)] font-semibold">项目共享成果</h2>
                {!project.artifacts.length && <p className="text-sm text-muted-foreground">尚无已发布成果。</p>}
                <CollaborationArtifacts artifacts={project.artifacts} onSaved={onSaved} />
            </section>
        </section>
    )
}

/**
 * Reads authorized collaboration projects for the shared project list controls.
 * @returns Saved projects, safe loading failures, and an explicit refresh action.
 */
export function useCollaborationProjects() {
    return useSavedCollaboration(listCollaborationProjects)
}

/**
 * Renders the collaboration projects selected by the shared collection controls.
 * @param props - Authorized projects after identity deduplication and search filtering.
 * @returns Saved collaboration project links, or nothing when none match.
 */
export function CollaborationProjectCards({ projects }: { projects: CollaborationProject[] }) {
    if (!projects.length) return null
    return (
        <section className="space-y-3" aria-label="参与的协作项目">
            <h2 className="text-[length:var(--type-subheading)] font-semibold">参与的协作项目</h2>
            <div className="workspace-collection grid min-w-0">
                {projects.map(project => (
                    <Card
                        key={project.id}
                        className="rounded-none border-0 border-b bg-transparent py-4 shadow-none [&>[data-slot=card-header]]:px-0 [&>[data-slot=card-content]]:px-0"
                    >
                        <CardHeader>
                            <CardTitle className="text-[length:var(--type-subheading)]">
                                <Link className="underline" href={`/projects/${project.id}`}>
                                    {project.name}
                                </Link>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <p className="break-words text-sm">{project.description}</p>
                            <p className="text-xs text-muted-foreground">
                                {project.members
                                    .filter(member => member.status !== 'revoked')
                                    .map(member => member.name)
                                    .join('、')}{' '}
                                · {project.nodes.length} 个责任节点
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </section>
    )
}

/**
 * Synchronizes ordinary chat and places saved dispatch receipts at their original message positions.
 * @param props - Stable source, optional visible-message anchors, and the saved-history refresh callback.
 * @returns Pending confirmations below chat and terminal receipts beside their owning messages.
 */
export function CollaborationSourcePanel({
    source,
    eventId,
    onHistoryChange,
    messages,
    getMessageAnchor,
}: {
    source: CollaborationSource
    eventId?: string
    showDetails?: boolean
    onHistoryChange?: () => void
    messages?: readonly ChatMessage[]
    getMessageAnchor?: (messageId: string) => HTMLElement | null
}) {
    const cursor = useRef(0)
    const events = useRef<CollaborationEvent[]>([])
    const nodeState = useRef('')
    const snapshotKey = useRef('')
    const callback = useRef(onHistoryChange)
    const { kind, id } = source
    const sourceKey = `${kind}:${id}`
    const [settled, setSettled] = useState<{ sourceKey: string; drafts: Record<string, CollaborationDispatch> }>({ sourceKey, drafts: {} })
    const [, refreshAnchors] = useState(0)
    const messageIdentity = messages?.map(message => message.id).join('\n') ?? ''
    useEffect(() => {
        let current = true
        // Message refs attach during the parent commit; refresh their portal destinations after that commit settles.
        queueMicrotask(() => {
            if (current) refreshAnchors(value => value + 1)
        })
        return () => {
            current = false
        }
    }, [messageIdentity, sourceKey, getMessageAnchor])
    useEffect(() => {
        callback.current = onHistoryChange
    }, [onHistoryChange])
    const read = useCallback(
        async (signal: AbortSignal) => {
            const key = `${kind}:${id}:${eventId ?? ''}`
            if (snapshotKey.current !== key) {
                cursor.current = 0
                events.current = []
                nodeState.current = ''
                snapshotKey.current = key
            }
            let page
            try {
                page = await getSourceCollaboration({ kind, id }, cursor.current, signal, cursor.current === 0 ? eventId : undefined)
            } catch (error) {
                if (error instanceof CollaborationRequestError && [401, 403, 404].includes(error.status)) {
                    cursor.current = 0
                    events.current = []
                    nodeState.current = ''
                }
                throw error
            }
            if (signal.aborted) return { ...page, events: events.current }
            const authorizedProjects = new Set(page.nodes.map(node => node.projectId))
            const retained = events.current.filter(event => !event.projectId || authorizedProjects.has(event.projectId))
            const known = new Set(retained.map(event => event.id))
            const added = page.events.filter(event => !known.has(event.id))
            events.current = [...retained, ...added].sort((left, right) => left.sequence - right.sequence)
            cursor.current = page.nextCursor
            const signature = JSON.stringify({
                nodes: page.nodes.map(node => [node.id, node.status, node.updatedAt, node.revision]),
                questions: page.questions.map(question => [question.id, question.version, question.status, question.updatedAt]),
                sourceState: page.sourceState,
                pendingContact: page.pendingContact,
                pendingDispatches: page.pendingDispatches,
            })
            if (added.length || signature !== nodeState.current) callback.current?.()
            nodeState.current = signature
            return { ...page, events: events.current }
        },
        [kind, id, eventId]
    )
    const saved = useSavedCollaboration(read)
    const data = saved.data
    if (!data) return null
    if (!data.pendingDispatches?.length) return null
    return (
        <div className="min-w-0 space-y-4">
            {data.pendingDispatches?.map(savedDraft => {
                const confirmed = settled.sourceKey === sourceKey ? settled.drafts[`${savedDraft.id}:${savedDraft.version}`] : undefined
                const draft = savedDraft.status === 'pending' && confirmed ? confirmed : savedDraft
                const card = (
                    <CollaborationDispatchCard
                        key={`${draft.id}:${draft.version}`}
                        draft={draft}
                        sourceActive={Boolean(data.sourceState?.activeRequestId)}
                        onSaved={saved.refresh}
                        onResolved={resolved =>
                            setSettled(current => ({
                                sourceKey,
                                drafts: {
                                    ...(current.sourceKey === sourceKey ? current.drafts : {}),
                                    [`${resolved.id}:${resolved.version}`]: resolved,
                                },
                            }))
                        }
                    />
                )
                if (draft.status === 'pending' || !messages || !getMessageAnchor) return card
                const messageId = collaborationDispatchAnchor(draft, messages)
                const anchor = messageId ? getMessageAnchor(messageId) : null
                return anchor ? createPortal(card, anchor, `${sourceKey}:${draft.id}:${draft.version}`) : null
            })}
            {saved.error && (
                <FeedbackMessage variant="error">
                    {saved.error}
                    <Button variant="link" onClick={saved.refresh}>
                        重新载入
                    </Button>
                </FeedbackMessage>
            )}
        </div>
    )
}

/**
 * Resolves a saved notification to its actual source or pending project node.
 * @param item - Authorized notification containing no private source history.
 * @returns The original work URL, or null for a lightweight message thread.
 */
function notificationHref(item: CollaborationNotification): string | null {
    if (item.source?.kind === 'conversation')
        return `/?${new URLSearchParams({ conversation: item.source.id, ...(item.eventId ? { event: item.eventId } : {}) })}`
    if (item.source?.kind === 'task')
        return `/?${new URLSearchParams({ conversation: item.source.id, ...(item.eventId ? { event: item.eventId } : {}) })}`
    if (item.threadId) return null
    return item.projectId ? `/projects/${item.projectId}${item.nodeId ? `?node=${item.nodeId}` : ''}` : null
}

/**
 * Adds lightweight collaboration attention links without making an IM center the work surface.
 * @returns An account-scoped notification dialog with direct original-work links and simple replies.
 */
export function CollaborationNotifications() {
    const account = useAccount()
    const [open, setOpen] = useState(false)
    const [threadId, setThreadId] = useState<string | null>(null)
    const [reply, setReply] = useState('')
    const [readingError, setReadingError] = useState('')
    const [unreadTotal, setUnreadTotal] = useState<{ accountId: string | undefined; count: number | null }>({
        accountId: undefined,
        count: null,
    })
    const readMessages = useRef(new Set<string>())
    const readNotifications = useRef(new Set<string>())
    const authorizedProjects = useRef<Set<string> | null>(null)
    const [openedNotifications, setOpenedNotifications] = useState<Set<string>>(() => new Set())
    const accountId = account.user?.id
    const read = useCallback(
        async (signal: AbortSignal, before?: number) => {
            const page = await getCollaborationNotificationPage(0, signal, before)
            if (!signal.aborted) {
                setUnreadTotal({ accountId, count: page.unread })
                if (page.authorizedProjectIds) authorizedProjects.current = new Set(page.authorizedProjectIds)
            }
            return page.notifications.map(item => (readNotifications.current.has(item.id) ? { ...item, read: true } : item))
        },
        [accountId]
    )
    const permitsNotification = useCallback(
        (item: CollaborationNotification) =>
            !item.projectId || authorizedProjects.current === null || authorizedProjects.current.has(item.projectId),
        []
    )
    const saved = useCollaborationHistory(`${accountId}:notifications`, read, true, permitsNotification)
    const readThread = useCallback(
        (signal: AbortSignal, before?: number) => getCollaborationMessages(threadId!, signal, before),
        [threadId]
    )
    const thread = useCollaborationHistory(`${accountId}:${threadId}`, readThread, Boolean(open && threadId))
    const refreshNotifications = saved.refresh
    useEffect(() => {
        if (!open || !threadId || !thread.data || !accountId) return
        const ids = thread.data.items
            .filter(message => message.recipientId === accountId && !readMessages.current.has(message.id))
            .slice(0, 100)
            .map(message => message.id)
        if (!ids.length) return
        const controller = new AbortController()
        for (const id of ids) readMessages.current.add(id)
        void sendCollaborationCommand(
            { type: 'read', requestId: crypto.randomUUID(), notificationIds: [], messageIds: ids },
            controller.signal
        )
            .then(() => {
                if (!controller.signal.aborted) {
                    setReadingError('')
                    refreshNotifications()
                }
            })
            .catch(error => {
                for (const id of ids) readMessages.current.delete(id)
                if (!controller.signal.aborted) setReadingError(failureText(error))
            })
        return () => controller.abort()
    }, [open, threadId, thread.data, accountId, refreshNotifications])
    const action = useCollaborationAction()
    const unread =
        (unreadTotal.accountId === accountId ? unreadTotal.count : null) ?? saved.data?.items.filter(item => !item.read).length ?? 0
    /**
     * Marks only the notification intentionally opened by the current account.
     * @param item - Notification the user chose to read.
     * @returns A promise settled after a confirmed read mutation or safe failure.
     */
    async function readNotification(item: CollaborationNotification) {
        if (item.threadId && !notificationHref(item)) {
            if (threadId !== item.threadId) setReply('')
            setThreadId(item.threadId)
        }
        if (
            !item.read &&
            !readNotifications.current.has(item.id) &&
            (await action.run(requestId => ({ type: 'read', requestId, notificationIds: [item.id], messageIds: [] }), `read:${item.id}`))
        ) {
            readNotifications.current.add(item.id)
            setOpenedNotifications(current => new Set([...current, item.id]))
            saved.refresh()
        }
    }
    return (
        <>
            <Button variant="ghost" className="w-full justify-start gap-2" onClick={() => setOpen(true)}>
                消息{unread > 0 && <Badge variant="secondary">{unread}</Badge>}
            </Button>
            <Dialog
                open={open}
                onOpenChange={next => {
                    setOpen(next)
                    if (!next) {
                        setThreadId(null)
                        setReply('')
                    }
                }}
            >
                <DialogContent className="max-h-[85dvh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{threadId ? '消息' : '消息'}</DialogTitle>
                        <DialogDescription>点击消息继续与 Agent 聊天。</DialogDescription>
                    </DialogHeader>
                    {threadId ? (
                        <div className="space-y-4">
                            <Button variant="outline" onClick={() => setThreadId(null)}>
                                返回消息
                            </Button>
                            {thread.data?.hasEarlier && (
                                <Button variant="outline" onClick={() => void thread.loadEarlier()} disabled={thread.paging.pending}>
                                    加载更早转告
                                </Button>
                            )}
                            {thread.data?.items.map(message => (
                                <Card key={message.id}>
                                    <CardContent className="space-y-2 pt-4">
                                        <p className="text-xs text-muted-foreground">
                                            {message.senderName}
                                            {message.authorKind === 'agent' ? ' · Agent 代发' : ''}
                                        </p>
                                        <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                                    </CardContent>
                                </Card>
                            ))}
                            <form
                                className="space-y-3"
                                onSubmit={async event => {
                                    event.preventDefault()
                                    const last = thread.data?.items.at(-1)
                                    if (!last || !reply.trim()) return
                                    const recipientId = last.senderId === account.user?.id ? last.recipientId : last.senderId
                                    if (
                                        await action.run(
                                            requestId => ({ type: 'message', requestId, recipientId, content: reply }),
                                            `${threadId}:${recipientId}:${reply}`
                                        )
                                    ) {
                                        setReply('')
                                        thread.refresh()
                                        saved.refresh()
                                    }
                                }}
                            >
                                <Label htmlFor="collaboration-direct-reply">回复这条转告</Label>
                                <Textarea
                                    id="collaboration-direct-reply"
                                    value={reply}
                                    maxLength={32000}
                                    disabled={action.pending}
                                    onChange={event => setReply(event.target.value)}
                                />
                                <Button type="submit" disabled={action.pending || !reply.trim() || !thread.data?.items.length}>
                                    发送回复
                                </Button>
                            </form>
                            {(thread.error || thread.paging.error) && (
                                <FeedbackMessage variant="error">{thread.error || thread.paging.error}</FeedbackMessage>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {saved.data?.items.length === 0 && <p className="text-sm text-muted-foreground">还没有收到消息。</p>}
                            {saved.data?.hasEarlier && (
                                <Button variant="outline" onClick={() => void saved.loadEarlier()} disabled={saved.paging.pending}>
                                    加载更早通知
                                </Button>
                            )}
                            {saved.data?.items.map(item => (
                                <Card key={item.id}>
                                    <CardContent className="space-y-2 pt-4">
                                        <p className="flex items-center gap-2 font-medium">
                                            {item.title}
                                            {!item.read && !openedNotifications.has(item.id) && <Badge variant="secondary">未读</Badge>}
                                        </p>
                                        <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>
                                        {notificationHref(item) ? (
                                            <Link
                                                className="text-sm underline"
                                                href={notificationHref(item)!}
                                                onClick={() => {
                                                    void readNotification(item)
                                                    setOpen(false)
                                                }}
                                            >
                                                打开 Agent 对话
                                            </Link>
                                        ) : (
                                            <Button variant="outline" onClick={() => void readNotification(item)}>
                                                查看转告
                                            </Button>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                            {(saved.error || saved.paging.error) && (
                                <FeedbackMessage variant="error">
                                    {saved.error || saved.paging.error}
                                    <Button variant="link" onClick={saved.refresh}>
                                        重试通知
                                    </Button>
                                </FeedbackMessage>
                            )}
                        </div>
                    )}
                    {action.error && <FeedbackMessage variant="error">{action.error}</FeedbackMessage>}
                    {readingError && <FeedbackMessage variant="error">{readingError}</FeedbackMessage>}
                </DialogContent>
            </Dialog>
        </>
    )
}
