import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createChatRuntime, type ChatRuntime } from '@ai-harness/chat-runtime'
import { chatConversationSchema, chatStreamEventSchema, type ChatStreamEvent } from '@ai-harness/contracts'
import { createMemoryChatStore, type ChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig as readApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

const token = 'private-test-api-token-with-at-least-32-characters'
const providerKey = 'private-test-deepseek-key'
const userId = randomUUID()
const config = readApiConfig({
    HARNESS_API_TOKEN: token,
    CHAT_STORE: 'memory',
    DEEPSEEK_API_KEY: providerKey,
    DEEPSEEK_SYSTEM_PROMPT: 'API integration test system prompt.',
})
const applications: NestExpressApplication[] = []
let currentStore: ChatStore

/**
 * Encode a provider delta using the DeepSeek Chat Completions SSE protocol.
 * @param delta - Text or reasoning fields returned by the fake provider.
 * @param finish - Optional valid terminal finish reason.
 * @returns One complete provider SSE frame.
 */
function providerEvent(delta: Record<string, unknown>, finish: string | null = null): string {
    return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
}

/**
 * Create a fully terminated provider stream with optional reasoning.
 * @param content - Final assistant text.
 * @param reasoning - Optional streamed reasoning text.
 * @returns A fetch-compatible provider response.
 */
function providerResponse(content: string, reasoning = ''): Response {
    const payload =
        (reasoning ? providerEvent({ reasoning_content: reasoning }) : '') +
        providerEvent({ content }) +
        providerEvent({}, 'stop') +
        'data: [DONE]\n\n'
    return new Response(payload, { headers: { 'content-type': 'text/event-stream' } })
}

/**
 * Start the actual Nest HTTP application on an ephemeral loopback port.
 * @param runtime - Explicit Cordis runtime whose provider transport is isolated.
 * @returns Base URL for authenticated HTTP integration requests.
 * @throws Error when application initialization or local port binding fails.
 */
async function start(runtime?: ChatRuntime): Promise<string> {
    const store = await createMemoryChatStore()
    currentStore = store
    const app = await createApiApp({ ...config, ...(runtime ? {} : { apiKey: '' }) }, { store, runtime, logger: false })
    applications.push(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    return `http://127.0.0.1:${address.port}/api/chat`
}

/**
 * Persist a real fixture account session and construct private HTTP headers.
 * @param identity - User UUID established by the Web server session.
 * @returns HTTP headers accepted by the API authorization guard.
 */
async function headers(identity = userId): Promise<Record<string, string>> {
    return sessionHeaders(currentStore, config, identity)
}

/**
 * Create and validate an API-owned conversation through the real HTTP boundary.
 * @param baseUrl - Running API endpoint prefix.
 * @param identity - Authenticated user UUID.
 * @returns The persisted public conversation.
 */
async function createConversation(baseUrl: string, identity = userId) {
    const response = await fetch(`${baseUrl}/conversations`, { method: 'POST', headers: await headers(identity), body: JSON.stringify({}) })
    expect(response.status).toBe(201)
    return chatConversationSchema.parse(await response.json())
}

/**
 * Validate every application event contained in an API SSE response.
 * @param payload - Full raw application SSE stream.
 * @returns Ordered public application events.
 */
function events(payload: string): ChatStreamEvent[] {
    return payload.split(/\r?\n\r?\n/).flatMap(frame => {
        const data = frame
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
        return data ? [chatStreamEventSchema.parse(JSON.parse(data))] : []
    })
}

/**
 * Submit an authenticated message through the actual HTTP streaming endpoint.
 * @param baseUrl - Running API endpoint prefix.
 * @param conversationId - Owned conversation UUID.
 * @param content - User question.
 * @param requestId - Stable idempotent turn identifier.
 * @returns The raw streaming HTTP response.
 */
async function message(baseUrl: string, conversationId: string, content: string, requestId = randomUUID()): Promise<Response> {
    return fetch(`${baseUrl}/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ content, requestId }),
    })
}

afterEach(async () => {
    await Promise.all(applications.splice(0).map(app => app.close()))
})

describe('Nest HTTP API and real Cordis runtime', () => {
    it('requires a persisted session and ignores forged ownership headers', async () => {
        const baseUrl = await start()
        for (const invalidHeaders of [
            {},
            { ...(await headers()), authorization: 'Bearer forged-credential' },
            { ...(await headers()), authorization: '' },
            { ...(await headers()), 'x-harness-session': '' },
            { ...(await headers()), 'x-harness-session': 'a'.repeat(43) },
            { authorization: `Bearer ${token}`, 'x-harness-user-id': userId, 'x-harness-workspace-id': config.workspaceId },
        ]) {
            const response = await fetch(`${baseUrl}/status`, { headers: invalidHeaders })
            expect(response.status).toBe(401)
            const body = await response.text()
            expect(body).not.toContain(token)
            expect(body).not.toContain(providerKey)
        }
        const valid = await fetch(`${baseUrl}/status`, { headers: await headers() })
        expect(await valid.json()).toEqual({ configured: false, model: config.model, storage: 'postgres' })
        const forgedClaims = await fetch(`${baseUrl}/conversations`, {
            headers: { ...(await headers()), 'x-harness-user-id': randomUUID(), 'x-harness-workspace-id': 'forged-workspace' },
        })
        expect(forgedClaims.status).toBe(200)
        expect(await forgedClaims.json()).toEqual({ conversations: [] })
    })

    it('enforces conversation ownership and validates public bodies before starting an SSE stream', async () => {
        const providerFetch = vi.fn(async () => providerResponse('answer'))
        const runtime = await createChatRuntime({ apiKey: providerKey, fetch: providerFetch })
        const baseUrl = await start(runtime)
        const created = await createConversation(baseUrl)
        const other = await headers(randomUUID())
        const foreignList = await fetch(`${baseUrl}/conversations`, { headers: other })
        expect(await foreignList.json()).toEqual({ conversations: [] })
        const foreignRead = await fetch(`${baseUrl}/conversations/${created.id}`, { headers: other })
        expect(foreignRead.status).toBe(404)
        const foreignSend = await fetch(`${baseUrl}/conversations/${created.id}/messages`, {
            method: 'POST',
            headers: other,
            body: JSON.stringify({ content: 'private', requestId: randomUUID() }),
        })
        expect(foreignSend.status).toBe(404)
        expect(foreignSend.headers.get('content-type')).toContain('application/json')
        const invalid = await fetch(`${baseUrl}/conversations/${created.id}/messages`, {
            method: 'POST',
            headers: await headers(),
            body: JSON.stringify({ content: '', requestId: randomUUID(), userId }),
        })
        expect(invalid.status).toBe(400)
        expect(invalid.headers.get('content-type')).toContain('application/json')
        const invalidId = await fetch(`${baseUrl}/conversations/not-a-uuid`, { headers: await headers() })
        expect(invalidId.status).toBe(400)
        expect(providerFetch).not.toHaveBeenCalled()
    })

    it('streams two complete rounds through Nest, persists reasoning, and restores authorized model history', async () => {
        const providerFetch = vi
            .fn<typeof fetch>(async () => providerResponse('第一轮回答', '第一轮思考'))
            .mockResolvedValueOnce(providerResponse('第一轮回答', '第一轮思考'))
            .mockResolvedValueOnce(providerResponse('第二轮回答'))
        const runtime = await createChatRuntime({
            apiKey: providerKey,
            model: config.model,
            systemPrompt: 'API integration test system prompt.',
            fetch: providerFetch,
        })
        const baseUrl = await start(runtime)
        const created = await createConversation(baseUrl)
        const firstId = randomUUID()
        const firstResponse = await message(baseUrl, created.id, '第一轮问题', firstId)
        expect(firstResponse.ok).toBe(true)
        expect(firstResponse.headers.get('content-type')).toContain('text/event-stream')
        expect(firstResponse.headers.get('cache-control')).toBe('no-cache, no-transform')
        const first = events(await firstResponse.text())
        expect(first.map(event => event.type)).toEqual(['start', 'reasoning', 'delta', 'done'])
        expect(first.filter(event => ['done', 'cancelled', 'error'].includes(event.type))).toHaveLength(1)
        expect(first.at(-1)).toMatchObject({
            type: 'done',
            conversation: {
                messages: [
                    { role: 'user', content: '第一轮问题' },
                    { role: 'assistant', content: '第一轮回答', reasoning: '第一轮思考', status: 'complete' },
                ],
            },
        })
        const replay = events(await (await message(baseUrl, created.id, '第一轮问题', firstId)).text())
        expect(replay.map(event => event.type)).toEqual(['done'])
        expect(providerFetch).toHaveBeenCalledOnce()
        const second = events(await (await message(baseUrl, created.id, '第二轮问题')).text())
        expect(second.map(event => event.type)).toEqual(['start', 'delta', 'done'])
        const requestBody = JSON.parse(String(providerFetch.mock.calls[1]![1]!.body))
        expect(requestBody.messages).toEqual([
            { role: 'system', content: 'API integration test system prompt.' },
            { role: 'user', content: '第一轮问题' },
            { role: 'assistant', content: '第一轮回答', reasoning_content: '第一轮思考' },
            { role: 'user', content: '第二轮问题' },
        ])
        const loaded = chatConversationSchema.parse(
            await (await fetch(`${baseUrl}/conversations/${created.id}`, { headers: await headers() })).json()
        )
        expect(loaded.messages.map(item => item.content)).toEqual(['第一轮问题', '第一轮回答', '第二轮问题', '第二轮回答'])
        const listed = await (await fetch(`${baseUrl}/conversations`, { headers: await headers() })).json()
        expect(listed.conversations).toEqual([loaded])
        expect(JSON.stringify({ first, second, listed })).not.toContain(providerKey)
        expect(JSON.stringify({ first, second, listed })).not.toContain(token)
        expect(loaded.agent?.systemPrompt).toBe(config.systemPrompt)
    })

    it('redacts provider failures while recording an unsuccessful assistant turn', async () => {
        const runtime = await createChatRuntime({
            apiKey: providerKey,
            fetch: async () => new Response(`provider body contains ${providerKey}`, { status: 401 }),
        })
        const baseUrl = await start(runtime)
        const created = await createConversation(baseUrl)
        const response = await message(baseUrl, created.id, '失败的问题')
        const payload = await response.text()
        const streamed = events(payload)
        expect(streamed.map(event => event.type)).toEqual(['start', 'error'])
        expect(streamed.filter(event => ['done', 'cancelled', 'error'].includes(event.type))).toHaveLength(1)
        expect(payload).not.toContain(providerKey)
        expect(payload).not.toContain('provider body')
        const loaded = await (await fetch(`${baseUrl}/conversations/${created.id}`, { headers: await headers() })).json()
        expect(loaded.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'error', content: '' })
        expect(loaded.activeRequestId).toBeUndefined()
    })

    it('refuses concurrent HTTP turns and saves the streamed prefix before explicit cancellation returns', async () => {
        let cancelled = false
        const runtime = await createChatRuntime({
            apiKey: providerKey,
            fetch: async () =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        /**
                         * Deliver a prefix while keeping provider generation open.
                         * @param controller - Producer side of the provider response stream.
                         * @returns Nothing after queuing the first response frame.
                         */
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode(providerEvent({ content: 'partial-prefix' })))
                        },
                        /**
                         * Observe that API cancellation reaches the provider reader.
                         * @returns Nothing after recording the cancellation.
                         */
                        cancel() {
                            cancelled = true
                        },
                    }),
                    { headers: { 'content-type': 'text/event-stream' } }
                ),
        })
        const baseUrl = await start(runtime)
        const created = await createConversation(baseUrl)
        const requestId = randomUUID()
        const response = await message(baseUrl, created.id, '长回答', requestId)
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let payload = ''
        while (!payload.includes('partial-prefix')) {
            const part = await reader.read()
            expect(part.done).toBe(false)
            payload += decoder.decode(part.value, { stream: true })
        }
        const conflict = await message(baseUrl, created.id, '另一个问题')
        expect(conflict.status).toBe(409)
        expect(conflict.headers.get('content-type')).toContain('application/json')
        const stale = await fetch(`${baseUrl}/conversations/${created.id}/cancel`, {
            method: 'POST',
            headers: await headers(),
            body: JSON.stringify({ requestId: randomUUID() }),
        })
        expect(stale.status).toBe(409)
        const stop = await fetch(`${baseUrl}/conversations/${created.id}/cancel`, {
            method: 'POST',
            headers: await headers(),
            body: JSON.stringify({ requestId }),
        })
        expect(stop.ok).toBe(true)
        const saved = chatConversationSchema.parse(await stop.json())
        expect(saved.messages.at(-1)).toMatchObject({ content: 'partial-prefix', status: 'cancelled', requestId })
        expect(saved.activeRequestId).toBeUndefined()
        while (true) {
            const part = await reader.read()
            payload += decoder.decode(part.value, { stream: !part.done })
            if (part.done) break
        }
        reader.releaseLock()
        expect(events(payload).map(event => event.type)).toEqual(['start', 'delta', 'cancelled'])
        expect(cancelled).toBe(true)
    })

    it('cancels a disconnected HTTP response and retains its delivered prefix for reload', async () => {
        let cancelled = false
        const runtime = await createChatRuntime({
            apiKey: providerKey,
            fetch: async () =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        /**
                         * Deliver a prefix before waiting for the client disconnect.
                         * @param controller - Producer side of the provider response stream.
                         * @returns Nothing after queuing the prefix.
                         */
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode(providerEvent({ content: 'saved-on-disconnect' })))
                        },
                        /**
                         * Observe cancellation of the provider stream reader.
                         * @returns Nothing after recording the cancellation.
                         */
                        cancel() {
                            cancelled = true
                        },
                    }),
                    { headers: { 'content-type': 'text/event-stream' } }
                ),
        })
        const baseUrl = await start(runtime)
        const created = await createConversation(baseUrl)
        const requestId = randomUUID()
        const disconnected = new AbortController()
        const response = await fetch(`${baseUrl}/conversations/${created.id}/messages`, {
            method: 'POST',
            headers: await headers(),
            body: JSON.stringify({ content: '随后断开的请求', requestId }),
            signal: disconnected.signal,
        })
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let payload = ''
        while (!payload.includes('saved-on-disconnect')) {
            const part = await reader.read()
            expect(part.done).toBe(false)
            payload += decoder.decode(part.value, { stream: true })
        }
        disconnected.abort()
        await expect(reader.read()).rejects.toThrow()
        reader.releaseLock()
        await expect
            .poll(async () => {
                const loaded = await (await fetch(`${baseUrl}/conversations/${created.id}`, { headers: await headers() })).json()
                return loaded.messages.at(-1)
            })
            .toMatchObject({ role: 'assistant', content: 'saved-on-disconnect', status: 'cancelled', requestId })
        expect(cancelled).toBe(true)
    })
})
