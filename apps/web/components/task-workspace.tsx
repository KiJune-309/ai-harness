'use client'

import {
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Bot,
    Check,
    CheckCheck,
    ChevronDown,
    ChevronRight,
    Circle,
    CircleCheck,
    ClipboardList,
    Folder,
    LoaderCircle,
    Play,
    Plus,
    RotateCcw,
    Search,
    Square,
    X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
    AgentDefinition,
    ChatStatus,
    CreateTask,
    PersonalProject,
    PersonalTask,
    TaskStatus,
    UpdateTaskStatus,
} from '@ai-harness/contracts'
import { createTaskSchema } from '@ai-harness/contracts'
import { listAgents } from '../lib/agent-client'
import { getChatStatus } from '../lib/chat-client'
import { listProjects } from '../lib/project-client'
import {
    cancelTask,
    createTask,
    getTask,
    listTasks,
    startTask,
    streamTaskMessage,
    updateTaskStatus,
    updateTaskProject,
    type TaskStreamEvent,
} from '../lib/task-client'
import styles from './task-workspace.module.css'

type TaskView = 'pending' | 'completed'
type CreationDraft = { title: string; goal: string; agentId: string }
type CreationErrors = Partial<Record<'title' | 'goal' | 'agentId', string>>
type TaskAttempt = { kind: 'start' | 'message'; content: string; requestId: string }
type ActiveTurn = { requestId: string; stopping: boolean }

const statusLabels: Record<TaskStatus, string> = {
    'not-started': '未开始',
    'in-progress': '进行中',
    'needs-input': '待补充',
    completed: '已完成',
}
const pendingStatuses: TaskStatus[] = ['not-started', 'in-progress', 'needs-input']

/**
 * Converts an unknown request failure into a readable task message.
 * @param error - Error thrown by the task client or browser connection.
 * @returns Safe text for visible error feedback.
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '任务服务暂时无法连接，请重试。'
}

/**
 * Orders tasks by their saved update time with a stable identifier fallback.
 * @param tasks - Task records returned by the API or a completed mutation.
 * @returns A sorted copy with the most recently changed tasks first.
 */
function recentTasks(tasks: PersonalTask[]): PersonalTask[] {
    return [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
}

/**
 * Formats a stored update time for the Chinese workspace.
 * @param value - ISO timestamp supplied by the API.
 * @returns A localized month, day, hour, and minute.
 */
function updatedLabel(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(
        new Date(value)
    )
}

/**
 * Reads a task-specific supplemental draft without requiring browser storage.
 * @param id - Stable task identifier used to isolate drafts.
 * @returns The stored draft, or an empty string when none is available.
 */
function readDraft(id: string): string {
    try {
        return sessionStorage.getItem(`orbit.task-draft.${id}`) ?? ''
    } catch {
        return ''
    }
}

/**
 * Preserves unsent supplemental text across detail-page navigation and refresh.
 * @param id - Stable task identifier used to isolate drafts.
 * @param value - Current unsent text, or empty to remove a submitted draft.
 * @returns Nothing; updates session storage when available.
 */
function rememberDraft(id: string, value: string): void {
    try {
        if (value) sessionStorage.setItem(`orbit.task-draft.${id}`, value)
        else sessionStorage.removeItem(`orbit.task-draft.${id}`)
    } catch {
        // The in-memory draft remains usable when browser storage is blocked.
    }
}

/**
 * Finds only the latest failed or stopped task turn that can be retried.
 * @param task - Persisted task after a reload, cancellation, or failed execution.
 * @returns The original request metadata, or null after a successful later turn.
 */
function latestRetry(task: PersonalTask): TaskAttempt | null {
    const last = task.messages.at(-1)
    if (task.activeRequestId || !last || last.role !== 'assistant' || last.status === 'complete' || !last.requestId) return null
    const user = task.messages.find(message => message.role === 'user' && message.requestId === last.requestId)
    if (!user) return null
    const firstUser = task.messages.find(message => message.role === 'user')
    return { kind: firstUser?.requestId === user.requestId ? 'start' : 'message', content: user.content, requestId: last.requestId }
}

/**
 * Describes the saved outcome of a stop request without assuming cancellation won the race.
 * @param task - Latest server snapshot returned after cancellation or recovery.
 * @param requestId - Exact execution the user attempted to stop.
 * @returns Feedback matching the recorded reply, active execution, or unaccepted request.
 */
function stopNotice(task: PersonalTask, requestId: string): string {
    const reply = task.messages.find(message => message.role === 'assistant' && message.requestId === requestId)
    if (reply?.status === 'complete') return '回复已完成，结果已保留。'
    if (reply?.status === 'cancelled') return '已停止生成，已生成的内容已保留。'
    if (reply?.status === 'error') return '回复生成失败，已记录的内容已保留，可以重试最近请求。'
    if (task.activeRequestId === requestId) return '仍在执行，正在确认停止结果。'
    const accepted = task.messages.some(message => message.role === 'user' && message.requestId === requestId)
    return accepted ? '暂未确认回复结果，请重新载入任务查看保存状态。' : '本次请求尚未被接受，未发送的输入已保留。'
}

/**
 * Selects the list or stable detail view without mixing their state lifetimes.
 * @param props - Optional saved task identifier for the detail route.
 * @returns The real task list or its persisted conversation workspace.
 */
export function TaskWorkspace({ taskId }: { taskId?: string }) {
    return taskId ? <TaskDetail key={taskId} taskId={taskId} /> : <TaskList />
}

/**
 * Renders loading, error, and retry feedback with an accessible status message.
 * @param props - Current error and callback for retrying the failed load.
 * @returns Centered feedback that never substitutes demonstration tasks.
 */
function LoadFeedback({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div className={styles.loadFeedback} role={error ? 'alert' : 'status'}>
            {error ? (
                <ClipboardList size={28} aria-hidden="true" />
            ) : (
                <LoaderCircle className={styles.spinner} size={23} aria-hidden="true" />
            )}
            <h1>{error ? '暂时无法载入任务' : '正在载入任务'}</h1>
            <p>{error || '正在读取当前工作区的任务记录。'}</p>
            {error && (
                <>
                    <button type="button" className={styles.secondaryButton} onClick={onRetry}>
                        <RotateCcw size={15} aria-hidden="true" />
                        重新载入
                    </button>
                    <Link href="/inbox" className={styles.textLink}>
                        返回个人任务
                        <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                </>
            )}
        </div>
    )
}

/**
 * Displays the real task collection with search, work views, and task creation.
 * @returns Scoped task cards, honest storage feedback, and an accessible creation dialog.
 */
function TaskList() {
    const router = useRouter()
    const [tasks, setTasks] = useState<PersonalTask[]>([])
    const [agents, setAgents] = useState<AgentDefinition[]>([])
    const [status, setStatus] = useState<ChatStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [reload, setReload] = useState(0)
    const [view, setView] = useState<TaskView>('pending')
    const [query, setQuery] = useState('')
    const [mutationError, setMutationError] = useState('')
    const [mutationNotice, setMutationNotice] = useState('')
    const [changingId, setChangingId] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const openerRef = useRef<HTMLButtonElement>(null)
    const mutationBusy = useRef(false)
    const pendingCount = tasks.filter(task => task.task.status !== 'completed').length
    const completedCount = tasks.length - pendingCount
    const search = query.trim().toLocaleLowerCase()
    const visible = tasks.filter(
        task =>
            (view === 'completed') === (task.task.status === 'completed') &&
            `${task.title} ${task.task.goal}`.toLocaleLowerCase().includes(search)
    )

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Establishes the signed identity before reading task and agent collections.
         * @returns A promise settled after the current user's records are loaded.
         */
        async function load() {
            try {
                const connection = await getChatStatus(controller.signal)
                const [items, profiles] = await Promise.all([listTasks(controller.signal), listAgents(controller.signal)])
                if (controller.signal.aborted) return
                setTasks(recentTasks(items))
                setAgents(profiles)
                setStatus(connection)
                setLoadError('')
            } catch (error) {
                if (!controller.signal.aborted) setLoadError(errorMessage(error))
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        void load()
        return () => controller.abort()
    }, [reload])

    /**
     * Reloads the collection after an explicit failed-load retry.
     * @returns Nothing; switches back to loading feedback.
     */
    function reloadTasks() {
        setLoading(true)
        setLoadError('')
        setReload(value => value + 1)
    }

    /**
     * Opens the shared creation flow with its previously unsaved input.
     * @returns Nothing; makes the task creation dialog visible.
     */
    function openCreation() {
        setDialogOpen(true)
    }

    /**
     * Closes the shared creation dialog and restores keyboard focus.
     * @returns Nothing; returns to the task collection.
     */
    function closeCreation() {
        setDialogOpen(false)
        openerRef.current?.focus()
    }

    /**
     * Opens the stable task after the shared creation flow confirms persistence.
     * @param saved - Complete task returned by the API.
     * @returns Nothing; updates the collection and navigates to its detail.
     */
    function createdTask(saved: PersonalTask) {
        setTasks(current => recentTasks([saved, ...current.filter(task => task.id !== saved.id)]))
        setDialogOpen(false)
        router.push(`/inbox/${encodeURIComponent(saved.id)}`)
    }

    /**
     * Completes or restores a task only after the server confirms the change.
     * @param task - Task whose completion control was activated.
     * @returns A promise settled after the collection is updated or its error is shown.
     */
    async function toggleCompleted(task: PersonalTask) {
        if (mutationBusy.current || task.activeRequestId) return
        mutationBusy.current = true
        setChangingId(task.id)
        setMutationError('')
        setMutationNotice('')
        try {
            const saved = await updateTaskStatus(task.id, task.task.status === 'completed' ? { restore: true } : { status: 'completed' })
            setTasks(current => recentTasks(current.map(item => (item.id === saved.id ? saved : item))))
            setMutationNotice(`已${saved.task.status === 'completed' ? '完成' : '恢复'}任务：${saved.title}。`)
        } catch (error) {
            setMutationError(errorMessage(error))
        } finally {
            mutationBusy.current = false
            setChangingId(null)
        }
    }

    if (loading || loadError) return <LoadFeedback error={loadError} onRetry={reloadTasks} />

    return (
        <section className={styles.page}>
            <header className={styles.listHeader}>
                <div>
                    <div className={styles.eyebrow}>
                        <ClipboardList size={16} aria-hidden="true" /> PERSONAL TASKS
                    </div>
                    <h1>个人任务</h1>
                    <p>给工作一个明确的目标，和 Agent 一起推进。</p>
                </div>
                <button ref={openerRef} type="button" className={styles.primaryButton} onClick={openCreation}>
                    <Plus size={16} aria-hidden="true" />
                    新建任务
                </button>
            </header>
            {status?.storage === 'memory' && (
                <p className={styles.storageNotice}>当前为临时存储：刷新和返回页面会保留记录，重启服务会清空任务及对话。</p>
            )}
            <div className={styles.toolbar}>
                <div className={styles.views} role="group" aria-label="任务视图">
                    <button
                        type="button"
                        className={view === 'pending' ? styles.activeView : ''}
                        aria-pressed={view === 'pending'}
                        onClick={() => setView('pending')}
                    >
                        待办<span>{pendingCount}</span>
                    </button>
                    <button
                        type="button"
                        className={view === 'completed' ? styles.activeView : ''}
                        aria-pressed={view === 'completed'}
                        onClick={() => setView('completed')}
                    >
                        已完成<span>{completedCount}</span>
                    </button>
                </div>
                <label className={styles.search}>
                    <Search size={16} aria-hidden="true" />
                    <span className="sr-only">搜索任务名称或目标</span>
                    <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称或目标" />
                </label>
                <button
                    type="button"
                    className={styles.refreshButton}
                    aria-label="刷新任务列表"
                    title="刷新任务列表"
                    disabled={Boolean(changingId)}
                    onClick={reloadTasks}
                >
                    <RotateCcw size={15} aria-hidden="true" />
                </button>
            </div>
            {mutationError && (
                <div className={styles.error} role="alert">
                    <p>{mutationError}</p>
                    <span>原状态已保留，可以再次点击完成或恢复。</span>
                </div>
            )}
            {mutationNotice && (
                <p className={styles.notice} role="status">
                    <Check size={14} aria-hidden="true" />
                    {mutationNotice}
                </p>
            )}
            {visible.length === 0 ? (
                <div className={styles.empty}>
                    <ClipboardList size={30} strokeWidth={1.3} aria-hidden="true" />
                    <h2>{search ? '没有找到相关任务' : view === 'completed' ? '还没有已完成的任务' : '从一个明确的目标开始'}</h2>
                    <p>
                        {search
                            ? '试试任务名称或目标中的其他关键词。'
                            : view === 'completed'
                              ? '确认工作完成后，标记完成的任务会显示在这里。'
                              : '创建任务，选好助手，再由你决定何时开始执行。'}
                    </p>
                    {search ? (
                        <button type="button" className={styles.secondaryButton} onClick={() => setQuery('')}>
                            清空搜索
                        </button>
                    ) : (
                        view === 'pending' && (
                            <button type="button" className={styles.secondaryButton} onClick={openCreation}>
                                <Plus size={15} aria-hidden="true" />
                                创建第一个任务
                            </button>
                        )
                    )}
                </div>
            ) : (
                <div className={`${styles.board} ${view === 'completed' ? styles.completedBoard : ''}`}>
                    {(view === 'completed' ? ['completed' as TaskStatus] : pendingStatuses).map(workStatus => (
                        <section className={styles.column} key={workStatus} aria-labelledby={`task-column-${workStatus}`}>
                            <h2 id={`task-column-${workStatus}`}>
                                <span className={styles.statusDot} data-status={workStatus} />
                                {statusLabels[workStatus]}
                                <span>{visible.filter(task => task.task.status === workStatus).length}</span>
                            </h2>
                            <div className={styles.cards}>
                                {visible
                                    .filter(task => task.task.status === workStatus)
                                    .map(task => (
                                        <article className={styles.card} key={task.id}>
                                            <button
                                                type="button"
                                                className={styles.completeControl}
                                                aria-label={`${task.task.status === 'completed' ? '恢复' : '完成'}任务：${task.title}`}
                                                title={
                                                    task.activeRequestId
                                                        ? '生成期间不能修改状态'
                                                        : task.task.status === 'completed'
                                                          ? '恢复任务'
                                                          : '标记完成'
                                                }
                                                disabled={Boolean(changingId) || Boolean(task.activeRequestId)}
                                                onClick={() => toggleCompleted(task)}
                                            >
                                                {changingId === task.id ? (
                                                    <LoaderCircle size={18} className={styles.spinner} aria-hidden="true" />
                                                ) : task.task.status === 'completed' ? (
                                                    <CircleCheck size={19} aria-hidden="true" />
                                                ) : (
                                                    <Circle size={19} aria-hidden="true" />
                                                )}
                                            </button>
                                            <Link href={`/inbox/${encodeURIComponent(task.id)}`} className={styles.cardLink}>
                                                <h3>{task.title}</h3>
                                                <p>{task.task.goal}</p>
                                                <div className={styles.cardMeta}>
                                                    <span>
                                                        <Bot size={13} aria-hidden="true" />
                                                        {task.agent.name}
                                                    </span>
                                                    <time dateTime={task.updatedAt}>{updatedLabel(task.updatedAt)}</time>
                                                </div>
                                                {task.activeRequestId && (
                                                    <span className={styles.runningLabel}>正在执行，结束后可修改状态</span>
                                                )}
                                                <span className={styles.openTask}>
                                                    打开任务
                                                    <ChevronRight size={13} aria-hidden="true" />
                                                </span>
                                            </Link>
                                        </article>
                                    ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
            <TaskCreationDialog open={dialogOpen} onClose={closeCreation} onCreated={createdTask} agents={agents} status={status} />
        </section>
    )
}

/**
 * Reuses one task creation form for the complete inbox and a specific project's atomic creation flow.
 * @param props - Dialog visibility, available agents, optional project context, and saved-task callbacks.
 * @returns An accessible persistent draft whose retries retain their original action identifier.
 */
export function TaskCreationDialog({
    open,
    onClose,
    onCreated,
    agents,
    status,
    projectId,
    projectName,
}: {
    open: boolean
    onClose: () => void
    onCreated: (task: PersonalTask) => void
    agents: AgentDefinition[]
    status: ChatStatus | null
    projectId?: string
    projectName?: string
}) {
    const [draft, setDraft] = useState<CreationDraft>({ title: '', goal: '', agentId: '' })
    const [fieldErrors, setFieldErrors] = useState<CreationErrors>({})
    const [createError, setCreateError] = useState('')
    const [creating, setCreating] = useState(false)
    const dialogRef = useRef<HTMLDialogElement>(null)
    const titleRef = useRef<HTMLInputElement>(null)
    const createAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const creatingNow = useRef(false)

    useEffect(() => {
        if (open) {
            dialogRef.current?.showModal()
            titleRef.current?.focus()
        } else dialogRef.current?.close()
    }, [open])

    /**
     * Closes an idle creation form and returns focus to its triggering action.
     * @returns Nothing; keeps the draft for the next opening.
     */
    function closeCreation() {
        if (creating) return
        dialogRef.current?.close()
        onClose()
    }

    /**
     * Validates a required creation field when keyboard focus leaves it.
     * @param field - Required title or goal field being checked.
     * @returns Nothing; updates that field's accessible inline error.
     */
    function validateCreationField(field: 'title' | 'goal') {
        const result = createTaskSchema.shape[field].safeParse(draft[field])
        setFieldErrors(current => ({ ...current, [field]: result.success ? undefined : result.error.issues[0]?.message }))
    }

    /**
     * Validates the creation draft and preserves a request identifier for safe retries.
     * @param event - Form submission from the creation dialog.
     * @returns A promise settled when the task is saved or a recoverable error is shown.
     */
    async function saveTask(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (creating || creatingNow.current) return
        const fingerprint = JSON.stringify({
            title: draft.title.trim(),
            goal: draft.goal.trim(),
            agentId: draft.agentId,
            projectId: projectId ?? '',
        })
        if (createAttempt.current?.fingerprint !== fingerprint) createAttempt.current = { fingerprint, requestId: crypto.randomUUID() }
        const input: CreateTask = {
            requestId: createAttempt.current.requestId,
            title: draft.title,
            goal: draft.goal,
            ...(draft.agentId ? { agentId: draft.agentId } : {}),
            ...(projectId ? { projectId } : {}),
        }
        const result = createTaskSchema.safeParse(input)
        if (!result.success) {
            const errors: CreationErrors = {}
            for (const issue of result.error.issues) {
                const field = issue.path[0] as keyof CreationErrors
                errors[field] ??= issue.message
            }
            setFieldErrors(errors)
            const first = errors.title ? 'task-create-title' : errors.goal ? 'task-create-goal' : 'task-create-agent'
            document.getElementById(first)?.focus()
            return
        }
        setFieldErrors({})
        setCreateError('')
        setCreating(true)
        creatingNow.current = true
        try {
            const saved = await createTask(result.data)
            dialogRef.current?.close()
            onCreated(saved)
        } catch (error) {
            setCreateError(errorMessage(error))
        } finally {
            setCreating(false)
            creatingNow.current = false
        }
    }

    return (
        <dialog
            ref={dialogRef}
            className={styles.dialog}
            aria-labelledby="task-create-heading"
            onCancel={event => {
                if (creating) event.preventDefault()
            }}
            onClose={closeCreation}
        >
            <header className={styles.dialogHeading}>
                <div>
                    <span className={styles.eyebrow}>NEW TASK</span>
                    <h2 id="task-create-heading">{projectId ? '在项目中新建任务' : '新建个人任务'}</h2>
                </div>
                <button type="button" className={styles.iconButton} aria-label="关闭新建任务" disabled={creating} onClick={closeCreation}>
                    <X size={19} aria-hidden="true" />
                </button>
            </header>
            <form onSubmit={saveTask} noValidate>
                <fieldset disabled={creating} className={styles.creationFields}>
                    <div className={styles.field}>
                        <label htmlFor="task-create-title">
                            任务名称 <span aria-hidden="true">*</span>
                        </label>
                        <input
                            ref={titleRef}
                            id="task-create-title"
                            name="title"
                            value={draft.title}
                            maxLength={120}
                            required
                            placeholder="例如：比较三个候选方案"
                            aria-invalid={Boolean(fieldErrors.title)}
                            aria-describedby={fieldErrors.title ? 'task-create-title-error' : undefined}
                            onChange={event => {
                                setDraft(current => ({ ...current, title: event.target.value }))
                                setCreateError('')
                            }}
                            onBlur={() => validateCreationField('title')}
                        />
                        {fieldErrors.title && (
                            <p className={styles.fieldError} id="task-create-title-error">
                                {fieldErrors.title}
                            </p>
                        )}
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="task-create-goal">
                            任务目标 <span aria-hidden="true">*</span>
                        </label>
                        <textarea
                            id="task-create-goal"
                            name="goal"
                            value={draft.goal}
                            rows={6}
                            maxLength={32000}
                            required
                            placeholder="说明你想解决的问题、已有背景，以及希望得到的结果。"
                            aria-invalid={Boolean(fieldErrors.goal)}
                            aria-describedby={fieldErrors.goal ? 'task-create-goal-error' : 'task-create-goal-hint'}
                            onChange={event => {
                                setDraft(current => ({ ...current, goal: event.target.value }))
                                setCreateError('')
                            }}
                            onBlur={() => validateCreationField('goal')}
                        />
                        <p className={styles.hint} id="task-create-goal-hint">
                            目标将作为首次执行的请求，后续可以在对话中补充背景。
                        </p>
                        {fieldErrors.goal && (
                            <p className={styles.fieldError} id="task-create-goal-error">
                                {fieldErrors.goal}
                            </p>
                        )}
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="task-create-agent">使用的 Agent</label>
                        <div className={styles.selectWrap}>
                            <select
                                id="task-create-agent"
                                value={draft.agentId}
                                onChange={event => setDraft(current => ({ ...current, agentId: event.target.value }))}
                            >
                                <option value="">通用助手 · {status?.model}</option>
                                {agents.map(agent => (
                                    <option value={agent.id} key={agent.id}>
                                        {agent.name} · {agent.modelId}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown size={15} aria-hidden="true" />
                        </div>
                        <p className={styles.hint}>任务会保留创建时的助手配置，之后编辑 Agent 不会改变它。</p>
                        {fieldErrors.agentId && <p className={styles.fieldError}>{fieldErrors.agentId}</p>}
                    </div>
                </fieldset>
                <p className={styles.creationNote}>
                    {projectId && <>任务将归入“{projectName || '当前项目'}”。</>}创建只保存任务。进入任务后，点击“开始执行”才会调用模型。
                </p>
                {createError && (
                    <div className={styles.error} role="alert">
                        <p>{createError}</p>
                        <span>输入已保留。直接重试不会重复创建同一个任务。</span>
                    </div>
                )}
                <div className={styles.dialogActions}>
                    <button type="button" className={styles.secondaryButton} disabled={creating} onClick={closeCreation}>
                        暂时取消
                    </button>
                    <button type="submit" className={styles.primaryButton} disabled={creating}>
                        {creating ? (
                            <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />
                        ) : (
                            <ArrowRight size={16} aria-hidden="true" />
                        )}
                        {creating ? '正在保存' : '创建任务'}
                    </button>
                </div>
            </form>
        </dialog>
    )
}

/**
 * Displays and executes one persisted task with its immutable goal and agent snapshot.
 * @param props - Stable task identifier supplied by the route.
 * @returns Work controls, durable history, and a recoverable streaming composer.
 */
function TaskDetail({ taskId }: { taskId: string }) {
    const [task, setTask] = useState<PersonalTask | null>(null)
    const [projects, setProjects] = useState<PersonalProject[]>([])
    const [projectTarget, setProjectTarget] = useState('')
    const [projectError, setProjectError] = useState('')
    const [projectNotice, setProjectNotice] = useState('')
    const [changingProject, setChangingProject] = useState(false)
    const [connection, setConnection] = useState<ChatStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [reload, setReload] = useState(0)
    const [draft, setDraft] = useState('')
    const [actionError, setActionError] = useState('')
    const [activeTurn, setActiveTurn] = useState<ActiveTurn | null>(null)
    const [changingStatus, setChangingStatus] = useState(false)
    const [remoteStopping, setRemoteStopping] = useState(false)
    const [pollVersion, setPollVersion] = useState(0)
    const [retry, setRetry] = useState<TaskAttempt | null>(null)
    const [notice, setNotice] = useState('')
    const running = useRef<{ controller: AbortController; attempt: TaskAttempt } | null>(null)
    const cancellation = useRef<Promise<PersonalTask> | null>(null)
    const statusBusy = useRef(false)
    const projectBusy = useRef(false)
    const mounted = useRef(true)
    const composerRef = useRef<HTMLTextAreaElement>(null)
    const endRef = useRef<HTMLDivElement>(null)
    const busy = Boolean(activeTurn || task?.activeRequestId)
    const completed = task?.task.status === 'completed'
    const currentProject = projects.find(project => project.id === task?.task.projectId)

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            running.current?.controller.abort()
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Establishes the identity before reading the stable task and its saved history.
         * @returns A promise settled after the task is loaded or its failure is visible.
         */
        async function load() {
            try {
                const status = await getChatStatus(controller.signal)
                const [saved, projectList] = await Promise.all([getTask(taskId, controller.signal), listProjects(controller.signal)])
                if (controller.signal.aborted) return
                setConnection(status)
                setTask(saved)
                setProjects(projectList)
                setProjectTarget(saved.task.projectId ?? '')
                setRetry(latestRetry(saved))
                setLoadError('')
                setDraft(current => current || readDraft(taskId))
            } catch (error) {
                if (!controller.signal.aborted) setLoadError(errorMessage(error))
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        void load()
        return () => controller.abort()
    }, [taskId, reload])

    useEffect(() => {
        if (!task?.activeRequestId || activeTurn || remoteStopping) return
        const controller = new AbortController()
        const timer = window.setTimeout(() => {
            getTask(taskId, controller.signal)
                .then(saved => {
                    if (!controller.signal.aborted) {
                        setTask(saved)
                        setRetry(latestRetry(saved))
                    }
                })
                .catch(error => {
                    if (!controller.signal.aborted) {
                        setActionError(errorMessage(error))
                        setPollVersion(value => value + 1)
                    }
                })
        }, 2000)
        return () => {
            window.clearTimeout(timer)
            controller.abort()
        }
    }, [task, activeTurn, remoteStopping, taskId, pollVersion])

    useEffect(() => {
        if (activeTurn) endRef.current?.scrollIntoView({ block: 'nearest' })
    }, [task?.messages, activeTurn])

    /**
     * Preserves text before it has been accepted by the task execution service.
     * @param value - Current supplemental message draft.
     * @returns Nothing; updates the local and session-persisted draft.
     */
    function updateDraft(value: string) {
        setDraft(value)
        rememberDraft(taskId, value)
    }

    /**
     * Reloads the task's actual saved state after an explicit connection retry.
     * @returns Nothing; starts a fresh read without changing the user's draft.
     */
    function reloadTask() {
        if (running.current || projectBusy.current) return
        setLoading(true)
        setLoadError('')
        setActionError('')
        setReload(value => value + 1)
    }

    /**
     * Applies validated stream updates to the current task while preserving its goal.
     * @param event - Incremental model output or a validated terminal task snapshot.
     * @param attempt - Stable request metadata associated with this execution.
     * @returns Nothing; updates messages and clears accepted supplemental text.
     */
    function applyEvent(event: TaskStreamEvent, attempt: TaskAttempt) {
        if (!mounted.current) return
        if (event.type === 'done' || event.type === 'cancelled') {
            setTask(event.conversation)
            setRetry(latestRetry(event.conversation))
            return
        }
        if (event.type === 'start') {
            const now = new Date().toISOString()
            setTask(current =>
                current
                    ? {
                          ...current,
                          activeRequestId: attempt.requestId,
                          task: { ...current.task, started: true, status: current.task.started ? current.task.status : 'in-progress' },
                          messages: [
                              ...current.messages.filter(message => message.requestId !== attempt.requestId),
                              {
                                  id: `${attempt.requestId}:user`,
                                  role: 'user',
                                  content: attempt.content,
                                  status: 'complete',
                                  requestId: attempt.requestId,
                                  createdAt: now,
                              },
                              {
                                  id: `${attempt.requestId}:assistant`,
                                  role: 'assistant',
                                  content: '',
                                  status: 'complete',
                                  requestId: attempt.requestId,
                                  createdAt: now,
                              },
                          ],
                      }
                    : current
            )
            if (attempt.kind === 'message')
                setDraft(current => {
                    if (current.trim() === attempt.content) {
                        rememberDraft(taskId, '')
                        return ''
                    }
                    return current
                })
            return
        }
        if (event.type !== 'delta' && event.type !== 'reasoning') return
        setTask(current =>
            current
                ? {
                      ...current,
                      messages: current.messages.map(message =>
                          message.id === `${attempt.requestId}:assistant`
                              ? event.type === 'delta'
                                  ? { ...message, content: message.content + event.text }
                                  : { ...message, reasoning: (message.reasoning ?? '') + event.text }
                              : message
                      ),
                  }
                : current
        )
    }

    /**
     * Confirms saved history after a disconnect, falling back when cancellation itself failed.
     * @returns The settled task or its latest server activity snapshot.
     * @throws Error when neither cancellation nor the task read can confirm saved state.
     */
    async function recoverTask(): Promise<PersonalTask> {
        const pending = cancellation.current
        if (!pending) return getTask(taskId)
        try {
            return await pending
        } catch {
            return getTask(taskId)
        }
    }

    /**
     * Executes the saved goal or one supplemental message using a stable request identifier.
     * @param attempt - Explicit retry metadata, or a new goal/message request when omitted.
     * @returns A promise settled after generation, recovery, or a visible recoverable failure.
     */
    async function execute(attempt?: TaskAttempt) {
        if (!task || running.current || task.activeRequestId || statusBusy.current || projectBusy.current || completed) return
        if (!connection?.configured) {
            setActionError('DeepSeek 尚未配置。请完成服务端配置，再重新载入任务。')
            return
        }
        const next: TaskAttempt = attempt ?? {
            kind: task.task.started ? 'message' : 'start',
            content: task.task.started ? draft.trim() : task.task.goal,
            requestId: crypto.randomUUID(),
        }
        if (!next.content.trim()) return
        const controller = new AbortController()
        running.current = { controller, attempt: next }
        cancellation.current = null
        setActiveTurn({ requestId: next.requestId, stopping: false })
        setActionError('')
        setNotice('')
        setRetry(null)
        let terminal = false
        let providerError = ''
        try {
            /**
             * Records terminal outcomes and forwards this execution's stream updates.
             * @param event - Parsed event emitted by the task client.
             * @returns Nothing; updates task history or captures a provider failure.
             */
            function receive(event: TaskStreamEvent) {
                if (event.type === 'done' || event.type === 'cancelled') terminal = true
                if (event.type === 'error') providerError = event.message
                applyEvent(event, next)
            }
            if (next.kind === 'start') await startTask(taskId, next.requestId, receive, controller.signal)
            else await streamTaskMessage(taskId, next.content, next.requestId, receive, controller.signal)
            if (providerError) throw new Error(providerError)
        } catch (error) {
            if (!mounted.current) return
            if (!controller.signal.aborted) setActionError(errorMessage(error))
            if (!terminal) {
                try {
                    const saved = await recoverTask()
                    if (!mounted.current) return
                    setTask(saved)
                    const accepted = saved.messages.some(message => message.role === 'user' && message.requestId === next.requestId)
                    setRetry(latestRetry(saved) ?? (!accepted ? next : null))
                    if (next.kind === 'message' && !accepted)
                        setDraft(current => {
                            const value = current || next.content
                            rememberDraft(taskId, value)
                            return value
                        })
                    if (controller.signal.aborted) setNotice(stopNotice(saved, next.requestId))
                } catch {
                    setRetry(next)
                    setActionError('连接已中断，暂时无法确认保存结果。输入与请求标识已保留，可以重试或重新载入。')
                    setTask(current => (current ? { ...current, activeRequestId: undefined } : current))
                }
            }
        } finally {
            if (running.current?.controller === controller) {
                running.current = null
                cancellation.current = null
                if (mounted.current) setActiveTurn(null)
            }
        }
    }

    /**
     * Stops the matching active turn and confirms the persisted partial result.
     * @returns A promise settled when cancellation is acknowledged or an error is visible.
     */
    async function stop() {
        const requestId = activeTurn?.requestId ?? task?.activeRequestId
        if (!requestId || activeTurn?.stopping || remoteStopping) return
        setActionError('')
        if (running.current) {
            setActiveTurn({ requestId, stopping: true })
            const pending = cancelTask(taskId, requestId)
            void pending.catch(() => undefined)
            cancellation.current = pending
            running.current.controller.abort()
            return
        }
        setRemoteStopping(true)
        try {
            const saved = await cancelTask(taskId, requestId)
            setTask(saved)
            setRetry(latestRetry(saved))
            setNotice(stopNotice(saved, requestId))
        } catch (error) {
            setActionError(errorMessage(error))
        } finally {
            setRemoteStopping(false)
        }
    }

    /**
     * Saves an explicit work-state change without optimistic state replacement.
     * @param input - Requested work state or restore instruction.
     * @returns A promise settled after the server confirms or rejects the mutation.
     */
    async function changeStatus(input: UpdateTaskStatus) {
        if (!task || busy || statusBusy.current || projectBusy.current) return
        statusBusy.current = true
        setChangingStatus(true)
        setActionError('')
        setNotice('')
        try {
            const saved = await updateTaskStatus(taskId, input)
            setTask(saved)
            setRetry(latestRetry(saved))
            setNotice(input && 'restore' in input ? '已恢复任务，可以继续原来的对话。' : `任务已设为${statusLabels[saved.task.status]}。`)
        } catch (error) {
            setActionError(errorMessage(error))
        } finally {
            statusBusy.current = false
            setChangingStatus(false)
        }
    }

    /**
     * Saves one confirmed project membership change without replacing task context optimistically.
     * @param event - Membership form submission for moving or removing the task.
     * @returns A promise settled after saved membership or nearby recoverable failure feedback.
     */
    async function changeProject(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!task || busy || statusBusy.current || projectBusy.current || projectTarget === (task.task.projectId ?? '')) return
        projectBusy.current = true
        setChangingProject(true)
        setProjectError('')
        setProjectNotice('')
        try {
            const saved = await updateTaskProject(taskId, { projectId: projectTarget || null })
            setTask(saved)
            setProjectTarget(saved.task.projectId ?? '')
            setRetry(latestRetry(saved))
            const project = projects.find(item => item.id === saved.task.projectId)
            setProjectNotice(
                saved.task.projectId
                    ? `已归入“${project?.name ?? '项目'} · ${saved.task.projectId.slice(0, 8)}”。`
                    : '已移出项目，任务仍保留在个人任务中。'
            )
        } catch (error) {
            setProjectError(errorMessage(error))
        } finally {
            projectBusy.current = false
            setChangingProject(false)
        }
    }

    if (loading || loadError || !task) return <LoadFeedback error={loadError} onRetry={reloadTask} />

    return (
        <section className={`${styles.page} ${styles.detailPage}`}>
            <Link href="/inbox" className={styles.backLink}>
                <ArrowLeft size={15} aria-hidden="true" />
                个人任务
            </Link>
            <header className={styles.detailHeader}>
                <div>
                    <h1>{task.title}</h1>
                    <div className={styles.taskIdentity}>
                        <span>
                            <Bot size={14} aria-hidden="true" />
                            {task.agent.name}
                        </span>
                        <span>{task.agent.modelId}</span>
                        <span>创建时的助手配置</span>
                    </div>
                </div>
                <div className={styles.statusActions}>
                    <label className={styles.selectWrap}>
                        <span className="sr-only">任务工作状态</span>
                        <select
                            value={task.task.status}
                            disabled={busy || changingStatus || changingProject || completed}
                            aria-describedby="task-status-hint"
                            onChange={event => changeStatus({ status: event.target.value as TaskStatus })}
                        >
                            {Object.entries(statusLabels).map(([value, label]) => (
                                <option value={value} key={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={14} aria-hidden="true" />
                    </label>
                    {completed ? (
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={busy || changingStatus || changingProject}
                            onClick={() => changeStatus({ restore: true })}
                        >
                            <RotateCcw size={15} aria-hidden="true" />
                            {changingStatus ? '正在恢复' : '恢复任务'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={busy || changingStatus || changingProject}
                            onClick={() => changeStatus({ status: 'completed' })}
                        >
                            <CheckCheck size={16} aria-hidden="true" />
                            {changingStatus ? '正在保存' : '标记完成'}
                        </button>
                    )}
                </div>
            </header>
            <p id="task-status-hint" className={styles.statusHint}>
                {busy
                    ? '正在生成回复，停止或等待结束后才能修改工作状态。'
                    : completed
                      ? '任务已完成，历史仍可查看。恢复任务后可继续执行。'
                      : '工作状态由你决定；一次回复结束不会自动完成任务。'}
            </p>
            {connection?.storage === 'memory' && (
                <p className={styles.storageNotice}>当前为临时存储：刷新和返回页面会保留记录，重启服务会清空任务及对话。</p>
            )}
            <section className={styles.projectMembership} aria-label="任务项目归属">
                <div className={styles.currentProject}>
                    <span>所属项目</span>
                    {task.task.projectId ? (
                        <Link href={`/projects/${encodeURIComponent(task.task.projectId)}`}>
                            <Folder size={15} aria-hidden="true" />
                            {currentProject?.name ?? '项目'}
                            <span>· {task.task.projectId.slice(0, 8)}</span>
                            <ArrowRight size={13} aria-hidden="true" />
                        </Link>
                    ) : (
                        <strong>未归组</strong>
                    )}
                </div>
                <form onSubmit={changeProject}>
                    <label htmlFor="task-project-target">移动到项目</label>
                    <div className={styles.projectControls}>
                        <div className={styles.selectWrap}>
                            <select
                                id="task-project-target"
                                value={projectTarget}
                                disabled={busy || changingStatus || changingProject}
                                aria-describedby="task-project-hint"
                                onChange={event => {
                                    setProjectTarget(event.target.value)
                                    setProjectError('')
                                    setProjectNotice('')
                                }}
                            >
                                <option value="">未归组</option>
                                {projects.map(project => (
                                    <option value={project.id} key={project.id}>
                                        {project.name} · {project.description ? `${project.description.slice(0, 30)} · ` : ''}
                                        {project.id.slice(0, 8)}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown size={14} aria-hidden="true" />
                        </div>
                        <button
                            type="submit"
                            className={styles.secondaryButton}
                            disabled={busy || changingStatus || changingProject || projectTarget === (task.task.projectId ?? '')}
                        >
                            {changingProject ? (
                                <LoaderCircle className={styles.spinner} size={14} aria-hidden="true" />
                            ) : (
                                <Check size={14} aria-hidden="true" />
                            )}
                            {changingProject ? '正在保存' : '保存归属'}
                        </button>
                    </div>
                    <p id="task-project-hint" className={styles.hint}>
                        {busy
                            ? '正在生成回复，停止或等待结束后才能修改项目归属。'
                            : '移动会保留本任务的目标、助手、状态和对话。选择“未归组”可移出项目。'}
                    </p>
                </form>
                {projectError && (
                    <div className={styles.error} role="alert">
                        <p>{projectError}</p>
                        <span>当前仍展示上次确认的归属，可以重试或重新载入确认。</span>
                    </div>
                )}
                {projectNotice && (
                    <p className={styles.notice} role="status">
                        <Check size={14} aria-hidden="true" />
                        {projectNotice}
                    </p>
                )}
            </section>
            <details className={styles.goal} open>
                <summary>
                    <ClipboardList size={16} aria-hidden="true" />
                    任务目标
                    <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <p>{task.task.goal}</p>
            </details>
            <details className={styles.agentSnapshot}>
                <summary>
                    查看助手配置
                    <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <p>
                    工具：
                    {task.agent.toolIds.length
                        ? task.agent.toolIds.map(id => (id === 'calculator' ? '计算器' : '当前时间')).join('、')
                        : '未启用工具'}
                </p>
                <p className={styles.frozenPrompt}>{task.agent.systemPrompt || '通用助手默认提示词'}</p>
            </details>
            <div className={styles.conversation} aria-label="任务对话">
                <div className={styles.conversationHeading}>
                    <h2>任务对话</h2>
                    <span>{busy ? '正在执行' : completed ? '已完成 · 只读' : task.task.started ? '继续同一上下文' : '等待开始'}</span>
                </div>
                {task.messages.length === 0 && (
                    <div className={styles.conversationEmpty}>
                        <Bot size={27} strokeWidth={1.4} aria-hidden="true" />
                        <p>{task.task.started ? '可以继续补充任务背景。' : '任务已保存。准备好后，让 Agent 从目标开始工作。'}</p>
                    </div>
                )}
                <div className={styles.messages}>
                    {task.messages.map(message => (
                        <article key={message.id} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
                            <div className={styles.messageLabel}>
                                {message.role === 'user' ? '你' : task.agent.name}
                                {message.kind === 'opening' && <span>开场消息</span>}
                                {activeTurn && message.requestId === activeTurn.requestId && message.role === 'assistant' && (
                                    <span>{activeTurn.stopping ? '正在停止…' : '正在回复…'}</span>
                                )}
                            </div>
                            {message.reasoning && (
                                <details className={styles.reasoning}>
                                    <summary>思考过程</summary>
                                    <p>{message.reasoning}</p>
                                </details>
                            )}
                            {message.content ? (
                                <div className={styles.markdown}>
                                    <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                                </div>
                            ) : activeTurn && message.requestId === activeTurn.requestId ? (
                                <span className={styles.thinking} role="status">
                                    正在思考…
                                </span>
                            ) : (
                                <p className={styles.hint}>{message.status === 'error' ? '回答未完成。' : '未生成更多内容。'}</p>
                            )}
                            {message.status !== 'complete' && (
                                <span className={styles.messageStatus}>
                                    {message.status === 'cancelled' ? '已停止 · 部分回复' : '生成失败 · 回答未完成'}
                                </span>
                            )}
                        </article>
                    ))}
                    <div ref={endRef} />
                </div>
                {actionError && (
                    <div className={styles.error} role="alert">
                        <p>{actionError}</p>
                        <button
                            type="button"
                            className={styles.textLink}
                            disabled={Boolean(activeTurn) || changingStatus}
                            onClick={reloadTask}
                        >
                            重新载入任务
                            <RotateCcw size={13} aria-hidden="true" />
                        </button>
                    </div>
                )}
                {notice && (
                    <p className={styles.notice} role="status">
                        <Check size={14} aria-hidden="true" />
                        {notice}
                    </p>
                )}
                {retry && !busy && !completed && (
                    <div className={styles.retryBar}>
                        <span>最近一次{retry.kind === 'start' ? '目标执行' : '补充请求'}未完成，可以沿用原请求重试。</span>
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={changingStatus || changingProject || !connection?.configured}
                            onClick={() => execute(retry)}
                        >
                            <RotateCcw size={14} aria-hidden="true" />
                            重试最近请求
                        </button>
                    </div>
                )}
                {!connection?.configured && !completed && (
                    <div className={styles.error} role="status">
                        <p>DeepSeek 尚未配置。任务已保存，完成服务端配置后可继续。</p>
                        <button type="button" className={styles.textLink} disabled={busy} onClick={reloadTask}>
                            重新检查连接
                            <RotateCcw size={13} aria-hidden="true" />
                        </button>
                    </div>
                )}
                {completed ? (
                    <div className={styles.completedNotice}>
                        <CircleCheck size={19} aria-hidden="true" />
                        <p>
                            任务已完成。
                            <br />
                            <span>恢复后可以在原上下文中继续。</span>
                        </p>
                    </div>
                ) : !task.task.started ? (
                    <div className={styles.startBlock}>
                        <p>
                            点击开始，将任务目标交给 {task.agent.name}。<span>创建和查看任务不会自动调用模型。</span>
                        </p>
                        {busy ? (
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                disabled={Boolean(activeTurn?.stopping || remoteStopping)}
                                onClick={stop}
                            >
                                <Square size={14} aria-hidden="true" />
                                {activeTurn?.stopping || remoteStopping ? '正在停止' : '停止执行'}
                            </button>
                        ) : (
                            <button
                                type="button"
                                className={styles.primaryButton}
                                disabled={changingStatus || changingProject || !connection?.configured}
                                onClick={() => execute()}
                            >
                                <Play size={15} aria-hidden="true" />
                                开始执行
                            </button>
                        )}
                    </div>
                ) : (
                    <form
                        className={styles.composer}
                        onSubmit={event => {
                            event.preventDefault()
                            void execute()
                        }}
                    >
                        <label htmlFor="task-message">补充消息</label>
                        <textarea
                            id="task-message"
                            ref={composerRef}
                            value={draft}
                            maxLength={32000}
                            rows={3}
                            placeholder={busy ? 'Agent 正在回复，也可以先整理下一条消息…' : '补充背景、回答问题，或继续追问…'}
                            onChange={event => updateDraft(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                                    event.preventDefault()
                                    void execute()
                                }
                            }}
                        />
                        <div className={styles.composerFooter}>
                            <span>
                                {busy ? '正在生成回复，草稿会保留。' : 'Enter 发送 · Shift + Enter 换行'}
                                {draft.length > 30000 && ` · ${draft.length.toLocaleString()} / 32,000`}
                            </span>
                            {busy ? (
                                <button
                                    type="button"
                                    className={styles.stopButton}
                                    disabled={Boolean(activeTurn?.stopping || remoteStopping)}
                                    onClick={stop}
                                >
                                    <Square size={14} aria-hidden="true" />
                                    {activeTurn?.stopping || remoteStopping ? '正在停止' : '停止生成'}
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    className={styles.sendButton}
                                    aria-label="发送补充消息"
                                    disabled={!draft.trim() || changingStatus || changingProject || !connection?.configured}
                                >
                                    <ArrowUp size={18} aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    </form>
                )}
            </div>
        </section>
    )
}
