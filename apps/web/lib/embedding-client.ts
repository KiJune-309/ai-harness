import { observeWorkspaceResponse, workspaceHeaders } from './workspace-context'
import {
    createEmbeddingModelSchema,
    updateEmbeddingModelSchema,
    embeddingModelSchema,
    embeddingModelsSchema,
    embeddingModelTestSchema,
    type CreateEmbeddingModel,
    type UpdateEmbeddingModel,
} from '@ai-harness/contracts'

/**
 * Calls only the independent embedding account API without exposing provider credentials.
 * @param path - Resource relative to the embedding connection collection.
 * @param options - Explicit method, body, and optional cancellation signal.
 * @returns Untrusted JSON for public contract validation, or null after deletion.
 * @throws Error for authorization, persistence, provider test, network, or deadline failures.
 */
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), 35_000)
    try {
        const response = await fetch(`/api/account/embedding-models${path}`, {
            ...options,
            headers: workspaceHeaders(options.headers),
            cache: 'no-store',
            credentials: 'same-origin',
            signal: options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal,
        })
        observeWorkspaceResponse(response)
        if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('harness:unauthorized'))
        if (!response.ok) {
            let message = `向量模型请求失败（${response.status}），请重试。`
            try {
                const body: unknown = await response.json()
                if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim())
                    message = body.message
            } catch {
                // A disconnected proxy may return non-JSON feedback.
            }
            throw Object.assign(new Error(message), { status: response.status })
        }
        return response.status === 204 ? null : await response.json()
    } catch (cause) {
        if (options.signal?.aborted) throw cause
        if (deadline.signal.aborted) throw new Error('向量模型请求超时，请检查连接后重试。')
        if (cause instanceof Error && 'status' in cause) throw cause
        throw new Error('暂时无法连接向量模型服务，请稍后重试。')
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Rejects malformed or secret-bearing public embedding responses.
 * @param value - Untrusted JSON.
 * @param schema - Shared strict public response contract.
 * @returns Validated public metadata only.
 * @throws Error when the service returns an invalid response.
 */
function parse<T>(value: unknown, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T {
    const result = schema.safeParse(value)
    if (!result.success) throw new Error('向量模型返回了无效的数据，请重新载入。')
    return result.data
}

/**
 * Serializes a validated connection write without persisting its key in browser storage.
 * @param method - Explicit create or update operation.
 * @param input - Validated metadata and write-only credentials.
 * @returns JSON request options used only by the current transfer.
 */
function mutation(method: 'POST' | 'PUT', input: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
}

/**
 * Lists embedding connections separately from the chat model directory.
 * @param signal - Optional navigation cancellation.
 * @returns Only the current account's safe embedding metadata.
 * @throws Error when loading or validation fails.
 */
export async function listEmbeddingModels(signal?: AbortSignal) {
    return parse(await request('', { signal }), embeddingModelsSchema).models
}

/**
 * Creates a saved embedding connection without calling its provider.
 * @param input - Validated fields and a retained creation action UUID.
 * @returns Confirmed safe connection metadata.
 * @throws Error for invalid fields, conflicting retries, or failed persistence.
 */
export async function createEmbeddingModel(input: CreateEmbeddingModel) {
    return parse(await request('', mutation('POST', createEmbeddingModelSchema.parse(input))), embeddingModelSchema)
}

/**
 * Updates exactly the version the user opened, keeping a blank key unchanged.
 * @param id - Owned connection identifier.
 * @param input - New fields and the expected saved revision.
 * @returns Confirmed metadata with any new unverified revision.
 * @throws Error for version conflicts, invalid fields, or unsuccessful saving.
 */
export async function updateEmbeddingModel(id: string, input: UpdateEmbeddingModel) {
    return parse(
        await request(`/${encodeURIComponent(id)}`, mutation('PUT', updateEmbeddingModelSchema.parse(input))),
        embeddingModelSchema
    )
}

/**
 * Explicitly tests the saved connection with fixed non-secret probe text.
 * @param id - Owned saved connection.
 * @param signal - User cancellation or unmount signal.
 * @returns Verified dimensions and the provider's declared model identity.
 * @throws Error for unsupported protocol, provider failure, cancellation, or a stale revision.
 */
export async function testEmbeddingModel(id: string, signal: AbortSignal) {
    return parse(await request(`/${encodeURIComponent(id)}/test`, { method: 'POST', signal }), embeddingModelTestSchema)
}

/**
 * Chooses the only active embedding space without invoking the provider.
 * @param id - Owned saved connection selected by the user.
 * @returns Confirmed single-default metadata.
 * @throws Error when authorization, persistence, or configuration comparison fails.
 */
export async function setDefaultEmbeddingModel(id: string) {
    return parse(await request(`/${encodeURIComponent(id)}/default`, { method: 'POST' }), embeddingModelSchema)
}

/**
 * Deletes the explicitly confirmed embedding connection without choosing a replacement.
 * @param id - Owned connection selected for deletion.
 * @returns After deletion is confirmed by the API.
 * @throws Error when deletion cannot be confirmed.
 */
export async function deleteEmbeddingModel(id: string): Promise<void> {
    await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
