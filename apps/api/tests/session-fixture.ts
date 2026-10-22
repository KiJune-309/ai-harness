import { createHash } from 'node:crypto'
import type { ChatStore } from '@ai-harness/db'
import type { ApiConfig } from '../src/config.js'

const sessions = new WeakMap<ChatStore, Map<string, Promise<string>>>()

/**
 * Persists a fixture account and a genuine hashed session without bypassing authentication.
 * @param store - The same scoped persistence used by the tested application.
 * @param config - Trusted deployment token and workspace configuration.
 * @param identity - Stable fixture user UUID.
 * @returns Private server and opaque session headers accepted by the real guard.
 * @throws Error when account persistence or current-version session insertion is unavailable.
 */
export async function sessionHeaders(store: ChatStore, config: ApiConfig, identity: string): Promise<Record<string, string>> {
    let owned = sessions.get(store)
    if (!owned) {
        owned = new Map()
        sessions.set(store, owned)
    }
    let session = owned.get(identity)
    if (!session) {
        session = (async () => {
            if (!store.accounts) throw new Error('Fixture requires genuine account persistence.')
            const now = new Date().toISOString()
            const account = await store.accounts.getById(identity)
            if (!account)
                await store.accounts.createUser({
                    user: { id: identity, username: 'Fixture user', email: `${identity}@example.test`, createdAt: now, updatedAt: now },
                    workspaceId: config.workspaceId,
                    passwordHash: 'fixture-hash',
                    credentialVersion: 1,
                })
            const raw = createHash('sha256').update(`session-fixture:${identity}`).digest('base64url')
            const saved = await store.accounts.saveSession({
                tokenHash: createHash('sha256').update(raw).digest('hex'),
                userId: identity,
                credentialVersion: account?.credentialVersion ?? 1,
                createdAt: now,
                expiresAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
            })
            if (!saved) throw new Error('Fixture could not persist a current-version account session.')
            return raw
        })()
        owned.set(identity, session)
    }
    return { authorization: `Bearer ${config.token}`, 'x-harness-session': await session, 'content-type': 'application/json' }
}

/**
 * Registers a genuine account through an isolated process's public HTTP boundary.
 * @param baseUrl - Isolated API origin without a trailing path.
 * @param token - Private server token shared only by the test-owned process.
 * @param identity - Unique fixture label used to build a normalized email.
 * @returns The opaque session issued through the private response header.
 * @throws Error when registration or private session issuance fails.
 */
export async function registerSession(baseUrl: string, token: string, identity: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/account/register`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
            username: 'Persistence fixture',
            email: `${identity}@example.test`,
            password: 'Private-fixture-password-2026',
        }),
    })
    if (!response.ok) throw new Error(`Fixture account registration failed with HTTP ${response.status}.`)
    const session = response.headers.get('x-harness-session')
    if (!session || !/^[A-Za-z0-9_-]{43}$/.test(session)) throw new Error('Fixture registration did not issue a valid opaque session.')
    await response.body?.cancel()
    return session
}
