import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AccountConflictError, createMemoryAccountStore, type StoredAccount, type StoredAccountModel } from '../src/index.js'

const now = '2026-10-17T00:00:00.000Z'
/**
 * Creates a private account fixture with a stable workspace and non-reusable verifier.
 * @param email - Unique normalized fixture email.
 * @returns Private fixture account.
 */
function account(email: string): StoredAccount {
    return {
        user: { id: randomUUID(), username: 'Test owner', email, createdAt: now, updatedAt: now },
        workspaceId: 'personal',
        passwordHash: 'not-plaintext-password',
        credentialVersion: 1,
    }
}
/**
 * Creates a complete private model fixture without plaintext credentials.
 * @returns Independent encrypted model fixture.
 */
function model(): StoredAccountModel {
    const id = randomUUID()
    return {
        model: {
            id,
            modelId: `account:${id}`,
            name: 'Fixture model',
            baseUrl: 'https://example.com/v1',
            model: 'model-a',
            hasApiKey: true,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
        },
        encryptedApiKey: 'v1.encrypted.fixture.value',
        creationFingerprint: 'hmac-fingerprint',
    }
}

describe('account memory persistence invariants', () => {
    it('models atomic source limits and expiry for explicitly injected test persistence', async () => {
        const store = createMemoryAccountStore()
        const key = createHash('sha256').update('fixture-source').digest('hex')
        const now = Date.now()
        const results = await Promise.all(Array.from({ length: 14 }, () => store.consumeRateLimit(key, 10, 1000, now)))
        expect(results.filter(Boolean)).toHaveLength(10)
        expect(await store.consumeRateLimit(key, 10, 1000, now + 999)).toBe(false)
        expect(await store.consumeRateLimit(key, 10, 1000, now + 1000)).toBe(true)
        await expect(store.consumeRateLimit('raw-email@example.com', 10, 1000, now)).rejects.toThrow('Invalid authentication')
    })
    it('serializes failure verification, skips exhausted hashes and releases a rejected verifier', async () => {
        const store = createMemoryAccountStore()
        const key = createHash('sha256').update('fixture-email').digest('hex')
        const now = Date.now()
        const verify = vi.fn(async () => false)
        const results = await Promise.all(Array.from({ length: 14 }, () => store.verifyLogin(key, 10, 1000, now, verify)))
        expect(results.filter(result => result === 'failed')).toHaveLength(10)
        expect(results.filter(result => result === 'limited')).toHaveLength(4)
        expect(verify).toHaveBeenCalledTimes(10)
        await expect(
            store.verifyLogin(key, 10, 1000, now + 1000, async () => {
                throw new Error('Fixture verifier failed')
            })
        ).rejects.toThrow('Fixture verifier failed')
        expect(await store.verifyLogin(key, 10, 1000, now + 1000, async () => true)).toBe('verified')
        expect(await store.verifyLogin(key, 10, 1000, now + 1000, verify)).toBe('failed')
    })
    it('clears a verified email bucket without resetting an independent source bucket', async () => {
        const store = createMemoryAccountStore()
        const emailKey = createHash('sha256').update('email-fixture').digest('hex')
        const sourceKey = createHash('sha256').update('source-fixture').digest('hex')
        const now = Date.now()
        await store.consumeRateLimit(sourceKey, 1, 1000, now)
        expect(await store.verifyLogin(emailKey, 2, 1000, now, async () => false)).toBe('failed')
        expect(await store.verifyLogin(emailKey, 2, 1000, now, async () => true)).toBe('verified')
        expect(await store.verifyLogin(emailKey, 2, 1000, now, async () => false)).toBe('failed')
        expect(await store.verifyLogin(emailKey, 2, 1000, now, async () => false)).toBe('failed')
        expect(await store.consumeRateLimit(sourceKey, 1, 1000, now)).toBe(false)
    })
    it('enforces normalized global email uniqueness and never aliases returned users', async () => {
        const store = createMemoryAccountStore()
        const owner = account('ada@example.com')
        await store.createUser(owner)
        await expect(store.createUser(account(owner.user.email))).rejects.toBeInstanceOf(AccountConflictError)
        const copy = await store.getByEmail(owner.user.email)
        copy!.user.username = 'Changed externally'
        expect((await store.getById(owner.user.id))!.user.username).toBe('Test owner')
        expect(await store.getByEmail('unknown@example.com')).toBeUndefined()
    })
    it('revokes all sessions atomically on credentials and refuses a concurrent old-version session', async () => {
        const store = createMemoryAccountStore()
        const owner = account('ada@example.com')
        await store.createUser(owner)
        const session = {
            tokenHash: 'irreversible-hash',
            userId: owner.user.id,
            credentialVersion: 1,
            createdAt: now,
            expiresAt: '2026-10-24T00:00:00.000Z',
        }
        await store.saveSession(session)
        await store.saveSession({ ...session, tokenHash: 'second-hash' })
        expect(await store.getSession(session.tokenHash, now)).toEqual(owner)
        expect(await store.getSession(session.tokenHash, session.expiresAt)).toBeUndefined()
        const renamed = await store.updateUsername(owner.user.id, 'New name', now)
        expect(renamed?.id).toBe(owner.user.id)
        expect(await store.getSession(session.tokenHash, now)).toBeDefined()
        const changed = await store.updateCredentials(owner.user.id, owner.passwordHash, {
            email: 'new@example.com',
            passwordHash: 'new-private-verifier',
            now,
        })
        expect(changed).toMatchObject({ id: owner.user.id, email: 'new@example.com', username: 'New name' })
        expect(await store.getSession(session.tokenHash, now)).toBeUndefined()
        expect(await store.getSession('second-hash', now)).toBeUndefined()
        expect(await store.saveSession(session)).toBe(false)
        expect(await store.updateCredentials(owner.user.id, owner.passwordHash, { email: 'stale@example.com', now })).toBeUndefined()
        expect(await store.getByEmail('new@example.com')).toMatchObject({ credentialVersion: 2, passwordHash: 'new-private-verifier' })
    })
    it('leaves credentials and sessions unchanged when a unique email update fails', async () => {
        const store = createMemoryAccountStore()
        const first = account('one@example.com'),
            second = account('two@example.com')
        await store.createUser(first)
        await store.createUser(second)
        const session = {
            tokenHash: 'first-hash',
            userId: first.user.id,
            credentialVersion: 1,
            createdAt: now,
            expiresAt: '2026-10-24T00:00:00.000Z',
        }
        await store.saveSession(session)
        await expect(store.updateCredentials(first.user.id, first.passwordHash, { email: second.user.email, now })).rejects.toBeInstanceOf(
            AccountConflictError
        )
        expect(await store.getSession(session.tokenHash, now)).toEqual(first)
    })
    it('keeps model secrets scoped and serializes first/default selection without selecting a replacement on deletion', async () => {
        const store = createMemoryAccountStore()
        const owner = account('ada@example.com')
        await store.createUser(owner)
        const scope = { userId: owner.user.id, workspaceId: owner.workspaceId }
        const first = model(),
            second = model()
        const created = await Promise.all([store.saveModel(scope, first, true), store.saveModel(scope, second, true)])
        expect(created.filter(record => record.model.isDefault)).toHaveLength(1)
        expect(await store.getModel({ ...scope, userId: randomUUID() }, first.model.id)).toBeUndefined()
        expect(await store.getModel({ ...scope, workspaceId: 'other' }, first.model.id)).toBeUndefined()
        await Promise.all([store.setDefaultModel(scope, first.model.id, now), store.setDefaultModel(scope, second.model.id, now)])
        expect((await store.listModels(scope)).filter(record => record.model.isDefault).map(record => record.model.id)).toEqual([
            second.model.id,
        ])
        await store.saveModel(scope, {
            ...first,
            creationFingerprint: 'replacement',
            model: { ...first.model, name: 'Updated', isDefault: true },
        })
        expect(await store.getModel(scope, first.model.id)).toMatchObject({
            creationFingerprint: first.creationFingerprint,
            model: { isDefault: false, name: 'Updated' },
        })
        await store.deleteModel(scope, second.model.id)
        expect((await store.listModels(scope)).every(record => !record.model.isDefault)).toBe(true)
        await expect(store.saveModel(scope, first, true)).rejects.toBeInstanceOf(AccountConflictError)
    })
})
