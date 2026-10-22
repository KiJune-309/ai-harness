import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createMemoryChatStore } from '@ai-harness/db'
import {
    accountModelSchema,
    agentDefinitionSchema,
    chatConversationSchema,
    personalTaskSchema,
    templateLaunchResultSchema,
} from '@ai-harness/contracts'
import { describe, expect, it } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig as readApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

interface RecordedCall {
    path: string
    key: string
    body: { model: string; messages: { role: string; content: string }[] }
}

/**
 * Start an actual provider and account-authenticated API with recorded model requests.
 * @returns Scoped HTTP actions, observed provider calls, and resource cleanup.
 */
async function harness() {
    const calls: RecordedCall[] = []
    const provider = createServer(async (request, response) => {
        let text = ''
        for await (const chunk of request) text += chunk.toString()
        const body = JSON.parse(text) as RecordedCall['body']
        calls.push({ path: request.url ?? '', key: request.headers.authorization ?? '', body })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${body.model} answered` }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
        )
    })
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
    const store = await createMemoryChatStore()
    const config = readApiConfig({
        HARNESS_API_TOKEN: 'sf005-private-routing-fixture-token-2026',
        CHAT_STORE: 'memory',
        OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
    })
    const app = await createApiApp(config, { store, logger: false })
    await app.listen(0, '127.0.0.1')
    const api = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`
    const owner = randomUUID()
    /**
     * Send a real private request through the actual account session guard.
     * @param path - Account or chat resource under /api.
     * @param body - Optional mutation payload.
     * @param method - HTTP operation.
     * @param user - Fixture account whose real persisted session authorizes the request.
     * @returns The raw API response.
     */
    async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', user = owner): Promise<Response> {
        return fetch(`${api}/${path}`, {
            method,
            headers: await sessionHeaders(store, config, user),
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
    }
    /**
     * Close only resources created by this test harness.
     * @returns Fulfillment after the API and provider have stopped.
     */
    async function close(): Promise<void> {
        await app.close()
        provider.closeAllConnections()
        await new Promise<void>(resolve => provider.close(() => resolve()))
    }
    return { calls, origin, owner, request, close }
}

describe('account-owned models through real Cordis HTTP execution', () => {
    it('freezes default routes, resolves complete current connection updates, and refuses deleted references without fallback', async () => {
        const fixture = await harness()
        const { request, calls, origin } = fixture
        try {
            const inputA = { requestId: randomUUID(), name: 'My A', baseUrl: `${origin}/a/v1`, model: 'model-A', apiKey: 'private-key-A' }
            const a = accountModelSchema.parse(await (await request('account/models', inputA)).json())
            const b = accountModelSchema.parse(
                await (
                    await request('account/models', {
                        requestId: randomUUID(),
                        name: 'My B',
                        baseUrl: `${origin}/b/v1`,
                        model: 'model-B',
                        apiKey: 'private-key-B',
                    })
                ).json()
            )
            expect(a.isDefault).toBe(true)
            expect(b.isDefault).toBe(false)
            expect(calls).toHaveLength(0)
            const chat = chatConversationSchema.parse(await (await request('chat/conversations', {})).json())
            expect(chat.agent?.modelId).toBe(a.modelId)
            const task = personalTaskSchema.parse(
                await (await request('chat/tasks', { requestId: randomUUID(), title: 'A task', goal: 'KEEP_GOAL_A' })).json()
            )
            expect(task.agent.modelId).toBe(a.modelId)
            expect((await request(`account/models/${b.id}/default`, {})).ok).toBe(true)
            const secondChat = chatConversationSchema.parse(await (await request('chat/conversations', {})).json())
            expect(secondChat.agent?.modelId).toBe(b.modelId)
            const first = await request(`chat/conversations/${chat.id}/messages`, { requestId: randomUUID(), content: 'KEEP_HISTORY_A' })
            expect(await first.text()).toContain('model-A answered')
            expect(calls.at(-1)).toMatchObject({ path: '/a/v1/chat/completions', key: 'Bearer private-key-A', body: { model: 'model-A' } })
            expect(
                (
                    await request(
                        `account/models/${a.id}`,
                        { name: 'A updated', baseUrl: `${origin}/a2/v1`, model: 'model-A2', apiKey: 'private-key-A2' },
                        'PUT'
                    )
                ).ok
            ).toBe(true)
            expect(calls).toHaveLength(1)
            const continued = await request(`chat/conversations/${chat.id}/messages`, { requestId: randomUUID(), content: 'Continue A' })
            expect(await continued.text()).toContain('model-A2 answered')
            expect(calls.at(-1)).toMatchObject({
                path: '/a2/v1/chat/completions',
                key: 'Bearer private-key-A2',
                body: { model: 'model-A2' },
            })
            expect(calls.at(-1)!.body.messages.some(message => message.content === 'KEEP_HISTORY_A')).toBe(true)
            expect(calls.some(call => call.path === '/a/v1/chat/completions' && call.key === 'Bearer private-key-A2')).toBe(false)
            const started = await request(`chat/tasks/${task.id}/start`, { requestId: randomUUID() })
            expect(await started.text()).toContain('model-A2 answered')
            expect(calls.at(-1)!.body.messages.filter(message => message.content === 'KEEP_GOAL_A')).toHaveLength(1)
            const beforeTest = calls.length
            expect((await request(`account/models/${a.id}/test`, {})).ok).toBe(true)
            expect(calls).toHaveLength(beforeTest + 1)
            const replay = accountModelSchema.parse(await (await request('account/models', inputA)).json())
            expect(replay.model).toBe('model-A2')
            expect((await request(`account/models/${a.id}`, undefined, 'DELETE')).ok).toBe(true)
            expect((await request(`chat/conversations/${chat.id}`)).ok).toBe(true)
            const beforeDeleted = calls.length
            const removed = await request(`chat/conversations/${chat.id}/messages`, {
                requestId: randomUUID(),
                content: 'must not fallback',
            })
            expect(removed.status).toBe(503)
            expect(await removed.text()).toContain('已删除或不可用')
            expect(calls).toHaveLength(beforeDeleted)
            const valid = await request(`chat/conversations/${secondChat.id}/messages`, { requestId: randomUUID(), content: 'B only' })
            expect(await valid.text()).toContain('model-B answered')
            expect(calls.at(-1)).toMatchObject({ path: '/b/v1/chat/completions', key: 'Bearer private-key-B' })
            await request(`account/models/${b.id}`, undefined, 'DELETE')
            const fresh = chatConversationSchema.parse(await (await request('chat/conversations', {})).json())
            expect(fresh.agent?.modelId).not.toMatch(/^account:/)
            expect(
                (await request(`chat/conversations/${fresh.id}/messages`, { requestId: randomUUID(), content: 'needs config' })).status
            ).toBe(503)
        } finally {
            await fixture.close()
        }
    })

    it('exposes only owned catalog routes and preserves Agent and template task snapshots without automatic requests', async () => {
        const fixture = await harness()
        const { request, calls, origin } = fixture
        try {
            const a = accountModelSchema.parse(
                await (
                    await request('account/models', {
                        requestId: randomUUID(),
                        name: 'A',
                        baseUrl: `${origin}/a/v1`,
                        model: 'A',
                        apiKey: 'secret-A',
                    })
                ).json()
            )
            const foreign = randomUUID()
            await request(
                'account/models',
                { requestId: randomUUID(), name: 'Foreign B', baseUrl: `${origin}/b/v1`, model: 'B', apiKey: 'secret-B' },
                'POST',
                foreign
            )
            const catalog = await (await request('chat/agents/catalog')).json()
            expect(catalog.models.some((model: { id: string }) => model.id === a.modelId)).toBe(true)
            const foreignCatalog = await (await request('chat/agents/catalog', undefined, 'GET', foreign)).json()
            expect(foreignCatalog.models.some((model: { id: string }) => model.id === a.modelId)).toBe(false)
            const agentInput = {
                name: 'Owned agent',
                description: '',
                modelId: a.modelId,
                systemPrompt: 'KEEP_AGENT_A',
                toolIds: ['calculator'],
                openingMessages: ['OPENING_A'],
            }
            const agent = agentDefinitionSchema.parse(await (await request('chat/agents', agentInput)).json())
            expect((await request('chat/agents', agentInput, 'POST', foreign)).status).toBe(400)
            for (const [path, method] of [
                [`account/models/${a.id}`, 'GET'],
                [`account/models/${a.id}`, 'DELETE'],
                [`account/models/${a.id}/test`, 'POST'],
                [`account/models/${a.id}/default`, 'POST'],
            ] as const) {
                const response = await request(path, method === 'POST' ? {} : undefined, method, foreign)
                expect(response.status).toBe(404)
                expect(await response.text()).not.toContain('secret-A')
            }
            const template = await (
                await request('chat/templates', {
                    requestId: randomUUID(),
                    name: 'Blueprint',
                    description: '',
                    tasks: [{ id: randomUUID(), title: 'Agent task', goal: 'TEMPLATE_GOAL', agentId: agent.id }],
                })
            ).json()
            const launched = templateLaunchResultSchema.parse(
                await (
                    await request(`chat/templates/${template.id}/launch`, {
                        requestId: randomUUID(),
                        version: template.version,
                        name: 'Instance',
                        description: 'MANAGEMENT_ONLY',
                    })
                ).json()
            )
            expect(calls).toHaveLength(0)
            const task = personalTaskSchema.parse(await (await request(`chat/tasks/${launched.taskIds[0]}`)).json())
            expect(task.agent).toEqual(agent)
            await request(`chat/agents/${agent.id}`, { ...agentInput, systemPrompt: 'NEW_AGENT_PROMPT' }, 'PUT')
            const response = await request(`chat/tasks/${task.id}/start`, { requestId: randomUUID() })
            const payload = await response.text()
            expect(payload).toContain('A answered')
            expect(payload).not.toContain('secret-A')
            const content = calls
                .at(-1)!
                .body.messages.map(message => message.content)
                .join('\n')
            expect(content).toContain('KEEP_AGENT_A')
            expect(content).not.toContain('NEW_AGENT_PROMPT')
            expect(content).not.toContain('MANAGEMENT_ONLY')
            expect(calls.at(-1)!.body.messages.filter(message => message.content === 'OPENING_A')).toHaveLength(1)
            expect((await request(`chat/tasks/${task.id}`, undefined, 'GET', foreign)).status).toBe(404)
        } finally {
            await fixture.close()
        }
    })
})
