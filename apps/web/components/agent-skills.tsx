'use client'

import { useEffect, useRef, useState } from 'react'
import type { SkillRef, SkillSnapshot, SkillSummary } from '@ai-harness/contracts'
import { getSkill, listSkills } from '../lib/skill-client'
import { SkillFullText } from './skills-workspace'
import { FeedbackMessage } from './ui/feedback-message'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { SearchInput } from './ui/search-input'

export const skillBindingHint = '技能提供工作方法；工具权限仍由工具选择决定。库更新不会自动改变 Agent 或已有对话。'

/**
 * Identifies an exact frozen skill version without conflating same-name records.
 * @param ref - Stable private identity and immutable version.
 * @returns A local cache key containing no skill body.
 */
export function skillVersionKey(ref: SkillRef): string {
    return `${ref.skillId}:${ref.version}`
}

/**
 * Validates resolved binding bodies before an Agent step or save may proceed.
 * @param refs - Human-selected ordered exact references.
 * @param snapshots - Authorized exact bodies already read or frozen in the saved Agent.
 * @returns A visible error, or empty text for a fully resolved legal selection.
 */
export function skillBindingError(refs: SkillRef[], snapshots: SkillSnapshot[]): string {
    if (refs.length > 5) return '最多绑定 5 个技能。'
    if (new Set(refs.map(ref => ref.skillId)).size !== refs.length) return '同一技能不能重复绑定。'
    const selected = refs.map(ref => snapshots.find(snapshot => skillVersionKey(snapshot) === skillVersionKey(ref)))
    if (selected.some(snapshot => !snapshot)) return '部分技能版本尚未读取，请重试后再保存。'
    if (selected.reduce((sum, snapshot) => sum + (snapshot?.content.length ?? 0), 0) > 32000) return '已选技能正文合计最多 32000 个字。'
    return ''
}

/**
 * Shows fixed version identities and opens only their already authorized full snapshot bodies.
 * @param props - Ordered frozen snapshots and optional current-library update hints.
 * @returns Full-text access without silently updating any binding.
 */
export function AgentSkillSnapshots({ snapshots, checkUpdates = false }: { snapshots: SkillSnapshot[]; checkUpdates?: boolean }) {
    const [view, setView] = useState<SkillSnapshot | null>(null)
    const [library, setLibrary] = useState<SkillSummary[]>([])
    const [error, setError] = useState('')
    useEffect(() => {
        if (!checkUpdates || snapshots.length === 0) return
        const controller = new AbortController()
        void listSkills(controller.signal)
            .then(records => {
                if (!controller.signal.aborted) {
                    setLibrary(records)
                    setError('')
                }
            })
            .catch(cause => {
                if (!controller.signal.aborted)
                    setError(cause instanceof Error ? cause.message : '暂时无法检查新版，已保存的版本保持不变。')
            })
        return () => controller.abort()
    }, [checkUpdates, snapshots])
    return (
        <section className="grid min-w-0 gap-3" aria-label="已绑定技能">
            <h3 className="font-medium">技能 Skills</h3>
            {snapshots.length ? (
                <ol className="grid min-w-0">
                    {snapshots.map(snapshot => {
                        const latest = library.find(item => item.id === snapshot.skillId)
                        return (
                            <li key={snapshot.skillId} className="grid min-w-0 gap-2 border-b py-4 last:border-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="min-w-0 [overflow-wrap:anywhere]">{snapshot.title}</span>
                                    <Badge variant="secondary">v{snapshot.version}</Badge>
                                    <span className="text-xs text-muted-foreground">{snapshot.skillId.slice(0, 8)}</span>
                                </div>
                                {latest && latest.version > snapshot.version && (
                                    <p className="text-xs text-muted-foreground">
                                        当前 v{snapshot.version}，可更新到 v{latest.version}。编辑 Agent 后可明确使用新版。
                                    </p>
                                )}
                                <Button type="button" variant="outline" onClick={() => setView(snapshot)}>
                                    查看 v{snapshot.version} 全文
                                </Button>
                            </li>
                        )
                    })}
                </ol>
            ) : (
                <p className="text-sm text-muted-foreground">未绑定技能</p>
            )}
            <p className="text-xs text-muted-foreground">{skillBindingHint}</p>
            {error && (
                <FeedbackMessage variant="error" role="alert">
                    {error}
                </FeedbackMessage>
            )}
            <SkillSnapshotDialog snapshot={view} onClose={() => setView(null)} />
        </section>
    )
}

/**
 * Displays a frozen version in a scrollable literal-text review dialog.
 * @param props - Exact selected snapshot and explicit close action.
 * @returns Complete original text with reachable footer controls.
 */
function SkillSnapshotDialog({ snapshot, onClose }: { snapshot: SkillSnapshot | null; onClose(): void }) {
    const heading = useRef<HTMLHeadingElement>(null)
    return (
        <Dialog
            open={snapshot !== null}
            onOpenChange={open => {
                if (!open) onClose()
            }}
        >
            <DialogContent initialFocus={heading} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle ref={heading} tabIndex={-1}>
                        技能版本全文
                    </DialogTitle>
                    <DialogDescription>查看绑定的精确版本，正文按原始文本显示。</DialogDescription>
                </DialogHeader>
                {snapshot && <SkillFullText skill={snapshot} />}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        关闭
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Selects exact private skill versions in explicit human selection order.
 * @param props - Editable references, resolved version cache, and parent-owned draft updates.
 * @returns Full-text, explicit upgrade/removal, counts, and truthful library feedback.
 */
export function AgentSkillsEditor({
    refs,
    snapshots,
    disabled = false,
    error,
    onChange,
    onResolve,
    onBusyChange,
}: {
    refs: SkillRef[]
    snapshots: SkillSnapshot[]
    disabled?: boolean
    error?: string
    onChange(refs: SkillRef[]): void
    onResolve(snapshot: SkillSnapshot): void
    onBusyChange?(busy: boolean): void
}) {
    const [library, setLibrary] = useState<SkillSummary[] | null>(null)
    const [loadError, setLoadError] = useState('')
    const [actionError, setActionError] = useState('')
    const [query, setQuery] = useState('')
    const [revision, setRevision] = useState(0)
    const [busy, setBusy] = useState(false)
    const [view, setView] = useState<SkillSnapshot | null>(null)
    const alive = useRef(true)
    const lock = useRef(false)
    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
        }
    }, [])
    useEffect(() => {
        const controller = new AbortController()
        void listSkills(controller.signal)
            .then(records => {
                if (!controller.signal.aborted) {
                    setLibrary(records)
                    setLoadError('')
                }
            })
            .catch(cause => {
                if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : '技能库暂不可用，请重试。')
            })
        return () => controller.abort()
    }, [revision])
    const selected = refs.map(ref => snapshots.find(snapshot => skillVersionKey(snapshot) === skillVersionKey(ref)))
    const total = selected.reduce((sum, snapshot) => sum + (snapshot?.content.length ?? 0), 0)
    /**
     * Reads and explicitly selects the chosen current version without replacing other positions.
     * @param summary - Exact real library item selected by the human.
     * @returns After the chosen body is verified and selection updated or visibly rejected.
     */
    async function select(summary: SkillSummary) {
        if (disabled || lock.current) return
        const index = refs.findIndex(ref => ref.skillId === summary.id)
        if (index < 0 && refs.length >= 5) {
            setActionError('最多绑定 5 个技能。')
            return
        }
        lock.current = true
        onBusyChange?.(true)
        setBusy(true)
        setActionError('')
        try {
            const record = await getSkill(summary.id, summary.version)
            if (record.id !== summary.id || record.version !== summary.version) throw new Error('技能返回的版本不匹配，请重新载入。')
            const snapshot: SkillSnapshot = {
                skillId: record.id,
                version: record.version,
                title: record.title,
                description: record.description,
                content: record.content,
            }
            const nextRefs =
                index < 0
                    ? [...refs, { skillId: record.id, version: record.version }]
                    : refs.map((ref, position) => (position === index ? { skillId: record.id, version: record.version } : ref))
            const nextSnapshots = [...snapshots.filter(item => skillVersionKey(item) !== skillVersionKey(snapshot)), snapshot]
            const validation = skillBindingError(nextRefs, nextSnapshots)
            if (validation) throw new Error(validation)
            if (alive.current) {
                onResolve(snapshot)
                onChange(nextRefs)
            }
        } catch (cause) {
            if (alive.current) setActionError(cause instanceof Error ? cause.message : '无法读取所选技能，请重试。')
        } finally {
            lock.current = false
            if (alive.current) {
                setBusy(false)
                onBusyChange?.(false)
            }
        }
    }
    return (
        <section
            id="agent-skills"
            tabIndex={-1}
            aria-label="技能 Skills"
            aria-describedby={error ? 'agent-skills-hint agent-skills-error' : 'agent-skills-hint'}
            className="grid min-w-0 gap-3 outline-none"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">技能 Skills</h3>
                <span className="text-xs text-muted-foreground">
                    已选 {refs.length} / 5 · {total.toLocaleString()} / 32,000 字
                </span>
            </div>
            <p id="agent-skills-hint" className="text-xs text-muted-foreground">
                {skillBindingHint}
            </p>
            {refs.length ? (
                <ol className="grid min-w-0">
                    {refs.map((ref, index) => {
                        const snapshot = selected[index]
                        const latest = library?.find(skill => skill.id === ref.skillId)
                        return (
                            <li key={ref.skillId} className="grid min-w-0 gap-3 border-b py-4 last:border-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                                        {index + 1}. {snapshot?.title ?? '版本尚未读取'}
                                    </span>
                                    <Badge variant="secondary">v{ref.version}</Badge>
                                    <span className="text-xs text-muted-foreground">{ref.skillId.slice(0, 8)}</span>
                                </div>
                                {latest && latest.version > ref.version && (
                                    <p className="text-xs text-muted-foreground">
                                        当前 v{ref.version}，可更新到 v{latest.version}
                                    </p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={!snapshot || busy || disabled}
                                        onClick={() => setView(snapshot ?? null)}
                                    >
                                        查看 v{ref.version} 全文
                                    </Button>
                                    {latest && latest.version > ref.version && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={busy || disabled}
                                            onClick={() => void select(latest)}
                                        >
                                            使用新版 v{latest.version}
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={busy || disabled}
                                        aria-label={`移除技能 ${snapshot?.title ?? ref.skillId.slice(0, 8)}`}
                                        onClick={() => {
                                            setActionError('')
                                            onChange(refs.filter(item => item.skillId !== ref.skillId))
                                        }}
                                    >
                                        移除
                                    </Button>
                                </div>
                            </li>
                        )
                    })}
                </ol>
            ) : (
                <p className="text-sm text-muted-foreground">未绑定技能。仅明确选择的技能会保存到 Agent。</p>
            )}
            {error && (
                <p id="agent-skills-error" className="text-sm text-error-foreground">
                    {error}
                </p>
            )}
            {busy && (
                <FeedbackMessage variant="loading" role="status">
                    正在读取所选技能版本…
                </FeedbackMessage>
            )}
            {actionError && (
                <FeedbackMessage variant="error" role="alert">
                    {actionError}
                </FeedbackMessage>
            )}
            <div className="grid min-w-0 gap-4 border-t pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-medium">从技能库选择</h4>
                    <Button type="button" variant="ghost" disabled={disabled || busy} onClick={() => setRevision(value => value + 1)}>
                        刷新技能库
                    </Button>
                </div>
                <SearchInput
                    aria-label="搜索可选技能"
                    placeholder="搜索标题或说明"
                    value={query}
                    disabled={disabled || busy}
                    onValueChange={setQuery}
                />
                {loadError ? (
                    <FeedbackMessage variant="error">{loadError} 已绑定版本保持不变。</FeedbackMessage>
                ) : library === null ? (
                    <FeedbackMessage variant="loading" role="status">
                        正在载入技能库…
                    </FeedbackMessage>
                ) : library.length === 0 ? (
                    <p className="text-sm text-muted-foreground">技能库为空，可在 Skills 页面创建。</p>
                ) : (
                    <ul className="grid max-h-80 min-w-0 gap-0 overflow-y-auto overscroll-contain">
                        {library
                            .filter(skill => `${skill.title} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()))
                            .map(skill => {
                                const chosen = refs.some(ref => ref.skillId === skill.id)
                                return (
                                    <li
                                        key={skill.id}
                                        className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0"
                                    >
                                        <div className="min-w-0">
                                            <p className="[overflow-wrap:anywhere]">
                                                {skill.title} · v{skill.version}
                                            </p>
                                            <p className="text-xs text-muted-foreground">{skill.id.slice(0, 8)}</p>
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            aria-label={`选择技能 ${skill.title} ${skill.id.slice(0, 8)}`}
                                            disabled={disabled || busy || chosen}
                                            onClick={() => void select(skill)}
                                        >
                                            {chosen ? '已选择' : '选择'}
                                        </Button>
                                    </li>
                                )
                            })}
                    </ul>
                )}
            </div>
            <SkillSnapshotDialog snapshot={view} onClose={() => setView(null)} />
        </section>
    )
}
