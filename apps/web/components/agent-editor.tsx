'use client'

import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Bot,
    Calculator,
    ChevronDown,
    Clock3,
    LoaderCircle,
    Plus,
    RotateCcw,
    Save,
    Trash2,
    Wrench,
    X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from 'cn'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import type { AgentCatalog, AgentDefinition, AgentInput, AgentToolId, SkillSnapshot } from '@ai-harness/contracts'
import { agentInputSchema } from '@ai-harness/contracts'
import { createAgent, getAgent, getAgentCatalog, listAgents, updateAgent } from '../lib/agent-client'
import { AgentSkillsEditor, AgentSkillSnapshots, skillBindingError, skillVersionKey } from './agent-skills'
import styles from './agent-editor.styles'
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
import { Avatar, AvatarFallback } from './ui/avatar'
import { Badge } from './ui/badge'
import { Button, buttonVariants } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card'
import { Checkbox } from './ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { EmptyState } from './ui/empty-state'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { SearchInput } from './ui/search-input'
import { Separator } from './ui/separator'
import { Textarea } from './ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { useAccount } from './account-context'
import { PrivatePortalProvider, usePrivatePortalContainer } from './private-portal'

type FieldErrors = Partial<Record<keyof AgentInput | `openingMessages.${number}`, string>>
type EditorData = { catalog: AgentCatalog; agents: AgentDefinition[] }
type PendingAction = { kind: 'cancel-edit' | 'return-list' | 'close-create' }
type CreationStep = 0 | 1 | 2
const creationSteps = ['基本信息', '行为与能力', '开场消息与确认'] as const

/**
 * Resolves the creation step that owns a shared-contract field error.
 * @param field - Field path returned by the shared Agent schema.
 * @returns The step containing its editable control.
 */
function fieldStep(field: string): CreationStep {
    if (field === 'skillRefs' || field.startsWith('skillRefs.')) return 1
    if (field === 'systemPrompt' || field === 'toolIds' || field.startsWith('toolIds.')) return 1
    if (field === 'openingMessages' || field.startsWith('openingMessages.')) return 2
    return 0
}

/**
 * Resolves a validation path to its real editable control identifier.
 * @param field - Shared-schema field path, including indexed opening messages.
 * @returns The first relevant control identifier for focusing validation errors.
 */
function fieldControlId(field: string): string {
    if (field.startsWith('skillRefs')) return 'agent-skills'
    if (field.startsWith('openingMessages.')) return `agent-opening-${field.split('.')[1]}`
    const controls: Record<string, string> = {
        name: 'agent-name',
        description: 'agent-description',
        modelId: 'agent-model',
        systemPrompt: 'agent-prompt',
        skillRefs: 'agent-skills',
        openingMessages: 'agent-opening-0',
    }
    return controls[field] ?? 'agent-step-heading'
}

/**
 * Creates an empty agent with the server's default model.
 * @param modelId - Configured default model identifier from the catalog.
 * @returns Editable settings with no tools or opening messages selected.
 */
function emptyAgent(modelId: string): AgentInput {
    return { name: '', description: '', modelId, systemPrompt: '', toolIds: [], openingMessages: [], skillRefs: [] }
}

/**
 * Copies only editable fields from a saved agent.
 * @param agent - Saved agent whose settings should be edited.
 * @returns A separate input object without server metadata.
 */
function agentInput(agent: AgentDefinition): AgentInput {
    return {
        name: agent.name,
        description: agent.description,
        modelId: agent.modelId,
        systemPrompt: agent.systemPrompt,
        toolIds: [...agent.toolIds],
        openingMessages: [...agent.openingMessages],
        skillRefs: (agent.skillSnapshots ?? []).map(snapshot => ({ skillId: snapshot.skillId, version: snapshot.version })),
    }
}

/**
 * Returns field errors using the same validation rules as the API.
 * @param input - Current editor draft.
 * @returns The first useful error for each invalid field or opening message.
 */
function validateFields(input: AgentInput): FieldErrors {
    const result = agentInputSchema.safeParse(input)
    if (result.success) return {}
    const errors: FieldErrors = {}
    for (const issue of result.error.issues) {
        const path = issue.path.join('.') as keyof FieldErrors
        errors[path] ??= issue.message
    }
    return errors
}

/**
 * Extracts a readable explanation from an agent request failure.
 * @param error - Error thrown while loading or saving an agent.
 * @returns A safe message to display in the editor.
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '暂时无法连接 Agent 服务，请重试。'
}

/**
 * Isolates the collection and each URL-owned Agent's private draft and request lifetime.
 * @param props - Optional URL identifier for an independently loaded Agent detail.
 * @returns A keyed workspace that never reuses another Agent's local state.
 */
export function AgentEditor({ agentId }: { agentId?: string }) {
    return <AgentWorkspace key={agentId ?? 'list'} agentId={agentId} />
}

/**
 * Formats a validated saved Agent timestamp without changing its underlying value.
 * @param value - Server-owned ISO creation or update time.
 * @returns A readable local date and time.
 */
function savedTime(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

/**
 * Renders an independently loaded read-only detail or the real collection and creation flow.
 * @param props - Optional URL identifier for detail and full editing mode.
 * @returns A workspace backed by the existing scoped Agent API.
 */
function AgentWorkspace({ agentId }: { agentId?: string }) {
    const { modelLabel } = useAccount()
    const privatePortalContainer = usePrivatePortalContainer()
    const router = useRouter()
    const [data, setData] = useState<EditorData | null>(null)
    const [loadError, setLoadError] = useState('')
    const [reload, setReload] = useState(0)
    const [query, setQuery] = useState('')
    const [draft, setDraft] = useState<AgentInput>(emptyAgent(''))
    const [baseline, setBaseline] = useState<AgentInput>(emptyAgent(''))
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [editing, setEditing] = useState(false)
    const [errors, setErrors] = useState<FieldErrors>({})
    const [saveError, setSaveError] = useState('')
    const [notice, setNotice] = useState('')
    const [skillCache, setSkillCache] = useState<SkillSnapshot[]>([])
    const [skillLoading, setSkillLoading] = useState(false)
    const skillReadPending = useRef(false)
    const [saving, setSaving] = useState(false)
    const [createOpen, setCreateOpen] = useState(false)
    const [creationStep, setCreationStep] = useState<CreationStep>(0)
    const [createPopup, setCreatePopup] = useState<HTMLDivElement | null>(null)
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
    const activeWorkspace = useRef(true)
    const savingNow = useRef(false)
    const nameRef = useRef<HTMLInputElement>(null)
    const stepHeadingRef = useRef<HTMLHeadingElement>(null)
    const pendingErrorFocus = useRef<string | null>(null)
    const newAgentRef = useRef<HTMLButtonElement>(null)
    const editButtonRef = useRef<HTMLButtonElement>(null)
    const detailHeadingRef = useRef<HTMLHeadingElement>(null)
    const discardCancelRef = useRef<HTMLButtonElement>(null)
    const discardedAction = useRef<PendingAction['kind'] | null>(null)
    const formRef = useRef<HTMLFormElement>(null)
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
    const model = data?.catalog.models.find(item => item.id === draft.modelId)
    const selectedTools = data?.catalog.tools.filter(tool => draft.toolIds.includes(tool.id)) ?? []
    const savedAgent = data?.agents.find(agent => agent.id === agentId)
    const filteredAgents = (data?.agents ?? []).filter(agent =>
        `${agent.name} ${agent.description}`.toLowerCase().includes(query.trim().toLowerCase())
    )
    const availableSkillSnapshots = [...skillCache, ...(data?.agents.flatMap(agent => agent.skillSnapshots ?? []) ?? [])]
    const draftSkillSnapshots = (draft.skillRefs ?? []).flatMap(ref => {
        const snapshot = availableSkillSnapshots.find(item => skillVersionKey(item) === skillVersionKey(ref))
        return snapshot ? [snapshot] : []
    })

    /**
     * Validates editable fields together with the full frozen skill binding limits.
     * @returns Schema and exact-version body errors associated with their owning step.
     */
    function validateDraft(): FieldErrors {
        const next = validateFields(draft)
        const skillError = skillBindingError(draft.skillRefs ?? [], availableSkillSnapshots)
        if (skillError) next.skillRefs = skillError
        return next
    }

    useEffect(() => {
        activeWorkspace.current = true
        return () => {
            activeWorkspace.current = false
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Loads independent capabilities and private agent records together.
         * @returns A promise settled after catalog and saved agents are loaded.
         */
        async function load() {
            try {
                const [catalog, records] = await Promise.all([
                    getAgentCatalog(controller.signal),
                    agentId ? getAgent(agentId, controller.signal) : listAgents(controller.signal),
                ])
                const agents = Array.isArray(records) ? records : [records]
                if (controller.signal.aborted) return
                if (agentId && agents[0].id !== agentId) throw new Error('Agent 服务返回的记录与当前详情不匹配，请重新载入。')
                const input = agentId ? agentInput(agents[0]) : emptyAgent(catalog.defaultModelId)
                setData({ catalog, agents })
                setDraft(input)
                setBaseline(input)
                setSelectedId(agentId ?? null)
                setEditing(false)
                setLoadError('')
            } catch (error) {
                if (!controller.signal.aborted) setLoadError(errorMessage(error))
            }
        }
        void load()
        return () => controller.abort()
    }, [agentId, reload])

    useEffect(() => {
        if (!dirty) return
        /**
         * Warns before a browser reload would discard an unsaved draft.
         * @param event - Browser navigation event.
         * @returns Nothing; asks the browser to show its unsaved-change warning.
         */
        function protectDraft(event: BeforeUnloadEvent) {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', protectDraft)
        return () => window.removeEventListener('beforeunload', protectDraft)
    }, [dirty])

    useEffect(() => {
        if (!createOpen) return
        const frame = window.requestAnimationFrame(() => {
            const fieldId = pendingErrorFocus.current
            pendingErrorFocus.current = null
            const selector = fieldId ? `[id="${fieldId}"]` : creationStep === 1 ? '#agent-prompt' : '#agent-opening-0'
            const target = fieldId || creationStep > 0 ? formRef.current?.querySelector<HTMLElement>(selector) : nameRef.current
            ;(target ?? stepHeadingRef.current)?.focus()
        })
        return () => window.cancelAnimationFrame(frame)
    }, [createOpen, creationStep])

    /**
     * Finds a focusable control that is mounted in the current creation step.
     * @returns A current-step field or its accessible heading when no opening exists.
     */
    function creationFocusTarget(): HTMLElement | null {
        if (creationStep === 0) return nameRef.current ?? stepHeadingRef.current
        const selector = creationStep === 1 ? '#agent-prompt' : '#agent-opening-0'
        return formRef.current?.querySelector<HTMLElement>(selector) ?? stepHeadingRef.current
    }

    /**
     * Shows validation feedback and moves to an error's step before focusing its mounted control.
     * @param nextErrors - Relevant validation errors from the shared Agent schema.
     * @returns Nothing; keeps the current draft and schedules only the required focus transfer.
     */
    function showFieldErrors(nextErrors: FieldErrors) {
        setErrors(nextErrors)
        const firstField = Object.keys(nextErrors)[0]
        if (!firstField) return
        const fieldId = fieldControlId(firstField)
        if (createOpen && fieldStep(firstField) !== creationStep) {
            pendingErrorFocus.current = fieldId
            stepHeadingRef.current?.focus()
            setCreationStep(fieldStep(firstField))
        } else {
            ;(formRef.current?.querySelector<HTMLElement>(`[id="${fieldId}"]`) ?? stepHeadingRef.current)?.focus()
        }
    }

    /**
     * Validates only the current creation step before advancing without a request.
     * @returns Nothing; advances one step only when its own fields are valid.
     */
    function advanceCreation() {
        if (savingNow.current || skillReadPending.current || !createOpen || creationStep === 2) return
        const nextErrors = Object.fromEntries(Object.entries(validateDraft()).filter(([field]) => fieldStep(field) === creationStep))
        if (Object.keys(nextErrors).length) {
            showFieldErrors(nextErrors)
            setSaveError('请先检查当前步骤标记的字段。')
            return
        }
        setErrors({})
        setSaveError('')
        stepHeadingRef.current?.focus()
        setCreationStep((creationStep + 1) as CreationStep)
    }

    /**
     * Returns to the preceding creation step without resetting any configuration.
     * @returns Nothing; preserves the complete draft and clears stale request feedback.
     */
    function previousCreation() {
        if (savingNow.current || skillReadPending.current || creationStep === 0) return
        setSaveError('')
        stepHeadingRef.current?.focus()
        setCreationStep((creationStep - 1) as CreationStep)
    }

    /**
     * Treats an early single-line Enter as step navigation while respecting text composition.
     * @param event - Keyboard event bubbling from the current editor controls.
     * @returns Nothing; never submits on an early step or intercepts textarea newlines.
     */
    function handleEditorKeyDown(event: KeyboardEvent<HTMLFormElement>) {
        if (!createOpen || event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        event.preventDefault()
        if (creationStep < 2) advanceCreation()
    }

    /**
     * Updates one editable setting while clearing stale save feedback.
     * @param field - Field to update in the current draft.
     * @param value - New value for that field.
     * @returns Nothing; updates local form state.
     */
    function updateField<K extends keyof AgentInput>(field: K, value: AgentInput[K]) {
        if (savingNow.current || skillReadPending.current) return
        setDraft(current => ({ ...current, [field]: value }))
        setSaveError('')
        setNotice('')
    }

    /**
     * Validates a field after the user leaves it.
     * @param field - Field or opening message whose error should be shown.
     * @returns Nothing; updates that field's inline validation state.
     */
    function validateField(field: keyof FieldErrors) {
        const next = validateDraft()
        setErrors(current => ({ ...current, [field]: next[field] }))
    }

    /**
     * Commits a picker-validated exact version while its read lock still excludes human submits.
     * @param refs - Ordered references verified by the mounted private skill picker.
     * @returns Nothing; atomically updates this draft without reopening the submission window.
     */
    function commitSkillRefs(refs: NonNullable<AgentInput['skillRefs']>) {
        setDraft(current => ({ ...current, skillRefs: refs }))
        setErrors(current => ({ ...current, skillRefs: undefined }))
        setSaveError('')
        setNotice('')
    }

    /**
     * Opens the current saved Agent's complete editor after an explicit edit action.
     * @returns Nothing; starts from the latest confirmed configuration and focuses its name.
     */
    function openEditor() {
        if (savingNow.current || skillReadPending.current || !savedAgent) return
        const input = agentInput(savedAgent)
        setDraft(input)
        setBaseline(input)
        setEditing(true)
        setErrors({})
        setSaveError('')
        setNotice('')
        setPendingAction(null)
        window.requestAnimationFrame(() => nameRef.current?.focus())
    }

    /**
     * Returns focus to a control that remains available in the read-only detail.
     * @returns Nothing; focuses the explicit edit action or the saved detail heading.
     */
    function focusSavedDetail() {
        window.requestAnimationFrame(() => (editButtonRef.current ?? detailHeadingRef.current)?.focus())
    }

    /**
     * Restores the last confirmed configuration without writing a cancelled local draft.
     * @returns Nothing; exits editing and returns focus to the read-only detail.
     */
    function cancelEditing() {
        if (savingNow.current || skillReadPending.current || !savedAgent) return
        const input = agentInput(savedAgent)
        setDraft(input)
        setBaseline(input)
        setEditing(false)
        setErrors({})
        setSaveError('')
        setPendingAction(null)
        focusSavedDetail()
    }

    /**
     * Protects a dirty detail draft before cancelling its full editor.
     * @returns Nothing; either restores saved data or asks for explicit discard confirmation.
     */
    function requestEditCancel() {
        if (savingNow.current || skillReadPending.current) return
        if (dirty) {
            discardedAction.current = null
            setPendingAction({ kind: 'cancel-edit' })
        } else cancelEditing()
    }

    /**
     * Preserves native link behavior while protecting an unsaved in-page return to the list.
     * @param event - Click or keyboard activation of the semantic return link.
     * @returns Nothing; navigation proceeds only when the current draft may safely be left.
     */
    function requestListReturn(event: MouseEvent<HTMLAnchorElement>) {
        if (savingNow.current || skillReadPending.current) {
            event.preventDefault()
            return
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        if (editing && dirty) {
            event.preventDefault()
            discardedAction.current = null
            setPendingAction({ kind: 'return-list' })
        }
    }

    /**
     * Opens a clean creation dialog without mounting a second editor.
     * @returns Nothing; resets only the local creation draft and feedback.
     */
    function openCreation() {
        if (savingNow.current || skillReadPending.current || !data) return
        const input = emptyAgent(data.catalog.defaultModelId)
        setDraft(input)
        setBaseline(input)
        setErrors({})
        setSaveError('')
        setNotice('')
        setPendingAction(null)
        setCreationStep(0)
        pendingErrorFocus.current = null
        setCreateOpen(true)
    }

    /**
     * Discards a confirmed creation draft and restores the saved editing context.
     * @returns Nothing; closes creation without changing any saved Agent.
     */
    function closeCreation() {
        if (savingNow.current || skillReadPending.current) return
        const saved = data?.agents.find(agent => agent.id === selectedId)
        const input = saved ? agentInput(saved) : emptyAgent(data?.catalog.defaultModelId ?? '')
        setDraft(input)
        setBaseline(input)
        setErrors({})
        setSaveError('')
        setPendingAction(null)
        setCreateOpen(false)
        setCreationStep(0)
        pendingErrorFocus.current = null
    }

    /**
     * Opens the collection's creation dialog without exposing it from a detail editor.
     * @returns Nothing; starts a fresh three-step draft when the collection is idle.
     */
    function requestCreation() {
        if (savingNow.current || skillReadPending.current || createOpen || agentId) return
        openCreation()
    }

    /**
     * Routes every idle creation close gesture through the same dirty-draft protection.
     * @returns Nothing; keeps pending writes visible and preserves unconfirmed drafts.
     */
    function requestCreationClose() {
        if (savingNow.current || skillReadPending.current) return
        if (dirty) {
            discardedAction.current = null
            setPendingAction({ kind: 'close-create' })
        } else closeCreation()
    }

    /**
     * Applies only the navigation or close action explicitly confirmed by the user.
     * @returns Nothing; discards a local draft and transfers focus to its destination.
     */
    function confirmDiscard() {
        if (!pendingAction || savingNow.current || skillReadPending.current) return
        discardedAction.current = pendingAction.kind
        if (pendingAction.kind === 'cancel-edit') cancelEditing()
        else if (pendingAction.kind === 'return-list') {
            setPendingAction(null)
            setDraft(baseline)
            setEditing(false)
            router.push('/agents')
        } else closeCreation()
    }

    /**
     * Enables or disables a registered runtime tool for this agent.
     * @param id - Tool from the server capability catalog.
     * @returns Nothing; updates the selected tool identifiers.
     */
    function toggleTool(id: AgentToolId) {
        updateField('toolIds', draft.toolIds.includes(id) ? draft.toolIds.filter(item => item !== id) : [...draft.toolIds, id])
    }

    /**
     * Updates one opening message while preserving the configured order.
     * @param index - Position of the opening message to update.
     * @param value - New assistant greeting text.
     * @returns Nothing; updates the draft's opening messages.
     */
    function updateOpening(index: number, value: string) {
        updateField(
            'openingMessages',
            draft.openingMessages.map((message, position) => (position === index ? value : message))
        )
    }

    /**
     * Reorders an opening message by one position.
     * @param index - Message's current position.
     * @param offset - Direction in which to move the message.
     * @returns Nothing; updates the ordered messages and clears stale errors.
     */
    function moveOpening(index: number, offset: -1 | 1) {
        const messages = [...draft.openingMessages]
        const target = index + offset
        if (target < 0 || target >= messages.length) return
        ;[messages[index], messages[target]] = [messages[target], messages[index]]
        updateField('openingMessages', messages)
        setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('openingMessages'))))
    }

    /**
     * Removes an opening message and clears errors whose positions have shifted.
     * @param index - Position of the opening message to remove.
     * @returns Nothing; removes the selected message from the draft.
     */
    function removeOpening(index: number) {
        updateField(
            'openingMessages',
            draft.openingMessages.filter((_, position) => position !== index)
        )
        setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('openingMessages'))))
    }

    /**
     * Validates the draft and persists it before optionally opening a new chat.
     * @param event - Submit event identifying the chosen save action.
     * @returns A promise settled when saving completes or its error is displayed.
     */
    async function saveAgent(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (savingNow.current || skillReadPending.current || !data || (!createOpen && !selectedId)) return
        if (!createOpen && (!editing || !agentId)) return
        const submitter = (event.nativeEvent as SubmitEvent).submitter
        if (createOpen && creationStep < 2) {
            advanceCreation()
            return
        }
        if (createOpen && (!(submitter instanceof HTMLButtonElement) || submitter.value !== 'create')) return
        const nextErrors = validateDraft()
        if (Object.keys(nextErrors).length) {
            showFieldErrors(nextErrors)
            setSaveError('请先检查标记的字段，再保存 Agent。')
            return
        }
        setErrors({})
        const creating = createOpen
        const startChat = !creating && submitter instanceof HTMLButtonElement && submitter.value === 'chat'
        savingNow.current = true
        setSaving(true)
        setSaveError('')
        setNotice('')
        try {
            const saved = creating ? await createAgent(draft) : await updateAgent(selectedId!, draft)
            if (!activeWorkspace.current) return
            if (!creating && saved.id !== agentId) throw new Error('Agent 服务返回的更新记录与当前详情不匹配，输入已保留。')
            const input = agentInput(saved)
            setData(current =>
                current ? { ...current, agents: [saved, ...current.agents.filter(agent => agent.id !== saved.id)] } : current
            )
            setDraft(input)
            setBaseline(input)
            setSelectedId(saved.id)
            if (creating) {
                setCreateOpen(false)
                setCreationStep(0)
                pendingErrorFocus.current = null
                router.push(`/agents/${encodeURIComponent(saved.id)}`)
            } else {
                setEditing(false)
                if (!startChat) focusSavedDetail()
            }
            setNotice(creating ? '已创建' : '已保存')
            if (startChat) router.push(`/?agent=${encodeURIComponent(saved.id)}`)
        } catch (error) {
            if (activeWorkspace.current) setSaveError(errorMessage(error))
        } finally {
            savingNow.current = false
            if (activeWorkspace.current) setSaving(false)
        }
    }

    if (!data) {
        return (
            <div className={styles.loading}>
                <FeedbackMessage variant={loadError ? 'error' : 'loading'} role={loadError ? 'alert' : 'status'}>
                    {loadError || (agentId ? '正在读取当前 Agent 的已保存配置。' : '正在读取可用模型、工具和已保存的 Agent。')}
                </FeedbackMessage>
                {loadError && (
                    <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                            setLoadError('')
                            setReload(value => value + 1)
                        }}
                    >
                        <RotateCcw size={16} aria-hidden="true" />
                        重新连接
                    </Button>
                )}
                {agentId && (
                    <Link href="/agents" className={buttonVariants({ variant: 'link', className: 'w-fit justify-start' })}>
                        <ArrowLeft aria-hidden="true" />
                        返回 Agents
                    </Link>
                )}
            </div>
        )
    }

    const discardConfirmation = (
        <AlertDialog
            open={Boolean(pendingAction)}
            onOpenChange={open => {
                if (!open) setPendingAction(null)
            }}
        >
            <AlertDialogContent
                initialFocus={discardCancelRef}
                finalFocus={() =>
                    discardedAction.current === 'close-create'
                        ? newAgentRef.current
                        : createOpen
                          ? creationFocusTarget()
                          : editing
                            ? (nameRef.current ?? detailHeadingRef.current)
                            : (editButtonRef.current ?? detailHeadingRef.current ?? true)
                }
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {pendingAction?.kind === 'close-create' ? '放弃新建 Agent 草稿？' : '放弃未保存的更改？'}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {pendingAction?.kind === 'close-create'
                            ? '草稿尚未创建。继续填写可保留全部配置；放弃后下次新建将从默认配置开始。'
                            : pendingAction?.kind === 'return-list'
                              ? '返回 Agents 前，要放弃当前未保存的更改吗？'
                              : '取消编辑将恢复上次保存的配置，要放弃当前未保存的更改吗？'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel ref={discardCancelRef}>
                        {pendingAction?.kind === 'close-create' ? '继续填写' : '继续编辑'}
                    </AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={confirmDiscard}>
                        {pendingAction?.kind === 'close-create'
                            ? '放弃草稿'
                            : pendingAction?.kind === 'return-list'
                              ? '放弃更改并返回'
                              : '放弃更改'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )

    const editor = (
        <div className={createOpen && creationStep < 2 ? styles.stepLayout : styles.layout}>
            <form
                id="agent-editor-form"
                className={cn(styles.form, createOpen && styles.createForm)}
                ref={formRef}
                onSubmit={saveAgent}
                onKeyDown={handleEditorKeyDown}
                noValidate
            >
                <div className={styles.editorHeading}>
                    <h2 id="agent-step-heading" ref={stepHeadingRef} tabIndex={-1}>
                        {createOpen ? creationSteps[creationStep] : '编辑 Agent'}
                    </h2>
                    <Badge variant={saving ? 'info' : dirty ? 'warning' : createOpen ? 'secondary' : 'success'} role="status">
                        {saving ? '正在保存…' : dirty ? '有未保存的更改' : createOpen ? '新草稿' : '所有更改已保存'}
                    </Badge>
                </div>
                {(!createOpen || creationStep === 0) && (
                    <Card>
                        <CardContent>
                            <fieldset className={styles.section} disabled={saving || skillLoading}>
                                <legend className={createOpen ? 'sr-only' : 'mb-4 text-[15px] font-semibold'}>基本信息</legend>
                                <div className={styles.field}>
                                    <Label htmlFor="agent-name">
                                        名称 <span aria-hidden="true">*</span>
                                    </Label>
                                    <Input
                                        ref={nameRef}
                                        id="agent-name"
                                        name="name"
                                        value={draft.name}
                                        maxLength={60}
                                        placeholder="例如：研究助手"
                                        required
                                        aria-invalid={Boolean(errors.name)}
                                        aria-describedby={errors.name ? 'agent-name-error' : undefined}
                                        onChange={event => updateField('name', event.target.value)}
                                        onBlur={() => validateField('name')}
                                    />
                                    {errors.name && (
                                        <p id="agent-name-error" className={styles.fieldError}>
                                            {errors.name}
                                        </p>
                                    )}
                                </div>
                                <div className={styles.field}>
                                    <Label htmlFor="agent-description">
                                        简介 <span className={styles.optional}>选填</span>
                                    </Label>
                                    <Textarea
                                        id="agent-description"
                                        name="description"
                                        rows={2}
                                        value={draft.description}
                                        maxLength={200}
                                        placeholder="一句话介绍它擅长做什么"
                                        aria-invalid={Boolean(errors.description)}
                                        aria-describedby={errors.description ? 'agent-description-error' : undefined}
                                        onChange={event => updateField('description', event.target.value)}
                                        onBlur={() => validateField('description')}
                                    />
                                    {errors.description && (
                                        <p id="agent-description-error" className={styles.fieldError}>
                                            {errors.description}
                                        </p>
                                    )}
                                </div>
                                <div className={styles.field}>
                                    <Label htmlFor="agent-model">
                                        LLM 模型 <span aria-hidden="true">*</span>
                                    </Label>
                                    <div className={styles.selectWrap}>
                                        <NativeSelect
                                            className="w-full"
                                            id="agent-model"
                                            name="modelId"
                                            required
                                            value={draft.modelId}
                                            aria-describedby={errors.modelId ? 'agent-model-hint agent-model-error' : 'agent-model-hint'}
                                            aria-invalid={Boolean(errors.modelId)}
                                            onChange={event => updateField('modelId', event.target.value)}
                                            onBlur={() => validateField('modelId')}
                                        >
                                            {!model && draft.modelId.startsWith('account:') && (
                                                <NativeSelectOption value={draft.modelId} disabled>
                                                    {modelLabel(draft.modelId)}
                                                </NativeSelectOption>
                                            )}
                                            {data.catalog.models.map(item => (
                                                <NativeSelectOption value={item.id} key={item.id} disabled={!item.available}>
                                                    {item.label}
                                                    {item.available ? '' : ' · 未配置'}
                                                </NativeSelectOption>
                                            ))}
                                        </NativeSelect>
                                    </div>
                                    <p className={styles.hint} id="agent-model-hint">
                                        {model?.description ?? '选择账户中的个人连接，或可用的服务端模型。'}
                                        {model && !model.available && ' 当前模型尚未配置，请先添加可用连接。'}{' '}
                                        <Button
                                            variant="link"
                                            disabled={saving || skillLoading}
                                            nativeButton={false}
                                            render={<Link href="/account#models" />}
                                        >
                                            管理我的模型连接
                                        </Button>
                                    </p>
                                    {errors.modelId && (
                                        <p id="agent-model-error" className={styles.fieldError}>
                                            {errors.modelId}
                                        </p>
                                    )}
                                </div>
                            </fieldset>
                        </CardContent>
                    </Card>
                )}

                {(!createOpen || creationStep === 1) && (
                    <Card>
                        <CardContent>
                            <fieldset className={styles.section} disabled={saving || skillLoading}>
                                <legend className={createOpen ? 'sr-only' : 'mb-4 text-[15px] font-semibold'}>行为与能力</legend>
                                <div className={styles.field}>
                                    <div className={styles.labelRow}>
                                        <Label htmlFor="agent-prompt">
                                            系统提示词 <span className={styles.optional}>System prompt</span>
                                        </Label>
                                        <span className={styles.characterCount}>{draft.systemPrompt.length.toLocaleString()} / 32,000</span>
                                    </div>
                                    <Textarea
                                        id="agent-prompt"
                                        name="systemPrompt"
                                        className={styles.prompt}
                                        rows={8}
                                        value={draft.systemPrompt}
                                        maxLength={32000}
                                        placeholder={
                                            '描述 Agent 的角色、目标和工作方式。\n\n例如：你是一位严谨的研究助手。回答时先给出结论，再说明依据；信息不足时先提出澄清问题。'
                                        }
                                        aria-invalid={Boolean(errors.systemPrompt)}
                                        aria-describedby={
                                            errors.systemPrompt ? 'agent-prompt-hint agent-prompt-error' : 'agent-prompt-hint'
                                        }
                                        onChange={event => updateField('systemPrompt', event.target.value)}
                                        onBlur={() => validateField('systemPrompt')}
                                    />
                                    <p className={styles.hint} id="agent-prompt-hint">
                                        这段指令会用于每次对话。留空时使用默认助手行为。
                                    </p>
                                    {errors.systemPrompt && (
                                        <p id="agent-prompt-error" className={styles.fieldError}>
                                            {errors.systemPrompt}
                                        </p>
                                    )}
                                </div>
                                <AgentSkillsEditor
                                    refs={draft.skillRefs ?? []}
                                    snapshots={availableSkillSnapshots}
                                    disabled={saving || skillLoading}
                                    error={errors.skillRefs}
                                    onChange={commitSkillRefs}
                                    onBusyChange={busy => {
                                        skillReadPending.current = busy
                                        setSkillLoading(busy)
                                    }}
                                    onResolve={snapshot =>
                                        setSkillCache(current => [
                                            ...current.filter(item => skillVersionKey(item) !== skillVersionKey(snapshot)),
                                            snapshot,
                                        ])
                                    }
                                />
                                <div className={styles.field}>
                                    <div className={styles.labelRow}>
                                        <span className="text-sm font-medium">
                                            工具 <span className={styles.optional}>Tools</span>
                                        </span>
                                        <span className={styles.characterCount}>已启用 {draft.toolIds.length} 项</span>
                                    </div>
                                    <p className={styles.hint} id="agent-tools-hint">
                                        选择 Agent 可以在对话中调用的能力。
                                    </p>
                                    <div className={styles.toolGrid} role="group" aria-label="可用工具" aria-describedby="agent-tools-hint">
                                        {data.catalog.tools.map(tool => (
                                            <Card size="sm" key={tool.id}>
                                                <CardContent>
                                                    <Label className={styles.toolCard} htmlFor={`agent-tool-${tool.id}`}>
                                                        <Checkbox
                                                            id={`agent-tool-${tool.id}`}
                                                            name="toolIds"
                                                            value={tool.id}
                                                            checked={draft.toolIds.includes(tool.id)}
                                                            disabled={saving || skillLoading}
                                                            onCheckedChange={() => toggleTool(tool.id)}
                                                        />
                                                        <span className={styles.toolIcon}>
                                                            {tool.id === 'calculator' ? (
                                                                <Calculator size={19} aria-hidden="true" />
                                                            ) : (
                                                                <Clock3 size={19} aria-hidden="true" />
                                                            )}
                                                        </span>
                                                        <span className={styles.toolContent}>
                                                            <strong>{tool.label}</strong>
                                                            <span>{tool.description}</span>
                                                        </span>
                                                    </Label>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                    {!data.catalog.tools.length && <p className={styles.hint}>服务端暂未提供可用工具。</p>}
                                    {errors.toolIds && <p className={styles.fieldError}>{errors.toolIds}</p>}
                                </div>
                            </fieldset>
                        </CardContent>
                    </Card>
                )}

                {(!createOpen || creationStep === 2) && (
                    <Card>
                        <CardContent>
                            <fieldset className={styles.section} disabled={saving || skillLoading}>
                                <legend className={createOpen ? 'sr-only' : 'mb-4 text-[15px] font-semibold'}>开场消息</legend>
                                <p className={styles.sectionIntro}>开始新对话时，Agent 会按顺序展示这些消息。最多 5 条。</p>
                                <div className={styles.openings}>
                                    {draft.openingMessages.map((message, index) => (
                                        <Card size="sm" key={index}>
                                            <CardContent className={styles.opening}>
                                                <div className={styles.openingTop}>
                                                    <Label htmlFor={`agent-opening-${index}`}>消息 {index + 1}</Label>
                                                    <div>
                                                        <Tooltip>
                                                            <TooltipTrigger
                                                                render={<Button variant="ghost" size="icon-sm" />}
                                                                type="button"
                                                                aria-label={`上移开场消息 ${index + 1}`}
                                                                disabled={saving || index === 0}
                                                                onClick={() => moveOpening(index, -1)}
                                                            >
                                                                <ArrowUp size={15} aria-hidden="true" />
                                                            </TooltipTrigger>
                                                            <TooltipContent>上移</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                            <TooltipTrigger
                                                                render={<Button variant="ghost" size="icon-sm" />}
                                                                type="button"
                                                                aria-label={`下移开场消息 ${index + 1}`}
                                                                disabled={saving || index === draft.openingMessages.length - 1}
                                                                onClick={() => moveOpening(index, 1)}
                                                            >
                                                                <ArrowDown size={15} aria-hidden="true" />
                                                            </TooltipTrigger>
                                                            <TooltipContent>下移</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                            <TooltipTrigger
                                                                render={<Button variant="ghost" size="icon-sm" />}
                                                                type="button"
                                                                aria-label={`删除开场消息 ${index + 1}`}
                                                                disabled={saving || skillLoading}
                                                                onClick={() => removeOpening(index)}
                                                            >
                                                                <Trash2 size={15} aria-hidden="true" />
                                                            </TooltipTrigger>
                                                            <TooltipContent>删除</TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                                <Textarea
                                                    id={`agent-opening-${index}`}
                                                    rows={3}
                                                    value={message}
                                                    maxLength={2000}
                                                    placeholder="你好，我可以帮你做些什么？"
                                                    aria-invalid={Boolean(errors[`openingMessages.${index}`])}
                                                    aria-describedby={
                                                        errors[`openingMessages.${index}`] ? `agent-opening-${index}-error` : undefined
                                                    }
                                                    onChange={event => updateOpening(index, event.target.value)}
                                                    onBlur={() => validateField(`openingMessages.${index}`)}
                                                />
                                                {errors[`openingMessages.${index}`] && (
                                                    <p className={styles.fieldError} id={`agent-opening-${index}-error`}>
                                                        {errors[`openingMessages.${index}`]}
                                                    </p>
                                                )}
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                                <Button
                                    variant="outline"
                                    type="button"
                                    disabled={saving || draft.openingMessages.length >= 5}
                                    aria-describedby="agent-openings-limit"
                                    onClick={() => updateField('openingMessages', [...draft.openingMessages, ''])}
                                >
                                    <Plus size={16} aria-hidden="true" />
                                    添加开场消息<span>{draft.openingMessages.length} / 5</span>
                                </Button>
                                <p id="agent-openings-limit" className={styles.hint}>
                                    {draft.openingMessages.length >= 5
                                        ? '已达到 5 条上限。可以编辑、排序或删除现有消息。'
                                        : draft.openingMessages.length === 0
                                          ? '也可以留空，由用户发起第一条消息。'
                                          : '使用上下箭头调整显示顺序。'}
                                </p>
                                {errors.openingMessages && <p className={styles.fieldError}>{errors.openingMessages}</p>}
                            </fieldset>
                        </CardContent>
                    </Card>
                )}

                <footer className={styles.formFooter}>
                    {!createOpen && saveError && <FeedbackMessage variant="error">{saveError}</FeedbackMessage>}
                    {!createOpen && notice && (
                        <FeedbackMessage variant="success" role="status">
                            {notice}
                        </FeedbackMessage>
                    )}
                    {!createOpen && (
                        <div className={styles.footerActions}>
                            <Button variant="outline" type="submit" value="save" disabled={saving || skillLoading}>
                                {saving ? (
                                    <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />
                                ) : (
                                    <Save size={16} aria-hidden="true" />
                                )}
                                {saving ? '正在保存' : '保存 Agent'}
                            </Button>
                            <Button type="submit" value="chat" disabled={saving || skillLoading}>
                                保存并开始对话
                                <ArrowRight size={16} aria-hidden="true" />
                            </Button>
                        </div>
                    )}
                </footer>
            </form>

            {(!createOpen || creationStep === 2) && (
                <aside className={styles.preview} aria-label={createOpen ? '完整配置摘要' : 'Agent 配置预览'}>
                    <Card>
                        <CardHeader className={styles.previewHeading}>
                            <CardTitle>{createOpen ? '完整配置摘要' : '配置预览'}</CardTitle>
                            <Badge variant="secondary">实时更新</Badge>
                        </CardHeader>
                        <CardContent className={styles.previewBody}>
                            <Avatar className="size-10">
                                <AvatarFallback>
                                    <Bot size={27} aria-hidden="true" />
                                </AvatarFallback>
                            </Avatar>
                            <h2 className="break-words text-lg font-semibold">{draft.name.trim() || '你的 Agent'}</h2>
                            <p className={styles.previewDescription}>
                                {draft.description.trim() || (createOpen ? '未填写简介' : '为你的工作方式，创建一个专属助手。')}
                            </p>
                            <Badge
                                variant="outline"
                                className={createOpen ? 'h-auto max-w-full whitespace-normal break-words' : 'max-w-full truncate'}
                            >
                                {model?.label ?? modelLabel(draft.modelId)}
                            </Badge>
                            <AgentSkillSnapshots snapshots={draftSkillSnapshots} />
                            {selectedTools.length > 0 && (
                                <div className={styles.previewTools}>
                                    {selectedTools.map(tool => (
                                        <Badge variant="secondary" key={tool.id}>
                                            <Wrench size={12} aria-hidden="true" />
                                            {tool.label}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                            {createOpen && selectedTools.length === 0 && <p className={styles.hint}>未启用工具</p>}
                            <div className={styles.previewDivider}>
                                <Separator />
                                <span>新对话从这里开始</span>
                            </div>
                            {(createOpen ? draft.openingMessages.length > 0 : draft.openingMessages.some(message => message.trim())) ? (
                                <ol className={styles.previewMessages}>
                                    {(createOpen ? draft.openingMessages : draft.openingMessages.filter(message => message.trim())).map(
                                        (message, index) => (
                                            <li key={index}>
                                                <Card size="sm">
                                                    <CardContent className={styles.previewMessage}>
                                                        <Bot size={15} aria-hidden="true" />
                                                        <p>{message || '（尚未填写）'}</p>
                                                    </CardContent>
                                                </Card>
                                            </li>
                                        )
                                    )}
                                </ol>
                            ) : (
                                <div className={styles.previewEmpty}>
                                    <Bot size={22} aria-hidden="true" />
                                    <p>
                                        {createOpen ? (
                                            '未配置开场消息，由用户发起对话。'
                                        ) : (
                                            <>
                                                添加开场消息，
                                                <br />
                                                让第一句对话更自然。
                                            </>
                                        )}
                                    </p>
                                </div>
                            )}
                            {createOpen ? (
                                <section className={styles.promptPreview} aria-label="系统提示词摘要">
                                    <h3 className="font-medium">系统提示词</h3>
                                    <p>{draft.systemPrompt || '使用默认助手行为'}</p>
                                </section>
                            ) : (
                                draft.systemPrompt.trim() && (
                                    <Collapsible className={styles.promptPreview}>
                                        <CollapsibleTrigger render={<Button variant="ghost" />}>
                                            查看系统提示词
                                            <ChevronDown size={14} aria-hidden="true" />
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                            <p>{draft.systemPrompt}</p>
                                        </CollapsibleContent>
                                    </Collapsible>
                                )
                            )}
                        </CardContent>
                        <CardFooter className="flex-col items-stretch gap-3">
                            <p className={styles.previewFootnote}>保存后，在对话中体验 Agent 的实际回复。</p>
                            {!createOpen && selectedId && !dirty && (
                                <Button nativeButton={false} render={<Link href={`/?agent=${encodeURIComponent(selectedId)}`} />}>
                                    使用这个 Agent
                                    <ArrowRight size={15} aria-hidden="true" />
                                </Button>
                            )}
                        </CardFooter>
                    </Card>
                </aside>
            )}
        </div>
    )

    return (
        <div className={styles.page}>
            {agentId && savedAgent ? (
                <>
                    <Link
                        href="/agents"
                        className={buttonVariants({ variant: 'link', className: 'w-fit justify-start' })}
                        aria-disabled={saving || undefined}
                        tabIndex={saving ? -1 : undefined}
                        onClick={requestListReturn}
                    >
                        <ArrowLeft aria-hidden="true" />
                        返回 Agents
                    </Link>
                    <header className={styles.pageHeading}>
                        <div className="min-w-0">
                            <h1 ref={detailHeadingRef} tabIndex={-1} className="break-words">
                                {savedAgent.name}
                            </h1>
                            <p>{editing ? '修改后点击保存' : '查看已保存配置'}</p>
                        </div>
                        {editing ? (
                            <Button type="button" variant="outline" disabled={saving || skillLoading} onClick={requestEditCancel}>
                                取消编辑
                            </Button>
                        ) : (
                            <Button ref={editButtonRef} type="button" onClick={openEditor}>
                                编辑 Agent
                            </Button>
                        )}
                    </header>
                    {!editing && notice && (
                        <FeedbackMessage variant="success" role="status">
                            {notice}
                        </FeedbackMessage>
                    )}
                    {!editing && (
                        <div className={styles.readOnly}>
                            <Card>
                                <CardHeader>
                                    <CardTitle>基本信息</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <dl className={styles.savedFacts}>
                                        <dt>名称</dt>
                                        <dd>{savedAgent.name}</dd>
                                        <dt>简介</dt>
                                        <dd>{savedAgent.description || '未填写简介'}</dd>
                                        <dt>LLM 模型</dt>
                                        <dd>
                                            {data.catalog.models.find(item => item.id === savedAgent.modelId)?.label ??
                                                modelLabel(savedAgent.modelId)}
                                        </dd>
                                        <dt>创建时间</dt>
                                        <dd>
                                            <time dateTime={savedAgent.createdAt}>{savedTime(savedAgent.createdAt)}</time>
                                        </dd>
                                        <dt>更新时间</dt>
                                        <dd>
                                            <time dateTime={savedAgent.updatedAt}>{savedTime(savedAgent.updatedAt)}</time>
                                        </dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card role="region" aria-label="系统提示词">
                                <CardHeader>
                                    <CardTitle>系统提示词</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className={styles.savedText}>{savedAgent.systemPrompt || '未设置系统提示词，使用默认助手行为。'}</p>
                                </CardContent>
                            </Card>
                            <Card role="region" aria-label="技能 Skills">
                                <CardContent>
                                    <AgentSkillSnapshots snapshots={savedAgent.skillSnapshots ?? []} checkUpdates />
                                </CardContent>
                            </Card>
                            <Card role="region" aria-label="工具">
                                <CardHeader>
                                    <CardTitle>工具</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {savedAgent.toolIds.length ? (
                                        <ul className={styles.previewTools}>
                                            {savedAgent.toolIds.map(toolId => (
                                                <li key={toolId}>
                                                    <Badge variant="secondary">
                                                        {data.catalog.tools.find(tool => tool.id === toolId)?.label ??
                                                            (toolId === 'calculator' ? '计算器' : '当前时间')}
                                                    </Badge>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className={styles.hint}>未启用工具</p>
                                    )}
                                </CardContent>
                            </Card>
                            <Card role="region" aria-label="开场消息">
                                <CardHeader>
                                    <CardTitle>开场消息</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {savedAgent.openingMessages.length ? (
                                        <ol className={styles.savedOpenings}>
                                            {savedAgent.openingMessages.map((message, index) => (
                                                <li key={index}>
                                                    <p className={styles.savedText}>{message}</p>
                                                </li>
                                            ))}
                                        </ol>
                                    ) : (
                                        <p className={styles.hint}>未配置开场消息，由用户发起对话。</p>
                                    )}
                                </CardContent>
                            </Card>
                            <div>
                                <Button nativeButton={false} render={<Link href={`/?agent=${encodeURIComponent(savedAgent.id)}`} />}>
                                    使用这个 Agent
                                    <ArrowRight aria-hidden="true" />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <>
                    <header className={styles.pageHeading}>
                        <div className="min-w-0 sm:flex-1">
                            <h1>Agents</h1>
                            <p>为不同工作配置模型、方法和工具。</p>
                        </div>
                        <Button
                            ref={newAgentRef}
                            className="max-w-full shrink-0"
                            variant="default"
                            type="button"
                            disabled={saving || skillLoading}
                            onClick={requestCreation}
                        >
                            <Plus size={16} aria-hidden="true" />
                            <span>新建 Agent</span>
                        </Button>
                    </header>

                    <div className="workspace-toolbar flex flex-wrap items-center gap-3 border-b pb-5">
                        <SearchInput
                            containerClassName="w-full sm:max-w-sm"
                            aria-label="搜索 Agent"
                            placeholder="搜索名称或简介"
                            value={query}
                            onValueChange={setQuery}
                        />
                        <span className="text-sm text-muted-foreground">{data.agents.length} 个 Agent</span>
                    </div>
                    {filteredAgents.length > 0 ? (
                        <ul className={styles.agentList} aria-label="Agent 列表">
                            {filteredAgents.map(agent => (
                                <li key={agent.id} className="min-w-0">
                                    <Card className={styles.agentCard}>
                                        <Link
                                            href={`/agents/${encodeURIComponent(agent.id)}`}
                                            className={styles.agentCardAction}
                                            aria-label={agent.name}
                                        >
                                            <span className="row-span-2 flex min-w-0 items-start">
                                                <Avatar className="size-9 shrink-0">
                                                    <AvatarFallback>
                                                        <Bot size={20} aria-hidden="true" />
                                                    </AvatarFallback>
                                                </Avatar>
                                            </span>
                                            <span className="grid w-full min-w-0 gap-1">
                                                <span className="line-clamp-2 break-words text-sm font-medium leading-5">{agent.name}</span>
                                                <span className="line-clamp-2 break-words text-sm font-normal leading-5 text-muted-foreground">
                                                    {agent.description || '尚未填写简介'}
                                                </span>
                                            </span>
                                            <Badge variant="secondary" className="col-start-2 max-w-full justify-self-start truncate">
                                                {data.catalog.models.find(item => item.id === agent.modelId)?.label ??
                                                    modelLabel(agent.modelId)}
                                            </Badge>
                                        </Link>
                                    </Card>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <EmptyState
                            icon={<Bot aria-hidden="true" />}
                            title={data.agents.length ? '没有匹配的 Agent' : '创建你的第一个 Agent'}
                            description={
                                data.agents.length
                                    ? '换个名称或简介关键词，或清空搜索。'
                                    : '点击“新建 Agent”配置模型、角色、工具和开场消息；创建配置不会调用模型。'
                            }
                        />
                    )}
                </>
            )}

            {!createOpen && discardConfirmation}

            {!createOpen && agentId && editing && editor}
            {!agentId && (
                <Dialog
                    open={createOpen}
                    onOpenChange={(open, event) => {
                        if (!open) {
                            event.cancel()
                            requestCreationClose()
                        }
                    }}
                >
                    <DialogContent
                        ref={setCreatePopup}
                        initialFocus={creationFocusTarget}
                        finalFocus={newAgentRef}
                        showCloseButton={false}
                        className={styles.createDialog}
                    >
                        <DialogHeader className={styles.dialogHeader}>
                            <div className="min-w-0 space-y-2">
                                <DialogTitle>新建 Agent</DialogTitle>
                                <DialogDescription>配置模型、角色、工具与开场消息。确定创建只保存配置，不会开始对话。</DialogDescription>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                type="button"
                                aria-label="关闭新建 Agent"
                                disabled={saving || skillLoading}
                                onClick={requestCreationClose}
                            >
                                <X aria-hidden="true" />
                            </Button>
                        </DialogHeader>
                        <ol className={styles.steps} aria-label="创建步骤">
                            {creationSteps.map((label, index) => (
                                <li key={label} aria-current={index === creationStep ? 'step' : undefined} className={styles.step}>
                                    <Badge variant={index === creationStep ? 'default' : 'outline'}>{index + 1}</Badge>
                                    <span>{label}</span>
                                </li>
                            ))}
                        </ol>
                        <p className={styles.stepProgress} role="status" aria-live="polite">
                            第 {creationStep + 1} 步，共 3 步：{creationSteps[creationStep]}
                        </p>
                        <div className={styles.dialogBody}>{createOpen ? editor : null}</div>
                        <div className={styles.dialogActions}>
                            {createOpen && saveError && <FeedbackMessage variant="error">{saveError}</FeedbackMessage>}
                            <DialogFooter>
                                <Button variant="outline" type="button" disabled={saving || skillLoading} onClick={requestCreationClose}>
                                    取消
                                </Button>
                                {creationStep > 0 && (
                                    <Button
                                        key="previous-step"
                                        variant="outline"
                                        type="button"
                                        disabled={saving || skillLoading}
                                        onClick={previousCreation}
                                    >
                                        上一步
                                    </Button>
                                )}
                                {creationStep < 2 ? (
                                    <Button
                                        key={`next-step-${creationStep}`}
                                        type="button"
                                        disabled={saving || skillLoading}
                                        onClick={event => {
                                            event.preventDefault()
                                            advanceCreation()
                                        }}
                                    >
                                        下一步
                                        <ArrowRight aria-hidden="true" />
                                    </Button>
                                ) : (
                                    <Button
                                        key="confirm-create"
                                        type="submit"
                                        value="create"
                                        form="agent-editor-form"
                                        disabled={saving || skillLoading}
                                    >
                                        {saving && <LoaderCircle className={styles.spinner} aria-hidden="true" />}
                                        {saving ? '正在创建' : '确定创建'}
                                    </Button>
                                )}
                            </DialogFooter>
                        </div>
                        {/* Keep the confirmation in its parent's portal so modal recovery does not hide a sibling overlay. */}
                        <PrivatePortalProvider container={createPopup?.parentElement ?? null} paused={privatePortalContainer === null}>
                            {createOpen ? discardConfirmation : null}
                        </PrivatePortalProvider>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}
