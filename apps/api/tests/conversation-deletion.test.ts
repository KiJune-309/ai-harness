import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createMemoryChatStore } from '@ai-harness/db'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

const apps: NestExpressApplication[] = []
afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

describe('ordinary conversation deletion API', () => {
    it('requires the real owner, gives an idempotent receipt and removes the chat from reads', async () => {
        const config = readTestApiConfig({ HARNESS_API_TOKEN: 'isolated-conversation-deletion-server-token', CHAT_STORE: 'memory' })
        const store = createMemoryChatStore()
        const app = await createApiApp(config, { store, logger: false })
        apps.push(app)
        await app.listen(0, '127.0.0.1')
        const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/chat/conversations`
        const owner = await sessionHeaders(store, config, randomUUID())
        const foreign = await sessionHeaders(store, config, randomUUID())
        const created = await fetch(base, { method: 'POST', headers: owner, body: '{}' })
        const chat = (await created.json()) as { id: string }
        expect(created.status).toBe(201)
        expect((await fetch(`${base}/${chat.id}`, { method: 'DELETE', headers: foreign })).status).toBe(404)
        expect((await fetch(`${base}/${chat.id}`, { method: 'DELETE' })).status).toBe(401)
        expect((await fetch(`${base}/not-a-uuid`, { method: 'DELETE', headers: owner })).status).toBe(400)
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const removed = await fetch(`${base}/${chat.id}`, { method: 'DELETE', headers: owner })
            expect(removed.status).toBe(200)
            expect(await removed.json()).toEqual({ id: chat.id, deleted: true })
        }
        expect((await fetch(`${base}/${chat.id}`, { headers: owner })).status).toBe(404)
        expect(await (await fetch(base, { headers: owner })).json()).toEqual({ conversations: [] })
    })
})
