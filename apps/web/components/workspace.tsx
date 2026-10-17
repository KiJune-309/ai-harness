'use client'

import {
    ArrowRight,
    ArrowUp,
    Bot,
    Check,
    ChevronDown,
    ChevronRight,
    CircleHelp,
    Copy,
    Folder,
    Grid2X2,
    Home,
    Inbox,
    Layers,
    MoreHorizontal,
    MessageSquare,
    Menu,
    Paperclip,
    Plus,
    SlidersHorizontal,
    Square,
    SquarePen,
    X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { AgentDefinition, ChatConversation, ChatMessage, ChatStatus, ChatStreamEvent } from '@ai-harness/contracts'
import { getAgent, listAgents } from '../lib/agent-client'
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

type Conversation = ChatConversation & { unread?: boolean }
type Generation = { conversationId: string | null; requestId: string; stopping?: boolean }
type RetryTurn = { conversationId: string | null; content: string; requestId: string }
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
export function Workspace({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const router = useRouter()
    const requestedAgentId = useSearchParams().get('agent')
    const isHome = pathname === '/'
    const isTasks = pathname === '/inbox' || pathname.startsWith('/inbox/')
    const isProjects = pathname === '/projects' || pathname.startsWith('/projects/')
    const isTemplates = pathname === '/templates' || pathname.startsWith('/templates/')
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeId, setActiveId] = useState<string | null>(null)
    const [draft, setDraft] = useState('')
    const [historyExpanded, setHistoryExpanded] = useState(false)
    const [recentIds, setRecentIds] = useState<string[]>([])
    const [loadingHistory, setLoadingHistory] = useState(true)
    const [reloadVersion, setReloadVersion] = useState(0)
    const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null)
    const [chatError, setChatError] = useState('')
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
    const generationController = useRef<AbortController | null>(null)
    const cancellation = useRef<{ requestId: string; promise: Promise<ChatConversation> } | null>(null)
    const visibleConversation = useRef({ isHome, activeId })
    const selectionRequest = useRef(0)
    const modalRef = useRef<HTMLDialogElement>(null)
    const drawerRef = useRef<HTMLDialogElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const endRef = useRef<HTMLDivElement>(null)
    const documentVisible = useSyncExternalStore(subscribeDocumentVisibility, getDocumentVisibility, getServerDocumentVisibility)
    const activeConversation = conversations.find(item => item.id === activeId)
    const selectedAgent = agents.find(item => item.id === selectedAgentId)
    const resolvingAgent =
        isHome && Boolean(requestedAgentId && (agentRoute.key !== agentRouteKey || agentRoute.resolvedId !== requestedAgentId))
    const agent = resolvingAgent ? '正在载入 Agent…' : (activeConversation?.agent?.name ?? selectedAgent?.name ?? '通用助手')
    const model = activeConversation?.agent?.modelId ?? selectedAgent?.modelId ?? chatStatus?.model ?? 'DeepSeek'
    const shownConversation = resolvingAgent
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

    // Navigation invalidates the previous deep-link resolution before a message can be sent.
    if (agentRoute.key !== agentRouteKey) setAgentRoute({ key: agentRouteKey, resolvedId: null })

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
        if (!isHome) return
        const controller = new AbortController()
        // The first response establishes the browser identity before history is requested.
        getChatStatus(controller.signal)
            .then(async status => {
                const [items, savedAgents] = await Promise.all([listConversations(controller.signal), listAgents(controller.signal)])
                if (controller.signal.aborted) return
                setChatStatus(status)
                setConversations(current => (generationController.current ? current : items))
                setAgents(savedAgents)
                setRecentIds(items.map(item => item.id))
                setChatError('')
                try {
                    const rememberedId = localStorage.getItem(activeConversationKey)
                    setActiveId(current => current ?? (items.some(item => item.id === rememberedId) ? rememberedId : null))
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
    }, [reloadVersion, isHome])

    useEffect(() => {
        if (!isHome || !requestedAgentId || loadingHistory || agentRoute.resolvedId === requestedAgentId) return
        const controller = new AbortController()
        const selection = ++selectionRequest.current
        getAgent(requestedAgentId, controller.signal)
            .then(profile => {
                if (controller.signal.aborted || selectionRequest.current !== selection) return
                setAgents(items => [profile, ...items.filter(item => item.id !== profile.id)])
                setSelectedAgentId(profile.id)
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
    }, [isHome, requestedAgentId, loadingHistory, agentRoute.resolvedId, agentRouteKey])

    useEffect(() => () => generationController.current?.abort(), [])

    useEffect(() => {
        if (isHome && hasMessages) endRef.current?.scrollIntoView({ block: 'end' })
    }, [activeConversation?.messages, isHome, hasMessages])

    useEffect(() => {
        if (!notice) return
        const timer = window.setTimeout(() => setNotice(''), 3500)
        return () => window.clearTimeout(timer)
    }, [notice])

    useEffect(() => {
        if (modalRef.current?.open) modalRef.current.querySelector<HTMLButtonElement>('.dialog-close')?.focus()
    }, [modalKind])

    /**
     * Opens the requested workspace dialog and closes mobile navigation.
     * @param kind - Dialog content to display.
     * @returns Nothing; updates and opens the native dialog.
     */
    function openModal(kind: ModalKind) {
        drawerRef.current?.close()
        setModalKind(kind)
        modalRef.current?.showModal()
    }

    /**
     * Starts an empty composer while retaining any background generation.
     * @returns Nothing; resets selection and navigates to the workspace.
     */
    function newConversation() {
        selectionRequest.current += 1
        setActiveId(null)
        rememberConversation(null)
        setDraft('')
        setChatError('')
        setRetryTurn(null)
        drawerRef.current?.close()
        router.push('/')
        window.setTimeout(() => inputRef.current?.focus(), 0)
    }

    /**
     * Choose a saved Agent for a fresh conversation without altering existing history.
     * @param id - Saved Agent UUID, or empty for the default assistant.
     * @returns Nothing; displays the selected Agent's configured opening messages.
     */
    function selectAgent(id: string) {
        setSelectedAgentId(id)
        newConversation()
    }

    /**
     * Selects a conversation and refreshes its durable server history.
     * @param id - Conversation identifier selected in navigation.
     * @returns A promise resolved after the conversation refresh.
     */
    async function selectConversation(id: string) {
        const selection = ++selectionRequest.current
        setRecentIds(ids => [id, ...ids.filter(item => item !== id)])
        setActiveId(id)
        rememberConversation(id)
        setDraft('')
        setChatError('')
        setRetryTurn(null)
        drawerRef.current?.close()
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
    function stopGeneration() {
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
        if (!content || generationController.current || loadingHistory || resolvingAgent) return
        if (!chatStatus?.configured) {
            setChatError('DeepSeek 尚未配置，请在服务端设置 DEEPSEEK_API_KEY 后重新检查。')
            return
        }
        const controller = new AbortController()
        generationController.current = controller
        const requestId = retry?.requestId ?? crypto.randomUUID()
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
                const conversation = await createConversation(content.slice(0, 40), controller.signal, selectedAgentId || undefined)
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
            setActiveId(id)
            rememberConversation(id)
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
            await streamMessage(id, content, requestId, receiveEvent, controller.signal)
            if (failure) throw new Error(failure)
        } catch (error) {
            if (!controller.signal.aborted) {
                setChatError(errorMessage(error))
                setRetryTurn({ conversationId, content, requestId })
            }
            if (conversationId && !completed) {
                try {
                    const conversation =
                        cancellation.current?.requestId === requestId
                            ? await cancellation.current.promise
                            : await getConversation(conversationId)
                    updateConversation(conversation)
                    if (
                        controller.signal.aborted &&
                        !conversation.messages.some(message => message.role === 'user' && message.requestId === requestId)
                    ) {
                        setDraft(current => current || content)
                    }
                } catch {
                    if (controller.signal.aborted) setChatError('生成已停止，但未能确认保存结果。请重新连接以载入对话。')
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
            } else if (!conversationId) {
                setDraft(current => current || content)
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
     * Builds shared desktop and mobile workspace navigation.
     * @param mobile - Whether the navigation is inside the mobile drawer.
     * @returns Sidebar navigation and account controls.
     */
    function sidebarContent(mobile = false) {
        return (
            <>
                <div className="sidebar-brand">
                    <Link href="/" onClick={() => drawerRef.current?.close()} className="wordmark">
                        orbit<span className="wordmark-dot">.</span>
                    </Link>
                    {mobile ? (
                        <button className="icon-button" aria-label="关闭导航" onClick={() => drawerRef.current?.close()}>
                            <X size={18} />
                        </button>
                    ) : (
                        <button
                            className="icon-button new-conversation-button"
                            aria-label="新对话"
                            title="新对话"
                            onClick={newConversation}
                        >
                            <SquarePen size={19} />
                        </button>
                    )}
                </div>
                <nav className="sidebar-nav" aria-label="工作区导航">
                    {mobile ? (
                        <button className="sidebar-nav-link new-chat-link" onClick={newConversation}>
                            <SquarePen size={18} />
                            <span>新对话</span>
                        </button>
                    ) : (
                        <Link href="/" className={`sidebar-nav-link ${isHome ? 'active' : ''}`} aria-current={isHome ? 'page' : undefined}>
                            <Home size={18} />
                            <span>工作台</span>
                        </Link>
                    )}
                    <Link
                        href="/agents"
                        className={`sidebar-nav-link ${mobile ? 'drawer-page-link' : ''} ${pathname === '/agents' ? 'active' : ''}`}
                        aria-current={pathname === '/agents' ? 'page' : undefined}
                        onClick={() => drawerRef.current?.close()}
                    >
                        <Bot size={18} />
                        <span>Agents</span>
                    </Link>
                    <Link
                        href="/rag"
                        className={`sidebar-nav-link ${mobile ? 'drawer-page-link' : ''} ${pathname === '/rag' ? 'active' : ''}`}
                        aria-current={pathname === '/rag' ? 'page' : undefined}
                        onClick={() => drawerRef.current?.close()}
                    >
                        <Folder size={18} />
                        <span>资料库</span>
                    </Link>
                    <Link
                        href="/projects"
                        className={`sidebar-nav-link ${mobile ? 'drawer-page-link' : ''} ${isProjects ? 'active' : ''}`}
                        aria-current={isProjects ? 'page' : undefined}
                        onClick={() => drawerRef.current?.close()}
                    >
                        <Folder size={18} />
                        <span>项目</span>
                    </Link>
                    <Link
                        href="/templates"
                        className={`sidebar-nav-link ${mobile ? 'drawer-page-link' : ''} ${isTemplates ? 'active' : ''}`}
                        aria-current={isTemplates ? 'page' : undefined}
                        onClick={() => drawerRef.current?.close()}
                    >
                        <Layers size={18} />
                        <span>任务模板</span>
                    </Link>
                    <Link
                        href="/inbox"
                        className={`sidebar-nav-link ${mobile ? 'drawer-page-link' : ''} ${isTasks ? 'active' : ''}`}
                        aria-current={isTasks ? 'page' : undefined}
                        onClick={() => drawerRef.current?.close()}
                    >
                        <Inbox size={18} />
                        <span>任务</span>
                    </Link>
                </nav>
                <div className="sidebar-scroll">
                    {(mobile || hasMessages || !isHome) && (
                        <div className="sidebar-section recent-sidebar">
                            <button
                                className="project-toggle"
                                aria-expanded={historyExpanded}
                                onClick={() => setHistoryExpanded(value => !value)}
                            >
                                <MessageSquare size={15} aria-hidden="true" />
                                <span>全部对话</span>
                                <ChevronRight className={historyExpanded ? 'rotated' : ''} size={13} />
                            </button>
                            {historyExpanded &&
                                conversations.map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => selectConversation(item.id)}
                                        className={`conversation-link recent-link ${activeId === item.id && isHome ? 'selected' : ''}`}
                                        title={item.title}
                                        aria-label={item.title + (item.unread ? '，未读消息' : '')}
                                        aria-current={activeId === item.id && isHome ? 'page' : undefined}
                                    >
                                        <span className="conversation-title">{item.title}</span>
                                        {item.unread && <span className="conversation-unread" aria-hidden="true" />}
                                    </button>
                                ))}
                        </div>
                    )}
                </div>
                <div className="sidebar-bottom">
                    <button className="sidebar-utility sidebar-more" onClick={() => openModal('more')}>
                        <MoreHorizontal size={18} />
                        <span>更多</span>
                    </button>
                    <button className="profile-button" onClick={() => openModal('workspace')}>
                        <span className="avatar">K</span>
                        <span className="profile-text">
                            <strong>Kijune</strong>
                        </span>
                        <ChevronDown size={13} />
                    </button>
                </div>
            </>
        )
    }

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
            <aside className="sidebar" aria-label="工作区侧栏">
                {sidebarContent()}
            </aside>
            <main id="main-content" className={`main-panel ${isHome && !hasMessages ? 'home-overview' : ''}`} tabIndex={-1}>
                <header className={`workspace-header ${isHome ? 'home-header' : ''}`}>
                    <button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => drawerRef.current?.showModal()}>
                        <Menu size={18} />
                    </button>
                    {isHome && !hasMessages && <h1 className="workspace-page-title">工作台</h1>}
                    <button className="header-location" onClick={() => openModal('workspace')} aria-label="orbit. 个人工作区">
                        <span className="header-label-desktop">个人工作区</span>
                        <span className="header-label-mobile">
                            orbit<span className="wordmark-dot">.</span>
                        </span>
                        <ChevronDown size={12} />
                    </button>
                    {isHome && hasMessages && <h1 className="active-conversation-title">{shownConversation?.title}</h1>}
                    <div className="header-actions">
                        {isHome && hasMessages && (
                            <button className="icon-button" title="新对话" aria-label="开始新对话" onClick={newConversation}>
                                <Plus size={18} />
                            </button>
                        )}
                        <button
                            className="icon-button header-settings"
                            aria-label="工作区设置"
                            title="工作区设置"
                            onClick={() => openModal('settings')}
                        >
                            <SlidersHorizontal size={17} />
                        </button>
                    </div>
                </header>
                <section className={`chat-home ${hasMessages ? 'with-messages' : ''}`} hidden={!isHome} aria-label="Agent 对话">
                    {hasMessages ? (
                        <>
                            <div className="message-scroll">
                                <div className="messages">
                                    {shownConversation?.messages.map((message, index) =>
                                        message.role === 'user' ? (
                                            <div className="user-message" key={message.id}>
                                                {message.content}
                                            </div>
                                        ) : (
                                            <article className="assistant-message" key={message.id}>
                                                <div className="answer-content">
                                                    <div className="assistant-label">
                                                        {activeConversation?.agent?.name ?? selectedAgent?.name ?? model}
                                                        {generation?.conversationId === activeId &&
                                                            index === shownConversation.messages.length - 1 && (
                                                                <span>
                                                                    {generation.stopping
                                                                        ? '正在停止…'
                                                                        : message.content
                                                                          ? '正在回答…'
                                                                          : '正在思考…'}
                                                                </span>
                                                            )}
                                                    </div>
                                                    {message.reasoning && (
                                                        <details className="answer-reasoning">
                                                            <summary>思考过程</summary>
                                                            <div>{message.reasoning}</div>
                                                        </details>
                                                    )}
                                                    {message.content ? (
                                                        <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                                                    ) : generation?.conversationId === activeId &&
                                                      generation.requestId === message.requestId ? (
                                                        <div className="thinking-dots" aria-label="正在生成回答">
                                                            <i />
                                                            <i />
                                                            <i />
                                                        </div>
                                                    ) : (
                                                        <p className="muted">
                                                            {message.status === 'error'
                                                                ? '回答未完成，请重试。'
                                                                : '已停止生成，可以继续提问。'}
                                                        </p>
                                                    )}
                                                    {message.content && (!generation || generation.requestId !== message.requestId) && (
                                                        <div className="answer-actions">
                                                            <button onClick={() => copyMessage(message.content)} className="text-button">
                                                                <Copy size={14} />
                                                                复制回答
                                                            </button>
                                                            {message.status === 'cancelled' && <span className="muted">已停止</span>}
                                                            {message.status === 'error' && <span className="muted">回答未完成</span>}
                                                        </div>
                                                    )}
                                                    {!generation &&
                                                        !retryTurn &&
                                                        message.status !== 'complete' &&
                                                        index === shownConversation.messages.length - 1 && (
                                                            <button className="text-button" type="button" onClick={retryLastTurn}>
                                                                重新生成
                                                            </button>
                                                        )}
                                                </div>
                                            </article>
                                        )
                                    )}
                                    <div ref={endRef} />
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="home-task-heading">
                            <h2>新对话</h2>
                            <button className="starter-trigger" type="button" aria-label="示例问题" onClick={() => openModal('starters')}>
                                <CircleHelp size={15} aria-hidden="true" />
                                示例问题
                            </button>
                        </div>
                    )}
                    <div className="compose-area">
                        <div className="composer-wrap">
                            <form
                                className="composer"
                                onSubmit={event => {
                                    event.preventDefault()
                                    sendMessage()
                                }}
                            >
                                <label className="sr-only" htmlFor="task-input">
                                    描述你的任务
                                </label>
                                <textarea
                                    id="task-input"
                                    ref={inputRef}
                                    value={draft}
                                    maxLength={32_000}
                                    onChange={event => setDraft(event.target.value)}
                                    placeholder={hasMessages ? '继续讨论…' : '描述问题，或添加相关资料…'}
                                    title="Enter 发送，Shift+Enter 换行"
                                    rows={1}
                                    onKeyDown={event => {
                                        if (
                                            event.key === 'Enter' &&
                                            !event.shiftKey &&
                                            !event.nativeEvent.isComposing &&
                                            event.keyCode !== 229
                                        ) {
                                            event.preventDefault()
                                            sendMessage()
                                        }
                                    }}
                                />
                                <div className="composer-toolbar">
                                    <div className="compose-tools">
                                        <div className="compose-context">
                                            <button
                                                type="button"
                                                className="context-toggle"
                                                aria-label="查看资料功能状态"
                                                onClick={() => openModal('files')}
                                            >
                                                <Paperclip size={16} />
                                                <span>添加资料</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="composer-right">
                                        <label className="agent-select">
                                            <span aria-hidden="true">{agent}</span>
                                            <select
                                                aria-label="选择助手"
                                                value={activeConversation?.agentId ?? selectedAgentId}
                                                onChange={event => selectAgent(event.target.value)}
                                            >
                                                <option value="">通用助手</option>
                                                {agents.map(profile => (
                                                    <option value={profile.id} key={profile.id}>
                                                        {profile.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <ChevronDown size={12} />
                                        </label>
                                        {generation ? (
                                            <button
                                                type="button"
                                                className="send-button"
                                                aria-label="停止生成"
                                                onClick={stopGeneration}
                                                disabled={generation.stopping}
                                            >
                                                <Square size={14} fill="currentColor" />
                                            </button>
                                        ) : (
                                            <button
                                                className="send-button"
                                                type="submit"
                                                disabled={!draft.trim() || loadingHistory || resolvingAgent || !chatStatus?.configured}
                                                aria-label="发送任务"
                                            >
                                                <ArrowUp size={18} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </form>
                            <div className="chat-service-status" role="status" aria-live="polite">
                                {loadingHistory
                                    ? '正在连接聊天服务…'
                                    : generation
                                      ? generation.stopping
                                          ? '正在保存已生成的回答…'
                                          : 'DeepSeek 正在生成回答'
                                      : chatStatus?.configured
                                        ? `${model} · ${chatStatus.storage === 'memory' ? '临时对话，重启服务后清除' : '对话自动保存'}`
                                        : 'DeepSeek 尚未配置'}
                            </div>
                            {chatStatus && !chatStatus.configured && !chatError && (
                                <div className="chat-feedback" role="alert">
                                    <p>请在服务端设置 DEEPSEEK_API_KEY，再重新检查连接。</p>
                                    <button className="text-button" type="button" onClick={reloadHistory} disabled={loadingHistory}>
                                        重新检查
                                    </button>
                                </div>
                            )}
                            {chatError && (
                                <div className="chat-feedback" role="alert">
                                    <p>{chatError}</p>
                                    <div className="chat-feedback-actions">
                                        {retryTurn && (
                                            <button
                                                className="text-button"
                                                type="button"
                                                disabled={Boolean(generation)}
                                                onClick={() => sendMessage(retryTurn.content, retryTurn)}
                                            >
                                                重试这条消息
                                            </button>
                                        )}
                                        <button
                                            className="text-button"
                                            type="button"
                                            onClick={reloadHistory}
                                            disabled={loadingHistory || Boolean(generation)}
                                        >
                                            重新连接
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        {generation && generation.conversationId !== activeId && (
                            <p className="generation-note">另一段对话正在生成回答。点击停止按钮后可发送新任务。</p>
                        )}
                    </div>
                    {!hasMessages && (
                        <div className="home-continuation">
                            <section className="resume-work" aria-labelledby="resume-heading">
                                <div className="resume-heading">
                                    <h2 id="resume-heading" className="home-section-label">
                                        最近对话
                                    </h2>
                                    <button className="history-trigger" type="button" onClick={() => openModal('history')}>
                                        全部对话 <ChevronRight size={14} aria-hidden="true" />
                                    </button>
                                </div>
                                <div className="resume-list" aria-busy={loadingHistory}>
                                    {!conversations.length && (
                                        <p className="empty-message">
                                            {loadingHistory ? '正在载入历史对话…' : '还没有对话，发送一个问题开始吧。'}
                                        </p>
                                    )}
                                    {recentIds
                                        .map(id => conversations.find(item => item.id === id))
                                        .filter((item): item is Conversation => Boolean(item?.messages.length))
                                        .slice(0, 3)
                                        .map(item => (
                                            <button
                                                className="resume-row"
                                                key={item.id}
                                                title={item.title}
                                                onClick={() => selectConversation(item.id)}
                                            >
                                                <span className="resume-title">{item.title}</span>
                                                <ChevronRight className="resume-arrow" size={14} aria-hidden="true" />
                                                <span className="resume-meta">
                                                    <span className="resume-project">{item.agent?.name ?? '通用助手'}</span>
                                                    <time className="resume-date" dateTime={item.updatedAt}>
                                                        {item.updatedAt
                                                            ? new Intl.DateTimeFormat('zh-CN', {
                                                                  month: 'long',
                                                                  day: 'numeric',
                                                                  timeZone: 'Asia/Shanghai',
                                                              }).format(new Date(item.updatedAt))
                                                            : ''}
                                                    </time>
                                                </span>
                                            </button>
                                        ))}
                                </div>
                            </section>
                        </div>
                    )}
                </section>
                {!isHome && <div className="route-content">{children}</div>}
            </main>
            <nav className="mobile-nav" aria-label="应用导航">
                <Link href="/" aria-current={isHome ? 'page' : undefined} className={isHome ? 'active' : ''}>
                    <Home size={22} />
                    <span>工作台</span>
                </Link>
                <Link href="/rag" aria-current={pathname === '/rag' ? 'page' : undefined} className={pathname === '/rag' ? 'active' : ''}>
                    <Folder size={22} />
                    <span>资料库</span>
                </Link>
                <Link
                    href="/agents"
                    aria-current={pathname === '/agents' ? 'page' : undefined}
                    className={pathname === '/agents' ? 'active' : ''}
                >
                    <Bot size={22} />
                    <span>Agents</span>
                </Link>
                <Link href="/projects" aria-current={isProjects ? 'page' : undefined} className={isProjects ? 'active' : ''}>
                    <Folder size={22} />
                    <span>项目</span>
                </Link>
                <Link href="/inbox" aria-current={isTasks ? 'page' : undefined} className={isTasks ? 'active' : ''}>
                    <Inbox size={22} />
                    <span>任务</span>
                </Link>
            </nav>
            <dialog ref={drawerRef} className="navigation-dialog" aria-label="工作区导航">
                {sidebarContent(true)}
            </dialog>
            <dialog ref={modalRef} className="resource-dialog workspace-dialog" aria-labelledby="workspace-dialog-title">
                <div className="dialog-heading">
                    <h2 id="workspace-dialog-title">{modalTitles[modalKind]}</h2>
                    <button className="icon-button dialog-close" aria-label="关闭对话框" onClick={() => modalRef.current?.close()}>
                        <X size={19} />
                    </button>
                </div>
                {modalKind === 'more' && (
                    <div className="more-menu">
                        <Link className="sidebar-utility" href="/components" onClick={() => modalRef.current?.close()}>
                            <Grid2X2 size={18} />
                            <span>组件展示</span>
                            <ChevronRight size={16} />
                        </Link>
                        <button className="sidebar-utility" onClick={() => setModalKind('plugins')}>
                            <Layers size={18} />
                            <span>插件与能力</span>
                            <ChevronRight size={16} />
                        </button>
                        <button className="sidebar-utility" onClick={() => setModalKind('help')}>
                            <CircleHelp size={18} />
                            <span>使用帮助</span>
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}
                {modalKind === 'starters' && (
                    <div className="starter-grid" aria-label="工作起点">
                        {starters.map(({ title, detail, prompt }) => (
                            <button
                                className="starter-card"
                                aria-label={title + '：' + detail + '，填入输入框'}
                                key={title}
                                onClick={() => {
                                    setDraft(prompt)
                                    modalRef.current?.close()
                                    inputRef.current?.focus()
                                }}
                            >
                                {title}
                                <ArrowUp size={16} aria-hidden="true" />
                            </button>
                        ))}
                    </div>
                )}
                {modalKind === 'history' && (
                    <div className="history-list" aria-busy={loadingHistory}>
                        {!conversations.length && (
                            <p className="empty-message">{loadingHistory ? '正在载入历史对话…' : '还没有保存的对话。'}</p>
                        )}
                        {conversations.map(item => (
                            <button
                                className="history-row"
                                key={item.id}
                                aria-label={`${item.title}，${item.agent?.name ?? '通用助手'}${item.unread ? '，未读消息' : ''}`}
                                onClick={() => {
                                    modalRef.current?.close()
                                    selectConversation(item.id)
                                    window.setTimeout(() => inputRef.current?.focus(), 0)
                                }}
                            >
                                <span className="history-label">
                                    <strong>{item.title}</strong>
                                    <small>{item.agent?.name ?? '通用助手'}</small>
                                </span>
                                {item.unread && <span className="conversation-unread" aria-hidden="true" />}
                                <ChevronRight size={16} aria-hidden="true" />
                            </button>
                        ))}
                    </div>
                )}
                {modalKind === 'workspace' && (
                    <>
                        <p className="dialog-description">管理项目、对话与资料。</p>
                        <div className="workspace-summary">
                            <OrbitMark />
                            <div>
                                <strong>个人工作区</strong>
                                <span>项目、对话与资料，放在一起。</span>
                            </div>
                        </div>
                    </>
                )}
                {modalKind === 'files' && (
                    <>
                        <p className="dialog-description">资料上下文尚未接入当前聊天。</p>
                        <p className="dialog-note">当前 DeepSeek 对话使用你输入的文字与该对话的历史消息。你可以直接粘贴需要讨论的内容。</p>
                        <Link className="action-button" href="/rag" onClick={() => modalRef.current?.close()}>
                            前往资料库
                            <ArrowRight size={16} />
                        </Link>
                    </>
                )}
                {modalKind === 'plugins' && (
                    <>
                        <p className="dialog-description">当前对话已接入 DeepSeek。</p>
                        <div className="capability-note">
                            <Layers size={20} />
                            <span>网页阅读与其他插件尚未接入，当前聊天使用文字与历史消息。</span>
                        </div>
                    </>
                )}
                {modalKind === 'settings' && (
                    <>
                        <p className="dialog-description">选择助手与对话使用的资料。</p>
                        <div className="setting-row">
                            <span>
                                <strong>当前助手</strong>
                                <span>选择适合当前工作的助手</span>
                            </span>
                            <div className="select-control">
                                <select
                                    aria-label="设置助手"
                                    value={activeConversation?.agentId ?? selectedAgentId}
                                    onChange={event => selectAgent(event.target.value)}
                                >
                                    <option value="">通用助手</option>
                                    {agents.map(profile => (
                                        <option value={profile.id} key={profile.id}>
                                            {profile.name}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={14} aria-hidden="true" />
                            </div>
                        </div>
                        <p className="dialog-note">当前模型：{model}。切换助手会开始一段新对话。</p>
                        <Link className="action-button" href="/agents" onClick={() => modalRef.current?.close()}>
                            创建或编辑 Agent
                            <ArrowRight size={16} />
                        </Link>
                    </>
                )}
                {modalKind === 'help' && (
                    <>
                        <p className="dialog-description">把任务写下来，让工作有一个起点。</p>
                        <ol className="help-list">
                            <li>描述目标，或选择一个起步灵感。</li>
                            <li>发送任务，查看回答并继续讨论。</li>
                            <li>在资料库和任务页继续整理工作。</li>
                        </ol>
                        <p className="dialog-note">Enter 发送 · Shift + Enter 换行。</p>
                    </>
                )}
            </dialog>
            <div className={`toast ${notice ? 'visible' : ''}`} role="status">
                {notice && (
                    <>
                        <Check size={15} />
                        {notice}
                    </>
                )}
            </div>
        </div>
    )
}
