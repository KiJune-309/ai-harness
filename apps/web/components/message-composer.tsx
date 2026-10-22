'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { CollaborationPerson, PersonMention } from '@ai-harness/contracts'
import { searchCollaborationPeople } from '../lib/collaboration-client'
import { Button } from './ui/button'
import { FeedbackMessage } from './ui/feedback-message'
import { Textarea } from './ui/textarea'

const commands = [
    { name: '总结', command: '/summary', text: '请总结以下内容，提炼关键结论和下一步行动：\n' },
    { name: '制定计划', command: '/plan', text: '请为以下目标制定可执行的计划，列出步骤、依赖和验收标准：\n' },
    { name: '审查', command: '/review', text: '请审查以下内容，指出问题、风险和具体改进建议：\n' },
]

/**
 * Retains stable person identities only when their exact mention survives a text edit.
 * @param previous - Draft before the edit.
 * @param next - Draft after the edit.
 * @param mentions - Account bindings previously selected by the user.
 * @returns Rebased bindings, excluding any mention overwritten or changed by the edit.
 */
export function rebasePersonMentions(previous: string, next: string, mentions: PersonMention[]): PersonMention[] {
    let start = 0
    while (start < previous.length && start < next.length && previous[start] === next[start]) start++
    let suffix = 0
    while (
        suffix < previous.length - start &&
        suffix < next.length - start &&
        previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    )
        suffix++
    const oldEnd = previous.length - suffix
    const shift = next.length - previous.length
    return mentions.flatMap(mention => {
        const updated =
            mention.end <= start
                ? mention
                : mention.start >= oldEnd
                  ? { ...mention, start: mention.start + shift, end: mention.end + shift }
                  : null
        return updated && next.slice(updated.start, updated.end) === `@${updated.name}` ? [updated] : []
    })
}

/**
 * Adjusts person bindings for the existing message submission whitespace normalization.
 * @param value - Unsubmitted draft including leading or trailing whitespace.
 * @param mentions - Selected stable account bindings.
 * @returns Bindings relative to the trimmed message body.
 */
export function trimPersonMentions(value: string, mentions: PersonMention[]): PersonMention[] {
    const shift = value.length - value.trimStart().length
    const content = value.trim()
    return mentions.flatMap(mention => {
        const next = { ...mention, start: mention.start - shift, end: mention.end - shift }
        return next.start >= 0 && content.slice(next.start, next.end) === `@${next.name}` ? [next] : []
    })
}

/**
 * Excludes quoted material and Markdown code from executable mention completion.
 * @param text - Draft text before the current cursor.
 * @returns Whether the cursor is in ordinary user-authored prose.
 */
function acceptsPersonMention(text: string): boolean {
    let fence = ''
    for (const line of text.split('\n')) {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
        if (marker) {
            if (!fence) fence = marker
            else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''
        }
    }
    const line = text.split('\n').at(-1) ?? ''
    return !fence && !/^\s*>/.test(line) && !/^(?: {4}|\t)/.test(line) && (line.match(/`+/g)?.length ?? 0) % 2 === 0
}

/**
 * Provides a minimal message editor with command completion and bounded local context imports.
 * @param props - Controlled draft, editor identity, focus reference and send callback.
 * @returns An accessible editor that sends Markdown and imported text through the existing message flow.
 */
export function MessageComposer({
    id,
    value,
    onChange,
    onSend,
    inputRef,
    placeholder,
    describedBy,
    mentions = [],
    onMentionsChange,
}: {
    id: string
    value: string
    onChange: (value: string) => void
    onSend: () => void
    inputRef: RefObject<HTMLTextAreaElement | null>
    placeholder: string
    describedBy?: string
    mentions?: PersonMention[]
    onMentionsChange?: (mentions: PersonMention[]) => void
}) {
    const fileRef = useRef<HTMLInputElement>(null)
    const [menu, setMenu] = useState<'@' | '/' | null>(null)
    const [active, setActive] = useState(0)
    const [error, setError] = useState('')
    const [reading, setReading] = useState(false)
    const [cursor, setCursor] = useState(0)
    const [people, setPeople] = useState<CollaborationPerson[]>([])
    const [peopleError, setPeopleError] = useState('')
    const trigger = value.slice(0, cursor).match(/(?:^|\s)([@/])([^\s@/]*)$/)
    const query = trigger?.[2]?.toLowerCase() ?? ''
    const filtered = commands.filter(item => `${item.name} ${item.command}`.toLowerCase().includes(query))
    const items =
        menu === '/'
            ? filtered.map(item => ({
                  label: `${item.command} · ${item.name}`,
                  text: item.text,
                  person: undefined as CollaborationPerson | undefined,
              }))
            : [
                  ...people.map(person => ({ label: `同事 · ${person.name} · ${person.id.slice(0, 8)}`, text: `@${person.name}`, person })),
                  { label: '添加文本文件', text: 'file', person: undefined },
                  { label: '添加 SKILL.md 文本（仅当前消息）', text: 'skill', person: undefined },
              ]

    useEffect(() => {
        if (menu !== '@' || !query || !acceptsPersonMention(value.slice(0, cursor))) return
        const controller = new AbortController()
        const timer = window.setTimeout(() => {
            searchCollaborationPeople(query, controller.signal)
                .then(found => {
                    if (!controller.signal.aborted) setPeople(found)
                })
                .catch(() => {
                    if (!controller.signal.aborted) setPeopleError('同事目录暂不可用，可稍后重试。')
                })
        }, 180)
        return () => {
            window.clearTimeout(timer)
            controller.abort()
        }
    }, [menu, query, value, cursor])

    /**
     * Replaces the current selection or completion token and restores editor focus.
     * @param text - Markdown or expanded instruction to insert.
     * @param complete - Whether to replace the active completion token.
     * @param person - Explicitly selected real account, when inserting a person mention.
     * @returns Nothing; updates the controlled draft or a nearby validation message.
     */
    function insert(text: string, complete = false, person?: CollaborationPerson) {
        const editor = inputRef.current
        const end = editor?.selectionEnd ?? value.length
        const start = complete && trigger ? cursor - trigger[2]!.length - 1 : (editor?.selectionStart ?? value.length)
        const next = value.slice(0, start) + text + value.slice(end)
        if (next.length > 32_000) {
            setError('消息最多 32,000 字。')
            return
        }
        onChange(next)
        setPeople([])
        setPeopleError('')
        const bindings = rebasePersonMentions(value, next, mentions)
        if (person) bindings.push({ userId: person.id, name: person.name, start, end: start + text.length })
        onMentionsChange?.(bindings)
        setError('')
        setMenu(null)
        requestAnimationFrame(() => {
            editor?.focus()
            editor?.setSelectionRange(start + text.length, start + text.length)
        })
    }

    /**
     * Applies a completion or opens the native file picker.
     * @param index - Active candidate index.
     * @returns Nothing; changes the draft or opens file selection.
     */
    function choose(index: number) {
        const item = items[index]
        if (!item) return
        if (menu === '/' || item.person) insert(item.text, true, item.person)
        else {
            setMenu(null)
            fileRef.current?.click()
        }
    }

    /**
     * Reads a user-selected UTF-8 text file into the draft without executing its content.
     * @param file - Text or Markdown file selected by the user.
     * @returns A promise resolved after import or a visible error; no upload is performed.
     */
    async function importFile(file?: File) {
        if (!file) return
        setReading(true)
        setError('')
        try {
            if (!/\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|css|html|yaml|yml)$/i.test(file.name)) throw new Error('请选择文本文件。')
            if (file.size > 96_000) throw new Error('文件过大，最多 96 KB。')
            const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
            if (inputRef.current && inputRef.current.value !== value) throw new Error('草稿已更新，请重新添加文件。')
            if (text.includes('\0')) throw new Error('无法读取此文本文件。')
            const name = file.name.replace(/[\r\n`]/g, '')
            const fence = '`'.repeat(Array.from(text.matchAll(/`+/g)).reduce((length, match) => Math.max(length, match[0].length + 1), 3))
            insert(`\n\n文件：${name}\n${fence}text\n${text}\n${fence}\n`, Boolean(trigger))
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '读取失败，请重试。')
        } finally {
            setReading(false)
            if (fileRef.current) fileRef.current.value = ''
        }
    }

    return (
        <div className="relative min-w-0 space-y-2" aria-busy={reading}>
            <input
                ref={fileRef}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-label="选择文本文件或 SKILL.md 文本（仅当前消息）"
                accept=".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.css,.html,.yaml,.yml"
                disabled={reading}
                onChange={event => void importFile(event.target.files?.[0])}
            />
            <Textarea
                id={id}
                ref={inputRef}
                value={value}
                maxLength={32_000}
                rows={3}
                placeholder={placeholder}
                aria-describedby={describedBy}
                className="conversation-input max-h-72 resize-none rounded-none border-0 bg-transparent p-1 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                aria-controls={menu ? `${id}-suggestions` : undefined}
                aria-haspopup="true"
                onChange={event => {
                    const next = event.target.value
                    const position = event.target.selectionStart
                    onChange(next)
                    setPeople([])
                    setPeopleError('')
                    onMentionsChange?.(rebasePersonMentions(value, next, mentions))
                    setCursor(position)
                    setMenu(
                        acceptsPersonMention(next.slice(0, position))
                            ? ((next.slice(0, position).match(/(?:^|\s)([@/])[^\s@/]*$/)?.[1] as '@' | '/' | undefined) ?? null)
                            : null
                    )
                    setActive(0)
                }}
                onClick={() => {
                    setCursor(inputRef.current?.selectionStart ?? 0)
                    setMenu(null)
                }}
                onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return
                    if (menu && event.key === 'Escape') {
                        event.preventDefault()
                        setMenu(null)
                        return
                    }
                    if (menu && items.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
                        event.preventDefault()
                        if (event.key === 'ArrowDown') setActive((active + 1) % items.length)
                        else if (event.key === 'ArrowUp') setActive((active + items.length - 1) % items.length)
                        else choose(active)
                        return
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        if (!reading) onSend()
                    }
                }}
            />
            {menu && (
                <div
                    id={`${id}-suggestions`}
                    className="rounded-lg border bg-popover p-1 text-popover-foreground"
                    role="group"
                    aria-label={menu === '/' ? '快捷命令' : '添加上下文'}
                >
                    {items.length ? (
                        items.map((item, index) => (
                            <Button
                                key={item.label}
                                type="button"
                                variant={index === active ? 'secondary' : 'ghost'}
                                className="flex w-full justify-start"
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => choose(index)}
                            >
                                {item.label}
                            </Button>
                        ))
                    ) : (
                        <p className="p-2 text-sm text-muted-foreground">没有匹配的命令</p>
                    )}
                    {menu === '@' && peopleError && (
                        <FeedbackMessage variant="error" role="status" className="mt-2">
                            {peopleError}
                        </FeedbackMessage>
                    )}
                </div>
            )}
            {mentions.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    已选择同事：{mentions.map(mention => `${mention.name} · ${mention.userId.slice(0, 8)}`).join('、')}
                </p>
            )}
            {(error || reading) && (
                <FeedbackMessage variant={error ? 'error' : 'loading'} role={error ? 'alert' : 'status'}>
                    {error || '读取中…'}
                </FeedbackMessage>
            )}
        </div>
    )
}
