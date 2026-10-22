'use client'

import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { FeedbackMessage } from './ui/feedback-message'

import { Database, RotateCcw, Search } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type {
    EmbeddingModel,
    EmbeddingSpace,
    KnowledgeDocument,
    KnowledgeIndexAction,
    KnowledgeVectorIndex,
    VectorStatus,
} from '@ai-harness/contracts'
import { getKnowledgeVectorIndex, getVectorStatus, startKnowledgeVectorIndex } from '../lib/vector-client'
import styles from './vector-workspace.styles'
import { Badge } from './ui/badge'
import { Progress, ProgressLabel, ProgressValue } from './ui/progress'

const labels: Record<KnowledgeVectorIndex['status'], string> = {
    none: '尚未建立索引',
    queued: '等待建立索引',
    indexing: '正在建立索引',
    ready: '向量索引已就绪',
    failed: '向量索引失败',
    stale: '索引空间已失效',
}

/**
 * Compares only the verified vector identity, allowing a connection rename without invalidation.
 * @param space - Frozen non-secret space of the existing index generation.
 * @param model - Current account default embedding configuration.
 * @returns Whether the complete version, provider identity, and dimensions still match.
 */
function matchesDefault(space: EmbeddingSpace | undefined, model: EmbeddingModel | null): boolean {
    return Boolean(
        space &&
        model?.verifiedAt &&
        space.id === model.id &&
        space.revision === model.revision &&
        space.providerModel === model.providerModel &&
        space.dimensions === model.dimensions
    )
}

/**
 * Shows durable vector indexing separately from original document parsing and chunk storage.
 * @param props - Actual source metadata already verified by the document detail page.
 * @returns Current default space, persisted progress, and explicitly confirmed index actions.
 */
export function KnowledgeIndexCard({ document }: { document: KnowledgeDocument }) {
    const [status, setStatus] = useState<VectorStatus | null>(null)
    const [index, setIndex] = useState<KnowledgeVectorIndex | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [actionError, setActionError] = useState('')
    const [busy, setBusy] = useState(false)
    const [revision, setRevision] = useState(0)
    const action = useRef<{ fingerprint: string; input: KnowledgeIndexAction } | null>(null)
    const activeAction = useRef<AbortController | null>(null)
    useEffect(() => () => activeAction.current?.abort(), [])

    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        /**
         * Reads metadata without provider calls and polls only unsettled durable index jobs.
         * @param initial - Whether this refresh should show loading feedback.
         * @returns After confirmed metadata or a recoverable read failure.
         */
        async function load(initial: boolean) {
            if (initial) setLoading(true)
            try {
                const [capabilities, saved] = await Promise.all([
                    getVectorStatus(controller.signal),
                    getKnowledgeVectorIndex(document.id, controller.signal),
                ])
                if (controller.signal.aborted) return
                setStatus(capabilities)
                setIndex(saved)
                setLoadError('')
                if (saved.status === 'queued' || saved.status === 'indexing') timer = setTimeout(() => void load(false), 2000)
            } catch (cause) {
                if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : '暂时无法读取向量索引状态。')
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        void load(true)
        /**
         * Rechecks the default when a user returns from account configuration in another tab.
         * @returns Nothing after requesting a metadata-only refresh.
         */
        function refresh(): void {
            setRevision(value => value + 1)
        }
        window.addEventListener('focus', refresh)
        return () => {
            controller.abort()
            clearTimeout(timer)
            window.removeEventListener('focus', refresh)
        }
    }, [document.id, document.status, document.chunkCount, revision])

    const model = status?.defaultModel ?? null
    const pending = index?.status === 'queued' || index?.status === 'indexing'
    const blocked = !status?.available
        ? status?.reason || '向量数据库暂时不可用。'
        : !model
          ? '尚未配置默认向量模型。'
          : !model.verifiedAt
            ? '默认向量模型尚未验证，请先测试连接。'
            : document.status !== 'ready'
              ? '请先等待原始资料分片完成。'
              : ''
    const compatible = matchesDefault(index?.model, model)

    /**
     * Starts or resumes only the default identity displayed before the explicit user click.
     * @param retry - Whether to reuse a compatible failed generation and its saved batches.
     * @returns After durable action confirmation or a visible retryable failure.
     */
    async function start(retry: boolean) {
        if (busy || blocked || loading || loadError || !model || !index || pending) return
        const fingerprint = JSON.stringify({
            retry,
            generation: index.generation,
            attempt: index.attempt,
            modelId: model.id,
            revision: model.revision,
        })
        if (action.current?.fingerprint !== fingerprint)
            action.current = { fingerprint, input: { requestId: crypto.randomUUID(), modelId: model.id, revision: model.revision } }
        const controller = new AbortController()
        activeAction.current = controller
        setBusy(true)
        setActionError('')
        try {
            const saved = await startKnowledgeVectorIndex(document.id, action.current.input, retry, controller.signal)
            if (controller.signal.aborted) return
            setIndex(saved)
            action.current = null
            setRevision(value => value + 1)
        } catch (cause) {
            if (!controller.signal.aborted)
                setActionError(cause instanceof Error ? cause.message : '未能确认索引操作，请使用相同操作重试。')
        } finally {
            if (!controller.signal.aborted) setBusy(false)
        }
    }

    return (
        <Card className={styles.indexPanel} aria-labelledby="vector-index-title" aria-busy={busy || loading}>
            <CardContent>
                <header className={styles.sectionHeading}>
                    <div>
                        <h2 id="vector-index-title">
                            <Database size={18} aria-hidden="true" />
                            向量索引
                        </h2>
                        <p>分片保存与向量索引是独立状态，只有完整且相容的索引参与检索。</p>
                    </div>
                    <Button
                        variant="outline"
                        type="button"
                        className={styles.secondary}
                        disabled={loading || busy}
                        onClick={() => setRevision(value => value + 1)}
                    >
                        <RotateCcw size={15} aria-hidden="true" />
                        刷新状态
                    </Button>
                </header>
                {loading && !index ? (
                    <p className={styles.hint} role="status">
                        正在读取索引状态…
                    </p>
                ) : loadError ? (
                    <FeedbackMessage variant="error" className={styles.error} role="alert">
                        {loadError}
                    </FeedbackMessage>
                ) : (
                    <>
                        <div className={styles.indexState} role="status">
                            <Badge
                                variant={
                                    index?.status === 'failed'
                                        ? 'destructive'
                                        : index?.status === 'stale'
                                          ? 'warning'
                                          : index?.status === 'ready'
                                            ? 'success'
                                            : 'info'
                                }
                            >
                                {index ? labels[index.status] : '索引状态未读取'}
                            </Badge>
                            <span className="text-muted-foreground">
                                {index && index.status !== 'none'
                                    ? `${index.completedChunks} / ${index.totalChunks} 个分片已持久化 · 第 ${index.generation} 代`
                                    : `${document.chunkCount} 个原始分片`}
                            </span>
                        </div>
                        {index && index.status !== 'none' && index.totalChunks > 0 && (
                            <Progress value={(index.completedChunks / index.totalChunks) * 100}>
                                <ProgressLabel>已持久化分片进度</ProgressLabel>
                                <ProgressValue />
                            </Progress>
                        )}
                        {index?.error && (
                            <FeedbackMessage variant="error" className={styles.error}>
                                {index.error}
                            </FeedbackMessage>
                        )}
                        <div className={styles.modelSummary}>
                            <span>当前默认向量模型</span>
                            <strong>{model?.name || '尚未设置'}</strong>
                            {model && (
                                <p>
                                    配置版本 {model.revision} ·{' '}
                                    {model.verifiedAt ? `${model.providerModel} · ${model.dimensions} 维` : '尚未验证'}
                                </p>
                            )}
                        </div>
                        {index?.model && (
                            <p className={styles.hint}>
                                此索引：{index.model.name} · 版本 {index.model.revision} · {index.model.providerModel} ·{' '}
                                {index.model.dimensions} 维。
                            </p>
                        )}
                        {blocked && (
                            <FeedbackMessage variant="warning" className={styles.notice}>
                                {blocked}{' '}
                                {(!model || !model.verifiedAt) && <Link href="/account#embedding-models">配置或测试向量模型</Link>}
                            </FeedbackMessage>
                        )}
                        {(index?.status === 'stale' || (index?.status === 'failed' && !compatible)) && (
                            <FeedbackMessage variant="warning" className={styles.notice}>
                                当前默认空间与已有索引不相容。请明确重新建立索引，不会自动替换或混用旧向量。
                            </FeedbackMessage>
                        )}
                        <FeedbackMessage variant="warning">
                            开始、重建或重试会向默认服务发送资料分片，可能产生费用。重新建立时，旧代会立即退出召回；关闭页面不会取消已保存任务。
                        </FeedbackMessage>
                        <div className={styles.actions}>
                            <Button
                                variant="default"
                                type="button"
                                className={styles.primary}
                                disabled={Boolean(blocked) || pending || busy || loading || Boolean(loadError)}
                                onClick={() => void start(false)}
                            >
                                {busy ? '正在确认…' : index?.status === 'none' ? '开始建立索引' : '重新建立索引'}
                            </Button>
                            {index?.status === 'failed' && compatible && (
                                <Button
                                    variant="outline"
                                    type="button"
                                    className={styles.secondary}
                                    disabled={Boolean(blocked) || busy || loading}
                                    onClick={() => void start(true)}
                                >
                                    重试未完成批次
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                className={styles.secondary}
                                nativeButton={false}
                                render={<Link href={`/rag/search?documentId=${document.id}`} />}
                            >
                                <Search size={15} aria-hidden="true" />
                                检索此资料
                            </Button>
                        </div>
                        {actionError && (
                            <FeedbackMessage variant="error" className={styles.error} role="alert">
                                {actionError}
                            </FeedbackMessage>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    )
}
