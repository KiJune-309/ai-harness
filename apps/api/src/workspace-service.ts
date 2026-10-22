import {
    createWorkspaceSchema,
    inviteWorkspaceMemberSchema,
    respondWorkspaceInvitationSchema,
    workspaceInputSchema,
    type WorkspaceDetail,
    type WorkspaceDirectory,
} from '@ai-harness/contracts'
import { WorkspaceAccessError, WorkspaceConflictError, type ChatScope, type WorkspaceStore } from '@ai-harness/db'
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { hashAccountSession } from './account-service.js'

/** Coordinates explicit team membership changes after real account authentication. */
export class WorkspaceService {
    /**
     * Retains shared durable persistence, with omission allowed only in explicit old test fixtures.
     * @param store - Existing process-owned workspace store.
     */
    constructor(private readonly store: WorkspaceStore | undefined) {}

    /**
     * Requires durable workspace storage for every management operation.
     * @returns Shared workspace persistence.
     * @throws ServiceUnavailableException when the injected fixture has no workspace support.
     */
    private persistence(): WorkspaceStore {
        if (!this.store) throw new ServiceUnavailableException('工作空间服务暂时不可用，请稍后重试。')
        return this.store
    }

    /**
     * Converts private persistence failures into bounded public errors.
     * @param action - Authorized database operation.
     * @returns Its committed result.
     * @throws ForbiddenException for access failure, ConflictException for stale actions, or ServiceUnavailableException for database failure.
     */
    private async run<T>(action: () => Promise<T>): Promise<T> {
        try {
            return await action()
        } catch (error) {
            if (error instanceof WorkspaceAccessError) throw new ForbiddenException(error.message)
            if (error instanceof WorkspaceConflictError) throw new ConflictException(error.message)
            if (error instanceof ServiceUnavailableException) throw error
            throw new ServiceUnavailableException('工作空间服务暂时不可用，请稍后重试。')
        }
    }

    /**
     * Validates a strict shared request without exposing transport internals.
     * @param schema - Shared public request schema.
     * @param value - Untrusted JSON body.
     * @returns Normalized valid input.
     * @throws BadRequestException for unknown fields or invalid values.
     */
    private parse<T>(
        schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } },
        value: unknown
    ): T {
        const parsed = schema.safeParse(value)
        if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message || '工作空间参数不正确。')
        return parsed.data
    }

    /**
     * Resolves a current session's authorized active business scope.
     * @param scope - Real account's historical identity scope.
     * @param session - Opaque server session.
     * @returns Current verified business scope.
     */
    async current(scope: ChatScope, session: string): Promise<ChatScope> {
        if (!this.store) return scope
        return { userId: scope.userId, workspaceId: await this.run(() => this.store!.current(scope, hashAccountSession(session))) }
    }

    /**
     * Lists only spaces and invitations belonging to the authenticated account.
     * @param scope - Verified account scope.
     * @param session - Current session secret, never returned publicly.
     * @returns Public directory.
     */
    directory(scope: ChatScope, session: string): Promise<WorkspaceDirectory> {
        return this.run(() => this.persistence().directory(scope, hashAccountSession(session)))
    }

    /**
     * Creates one team without calling a model or automatically inviting anyone.
     * @param scope - Verified creator.
     * @param body - Untrusted creation body.
     * @returns Persisted team.
     */
    create(scope: ChatScope, body: unknown) {
        const input = this.parse(createWorkspaceSchema, body)
        return this.run(() => this.persistence().create(scope, input))
    }

    /**
     * Reads an authorized team's current roster and settings.
     * @param scope - Verified requester.
     * @param id - Workspace identifier.
     * @returns Authorized public detail.
     */
    detail(scope: ChatScope, id: string): Promise<WorkspaceDetail> {
        return this.run(() => this.persistence().detail(scope, id))
    }

    /**
     * Updates owner-managed team fields.
     * @param scope - Verified owner.
     * @param id - Workspace identifier.
     * @param body - Untrusted editable fields.
     * @returns Saved team metadata.
     */
    update(scope: ChatScope, id: string, body: unknown) {
        const input = this.parse(workspaceInputSchema, body)
        return this.run(() => this.persistence().update(scope, id, input))
    }

    /**
     * Saves a membership-verified selection for only the current session.
     * @param scope - Verified requester.
     * @param session - Opaque current session.
     * @param id - Target joined workspace.
     * @returns After persistence confirms the selection.
     */
    select(scope: ChatScope, session: string, id: string): Promise<void> {
        return this.run(() => this.persistence().select(scope, hashAccountSession(session), id))
    }

    /**
     * Creates an owner-authorized invitation to an existing account.
     * @param scope - Verified owner.
     * @param id - Workspace identifier.
     * @param body - Email and stable action identity.
     * @returns Persisted public invitation.
     */
    invite(scope: ChatScope, id: string, body: unknown) {
        const input = this.parse(inviteWorkspaceMemberSchema, body)
        return this.run(() => this.persistence().invite(scope, id, input))
    }

    /**
     * Applies an explicit decision from the real stable invitation recipient.
     * @param scope - Verified recipient.
     * @param id - Invitation identifier.
     * @param body - Strict accept/decline choice.
     * @returns After the decision is committed.
     */
    respond(scope: ChatScope, id: string, body: unknown): Promise<void> {
        const input = this.parse(respondWorkspaceInvitationSchema, body)
        return this.run(() => this.persistence().respond(scope, id, input.accept))
    }

    /**
     * Revokes a pending invitation after checking the current owner.
     * @param scope - Verified owner.
     * @param id - Workspace identifier.
     * @param invitationId - Invitation identifier.
     * @returns After revocation is durable.
     */
    revoke(scope: ChatScope, id: string, invitationId: string): Promise<void> {
        return this.run(() => this.persistence().revoke(scope, id, invitationId))
    }

    /**
     * Removes a non-owner member or performs the caller's explicit leave.
     * @param scope - Verified owner or leaving member.
     * @param id - Team identifier.
     * @param userId - Target stable member identifier.
     * @returns After access is revoked.
     */
    remove(scope: ChatScope, id: string, userId: string): Promise<void> {
        return this.run(() => this.persistence().remove(scope, id, userId))
    }
}
