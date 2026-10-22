'use client'

import { useRef, useState } from 'react'
import type { ChatConversation, HumanDecisionAction, HumanRequest, HumanRequestStatus } from '@ai-harness/contracts'
import { decideHumanRequest, getConversation } from '../lib/chat-client'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { FeedbackMessage } from './ui/feedback-message'

const statusLabels: Record<HumanRequestStatus, string> = {
    pending: '等待本人处理',
    answered: '答案已保存',
    approved: '已批准，等待执行',
    rejected: '已拒绝，未执行',
    cancelled: '已取消',
    superseded: '已被新要求替代',
    invalid: '请求已失效',
    executing: '正在执行已批准的操作',
    succeeded: '操作已成功',
    failed: '执行失败',
    unknown: '结果不明，已停止自动重试',
}

/**
 * Presents text from a saved tool result without exposing its transport envelope as product copy.
 * @param result - Persisted public result string, which may contain a serialized Cordis text result.
 * @returns Human-readable text blocks, or the original result when it is not a recognized envelope.
 */
function resultText(result: string): string {
    try {
        const value: unknown = JSON.parse(result)
        if (
            value &&
            typeof value === 'object' &&
            'isError' in value &&
            typeof value.isError === 'boolean' &&
            'content' in value &&
            Array.isArray(value.content)
        ) {
            const blocks = value.content.flatMap(block =>
                block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' ? [block.text as string] : []
            )
            if (blocks.length) return blocks.join('\n\n')
        }
    } catch {
        // Ordinary public result text is already ready to display literally.
    }
    return result
}

/**
 * Shows the current question or an exact operation and records only dedicated human decisions.
 * @param props - Owned conversation, persisted request, composer callback, and durable refresh callback.
 * @returns An accessible prompt or operation preview with no independent answer input.
 */
function HumanRequestCard({
    conversationId,
    request,
    disabled,
    onSuggestion,
    onSaved,
}: {
    conversationId: string
    request: HumanRequest
    disabled: boolean
    onSuggestion: (request: HumanRequest, text: string) => void
    onSaved: (conversation: ChatConversation) => void
}) {
    const [busy, setBusy] = useState(false)
    const [activeDecision, setActiveDecision] = useState<HumanDecisionAction['decision'] | null>(null)
    const [error, setError] = useState('')
    const lock = useRef(false)
    const action = useRef<HumanDecisionAction | null>(null)
    const pending = request.status === 'pending'

    /**
     * Submits or safely reconciles the same dedicated decision without changing its identity.
     * @param decision - Approval, rejection, or cancellation chosen by the real person.
     * @returns A promise settled after the server result or durable reconciliation is visible.
     */
    async function decide(decision: HumanDecisionAction['decision']) {
        if (!pending || disabled || lock.current) return
        if (action.current && action.current.decision !== decision) {
            setError('上次提交的结果尚未确认，请先重试原操作或刷新对话。')
            return
        }
        action.current ??= { actionId: crypto.randomUUID(), version: request.version, decision }
        lock.current = true
        setBusy(true)
        setActiveDecision(decision)
        setError('')
        try {
            const saved = await decideHumanRequest(conversationId, request.id, action.current)
            action.current = null
            onSaved(saved)
        } catch (cause) {
            try {
                const saved = await getConversation(conversationId)
                const current = saved.humanRequests?.find(item => item.id === request.id)
                onSaved(saved)
                if (current && (current.status !== 'pending' || current.version !== request.version)) {
                    action.current = null
                    return
                }
            } catch {
                // Keep the original action identity until its committed outcome can be confirmed.
            }
            setError(cause instanceof Error ? cause.message : '未能确认处理结果，请重试原操作。')
        } finally {
            lock.current = false
            setBusy(false)
            setActiveDecision(null)
        }
    }

    return (
        <section
            role="region"
            aria-label={request.kind === 'question' ? 'Agent 等待本人回答' : '操作前审批'}
            className={
                request.kind === 'question'
                    ? 'min-w-0 space-y-3 text-sm [overflow-wrap:anywhere]'
                    : 'min-w-0 space-y-3 rounded-xl border border-border p-4 text-sm [overflow-wrap:anywhere]'
            }
        >
            {request.kind === 'approval' && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">请核对本次操作</span>
                    <Badge
                        variant={request.status === 'unknown' || request.status === 'failed' ? 'destructive' : 'secondary'}
                        role="status"
                    >
                        {statusLabels[request.status]}
                    </Badge>
                </div>
            )}
            {request.kind === 'question' ? (
                <>
                    <p id={`human-question-${request.id}`} className="whitespace-pre-wrap text-base font-medium" aria-live="polite">
                        {request.question.text}
                    </p>
                    {request.question.context && <p className="whitespace-pre-wrap text-muted-foreground">{request.question.context}</p>}
                    {pending && (
                        <>
                            {Boolean(request.question.options?.length) && (
                                <div className="flex flex-wrap gap-2" role="group" aria-label="答案建议，仅填入底部输入框">
                                    {request.question.options?.map((option, index) => (
                                        <Button
                                            key={`${index}:${option}`}
                                            variant="outline"
                                            className="h-auto min-h-11 max-w-full whitespace-normal text-left"
                                            disabled={disabled || busy}
                                            onClick={() => onSuggestion(request, option)}
                                        >
                                            {option}
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </>
            ) : (
                <>
                    <dl className="grid min-w-0 gap-2">
                        <div>
                            <dt className="text-muted-foreground">工具</dt>
                            <dd>
                                {request.approval.toolId} · {request.approval.toolVersion}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">动作</dt>
                            <dd className="whitespace-pre-wrap">{request.approval.action}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">实际目标</dt>
                            <dd className="whitespace-pre-wrap">{request.approval.target}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">影响范围</dt>
                            <dd className="whitespace-pre-wrap">{request.approval.scope}</dd>
                        </div>
                    </dl>
                    <div className="min-w-0 space-y-2">
                        <p className="text-muted-foreground">完整操作参数</p>
                        <pre className="min-w-0 whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs [overflow-wrap:anywhere]">
                            {JSON.stringify(request.approval.arguments, null, 2)}
                        </pre>
                    </div>
                    {pending && <p className="text-muted-foreground">仅批准以上这次操作。也可以在底部修改要求，原请求随之失效。</p>}
                </>
            )}
            {request.result && <p className="whitespace-pre-wrap">{resultText(request.result)}</p>}
            {pending && (
                <div className="flex flex-wrap gap-2">
                    {request.kind === 'approval' && (
                        <>
                            <Button className="min-h-11" disabled={disabled || busy} onClick={() => void decide('approve')}>
                                {busy && activeDecision === 'approve' ? '正在保存决定…' : '批准本次操作'}
                            </Button>
                            <Button
                                className="min-h-11"
                                variant="outline"
                                disabled={disabled || busy}
                                onClick={() => void decide('reject')}
                            >
                                拒绝
                            </Button>
                        </>
                    )}
                    <Button className="min-h-11" variant="ghost" disabled={disabled || busy} onClick={() => void decide('cancel')}>
                        {request.kind === 'question' ? '取消此问题' : '取消等待'}
                    </Button>
                </div>
            )}
            {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
        </section>
    )
}

/**
 * Renders one current question or saved operation previews without repeating completed questions.
 * @param props - Saved conversation, optional request kind, and callbacks sharing the ordinary composer and history.
 * @returns The current question and/or operation receipts without another input area; null when none are visible.
 */
export function HumanRequestPanel({
    conversation,
    kind,
    disabled = false,
    onSuggestion,
    onSaved,
}: {
    conversation: ChatConversation
    kind?: HumanRequest['kind']
    disabled?: boolean
    onSuggestion: (request: HumanRequest, text: string) => void
    onSaved: (conversation: ChatConversation) => void
}) {
    const currentQuestion = conversation.humanRequests?.find(request => request.kind === 'question' && request.status === 'pending')
    const requests = conversation.humanRequests?.filter(
        request => (!kind || request.kind === kind) && (request.kind === 'approval' || request === currentQuestion)
    )
    if (!requests?.length) return null
    return (
        <div className="min-w-0 space-y-4" aria-label="人工介入记录">
            {requests.map(request => (
                <HumanRequestCard
                    key={`${conversation.id}:${request.id}:${request.version}`}
                    conversationId={conversation.id}
                    request={request}
                    disabled={disabled}
                    onSuggestion={onSuggestion}
                    onSaved={onSaved}
                />
            ))}
        </div>
    )
}
