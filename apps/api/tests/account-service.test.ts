import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryChatStore, type ChatScope, type ChatStore } from '@ai-harness/db'
import { AccountService, hashAccountPassword, hashAccountRateLimit, hashAccountSession } from '../src/account-service.js'
import { readTestApiConfig as readApiConfig } from './config-fixture.js'
import { readApiConfig as readProductionApiConfig } from '../src/config.js'

const password = 'Correct account password '
const config = readApiConfig({ HARNESS_API_TOKEN: 'private-account-test-token-at-least-32-bytes', CHAT_STORE: 'memory' })
let verifier: string
beforeAll(async () => {
    verifier = await hashAccountPassword(password)
})

/**
 * Seeds an account directly while retaining actual password and session validation.
 * @param store - Explicit in-memory test persistence.
 * @param email - Optional unique fixture email.
 * @returns Trusted ownership scope and initial private session.
 */
async function seed(store: ChatStore, email = `${randomUUID()}@example.com`): Promise<{ scope: ChatScope; session: string }> {
    const userId = randomUUID(),
        session = Buffer.from(randomUUID().replaceAll('-', '')).toString('base64url').slice(0, 43)
    const now = new Date().toISOString()
    await store.accounts!.createUser({
        user: { id: userId, username: 'Test owner', email, createdAt: now, updatedAt: now },
        workspaceId: config.workspaceId,
        passwordHash: verifier,
        credentialVersion: 1,
    })
    await store.accounts!.saveSession({
        tokenHash: hashAccountSession(session),
        userId,
        credentialVersion: 1,
        createdAt: now,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
    })
    return { scope: { userId, workspaceId: config.workspaceId }, session }
}
/**
 * Builds normalized model creation parameters with a stable retry identity.
 * @param changes - Candidate field overrides.
 * @returns Private write-only model input.
 */
function input(changes = {}) {
    return {
        requestId: randomUUID(),
        name: 'My model',
        baseUrl: 'https://example.com/v1',
        model: 'model-a',
        apiKey: 'private-model-key',
        ...changes,
    }
}

describe('real account coordination', () => {
    it('shares private source limits across service instances without storing email or address identities', async () => {
        const store = createMemoryChatStore()
        const first = new AccountService(store.accounts, config)
        const second = new AccountService(store.accounts, config)
        const consume = vi.spyOn(store.accounts!, 'consumeRateLimit')
        try {
            for (let index = 0; index < 10; index++)
                await expect(
                    (index % 2 ? first : second).register({ username: 'x', email: 'invalid', password: 'short' }, 'private-fixture-source')
                ).rejects.toMatchObject({ status: 400 })
            await expect(
                second.register({ username: 'x', email: 'invalid', password: 'short' }, 'private-fixture-source')
            ).rejects.toMatchObject({ status: 429 })
            expect(consume.mock.calls.every(([key]) => /^[a-f0-9]{64}$/.test(key))).toBe(true)
            expect(JSON.stringify(consume.mock.calls)).not.toContain('private-fixture-source')
            const secret = Buffer.from(config.accountEncryptionKey!, 'hex')
            expect(consume.mock.calls[0]![0]).toBe(hashAccountRateLimit('register:private-fixture-source', config.workspaceId, secret))
            expect(hashAccountRateLimit('register:private-fixture-source', 'other-workspace', secret)).not.toBe(consume.mock.calls[0]![0])
        } finally {
            await store.close()
        }
    })
    it('clears only a verified email failure bucket and fails closed when persistent frequency checks fail', async () => {
        const store = createMemoryChatStore()
        const service = new AccountService(store.accounts, config)
        const email = `${randomUUID()}@example.com`
        const { scope } = await seed(store, email)
        const now = Date.now()
        const secret = Buffer.from(config.accountEncryptionKey!, 'hex')
        const emailKey = hashAccountRateLimit(`failed:${email}`, config.workspaceId, secret)
        const sourceKey = hashAccountRateLimit('login:near-limit-source', config.workspaceId, secret)
        try {
            for (let index = 0; index < 9; index++) await store.accounts!.verifyLogin(emailKey, 10, 15 * 60 * 1000, now, async () => false)
            for (let index = 0; index < 59; index++) await store.accounts!.consumeRateLimit(sourceKey, 60, 15 * 60 * 1000, now)
            expect((await service.login({ email, password }, 'near-limit-source')).user.id).toBe(scope.userId)
            await expect(service.login({ email, password }, 'near-limit-source')).rejects.toMatchObject({ status: 429 })
            for (let index = 0; index < 10; index++)
                expect(await store.accounts!.verifyLogin(emailKey, 10, 15 * 60 * 1000, now, async () => false)).toBe('failed')
            await expect(service.login({ email, password }, 'new-source')).rejects.toMatchObject({ status: 429 })
            const save = vi.spyOn(store.accounts!, 'saveSession')
            const verification = vi.spyOn(store.accounts!, 'verifyLogin').mockRejectedValue(new Error('private database outage'))
            await expect(service.login({ email, password }, 'another-source')).rejects.toMatchObject({ status: 503 })
            expect(save).not.toHaveBeenCalled()
            verification.mockRestore()
            vi.spyOn(store.accounts!, 'consumeRateLimit').mockRejectedValue(new Error('private database outage'))
            const create = vi.spyOn(store.accounts!, 'createUser')
            await expect(service.register({ username: 'New owner', email: 'new@example.com', password })).rejects.toMatchObject({
                status: 503,
            })
            expect(create).not.toHaveBeenCalled()
        } finally {
            await store.close()
        }
    })
    it('stores salted scrypt and token hashes and returns public stable users', async () => {
        const store = await createMemoryChatStore()
        const service = new AccountService(store.accounts, config)
        const created = await service.register({ username: ' Ada ', email: ' ADA@example.com ', password })
        const account = await store.accounts!.getByEmail('ada@example.com')
        expect(created.user).toMatchObject({ username: 'Ada', email: 'ada@example.com' })
        expect(account!.passwordHash).toMatch(/^scrypt\$131072\$8\$1\$/)
        expect(account!.passwordHash).not.toContain(password)
        expect(JSON.stringify(created.user)).not.toContain('password')
        const scope = await service.authenticate(created.session)
        expect(scope?.userId).toBe(created.user.id)
        expect(await service.authenticate('forged')).toBeUndefined()
        await service.logout(created.session)
        expect(await service.authenticate(created.session)).toBeUndefined()
        const login = await service.login({ email: 'Ada@Example.com', password })
        expect(login.user.id).toBe(created.user.id)
        expect(login.session).not.toBe(created.session)
        await expect(service.login({ email: 'missing@example.com', password })).rejects.toThrow('邮箱或密码不正确')
        await expect(service.login({ email: 'ada@example.com', password: 'Wrong account password' })).rejects.toThrow('邮箱或密码不正确')
        await store.close()
    })
    it('atomically revokes both sessions after email and password changes while failed changes preserve them', async () => {
        const store = await createMemoryChatStore()
        const service = new AccountService(store.accounts, config)
        const first = await seed(store, 'one@example.com')
        await seed(store, 'two@example.com')
        const second = await service.login({ email: 'one@example.com', password })
        await expect(service.updateEmail(first.scope, { email: 'two@example.com', currentPassword: password })).rejects.toThrow(
            '邮箱已被使用'
        )
        await expect(service.updateEmail(first.scope, { email: 'new@example.com', currentPassword: 'Wrong old password' })).rejects.toThrow(
            '当前密码不正确'
        )
        expect(await service.authenticate(first.session)).toEqual(first.scope)
        await service.updateUsername(first.scope, { username: 'Updated owner' })
        expect((await service.user(first.scope)).username).toBe('Updated owner')
        await service.updateEmail(first.scope, { email: 'new@example.com', currentPassword: password })
        expect(await service.authenticate(first.session)).toBeUndefined()
        expect(await service.authenticate(second.session)).toBeUndefined()
        await expect(service.login({ email: 'one@example.com', password })).rejects.toThrow('邮箱或密码不正确')
        const fresh = await service.login({ email: 'new@example.com', password })
        await service.updatePassword(first.scope, { currentPassword: password, newPassword: 'New correct account password' })
        expect(await service.authenticate(fresh.session)).toBeUndefined()
        await expect(service.login({ email: 'new@example.com', password })).rejects.toThrow('邮箱或密码不正确')
        expect((await service.login({ email: 'new@example.com', password: 'New correct account password' })).user.id).toBe(
            first.scope.userId
        )
        await store.close()
    })
    it('persists only encrypted model keys, supports idempotent creation and preserves empty edited keys', async () => {
        const store = await createMemoryChatStore()
        const test = vi.fn(async () => {})
        const service = new AccountService(store.accounts, config, test)
        const { scope } = await seed(store)
        const fields = input()
        const first = await service.createModel(scope, fields)
        expect(first.isDefault).toBe(true)
        expect(await service.createModel(scope, fields)).toEqual(first)
        expect(await service.listModels(scope)).toHaveLength(1)
        await expect(service.createModel(scope, { ...fields, name: 'different action' })).rejects.toThrow('其他配置')
        const record = await store.accounts!.getModel(scope, first.id)
        expect(JSON.stringify(record)).not.toContain(fields.apiKey)
        expect(record!.encryptedApiKey).toMatch(/^v1\./)
        const update = { name: 'Changed model', baseUrl: 'https://provider.example.com/api', model: 'model-b', apiKey: ' ' }
        await service.updateModel(scope, first.id, update)
        expect((await service.getModel(scope, first.id))!.apiKey).toBe(fields.apiKey)
        await service.updateModel(scope, first.id, { ...update, apiKey: 'new-private-key' })
        expect(await service.getModel(scope, first.id)).toMatchObject({
            apiKey: 'new-private-key',
            public: { model: 'model-b', baseUrl: update.baseUrl },
        })
        expect(test).not.toHaveBeenCalled()
        expect((await service.createModel(scope, fields)).name).toBe('Changed model')
        await service.testModel(scope, first.id)
        expect(test).toHaveBeenCalledWith({ apiKey: 'new-private-key', model: 'model-b', baseUrl: update.baseUrl }, expect.any(AbortSignal))
        expect(JSON.stringify(await service.listModels(scope))).not.toContain('private-key')
        await store.close()
    })
    it('enforces user/workspace isolation and AES authenticated ownership binding', async () => {
        const store = await createMemoryChatStore()
        const test = vi.fn(async () => {})
        const service = new AccountService(store.accounts, config, test)
        const first = await seed(store),
            second = await seed(store)
        const saved = await service.createModel(first.scope, input())
        expect(await service.listModels(second.scope)).toEqual([])
        expect(await service.getModel(second.scope, saved.id)).toBeUndefined()
        await expect(service.testModel(second.scope, saved.id)).rejects.toThrow('未找到')
        await expect(service.deleteModel(second.scope, saved.id)).rejects.toThrow('未找到')
        await expect(service.getModel({ ...first.scope, workspaceId: 'foreign' }, saved.id)).rejects.toThrow('登录已失效')
        const stolen = await store.accounts!.getModel(first.scope, saved.id)
        await store.accounts!.saveModel(second.scope, stolen!, true)
        await expect(service.getModel(second.scope, saved.id)).rejects.toThrow('模型凭据不可用')
        expect(test).not.toHaveBeenCalled()
        await store.close()
    })
    it('serializes defaults, preserves deletion semantics, and rejects forbidden URLs before any transport', async () => {
        const store = await createMemoryChatStore()
        const service = new AccountService(store.accounts, config)
        const { scope } = await seed(store)
        for (const baseUrl of [
            'http://127.0.0.1:3000',
            'https://169.254.169.254',
            'https://user:secret@example.com',
            'https://example.com/?key=secret',
            'https://example.com/#secret',
        ])
            await expect(service.createModel(scope, input({ baseUrl }))).rejects.toThrow('安全要求')
        const first = await service.createModel(scope, input())
        const second = await service.createModel(scope, input())
        await Promise.all([service.setDefaultModel(scope, first.id), service.setDefaultModel(scope, second.id)])
        expect((await service.listModels(scope)).filter(model => model.isDefault).map(model => model.id)).toEqual([second.id])
        await service.deleteModel(scope, second.id)
        expect(await service.defaultModel(scope)).toBeUndefined()
        expect(await service.getModel(scope, first.id)).toBeDefined()
        await store.close()
    })
    it('redacts provider errors and reports cancellation without returning secrets', async () => {
        const store = await createMemoryChatStore()
        const { scope } = await seed(store)
        const service = new AccountService(store.accounts, config, async () => {
            throw new Error('private-model-key provider raw secret response')
        })
        const saved = await service.createModel(scope, input())
        await expect(service.testModel(scope, saved.id)).rejects.toThrow('连接测试失败')
        try {
            await service.testModel(scope, saved.id)
        } catch (error) {
            expect(String(error)).not.toContain('private-model-key')
        }
        const cancelled = new AbortController()
        cancelled.abort()
        await expect(service.testModel(scope, saved.id, cancelled.signal)).rejects.toThrow('已取消')
        await store.close()
    })
    it('enforces the declared source request limits before expensive hashing', async () => {
        const store = await createMemoryChatStore()
        const service = new AccountService(store.accounts, config)
        for (let index = 0; index < 10; index++)
            await expect(service.register({ username: 'x', email: 'invalid', password: 'short' }, 'same-source')).rejects.toMatchObject({
                status: 400,
            })
        await expect(service.register({ username: 'x', email: 'invalid', password: 'short' }, 'same-source')).rejects.toMatchObject({
            status: 429,
        })
        for (let index = 0; index < 60; index++)
            await expect(service.login({ email: 'invalid', password: 'short' }, 'login-source')).rejects.toMatchObject({ status: 400 })
        await expect(service.login({ email: 'invalid', password: 'short' }, 'login-source')).rejects.toMatchObject({ status: 429 })
        await store.close()
    })
    it('limits ten failed email verifications across different sources and permits retry after the window', async () => {
        const store = await createMemoryChatStore()
        const service = new AccountService(store.accounts, config)
        const input = { email: 'email-rate-fixture@example.com', password: 'Incorrect fixture password' }
        try {
            for (let index = 0; index < 10; index++)
                await expect(service.login(input, `independent-source-${index}`)).rejects.toMatchObject({ status: 401 })
            await expect(service.login(input, 'another-source')).rejects.toMatchObject({ status: 429 })
            const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 60 * 1000 + 1)
            try {
                await expect(service.login(input, 'after-window-source')).rejects.toMatchObject({ status: 401 })
            } finally {
                clock.mockRestore()
            }
        } finally {
            await store.close()
        }
    }, 15000)
    it('rejects unsafe persistent and production startup configuration', () => {
        expect(() => readProductionApiConfig({ HARNESS_API_TOKEN: config.token, NODE_ENV: 'production' })).toThrow('PostgreSQL')
        expect(() => readProductionApiConfig({ HARNESS_API_TOKEN: config.token, DATABASE_URL: 'postgresql://fixture' })).toThrow(
            'ACCOUNT_ENCRYPTION_KEY'
        )
        expect(() =>
            readProductionApiConfig({
                HARNESS_API_TOKEN: config.token,
                DATABASE_URL: config.databaseUrl,
                ACCOUNT_ENCRYPTION_KEY: 'invalid',
            })
        ).toThrow('64 hexadecimal')
    })
})
