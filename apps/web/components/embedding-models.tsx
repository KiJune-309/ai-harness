'use client'

import { createEmbeddingModelSchema, updateEmbeddingModelSchema, type EmbeddingModel } from '@ai-harness/contracts'
import { Check, Plus, Star, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
    createEmbeddingModel,
    deleteEmbeddingModel,
    listEmbeddingModels,
    setDefaultEmbeddingModel,
    testEmbeddingModel,
    updateEmbeddingModel,
} from '../lib/embedding-client'
import styles from './account-workspace.styles'
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
import { Input } from './ui/input'
import { Label } from './ui/label'

type ModelFields = { name: string; baseUrl: string; model: string; apiKey: string }
const blankFields: ModelFields = { name: '', baseUrl: '', model: '', apiKey: '' }

/**
 * Renders independent embedding connection controls with write-only keys.
 * @returns The connection list, editor, explicit tests, and deletion confirmation.
 */
export function EmbeddingModels() {
    const [models, setModels] = useState<EmbeddingModel[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [selectedRevision, setSelectedRevision] = useState(1)
    const [fields, setFields] = useState<ModelFields>(blankFields)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [revision, setRevision] = useState(0)
    const [busy, setBusy] = useState('')
    const [feedback, setFeedback] = useState<{ error?: string; success?: string }>({})
    const [testFeedback, setTestFeedback] = useState<Record<string, { error?: string; success?: string }>>({})
    const [deleting, setDeleting] = useState<EmbeddingModel | null>(null)
    const deleteCancelRef = useRef<HTMLButtonElement>(null)
    const testController = useRef<AbortController | null>(null)
    // A failed create keeps this in-memory action identity until its normalized fields change.
    const creation = useRef<{ fingerprint: string; requestId: string } | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        listEmbeddingModels(controller.signal)
            .then(items => {
                if (controller.signal.aborted) return
                setModels(items)
                setLoadError('')
                setLoading(false)
            })
            .catch(cause => {
                if (controller.signal.aborted) return
                setLoadError(cause instanceof Error ? cause.message : '模型连接暂时无法载入。')
                setLoading(false)
            })
        return () => controller.abort()
    }, [revision])

    useEffect(() => () => testController.current?.abort(), [])

    /**
     * Opens a saved connection without ever reading its secret key.
     * @param item - Saved metadata, or null for an empty creation form.
     * @returns Nothing; replaces editor fields and clears stale errors and secrets.
     */
    function select(item: EmbeddingModel | null) {
        if (busy) return
        setSelectedId(item?.id ?? null)
        setSelectedRevision(item?.revision ?? 1)
        setFields(item ? { name: item.name, baseUrl: item.baseUrl, model: item.model, apiKey: '' } : blankFields)
        setErrors({})
        setFeedback({})
        creation.current = null
    }

    /**
     * Replaces safe connection metadata while respecting the single-default invariant.
     * @param saved - Confirmed record returned by the account API.
     * @returns Nothing; updates the visible list.
     */
    function merge(saved: EmbeddingModel) {
        setTestFeedback(previous => ({ ...previous, [saved.id]: {} }))
        setModels(current => [
            saved,
            ...current.filter(item => item.id !== saved.id).map(item => (saved.isDefault ? { ...item, isDefault: false } : item)),
        ])
    }

    /**
     * Saves only validated editor fields and preserves a failed creation's action identifier.
     * @param event - Model editor submission.
     * @returns After a confirmed save or a recoverable local or network failure.
     */
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (busy || loading || loadError) return
        const input = { name: fields.name.trim(), baseUrl: fields.baseUrl.trim(), model: fields.model.trim(), apiKey: fields.apiKey.trim() }
        const fingerprint = JSON.stringify(input)
        if (!selectedId && creation.current?.fingerprint !== fingerprint) creation.current = { fingerprint, requestId: crypto.randomUUID() }
        const candidate = selectedId ? { ...input, revision: selectedRevision } : { ...input, requestId: creation.current!.requestId }
        const parsed = (selectedId ? updateEmbeddingModelSchema : createEmbeddingModelSchema).safeParse(candidate)
        const nextErrors: Record<string, string> = {}
        if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] ??= issue.message
        setErrors(nextErrors)
        setFeedback({})
        if (!parsed.success) {
            const form = event.currentTarget
            requestAnimationFrame(() => form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
            return
        }
        setBusy('save')
        try {
            const saved = selectedId
                ? await updateEmbeddingModel(selectedId, updateEmbeddingModelSchema.parse(candidate))
                : await createEmbeddingModel(createEmbeddingModelSchema.parse(candidate))
            merge(saved)
            setSelectedId(saved.id)
            setSelectedRevision(saved.revision)
            setFields({ name: saved.name, baseUrl: saved.baseUrl, model: saved.model, apiKey: '' })
            creation.current = null
            setFeedback({ success: '向量连接已保存，保存不会请求服务商。请主动测试后再建立索引。' })
        } catch (cause) {
            setFeedback({ error: cause instanceof Error ? cause.message : '连接未能保存，请重试。' })
        } finally {
            setBusy('')
        }
    }

    /**
     * Sets an explicitly selected saved model as the default for new content.
     * @param item - Owned connection to select.
     * @returns After the server confirms the single-default update.
     */
    async function chooseDefault(item: EmbeddingModel) {
        if (busy) return
        setBusy(`default:${item.id}`)
        setTestFeedback(previous => ({ ...previous, [item.id]: {} }))
        try {
            merge(await setDefaultEmbeddingModel(item.id))
            setTestFeedback(previous => ({
                ...previous,
                [item.id]: { success: '已设为默认向量模型。其他空间的索引须手动重建，未验证的连接须先测试。' },
            }))
        } catch (cause) {
            setTestFeedback(previous => ({
                ...previous,
                [item.id]: { error: cause instanceof Error ? cause.message : '默认连接未能更新。' },
            }))
        } finally {
            setBusy('')
        }
    }

    /**
     * Starts one explicit cancellable provider test against a saved connection.
     * @param item - Owned saved connection selected by the user.
     * @returns After a bounded test, failure, or explicit cancellation.
     */
    async function test(item: EmbeddingModel) {
        if (busy) return
        const controller = new AbortController()
        testController.current = controller
        setBusy(`test:${item.id}`)
        setTestFeedback(previous => ({ ...previous, [item.id]: {} }))
        try {
            const result = await testEmbeddingModel(item.id, controller.signal)
            if (controller.signal.aborted) return
            merge(result.model)
            setTestFeedback(previous => ({ ...previous, [item.id]: { success: result.message || '已验证实际模型和向量维度。' } }))
        } catch (cause) {
            setTestFeedback(previous => ({
                ...previous,
                [item.id]: controller.signal.aborted
                    ? { success: '测试已取消。' }
                    : { error: cause instanceof Error ? cause.message : '连接测试失败，请重试。' },
            }))
        } finally {
            if (testController.current === controller) testController.current = null
            setBusy('')
        }
    }

    /**
     * Deletes the confirmed connection without removing original documents or chunks.
     * @returns After confirmed deletion or a visible retryable failure.
     */
    async function confirmDelete() {
        if (!deleting || busy) return
        const item = deleting
        setBusy(`delete:${item.id}`)
        setFeedback({})
        try {
            await deleteEmbeddingModel(item.id)
            setModels(current => current.filter(model => model.id !== item.id))
            if (selectedId === item.id) {
                setSelectedId(null)
                setFields(blankFields)
                setErrors({})
                creation.current = null
            }
            setDeleting(null)
            setFeedback({ success: '向量连接已删除，原始资料与分片仍会保留。' })
        } catch (cause) {
            setFeedback({ error: cause instanceof Error ? cause.message : '连接未能删除，请重试。' })
        } finally {
            setBusy('')
        }
    }

    return (
        <section role="region" id="embedding-models" className={styles.section} aria-labelledby="embedding-models-title">
            <div className={styles.sectionLayout}>
                <div className={styles.sectionIntro}>
                    <h2 id="embedding-models-title">向量模型</h2>
                    <p>独立配置 OpenAI 兼容的 embedding 服务，用于向量索引与检索，不用于聊天。</p>
                    <p>保存、编辑和设默认不会请求服务商。测试使用两条固定短文本；测试、手动索引和查询可能产生服务商费用。</p>
                </div>
                <div className={styles.modelArea}>
                    {loading ? (
                        <FeedbackMessage variant="loading" role="status">
                            正在载入模型连接…
                        </FeedbackMessage>
                    ) : loadError ? (
                        <FeedbackMessage variant="error">
                            <p>{loadError}</p>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setLoading(true)
                                    setLoadError('')
                                    setRevision(value => value + 1)
                                }}
                            >
                                重新载入连接
                            </Button>
                        </FeedbackMessage>
                    ) : (
                        <>
                            <div className={styles.modelList}>
                                <div className={styles.listHeading}>
                                    <span>{models.length ? `${models.length} 个个人连接` : '尚无个人连接'}</span>
                                    <Button type="button" variant="outline" onClick={() => select(null)} disabled={Boolean(busy)}>
                                        <Plus size={15} aria-hidden="true" />
                                        添加连接
                                    </Button>
                                </div>
                                {!models.length && (
                                    <p className={styles.empty}>添加专用向量模型连接并主动测试。不会自动复用聊天模型或聊天密钥。</p>
                                )}
                                {models.map(item => (
                                    <article className={styles.modelCard} key={item.id}>
                                        <div className={styles.modelCardContent}>
                                            <div className={styles.modelTitle}>
                                                <strong>{item.name}</strong>
                                                {selectedId === item.id && <Badge variant="outline">正在编辑</Badge>}
                                                {item.isDefault && (
                                                    <Badge variant="secondary">
                                                        <Star size={11} aria-hidden="true" />
                                                        默认
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className={styles.modelCode}>{item.model}</p>
                                            <p className={styles.modelUrl}>{item.baseUrl}</p>
                                            <p className={styles.hint}>
                                                <Check size={12} aria-hidden="true" />
                                                API key 已配置 · 版本 {item.revision}
                                            </p>
                                            <FeedbackMessage variant={item.verifiedAt ? 'success' : 'warning'}>
                                                {item.verifiedAt
                                                    ? `已验证 · ${item.dimensions} 维 · ${item.providerModel}`
                                                    : '尚未验证：请测试连接后再建立索引或查询。'}
                                            </FeedbackMessage>
                                            <div className={styles.cardActions}>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => select(item)}
                                                    disabled={Boolean(busy)}
                                                >
                                                    编辑
                                                </Button>
                                                {busy === `test:${item.id}` ? (
                                                    <Button type="button" variant="outline" onClick={() => testController.current?.abort()}>
                                                        取消测试
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={() => test(item)}
                                                        disabled={Boolean(busy)}
                                                    >
                                                        测试连接
                                                    </Button>
                                                )}
                                                {!item.isDefault && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={() => chooseDefault(item)}
                                                        disabled={Boolean(busy)}
                                                    >
                                                        {busy === `default:${item.id}` ? '正在设置…' : '设为默认'}
                                                    </Button>
                                                )}
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="text-muted-foreground hover:text-destructive"
                                                    aria-label={`删除连接 ${item.name}`}
                                                    onClick={() => {
                                                        setFeedback({})
                                                        setDeleting(item)
                                                    }}
                                                    disabled={Boolean(busy)}
                                                >
                                                    <Trash2 size={14} aria-hidden="true" />
                                                    <span>删除</span>
                                                </Button>
                                            </div>
                                            {busy === `test:${item.id}` && (
                                                <FeedbackMessage variant="loading" role="status">
                                                    正在测试已保存的连接…
                                                </FeedbackMessage>
                                            )}
                                            {testFeedback[item.id]?.error && (
                                                <FeedbackMessage variant="error">{testFeedback[item.id].error}</FeedbackMessage>
                                            )}
                                            {testFeedback[item.id]?.success && (
                                                <FeedbackMessage
                                                    variant={testFeedback[item.id].success === '测试已取消。' ? 'info' : 'success'}
                                                    role="status"
                                                >
                                                    {testFeedback[item.id].success}
                                                </FeedbackMessage>
                                            )}
                                        </div>
                                    </article>
                                ))}
                            </div>
                            <form onSubmit={save} className={styles.modelForm} aria-busy={busy === 'save'} noValidate>
                                <div className={styles.editorHeading}>
                                    <h3>{selectedId ? '编辑连接' : '添加模型连接'}</h3>
                                    {selectedId && (
                                        <Button type="button" variant="outline" onClick={() => select(null)} disabled={Boolean(busy)}>
                                            完成编辑
                                        </Button>
                                    )}
                                </div>
                                <p className={styles.hint}>
                                    {selectedId
                                        ? '变更地址、模型或 key 将使验证和旧索引失效，须重新测试并手动重建；只改名称不影响向量空间。'
                                        : '保存不会请求模型。维度由主动测试读取，无需手动填写；建议使用稳定或带版本的模型标识。'}
                                </p>
                                <fieldset className={styles.fields} disabled={Boolean(busy)}>
                                    {(['name', 'baseUrl', 'model', 'apiKey'] as const).map(key => (
                                        <div className={styles.field} key={key}>
                                            <Label htmlFor={`embedding-model-${key}`}>
                                                {key === 'name'
                                                    ? '连接名称'
                                                    : key === 'baseUrl'
                                                      ? 'Base URL'
                                                      : key === 'model'
                                                        ? '模型标识'
                                                        : 'API key'}
                                                {key === 'apiKey' && selectedId && <span className={styles.optional}>留空保留</span>}
                                            </Label>
                                            <Input
                                                id={`embedding-model-${key}`}
                                                type={key === 'apiKey' ? 'password' : key === 'baseUrl' ? 'url' : 'text'}
                                                value={fields[key]}
                                                onChange={event => setFields(previous => ({ ...previous, [key]: event.target.value }))}
                                                autoComplete={key === 'apiKey' ? 'off' : undefined}
                                                spellCheck={key === 'name' ? undefined : false}
                                                autoCapitalize={key === 'name' ? undefined : 'none'}
                                                maxLength={key === 'name' ? 60 : key === 'model' ? 120 : key === 'baseUrl' ? 2048 : 8192}
                                                placeholder={
                                                    key === 'name'
                                                        ? '例如：我的向量服务'
                                                        : key === 'baseUrl'
                                                          ? 'https://api.example.com/v1'
                                                          : key === 'model'
                                                            ? '服务商的 embedding 模型 ID'
                                                            : selectedId
                                                              ? '已安全保存，留空保留原 key'
                                                              : '输入服务商提供的 API key'
                                                }
                                                required={key !== 'apiKey' || !selectedId}
                                                aria-invalid={Boolean(errors[key])}
                                                aria-describedby={`embedding-model-${key}-hint`}
                                            />
                                            <span id={`embedding-model-${key}-hint`} className={errors[key] ? styles.error : styles.hint}>
                                                {errors[key] ||
                                                    (key === 'baseUrl'
                                                        ? '填写 API 基础地址，系统追加 /embeddings；请勿填写完整 embeddings 或聊天地址。'
                                                        : key === 'apiKey'
                                                          ? selectedId
                                                              ? '输入新 key 会替换原值；已保存的 key 不会回显。'
                                                              : '仅保存在服务端，保存成功后输入框会清空。'
                                                          : key === 'model'
                                                            ? '使用服务商的专用 embedding 模型 ID；支持实际输出 1–4096 维。'
                                                            : '为这条连接起一个容易辨认的名字。')}
                                            </span>
                                        </div>
                                    ))}
                                </fieldset>
                                {!deleting && feedback.error && <FeedbackMessage variant="error">{feedback.error}</FeedbackMessage>}
                                {feedback.success && (
                                    <FeedbackMessage variant="success" role="status">
                                        {feedback.success}
                                    </FeedbackMessage>
                                )}
                                <Button type="submit" disabled={Boolean(busy)}>
                                    {busy === 'save' ? '正在保存…' : selectedId ? '保存连接' : '添加连接'}
                                </Button>
                            </form>
                        </>
                    )}
                </div>
            </div>
            <AlertDialog
                open={Boolean(deleting)}
                onOpenChange={open => {
                    if (!open && !busy) setDeleting(null)
                }}
            >
                <AlertDialogContent initialFocus={deleteCancelRef}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>删除向量模型连接？</AlertDialogTitle>
                        <AlertDialogDescription>
                            将删除“{deleting?.name}”。原始资料与分片仍保留，使用此连接的向量索引将不可用，不会自动换用其他模型。
                            {deleting?.isDefault && <> {'这也是默认向量连接。删除后默认会清空，不自动选择其他向量或聊天连接。'}</>}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {feedback.error && <FeedbackMessage variant="error">{feedback.error}</FeedbackMessage>}
                    <AlertDialogFooter>
                        <AlertDialogCancel ref={deleteCancelRef} disabled={Boolean(busy)}>
                            保留连接
                        </AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={confirmDelete} disabled={Boolean(busy)}>
                            {busy.startsWith('delete:') ? '正在删除…' : '确认删除'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    )
}
