import { observeWorkspaceResponse, workspaceHeaders } from './workspace-context'
import {
    knowledgeIndexActionSchema,
    knowledgeSearchSchema,
    knowledgeSearchResultSchema,
    knowledgeVectorIndexSchema,
    vectorStatusSchema,
    type KnowledgeIndexAction,
    type KnowledgeSearch,
} from '@ai-harness/contracts'

/**
 * Requests one explicit vector operation through the authenticated knowledge proxy.
 * @param path - Fixed vector status, document index, or search resource.
 * @param options - Read or explicit JSON action with cancellation.
 * @returns Untrusted public JSON for contract validation.
 * @throws Error for safe API failures, lost sessions, cancellation, or deadlines.
 */
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), 35_000)
    try {
        const response = await fetch(`/api/knowledge${path}`, {
            ...options,
            headers: workspaceHeaders(options.headers),
            cache: 'no-store',
            credentials: 'same-origin',
            signal: options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal,
        })
        observeWorkspaceResponse(response)
        if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('harness:unauthorized'))
        if (!response.ok) {
            let message = `向量资料请求失败（${response.status}），请重试。`
            try {
                const body: unknown = await response.json()
                if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim())
                    message = body.message
            } catch {
                // A failed connection may return an HTML response.
            }
            throw Object.assign(new Error(message), { status: response.status })
        }
        return await response.json()
    } catch (cause) {
        if (options.signal?.aborted) throw cause
        if (deadline.signal.aborted) throw new Error('向量操作超时，请检查连接后重试。')
        if (cause instanceof Error && 'status' in cause) throw cause
        throw new Error('暂时无法连接向量资料服务，请重试。')
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Validates safe vector metadata before rendering any status or source.
 * @param value - Untrusted public response.
 * @param schema - Strict shared response contract.
 * @returns Validated data without raw vectors or provider credentials.
 * @throws Error for malformed or private-field responses.
 */
function parse<T>(value: unknown, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T {
    const result = schema.safeParse(value)
    if (!result.success) throw new Error('向量资料返回了无效的数据，请重新载入。')
    return result.data
}

/**
 * Reads actual vector availability and the current account default without a model call.
 * @param signal - Optional navigation cancellation.
 * @returns Capability and the default embedding connection metadata.
 * @throws Error when loading or validation fails.
 */
export async function getVectorStatus(signal?: AbortSignal) {
    return parse(await request('/vector-status', { signal }), vectorStatusSchema)
}

/**
 * Reads one document's index state independently of its text processing state.
 * @param id - Owned source document identifier.
 * @param signal - Optional navigation cancellation.
 * @returns Durable index state, compatible frozen space, and persisted progress.
 * @throws Error for inaccessible documents, storage failure, or invalid data.
 */
export async function getKnowledgeVectorIndex(id: string, signal?: AbortSignal) {
    return parse(await request(`/documents/${encodeURIComponent(id)}/index`, { signal }), knowledgeVectorIndexSchema)
}

/**
 * Starts an explicitly confirmed index generation or compatible failed-generation retry.
 * @param id - Owned ready source document.
 * @param input - Retained action UUID and the default identity the user confirmed.
 * @param retry - Whether to resume the compatible failed generation.
 * @param signal - Optional request cancellation; durable jobs survive navigation.
 * @returns Confirmed durable index metadata after the action is accepted.
 * @throws Error for changed defaults, invalid source state, or persistence failure.
 */
export async function startKnowledgeVectorIndex(id: string, input: KnowledgeIndexAction, retry = false, signal?: AbortSignal) {
    return parse(
        await request(`/documents/${encodeURIComponent(id)}/index${retry ? '/retry' : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(knowledgeIndexActionSchema.parse(input)),
            signal,
        }),
        knowledgeVectorIndexSchema
    )
}

/**
 * Embeds only an explicitly submitted query and retrieves compatible scoped original chunks.
 * @param input - Validated Unicode query, Top K, and optional owned document restriction.
 * @param signal - Optional user cancellation signal.
 * @returns The actual default model space and cosine-ordered original source hits.
 * @throws Error for invalid queries, no compatible indexes, provider failure, or model changes.
 */
export async function searchKnowledgeVectors(input: KnowledgeSearch, signal?: AbortSignal) {
    return parse(
        await request('/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(knowledgeSearchSchema.parse(input)),
            signal,
        }),
        knowledgeSearchResultSchema
    )
}

/**
 * Builds a stable source link that lets the detail page load the correct chunk page.
 * @param documentId - Saved source document identifier.
 * @param chunkIndex - One-based original chunk sequence number.
 * @returns A same-origin detail path with explicit chunk navigation and anchor.
 */
export function knowledgeChunkSource(documentId: string, chunkIndex: number): string {
    return `/rag/${encodeURIComponent(documentId)}?chunk=${chunkIndex}#chunk-${chunkIndex}`
}
