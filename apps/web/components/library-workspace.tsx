'use client'

import { Button } from './ui/button'
import { Input } from './ui/input'
import { SearchInput } from './ui/search-input'
import { Label } from './ui/label'
import { Card, CardContent } from './ui/card'
import { FeedbackMessage } from './ui/feedback-message'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

import {
    KNOWLEDGE_DEFAULT_CHUNK_SIZE,
    KNOWLEDGE_DEFAULT_OVERLAP,
    KNOWLEDGE_MAX_FILE_SIZE,
    knowledgeChunkingSchema,
    type KnowledgeChunks,
    type KnowledgeDocument,
    type KnowledgeDocuments,
    type KnowledgeStatus,
} from '@ai-harness/contracts'
import { ArrowLeft, ArrowRight, Check, Download, FileText, LoaderCircle, Plus, RotateCcw, Search, Upload, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type RefObject } from 'react'
import {
    downloadKnowledgeFile,
    getKnowledgeChunks,
    getKnowledgeDocument,
    getKnowledgeStatus,
    listKnowledgeDocuments,
    retryKnowledgeDocument,
    uploadKnowledgeDocument,
} from '../lib/knowledge-client'
import styles from './library-workspace.styles'
import { KnowledgeIndexCard } from './knowledge-index'
import { Badge } from './ui/badge'
import { Pagination as PaginationRoot, PaginationContent, PaginationItem } from './ui/pagination'
import { EmptyState } from './ui/empty-state'

const statusLabels: Record<KnowledgeDocument['status'], string> = {
    queued: '等待处理',
    processing: '正在解析分片',
    ready: '分片完成',
    failed: '处理失败',
}

/**
 * Presents a knowledge failure without exposing implementation details.
 * @param cause - Error from the validated client or browser transfer.
 * @returns A useful public explanation.
 */
function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : '暂时无法读取资料，请稍后重试。'
}

/**
 * Formats original byte size without confusing it with extracted character count.
 * @param size - Original file byte count.
 * @returns A concise display with the exact byte count available in details.
 */
function fileSize(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
    return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

/**
 * Formats saved timestamps using the interface's local date conventions.
 * @param value - Validated ISO timestamp.
 * @returns A localized date and time.
 */
function dateLabel(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(value))
}

/**
 * Identifies work that still requires polling its durable processing record.
 * @param document - Actual saved document state.
 * @returns Whether the background job has not yet settled.
 */
function isPending(document: KnowledgeDocument): boolean {
    return document.status === 'queued' || document.status === 'processing'
}

/**
 * Renders textual processing feedback without invented percentage progress.
 * @param props - Actual saved processing state.
 * @returns An accessible icon and explicit state label.
 */
function DocumentStatus({ status }: { status: KnowledgeDocument['status'] }) {
    return (
        <Badge variant={status === 'failed' ? 'destructive' : status === 'ready' ? 'success' : 'info'}>
            {status === 'ready' ? (
                <Check size={14} aria-hidden="true" />
            ) : status === 'failed' ? (
                <X size={14} aria-hidden="true" />
            ) : (
                <LoaderCircle size={14} aria-hidden="true" />
            )}
            {statusLabels[status]}
        </Badge>
    )
}

/**
 * Provides bounded page navigation with a readable position and stable controls.
 * @param props - Current server page and navigation callback.
 * @returns Navigation for the complete document or chunk collection.
 */
function Pagination({
    page,
    pageSize,
    total,
    disabled,
    onPage,
}: {
    page: number
    pageSize: number
    total: number
    disabled: boolean
    onPage: (page: number) => void
}) {
    const pages = Math.max(1, Math.ceil(total / pageSize))
    return (
        <PaginationRoot className={styles.pagination} aria-label="分页">
            <PaginationContent className="flex w-full flex-wrap justify-between gap-3">
                <PaginationItem>
                    第 {page} / {pages} 页 · 共 {total} 项
                </PaginationItem>
                <PaginationItem className="flex gap-2">
                    <Button
                        variant="outline"
                        type="button"
                        className={styles.secondaryButton}
                        disabled={disabled || page <= 1}
                        onClick={() => onPage(page - 1)}
                    >
                        <ArrowLeft size={15} aria-hidden="true" /> 上一页
                    </Button>
                    <Button
                        variant="outline"
                        type="button"
                        className={styles.secondaryButton}
                        disabled={disabled || page >= pages}
                        onClick={() => onPage(page + 1)}
                    >
                        下一页 <ArrowRight size={15} aria-hidden="true" />
                    </Button>
                </PaginationItem>
            </PaginationContent>
        </PaginationRoot>
    )
}

/**
 * Selects the real collection or stable saved-document detail view.
 * @param props - Optional existing document identifier from routing.
 * @returns The authenticated knowledge workspace.
 */
export function LibraryWorkspace({ documentId }: { documentId?: string }) {
    return documentId ? <DocumentDetail key={documentId} documentId={documentId} /> : <DocumentList />
}

/**
 * Lists real account-scoped documents and uploads original sources for background processing.
 * @returns The document collection with truthful empty, loading, and failure states.
 */
function DocumentList() {
    const [status, setStatus] = useState<KnowledgeStatus | null>(null)
    const [result, setResult] = useState<KnowledgeDocuments | null>(null)
    const [query, setQuery] = useState('')
    const [page, setPage] = useState(1)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)
    const [uploadOpen, setUploadOpen] = useState(false)
    const uploadOpener = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        /**
         * Loads saved records and polls only while this page contains unsettled work.
         * @param initial - Whether the page should show a loading indicator.
         * @returns After a confirmed collection update or a visible recoverable failure.
         */
        async function load(initial: boolean) {
            if (initial) setLoading(true)
            try {
                const [capabilities, documents] = await Promise.all([
                    getKnowledgeStatus(controller.signal),
                    listKnowledgeDocuments({ page, pageSize: 20, query: query.trim() }, controller.signal),
                ])
                if (controller.signal.aborted) return
                setStatus(capabilities)
                setResult(documents)
                setError('')
                if (documents.documents.some(isPending)) timer = setTimeout(() => void load(false), 2000)
            } catch (cause) {
                if (!controller.signal.aborted) setError(errorMessage(cause))
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        const debounce = setTimeout(() => void load(true), query ? 250 : 0)
        return () => {
            controller.abort()
            clearTimeout(debounce)
            clearTimeout(timer)
        }
    }, [page, query, revision])

    /**
     * Opens a fresh upload dialog and remembers the control to focus after dismissal.
     * @param event - Header or empty-state upload action.
     * @returns Nothing after opening the account-scoped dialog.
     */
    function openUpload(event: MouseEvent<HTMLButtonElement>): void {
        uploadOpener.current = event.currentTarget
        setUploadOpen(true)
    }

    /**
     * Closes an idle upload dialog, allowing its focus manager to restore the opening control.
     * @returns Nothing after discarding the unsubmitted local form.
     */
    function closeUpload(): void {
        setUploadOpen(false)
    }

    return (
        <section className={styles.page}>
            <header className={styles.heading}>
                <div>
                    <h1>资料库</h1>
                    <p>上传原始资料，检查提取正文与分片结果。</p>
                </div>
                <div className={styles.headingActions}>
                    <Button variant="outline" nativeButton={false} render={<Link href="/rag/search" />} className={styles.secondaryButton}>
                        <Search size={16} aria-hidden="true" />
                        检索调试
                    </Button>
                    <Button
                        variant="default"
                        type="button"
                        className={styles.primaryButton}
                        onClick={openUpload}
                        aria-haspopup="dialog"
                        aria-expanded={uploadOpen}
                        aria-controls="knowledge-upload"
                    >
                        <Plus size={16} aria-hidden="true" /> 上传资料
                    </Button>
                </div>
            </header>
            {uploadOpen && <UploadForm available={status?.configured ?? false} onClose={closeUpload} returnFocus={uploadOpener} />}
            {status && !status.configured && (
                <FeedbackMessage variant="error" className={styles.errorBanner} role="alert">
                    资料上传服务尚未连接，请稍后重新载入。
                </FeedbackMessage>
            )}
            <div className={styles.toolbar}>
                <span>全部资料 {result ? <strong>{result.total}</strong> : ''}</span>
                <SearchInput
                    containerClassName={styles.search}
                    aria-label="按文件名搜索资料"
                    placeholder="按文件名搜索"
                    maxLength={180}
                    value={query}
                    onValueChange={value => {
                        setQuery(value)
                        setPage(1)
                    }}
                />
                <Button
                    variant="outline"
                    type="button"
                    className={styles.secondaryButton}
                    disabled={loading}
                    onClick={() => setRevision(value => value + 1)}
                >
                    <RotateCcw size={15} aria-hidden="true" /> 重新载入
                </Button>
            </div>
            {error && (
                <FeedbackMessage variant="error" className={styles.errorBanner} role="alert">
                    <span>{error}</span>
                    <Button
                        variant="outline"
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => setRevision(value => value + 1)}
                    >
                        重试读取
                    </Button>
                </FeedbackMessage>
            )}
            {loading ? (
                <Card className={styles.empty} role="status">
                    <CardContent>正在读取资料…</CardContent>
                </Card>
            ) : result && !error ? (
                <>
                    {result.documents.length ? (
                        <ul className={styles.documentList} aria-label="资料列表">
                            {result.documents.map(document => (
                                <li key={document.id} className="min-w-0">
                                    <Card className={styles.documentCard}>
                                        <Link
                                            href={`/rag/${document.id}`}
                                            className={styles.documentCardLink}
                                            aria-label={document.fileName}
                                            title={document.fileName}
                                        >
                                            <div className={styles.documentCardHeader}>
                                                <FileText size={20} aria-hidden="true" />
                                            </div>
                                            <div className={styles.documentInfo}>
                                                <h2>{document.fileName}</h2>
                                                <p>
                                                    {document.format.toUpperCase()} · {fileSize(document.size)} ·{' '}
                                                    {dateLabel(document.createdAt)}
                                                </p>
                                            </div>
                                            <div className={styles.documentCardFooter}>
                                                <DocumentStatus status={document.status} />
                                                <p>
                                                    {document.status === 'ready'
                                                        ? `${document.chunkCount} 个分片 · ${document.characterCount.toLocaleString('zh-CN')} 字符`
                                                        : document.status === 'failed'
                                                          ? document.error || '处理失败，查看详情重试。'
                                                          : '等待分片结果'}
                                                </p>
                                            </div>
                                        </Link>
                                    </Card>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <EmptyState
                            icon={<FileText />}
                            title={query.trim() ? '没有匹配的资料' : '上传你的第一份资料'}
                            description={
                                query.trim()
                                    ? '试试其他文件名，或清除搜索。'
                                    : '支持 TXT、Markdown、带文本层的 PDF 和 DOCX，单文件最多 10 MiB。'
                            }
                            actionLabel={query.trim() ? undefined : '选择资料'}
                            onAction={query.trim() ? undefined : openUpload}
                            actionProps={{ 'aria-haspopup': 'dialog' }}
                        />
                    )}
                    {result.total > 0 && (
                        <Pagination
                            page={result.page}
                            pageSize={result.pageSize}
                            total={result.total}
                            disabled={loading}
                            onPage={setPage}
                        />
                    )}
                </>
            ) : null}
        </section>
    )
}

/**
 * Uploads one file while preserving the creation identifier across uncertain failures.
 * @param props - Availability, the idle-dialog close callback, and the original opening control.
 * @returns A modal upload form with local errors and actual persistence feedback.
 */
function UploadForm({
    available,
    onClose,
    returnFocus,
}: {
    available: boolean
    onClose: () => void
    returnFocus: RefObject<HTMLButtonElement | null>
}) {
    const router = useRouter()
    const [file, setFile] = useState<File | null>(null)
    const [chunkSize, setChunkSize] = useState(String(KNOWLEDGE_DEFAULT_CHUNK_SIZE))
    const [overlap, setOverlap] = useState(String(KNOWLEDGE_DEFAULT_OVERLAP))
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const action = useRef<{ file: File; chunkSize: number; overlap: number; requestId: string } | null>(null)
    const activeRequest = useRef<AbortController | null>(null)
    const fileInput = useRef<HTMLInputElement>(null)
    useEffect(() => () => activeRequest.current?.abort(), [])

    /**
     * Closes the upload dialog only when no original-file transfer is in progress.
     * @returns Nothing; leaves an in-flight transfer and its form visible.
     */
    function close(): void {
        if (!activeRequest.current) onClose()
    }

    /**
     * Validates file bounds and numeric character settings before requesting durable upload.
     * @param event - Submitted upload form.
     * @returns After navigation to a confirmed record or a recoverable error preserving input.
     */
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (activeRequest.current || !available) return
        const form = event.currentTarget
        const parsed = knowledgeChunkingSchema.safeParse({ chunkSize: Number(chunkSize), overlap: Number(overlap) })
        const nextErrors: Record<string, string> = {}
        if (!file) nextErrors.file = '请选择一份资料。'
        else if (!/\.(txt|md|pdf|docx)$/i.test(file.name)) nextErrors.file = '请选择 TXT、MD、PDF 或 DOCX 文件。'
        else if (file.size <= 0 || file.size > KNOWLEDGE_MAX_FILE_SIZE) nextErrors.file = '文件须大于 0 且不超过 10 MiB。'
        else if (file.name.length > 180) nextErrors.file = '文件名过长，请缩短为 180 个字符以内。'
        if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] ??= issue.message
        if (!chunkSize.trim()) nextErrors.chunkSize = '请填写最大分片长度。'
        if (!overlap.trim()) nextErrors.overlap = '请填写最大重叠长度，允许为 0。'
        setErrors(nextErrors)
        setError('')
        if (Object.keys(nextErrors).length || !file || !parsed.success) {
            requestAnimationFrame(() => form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
            return
        }
        if (
            !action.current ||
            action.current.file !== file ||
            action.current.chunkSize !== parsed.data.chunkSize ||
            action.current.overlap !== parsed.data.overlap
        )
            action.current = { file, ...parsed.data, requestId: crypto.randomUUID() }
        const controller = new AbortController()
        activeRequest.current = controller
        setBusy(true)
        try {
            const document = await uploadKnowledgeDocument(file, { requestId: action.current.requestId, ...parsed.data }, controller.signal)
            if (controller.signal.aborted) return
            action.current = null
            router.push(`/rag/${document.id}`)
        } catch (cause) {
            if (!controller.signal.aborted) setError(errorMessage(cause))
        } finally {
            if (activeRequest.current === controller) activeRequest.current = null
            if (!controller.signal.aborted) setBusy(false)
        }
    }

    return (
        <Dialog
            open
            disablePointerDismissal={busy}
            onOpenChange={(open, details) => {
                if (!open) {
                    if (activeRequest.current) details.cancel()
                    else close()
                }
            }}
        >
            <DialogContent
                id="knowledge-upload"
                showCloseButton={false}
                initialFocus={fileInput}
                finalFocus={returnFocus}
                className={styles.uploadDialog}
            >
                <DialogHeader className="relative shrink-0 pr-10">
                    <DialogTitle>上传并分片</DialogTitle>
                    <DialogDescription>选择原始文件并设置分片参数。</DialogDescription>
                    <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        className="absolute top-0 right-0"
                        aria-label="关闭上传表单"
                        disabled={busy}
                        onClick={close}
                    >
                        <X size={18} aria-hidden="true" />
                    </Button>
                </DialogHeader>
                <form onSubmit={submit} noValidate className="flex min-h-0 flex-col gap-4">
                    <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain">
                        <fieldset disabled={busy || !available} className={styles.fields}>
                            <div className={`${styles.field} ${styles.fileField}`}>
                                <Label htmlFor="knowledge-file">
                                    原始文件 <span aria-hidden="true">*</span>
                                </Label>
                                <div className={styles.filePicker}>
                                    <Input
                                        id="knowledge-file"
                                        ref={fileInput}
                                        className={styles.fileInput}
                                        type="file"
                                        required
                                        accept=".txt,.md,.pdf,.docx"
                                        aria-describedby="knowledge-file-types knowledge-file-hint"
                                        aria-invalid={Boolean(errors.file)}
                                        onChange={event => setFile(event.target.files?.[0] ?? null)}
                                    />
                                    <div className={styles.filePickerContent}>
                                        {file ? (
                                            <FileText size={28} strokeWidth={1.5} aria-hidden="true" />
                                        ) : (
                                            <Upload size={28} strokeWidth={1.5} aria-hidden="true" />
                                        )}
                                        <span className={styles.filePickerTitle}>{file ? file.name : '点击选择文件'}</span>
                                        <span id="knowledge-file-types" className={styles.filePickerDescription}>
                                            {file ? `${fileSize(file.size)} · 点击更换文件` : 'TXT / MD / PDF / DOCX · 最大 10 MiB'}
                                        </span>
                                    </div>
                                </div>
                                <span id="knowledge-file-hint" className={errors.file ? styles.fieldError : styles.hint}>
                                    {errors.file || 'PDF 需包含可提取文字，扫描件请先进行 OCR。'}
                                </span>
                            </div>
                            <div className={styles.field}>
                                <Label htmlFor="knowledge-chunk-size">
                                    最大分片长度（字符） <span aria-hidden="true">*</span>
                                </Label>
                                <Input
                                    id="knowledge-chunk-size"
                                    type="number"
                                    inputMode="numeric"
                                    min={200}
                                    max={4000}
                                    step={1}
                                    required
                                    value={chunkSize}
                                    aria-invalid={Boolean(errors.chunkSize)}
                                    aria-describedby="knowledge-chunk-size-hint"
                                    onChange={event => setChunkSize(event.target.value)}
                                />
                                <span id="knowledge-chunk-size-hint" className={errors.chunkSize ? styles.fieldError : styles.hint}>
                                    {errors.chunkSize || '200–4000 个 Unicode 字符的上限；段落、句子和标点优先，实际可更短。'}
                                </span>
                            </div>
                            <div className={styles.field}>
                                <Label htmlFor="knowledge-overlap">
                                    最大重叠长度（字符） <span aria-hidden="true">*</span>
                                </Label>
                                <Input
                                    id="knowledge-overlap"
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={Math.min(500, Math.floor(Number(chunkSize) / 2))}
                                    step={1}
                                    required
                                    value={overlap}
                                    aria-invalid={Boolean(errors.overlap)}
                                    aria-describedby="knowledge-overlap-hint"
                                    onChange={event => setOverlap(event.target.value)}
                                />
                                <span id="knowledge-overlap-hint" className={errors.overlap ? styles.fieldError : styles.hint}>
                                    {errors.overlap || '0–500 字符的上限，且不超过最大长度的一半；完整尾部单元优先，实际可更少或为 0。'}
                                </span>
                            </div>
                        </fieldset>
                        {!available && <FeedbackMessage variant="info">正在确认资料上传服务；服务连接后即可提交。</FeedbackMessage>}
                        {error && (
                            <FeedbackMessage variant="error" className={styles.errorBanner} role="alert">
                                {error} 原选择与参数已保留，可直接重试。
                            </FeedbackMessage>
                        )}
                    </div>
                    <div className={styles.formActions}>
                        <p className={styles.hint}>{busy ? '正在保存原文件，请保持此页打开…' : '保存成功后进入详情查看真实处理状态。'}</p>
                        <Button variant="default" type="submit" className={styles.primaryButton} disabled={busy || !available}>
                            <Upload size={16} aria-hidden="true" />
                            {busy ? '正在上传…' : '上传并开始分片'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Reads a stable document and its complete published chunk pages, with recoverable processing.
 * @param props - Saved document identifier supplied by the route.
 * @returns Original metadata, processing state, and plain text chunks.
 */
function DocumentDetail({ documentId }: { documentId: string }) {
    const params = useSearchParams()
    const projectFolderId = params.get('projectFolderId') ?? undefined
    const chunkParameter = Number(params.get('chunk'))
    const requestedChunk = Number.isInteger(chunkParameter) && chunkParameter >= 1 && chunkParameter <= 5000 ? chunkParameter : null
    const [document, setDocument] = useState<KnowledgeDocument | null>(null)
    const [chunks, setChunks] = useState<KnowledgeChunks | null>(null)
    const [page, setPage] = useState(requestedChunk ? Math.ceil(requestedChunk / 20) : 1)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [chunkError, setChunkError] = useState('')
    const [actionError, setActionError] = useState('')
    const [revision, setRevision] = useState(0)
    const [busy, setBusy] = useState('')
    const retryAction = useRef<{ attempt: number; requestId: string } | null>(null)
    const activeAction = useRef<AbortController | null>(null)
    useEffect(() => () => activeAction.current?.abort(), [])
    const [routeChunk, setRouteChunk] = useState(requestedChunk)
    if (routeChunk !== requestedChunk) {
        setRouteChunk(requestedChunk)
        if (requestedChunk) setPage(Math.ceil(requestedChunk / 20))
    }
    useEffect(() => {
        if (loading || !requestedChunk || !chunks?.chunks.some(chunk => chunk.index === requestedChunk)) return
        const source = window.document.getElementById(`chunk-${requestedChunk}`)
        source?.scrollIntoView({ block: 'start' })
        source?.focus({ preventScroll: true })
    }, [chunks, requestedChunk, loading])

    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        /**
         * Refreshes real processing state and reads only atomically published chunks.
         * @param initial - Whether this navigation requires a loading message.
         * @returns After settled display state or a recoverable load failure.
         */
        async function load(initial: boolean) {
            if (initial) setLoading(true)
            try {
                const saved = await getKnowledgeDocument(documentId, controller.signal, projectFolderId)
                if (controller.signal.aborted) return
                setDocument(saved)
                setError('')
                if (saved.status === 'ready') {
                    try {
                        const result = await getKnowledgeChunks(documentId, page, controller.signal, projectFolderId)
                        if (!controller.signal.aborted) {
                            setChunks(result)
                            setChunkError('')
                        }
                    } catch (cause) {
                        if (!controller.signal.aborted) {
                            setChunks(null)
                            setChunkError(errorMessage(cause))
                        }
                    }
                } else {
                    setChunks(null)
                    setChunkError('')
                    if (isPending(saved)) timer = setTimeout(() => void load(false), 2000)
                }
            } catch (cause) {
                if (!controller.signal.aborted) setError(errorMessage(cause))
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        void load(true)
        return () => {
            controller.abort()
            clearTimeout(timer)
        }
    }, [documentId, projectFolderId, page, revision])

    /**
     * Requeues the saved source while preserving one action UUID until its result is confirmed.
     * @returns After the new state is durable or the retry error is visible.
     */
    async function retry() {
        if (!document || busy) return
        if (!retryAction.current || retryAction.current.attempt !== document.attempt)
            retryAction.current = { attempt: document.attempt, requestId: crypto.randomUUID() }
        const controller = new AbortController()
        activeAction.current = controller
        setBusy('retry')
        setActionError('')
        try {
            const saved = await retryKnowledgeDocument(document.id, retryAction.current.requestId, controller.signal)
            if (controller.signal.aborted) return
            setDocument(saved)
            retryAction.current = null
            setRevision(value => value + 1)
        } catch (cause) {
            if (!controller.signal.aborted) setActionError(errorMessage(cause))
        } finally {
            if (!controller.signal.aborted) setBusy('')
        }
    }

    /**
     * Downloads authenticated original bytes and reports storage failures in the current page.
     * @returns After starting the browser download or showing an actionable error.
     */
    async function download() {
        if (!document || busy) return
        const controller = new AbortController()
        activeAction.current = controller
        setBusy('download')
        setActionError('')
        try {
            const blob = await downloadKnowledgeFile(document.id, controller.signal, projectFolderId)
            if (controller.signal.aborted) return
            const objectUrl = URL.createObjectURL(blob)
            const anchor = window.document.createElement('a')
            anchor.href = objectUrl
            anchor.download = document.fileName
            anchor.hidden = true
            window.document.body.append(anchor)
            anchor.click()
            anchor.remove()
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
        } catch (cause) {
            if (!controller.signal.aborted) setActionError(errorMessage(cause))
        } finally {
            if (!controller.signal.aborted) setBusy('')
        }
    }

    return (
        <section className={styles.page}>
            <Button variant="ghost" className={styles.backLink} nativeButton={false} render={<Link href="/rag" />}>
                <ArrowLeft size={15} aria-hidden="true" />
                返回资料库
            </Button>
            {loading && !document ? (
                <Card className={styles.empty} role="status">
                    <CardContent>正在读取资料详情…</CardContent>
                </Card>
            ) : error ? (
                <FeedbackMessage variant="error" className={styles.errorBanner} role="alert">
                    <span>{error}</span>
                    <Button
                        variant="outline"
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => setRevision(value => value + 1)}
                    >
                        重新载入
                    </Button>
                </FeedbackMessage>
            ) : document ? (
                <>
                    <header className={styles.heading}>
                        <div>
                            <h1>{document.fileName}</h1>
                            <p>
                                {document.format.toUpperCase()} · {fileSize(document.size)}（{document.size.toLocaleString('zh-CN')} 字节）
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            type="button"
                            className={styles.secondaryButton}
                            disabled={Boolean(busy)}
                            onClick={() => void download()}
                        >
                            <Download size={16} aria-hidden="true" />
                            {busy === 'download' ? '正在下载…' : '下载原文件'}
                        </Button>
                    </header>
                    <FeedbackMessage variant={document.status === 'ready' ? 'success' : document.status === 'failed' ? 'error' : 'loading'}>
                        <p>
                            {document.status === 'ready'
                                ? '已保存完整分片，可以逐片核对正文。'
                                : document.status === 'failed'
                                  ? document.error || '未能提取有效正文，请检查原文件后重试。'
                                  : '原文件已持久保存，正在后台提取正文并分片。页面会自动更新，无需重复上传。'}
                        </p>
                        {document.status === 'failed' && (
                            <Button
                                variant="outline"
                                type="button"
                                className={styles.secondaryButton}
                                disabled={Boolean(busy)}
                                onClick={() => void retry()}
                            >
                                <RotateCcw size={15} aria-hidden="true" />
                                {busy === 'retry' ? '正在重新排队…' : '重新处理原文件'}
                            </Button>
                        )}
                    </FeedbackMessage>
                    {actionError && (
                        <FeedbackMessage variant="error" className={styles.errorBanner} role="alert">
                            {actionError}
                        </FeedbackMessage>
                    )}
                    <dl className={styles.metadata}>
                        <div>
                            <dt>分片总数</dt>
                            <dd>{document.status === 'ready' ? document.chunkCount.toLocaleString('zh-CN') : '待处理完成'}</dd>
                        </div>
                        <div>
                            <dt>提取字符数</dt>
                            <dd>{document.status === 'ready' ? document.characterCount.toLocaleString('zh-CN') : '待处理完成'}</dd>
                        </div>
                        <div>
                            <dt>最大分片长度 / 最大重叠</dt>
                            <dd>
                                {document.chunkSize} / {document.overlap} 字符
                            </dd>
                        </div>
                        {document.pageCount && (
                            <div>
                                <dt>原文页数</dt>
                                <dd>{document.pageCount}</dd>
                            </div>
                        )}
                        <div>
                            <dt>上传时间</dt>
                            <dd>{dateLabel(document.createdAt)}</dd>
                        </div>
                        <div>
                            <dt>最近更新</dt>
                            <dd>{dateLabel(document.updatedAt)}</dd>
                        </div>
                        <div>
                            <dt>处理次数</dt>
                            <dd>{document.attempt}</dd>
                        </div>
                    </dl>
                    {!projectFolderId && <KnowledgeIndexCard document={document} />}
                    <section className={styles.chunksSection} aria-labelledby="knowledge-chunks-title">
                        <div className={styles.sectionHeading}>
                            <div>
                                <h2 id="knowledge-chunks-title">资料分片</h2>
                                <p>
                                    新上传按段落、句子和标点优先分片，无可用边界时按最大长度切分；已有分片保持原样。长度和重叠均为上限，实际可更短。按
                                    Unicode 字符计数，统一换行并去除 BOM 与 NUL，保留空白；来源位置从 0 起算，终点不包含在内。
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                type="button"
                                className={styles.secondaryButton}
                                disabled={loading || Boolean(busy)}
                                onClick={() => setRevision(value => value + 1)}
                            >
                                <RotateCcw size={15} aria-hidden="true" /> 刷新结果
                            </Button>
                        </div>
                        {document.status !== 'ready' ? (
                            <FeedbackMessage variant={document.status === 'failed' ? 'warning' : 'info'}>
                                {document.status === 'failed'
                                    ? '本次处理失败，未发布部分分片。可下载原文件核对并重新处理。'
                                    : '处理完成后，这里将显示完整分片。'}
                            </FeedbackMessage>
                        ) : loading ? (
                            <Card className={styles.empty} role="status">
                                <CardContent>正在读取分片…</CardContent>
                            </Card>
                        ) : chunkError ? (
                            <FeedbackMessage variant="error" className={styles.errorBanner} role="alert">
                                <span>{chunkError}</span>
                                <Button
                                    variant="outline"
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => setRevision(value => value + 1)}
                                >
                                    重试读取分片
                                </Button>
                            </FeedbackMessage>
                        ) : chunks ? (
                            <>
                                <div className={styles.chunkList}>
                                    {chunks.chunks.map(chunk => (
                                        <Card key={chunk.id} id={`chunk-${chunk.index}`} tabIndex={-1} className={styles.chunk}>
                                            <CardContent>
                                                <header>
                                                    <h3>分片 {String(chunk.index).padStart(3, '0')}</h3>
                                                    <span>{chunk.characterCount} 字符</span>
                                                </header>
                                                <p className={styles.chunkSource}>
                                                    来源：{document.fileName}
                                                    {chunk.pageStart
                                                        ? ` · 第 ${chunk.pageStart}${chunk.pageEnd && chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : ''} 页`
                                                        : ' · 以正文字符位置定位'}
                                                    <br />
                                                    字符位置 [{chunk.charStart}, {chunk.charEnd})
                                                </p>
                                                <div className={styles.chunkContent}>{chunk.content}</div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                                <Pagination
                                    page={chunks.page}
                                    pageSize={chunks.pageSize}
                                    total={chunks.total}
                                    disabled={loading}
                                    onPage={setPage}
                                />
                            </>
                        ) : null}
                    </section>
                </>
            ) : null}
        </section>
    )
}
