import { observeWorkspaceResponse, workspaceHeaders } from './workspace-context'
import {
    accountMeSchema,
    accountModelSchema,
    accountModelsSchema,
    accountModelTestSchema,
    accountUserSchema,
    createAccountModelSchema,
    loginAccountSchema,
    registerAccountSchema,
    updateAccountModelSchema,
    updateEmailSchema,
    updatePasswordSchema,
    updateUsernameSchema,
    type AccountMe,
    type AccountModel,
    type AccountUser,
    type CreateAccountModel,
    type LoginAccount,
    type RegisterAccount,
    type UpdateAccountModel,
    type UpdateEmail,
    type UpdatePassword,
    type UpdateUsername,
} from '@ai-harness/contracts'
import { notifyAccountChange } from './account-session'

/**
 * Keeps post-login navigation within this application.
 * @param value - Optional return address from the URL.
 * @returns A safe same-origin path or the home page.
 */
export function safeReturnTo(value: string | null): string {
    if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/'
    try {
        const url = new URL(value, 'https://orbit.invalid')
        if (url.origin !== 'https://orbit.invalid' || /^\/(login|register)(\/|$)/.test(url.pathname)) return '/'
        return `${url.pathname}${url.search}${url.hash}`
    } catch {
        return '/'
    }
}

/**
 * Requests a protected account resource without persisting credentials in JavaScript storage.
 * @param path - Fixed account API resource.
 * @param options - HTTP method, payload and caller cancellation.
 * @returns Untrusted public JSON for contract validation.
 * @throws Error for safe server errors, cancellation, or network timeout.
 */
async function requestAccount(path: string, options: RequestInit = {}): Promise<unknown> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), path.endsWith('/test') ? 20_000 : 15_000)
    try {
        const response = await fetch(`/api/account${path}`, {
            cache: 'no-store',
            ...options,
            headers: path === '/me' || path === '/login' || path === '/register' ? options.headers : workspaceHeaders(options.headers),
            signal: options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal,
        })
        observeWorkspaceResponse(response)
        if (!response.ok) {
            if (response.status === 401 && path !== '/login' && path !== '/register' && typeof window !== 'undefined')
                window.dispatchEvent(new Event('harness:unauthorized'))
            let message = `账户服务请求失败（${response.status}），请重试。`
            try {
                const value: unknown = await response.json()
                if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') message = value.message
            } catch {
                // A disconnected server can return an HTML response.
            }
            throw Object.assign(new Error(message), { status: response.status })
        }
        if (response.status === 204) return null
        return await response.json()
    } catch (error) {
        if (options.signal?.aborted) throw error
        if (deadline.signal.aborted) throw new Error('请求超时，请检查连接后重试。')
        if (error instanceof Error && 'status' in error) throw error
        throw new Error('暂时无法连接账户服务，请重试。')
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Validates an account response before it becomes UI state.
 * @param value - Untrusted public JSON.
 * @param schema - Shared public response validator.
 * @returns The validated response.
 * @throws Error if the service returns malformed data or private fields.
 */
function parseAccount<T>(value: unknown, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T {
    const result = schema.safeParse(value)
    if (!result.success) throw new Error('账户服务返回了无效的数据，请重新载入。')
    return result.data
}

/**
 * Serializes an explicitly submitted account mutation.
 * @param method - Allowed mutation method.
 * @param input - Validated request fields, kept only for this request.
 * @returns JSON request options.
 */
function mutation(method: 'POST' | 'PUT', input: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
}

/**
 * Reads the authenticated public profile and persistence mode.
 * @param signal - Optional navigation cancellation.
 * @returns Current user and storage mode.
 * @throws Error when the session is invalid or the service is unavailable.
 */
export async function getAccount(signal?: AbortSignal): Promise<AccountMe> {
    return parseAccount(await requestAccount('/me', { signal }), accountMeSchema)
}

/**
 * Creates an account and establishes the HttpOnly browser session.
 * @param input - Registration fields from the validated form.
 * @returns The authenticated public user.
 * @throws Error for invalid fields, duplicate email, or service failures.
 */
export async function registerAccount(input: RegisterAccount): Promise<AccountUser> {
    const user = parseAccount(await requestAccount('/register', mutation('POST', registerAccountSchema.parse(input))), accountUserSchema)
    notifyAccountChange()
    return user
}

/**
 * Authenticates an email and password using an HttpOnly session.
 * @param input - Email and password supplied by the user.
 * @returns The authenticated public user.
 * @throws Error for invalid credentials or rate limiting.
 */
export async function loginAccount(input: LoginAccount): Promise<AccountUser> {
    const user = parseAccount(await requestAccount('/login', mutation('POST', loginAccountSchema.parse(input))), accountUserSchema)
    notifyAccountChange()
    return user
}

/**
 * Revokes this browser session and clears its HttpOnly cookie.
 * @returns After the server confirms logout.
 * @throws Error when revocation cannot be confirmed.
 */
export async function logoutAccount(): Promise<void> {
    await requestAccount('/logout', mutation('POST', {}))
    notifyAccountChange()
}

/**
 * Updates the user's display name without changing resource ownership.
 * @param input - New public display name.
 * @returns Updated public user.
 * @throws Error for invalid fields or unsuccessful persistence.
 */
export async function updateAccountUsername(input: UpdateUsername): Promise<AccountUser> {
    return parseAccount(await requestAccount('/username', mutation('PUT', updateUsernameSchema.parse(input))), accountUserSchema)
}

/**
 * Changes the login email and revokes every existing session.
 * @param input - New email and current password.
 * @returns After the server confirms the credential change.
 * @throws Error for an occupied email, invalid password, or save failure.
 */
export async function updateAccountEmail(input: UpdateEmail): Promise<void> {
    await requestAccount('/email', mutation('PUT', updateEmailSchema.parse(input)))
    notifyAccountChange()
}

/**
 * Changes the password and revokes every existing session.
 * @param input - Current and new passwords.
 * @returns After the server confirms the credential change.
 * @throws Error for invalid credentials or save failure.
 */
export async function updateAccountPassword(input: UpdatePassword): Promise<void> {
    await requestAccount('/password', mutation('PUT', updatePasswordSchema.parse(input)))
    notifyAccountChange()
}

/**
 * Lists only this account's safe model connection metadata.
 * @param signal - Optional navigation cancellation.
 * @returns Saved connections without API keys.
 * @throws Error for invalid or inaccessible data.
 */
export async function listAccountModels(signal?: AbortSignal): Promise<AccountModel[]> {
    return parseAccount(await requestAccount('/models', { signal }), accountModelsSchema).models
}

/**
 * Saves a personal connection without making any provider request.
 * @param input - Connection fields and a retained creation identifier.
 * @returns Safe saved metadata.
 * @throws Error for invalid fields, conflicting retries, or save failure.
 */
export async function createAccountModel(input: CreateAccountModel): Promise<AccountModel> {
    return parseAccount(await requestAccount('/models', mutation('POST', createAccountModelSchema.parse(input))), accountModelSchema)
}

/**
 * Edits a connection while preserving the key when the input is blank.
 * @param id - Owned stable connection identifier.
 * @param input - Current fields and optional replacement key.
 * @returns Updated safe metadata.
 * @throws Error for invalid or inaccessible connections.
 */
export async function updateAccountModel(id: string, input: UpdateAccountModel): Promise<AccountModel> {
    return parseAccount(
        await requestAccount(`/models/${encodeURIComponent(id)}`, mutation('PUT', updateAccountModelSchema.parse(input))),
        accountModelSchema
    )
}

/**
 * Chooses one saved connection for newly created general conversations and tasks.
 * @param id - Owned stable connection identifier.
 * @returns The updated default connection.
 * @throws Error when the change cannot be confirmed.
 */
export async function setDefaultAccountModel(id: string): Promise<AccountModel> {
    return parseAccount(await requestAccount(`/models/${encodeURIComponent(id)}/default`, mutation('POST', {})), accountModelSchema)
}

/**
 * Deletes a connection only after explicit UI confirmation.
 * @param id - Owned stable connection identifier.
 * @returns After confirmed deletion.
 * @throws Error when deletion cannot be confirmed.
 */
export async function deleteAccountModel(id: string): Promise<void> {
    await requestAccount(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * Explicitly tests a saved connection without creating any chat or task.
 * @param id - Owned connection selected for this test.
 * @param signal - User cancellation and unmount signal.
 * @returns Safe bounded success feedback.
 * @throws Error for authentication, provider, timeout, or cancellation failures.
 */
export async function testAccountModel(id: string, signal: AbortSignal): Promise<{ success: true; message: string }> {
    return parseAccount(
        await requestAccount(`/models/${encodeURIComponent(id)}/test`, { ...mutation('POST', {}), signal }),
        accountModelTestSchema
    )
}
