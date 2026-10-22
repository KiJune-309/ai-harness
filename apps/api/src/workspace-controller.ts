import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from '@nestjs/common'
import type { ChatRequest } from './auth.js'
import { WorkspaceService } from './workspace-service.js'

/**
 * Validates stable UUID route identifiers before PostgreSQL casts.
 * @param id - Untrusted route value.
 * @returns The valid identifier.
 * @throws BadRequestException for malformed input.
 */
function uuid(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        throw new BadRequestException('标识不正确，请刷新后重试。')
    return id
}

/** Exposes explicit human workspace management after the global real-session guard. */
@Controller('account/workspaces')
export class WorkspaceController {
    /**
     * Retains shared membership coordination.
     * @param service - Application-owned workspace coordinator.
     */
    constructor(@Inject(WorkspaceService) private readonly service: WorkspaceService) {}

    /**
     * Lists the authenticated account's directory across its current activity scope.
     * @param request - Real authenticated session.
     * @returns Joined spaces and the recipient's invitations.
     */
    @Get()
    directory(@Req() request: ChatRequest) {
        return this.service.directory(request.chatScope, request.accountSession)
    }

    /**
     * Creates a team with one owner and a stable retry identity.
     * @param request - Verified creator.
     * @param body - Strict creation fields.
     * @returns Persisted team.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: unknown) {
        return this.service.create(request.chatScope, body)
    }

    /**
     * Accepts or declines only the authenticated invitee's invitation.
     * @param request - Verified invitee.
     * @param id - Invitation identifier.
     * @param body - Explicit boolean decision.
     * @returns Confirmation after persistence.
     */
    @Post('invitations/:id/respond')
    async respond(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        await this.service.respond(request.chatScope, uuid(id), body)
        return { success: true as const }
    }

    /**
     * Reads a workspace only while the caller is an effective member.
     * @param request - Verified requester.
     * @param id - Workspace identifier including the historical string scope.
     * @returns Authorized detail.
     */
    @Get(':id')
    detail(@Req() request: ChatRequest, @Param('id') id: string) {
        return this.service.detail(request.chatScope, id)
    }

    /**
     * Updates fields only for the actual team owner.
     * @param request - Verified owner.
     * @param id - Team identifier.
     * @param body - Strict editable fields.
     * @returns Saved team metadata.
     */
    @Put(':id')
    update(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        return this.service.update(request.chatScope, uuid(id), body)
    }

    /**
     * Persists a membership-verified session workspace selection.
     * @param request - Verified requester and current session.
     * @param id - Joined target scope.
     * @returns Confirmation after persistence.
     */
    @Post(':id/switch')
    async select(@Req() request: ChatRequest, @Param('id') id: string) {
        await this.service.select(request.chatScope, request.accountSession, id)
        return { success: true as const }
    }

    /**
     * Creates an owner-authorized, account-bound station invitation.
     * @param request - Verified owner.
     * @param id - Team identifier.
     * @param body - Recipient email and retry identity.
     * @returns Persisted invitation preview.
     */
    @Post(':id/invitations')
    invite(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown) {
        return this.service.invite(request.chatScope, uuid(id), body)
    }

    /**
     * Revokes a pending team invitation after owner authorization.
     * @param request - Verified owner.
     * @param id - Team identifier.
     * @param invitationId - Invitation identifier.
     * @returns Committed confirmation.
     */
    @Delete(':id/invitations/:invitationId')
    async revoke(@Req() request: ChatRequest, @Param('id') id: string, @Param('invitationId') invitationId: string) {
        await this.service.revoke(request.chatScope, uuid(id), uuid(invitationId))
        return { success: true as const }
    }

    /**
     * Removes a non-owner member without moving their private content.
     * @param request - Verified owner.
     * @param id - Team identifier.
     * @param userId - Actual target member.
     * @returns Committed confirmation.
     */
    @Delete(':id/members/:userId')
    async remove(@Req() request: ChatRequest, @Param('id') id: string, @Param('userId') userId: string) {
        await this.service.remove(request.chatScope, uuid(id), uuid(userId))
        return { success: true as const }
    }

    /**
     * Applies the current ordinary member's explicit leave decision.
     * @param request - Verified leaving member.
     * @param id - Team identifier.
     * @returns Confirmation after membership removal.
     */
    @Post(':id/leave')
    async leave(@Req() request: ChatRequest, @Param('id') id: string) {
        await this.service.remove(request.chatScope, uuid(id), request.chatScope.userId)
        return { success: true as const }
    }
}
