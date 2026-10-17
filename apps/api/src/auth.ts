import { timingSafeEqual } from 'node:crypto'
import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { ChatScope } from '@ai-harness/db'
import type { Request } from 'express'
import type { ApiConfig } from './config.js'

export interface ChatRequest extends Request {
    chatScope: ChatScope
}

/**
 * Compare server credentials without content-dependent timing differences.
 * @param candidate - Credential supplied by the trusted Web server.
 * @param expected - API process credential.
 * @returns Whether both byte sequences match.
 */
function matchesToken(candidate: string, expected: string): boolean {
    const left = Buffer.from(candidate)
    const right = Buffer.from(expected)
    return left.length === right.length && timingSafeEqual(left, right)
}

/** Authenticates the Web server before accepting its user and workspace claims. */
@Injectable()
export class ChatGuard implements CanActivate {
    /**
     * Retain private server authentication settings.
     * @param config - Shared Web/API token and allowed workspace.
     */
    constructor(private readonly config: ApiConfig) {}

    /**
     * Verify the server credential before constructing a trusted runtime scope.
     * @param context - Nest HTTP request context.
     * @returns True after authenticated ownership has been attached.
     * @throws UnauthorizedException for missing or forged credentials and claims.
     */
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<ChatRequest>()
        const authorization = request.headers.authorization || ''
        const userId = request.headers['x-harness-user-id']
        const workspaceId = request.headers['x-harness-workspace-id']
        if (
            !matchesToken(authorization, `Bearer ${this.config.token}`) ||
            typeof userId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ||
            workspaceId !== this.config.workspaceId
        )
            throw new UnauthorizedException('无法验证当前会话，请刷新页面。')
        request.chatScope = { userId, workspaceId }
        return true
    }
}
