import {
    createProjectFolderSchema,
    projectFolderSchema,
    projectFoldersSchema,
    type CreateProjectFolder,
    type ProjectFolder,
} from '@ai-harness/contracts'
import { requestChatResponse } from './chat-client'

/**
 * Requests an authenticated personal project folder resource.
 * @param path - Fixed resource path under the folder collection.
 * @param options - Request method, payload and optional cancellation signal.
 * @returns The untrusted successful JSON response.
 * @throws Error when authentication, persistence or transport fails.
 */
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await requestChatResponse(`/project-folders${path}`, options)
    let value: unknown
    try {
        value = await response.json()
    } catch {
        throw new Error('暂时无法读取项目，请稍后重试。')
    }
    if (!response.ok) {
        if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') throw new Error(value.message)
        throw new Error('暂时无法读取项目，请稍后重试。')
    }
    return value
}

/**
 * Lists only the authenticated user's personal project folders.
 * @param signal - Optional navigation cancellation signal.
 * @returns Validated folders in server order.
 * @throws Error when the collection is inaccessible or malformed.
 */
export async function listProjectFolders(signal?: AbortSignal): Promise<ProjectFolder[]> {
    const value = await request('', { signal })
    const parsed = projectFoldersSchema.safeParse(value)
    if (!parsed.success) throw new Error('项目列表格式无效，请重新载入。')
    return parsed.data.projects
}

/**
 * Reads a saved personal project without opening a conversation.
 * @param id - Stable project folder identifier.
 * @param signal - Optional navigation cancellation signal.
 * @returns The validated project folder.
 * @throws Error when inaccessible or malformed.
 */
export async function getProjectFolder(id: string, signal?: AbortSignal): Promise<ProjectFolder> {
    return projectFolderSchema.parse(await request(`/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Creates one personal folder using the retained idempotent creation action.
 * @param input - Name and stable creation request identifier.
 * @param signal - Optional request cancellation signal.
 * @returns The folder confirmed by the server.
 * @throws Error when validation or persistence fails.
 */
export async function createProjectFolder(input: CreateProjectFolder, signal?: AbortSignal): Promise<ProjectFolder> {
    return projectFolderSchema.parse(
        await request('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createProjectFolderSchema.parse(input)),
            signal,
        })
    )
}
