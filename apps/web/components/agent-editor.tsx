'use client'

import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    Bot,
    Calculator,
    Check,
    ChevronDown,
    Clock3,
    LoaderCircle,
    Plus,
    RotateCcw,
    Save,
    Trash2,
    Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AgentCatalog, AgentDefinition, AgentInput, AgentToolId } from '@ai-harness/contracts'
import { agentInputSchema } from '@ai-harness/contracts'
import { createAgent, getAgentCatalog, listAgents, updateAgent } from '../lib/agent-client'
import styles from './agent-editor.module.css'

type FieldErrors = Partial<Record<keyof AgentInput | `openingMessages.${number}`, string>>
type EditorData = { catalog: AgentCatalog; agents: AgentDefinition[] }

/**
 * Creates an empty agent with the server's default model.
 * @param modelId - Configured default model identifier from the catalog.
 * @returns Editable settings with no tools or opening messages selected.
 */
function emptyAgent(modelId: string): AgentInput {
    return { name: '', description: '', modelId, systemPrompt: '', toolIds: [], openingMessages: [] }
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
 * Renders agent management, editable model settings, and a truthful configuration preview.
 * @returns A responsive form backed by the agent API.
 */
export function AgentEditor() {
    const router = useRouter()
    const [data, setData] = useState<EditorData | null>(null)
    const [loadError, setLoadError] = useState('')
    const [reload, setReload] = useState(0)
    const [draft, setDraft] = useState<AgentInput>(emptyAgent(''))
    const [baseline, setBaseline] = useState<AgentInput>(emptyAgent(''))
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [errors, setErrors] = useState<FieldErrors>({})
    const [saveError, setSaveError] = useState('')
    const [notice, setNotice] = useState('')
    const [saving, setSaving] = useState(false)
    const [pendingSelection, setPendingSelection] = useState<{ id: string | null } | null>(null)
    const nameRef = useRef<HTMLInputElement>(null)
    const formRef = useRef<HTMLFormElement>(null)
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
    const model = data?.catalog.models.find(item => item.id === draft.modelId)
    const selectedTools = data?.catalog.tools.filter(tool => draft.toolIds.includes(tool.id)) ?? []

    useEffect(() => {
        const controller = new AbortController()
        /**
         * Establishes the session before loading its private agent list.
         * @returns A promise settled after catalog and saved agents are loaded.
         */
        async function load() {
            try {
                const catalog = await getAgentCatalog(controller.signal)
                const agents = await listAgents(controller.signal)
                if (controller.signal.aborted) return
                const input = emptyAgent(catalog.defaultModelId)
                setData({ catalog, agents })
                setDraft(input)
                setBaseline(input)
                setLoadError('')
            } catch (error) {
                if (!controller.signal.aborted) setLoadError(errorMessage(error))
            }
        }
        void load()
        return () => controller.abort()
    }, [reload])

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

    /**
     * Updates one editable setting while clearing stale save feedback.
     * @param field - Field to update in the current draft.
     * @param value - New value for that field.
     * @returns Nothing; updates local form state.
     */
    function updateField<K extends keyof AgentInput>(field: K, value: AgentInput[K]) {
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
        const next = validateFields(draft)
        setErrors(current => ({ ...current, [field]: next[field] }))
    }

    /**
     * Opens a saved agent or starts a new draft after changes are settled.
     * @param id - Saved identifier, or null to start a new agent.
     * @returns Nothing; resets the editor and moves focus to the name.
     */
    function openAgent(id: string | null) {
        const saved = data?.agents.find(agent => agent.id === id)
        const input = saved ? agentInput(saved) : emptyAgent(data?.catalog.defaultModelId ?? '')
        setDraft(input)
        setBaseline(input)
        setSelectedId(saved?.id ?? null)
        setErrors({})
        setSaveError('')
        setNotice('')
        setPendingSelection(null)
        nameRef.current?.focus()
    }

    /**
     * Protects unsaved edits when switching between agents.
     * @param id - Target saved identifier, or null for a new draft.
     * @returns Nothing; opens the agent or shows a discard confirmation.
     */
    function requestSelection(id: string | null) {
        if (id === selectedId) return
        if (dirty) setPendingSelection({ id })
        else openAgent(id)
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
        if (saving || !data) return
        const nextErrors = validateFields(draft)
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length) {
            const firstField = Object.keys(nextErrors)[0]
            const fieldIds: Record<string, string> = {
                name: 'agent-name',
                description: 'agent-description',
                modelId: 'agent-model',
                systemPrompt: 'agent-prompt',
            }
            const fieldId = firstField.startsWith('openingMessages.') ? `agent-opening-${firstField.split('.')[1]}` : fieldIds[firstField]
            if (fieldId) formRef.current?.querySelector<HTMLElement>(`[id="${fieldId}"]`)?.focus()
            setSaveError('请先检查标记的字段，再保存 Agent。')
            return
        }
        const submitter = (event.nativeEvent as SubmitEvent).submitter
        const startChat = submitter instanceof HTMLButtonElement && submitter.value === 'chat'
        setSaving(true)
        setSaveError('')
        setNotice('')
        try {
            const saved = selectedId ? await updateAgent(selectedId, draft) : await createAgent(draft)
            const input = agentInput(saved)
            setData(current =>
                current ? { ...current, agents: [saved, ...current.agents.filter(agent => agent.id !== saved.id)] } : current
            )
            setDraft(input)
            setBaseline(input)
            setSelectedId(saved.id)
            setNotice('已保存，可以开始对话。')
            if (startChat) router.push(`/?agent=${encodeURIComponent(saved.id)}`)
        } catch (error) {
            setSaveError(errorMessage(error))
        } finally {
            setSaving(false)
        }
    }

    if (!data) {
        return (
            <div className={styles.loading} role={loadError ? 'alert' : 'status'}>
                {loadError ? (
                    <Bot size={28} aria-hidden="true" />
                ) : (
                    <LoaderCircle className={styles.spinner} size={24} aria-hidden="true" />
                )}
                <h1>{loadError ? '暂时无法载入 Agent' : '正在载入 Agent 配置'}</h1>
                <p>{loadError || '正在读取可用模型、工具和已保存的 Agent。'}</p>
                {loadError && (
                    <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={() => {
                            setLoadError('')
                            setReload(value => value + 1)
                        }}
                    >
                        <RotateCcw size={16} aria-hidden="true" />
                        重新连接
                    </button>
                )}
            </div>
        )
    }

    return (
        <div className={styles.page}>
            <header className={styles.pageHeading}>
                <div>
                    <div className={styles.eyebrow}>
                        <Bot size={16} aria-hidden="true" /> AGENTS
                    </div>
                    <h1>让 Agent 按你的方式工作</h1>
                    <p>选择模型，定义它的角色，再赋予它需要的工具。</p>
                </div>
                <span className={styles.count}>{data.agents.length} 个已保存</span>
            </header>

            <nav className={styles.agentList} aria-label="选择要编辑的 Agent">
                <button
                    className={`${styles.agentTab} ${selectedId === null ? styles.activeTab : ''}`}
                    type="button"
                    aria-current={selectedId === null ? 'true' : undefined}
                    disabled={saving}
                    onClick={() => requestSelection(null)}
                >
                    <Plus size={16} aria-hidden="true" />
                    <span>新建 Agent</span>
                </button>
                {data.agents.map(agent => (
                    <button
                        className={`${styles.agentTab} ${selectedId === agent.id ? styles.activeTab : ''}`}
                        type="button"
                        key={agent.id}
                        aria-current={selectedId === agent.id ? 'true' : undefined}
                        disabled={saving}
                        onClick={() => requestSelection(agent.id)}
                    >
                        <Bot size={16} aria-hidden="true" />
                        <span>{agent.name}</span>
                    </button>
                ))}
            </nav>

            {pendingSelection && (
                <div className={styles.discardNotice} role="alert">
                    <p>当前 Agent 有未保存的更改。切换前，要放弃这些更改吗？</p>
                    <div>
                        <button className={styles.secondaryButton} type="button" onClick={() => setPendingSelection(null)}>
                            继续编辑
                        </button>
                        <button className={styles.secondaryButton} type="button" onClick={() => openAgent(pendingSelection.id)}>
                            放弃更改并切换
                        </button>
                    </div>
                </div>
            )}

            <div className={styles.layout}>
                <form className={styles.form} ref={formRef} onSubmit={saveAgent} noValidate>
                    <div className={styles.editorHeading}>
                        <h2>{selectedId ? '编辑 Agent' : '创建 Agent'}</h2>
                        <span className={styles.saveState} role="status">
                            {saving ? '正在保存…' : dirty ? '有未保存的更改' : selectedId ? '所有更改已保存' : '新草稿'}
                        </span>
                    </div>
                    <fieldset className={styles.section} disabled={saving}>
                        <legend>
                            <span>01</span>基本信息
                        </legend>
                        <div className={styles.field}>
                            <label htmlFor="agent-name">
                                名称 <span aria-hidden="true">*</span>
                            </label>
                            <input
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
                            <label htmlFor="agent-description">
                                简介 <span className={styles.optional}>选填</span>
                            </label>
                            <input
                                id="agent-description"
                                name="description"
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
                            <label htmlFor="agent-model">
                                LLM 模型 <span aria-hidden="true">*</span>
                            </label>
                            <div className={styles.selectWrap}>
                                <select
                                    id="agent-model"
                                    name="modelId"
                                    required
                                    value={draft.modelId}
                                    aria-describedby={errors.modelId ? 'agent-model-hint agent-model-error' : 'agent-model-hint'}
                                    aria-invalid={Boolean(errors.modelId)}
                                    onChange={event => updateField('modelId', event.target.value)}
                                    onBlur={() => validateField('modelId')}
                                >
                                    {data.catalog.models.map(item => (
                                        <option value={item.id} key={item.id} disabled={!item.available}>
                                            {item.label}
                                            {item.available ? '' : ' · 未配置'}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={16} aria-hidden="true" />
                            </div>
                            <p className={styles.hint} id="agent-model-hint">
                                {model?.description ?? '模型由服务端提供，密钥由服务端管理。'}
                                {model && !model.available && ' 当前模型尚未在服务端配置，保存后需完成配置才能对话。'}
                            </p>
                            {errors.modelId && (
                                <p id="agent-model-error" className={styles.fieldError}>
                                    {errors.modelId}
                                </p>
                            )}
                        </div>
                    </fieldset>

                    <fieldset className={styles.section} disabled={saving}>
                        <legend>
                            <span>02</span>行为与能力
                        </legend>
                        <div className={styles.field}>
                            <div className={styles.labelRow}>
                                <label htmlFor="agent-prompt">
                                    系统提示词 <span className={styles.optional}>System prompt</span>
                                </label>
                                <span className={styles.characterCount}>{draft.systemPrompt.length.toLocaleString()} / 32,000</span>
                            </div>
                            <textarea
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
                                aria-describedby={errors.systemPrompt ? 'agent-prompt-hint agent-prompt-error' : 'agent-prompt-hint'}
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
                        <div className={styles.field}>
                            <div className={styles.labelRow}>
                                <span className={styles.fieldLabel}>
                                    工具 <span className={styles.optional}>Tools</span>
                                </span>
                                <span className={styles.characterCount}>已启用 {draft.toolIds.length} 项</span>
                            </div>
                            <p className={styles.hint} id="agent-tools-hint">
                                选择 Agent 可以在对话中调用的能力。
                            </p>
                            <div className={styles.toolGrid} role="group" aria-label="可用工具" aria-describedby="agent-tools-hint">
                                {data.catalog.tools.map(tool => (
                                    <label
                                        className={`${styles.toolCard} ${draft.toolIds.includes(tool.id) ? styles.toolSelected : ''}`}
                                        key={tool.id}
                                    >
                                        <input
                                            type="checkbox"
                                            name="toolIds"
                                            value={tool.id}
                                            checked={draft.toolIds.includes(tool.id)}
                                            onChange={() => toggleTool(tool.id)}
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
                                    </label>
                                ))}
                            </div>
                            {!data.catalog.tools.length && <p className={styles.hint}>服务端暂未提供可用工具。</p>}
                            {errors.toolIds && <p className={styles.fieldError}>{errors.toolIds}</p>}
                        </div>
                    </fieldset>

                    <fieldset className={styles.section} disabled={saving}>
                        <legend>
                            <span>03</span>开场消息 <span className={styles.optional}>Opening messages</span>
                        </legend>
                        <p className={styles.sectionIntro}>开始新对话时，Agent 会按顺序展示这些消息。最多 5 条。</p>
                        <div className={styles.openings}>
                            {draft.openingMessages.map((message, index) => (
                                <div className={styles.opening} key={index}>
                                    <div className={styles.openingTop}>
                                        <label htmlFor={`agent-opening-${index}`}>消息 {index + 1}</label>
                                        <div>
                                            <button
                                                className={styles.iconButton}
                                                type="button"
                                                title="上移"
                                                aria-label={`上移开场消息 ${index + 1}`}
                                                disabled={index === 0}
                                                onClick={() => moveOpening(index, -1)}
                                            >
                                                <ArrowUp size={15} aria-hidden="true" />
                                            </button>
                                            <button
                                                className={styles.iconButton}
                                                type="button"
                                                title="下移"
                                                aria-label={`下移开场消息 ${index + 1}`}
                                                disabled={index === draft.openingMessages.length - 1}
                                                onClick={() => moveOpening(index, 1)}
                                            >
                                                <ArrowDown size={15} aria-hidden="true" />
                                            </button>
                                            <button
                                                className={styles.iconButton}
                                                type="button"
                                                title="删除"
                                                aria-label={`删除开场消息 ${index + 1}`}
                                                onClick={() => removeOpening(index)}
                                            >
                                                <Trash2 size={15} aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>
                                    <textarea
                                        id={`agent-opening-${index}`}
                                        rows={3}
                                        value={message}
                                        maxLength={2000}
                                        placeholder="你好，我可以帮你做些什么？"
                                        aria-invalid={Boolean(errors[`openingMessages.${index}`])}
                                        aria-describedby={errors[`openingMessages.${index}`] ? `agent-opening-${index}-error` : undefined}
                                        onChange={event => updateOpening(index, event.target.value)}
                                        onBlur={() => validateField(`openingMessages.${index}`)}
                                    />
                                    {errors[`openingMessages.${index}`] && (
                                        <p className={styles.fieldError} id={`agent-opening-${index}-error`}>
                                            {errors[`openingMessages.${index}`]}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                        <button
                            className={styles.addMessage}
                            type="button"
                            disabled={draft.openingMessages.length >= 5}
                            aria-describedby="agent-openings-limit"
                            onClick={() => updateField('openingMessages', [...draft.openingMessages, ''])}
                        >
                            <Plus size={16} aria-hidden="true" />
                            添加开场消息<span>{draft.openingMessages.length} / 5</span>
                        </button>
                        <p id="agent-openings-limit" className={styles.hint}>
                            {draft.openingMessages.length >= 5
                                ? '已达到 5 条上限。可以编辑、排序或删除现有消息。'
                                : draft.openingMessages.length === 0
                                  ? '也可以留空，由用户发起第一条消息。'
                                  : '使用上下箭头调整显示顺序。'}
                        </p>
                        {errors.openingMessages && <p className={styles.fieldError}>{errors.openingMessages}</p>}
                    </fieldset>

                    <footer className={styles.formFooter}>
                        {saveError && (
                            <p className={styles.saveError} role="alert">
                                {saveError}
                            </p>
                        )}
                        {notice && (
                            <p className={styles.notice} role="status">
                                <Check size={15} aria-hidden="true" />
                                {notice}
                            </p>
                        )}
                        <div className={styles.footerActions}>
                            <button className={styles.secondaryButton} type="submit" value="save" disabled={saving}>
                                {saving ? (
                                    <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />
                                ) : (
                                    <Save size={16} aria-hidden="true" />
                                )}
                                {saving ? '正在保存' : '保存 Agent'}
                            </button>
                            <button className={styles.primaryButton} type="submit" value="chat" disabled={saving}>
                                保存并开始对话
                                <ArrowRight size={16} aria-hidden="true" />
                            </button>
                        </div>
                    </footer>
                </form>

                <aside className={styles.preview} aria-label="Agent 配置预览">
                    <div className={styles.previewHeading}>
                        <span>配置预览</span>
                        <span className={styles.previewLabel}>实时更新</span>
                    </div>
                    <div className={styles.previewBody}>
                        <div className={styles.avatar}>
                            <Bot size={27} strokeWidth={1.5} aria-hidden="true" />
                        </div>
                        <h2>{draft.name.trim() || '你的 Agent'}</h2>
                        <p className={styles.previewDescription}>{draft.description.trim() || '为你的工作方式，创建一个专属助手。'}</p>
                        <span className={styles.modelBadge}>
                            <span />
                            {model?.label ?? draft.modelId}
                        </span>
                        {selectedTools.length > 0 && (
                            <div className={styles.previewTools}>
                                {selectedTools.map(tool => (
                                    <span key={tool.id}>
                                        <Wrench size={12} aria-hidden="true" />
                                        {tool.label}
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className={styles.previewDivider}>
                            <span>新对话从这里开始</span>
                        </div>
                        {draft.openingMessages.some(message => message.trim()) ? (
                            <div className={styles.previewMessages}>
                                {draft.openingMessages
                                    .filter(message => message.trim())
                                    .map((message, index) => (
                                        <div className={styles.previewMessage} key={index}>
                                            <Bot size={15} aria-hidden="true" />
                                            <p>{message}</p>
                                        </div>
                                    ))}
                            </div>
                        ) : (
                            <div className={styles.previewEmpty}>
                                <Bot size={22} strokeWidth={1.5} aria-hidden="true" />
                                <p>
                                    添加开场消息，
                                    <br />
                                    让第一句对话更自然。
                                </p>
                            </div>
                        )}
                        {draft.systemPrompt.trim() && (
                            <details className={styles.promptPreview}>
                                <summary>
                                    查看系统提示词
                                    <ChevronDown size={14} aria-hidden="true" />
                                </summary>
                                <p>{draft.systemPrompt}</p>
                            </details>
                        )}
                    </div>
                    <div className={styles.previewFootnote}>保存后，在对话中体验 Agent 的实际回复。</div>
                    {selectedId && !dirty && (
                        <Link className={styles.useAgent} href={`/?agent=${encodeURIComponent(selectedId)}`}>
                            使用这个 Agent
                            <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                    )}
                </aside>
            </div>
        </div>
    )
}
