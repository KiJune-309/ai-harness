import {
    createWorkflowTemplateSchema,
    updateWorkflowTemplateSchema,
    createWorkflowPreviewSchema,
    workflowLaunchSchema,
} from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import type { ChatRequest } from './auth.js'
import { WorkflowTemplateService } from './workflow-template-service.js'
import { LegacyProjectsRetiredGuard } from './legacy-project-policy.js'

/**
 * Validates and canonicalizes an untrusted route identity.
 * @param id - Candidate template UUID.
 * @returns A canonical UUID.
 * @throws BadRequestException for a malformed identity.
 */
function identity(id: string): string {
    const result = workflowLaunchSchema.shape.requestId.safeParse(id)
    if (!result.success) throw new BadRequestException('模板标识无效。')
    return result.data
}

/** Provides stable kind-aware discovery without permission or service-error fallback. */
@Controller('chat/template-catalog')
export class TemplateCatalogController {
    /**
     * Receives the existing scoped template coordinator.
     * @param service - Human-owned template service.
     */
    constructor(@Inject(WorkflowTemplateService) private readonly service: WorkflowTemplateService) {}
    /**
     * Reads both kinds in the actual owner's current workspace.
     * @param request - Authenticated request.
     * @returns A typed private template directory.
     */
    @Get()
    list(@Req() request: ChatRequest) {
        return this.service.catalog(request.chatScope)
    }
    /**
     * Reads one exact stable template type and its complete owned record.
     * @param request - Authenticated request.
     * @param id - Untrusted template identity.
     * @returns The typed owned template.
     */
    @Get(':id')
    get(@Req() request: ChatRequest, @Param('id') id: string) {
        return this.service.get(request.chatScope, identity(id))
    }
}

/** Validates human-only workflow editing and immutable complete-preview startup. */
@Controller('chat/workflow-templates')
export class WorkflowTemplateController {
    /**
     * Receives the human-owned workflow coordinator.
     * @param service - Scoped workflow persistence and startup.
     */
    constructor(@Inject(WorkflowTemplateService) private readonly service: WorkflowTemplateService) {}
    /**
     * Creates a complete valid workflow graph.
     * @param request - Authenticated owner.
     * @param body - Untrusted graph and creation action.
     * @returns The saved workflow revision.
     * @throws BadRequestException for invalid fields or graph structure.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: unknown) {
        const parsed = createWorkflowTemplateSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '协作流程不完整。')
        return this.service.create(request.chatScope, parsed.data)
    }
    /**
     * Reads the exact owned workflow type.
     * @param request - Authenticated owner.
     * @param id - Workflow identity.
     * @returns The saved workflow or an explicit type refusal.
     */
    @Get(':id')
    async get(@Req() request: ChatRequest, @Param('id') id: string) {
        const result = await this.service.get(request.chatScope, identity(id))
        if (result.kind !== 'workflow') throw new BadRequestException('此模板是个人清单。')
        return result.template
    }
    /**
     * Replaces the full graph at its explicit expected version.
     * @param request - Authenticated owner.
     * @param id - Saved workflow identity.
     * @param body - Untrusted graph and expected version.
     * @returns The saved next revision.
     * @throws BadRequestException for invalid graph fields.
     */
    @Put(':id')
    update(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        const parsed = updateWorkflowTemplateSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '协作流程不完整。')
        return this.service.update(request.chatScope, identity(id), parsed.data)
    }
    /**
     * Creates a full immutable server preview without creating project work or execution.
     * @param request - Authenticated initiator.
     * @param id - Saved workflow identity.
     * @param body - Expected version, explicit project fields and actual node assignments.
     * @returns Every exact opening, real recipient and full sharing scope.
     */
    @Post(':id/preview')
    @UseGuards(LegacyProjectsRetiredGuard)
    preview(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        const parsed = createWorkflowPreviewSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请填写项目名称、版本和有效的实际处理人。')
        return this.service.preview(request.chatScope, identity(id), parsed.data)
    }
    /**
     * Confirms only the complete immutable preview already reviewed by this owner.
     * @param request - Authenticated human initiator.
     * @param id - Saved workflow identity.
     * @param body - Stable action and exact immutable preview identity.
     * @returns The original atomic shared instance result.
     */
    @Post(':id/launch')
    @UseGuards(LegacyProjectsRetiredGuard)
    launch(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        const parsed = workflowLaunchSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('启动标识或完整预览无效。')
        return this.service.launch(request.chatScope, identity(id), parsed.data)
    }
}
