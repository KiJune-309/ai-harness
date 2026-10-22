import {
    cancelChatMessageSchema,
    createConversationSchema,
    sendChatMessageSchema,
    humanDecisionActionSchema,
    type ChatConversation,
    type ChatStatus,
    type ChatStreamEvent,
} from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import type { ChatRequest } from './auth.js'
import { ChatService } from './chat-service.js'

/**
 * Validate conversation identifiers before they reach storage.
 * @param id - Route identifier supplied by the caller.
 * @returns A valid UUID.
 * @throws BadRequestException for malformed identifiers.
 */
function conversationId(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        throw new BadRequestException('对话标识无效。')
    return id
}

/** Authorized chat endpoints; provider credentials never enter this surface. */
@Controller('chat')
export class ChatController {
    /**
     * Receive the initialized application service through an explicit Nest token.
     * @param service - Shared chat coordinator.
     */
    constructor(@Inject(ChatService) private readonly service: ChatService) {}

    /**
     * Return the model connection state for the signed browser session.
     * @param request - Request with a validated account session.
     * @returns Safe public configuration state.
     */
    @Get('status')
    status(@Req() request: ChatRequest): Promise<ChatStatus> {
        return this.service.statusFor(request.chatScope)
    }

    /**
     * List the current identity's authorized conversations.
     * @param request - Request authenticated by ChatGuard.
     * @returns Only conversations belonging to its trusted scope.
     */
    @Get('conversations')
    async list(@Req() request: ChatRequest): Promise<{ conversations: ChatConversation[] }> {
        return { conversations: await this.service.list(request.chatScope) }
    }

    /**
     * Create a conversation after validating its public input.
     * @param request - Authenticated request.
     * @param body - Untrusted JSON input.
     * @returns A newly persisted conversation.
     * @throws BadRequestException for invalid input.
     */
    @Post('conversations')
    create(@Req() request: ChatRequest, @Body() body: unknown): Promise<ChatConversation> {
        const parsed = createConversationSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('对话标题格式不正确。')
        return this.service.create(request.chatScope, parsed.data.title, parsed.data.agentId, {
            projectFolderId: parsed.data.projectFolderId,
            requestId: parsed.data.requestId,
        })
    }

    /**
     * Load one conversation through its ownership scope.
     * @param request - Authenticated request.
     * @param id - Untrusted route UUID.
     * @returns The caller-owned conversation.
     */
    @Get('conversations/:id')
    get(@Req() request: ChatRequest, @Param('id') id: string): Promise<ChatConversation> {
        return this.service.get(request.chatScope, conversationId(id))
    }

    /**
     * Deletes only the authenticated owner's ordinary conversation.
     * @param request - Request with verified account and workspace authorization.
     * @param id - Untrusted exact conversation UUID.
     * @returns The durable deletion receipt without any removed private content.
     * @throws BadRequestException for a malformed conversation identity.
     */
    @Delete('conversations/:id')
    remove(@Req() request: ChatRequest, @Param('id') id: string): Promise<{ id: string; deleted: true }> {
        return this.service.remove(request.chatScope, conversationId(id))
    }

    /**
     * Cancel only the identified live turn and await its saved partial output.
     * @param request - Authenticated request.
     * @param id - Untrusted conversation UUID.
     * @param body - Untrusted idempotency key.
     * @returns The settled conversation snapshot.
     * @throws BadRequestException for malformed input.
     */
    @Post('conversations/:id/cancel')
    cancel(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<ChatConversation> {
        const parsed = cancelChatMessageSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('停止请求的格式不正确。')
        return this.service.cancel(request.chatScope, conversationId(id), parsed.data.requestId)
    }

    /**
     * Apply an authenticated human decision to the exact persisted preview.
     * @param request - Request authenticated by the account and workspace guard.
     * @param id - Private source conversation identity.
     * @param requestId - Immutable human request identity.
     * @param body - Untrusted decision, expected version and retry identity.
     * @returns The private current conversation after the decision commits.
     * @throws BadRequestException for malformed identities or action fields.
     */
    @Post('conversations/:id/human-requests/:requestId/decisions')
    decideHuman(
        @Req() request: ChatRequest,
        @Param('id') id: string,
        @Param('requestId') requestId: string,
        @Body() body: unknown
    ): Promise<ChatConversation> {
        const parsed = humanDecisionActionSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('人工决定的格式不正确，请刷新当前请求后重试。')
        return this.service.decideHuman(request.chatScope, conversationId(id), conversationId(requestId), parsed.data)
    }

    /**
     * Stream one Cordis turn and cancel provider work when the response closes.
     * @param request - Authenticated request with validated ownership claims.
     * @param response - Raw streaming HTTP response.
     * @param id - Untrusted conversation UUID.
     * @param body - Untrusted prompt and idempotency key.
     * @returns After the stream has settled and all request observers are removed.
     * @throws BadRequestException for malformed input before SSE headers are sent.
     */
    @Post('conversations/:id/messages')
    async send(@Req() request: ChatRequest, @Res() response: Response, @Param('id') id: string, @Body() body: unknown): Promise<void> {
        const parsed = sendChatMessageSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请输入 1 到 32000 字的问题，并提供有效的请求标识。')
        const ownedId = conversationId(id)
        const controller = new AbortController()
        let heartbeat: ReturnType<typeof setInterval> | undefined
        /**
         * Stop provider generation when the browser no longer consumes the stream.
         * @returns Nothing.
         */
        function disconnect(): void {
            if (!response.writableEnded) controller.abort()
        }
        /**
         * Write a public event after initializing non-buffered SSE headers.
         * @param event - Validated application event.
         * @returns Nothing when the browser has disconnected.
         */
        function emit(event: ChatStreamEvent): void {
            if (response.destroyed || response.writableEnded) return
            if (!response.headersSent) {
                response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
                response.setHeader('Cache-Control', 'no-cache, no-transform')
                response.setHeader('X-Accel-Buffering', 'no')
                response.flushHeaders()
                heartbeat = setInterval(() => {
                    if (!response.destroyed && !response.writableEnded) response.write(': keep-alive\n\n')
                }, 15000)
            }
            response.write(`data: ${JSON.stringify(event)}\n\n`)
        }
        response.on('close', disconnect)
        try {
            await this.service.send(request.chatScope, ownedId, parsed.data, controller.signal, emit)
            if (!response.destroyed) response.end()
        } catch (error) {
            if (!response.headersSent) throw error
            emit({ type: 'error', message: '对话服务暂时不可用，请稍后重试。' })
            if (!response.destroyed) response.end()
        } finally {
            if (heartbeat) clearInterval(heartbeat)
            response.off('close', disconnect)
        }
    }
}
