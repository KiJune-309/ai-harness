import type { ChatStreamEvent, CreateTask, PersonalTask, UpdateTaskStatus, UpdateTaskProject } from '@ai-harness/contracts'
import {
    cancelChatMessageSchema,
    createTaskSchema,
    personalTaskSchema,
    sendChatMessageSchema,
    updateTaskStatusSchema,
    updateTaskProjectSchema,
} from '@ai-harness/contracts'
import { requestChatResponse, streamChatRequest } from './chat-client'

export type TaskStreamEvent =
    Exclude<ChatStreamEvent, { type: 'done' | 'cancelled' }> | { type: 'done' | 'cancelled'; conversation: PersonalTask }

const taskPath = '/tasks'

/**
 * Validates a task response before it enters browser state.
 * @param value - Untrusted JSON returned by the task service.
 * @returns The validated task with its frozen agent and work metadata.
 * @throws Error when required task fields are missing or invalid.
 */
function parseTask(value: unknown): PersonalTask {
    const result = personalTaskSchema.safeParse(value)
    if (!result.success) throw new Error('任务服务返回了无效的数据，请重新载入。')
    return result.data
}

/**
 * Requests a task resource through the existing same-origin proxy.
 * @param path - Resource path relative to the task collection.
 * @param options - HTTP method, payload, and optional cancellation signal.
 * @returns Untrusted JSON for the public contract validator.
 * @throws Error when the connection fails or the service rejects the request.
 */
async function requestJson(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await requestChatResponse(`${taskPath}${path}`, { cache: 'no-store', ...options })
    if (!response.ok) {
        let message = `任务服务请求失败（${response.status}），请稍后重试。`
        try {
            const body: unknown = await response.json()
            if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim())
                message = body.message
        } catch {
            // A disconnected proxy may return an HTML error page.
        }
        throw new Error(message)
    }
    return response.json()
}

/**
 * Loads tasks owned by the current browser identity and workspace.
 * @param signal - Optional cancellation signal for navigation or refresh.
 * @returns Validated tasks in the server's recent-update order.
 * @throws Error when the collection is unavailable or contains invalid tasks.
 */
export async function listTasks(signal?: AbortSignal): Promise<PersonalTask[]> {
    const value = await requestJson('', { signal })
    if (!value || typeof value !== 'object' || !('tasks' in value) || !Array.isArray(value.tasks))
        throw new Error('任务服务返回了无效的列表。')
    return value.tasks.map(parseTask)
}

/**
 * Opens a stable task without creating or executing it.
 * @param id - Task identifier from a saved resource or URL.
 * @param signal - Optional cancellation signal for navigation.
 * @returns The persisted task, agent snapshot, and message history.
 * @throws Error when the task is unavailable to the current identity.
 */
export async function getTask(id: string, signal?: AbortSignal): Promise<PersonalTask> {
    return parseTask(await requestJson(`/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Saves a new task without making a model request.
 * @param input - Validated title, goal, optional agent, and stable creation request identifier.
 * @param signal - Optional cancellation signal for the save operation.
 * @returns The saved task with its frozen agent configuration.
 * @throws Error when validation, authorization, or persistence fails.
 */
export async function createTask(input: CreateTask, signal?: AbortSignal): Promise<PersonalTask> {
    return parseTask(
        await requestJson('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createTaskSchema.parse(input)),
            signal,
        })
    )
}

/**
 * Persists a user-selected work status or restores the prior unfinished status.
 * @param id - Existing task identifier.
 * @param input - Explicit status selection or restore instruction.
 * @returns The task after the status has been saved.
 * @throws Error when the task is running, the change is invalid, or saving fails.
 */
export async function updateTaskStatus(id: string, input: UpdateTaskStatus): Promise<PersonalTask> {
    return parseTask(
        await requestJson(`/${encodeURIComponent(id)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateTaskStatusSchema.parse(input)),
        })
    )
}

/**
 * Moves a task to one project or removes its current project association.
 * @param id - Stable task identifier whose history remains unchanged.
 * @param input - Accessible target project identifier, or null for no project.
 * @returns The complete task after the service saves the association.
 * @throws Error for invalid input, inaccessible records, active generation or persistence failure.
 */
export async function updateTaskProject(id: string, input: UpdateTaskProject): Promise<PersonalTask> {
    return parseTask(
        await requestJson(`/${encodeURIComponent(id)}/project`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateTaskProjectSchema.parse(input)),
        })
    )
}

/**
 * Validates terminal task snapshots while forwarding shared chat stream events.
 * @param path - Relative task execution route handled by the shared SSE client.
 * @param body - Already validated public execution payload.
 * @param onEvent - Receives stream updates and complete task snapshots.
 * @param signal - Signal that disconnects and cancels model execution.
 * @returns A promise settled when the shared stream reaches a terminal event.
 * @throws Error for malformed task snapshots, interrupted streams, or HTTP failures.
 */
async function streamTask(
    path: string,
    body: Record<string, string>,
    onEvent: (event: TaskStreamEvent) => void,
    signal: AbortSignal
): Promise<void> {
    await streamChatRequest(
        path,
        body,
        event => {
            if (event.type === 'done' || event.type === 'cancelled')
                onEvent({ type: event.type, conversation: parseTask(event.conversation) })
            else onEvent(event)
        },
        signal
    )
}

/**
 * Explicitly begins a task using its saved goal as the first user request.
 * @param id - Existing task identifier.
 * @param requestId - Stable identifier reused when retrying this first execution.
 * @param onEvent - Receives incremental text and validated final task state.
 * @param signal - Cancellation signal for the execution connection.
 * @returns A promise settled after the terminal stream event.
 * @throws Error when execution is rejected or the stream is invalid.
 */
export async function startTask(
    id: string,
    requestId: string,
    onEvent: (event: TaskStreamEvent) => void,
    signal: AbortSignal
): Promise<void> {
    const input = cancelChatMessageSchema.parse({ requestId })
    await streamTask(`/tasks/${encodeURIComponent(id)}/start`, input, onEvent, signal)
}

/**
 * Sends a follow-up in the same task context without repeating its saved goal.
 * @param id - Existing task identifier.
 * @param content - User's supplemental message.
 * @param requestId - Stable identifier reused for an explicit failed-turn retry.
 * @param onEvent - Receives incremental text and validated final task state.
 * @param signal - Cancellation signal for the execution connection.
 * @returns A promise settled after the terminal stream event.
 * @throws Error when validation, task rules, or streaming fails.
 */
export async function streamTaskMessage(
    id: string,
    content: string,
    requestId: string,
    onEvent: (event: TaskStreamEvent) => void,
    signal: AbortSignal
): Promise<void> {
    const input = sendChatMessageSchema.parse({ content, requestId })
    await streamTask(`/tasks/${encodeURIComponent(id)}/messages`, input, onEvent, signal)
}

/**
 * Stops a matching active task turn and retrieves its saved partial history.
 * @param id - Task containing the active model request.
 * @param requestId - Identifier of the turn the user chose to stop.
 * @returns The settled task after cancellation has been acknowledged.
 * @throws Error when cancellation cannot be confirmed by the server.
 */
export async function cancelTask(id: string, requestId: string): Promise<PersonalTask> {
    return parseTask(
        await requestJson(`/${encodeURIComponent(id)}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cancelChatMessageSchema.parse({ requestId })),
        })
    )
}
