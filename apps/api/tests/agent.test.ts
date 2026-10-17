import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { agentDefinitionSchema, type AgentCatalog, type AgentInput } from '@ai-harness/contracts'
import { createChatStore, type ChatStore } from '@ai-harness/db'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentController } from '../src/agent-controller.js'
import { AgentService } from '../src/agent-service.js'
import { ChatGuard } from '../src/auth.js'
import { readApiConfig } from '../src/config.js'

const token = 'agent-tests-private-api-token-with-at-least-32-characters'
const config = readApiConfig({ HARNESS_API_TOKEN: token, CHAT_STORE: 'memory' })
const userId = randomUUID()
const applications: NestExpressApplication[] = []
const stores: ChatStore[] = []
const catalog: AgentCatalog = {
    defaultModelId: 'deepseek-chat',
    models: [
        { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'DeepSeek', available: true },
        { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'DeepSeek', available: false },
    ],
    tools: [
        { id: 'calculator', label: '计算器', description: '计算数学表达式。' },
        { id: 'current-time', label: '当前时间', description: '查询当前时间。' },
    ],
}

/**
 * Build a valid public agent creation or update body.
 * @param changes - Configuration fields overridden by the test.
 * @returns A valid credential-free public agent configuration.
 */
function input(changes: Partial<AgentInput> = {}): AgentInput {
    return {
        name: '数学助手',
        description: '帮助完成计算。',
        modelId: 'deepseek-chat',
        systemPrompt: 'Use the configured tools.',
        toolIds: ['calculator'],
        openingMessages: ['你好，需要计算什么？'],
        ...changes,
    }
}

/**
 * Build authenticated server-to-server headers for an agent request.
 * @param identity - Browser-session user UUID.
 * @returns Ownership claims accepted by the API authorization guard.
 */
function headers(identity = userId): Record<string, string> {
    return {
        authorization: `Bearer ${token}`,
        'x-harness-user-id': identity,
        'x-harness-workspace-id': config.workspaceId,
        'content-type': 'application/json',
    }
}

/**
 * Initialize the real agent HTTP controller with shared scoped persistence.
 * @param capabilities - Optional reduced catalog used to test tool registration.
 * @returns The loopback endpoint prefix for authenticated requests.
 * @throws Error when local application initialization or port binding fails.
 */
async function start(capabilities = catalog): Promise<string> {
    const store = await createChatStore({ allowMemory: true })
    stores.push(store)
    const service = new AgentService(store.agents, capabilities)
    class AgentTestModule {}
    Module({ controllers: [AgentController], providers: [{ provide: AgentService, useValue: service }] })(AgentTestModule)
    const application = await NestFactory.create<NestExpressApplication>(AgentTestModule, { logger: false })
    applications.push(application)
    application.setGlobalPrefix('api')
    application.useGlobalGuards(new ChatGuard(config))
    await application.listen(0, '127.0.0.1')
    const address = application.getHttpServer().address() as AddressInfo
    return `http://127.0.0.1:${address.port}/api/chat/agents`
}

/**
 * Submit an agent configuration through the real authenticated HTTP boundary.
 * @param url - Agent collection or item endpoint.
 * @param body - Untrusted public JSON body.
 * @param method - Agent create or update operation.
 * @param identity - Authenticated browser-session identity.
 * @returns The raw HTTP response for assertions.
 */
function save(url: string, body: unknown, method = 'POST', identity = userId): Promise<Response> {
    return fetch(url, { method, headers: headers(identity), body: JSON.stringify(body) })
}

afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(applications.splice(0).map(application => application.close()))
    await Promise.all(stores.splice(0).map(store => store.close()))
})

describe('agent configuration HTTP API', () => {
    it('requires authentication before exposing catalog and returns only public capabilities', async () => {
        const base = await start()
        expect((await fetch(`${base}/catalog`)).status).toBe(401)
        expect((await fetch(base)).status).toBe(401)
        const response = await fetch(`${base}/catalog`, { headers: headers() })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(catalog)
    })

    it('creates, lists, and reloads complete agent configurations within ownership scope', async () => {
        const base = await start()
        const response = await save(base, input())
        expect(response.status).toBe(201)
        const created = agentDefinitionSchema.parse(await response.json())
        expect(created).toMatchObject(input())
        expect(created.updatedAt).toBe(created.createdAt)
        expect(await (await fetch(base, { headers: headers() })).json()).toEqual({ agents: [created] })
        expect(await (await fetch(`${base}/${created.id}`, { headers: headers() })).json()).toEqual(created)
        const foreignUser = randomUUID()
        expect(await (await fetch(base, { headers: headers(foreignUser) })).json()).toEqual({ agents: [] })
        expect((await fetch(`${base}/${created.id}`, { headers: headers(foreignUser) })).status).toBe(404)
        expect((await save(`${base}/${created.id}`, input({ name: 'Foreign update' }), 'PUT', foreignUser)).status).toBe(404)
        expect(await (await fetch(`${base}/${created.id}`, { headers: headers() })).json()).toEqual(created)
    })

    it('replaces configuration while preserving identity and creation time', async () => {
        const store = await createChatStore({ allowMemory: true })
        stores.push(store)
        const service = new AgentService(store.agents, catalog)
        const scope = { userId, workspaceId: config.workspaceId }
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-17T03:00:00.000Z'))
        const created = await service.create(scope, input())
        vi.setSystemTime(new Date('2026-10-17T03:01:00.000Z'))
        const replacement = input({ name: '旅行助手', systemPrompt: 'Help plan journeys.', toolIds: ['current-time'], openingMessages: [] })
        const updated = await service.update(scope, created.id, replacement)
        expect(updated).toEqual({ ...replacement, id: created.id, createdAt: created.createdAt, updatedAt: '2026-10-17T03:01:00.000Z' })
        expect(await service.get(scope, created.id)).toEqual(updated)
    })

    it('accepts recognized models before their provider credentials are configured', async () => {
        const base = await start()
        const response = await save(base, input({ modelId: 'deepseek-reasoner' }))
        expect(response.status).toBe(201)
        expect(await response.json()).toMatchObject({ modelId: 'deepseek-reasoner' })
    })

    it('rejects invalid fields, unknown models and tools, credentials, and forged ownership', async () => {
        const base = await start()
        for (const invalid of [
            input({ name: ' ' }),
            input({ modelId: 'unregistered-model' }),
            input({ systemPrompt: 'a'.repeat(32_001) }),
            input({ openingMessages: [''] }),
            input({ openingMessages: Array(6).fill('Hello') }),
            input({ toolIds: ['calculator', 'calculator'] }),
            { ...input(), toolIds: ['unknown-tool'] },
            { ...input(), apiKey: 'private-key' },
            { ...input(), userId: randomUUID() },
        ]) {
            expect((await save(base, invalid)).status).toBe(400)
        }
        expect(await (await fetch(base, { headers: headers() })).json()).toEqual({ agents: [] })
        expect((await fetch(`${base}/not-a-uuid`, { headers: headers() })).status).toBe(400)
        expect((await save(`${base}/not-a-uuid`, input(), 'PUT')).status).toBe(400)
        expect((await fetch(`${base}/${randomUUID()}`, { headers: headers() })).status).toBe(404)
    })

    it('refuses schema-valid tools that are absent from the initialized runtime catalog', async () => {
        const base = await start({ ...catalog, tools: catalog.tools.filter(tool => tool.id === 'current-time') })
        expect((await save(base, input({ toolIds: ['calculator'] }))).status).toBe(400)
        const created = agentDefinitionSchema.parse(await (await save(base, input({ toolIds: ['current-time'] }))).json())
        expect((await save(`${base}/${created.id}`, input({ toolIds: ['calculator'] }), 'PUT')).status).toBe(400)
    })

    it('returns detached catalog data and a controlled failure when storage is unavailable', async () => {
        const service = new AgentService(undefined, catalog)
        const detached = service.catalog()
        detached.models.length = 0
        expect(service.catalog()).toEqual(catalog)
        await expect(service.create({ userId, workspaceId: config.workspaceId }, input())).rejects.toThrow('Agent 存储暂时不可用')
    })
})
