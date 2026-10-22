import {
    collaborationActionResultSchema,
    collaborationArtifactSchema,
    collaborationCommandSchema,
    collaborationEventSchema,
    collaborationMessageSchema,
    collaborationNodeDetailSchema,
    collaborationNodeSchema,
    collaborationNotificationSchema,
    collaborationPersonSchema,
    collaborationProjectSchema,
    collaborationProjectProgressSchema,
    collaborationQuestionSchema,
    collaborationSourceStateSchema,
    collaborationPendingContactSchema,
    collaborationDispatchSchema,
    type CollaborationActionResult,
    type CollaborationCommand,
    type CollaborationSource,
} from '@ai-harness/contracts'
import { requestChatResponse } from './chat-client'

/**
 * Describes an authorized collaboration request failure without exposing transport details.
 */
export class CollaborationRequestError extends Error {
    /**
     * Keeps the HTTP status available for inaccessible-record and retry handling.
     * @param message - Safe server or localized error text.
     * @param status - HTTP status, or zero for a connection failure.
     * @returns A collaboration request error.
     */
    constructor(
        message: string,
        public readonly status: number
    ) {
        super(message)
        this.name = 'CollaborationRequestError'
    }
}

/**
 * Reads an object envelope without accepting malformed lists as saved records.
 * @param value - Untrusted response body.
 * @returns A response object for subsequent schema validation.
 * @throws Error for a malformed response.
 */
function envelope(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('协作服务返回了无效的数据，请重新载入。')
    return value as Record<string, unknown>
}

/**
 * Requests one exact collaboration resource through the authenticated same-origin proxy.
 * @param path - Resource and validated query string below collaboration.
 * @param options - Method, body, and navigation cancellation signal.
 * @returns Untrusted JSON for the shared public schema.
 * @throws CollaborationRequestError for connection or HTTP failures.
 */
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    let response: Response
    try {
        response = await requestChatResponse(`/collaboration/${path}`, { cache: 'no-store', ...options })
    } catch (error) {
        if (options.signal?.aborted) throw error
        throw new CollaborationRequestError('暂时无法连接协作服务，请保留当前输入后重试。', 0)
    }
    if (!response.ok) {
        let message = response.status === 404 ? '未找到该协作记录，或你没有访问权限。' : '协作操作未能确认，请重试。'
        try {
            const body = envelope(await response.json())
            if (typeof body.message === 'string' && body.message.trim()) message = body.message
        } catch {
            // Keep safe feedback when an unavailable proxy returns HTML.
        }
        throw new CollaborationRequestError(message, response.status)
    }
    return response.json()
}

/**
 * Finds real colleagues in the authenticated workspace.
 * @param query - Name fragment entered in the mention picker.
 * @param signal - Cancels an obsolete search.
 * @returns Minimal public identities with stable account identifiers.
 * @throws Error for rejected searches or malformed responses.
 */
export async function searchCollaborationPeople(query: string, signal?: AbortSignal) {
    const body = envelope(await request(`people?${new URLSearchParams({ q: query })}`, { signal }))
    return collaborationPersonSchema.array().parse(body.people)
}

/**
 * Lists only collaboration projects visible to the authenticated account.
 * @param signal - Cancels navigation or an obsolete refresh.
 * @returns Authorized project projections without private task histories.
 * @throws Error for loading or schema failures.
 */
export async function listCollaborationProjects(signal?: AbortSignal) {
    const body = envelope(await request('projects', { signal }))
    return collaborationProjectSchema.array().parse(body.projects)
}

/**
 * Reads a shared project through its dedicated safe projection.
 * @param id - Stable collaboration project identifier.
 * @param signal - Cancels an obsolete selection.
 * @returns The project, authorized nodes, and published materials.
 * @throws Error for inaccessible or malformed records.
 */
export async function getCollaborationProject(id: string, signal?: AbortSignal) {
    return collaborationProjectSchema.parse(await request(`projects/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Reads the project's independent safe responsibility and pending-request projection.
 * @param id - Authorized project identifier.
 * @param signal - Cancels an obsolete view or account scope.
 * @returns Only public progress metadata and explicitly authorized own-chat links.
 * @throws Error when permissions, persistence, or the public whitelist contract cannot be verified.
 */
export async function getCollaborationProjectProgress(id: string, signal?: AbortSignal) {
    return collaborationProjectProgressSchema.parse(await request(`projects/${encodeURIComponent(id)}/progress`, { signal }))
}

/**
 * Reads a pending assignment or an authorized node projection.
 * @param id - Stable node identifier, which is never treated as a task identifier.
 * @param signal - Cancels an obsolete selection.
 * @returns Node metadata and its authorized events, questions, and artifacts.
 * @throws Error for inaccessible or malformed records.
 */
export async function getCollaborationNode(id: string, signal?: AbortSignal) {
    return collaborationNodeDetailSchema.parse(await request(`nodes/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Reads one authorized chronological page without truncating older node history.
 * @param id - Stable collaboration node identifier.
 * @param cursor - Exclusive event sequence already loaded in order.
 * @param signal - Cancels an obsolete node read.
 * @param eventId - Optional authorized anchor to retrieve without scanning unrelated pages.
 * @returns At most fifty validated events and their continuation cursor.
 * @throws Error for inaccessible nodes or malformed event pages.
 */
export async function getNodeCollaborationEvents(id: string, cursor = 0, signal?: AbortSignal, eventId?: string) {
    const params = new URLSearchParams({ cursor: String(cursor), ...(eventId ? { eventId } : {}) })
    const body = envelope(await request(`nodes/${encodeURIComponent(id)}/events?${params}`, { signal }))
    const events = collaborationEventSchema.array().parse(body.events)
    return {
        events,
        nextCursor: typeof body.nextCursor === 'number' ? body.nextCursor : Math.max(cursor, ...events.map(event => event.sequence)),
        hasMore: body.hasMore === true,
    }
}

/**
 * Reads bounded collaboration events belonging to an original private work context.
 * @param source - Authenticated conversation or task source.
 * @param cursor - Last server event sequence already received.
 * @param signal - Cancels a hidden or obsolete view.
 * @param eventId - Optional initial event anchor used to load its authorized page.
 * @returns Validated events and current node/question projections with a monotonic cursor.
 * @throws Error for inaccessible or malformed responses.
 */
export async function getSourceCollaboration(source: CollaborationSource, cursor = 0, signal?: AbortSignal, eventId?: string) {
    const params = new URLSearchParams({
        sourceKind: source.kind,
        sourceId: source.id,
        cursor: String(cursor),
        limit: '50',
        ...(eventId ? { eventId } : {}),
    })
    const body = envelope(await request(`source-events?${params}`, { signal }))
    const events = collaborationEventSchema.array().parse(body.events)
    return {
        events,
        questions: collaborationQuestionSchema.array().parse(body.questions ?? []),
        nodes: collaborationNodeSchema.array().parse(body.nodes ?? []),
        artifacts: collaborationArtifactSchema.array().parse(body.artifacts ?? []),
        sourceState: body.sourceState ? collaborationSourceStateSchema.parse(body.sourceState) : undefined,
        pendingContact: body.pendingContact ? collaborationPendingContactSchema.parse(body.pendingContact) : undefined,
        pendingDispatches: collaborationDispatchSchema.array().parse(body.pendingDispatches ?? []),
        nextCursor: typeof body.nextCursor === 'number' ? body.nextCursor : Math.max(cursor, ...events.map(event => event.sequence)),
        hasMore: body.hasMore === true,
    }
}

/**
 * Reads a bounded page of the current account's collaboration notifications.
 * @param cursor - Last notification sequence received.
 * @param signal - Cancels an obsolete or hidden view.
 * @param before - Exclusive sequence cursor for a bounded older page.
 * @returns Saved notifications; reading this list does not mark them read.
 * @throws Error for loading or schema failures.
 */
export async function listCollaborationNotifications(cursor = 0, signal?: AbortSignal, before?: number) {
    return (await getCollaborationNotificationPage(cursor, signal, before)).notifications
}

/**
 * Reads a bounded notification page with its durable total unread count.
 * @param cursor - Compatibility cursor for recent notifications.
 * @param signal - Cancels an obsolete account read.
 * @param before - Exclusive sequence cursor for older records.
 * @returns Validated notifications and the server's unread total when provided.
 * @throws Error for request or response validation failures.
 */
export async function getCollaborationNotificationPage(cursor = 0, signal?: AbortSignal, before?: number) {
    const params = new URLSearchParams({
        cursor: String(cursor),
        limit: '100',
        ...(before === undefined ? {} : { before: String(before) }),
    })
    const body = envelope(await request(`notifications?${params}`, { signal }))
    return {
        notifications: collaborationNotificationSchema.array().parse(body.notifications),
        unread: typeof body.unread === 'number' && Number.isSafeInteger(body.unread) && body.unread >= 0 ? body.unread : null,
        authorizedProjectIds:
            body.authorizedProjectIds === undefined
                ? undefined
                : collaborationPersonSchema.shape.id.array().parse(body.authorizedProjectIds),
    }
}

/**
 * Reads one lightweight message thread without granting access to its source task.
 * @param threadId - Exact thread chosen from a saved notification.
 * @param signal - Cancels an obsolete thread selection.
 * @param before - Exclusive sequence cursor for a bounded older page.
 * @returns Authorized messages in that thread.
 * @throws Error for inaccessible or malformed responses.
 */
export async function getCollaborationMessages(threadId: string, signal?: AbortSignal, before?: number) {
    const params = new URLSearchParams({ threadId, ...(before === undefined ? {} : { before: String(before) }) })
    const body = envelope(await request(`messages?${params}`, { signal }))
    return collaborationMessageSchema.array().parse(body.messages)
}

/**
 * Looks up an acknowledged mutation after its response was lost.
 * @param requestId - Stable action identifier retained by the original form.
 * @param signal - Cancels an obsolete lookup.
 * @returns The original committed result, without repeating the mutation.
 * @throws Error when the action is unknown or inaccessible.
 */
export async function getCollaborationAction(requestId: string, signal?: AbortSignal) {
    return collaborationActionResultSchema.parse(await request(`actions/${encodeURIComponent(requestId)}`, { signal }))
}

/**
 * Submits one validated command and checks committed state after an uncertain response.
 * @param command - A shared strict command carrying the caller's retained action identifier.
 * @param signal - Cancels this browser request without revoking accepted server work.
 * @returns The validated committed action result.
 * @throws Error when validation, authorization, or persistence cannot be confirmed.
 */
export async function sendCollaborationCommand(command: CollaborationCommand, signal?: AbortSignal): Promise<CollaborationActionResult> {
    const input = collaborationCommandSchema.parse(command)
    try {
        return collaborationActionResultSchema.parse(
            await request('commands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
                signal,
            })
        )
    } catch (error) {
        if (signal?.aborted || !(error instanceof CollaborationRequestError) || (error.status >= 400 && error.status < 500)) throw error
        try {
            return await getCollaborationAction(input.requestId, signal)
        } catch {
            throw error
        }
    }
}
