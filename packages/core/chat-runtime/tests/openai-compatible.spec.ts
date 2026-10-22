import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createChatRuntime, createModelFetch, isAllowedModelAddress, testModelConnection, validateModelBaseUrl } from '../src/index.ts'

interface ProviderRequest {
    path: string
    authorization: string
    body: {
        model: string
        max_tokens?: number
        messages: { role: string; content: string; reasoning_content?: string }[]
        tools?: unknown[]
    }
}
const servers: Server[] = []

/**
 * Start a loopback provider that records actual socket requests and emits SSE.
 * @param reply - Provider response selected from the parsed incoming request.
 * @returns The exact origin, recorded requests, and request-arrival observer.
 */
async function provider(reply: (request: ProviderRequest) => string | number) {
    const requests: ProviderRequest[] = []
    let arrived: (() => void) | undefined
    const requestArrived = new Promise<void>(resolve => {
        arrived = resolve
    })
    const server = createServer(async (request, response) => {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const record: ProviderRequest = {
            path: request.url ?? '',
            authorization: request.headers.authorization ?? '',
            body: JSON.parse(body),
        }
        requests.push(record)
        arrived?.()
        const result = reply(record)
        if (result === 0) return
        if (typeof result === 'number') {
            response.writeHead(result, { location: '/redirect-target' })
            response.end('private provider refusal')
            return
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(result)
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, requestArrived }
}

/**
 * Serialize a complete text or native tool-call stream.
 * @param delta - Content or tool-call fields.
 * @param finish - Standard Chat Completions terminal reason.
 * @returns Valid provider SSE frames including the terminal marker.
 */
function stream(delta: Record<string, unknown>, finish = 'stop'): string {
    return (
        [
            { delta, finish_reason: null },
            { delta: {}, finish_reason: finish },
        ]
            .map(choice => `data: ${JSON.stringify({ choices: [{ index: 0, ...choice }] })}\n\n`)
            .join('') + 'data: [DONE]\n\n'
    )
}

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            server =>
                new Promise<void>(resolve => {
                    server.closeAllConnections()
                    server.close(() => resolve())
                })
        )
    )
})

describe('personal OpenAI-compatible Cordis connections', () => {
    it('normalizes public HTTPS bases and rejects dangerous URL authorities without network access', () => {
        expect(validateModelBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1')
        for (const address of [
            'file:///tmp/key',
            'http://public.example/v1',
            'https://user:secret@api.example/v1',
            'https://api.example/v1?key=secret',
            'https://api.example/v1#secret',
            'https://localhost/v1',
            'https://127.1/v1',
            'https://2130706433/v1',
            'https://[::ffff:127.0.0.1]/v1',
            'https://metadata.google.internal/v1',
        ])
            expect(() => validateModelBaseUrl(address)).toThrow()
        for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '100.64.0.1', '2001:db8::1', '2002:7f00:1::'])
            expect(isAllowedModelAddress(address)).toBe(false)
        expect(isAllowedModelAddress('8.8.8.8')).toBe(true)
        expect(isAllowedModelAddress('2606:4700:4700::1111')).toBe(true)
    })

    it('allows only an administrator-approved exact local origin and always blocks metadata addresses', () => {
        const allowedLocalOrigins = ['http://127.0.0.1:9001', 'http://[::1]:9001']
        expect(validateModelBaseUrl('http://127.0.0.1:9001/v1', { allowedLocalOrigins })).toContain(':9001/v1')
        expect(validateModelBaseUrl('http://[::1]:9001/v1', { allowedLocalOrigins })).toContain(':9001/v1')
        expect(() => validateModelBaseUrl('http://127.0.0.1:9002/v1', { allowedLocalOrigins })).toThrow()
        for (const address of [
            '169.254.169.254',
            '100.100.100.200',
            '168.63.129.16',
            '::ffff:a9fe:a9fe',
            'fd00:ec2::254',
            'fd20:ce::254',
            '0.0.0.0',
            '224.0.0.1',
        ])
            expect(isAllowedModelAddress(address, true)).toBe(false)
    })

    it('tests a saved connection through the actual pinned HTTP transport with a bounded minimal prompt', async () => {
        const fixture = await provider(() => stream({ content: 'OK' }))
        await testModelConnection(
            { apiKey: 'personal-key-A', baseUrl: `${fixture.origin}/v1`, model: 'compatible-model' },
            { allowedLocalOrigins: [fixture.origin] }
        )
        expect(fixture.requests).toHaveLength(1)
        expect(fixture.requests[0]).toMatchObject({
            path: '/v1/chat/completions',
            authorization: 'Bearer personal-key-A',
            body: { model: 'compatible-model', max_tokens: 32 },
        })
        expect(fixture.requests[0]!.body.messages).toHaveLength(1)
        expect(fixture.requests[0]!.body.tools).toBeUndefined()
    })

    it('runs native tools through the shared Cordis loop and keeps concurrent private connections isolated', async () => {
        const fixture = await provider(request => {
            if (request.body.model === 'model-B') return stream({ content: 'B answered' })
            if (request.body.messages.some(message => message.role === 'tool')) return stream({ content: 'The result is 42.' })
            return stream(
                {
                    reasoning_content: 'Calculate first.',
                    tool_calls: [
                        { index: 0, id: 'call-1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"6*7"}' } },
                    ],
                },
                'tool_calls'
            )
        })
        const runtime = await createChatRuntime({ apiKey: '', allowedLocalOrigins: [fixture.origin] })
        const now = new Date().toISOString()
        try {
            const input = {
                scope: { userId: 'A', workspaceId: 'workspace' },
                conversationId: randomUUID(),
                history: [],
                content: 'calculate 6*7',
                signal: new AbortController().signal,
                onDelta: () => undefined,
            }
            const [first, second] = await Promise.all([
                runtime.run({
                    ...input,
                    connection: { apiKey: 'key-A', baseUrl: `${fixture.origin}/a/v1`, model: 'model-A' },
                    agent: {
                        id: randomUUID(),
                        name: 'Calculator',
                        description: '',
                        modelId: `account:${randomUUID()}`,
                        systemPrompt: 'KEEP_AGENT_PROMPT',
                        toolIds: ['calculator'],
                        openingMessages: [],
                        createdAt: now,
                        updatedAt: now,
                    },
                }),
                runtime.run({
                    ...input,
                    scope: { userId: 'B', workspaceId: 'workspace' },
                    connection: { apiKey: 'key-B', baseUrl: `${fixture.origin}/b/v1`, model: 'model-B' },
                }),
            ])
            expect(first.content).toBe('The result is 42.')
            expect(second.content).toBe('B answered')
            const aRequests = fixture.requests.filter(request => request.body.model === 'model-A')
            expect(aRequests).toHaveLength(2)
            expect(aRequests.every(request => request.authorization === 'Bearer key-A' && request.path === '/a/v1/chat/completions')).toBe(
                true
            )
            expect(aRequests[1]!.body.messages.some(message => message.role === 'tool' && message.content.includes('42'))).toBe(true)
            expect(aRequests[1]!.body.messages.every(message => message.reasoning_content === undefined)).toBe(true)
            expect(aRequests[0]!.body.messages.some(message => message.content.includes('KEEP_AGENT_PROMPT'))).toBe(true)
            expect(fixture.requests.find(request => request.body.model === 'model-B')).toMatchObject({
                authorization: 'Bearer key-B',
                path: '/b/v1/chat/completions',
            })
        } finally {
            await runtime.dispose()
        }
    })

    it('never follows provider redirects or exposes raw refusal bodies', async () => {
        for (const status of [204, 205, 302, 401]) {
            const fixture = await provider(() => status)
            await expect(
                testModelConnection(
                    { apiKey: 'private-model-key', model: 'model', baseUrl: fixture.origin },
                    { allowedLocalOrigins: [fixture.origin] }
                )
            ).rejects.toThrow(status === 401 ? '模型鉴权失败' : '连接测试失败')
            expect(fixture.requests).toHaveLength(1)
        }
    })

    it('cancels a real pending model test when the browser aborts', async () => {
        const fixture = await provider(() => 0)
        const controller = new AbortController()
        const pending = testModelConnection(
            { apiKey: 'private-key', model: 'model', baseUrl: fixture.origin },
            { allowedLocalOrigins: [fixture.origin], signal: controller.signal }
        )
        await fixture.requestArrived
        controller.abort()
        await expect(pending).rejects.toThrow('连接测试已取消')
    })

    it('rejects a private target before opening its socket unless the exact origin is approved', async () => {
        const fixture = await provider(() => stream({ content: 'never' }))
        await expect(createModelFetch()(fixture.origin, { method: 'POST', body: '{}' })).rejects.toThrow()
        expect(fixture.requests).toHaveLength(0)
    })
})
