'use client'

import {
    ArrowLeft,
    ArrowRight,
    Bot,
    Check,
    ChevronDown,
    Folder,
    FolderPlus,
    Layers,
    LoaderCircle,
    Pencil,
    Plus,
    RotateCcw,
    Search,
    X,
} from 'lucide-react'
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
} from '@ai-harness/contracts'
import { projectInputSchema } from '@ai-harness/contracts'
import { listAgents } from '../lib/agent-client'
import { getChatStatus } from '../lib/chat-client'
import { createProject, getProject, listProjects, updateProject } from '../lib/project-client'
import { listTasks, updateTaskProject } from '../lib/task-client'
import { TaskCreationDialog } from './task-workspace'
import styles from './project-workspace.module.css'

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
export function ProjectWorkspace({ projectId }: { projectId?: string }) {
    return projectId ? <ProjectOverview key={projectId} projectId={projectId} /> : <ProjectList />
}

/**
 * Renders loading and failure feedback without placeholder project records.
 * @param props - Current error and explicit retry callback.
 * @returns Accessible project feedback and a route back to the collection.
 */
function ProjectFeedback({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div className={styles.feedback} role={error ? 'alert' : 'status'}>
            {error ? <Folder size={29} aria-hidden="true" /> : <LoaderCircle size={24} className={styles.spinner} aria-hidden="true" />}
            <h1>{error ? '暂时无法载入项目' : '正在载入项目'}</h1>
            <p>{error || '正在读取当前工作区的项目记录。'}</p>
            {error && (
                <>
                    <button type="button" className={styles.secondaryButton} onClick={onRetry}>
                        <RotateCcw size={15} aria-hidden="true" />
                        重新载入
                    </button>
                    <Link href="/projects" className={styles.textLink}>
                        返回个人项目
                        <ArrowRight size={14} aria-hidden="true" />
                    </Link>
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
}: {
    project: PersonalProject | null
    onClose: () => void
    onSaved: (project: PersonalProject) => void
}) {
    const [draft, setDraft] = useState<ProjectInput>({ name: project?.name ?? '', description: project?.description ?? '' })
    const [errors, setErrors] = useState<Partial<Record<keyof ProjectInput, string>>>({})
    const [failure, setFailure] = useState('')
    const [saving, setSaving] = useState(false)
    const dialogRef = useRef<HTMLDialogElement>(null)
    const nameRef = useRef<HTMLInputElement>(null)
    const busy = useRef(false)
    const creation = useRef<{ fingerprint: string; requestId: string } | null>(null)

    useEffect(() => {
        dialogRef.current?.showModal()
        nameRef.current?.focus()
    }, [])

    /**
     * Closes an idle project form after returning keyboard focus to its parent view.
     * @returns Nothing; retains inputs while a failed save remains open.
     */
    function close() {
        if (busy.current) return
        dialogRef.current?.close()
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
        const fingerprint = JSON.stringify(result.data)
        if (creation.current?.fingerprint !== fingerprint) creation.current = { fingerprint, requestId: crypto.randomUUID() }
        busy.current = true
        setSaving(true)
        setFailure('')
        setErrors({})
        try {
            const saved = project
                ? await updateProject(project.id, result.data)
                : await createProject({ ...result.data, requestId: creation.current.requestId })
            dialogRef.current?.close()
            onSaved(saved)
        } catch (error) {
            setFailure(errorMessage(error))
        } finally {
            busy.current = false
            setSaving(false)
        }
    }

    return (
        <dialog
            ref={dialogRef}
            className={styles.dialog}
            aria-labelledby="project-editor-heading"
            onCancel={event => {
                if (saving) event.preventDefault()
            }}
            onClose={close}
        >
            <header className={styles.dialogHeader}>
                <div>
                    <span className={styles.eyebrow}>{project ? 'EDIT PROJECT' : 'NEW PROJECT'}</span>
                    <h2 id="project-editor-heading">{project ? '编辑项目' : '新建个人项目'}</h2>
                </div>
                <button type="button" className={styles.iconButton} disabled={saving} aria-label="关闭项目表单" onClick={close}>
                    <X size={19} aria-hidden="true" />
                </button>
            </header>
            <form onSubmit={save} noValidate>
                <fieldset className={styles.fields} disabled={saving}>
                    <div className={styles.field}>
                        <label htmlFor="project-name">
                            项目名称 <span aria-hidden="true">*</span>
                        </label>
                        <input
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
                        <label htmlFor="project-description">
                            项目说明 <span>选填</span>
                        </label>
                        <textarea
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
                </fieldset>
                {failure && (
                    <div className={styles.error} role="alert">
                        <p>{failure}</p>
                        <span>输入已保留，可以直接重试。</span>
                    </div>
                )}
                <footer className={styles.dialogActions}>
                    <button type="button" className={styles.secondaryButton} disabled={saving} onClick={close}>
                        暂时取消
                    </button>
                    <button type="submit" className={styles.primaryButton} disabled={saving}>
                        {saving ? (
                            <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" />
                        ) : (
                            <Check size={15} aria-hidden="true" />
                        )}
                        {saving ? '正在保存' : project ? '保存修改' : '创建项目'}
                    </button>
                </footer>
            </form>
        </dialog>
    )
}

/**
 * Lists real personal projects with name/description search and creation or editing.
 * @returns The complete project collection with honest empty and failure states.
 */
function ProjectList() {
    const router = useRouter()
    const [projects, setProjects] = useState<PersonalProject[]>([])
    const [status, setStatus] = useState<ChatStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [failure, setFailure] = useState('')
    const [reload, setReload] = useState(0)
    const [query, setQuery] = useState('')
    const [editor, setEditor] = useState<{ project: PersonalProject | null } | null>(null)
    const [notice, setNotice] = useState('')
    const opener = useRef<HTMLButtonElement | null>(null)
    const search = query.trim().toLocaleLowerCase()
    const visible = projects.filter(project => `${project.name} ${project.description}`.toLocaleLowerCase().includes(search))

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Establishes the browser identity before requesting its scoped projects.
         * @returns A promise settled after the project collection is read.
         */
        async function load() {
            try {
                const connection = await getChatStatus(controller.signal)
                const items = await listProjects(controller.signal)
                if (controller.signal.aborted) return
                setProjects(recentRecords(items))
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
    }, [reload])

    /**
     * Reloads projects after an explicit refresh or failed request.
     * @returns Nothing; switches to truthful loading feedback.
     */
    function refresh() {
        setLoading(true)
        setFailure('')
        setReload(value => value + 1)
    }

    /**
     * Closes the editor and restores focus to its opening action.
     * @returns Nothing; returns keyboard control to the collection.
     */
    function closeEditor() {
        setEditor(null)
        opener.current?.focus()
    }

    /**
     * Applies a confirmed save and opens new projects at their stable address.
     * @param project - Persisted project returned by the typed API.
     * @returns Nothing; updates the list or navigates to the new project.
     */
    function savedProject(project: PersonalProject) {
        const created = !editor?.project
        setProjects(current => recentRecords([project, ...current.filter(item => item.id !== project.id)]))
        closeEditor()
        setNotice('项目信息已保存。')
        if (created) router.push(`/projects/${encodeURIComponent(project.id)}`)
    }

    if (loading || failure) return <ProjectFeedback error={failure} onRetry={refresh} />

    return (
        <section className={styles.page}>
            <header className={styles.heading}>
                <div>
                    <div className={styles.eyebrow}>
                        <Folder size={16} aria-hidden="true" /> PERSONAL PROJECTS
                    </div>
                    <h1>个人项目</h1>
                    <p>把同一个主题下的任务，放在一起持续推进。</p>
                </div>
                <div className={styles.headingActions}>
                    <Link href="/templates" className={styles.secondaryButton}>
                        <Layers size={15} aria-hidden="true" />
                        任务模板
                    </Link>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={event => {
                            opener.current = event.currentTarget
                            setEditor({ project: null })
                        }}
                    >
                        <Plus size={16} aria-hidden="true" />
                        新建项目
                    </button>
                </div>
            </header>
            {status?.storage === 'memory' && (
                <p className={styles.storageNotice}>当前为临时存储：刷新和返回页面会保留记录，重启服务会清空项目、任务及对话。</p>
            )}
            <div className={styles.toolbar}>
                <span>{projects.length} 个项目</span>
                <label className={styles.search}>
                    <Search size={16} aria-hidden="true" />
                    <span className="sr-only">搜索项目名称或说明</span>
                    <input type="search" value={query} placeholder="搜索名称或说明" onChange={event => setQuery(event.target.value)} />
                </label>
                <button type="button" className={styles.iconButton} aria-label="刷新项目列表" title="刷新项目列表" onClick={refresh}>
                    <RotateCcw size={16} aria-hidden="true" />
                </button>
            </div>
            {notice && (
                <p className={styles.notice} role="status">
                    <Check size={14} aria-hidden="true" />
                    {notice}
                </p>
            )}
            {visible.length === 0 ? (
                <div className={styles.empty}>
                    <FolderPlus size={32} strokeWidth={1.4} aria-hidden="true" />
                    <h2>{search ? '没有找到相关项目' : '为长期主题建一个项目'}</h2>
                    <p>{search ? '试试名称或项目说明中的其他关键词。' : '从一个空项目开始，归入已有任务，或创建新的工作目标。'}</p>
                    {search ? (
                        <button type="button" className={styles.secondaryButton} onClick={() => setQuery('')}>
                            清空搜索
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={event => {
                                opener.current = event.currentTarget
                                setEditor({ project: null })
                            }}
                        >
                            <Plus size={15} aria-hidden="true" />
                            创建第一个项目
                        </button>
                    )}
                </div>
            ) : (
                <div className={styles.projectGrid}>
                    {visible.map(project => (
                        <article className={styles.projectCard} key={project.id}>
                            <Link href={`/projects/${encodeURIComponent(project.id)}`} className={styles.projectLink}>
                                <Folder size={22} strokeWidth={1.5} aria-hidden="true" />
                                <h2>{project.name}</h2>
                                <p>{project.description || '添加说明，方便下次回来继续。'}</p>
                                <span className={styles.projectIdentity}>
                                    编号 {project.id.slice(0, 8)} · {updatedLabel(project.updatedAt)} 更新
                                </span>
                                <span className={styles.openProject}>
                                    打开项目
                                    <ArrowRight size={14} aria-hidden="true" />
                                </span>
                            </Link>
                            <button
                                type="button"
                                className={`${styles.iconButton} ${styles.cardEdit}`}
                                aria-label={`编辑项目：${project.name}，编号 ${project.id.slice(0, 8)}`}
                                onClick={event => {
                                    opener.current = event.currentTarget
                                    setEditor({ project })
                                }}
                            >
                                <Pencil size={15} aria-hidden="true" />
                            </button>
                        </article>
                    ))}
                </div>
            )}
            {editor && (
                <ProjectEditorDialog
                    key={editor.project?.id ?? 'new'}
                    project={editor.project}
                    onClose={closeEditor}
                    onSaved={savedProject}
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
         * Establishes the identity before reading project membership and task-creation choices.
         * @returns A promise settled after complete, untruncated task data is available.
         */
        async function load() {
            try {
                const connection = await getChatStatus(controller.signal)
                const [saved, allTasks, allProjects, profiles] = await Promise.all([
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
            <Link href="/projects" className={styles.backLink}>
                <ArrowLeft size={15} aria-hidden="true" />
                个人项目
            </Link>
            <header className={`${styles.heading} ${styles.detailHeading}`}>
                <div>
                    <div className={styles.eyebrow}>
                        <Folder size={16} aria-hidden="true" /> PROJECT · {detail.project.id.slice(0, 8)}
                    </div>
                    <h1>{detail.project.name}</h1>
                    <p className={styles.description}>{detail.project.description || '这个项目还没有添加说明。'}</p>
                </div>
                <div className={styles.headingActions}>
                    <Link href="/templates" className={styles.secondaryButton}>
                        <Layers size={15} aria-hidden="true" />
                        任务模板
                    </Link>
                    <button ref={editorOpener} type="button" className={styles.secondaryButton} onClick={() => setEditing(true)}>
                        <Pencil size={15} aria-hidden="true" />
                        编辑项目
                    </button>
                </div>
            </header>
            {status?.storage === 'memory' && (
                <p className={styles.storageNotice}>当前为临时存储：刷新和返回页面会保留记录，重启服务会清空项目、任务及对话。</p>
            )}
            {detail.project.templateOrigin && (
                <section className={styles.templateOrigin} aria-label="项目来源模板">
                    <div>
                        <Layers size={15} aria-hidden="true" />
                        <strong>来自任务模板 · v{detail.project.templateOrigin.version}</strong>
                        <Link href={`/templates/${encodeURIComponent(detail.project.templateOrigin.templateId)}`}>
                            查看当前模板
                            <ArrowRight size={13} aria-hidden="true" />
                        </Link>
                    </div>
                    <p>任务按生成时保存的条目顺序展示；后续归入的任务排在末尾。</p>
                </section>
            )}
            <div className={styles.stats} aria-label="项目任务状态数量">
                <div>
                    <strong>{detail.tasks.length}</strong>
                    <span>全部任务</span>
                </div>
                {Object.entries(statusLabels).map(([value, label]) => (
                    <div key={value}>
                        <strong>{detail.tasks.filter(task => task.task.status === value).length}</strong>
                        <span>{label}</span>
                    </div>
                ))}
            </div>
            <div className={styles.tasksHeading}>
                <div>
                    <h2>项目任务</h2>
                    <p>所有任务保留各自的目标、助手和对话。</p>
                </div>
                <div>
                    <button
                        type="button"
                        className={styles.iconButton}
                        disabled={Boolean(changingId)}
                        aria-label="刷新项目和任务状态"
                        title="刷新项目和任务状态"
                        onClick={refresh}
                    >
                        <RotateCcw size={15} aria-hidden="true" />
                    </button>
                    <button ref={taskOpener} type="button" className={styles.primaryButton} onClick={() => setCreatingTask(true)}>
                        <Plus size={15} aria-hidden="true" />
                        新建任务
                    </button>
                </div>
            </div>
            <form
                className={styles.membershipForm}
                onSubmit={event => {
                    event.preventDefault()
                    if (candidate) void changeMembership(candidate, projectId)
                }}
            >
                <label htmlFor="project-existing-task">归入已有任务</label>
                <div className={styles.membershipControls}>
                    <div className={styles.selectWrap}>
                        <select
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
                            <option value="">{candidates.length ? '选择一个已有任务' : '没有其他可归入的任务'}</option>
                            {candidates.map(task => (
                                <option value={task.id} key={task.id} disabled={Boolean(task.activeRequestId)}>
                                    {task.title} · {statusLabels[task.task.status]} · {membershipLabel(task.task.projectId, projects)} ·{' '}
                                    {task.id.slice(0, 8)}
                                    {task.activeRequestId ? ' · 正在生成' : ''}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={15} aria-hidden="true" />
                    </div>
                    <button
                        type="submit"
                        className={styles.secondaryButton}
                        disabled={!candidate || Boolean(changingId) || Boolean(candidate?.activeRequestId)}
                    >
                        {changingId && changingId === selectedTask ? (
                            <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" />
                        ) : (
                            <Plus size={15} aria-hidden="true" />
                        )}
                        归入项目
                    </button>
                </div>
                <p className={styles.hint} id="project-existing-task-hint">
                    可选择未归组或其他项目的任务；已完成任务也可以归组。生成中的任务暂不可移动。
                </p>
                {candidate?.task.projectId && (
                    <p className={styles.moveNotice}>该任务将从“{membershipLabel(candidate.task.projectId, projects)}”移动到当前项目。</p>
                )}
            </form>
            {membershipError && (
                <div className={styles.error} role="alert">
                    <p>{membershipError}</p>
                    <span>当前仍展示上次确认的归属与数量，可以重试或刷新确认。</span>
                </div>
            )}
            {notice && (
                <p className={styles.notice} role="status">
                    <Check size={14} aria-hidden="true" />
                    {notice}
                </p>
            )}
            {detail.tasks.length === 0 ? (
                <div className={styles.empty}>
                    <FolderPlus size={30} strokeWidth={1.4} aria-hidden="true" />
                    <h2>项目里还没有任务</h2>
                    <p>归入一个已有任务，或创建一个新的工作目标。</p>
                </div>
            ) : (
                <div className={styles.taskList}>
                    {detail.tasks.map(task => (
                        <article className={styles.taskRow} key={task.id}>
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
                                    <span className={styles.statusBadge}>{statusLabels[task.task.status]}</span>
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
                            <button
                                type="button"
                                className={styles.removeButton}
                                disabled={Boolean(changingId) || Boolean(task.activeRequestId)}
                                title={task.activeRequestId ? '生成期间不能修改归属' : '移出后仍保留在个人任务'}
                                aria-label={`移出任务：${task.title}`}
                                onClick={() => changeMembership(task, null)}
                            >
                                {changingId === task.id ? '正在保存' : task.activeRequestId ? '生成中' : '移出项目'}
                            </button>
                        </article>
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
