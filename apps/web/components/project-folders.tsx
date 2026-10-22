'use client'

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, Folder, LoaderCircle, Plus, SquarePen } from 'lucide-react'
import type { ChatConversation, ProjectFolder } from '@ai-harness/contracts'
import { createProjectFolder, listProjectFolders } from '../lib/project-folder-client'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { FeedbackMessage } from './ui/feedback-message'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { SidebarGroup, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'
import { ConversationHistoryItem } from './conversation-history-item'

const projectRowIconVisibility =
    '[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100'

/**
 * Presents personal folders directly above ordinary conversation history.
 * @param props - Current scope, saved folders, conversations and ordinary chat navigation actions.
 * @returns Folder creation and independent, accessible folder conversation lists.
 */
export function ProjectFolders({
    userId,
    folders,
    onFoldersChange,
    conversations,
    activeId,
    activeFolderId,
    onSelectConversation,
    onNewConversation,
    onDeleted,
}: {
    userId?: string
    folders: ProjectFolder[]
    onFoldersChange: Dispatch<SetStateAction<ProjectFolder[]>>
    conversations: ChatConversation[]
    activeId: string | null
    activeFolderId?: string
    onSelectConversation: (id: string) => void
    onNewConversation: (folder: ProjectFolder) => void
    onDeleted?: (id: string) => void
}) {
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [reload, setReload] = useState(0)
    const [expanded, setExpanded] = useState<Record<string, boolean>>({})
    const [creating, setCreating] = useState(false)
    const [name, setName] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState('')
    const creation = useRef<{ name: string; requestId: string } | null>(null)
    const pending = useRef(false)

    useEffect(() => {
        const controller = new AbortController()
        listProjectFolders(controller.signal)
            .then(items => {
                if (controller.signal.aborted) return
                onFoldersChange(items)
                setLoadError('')
            })
            .catch(cause => {
                if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : '项目暂时无法载入。')
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })
        return () => controller.abort()
    }, [reload, userId, onFoldersChange])

    /**
     * Saves one folder with an action identifier retained across failed requests.
     * @returns A promise settled after confirmed creation or visible failure.
     */
    async function save() {
        if (pending.current) return
        const trimmed = name.trim()
        if (!trimmed) {
            setSaveError('请填写项目名称。')
            return
        }
        if (!creation.current || creation.current.name !== trimmed) creation.current = { name: trimmed, requestId: crypto.randomUUID() }
        pending.current = true
        setSaving(true)
        setSaveError('')
        try {
            const folder = await createProjectFolder(creation.current)
            onFoldersChange(items => [folder, ...items.filter(item => item.id !== folder.id)])
            setExpanded(items => ({ ...items, [folder.id]: true }))
            setCreating(false)
            setName('')
            creation.current = null
        } catch (cause) {
            setSaveError(cause instanceof Error ? cause.message : '项目未保存，请重试。')
        } finally {
            pending.current = false
            setSaving(false)
        }
    }

    return (
        <SidebarGroup aria-label="个人项目">
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setCreating(true)}>
                        <Plus aria-hidden="true" />
                        <span>新建项目</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
                {loading && (
                    <li className="px-2 py-1 text-xs text-muted-foreground" role="status">
                        正在载入项目…
                    </li>
                )}
                {loadError && (
                    <li className="px-2 py-1 text-xs text-muted-foreground">
                        <p role="alert">{loadError}</p>
                        <Button
                            variant="link"
                            size="sm"
                            onClick={() => {
                                setLoading(true)
                                setReload(value => value + 1)
                            }}
                        >
                            重新载入项目
                        </Button>
                    </li>
                )}
                {folders.map(folder => {
                    const items = conversations.filter(item => item.projectFolderId === folder.id)
                    const open = expanded[folder.id] ?? activeFolderId === folder.id
                    return (
                        <SidebarMenuItem key={folder.id}>
                            <Collapsible open={open} onOpenChange={value => setExpanded(current => ({ ...current, [folder.id]: value }))}>
                                <div className="group/project-row relative">
                                    <CollapsibleTrigger render={<SidebarMenuButton className="pr-9" />}>
                                        <Folder aria-hidden="true" />
                                        <span className="truncate" title={folder.name}>
                                            {folder.name}
                                        </span>
                                        <ChevronDown
                                            className={`ml-auto size-3.5 shrink-0 transition-transform ${projectRowIconVisibility} ${open ? '' : '-rotate-90'}`}
                                            aria-hidden="true"
                                        />
                                    </CollapsibleTrigger>
                                    <SidebarMenuAction
                                        className={projectRowIconVisibility}
                                        aria-label={`在“${folder.name}”中新建对话`}
                                        title="新建对话"
                                        onClick={() => onNewConversation(folder)}
                                    >
                                        <SquarePen aria-hidden="true" />
                                    </SidebarMenuAction>
                                </div>
                                <CollapsibleContent>
                                    <SidebarMenu className="mt-1 border-l border-sidebar-border pl-3 ml-3 w-auto">
                                        {!items.length && <li className="px-2 py-1 text-xs text-muted-foreground">暂无对话</li>}
                                        {items.map(item =>
                                            onDeleted ? (
                                                <ConversationHistoryItem
                                                    key={item.id}
                                                    conversation={item}
                                                    isActive={activeId === item.id}
                                                    onSelect={onSelectConversation}
                                                    onDeleted={onDeleted}
                                                />
                                            ) : (
                                                <SidebarMenuItem key={item.id}>
                                                    <SidebarMenuButton
                                                        isActive={activeId === item.id}
                                                        onClick={() => onSelectConversation(item.id)}
                                                        title={item.title}
                                                    >
                                                        <span className="truncate">{item.title}</span>
                                                    </SidebarMenuButton>
                                                </SidebarMenuItem>
                                            )
                                        )}
                                    </SidebarMenu>
                                </CollapsibleContent>
                            </Collapsible>
                        </SidebarMenuItem>
                    )
                })}
            </SidebarMenu>
            <Dialog
                open={creating}
                onOpenChange={open => {
                    if (!pending.current) setCreating(open)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>新建项目</DialogTitle>
                        <DialogDescription>把同一主题的对话和资料放在一起，仅你可见。</DialogDescription>
                    </DialogHeader>
                    <form
                        onSubmit={event => {
                            event.preventDefault()
                            void save()
                        }}
                        className="grid gap-5"
                    >
                        <div className="grid gap-2">
                            <Label htmlFor="project-folder-name">项目名称</Label>
                            <Input
                                id="project-folder-name"
                                value={name}
                                onChange={event => setName(event.target.value)}
                                maxLength={120}
                                disabled={saving}
                                aria-invalid={Boolean(saveError && !name.trim())}
                            />
                        </div>
                        {saveError && <FeedbackMessage variant="error">{saveError}</FeedbackMessage>}
                        <DialogFooter>
                            <Button variant="outline" type="button" disabled={saving} onClick={() => setCreating(false)}>
                                取消
                            </Button>
                            <Button type="submit" disabled={saving}>
                                {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                                {saving ? '正在创建…' : '创建项目'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </SidebarGroup>
    )
}
