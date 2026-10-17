import { proxyChatRequest } from '../../../../server/chat-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
    params: Promise<{ path?: string[] }>
}

/**
 * Proxy authorized chat reads through the server-only API connection.
 * @param request - Incoming same-origin request.
 * @param context - Next route parameters.
 * @returns The API response and signed browser session cookie.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
    return proxyChatRequest(request, (await context.params).path ?? [])
}

/**
 * Proxy same-origin chat mutations and preserve SSE cancellation.
 * @param request - Incoming browser request.
 * @param context - Next route parameters.
 * @returns The API response without exposing any provider or server credentials.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
    return proxyChatRequest(request, (await context.params).path ?? [])
}

/**
 * Forward same-origin edits to an owned Agent definition.
 * @param request - Incoming browser mutation.
 * @param context - Next route parameters.
 * @returns The authorized API update response.
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
    return proxyChatRequest(request, (await context.params).path ?? [])
}
