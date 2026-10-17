import { createProjectSchema, projectInputSchema, type PersonalProject, type ProjectDetail } from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common'
import type { ChatRequest } from './auth.js'
import { ChatService } from './chat-service.js'

/**
 * Validate stable project route identifiers before scoped persistence.
 * @param id - Untrusted route identifier.
 * @returns A valid UUID identifying one project.
 * @throws BadRequestException for malformed identifiers.
 */
function projectId(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        throw new BadRequestException('项目标识无效。')
    return id
}

/** Authenticated personal-project management using the shared task coordinator. */
@Controller('chat/projects')
export class ProjectController {
    /**
     * Retain the process-owned project and task coordinator.
     * @param service - Shared scoped persistence and task mutation coordinator.
     */
    constructor(@Inject(ChatService) private readonly service: ChatService) {}

    /**
     * List real projects within the current authenticated ownership scope.
     * @param request - Request authenticated by the shared application guard.
     * @returns Only public project fields without internal creation parameters.
     */
    @Get()
    async list(@Req() request: ChatRequest): Promise<{ projects: PersonalProject[] }> {
        return { projects: await this.service.listProjects(request.chatScope) }
    }

    /**
     * Create or replay a project without executing a model.
     * @param request - Request with trusted user and workspace context.
     * @param body - Untrusted creation fields and idempotent action identifier.
     * @returns The created project or its current record on a matching replay.
     * @throws BadRequestException for invalid input.
     * @throws ConflictException for concurrent or mismatched creation actions.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: unknown): Promise<PersonalProject> {
        const parsed = createProjectSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请填写有效的项目名称、说明和请求标识。')
        return this.service.createProject(request.chatScope, parsed.data)
    }

    /**
     * Read a stable project address and its live task snapshots.
     * @param request - Request with trusted user and workspace context.
     * @param id - Untrusted stable project identifier.
     * @returns The owned project and its currently associated tasks.
     * @throws BadRequestException for malformed identifiers.
     * @throws NotFoundException for nonexistent or inaccessible projects.
     */
    @Get(':id')
    get(@Req() request: ChatRequest, @Param('id') id: string): Promise<ProjectDetail> {
        return this.service.getProject(request.chatScope, projectId(id))
    }

    /**
     * Save project management fields while preserving identity and task membership.
     * @param request - Request with trusted user and workspace context.
     * @param id - Untrusted stable project identifier.
     * @param body - Untrusted replacement name and description.
     * @returns The saved public project record.
     * @throws BadRequestException for malformed identifiers or fields.
     * @throws NotFoundException for nonexistent or inaccessible projects.
     * @throws ConflictException for concurrent project writes.
     */
    @Put(':id')
    update(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<PersonalProject> {
        const ownedId = projectId(id)
        const parsed = projectInputSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请填写有效的项目名称和说明。')
        return this.service.updateProject(request.chatScope, ownedId, parsed.data)
    }
}
