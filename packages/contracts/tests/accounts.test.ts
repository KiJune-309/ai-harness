import { describe, expect, it } from 'vitest'
import {
    accountModelSchema,
    accountMeSchema,
    chatStatusSchema,
    createAccountModelSchema,
    loginAccountSchema,
    registerAccountSchema,
    updateAccountModelSchema,
    updateEmailSchema,
    updatePasswordSchema,
} from '../src/index.js'

const password = ' space-containing password '
const user = { username: '  Ada  ', email: '  ADA@example.com  ', password }
const model = {
    requestId: '92d7926a-c78a-4e75-b55d-b35f37b66a58',
    name: ' My model ',
    baseUrl: 'https://example.com/v1',
    model: ' model-a ',
    apiKey: ' private-key ',
}

describe('strict account public contracts', () => {
    it('accepts only persistent storage in account and chat availability responses', () => {
        const account = {
            id: model.requestId,
            username: 'Ada',
            email: 'ada@example.com',
            createdAt: '2026-10-17T00:00:00.000Z',
            updatedAt: '2026-10-17T00:00:00.000Z',
        }
        const status = { configured: true, model: 'deepseek-flash' }
        expect(accountMeSchema.parse({ user: account, storage: 'postgres' }).storage).toBe('postgres')
        expect(chatStatusSchema.parse({ ...status, storage: 'postgres' }).storage).toBe('postgres')
        for (const storage of ['memory', undefined, '']) {
            expect(accountMeSchema.safeParse({ user: account, storage }).success).toBe(false)
            expect(chatStatusSchema.safeParse({ ...status, storage }).success).toBe(false)
        }
    })

    it('normalizes email and display name while preserving password whitespace', () => {
        expect(registerAccountSchema.parse(user)).toEqual({ username: 'Ada', email: 'ada@example.com', password })
        expect(loginAccountSchema.parse({ email: user.email, password }).password).toBe(password)
        for (const username of ['x', 'x'.repeat(51)]) expect(registerAccountSchema.safeParse({ ...user, username }).success).toBe(false)
        for (const password of ['x'.repeat(11), 'x'.repeat(129)])
            expect(registerAccountSchema.safeParse({ ...user, password }).success).toBe(false)
        expect(registerAccountSchema.safeParse({ ...user, userId: model.requestId }).success).toBe(false)
        expect(registerAccountSchema.safeParse({ ...user, email: 'invalid' }).success).toBe(false)
    })
    it('requires current password on sensitive changes and never accepts ownership fields', () => {
        expect(updateEmailSchema.safeParse({ email: user.email }).success).toBe(false)
        expect(updateEmailSchema.parse({ email: user.email, currentPassword: password }).email).toBe('ada@example.com')
        expect(updatePasswordSchema.safeParse({ currentPassword: password, newPassword: 'short' }).success).toBe(false)
        expect(updatePasswordSchema.safeParse({ currentPassword: password, newPassword: password, userId: model.requestId }).success).toBe(
            false
        )
    })
    it('requires a write-only key on creation and permits blank retained keys on edit', () => {
        expect(createAccountModelSchema.parse(model)).toMatchObject({ name: 'My model', model: 'model-a', apiKey: 'private-key' })
        expect(createAccountModelSchema.safeParse({ ...model, apiKey: '' }).success).toBe(false)
        const update = { name: model.name, baseUrl: model.baseUrl, model: model.model }
        expect(updateAccountModelSchema.safeParse(update).success).toBe(true)
        expect(updateAccountModelSchema.parse({ ...update, apiKey: '  ' }).apiKey).toBe('')
        const publicModel = {
            ...update,
            id: model.requestId,
            modelId: `account:${model.requestId}`,
            hasApiKey: true,
            isDefault: false,
            createdAt: '2026-10-17T00:00:00.000Z',
            updatedAt: '2026-10-17T00:00:00.000Z',
        }
        expect(accountModelSchema.safeParse({ ...publicModel, apiKey: model.apiKey }).success).toBe(false)
        expect(accountModelSchema.safeParse({ ...publicModel, encryptedApiKey: 'ciphertext' }).success).toBe(false)
    })
})
