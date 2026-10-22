import { knowledgeIndexActionSchema, knowledgeSearchSchema } from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import type { ChatRequest } from './auth.js'
import { embeddingRouteId, withEmbeddingDisconnect } from './embedding-controller.js'
import { VectorService } from './vector-service.js'

/**
 * Explicit indexing and source-backed cosine retrieval, independent of the existing chat runtime.
 */
@Controller('knowledge')
export class VectorController {
    /**
     * Retains the process-owned durable vector coordinator.
     * @param service - Persistent index and explicit retrieval coordinator.
     */
    constructor(@Inject(VectorService) private readonly service: VectorService) {}
    /**
     * Reports real vector database capability and this user's current default.
     * @param request - Authenticated account and workspace.
     * @returns Safe actual capability without provider calls.
     */
    @Get('vector-status')
    status(@Req() request: ChatRequest) {
        return this.service.status(request.chatScope)
    }
    /**
     * Reads one owned source's independent indexing state.
     * @param request - Authenticated account and workspace.
     * @param id - Untrusted document UUID.
     * @returns Real generation and persistent progress or truthful none/stale state.
     */
    @Get('documents/:id/index')
    index(@Req() request: ChatRequest, @Param('id') id: string) {
        return this.service.index(request.chatScope, embeddingRouteId(id))
    }
    /**
     * Starts an explicitly confirmed new index generation without waiting for provider processing.
     * @param request - Authenticated account and workspace.
     * @param id - Untrusted document UUID.
     * @param body - Stable action and confirmed current default identity.
     * @returns Persisted queued or matching replay state.
     * @throws BadRequestException when input is malformed.
     */
    @Post('documents/:id/index')
    start(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        const parsed = knowledgeIndexActionSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请重新确认默认向量模型并提交有效索引操作。')
        return this.service.start(request.chatScope, embeddingRouteId(id), parsed.data)
    }
    /**
     * Retries only a failed generation still compatible with the confirmed current default.
     * @param request - Authenticated account and workspace.
     * @param id - Untrusted document UUID.
     * @param body - Stable retry action and confirmed default identity.
     * @returns Durable same-generation resumed state.
     * @throws BadRequestException when input is malformed.
     */
    @Post('documents/:id/index/retry')
    retry(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        const parsed = knowledgeIndexActionSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('请重新确认默认向量模型并提交有效重试操作。')
        return this.service.start(request.chatScope, embeddingRouteId(id), parsed.data, true)
    }
    /**
     * Performs one explicit query embedding and true scoped SQL cosine search without generating an answer.
     * @param request - Authenticated account and workspace.
     * @param body - Strict bounded query, Top K, and optional owned document filter.
     * @param response - Response used to cancel synchronous provider work on disconnect.
     * @returns Complete original source hits and real cosine distances.
     * @throws BadRequestException when query fields are invalid.
     */
    @Post('search')
    search(@Req() request: ChatRequest, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
        const parsed = knowledgeSearchSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('查询须为 1–2000 个字符，Top K 须为 1–20。')
        return withEmbeddingDisconnect(response, signal => this.service.search(request.chatScope, parsed.data, signal))
    }
}
