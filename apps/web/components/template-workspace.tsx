'use client'

import { ArrowRight, ClipboardList, Layers, Plus, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { TemplateCatalogEntry, WorkflowTemplate } from '@ai-harness/contracts'
import { getTemplateCatalogEntry, listTemplateCatalog } from '../lib/workflow-template-client'
import { WorkflowTemplateEditor } from './workflow-template'
import styles from './template-workspace.styles'
import { FeedbackMessage } from './ui/feedback-message'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { SearchInput } from './ui/search-input'

/**
 * Converts an unknown template read failure into safe visible feedback.
 * @param error - Failure thrown by the typed catalog client.
 * @returns A useful public message without credentials or transport internals.
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '模板服务暂时无法连接，请重试。'
}

/**
 * Formats a persisted workflow timestamp without implying a local draft was saved.
 * @param value - Validated server ISO timestamp.
 * @returns A concise localized date and time.
 */
function updatedLabel(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(
        new Date(value)
    )
}

/**
 * Opens the workflow-only catalog, a fresh workflow, or an explicitly discovered saved kind.
 * @param props - Existing editor mode and optional stable saved identity.
 * @returns Collaborative workflow management without a personal-list creation or launch path.
 */
export function TemplateWorkspace({ editing = false, templateId }: { editing?: boolean; templateId?: string }) {
    if (!editing) return <TemplateList />
    return templateId ? <CatalogEditor key={templateId} templateId={templateId} /> : <WorkflowTemplateEditor />
}

/**
 * Discovers a stable record's true server kind without interpreting errors as a different kind.
 * @param props - Stable template route identity.
 * @returns The authorized workflow editor, a legacy explanation, or a truthful load failure.
 */
function CatalogEditor({ templateId }: { templateId: string }) {
    const [entry, setEntry] = useState<TemplateCatalogEntry | null>(null)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        void getTemplateCatalogEntry(templateId, controller.signal)
            .then(saved => {
                if (saved.template.id.toLowerCase() !== templateId.toLowerCase())
                    throw new Error('返回的模板与当前地址不匹配，请重新载入。')
                if (!controller.signal.aborted) {
                    setEntry(saved)
                    setError('')
                }
            })
            .catch(cause => {
                if (!controller.signal.aborted) setError(errorMessage(cause))
            })
        return () => controller.abort()
    }, [templateId, revision])
    if (!entry || error) return <LoadFeedback error={error} onRetry={() => setRevision(value => value + 1)} />
    if (entry.kind === 'workflow') return <WorkflowTemplateEditor initialTemplate={entry.template} />
    return (
        <section className="workspace-page grid min-w-0 gap-5">
            <Badge variant="secondary">旧个人清单</Badge>
            <header className="workspace-page-header">
                <h1>此模板为旧个人清单</h1>
                <p className="mt-2 text-sm text-muted-foreground">当前任务模板仅支持协作流程，历史个人模板数据已保留。</p>
            </header>
            <div>
                <Button variant="outline" nativeButton={false} render={<Link href="/templates" />}>
                    返回任务模板
                    <ArrowRight aria-hidden="true" />
                </Button>
            </div>
        </section>
    )
}

/**
 * Distinguishes loading and failed catalog reads without a false empty workflow collection.
 * @param props - Current error and explicit retry callback.
 * @returns Accessible feedback with safe navigation back to the workflow catalog.
 */
function LoadFeedback({ error, onRetry }: { error: string; onRetry(): void }) {
    return (
        <div className={styles.feedback}>
            <FeedbackMessage variant={error ? 'error' : 'loading'} role={error ? 'alert' : 'status'}>
                {error || '正在读取当前工作空间的协作流程模板。'}
            </FeedbackMessage>
            {error && (
                <>
                    <Button type="button" variant="outline" onClick={onRetry}>
                        <RotateCcw size={15} aria-hidden="true" />
                        重新载入
                    </Button>
                    <Button variant="link" nativeButton={false} render={<Link href="/templates" />}>
                        返回任务模板
                        <ArrowRight size={14} aria-hidden="true" />
                    </Button>
                </>
            )}
        </div>
    )
}

/**
 * Lists only real collaborative workflows while leaving historical personal records untouched.
 * @returns Searchable stable workflow cards with accurate workflow counts and load states.
 */
function TemplateList() {
    const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [failure, setFailure] = useState('')
    const [reload, setReload] = useState(0)
    const [query, setQuery] = useState('')
    const search = query.trim().toLocaleLowerCase()
    const visible = templates.filter(template => `${template.name} ${template.description}`.toLocaleLowerCase().includes(search))
    useEffect(() => {
        const controller = new AbortController()
        void listTemplateCatalog(controller.signal)
            .then(items => {
                if (controller.signal.aborted) return
                setTemplates(
                    items
                        .flatMap(entry => (entry.kind === 'workflow' ? [entry.template] : []))
                        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
                )
                setFailure('')
            })
            .catch(cause => {
                if (!controller.signal.aborted) setFailure(errorMessage(cause))
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })
        return () => controller.abort()
    }, [reload])
    /**
     * Explicitly reloads the authorized catalog without exposing hidden historical kinds.
     * @returns Nothing; shows a real loading state until the read settles.
     */
    function refresh() {
        setLoading(true)
        setFailure('')
        setReload(value => value + 1)
    }
    if (loading || failure) return <LoadFeedback error={failure} onRetry={refresh} />
    return (
        <section className={styles.page}>
            <header className={styles.heading}>
                <div>
                    <h1>任务模板</h1>
                    <p>维护已保存的流程定义；旧版项目流程已停用，暂不支持启动。</p>
                </div>
                <Button nativeButton={false} render={<Link href="/templates/new" />}>
                    <Plus size={16} aria-hidden="true" />
                    新建模板
                </Button>
            </header>
            <div className={styles.toolbar}>
                <span>{templates.length} 个模板</span>
                <SearchInput
                    containerClassName={styles.search}
                    aria-label="搜索模板名称或说明"
                    value={query}
                    placeholder="搜索名称或说明"
                    onValueChange={setQuery}
                />
                <Button type="button" variant="ghost" size="icon" aria-label="刷新模板列表" title="刷新模板列表" onClick={refresh}>
                    <RotateCcw size={16} aria-hidden="true" />
                </Button>
            </div>
            {visible.length === 0 ? (
                <div className={styles.empty}>
                    <ClipboardList size={32} strokeWidth={1.4} aria-hidden="true" />
                    <h2>{search ? '没有找到相关模板' : '创建第一份协作流程'}</h2>
                    <p>{search ? '可使用名称和说明中的其他关键词。' : '设置节点、处理人和上下游关系，保存你的流程定义。'}</p>
                    {search ? (
                        <Button type="button" variant="outline" onClick={() => setQuery('')}>
                            清空搜索
                        </Button>
                    ) : (
                        <Button variant="outline" nativeButton={false} render={<Link href="/templates/new" />}>
                            <Plus size={15} aria-hidden="true" />
                            创建第一个模板
                        </Button>
                    )}
                </div>
            ) : (
                <div className={styles.templateGrid}>
                    {visible.map(template => (
                        <Card
                            key={template.id}
                            className="workspace-item rounded-none border-0 border-b bg-transparent py-5 shadow-none transition-colors duration-(--motion-fast) ease-(--motion-ease) hover:bg-muted/35 motion-reduce:transition-none"
                        >
                            <CardContent className="px-0">
                                <Link href={`/templates/${encodeURIComponent(template.id)}`} className={styles.templateCard}>
                                    <div className={styles.cardTop}>
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                            <Layers size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                            <h2>{template.name}</h2>
                                            <Badge variant="secondary">v{template.version}</Badge>
                                        </div>
                                        <Badge variant="outline">协作流程</Badge>
                                    </div>
                                    <p className="line-clamp-2">{template.description || '打开模板，查看完整节点、处理人与上下游。'}</p>
                                    <div className={styles.cardMeta}>
                                        <span>
                                            {template.nodes.length} 个节点 · 编号 {template.id.slice(0, 8)}
                                        </span>
                                        <time dateTime={template.updatedAt}>{updatedLabel(template.updatedAt)}</time>
                                    </div>
                                    <span className={styles.openTemplate}>
                                        编辑模板
                                        <ArrowRight size={14} aria-hidden="true" />
                                    </span>
                                </Link>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </section>
    )
}
