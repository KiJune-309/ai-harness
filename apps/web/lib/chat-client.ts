import { observeWorkspaceResponse, workspaceHeaders } from './workspace-context'
import type {
    ChatConversation,
    ChatStatus,
    ChatStreamEvent,
    HumanDecisionAction,
    HumanResponse,
    PersonMention,
} from '@ai-harness/contracts'
import { chatConversationSchema, chatStatusSchema, chatStreamEventSchema, deleteConversationResultSchema } from '@ai-harness/contracts'

const chatPath = '/api/chat'

export class ChatRequestError extends Error {
    /**
     * Retains the HTTP status needed to reconcile a stale human response safely.
     * @param message - Public service failure text.
     * @param status - Rejected HTTP status.
     * @returns A chat request error with its original status.
     */
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message)
        this.name = 'ChatRequestError'
    }
}

/**
 * Validates public API data before it enters the workspace state.
 * @param value - Untrusted JSON returned by the service.
 * @param schema - Shared contract validator for the expected response.
 * @returns The validated public response.
 * @throws Error when the response does not match the shared contract.
 */
function parseResponse<T>(value: unknown, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error('聊天服务返回了无效的数据，请重新连接。')
    return parsed.data
}

/**
 * Reads a server error without hiding the useful response message.
 * @param response - Failed HTTP response from the chat API.
 * @returns A safe, human-readable error for the caller.
 */
async function responseError(response: Response): Promise<Error> {
    try {
        const body: unknown = await response.json()
        if (body && typeof body === 'object' && 'message' in body) {
            const message = body.message
            if (typeof message === 'string' && message.trim()) return new ChatRequestError(message, response.status)
        }
    } catch {
        // A proxy or disconnected server may return a non-JSON error page.
    }
    return new ChatRequestError(`聊天服务请求失败（${response.status}），请稍后重试。`, response.status)
}

/**
 * Fetches a JSON resource through the same-origin chat proxy.
 * @param path - Resource path relative to the chat API.
 * @param options - Request options, including cancellation when needed.
 * @returns The JSON response body.
 * @throws Error when the service rejects the request or the connection fails.
 */
async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await requestChatResponse(path, options)
    if (!response.ok) throw await responseError(response)
    return (await response.json()) as T
}

/**
 * Bound connection setup while preserving caller cancellation and long response streams.
 * @param path - API path relative to the same-origin chat proxy.
 * @param options - Request method, payload and optional navigation or generation signal.
 * @returns Response headers and the still-streaming response body.
 * @throws Error for connection timeout or an unavailable network without leaking transport details.
 */
export async function requestChatResponse(path: string, options: RequestInit = {}): Promise<Response> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), 15_000)
    try {
        const response = await fetch(`${chatPath}${path}`, {
            cache: 'no-store',
            ...options,
            headers: workspaceHeaders(options.headers),
            signal: options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal,
        })
        observeWorkspaceResponse(response)
        if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('harness:unauthorized'))
        return response
    } catch (error) {
        if (options.signal?.aborted) throw error
        if (deadline.signal.aborted) throw new Error('连接超时，请检查网络后重试。')
        throw new Error('暂时无法连接服务，请检查网络后重试。')
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Checks whether the server has the credentials needed for DeepSeek chat.
 * @param signal - Optional cancellation signal for the request.
 * @returns Public model and configuration status without credentials.
 * @throws Error when the status endpoint is unavailable.
 */
export async function getChatStatus(signal?: AbortSignal): Promise<ChatStatus> {
    return parseResponse(await requestJson('/status', { signal }), chatStatusSchema)
}

/**
 * Loads the conversations persisted by the chat API.
 * @param signal - Optional cancellation signal for the request.
 * @returns Conversations ordered by the server.
 * @throws Error when history cannot be loaded.
 */
export async function listConversations(signal?: AbortSignal): Promise<ChatConversation[]> {
    const result = await requestJson<unknown>('/conversations', { signal })
    if (!result || typeof result !== 'object' || !('conversations' in result)) throw new Error('聊天服务返回了无效的对话列表。')
    return parseResponse(result.conversations, chatConversationSchema.array())
}

/**
 * Creates a durable conversation before sending its first message.
 * @param title - Initial title derived from the user's first message.
 * @param signal - Optional cancellation signal for the request.
 * @param agentId - Optional saved Agent chosen for this conversation.
 * @param project - Optional personal project and retained creation action for a new conversation.
 * @returns The newly persisted empty conversation.
 * @throws Error when creation fails.
 */
export async function createConversation(
    title: string,
    signal?: AbortSignal,
    agentId?: string,
    project?: { projectFolderId?: string; requestId?: string }
): Promise<ChatConversation> {
    const result = await requestJson('/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, ...(agentId ? { agentId } : {}), ...project }),
        signal,
    })
    return parseResponse(result, chatConversationSchema)
}

/**
 * Reloads one conversation after a stopped or interrupted stream.
 * @param id - Conversation identifier supplied by the API.
 * @param signal - Optional cancellation signal for the request.
 * @returns The durable server version of the conversation.
 * @throws Error when the conversation cannot be fetched.
 */
export async function getConversation(id: string, signal?: AbortSignal): Promise<ChatConversation> {
    return parseResponse(await requestJson(`/conversations/${encodeURIComponent(id)}`, { signal }), chatConversationSchema)
}

/**
 * Deletes one owned ordinary chat through the authorized same-origin proxy.
 * @param id - Exact conversation selected by the user.
 * @returns After the server confirms durable deletion of this identity.
 * @throws Error when deletion fails or the receipt does not match the chosen conversation.
 */
export async function deleteConversation(id: string): Promise<void> {
    const result = parseResponse(
        await requestJson(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        deleteConversationResultSchema
    )
    if (result.id !== id) throw new Error('未能确认对话删除结果，请刷新后重试。')
}

/**
 * Cancels a running turn and waits for its partial answer to be saved.
 * @param id - Conversation containing the running request.
 * @param requestId - Identifier of the request the user chose to stop.
 * @returns The settled conversation after generation has stopped.
 * @throws Error when the server cannot confirm cancellation.
 */
export async function cancelConversation(id: string, requestId: string): Promise<ChatConversation> {
    const result = await requestJson(`/conversations/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
    })
    return parseResponse(result, chatConversationSchema)
}

/**
 * Records one dedicated decision about the exact saved human request version.
 * @param conversationId - Owned ordinary conversation containing the request.
 * @param humanRequestId - Stable identity of the reviewed request.
 * @param action - Retained idempotency identity, exact version, and human decision.
 * @returns The durable conversation after the decision and any resume scheduling.
 * @throws ChatRequestError when permission, version, or current state rejects the action.
 */
export async function decideHumanRequest(
    conversationId: string,
    humanRequestId: string,
    action: HumanDecisionAction
): Promise<ChatConversation> {
    const result = await requestJson(
        `/conversations/${encodeURIComponent(conversationId)}/human-requests/${encodeURIComponent(humanRequestId)}/decisions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }
    )
    return parseResponse(result, chatConversationSchema)
}

/**
 * Decodes one data frame from the server-sent event stream.
 * @param frame - Complete SSE frame, with line endings already normalized.
 * @returns A chat event, or null for keep-alive and unrelated SSE frames.
 * @throws Error when the server returns malformed JSON or an unknown event.
 */
function decodeFrame(frame: string): ChatStreamEvent | null {
    const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n')
    if (!data) return null
    return parseResponse(JSON.parse(data), chatStreamEventSchema)
}

/**
 * Sends a user turn and delivers real model events as they arrive.
 * @param conversationId - Existing durable conversation identifier.
 * @param content - User message to send to DeepSeek.
 * @param requestId - Stable identifier for this user turn and any explicit retry.
 * @param onEvent - Receives parsed model, completion, and failure events.
 * @param signal - Aborting this signal disconnects and cancels server generation.
 * @param mentions - Explicit account bindings relative to the submitted message body.
 * @param humanResponse - Exact saved question answered by this ordinary composer submission.
 * @returns A promise resolved after a terminal server event.
 * @throws Error for HTTP failures, malformed events, or truncated connections.
 */
export async function streamMessage(
    conversationId: string,
    content: string,
    requestId: string,
    onEvent: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
    mentions?: PersonMention[],
    humanResponse?: HumanResponse
): Promise<void> {
    await streamChatRequest(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        { content, requestId, ...(mentions?.length ? { mentions } : {}), ...(humanResponse ? { humanResponse } : {}) },
        onEvent,
        signal
    )
}

/**
 * Stream an allowed chat or task operation through the same-origin proxy.
 * @param path - Relative API path owned by the chat or task client.
 * @param body - Validated message or start request without credentials.
 * @param onEvent - Observer for parsed model and terminal events.
 * @param signal - Cancels the browser stream and upstream generation.
 * @returns After a validated terminal event is received.
 * @throws Error for HTTP errors, malformed responses, or incomplete streams.
 */
export async function streamChatRequest(
    path: string,
    body: Record<string, unknown>,
    onEvent: (event: ChatStreamEvent) => void,
    signal: AbortSignal
): Promise<void> {
    const response = await requestChatResponse(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal,
    })
    if (!response.ok) throw await responseError(response)
    if (!response.body) throw new Error('聊天服务没有返回消息流，请重试。')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let terminal = false
    try {
        while (!terminal) {
            const { value, done } = await reader.read()
            buffer += decoder.decode(value, { stream: !done })
            buffer = buffer.replace(/\r\n/g, '\n')
            let boundary = buffer.indexOf('\n\n')
            while (boundary !== -1) {
                const event = decodeFrame(buffer.slice(0, boundary))
                buffer = buffer.slice(boundary + 2)
                if (event) {
                    onEvent(event)
                    terminal = event.type === 'done' || event.type === 'cancelled' || event.type === 'error'
                    if (terminal) break
                }
                boundary = buffer.indexOf('\n\n')
            }
            if (done) break
        }
        if (!terminal) throw new Error('连接已中断，回答可能不完整。请重试或重新载入对话。')
    } finally {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
    }
}
