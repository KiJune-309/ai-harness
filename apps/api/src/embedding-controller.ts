import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, Res, BadRequestException } from '@nestjs/common'
import type { Response } from 'express'
import type { CreateEmbeddingModel, UpdateEmbeddingModel } from '@ai-harness/contracts'
import type { ChatRequest } from './auth.js'
import { EmbeddingService } from './embedding-service.js'

/**
 * Rejects malformed route identifiers before any persistence operation.
 * @param value - Untrusted UUID route segment.
 * @returns The validated original identifier.
 * @throws BadRequestException for invalid syntax.
 */
export function embeddingRouteId(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
        throw new BadRequestException('向量连接或资料标识无效。')
    return value
}
/**
 * Cancels only a synchronous provider operation when its response is abandoned.
 * @param response - Authenticated HTTP response.
 * @param operation - Explicit test or query, never a durable background index job.
 * @returns The operation's actual result after releasing response listeners.
 */
export async function withEmbeddingDisconnect<T>(response: Response, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    /**
     * Signals cancellation when the caller is no longer consuming its response.
     * @returns Nothing after updating the request-owned cancellation signal.
     */
    function disconnect(): void {
        if (!response.writableEnded) controller.abort()
    }
    response.once('close', disconnect)
    try {
        return await operation(controller.signal)
    } finally {
        response.off('close', disconnect)
    }
}

/**
 * Authenticated independent embedding configuration and explicit real-provider verification.
 */
@Controller('account/embedding-models')
export class EmbeddingController {
    /**
     * Retains the process-owned independent embedding authority.
     * @param service - Private credential, metadata, and test coordinator.
     */
    constructor(@Inject(EmbeddingService) private readonly service: EmbeddingService) {}
    /**
     * Lists only this owner's safe embedding metadata.
     * @param request - Authenticated account and workspace.
     * @returns Public embedding configurations without keys or ciphertext.
     */
    @Get()
    async list(@Req() request: ChatRequest) {
        return { models: await this.service.list(request.chatScope) }
    }
    /**
     * Creates or replays an encrypted connection without calling the provider.
     * @param request - Authenticated account and workspace.
     * @param body - Strict creation fields and stable action UUID.
     * @returns Authoritative safe connection metadata.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: CreateEmbeddingModel) {
        return this.service.create(request.chatScope, body)
    }
    /**
     * Reads one owned configuration by its stable route UUID.
     * @param request - Authenticated account and workspace.
     * @param id - Untrusted model route identifier.
     * @returns Public metadata or a uniform absent/foreign error.
     */
    @Get(':id')
    get(@Req() request: ChatRequest, @Param('id') id: string) {
        return this.service.get(request.chatScope, embeddingRouteId(id))
    }
    /**
     * Updates only a confirmed current revision and keeps a blank key unchanged.
     * @param request - Authenticated account and workspace.
     * @param id - Untrusted model route identifier.
     * @param body - Strict replacement fields with expected revision.
     * @returns Authoritative public updated metadata.
     */
    @Put(':id')
    update(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: UpdateEmbeddingModel) {
        return this.service.update(request.chatScope, embeddingRouteId(id), body)
    }
    /**
     * Selects the one independent embedding default without provider calls.
     * @param request - Authenticated account and workspace.
     * @param id - Untrusted model route identifier.
     * @returns Selected safe metadata.
     */
    @Post(':id/default')
    setDefault(@Req() request: ChatRequest, @Param('id') id: string) {
        return this.service.setDefault(request.chatScope, embeddingRouteId(id))
    }
    /**
     * Deletes an owned connection while preventing its old creation action from reviving it.
     * @param request - Authenticated account and workspace.
     * @param id - Untrusted model route identifier.
     * @returns Success only after actual persistent deletion.
     */
    @Delete(':id')
    async delete(@Req() request: ChatRequest, @Param('id') id: string): Promise<{ success: true }> {
        await this.service.delete(request.chatScope, embeddingRouteId(id))
        return { success: true }
    }
    /**
     * Explicitly verifies two fixed texts through the real bounded embedding adapter.
     * @param request - Authenticated account and workspace.
     * @param id - Untrusted saved model route identifier.
     * @param response - Response used solely for disconnect cancellation.
     * @returns Safe actual model and dimension verification metadata.
     */
    @Post(':id/test')
    test(@Req() request: ChatRequest, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
        return withEmbeddingDisconnect(response, signal => this.service.test(request.chatScope, embeddingRouteId(id), signal))
    }
}
