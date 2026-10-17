'use client'

import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Bot,
    Check,
    ChevronDown,
    ClipboardList,
    Layers,
    LoaderCircle,
    Plus,
    RotateCcw,
    Save,
    Search,
    Trash2,
    X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
    AgentDefinition,
    ChatStatus,
    LaunchTemplate,
    ProjectTemplate,
    ProjectInput,
    TemplateInput,
    TemplateLaunchResult,
    TemplateTask,
} from '@ai-harness/contracts'
import { launchTemplateSchema, templateInputSchema } from '@ai-harness/contracts'
import { listAgents } from '../lib/agent-client'
import { getChatStatus } from '../lib/chat-client'
import { createTemplate, getTemplate, launchTemplate, listTemplates, updateTemplate } from '../lib/template-client'
import styles from './template-workspace.module.css'

type FieldErrors = Record<string, string | undefined>

/**
 * Converts an unknown template request failure into visible safe feedback.
 * @param error - Failure thrown by the typed template client.
 * @returns A human-readable explanation without credentials or transport internals.
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '模板服务暂时无法连接，请重试。'
}

/**
 * Detects an API conflict that requires an explicit read before another write.
 * @param error - Failure returned by the version-aware template API.
 * @returns Whether the server rejected the action with a conflict status.
 */
function isConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 409)
}

/**
 * Copies only editable fields while preserving each task item's stable identifier.
 * @param template - Saved template version to edit or preview.
 * @returns An independent input object without server-owned metadata.
 */
function templateInput(template: ProjectTemplate): TemplateInput {
    return { name: template.name, description: template.description, tasks: template.tasks.map(task => ({ ...task })) }
}

/**
 * Creates an empty task blueprint with an identity that survives reordering.
 * @returns A new blank task item for the client-side draft.
 */
function newTask(): TemplateTask {
    return { id: crypto.randomUUID(), title: '', goal: '' }
}

/**
 * Validates a template and associates nested errors with stable task identities.
 * @param input - Current editable task-template draft.
 * @returns First inline error for each field, plus aggregate task-list errors.
 */
function validateInput(input: TemplateInput): FieldErrors {
    const result = templateInputSchema.safeParse(input)
    if (result.success) return {}
    const errors: FieldErrors = {}
    for (const issue of result.error.issues) {
        const path =
            issue.path[0] === 'tasks' && typeof issue.path[1] === 'number' && issue.path.length > 2
                ? `tasks.${input.tasks[issue.path[1]]?.id}.${String(issue.path[2])}`
                : issue.path.join('.')
        const message =
            issue.path[0] === 'name' || issue.path[0] === 'description' ? issue.message.replaceAll('项目', '模板') : issue.message
        errors[path] ??= message
    }
    return errors
}

/**
 * Distinguishes saved agents by model and identity when names repeat.
 * @param agentId - Referenced saved agent, or absent for the system assistant.
 * @param agents - Current identity's accessible agent collection.
 * @param model - Current deployment's public default model identifier.
 * @returns A truthful choice label without implying that configuration is frozen yet.
 */
function agentLabel(agentId: string | undefined, agents: AgentDefinition[], model: string): string {
    if (!agentId) return `通用助手 · ${model}`
    const agent = agents.find(item => item.id === agentId)
    return agent ? `${agent.name} · ${agent.modelId} · ${agent.id.slice(0, 8)}` : `助手暂不可用 · ${agentId.slice(0, 8)}`
}

/**
 * Formats the persisted template timestamp for the Chinese workspace.
 * @param value - ISO timestamp supplied by the service.
 * @returns A concise month, day, hour, and minute.
 */
function updatedLabel(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(
        new Date(value)
    )
}

/**
 * Chooses template collection or editor state according to the application route.
 * @param props - Editor mode and optional stable saved template identifier.
 * @returns Real personal templates or their full-page editor.
 */
export function TemplateWorkspace({ editing = false, templateId }: { editing?: boolean; templateId?: string }) {
    return editing ? <TemplateEditor key={templateId ?? 'new'} templateId={templateId} /> : <TemplateList />
}

/**
 * Displays loading and recoverable failures without creating demonstration templates.
 * @param props - Current load error and explicit retry callback.
 * @returns Accessible feedback and collection navigation after failure.
 */
function LoadFeedback({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div className={styles.feedback} role={error ? 'alert' : 'status'}>
            {error ? <Layers size={29} aria-hidden="true" /> : <LoaderCircle size={23} className={styles.spinner} aria-hidden="true" />}
            <h1>{error ? '暂时无法载入模板' : '正在载入模板'}</h1>
            <p>{error || '正在读取当前工作区的任务模板。'}</p>
            {error && (
                <>
                    <button type="button" className={styles.secondaryButton} onClick={onRetry}>
                        <RotateCcw size={15} aria-hidden="true" />
                        重新载入
                    </button>
                    <Link href="/templates" className={styles.textLink}>
                        返回任务模板
                        <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                </>
            )}
        </div>
    )
}

/**
 * Lists saved personal templates with exact name/description search and stable links.
 * @returns The complete current user's template collection with clear empty and error states.
 */
function TemplateList() {
    const [templates, setTemplates] = useState<ProjectTemplate[]>([])
    const [status, setStatus] = useState<ChatStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [failure, setFailure] = useState('')
    const [reload, setReload] = useState(0)
    const [query, setQuery] = useState('')
    const search = query.trim().toLocaleLowerCase()
    const visible = templates.filter(template => `${template.name} ${template.description}`.toLocaleLowerCase().includes(search))

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Establishes the signed identity before loading its real template collection.
         * @returns A promise settled when the list has loaded or an error is displayed.
         */
        async function load() {
            try {
                const connection = await getChatStatus(controller.signal)
                const items = await listTemplates(controller.signal)
                if (controller.signal.aborted) return
                setStatus(connection)
                setTemplates(
                    [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
                )
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
     * Reloads the real collection after a deliberate refresh or failed request.
     * @returns Nothing; starts truthful loading feedback.
     */
    function refresh() {
        setLoading(true)
        setFailure('')
        setReload(value => value + 1)
    }

    if (loading || failure) return <LoadFeedback error={failure} onRetry={refresh} />
    return (
        <section className={styles.page}>
            <Link href="/projects" className={styles.backLink}>
                <ArrowLeft size={15} aria-hidden="true" />
                个人项目
            </Link>
            <header className={styles.heading}>
                <div>
                    <div className={styles.eyebrow}>
                        <Layers size={16} aria-hidden="true" /> TASK TEMPLATES
                    </div>
                    <h1>任务模板</h1>
                    <p>把常用的工作目标整理成清单，下次从这里开始。</p>
                </div>
                <Link href="/templates/new" className={styles.primaryButton}>
                    <Plus size={16} aria-hidden="true" />
                    新建模板
                </Link>
            </header>
            {status?.storage === 'memory' && (
                <p className={styles.storageNotice}>当前为临时存储：刷新和返回页面会保留记录，重启服务会清空模板、项目、任务及对话。</p>
            )}
            <div className={styles.toolbar}>
                <span>{templates.length} 个模板</span>
                <label className={styles.search}>
                    <Search size={16} aria-hidden="true" />
                    <span className="sr-only">搜索模板名称或说明</span>
                    <input type="search" value={query} placeholder="搜索名称或说明" onChange={event => setQuery(event.target.value)} />
                </label>
                <button type="button" className={styles.iconButton} aria-label="刷新模板列表" title="刷新模板列表" onClick={refresh}>
                    <RotateCcw size={16} aria-hidden="true" />
                </button>
            </div>
            {visible.length === 0 ? (
                <div className={styles.empty}>
                    <ClipboardList size={32} strokeWidth={1.4} aria-hidden="true" />
                    <h2>{search ? '没有找到相关模板' : '从一份常用任务清单开始'}</h2>
                    <p>{search ? '试试模板名称或说明中的其他关键词。' : '保存任务目标与助手选择，预览后再生成一个新的个人项目。'}</p>
                    {search ? (
                        <button type="button" className={styles.secondaryButton} onClick={() => setQuery('')}>
                            清空搜索
                        </button>
                    ) : (
                        <Link href="/templates/new" className={styles.secondaryButton}>
                            <Plus size={15} aria-hidden="true" />
                            创建第一个模板
                        </Link>
                    )}
                </div>
            ) : (
                <div className={styles.templateGrid}>
                    {visible.map(template => (
                        <Link key={template.id} href={`/templates/${encodeURIComponent(template.id)}`} className={styles.templateCard}>
                            <div className={styles.cardTop}>
                                <Layers size={21} strokeWidth={1.5} aria-hidden="true" />
                                <span>v{template.version}</span>
                            </div>
                            <h2>{template.name}</h2>
                            <p>{template.description || '打开模板，查看完整的任务目标与助手选择。'}</p>
                            <div className={styles.cardMeta}>
                                <span>
                                    {template.tasks.length} 个任务 · 编号 {template.id.slice(0, 8)}
                                </span>
                                <time dateTime={template.updatedAt}>{updatedLabel(template.updatedAt)}</time>
                            </div>
                            <span className={styles.openTemplate}>
                                编辑与启动预览
                                <ArrowRight size={14} aria-hidden="true" />
                            </span>
                        </Link>
                    ))}
                </div>
            )}
        </section>
    )
}

/**
 * Shows full ordered task goals and current assistant choices for an identified blueprint.
 * @param props - Complete task items, accessible agents, and current default model label.
 * @returns A complete readable task list without implying dependencies or automatic execution.
 */
function TaskPreview({ tasks, agents, model }: { tasks: TemplateTask[]; agents: AgentDefinition[]; model: string }) {
    return (
        <ol className={styles.previewTasks}>
            {tasks.map((task, index) => (
                <li key={task.id}>
                    <div className={styles.previewTaskHeading}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <h3>{task.title.trim() || '填写任务名称'}</h3>
                    </div>
                    <p className={styles.previewGoal}>{task.goal.trim() || '填写这项任务的目标与希望获得的结果。'}</p>
                    <span className={styles.agentChoice}>
                        <Bot size={13} aria-hidden="true" />
                        {agentLabel(task.agentId, agents, model)}
                    </span>
                </li>
            ))}
        </ol>
    )
}

/**
 * Creates or edits a stable ordered task blueprint with explicit version-conflict recovery.
 * @param props - Existing template identifier, or absent for an unsaved new draft.
 * @returns The complete editor, real-time draft preview, and saved-version launch action.
 */
function TemplateEditor({ templateId }: { templateId?: string }) {
    const router = useRouter()
    const [template, setTemplate] = useState<ProjectTemplate | null>(null)
    const [draft, setDraft] = useState<TemplateInput | null>(null)
    const [baseline, setBaseline] = useState<TemplateInput | null>(null)
    const [agents, setAgents] = useState<AgentDefinition[]>([])
    const [status, setStatus] = useState<ChatStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [reload, setReload] = useState(0)
    const [errors, setErrors] = useState<FieldErrors>({})
    const [saveError, setSaveError] = useState('')
    const [conflict, setConflict] = useState(false)
    const [notice, setNotice] = useState('')
    const [saving, setSaving] = useState(false)
    const [launching, setLaunching] = useState(false)
    const [launchDraft, setLaunchDraft] = useState<ProjectInput | null>(null)
    const [reloadConfirm, setReloadConfirm] = useState(false)
    const savingNow = useRef(false)
    const creation = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const launchCreation = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const launchOpener = useRef<HTMLButtonElement>(null)
    const dirty = Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline))
    const totalGoalLength = draft?.tasks.reduce((total, task) => total + task.goal.trim().length, 0) ?? 0

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Establishes the signed identity before reading a version and its assistant choices.
         * @returns A promise settled after a complete editable draft has been initialized.
         */
        async function load() {
            try {
                const connection = await getChatStatus(controller.signal)
                const [saved, choices] = await Promise.all([
                    templateId ? getTemplate(templateId, controller.signal) : Promise.resolve(null),
                    listAgents(controller.signal),
                ])
                if (controller.signal.aborted) return
                const input = saved ? templateInput(saved) : { name: '', description: '', tasks: [newTask()] }
                setStatus(connection)
                setAgents(choices)
                setTemplate(saved)
                setDraft(input)
                setBaseline(input)
                setLoadError('')
                setErrors({})
                setSaveError('')
                setConflict(false)
                setReloadConfirm(false)
            } catch (error) {
                if (!controller.signal.aborted) setLoadError(errorMessage(error))
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }
        void load()
        return () => controller.abort()
    }, [templateId, reload])

    useEffect(() => {
        if (!dirty) return
        /**
         * Warns before a browser refresh would discard an unsaved template draft.
         * @param event - Browser navigation event.
         * @returns Nothing; requests the browser's native unsaved-change warning.
         */
        function protectDraft(event: BeforeUnloadEvent) {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', protectDraft)
        return () => window.removeEventListener('beforeunload', protectDraft)
    }, [dirty])

    /**
     * Loads the latest version only after the user has chosen to discard the current draft.
     * @returns Nothing; retains creation-action metadata while reading fresh server state.
     */
    function reloadTemplate() {
        if (savingNow.current) return
        setLoading(true)
        setLoadError('')
        setReload(value => value + 1)
    }

    /**
     * Protects unsaved text before replacing it with the latest server version.
     * @returns Nothing; shows a local discard choice or refreshes a clean draft.
     */
    function requestReload() {
        if (dirty) setReloadConfirm(true)
        else reloadTemplate()
    }

    /**
     * Updates a top-level template field without discarding other form inputs.
     * @param field - Editable template name or description.
     * @param value - New text entered by the user.
     * @returns Nothing; updates the draft and clears stale save feedback.
     */
    function updateField(field: 'name' | 'description', value: string) {
        setDraft(current => (current ? { ...current, [field]: value } : current))
        setNotice('')
        setSaveError('')
    }

    /**
     * Updates one task while retaining its identity and ordered position.
     * @param id - Stable blueprint item identifier.
     * @param patch - Changed task text or assistant choice.
     * @returns Nothing; updates the draft and clears stale save feedback.
     */
    function updateTask(id: string, patch: Partial<Omit<TemplateTask, 'id'>>) {
        setDraft(current =>
            current ? { ...current, tasks: current.tasks.map(task => (task.id === id ? { ...task, ...patch } : task)) } : current
        )
        setNotice('')
        setSaveError('')
    }

    /**
     * Validates one field after focus leaves it using shared API rules.
     * @param field - Top-level or stable task-field error path.
     * @returns Nothing; updates that field's inline validation message.
     */
    function validateField(field: string) {
        if (!draft) return
        const next = validateInput(draft)
        setErrors(current => ({ ...current, [field]: next[field], tasks: next.tasks }))
    }

    /**
     * Appends one empty task up to the published eight-item limit.
     * @returns Nothing; preserves all existing item identities and draft content.
     */
    function addTask() {
        if (!draft || draft.tasks.length >= 8) return
        setDraft({ ...draft, tasks: [...draft.tasks, newTask()] })
        setNotice('')
    }

    /**
     * Removes a selected task while preserving the required last item.
     * @param id - Stable identifier of the task item to remove.
     * @returns Nothing; updates the draft without changing surviving identities.
     */
    function removeTask(id: string) {
        if (!draft || draft.tasks.length <= 1) return
        const tasks = draft.tasks.filter(task => task.id !== id)
        const next = { ...draft, tasks }
        setDraft(next)
        setErrors(current => ({
            ...Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`tasks.${id}.`))),
            tasks: validateInput(next).tasks,
        }))
        setNotice('')
        setSaveError('')
    }

    /**
     * Moves one existing task by a single position without changing its identity.
     * @param id - Stable identifier of the item being moved.
     * @param offset - Previous or next list position.
     * @returns Nothing; updates the displayed and persisted task order.
     */
    function moveTask(id: string, offset: -1 | 1) {
        if (!draft) return
        const tasks = [...draft.tasks]
        const from = tasks.findIndex(task => task.id === id)
        const to = from + offset
        if (from < 0 || to < 0 || to >= tasks.length) return
        ;[tasks[from], tasks[to]] = [tasks[to], tasks[from]]
        setDraft({ ...draft, tasks })
        setNotice('')
        setSaveError('')
    }

    /**
     * Persists a valid blueprint using its original creation action or read update version.
     * @param event - Template editor form submission.
     * @returns A promise settled after confirmed persistence or preserved-draft failure feedback.
     */
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!draft || savingNow.current) return
        const next = validateInput(draft)
        setErrors(next)
        if (Object.keys(next).length) {
            const first = Object.keys(next)[0]
            const parts = first.split('.')
            const id =
                parts[0] === 'tasks'
                    ? parts.length > 2
                        ? `template-task-${parts[1]}-${parts[2]}`
                        : 'template-tasks-heading'
                    : `template-${first}`
            document.getElementById(id)?.focus()
            setSaveError('请检查标记的字段后再保存模板。')
            return
        }
        const input = templateInputSchema.parse(draft)
        const fingerprint = JSON.stringify(input)
        if (creation.current?.fingerprint !== fingerprint) creation.current = { fingerprint, requestId: crypto.randomUUID() }
        savingNow.current = true
        setSaving(true)
        setSaveError('')
        setNotice('')
        try {
            const saved = template
                ? await updateTemplate(template.id, { ...input, version: template.version })
                : await createTemplate({ ...input, requestId: creation.current.requestId })
            const savedInput = templateInput(saved)
            setTemplate(saved)
            setDraft(savedInput)
            setBaseline(savedInput)
            setConflict(false)
            setNotice(`模板已保存 · v${saved.version}。`)
            if (!templateId) router.replace(`/templates/${encodeURIComponent(saved.id)}`)
        } catch (error) {
            setSaveError(errorMessage(error))
            if (isConflict(error)) setConflict(true)
        } finally {
            savingNow.current = false
            setSaving(false)
        }
    }

    /**
     * Applies an explicitly reread launch version while the underlying editor is clean.
     * @param saved - Latest complete version confirmed by the template service.
     * @returns Nothing; aligns the editor and its saved preview with the same version.
     */
    function reloadedForLaunch(saved: ProjectTemplate) {
        const input = templateInput(saved)
        setTemplate(saved)
        setDraft(input)
        setBaseline(input)
        setConflict(false)
        setErrors({})
    }

    /**
     * Returns focus to the saved-version launch action after closing its dialog.
     * @returns Nothing; keeps the editable template and its saved version intact.
     */
    function closeLaunch() {
        setLaunching(false)
        launchOpener.current?.focus()
    }

    /**
     * Opens the saved-version preview while retaining any previously failed launch fields.
     * @returns Nothing; initializes project fields only for the first opening.
     */
    function openLaunch() {
        if (!template || dirty || conflict || savingNow.current) return
        setLaunchDraft(current => current ?? { name: template.name, description: template.description })
        setLaunching(true)
    }

    /**
     * Retains one launch action across failed responses and closing or reopening its preview.
     * @param fingerprint - Normalized template, version, and new-project parameters.
     * @returns The existing action identifier or a new identifier after parameters change.
     */
    function launchRequestId(fingerprint: string): string {
        if (launchCreation.current?.fingerprint !== fingerprint) launchCreation.current = { fingerprint, requestId: crypto.randomUUID() }
        return launchCreation.current.requestId
    }

    /**
     * Opens the confirmed new project after every template task has been created.
     * @param result - Atomic project and original task identifiers returned by the API.
     * @returns Nothing; navigates only after a confirmed launch response.
     */
    function launchedProject(result: TemplateLaunchResult) {
        setLaunching(false)
        router.push(`/projects/${encodeURIComponent(result.project.id)}`)
    }

    if (loading || loadError || !draft) return <LoadFeedback error={loadError} onRetry={reloadTemplate} />
    return (
        <section className={styles.page}>
            <Link href="/templates" className={styles.backLink}>
                <ArrowLeft size={15} aria-hidden="true" />
                任务模板
            </Link>
            <header className={styles.heading}>
                <div>
                    <div className={styles.eyebrow}>
                        <Layers size={16} aria-hidden="true" />
                        {template ? `TEMPLATE · ${template.id.slice(0, 8)} · v${template.version}` : 'NEW TEMPLATE'}
                    </div>
                    <h1>{template ? '编辑任务模板' : '创建任务模板'}</h1>
                    <p>保存一份有序清单，准备好后再生成项目与独立任务。</p>
                </div>
                {template && (
                    <div className={styles.headingActions}>
                        <button type="button" className={styles.secondaryButton} disabled={saving} onClick={requestReload}>
                            <RotateCcw size={14} aria-hidden="true" />
                            读取最新版本
                        </button>
                        <button
                            ref={launchOpener}
                            type="button"
                            className={styles.primaryButton}
                            disabled={saving || dirty || conflict}
                            aria-describedby="template-launch-hint"
                            onClick={openLaunch}
                        >
                            启动预览
                            <ArrowRight size={15} aria-hidden="true" />
                        </button>
                    </div>
                )}
            </header>
            {status?.storage === 'memory' && (
                <p className={styles.storageNotice}>当前为临时存储：刷新和返回页面会保留记录，重启服务会清空模板、项目、任务及对话。</p>
            )}
            {template && (
                <p id="template-launch-hint" className={styles.hint}>
                    {conflict
                        ? '请明确重新读取最新版本，再检查并保存或启动。'
                        : dirty
                          ? '当前有未保存的更改。请先保存，再预览启动这个版本。'
                          : `启动预览将使用已保存版本 v${template.version}，不会自动执行模型。`}
                </p>
            )}
            {reloadConfirm && (
                <div className={styles.conflict} role="alert">
                    <p>重新载入会用最新版本替换当前草稿。要保留当前输入，还是放弃更改后重新读取？</p>
                    <div>
                        <button type="button" className={styles.secondaryButton} onClick={() => setReloadConfirm(false)}>
                            保留草稿
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={reloadTemplate}>
                            放弃草稿并重载
                        </button>
                    </div>
                </div>
            )}
            <div className={styles.editorLayout}>
                <form className={styles.editor} onSubmit={save} noValidate>
                    <div className={styles.formHeading}>
                        <h2>模板内容</h2>
                        <span role="status">
                            {saving ? '正在保存…' : dirty ? '有未保存的更改' : template ? `已保存 · v${template.version}` : '新草稿'}
                        </span>
                    </div>
                    <fieldset disabled={saving} className={styles.basicFields}>
                        <div className={styles.field}>
                            <label htmlFor="template-name">
                                模板名称 <span aria-hidden="true">*</span>
                            </label>
                            <input
                                id="template-name"
                                value={draft.name}
                                maxLength={120}
                                required
                                placeholder="例如：每周产品回顾"
                                aria-invalid={Boolean(errors.name)}
                                aria-describedby={errors.name ? 'template-name-error' : undefined}
                                onChange={event => updateField('name', event.target.value)}
                                onBlur={() => validateField('name')}
                            />
                            {errors.name && (
                                <p id="template-name-error" className={styles.fieldError}>
                                    {errors.name}
                                </p>
                            )}
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="template-description">
                                模板说明 <span>选填</span>
                            </label>
                            <textarea
                                id="template-description"
                                rows={3}
                                value={draft.description}
                                maxLength={2000}
                                placeholder="说明这份清单适合什么工作，或建议何时使用。"
                                aria-invalid={Boolean(errors.description)}
                                aria-describedby={errors.description ? 'template-description-error' : undefined}
                                onChange={event => updateField('description', event.target.value)}
                                onBlur={() => validateField('description')}
                            />
                            {errors.description && (
                                <p id="template-description-error" className={styles.fieldError}>
                                    {errors.description}
                                </p>
                            )}
                        </div>
                    </fieldset>
                    <div className={styles.tasksHeading}>
                        <div>
                            <h2 id="template-tasks-heading" tabIndex={-1}>
                                任务条目
                            </h2>
                            <p>顺序表示清单排列。每个任务都需要单独明确开始。</p>
                        </div>
                        <span>{draft.tasks.length} / 8</span>
                    </div>
                    <p className={`${styles.goalCount} ${totalGoalLength > 32000 ? styles.invalidCount : ''}`}>
                        任务目标合计 {totalGoalLength.toLocaleString()} / 32,000 字
                    </p>
                    {errors.tasks && (
                        <p className={styles.fieldError} role="alert">
                            {errors.tasks}
                        </p>
                    )}
                    <div className={styles.taskItems}>
                        {draft.tasks.map((task, index) => (
                            <fieldset className={styles.taskItem} disabled={saving} key={task.id}>
                                <legend className="sr-only">任务 {index + 1}</legend>
                                <div className={styles.taskItemHeading}>
                                    <strong>
                                        <span>{String(index + 1).padStart(2, '0')}</span>任务 {index + 1}
                                    </strong>
                                    <div>
                                        <button
                                            className={styles.iconButton}
                                            type="button"
                                            title={index === 0 ? '已是第一个任务' : '上移任务'}
                                            aria-label={`上移任务 ${index + 1}`}
                                            disabled={index === 0}
                                            onClick={() => moveTask(task.id, -1)}
                                        >
                                            <ArrowUp size={15} aria-hidden="true" />
                                        </button>
                                        <button
                                            className={styles.iconButton}
                                            type="button"
                                            title={index === draft.tasks.length - 1 ? '已是最后一个任务' : '下移任务'}
                                            aria-label={`下移任务 ${index + 1}`}
                                            disabled={index === draft.tasks.length - 1}
                                            onClick={() => moveTask(task.id, 1)}
                                        >
                                            <ArrowDown size={15} aria-hidden="true" />
                                        </button>
                                        <button
                                            className={styles.iconButton}
                                            type="button"
                                            title={draft.tasks.length <= 1 ? '至少保留一个任务' : '删除任务'}
                                            aria-label={`删除任务 ${index + 1}`}
                                            disabled={draft.tasks.length <= 1}
                                            onClick={() => removeTask(task.id)}
                                        >
                                            <Trash2 size={15} aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor={`template-task-${task.id}-title`}>
                                        任务名称 <span aria-hidden="true">*</span>
                                    </label>
                                    <input
                                        id={`template-task-${task.id}-title`}
                                        value={task.title}
                                        maxLength={120}
                                        required
                                        placeholder="填写这一项的工作名称"
                                        aria-invalid={Boolean(errors[`tasks.${task.id}.title`])}
                                        aria-describedby={
                                            errors[`tasks.${task.id}.title`] ? `template-task-${task.id}-title-error` : undefined
                                        }
                                        onChange={event => updateTask(task.id, { title: event.target.value })}
                                        onBlur={() => validateField(`tasks.${task.id}.title`)}
                                    />
                                    {errors[`tasks.${task.id}.title`] && (
                                        <p className={styles.fieldError} id={`template-task-${task.id}-title-error`}>
                                            {errors[`tasks.${task.id}.title`]}
                                        </p>
                                    )}
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor={`template-task-${task.id}-goal`}>
                                        任务目标 <span aria-hidden="true">*</span>
                                    </label>
                                    <textarea
                                        id={`template-task-${task.id}-goal`}
                                        rows={5}
                                        value={task.goal}
                                        maxLength={8000}
                                        required
                                        placeholder="描述背景、具体目标和希望得到的结果。"
                                        aria-invalid={Boolean(errors[`tasks.${task.id}.goal`])}
                                        aria-describedby={`template-task-${task.id}-goal-hint${errors[`tasks.${task.id}.goal`] ? ` template-task-${task.id}-goal-error` : ''}`}
                                        onChange={event => updateTask(task.id, { goal: event.target.value })}
                                        onBlur={() => validateField(`tasks.${task.id}.goal`)}
                                    />
                                    <p id={`template-task-${task.id}-goal-hint`} className={styles.hint}>
                                        {task.goal.length.toLocaleString()} / 8,000 字
                                    </p>
                                    {errors[`tasks.${task.id}.goal`] && (
                                        <p className={styles.fieldError} id={`template-task-${task.id}-goal-error`}>
                                            {errors[`tasks.${task.id}.goal`]}
                                        </p>
                                    )}
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor={`template-task-${task.id}-agentId`}>使用的 Agent</label>
                                    <div className={styles.selectWrap}>
                                        <select
                                            id={`template-task-${task.id}-agentId`}
                                            value={task.agentId ?? ''}
                                            aria-invalid={Boolean(errors[`tasks.${task.id}.agentId`])}
                                            onChange={event => updateTask(task.id, { agentId: event.target.value || undefined })}
                                            onBlur={() => validateField(`tasks.${task.id}.agentId`)}
                                        >
                                            <option value="">通用助手 · {status?.model}</option>
                                            {task.agentId && !agents.some(agent => agent.id === task.agentId) && (
                                                <option value={task.agentId} disabled>
                                                    助手暂不可用 · {task.agentId.slice(0, 8)}
                                                </option>
                                            )}
                                            {agents.map(agent => (
                                                <option value={agent.id} key={agent.id}>
                                                    {agentLabel(agent.id, agents, status?.model ?? '默认模型')}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown size={15} aria-hidden="true" />
                                    </div>
                                    {errors[`tasks.${task.id}.agentId`] && (
                                        <p className={styles.fieldError}>{errors[`tasks.${task.id}.agentId`]}</p>
                                    )}
                                </div>
                            </fieldset>
                        ))}
                    </div>
                    <button
                        type="button"
                        className={styles.addTaskButton}
                        disabled={saving || draft.tasks.length >= 8}
                        aria-describedby="template-task-limit"
                        onClick={addTask}
                    >
                        <Plus size={16} aria-hidden="true" />
                        添加任务<span>{draft.tasks.length} / 8</span>
                    </button>
                    <p id="template-task-limit" className={styles.hint}>
                        {draft.tasks.length >= 8
                            ? '已达到 8 项上限。可以继续编辑、调整顺序或移除现有条目。'
                            : '至少保留 1 项，最多 8 项。每项有独立目标和助手选择。'}
                    </p>
                    {saveError && (
                        <div className={styles.error} role="alert">
                            <p>{saveError}</p>
                            <span>当前输入和创建动作已保留，可以检查后重试。</span>
                        </div>
                    )}
                    {conflict && (
                        <div className={styles.conflict} role="alert">
                            <p>服务端内容可能已更新。当前草稿已保留，请明确重新读取并核对最新版本。</p>
                            <button type="button" className={styles.secondaryButton} onClick={requestReload}>
                                <RotateCcw size={14} aria-hidden="true" />
                                重新读取最新版本
                            </button>
                        </div>
                    )}
                    {notice && (
                        <p className={styles.notice} role="status">
                            <Check size={14} aria-hidden="true" />
                            {notice}
                        </p>
                    )}
                    <footer className={styles.formFooter}>
                        <span>保存模板只记录清单与助手选择。</span>
                        <button type="submit" className={styles.primaryButton} disabled={saving || conflict}>
                            {saving ? (
                                <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" />
                            ) : (
                                <Save size={15} aria-hidden="true" />
                            )}
                            {saving ? '正在保存' : '保存模板'}
                        </button>
                    </footer>
                </form>
                <aside className={styles.preview} aria-label="完整任务清单预览">
                    <div className={styles.previewHeading}>
                        <span>{dirty || !template ? '当前草稿预览' : `已保存预览 · v${template.version}`}</span>
                        <span>{draft.tasks.length} 项任务</span>
                    </div>
                    <div className={styles.previewBody}>
                        <h2>{draft.name.trim() || '你的任务模板'}</h2>
                        {draft.description.trim() && <p className={styles.previewDescription}>{draft.description}</p>}
                        <p className={styles.previewNote}>每项任务独立开始、独立对话；清单顺序用于阅读与整理。</p>
                        <TaskPreview tasks={draft.tasks} agents={agents} model={status?.model ?? '默认模型'} />
                    </div>
                    <div className={styles.freezeNote}>助手的实际模型、提示词、工具及开场消息会在生成项目时解析并冻结到各任务。</div>
                </aside>
            </div>
            {launching && template && launchDraft && (
                <LaunchDialog
                    template={template}
                    agents={agents}
                    status={status}
                    draft={launchDraft}
                    onDraftChange={setLaunchDraft}
                    requestIdFor={launchRequestId}
                    onClose={closeLaunch}
                    onReloaded={reloadedForLaunch}
                    onLaunched={launchedProject}
                />
            )}
        </section>
    )
}

/**
 * Previews one explicit template version and creates its project only after confirmation.
 * @param props - Saved preview version, current agent choices, and confirmed-result callbacks.
 * @returns Full ordered goals plus an idempotent project-creation form with version recovery.
 */
function LaunchDialog({
    template,
    agents,
    status,
    draft,
    onDraftChange,
    requestIdFor,
    onClose,
    onReloaded,
    onLaunched,
}: {
    template: ProjectTemplate
    agents: AgentDefinition[]
    status: ChatStatus | null
    draft: ProjectInput
    onDraftChange: (input: ProjectInput) => void
    requestIdFor: (fingerprint: string) => string
    onClose: () => void
    onReloaded: (template: ProjectTemplate) => void
    onLaunched: (result: TemplateLaunchResult) => void
}) {
    const [preview, setPreview] = useState(template)
    const [errors, setErrors] = useState<FieldErrors>({})
    const [failure, setFailure] = useState('')
    const [conflict, setConflict] = useState(false)
    const [saving, setSaving] = useState(false)
    const [reading, setReading] = useState(false)
    const dialogRef = useRef<HTMLDialogElement>(null)
    const nameRef = useRef<HTMLInputElement>(null)
    const busy = useRef(false)

    useEffect(() => {
        dialogRef.current?.showModal()
        nameRef.current?.focus()
    }, [])

    /**
     * Closes an idle launch preview and returns focus to the saved-version action.
     * @returns Nothing; never cancels an accepted background write silently.
     */
    function close() {
        if (busy.current) return
        dialogRef.current?.close()
        onClose()
    }

    /**
     * Reads a new preview version only after an explicit user action, retaining project fields.
     * @returns A promise settled after a complete fresh preview or visible read failure.
     */
    async function reloadPreview() {
        if (busy.current) return
        busy.current = true
        setReading(true)
        setFailure('')
        try {
            const saved = await getTemplate(preview.id)
            setPreview(saved)
            onReloaded(saved)
            setConflict(false)
        } catch (error) {
            setFailure(errorMessage(error))
        } finally {
            busy.current = false
            setReading(false)
        }
    }

    /**
     * Validates a new project field after keyboard focus leaves it.
     * @param field - Project name or description field being checked.
     * @returns Nothing; updates the corresponding inline error.
     */
    function validateField(field: 'name' | 'description') {
        const result = launchTemplateSchema.shape[field].safeParse(draft[field])
        setErrors(current => ({ ...current, [field]: result.success ? undefined : result.error.issues[0]?.message }))
    }

    /**
     * Atomically generates a new project and all template tasks using the explicitly previewed version.
     * @param event - Launch confirmation form submission.
     * @returns A promise settled after confirmed generation or preserved-input failure feedback.
     */
    async function launch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (busy.current || conflict) return
        const fingerprint = JSON.stringify({
            templateId: preview.id,
            version: preview.version,
            name: draft.name.trim(),
            description: draft.description.trim(),
        })
        const input: LaunchTemplate = { ...draft, requestId: requestIdFor(fingerprint), version: preview.version }
        const result = launchTemplateSchema.safeParse(input)
        if (!result.success) {
            const next: FieldErrors = {}
            for (const issue of result.error.issues) next[issue.path.join('.')] ??= issue.message
            setErrors(next)
            document.getElementById(next.name ? 'template-launch-name' : 'template-launch-description')?.focus()
            return
        }
        busy.current = true
        setSaving(true)
        setFailure('')
        setErrors({})
        try {
            const saved = await launchTemplate(preview.id, result.data)
            dialogRef.current?.close()
            onLaunched(saved)
        } catch (error) {
            setFailure(errorMessage(error))
            if (isConflict(error)) setConflict(true)
        } finally {
            busy.current = false
            setSaving(false)
        }
    }

    return (
        <dialog
            ref={dialogRef}
            className={styles.launchDialog}
            aria-labelledby="template-launch-heading"
            onCancel={event => {
                if (saving || reading) event.preventDefault()
            }}
            onClose={close}
        >
            <header className={styles.dialogHeading}>
                <div>
                    <span className={styles.eyebrow}>LAUNCH PREVIEW · v{preview.version}</span>
                    <h2 id="template-launch-heading">从模板生成项目</h2>
                    <p>
                        {preview.name} · 编号 {preview.id.slice(0, 8)}
                    </p>
                </div>
                <button type="button" className={styles.iconButton} disabled={saving || reading} aria-label="关闭启动预览" onClick={close}>
                    <X size={19} aria-hidden="true" />
                </button>
            </header>
            <form onSubmit={launch} noValidate>
                <fieldset disabled={saving || reading} className={styles.basicFields}>
                    <div className={styles.field}>
                        <label htmlFor="template-launch-name">
                            新项目名称 <span aria-hidden="true">*</span>
                        </label>
                        <input
                            ref={nameRef}
                            id="template-launch-name"
                            value={draft.name}
                            maxLength={120}
                            required
                            aria-invalid={Boolean(errors.name)}
                            aria-describedby={errors.name ? 'template-launch-name-error' : undefined}
                            onChange={event => {
                                onDraftChange({ ...draft, name: event.target.value })
                                setFailure('')
                            }}
                            onBlur={() => validateField('name')}
                        />
                        {errors.name && (
                            <p className={styles.fieldError} id="template-launch-name-error">
                                {errors.name}
                            </p>
                        )}
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="template-launch-description">
                            新项目说明 <span>选填</span>
                        </label>
                        <textarea
                            id="template-launch-description"
                            rows={3}
                            value={draft.description}
                            maxLength={2000}
                            aria-invalid={Boolean(errors.description)}
                            aria-describedby={errors.description ? 'template-launch-description-error' : undefined}
                            onChange={event => {
                                onDraftChange({ ...draft, description: event.target.value })
                                setFailure('')
                            }}
                            onBlur={() => validateField('description')}
                        />
                        {errors.description && (
                            <p className={styles.fieldError} id="template-launch-description-error">
                                {errors.description}
                            </p>
                        )}
                    </div>
                </fieldset>
                <div className={styles.launchPreviewHeading}>
                    <h3>将生成 {preview.tasks.length} 个未开始任务</h3>
                    <span>预览版本 v{preview.version}</span>
                </div>
                <TaskPreview tasks={preview.tasks} agents={agents} model={status?.model ?? '默认模型'} />
                <p className={styles.freezeNote}>
                    助手的实际模型、提示词、工具与开场消息在生成时解析并冻结。创建后仍需逐项点击“开始执行”，清单顺序不触发自动调度。
                </p>
                {failure && (
                    <div className={styles.error} role="alert">
                        <p>{failure}</p>
                        <span>新项目输入和启动动作已保留，未确认成功前不会跳转。</span>
                    </div>
                )}
                {conflict && (
                    <div className={styles.conflict} role="alert">
                        <p>预览版本可能已更新。请明确重新读取模板，检查完整清单后再次确认；新项目名称和说明会保留。</p>
                        <button type="button" className={styles.secondaryButton} disabled={saving || reading} onClick={reloadPreview}>
                            <RotateCcw size={14} aria-hidden="true" />
                            {reading ? '正在读取' : '重新读取模板版本'}
                        </button>
                    </div>
                )}
                <footer className={styles.dialogActions}>
                    <button type="button" className={styles.secondaryButton} disabled={saving || reading} onClick={close}>
                        返回模板
                    </button>
                    <button type="submit" className={styles.primaryButton} disabled={saving || reading || conflict}>
                        {saving ? (
                            <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" />
                        ) : (
                            <Plus size={15} aria-hidden="true" />
                        )}
                        {saving ? '正在生成项目' : '创建项目与任务'}
                    </button>
                </footer>
            </form>
        </dialog>
    )
}
