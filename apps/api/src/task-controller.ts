import {
    cancelChatMessageSchema,
    createTaskSchema,
    sendChatMessageSchema,
    updateTaskProjectSchema,
    updateTaskStatusSchema,
    type ChatStreamEvent,
    type PersonalTask,
    type SendChatMessage,
} from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import type { ChatRequest } from './auth.js'
import { ChatService } from './chat-service.js'
import { LegacyProjectsRetiredGuard, throwLegacyProjectRetired } from './legacy-project-policy.js'

/**
 * Validate stable task identifiers before they reach scoped persistence.
 * @param id - Untrusted route identifier.
 * @returns A valid UUID identifying one task.
 * @throws BadRequestException when the supplied identifier is malformed.
 */
function taskId(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        throw new BadRequestException('任务标识无效。')
    return id
}

/** Authenticated personal-task endpoints sharing the application's scoped chat coordinator. */
@Controller('chat/tasks')
export class TaskController {
    /**
     * Receive the process-owned coordinator through an explicit Nest injection token.
     * @param service - Shared task, storage and Cordis execution coordinator.
     */
    constructor(@Inject(ChatService) private readonly service: ChatService) {}

    /**
     * List real tasks owned by the current identity.
     * @param request - Request authenticated by the application guard.
     * @returns Only complete personal tasks within its trusted ownership scope.
     */
    @Get()
    async list(@Req() request: ChatRequest): Promise<{ tasks: PersonalTask[] }> {
        return { tasks: await this.service.listTasks(request.chatScope) }
    }

    /**
     * Persist a complete personal task without starting model execution.
     * @param request - Authenticated request with trusted ownership context.
     * @param body - Untrusted creation fields and idempotent request identifier.
     * @returns The created task, or its original snapshot on a matching retry.
     * @throws BadRequestException for invalid creation fields.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: unknown): Promise<PersonalTask> {
        const parsed = createTaskSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请填写有效的任务名称、目标和请求标识。')
        if (parsed.data.projectId) throwLegacyProjectRetired()
        return this.service.createTask(request.chatScope, parsed.data)
    }

    /**
     * Load a stable task address within the authenticated ownership scope.
     * @param request - Authenticated request with trusted ownership context.
     * @param id - Untrusted stable task UUID.
     * @returns The complete task, frozen Agent, work state and recorded messages.
     * @throws BadRequestException for malformed task identifiers.
     * @throws NotFoundException for absent or inaccessible tasks.
     */
    @Get(':id')
    get(@Req() request: ChatRequest, @Param('id') id: string): Promise<PersonalTask> {
        return this.service.getTask(request.chatScope, taskId(id))
    }

    /**
     * Move an owned task to an owned project or remove its current membership.
     * @param request - Authenticated request with trusted ownership context.
     * @param id - Untrusted stable task identifier.
     * @param body - Untrusted target project identifier or explicit null.
     * @returns The latest saved task without changing its conversation context.
     * @throws BadRequestException for malformed identifiers or membership input.
     * @throws NotFoundException when either side is nonexistent or inaccessible.
     * @throws ConflictException during generation or concurrent task mutations.
     */
    @Put(':id/project')
    @UseGuards(LegacyProjectsRetiredGuard)
    project(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<PersonalTask> {
        const ownedId = taskId(id)
        const parsed = updateTaskProjectSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('项目归属格式不正确。')
        return this.service.updateTaskProject(request.chatScope, ownedId, parsed.data)
    }

    /**
     * Save an explicit work state or restore the state retained before completion.
     * @param request - Authenticated request with trusted ownership context.
     * @param id - Untrusted stable task UUID.
     * @param body - Untrusted status action.
     * @returns The saved task snapshot after the state action succeeds.
     * @throws BadRequestException for malformed identifiers or status actions.
     * @throws ConflictException while the task is generating a response.
     */
    @Put(':id/status')
    status(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<PersonalTask> {
        const ownedId = taskId(id)
        const parsed = updateTaskStatusSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('任务状态格式不正确。')
        return this.service.updateTaskStatus(request.chatScope, ownedId, parsed.data)
    }

    /**
     * Explicitly start a task by streaming the stored goal as its initial user turn.
     * @param request - Authenticated request with trusted ownership context.
     * @param response - Raw streaming HTTP response.
     * @param id - Untrusted stable task UUID.
     * @param body - Untrusted idempotent start request identifier.
     * @returns After the accepted goal turn is settled and the stream has closed.
     * @throws BadRequestException for malformed identifiers or request bodies.
     */
    @Post(':id/start')
    start(@Req() request: ChatRequest, @Res() response: Response, @Param('id') id: string, @Body() body: unknown): Promise<void> {
        const ownedId = taskId(id)
        const parsed = cancelChatMessageSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('开始请求的格式不正确。')
        return this.stream(request, response, ownedId, parsed.data)
    }

    /**
     * Stream a supplementary message within an already-started, unfinished task.
     * @param request - Authenticated request with trusted ownership context.
     * @param response - Raw streaming HTTP response.
     * @param id - Untrusted stable task UUID.
     * @param body - Untrusted supplementary message and idempotent identifier.
     * @returns After the accepted message settles and the stream has closed.
     * @throws BadRequestException for malformed identifiers or message bodies.
     */
    @Post(':id/messages')
    send(@Req() request: ChatRequest, @Res() response: Response, @Param('id') id: string, @Body() body: unknown): Promise<void> {
        const ownedId = taskId(id)
        const parsed = sendChatMessageSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请输入 1 到 32000 字的补充消息，并提供有效的请求标识。')
        return this.stream(request, response, ownedId, parsed.data)
    }

    /**
     * Stop the exact active task turn and await its saved partial response.
     * @param request - Authenticated request with trusted ownership context.
     * @param id - Untrusted stable task UUID.
     * @param body - Untrusted idempotent identifier of the turn to stop.
     * @returns The settled task snapshot, preserving its explicit work state.
     * @throws BadRequestException for malformed identifiers or cancellation bodies.
     */
    @Post(':id/cancel')
    cancel(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<PersonalTask> {
        const ownedId = taskId(id)
        const parsed = cancelChatMessageSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('停止请求的格式不正确。')
        return this.service.cancelTask(request.chatScope, ownedId, parsed.data.requestId)
    }

    /**
     * Connect an authorized task execution to a non-buffered, disconnect-aware SSE response.
     * @param request - Authenticated request with trusted ownership context.
     * @param response - Raw streaming HTTP response.
     * @param id - Validated stable task identifier.
     * @param input - Validated start identifier or supplementary user message.
     * @returns After execution settles and heartbeat and disconnect listeners are removed.
     * @throws HttpException for pre-stream ownership, configuration or lifecycle refusals.
     */
    private async stream(
        request: ChatRequest,
        response: Response,
        id: string,
        input: SendChatMessage | { requestId: string }
    ): Promise<void> {
        const controller = new AbortController()
        let heartbeat: ReturnType<typeof setInterval> | undefined
        /**
         * Cancel provider work when the response consumer disconnects.
         * @returns Nothing after signalling cancellation.
         */
        function disconnect(): void {
            if (!response.writableEnded) controller.abort()
        }
        /**
         * Keep an accepted stream alive while waiting for provider output.
         * @returns Nothing when the response is already closed.
         */
        function keepAlive(): void {
            if (!response.destroyed && !response.writableEnded) response.write(': keep-alive\n\n')
        }
        /**
         * Initialize SSE headers once and publish one safe application event.
         * @param event - Public task execution event.
         * @returns Nothing when the response consumer has disconnected.
         */
        function emit(event: ChatStreamEvent): void {
            if (response.destroyed || response.writableEnded) return
            if (!response.headersSent) {
                response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
                response.setHeader('Cache-Control', 'no-cache, no-transform')
                response.setHeader('X-Accel-Buffering', 'no')
                response.flushHeaders()
                heartbeat = setInterval(keepAlive, 15000)
            }
            response.write(`data: ${JSON.stringify(event)}\n\n`)
        }
        response.on('close', disconnect)
        try {
            if ('content' in input) await this.service.sendTask(request.chatScope, id, input, controller.signal, emit)
            else await this.service.startTask(request.chatScope, id, input.requestId, controller.signal, emit)
            if (!response.destroyed) response.end()
        } catch (error) {
            if (!response.headersSent) throw error
            emit({ type: 'error', message: '任务服务暂时不可用，请稍后重试。' })
            if (!response.destroyed) response.end()
        } finally {
            if (heartbeat) clearInterval(heartbeat)
            response.off('close', disconnect)
        }
    }
}
