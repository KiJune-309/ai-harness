import { proxyAccountRequest } from '../../../../server/account-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
interface RouteContext {
    params: Promise<{ path?: string[] }>
}

/**
 * Forward an allowed account read using the private account session.
 * @param request - Incoming browser request.
 * @param context - Decoded route parameters.
 * @returns A credential-free account response.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
    return proxyAccountRequest(request, (await context.params).path ?? [])
}

/**
 * Forward same-origin registration, login, or model actions.
 * @param request - Incoming browser request.
 * @param context - Decoded route parameters.
 * @returns A safe response with an HttpOnly session cookie when applicable.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
    return proxyAccountRequest(request, (await context.params).path ?? [])
}

/**
 * Forward a same-origin profile, security, or model update.
 * @param request - Incoming browser request.
 * @param context - Decoded route parameters.
 * @returns The authorized API result.
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
    return proxyAccountRequest(request, (await context.params).path ?? [])
}

/**
 * Delete only the model connection selected by the authenticated user.
 * @param request - Incoming same-origin request.
 * @param context - Decoded route parameters.
 * @returns The authorized deletion result.
 */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
    return proxyAccountRequest(request, (await context.params).path ?? [])
}
