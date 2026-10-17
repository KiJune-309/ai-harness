import {
    createProjectSchema,
    personalProjectSchema,
    projectDetailSchema,
    projectInputSchema,
    type CreateProject,
    type PersonalProject,
    type ProjectDetail,
    type ProjectInput,
} from '@ai-harness/contracts'
import { requestChatResponse } from './chat-client'

/**
 * Requests a scoped project through the same-origin signed identity proxy.
 * @param path - Resource path relative to the project collection.
 * @param options - Method, payload and optional navigation cancellation signal.
 * @returns Untrusted JSON to be validated by the public project contract.
 * @throws Error for network failures or rejected requests without exposing private details.
 */
async function requestJson(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await requestChatResponse(`/projects${path}`, { cache: 'no-store', ...options })
    if (!response.ok) {
        let message = `项目服务请求失败（${response.status}），请稍后重试。`
        try {
            const body: unknown = await response.json()
            if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim())
                message = body.message
        } catch {
            // An unavailable proxy may return an HTML error page.
        }
        throw new Error(message)
    }
    return response.json()
}

/**
 * Validates a saved public project before updating browser state.
 * @param value - Untrusted project response.
 * @returns The validated project without any storage-only fields.
 * @throws Error when the response does not match the public contract.
 */
function parseProject(value: unknown): PersonalProject {
    const result = personalProjectSchema.safeParse(value)
    if (!result.success) throw new Error('项目服务返回了无效的数据，请重新载入。')
    return result.data
}

/**
 * Lists real personal projects in the current user's workspace.
 * @param signal - Optional navigation or refresh cancellation signal.
 * @returns Validated projects in the server's recent-update order.
 * @throws Error when loading fails or the collection is malformed.
 */
export async function listProjects(signal?: AbortSignal): Promise<PersonalProject[]> {
    const value = await requestJson('', { signal })
    if (!value || typeof value !== 'object' || !('projects' in value) || !Array.isArray(value.projects))
        throw new Error('项目服务返回了无效的列表。')
    return value.projects.map(parseProject)
}

/**
 * Loads one stable project and every currently associated task.
 * @param id - Project identifier supplied by navigation or a saved task.
 * @param signal - Optional cancellation signal.
 * @returns The saved project and real task snapshots for current status counts.
 * @throws Error when inaccessible, unavailable or malformed.
 */
export async function getProject(id: string, signal?: AbortSignal): Promise<ProjectDetail> {
    const result = projectDetailSchema.safeParse(await requestJson(`/${encodeURIComponent(id)}`, { signal }))
    if (!result.success) throw new Error('项目服务返回了无效的详情，请重新载入。')
    return result.data
}

/**
 * Creates a project using the caller's retained idempotent action identifier.
 * @param input - Name, description and creation request identifier.
 * @param signal - Optional cancellation signal for saving.
 * @returns The saved project, including its current values when replaying an old creation.
 * @throws Error when validation, authorization or saving fails.
 */
export async function createProject(input: CreateProject, signal?: AbortSignal): Promise<PersonalProject> {
    return parseProject(
        await requestJson('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createProjectSchema.parse(input)),
            signal,
        })
    )
}

/**
 * Updates a project's management information without changing task context.
 * @param id - Stable project identifier.
 * @param input - New project name and description.
 * @returns The project after persistence succeeds.
 * @throws Error when validation, ownership or saving fails.
 */
export async function updateProject(id: string, input: ProjectInput): Promise<PersonalProject> {
    return parseProject(
        await requestJson(`/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(projectInputSchema.parse(input)),
        })
    )
}
