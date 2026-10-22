'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { FileText, LoaderCircle, Upload } from 'lucide-react'
import {
    KNOWLEDGE_DEFAULT_CHUNK_SIZE,
    KNOWLEDGE_DEFAULT_OVERLAP,
    type KnowledgeDocument,
    type KnowledgeDocuments,
} from '@ai-harness/contracts'
import { listKnowledgeDocuments, uploadKnowledgeDocument } from '../lib/knowledge-client'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Badge } from './ui/badge'
import { FeedbackMessage } from './ui/feedback-message'

const statusLabels: Record<KnowledgeDocument['status'], string> = {
    queued: '等待处理',
    processing: '正在处理',
    ready: '可供 Agent 查阅',
    failed: '处理失败',
}

/**
 * Shows and uploads documents in one exact personal project boundary.
 * @param props - Immutable project selection and controlled sheet visibility.
 * @returns A project-scoped document list, upload form and content links.
 */
export function ProjectFiles({
    projectFolderId,
    projectName,
    open,
    onOpenChange,
    returnFocusRef,
}: {
    projectFolderId: string
    projectName: string
    open: boolean
    onOpenChange: (open: boolean) => void
    returnFocusRef?: RefObject<HTMLButtonElement | null>
}) {
    const [documents, setDocuments] = useState<KnowledgeDocuments | null>(null)
    const [page, setPage] = useState(1)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [reload, setReload] = useState(0)
    const [file, setFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [uploadError, setUploadError] = useState('')
    const [uploaded, setUploaded] = useState('')
    const upload = useRef<{ file: File; requestId: string } | null>(null)
    const activeUpload = useRef<AbortController | null>(null)
    const uploadInput = useRef<HTMLInputElement>(null)

    useEffect(() => () => activeUpload.current?.abort(), [])
    useEffect(() => {
        if (!open) return
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        /**
         * Reads the current project's saved files and polls only incomplete processing.
         * @param initial - Whether to show the initial loading state.
         * @returns A promise settled after this scoped read.
         */
        async function load(initial: boolean) {
            if (initial) setLoading(true)
            try {
                const result = await listKnowledgeDocuments({ projectFolderId, page, pageSize: 20, query: '' }, controller.signal)
                if (controller.signal.aborted) return
                setDocuments(result)
                setError('')
                if (result.documents.some(item => item.status === 'queued' || item.status === 'processing'))
                    timer = setTimeout(() => void load(false), 2000)
            } catch (cause) {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '暂时无法载入项目资料。')
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        void load(true)
        return () => {
            controller.abort()
            if (timer) clearTimeout(timer)
        }
    }, [projectFolderId, page, open, reload])

    /**
     * Uploads the selected file while retaining the original action for retry.
     * @returns A promise settled after persistence succeeds or a visible failure occurs.
     */
    async function uploadFile() {
        if (!file || activeUpload.current) return
        if (!upload.current || upload.current.file !== file) upload.current = { file, requestId: crypto.randomUUID() }
        const controller = new AbortController()
        activeUpload.current = controller
        setUploading(true)
        setUploadError('')
        setUploaded('')
        try {
            const saved = await uploadKnowledgeDocument(
                file,
                {
                    projectFolderId,
                    requestId: upload.current.requestId,
                    chunkSize: KNOWLEDGE_DEFAULT_CHUNK_SIZE,
                    overlap: KNOWLEDGE_DEFAULT_OVERLAP,
                },
                controller.signal
            )
            if (controller.signal.aborted) return
            setUploaded(`“${saved.fileName}”已上传，处理完成后 Agent 可按问题查阅。`)
            setFile(null)
            if (uploadInput.current) uploadInput.current.value = ''
            upload.current = null
            setPage(1)
            setReload(value => value + 1)
        } catch (cause) {
            if (!controller.signal.aborted) setUploadError(cause instanceof Error ? cause.message : '上传未完成，请重试。')
        } finally {
            if (activeUpload.current === controller) {
                activeUpload.current = null
                setUploading(false)
            }
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                className="data-[side=right]:w-full data-[side=right]:sm:max-w-md"
                aria-label="项目资料"
                finalFocus={returnFocusRef}
            >
                <SheetHeader className="pr-12">
                    <SheetTitle>项目资料</SheetTitle>
                    <SheetDescription className="break-words">{projectName} · Agent 可根据问题查阅这里已处理完成的资料。</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                    <form
                        className="grid gap-3 border-b border-border pb-5"
                        onSubmit={event => {
                            event.preventDefault()
                            void uploadFile()
                        }}
                    >
                        <Label htmlFor="project-file-upload">上传资料</Label>
                        <Input
                            ref={uploadInput}
                            id="project-file-upload"
                            type="file"
                            accept=".txt,.md,.pdf,.docx"
                            disabled={uploading}
                            onChange={event => {
                                setFile(event.target.files?.[0] ?? null)
                                setUploadError('')
                                setUploaded('')
                            }}
                        />
                        <p className="text-xs text-muted-foreground">TXT、MD、PDF 或 DOCX，单个文件不超过 10 MiB。</p>
                        <Button type="submit" disabled={!file || uploading} className="justify-self-start">
                            {uploading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                            {uploading ? '正在上传…' : uploadError ? '重试上传' : '上传资料'}
                        </Button>
                        {uploadError && <FeedbackMessage variant="error">{uploadError}</FeedbackMessage>}
                        {uploaded && <FeedbackMessage variant="success">{uploaded}</FeedbackMessage>}
                    </form>
                    <div className="flex items-center justify-between gap-2 py-3">
                        <h3 className="font-medium">资料列表{documents ? ` · ${documents.total}` : ''}</h3>
                        <Button variant="ghost" size="sm" onClick={() => setReload(value => value + 1)} disabled={loading}>
                            刷新
                        </Button>
                    </div>
                    {loading && (
                        <p role="status" className="text-sm text-muted-foreground">
                            正在载入资料…
                        </p>
                    )}
                    {error && (
                        <FeedbackMessage variant="error">
                            {error}
                            <Button variant="link" size="sm" onClick={() => setReload(value => value + 1)}>
                                重新载入
                            </Button>
                        </FeedbackMessage>
                    )}
                    {!loading && !error && !documents?.documents.length && (
                        <p className="text-sm text-muted-foreground">还没有项目资料，可以先上传一份文件。</p>
                    )}
                    {!loading &&
                        !error &&
                        documents?.documents.map(document => (
                            <div key={document.id} className="grid gap-2 border-b border-border py-3">
                                <div className="flex min-w-0 items-start gap-2">
                                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <span className="min-w-0 break-words font-medium">{document.fileName}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                        variant={
                                            document.status === 'failed'
                                                ? 'destructive'
                                                : document.status === 'ready'
                                                  ? 'success'
                                                  : 'secondary'
                                        }
                                    >
                                        {statusLabels[document.status]}
                                    </Badge>
                                    {document.status === 'ready' && (
                                        <Link
                                            href={`/rag/${encodeURIComponent(document.id)}?${new URLSearchParams({ projectFolderId })}`}
                                            className="text-sm underline underline-offset-4"
                                            onClick={() => onOpenChange(false)}
                                        >
                                            查看资料
                                        </Link>
                                    )}
                                </div>
                                {document.error && <p className="text-xs text-destructive">{document.error}</p>}
                            </div>
                        ))}
                    {documents && documents.total > 20 && (
                        <div className="mt-4 flex items-center justify-between gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={loading || page === 1}
                                onClick={() => setPage(value => value - 1)}
                            >
                                上一页
                            </Button>
                            <span className="text-xs text-muted-foreground">第 {page} 页</span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={loading || page * 20 >= documents.total}
                                onClick={() => setPage(value => value + 1)}
                            >
                                下一页
                            </Button>
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}
