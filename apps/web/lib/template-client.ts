import {
    createTemplateSchema,
    launchTemplateSchema,
    projectTemplateSchema,
    templateLaunchResultSchema,
    updateTemplateSchema,
    type CreateTemplate,
    type LaunchTemplate,
    type ProjectTemplate,
    type TemplateLaunchResult,
    type UpdateTemplate,
} from '@ai-harness/contracts'
import { requestChatResponse } from './chat-client'

/**
 * Requests an authorized template through the signed same-origin proxy.
 * @param path - Resource below the template collection.
 * @param options - Method, payload and optional navigation signal.
 * @returns Untrusted JSON for public contract validation.
 * @throws Error for network failures or rejected requests.
 */
async function requestJson(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await requestChatResponse(`/templates${path}`, { cache: 'no-store', ...options })
    if (!response.ok) {
        let message = `模板服务请求失败（${response.status}），请稍后重试。`
        try {
            const body: unknown = await response.json()
            if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim())
                message = body.message
        } catch {
            // A disconnected proxy may provide an HTML response.
        }
        throw Object.assign(new Error(message), { status: response.status })
    }
    return response.json()
}

/**
 * Validates a saved template before replacing browser state.
 * @param value - Untrusted public response.
 * @returns The full versioned template.
 * @throws Error for malformed records or private storage-only fields.
 */
function parseTemplate(value: unknown): ProjectTemplate {
    const result = projectTemplateSchema.safeParse(value)
    if (!result.success) throw new Error('模板服务返回了无效的数据，请重新载入。')
    return result.data
}

/**
 * Loads templates owned by the current browser identity.
 * @param signal - Optional cancellation signal.
 * @returns The validated collection in recent-update order.
 * @throws Error when loading fails or collection data is invalid.
 */
export async function listTemplates(signal?: AbortSignal): Promise<ProjectTemplate[]> {
    const value = await requestJson('', { signal })
    if (!value || typeof value !== 'object' || !('templates' in value) || !Array.isArray(value.templates))
        throw new Error('模板服务返回了无效的列表。')
    return value.templates.map(parseTemplate)
}

/**
 * Reads a stable template and its current version without creating an instance.
 * @param id - Template identifier from a saved resource or URL.
 * @param signal - Optional cancellation signal.
 * @returns The current ordered blueprint.
 * @throws Error for inaccessible or invalid records.
 */
export async function getTemplate(id: string, signal?: AbortSignal): Promise<ProjectTemplate> {
    return parseTemplate(await requestJson(`/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Saves a new blueprint using a retained idempotent creation identifier.
 * @param input - Validated metadata, ordered tasks and creation identifier.
 * @returns The current saved template on initial save or matching replay.
 * @throws Error for invalid fields, conflicting requests or unavailable persistence.
 */
export async function createTemplate(input: CreateTemplate): Promise<ProjectTemplate> {
    return parseTemplate(
        await requestJson('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createTemplateSchema.parse(input)),
        })
    )
}

/**
 * Saves a blueprint only when the caller's read version remains current.
 * @param id - Stable template identifier.
 * @param input - Ordered blueprint and the version it was edited from.
 * @returns The next saved template version.
 * @throws Error for stale versions, invalid content or persistence failure.
 */
export async function updateTemplate(id: string, input: UpdateTemplate): Promise<ProjectTemplate> {
    return parseTemplate(
        await requestJson(`/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateTemplateSchema.parse(input)),
        })
    )
}

/**
 * Atomically creates a project and independent tasks from a previewed template version.
 * @param id - Template whose scope and version the API verifies.
 * @param input - Retained launch identifier, preview version and new project fields.
 * @returns The current original project and its ordered original task identifiers.
 * @throws Error for changed versions, conflicting actions, invalid responses or saving failures.
 */
export async function launchTemplate(id: string, input: LaunchTemplate): Promise<TemplateLaunchResult> {
    const value = await requestJson(`/${encodeURIComponent(id)}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(launchTemplateSchema.parse(input)),
    })
    const result = templateLaunchResultSchema.safeParse(value)
    if (!result.success) throw new Error('模板服务返回了无效的项目结果，请重新载入。')
    return result.data
}
