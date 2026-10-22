let verifiedWorkspaceId: string | undefined
let invalidated = false

/**
 * Retains only the workspace most recently verified by the account boundary.
 * @param workspaceId - Server-confirmed active workspace, or undefined during invalidation.
 * @returns Nothing; updates only this document's transient request context.
 */
export function setVerifiedWorkspace(workspaceId: string | undefined): void {
    if (workspaceId) invalidated = false
    else if (verifiedWorkspaceId) invalidated = true
    verifiedWorkspaceId = workspaceId
}

/**
 * Binds a business request to the workspace that rendered its current form.
 * @param headers - Original request headers, including multipart or JSON metadata.
 * @returns Headers containing only the server-verified workspace expectation.
 * @throws Error after a real workspace is invalidated and before the next verified account response.
 */
export function workspaceHeaders(headers?: HeadersInit): HeadersInit | undefined {
    if (invalidated) throw new Error('工作空间正在重新验证，请稍后重试。')
    if (!verifiedWorkspaceId && !new Headers(headers).has('X-Harness-Context')) return headers
    const result = new Headers(headers)
    result.delete('X-Harness-Context')
    if (verifiedWorkspaceId) result.set('X-Harness-Context', verifiedWorkspaceId)
    return result
}

/**
 * Asks the account boundary to reverify a workspace rejected by the server.
 * @param response - Response from a protected business request.
 * @returns Nothing; emits a local event only for an explicit context conflict.
 */
export function observeWorkspaceResponse(response: Response): void {
    if (response.headers.get('X-Harness-Context-Changed') === '1' && typeof window !== 'undefined')
        window.dispatchEvent(new Event('harness:workspace-changed'))
}
