import { timingSafeEqual } from 'node:crypto'
import { ConflictException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { ChatScope } from '@ai-harness/db'
import type { Request } from 'express'
import type { ApiConfig } from './config.js'
import { AccountService } from './account-service.js'
import type { WorkspaceService } from './workspace-service.js'

export interface ChatRequest extends Request {
    chatScope: ChatScope
    accountSession: string
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

/** Authenticates the private Web server and derives user identity only from real account sessions. */
@Injectable()
export class ChatGuard implements CanActivate {
    /**
     * Retain private server authentication settings.
     * @param config - Shared Web/API token and allowed workspace.
     * @param accounts - Server-side opaque session authenticator.
     */
    constructor(
        private readonly config: ApiConfig,
        private readonly accounts: AccountService,
        private readonly workspaces?: WorkspaceService
    ) {}

    /**
     * Verify the server credential before constructing a trusted runtime scope.
     * @param context - Nest HTTP request context.
     * @returns True after authenticated ownership has been attached.
     * @throws UnauthorizedException for missing or forged credentials and claims.
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<ChatRequest>()
        const authorization = request.headers.authorization || ''
        if (!matchesToken(authorization, `Bearer ${this.config.token}`)) throw new UnauthorizedException('无法验证当前会话，请重新登录。')
        const pathname = request.path.replace(/\/+$/, '')
        if (request.method === 'POST' && (pathname === '/api/account/register' || pathname === '/api/account/login')) return true
        const session = request.headers['x-harness-session']
        const scope = typeof session === 'string' ? await this.accounts.authenticate(session) : undefined
        if (!scope) throw new UnauthorizedException('登录已失效，请重新登录。')
        const active = this.workspaces ? await this.workspaces.current(scope, session as string) : scope
        const control = pathname === '/api/account/me' || pathname.startsWith('/api/account/workspaces')
        const expected = request.headers['x-harness-context']
        if (!control && expected !== undefined && expected !== active.workspaceId) {
            context.switchToHttp().getResponse().setHeader('X-Harness-Context-Changed', '1')
            throw new ConflictException('工作空间已变化，请重新载入后继续。')
        }
        request.chatScope = active
        request.accountSession = session as string
        return true
    }
}
