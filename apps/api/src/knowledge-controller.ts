import { KNOWLEDGE_MAX_FILE_SIZE, knowledgePageQuerySchema, knowledgeRetrySchema, knowledgeUploadSchema } from '@ai-harness/contracts'
import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpException,
    Inject,
    Injectable,
    Param,
    Post,
    Query,
    Req,
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    type CanActivate,
    type ExecutionContext,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import type { ChatRequest } from './auth.js'
import { KnowledgeService } from './knowledge-service.js'

/**
 * Validates stable knowledge identifiers before any scoped database operation.
 * @param id - Untrusted route segment.
 * @returns The original validated UUID.
 * @throws BadRequestException for malformed identifiers.
 */
function documentId(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        throw new BadRequestException('资料标识无效。')
    return id
}

/**
 * Decodes browser UTF-8 multipart filename bytes while preserving already decoded or Latin names.
 * @param original - Filename supplied by the multipart parser's Latin-1 header decoder.
 * @returns A strictly decoded UTF-8 filename or the unchanged original when conversion is invalid.
 */
export function decodeMultipartFileName(original: string): string {
    if ([...original].some(char => char.codePointAt(0)! > 255)) return original
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(original, 'latin1'))
    } catch {
        return original
    }
}

/** Admits bounded authenticated uploads before Multer allocates in-memory file buffers. */
@Injectable()
export class KnowledgeUploadGuard implements CanActivate {
    private active = 0

    /**
     * Retains the configured feature coordinator.
     * @param service - Shared knowledge service checked before reading multipart data.
     */
    constructor(@Inject(KnowledgeService) private readonly service: KnowledgeService) {}

    /**
     * Enforces a process resource limit after global authentication and before file interception.
     * @param context - Authenticated HTTP request and response context.
     * @returns True after allocating an upload slot until the response closes.
     * @throws HttpException when upload capacity is exhausted.
     */
    canActivate(context: ExecutionContext): boolean {
        this.service.assertConfigured()
        if (this.active >= 4) throw new HttpException('同时上传的资料过多，请等待当前上传完成后重试。', 429)
        this.active++
        const response = context.switchToHttp().getResponse<Response>()
        let released = false
        /**
         * Releases one upload slot exactly once for success, rejection, or disconnect.
         * @returns Nothing after updating the process-owned resource counter.
         */
        const release = (): void => {
            if (released) return
            released = true
            this.active--
            response.removeListener('finish', release)
            response.removeListener('close', release)
        }
        response.once('finish', release)
        response.once('close', release)
        return true
    }
}

/** Authenticated uploads, source downloads, and complete-batch chunk inspection. */
@Controller('knowledge')
export class KnowledgeController {
    /**
     * Retains the process-owned durable knowledge coordinator.
     * @param service - Authorized source and chunk operations.
     */
    constructor(@Inject(KnowledgeService) private readonly service: KnowledgeService) {}

    /**
     * Reports actual feature configuration and supported upload limits.
     * @returns Public configuration without private object settings.
     */
    @Get('status')
    status() {
        return this.service.status()
    }

    /**
     * Lists only current ownership metadata with literal filename search.
     * @param request - Request authenticated by the shared global guard.
     * @param query - Untrusted pagination and filename query.
     * @returns A public document page.
     * @throws BadRequestException when query parameters are invalid.
     */
    @Get('documents')
    list(@Req() request: ChatRequest, @Query() query: unknown) {
        const parsed = knowledgePageQuerySchema.safeParse(query)
        if (!parsed.success) throw new BadRequestException('资料列表查询参数无效。')
        return this.service.list(request.chatScope, parsed.data)
    }

    /**
     * Persists a size-limited original and idempotently queues actual document processing.
     * @param request - Globally authenticated account and workspace.
     * @param file - The only accepted multipart file.
     * @param body - Multipart action and numeric chunk settings.
     * @returns Newly queued metadata or the matching original action result.
     * @throws BadRequestException for missing files or invalid fields.
     */
    @Post('documents')
    @UseGuards(KnowledgeUploadGuard)
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: KNOWLEDGE_MAX_FILE_SIZE, files: 1, fields: 4, parts: 6, fieldSize: 200, fieldNameSize: 100 },
            preservePath: true,
        })
    )
    upload(
        @Req() request: ChatRequest,
        @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
        @Body() body: Record<string, unknown>
    ) {
        if (!file?.buffer) throw new BadRequestException('请选择需要上传的资料文件。')
        const parsed = knowledgeUploadSchema.safeParse({
            ...body,
            chunkSize: typeof body?.chunkSize === 'string' ? Number(body.chunkSize) : body?.chunkSize,
            overlap: typeof body?.overlap === 'string' ? Number(body.overlap) : body?.overlap,
        })
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message || '上传参数无效，请检查分片大小与重叠。')
        // Multer's multipart header parser decodes Latin-1; browsers submit UTF-8 filename bytes.
        return this.service.upload(request.chatScope, parsed.data, {
            originalname: decodeMultipartFileName(file.originalname),
            buffer: file.buffer,
        })
    }

    /**
     * Reads public metadata for one owned source.
     * @param request - Authenticated request.
     * @param id - Untrusted source UUID.
     * @param query - Optional private project boundary.
     * @returns Owned public document metadata.
     */
    @Get('documents/:id')
    get(@Req() request: ChatRequest, @Param('id') id: string, @Query() query: unknown) {
        const input = knowledgePageQuerySchema.safeParse(query)
        if (!input.success) throw new BadRequestException('资料查询参数无效。')
        return this.service.get(request.chatScope, documentId(id), input.data.projectFolderId)
    }

    /**
     * Reads an ordered page only from a complete ready batch.
     * @param request - Authenticated request.
     * @param id - Untrusted source UUID.
     * @param query - Untrusted pagination.
     * @returns Public chunk content without private object references.
     * @throws BadRequestException when pagination is invalid.
     */
    @Get('documents/:id/chunks')
    chunks(@Req() request: ChatRequest, @Param('id') id: string, @Query() query: unknown) {
        const parsed = knowledgePageQuerySchema.safeParse(query)
        if (!parsed.success) throw new BadRequestException('分片分页参数无效。')
        return this.service.chunks(request.chatScope, documentId(id), parsed.data)
    }

    /**
     * Requeues a failed source through a persistent idempotent retry action.
     * @param request - Authenticated request.
     * @param id - Untrusted source UUID.
     * @param body - Untrusted retry action identifier.
     * @returns Current owned processing metadata.
     * @throws BadRequestException when the action is invalid.
     */
    @Post('documents/:id/retry')
    retry(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        const parsed = knowledgeRetrySchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('重试操作标识无效，请重新打开资料后重试。')
        return this.service.retry(request.chatScope, documentId(id), parsed.data.requestId)
    }

    /**
     * Downloads original authorized bytes as an inert private attachment.
     * @param request - Authenticated request.
     * @param id - Untrusted source UUID.
     * @param response - HTTP response receiving safe attachment headers and bytes.
     * @param query - Optional private project boundary.
     * @returns After the exact original bytes have been sent.
     */
    @Get('documents/:id/file')
    async file(@Req() request: ChatRequest, @Param('id') id: string, @Res() response: Response, @Query() query: unknown): Promise<void> {
        const input = knowledgePageQuerySchema.safeParse(query)
        if (!input.success) throw new BadRequestException('资料查询参数无效。')
        const result = await this.service.file(request.chatScope, documentId(id), input.data.projectFolderId)
        const encoded = encodeURIComponent(result.document.fileName).replace(
            /['()*]/g,
            char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
        )
        response.setHeader('Content-Type', 'application/octet-stream')
        response.setHeader('Content-Disposition', `attachment; filename="document.${result.document.format}"; filename*=UTF-8''${encoded}`)
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.setHeader('Content-Security-Policy', 'sandbox')
        response.setHeader('Cache-Control', 'private, no-store')
        response.setHeader('Content-Length', result.file.byteLength)
        response.send(Buffer.from(result.file))
    }
}
