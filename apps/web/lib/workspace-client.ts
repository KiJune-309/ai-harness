import {
    createWorkspaceSchema,
    inviteWorkspaceMemberSchema,
    teamWorkspaceSchema,
    workspaceDetailSchema,
    workspaceDirectorySchema,
    workspaceInputSchema,
    workspaceInvitationSchema,
    type CreateWorkspace,
    type InviteWorkspaceMember,
    type WorkspaceInput,
} from '@ai-harness/contracts'

/**
 * Calls workspace management independently of a stale business workspace context.
 * @param path - Fixed resource below the workspace directory.
 * @param options - HTTP method, payload, and caller cancellation.
 * @returns Untrusted public JSON for shared contract validation.
 * @throws Error for lost sessions, invalid permissions, failed persistence, or a deadline.
 */
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), 15_000)
    try {
        const response = await fetch(`/api/account/workspaces${path}`, {
            ...options,
            cache: 'no-store',
            credentials: 'same-origin',
            signal: options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal,
        })
        if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('harness:unauthorized'))
        if (!response.ok) {
            let message = `工作空间请求失败（${response.status}），请重试。`
            try {
                const body: unknown = await response.json()
                if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') message = body.message
            } catch {
                // A disconnected proxy can return non-JSON feedback.
            }
            throw Object.assign(new Error(message), { status: response.status })
        }
        return response.status === 204 ? null : await response.json()
    } catch (cause) {
        if (options.signal?.aborted) throw cause
        if (deadline.signal.aborted) throw new Error('工作空间请求超时，请检查连接后重试。')
        if (cause instanceof Error && 'status' in cause) throw cause
        throw new Error('暂时无法连接工作空间服务，请重试。')
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Validates public workspace metadata before it becomes interface state.
 * @param value - Untrusted response JSON.
 * @param schema - Shared strict public contract.
 * @returns The validated public result.
 * @throws Error for malformed or unexpected private fields.
 */
function parse<T>(value: unknown, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T {
    const result = schema.safeParse(value)
    if (!result.success) throw new Error('工作空间返回了无效的数据，请重新载入。')
    return result.data
}

/**
 * Serializes an explicit workspace mutation.
 * @param method - Allowed write method.
 * @param input - Validated public request fields.
 * @returns JSON request options.
 */
function mutation(method: 'POST' | 'PUT', input: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
}

/**
 * Requires an explicit server confirmation before a management action changes the interface.
 * @param value - Untrusted successful HTTP response body.
 * @returns Nothing after a strict public success acknowledgement.
 * @throws Error when the response is malformed or lacks confirmation.
 */
function confirmSuccess(value: unknown): void {
    if (!value || typeof value !== 'object' || !('success' in value) || value.success !== true || Object.keys(value).length !== 1)
        throw new Error('未能确认工作空间操作结果，请重新载入后重试。')
}

/**
 * Reads the real membership directory and invitations addressed to this account.
 * @param signal - Optional component cancellation.
 * @returns Persisted memberships, current workspace, and invitations.
 * @throws Error when the directory cannot be read or validated.
 */
export async function listWorkspaces(signal?: AbortSignal) {
    return parse(await request('', { signal }), workspaceDirectorySchema)
}

/**
 * Creates one team using a retained request identifier for safe retries.
 * @param input - Validated name, description, and creation request identifier.
 * @returns The persisted team workspace owned by this account.
 * @throws Error for invalid fields, conflicting retries, or storage failure.
 */
export async function createWorkspace(input: CreateWorkspace) {
    return parse(await request('', mutation('POST', createWorkspaceSchema.parse(input))), teamWorkspaceSchema)
}

/**
 * Reads one workspace's permitted management details.
 * @param id - A workspace selected from the current membership directory.
 * @param signal - Optional component cancellation.
 * @returns Public workspace, member, and permitted invitation metadata.
 * @throws Error for missing membership or unavailable data.
 */
export async function getWorkspace(id: string, signal?: AbortSignal) {
    return parse(await request(`/${encodeURIComponent(id)}`, { signal }), workspaceDetailSchema)
}

/**
 * Saves an owner's explicit workspace information changes.
 * @param id - Team workspace identifier.
 * @param input - Validated name and description.
 * @returns The confirmed updated workspace.
 * @throws Error for lost owner permission, validation, or storage failure.
 */
export async function updateWorkspace(id: string, input: WorkspaceInput) {
    return parse(await request(`/${encodeURIComponent(id)}`, mutation('PUT', workspaceInputSchema.parse(input))), teamWorkspaceSchema)
}

/**
 * Switches only after the user confirms discarding the current private drafts.
 * @param id - A currently joined workspace identifier.
 * @returns After the server persists the session's active workspace.
 * @throws Error when membership or persistence cannot be confirmed.
 */
export async function switchWorkspace(id: string): Promise<void> {
    confirmSuccess(await request(`/${encodeURIComponent(id)}/switch`, mutation('POST', {})))
}

/**
 * Invites one existing registered account by normalized email.
 * @param id - Team workspace owned by the caller.
 * @param input - Recipient email and retained invitation action identifier.
 * @returns The persisted invitation and its actual expiry.
 * @throws Error for missing recipients, duplicate membership, permission loss, or storage failure.
 */
export async function inviteWorkspaceMember(id: string, input: InviteWorkspaceMember) {
    return parse(
        await request(`/${encodeURIComponent(id)}/invitations`, mutation('POST', inviteWorkspaceMemberSchema.parse(input))),
        workspaceInvitationSchema
    )
}

/**
 * Records this account's explicit invitation choice.
 * @param id - Invitation actually addressed to the authenticated account.
 * @param accept - Whether to accept membership or decline the invitation.
 * @returns After the atomic membership or declined status is confirmed.
 * @throws Error for expired, revoked, unauthorized, or unavailable invitations.
 */
export async function respondWorkspaceInvitation(id: string, accept: boolean): Promise<void> {
    confirmSuccess(await request(`/invitations/${encodeURIComponent(id)}/respond`, mutation('POST', { accept })))
}

/**
 * Revokes an owner's pending invitation after explicit selection.
 * @param workspaceId - Owned team workspace.
 * @param invitationId - The actual invitation being revoked.
 * @returns After the server confirms revocation.
 * @throws Error for lost permission, changed invitation state, or persistence failure.
 */
export async function revokeWorkspaceInvitation(workspaceId: string, invitationId: string): Promise<void> {
    confirmSuccess(
        await request(`/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' })
    )
}

/**
 * Removes a member after the owner confirms the recipient and consequences.
 * @param workspaceId - Owned team workspace.
 * @param userId - The member selected for removal.
 * @returns After membership removal is confirmed.
 * @throws Error for owner removal, lost permission, or persistence failure.
 */
export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    confirmSuccess(await request(`/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }))
}

/**
 * Leaves a team only after the member confirms losing access.
 * @param workspaceId - Joined team workspace where this account is a member.
 * @returns After membership removal and any active-workspace fallback are persisted.
 * @throws Error for owner exit, lost permission, or persistence failure.
 */
export async function leaveWorkspace(workspaceId: string): Promise<void> {
    confirmSuccess(await request(`/${encodeURIComponent(workspaceId)}/leave`, mutation('POST', {})))
}
