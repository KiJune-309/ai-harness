'use client'

import { ArrowRight, BookOpen, Plus, RotateCcw, Save } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { skillInputSchema, type SkillInput, type SkillRecord, type SkillSummary, type SkillVersionSummary } from '@ai-harness/contracts'
import { createSkill, getSkill, listSkills, listSkillVersions, updateSkill } from '../lib/skill-client'
import { FeedbackMessage } from './ui/feedback-message'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from './ui/alert-dialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { EmptyState } from './ui/empty-state'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { SearchInput } from './ui/search-input'
import { Textarea } from './ui/textarea'

const emptySkill: SkillInput = { title: '', description: '', content: '' }
const literalText = 'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]'

/**
 * Formats a saved skill timestamp in the user's local time.
 * @param value - Validated ISO server timestamp.
 * @returns Readable date and time.
 */
function time(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

/**
 * Converts a typed request failure into visible feedback.
 * @param cause - API, validation, or connection failure.
 * @returns A safe explanation that does not erase the draft.
 */
function message(cause: unknown): string {
    return cause instanceof Error ? cause.message : '技能服务暂不可用，请保留输入后重试。'
}

/**
 * Copies only editable literal text from a confirmed record.
 * @param record - Server-confirmed current or historical version.
 * @returns A separate editable value without metadata.
 */
function inputOf(record: SkillRecord): SkillInput {
    return { title: record.title, description: record.description, content: record.content }
}

/**
 * Renders full immutable text without evaluating Markdown, HTML, links, or code.
 * @param props - Exact authorized skill version.
 * @returns Complete version metadata and literal source text.
 */
export function SkillFullText({ skill }: { skill: SkillRecord | (SkillInput & { skillId: string; version: number }) }) {
    const id = 'id' in skill ? skill.id : skill.skillId
    return (
        <div className="grid min-w-0 gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 font-medium [overflow-wrap:anywhere]">{skill.title}</h3>
                <Badge variant="secondary">v{skill.version}</Badge>
                <span className="text-xs text-muted-foreground">{id.slice(0, 8)}</span>
            </div>
            <p className={literalText}>{skill.description || '未填写说明'}</p>
            {'updatedAt' in skill && <p className="text-xs text-muted-foreground">{time(skill.updatedAt)}</p>}
            <pre className={`${literalText} rounded-lg border bg-muted p-4 font-mono text-sm`}>{skill.content}</pre>
        </div>
    )
}

/**
 * Renders shared text fields with precise inline error associations.
 * @param props - Current draft, disabled state, and explicit human field updates.
 * @returns Title, optional description, and literal Markdown controls.
 */
function SkillFields({
    value,
    errors,
    disabled,
    onChange,
}: {
    value: SkillInput
    errors: Record<string, string>
    disabled: boolean
    onChange(value: SkillInput): void
}) {
    return (
        <fieldset disabled={disabled} className="grid min-w-0 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="skill-title">技能标题</Label>
                <Input
                    id="skill-title"
                    value={value.title}
                    aria-invalid={Boolean(errors.title)}
                    aria-describedby={errors.title ? 'skill-title-error' : undefined}
                    onChange={event => onChange({ ...value, title: event.target.value })}
                />
                {errors.title && (
                    <p id="skill-title-error" className="text-sm text-error-foreground">
                        {errors.title}
                    </p>
                )}
            </div>
            <div className="grid gap-2">
                <Label htmlFor="skill-description">说明（可选）</Label>
                <Textarea
                    id="skill-description"
                    rows={3}
                    value={value.description}
                    aria-invalid={Boolean(errors.description)}
                    aria-describedby={errors.description ? 'skill-description-error' : undefined}
                    onChange={event => onChange({ ...value, description: event.target.value })}
                />
                {errors.description && (
                    <p id="skill-description-error" className="text-sm text-error-foreground">
                        {errors.description}
                    </p>
                )}
            </div>
            <div className="grid min-w-0 gap-2">
                <div className="flex flex-wrap justify-between gap-2">
                    <Label htmlFor="skill-content">Markdown 正文</Label>
                    <span className="text-xs text-muted-foreground">{value.content.length.toLocaleString()} / 16,000</span>
                </div>
                <Textarea
                    id="skill-content"
                    rows={12}
                    className="min-h-48 font-mono"
                    value={value.content}
                    aria-invalid={Boolean(errors.content)}
                    aria-describedby={errors.content ? 'skill-content-hint skill-content-error' : 'skill-content-hint'}
                    onChange={event => onChange({ ...value, content: event.target.value })}
                />
                <p id="skill-content-hint" className="text-xs text-muted-foreground">
                    保存原始文本和换行。技能提供工作方法，不增加工具或发送权限。
                </p>
                {errors.content && (
                    <p id="skill-content-error" className="text-sm text-error-foreground">
                        {errors.content}
                    </p>
                )}
            </div>
        </fieldset>
    )
}

/**
 * Isolates each stable private skill route from other local draft lifetimes.
 * @param props - Optional stable detail identity.
 * @returns The collection or exact owned record editor.
 */
export function SkillWorkspace({ skillId }: { skillId?: string }) {
    return skillId ? <SkillDetail key={skillId} skillId={skillId} /> : <SkillList />
}

/**
 * Renders the real private library and a guarded creation dialog.
 * @returns Searchable summaries, honest load states, and human creation controls.
 */
function SkillList() {
    const router = useRouter()
    const [skills, setSkills] = useState<SkillSummary[] | null>(null)
    const [loadError, setLoadError] = useState('')
    const [revision, setRevision] = useState(0)
    const [query, setQuery] = useState('')
    const [open, setOpen] = useState(false)
    const [discard, setDiscard] = useState(false)
    const [draft, setDraft] = useState<SkillInput>(emptySkill)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [saveError, setSaveError] = useState('')
    const [saving, setSaving] = useState(false)
    const lock = useRef(false)
    const alive = useRef(true)
    const form = useRef<HTMLFormElement>(null)
    const action = useRef<{ fingerprint: string; id: string } | null>(null)
    const dirty = JSON.stringify(draft) !== JSON.stringify(emptySkill)
    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
        }
    }, [])
    useEffect(() => {
        const controller = new AbortController()
        void listSkills(controller.signal)
            .then(result => {
                if (!controller.signal.aborted) {
                    setSkills(result)
                    setLoadError('')
                }
            })
            .catch(cause => {
                if (!controller.signal.aborted) setLoadError(message(cause))
            })
        return () => controller.abort()
    }, [revision])
    useEffect(() => {
        /**
         * Protects a human creation draft on a document navigation.
         * @param event - Browser navigation event.
         * @returns Nothing; the browser asks before leaving an unsaved draft.
         */
        function protect(event: BeforeUnloadEvent) {
            if (open && dirty) event.preventDefault()
        }
        window.addEventListener('beforeunload', protect)
        return () => window.removeEventListener('beforeunload', protect)
    }, [open, dirty])
    /**
     * Opens an independent blank creation action.
     * @returns Nothing; focuses the title through the dialog's default focus.
     */
    function create() {
        setDraft(emptySkill)
        setErrors({})
        setSaveError('')
        action.current = null
        setOpen(true)
    }
    /**
     * Protects a changed dialog before dismissal.
     * @param next - Requested dialog open state.
     * @returns Nothing; retains the draft until an explicit discard.
     */
    function close(next: boolean) {
        if (lock.current) return
        if (!next && dirty) setDiscard(true)
        else setOpen(next)
    }
    /**
     * Creates exactly the reviewed text with safe same-action retries.
     * @param event - Human form submission.
     * @returns After confirmed persistence or visible feedback preserving input.
     */
    async function save(event: FormEvent) {
        event.preventDefault()
        if (lock.current) return
        const parsed = skillInputSchema.safeParse(draft)
        if (!parsed.success) {
            const next: Record<string, string> = {}
            for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message
            setErrors(next)
            form.current?.querySelector<HTMLElement>(`#skill-${Object.keys(next)[0]}`)?.focus()
            return
        }
        const fingerprint = JSON.stringify(parsed.data)
        if (action.current?.fingerprint !== fingerprint) action.current = { fingerprint, id: crypto.randomUUID() }
        lock.current = true
        setSaving(true)
        setErrors({})
        setSaveError('')
        try {
            const saved = await createSkill({ ...parsed.data, requestId: action.current.id })
            if (alive.current) {
                setOpen(false)
                setDraft(emptySkill)
                router.push(`/skills/${saved.id}`)
            }
        } catch (cause) {
            if (alive.current) setSaveError(message(cause))
        } finally {
            lock.current = false
            if (alive.current) setSaving(false)
        }
    }
    const filtered = (skills ?? [])
        .filter(skill => `${skill.title} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    return (
        <main className="workspace-page flex flex-col gap-6">
            <header className="workspace-page-header flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1>Skills</h1>
                    <p className="mt-2 text-sm text-muted-foreground">保存可复用的工作方法，再在 Agent 中选择具体版本。</p>
                </div>
                <Button onClick={create}>
                    <Plus aria-hidden="true" />
                    新建技能
                </Button>
            </header>
            <div className="workspace-toolbar flex flex-wrap items-center gap-3 border-b pb-4">
                <SearchInput
                    containerClassName="w-full sm:max-w-sm"
                    aria-label="搜索技能"
                    placeholder="搜索标题或说明"
                    value={query}
                    onValueChange={setQuery}
                />
                <span className="text-sm text-muted-foreground">{skills === null ? '尚未载入' : `${skills.length} 个技能`}</span>
                <Button variant="outline" onClick={() => setRevision(value => value + 1)}>
                    <RotateCcw aria-hidden="true" />
                    刷新
                </Button>
            </div>
            {loadError ? (
                <FeedbackMessage variant="error">{loadError}</FeedbackMessage>
            ) : skills === null ? (
                <FeedbackMessage variant="loading" role="status">
                    正在载入技能…
                </FeedbackMessage>
            ) : filtered.length ? (
                <ul className="grid min-w-0 divide-y" aria-label="技能列表">
                    {filtered.map(skill => (
                        <li key={skill.id} className="min-w-0">
                            <Link
                                href={`/skills/${skill.id}`}
                                aria-label={skill.title}
                                className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 rounded-lg px-2 py-4 outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:px-4"
                            >
                                <BookOpen className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
                                <div className="grid min-w-0 gap-1">
                                    <h2 className="text-sm font-medium [overflow-wrap:anywhere]">{skill.title}</h2>
                                    <p className="line-clamp-2 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                                        {skill.description || '未填写说明'}
                                    </p>
                                    <span className="text-xs text-muted-foreground">{skill.id.slice(0, 8)}</span>
                                </div>
                                <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground sm:col-start-auto sm:justify-end">
                                    <Badge variant="secondary">v{skill.version}</Badge>
                                    <time dateTime={skill.updatedAt}>{time(skill.updatedAt)}</time>
                                    <ArrowRight className="ml-1 size-4" aria-hidden="true" />
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <EmptyState
                    icon={<BookOpen />}
                    title={skills.length ? '没有匹配的技能' : '还没有技能'}
                    description={skills.length ? '换个标题或说明关键词试试。' : '将常用检查清单、输出规范或工作方法保存为技能。'}
                />
            )}
            <Dialog open={open} onOpenChange={close}>
                <DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>新建技能</DialogTitle>
                        <DialogDescription>仅本人在当前工作空间可见。保存后在 Agent 中选择具体版本。</DialogDescription>
                    </DialogHeader>
                    <form ref={form} onSubmit={save} className="grid min-w-0 gap-4" aria-busy={saving}>
                        <SkillFields
                            value={draft}
                            errors={errors}
                            disabled={saving}
                            onChange={value => {
                                setDraft(value)
                                setErrors({})
                                setSaveError('')
                            }}
                        />
                        {saveError && <FeedbackMessage variant="error">{saveError}</FeedbackMessage>}
                        <DialogFooter>
                            <Button type="button" variant="outline" disabled={saving} onClick={() => close(false)}>
                                取消
                            </Button>
                            <Button type="submit" disabled={saving}>
                                {saving ? '正在保存…' : '保存技能'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <AlertDialog open={discard} onOpenChange={setDiscard}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>放弃未保存的技能？</AlertDialogTitle>
                        <AlertDialogDescription>关闭后会丢失本次输入，已保存的技能不受影响。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>继续编辑</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setDiscard(false)
                                setOpen(false)
                                setDraft(emptySkill)
                            }}
                        >
                            放弃修改
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </main>
    )
}

/**
 * Edits a stable record while retaining local text across version conflicts and rereads.
 * @param props - Owned skill route identity.
 * @returns Full literal text, explicit conflict reconciliation, and immutable history.
 */
function SkillDetail({ skillId }: { skillId: string }) {
    const router = useRouter()
    const [saved, setSaved] = useState<SkillRecord | null>(null)
    const [draft, setDraft] = useState<SkillInput>(emptySkill)
    const [history, setHistory] = useState<SkillVersionSummary[] | null>(null)
    const [historyError, setHistoryError] = useState('')
    const [versionView, setVersionView] = useState<SkillRecord | null>(null)
    const [viewError, setViewError] = useState('')
    const [viewOpen, setViewOpen] = useState(false)
    const [loadError, setLoadError] = useState('')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [conflict, setConflict] = useState(false)
    const [latest, setLatest] = useState<SkillRecord | null>(null)
    const [discard, setDiscard] = useState(false)
    const [busy, setBusy] = useState(false)
    const [revision, setRevision] = useState(0)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const lock = useRef(false)
    const alive = useRef(true)
    const action = useRef<{ fingerprint: string; id: string } | null>(null)
    const historyHeading = useRef<HTMLHeadingElement>(null)
    const comparisonHeading = useRef<HTMLHeadingElement>(null)
    const viewRequest = useRef(0)
    const discardDestination = useRef<string | null>(null)
    const form = useRef<HTMLFormElement>(null)
    const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(inputOf(saved))
    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
        }
    }, [])
    useEffect(() => {
        const controller = new AbortController()
        void getSkill(skillId, undefined, controller.signal)
            .then(record => {
                if (record.id !== skillId) throw new Error('返回的技能与当前地址不匹配。')
                if (!controller.signal.aborted) {
                    setSaved(record)
                    setDraft(inputOf(record))
                    setLoadError('')
                }
            })
            .catch(cause => {
                if (!controller.signal.aborted) setLoadError(message(cause))
            })
        return () => controller.abort()
    }, [skillId, revision])
    useEffect(() => {
        const controller = new AbortController()
        void listSkillVersions(skillId, controller.signal)
            .then(records => {
                if (!controller.signal.aborted) {
                    setHistory(records)
                    setHistoryError('')
                }
            })
            .catch(cause => {
                if (!controller.signal.aborted) setHistoryError(message(cause))
            })
        return () => controller.abort()
    }, [skillId, saved?.version])
    useEffect(() => {
        /**
         * Guards native navigation without writing or discarding the local text.
         * @param event - Native document navigation.
         * @returns Nothing; delegates the dirty decision to the browser.
         */
        function protect(event: BeforeUnloadEvent) {
            if (dirty) event.preventDefault()
        }
        window.addEventListener('beforeunload', protect)
        return () => window.removeEventListener('beforeunload', protect)
    }, [dirty])
    useEffect(() => {
        /**
         * Protects unsaved text when an ordinary same-origin application link is activated.
         * @param event - Native anchor activation, including keyboard-generated clicks.
         * @returns Nothing; preserves modified-click, download, and external navigation semantics.
         */
        function protectLink(event: MouseEvent) {
            if (!dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return
            const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
            if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
            const destination = new URL(anchor.href, window.location.href)
            if (
                destination.origin !== window.location.origin ||
                destination.protocol !== window.location.protocol ||
                (destination.pathname === window.location.pathname && destination.search === window.location.search)
            )
                return
            event.preventDefault()
            if (lock.current) return
            discardDestination.current = `${destination.pathname}${destination.search}${destination.hash}`
            setDiscard(true)
        }
        document.addEventListener('click', protectLink, true)
        return () => document.removeEventListener('click', protectLink, true)
    }, [dirty])
    /**
     * Saves a new immutable version only after validation and human submission.
     * @param event - Explicit form submission.
     * @returns After a confirmed write or error preserving every field.
     */
    async function save(event: FormEvent) {
        event.preventDefault()
        if (!saved || lock.current || conflict) return
        const parsed = skillInputSchema.safeParse(draft)
        if (!parsed.success) {
            const next: Record<string, string> = {}
            for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message
            setErrors(next)
            form.current?.querySelector<HTMLElement>(`#skill-${Object.keys(next)[0]}`)?.focus()
            return
        }
        const fingerprint = JSON.stringify({ ...parsed.data, version: saved.version })
        if (action.current?.fingerprint !== fingerprint) action.current = { fingerprint, id: crypto.randomUUID() }
        lock.current = true
        setBusy(true)
        setError('')
        setNotice('')
        try {
            const record = await updateSkill(skillId, { ...parsed.data, version: saved.version, requestId: action.current.id })
            if (record.id !== skillId) throw new Error('返回的技能与当前地址不匹配，输入已保留。')
            if (alive.current) {
                setSaved(record)
                setDraft(inputOf(record))
                setErrors({})
                setNotice(`已保存 v${record.version}`)
                action.current = null
            }
        } catch (cause) {
            if (alive.current) {
                setError(message(cause))
                setConflict(Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409))
            }
        } finally {
            lock.current = false
            if (alive.current) setBusy(false)
        }
    }
    /**
     * Explicitly reads the latest version for comparison without replacing local text.
     * @returns After the latest full server version is displayed or a visible read failure.
     */
    async function reread() {
        if (lock.current) return
        lock.current = true
        setBusy(true)
        try {
            const record = await getSkill(skillId)
            if (record.id !== skillId) throw new Error('返回的技能与当前地址不匹配。')
            if (alive.current) setLatest(record)
        } catch (cause) {
            if (alive.current) setError(message(cause))
        } finally {
            lock.current = false
            if (alive.current) setBusy(false)
        }
    }
    /**
     * Reads one exact immutable historical version for a separate full-text dialog.
     * @param version - Version chosen from the server history.
     * @returns After exact content is visible or an honest error.
     */
    async function inspect(version: number) {
        const request = ++viewRequest.current
        setVersionView(null)
        setViewError('')
        setViewOpen(true)
        try {
            const record = await getSkill(skillId, version)
            if (record.id !== skillId || record.version !== version) throw new Error('技能版本返回不匹配，请重试。')
            if (alive.current && request === viewRequest.current) setVersionView(record)
        } catch (cause) {
            if (alive.current && request === viewRequest.current) setViewError(message(cause))
        }
    }
    if (!saved)
        return (
            <main className="workspace-page grid gap-4">
                {loadError ? (
                    <>
                        <FeedbackMessage variant="error">{loadError}</FeedbackMessage>
                        <Button onClick={() => setRevision(value => value + 1)}>重新载入</Button>
                    </>
                ) : (
                    <FeedbackMessage variant="loading" role="status">
                        正在载入技能…
                    </FeedbackMessage>
                )}
            </main>
        )
    return (
        <main className="workspace-page grid gap-6">
            <header className="workspace-page-header grid min-w-0 gap-3">
                <Link href="/skills" className="text-sm text-muted-foreground">
                    返回 Skills
                </Link>
                <h1 className="[overflow-wrap:anywhere]">{saved.title}</h1>
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary">v{saved.version}</Badge>
                    {saved.id.slice(0, 8)} · {time(saved.updatedAt)}
                </p>
                <p className="text-sm text-muted-foreground">每次保存生成新版本。Agent 的既有绑定与对话不会自动升级。</p>
            </header>
            <form ref={form} onSubmit={save} className="grid min-w-0 max-w-4xl gap-6 border-t pt-6" aria-busy={busy}>
                <section className="grid min-w-0 gap-4" aria-labelledby="skill-content-title">
                    <h2 id="skill-content-title" className="text-[15px] font-semibold">
                        技能内容
                    </h2>
                    <div>
                        <SkillFields
                            value={draft}
                            errors={errors}
                            disabled={busy}
                            onChange={value => {
                                setDraft(value)
                                setErrors({})
                                setNotice('')
                            }}
                        />
                    </div>
                </section>
                {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
                {notice && (
                    <FeedbackMessage variant={notice.startsWith('已保存') ? 'success' : 'info'} role="status">
                        {notice}
                    </FeedbackMessage>
                )}
                {conflict && (
                    <FeedbackMessage variant="warning">
                        <p>本地输入已保留。请先重读最新版本并核对，再明确保存。</p>
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void reread()}>
                            重读最新版本
                        </Button>
                    </FeedbackMessage>
                )}
                <div className="flex flex-wrap justify-end gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !dirty}
                        onClick={() => {
                            discardDestination.current = null
                            setDiscard(true)
                        }}
                    >
                        取消修改
                    </Button>
                    <Button type="submit" disabled={busy || !dirty || conflict}>
                        <Save aria-hidden="true" />
                        {busy ? '正在保存…' : '保存新版本'}
                    </Button>
                </div>
            </form>
            <section className="grid min-w-0 max-w-4xl gap-4 border-t pt-6" aria-labelledby="skill-history-title">
                <h2 id="skill-history-title" className="text-[15px] font-semibold">
                    版本记录
                </h2>
                <div className="grid min-w-0 divide-y">
                    {historyError ? (
                        <FeedbackMessage variant="error">{historyError}</FeedbackMessage>
                    ) : history === null ? (
                        <FeedbackMessage variant="loading" role="status">
                            正在载入版本…
                        </FeedbackMessage>
                    ) : (
                        history
                            .toSorted((a, b) => b.version - a.version)
                            .map(version => (
                                <div key={version.version} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="[overflow-wrap:anywhere]">
                                            v{version.version} · {version.title}
                                        </p>
                                        <time className="text-xs text-muted-foreground" dateTime={version.updatedAt}>
                                            {time(version.updatedAt)}
                                        </time>
                                    </div>
                                    <Button variant="outline" onClick={() => void inspect(version.version)}>
                                        查看 v{version.version}
                                    </Button>
                                </div>
                            ))
                    )}
                </div>
            </section>
            <Dialog open={viewOpen} onOpenChange={setViewOpen}>
                <DialogContent initialFocus={historyHeading} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle ref={historyHeading} tabIndex={-1}>
                            技能版本全文
                        </DialogTitle>
                        <DialogDescription>历史版本只读，正文按原始文本显示。</DialogDescription>
                    </DialogHeader>
                    {viewError ? (
                        <FeedbackMessage variant="error">{viewError}</FeedbackMessage>
                    ) : versionView ? (
                        <SkillFullText skill={versionView} />
                    ) : (
                        <FeedbackMessage variant="loading" role="status">
                            正在载入全文…
                        </FeedbackMessage>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setViewOpen(false)}>
                            关闭
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={latest !== null}
                onOpenChange={next => {
                    if (!next) setLatest(null)
                }}
            >
                <DialogContent initialFocus={comparisonHeading} className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle ref={comparisonHeading} tabIndex={-1}>
                            核对最新版本与本地输入
                        </DialogTitle>
                        <DialogDescription>重读不会覆盖本地文本。选择保留本地后，需再次点击保存新版本。</DialogDescription>
                    </DialogHeader>
                    {latest && (
                        <>
                            <section className="grid min-w-0 gap-3">
                                <h2 className="font-semibold">服务器最新版本</h2>
                                <SkillFullText skill={latest} />
                            </section>
                            <section className="grid min-w-0 gap-3">
                                <h2 className="font-semibold">本地未保存输入</h2>
                                <SkillFullText skill={{ ...draft, skillId, version: saved.version }} />
                            </section>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setLatest(null)}>
                                    继续核对
                                </Button>
                                <Button
                                    onClick={() => {
                                        setSaved(latest)
                                        setLatest(null)
                                        setConflict(false)
                                        setError('')
                                        setNotice('已采用最新版本作为保存基准，本地输入保留，请核对后再次保存。')
                                        action.current = null
                                    }}
                                >
                                    保留本地并采用最新基准
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            <AlertDialog open={discard} onOpenChange={setDiscard}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
                        <AlertDialogDescription>本地输入将恢复为已读取的版本。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>继续编辑</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setDraft(inputOf(saved))
                                setConflict(false)
                                setError('')
                                setDiscard(false)
                                if (discardDestination.current) router.push(discardDestination.current)
                            }}
                        >
                            放弃修改
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </main>
    )
}
