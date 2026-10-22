'use client'

import { useRef, useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import type { ChatConversation } from '@ai-harness/contracts'
import { deleteConversation } from '../lib/chat-client'
import { Badge } from './ui/badge'
import { FeedbackMessage } from './ui/feedback-message'
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'
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

/**
 * Shows an ordinary chat row with a hover, keyboard and touch-accessible deletion action.
 * @param props - Owned conversation, active state, navigation and confirmed-deletion callback.
 * @returns One sidebar item and its explicit deletion confirmation with durable failure feedback.
 */
export function ConversationHistoryItem({
    conversation,
    isActive,
    onSelect,
    onDeleted,
}: {
    conversation: ChatConversation & { unread?: boolean }
    isActive: boolean
    onSelect: (id: string) => void
    onDeleted: (id: string) => void
}) {
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const locked = useRef(false)

    /**
     * Deletes only the confirmed conversation and leaves its row intact on failure.
     * @returns After a durable receipt or visible retryable failure.
     */
    async function remove(): Promise<void> {
        if (locked.current) return
        locked.current = true
        setBusy(true)
        setError('')
        try {
            await deleteConversation(conversation.id)
            setOpen(false)
            onDeleted(conversation.id)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '对话未能删除，请稍后重试。')
        } finally {
            locked.current = false
            setBusy(false)
        }
    }

    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                isActive={isActive}
                onClick={() => onSelect(conversation.id)}
                title={conversation.title}
                aria-label={conversation.title + (conversation.unread ? '，未读消息' : '')}
            >
                <span className="truncate">{conversation.title}</span>
                {conversation.unread && <Badge variant="secondary">未读</Badge>}
            </SidebarMenuButton>
            {!conversation.task && (
                <SidebarMenuAction
                    className="[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 hover:text-destructive focus-visible:text-destructive"
                    title="删除对话"
                    aria-label={`删除对话“${conversation.title}”`}
                    onClick={() => {
                        setError('')
                        setOpen(true)
                    }}
                >
                    <Trash2 aria-hidden="true" />
                </SidebarMenuAction>
            )}
            <AlertDialog
                open={open}
                onOpenChange={next => {
                    if (!locked.current) setOpen(next)
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>删除这段对话？</AlertDialogTitle>
                        <AlertDialogDescription className="[overflow-wrap:anywhere]">
                            “{conversation.title}”及其中的聊天记录将被永久删除。已发送给同事的消息不会撤回。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void remove()}>
                            {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                            {busy ? '正在删除…' : '删除对话'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </SidebarMenuItem>
    )
}
