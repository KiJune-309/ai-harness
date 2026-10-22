'use client'

import {
    ArrowRight,
    ArrowUp,
    Bot,
    ChevronDown,
    ChevronRight,
    CircleHelp,
    Copy,
    Files,
    Folder,
    Inbox,
    Layers,
    BookOpen,
    MessageSquare,
    SlidersHorizontal,
    Square,
    SquarePen,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react'
import type {
    AgentDefinition,
    ChatConversation,
    ChatMessage,
    ChatStatus,
    ChatStreamEvent,
    HumanRequest,
    HumanResponse,
    PersonMention,
    ProjectFolder,
} from '@ai-harness/contracts'
import { getAgent, listAgents } from '../lib/agent-client'
import { useAccount } from './account-context'
import {
    cancelConversation,
    createConversation,
    getChatStatus,
    getConversation,
    listConversations,
    streamMessage,
} from '../lib/chat-client'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { UserMenu } from './user-menu'
import { WorkspaceNavigationContent, WorkspaceNavigationLabel } from './workspace-navigation'
import { WorkspaceSelector } from './team-workspaces'
import { FeedbackMessage, FeedbackToast } from './ui/feedback-message'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { MessageComposer, trimPersonMentions } from './message-composer'
import { ProjectFolders } from './project-folders'
import { ProjectFiles } from './project-files'
import { HumanRequestPanel } from './human-request-panel'
import { ConversationHistoryItem } from './conversation-history-item'
import { CollaborationSourcePanel } from './collaboration-workspace'
import {
    Sidebar,
    SidebarProvider,
    SidebarHeader,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarSeparator,
    SidebarInset,
    SidebarTrigger,
    useSidebar,
} from './ui/sidebar'

type Conversation = ChatConversation & { unread?: boolean }
type Generation = { conversationId: string | null; requestId: string; stopping?: boolean }
type RetryTurn = {
    conversationId: string | null
    content: string
    requestId: string
    mentions?: PersonMention[]
    projectFolderId?: string
    agentId?: string
    humanResponse?: HumanResponse
}
type ModalKind = 'workspace' | 'files' | 'plugins' | 'settings' | 'help' | 'starters' | 'more' | 'history'

const activeConversationKey = 'ai-harness.active-conversation'

const starters = [
    {
        title: '产品想法，该先验证什么？',
        detail: '产品与设计',
        prompt: '我有一个新产品想法，帮我梳理问题、目标用户和第一步。',
    },
    {
        title: '访谈里有什么新发现？',
        detail: '研究与资料',
        prompt: '请帮我整理用户访谈里的关键发现，区分已知事实和待验证的问题。',
    },
    { title: '下周先做哪三件事？', detail: '日常工作', prompt: '帮我梳理下周最重要的三件事，并按优先级安排。' },
]

/**
 * Renders the existing workspace brand mark.
 * @param props - Optional CSS class for the mark.
 * @returns An accessible decorative SVG.
 */
function OrbitMark({ className = '' }: { className?: string }) {
    return (
        <svg className={className} width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <ellipse cx="24" cy="24" rx="10" ry="20" transform="rotate(43 24 24)" stroke="currentColor" strokeWidth="1.6" />
            <ellipse cx="24" cy="24" rx="10" ry="20" transform="rotate(-43 24 24)" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="24" cy="24" r="4.2" fill="currentColor" />
        </svg>
    )
}

/**
 * Extracts a useful message from a network or service failure.
 * @param error - Unknown failure thrown by a chat request.
 * @returns Text suitable for display beside the composer.
 */
function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : '聊天服务暂时无法连接，请重试。'
}

/**
 * Orders saved conversations by their latest update with a stable tie-breaker.
 * @param left - First saved conversation to compare.
 * @param right - Second saved conversation to compare.
 * @returns A sort comparison placing the most recently updated conversation first.
 */
function compareConversationUpdates(left: Conversation, right: Conversation) {
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id)
}

/**
 * Stores the selected conversation without making browser storage required.
 * @param id - Selected conversation identifier, or null for a new conversation.
 * @returns Nothing; updates browser storage when it is available.
 */
function rememberConversation(id: string | null) {
    try {
        if (id) localStorage.setItem(activeConversationKey, id)
        else localStorage.removeItem(activeConversationKey)
    } catch {
        // Conversation history remains available through the API when storage is blocked.
    }
}

/**
 * Subscribes to browser visibility changes for unread-message state.
 * @param onChange - Callback invoked when document visibility changes.
 * @returns A cleanup function removing the event listener.
 */
function subscribeDocumentVisibility(onChange: () => void) {
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
}

/**
 * Reads whether the browser currently displays this document.
 * @returns True when the document is visible.
 */
function getDocumentVisibility() {
    return document.visibilityState === 'visible'
}

/**
 * Supplies a stable visibility snapshot during server rendering.
 * @returns False because browser visibility is unavailable on the server.
 */
function getServerDocumentVisibility() {
    return false
}

/**
 * Renders the workspace shell and its persisted DeepSeek chat experience.
 * @param props - Route content displayed beside the shared conversation interface.
 * @returns The responsive workspace, dialogs, and live chat controls.
 */
function WorkspaceContent({ children }: { children: ReactNode }) {
    const { modelLabel, user } = useAccount()
    const pathname = usePathname()
    const router = useRouter()
    const { isMobile, setOpenMobile } = useSidebar()
    const searchParams = useSearchParams()
    const requestedAgentId = searchParams.get('agent')
    const requestedConversationId = searchParams.get('conversation')
    const requestedEventId = searchParams.get('event') ?? undefined
    const isHome = pathname === '/'
    const isTasks = pathname === '/inbox' || pathname.startsWith('/inbox/')
    const isTemplates = pathname === '/templates' || pathname.startsWith('/templates/')
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeId, setActiveId] = useState<string | null>(null)
    const [startingConversation, startConversationTransition] = useTransition()
    const [draft, setDraft] = useState('')
    const [draftMentions, setDraftMentions] = useState<PersonMention[]>([])
    const [answerTarget, setAnswerTarget] = useState<(HumanResponse & { conversationId: string }) | null>(null)
    const [conversationRoute, setConversationRoute] = useState<{ id: string | null; ready: boolean }>({
        id: requestedConversationId,
        ready: !requestedConversationId,
    })
    const [historyExpanded, setHistoryExpanded] = useState(true)
    const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>([])
    const [selectedProjectFolderId, setSelectedProjectFolderId] = useState<string | undefined>()
    const [projectFilesOpen, setProjectFilesOpen] = useState(false)
    const [recentIds, setRecentIds] = useState<string[]>([])
    const [loadingHistory, setLoadingHistory] = useState(true)
    const [reloadVersion, setReloadVersion] = useState(0)
    const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null)
    const [chatError, setChatError] = useState('')
    const [historySyncError, setHistorySyncError] = useState('')
    const [retryTurn, setRetryTurn] = useState<RetryTurn | null>(null)
    const [generation, setGeneration] = useState<Generation | null>(null)
    const [agents, setAgents] = useState<AgentDefinition[]>([])
    const [selectedAgentId, setSelectedAgentId] = useState('')
    const agentRouteKey = `${pathname}?agent=${requestedAgentId ?? ''}`
    const [agentRoute, setAgentRoute] = useState<{ key: string; resolvedId: string | null }>({
        key: agentRouteKey,
        resolvedId: null,
    })
    const [modalKind, setModalKind] = useState<ModalKind>('workspace')
    const [notice, setNotice] = useState('')
    const [modalOpen, setModalOpen] = useState(false)
    const generationController = useRef<AbortController | null>(null)
    const cancellation = useRef<{ requestId: string; promise: Promise<ChatConversation> } | null>(null)
    const visibleConversation = useRef({ isHome, activeId })
    const selectionRequest = useRef(0)
    const deletedConversationIds = useRef(new Set<string>())
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const mobileProjectFilesRef = useRef<HTMLButtonElement>(null)
    const desktopProjectFilesRef = useRef<HTMLButtonElement>(null)
    const endRef = useRef<HTMLDivElement>(null)
    const messageAnchors = useRef(new Map<string, HTMLDivElement>())
    const documentVisible = useSyncExternalStore(subscribeDocumentVisibility, getDocumentVisibility, getServerDocumentVisibility)
    const activeConversation = conversations.find(item => item.id === activeId)
    const pendingQuestion = activeConversation?.humanRequests?.find(request => request.kind === 'question' && request.status === 'pending')
    const backgroundRequestId = activeConversation?.activeRequestId
    const executionBusy = Boolean(generation || backgroundRequestId)
    const answerTargetCurrent = Boolean(
        pendingQuestion &&
        answerTarget?.conversationId === activeId &&
        answerTarget.requestId === pendingQuestion.id &&
        answerTarget.version === pendingQuestion.version
    )
    const staleAnswer = Boolean((pendingQuestion || answerTarget) && !answerTargetCurrent && draft.trim())
    const projectFolderId = activeConversation?.projectFolderId ?? (activeId ? undefined : selectedProjectFolderId)
    const projectName = projectFolders.find(item => item.id === projectFolderId)?.name ?? '当前项目'
    const orderedConversations = [...conversations].sort(compareConversationUpdates)
    const selectedAgent = agents.find(item => item.id === selectedAgentId)
    const composerAgentName = agents.find(item => item.id === (activeConversation?.agentId ?? selectedAgentId))?.name ?? '通用助手'
    const resolvingAgent =
        isHome &&
        !requestedConversationId &&
        Boolean(requestedAgentId && (agentRoute.key !== agentRouteKey || agentRoute.resolvedId !== requestedAgentId))
    const resolvingConversation =
        isHome && Boolean(requestedConversationId && (conversationRoute.id !== requestedConversationId || !conversationRoute.ready))
    const model = modelLabel(activeConversation?.agent?.modelId ?? selectedAgent?.modelId ?? chatStatus?.model ?? 'DeepSeek')
    const shownConversation =
        resolvingAgent || resolvingConversation
            ? undefined
            : (activeConversation ??
              (selectedAgent
                  ? {
                        title: selectedAgent.name,
                        messages: selectedAgent.openingMessages.map((content, index): ChatMessage => ({
                            id: `opening-${selectedAgent.id}-${index}`,
                            role: 'assistant',
                            content,
                            status: 'complete',
                            kind: 'opening',
                            createdAt: selectedAgent.updatedAt,
                        })),
                    }
                  : undefined))
    const hasMessages = Boolean(shownConversation?.messages.length)
    const displayedMessages =
        shownConversation?.messages.filter(
            message =>
                !(
                    message.role === 'assistant' &&
                    message.status === 'complete' &&
                    !message.content &&
                    !message.reasoning &&
                    !(generation?.conversationId === activeId && generation.requestId === message.requestId) &&
                    (!backgroundRequestId || backgroundRequestId !== message.requestId)
                )
        ) ?? []

    /**
     * Finds the visible historical slot immediately after one exact message.
     * @param messageId - Stable saved message identity selected for a collaboration receipt.
     * @returns The current chat-owned anchor, or null when that message is not mounted.
     */
    const getMessageAnchor = useCallback((messageId: string): HTMLDivElement | null => {
        return messageAnchors.current.get(messageId) ?? null
    }, [])

    // Navigation invalidates the previous deep-link resolution before a message can be sent.
    if (agentRoute.key !== agentRouteKey) setAgentRoute({ key: agentRouteKey, resolvedId: null })
    if (conversationRoute.id !== requestedConversationId)
        setConversationRoute({ id: requestedConversationId, ready: !requestedConversationId })

    // 可见会话在渲染时标为已读，避免展示过期的未读提示。
    if (isHome && documentVisible && activeConversation?.unread) {
        setConversations(items => items.map(item => (item.id === activeId ? { ...item, unread: false } : item)))
    }

    /**
     * Merges a durable conversation while preserving accurate unread state.
     * @param conversation - Latest conversation returned by the server.
     * @returns Nothing; updates history and recent-conversation ordering.
     */
    function updateConversation(conversation: ChatConversation) {
        if (deletedConversationIds.current.has(conversation.id)) return
        const view = visibleConversation.current
        const unread = !(view.isHome && view.activeId === conversation.id && document.visibilityState === 'visible')
        setConversations(items => [{ ...conversation, unread }, ...items.filter(item => item.id !== conversation.id)])
        setRecentIds(ids => [conversation.id, ...ids.filter(id => id !== conversation.id)])
    }

    /**
     * Appends streamed model text to the pending assistant message.
     * @param conversationId - Conversation receiving the model output.
     * @param assistantId - Optimistic assistant message identifier.
     * @param event - Parsed event from the server stream.
     * @returns Nothing; updates text, reasoning, or settled conversation history.
     */
    function updateGeneratedReply(conversationId: string, assistantId: string, event: ChatStreamEvent) {
        if (event.type === 'done' || event.type === 'cancelled') {
            updateConversation(event.conversation)
            return
        }
        if (event.type !== 'delta' && event.type !== 'reasoning') return
        const view = visibleConversation.current
        const unread = !(view.isHome && view.activeId === conversationId && document.visibilityState === 'visible')
        setConversations(items =>
            items.map(item =>
                item.id === conversationId
                    ? {
                          ...item,
                          unread,
                          messages: item.messages.map(message =>
                              message.id !== assistantId
                                  ? message
                                  : event.type === 'delta'
                                    ? { ...message, content: message.content + event.text }
                                    : { ...message, reasoning: (message.reasoning ?? '') + event.text }
                          ),
                      }
                    : item
            )
        )
    }

    useEffect(() => {
        visibleConversation.current = { isHome, activeId }
    }, [isHome, activeId])

    useEffect(() => {
        const controller = new AbortController()
        // All routes share saved chat history; only the chat page needs model and Agent metadata.
        const metadata = isHome ? Promise.all([getChatStatus(controller.signal), listAgents(controller.signal)]) : Promise.resolve(null)
        Promise.all([listConversations(controller.signal), metadata])
            .then(([history, details]) => {
                if (controller.signal.aborted) return
                const items = history.filter(item => !deletedConversationIds.current.has(item.id))
                if (details) setChatStatus(details[0])
                setConversations(current => {
                    if (generationController.current) return current
                    const selected = requestedConversationId ? current.find(item => item.id === requestedConversationId) : undefined
                    return selected ? [selected, ...items.filter(item => item.id !== selected.id)] : items
                })
                if (details) setAgents(details[1])
                setRecentIds(items.map(item => item.id))
                setChatError('')
                try {
                    const rememberedId = localStorage.getItem(activeConversationKey)
                    if (!requestedConversationId)
                        setActiveId(current => current ?? (items.some(item => item.id === rememberedId) ? rememberedId : null))
                    if (!requestedConversationId)
                        setSelectedAgentId(current => current || items.find(item => item.id === rememberedId)?.agentId || '')
                } catch {
                    // The user can still select a conversation from server history.
                }
            })
            .catch(error => {
                if (!controller.signal.aborted) setChatError(errorMessage(error))
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoadingHistory(false)
            })
        return () => controller.abort()
    }, [reloadVersion, requestedConversationId, user?.id, isHome])

    useEffect(() => {
        const controller = new AbortController()
        let timer: number | undefined
        let reading = false
        /**
         * Refreshes ordinary chat history so received messages appear in the same conversation list.
         * @returns A promise settled after one serialized saved-history read.
         */
        async function refresh() {
            if (document.visibilityState !== 'visible' || reading || controller.signal.aborted) return
            reading = true
            try {
                const history = await listConversations(controller.signal)
                if (controller.signal.aborted) return
                const items = history.filter(item => !deletedConversationIds.current.has(item.id))
                setHistorySyncError('')
                setConversations(current => {
                    const previous = new Map(current.map(item => [item.id, item]))
                    const runningId = generationController.current ? generation?.conversationId : undefined
                    return items.map(item => {
                        const saved = previous.get(item.id)
                        if (saved && item.id === runningId) return saved
                        const changed = !saved || saved.updatedAt !== item.updatedAt
                        const visible = visibleConversation.current
                        const unread =
                            saved?.unread ||
                            (changed &&
                                item.messages.at(-1)?.role === 'assistant' &&
                                !(visible.isHome && visible.activeId === item.id && document.visibilityState === 'visible'))
                        return { ...item, unread }
                    })
                })
                setRecentIds(items.map(item => item.id))
            } catch {
                if (!controller.signal.aborted) setHistorySyncError('未能刷新对话，以下是上次成功读取的处理状态。')
            } finally {
                reading = false
                if (!controller.signal.aborted) timer = window.setTimeout(() => void refresh(), 3000)
            }
        }
        /**
         * Resumes saved-history polling when the user returns to the browser tab.
         * @returns Nothing; starts one fresh read after clearing the suspended timer.
         */
        function resume() {
            if (document.visibilityState !== 'visible') return
            if (timer !== undefined) window.clearTimeout(timer)
            void refresh()
        }
        timer = window.setTimeout(() => void refresh(), 3000)
        document.addEventListener('visibilitychange', resume)
        return () => {
            controller.abort()
            if (timer !== undefined) window.clearTimeout(timer)
            document.removeEventListener('visibilitychange', resume)
        }
    }, [user?.id, generation?.conversationId])

    useEffect(() => {
        if (!isHome || !requestedConversationId) return
        const controller = new AbortController()
        const selection = ++selectionRequest.current
        getConversation(requestedConversationId, controller.signal)
            .then(conversation => {
                if (
                    controller.signal.aborted ||
                    selectionRequest.current !== selection ||
                    conversation.id !== requestedConversationId ||
                    deletedConversationIds.current.has(conversation.id)
                )
                    return
                setConversations(items => [{ ...conversation, unread: false }, ...items.filter(item => item.id !== conversation.id)])
                setActiveId(conversation.id)
                setDraftMentions([])
                setSelectedAgentId(conversation.agentId ?? '')
                setConversationRoute({ id: requestedConversationId, ready: true })
                setChatError('')
            })
            .catch(error => {
                if (!controller.signal.aborted && selectionRequest.current === selection) {
                    setActiveId(null)
                    setChatError(errorMessage(error))
                }
            })
        return () => controller.abort()
    }, [isHome, requestedConversationId, reloadVersion])

    useEffect(() => {
        if (!isHome || requestedConversationId || !requestedAgentId || loadingHistory || agentRoute.resolvedId === requestedAgentId) return
        const controller = new AbortController()
        const selection = ++selectionRequest.current
        getAgent(requestedAgentId, controller.signal)
            .then(profile => {
                if (controller.signal.aborted || selectionRequest.current !== selection) return
                setAgents(items => [profile, ...items.filter(item => item.id !== profile.id)])
                setSelectedAgentId(profile.id)
                setSelectedProjectFolderId(undefined)
                setActiveId(null)
                rememberConversation(null)
                setDraft('')
                setChatError('')
                setRetryTurn(null)
                setAgentRoute({ key: agentRouteKey, resolvedId: requestedAgentId })
            })
            .catch(error => {
                if (!controller.signal.aborted && selectionRequest.current === selection) setChatError(errorMessage(error))
            })
        return () => controller.abort()
    }, [isHome, requestedAgentId, requestedConversationId, loadingHistory, agentRoute.resolvedId, agentRouteKey])

    useEffect(() => () => generationController.current?.abort(), [])

    useEffect(() => {
        if (isHome && hasMessages) endRef.current?.scrollIntoView({ block: 'end' })
    }, [activeConversation?.messages, isHome, hasMessages])

    useEffect(() => {
        if (!notice) return
        const timer = window.setTimeout(() => setNotice(''), 3500)
        return () => window.clearTimeout(timer)
    }, [notice])

    /**
     * Opens the requested workspace dialog and closes mobile navigation.
     * @param kind - Dialog content to display.
     * @returns Nothing; updates the controlled dialog after closing mobile navigation.
     */
    function openModal(kind: ModalKind) {
        setOpenMobile(false)
        setModalKind(kind)
        window.setTimeout(() => setModalOpen(true), 0)
    }

    /**
     * Starts an empty composer while retaining any background generation.
     * @param folderId - Personal project for a fresh draft, or undefined for an ungrouped conversation.
     * @returns Nothing; resets selection and navigates to the workspace.
     */
    function newConversation(folderId?: string) {
        selectionRequest.current += 1
        setSelectedProjectFolderId(folderId)
        setProjectFilesOpen(false)
        setActiveId(null)
        rememberConversation(null)
        setDraft('')
        setDraftMentions([])
        setAnswerTarget(null)
        setChatError('')
        setRetryTurn(null)
        setOpenMobile(false)
        router.push('/')
        window.setTimeout(() => inputRef.current?.focus(), 0)
    }

    /**
     * Opens a blank general conversation from navigation without creating a saved record.
     * @returns Nothing; clears the current draft and Agent selection while retaining saved history and background generation.
     */
    function startNewConversation() {
        setSelectedAgentId('')
        startConversationTransition(() => newConversation())
    }

    /**
     * Removes a durably deleted chat and prevents late stream or polling responses from restoring it.
     * @param id - Exact conversation confirmed deleted by the server.
     * @returns Nothing; clears only the deleted chat's selection and execution state.
     */
    function removeConversationFromHistory(id: string) {
        deletedConversationIds.current.add(id)
        setConversations(items => items.filter(item => item.id !== id))
        setRecentIds(ids => ids.filter(item => item !== id))
        if (generation?.conversationId === id) {
            generationController.current?.abort()
            generationController.current = null
            cancellation.current = null
            setGeneration(null)
        }
        if (activeId === id) {
            if (isHome) newConversation()
            else {
                selectionRequest.current += 1
                setActiveId(null)
                rememberConversation(null)
                setDraft('')
                setDraftMentions([])
                setAnswerTarget(null)
                setRetryTurn(null)
                setProjectFilesOpen(false)
                setChatError('')
            }
        }
        setNotice('对话已删除')
    }

    /**
     * Choose a saved Agent for a fresh conversation without altering existing history.
     * @param id - Saved Agent UUID, or empty for the default assistant.
     * @returns Nothing; displays the selected Agent's configured opening messages.
     */
    function selectAgent(id: string) {
        setSelectedAgentId(id)
        newConversation(projectFolderId)
    }

    /**
     * Selects a saved project for the unsent conversation without changing its text or assistant.
     * @param id - Personal project identifier, or empty for a conversation outside any project.
     * @returns Nothing; updates only an idle draft's project and clears unrelated transient feedback.
     */
    function selectProjectFolder(id: string) {
        if (activeId || executionBusy || retryTurn || loadingHistory || resolvingAgent || resolvingConversation) return
        if (id && !projectFolders.some(folder => folder.id === id)) return
        const next = id || undefined
        if (next === projectFolderId) return
        selectionRequest.current += 1
        setSelectedProjectFolderId(next)
        setProjectFilesOpen(false)
        setChatError('')
    }

    /**
     * Selects a conversation and refreshes its durable server history.
     * @param id - Conversation identifier selected in navigation.
     * @returns A promise resolved after the conversation refresh.
     */
    async function selectConversation(id: string) {
        setProjectFilesOpen(false)
        setSelectedProjectFolderId(undefined)
        const selection = ++selectionRequest.current
        setRecentIds(ids => [id, ...ids.filter(item => item !== id)])
        setActiveId(id)
        rememberConversation(id)
        setDraft('')
        setDraftMentions([])
        setAnswerTarget(null)
        setChatError('')
        setRetryTurn(null)
        setOpenMobile(false)
        router.push('/')
        if (generation?.conversationId === id) return
        try {
            const conversation = await getConversation(id)
            if (selectionRequest.current === selection) {
                setConversations(items => items.map(item => (item.id === id ? { ...conversation, unread: false } : item)))
                setSelectedAgentId(conversation.agentId ?? '')
            }
        } catch (error) {
            if (selectionRequest.current === selection) setChatError(errorMessage(error))
        }
    }

    /**
     * Reloads model configuration and saved conversations after a service error.
     * @returns Nothing; starts another asynchronous workspace refresh.
     */
    function reloadHistory() {
        if (generationController.current) return
        setLoadingHistory(true)
        setChatError('')
        setReloadVersion(version => version + 1)
    }

    /**
     * Disconnects the active stream so the server cancels model generation.
     * @returns Nothing; the send operation refreshes saved partial output.
     */
    async function stopGeneration() {
        if (!generation && activeId && backgroundRequestId) {
            setGeneration({ conversationId: activeId, requestId: backgroundRequestId, stopping: true })
            try {
                updateConversation(await cancelConversation(activeId, backgroundRequestId))
            } catch (cause) {
                setChatError(errorMessage(cause))
            } finally {
                setGeneration(null)
            }
            return
        }
        setGeneration(current => (current ? { ...current, stopping: true } : null))
        if (generation?.conversationId) {
            const promise = cancelConversation(generation.conversationId, generation.requestId)
            // Observe early failures immediately; the send operation still awaits the original result.
            void promise.catch(() => undefined)
            cancellation.current = {
                requestId: generation.requestId,
                promise,
            }
        }
        generationController.current?.abort()
    }

    /**
     * Sends a message through the API and applies real DeepSeek stream events.
     * @param text - Composer content, or the failed prompt when retrying.
     * @param retry - Existing turn metadata used for an explicit retry.
     * @returns A promise resolved after completion, cancellation, or a shown error.
     */
    async function sendMessage(text = draft, retry?: RetryTurn) {
        const content = text.trim()
        if (!retry && retryTurn?.conversationId === activeId && retryTurn.content === content) retry = retryTurn
        if (!content || generationController.current || backgroundRequestId || loadingHistory || resolvingAgent || resolvingConversation)
            return
        if (!retry && (staleAnswer || (pendingQuestion && !answerTargetCurrent))) {
            setChatError('当前问题已经变化，草稿已保留。请先核对当前问题，再决定是否用这份草稿回答。')
            return
        }
        if (!chatStatus?.configured) {
            setChatError('尚无可用模型，请到账户设置添加模型连接后重新检查。')
            return
        }
        const selection = selectionRequest.current
        const controller = new AbortController()
        generationController.current = controller
        const requestId = retry?.requestId ?? crypto.randomUUID()
        const creationProjectId = retry ? retry.projectFolderId : projectFolderId
        const creationAgentId = retry ? retry.agentId : selectedAgentId || undefined
        const humanResponse =
            retry?.humanResponse ??
            (answerTargetCurrent && answerTarget ? { requestId: answerTarget.requestId, version: answerTarget.version } : undefined)
        const mentions = humanResponse ? [] : (retry?.mentions ?? trimPersonMentions(text, draftMentions))
        let conversationId = retry ? retry.conversationId : activeId
        const assistantId = `${requestId}:assistant`
        let failure = ''
        let completed = false
        setGeneration({ conversationId, requestId })
        setChatError('')
        setRetryTurn(null)
        setDraft('')
        try {
            if (!conversationId) {
                const conversation = await createConversation(content.slice(0, 40), controller.signal, creationAgentId, {
                    ...(creationProjectId ? { projectFolderId: creationProjectId } : {}),
                    requestId,
                })
                conversationId = conversation.id
                controller.signal.throwIfAborted()
                setConversations(items => [conversation, ...items.filter(item => item.id !== conversation.id)])
            }
            const id = conversationId
            const now = new Date().toISOString()
            const userMessage: ChatMessage = {
                id: `${requestId}:user`,
                requestId,
                role: 'user',
                content,
                status: 'complete',
                createdAt: now,
            }
            const blankReply: ChatMessage = {
                id: assistantId,
                requestId,
                role: 'assistant',
                content: '',
                status: 'complete',
                createdAt: now,
            }
            setConversations(items =>
                items.map(item =>
                    item.id === id
                        ? {
                              ...item,
                              messages: [
                                  ...item.messages.filter(
                                      message =>
                                          message.requestId !== requestId && message.id !== userMessage.id && message.id !== assistantId
                                  ),
                                  userMessage,
                                  blankReply,
                              ],
                              updatedAt: now,
                          }
                        : item
                )
            )
            if (selectionRequest.current === selection) {
                setActiveId(id)
                rememberConversation(id)
            }
            setRecentIds(ids => [id, ...ids.filter(item => item !== id)])
            setGeneration({ conversationId: id, requestId })
            /**
             * Applies the current server event to this conversation.
             * @param event - Parsed event from the model execution stream.
             * @returns Nothing; updates visible content or terminal state.
             */
            function receiveEvent(event: ChatStreamEvent) {
                if (event.type === 'error') failure = event.message
                if (event.type === 'done' || event.type === 'cancelled') completed = true
                updateGeneratedReply(id, assistantId, event)
            }
            if (humanResponse) await streamMessage(id, content, requestId, receiveEvent, controller.signal, mentions, humanResponse)
            else await streamMessage(id, content, requestId, receiveEvent, controller.signal, mentions)
            if (selectionRequest.current === selection) setDraftMentions([])
            if (failure) throw new Error(failure)
        } catch (error) {
            if (!controller.signal.aborted && selectionRequest.current === selection) {
                setChatError(errorMessage(error))
                setRetryTurn({
                    conversationId,
                    content,
                    requestId,
                    ...(creationProjectId ? { projectFolderId: creationProjectId } : {}),
                    ...(creationAgentId ? { agentId: creationAgentId } : {}),
                    ...(mentions.length ? { mentions } : {}),
                    ...(humanResponse ? { humanResponse } : {}),
                })
            }
            if (conversationId && !completed) {
                try {
                    const conversation =
                        cancellation.current?.requestId === requestId
                            ? await cancellation.current.promise
                            : await getConversation(conversationId)
                    updateConversation(conversation)
                    if (conversation.messages.some(message => message.role === 'user' && message.requestId === requestId)) {
                        setRetryTurn(null)
                        setChatError('')
                        if (!controller.signal.aborted) setNotice('这条输入已保存，已重新读取当前处理状态。')
                    }
                    if (
                        selectionRequest.current === selection &&
                        !conversation.messages.some(message => message.role === 'user' && message.requestId === requestId)
                    ) {
                        setDraft(current => current || content)
                        setDraftMentions(current => (current.length ? current : mentions))
                    }
                } catch {
                    if (humanResponse && selectionRequest.current === selection) {
                        setDraft(current => current || content)
                        setAnswerTarget({ conversationId, ...humanResponse })
                    }
                    if (controller.signal.aborted && selectionRequest.current === selection)
                        setChatError('生成已停止，但未能确认保存结果。请重新连接以载入对话。')
                    setConversations(items =>
                        items.map(item =>
                            item.id === conversationId
                                ? {
                                      ...item,
                                      messages: item.messages.map(message =>
                                          message.id === assistantId
                                              ? { ...message, status: controller.signal.aborted ? 'cancelled' : 'error' }
                                              : message
                                      ),
                                  }
                                : item
                        )
                    )
                }
            } else if (!conversationId && selectionRequest.current === selection) {
                setDraft(current => current || content)
                setDraftMentions(current => (current.length ? current : mentions))
            }
        } finally {
            if (generationController.current === controller) {
                generationController.current = null
                cancellation.current = null
                setGeneration(null)
            }
        }
    }

    /**
     * Regenerates the final failed or stopped turn without duplicating the prompt.
     * @returns A promise resolved after retrying the persisted user request.
     */
    async function retryLastTurn() {
        const userMessage = activeConversation?.messages.findLast(message => message.role === 'user')
        if (!activeConversation || !userMessage?.requestId) return
        await sendMessage(userMessage.content, {
            conversationId: activeConversation.id,
            content: userMessage.content,
            requestId: userMessage.requestId,
        })
    }

    /**
     * Copies an answer and reports the result without interrupting reading.
     * @param text - Answer content to place on the clipboard.
     * @returns A promise resolved after displaying copy feedback.
     */
    async function copyMessage(text: string) {
        try {
            await navigator.clipboard.writeText(text)
            setNotice('回答已复制')
        } catch {
            setNotice('复制未成功，请选中回答手动复制')
        }
    }

    /**
     * Refreshes saved private history after a source-bound collaboration event changes.
     * @returns Nothing; ignores late responses for a different current conversation.
     */
    function refreshCollaborationHistory() {
        if (!activeId) return
        const selectedId = activeId
        void getConversation(selectedId)
            .then(conversation => {
                if (
                    visibleConversation.current.activeId === selectedId &&
                    !generationController.current &&
                    !deletedConversationIds.current.has(conversation.id)
                )
                    setConversations(items => [conversation, ...items.filter(item => item.id !== selectedId)])
            })
            .catch(() => undefined)
    }

    /**
     * Preserves the existing composer draft while explicitly inserting a suggestion for this question.
     * @param request - Exact currently displayed question selected by the person.
     * @param text - Suggested answer to append without automatically submitting it.
     * @returns Nothing; updates the ordinary editor and retains the exact question binding.
     */
    function useAnswerSuggestion(request: HumanRequest, text: string) {
        if (!activeId || request.id !== pendingQuestion?.id || request.version !== pendingQuestion.version || executionBusy) return
        const next = draft ? `${draft}\n${text}` : text
        if (next.length > 32_000) {
            setChatError('消息最多 32,000 字，原草稿已保留。')
            return
        }
        setDraft(next)
        setAnswerTarget({ conversationId: activeId, requestId: request.id, version: request.version })
        setChatError('')
        inputRef.current?.focus()
    }

    /**
     * Binds a newly edited answer to the visible question without rebinding an existing draft after polling.
     * @param value - Updated contents of the one ordinary bottom composer.
     * @returns Nothing; retains the draft and its first explicit question association.
     */
    function changeComposerDraft(value: string) {
        if (!value.trim() || !draft.trim()) {
            setAnswerTarget(
                value.trim() && pendingQuestion && activeId
                    ? { conversationId: activeId, requestId: pendingQuestion.id, version: pendingQuestion.version }
                    : null
            )
        }
        setDraft(value)
    }

    /**
     * Applies a durable human decision without treating approval as successful tool execution.
     * @param conversation - Server-saved state after a decision or its reconciliation read.
     * @returns Nothing; refreshes private history and clears an explicitly cancelled question binding.
     */
    function updateHumanDecision(conversation: ChatConversation) {
        updateConversation(conversation)
        const answered = conversation.humanRequests?.find(request => request.id === answerTarget?.requestId)
        if (answered?.status === 'cancelled' && conversation.id === answerTarget?.conversationId) {
            setAnswerTarget(null)
            setRetryTurn(null)
            setChatError('')
        }
    }

    const humanPanel =
        activeConversation && !resolvingConversation ? (
            <HumanRequestPanel
                key={`human:${activeConversation.id}`}
                conversation={activeConversation}
                kind="approval"
                disabled={executionBusy}
                onSuggestion={useAnswerSuggestion}
                onSaved={updateHumanDecision}
            />
        ) : null
    const questionPanel =
        activeConversation && pendingQuestion && !resolvingConversation ? (
            <div className="mb-3 max-h-[min(40dvh,18rem)] overflow-y-auto overscroll-contain px-1 py-1">
                <HumanRequestPanel
                    key={`question:${activeConversation.id}`}
                    conversation={activeConversation}
                    kind="question"
                    disabled={executionBusy}
                    onSuggestion={useAnswerSuggestion}
                    onSaved={updateHumanDecision}
                />
            </div>
        ) : null
    const collaborationPanel =
        activeId && !resolvingConversation ? (
            <CollaborationSourcePanel
                key={`collaboration:${activeId}`}
                source={{ kind: activeConversation?.task ? 'task' : 'conversation', id: activeId }}
                eventId={requestedEventId}
                onHistoryChange={refreshCollaborationHistory}
                showDetails={false}
                messages={displayedMessages}
                getMessageAnchor={getMessageAnchor}
            />
        ) : null

    const navigation = [
        { href: '/agents', label: 'Agents', Icon: Bot, active: pathname === '/agents' || pathname.startsWith('/agents/') },
        { href: '/skills', label: 'Skills', Icon: BookOpen, active: pathname === '/skills' || pathname.startsWith('/skills/') },
        { href: '/rag', label: '资料库', Icon: Folder, active: pathname.startsWith('/rag') },
        { href: '/templates', label: '任务模板', Icon: Layers, active: isTemplates },
        { href: '/inbox', label: '任务', Icon: Inbox, active: isTasks },
    ]
    const modalTitles: Record<ModalKind, string> = {
        workspace: '你的工作空间',
        files: '对话资料',
        plugins: '插件与能力',
        settings: '工作区设置',
        help: '从这里开始',
        starters: '从一个问题开始',
        history: '全部对话',
        more: '更多',
    }

    return (
        <div className="workspace-shell">
            <a className="skip-link" href="#main-content">
                跳到工作区
            </a>
            <Sidebar aria-label="工作区侧栏">
                <SidebarHeader>
                    <div className="flex items-center justify-between gap-2 p-2">
                        <Link href="/" onClick={() => setOpenMobile(false)} className="text-2xl font-semibold tracking-tighter">
                            orbit<span className="text-ring">.</span>
                        </Link>
                        {isMobile && <SidebarTrigger aria-label="关闭导航" />}
                    </div>
                    <WorkspaceSelector onNavigate={() => setOpenMobile(false)} />
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton
                                        isActive={isHome && !activeId && !requestedConversationId && !projectFolderId}
                                        onClick={startNewConversation}
                                        disabled={startingConversation}
                                    >
                                        <WorkspaceNavigationLabel
                                            label="开始新对话"
                                            icon={SquarePen}
                                            pending={startingConversation}
                                            pendingLabel="正在打开新对话…"
                                        />
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                {navigation.map(({ href, label, Icon, active }) => (
                                    <SidebarMenuItem key={href}>
                                        <SidebarMenuButton
                                            render={<Link href={href} />}
                                            isActive={active}
                                            aria-current={active ? 'page' : undefined}
                                            onClick={() => setOpenMobile(false)}
                                        >
                                            <WorkspaceNavigationContent label={label} icon={Icon} />
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                    <SidebarSeparator />
                    <ProjectFolders
                        userId={user?.id}
                        folders={projectFolders}
                        onFoldersChange={setProjectFolders}
                        conversations={orderedConversations}
                        activeId={isHome ? activeId : null}
                        activeFolderId={projectFolderId}
                        onSelectConversation={id => void selectConversation(id)}
                        onDeleted={removeConversationFromHistory}
                        onNewConversation={folder => {
                            setSelectedAgentId('')
                            newConversation(folder.id)
                        }}
                    />
                    <SidebarGroup>
                        <Collapsible open={historyExpanded} onOpenChange={setHistoryExpanded}>
                            <CollapsibleTrigger render={<SidebarMenuButton />}>
                                <MessageSquare aria-hidden="true" />
                                <span>全部对话</span>
                                <ChevronDown className="ml-auto" aria-hidden="true" />
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <SidebarMenu className="mt-2">
                                    {loadingHistory && (
                                        <SidebarMenuItem>
                                            <p className="px-2 text-sm text-muted-foreground" role="status">
                                                正在载入对话…
                                            </p>
                                        </SidebarMenuItem>
                                    )}
                                    {!loadingHistory && !conversations.length && (
                                        <SidebarMenuItem>
                                            <p className="px-2 text-sm text-muted-foreground">所有对话会显示在这里</p>
                                        </SidebarMenuItem>
                                    )}
                                    {orderedConversations.map(item => (
                                        <ConversationHistoryItem
                                            key={item.id}
                                            conversation={item}
                                            isActive={activeId === item.id && isHome}
                                            onSelect={id => void selectConversation(id)}
                                            onDeleted={removeConversationFromHistory}
                                        />
                                    ))}
                                </SidebarMenu>
                            </CollapsibleContent>
                        </Collapsible>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarFooter>
                    <UserMenu
                        onOpenPanel={openModal}
                        onNavigate={() => setOpenMobile(false)}
                        onSignedOut={() => {
                            rememberConversation(null)
                            generationController.current?.abort()
                        }}
                    />
                </SidebarFooter>
            </Sidebar>
            <SidebarInset id="main-content" className="main-panel" tabIndex={-1}>
                <header className="workspace-header md:hidden">
                    <SidebarTrigger aria-label="打开导航" />
                    <Link href="/" className="font-semibold">
                        orbit<span className="text-ring">.</span>
                    </Link>
                    <Button variant="ghost" size="icon" className="ml-auto" aria-label="工作区设置" onClick={() => openModal('settings')}>
                        <SlidersHorizontal aria-hidden="true" />
                    </Button>
                    {isHome && projectFolderId && (
                        <Button
                            ref={mobileProjectFilesRef}
                            variant="ghost"
                            size="icon"
                            aria-label="打开项目资料"
                            onClick={() => setProjectFilesOpen(true)}
                        >
                            <Files aria-hidden="true" />
                        </Button>
                    )}
                </header>
                {isHome && projectFolderId && (
                    <div className="hidden h-14 shrink-0 items-center justify-between gap-3 px-6 md:flex">
                        <span className="min-w-0 truncate text-sm text-muted-foreground" title={projectName}>
                            {projectName}
                        </span>
                        <Button
                            ref={desktopProjectFilesRef}
                            variant="ghost"
                            size="icon"
                            aria-label="打开项目资料"
                            onClick={() => setProjectFilesOpen(true)}
                        >
                            <Files aria-hidden="true" />
                        </Button>
                    </div>
                )}
                {isHome ? (
                    <section className={`chat-home ${hasMessages ? 'with-messages' : ''}`} aria-label="Agent 对话">
                        {hasMessages ? (
                            <div className="message-scroll">
                                <div className="messages">
                                    {displayedMessages.map((message, index) => (
                                        <div key={message.id} className="min-w-0" data-chat-message-id={message.id}>
                                            {message.role === 'user' ? (
                                                <div className="user-message">{message.content}</div>
                                            ) : (
                                                <article
                                                    className="assistant-message"
                                                    data-consecutive={displayedMessages[index - 1]?.role === 'assistant' || undefined}
                                                    aria-label={message.kind === 'relay' ? '协作消息' : 'Agent 回复'}
                                                >
                                                    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                                                        <span className="font-medium text-foreground">
                                                            {message.kind === 'relay'
                                                                ? '协作消息'
                                                                : (activeConversation?.agent?.name ?? selectedAgent?.name ?? model)}
                                                        </span>
                                                        <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
                                                            {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                            })}
                                                        </time>
                                                        {generation?.conversationId === activeId &&
                                                            index === displayedMessages.length - 1 && (
                                                                <Badge variant="secondary">
                                                                    {generation.stopping
                                                                        ? '正在停止…'
                                                                        : message.content
                                                                          ? '正在回答…'
                                                                          : '正在思考…'}
                                                                </Badge>
                                                            )}
                                                    </div>
                                                    {message.reasoning && (
                                                        <Collapsible className="mb-4">
                                                            <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                                                                思考过程
                                                                <ChevronDown aria-hidden="true" />
                                                            </CollapsibleTrigger>
                                                            <CollapsibleContent className="whitespace-pre-wrap break-words py-3 text-sm text-muted-foreground">
                                                                {message.reasoning}
                                                            </CollapsibleContent>
                                                        </Collapsible>
                                                    )}
                                                    {message.content ? (
                                                        <div
                                                            className={`markdown-content${message.kind ? ' [&_p]:whitespace-pre-wrap' : ''}`}
                                                        >
                                                            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                                                        </div>
                                                    ) : generation?.conversationId === activeId &&
                                                      generation.requestId === message.requestId ? (
                                                        <p role="status" className="text-sm text-muted-foreground">
                                                            正在生成回答…
                                                        </p>
                                                    ) : backgroundRequestId && backgroundRequestId === message.requestId ? (
                                                        <p role="status" className="text-sm text-muted-foreground">
                                                            Agent 正在后台执行…
                                                        </p>
                                                    ) : message.status !== 'complete' ? (
                                                        <FeedbackMessage variant={message.status === 'error' ? 'error' : 'info'}>
                                                            {message.status === 'error'
                                                                ? '回答未完成，请重试。'
                                                                : '已停止生成，可以继续提问。'}
                                                        </FeedbackMessage>
                                                    ) : null}
                                                    {message.content && (!generation || generation.requestId !== message.requestId) && (
                                                        <div className="mt-3 flex items-center gap-2">
                                                            <Button variant="ghost" size="sm" onClick={() => copyMessage(message.content)}>
                                                                <Copy aria-hidden="true" />
                                                                复制回答
                                                            </Button>
                                                            {message.status === 'cancelled' && <Badge variant="info">已停止</Badge>}
                                                            {message.status === 'error' && <Badge variant="destructive">回答未完成</Badge>}
                                                        </div>
                                                    )}
                                                    {!generation &&
                                                        !retryTurn &&
                                                        message.status !== 'complete' &&
                                                        index === displayedMessages.length - 1 && (
                                                            <Button variant="outline" size="sm" onClick={retryLastTurn}>
                                                                重新生成
                                                            </Button>
                                                        )}
                                                </article>
                                            )}
                                            <div
                                                className="chat-message-receipt min-w-0"
                                                ref={element => {
                                                    if (element) messageAnchors.current.set(message.id, element)
                                                    else messageAnchors.current.delete(message.id)
                                                }}
                                            />
                                        </div>
                                    ))}
                                    {collaborationPanel}
                                    {humanPanel}
                                    <div ref={endRef} />
                                </div>
                            </div>
                        ) : (
                            <div className="chat-start-header">
                                <div className="home-task-heading">
                                    <h1 className="text-2xl font-semibold tracking-tight">新对话</h1>
                                    <Button variant="ghost" size="sm" onClick={() => openModal('starters')}>
                                        <CircleHelp aria-hidden="true" />
                                        示例问题
                                    </Button>
                                </div>
                                {collaborationPanel}
                                {humanPanel}
                            </div>
                        )}
                        <div className="compose-area">
                            {historySyncError && (activeConversation?.humanRequests?.length || backgroundRequestId) ? (
                                <FeedbackMessage variant="warning" className="mb-3">
                                    {historySyncError}
                                </FeedbackMessage>
                            ) : null}
                            {questionPanel}
                            {pendingQuestion?.kind === 'question' && staleAnswer && (
                                <div className="mb-3 min-w-0 space-y-2 text-sm [overflow-wrap:anywhere]" role="status">
                                    <>
                                        <p className="text-muted-foreground">问题已变化，原草稿尚未关联当前问题。请核对后再继续。</p>
                                        <Button
                                            variant="outline"
                                            disabled={executionBusy}
                                            onClick={() => {
                                                if (activeId)
                                                    setAnswerTarget({
                                                        conversationId: activeId,
                                                        requestId: pendingQuestion.id,
                                                        version: pendingQuestion.version,
                                                    })
                                                setRetryTurn(null)
                                                setChatError('')
                                                inputRef.current?.focus()
                                            }}
                                        >
                                            已核对，将草稿用于当前问题
                                        </Button>
                                    </>
                                </div>
                            )}
                            {staleAnswer && !pendingQuestion && (
                                <FeedbackMessage variant="warning" className="mb-3">
                                    <p>原问题已结束，草稿已保留。</p>
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setAnswerTarget(null)
                                            setRetryTurn(null)
                                            setChatError('')
                                        }}
                                    >
                                        将草稿用于新讨论
                                    </Button>
                                </FeedbackMessage>
                            )}
                            <Card className="composer-surface py-2">
                                <CardContent className="px-2">
                                    <form
                                        className="grid gap-3"
                                        onSubmit={event => {
                                            event.preventDefault()
                                            sendMessage()
                                        }}
                                    >
                                        <Label className="sr-only" htmlFor="task-input">
                                            {pendingQuestion ? '回答当前问题' : '描述你的任务'}
                                        </Label>
                                        <div className="px-3 pt-3">
                                            <MessageComposer
                                                id="task-input"
                                                describedBy={pendingQuestion ? `human-question-${pendingQuestion.id}` : undefined}
                                                inputRef={inputRef}
                                                value={draft}
                                                onChange={changeComposerDraft}
                                                mentions={draftMentions}
                                                onMentionsChange={setDraftMentions}
                                                onSend={() => void sendMessage()}
                                                placeholder={
                                                    pendingQuestion
                                                        ? '输入你的答案，或修改建议后发送…'
                                                        : hasMessages
                                                          ? '继续讨论…'
                                                          : '描述问题，或添加相关资料…'
                                                }
                                            />
                                        </div>
                                        <div className="flex min-w-0 items-center justify-between gap-2 pl-2">
                                            <div className="flex min-w-0 flex-1 items-center gap-1">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger
                                                        type="button"
                                                        aria-label="选择助手"
                                                        className="inline-flex h-11 min-w-0 max-w-48 cursor-pointer items-center gap-1 border-0 bg-transparent px-2 text-base text-foreground outline-none focus-visible:text-primary focus-visible:underline focus-visible:underline-offset-4 md:text-sm"
                                                    >
                                                        <span className="truncate">{composerAgentName}</span>
                                                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent
                                                        side="top"
                                                        align="start"
                                                        className="min-w-48 max-w-[calc(100vw-2rem)]"
                                                    >
                                                        <DropdownMenuRadioGroup
                                                            value={activeConversation?.agentId ?? selectedAgentId}
                                                            onValueChange={selectAgent}
                                                        >
                                                            <DropdownMenuRadioItem value="" className="min-h-11" closeOnClick>
                                                                通用助手
                                                            </DropdownMenuRadioItem>
                                                            {agents.map(profile => (
                                                                <DropdownMenuRadioItem
                                                                    value={profile.id}
                                                                    key={profile.id}
                                                                    className="min-h-11"
                                                                    closeOnClick
                                                                >
                                                                    <span className="min-w-0 break-words">{profile.name}</span>
                                                                </DropdownMenuRadioItem>
                                                            ))}
                                                        </DropdownMenuRadioGroup>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger
                                                        type="button"
                                                        aria-label="选择项目"
                                                        disabled={
                                                            Boolean(activeId) ||
                                                            executionBusy ||
                                                            Boolean(retryTurn) ||
                                                            loadingHistory ||
                                                            resolvingAgent ||
                                                            resolvingConversation
                                                        }
                                                        title={
                                                            activeId
                                                                ? '已有对话的项目归属已固定，新对话可选择项目'
                                                                : projectFolderId
                                                                  ? projectName
                                                                  : '选择项目'
                                                        }
                                                        className="inline-flex h-11 min-w-0 max-w-48 cursor-pointer items-center gap-1 border-0 bg-transparent px-2 text-base text-foreground outline-none focus-visible:text-primary focus-visible:underline focus-visible:underline-offset-4 disabled:cursor-default disabled:text-muted-foreground md:text-sm"
                                                    >
                                                        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                                        <span className="truncate">{projectFolderId ? projectName : '选择项目'}</span>
                                                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent
                                                        side="top"
                                                        align="start"
                                                        className="min-w-48 max-w-[calc(100vw-2rem)]"
                                                    >
                                                        <DropdownMenuRadioGroup
                                                            value={projectFolderId ?? ''}
                                                            onValueChange={selectProjectFolder}
                                                        >
                                                            <DropdownMenuRadioItem value="" className="min-h-11" closeOnClick>
                                                                不选择项目
                                                            </DropdownMenuRadioItem>
                                                            {projectFolders.map(folder => (
                                                                <DropdownMenuRadioItem
                                                                    value={folder.id}
                                                                    key={folder.id}
                                                                    className="min-h-11"
                                                                    closeOnClick
                                                                >
                                                                    <span className="min-w-0 break-words">{folder.name}</span>
                                                                </DropdownMenuRadioItem>
                                                            ))}
                                                        </DropdownMenuRadioGroup>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                            {executionBusy ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-lg"
                                                    className="rounded-full p-1.5 hover:bg-transparent"
                                                    aria-label="停止生成"
                                                    onClick={stopGeneration}
                                                    disabled={generation?.stopping}
                                                >
                                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground group-hover/button:bg-primary/90">
                                                        <Square aria-hidden="true" />
                                                    </span>
                                                </Button>
                                            ) : (
                                                <Button
                                                    type="submit"
                                                    variant="ghost"
                                                    size="icon-lg"
                                                    className="rounded-full p-1.5 hover:bg-transparent"
                                                    disabled={
                                                        !draft.trim() ||
                                                        loadingHistory ||
                                                        resolvingAgent ||
                                                        resolvingConversation ||
                                                        staleAnswer ||
                                                        !chatStatus?.configured
                                                    }
                                                    aria-label={pendingQuestion ? '发送答案' : '发送任务'}
                                                >
                                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground group-hover/button:bg-primary/90">
                                                        <ArrowUp aria-hidden="true" />
                                                    </span>
                                                </Button>
                                            )}
                                        </div>
                                    </form>
                                </CardContent>
                            </Card>
                            <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                                {loadingHistory
                                    ? '正在连接聊天服务…'
                                    : generation
                                      ? generation.stopping
                                          ? '正在保存已生成的回答…'
                                          : '正在生成回答'
                                      : backgroundRequestId
                                        ? 'Agent 正在后台执行，结果将自动更新'
                                        : pendingQuestion
                                          ? '回答后继续'
                                          : chatStatus?.configured
                                            ? `${model} · 对话自动保存`
                                            : '尚未配置模型'}
                            </p>
                            {chatStatus && !chatStatus.configured && !chatError && (
                                <FeedbackMessage variant="warning" className="mt-3">
                                    <p>请先到账户设置添加模型连接，再重新检查连接。</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <Button variant="outline" nativeButton={false} render={<Link href="/account#models" />}>
                                            配置我的模型
                                        </Button>
                                        <Button variant="outline" onClick={reloadHistory} disabled={loadingHistory}>
                                            重新检查
                                        </Button>
                                    </div>
                                </FeedbackMessage>
                            )}
                            {chatError && (
                                <FeedbackMessage variant="error" className="mt-3">
                                    <p>{chatError}</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {retryTurn && (
                                            <Button
                                                variant="outline"
                                                disabled={Boolean(generation)}
                                                onClick={() => sendMessage(retryTurn.content, retryTurn)}
                                            >
                                                重试这条消息
                                            </Button>
                                        )}
                                        <Button variant="outline" onClick={reloadHistory} disabled={loadingHistory || Boolean(generation)}>
                                            重新连接
                                        </Button>
                                    </div>
                                </FeedbackMessage>
                            )}
                            {generation && generation.conversationId !== activeId && (
                                <FeedbackMessage variant="info" className="mt-3">
                                    另一段对话正在生成回答。点击停止按钮后可发送新任务。
                                </FeedbackMessage>
                            )}
                        </div>
                        {!hasMessages && (
                            <section className="home-continuation" aria-labelledby="resume-heading">
                                <div className="mb-3 flex items-center justify-between gap-2">
                                    <h2 id="resume-heading" className="font-medium">
                                        最近对话
                                    </h2>
                                    <Button variant="ghost" size="sm" onClick={() => openModal('history')}>
                                        全部对话
                                        <ChevronRight aria-hidden="true" />
                                    </Button>
                                </div>
                                <div className="grid gap-2" aria-busy={loadingHistory}>
                                    {!conversations.length && (
                                        <p className="text-sm text-muted-foreground">
                                            {loadingHistory ? '正在载入历史对话…' : '还没有对话，发送一个问题开始吧。'}
                                        </p>
                                    )}
                                    {recentIds
                                        .map(id => conversations.find(item => item.id === id))
                                        .filter((item): item is Conversation => Boolean(item?.messages.length))
                                        .slice(0, 3)
                                        .map(item => (
                                            <Button
                                                variant="ghost"
                                                className="conversation-row"
                                                key={item.id}
                                                title={item.title}
                                                onClick={() => selectConversation(item.id)}
                                            >
                                                <span className="truncate">{item.title}</span>
                                                <span className="shrink-0 text-xs text-muted-foreground">
                                                    {item.agent?.name ?? '通用助手'}
                                                </span>
                                            </Button>
                                        ))}
                                </div>
                            </section>
                        )}
                    </section>
                ) : (
                    <div className="route-content">{children}</div>
                )}
            </SidebarInset>
            <nav className="mobile-nav" aria-label="应用导航">
                <Button
                    variant={isHome && !activeId && !requestedConversationId && !projectFolderId ? 'secondary' : 'ghost'}
                    onClick={startNewConversation}
                    disabled={startingConversation}
                    className="h-auto min-w-0 flex-1 flex-col gap-1 px-1 py-2 text-xs"
                >
                    <WorkspaceNavigationLabel
                        label="开始新对话"
                        icon={SquarePen}
                        pending={startingConversation}
                        pendingLabel="正在打开新对话…"
                    />
                </Button>
                {['/rag', '/agents', '/templates', '/inbox']
                    .map(href => navigation.find(item => item.href === href)!)
                    .map(({ href, label, Icon, active }) => (
                        <Button
                            key={href}
                            variant={active ? 'secondary' : 'ghost'}
                            nativeButton={false}
                            role="link"
                            render={<Link href={href} />}
                            aria-current={active ? 'page' : undefined}
                            className="h-auto min-w-0 flex-1 flex-col gap-1 px-1 py-2 text-xs"
                        >
                            <WorkspaceNavigationContent label={label} icon={Icon} />
                        </Button>
                    ))}
            </nav>
            {isHome && projectFolderId && (
                <ProjectFiles
                    key={projectFolderId}
                    projectFolderId={projectFolderId}
                    projectName={projectName}
                    open={projectFilesOpen}
                    onOpenChange={setProjectFilesOpen}
                    returnFocusRef={isMobile ? mobileProjectFilesRef : desktopProjectFilesRef}
                />
            )}
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-h-[85dvh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{modalTitles[modalKind]}</DialogTitle>
                        <DialogDescription>个人工作区</DialogDescription>
                    </DialogHeader>
                    {modalKind === 'starters' && (
                        <div className="grid gap-2">
                            {starters.map(({ title, detail, prompt }) => (
                                <Button
                                    variant="outline"
                                    className="h-auto justify-between whitespace-normal py-3 text-left"
                                    key={title}
                                    aria-label={`${title}：${detail}，填入输入框`}
                                    onClick={() => {
                                        setDraft(prompt)
                                        setModalOpen(false)
                                        window.setTimeout(() => inputRef.current?.focus(), 0)
                                    }}
                                >
                                    {title}
                                    <ArrowUp aria-hidden="true" />
                                </Button>
                            ))}
                        </div>
                    )}
                    {modalKind === 'history' && (
                        <div className="grid gap-2" aria-busy={loadingHistory}>
                            {!conversations.length && (
                                <p className="text-sm text-muted-foreground">
                                    {loadingHistory ? '正在载入历史对话…' : '还没有保存的对话。'}
                                </p>
                            )}
                            {orderedConversations.map(item => (
                                <Button
                                    variant="ghost"
                                    className="h-auto justify-between py-3"
                                    key={item.id}
                                    onClick={() => {
                                        setModalOpen(false)
                                        selectConversation(item.id)
                                    }}
                                    aria-label={`${item.title}，${item.agent?.name ?? '通用助手'}`}
                                >
                                    <span className="truncate">{item.title}</span>
                                    <ChevronRight aria-hidden="true" />
                                </Button>
                            ))}
                        </div>
                    )}
                    {modalKind === 'workspace' && (
                        <div className="grid gap-3">
                            <OrbitMark />
                            <p>个人工作区：项目、对话与资料，放在一起。</p>
                        </div>
                    )}
                    {modalKind === 'files' && (
                        <div className="grid gap-3">
                            <p>资料上下文尚未接入当前聊天。</p>
                            <p className="text-sm text-muted-foreground">
                                当前对话使用输入的文字与该对话的历史消息。你可以直接粘贴需要讨论的内容。
                            </p>
                            <Button nativeButton={false} render={<Link href="/rag" />} onClick={() => setModalOpen(false)}>
                                前往资料库
                                <ArrowRight aria-hidden="true" />
                            </Button>
                        </div>
                    )}
                    {modalKind === 'plugins' && (
                        <FeedbackMessage variant="info">
                            当前已接入模型对话。网页阅读与其他插件尚未接入，聊天使用文字与历史消息。
                        </FeedbackMessage>
                    )}
                    {modalKind === 'settings' && (
                        <div className="grid gap-3">
                            <Label htmlFor="workspace-agent">当前助手</Label>
                            <NativeSelect
                                id="workspace-agent"
                                value={activeConversation?.agentId ?? selectedAgentId}
                                onChange={event => selectAgent(event.target.value)}
                            >
                                <NativeSelectOption value="">通用助手</NativeSelectOption>
                                {agents.map(profile => (
                                    <NativeSelectOption value={profile.id} key={profile.id}>
                                        {profile.name}
                                    </NativeSelectOption>
                                ))}
                            </NativeSelect>
                            <p className="text-sm text-muted-foreground">当前模型：{model}。切换助手会开始一段新对话。</p>
                            <Button
                                variant="outline"
                                nativeButton={false}
                                render={<Link href="/agents" />}
                                onClick={() => setModalOpen(false)}
                            >
                                创建或编辑 Agent
                            </Button>
                        </div>
                    )}
                    {modalKind === 'help' && (
                        <div className="grid gap-3">
                            <ol className="list-decimal space-y-2 pl-5">
                                <li>描述目标，或选择一个示例问题。</li>
                                <li>发送任务，查看回答并继续讨论。</li>
                                <li>在资料库和任务页继续整理工作。</li>
                            </ol>
                            <p className="text-sm text-muted-foreground">Enter 发送 · Shift + Enter 换行。</p>
                            <p className="text-xs text-muted-foreground">
                                界面字体：
                                <a
                                    href="https://hyperos.mi.com/font/zh/"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-4"
                                >
                                    MiSans · 小米
                                </a>
                                {' · '}
                                <a
                                    href="/fonts/MiSans-license.pdf"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-4"
                                >
                                    字体许可
                                </a>
                            </p>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            {notice && (
                <FeedbackToast variant={notice === '回答已复制' ? 'success' : 'error'} onDismiss={() => setNotice('')}>
                    {notice}
                </FeedbackToast>
            )}
        </div>
    )
}

/**
 * Supplies the official responsive sidebar controls to the persisted chat workspace.
 * @param props - Authenticated route content.
 * @returns The shared shadcn sidebar and workspace.
 */
export function Workspace({ children }: { children: ReactNode }) {
    return (
        <SidebarProvider>
            <WorkspaceContent>{children}</WorkspaceContent>
        </SidebarProvider>
    )
}
