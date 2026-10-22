import { randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createMemoryChatStore, type ChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../src/app.js'
import { hashAccountPassword, hashAccountSession } from '../src/account-service.js'
import { readTestApiConfig as readApiConfig } from './config-fixture.js'

const config = readApiConfig({ HARNESS_API_TOKEN: 'private-account-http-token-at-least-32-bytes', CHAT_STORE: 'memory' })
const apps: NestExpressApplication[] = []
const password = 'Correct account password'
let verifier: string
beforeAll(async () => {
    verifier = await hashAccountPassword(password)
})
afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

/**
 * Starts the actual guarded API with isolated account persistence and an explicit tester.
 * @param tester - Controlled provider callback whose arguments remain private.
 * @returns Actual API address and shared test persistence.
 */
async function start(tester = vi.fn(async () => {})): Promise<{ base: string; store: ChatStore }> {
    const store = await createMemoryChatStore()
    const app = await createApiApp(config, { store, logger: false, testAccountModel: tester })
    apps.push(app)
    await app.listen(0, '127.0.0.1')
    return { base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`, store }
}
/**
 * Constructs the private BFF credential and optional genuine account session.
 * @param session - Opaque server-issued session.
 * @returns Private HTTP request headers.
 */
function headers(session?: string): Record<string, string> {
    return {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        ...(session ? { 'x-harness-session': session } : {}),
    }
}
/**
 * Seeds real hashed-session records to avoid repeating expensive fixture registration.
 * @param store - Test persistence used by the actual API guard.
 * @returns Account scope and non-reusable browser session.
 */
async function seed(store: ChatStore) {
    const id = randomUUID(),
        session = randomBytes(32).toString('base64url'),
        now = new Date().toISOString()
    await store.accounts!.createUser({
        user: { id, username: 'Account owner', email: `${id}@example.com`, createdAt: now, updatedAt: now },
        passwordHash: verifier,
        credentialVersion: 1,
        workspaceId: config.workspaceId,
    })
    await store.accounts!.saveSession({
        tokenHash: hashAccountSession(session),
        userId: id,
        credentialVersion: 1,
        createdAt: now,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
    })
    return { id, session }
}

describe('account HTTP boundary and real session guard', () => {
    it('requires the private server token even on registration and rejects user-header impersonation', async () => {
        const { base, store } = await start()
        const owner = await seed(store)
        const registration = { username: 'Ada', email: 'ada@example.com', password }
        expect(
            (
                await fetch(`${base}/account/register`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(registration),
                })
            ).status
        ).toBe(401)
        for (const candidate of [
            headers(),
            { ...headers(), 'x-harness-user-id': owner.id, 'x-harness-workspace-id': config.workspaceId },
            headers('forged-session'),
        ]) {
            expect((await fetch(`${base}/account/me`, { headers: candidate })).status).toBe(401)
            expect((await fetch(`${base}/chat/conversations`, { headers: candidate })).status).toBe(401)
        }
        const me = await fetch(`${base}/account/me`, {
            headers: { ...headers(owner.session), 'x-harness-user-id': randomUUID(), 'x-harness-workspace-id': 'forged' },
        })
        expect(me.status).toBe(200)
        expect(await me.json()).toMatchObject({ user: { id: owner.id }, storage: 'postgres' })
        const expired = randomBytes(32).toString('base64url')
        await store.accounts!.saveSession({
            tokenHash: hashAccountSession(expired),
            userId: owner.id,
            credentialVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-01-02T00:00:00.000Z',
        })
        expect((await fetch(`${base}/account/me`, { headers: headers(expired) })).status).toBe(401)
    })
    it('returns session only in a private header and revokes it on logout', async () => {
        const { base } = await start()
        const registration = { username: ' Ada ', email: ' ADA@example.com ', password }
        const registered = await fetch(`${base}/account/register`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(registration),
        })
        expect(registered.status).toBe(201)
        const session = registered.headers.get('x-harness-session')!
        expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/)
        const body = await registered.json()
        expect(body).toMatchObject({ username: 'Ada', email: 'ada@example.com' })
        expect(JSON.stringify(body)).not.toContain(session)
        expect(JSON.stringify(body)).not.toContain('password')
        const renamed = await fetch(`${base}/account/username`, {
            method: 'PUT',
            headers: headers(session),
            body: JSON.stringify({ username: 'Grace' }),
        })
        expect((await renamed.json()).username).toBe('Grace')
        expect((await fetch(`${base}/account/logout`, { method: 'POST', headers: headers(session) })).ok).toBe(true)
        expect((await fetch(`${base}/account/me`, { headers: headers(session) })).status).toBe(401)
        const login = await fetch(`${base}/account/login`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ email: 'ADA@example.com', password }),
        })
        expect(login.status).toBe(201)
        expect((await login.json()).id).toBe(body.id)
    })
    it('keeps model CRUD private, never tests on save and does not leak provider failures', async () => {
        const test = vi.fn(async () => {
            throw new Error('private-key raw-provider-secret')
        })
        const { base, store } = await start(test)
        const first = await seed(store),
            second = await seed(store)
        const input = {
            requestId: randomUUID(),
            name: 'Private model',
            baseUrl: 'https://example.com/v1',
            model: 'example-chat',
            apiKey: 'private-key',
        }
        const created = await fetch(`${base}/account/models`, {
            method: 'POST',
            headers: headers(first.session),
            body: JSON.stringify(input),
        })
        expect(created.status).toBe(201)
        const model = await created.json()
        expect(model).toMatchObject({ id: input.requestId, isDefault: true, hasApiKey: true })
        expect(JSON.stringify(model)).not.toContain('private-key')
        expect(test).not.toHaveBeenCalled()
        for (const method of ['GET', 'PUT', 'DELETE']) {
            const path = `${base}/account/models/${model.id}`
            const response = await fetch(path, {
                method,
                headers: headers(second.session),
                ...(method === 'PUT' ? { body: JSON.stringify({ name: 'foreign', baseUrl: input.baseUrl, model: input.model }) } : {}),
            })
            expect(response.status).toBe(404)
        }
        expect((await fetch(`${base}/account/models/${model.id}/test`, { method: 'POST', headers: headers(second.session) })).status).toBe(
            404
        )
        expect(test).not.toHaveBeenCalled()
        const failure = await fetch(`${base}/account/models/${model.id}/test`, { method: 'POST', headers: headers(first.session) })
        expect(failure.status).toBe(400)
        const message = await failure.text()
        expect(message).not.toContain('private-key')
        expect(message).not.toContain('raw-provider-secret')
        expect(test).toHaveBeenCalledOnce()
        const tasks = await fetch(`${base}/chat/tasks`, { headers: headers(first.session) })
        expect(await tasks.json()).toEqual({ tasks: [] })
        expect((await fetch(`${base}/account/models/${model.id}`, { method: 'DELETE', headers: headers(first.session) })).ok).toBe(true)
        expect((await fetch(`${base}/account/models/${model.id}`, { headers: headers(first.session) })).status).toBe(404)
    })
    it('preserves an authenticated session on wrong current password and revokes all sessions on success', async () => {
        const { base, store } = await start()
        const owner = await seed(store)
        const otherSession = randomBytes(32).toString('base64url')
        const now = new Date().toISOString()
        await store.accounts!.saveSession({
            tokenHash: hashAccountSession(otherSession),
            userId: owner.id,
            credentialVersion: 1,
            createdAt: now,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
        })
        const path = `${base}/account/email`
        const wrong = await fetch(path, {
            method: 'PUT',
            headers: headers(owner.session),
            body: JSON.stringify({ email: 'new@example.com', currentPassword: 'Incorrect password' }),
        })
        expect(wrong.status).toBe(400)
        expect((await fetch(`${base}/account/me`, { headers: headers(owner.session) })).status).toBe(200)
        const correct = await fetch(path, {
            method: 'PUT',
            headers: headers(owner.session),
            body: JSON.stringify({ email: 'new@example.com', currentPassword: password }),
        })
        expect(correct.status).toBe(200)
        for (const session of [owner.session, otherSession])
            expect((await fetch(`${base}/account/me`, { headers: headers(session) })).status).toBe(401)
    })
})
