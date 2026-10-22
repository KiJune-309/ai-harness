'use client'

import { ArrowLeft, ArrowRight, Bot, Check, Folder, FolderPlus, Layers, LoaderCircle, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
    AgentDefinition,
    ChatStatus,
    PersonalProject,
    PersonalTask,
    ProjectDetail,
    ProjectInput,
    TaskStatus,
    CollaborationPerson,
    CollaborationProject,
} from '@ai-harness/contracts'
import { projectInputSchema } from '@ai-harness/contracts'
import { listAgents } from '../lib/agent-client'
import { getChatStatus } from '../lib/chat-client'
import { createProject, getProject, listProjects, updateProject } from '../lib/project-client'
import { listTasks, updateTaskProject } from '../lib/task-client'
import { TaskCreationDialog } from './task-workspace'
import { CollaborationProjectBoundary, useCollaborationProjects } from './collaboration-workspace'
import { ProjectMemberPicker } from './team-project'
import { useAccount } from './account-context'
import { sendCollaborationCommand } from '../lib/collaboration-client'
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import styles from './project-workspace.styles'
import { FeedbackMessage } from './ui/feedback-message'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { SearchInput } from './ui/search-input'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Textarea } from './ui/textarea'
import { EmptyState } from './ui/empty-state'

const statusLabels: Record<TaskStatus, string> = {
    'not-started': '未开始',
    'in-progress': '进行中',
    'needs-input': '待补充',
    completed: '已完成',
}

/**
 * Converts a project request failure into safe visible feedback.
 * @param error - Failure thrown by the typed project or task client.
 * @returns A human-readable explanation without transport diagnostics.
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '暂时无法连接项目服务，请重试。'
}

/**
 * Formats a saved update timestamp in the workspace's Chinese interface.
 * @param value - ISO timestamp returned by the API.
 * @returns A concise localized date and time.
 */
function updatedLabel(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(
        new Date(value)
    )
}

/**
 * Sorts persisted records by update time without mutating their source collection.
 * @param records - Saved projects or tasks with stable identifiers and timestamps.
 * @returns A recently updated first copy with stable ordering for ties.
 */
function recentRecords<T extends { id: string; updatedAt: string }>(records: T[]): T[] {
    return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
}

/**
 * Keeps generated task identities in their recorded template order after membership updates.
 * @param project - Saved project with optional original template task identifiers.
 * @param tasks - Complete confirmed task membership to display.
 * @returns Original template tasks first, followed by later tasks in recent-update order.
 */
function orderedProjectTasks(project: PersonalProject, tasks: PersonalTask[]): PersonalTask[] {
    if (!project.templateOrigin) return recentRecords(tasks)
    const positions = new Map(project.templateOrigin.taskIds.map((id, index) => [id, index]))
    return [...tasks].sort((left, right) => {
        const leftPosition = positions.get(left.id)
        const rightPosition = positions.get(right.id)
        if (leftPosition !== undefined || rightPosition !== undefined)
            return (leftPosition ?? Number.MAX_SAFE_INTEGER) - (rightPosition ?? Number.MAX_SAFE_INTEGER)
        return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
    })
}

/**
 * Distinguishes projects with duplicate names when selecting an existing task.
 * @param id - Task's current project identifier, if any.
 * @param projects - Current identity's project records.
 * @returns A compact current-membership label with a stable identifier hint.
 */
function membershipLabel(id: string | undefined, projects: PersonalProject[]): string {
    if (!id) return '未归组'
    const project = projects.find(item => item.id === id)
    return `${project?.name ?? '项目'} · ${id.slice(0, 8)}`
}

/**
 * Selects project-list or project-detail state according to the stable route.
 * @param props - Optional existing project identifier.
 * @returns Real project management within the shared workspace.
 */
export function ProjectWorkspace({ projectId, nodeId, eventId }: { projectId?: string; nodeId?: string; eventId?: string }) {
    return projectId ? (
        <CollaborationProjectBoundary key={projectId} projectId={projectId} nodeId={nodeId} eventId={eventId}>
            <ProjectOverview projectId={projectId} />
        </CollaborationProjectBoundary>
    ) : (
        <ProjectList />
    )
}

/**
 * Renders loading and failure feedback without placeholder project records.
 * @param props - Current error and explicit retry callback.
 * @returns Accessible project feedback and a route back to the collection.
 */
function ProjectFeedback({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div className={styles.feedback}>
            <FeedbackMessage variant={error ? 'error' : 'loading'} role={error ? 'alert' : 'status'}>
                {error || '正在读取当前工作区的项目记录。'}
            </FeedbackMessage>
            {error && (
                <>
                    <Button type="button" variant="outline" onClick={onRetry}>
                        <RotateCcw size={15} aria-hidden="true" />
                        重新载入
                    </Button>
                    <Button variant="link" nativeButton={false} render={<Link href="/projects" />}>
                        返回项目
                        <ArrowRight size={14} aria-hidden="true" />
                    </Button>
                </>
            )}
        </div>
    )
}

/**
 * Creates or edits management information while preserving failed drafts and creation identifiers.
 * @param props - Optional existing project and callbacks for closing or confirmed persistence.
 * @returns An accessible project form with the same public contract as the server.
 */
function ProjectEditorDialog({
    project,
    onClose,
    onSaved,
    onCreatedShared,
}: {
    project: PersonalProject | null
    onClose: () => void
    onSaved: (project: PersonalProject) => void
    onCreatedShared?: (projectId: string) => void
}) {
    const { user } = useAccount()
    const [visibility, setVisibility] = useState<'private' | 'shared'>('private')
    const [people, setPeople] = useState<CollaborationPerson[]>([])
    const [draft, setDraft] = useState<ProjectInput>({ name: project?.name ?? '', description: project?.description ?? '' })
    const [errors, setErrors] = useState<Partial<Record<keyof ProjectInput, string>>>({})
    const [failure, setFailure] = useState('')
    const [saving, setSaving] = useState(false)
    const nameRef = useRef<HTMLInputElement>(null)
    const busy = useRef(false)
    const creation = useRef<{ fingerprint: string; requestId: string } | null>(null)

    /**
     * Closes an idle project form after returning keyboard focus to its parent view.
     * @returns Nothing; retains inputs while a failed save remains open.
     */
    function close() {
        if (busy.current) return
        onClose()
    }

    /**
     * Checks a project field after the user leaves it.
     * @param field - Name or description field being validated.
     * @returns Nothing; updates its inline accessible error.
     */
    function validateField(field: keyof ProjectInput) {
        const result = projectInputSchema.shape[field].safeParse(draft[field])
        setErrors(current => ({ ...current, [field]: result.success ? undefined : result.error.issues[0]?.message }))
    }

    /**
     * Saves valid project information and reuses the original creation action after a failed response.
     * @param event - Project form submit event.
     * @returns A promise settled after confirmed persistence or a visible recoverable error.
     */
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (busy.current) return
        const result = projectInputSchema.safeParse(draft)
        if (!result.success) {
            const next: Partial<Record<keyof ProjectInput, string>> = {}
            for (const issue of result.error.issues) {
                const field = issue.path[0] as keyof ProjectInput
                next[field] ??= issue.message
            }
            setErrors(next)
            document.getElementById(next.name ? 'project-name' : 'project-description')?.focus()
            return
        }
        const fingerprint = JSON.stringify({ ...result.data, visibility, memberIds: people.map(person => person.id).sort() })
        if (creation.current?.fingerprint !== fingerprint) creation.current = { fingerprint, requestId: crypto.randomUUID() }
        busy.current = true
        setSaving(true)
        setFailure('')
        setErrors({})
        try {
            if (!project && visibility === 'shared') {
                const resultAction = await sendCollaborationCommand({
                    type: 'project-create',
                    requestId: creation.current.requestId,
                    ...result.data,
                    memberIds: people.map(person => person.id),
                })
                if (!resultAction.projectId) throw new Error('未能确认项目编号，请保留当前输入后重试。')
                onCreatedShared?.(resultAction.projectId)
            } else {
                const saved = project
                    ? await updateProject(project.id, result.data)
                    : await createProject({ ...result.data, requestId: creation.current.requestId })
                onSaved(saved)
            }
        } catch (error) {
            setFailure(errorMessage(error))
        } finally {
            busy.current = false
            setSaving(false)
        }
    }

    return (
        <Dialog
            open
            onOpenChange={open => {
                if (!open) close()
            }}
        >
            <DialogContent showCloseButton={false} initialFocus={nameRef} className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader className={styles.dialogHeader}>
                    <div>
                        <DialogTitle id="project-editor-heading">{project ? '编辑项目' : '新建项目'}</DialogTitle>
                        <DialogDescription>填写项目名称和说明，并选择谁可以看见这个项目。</DialogDescription>
                    </div>
                    <Button type="button" variant="ghost" size="icon" disabled={saving} aria-label="关闭项目表单" onClick={close}>
                        <X size={19} aria-hidden="true" />
                    </Button>
                </DialogHeader>
                <form onSubmit={save} className={styles.dialogForm} noValidate>
                    <fieldset className={styles.fields} disabled={saving}>
                        <div className={styles.field}>
                            <Label htmlFor="project-name">
                                项目名称 <span aria-hidden="true">*</span>
                            </Label>
                            <Input
                                ref={nameRef}
                                id="project-name"
                                value={draft.name}
                                maxLength={120}
                                required
                                placeholder="例如：秋季产品调研"
                                aria-invalid={Boolean(errors.name)}
                                aria-describedby={errors.name ? 'project-name-error' : 'project-name-hint'}
                                onChange={event => {
                                    setDraft(current => ({ ...current, name: event.target.value }))
                                    setFailure('')
                                }}
                                onBlur={() => validateField('name')}
                            />
                            <p className={styles.hint} id="project-name-hint">
                                可以使用同名项目；项目编号会帮助你区分。
                            </p>
                            {errors.name && (
                                <p className={styles.fieldError} id="project-name-error">
                                    {errors.name}
                                </p>
                            )}
                        </div>
                        <div className={styles.field}>
                            <Label htmlFor="project-description">
                                项目说明 <span>选填</span>
                            </Label>
                            <Textarea
                                id="project-description"
                                value={draft.description}
                                rows={5}
                                maxLength={2000}
                                placeholder="介绍这个主题、整理范围，或希望持续推进的方向。"
                                aria-invalid={Boolean(errors.description)}
                                aria-describedby={errors.description ? 'project-description-error' : 'project-description-hint'}
                                onChange={event => {
                                    setDraft(current => ({ ...current, description: event.target.value }))
                                    setFailure('')
                                }}
                                onBlur={() => validateField('description')}
                            />
                            <p className={styles.hint} id="project-description-hint">
                                {draft.description.length.toLocaleString()} / 2,000 · 项目说明用于整理工作，各任务保留独立对话。
                            </p>
                            {errors.description && (
                                <p className={styles.fieldError} id="project-description-error">
                                    {errors.description}
                                </p>
                            )}
                        </div>
                        {!project && (
                            <div className={styles.field}>
                                <Label id="project-visibility-label">可见范围</Label>
                                <RadioGroup
                                    value={visibility}
                                    onValueChange={value => setVisibility(value as 'private' | 'shared')}
                                    aria-labelledby="project-visibility-label"
                                >
                                    <Label className="flex min-h-11 items-center gap-2" htmlFor="project-private">
                                        <RadioGroupItem id="project-private" value="private" />
                                        仅自己
                                    </Label>
                                    <Label className="flex min-h-11 items-center gap-2" htmlFor="project-shared">
                                        <RadioGroupItem id="project-shared" value="shared" />
                                        指定成员协作
                                    </Label>
                                </RadioGroup>
                                {visibility === 'shared' && (
                                    <ProjectMemberPicker
                                        selected={people}
                                        onChange={setPeople}
                                        exclude={user?.id ? [user.id] : []}
                                        disabled={saving}
                                        id="project-create-members"
                                    />
                                )}
                            </div>
                        )}
                    </fieldset>
                    {!project && visibility === 'shared' && (
                        <section className="grid min-w-0 gap-2 rounded-xl border p-3 text-sm" aria-label="协作项目完整预览">
                            <h3 className="font-medium break-words">{draft.name.trim() || '项目名称预览'}</h3>
                            <p className="whitespace-pre-wrap break-words">{draft.description.trim() || '暂无说明。'}</p>
                            <p className="break-words">
                                拥有者：{user?.username ?? '本人'}；成员：
                                {people.map(person => `${person.name}（${person.id.slice(0, 8)}）`).join('、') ||
                                    '当前仅你可见，可稍后添加成员。'}
                            </p>
                            <p className="text-muted-foreground">
                                这些成员可看项目说明、工作摘要和已发布共享内容；聊天和个人资料保持私有。保存只创建项目，不创建任务、聊天或消息。
                            </p>
                        </section>
                    )}
                    {failure && (
                        <FeedbackMessage variant="error">
                            <p>{failure}</p>
                            <span>输入已保留，可以直接重试。</span>
                        </FeedbackMessage>
                    )}
                    <DialogFooter className={styles.dialogActions}>
                        <Button type="button" variant="outline" disabled={saving} onClick={close}>
                            暂时取消
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {saving ? (
                                <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" />
                            ) : (
                                <Check size={15} aria-hidden="true" />
                            )}
                            {saving ? '正在保存' : project ? '保存修改' : visibility === 'shared' ? '创建协作项目' : '创建项目'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Lists authorized personal and collaboration projects with shared search and refresh controls.
 * @returns The complete project collection with honest empty and failure states.
 */
function ProjectList() {
    const router = useRouter()
    const { user } = useAccount()
    const collaboration = useCollaborationProjects()
    const [projects, setProjects] = useState<PersonalProject[]>([])
    const [status, setStatus] = useState<ChatStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [failure, setFailure] = useState('')
    const [reload, setReload] = useState(0)
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<'all' | 'private' | 'shared'>('all')
    const [editor, setEditor] = useState<{ project: PersonalProject | null } | null>(null)
    const [notice, setNotice] = useState('')
    const opener = useRef<HTMLButtonElement | null>(null)
    const search = query.trim().toLocaleLowerCase()
    type ListedProject = { kind: 'private'; project: PersonalProject } | { kind: 'shared'; project: CollaborationProject }
    const byId = new Map<string, ListedProject>()
    for (const project of projects) byId.set(project.id, { kind: 'private', project })
    for (const project of collaboration.data ?? []) byId.set(project.id, { kind: 'shared', project })
    const collection = [...byId.values()].sort(
        (left, right) => right.project.updatedAt.localeCompare(left.project.updatedAt) || left.project.id.localeCompare(right.project.id)
    )
    const visible = collection.filter(
        item =>
            (filter === 'all' || filter === item.kind) &&
            `${item.project.name} ${item.project.description}`.toLocaleLowerCase().includes(search)
    )
    const collectionReady = !loading && !failure && collaboration.data !== null && !collaboration.error

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Reads the complete private project list independently of shared projections.
         * @returns After the current identity's persisted list and capability metadata are read.
         */
        async function load() {
            try {
                const [connection, items] = await Promise.all([getChatStatus(controller.signal), listProjects(controller.signal)])
                if (controller.signal.aborted) return
                setProjects(items)
                setStatus(connection)
                setFailure('')
            } catch (cause) {
                if (!controller.signal.aborted) setFailure(errorMessage(cause))
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        void load()
        return () => controller.abort()
    }, [reload])

    /**
     * Reloads both project collections without describing incomplete reads as a full list.
     * @returns Nothing after invalidating previous requests.
     */
    function refresh() {
        setLoading(true)
        setFailure('')
        setReload(value => value + 1)
        collaboration.refresh()
    }

    /**
     * Closes an idle editor and returns focus to its real opening control.
     * @returns Nothing after restoring collection interaction.
     */
    function closeEditor() {
        setEditor(null)
        opener.current?.focus()
    }

    /**
     * Applies a confirmed private save and opens newly created projects by stable identifier.
     * @param project - The actual persisted private project.
     * @returns Nothing after a confirmed update or route transition.
     */
    function savedProject(project: PersonalProject) {
        const created = !editor?.project
        setProjects(current => [project, ...current.filter(item => item.id !== project.id)])
        closeEditor()
        setNotice('项目信息已保存。')
        if (created) router.push(`/projects/${encodeURIComponent(project.id)}`)
    }

    return (
        <section className={styles.page}>
            <header className={styles.heading}>
                <div>
                    <h1>项目</h1>
                    <p>当前工作空间中，仅自己管理的事项和指定成员协作的项目。</p>
                </div>
                <div className={styles.headingActions}>
                    <Button variant="outline" nativeButton={false} render={<Link href="/templates" />}>
                        <Layers size={15} aria-hidden="true" />
                        任务模板
                    </Button>
                    <Button
                        onClick={event => {
                            opener.current = event.currentTarget
                            setEditor({ project: null })
                        }}
                    >
                        <Plus size={16} aria-hidden="true" />
                        新建项目
                    </Button>
                </div>
            </header>
            {status?.storage === 'postgres' && (
                <p className={styles.storageNotice}>项目与已发布资料会持久保存，加入项目不会公开个人聊天或模型凭据。</p>
            )}
            <div className={styles.toolbar}>
                <span>
                    {collectionReady
                        ? `${collection.length} 个项目`
                        : failure || collaboration.error
                          ? '项目数量暂不可用'
                          : '正在载入项目…'}
                </span>
                <SearchInput
                    containerClassName={styles.search}
                    aria-label="搜索项目名称或说明"
                    value={query}
                    placeholder="搜索名称或说明"
                    onValueChange={setQuery}
                />
                <Button variant="ghost" size="icon" aria-label="刷新项目列表" onClick={refresh}>
                    <RotateCcw size={16} aria-hidden="true" />
                </Button>
            </div>
            <RadioGroup
                value={filter}
                onValueChange={value => setFilter(value as typeof filter)}
                aria-label="项目类型筛选"
                className="flex flex-wrap gap-4"
            >
                {[
                    { value: 'all', label: '全部' },
                    { value: 'private', label: '仅自己' },
                    { value: 'shared', label: '协作' },
                ].map(option => (
                    <Label key={option.value} className="flex min-h-11 items-center gap-2" htmlFor={`project-filter-${option.value}`}>
                        <RadioGroupItem id={`project-filter-${option.value}`} value={option.value} />
                        {option.label}
                    </Label>
                ))}
            </RadioGroup>
            {notice && (
                <FeedbackMessage variant="success" role="status">
                    {notice}
                </FeedbackMessage>
            )}
            {(failure || collaboration.error) && (
                <FeedbackMessage variant="error">
                    <p>{failure || collaboration.error}</p>
                    <p>尚未读取完整项目集合，请重新载入后查看。</p>
                    <Button variant="outline" onClick={refresh}>
                        重新载入项目
                    </Button>
                </FeedbackMessage>
            )}
            {!failure && !collaboration.error && !collectionReady && (
                <p role="status" className="text-sm text-muted-foreground">
                    正在载入项目…
                </p>
            )}
            {collectionReady && visible.length === 0 && (
                <EmptyState
                    icon={<FolderPlus />}
                    title={search || filter !== 'all' ? '没有找到相关项目' : '为长期主题建一个项目'}
                    description={
                        search || filter !== 'all' ? '试试其他关键词或项目类型。' : '创建仅自己使用的项目，或和指定成员共同整理事项。'
                    }
                    actionLabel={search || filter !== 'all' ? (filter === 'all' ? '清空搜索' : '清空筛选') : '创建第一个项目'}
                    onAction={
                        search || filter !== 'all'
                            ? () => {
                                  setQuery('')
                                  setFilter('all')
                              }
                            : event => {
                                  opener.current = event.currentTarget
                                  setEditor({ project: null })
                              }
                    }
                />
            )}
            {collectionReady && visible.length > 0 && (
                <div className={styles.projectGrid} aria-label="项目列表">
                    {visible.map(({ kind, project }) => (
                        <Card className={styles.projectCard} key={project.id}>
                            <CardContent className={styles.projectCardContent}>
                                <Link href={`/projects/${encodeURIComponent(project.id)}`} className={styles.projectLink}>
                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <Folder size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <h2>{project.name}</h2>
                                        <Badge variant="secondary">{kind === 'shared' ? '协作' : '仅自己'}</Badge>
                                    </div>
                                    <p className="line-clamp-2 whitespace-pre-wrap">{project.description || '暂无项目说明。'}</p>
                                    {kind === 'shared' && (
                                        <p>
                                            {project.ownerId === user?.id ? '拥有者' : '成员'} ·{' '}
                                            {project.members.filter(member => member.status === 'active').length} 位成员
                                        </p>
                                    )}
                                    <span className={styles.projectIdentity}>
                                        编号 {project.id.slice(0, 8)} · {updatedLabel(project.updatedAt)} 更新
                                    </span>
                                    <span className={styles.openProject}>
                                        打开项目
                                        <ArrowRight size={14} aria-hidden="true" />
                                    </span>
                                </Link>
                                {kind === 'private' && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`编辑项目：${project.name}，编号 ${project.id.slice(0, 8)}`}
                                        onClick={event => {
                                            opener.current = event.currentTarget
                                            setEditor({ project })
                                        }}
                                    >
                                        <Pencil size={15} aria-hidden="true" />
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
            {editor && (
                <ProjectEditorDialog
                    key={editor.project?.id ?? 'new'}
                    project={editor.project}
                    onClose={closeEditor}
                    onSaved={savedProject}
                    onCreatedShared={id => {
                        closeEditor()
                        router.push(`/projects/${encodeURIComponent(id)}`)
                    }}
                />
            )}
        </section>
    )
}

/**
 * Shows every task in one stable project and performs confirmed membership changes.
 * @param props - Current project's stable identifier.
 * @returns Project information, live status counts, existing-task membership, and shared task creation.
 */
function ProjectOverview({ projectId }: { projectId: string }) {
    const router = useRouter()
    const [detail, setDetail] = useState<ProjectDetail | null>(null)
    const [projects, setProjects] = useState<PersonalProject[]>([])
    const [tasks, setTasks] = useState<PersonalTask[]>([])
    const [agents, setAgents] = useState<AgentDefinition[]>([])
    const [status, setStatus] = useState<ChatStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [failure, setFailure] = useState('')
    const [reload, setReload] = useState(0)
    const [editing, setEditing] = useState(false)
    const [creatingTask, setCreatingTask] = useState(false)
    const [selectedTask, setSelectedTask] = useState('')
    const [changingId, setChangingId] = useState<string | null>(null)
    const [membershipError, setMembershipError] = useState('')
    const [notice, setNotice] = useState('')
    const membershipBusy = useRef(false)
    const editorOpener = useRef<HTMLButtonElement>(null)
    const taskOpener = useRef<HTMLButtonElement>(null)
    const candidates = recentRecords(tasks.filter(task => task.task.projectId !== projectId))
    const candidate = candidates.find(task => task.id === selectedTask)

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Loads independent model status, project membership, and task-creation choices together.
         * @returns A promise settled after complete, untruncated task data is available.
         */
        async function load() {
            try {
                const [connection, saved, allTasks, allProjects, profiles] = await Promise.all([
                    getChatStatus(controller.signal),
                    getProject(projectId, controller.signal),
                    listTasks(controller.signal),
                    listProjects(controller.signal),
                    listAgents(controller.signal),
                ])
                if (controller.signal.aborted) return
                setDetail(saved)
                setTasks(allTasks)
                setProjects(allProjects)
                setAgents(profiles)
                setStatus(connection)
                setFailure('')
            } catch (error) {
                if (!controller.signal.aborted) setFailure(errorMessage(error))
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        void load()
        return () => controller.abort()
    }, [projectId, reload])

    /**
     * Reads fresh task statuses and counts after an explicit project refresh.
     * @returns Nothing; keeps writes blocked while the latest complete data is loaded.
     */
    function refresh() {
        if (membershipBusy.current) return
        setLoading(true)
        setFailure('')
        setReload(value => value + 1)
    }

    /**
     * Closes the project-information editor and restores keyboard focus.
     * @returns Nothing; returns to the stable project page.
     */
    function closeEditor() {
        setEditing(false)
        editorOpener.current?.focus()
    }

    /**
     * Applies confirmed project information without changing any task snapshots.
     * @param project - Project saved by the edit API.
     * @returns Nothing; updates the visible title and description.
     */
    function savedProject(project: PersonalProject) {
        setDetail(current => (current ? { ...current, project } : current))
        setProjects(current => current.map(item => (item.id === project.id ? project : item)))
        closeEditor()
        setNotice('项目信息已保存。')
    }

    /**
     * Closes the shared new-task form while retaining its draft.
     * @returns Nothing; restores focus to the project action.
     */
    function closeTaskCreation() {
        setCreatingTask(false)
        taskOpener.current?.focus()
    }

    /**
     * Opens a task after the API atomically saves both its record and initial project.
     * @param saved - Complete task returned by the shared creation flow.
     * @returns Nothing; navigates to the existing stable task route.
     */
    function createdTask(saved: PersonalTask) {
        setCreatingTask(false)
        router.push(`/inbox/${encodeURIComponent(saved.id)}`)
    }

    /**
     * Moves an existing task into this project or removes one after confirmed persistence.
     * @param task - Existing task selected from the full collection or project membership.
     * @param target - This project's identifier, or null to leave the task ungrouped.
     * @returns A promise settled after confirmed membership or a recoverable visible error.
     */
    async function changeMembership(task: PersonalTask, target: string | null) {
        if (membershipBusy.current || task.activeRequestId) return
        membershipBusy.current = true
        setChangingId(task.id)
        setMembershipError('')
        setNotice('')
        try {
            const saved = await updateTaskProject(task.id, { projectId: target })
            setTasks(current => current.map(item => (item.id === saved.id ? saved : item)))
            setDetail(current =>
                current
                    ? {
                          ...current,
                          tasks: orderedProjectTasks(current.project, [
                              ...current.tasks.filter(item => item.id !== saved.id),
                              ...(saved.task.projectId === current.project.id ? [saved] : []),
                          ]),
                      }
                    : current
            )
            setSelectedTask('')
            setNotice(target ? `已归入任务：${saved.title}。` : `已移出任务：${saved.title}，仍可在个人任务中找到。`)
        } catch (error) {
            setMembershipError(errorMessage(error))
        } finally {
            membershipBusy.current = false
            setChangingId(null)
        }
    }

    if (loading || failure || !detail) return <ProjectFeedback error={failure} onRetry={refresh} />

    return (
        <section className={styles.page}>
            <Button className="self-start" variant="ghost" nativeButton={false} render={<Link href="/projects" />}>
                <ArrowLeft size={15} aria-hidden="true" />
                返回项目
            </Button>
            <header className={styles.heading}>
                <div className="min-w-0 flex-1">
                    <div className={styles.projectIdentity}>编号 {detail.project.id.slice(0, 8)}</div>
                    <Badge variant="secondary">仅自己</Badge>
                    <h1>{detail.project.name}</h1>
                    <p className={styles.description}>{detail.project.description || '这个项目还没有添加说明。'}</p>
                </div>
                <div className={styles.headingActions}>
                    <Button variant="outline" nativeButton={false} render={<Link href="/templates" />}>
                        <Layers size={15} aria-hidden="true" />
                        任务模板
                    </Button>
                    <Button ref={editorOpener} type="button" variant="outline" onClick={() => setEditing(true)}>
                        <Pencil size={15} aria-hidden="true" />
                        编辑项目
                    </Button>
                </div>
            </header>
            {status?.storage === 'postgres' && <p className={styles.storageNotice}>已保存的项目、任务和对话会保留，服务重启后仍可访问。</p>}
            {detail.project.templateOrigin && (
                <Card className="rounded-none border-0 border-b bg-transparent py-4 shadow-none" role="region" aria-label="项目来源模板">
                    <CardContent className={styles.templateOrigin}>
                        <div>
                            <Layers size={15} aria-hidden="true" />
                            <strong>来自任务模板 · v{detail.project.templateOrigin.version}</strong>
                            <Link href={`/templates/${encodeURIComponent(detail.project.templateOrigin.templateId)}`}>
                                查看来源说明
                                <ArrowRight size={13} aria-hidden="true" />
                            </Link>
                        </div>
                        <p>任务按生成时保存的条目顺序展示；后续归入的任务排在末尾。</p>
                    </CardContent>
                </Card>
            )}
            <div className={styles.stats} aria-label="项目任务状态数量">
                <Card className="rounded-none border-0 bg-transparent py-0 shadow-none">
                    <CardContent className={styles.stat}>
                        <strong>{detail.tasks.length}</strong>
                        <span>全部任务</span>
                    </CardContent>
                </Card>
                {Object.entries(statusLabels).map(([value, label]) => (
                    <Card key={value} className="rounded-none border-0 bg-transparent py-0 shadow-none">
                        <CardContent className={styles.stat}>
                            <strong>{detail.tasks.filter(task => task.task.status === value).length}</strong>
                            <span>{label}</span>
                        </CardContent>
                    </Card>
                ))}
            </div>
            <div className={styles.tasksHeading}>
                <div>
                    <h2>项目任务</h2>
                    <p>所有任务保留各自的目标、助手和对话。</p>
                </div>
                <div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={Boolean(changingId)}
                        aria-label="刷新项目和任务状态"
                        title="刷新项目和任务状态"
                        onClick={refresh}
                    >
                        <RotateCcw size={15} aria-hidden="true" />
                    </Button>
                    <Button ref={taskOpener} type="button" onClick={() => setCreatingTask(true)}>
                        <Plus size={15} aria-hidden="true" />
                        新建任务
                    </Button>
                </div>
            </div>
            <form
                className={styles.membershipForm}
                onSubmit={event => {
                    event.preventDefault()
                    if (candidate) void changeMembership(candidate, projectId)
                }}
            >
                <Label htmlFor="project-existing-task">归入已有任务</Label>
                <div className={styles.membershipControls}>
                    <div className={styles.selectWrap}>
                        <NativeSelect
                            className="w-full"
                            id="project-existing-task"
                            value={selectedTask}
                            disabled={Boolean(changingId) || candidates.length === 0}
                            aria-describedby="project-existing-task-hint"
                            onChange={event => {
                                setSelectedTask(event.target.value)
                                setMembershipError('')
                                setNotice('')
                            }}
                        >
                            <NativeSelectOption value="">
                                {candidates.length ? '选择一个已有任务' : '没有其他可归入的任务'}
                            </NativeSelectOption>
                            {candidates.map(task => (
                                <NativeSelectOption value={task.id} key={task.id} disabled={Boolean(task.activeRequestId)}>
                                    {task.title} · {statusLabels[task.task.status]} · {membershipLabel(task.task.projectId, projects)} ·{' '}
                                    {task.id.slice(0, 8)}
                                    {task.activeRequestId ? ' · 正在生成' : ''}
                                </NativeSelectOption>
                            ))}
                        </NativeSelect>
                    </div>
                    <Button
                        type="submit"
                        variant="outline"
                        disabled={!candidate || Boolean(changingId) || Boolean(candidate?.activeRequestId)}
                    >
                        {changingId && changingId === selectedTask ? (
                            <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" />
                        ) : (
                            <Plus size={15} aria-hidden="true" />
                        )}
                        归入项目
                    </Button>
                </div>
                <p className={styles.hint} id="project-existing-task-hint">
                    可选择未归组或其他项目的任务；已完成任务也可以归组。生成中的任务暂不可移动。
                </p>
                {candidate?.task.projectId && (
                    <p className={styles.moveNotice}>该任务将从“{membershipLabel(candidate.task.projectId, projects)}”移动到当前项目。</p>
                )}
            </form>
            {membershipError && (
                <FeedbackMessage variant="error">
                    <p>{membershipError}</p>
                    <span>当前仍展示上次确认的归属与数量，可以重试或刷新确认。</span>
                </FeedbackMessage>
            )}
            {notice && (
                <FeedbackMessage variant="success" role="status">
                    {notice}
                </FeedbackMessage>
            )}
            {detail.tasks.length === 0 ? (
                <EmptyState
                    icon={<FolderPlus strokeWidth={1.4} />}
                    title="项目里还没有任务"
                    description="归入一个已有任务，或创建一个新的工作目标。"
                />
            ) : (
                <div className={styles.taskList}>
                    {detail.tasks.map(task => (
                        <Card className={styles.taskRow} key={task.id}>
                            <CardContent className={styles.taskRowContent}>
                                <Link href={`/inbox/${encodeURIComponent(task.id)}`} className={styles.taskLink}>
                                    {detail.project.templateOrigin && (
                                        <span className={styles.templateTaskOrder}>
                                            {detail.project.templateOrigin.taskIds.includes(task.id)
                                                ? `模板条目 ${String(detail.project.templateOrigin.taskIds.indexOf(task.id) + 1).padStart(2, '0')}`
                                                : '后续归入的任务'}
                                        </span>
                                    )}
                                    <div className={styles.taskTitle}>
                                        <h3>{task.title}</h3>
                                        <Badge variant="secondary">{statusLabels[task.task.status]}</Badge>
                                    </div>
                                    <p>
                                        <span>
                                            <Bot size={13} aria-hidden="true" />
                                            {task.agent.name}
                                        </span>
                                        <span>{task.agent.modelId}</span>
                                        <span>编号 {task.id.slice(0, 8)}</span>
                                    </p>
                                    <span className={styles.taskOpen}>
                                        打开任务
                                        <ArrowRight size={13} aria-hidden="true" />
                                    </span>
                                </Link>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={Boolean(changingId) || Boolean(task.activeRequestId)}
                                    title={task.activeRequestId ? '生成期间不能修改归属' : '移出后仍保留在个人任务'}
                                    aria-label={`移出任务：${task.title}`}
                                    onClick={() => changeMembership(task, null)}
                                >
                                    {changingId === task.id ? '正在保存' : task.activeRequestId ? '生成中' : '移出项目'}
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
            {editing && <ProjectEditorDialog project={detail.project} onClose={closeEditor} onSaved={savedProject} />}
            <TaskCreationDialog
                open={creatingTask}
                onClose={closeTaskCreation}
                onCreated={createdTask}
                agents={agents}
                status={status}
                projectId={projectId}
                projectName={detail.project.name}
            />
        </section>
    )
}
