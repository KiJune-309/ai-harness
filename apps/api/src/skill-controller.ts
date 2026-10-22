import {
    createSkillSchema,
    updateSkillSchema,
    skillRefSchema,
    type SkillRecord,
    type SkillSummary,
    type SkillVersionSummary,
} from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common'
import type { ChatRequest } from './auth.js'
import { SkillService } from './skill-service.js'

/**
 * Validates and canonicalizes a public private-skill route identity.
 * @param id - Untrusted stable UUID.
 * @returns A canonical skill UUID.
 * @throws BadRequestException for malformed identifiers.
 */
function skillId(id: string): string {
    const parsed = skillRefSchema.shape.skillId.safeParse(id)
    if (!parsed.success) throw new BadRequestException('技能标识无效。')
    return parsed.data
}

/**
 * Validates an exact immutable historical version without permissive numeric parsing.
 * @param version - Untrusted route segment.
 * @returns A positive safe integer version.
 * @throws BadRequestException for invalid historical versions.
 */
function skillVersion(version: string): number {
    const value = Number(version)
    if (!/^[1-9][0-9]*$/.test(version) || !Number.isSafeInteger(value)) throw new BadRequestException('技能版本无效。')
    return value
}

/** Exposes only authenticated human-owned skill records and immutable history. */
@Controller('chat/skills')
export class SkillController {
    /**
     * Receives the process-owned durable skill coordinator.
     * @param service - Scoped private skill service.
     */
    constructor(@Inject(SkillService) private readonly service: SkillService) {}

    /**
     * Lists only current owned summaries in the authenticated selected workspace.
     * @param request - Persistently authenticated request.
     * @returns Private summary directory without full bodies.
     */
    @Get()
    async list(@Req() request: ChatRequest): Promise<{ skills: SkillSummary[] }> {
        return { skills: await this.service.list(request.chatScope) }
    }

    /**
     * Creates one human-authored version without model or network execution.
     * @param request - Persistently authenticated owner.
     * @param body - Untrusted strict text and creation action.
     * @returns The exact original committed version.
     * @throws BadRequestException for unknown or malformed fields.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: unknown): Promise<SkillRecord> {
        const parsed = createSkillSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '技能格式不正确。')
        return this.service.create(request.chatScope, parsed.data)
    }

    /**
     * Reads complete current text only for the real owner and workspace.
     * @param request - Persistently authenticated owner.
     * @param id - Untrusted skill identity.
     * @returns The current private immutable record.
     */
    @Get(':id')
    get(@Req() request: ChatRequest, @Param('id') id: string): Promise<SkillRecord> {
        return this.service.get(request.chatScope, skillId(id))
    }

    /**
     * Saves one new immutable version against a previously read revision.
     * @param request - Persistently authenticated owner.
     * @param id - Untrusted skill identity.
     * @param body - Complete replacement fields, expected version and stable action.
     * @returns The exact original committed new version.
     * @throws BadRequestException for malformed public fields.
     */
    @Put(':id')
    update(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<SkillRecord> {
        const parsed = updateSkillSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '技能格式不正确。')
        return this.service.update(request.chatScope, skillId(id), parsed.data)
    }

    /**
     * Lists all retained immutable version summaries under the same ownership guard.
     * @param request - Persistently authenticated owner.
     * @param id - Untrusted skill identity.
     * @returns Newest-first private version metadata.
     */
    @Get(':id/versions')
    async versions(@Req() request: ChatRequest, @Param('id') id: string): Promise<{ versions: SkillVersionSummary[] }> {
        return { versions: await this.service.versions(request.chatScope, skillId(id)) }
    }

    /**
     * Reads an exact historical body without upgrading or altering any existing binding.
     * @param request - Persistently authenticated owner.
     * @param id - Untrusted skill identity.
     * @param version - Exact positive immutable revision.
     * @returns The complete private historical record.
     */
    @Get(':id/versions/:version')
    version(@Req() request: ChatRequest, @Param('id') id: string, @Param('version') version: string): Promise<SkillRecord> {
        return this.service.get(request.chatScope, skillId(id), skillVersion(version))
    }
}
