import { proxyKnowledgeRequest } from '../../../../server/knowledge-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
    params: Promise<{ path?: string[] }>
}

/**
 * Reads only authorized document metadata, chunks, or an original attachment.
 * @param request - Browser-facing authenticated request.
 * @param context - Decoded fixed route components.
 * @returns The private, uncached knowledge response.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
    return proxyKnowledgeRequest(request, (await context.params).path ?? [])
}

/**
 * Forwards a bounded same-origin upload or an idempotent processing retry.
 * @param request - Browser-facing multipart or JSON mutation.
 * @param context - Decoded fixed route components.
 * @returns The saved document or safe recoverable failure.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
    return proxyKnowledgeRequest(request, (await context.params).path ?? [])
}
