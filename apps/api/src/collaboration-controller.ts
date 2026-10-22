import { collaborationSourceSchema } from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { ChatRequest } from './auth.js'
import { CollaborationService } from './collaboration-service.js'
import { LegacyProjectsRetiredGuard } from './legacy-project-policy.js'

/**
 * Validates an opaque route identity before database access.
 * @param value - Untrusted route identity.
 * @returns A UUID string.
 * @throws BadRequestException for malformed identities.
 */
function uuid(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
        throw new BadRequestException('协作标识无效。')
    return value
}

/**
 * Validates an exclusive pagination sequence.
 * @param value - Optional query cursor.
 * @returns A nonnegative integer.
 * @throws BadRequestException for invalid cursors.
 */
function cursor(value?: string): number {
    const parsed = value ? Number(value) : 0
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new BadRequestException('分页位置无效。')
    return parsed
}

/** Real session identities are supplied by ChatGuard for every collaboration request. */
@Controller('chat/collaboration')
export class CollaborationController {
    /**
     * Retains the initialized scoped collaboration coordinator.
     * @param service - Shared application service.
     */
    constructor(@Inject(CollaborationService) private readonly service: CollaborationService) {}

    /**
     * Searches only the current workspace's public member directory.
     * @param request - Authenticated account request.
     * @param query - Bounded member name or email fragment.
     * @returns Minimal member summaries.
     */
    @Get('people')
    people(@Req() request: ChatRequest, @Query('q') query = '') {
        if (!query.trim() || query.length > 100) throw new BadRequestException('请输入同事姓名，最多100字。')
        return this.service.query(async store => ({ people: await store.people(request.chatScope, query.trim()) }))
    }

    /**
     * Lists shared projects visible to the actual account.
     * @param request - Authenticated account request.
     * @returns Safe project projections without private Task histories.
     */
    @Get('projects')
    @UseGuards(LegacyProjectsRetiredGuard)
    projects(@Req() request: ChatRequest) {
        return this.service.query(async store => ({ projects: await store.projects(request.chatScope) }))
    }

    /**
     * Reads a currently authorized project projection.
     * @param request - Authenticated account request.
     * @param id - Stable project ID.
     * @returns Public members, responsibility nodes and shared materials.
     * @throws NotFoundException for absent or inaccessible projects.
     */
    @Get('projects/:id')
    @UseGuards(LegacyProjectsRetiredGuard)
    project(@Req() request: ChatRequest, @Param('id') id: string) {
        return this.service.query(async store => {
            const project = await store.project(request.chatScope, uuid(id))
            if (!project) throw new NotFoundException('未找到此协作项目。')
            return project
        })
    }

    /**
     * Reads only safe responsibility and pending-request metadata for effective project members.
     * @param request - Authenticated real workspace account.
     * @param id - Shared project identifier.
     * @returns Whitelisted progress and verified links for the viewer's own private chats only.
     * @throws NotFoundException when project or workspace membership no longer grants access.
     */
    @Get('projects/:id/progress')
    @UseGuards(LegacyProjectsRetiredGuard)
    progress(@Req() request: ChatRequest, @Param('id') id: string) {
        return this.service.query(store => store.progress(request.chatScope, uuid(id)))
    }

    /**
     * Reads a safe node view and its authorized shared events.
     * @param request - Authenticated account request.
     * @param id - Stable responsibility node ID.
     * @returns Shared node details, never another person's private Task.
     * @throws NotFoundException when inaccessible.
     */
    @Get('nodes/:id')
    @UseGuards(LegacyProjectsRetiredGuard)
    node(@Req() request: ChatRequest, @Param('id') id: string) {
        return this.service.query(async store => {
            const node = await store.node(request.chatScope, uuid(id))
            if (!node) throw new NotFoundException('未找到此协作节点。')
            return node
        })
    }

    /**
     * Reads a bounded page of node events with stable ordering.
     * @param request - Authenticated account request.
     * @param id - Stable responsibility node ID.
     * @param after - Exclusive event sequence.
     * @param eventId - Optional authorized event to locate directly.
     * @returns A bounded authorized event page with stable ordering.
     */
    @Get('nodes/:id/events')
    @UseGuards(LegacyProjectsRetiredGuard)
    events(@Req() request: ChatRequest, @Param('id') id: string, @Query('cursor') after?: string, @Query('eventId') eventId?: string) {
        const position = cursor(after)
        return this.service.query(store => store.nodeEvents(request.chatScope, uuid(id), position, eventId ? uuid(eventId) : undefined))
    }

    /**
     * Routes questions and answers back to their exact original private work location.
     * @param request - Authenticated source owner.
     * @param kind - Original source type.
     * @param id - Original private source ID.
     * @param after - Exclusive event sequence.
     * @param eventId - Optional authorized event to locate directly.
     * @returns Authorized events, related nodes and current questions.
     */
    @Get('source-events')
    sourceEvents(
        @Req() request: ChatRequest,
        @Query('sourceKind') kind: string,
        @Query('sourceId') id: string,
        @Query('cursor') after?: string,
        @Query('eventId') eventId?: string
    ) {
        const parsed = collaborationSourceSchema.safeParse({ kind, id })
        if (!parsed.success) throw new BadRequestException('原对话位置无效。')
        const position = cursor(after)
        return this.service.query(async store => {
            const page = await store.sourceEvents(request.chatScope, parsed.data, position, eventId ? uuid(eventId) : undefined)
            const events = page.events.slice(0, 50)
            const snapshot = await store.loadSource(request.chatScope, parsed.data)
            return {
                ...page,
                events,
                nextCursor: events.at(-1)?.sequence ?? position,
                hasMore: page.events.length > events.length,
                ...(snapshot?.bound
                    ? {
                          sourceState: {
                              revision: snapshot.revision,
                              activeRequestId: snapshot.conversation.activeRequestId,
                              updatedAt: snapshot.conversation.updatedAt,
                          },
                      }
                    : {}),
            }
        })
    }

    /**
     * Lists durable notifications without automatically marking them read.
     * @param request - Actual recipient.
     * @param before - Optional exclusive sequence for earlier notifications.
     * @returns Recipient notifications and unread count.
     */
    @Get('notifications')
    notifications(@Req() request: ChatRequest, @Query('before') before?: string) {
        return this.service.query(store => store.notifications(request.chatScope, before ? cursor(before) : undefined))
    }

    /**
     * Reads a private message thread or the account's recent message activity.
     * @param request - Actual participant.
     * @param threadId - Optional exact thread ID.
     * @param before - Optional exclusive sequence for earlier messages.
     * @returns Only messages sent or received by the account.
     */
    @Get('messages')
    messages(@Req() request: ChatRequest, @Query('threadId') threadId?: string, @Query('before') before?: string) {
        return this.service.query(async store => ({
            messages: await store.messages(request.chatScope, threadId ? uuid(threadId) : undefined, before ? cursor(before) : undefined),
        }))
    }

    /**
     * Checks whether an original action committed after a response was lost.
     * @param request - Original authenticated actor.
     * @param requestId - Original action identity.
     * @returns The committed outcome for this actor alone.
     * @throws NotFoundException when the action has not committed or is inaccessible.
     */
    @Get('actions/:requestId')
    action(@Req() request: ChatRequest, @Param('requestId') requestId: string) {
        return this.service.query(async store => {
            const action = await store.action(request.chatScope, uuid(requestId))
            if (!action) throw new NotFoundException('尚未查到此操作的提交记录。')
            return action
        })
    }

    /**
     * Accepts a strictly validated human action with durable request identity.
     * @param request - Authenticated real actor.
     * @param body - Untrusted command union.
     * @returns Only the committed safe action result.
     */
    @Post('commands')
    command(@Req() request: ChatRequest, @Body() body: unknown) {
        return this.service.command(request.chatScope, body)
    }
}
