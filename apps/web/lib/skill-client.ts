import {
    createSkillSchema,
    updateSkillSchema,
    skillRecordSchema,
    skillSummarySchema,
    skillVersionSummarySchema,
    type CreateSkill,
    type UpdateSkill,
} from '@ai-harness/contracts'
import { requestChatResponse } from './chat-client'

/**
 * Requests a private skill resource with the verified browser workspace expectation.
 * @param path - Fixed skill resource suffix.
 * @param options - Read cancellation or explicit JSON mutation options.
 * @returns Untrusted JSON for shared-contract validation.
 * @throws Error with status when permission, concurrency, or storage rejects the request.
 */
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await requestChatResponse(`/skills${path}`, { cache: 'no-store', ...options })
    if (!response.ok) {
        let message = `技能服务请求失败（${response.status}），输入已保留，请重试。`
        try {
            const body = await response.json()
            if (typeof body?.message === 'string') message = body.message
        } catch {
            /* A failed proxy may return a non-JSON response. */
        }
        throw Object.assign(new Error(message), { status: response.status })
    }
    return response.json()
}

/**
 * Reads summaries without fetching or implying access to another person's skill bodies.
 * @param signal - Optional lifecycle cancellation.
 * @returns The real private skill collection.
 * @throws Error for unavailable or malformed collections instead of returning a false empty library.
 */
export async function listSkills(signal?: AbortSignal) {
    const value = await request('', { signal })
    if (!value || typeof value !== 'object' || !('skills' in value)) throw new Error('技能列表返回无效，请重新载入。')
    return skillSummarySchema.array().parse(value.skills)
}

/**
 * Reads the exact owned skill, optionally at an immutable historical version.
 * @param id - Stable private skill identity.
 * @param version - Explicit immutable version, or current when omitted.
 * @param signal - Optional lifecycle cancellation.
 * @returns The authorized complete literal Markdown record.
 * @throws Error for missing, inaccessible, or unavailable records.
 */
export async function getSkill(id: string, version?: number, signal?: AbortSignal) {
    return skillRecordSchema.parse(
        await request(`/${encodeURIComponent(id)}${version === undefined ? '' : `/versions/${version}`}`, { signal })
    )
}

/**
 * Reads immutable version summaries for one authorized private skill.
 * @param id - Stable skill identity.
 * @param signal - Optional lifecycle cancellation.
 * @returns Real version summaries sorted by their caller as needed.
 * @throws Error for invalid or unavailable history.
 */
export async function listSkillVersions(id: string, signal?: AbortSignal) {
    const value = await request(`/${encodeURIComponent(id)}/versions`, { signal })
    if (!value || typeof value !== 'object' || !('versions' in value)) throw new Error('技能版本记录返回无效，请重试。')
    return skillVersionSummarySchema.array().parse(value.versions)
}

/**
 * Creates one private skill using a retained action identifier for safe retry.
 * @param input - Human-authored literal text and creation action identity.
 * @returns The committed immutable first version.
 * @throws Error for invalid input, conflicting replay, or storage failure.
 */
export async function createSkill(input: CreateSkill) {
    return skillRecordSchema.parse(
        await request('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createSkillSchema.parse(input)),
        })
    )
}

/**
 * Saves one new version against the explicitly read baseline.
 * @param id - Stable owned skill identity.
 * @param input - Full text, expected version, and retained update action identity.
 * @returns The exact committed version, including on a matching retry.
 * @throws Error for stale versions, changed replay parameters, or storage failure.
 */
export async function updateSkill(id: string, input: UpdateSkill) {
    return skillRecordSchema.parse(
        await request(`/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateSkillSchema.parse(input)),
        })
    )
}
