'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { projectInputSchema, type CollaborationPerson, type CollaborationProject } from '@ai-harness/contracts'
import {
    getCollaborationProject,
    searchCollaborationPeople,
    sendCollaborationCommand,
    CollaborationRequestError,
} from '../lib/collaboration-client'
import { useAccount } from './account-context'
import { ProjectBoardView } from './project-board'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { ProjectProgressView, ProjectStartDialog, projectTemplateOrigins, useProjectProgress } from './project-progress'
import { FeedbackMessage } from './ui/feedback-message'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from './ui/alert-dialog'
import { Input } from './ui/input'
import { SearchInput } from './ui/search-input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

/**
 * Extracts safe public request feedback without displaying transport details.
 * @param cause - Request or contract failure.
 * @returns A useful public error message.
 */
function failure(cause: unknown): string {
    return cause instanceof Error ? cause.message : '操作未完成，请保留当前输入后重试。'
}

/**
 * Chooses actual current-workspace colleagues with stable identifiers and cancellable search.
 * @param props - Selected colleagues, excluded identities, input identity, and form state.
 * @returns A keyboard-accessible bounded member picker with explicit identity previews.
 */
export function ProjectMemberPicker({
    selected,
    onChange,
    exclude = [],
    disabled = false,
    id = 'project-members',
}: {
    selected: CollaborationPerson[]
    onChange: (people: CollaborationPerson[]) => void
    exclude?: string[]
    disabled?: boolean
    id?: string
}) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<{ query: string; people: CollaborationPerson[] } | null>(null)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)
    const normalized = query.trim()
    useEffect(() => {
        if (!normalized || disabled) return
        const controller = new AbortController()
        const timer = setTimeout(() => {
            void searchCollaborationPeople(normalized, controller.signal)
                .then(people => {
                    if (!controller.signal.aborted) {
                        setResults({ query: normalized, people })
                        setError('')
                    }
                })
                .catch(cause => {
                    if (!controller.signal.aborted) setError(failure(cause))
                })
        }, 200)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [normalized, revision, disabled])
    const visible = results?.query === normalized ? results.people.filter(person => !exclude.includes(person.id)) : null
    return (
        <div className="grid min-w-0 gap-3">
            <div className="grid gap-2">
                <Label htmlFor={id}>搜索当前工作空间的同事</Label>
                <SearchInput
                    id={id}
                    value={query}
                    onValueChange={value => {
                        setQuery(value)
                        setError('')
                    }}
                    disabled={disabled}
                    placeholder="输入同事姓名"
                    autoComplete="off"
                />
            </div>
            <p className="text-xs text-muted-foreground">已选择 {selected.length} / 20 位同事。创建者自动加入，不需要重复选择。</p>
            {selected.length > 0 && (
                <ul className="grid gap-2" aria-label="已选择的项目成员">
                    {selected.map(person => (
                        <li key={person.id} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
                            <span className="min-w-0 flex-1 break-words">
                                {person.name}
                                <span className="ml-2 text-xs text-muted-foreground">{person.id.slice(0, 8)}</span>
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={disabled}
                                aria-label={`取消选择 ${person.name} ${person.id.slice(0, 8)}`}
                                onClick={() => onChange(selected.filter(item => item.id !== person.id))}
                            >
                                移除
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            {error ? (
                <FeedbackMessage variant="error">
                    {error}
                    <Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>
                        重试搜索
                    </Button>
                </FeedbackMessage>
            ) : normalized && !visible ? (
                <p role="status" className="text-sm text-muted-foreground">
                    正在搜索同事…
                </p>
            ) : (
                normalized &&
                visible && (
                    <ul className="grid gap-1" aria-label="同事搜索结果">
                        {visible.length === 0 && <li className="text-sm text-muted-foreground">没有符合条件的可选同事。</li>}
                        {visible.map(person => {
                            const picked = selected.some(item => item.id === person.id)
                            return (
                                <li key={person.id}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="min-h-11 h-auto w-full justify-between whitespace-normal text-left"
                                        disabled={disabled || picked || selected.length >= 20}
                                        onClick={() => onChange([...selected, person])}
                                    >
                                        <span className="break-words">
                                            {person.name} · {person.id.slice(0, 8)}
                                        </span>
                                        <span>{picked ? '已选择' : '选择'}</span>
                                    </Button>
                                </li>
                            )
                        })}
                    </ul>
                )
            )}
        </div>
    )
}

/**
 * Formats persisted timestamps without implying an unsaved local operation succeeded.
 * @param time - Confirmed ISO timestamp.
 * @returns A readable Chinese date and time.
 */
function timeLabel(time: string): string {
    return new Date(time).toLocaleString('zh-CN')
}

/**
 * Renders only the most recent saved version of each note or legacy artifact.
 * @param records - Immutable saved version records.
 * @returns A recently updated first list of the latest version of every stable record.
 */
function latestVersions<T extends { id: string; version: number; createdAt: string; updatedAt?: string }>(records: T[]): T[] {
    const byId = new Map<string, T>()
    for (const item of records) if (!byId.has(item.id) || byId.get(item.id)!.version < item.version) byId.set(item.id, item)
    return [...byId.values()].sort(
        (left, right) =>
            (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) || left.id.localeCompare(right.id)
    )
}

/**
 * Shows project overview, real members, and manually shared material without opening private work.
 * @param props - Authorized project projection and confirmed-data reload callback.
 * @returns The collaboration project management and shared content page.
 */
export function TeamProjectOverview({ project, onSaved }: { project: CollaborationProject; onSaved: () => void }) {
    const { user, workspaceId } = useAccount()
    return <TeamProjectDetail key={`${project.id}:${user?.id ?? ''}:${workspaceId ?? ''}`} project={project} onSaved={onSaved} />
}

/**
 * Keeps shared views, private local forms, and one progress reader within the current project scope.
 * @param props - Authorized metadata and its existing explicit reload action.
 * @returns Stable overview and board panels followed by common members and shared content.
 */
function TeamProjectDetail({ project, onSaved }: { project: CollaborationProject; onSaved: () => void }) {
    const { user } = useAccount()
    const router = useRouter()
    const searchParams = useSearchParams()
    const view = searchParams.get('view') === 'board' ? 'board' : 'overview'
    const progress = useProjectProgress(project.id)
    const [starting, setStarting] = useState(false)
    const [editor, setEditor] = useState<'info' | 'members' | null>(null)
    const [noteEditor, setNoteEditor] = useState<{ noteId?: string } | null>(null)
    const [remove, setRemove] = useState<CollaborationPerson | null>(null)
    const [error, setError] = useState('')
    const [removing, setRemoving] = useState(false)
    const action = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const pending = useRef(false)
    const owner = project.ownerId === user?.id
    const members = project.members.filter(member => member.status === 'active')
    const ownerName = members.find(member => member.id === project.ownerId)?.name ?? '项目拥有者'
    const notes = latestVersions(project.notes ?? [])
    const origins = projectTemplateOrigins(project)
    const templateOrigins = Object.values(origins).filter(
        (origin, index, all) => all.findIndex(item => item.templateId === origin.templateId && item.version === origin.version) === index
    )

    /**
     * Refreshes shared metadata and the existing single progress reader together.
     * @returns Nothing; does not mutate or execute any project work.
     */
    function refreshProject() {
        onSaved()
        progress.refresh()
    }

    /**
     * Changes only the shareable presentation query while retaining local panel state.
     * @param value - Explicit overview or board tab chosen by the viewer.
     * @returns Nothing; keeps all other route parameters and avoids scrolling the page.
     */
    function selectView(value: unknown) {
        if (value !== 'overview' && value !== 'board') return
        const query = new URLSearchParams(searchParams.toString())
        if (value === 'board') query.set('view', 'board')
        else query.delete('view')
        router.replace(`/projects/${project.id}${query.size ? `?${query}` : ''}`, { scroll: false })
    }

    /**
     * Removes only the displayed member after explicit scope-aware human confirmation.
     * @returns After confirmed removal or a recoverable error; never removes the project owner.
     */
    async function confirmRemoval(): Promise<void> {
        if (!remove || pending.current) return
        const fingerprint = JSON.stringify([project.id, project.revision, remove.id])
        if (action.current?.fingerprint !== fingerprint) action.current = { fingerprint, requestId: crypto.randomUUID() }
        pending.current = true
        setRemoving(true)
        setError('')
        try {
            await sendCollaborationCommand({
                type: 'revoke',
                requestId: action.current.requestId,
                projectId: project.id,
                revision: project.revision,
                userId: remove.id,
            })
            setRemove(null)
            onSaved()
        } catch (cause) {
            setError(failure(cause))
        } finally {
            pending.current = false
            setRemoving(false)
        }
    }

    return (
        <section className="workspace-page grid min-w-0 gap-8">
            <Link href="/projects" className="text-sm underline">
                返回项目
            </Link>
            <header className="workspace-page-header">
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <h1 className="min-w-0 [overflow-wrap:anywhere]">{project.name}</h1>
                        <Badge variant="secondary">协作</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">当前工作空间 · 项目 {project.id.slice(0, 8)}</p>
                    <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere] text-muted-foreground">
                        {project.description || '暂无项目说明。'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                        拥有者：{ownerName} · {members.length} 位有效成员 · {timeLabel(project.updatedAt)} 更新
                    </p>
                    {templateOrigins.map(origin => (
                        <p
                            key={`${origin.templateId}:${origin.version}`}
                            className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
                        >
                            来源协作模板 {origin.templateId.slice(0, 8)} · v{origin.version}
                        </p>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setStarting(true)}>开始我的工作</Button>
                    {owner && (
                        <>
                            <Button variant="outline" onClick={() => setEditor('info')}>
                                编辑项目
                            </Button>
                            <Button variant="outline" onClick={() => setEditor('members')}>
                                管理成员
                            </Button>
                        </>
                    )}
                    <Button variant="outline" onClick={refreshProject}>
                        刷新项目
                    </Button>
                </div>
            </header>
            <Tabs value={view} onValueChange={selectView} className="min-w-0 gap-5">
                <TabsList variant="line" aria-label="项目视图" className="w-full justify-start border-b">
                    <TabsTrigger value="overview">概览</TabsTrigger>
                    <TabsTrigger value="board">看板</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" keepMounted className="min-w-0">
                    <ProjectProgressView progress={progress} userId={user?.id} origins={origins} />
                </TabsContent>
                <TabsContent value="board" keepMounted className="min-w-0">
                    <ProjectBoardView
                        key={progress.errorStatus !== null && [401, 403, 404].includes(progress.errorStatus) ? 'unavailable' : 'authorized'}
                        progress={progress}
                        userId={user?.id}
                        origins={origins}
                        onStart={() => setStarting(true)}
                        onRefresh={refreshProject}
                    />
                </TabsContent>
            </Tabs>
            {starting && (
                <ProjectStartDialog
                    project={project}
                    progress={progress.data}
                    userId={user?.id}
                    onClose={() => setStarting(false)}
                    onSaved={() => {
                        onSaved()
                        progress.refresh()
                    }}
                />
            )}
            <section className="workspace-section grid min-w-0 gap-4" aria-labelledby="team-project-members-title">
                <h2 id="team-project-members-title" className="text-[15px] font-semibold">
                    项目成员
                </h2>
                <p className="text-sm text-muted-foreground">仅这些有效成员可见项目共享内容，团队拥有者不会自动获得本项目权限。</p>
                <ul className="workspace-collection grid divide-y">
                    {members.map(member => (
                        <li key={member.id} className="flex min-w-0 flex-wrap items-center gap-3 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="break-words font-medium">{member.name}</p>
                                <p className="text-xs text-muted-foreground">{member.id.slice(0, 8)}</p>
                            </div>
                            <Badge variant="secondary">{member.role === 'owner' ? '拥有者' : '成员'}</Badge>
                            {owner && member.id !== project.ownerId && (
                                <Button
                                    variant="outline"
                                    aria-label={`移除项目成员 ${member.name} ${member.id.slice(0, 8)}`}
                                    onClick={() => {
                                        setError('')
                                        setRemove(member)
                                    }}
                                >
                                    移除
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            </section>
            <section className="workspace-section grid min-w-0 gap-4" aria-labelledby="team-project-content-title">
                <h2 id="team-project-content-title" className="text-[15px] font-semibold">
                    共享内容
                </h2>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">项目资料</h3>
                    <Button onClick={() => setNoteEditor({})}>发布资料</Button>
                </div>
                <p className="text-sm text-muted-foreground">
                    所有当前有效项目成员及后加入成员可见。资料不会自动进入模型上下文或触发同事的 Agent。
                </p>
                {notes.length === 0 && <p className="text-sm text-muted-foreground">尚未发布项目资料。</p>}
                {notes.map(note => (
                    <Card key={note.id} className="rounded-none border-0 border-b bg-transparent py-5 shadow-none">
                        <CardHeader className="px-0">
                            <CardTitle className="break-words">{note.title}</CardTitle>
                            <p className="text-xs text-muted-foreground">
                                {note.authorName} · v{note.version} · {timeLabel(note.updatedAt)} · {note.id.slice(0, 8)}
                            </p>
                        </CardHeader>
                        <CardContent className="grid min-w-0 gap-3 px-0">
                            <p className="whitespace-pre-wrap break-words text-sm">{note.content}</p>
                            {note.authorId === user?.id && (
                                <div>
                                    <Button variant="outline" onClick={() => setNoteEditor({ noteId: note.id })}>
                                        更新资料
                                    </Button>
                                </div>
                            )}
                            {(project.notes ?? []).filter(item => item.id === note.id).length > 1 && (
                                <Collapsible>
                                    <CollapsibleTrigger render={<Button variant="ghost" />}>查看历史版本</CollapsibleTrigger>
                                    <CollapsibleContent className="grid gap-3 pt-3">
                                        {(project.notes ?? [])
                                            .filter(item => item.id === note.id && item.version !== note.version)
                                            .sort((left, right) => right.version - left.version)
                                            .map(version => (
                                                <div key={version.version} className="grid gap-2 border-t pt-3">
                                                    <h4 className="font-medium break-words">
                                                        {version.title} · v{version.version}
                                                    </h4>
                                                    <p className="text-xs text-muted-foreground">
                                                        {version.authorName} · {timeLabel(version.updatedAt)}
                                                    </p>
                                                    <p className="whitespace-pre-wrap break-words text-sm">{version.content}</p>
                                                </div>
                                            ))}
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
                        </CardContent>
                    </Card>
                ))}
                <h3 className="mt-6 text-sm font-medium">已发布成果</h3>
                {project.artifacts.length === 0 && <p className="text-sm text-muted-foreground">尚无已发布成果。</p>}
                {latestVersions(project.artifacts).map(artifact => (
                    <Card key={artifact.id} className="rounded-none border-0 border-b bg-transparent py-5 shadow-none">
                        <CardHeader className="px-0">
                            <CardTitle className="break-words">{artifact.title}</CardTitle>
                            <p className="text-xs text-muted-foreground">
                                {project.members.find(member => member.id === artifact.authorId)?.name ??
                                    `原成员 ${artifact.authorId.slice(0, 8)}`}{' '}
                                · v{artifact.version} · {timeLabel(artifact.createdAt)}
                            </p>
                        </CardHeader>
                        <CardContent className="grid min-w-0 gap-3 px-0">
                            <p className="whitespace-pre-wrap break-words text-sm">{artifact.content}</p>
                            {project.artifacts.filter(item => item.id === artifact.id).length > 1 && (
                                <Collapsible>
                                    <CollapsibleTrigger render={<Button variant="ghost" />}>查看成果历史版本</CollapsibleTrigger>
                                    <CollapsibleContent className="grid gap-3 pt-3">
                                        {project.artifacts
                                            .filter(item => item.id === artifact.id && item.version !== artifact.version)
                                            .sort((left, right) => right.version - left.version)
                                            .map(version => (
                                                <div key={version.version} className="grid gap-2 border-t pt-3">
                                                    <p className="font-medium break-words">
                                                        {version.title} · v{version.version}
                                                    </p>
                                                    <p className="whitespace-pre-wrap break-words text-sm">{version.content}</p>
                                                </div>
                                            ))}
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </section>
            {editor && (
                <ProjectManagementDialog
                    project={project}
                    kind={editor}
                    onClose={() => setEditor(null)}
                    onSaved={() => {
                        setEditor(null)
                        onSaved()
                    }}
                />
            )}
            {noteEditor && (
                <ProjectNoteDialog
                    project={project}
                    noteId={noteEditor.noteId}
                    onClose={() => setNoteEditor(null)}
                    onSaved={() => {
                        setNoteEditor(null)
                        onSaved()
                    }}
                />
            )}
            <AlertDialog open={Boolean(remove)} onOpenChange={open => !open && !pending.current && setRemove(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>移除“{remove?.name}”？</AlertDialogTitle>
                        <AlertDialogDescription>
                            此成员将失去“{project.name}
                            ”的说明、工作摘要、共享资料与成果访问权限。已投递的本人聊天和私有历史会保留，不会移交给其他成员。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
                    {error && (
                        <Button variant="outline" onClick={onSaved}>
                            重新读取项目
                        </Button>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
                        <Button variant="destructive" disabled={removing} onClick={() => void confirmRemoval()}>
                            {removing ? '正在移除…' : '确认移除'}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    )
}

/**
 * Edits shared metadata or explicitly opens the complete project scope to selected colleagues.
 * @param props - Authorized project baseline, operation type, and confirmed-save callbacks.
 * @returns A version-checked management form that preserves local drafts on conflicts.
 */
function ProjectManagementDialog({
    project,
    kind,
    onClose,
    onSaved,
}: {
    project: CollaborationProject
    kind: 'info' | 'members'
    onClose: () => void
    onSaved: () => void
}) {
    const [baseline, setBaseline] = useState(project)
    const [name, setName] = useState(project.name)
    const [description, setDescription] = useState(project.description)
    const [selected, setSelected] = useState<CollaborationPerson[]>([])
    const [error, setError] = useState('')
    const [feedbackVariant, setFeedbackVariant] = useState<'info' | 'error'>('error')
    const [fields, setFields] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    const [conflict, setConflict] = useState(false)
    const pending = useRef(false)
    const action = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const nameRef = useRef<HTMLInputElement>(null)
    const descriptionRef = useRef<HTMLTextAreaElement>(null)

    /**
     * Reads the current project revision while retaining every unsaved form field.
     * @returns After a successful refresh requiring a new explicit submit, or visible failure.
     */
    async function reread(): Promise<void> {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        try {
            setBaseline(await getCollaborationProject(project.id))
            setConflict(false)
            setFeedbackVariant('info')
            setError('已读取最新项目，本地输入仍保留。请核对共享范围后再次提交。')
        } catch (cause) {
            setFeedbackVariant('error')
            setError(failure(cause))
        } finally {
            pending.current = false
            setBusy(false)
        }
    }

    /**
     * Saves only the exact management fields and membership scope reviewed by the human owner.
     * @param event - Explicit management form submission.
     * @returns After confirmed persistence or a draft-preserving failure.
     */
    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault()
        if (pending.current || conflict) return
        const parsed = projectInputSchema.safeParse({ name, description })
        setFields({})
        if (!parsed.success) {
            const issues: Record<string, string> = {}
            for (const issue of parsed.error.issues) issues[String(issue.path[0])] ??= issue.message
            setFields(issues)
            if (issues.name) nameRef.current?.focus()
            else descriptionRef.current?.focus()
            return
        }
        const input =
            kind === 'info'
                ? { type: 'project-update' as const, projectId: project.id, revision: baseline.revision, ...parsed.data }
                : {
                      type: 'project-members-add' as const,
                      projectId: project.id,
                      revision: baseline.revision,
                      memberIds: selected.map(person => person.id),
                  }
        const fingerprint = JSON.stringify(input)
        if (action.current?.fingerprint !== fingerprint) action.current = { fingerprint, requestId: crypto.randomUUID() }
        pending.current = true
        setBusy(true)
        setError('')
        try {
            await sendCollaborationCommand({ ...input, requestId: action.current.requestId })
            onSaved()
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
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{kind === 'info' ? '编辑项目' : '管理成员'}</DialogTitle>
                    <DialogDescription>
                        {kind === 'info'
                            ? '项目名称和说明对所有有效项目成员可见。'
                            : '新增成员将立即获得本项目已有及后续共享内容的访问权限。'}
                    </DialogDescription>
                </DialogHeader>
                <form className="grid min-w-0 gap-4" onSubmit={event => void submit(event)} noValidate>
                    {kind === 'info' ? (
                        <>
                            <div className="grid gap-2">
                                <Label htmlFor="shared-project-name">项目名称</Label>
                                <Input
                                    id="shared-project-name"
                                    aria-invalid={Boolean(fields.name)}
                                    aria-describedby={fields.name ? 'shared-project-name-error' : undefined}
                                    ref={nameRef}
                                    value={name}
                                    onChange={event => setName(event.target.value)}
                                    maxLength={120}
                                    required
                                    disabled={busy}
                                />
                                {fields.name && (
                                    <p id="shared-project-name-error" role="alert" className="text-sm text-error-foreground">
                                        {fields.name}
                                    </p>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="shared-project-description">项目说明（选填）</Label>
                                <Textarea
                                    id="shared-project-description"
                                    ref={descriptionRef}
                                    aria-invalid={Boolean(fields.description)}
                                    aria-describedby={fields.description ? 'shared-project-description-error' : undefined}
                                    value={description}
                                    onChange={event => setDescription(event.target.value)}
                                    maxLength={2000}
                                    disabled={busy}
                                />
                                {fields.description && (
                                    <p id="shared-project-description-error" role="alert" className="text-sm text-error-foreground">
                                        {fields.description}
                                    </p>
                                )}
                            </div>
                        </>
                    ) : (
                        <ProjectMemberPicker
                            selected={selected}
                            onChange={setSelected}
                            exclude={baseline.members.filter(member => member.status === 'active').map(member => member.id)}
                            disabled={busy}
                        />
                    )}
                    <div className="grid gap-2 rounded-lg border p-3 text-sm">
                        <p className="font-medium break-words">{kind === 'info' ? name : baseline.name}</p>
                        <p className="whitespace-pre-wrap break-words">
                            {kind === 'info' ? description || '暂无说明。' : baseline.description || '暂无说明。'}
                        </p>
                        {kind === 'members' && (
                            <p className="break-words">
                                将向这些人开放：
                                {selected.map(person => `${person.name}（${person.id.slice(0, 8)}）`).join('、') || '尚未选择新成员'}
                            </p>
                        )}
                        <p className="text-muted-foreground">
                            这些成员可看项目说明、工作摘要、项目资料和已发布成果，后续内容也可见；聊天和个人资料保持私有。
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
                        <Button type="submit" disabled={busy || conflict || (kind === 'members' && selected.length === 0)}>
                            {busy ? '正在保存…' : kind === 'info' ? '保存修改' : '确认添加成员'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Publishes or versions one author's complete manually reviewed project note.
 * @param props - Authorized project, optional original note identity, and confirmed-save callbacks.
 * @returns A full-text preview form with immutable history and explicit conflict recovery.
 */
function ProjectNoteDialog({
    project,
    noteId,
    onClose,
    onSaved,
}: {
    project: CollaborationProject
    noteId?: string
    onClose: () => void
    onSaved: () => void
}) {
    const original = latestVersions(project.notes ?? []).find(note => note.id === noteId)
    const [baseline, setBaseline] = useState({ revision: project.revision, version: original?.version })
    const [title, setTitle] = useState(original?.title ?? '')
    const [content, setContent] = useState(original?.content ?? '')
    const [error, setError] = useState('')
    const [feedbackVariant, setFeedbackVariant] = useState<'info' | 'error'>('error')
    const [fields, setFields] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    const [conflict, setConflict] = useState(false)
    const [latest, setLatest] = useState<{ title: string; content: string; version: number } | null>(null)
    const pending = useRef(false)
    const action = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const titleRef = useRef<HTMLInputElement>(null)
    const contentRef = useRef<HTMLTextAreaElement>(null)

    /**
     * Reads the latest saved version and project authorization revision while preserving local text.
     * @returns After review metadata is refreshed, or a visible permission or persistence failure.
     */
    async function reread(): Promise<void> {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        try {
            const saved = await getCollaborationProject(project.id)
            const note = latestVersions(saved.notes ?? []).find(item => item.id === noteId)
            if (noteId && !note) throw new Error('当前资料不可用，请重新打开项目。')
            setBaseline({ revision: saved.revision, version: note?.version })
            setLatest(note ?? null)
            setConflict(false)
            setFeedbackVariant('info')
            setError('已读取最新资料，本地草稿已保留。请核对后再次明确提交。')
        } catch (cause) {
            setFeedbackVariant('error')
            setError(failure(cause))
        } finally {
            pending.current = false
            setBusy(false)
        }
    }

    /**
     * Submits the reviewed project revision and note version with the complete human-reviewed text.
     * @param event - Explicit note publication or update submission.
     * @returns After a confirmed new version or a visible draft-preserving failure.
     */
    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault()
        if (pending.current || conflict) return
        setFields({})
        const normalizedTitle = title.trim()
        const normalizedContent = content.trim()
        if (!normalizedTitle || normalizedTitle.length > 120) {
            setFields({ title: '资料标题须为 1–120 个字。' })
            titleRef.current?.focus()
            return
        }
        if (!normalizedContent || normalizedContent.length > 32000) {
            setFields({ content: '资料正文须为 1–32,000 个字。' })
            contentRef.current?.focus()
            return
        }
        const input = noteId
            ? {
                  type: 'note-edit' as const,
                  projectId: project.id,
                  revision: baseline.revision,
                  noteId,
                  version: baseline.version!,
                  title: normalizedTitle,
                  content: normalizedContent,
              }
            : {
                  type: 'note-publish' as const,
                  projectId: project.id,
                  revision: baseline.revision,
                  title: normalizedTitle,
                  content: normalizedContent,
              }
        const fingerprint = JSON.stringify(input)
        if (action.current?.fingerprint !== fingerprint) action.current = { fingerprint, requestId: crypto.randomUUID() }
        pending.current = true
        setBusy(true)
        setError('')
        try {
            await sendCollaborationCommand({ ...input, requestId: action.current.requestId })
            onSaved()
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
                    <DialogTitle>{noteId ? '更新资料' : '发布资料'}</DialogTitle>
                    <DialogDescription>
                        所有当前有效项目成员可见；后加入成员也可见。人工提交才保存共享正文，不调用模型或发送消息。
                    </DialogDescription>
                </DialogHeader>
                <form className="grid min-w-0 gap-4" noValidate onSubmit={event => void submit(event)}>
                    <div className="grid gap-2">
                        <Label htmlFor="project-note-title">资料标题</Label>
                        <Input
                            id="project-note-title"
                            aria-invalid={Boolean(fields.title)}
                            aria-describedby={fields.title ? 'project-note-title-error' : undefined}
                            ref={titleRef}
                            value={title}
                            onChange={event => setTitle(event.target.value)}
                            maxLength={120}
                            disabled={busy}
                            required
                        />
                        {fields.title && (
                            <p id="project-note-title-error" role="alert" className="text-sm text-error-foreground">
                                {fields.title}
                            </p>
                        )}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="project-note-content">资料正文</Label>
                        <Textarea
                            id="project-note-content"
                            aria-invalid={Boolean(fields.content)}
                            aria-describedby={fields.content ? 'project-note-content-error' : undefined}
                            ref={contentRef}
                            value={content}
                            onChange={event => setContent(event.target.value)}
                            maxLength={32000}
                            rows={10}
                            disabled={busy}
                            required
                        />
                        {fields.content && (
                            <p id="project-note-content-error" role="alert" className="text-sm text-error-foreground">
                                {fields.content}
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">{content.length.toLocaleString()} / 32,000 字，保留正文内部换行。</p>
                    </div>
                    <section className="grid min-w-0 gap-2 rounded-lg border p-3" aria-label="完整共享预览">
                        <h3 className="font-medium break-words">{title.trim() || '资料标题预览'}</h3>
                        <p className="whitespace-pre-wrap break-words text-sm">
                            {content.trim() || '填写正文后将在这里显示完整共享内容。'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            共享至“{project.name}”的所有当前及后加入的有效成员。不会分享私有聊天或个人资料。
                        </p>
                    </section>
                    {latest && (
                        <section className="grid min-w-0 gap-2 border-t pt-3" aria-label="最新已保存资料">
                            <h3 className="font-medium break-words">
                                最新已保存：{latest.title} · v{latest.version}
                            </h3>
                            <p className="whitespace-pre-wrap break-words text-sm">{latest.content}</p>
                        </section>
                    )}
                    {error && <FeedbackMessage variant={feedbackVariant}>{error}</FeedbackMessage>}
                    {conflict && (
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void reread()}>
                            重新读取最新资料，保留本地草稿
                        </Button>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="submit" disabled={busy || conflict}>
                            {busy ? '正在保存…' : noteId ? '提交新版本' : '发布资料'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
