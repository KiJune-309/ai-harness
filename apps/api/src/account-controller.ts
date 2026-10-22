import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, Res, BadRequestException, NotFoundException } from '@nestjs/common'
import type {
    AccountModel,
    AccountUser,
    CreateAccountModel,
    LoginAccount,
    RegisterAccount,
    UpdateAccountModel,
    UpdateEmail,
    UpdatePassword,
    UpdateUsername,
} from '@ai-harness/contracts'
import type { Response } from 'express'
import { AccountService } from './account-service.js'
import type { ChatRequest } from './auth.js'
import type { ApiConfig } from './config.js'

/**
 * Validates a configuration identifier before database access.
 * @param id - Untrusted route parameter.
 * @returns Valid UUID.
 * @throws BadRequestException for malformed identifiers.
 */
function modelId(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        throw new BadRequestException('模型连接标识不正确。')
    return id
}

/** Exposes strict public account endpoints while retaining sessions and secrets on the server. */
@Controller('account')
export class AccountController {
    /**
     * Receives shared private account coordination and deployment storage mode.
     * @param service - Process-owned account coordinator.
     * @param config - Server-only deployment configuration.
     */
    constructor(
        @Inject(AccountService) private readonly service: AccountService,
        @Inject('ACCOUNT_CONFIG') private readonly config: ApiConfig
    ) {}
    /**
     * Registers an account and sends its opaque token only to the private BFF header.
     * @param request - Server-authenticated public request.
     * @param response - Private server-to-server response.
     * @param body - Untrusted strict registration input.
     * @returns Only public profile fields.
     */
    @Post('register')
    async register(
        @Req() request: ChatRequest,
        @Res({ passthrough: true }) response: Response,
        @Body() body: RegisterAccount
    ): Promise<AccountUser> {
        const result = await this.service.register(body, request.ip ?? 'unknown')
        response.setHeader('X-Harness-Session', result.session)
        response.setHeader('Cache-Control', 'no-store')
        return result.user
    }
    /**
     * Creates a new server session after uniform credential verification.
     * @param request - Server-authenticated public request.
     * @param response - Private BFF response.
     * @param body - Candidate email and password.
     * @returns Public profile fields without session or password material.
     */
    @Post('login')
    async login(
        @Req() request: ChatRequest,
        @Res({ passthrough: true }) response: Response,
        @Body() body: LoginAccount
    ): Promise<AccountUser> {
        const result = await this.service.login(body, request.ip ?? 'unknown')
        response.setHeader('X-Harness-Session', result.session)
        response.setHeader('Cache-Control', 'no-store')
        return result.user
    }
    /**
     * Reads the real authenticated account and explicit deployment storage mode.
     * @param request - Session-authenticated request.
     * @returns Safe user profile and storage mode.
     */
    @Get('me')
    async me(@Req() request: ChatRequest): Promise<{ user: AccountUser; storage: 'postgres'; workspaceId: string }> {
        return { user: await this.service.user(request.chatScope), storage: 'postgres', workspaceId: request.chatScope.workspaceId }
    }
    /**
     * Revokes the current session before the BFF clears its cookie.
     * @param request - Session-authenticated request.
     * @returns Confirmation after persistence completes.
     */
    @Post('logout')
    async logout(@Req() request: ChatRequest): Promise<{ success: true }> {
        await this.service.logout(request.accountSession)
        return { success: true }
    }
    /**
     * Updates a display name without changing the stable user identity.
     * @param request - Session-authenticated request.
     * @param body - Strict display-name input.
     * @returns Current public user.
     */
    @Put('username')
    username(@Req() request: ChatRequest, @Body() body: UpdateUsername): Promise<AccountUser> {
        return this.service.updateUsername(request.chatScope, body)
    }
    /**
     * Updates the login email and atomically invalidates all prior sessions.
     * @param request - Session-authenticated request.
     * @param body - New email and current password.
     * @returns Updated public user after session revocation.
     */
    @Put('email')
    email(@Req() request: ChatRequest, @Body() body: UpdateEmail): Promise<AccountUser> {
        return this.service.updateEmail(request.chatScope, body)
    }
    /**
     * Replaces the password verifier and atomically revokes every old session.
     * @param request - Session-authenticated request.
     * @param body - Current and new passwords.
     * @returns Public user after successful credential change.
     */
    @Put('password')
    password(@Req() request: ChatRequest, @Body() body: UpdatePassword): Promise<AccountUser> {
        return this.service.updatePassword(request.chatScope, body)
    }
    /**
     * Lists safe metadata for this account's model connections.
     * @param request - Session-authenticated request.
     * @returns Owned public model configurations.
     */
    @Get('models')
    async models(@Req() request: ChatRequest): Promise<{ models: AccountModel[] }> {
        return { models: await this.service.listModels(request.chatScope) }
    }
    /**
     * Saves an encrypted personal connection without contacting its provider.
     * @param request - Session-authenticated request.
     * @param body - Strict connection fields and retry identity.
     * @returns Safe public connection metadata.
     */
    @Post('models')
    createModel(@Req() request: ChatRequest, @Body() body: CreateAccountModel): Promise<AccountModel> {
        return this.service.createModel(request.chatScope, body)
    }
    /**
     * Reads public metadata for one owned model without exposing its key.
     * @param request - Session-authenticated request.
     * @param id - Untrusted route identifier.
     * @returns Safe public model configuration.
     */
    @Get('models/:id')
    async getModel(@Req() request: ChatRequest, @Param('id') id: string): Promise<AccountModel> {
        const ownedId = modelId(id)
        const found = await this.service.listModels(request.chatScope)
        const model = found.find(candidate => candidate.id === ownedId)
        if (!model) throw new NotFoundException('未找到这个模型连接。')
        return model
    }
    /**
     * Replaces connection fields while preserving a blank write-only key.
     * @param request - Session-authenticated request.
     * @param id - Configuration UUID.
     * @param body - Strict replacement input.
     * @returns Safe updated configuration.
     */
    @Put('models/:id')
    updateModel(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: UpdateAccountModel): Promise<AccountModel> {
        return this.service.updateModel(request.chatScope, modelId(id), body)
    }
    /**
     * Selects one owned connection as the unique default.
     * @param request - Session-authenticated request.
     * @param id - Configuration UUID.
     * @returns Safe selected configuration.
     */
    @Post('models/:id/default')
    defaultModel(@Req() request: ChatRequest, @Param('id') id: string): Promise<AccountModel> {
        return this.service.setDefaultModel(request.chatScope, modelId(id))
    }
    /**
     * Deletes one owned connection while leaving existing business snapshots readable.
     * @param request - Session-authenticated request.
     * @param id - Configuration UUID.
     * @returns Confirmation after deletion succeeds.
     */
    @Delete('models/:id')
    async deleteModel(@Req() request: ChatRequest, @Param('id') id: string): Promise<{ success: true }> {
        await this.service.deleteModel(request.chatScope, modelId(id))
        return { success: true }
    }
    /**
     * Runs only the explicitly requested saved connection test and propagates browser cancellation.
     * @param request - Session-authenticated request.
     * @param response - Response used to observe early disconnect.
     * @param id - Configuration UUID.
     * @returns Safe bounded connection feedback.
     */
    @Post('models/:id/test')
    async testModel(
        @Req() request: ChatRequest,
        @Res({ passthrough: true }) response: Response,
        @Param('id') id: string
    ): Promise<{ success: true; message: string }> {
        const controller = new AbortController()
        /**
         * Aborts a model test when its response is no longer consumed.
         * @returns Nothing after cancellation is signalled.
         */
        function disconnect(): void {
            if (!response.writableEnded) controller.abort()
        }
        response.on('close', disconnect)
        try {
            return await this.service.testModel(request.chatScope, modelId(id), controller.signal)
        } finally {
            response.off('close', disconnect)
        }
    }
}
