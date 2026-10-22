'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
    workflowTemplateInputSchema,
    type WorkflowTemplate,
    type WorkflowTemplateInput,
    type CollaborationPerson,
} from '@ai-harness/contracts'
import { searchCollaborationPeople } from '../lib/collaboration-client'
import { createWorkflowTemplate, getWorkflowTemplate, updateWorkflowTemplate } from '../lib/workflow-template-client'
import { useAccount } from './account-context'
import { canSetWorkflowUpstream } from '../lib/workflow-connections'
import { WorkflowGraph } from './workflow-graph'
import { FeedbackMessage } from './ui/feedback-message'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { SearchInput } from './ui/search-input'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Textarea } from './ui/textarea'

/**
 * Formats public template errors without exposing transport or credential details.
 * @param cause - Failed request or shared validation error.
 * @returns Actionable text suitable for the current form.
 */
function failure(cause: unknown): string {
    return cause instanceof Error ? cause.message : '操作未完成，请保留草稿后重试。'
}

/**
 * Identifies a deliberate version or preview review checkpoint.
 * @param cause - API request failure.
 * @returns Whether an explicit reread is required before another submission.
 */
function conflict(cause: unknown): boolean {
    return Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409)
}

/**
 * Copies editable graph fields without server-owned availability or author metadata.
 * @param saved - Confirmed saved workflow.
 * @returns An independent version-free graph draft.
 */
function editable(saved: WorkflowTemplate): WorkflowTemplateInput {
    return {
        name: saved.name,
        description: saved.description,
        nodes: saved.nodes.map(({ id, title, goal, assigneeId, upstreamNodeId, position }) => ({
            id,
            title,
            goal,
            assigneeId,
            upstreamNodeId,
            position: { ...position },
        })),
    }
}

/**
 * Creates two independent blank graph nodes with one explicit initial upstream edge.
 * @returns A new unsaved graph requiring human text and assignee selection.
 */
function blank(): WorkflowTemplateInput {
    const root = crypto.randomUUID()
    return {
        name: '',
        description: '',
        nodes: [
            { id: root, title: '', goal: '', assigneeId: '', upstreamNodeId: null, position: { x: 100, y: 50 } },
            { id: crypto.randomUUID(), title: '', goal: '', assigneeId: '', upstreamNodeId: root, position: { x: 650, y: 400 } },
        ],
    }
}

/**
 * Searches real workspace colleagues and includes the authenticated viewer as an explicit choice.
 * @param props - Current identity selection, stable labels, and form editability.
 * @returns An accessible single-assignee picker without access to private Agent configurations.
 */
export function WorkflowAssigneePicker({
    value,
    name,
    active = true,
    onChange,
    disabled = false,
    id,
    invalid = false,
    describedBy,
}: {
    value: string
    name: string
    active?: boolean
    onChange: (person: CollaborationPerson) => void
    disabled?: boolean
    id: string
    invalid?: boolean
    describedBy?: string
}) {
    const { user } = useAccount()
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
    return (
        <div className="grid min-w-0 gap-2">
            <p className={`text-sm [overflow-wrap:anywhere] ${!active ? 'text-error-foreground' : ''}`}>
                {value ? `${name || '处理人'} · ${value.slice(0, 8)}${active ? '' : ' · 已失效，请重新选择'}` : '未设置处理人'}
            </p>
            <Button type="button" variant="outline" disabled={disabled} onClick={() => onChange({ id: user.id, name: user.username })}>
                选择我自己 · {user.id.slice(0, 8)}
            </Button>
            <Label htmlFor={id}>搜索处理人</Label>
            <SearchInput
                id={id}
                value={query}
                onValueChange={value => {
                    setQuery(value)
                    setError('')
                }}
                disabled={disabled}
                placeholder="输入当前空间同事姓名"
                autoComplete="off"
                aria-invalid={invalid || !active}
                aria-describedby={describedBy}
            />
            {error ? (
                <FeedbackMessage variant="error">
                    {error}
                    <Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>
                        重试搜索
                    </Button>
                </FeedbackMessage>
            ) : normalized && results?.query !== normalized ? (
                <p role="status" className="text-xs text-muted-foreground">
                    正在搜索处理人…
                </p>
            ) : (
                normalized && (
                    <ul className="grid min-w-0 gap-2" aria-label="处理人搜索结果">
                        {results?.people.length === 0 && <li>没有符合条件的有效同事。</li>}
                        {results?.people.map(person => (
                            <li key={person.id}>
                                <Button
                                    type="button"
                                    variant={value === person.id ? 'secondary' : 'outline'}
                                    className="h-auto min-h-11 w-full justify-start whitespace-normal text-left [overflow-wrap:anywhere]"
                                    disabled={disabled}
                                    onClick={() => onChange(person)}
                                >
                                    <span className="min-w-0">
                                        {person.name} · {person.id.slice(0, 8)}
                                    </span>
                                </Button>
                            </li>
                        ))}
                    </ul>
                )
            )}
        </div>
    )
}

/**
 * Shows all saved graph text during an explicit version comparison or frozen human preview.
 * @param props - Full graph draft and stable assignee labels.
 * @returns A complete readable graph list without truncating any work description.
 */
function CompleteNodes({
    nodes,
    names,
}: {
    nodes: WorkflowTemplateInput['nodes']
    names: Record<string, { name: string; active: boolean }>
}) {
    return (
        <ol className="grid min-w-0 gap-3">
            {nodes.map(node => (
                <li key={node.id} className="grid min-w-0 gap-2 rounded-xl border p-3 [overflow-wrap:anywhere]">
                    <h3 className="font-medium">
                        {node.title} · {node.id.slice(0, 8)}
                    </h3>
                    <p className="text-sm">
                        处理人：{names[node.assigneeId]?.name || '未设置'} · {node.assigneeId.slice(0, 8)}
                        {names[node.assigneeId]?.active === false ? '（已失效）' : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        上游：
                        {nodes.find(item => item.id === node.upstreamNodeId)?.title ||
                            (node.upstreamNodeId ? '需要重新选择上游' : '起点（无上游）')}{' '}
                        · 位置 {node.position.x}, {node.position.y}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{node.goal}</p>
                </li>
            ))}
        </ol>
    )
}

/**
 * Edits only the current person's versioned collaborative blueprint while keeping legacy lists separate.
 * @param props - Optional catalog-confirmed saved workflow.
 * @returns A responsive graph editor, full selected-node properties, while retired project launch remains unavailable.
 */
export function WorkflowTemplateEditor({ initialTemplate }: { initialTemplate?: WorkflowTemplate }) {
    const router = useRouter()
    const [saved, setSaved] = useState(initialTemplate ?? null)
    const [draft, setDraft] = useState<WorkflowTemplateInput>(() => (initialTemplate ? editable(initialTemplate) : blank()))
    const [baseline, setBaseline] = useState(() => JSON.stringify(initialTemplate ? editable(initialTemplate) : null))
    const [selectedId, setSelectedId] = useState(() => initialTemplate?.nodes[0]?.id ?? '')
    const [editingNode, setEditingNode] = useState(false)
    const [revealNodeId, setRevealNodeId] = useState<string | null>(null)
    const [names, setNames] = useState<Record<string, { name: string; active: boolean }>>(() =>
        Object.fromEntries(
            (initialTemplate?.nodes ?? []).map(node => [node.assigneeId, { name: node.assigneeName, active: node.assigneeActive }])
        )
    )
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [stale, setStale] = useState(false)
    const [latest, setLatest] = useState<WorkflowTemplate | null>(null)
    const [removing, setRemoving] = useState<string | null>(null)
    const [focusField, setFocusField] = useState<{ id: string } | null>(null)
    const pending = useRef(false)
    const creation = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const removeCancel = useRef<HTMLButtonElement>(null)
    const selected = draft.nodes.find(node => node.id === selectedId) ?? draft.nodes[0]!
    const dirty = JSON.stringify(draft) !== baseline
    useEffect(() => {
        if (focusField) {
            document.getElementById(focusField.id)?.focus()
        }
    }, [focusField, selectedId, editingNode])
    useEffect(() => {
        if (!dirty) return
        /**
         * Protects the current unsaved graph from browser-level reload or navigation.
         * @param event - Native page-unload event.
         * @returns Nothing after requesting the browser's standard draft warning.
         */
        function protect(event: BeforeUnloadEvent) {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', protect)
        return () => window.removeEventListener('beforeunload', protect)
    }, [dirty])
    /**
     * Changes one stable node without inferring any other relationships or positions.
     * @param id - Node identity being explicitly edited.
     * @param patch - Independent changed fields.
     * @returns Nothing after preserving all unrelated node draft fields.
     */
    function updateNode(id: string, patch: Partial<WorkflowTemplateInput['nodes'][number]>) {
        setDraft(current => ({ ...current, nodes: current.nodes.map(node => (node.id === id ? { ...node, ...patch } : node)) }))
        setNotice('')
        setError('')
    }
    /**
     * Opens the selected work's existing draft without changing its contents or layout.
     * @param id - Stable business node identity chosen through the graph or edit action.
     * @returns Nothing after selecting the node and focusing its modal editor.
     */
    function editNode(id: string): void {
        if (busy || pending.current || !draft.nodes.some(node => node.id === id)) return
        setSelectedId(id)
        setFocusField({ id: 'workflow-node-title' })
        setEditingNode(true)
    }
    /**
     * Applies one explicit connection or inspector choice, atomically detaching an old target.
     * @param nodeId - Target whose unique upstream is replaced.
     * @param upstreamNodeId - Chosen upstream or null for an explicitly disconnected draft.
     * @param previousTargetId - Original target to detach during edge reconnection.
     * @returns Nothing after a valid draft change, or visible feedback without changing a cyclic graph.
     */
    function changeUpstream(nodeId: string, upstreamNodeId: string | null, previousTargetId?: string): void {
        if (!canSetWorkflowUpstream(draft.nodes, nodeId, upstreamNodeId, previousTargetId)) {
            setError('无法设置上游：请选择有效节点，并避免连接自身或形成循环。')
            return
        }
        setDraft(current => ({
            ...current,
            nodes: current.nodes.map(node =>
                node.id === nodeId ? { ...node, upstreamNodeId } : node.id === previousTargetId ? { ...node, upstreamNodeId: null } : node
            ),
        }))
        setNotice('')
        setError('')
    }
    /**
     * Records an explicit single-person selection and its stable public label.
     * @param nodeId - Node whose assignee is being changed.
     * @param person - Actual workspace account chosen by the human.
     * @returns Nothing after changing only that node's assignee.
     */
    function choose(nodeId: string, person: CollaborationPerson) {
        setNames(current => ({ ...current, [person.id]: { name: person.name, active: true } }))
        updateNode(nodeId, { assigneeId: person.id })
    }
    /**
     * Appends one new leaf with a clearly selected upstream and independent identity.
     * @returns Nothing when the eight-node limit is reached, otherwise selects the new leaf.
     */
    function add() {
        if (pending.current || busy || draft.nodes.length >= 8) return
        const id = crypto.randomUUID()
        setDraft({
            ...draft,
            nodes: [
                ...draft.nodes,
                {
                    id,
                    title: '',
                    goal: '',
                    assigneeId: '',
                    upstreamNodeId: selected.id,
                    position: { x: Math.min(1000, selected.position.x + 150), y: Math.min(1000, selected.position.y + 250) },
                },
            ],
        })
        setSelectedId(id)
        setRevealNodeId(id)
        setFocusField({ id: 'workflow-node-title' })
        setEditingNode(true)
        setNotice('')
        setError('')
    }
    /**
     * Deletes only the confirmed node, preserving its children's broken references for explicit repair.
     * @returns Nothing after retaining every surviving node identity, assignee, and work text.
     */
    function remove() {
        if (!removing || draft.nodes.length <= 2) return
        const nodes = draft.nodes.filter(node => node.id !== removing)
        setDraft({ ...draft, nodes })
        setSelectedId(nodes[0]!.id)
        setRemoving(null)
        setNotice('')
    }
    /**
     * Keeps the work and returns from its deletion review to its unchanged modal draft.
     * @returns Nothing after restoring the selected work's editor and initial field.
     */
    function keepNode(): void {
        setRemoving(null)
        setFocusField({ id: 'workflow-node-title' })
        setEditingNode(true)
    }
    /**
     * Reads a comparison version without replacing any local text, position, selection, or person.
     * @returns After a complete latest version or visible preserved-draft failure.
     */
    async function reread() {
        if (!saved || pending.current) return
        pending.current = true
        setBusy(true)
        try {
            setLatest(await getWorkflowTemplate(saved.id))
            setError('')
        } catch (cause) {
            setError(failure(cause))
        } finally {
            pending.current = false
            setBusy(false)
        }
    }
    /**
     * Explicitly saves the complete valid tree using the retained creation or read version.
     * @param event - Human save submission.
     * @returns After confirmed persistence or actionable feedback with the complete draft retained.
     */
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (pending.current || stale) return
        const result = workflowTemplateInputSchema.safeParse(draft)
        if (!result.success) {
            const next: Record<string, string> = {}
            for (const issue of result.error.issues) {
                const path =
                    issue.path[0] === 'nodes' && typeof issue.path[1] === 'number'
                        ? `nodes.${draft.nodes[issue.path[1]]?.id}.${String(issue.path[2] ?? 'structure')}`
                        : issue.path.join('.')
                next[path] ??=
                    issue.code === 'custom'
                        ? issue.message
                        : issue.path[0] === 'name'
                          ? '模板名称须为 1–120 个字。'
                          : issue.path[0] === 'description'
                            ? '模板说明不能超过 2000 个字。'
                            : issue.path[2] === 'title'
                              ? '节点名称须为 1–120 个字。'
                              : issue.path[2] === 'goal'
                                ? '工作说明须为 1–8000 个字。'
                                : issue.path[2] === 'assigneeId'
                                  ? '请选择当前工作空间的有效处理人。'
                                  : '请检查节点数量、编号、上游关系及布局。'
            }
            setErrors(next)
            const first = result.error.issues[0]
            if (first?.path[0] === 'nodes') setEditingNode(true)
            if (first?.path[0] === 'nodes' && typeof first.path[1] === 'number') {
                setSelectedId(draft.nodes[first.path[1]]!.id)
                setFocusField({ id: `workflow-node-${String(first.path[2] ?? 'upstreamNodeId')}` })
            } else
                setFocusField({
                    id:
                        first?.path[0] === 'nodes'
                            ? first.message.includes('工作说明')
                                ? 'workflow-node-goal'
                                : 'workflow-node-upstreamNodeId'
                            : first?.path[0] === 'name'
                              ? 'workflow-name'
                              : 'workflow-description',
                })
            setError('请修复标记的字段与结构后保存。')
            return
        }
        const fingerprint = JSON.stringify(result.data)
        if (creation.current?.fingerprint !== fingerprint) creation.current = { fingerprint, requestId: crypto.randomUUID() }
        pending.current = true
        setBusy(true)
        setError('')
        setErrors({})
        try {
            const confirmed = saved
                ? await updateWorkflowTemplate(saved.id, { ...result.data, version: saved.version })
                : await createWorkflowTemplate({ ...result.data, requestId: creation.current.requestId })
            setSaved(confirmed)
            const input = editable(confirmed)
            setDraft(input)
            setBaseline(JSON.stringify(input))
            setNames(current => ({
                ...current,
                ...Object.fromEntries(
                    confirmed.nodes.map(node => [node.assigneeId, { name: node.assigneeName, active: node.assigneeActive }])
                ),
            }))
            setNotice(`协作流程已保存 · v${confirmed.version}`)
            if (!initialTemplate) router.replace(`/templates/${confirmed.id}`)
        } catch (cause) {
            setError(failure(cause))
            if (conflict(cause)) setStale(true)
        } finally {
            pending.current = false
            setBusy(false)
        }
    }
    return (
        <section className="workspace-page grid min-w-0 gap-6">
            <Link href="/templates" className="text-sm underline">
                返回任务模板
            </Link>
            <header className="workspace-page-header flex min-w-0 flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="[overflow-wrap:anywhere]">{saved ? '编辑协作流程模板' : '创建协作流程模板'}</h1>
                    <p className="mt-2 text-xs text-muted-foreground">
                        {saved ? `${saved.id.slice(0, 8)} · v${saved.version}` : '新草稿'} · {dirty ? '有未保存的更改' : '已保存'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {saved && (
                        <>
                            <Button type="button" variant="outline" disabled={busy} onClick={() => void reread()}>
                                读取最新版本
                            </Button>
                            <Button type="button" disabled title="旧版项目流程已停用，暂不支持启动">
                                暂不可启动
                            </Button>
                        </>
                    )}
                </div>
            </header>
            {saved && (
                <p className="text-sm text-muted-foreground">
                    {dirty
                        ? '请保存布局、处理人和正文修改；旧版项目流程已停用，暂不支持启动。'
                        : '模板仅本人可编辑；旧版项目流程已停用，暂不支持启动。'}
                </p>
            )}
            <form className="grid min-w-0 gap-6" noValidate onSubmit={event => void save(event)}>
                <fieldset
                    disabled={busy}
                    className="grid min-w-0 items-start gap-6 border-b pb-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                >
                    <div className="grid min-w-0 gap-2">
                        <Label htmlFor="workflow-name">模板名称</Label>
                        <Input
                            id="workflow-name"
                            value={draft.name}
                            maxLength={120}
                            onChange={event => setDraft({ ...draft, name: event.target.value })}
                            aria-invalid={Boolean(errors.name)}
                            aria-describedby={errors.name ? 'workflow-name-error' : undefined}
                        />
                        {errors.name && (
                            <p id="workflow-name-error" role="alert" className="text-sm text-error-foreground">
                                {errors.name}
                            </p>
                        )}
                    </div>
                    <div className="grid min-w-0 gap-2">
                        <Label htmlFor="workflow-description">模板说明（选填）</Label>
                        <Textarea
                            id="workflow-description"
                            value={draft.description}
                            maxLength={2000}
                            onChange={event => setDraft({ ...draft, description: event.target.value })}
                        />
                    </div>
                </fieldset>
                <div className="min-w-0">
                    <WorkflowGraph
                        nodes={draft.nodes.map(node => ({
                            ...node,
                            ownerName: node.assigneeId
                                ? `${names[node.assigneeId]?.name ?? '处理人'} · ${node.assigneeId.slice(0, 8)}`
                                : '未设置处理人',
                        }))}
                        selectedId={selected.id}
                        onSelect={setSelectedId}
                        onEditNode={editNode}
                        onMove={(id, position) => updateNode(id, { position })}
                        onUpstreamChange={changeUpstream}
                        onAddNode={add}
                        revealNodeId={revealNodeId}
                        disabled={busy}
                    />
                </div>
                {error && (
                    <FeedbackMessage variant="error">
                        {error}
                        <p>节点、布局、处理人和正文草稿已保留。</p>
                    </FeedbackMessage>
                )}
                {stale && (
                    <FeedbackMessage variant="warning">
                        版本已变更，请明确读取最新版本并核对后再次保存。
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void reread()}>
                            重新读取，保留本地草稿
                        </Button>
                    </FeedbackMessage>
                )}
                {notice && <FeedbackMessage variant={notice.startsWith('协作流程已保存') ? 'success' : 'info'}>{notice}</FeedbackMessage>}
                <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
                    <p className="mr-auto text-xs text-muted-foreground">
                        {dirty ? '有未保存的更改' : saved ? '当前内容已保存' : '新草稿'}
                    </p>
                    <Button type="submit" disabled={busy || stale}>
                        {busy ? '正在保存…' : '保存模板'}
                    </Button>
                </div>
            </form>
            {editingNode && (
                <Dialog
                    open
                    onOpenChange={open => {
                        if (!open && !busy && !pending.current) setEditingNode(false)
                    }}
                >
                    <DialogContent
                        className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl"
                        initialFocus={() =>
                            document.getElementById(focusField?.id.startsWith('workflow-node-') ? focusField.id : 'workflow-node-title') ??
                            false
                        }
                        finalFocus={() => document.getElementById('workflow-edit-selected') ?? false}
                        showCloseButton={!busy}
                    >
                        <DialogHeader>
                            <DialogTitle>编辑节点</DialogTitle>
                            <DialogDescription>节点 {selected.id.slice(0, 8)}。修改保留在当前草稿中，保存模板后生效。</DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
                            <fieldset className="grid min-w-0 gap-4" disabled={busy}>
                                <div className="grid min-w-0 gap-2">
                                    <Label htmlFor="workflow-node-title">节点名称</Label>
                                    <Input
                                        id="workflow-node-title"
                                        value={selected.title}
                                        maxLength={120}
                                        onChange={event => updateNode(selected.id, { title: event.target.value })}
                                        aria-invalid={Boolean(errors[`nodes.${selected.id}.title`])}
                                        aria-describedby={errors[`nodes.${selected.id}.title`] ? 'workflow-node-errors' : undefined}
                                    />
                                </div>
                                <div className="grid min-w-0 gap-2">
                                    <Label htmlFor="workflow-node-goal">工作说明</Label>
                                    <Textarea
                                        id="workflow-node-goal"
                                        rows={7}
                                        value={selected.goal}
                                        maxLength={8000}
                                        onChange={event => updateNode(selected.id, { goal: event.target.value })}
                                        aria-invalid={Boolean(errors[`nodes.${selected.id}.goal`])}
                                        aria-describedby={errors[`nodes.${selected.id}.goal`] ? 'workflow-node-errors' : undefined}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        本节点 {selected.goal.length} / 8,000 字；全部{' '}
                                        {draft.nodes.reduce((total, node) => total + node.goal.trim().length, 0)} / 32,000 字
                                    </p>
                                </div>
                                <div className="grid min-w-0 gap-2">
                                    <Label htmlFor="workflow-node-upstreamNodeId">上游节点</Label>
                                    <NativeSelect
                                        id="workflow-node-upstreamNodeId"
                                        aria-invalid={Boolean(errors.nodes || errors[`nodes.${selected.id}.upstreamNodeId`])}
                                        aria-describedby={
                                            errors.nodes || errors[`nodes.${selected.id}.upstreamNodeId`]
                                                ? 'workflow-node-errors'
                                                : undefined
                                        }
                                        className="w-full"
                                        value={selected.upstreamNodeId ?? ''}
                                        onChange={event => changeUpstream(selected.id, event.target.value || null)}
                                    >
                                        <NativeSelectOption value="">起点（无上游）</NativeSelectOption>
                                        {selected.upstreamNodeId && !draft.nodes.some(node => node.id === selected.upstreamNodeId) && (
                                            <NativeSelectOption value={selected.upstreamNodeId}>
                                                需要重新选择上游 · {selected.upstreamNodeId.slice(0, 8)}
                                            </NativeSelectOption>
                                        )}
                                        {draft.nodes
                                            .filter(node => node.id !== selected.id)
                                            .map(node => (
                                                <NativeSelectOption key={node.id} value={node.id}>
                                                    {node.title || '未命名节点'} · {node.id.slice(0, 8)}
                                                </NativeSelectOption>
                                            ))}
                                    </NativeSelect>
                                </div>
                                <WorkflowAssigneePicker
                                    key={selected.id}
                                    id="workflow-node-assigneeId"
                                    value={selected.assigneeId}
                                    name={names[selected.assigneeId]?.name ?? ''}
                                    active={names[selected.assigneeId]?.active}
                                    invalid={Boolean(errors[`nodes.${selected.id}.assigneeId`])}
                                    describedBy={errors[`nodes.${selected.id}.assigneeId`] ? 'workflow-node-errors' : undefined}
                                    onChange={person => choose(selected.id, person)}
                                    disabled={busy}
                                />
                                <div id="workflow-node-errors" className="grid gap-2">
                                    {Object.entries(errors)
                                        .filter(([key]) => key.startsWith(`nodes.${selected.id}.`) || key === 'nodes')
                                        .map(([key, message]) => (
                                            <p key={key} role="alert" className="text-sm text-error-foreground [overflow-wrap:anywhere]">
                                                {message}
                                            </p>
                                        ))}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={busy || draft.nodes.length <= 2}
                                        onClick={() => {
                                            setEditingNode(false)
                                            setRemoving(selected.id)
                                        }}
                                    >
                                        删除节点
                                    </Button>
                                </div>
                            </fieldset>
                            {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
                        </div>
                        <DialogFooter>
                            <Button type="button" disabled={busy} onClick={() => setEditingNode(false)}>
                                完成编辑
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
            {removing && (
                <Dialog open onOpenChange={open => !open && keepNode()}>
                    <DialogContent
                        initialFocus={removeCancel}
                        finalFocus={() => document.getElementById('workflow-edit-selected') ?? false}
                    >
                        <DialogHeader>
                            <DialogTitle>删除这个节点？</DialogTitle>
                            <DialogDescription>
                                删除“{draft.nodes.find(node => node.id === removing)?.title || '未命名节点'}
                                ”后，下列直接下游需要重新选择上游，不会自动重连。
                            </DialogDescription>
                        </DialogHeader>
                        <ul className="grid gap-2 text-sm">
                            {draft.nodes
                                .filter(node => node.upstreamNodeId === removing)
                                .map(node => (
                                    <li key={node.id}>
                                        {node.title || '未命名节点'} · {node.id.slice(0, 8)}
                                    </li>
                                ))}
                            {!draft.nodes.some(node => node.upstreamNodeId === removing) && <li>没有直接下游节点。</li>}
                        </ul>
                        <DialogFooter>
                            <Button ref={removeCancel} variant="outline" onClick={keepNode}>
                                保留节点
                            </Button>
                            <Button variant="destructive" onClick={remove}>
                                删除节点
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
            {latest && (
                <Dialog open onOpenChange={open => !open && setLatest(null)}>
                    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
                        <DialogHeader>
                            <DialogTitle>核对最新版本 v{latest.version}</DialogTitle>
                            <DialogDescription>
                                本地节点、选中项、位置和处理人均已保留。核对完整最新版本后，明确选择保留本地草稿或采用服务器版本。
                            </DialogDescription>
                        </DialogHeader>
                        <h2 className="font-semibold [overflow-wrap:anywhere]">{latest.name}</h2>
                        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{latest.description}</p>
                        <CompleteNodes
                            nodes={latest.nodes}
                            names={Object.fromEntries(
                                latest.nodes.map(node => [node.assigneeId, { name: node.assigneeName, active: node.assigneeActive }])
                            )}
                        />
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setLatest(null)}>
                                继续保留当前状态
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    const input = editable(latest)
                                    setSaved(latest)
                                    setDraft(input)
                                    setBaseline(JSON.stringify(input))
                                    setNames(current => ({
                                        ...current,
                                        ...Object.fromEntries(
                                            latest.nodes.map(node => [
                                                node.assigneeId,
                                                { name: node.assigneeName, active: node.assigneeActive },
                                            ])
                                        ),
                                    }))
                                    setSelectedId(input.nodes[0]!.id)
                                    setStale(false)
                                    setLatest(null)
                                    setError('')
                                    setNotice('已明确采用最新版本。')
                                }}
                            >
                                放弃草稿，采用最新版本
                            </Button>
                            <Button
                                onClick={() => {
                                    setSaved(latest)
                                    setBaseline(JSON.stringify(editable(latest)))
                                    setStale(false)
                                    setLatest(null)
                                    setError('')
                                    setNames(current => ({
                                        ...current,
                                        ...Object.fromEntries(
                                            latest.nodes.map(node => [
                                                node.assigneeId,
                                                { name: node.assigneeName, active: node.assigneeActive },
                                            ])
                                        ),
                                    }))
                                    setNotice('已核对最新版本，本地草稿已保留。请再次人工保存。')
                                }}
                            >
                                保留本地草稿，采用最新版本基准
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </section>
    )
}
