import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmbeddings, EmbeddingError, takeEmbeddingBatch, validateEmbeddingBaseUrl } from '../src/embeddings.js'

const servers: ReturnType<typeof createServer>[] = []
const connection = { baseUrl: 'https://embedding.example.test/v1', apiKey: 'private-fixture-key', model: 'embedding-fixture' }

afterEach(async () => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
    }
})

/**
 * Binds an explicitly owned loopback provider fixture without permitting unrelated local origins.
 * @param server - Test-owned HTTP provider.
 * @returns The exact origin required by the protected production transport.
 */
async function listen(server: ReturnType<typeof createServer>): Promise<string> {
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/**
 * Supplies one explicit protocol response without performing DNS or a remote cloud call.
 * @param value - JSON protocol fixture.
 * @param status - Explicit provider status.
 * @returns An injected transport used only by this isolated test.
 */
function respond(value: unknown, status = 200): typeof fetch {
    return async () => Response.json(value, { status })
}

describe('bounded OpenAI-compatible embedding protocol', () => {
    it('uses the protected real HTTP transport, preserves source text, and restores out-of-order results', async () => {
        let requestedPath = ''
        let requestedHeaders = ''
        let requestedBody: Record<string, unknown> = {}
        const server = createServer(async (request, response) => {
            const parts: Buffer[] = []
            for await (const part of request) parts.push(Buffer.from(part))
            requestedPath = request.url ?? ''
            requestedHeaders = request.headers.authorization ?? ''
            requestedBody = JSON.parse(Buffer.concat(parts).toString())
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end(
                JSON.stringify({
                    model: 'actual-embedding-revision',
                    data: [
                        { index: 1, embedding: [0, 1, 0] },
                        { index: 0, embedding: [0.1, 0, 1] },
                    ],
                })
            )
        })
        const origin = await listen(server)
        const sources = [' 原文 中文 😀\n', '独立查询']
        const result = await createEmbeddings({ ...connection, baseUrl: `${origin}/v1/` }, sources, { allowedLocalOrigins: [origin] })
        expect(requestedPath).toBe('/v1/embeddings')
        expect(requestedHeaders).toBe(`Bearer ${connection.apiKey}`)
        expect(requestedBody).toEqual({ model: connection.model, input: sources, encoding_format: 'float' })
        expect(result).toEqual({
            model: 'actual-embedding-revision',
            dimensions: 3,
            vectors: [
                [Math.fround(0.1), 0, 1],
                [0, 1, 0],
            ],
        })
    })

    it('rejects complete endpoints and unsafe model roots before requesting credentials', () => {
        for (const value of [
            'https://embedding.example.test/v1/embeddings',
            'https://embedding.example.test/v1/chat/completions',
            'http://127.0.0.1:8000/v1',
            'https://user:password@embedding.example.test/v1',
            'https://embedding.example.test/v1?key=private',
        ])
            expect(() => validateEmbeddingBaseUrl(value)).toThrow(EmbeddingError)
        expect(validateEmbeddingBaseUrl('https://embedding.example.test/v1/')).toBe('https://embedding.example.test/v1')
    })

    it('packs complete Unicode inputs by actual UTF-8 request bytes without losing the remainder', () => {
        const sources = Array.from({ length: 20 }, (_, index) => `${index}:` + '😀'.repeat(4000))
        const recovered: string[] = []
        while (recovered.length < sources.length) {
            const batch = takeEmbeddingBatch(connection, sources.slice(recovered.length))
            expect(batch.length).toBe(4)
            expect(
                Buffer.byteLength(JSON.stringify({ model: connection.model, input: batch, encoding_format: 'float' }))
            ).toBeLessThanOrEqual(65536)
            recovered.push(...batch)
        }
        expect(recovered).toEqual(sources)
        expect(() => takeEmbeddingBatch(connection, ['中'.repeat(23000)])).toThrow('单个分片')
        expect(takeEmbeddingBatch(connection, [])).toEqual([])
    })

    it('rejects invalid result identities, counts, indices, dimensions and PostgreSQL float32 values', async () => {
        const invalid = [
            { data: [{ index: 0, embedding: [1] }] },
            { model: '', data: [{ index: 0, embedding: [1] }] },
            { model: 'actual', data: [] },
            { model: 'actual', data: [{ index: 1, embedding: [1] }] },
            { model: 'actual', data: [{ index: -1, embedding: [1] }] },
            { model: 'actual', data: [{ index: 0, embedding: [] }] },
            { model: 'actual', data: [{ index: 0, embedding: [0, 0] }] },
            { model: 'actual', data: [{ index: 0, embedding: ['1'] }] },
            { model: 'actual', data: [{ index: 0, embedding: [1e100] }] },
            { model: 'actual', data: [{ index: 0, embedding: [1e-100] }] },
            { model: 'actual', data: [{ index: 0, embedding: new Array(4097).fill(1) }] },
        ]
        for (const value of invalid)
            await expect(createEmbeddings(connection, ['probe'], { transport: respond(value) })).rejects.toMatchObject({ kind: 'protocol' })
        for (const data of [
            [
                { index: 0, embedding: [1, 0] },
                { index: 0, embedding: [1, 0] },
            ],
            [
                { index: 0, embedding: [1] },
                { index: 1, embedding: [1, 0] },
            ],
        ])
            await expect(
                createEmbeddings(connection, ['one', 'two'], { transport: respond({ model: 'actual', data }) })
            ).rejects.toMatchObject({ kind: 'protocol' })
    })

    it('classifies provider failures without exposing their body or credentials', async () => {
        for (const [status, kind] of [
            [401, 'authentication'],
            [429, 'rate_limit'],
            [400, 'input'],
            [404, 'connection'],
            [500, 'connection'],
        ] as const) {
            try {
                await createEmbeddings(connection, ['source'], {
                    transport: respond({ private: connection.apiKey, source: 'private source' }, status),
                })
                expect.fail('The provider failure must not succeed')
            } catch (error) {
                expect(error).toBeInstanceOf(EmbeddingError)
                expect((error as EmbeddingError).kind).toBe(kind)
                expect((error as Error).message).not.toContain(connection.apiKey)
                expect((error as Error).message).not.toContain('private source')
            }
        }
    })

    it('aborts a real pending provider at its bounded deadline and releases the caller', async () => {
        const origin = await listen(createServer(() => undefined))
        await expect(
            createEmbeddings({ ...connection, baseUrl: origin }, ['probe'], { allowedLocalOrigins: [origin], timeoutMs: 50 })
        ).rejects.toMatchObject({ kind: 'timeout' })
        const cancelled = new AbortController()
        cancelled.abort(new Error('private reason'))
        await expect(createEmbeddings(connection, ['probe'], { signal: cancelled.signal })).rejects.toMatchObject({
            kind: 'cancelled',
            message: '向量请求已取消。',
        })
    })
})
