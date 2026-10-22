import {
    createSkillSchema,
    updateSkillSchema,
    type CreateSkill,
    type UpdateSkill,
    type SkillRecord,
    type SkillSummary,
    type SkillVersionSummary,
} from '@ai-harness/contracts'
import { SkillAccessError, SkillConflictError, SkillValidationError, type ChatScope, type SkillStore } from '@ai-harness/db'
import { BadRequestException, ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'

/**
 * Maps private skill persistence and binding errors without reflecting complete text or database details.
 * @param error - Private repository or validation refusal.
 * @returns Never returns.
 * @throws A bounded authorization, conflict, validation or service-unavailable HTTP exception.
 */
export function skillFailure(error: unknown): never {
    if (error instanceof SkillAccessError) throw new NotFoundException('未找到此技能或技能版本。')
    if (error instanceof SkillConflictError) throw new ConflictException(error.message)
    if (error instanceof SkillValidationError) throw new BadRequestException(error.message)
    if (error instanceof HttpException) throw error
    throw new ServiceUnavailableException('技能服务暂时不可用，请保留输入并用原请求重试。')
}

/** Coordinates human-owned private skill versions without executing their contents. */
export class SkillService {
    /**
     * Retains the shared durable skill repository.
     * @param store - PostgreSQL skill store, optional only for explicit legacy test injection.
     */
    constructor(private readonly store: SkillStore | undefined) {}

    /**
     * Runs one durable skill operation and converts private errors safely.
     * @param action - Scoped repository operation.
     * @returns The committed result.
     * @throws ServiceUnavailableException if persistence is absent or unavailable.
     */
    private async run<T>(action: (store: SkillStore) => Promise<T>): Promise<T> {
        try {
            if (!this.store) throw new ServiceUnavailableException('技能存储尚未连接。')
            return await action(this.store)
        } catch (error) {
            return skillFailure(error)
        }
    }

    /**
     * Lists current private summaries without full bodies.
     * @param scope - Verified owner and selected workspace.
     * @returns Current summaries with stable server ordering.
     */
    list(scope: ChatScope): Promise<SkillSummary[]> {
        return this.run(store => store.list(scope))
    }

    /**
     * Reads the current or an explicitly requested immutable private version.
     * @param scope - Verified owner and selected workspace.
     * @param id - Stable skill identity.
     * @param version - Optional exact historical version.
     * @returns Complete immutable private text.
     * @throws NotFoundException for absent, foreign or unavailable versions.
     */
    get(scope: ChatScope, id: string, version?: number): Promise<SkillRecord> {
        return this.run(async store => {
            const record = await store.get(scope, id, version)
            if (!record) throw new NotFoundException('未找到此技能或技能版本。')
            return record
        })
    }

    /**
     * Lists newest-first version summaries for an owned existing skill.
     * @param scope - Verified owner and selected workspace.
     * @param id - Stable skill identity.
     * @returns Retained version metadata.
     * @throws NotFoundException for a foreign or absent skill.
     */
    versions(scope: ChatScope, id: string): Promise<SkillVersionSummary[]> {
        return this.run(async store => {
            const versions = await store.versions(scope, id)
            if (!versions) throw new NotFoundException('未找到此技能。')
            return versions
        })
    }

    /**
     * Creates or replays one strict normalized private skill.
     * @param scope - Verified real owner and workspace.
     * @param input - Complete human-authored fields and stable creation action.
     * @returns The exact committed first version.
     * @throws BadRequestException for malformed public fields.
     */
    create(scope: ChatScope, input: CreateSkill): Promise<SkillRecord> {
        const parsed = createSkillSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '技能格式不正确。')
        return this.run(store => store.create(scope, parsed.data))
    }

    /**
     * Appends or replays an exact expected-version edit without overwriting history.
     * @param scope - Verified real owner and workspace.
     * @param id - Existing owned skill.
     * @param input - Complete replacement text, version and stable update action.
     * @returns The exact committed new version.
     * @throws BadRequestException for malformed public fields.
     */
    update(scope: ChatScope, id: string, input: UpdateSkill): Promise<SkillRecord> {
        const parsed = updateSkillSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '技能格式不正确。')
        return this.run(store => store.update(scope, id, parsed.data))
    }
}
