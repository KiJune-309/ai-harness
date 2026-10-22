import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    createAccountModel,
    deleteAccountModel,
    getAccount,
    listAccountModels,
    loginAccount,
    logoutAccount,
    registerAccount,
    safeReturnTo,
    setDefaultAccountModel,
    testAccountModel,
    updateAccountEmail,
    updateAccountModel,
    updateAccountPassword,
    updateAccountUsername,
} from '../../lib/account-client'
import { notifyAccountChange } from '../../lib/account-session'

vi.mock('../../lib/account-session', () => ({ notifyAccountChange: vi.fn() }))

const id = '55f986a5-a69c-4443-8c71-e6a5fc8e845d'
const time = '2026-10-17T08:00:00.000Z'
const user = { id, username: '工作伙伴', email: 'reader@example.com', createdAt: time, updatedAt: time }
const fields = { name: '我的模型', baseUrl: 'https://provider.example/v1', model: 'custom-model' }
const model = { ...fields, id, modelId: `account:${id}`, hasApiKey: true, isDefault: true, createdAt: time, updatedAt: time }
const fetcher = vi.fn<typeof fetch>()

beforeEach(() => {
    fetcher.mockReset()
    vi.mocked(notifyAccountChange).mockClear()
    vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

describe('account client', () => {
    it('announces identity changes only after confirmed successful account mutations', async () => {
        fetcher.mockImplementation(async () => Response.json(user))
        await registerAccount({ username: user.username, email: user.email, password: 'long-password' })
        await loginAccount({ email: user.email, password: 'long-password' })
        await logoutAccount()
        await updateAccountEmail({ email: 'next@example.com', currentPassword: 'long-password' })
        await updateAccountPassword({ currentPassword: 'long-password', newPassword: 'replacement-password' })
        expect(notifyAccountChange).toHaveBeenCalledTimes(5)
        expect(vi.mocked(notifyAccountChange).mock.calls.every(args => args.length === 0)).toBe(true)
        fetcher.mockResolvedValueOnce(Response.json({ message: '保存失败。' }, { status: 400 }))
        await expect(updateAccountEmail({ email: 'next@example.com', currentPassword: 'long-password' })).rejects.toThrow('保存失败')
        expect(notifyAccountChange).toHaveBeenCalledTimes(5)
        await updateAccountUsername({ username: '新的用户名' })
        expect(notifyAccountChange).toHaveBeenCalledTimes(5)
    })
    it('accepts only safe internal return destinations', () => {
        for (const value of [
            null,
            'https://evil.example',
            '//evil.example',
            '/\\evil.example',
            '/\nevil',
            '/login?returnTo=/',
            '/register',
        ])
            expect(safeReturnTo(value)).toBe('/')
        expect(safeReturnTo('/account#models')).toBe('/account#models')
        expect(safeReturnTo('/inbox?search=one#goal')).toBe('/inbox?search=one#goal')
    })

    it('validates public profile and metadata without accepting private fields', async () => {
        fetcher
            .mockResolvedValueOnce(Response.json({ user, storage: 'postgres' }))
            .mockResolvedValueOnce(Response.json({ models: [model] }))
            .mockResolvedValueOnce(Response.json({ models: [{ ...model, apiKey: 'should-never-return' }] }))
        const signal = new AbortController().signal
        await expect(getAccount(signal)).resolves.toEqual({ user, storage: 'postgres' })
        await expect(listAccountModels()).resolves.toEqual([model])
        await expect(listAccountModels()).rejects.toThrow('无效的数据')
        expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', signal: expect.any(AbortSignal) })
    })

    it('rejects temporary account storage instead of presenting it as durable', async () => {
        fetcher.mockResolvedValueOnce(Response.json({ user, storage: 'memory' }))
        await expect(getAccount()).rejects.toThrow('无效的数据')
    })

    it('normalizes registration and login email while preserving password spaces', async () => {
        fetcher.mockImplementation(async () => Response.json(user))
        await registerAccount({ username: ' 工作伙伴 ', email: ' Reader@Example.com ', password: '  long-password  ' })
        await loginAccount({ email: 'READER@example.com', password: '  long-password  ' })
        expect(fetcher).toHaveBeenNthCalledWith(
            1,
            '/api/account/register',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ username: user.username, email: user.email, password: '  long-password  ' }),
            })
        )
        expect(fetcher).toHaveBeenNthCalledWith(
            2,
            '/api/account/login',
            expect.objectContaining({ body: JSON.stringify({ email: user.email, password: '  long-password  ' }) })
        )
    })

    it('retains the exact creation action and sends blank edit key as preservation', async () => {
        fetcher
            .mockRejectedValueOnce(new TypeError('network'))
            .mockResolvedValueOnce(Response.json(model))
            .mockResolvedValueOnce(Response.json(model))
        const input = { ...fields, requestId: id, apiKey: 'private-key-for-request' }
        await expect(createAccountModel(input)).rejects.toThrow('暂时无法连接')
        await expect(createAccountModel(input)).resolves.toEqual(model)
        await updateAccountModel(id, { ...fields, apiKey: '' })
        expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body)
        expect(fetcher).toHaveBeenLastCalledWith(
            `/api/account/models/${id}`,
            expect.objectContaining({ method: 'PUT', body: JSON.stringify({ ...fields, apiKey: '' }) })
        )
    })

    it('uses explicit default, test and deletion endpoints without sending credentials again', async () => {
        fetcher
            .mockResolvedValueOnce(Response.json(model))
            .mockResolvedValueOnce(Response.json({ success: true, message: '连接测试成功。' }))
            .mockResolvedValueOnce(Response.json({ success: true }))
        await expect(setDefaultAccountModel(id)).resolves.toEqual(model)
        await expect(testAccountModel(id, new AbortController().signal)).resolves.toEqual({ success: true, message: '连接测试成功。' })
        await deleteAccountModel(id)
        expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
            `/api/account/models/${id}/default`,
            `/api/account/models/${id}/test`,
            `/api/account/models/${id}`,
        ])
        expect(fetcher.mock.calls[2]?.[1]?.method).toBe('DELETE')
        expect(fetcher.mock.calls[1]?.[1]?.body).toBe('{}')
    })

    it('updates profile and sensitive credentials only through validated mutations', async () => {
        fetcher.mockImplementation(async () => Response.json(user))
        await updateAccountUsername({ username: user.username })
        await updateAccountEmail({ email: 'next@example.com', currentPassword: 'current-password' })
        await updateAccountPassword({ currentPassword: 'current-password', newPassword: 'replacement-password' })
        expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/account/username', '/api/account/email', '/api/account/password'])
        await expect(updateAccountPassword({ currentPassword: 'current-password', newPassword: 'short' })).rejects.toThrow()
        expect(fetcher).toHaveBeenCalledTimes(3)
    })

    it('announces private session loss without treating a rejected login as session loss', async () => {
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { dispatchEvent })
        fetcher.mockImplementation(async () => Response.json({ message: '请重新登录。' }, { status: 401 }))
        await expect(loginAccount({ email: user.email, password: 'wrong-password' })).rejects.toMatchObject({ status: 401 })
        expect(dispatchEvent).not.toHaveBeenCalled()
        await expect(getAccount()).rejects.toMatchObject({ status: 401 })
        expect(dispatchEvent).toHaveBeenCalledOnce()
        expect(dispatchEvent.mock.calls[0]?.[0]?.type).toBe('harness:unauthorized')
    })

    it('supports caller cancellation and safe non-JSON errors', async () => {
        const controller = new AbortController()
        const aborted = new DOMException('Cancelled', 'AbortError')
        fetcher
            .mockImplementationOnce(async () => {
                controller.abort()
                throw aborted
            })
            .mockResolvedValueOnce(new Response('<html>failure</html>', { status: 502 }))
        await expect(testAccountModel(id, controller.signal)).rejects.toBe(aborted)
        await expect(listAccountModels()).rejects.toThrow('账户服务请求失败（502）')
    })
})
