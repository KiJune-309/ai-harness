import {
    createWorkflowTemplateSchema,
    updateWorkflowTemplateSchema,
    workflowTemplateSchema,
    templateCatalogEntrySchema,
    createWorkflowPreviewSchema,
    workflowPreviewSchema,
    workflowLaunchSchema,
    workflowLaunchResultSchema,
    type WorkflowTemplateInput,
} from '@ai-harness/contracts'
import { requestChatResponse } from './chat-client'

/**
 * Requests only authenticated same-workspace template resources through the existing BFF.
 * @param path - Fixed catalog or workflow endpoint below chat.
 * @param options - Explicit read cancellation or JSON mutation.
 * @returns Untrusted JSON for strict public contract validation.
 * @throws Error with HTTP status for permission, version, validation, or service failures.
 */
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await requestChatResponse(path, { cache: 'no-store', ...options })
    if (!response.ok) {
        let message = `协作模板请求失败（${response.status}），请保留输入后重试。`
        try {
            const body = await response.json()
            if (typeof body?.message === 'string') message = body.message
        } catch {
            /* Failed proxies may return non-JSON responses. */
        }
        throw Object.assign(new Error(message), { status: response.status })
    }
    return response.json()
}

/**
 * Encodes one explicit template write without carrying client identity claims.
 * @param method - Allowed workflow mutation method.
 * @param body - Validated public input.
 * @returns JSON request options.
 */
function json(method: 'POST' | 'PUT', body: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

/**
 * Reads the complete discriminated template catalog without hiding either collection's failures.
 * @param signal - Optional component lifecycle cancellation.
 * @returns Real personal and workflow templates in one authorized collection.
 * @throws Error for inaccessible or malformed catalog records.
 */
export async function listTemplateCatalog(signal?: AbortSignal) {
    const value = await request('/template-catalog', { signal })
    if (!Array.isArray(value)) throw new Error('模板目录返回无效，请重新载入。')
    return value.map(item => templateCatalogEntrySchema.parse(item))
}

/**
 * Discovers a stable template's real kind without permission-error fallback.
 * @param id - Stable template identity.
 * @param signal - Optional component lifecycle cancellation.
 * @returns The exact authorized discriminated template record.
 * @throws Error for missing, inaccessible, or unavailable records.
 */
export async function getTemplateCatalogEntry(id: string, signal?: AbortSignal) {
    return templateCatalogEntrySchema.parse(await request(`/template-catalog/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Reads a saved workflow version for an explicit review checkpoint.
 * @param id - Owned workflow identity.
 * @param signal - Optional cancellation.
 * @returns The current full graph and real assignee availability.
 * @throws Error for inaccessible or unavailable records.
 */
export async function getWorkflowTemplate(id: string, signal?: AbortSignal) {
    return workflowTemplateSchema.parse(await request(`/workflow-templates/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Saves one new graph using a retained human creation identifier.
 * @param input - Graph fields and retained request identifier.
 * @returns The confirmed workflow record.
 * @throws Error for invalid structure, assignees, conflicts, or storage failure.
 */
export async function createWorkflowTemplate(input: WorkflowTemplateInput & { requestId: string }) {
    return workflowTemplateSchema.parse(await request('/workflow-templates', json('POST', createWorkflowTemplateSchema.parse(input))))
}

/**
 * Updates only the explicitly read version of one owned workflow.
 * @param id - Stable workflow identity.
 * @param input - Complete layout, relationships, assignees, text, and baseline version.
 * @returns The confirmed next saved version.
 * @throws Error for stale versions, invalid structure, or lost authorization.
 */
export async function updateWorkflowTemplate(id: string, input: WorkflowTemplateInput & { version: number }) {
    return workflowTemplateSchema.parse(
        await request(`/workflow-templates/${encodeURIComponent(id)}`, json('PUT', updateWorkflowTemplateSchema.parse(input)))
    )
}

/**
 * Freezes the complete server-generated openings and sharing scope for human review.
 * @param id - Saved workflow identity.
 * @param input - Previewed version, project text, and this instance's exact assignees.
 * @returns A frozen server preview that must be reviewed before a separate confirmation.
 * @throws Error for changed versions or invalid assignees, never silently replacing them.
 */
export async function previewWorkflowTemplate(
    id: string,
    input: { version: number; name: string; description: string; assignees: { nodeId: string; assigneeId: string }[] }
) {
    return workflowPreviewSchema.parse(
        await request(`/workflow-templates/${encodeURIComponent(id)}/preview`, json('POST', createWorkflowPreviewSchema.parse(input)))
    )
}

/**
 * Confirms exactly one frozen preview without reconstructing or appending hidden opening text.
 * @param id - Workflow identity used to generate the preview.
 * @param input - Frozen preview and retained launch action identifiers.
 * @returns The actual new shared project and independent responsibility identities.
 * @throws Error for invalidated previews, permission changes, or persistence failure.
 */
export async function launchWorkflowTemplate(id: string, input: { requestId: string; previewId: string }) {
    return workflowLaunchResultSchema.parse(
        await request(`/workflow-templates/${encodeURIComponent(id)}/launch`, json('POST', workflowLaunchSchema.parse(input)))
    )
}
