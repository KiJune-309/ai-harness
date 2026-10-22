import { createProjectFolderSchema } from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common'
import type { ChatRequest } from './auth.js'
import { ProjectFolderService } from './project-folder-service.js'

/** Authenticated personal project-folder endpoints. */
@Controller('chat/project-folders')
export class ProjectFolderController {
    /**
     * Retains the initialized application folder coordinator.
     * @param service - Scoped persistent folder operations.
     */
    constructor(@Inject(ProjectFolderService) private readonly service: ProjectFolderService) {}

    /**
     * Lists the authenticated owner's private folders.
     * @param request - Identity-validated request.
     * @returns Current project folders.
     */
    @Get()
    async list(@Req() request: ChatRequest) {
        return { projects: await this.service.list(request.chatScope) }
    }

    /**
     * Creates one folder using a durable human action identifier.
     * @param request - Identity-validated request.
     * @param body - Untrusted name and action identifier.
     * @returns The saved folder.
     * @throws BadRequestException for invalid input.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: unknown) {
        const input = createProjectFolderSchema.safeParse(body)
        if (!input.success) throw new BadRequestException('请填写有效的项目名称。')
        return this.service.create(request.chatScope, input.data)
    }

    /**
     * Reads an owned project folder without exposing another owner's records.
     * @param request - Identity-validated request.
     * @param id - Untrusted folder identifier.
     * @returns The authorized folder.
     * @throws BadRequestException for malformed identifiers.
     */
    @Get(':id')
    get(@Req() request: ChatRequest, @Param('id') id: string) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
            throw new BadRequestException('项目标识无效。')
        return this.service.get(request.chatScope, id)
    }
}
