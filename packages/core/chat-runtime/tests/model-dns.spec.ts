import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup }))
import { createModelFetch } from '../src/model-connection.ts'

afterEach(() => lookup.mockReset())

describe('model DNS policy and socket pinning', () => {
    it('rejects private and mixed DNS records for public model origins before connecting', async () => {
        for (const addresses of [
            [{ address: '127.0.0.1', family: 4 }],
            [
                { address: '8.8.8.8', family: 4 },
                { address: '10.0.0.1', family: 4 },
            ],
            [{ address: '::ffff:169.254.169.254', family: 6 }],
        ]) {
            lookup.mockResolvedValueOnce(addresses)
            await expect(
                createModelFetch()('https://model.example.test/v1/chat/completions', { method: 'POST', body: '{}' })
            ).rejects.toThrow('不允许的网络')
        }
        expect(lookup).toHaveBeenCalledTimes(3)
    })

    it('pins the validated DNS address instead of resolving the hostname again at connection time', async () => {
        let host = ''
        const server = createServer((request, response) => {
            host = request.headers.host ?? ''
            response.writeHead(200, { 'content-type': 'text/plain' })
            response.end('pinned')
        })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as AddressInfo).port
        const origin = `http://approved-model.example.test:${port}`
        lookup
            .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
            .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])
        try {
            const response = await createModelFetch({ allowedLocalOrigins: [origin] })(`${origin}/v1/chat/completions`, {
                method: 'POST',
                body: '{}',
            })
            expect(await response.text()).toBe('pinned')
            expect(lookup).toHaveBeenCalledTimes(1)
            expect(host).toBe(`approved-model.example.test:${port}`)
        } finally {
            server.closeAllConnections()
            await new Promise<void>(resolve => server.close(() => resolve()))
        }
    })

    it('still rejects metadata DNS results when the administrator approved the exact local origin', async () => {
        lookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])
        const origin = 'http://approved-model.example.test:9001'
        await expect(createModelFetch({ allowedLocalOrigins: [origin] })(`${origin}/v1`, { method: 'POST', body: '{}' })).rejects.toThrow(
            '不允许的网络'
        )
    })

    it('cancels a pending DNS resolution without waiting for its deadline', async () => {
        lookup.mockReturnValue(new Promise(() => undefined))
        const controller = new AbortController()
        const pending = createModelFetch()('https://model.example.test/v1', { method: 'POST', body: '{}', signal: controller.signal })
        controller.abort()
        await expect(pending).rejects.toThrow('已取消')
    })
})
