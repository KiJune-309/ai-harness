import {
    createTemplateSchema,
    launchTemplateSchema,
    updateTemplateSchema,
    type ProjectTemplate,
    type TemplateLaunchResult,
} from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common'
import type { ChatRequest } from './auth.js'
import { ChatService } from './chat-service.js'

/**
 * Validate template route identifiers before scoped persistence.
 * @param id - Untrusted identifier from a route parameter.
 * @returns A valid stable UUID.
 * @throws BadRequestException for malformed identifiers.
 */
function templateId(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        throw new BadRequestException('模板标识无效。')
    return id
}

/** Authenticated personal task templates sharing the existing execution and storage coordinator. */
@Controller('chat/templates')
export class TemplateController {
    /**
     * Receive the existing process-owned task and project coordinator.
     * @param service - Shared scoped template persistence and instance creation service.
     */
    constructor(@Inject(ChatService) private readonly service: ChatService) {}

    /**
     * List actual templates within the trusted ownership scope.
     * @param request - Request authenticated by the application guard.
     * @returns Public template records without internal creation or launch actions.
     */
    @Get()
    async list(@Req() request: ChatRequest): Promise<{ templates: ProjectTemplate[] }> {
        return { templates: await this.service.listTemplates(request.chatScope) }
    }

    /**
     * Create or replay one saved ordered task blueprint.
     * @param request - Authenticated request containing trusted ownership context.
     * @param body - Untrusted template fields and stable creation action.
     * @returns The saved current template revision.
     * @throws BadRequestException for malformed input.
     * @throws HttpException for ownership or concurrent action refusals.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: unknown): Promise<ProjectTemplate> {
        const parsed = createTemplateSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请填写有效的模板名称、任务和请求标识。')
        return this.service.createTemplate(request.chatScope, parsed.data)
    }

    /**
     * Read the current template for editing and launch preview.
     * @param request - Authenticated request containing trusted ownership context.
     * @param id - Untrusted stable template identifier.
     * @returns The current public template.
     * @throws BadRequestException for malformed identifiers.
     * @throws NotFoundException for absent or inaccessible templates.
     */
    @Get(':id')
    get(@Req() request: ChatRequest, @Param('id') id: string): Promise<ProjectTemplate> {
        return this.service.getTemplate(request.chatScope, templateId(id))
    }

    /**
     * Save a full ordered blueprint against the editor's expected version.
     * @param request - Authenticated request containing trusted ownership context.
     * @param id - Untrusted stable template identifier.
     * @param body - Untrusted replacement fields and expected revision.
     * @returns The saved next template revision.
     * @throws BadRequestException for malformed fields or identifiers.
     * @throws HttpException for ownership or version conflicts.
     */
    @Put(':id')
    update(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<ProjectTemplate> {
        const ownedId = templateId(id)
        const parsed = updateTemplateSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请填写有效的模板内容和版本。')
        return this.service.updateTemplate(request.chatScope, ownedId, parsed.data)
    }

    /**
     * Atomically create a personal project and independent tasks without model execution.
     * @param request - Authenticated request containing trusted ownership context.
     * @param id - Untrusted stable template identifier.
     * @param body - Untrusted launch identifier, preview version and new project fields.
     * @returns The current original project and original ordered task identifiers.
     * @throws BadRequestException for malformed fields or identifiers.
     * @throws HttpException for ownership, storage availability or version conflicts.
     */
    @Post(':id/launch')
    launch(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<TemplateLaunchResult> {
        const ownedId = templateId(id)
        const parsed = launchTemplateSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请填写有效的项目名称、说明、模板版本和启动标识。')
        return this.service.launchTemplate(request.chatScope, ownedId, parsed.data)
    }
}
