import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createEmbeddings } from '../src/embeddings.js'

const fixtureKey = 'sf008-independent-protocol-fixture-key'
interface RecordedRequest {
    path: string
    authorization: string
    payload: Record<string, unknown>
}
type Responder = (request: RecordedRequest, response: ServerResponse) => void

/**
 * Hosts a controlled actual HTTP provider without using any cloud credentials or claiming semantic model validation.
 * @param responder - Mutable protocol response behavior for the isolated scenario.
 * @param scenario - Assertions against a real loopback connection and captured requests.
 * @returns After the test-owned server and all connections have closed.
 * @throws Error when the local server or scenario fails.
 */
async function provider(responder: Responder, scenario: (origin: string, requests: RecordedRequest[]) => Promise<void>): Promise<void> {
    const requests: RecordedRequest[] = []
    const server = createServer((request, response) => {
        void receive(request, response)
    })
    /**
     * Collects one bounded test request and dispatches its observable protocol response.
     * @param request - Incoming request from the actual core HTTP transport.
     * @param response - Test-owned response writer.
     * @returns After the request has been dispatched or its connection has failed.
     */
    async function receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
        try {
            const parts: Buffer[] = []
            for await (const part of request) parts.push(Buffer.from(part))
            const record = {
                path: request.url ?? '',
                authorization: request.headers.authorization ?? '',
                payload: JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>,
            }
            requests.push(record)
            responder(record, response)
        } catch {
            response.destroy()
        }
    }
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('The isolated provider did not open a loopback port.')
    try {
        await scenario(`http://127.0.0.1:${address.port}`, requests)
    } finally {
        const closed = new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
        server.closeAllConnections()
        await closed
    }
}

/**
 * Calls the production embedding entry point with only a server-authorized exact local origin.
 * @param origin - Test-owned local provider origin.
 * @param inputs - Actual input strings sent in one request.
 * @param signal - Optional cancellation signal for an individual request.
 * @returns The production adapter's validated result.
 */
function embed(origin: string, inputs = ['第一条资料', '第二条资料'], signal?: AbortSignal) {
    return createEmbeddings({ baseUrl: `${origin}/v1`, apiKey: fixtureKey, model: 'requested-fixture-model' }, inputs, {
        allowedLocalOrigins: [origin],
        signal,
    })
}

/**
 * Produces a complete protocol response with vectors whose order can be inspected independently.
 * @returns A legitimate two-input provider fixture response.
 */
function validResponse() {
    return {
        model: 'provider-snapshot-v1',
        data: [
            { index: 0, embedding: [1, 0] },
            { index: 1, embedding: [0, 1] },
        ],
    }
}

/**
 * Writes a controlled JSON protocol result without executing a model.
 * @param response - Test-owned provider response.
 * @param value - Observable JSON payload.
 * @param status - Explicit provider HTTP status.
 * @returns Nothing after ending the test response.
 */
function json(response: ServerResponse, value: unknown, status = 200): void {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
}

describe('independent embedding protocol acceptance using controlled real HTTP', () => {
    it('uses the dedicated endpoint, does not send dimensions, and restores complete out-of-order vector indices', async () => {
        await provider(
            (_request, response) => {
                const value = validResponse()
                value.data.reverse()
                json(response, value)
            },
            async (origin, requests) => {
                const result = await embed(origin)
                expect(result).toMatchObject({
                    model: 'provider-snapshot-v1',
                    dimensions: 2,
                    vectors: [
                        [1, 0],
                        [0, 1],
                    ],
                })
                expect(requests).toHaveLength(1)
                expect(requests[0]).toEqual({
                    path: '/v1/embeddings',
                    authorization: `Bearer ${fixtureKey}`,
                    payload: { model: 'requested-fixture-model', input: ['第一条资料', '第二条资料'], encoding_format: 'float' },
                })
            }
        )
    })

    it('rejects malformed identities, index mappings, dimensions, float32 overflow and all-zero underflow', async () => {
        let payload: unknown = validResponse()
        const invalid: unknown[] = [
            { data: validResponse().data },
            { model: ' ', data: validResponse().data },
            {
                model: 'fixture',
                data: [
                    { index: 0, embedding: [1, 0] },
                    { index: 0, embedding: [0, 1] },
                ],
            },
            { model: 'fixture', data: [{ index: 0, embedding: [1, 0] }] },
            {
                model: 'fixture',
                data: [
                    { index: 0, embedding: [1, 0] },
                    { index: 2, embedding: [0, 1] },
                ],
            },
            {
                model: 'fixture',
                data: [
                    { index: 0.5, embedding: [1, 0] },
                    { index: 1, embedding: [0, 1] },
                ],
            },
            {
                model: 'fixture',
                data: [
                    { index: 0, embedding: [1, 0] },
                    { index: 1, embedding: [0, 1, 0] },
                ],
            },
            {
                model: 'fixture',
                data: [
                    { index: 0, embedding: [0, 0] },
                    { index: 1, embedding: [0, 1] },
                ],
            },
            {
                model: 'fixture',
                data: [
                    { index: 0, embedding: [1e100, 0] },
                    { index: 1, embedding: [0, 1] },
                ],
            },
            {
                model: 'fixture',
                data: [
                    { index: 0, embedding: [1e-100, 0] },
                    { index: 1, embedding: [0, 1] },
                ],
            },
            {
                model: 'fixture',
                data: [
                    { index: 0, embedding: ['1', 0] },
                    { index: 1, embedding: [0, 1] },
                ],
            },
            {
                model: 'fixture',
                data: [
                    { index: 0, embedding: Array(4097).fill(1) },
                    { index: 1, embedding: Array(4097).fill(1) },
                ],
            },
            { model: 'fixture', choices: [{ message: { content: 'This is a chat-only endpoint.' } }] },
        ]
        await provider(
            (_request, response) => json(response, payload),
            async origin => {
                for (const value of invalid) {
                    payload = value
                    const failure = await embed(origin).then(
                        () => undefined,
                        cause => cause
                    )
                    expect(failure).toBeInstanceOf(Error)
                    expect(failure.message).not.toContain(fixtureKey)
                }
            }
        )
    })

    it('rejects actual response overflow and input body overflow without truncating user text', async () => {
        await provider(
            (_request, response) => {
                response.writeHead(200, { 'content-type': 'application/json' })
                response.end(`{"model":"fixture","padding":"${'x'.repeat(2 * 1024 * 1024)}","data":[]}`)
            },
            async (origin, requests) => {
                await expect(embed(origin)).rejects.toBeInstanceOf(Error)
                expect(requests).toHaveLength(1)
                await expect(embed(origin, Array(16).fill('中'.repeat(4000)))).rejects.toBeInstanceOf(Error)
                await expect(embed(origin, Array(17).fill('small text'))).rejects.toBeInstanceOf(Error)
                expect(requests).toHaveLength(1)
            }
        )
    })

    it('redacts actual provider authentication and rate-limit payloads', async () => {
        let status = 401
        const privateMarker = 'private-provider-response-must-not-be-reflected'
        await provider(
            (_request, response) => json(response, { error: { message: `${privateMarker}:${fixtureKey}` } }, status),
            async origin => {
                for (const code of [401, 429, 500]) {
                    status = code
                    const failure = await embed(origin).then(
                        () => undefined,
                        cause => cause
                    )
                    expect(failure).toBeInstanceOf(Error)
                    expect(failure.message).not.toContain(fixtureKey)
                    expect(failure.message).not.toContain(privateMarker)
                }
            }
        )
    })

    it('enforces a shortened hard deadline on an actual stalled connection and releases its request slot', async () => {
        let stalled = true
        await provider(
            (_request, response) => {
                if (!stalled) json(response, validResponse())
            },
            async (origin, requests) => {
                const failure = await createEmbeddings(
                    { baseUrl: `${origin}/v1`, apiKey: fixtureKey, model: 'requested-fixture-model' },
                    ['第一条资料', '第二条资料'],
                    { allowedLocalOrigins: [origin], timeoutMs: 50 }
                ).then(
                    () => undefined,
                    cause => cause
                )
                expect(failure).toMatchObject({ kind: 'timeout' })
                expect(failure.message).not.toContain(fixtureKey)
                expect(requests).toHaveLength(1)
                stalled = false
                expect((await embed(origin)).dimensions).toBe(2)
            }
        )
    })

    it('does not connect to an unapproved local origin or treat a full endpoint as an API root', async () => {
        await provider(
            (_request, response) => json(response, validResponse()),
            async (origin, requests) => {
                const connection = { apiKey: fixtureKey, model: 'requested-fixture-model' }
                await expect(createEmbeddings({ ...connection, baseUrl: `${origin}/v1` }, ['text'])).rejects.toBeInstanceOf(Error)
                await expect(
                    createEmbeddings({ ...connection, baseUrl: `${origin}/v1/embeddings` }, ['text'], { allowedLocalOrigins: [origin] })
                ).rejects.toBeInstanceOf(Error)
                await expect(
                    createEmbeddings({ ...connection, baseUrl: 'http://169.254.169.254/v1' }, ['text'], {
                        allowedLocalOrigins: ['http://169.254.169.254'],
                    })
                ).rejects.toBeInstanceOf(Error)
                expect(requests).toHaveLength(0)
            }
        )
    })

    it('bounds concurrent actual requests across separate connections and releases capacity after cancellation', async () => {
        const waiting: ServerResponse[] = []
        let open = false
        let active = 0
        let peak = 0
        await provider(
            (_request, response) => {
                active++
                peak = Math.max(peak, active)
                let released = false
                /**
                 * Counts one completed or disconnected actual provider request exactly once.
                 * @returns Nothing after updating observed concurrency.
                 */
                function release(): void {
                    if (!released) {
                        released = true
                        active--
                    }
                }
                response.once('finish', release)
                response.once('close', release)
                if (open) json(response, validResponse())
                else waiting.push(response)
            },
            async (origin, requests) => {
                const cancellation = new AbortController()
                const calls = Array.from({ length: 4 }, (_, index) =>
                    embed(origin, undefined, index === 0 ? cancellation.signal : undefined)
                )
                const observed = calls.map(call =>
                    call.then(
                        value => ({ ok: true, value }),
                        error => ({ ok: false, error })
                    )
                )
                let fifth: ReturnType<typeof embed> | undefined
                try {
                    for (let attempt = 0; requests.length < 4 && attempt < 100; attempt++) await delay(5)
                    expect(requests).toHaveLength(4)
                    fifth = embed(origin)
                    const fifthObserved = fifth.then(
                        value => ({ ok: true, value }),
                        error => ({ ok: false, error })
                    )
                    await delay(20)
                    expect(requests).toHaveLength(4)
                    cancellation.abort()
                    expect((await observed[0]!).ok).toBe(false)
                    open = true
                    for (const response of waiting) if (!response.destroyed && !response.writableEnded) json(response, validResponse())
                    await Promise.all([...observed, fifthObserved])
                    expect(peak).toBeLessThanOrEqual(4)
                    expect((await embed(origin)).vectors).toEqual([
                        [1, 0],
                        [0, 1],
                    ])
                } finally {
                    open = true
                    cancellation.abort()
                    for (const response of waiting) if (!response.destroyed && !response.writableEnded) json(response, validResponse())
                    await Promise.allSettled([...calls, ...(fifth ? [fifth] : [])])
                }
            }
        )
    })
})
