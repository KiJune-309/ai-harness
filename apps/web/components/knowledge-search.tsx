'use client'

import { Button } from './ui/button'
import { Input } from './ui/input'
import { SearchInput } from './ui/search-input'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Card, CardContent } from './ui/card'
import { FeedbackMessage } from './ui/feedback-message'

import {
    knowledgeSearchSchema,
    KNOWLEDGE_SEARCH_DEFAULT_TOP_K,
    KNOWLEDGE_SEARCH_MAX_CHARACTERS,
    type KnowledgeDocument,
    type KnowledgeSearchResult,
    type VectorStatus,
} from '@ai-harness/contracts'
import { ArrowLeft, ArrowUpRight, RotateCcw, Search, Square } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getKnowledgeDocument, listKnowledgeDocuments } from '../lib/knowledge-client'
import { getVectorStatus, knowledgeChunkSource, searchKnowledgeVectors } from '../lib/vector-client'
import styles from './vector-workspace.styles'

/**
 * Runs only user-submitted semantic queries and renders actual cosine-ranked original sources.
 * @returns Account-scoped vector recall debugging with truthful prerequisites and results.
 */
export function KnowledgeSearchWorkspace() {
    const params = useSearchParams()
    const requestedDocument = params.get('documentId') ?? ''
    const [selection, setSelection] = useState({ requested: requestedDocument, id: requestedDocument })
    const documentId = selection.requested === requestedDocument ? selection.id : requestedDocument
    if (selection.requested !== requestedDocument) setSelection({ requested: requestedDocument, id: requestedDocument })
    const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
    const [documentPage, setDocumentPage] = useState(1)
    const [documentTotal, setDocumentTotal] = useState(0)
    const [status, setStatus] = useState<VectorStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [revision, setRevision] = useState(0)
    const [query, setQuery] = useState('')
    const [topK, setTopK] = useState(String(KNOWLEDGE_SEARCH_DEFAULT_TOP_K))
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [result, setResult] = useState<KnowledgeSearchResult | null>(null)
    const activeRequest = useRef<AbortController | null>(null)
    const sourceRequest = useRef<AbortController | null>(null)
    const resultsHeading = useRef<HTMLHeadingElement>(null)
    useEffect(
        () => () => {
            activeRequest.current?.abort()
            sourceRequest.current?.abort()
        },
        []
    )

    useEffect(() => {
        /**
         * Refreshes metadata after another tab changes the account's default vector space.
         * @returns Nothing after scheduling a provider-free status reload.
         */
        function refresh(): void {
            setRevision(value => value + 1)
        }
        window.addEventListener('focus', refresh)
        return () => window.removeEventListener('focus', refresh)
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Refreshes owned source choices and current space without invoking the provider.
         * @returns After a confirmed metadata refresh or recoverable failure.
         */
        async function load(): Promise<void> {
            setLoading(true)
            await Promise.all([
                getVectorStatus(controller.signal),
                listKnowledgeDocuments({ page: 1, pageSize: 100, query: '' }, controller.signal),
                requestedDocument ? getKnowledgeDocument(requestedDocument, controller.signal) : Promise.resolve(null),
            ])
                .then(([capabilities, page, selected]) => {
                    if (controller.signal.aborted) return
                    setStatus(capabilities)
                    setResult(previous =>
                        previous &&
                        capabilities.defaultModel &&
                        previous.model.id === capabilities.defaultModel.id &&
                        previous.model.revision === capabilities.defaultModel.revision &&
                        previous.model.providerModel === capabilities.defaultModel.providerModel &&
                        previous.model.dimensions === capabilities.defaultModel.dimensions
                            ? previous
                            : null
                    )
                    setDocuments(
                        selected && !page.documents.some(item => item.id === selected.id) ? [selected, ...page.documents] : page.documents
                    )
                    setDocumentTotal(page.total)
                    setDocumentPage(1)
                    setLoadError('')
                })
                .catch(cause => {
                    if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : '暂时无法读取检索配置。')
                })
                .finally(() => {
                    if (!controller.signal.aborted) setLoading(false)
                })
        }
        void load()
        return () => controller.abort()
    }, [requestedDocument, revision])

    const model = status?.defaultModel
    const blocked = !status?.available
        ? status?.reason || '向量数据库暂时不可用。'
        : !model
          ? '请先设置默认向量模型。'
          : !model.verifiedAt
            ? '默认向量模型尚未验证。'
            : ''

    /**
     * Appends another real document page without pretending the first page is the complete selector.
     * @returns After the next owned-source page or a visible recoverable failure.
     */
    async function loadMore() {
        if (loadingMore || busy) return
        const controller = new AbortController()
        sourceRequest.current = controller
        setLoadingMore(true)
        try {
            const page = await listKnowledgeDocuments({ page: documentPage + 1, pageSize: 100, query: '' }, controller.signal)
            if (controller.signal.aborted) return
            setDocuments(current => [...current, ...page.documents.filter(item => !current.some(saved => saved.id === item.id))])
            setDocumentPage(page.page)
            setDocumentTotal(page.total)
            setError('')
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '未能读取更多资料。')
        } finally {
            if (!controller.signal.aborted) setLoadingMore(false)
        }
    }

    /**
     * Validates and explicitly submits a query using the current default compatible vector space.
     * @param event - Query form submission.
     * @returns After real search results, user cancellation, or recoverable provider feedback.
     */
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (busy || loading || loadError || blocked) return
        const form = event.currentTarget
        const parsed = knowledgeSearchSchema.safeParse({ query, topK: Number(topK), ...(documentId ? { documentId } : {}) })
        const nextErrors: Record<string, string> = {}
        if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] ??= issue.message
        if (!topK.trim()) nextErrors.topK = '请填写 Top K。'
        setErrors(nextErrors)
        setError('')
        setNotice('')
        if (!parsed.success || Object.keys(nextErrors).length) {
            requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
            return
        }
        const controller = new AbortController()
        activeRequest.current = controller
        setBusy(true)
        setResult(null)
        try {
            const saved = await searchKnowledgeVectors(parsed.data, controller.signal)
            if (controller.signal.aborted) {
                setNotice('查询已取消。')
                return
            }
            setResult(saved)
            requestAnimationFrame(() => resultsHeading.current?.focus())
        } catch (cause) {
            if (controller.signal.aborted) setNotice('查询已取消。')
            else setError(cause instanceof Error ? cause.message : '未能完成检索，请重试。')
        } finally {
            if (activeRequest.current === controller) activeRequest.current = null
            setBusy(false)
        }
    }

    return (
        <section className={styles.page}>
            <Button variant="ghost" nativeButton={false} render={<Link href="/rag" />} className={styles.backLink}>
                <ArrowLeft size={15} aria-hidden="true" />
                返回资料库
            </Button>
            <header className={styles.pageHeading}>
                <h1>检索调试</h1>
                <p>检查当前默认向量空间能召回哪些原始分片。</p>
            </header>
            {loading ? (
                <FeedbackMessage variant="loading" className={styles.notice} role="status">
                    正在读取向量配置与资料范围…
                </FeedbackMessage>
            ) : loadError ? (
                <FeedbackMessage variant="error" className={styles.error} role="alert">
                    <p>{loadError}</p>
                    <Button variant="outline" type="button" className={styles.secondary} onClick={() => setRevision(value => value + 1)}>
                        重新载入
                    </Button>
                </FeedbackMessage>
            ) : (
                <>
                    <div className={styles.modelSummary}>
                        <span>当前默认向量模型</span>
                        <strong>{model?.name || '尚未设置'}</strong>
                        {model && (
                            <p>
                                版本 {model.revision} · {model.verifiedAt ? `${model.providerModel} · ${model.dimensions} 维` : '尚未验证'}
                            </p>
                        )}
                        <Link href="/account#embedding-models">
                            管理向量模型 <ArrowUpRight size={13} aria-hidden="true" />
                        </Link>
                    </div>
                    {blocked && (
                        <FeedbackMessage variant="warning" className={styles.notice}>
                            {blocked} 请在账户页配置并测试向量连接；只保存不会调用服务商。
                        </FeedbackMessage>
                    )}
                    <form onSubmit={submit} className={styles.searchForm} aria-busy={busy} noValidate>
                        <fieldset className={styles.fields} disabled={busy || Boolean(blocked)}>
                            <div className={styles.queryField}>
                                <Label htmlFor="vector-query">
                                    查询文本 <span aria-hidden="true">*</span>
                                </Label>
                                <SearchInput
                                    id="vector-query"
                                    value={query}
                                    onValueChange={setQuery}
                                    disabled={busy || Boolean(blocked)}
                                    loading={busy}
                                    maxLength={4000}
                                    required
                                    placeholder="输入与你的资料有关的问题或描述…"
                                    aria-invalid={Boolean(errors.query)}
                                    aria-describedby="vector-query-hint"
                                />
                                <span id="vector-query-hint" className={errors.query ? styles.fieldError : styles.hint}>
                                    {errors.query ||
                                        `${Array.from(query.trim()).length} / ${KNOWLEDGE_SEARCH_MAX_CHARACTERS} 个 Unicode 字符。只有提交查询才调用服务商，可能产生费用。`}
                                </span>
                            </div>
                            <div className={styles.field}>
                                <Label htmlFor="vector-top-k">Top K</Label>
                                <Input
                                    id="vector-top-k"
                                    type="number"
                                    min={1}
                                    max={20}
                                    step={1}
                                    inputMode="numeric"
                                    value={topK}
                                    required
                                    onChange={event => setTopK(event.target.value)}
                                    aria-invalid={Boolean(errors.topK)}
                                    aria-describedby="vector-top-k-hint"
                                />
                                <span id="vector-top-k-hint" className={errors.topK ? styles.fieldError : styles.hint}>
                                    {errors.topK || '返回最相近的 1–20 个分片，默认 5。'}
                                </span>
                            </div>
                            <div className={styles.field}>
                                <Label htmlFor="vector-document">资料范围</Label>
                                <NativeSelect
                                    id="vector-document"
                                    value={documentId}
                                    onChange={event => setSelection({ requested: requestedDocument, id: event.target.value })}
                                    aria-invalid={Boolean(errors.documentId)}
                                    aria-describedby="vector-document-hint"
                                >
                                    <NativeSelectOption value="">全部相容资料</NativeSelectOption>
                                    {documents.map(document => (
                                        <NativeSelectOption value={document.id} key={document.id} disabled={document.status !== 'ready'}>
                                            {document.fileName} · {document.id.slice(0, 8)}
                                            {document.status !== 'ready' ? '（分片未完成）' : ''}
                                        </NativeSelectOption>
                                    ))}
                                </NativeSelect>
                                <span id="vector-document-hint" className={errors.documentId ? styles.fieldError : styles.hint}>
                                    {errors.documentId || '只搜索当前账户、当前默认空间中完整就绪的索引。'}
                                </span>
                            </div>
                        </fieldset>
                        {documents.length < documentTotal && (
                            <Button
                                variant="ghost"
                                type="button"
                                className={styles.textButton}
                                disabled={loadingMore || busy}
                                onClick={() => void loadMore()}
                            >
                                {loadingMore ? '正在载入…' : `载入更多资料（已列出 ${documents.length} / ${documentTotal}）`}
                            </Button>
                        )}
                        <div className={styles.actions}>
                            <Button variant="default" type="submit" className={styles.primary} disabled={busy || Boolean(blocked)}>
                                <Search size={16} aria-hidden="true" />
                                {busy ? '正在检索…' : '查询分片'}
                            </Button>
                            {busy && (
                                <Button
                                    variant="outline"
                                    type="button"
                                    className={styles.secondary}
                                    onClick={() => activeRequest.current?.abort()}
                                >
                                    <Square size={14} aria-hidden="true" />
                                    取消查询
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                type="button"
                                className={styles.secondary}
                                disabled={busy}
                                onClick={() => setRevision(value => value + 1)}
                            >
                                <RotateCcw size={15} aria-hidden="true" />
                                刷新配置
                            </Button>
                        </div>
                    </form>
                    {error && (
                        <FeedbackMessage variant="error" className={styles.error} role="alert">
                            <p>{error}</p>
                            <p>没有相容索引时，请先到对应资料详情手动建立索引。</p>
                            <Link href="/rag">查看资料</Link>
                        </FeedbackMessage>
                    )}
                    {notice && <FeedbackMessage variant="info">{notice}</FeedbackMessage>}
                    {result && (
                        <section className={styles.results} aria-labelledby="vector-results-title">
                            <h2 id="vector-results-title" ref={resultsHeading} tabIndex={-1}>
                                {result.hits.length ? `召回 ${result.hits.length} 个分片` : '没有召回结果'}
                            </h2>
                            <p className={styles.hint}>
                                查询：{result.query}
                                <br />
                                模型：{result.model.name} · 版本 {result.model.revision} · {result.model.providerModel} ·{' '}
                                {result.model.dimensions} 维。
                            </p>
                            <FeedbackMessage variant="info" className={styles.notice}>
                                按余弦距离升序排列，越小越相近。相似度 = 1 − distance，范围 [-1, 1]；不是概率或百分比置信度。
                            </FeedbackMessage>
                            {!result.hits.length && (
                                <FeedbackMessage variant="info">
                                    当前范围没有匹配分片，可以调整查询或检查对应资料的索引状态。
                                </FeedbackMessage>
                            )}
                            {result.hits.map(hit => (
                                <Card key={hit.chunk.id} className={styles.hit}>
                                    <CardContent>
                                        <header>
                                            <h3>
                                                <Link href={knowledgeChunkSource(hit.documentId, hit.chunk.index)}>{hit.fileName}</Link>
                                            </h3>
                                            <span>分片 {hit.chunk.index}</span>
                                        </header>
                                        <dl className={styles.scores}>
                                            <div>
                                                <dt>余弦距离</dt>
                                                <dd>{hit.distance.toFixed(6)}</dd>
                                            </div>
                                            <div>
                                                <dt>相似度</dt>
                                                <dd>{hit.score.toFixed(6)}</dd>
                                            </div>
                                        </dl>
                                        <p className={styles.hint}>
                                            字符位置 [{hit.chunk.charStart}, {hit.chunk.charEnd}) · {hit.chunk.characterCount} 字符
                                            {hit.chunk.pageStart
                                                ? ` · 第 ${hit.chunk.pageStart}${hit.chunk.pageEnd && hit.chunk.pageEnd !== hit.chunk.pageStart ? `–${hit.chunk.pageEnd}` : ''} 页`
                                                : ''}
                                        </p>
                                        <div className={styles.hitContent}>{hit.chunk.content}</div>
                                        <Button
                                            variant="ghost"
                                            className={styles.sourceLink}
                                            nativeButton={false}
                                            render={<Link href={knowledgeChunkSource(hit.documentId, hit.chunk.index)} />}
                                        >
                                            查看原文分片 <ArrowUpRight size={14} aria-hidden="true" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            ))}
                        </section>
                    )}
                </>
            )}
        </section>
    )
}
