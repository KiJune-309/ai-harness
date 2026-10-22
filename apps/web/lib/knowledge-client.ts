import { observeWorkspaceResponse, workspaceHeaders } from './workspace-context'
import {
    KNOWLEDGE_MAX_FILE_SIZE,
    knowledgeChunksSchema,
    knowledgeDocumentSchema,
    knowledgeDocumentsSchema,
    knowledgeRetrySchema,
    knowledgeStatusSchema,
    knowledgeUploadSchema,
} from '@ai-harness/contracts'

/**
 * Extracts a safe user-facing message from a failed knowledge response.
 * @param response - Failed same-origin API response.
 * @returns An actionable error without transport or credential details.
 */
async function responseError(response: Response): Promise<Error> {
    try {
        const body: unknown = await response.json()
        if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim())
            return new Error(body.message)
    } catch {
        // A disconnected proxy can return an HTML error page.
    }
    return new Error(`资料库请求失败（${response.status}），请稍后重试。`)
}

/**
 * Requests a private knowledge resource and notifies the account boundary of session loss.
 * @param path - Fixed resource path relative to the knowledge proxy.
 * @param options - Request method, body, and optional cancellation signal.
 * @returns The successful response for JSON validation or attachment decoding.
 * @throws Error for rejected requests, network failure, or a connection deadline.
 */
async function request(path: string, options: RequestInit = {}): Promise<Response> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), 60_000)
    try {
        const response = await fetch(`/api/knowledge${path}`, {
            ...options,
            headers: workspaceHeaders(options.headers),
            credentials: 'same-origin',
            cache: 'no-store',
            signal: options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal,
        })
        observeWorkspaceResponse(response)
        if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('harness:unauthorized'))
        if (!response.ok) throw await responseError(response)
        return response
    } catch (cause) {
        if (options.signal?.aborted) throw cause
        if (deadline.signal.aborted) throw new Error('上传或读取超时，请检查连接后重试。')
        if (cause instanceof Error && cause.name !== 'TypeError') throw cause
        throw new Error('暂时无法连接资料库，请检查网络后重试。')
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Validates an untrusted response before adding it to the knowledge workspace.
 * @param response - Successful API response.
 * @param schema - Shared public response validator.
 * @returns The validated response without storage-only fields.
 * @throws Error when a successful response does not match its public contract.
 */
async function parse<T>(
    response: Response,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }
): Promise<T> {
    const result = schema.safeParse(await response.json())
    if (!result.success) throw new Error('资料库返回了无效的数据，请重新载入。')
    return result.data
}

/**
 * Reads upload availability and public format and size limits.
 * @param signal - Optional navigation cancellation signal.
 * @returns The current knowledge service capabilities.
 * @throws Error when status cannot be loaded or validated.
 */
export async function getKnowledgeStatus(signal?: AbortSignal) {
    return parse(await request('/status', { signal }), knowledgeStatusSchema)
}

/**
 * Loads one filename-filtered page of the current account's real documents.
 * @param input - One-based page, page size, and filename query.
 * @param signal - Optional navigation cancellation signal.
 * @returns The validated page and full matching count.
 * @throws Error when loading or response validation fails.
 */
export async function listKnowledgeDocuments(
    input: { page: number; pageSize: number; query: string; projectFolderId?: string },
    signal?: AbortSignal
) {
    const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize), query: input.query })
    if (input.projectFolderId) query.set('projectFolderId', input.projectFolderId)
    const result = await parse(await request(`/documents?${query}`, { signal }), knowledgeDocumentsSchema)
    if (input.projectFolderId && result.documents.some(document => document.projectFolderId !== input.projectFolderId))
        throw new Error('资料所属项目不一致，请重新载入。')
    return result
}

/**
 * Loads one saved document at its stable authenticated address.
 * @param id - Saved document identifier.
 * @param signal - Optional navigation cancellation signal.
 * @param projectFolderId - Optional exact project boundary for this read.
 * @returns Saved metadata and the actual processing state.
 * @throws Error when inaccessible, unavailable, or malformed.
 */
export async function getKnowledgeDocument(id: string, signal?: AbortSignal, projectFolderId?: string) {
    const query = projectFolderId ? `?${new URLSearchParams({ projectFolderId })}` : ''
    const result = await parse(await request(`/documents/${encodeURIComponent(id)}${query}`, { signal }), knowledgeDocumentSchema)
    if (projectFolderId && result.projectFolderId !== projectFolderId) throw new Error('资料所属项目不一致，请重新载入。')
    return result
}

/**
 * Loads a complete ordered page of published document chunks.
 * @param id - Saved source document identifier.
 * @param page - One-based page number.
 * @param signal - Optional navigation cancellation signal.
 * @param projectFolderId - Optional exact project boundary for this read.
 * @returns Validated chunks and the total published count.
 * @throws Error when reading or response validation fails.
 */
export async function getKnowledgeChunks(id: string, page: number, signal?: AbortSignal, projectFolderId?: string) {
    const query = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (projectFolderId) query.set('projectFolderId', projectFolderId)
    return parse(await request(`/documents/${encodeURIComponent(id)}/chunks?${query}`, { signal }), knowledgeChunksSchema)
}

/**
 * Uploads original file bytes using the caller's retained creation action identifier.
 * @param file - Single user-selected original file.
 * @param input - Idempotent request identifier and numeric character-based chunk settings.
 * @param signal - Optional upload cancellation signal.
 * @returns Saved metadata after the original file and queued job are durable.
 * @throws Error when file or input validation fails, or persistence is not confirmed.
 */
export async function uploadKnowledgeDocument(
    file: File,
    input: { requestId: string; chunkSize: number; overlap: number; projectFolderId?: string },
    signal?: AbortSignal
) {
    const settings = knowledgeUploadSchema.parse(input)
    if (!/\.(txt|md|pdf|docx)$/i.test(file.name)) throw new Error('请选择 TXT、MD、PDF 或 DOCX 文件。')
    if (!file.size || file.size > KNOWLEDGE_MAX_FILE_SIZE) throw new Error('文件须大于 0 且不超过 10 MiB。')
    const body = new FormData()
    body.set('file', file)
    body.set('requestId', settings.requestId)
    body.set('chunkSize', String(settings.chunkSize))
    body.set('overlap', String(settings.overlap))
    if (settings.projectFolderId) body.set('projectFolderId', settings.projectFolderId)
    const result = await parse(await request('/documents', { method: 'POST', body, signal }), knowledgeDocumentSchema)
    if (settings.projectFolderId && result.projectFolderId !== settings.projectFolderId) throw new Error('资料所属项目不一致，请重新载入。')
    return result
}

/**
 * Requeues a failed saved source with the same retry identifier until its result is known.
 * @param id - Failed document identifier.
 * @param requestId - Retained UUID for this retry action.
 * @param signal - Optional cancellation signal.
 * @returns The confirmed document processing state.
 * @throws Error when authorization, idempotency, or requeueing fails.
 */
export async function retryKnowledgeDocument(id: string, requestId: string, signal?: AbortSignal) {
    return parse(
        await request(`/documents/${encodeURIComponent(id)}/retry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(knowledgeRetrySchema.parse({ requestId })),
            signal,
        }),
        knowledgeDocumentSchema
    )
}

/**
 * Downloads authorized original bytes without navigating to an error response.
 * @param id - Source document identifier.
 * @param signal - Optional transfer cancellation signal.
 * @param projectFolderId - Optional exact project boundary for this download.
 * @returns The original file as a browser-local download blob.
 * @throws Error for missing objects, lost sessions, or storage failure.
 */
export async function downloadKnowledgeFile(id: string, signal?: AbortSignal, projectFolderId?: string): Promise<Blob> {
    const query = projectFolderId ? `?${new URLSearchParams({ projectFolderId })}` : ''
    return (await request(`/documents/${encodeURIComponent(id)}/file${query}`, { signal })).blob()
}
