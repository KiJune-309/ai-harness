import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { ChatRuntime } from '@ai-harness/chat-runtime'
import { EmbeddingError, type EmbeddingResult } from '@ai-harness/chat-runtime/embeddings'
import type { EmbeddingModel } from '@ai-harness/contracts'
import { createChatStore } from '@ai-harness/db'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../src/app.js'
import type { EmbeddingGenerator } from '../src/embedding-service.js'
import { readTestApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

const { Pool } = createRequire(import.meta.resolve('@ai-harness/db'))('pg') as {
    Pool: new (options: { connectionString?: string }) => { query: (sql: string) => Promise<unknown>; end: () => Promise<void> }
}
const token = 'embedding-http-boundary-private-test-token'

/**
 * Runs actual Nest guards and PostgreSQL model transactions in a disposable private schema.
 * @param scenario - Assertions against the isolated authorized HTTP application.
 * @returns After application and random schema cleanup.
 */
async function isolated(
    scenario: (context: {
        origin: string
        a: Record<string, string>
        b: Record<string, string>
        sourceId: string
        generate: ReturnType<typeof vi.fn<EmbeddingGenerator>>
    }) => Promise<void>
): Promise<void> {
    const schema = `embedding_http_${randomUUID().replaceAll('-', '')}`
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const databaseUrl = new URL(process.env.TEST_DATABASE_URL!)
    databaseUrl.searchParams.set('options', `-c search_path=${schema}`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const store = await createChatStore({ databaseUrl: databaseUrl.toString() })
    const config = readTestApiConfig({ HARNESS_API_TOKEN: token, DATABASE_URL: databaseUrl.toString() })
    const generate = vi.fn<EmbeddingGenerator>().mockResolvedValue({
        model: 'provider-model-v1',
        dimensions: 2,
        vectors: [
            [1, 0],
            [0, 1],
        ],
    })
    const runtime: ChatRuntime = {
        /**
         * Rejects unintended chat model usage during embedding tests.
         * @returns Never; embedding tests must not use the chat runtime.
         */
        async run() {
            throw new Error('Unexpected chat invocation.')
        },
        /**
         * Releases this empty explicit runtime fixture.
         * @returns Nothing after fixture disposal.
         */
        async dispose() {},
    }
    const app = await createApiApp(config, {
        store,
        runtime,
        logger: false,
        embeddingGenerator: generate,
        vectorWorkerOptions: { autoStart: false },
    })
    try {
        expect(store.embeddings!.vectorAvailable).toBe(true)
        await app.listen(0, '127.0.0.1')
        const address = app.getHttpServer().address() as AddressInfo
        const owner = randomUUID()
        const a = await sessionHeaders(store, config, owner)
        const b = await sessionHeaders(store, config, randomUUID())
        const sourceId = randomUUID()
        const now = new Date().toISOString()
        const text = 'known source text'
        await store.knowledge!.create(
            { userId: owner, workspaceId: config.workspaceId },
            {
                document: {
                    id: sourceId,
                    fileName: 'source.txt',
                    format: 'txt',
                    size: text.length,
                    chunkSize: 200,
                    overlap: 0,
                    status: 'queued',
                    characterCount: 0,
                    chunkCount: 0,
                    attempt: 0,
                    createdAt: now,
                    updatedAt: now,
                },
                objectKey: `explicit-test-only/${sourceId}`,
                sha256: createHash('sha256').update(text).digest('hex'),
                fingerprint: 'a'.repeat(64),
            },
            async () => undefined
        )
        const job = await store.knowledge!.claim(60000)
        await store.knowledge!.complete(job!, {
            characterCount: text.length,
            chunks: [
                {
                    id: randomUUID(),
                    documentId: sourceId,
                    index: 1,
                    content: text,
                    characterCount: text.length,
                    charStart: 0,
                    charEnd: text.length,
                },
            ],
        })
        await scenario({ origin: `http://127.0.0.1:${address.port}`, a, b, sourceId, generate })
    } finally {
        await app.close()
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Sends one public JSON request without introducing trusted client identity fields.
 * @param origin - Test-owned API origin.
 * @param path - Actual public account or knowledge route.
 * @param headers - Genuine account session headers.
 * @param body - Optional public JSON fields.
 * @param method - HTTP method.
 * @returns The unconsumed actual HTTP response.
 */
function request(origin: string, path: string, headers: Record<string, string>, body?: unknown, method = 'POST'): Promise<Response> {
    return fetch(`${origin}/api/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('embedding HTTP input, authority, and action boundaries', () => {
    it('denies anonymous and foreign routes and does no provider work for malformed or unverified actions', async () => {
        await isolated(async ({ origin, a, b, sourceId, generate }) => {
            const id = randomUUID()
            const input = {
                requestId: id,
                name: 'My embedding',
                baseUrl: 'https://vectors.example.com/v1',
                model: 'embedding-v1',
                apiKey: 'HTTP_EMBEDDING_PRIVATE_SENTINEL',
            }
            const created = await request(origin, 'account/embedding-models', a, input)
            expect(created.status).toBe(201)
            const publicModel = (await created.json()) as EmbeddingModel
            expect(publicModel).toMatchObject({ id, revision: 1, hasApiKey: true, isDefault: true })
            expect(JSON.stringify(publicModel)).not.toContain(input.apiKey)
            const connectionRoutes = [
                { path: `account/embedding-models/${id}`, method: 'GET', body: undefined },
                {
                    path: `account/embedding-models/${id}`,
                    method: 'PUT',
                    body: { name: input.name, baseUrl: input.baseUrl, model: input.model, revision: 1 },
                },
                { path: `account/embedding-models/${id}`, method: 'DELETE', body: undefined },
                { path: `account/embedding-models/${id}/test`, method: 'POST', body: undefined },
                { path: `account/embedding-models/${id}/default`, method: 'POST', body: undefined },
            ]
            const action = { requestId: randomUUID(), modelId: id, revision: 1 }
            const sourceRoutes = [
                { path: `knowledge/documents/${sourceId}/index`, method: 'GET', body: undefined },
                { path: `knowledge/documents/${sourceId}/index`, method: 'POST', body: action },
                { path: `knowledge/documents/${sourceId}/index/retry`, method: 'POST', body: { ...action, requestId: randomUUID() } },
                { path: 'knowledge/search', method: 'POST', body: { query: 'known source', documentId: sourceId } },
            ]
            for (const route of [...connectionRoutes, ...sourceRoutes]) {
                expect((await request(origin, route.path, {}, route.body, route.method)).status).toBe(401)
                const foreign = await request(origin, route.path, b, route.body, route.method)
                expect(foreign.status).toBe(404)
                expect(await foreign.text()).not.toContain(input.apiKey)
            }
            expect((await request(origin, `knowledge/documents/${sourceId}/index`, a, action)).status).toBe(409)
            for (const body of [
                { query: ' ' },
                { query: '😀'.repeat(2001) },
                { query: 'x', topK: 21 },
                { query: 'x', documentId: 'bad' },
                { query: 'x', userId: randomUUID() },
            ])
                expect((await request(origin, 'knowledge/search', a, body)).status).toBe(400)
            expect(
                (
                    await request(origin, 'account/embedding-models', a, {
                        ...input,
                        requestId: randomUUID(),
                        baseUrl: 'https://vectors.example.com/v1/embeddings',
                    })
                ).status
            ).toBe(400)
            expect(
                (
                    await request(origin, 'account/embedding-models', a, {
                        ...input,
                        requestId: randomUUID(),
                        baseUrl: 'http://169.254.169.254',
                    })
                ).status
            ).toBe(400)
            expect(
                (await request(origin, 'account/embedding-models', a, { ...input, requestId: randomUUID(), userId: randomUUID() })).status
            ).toBe(400)
            expect(generate).not.toHaveBeenCalled()
        })
    })

    it('rejects stale in-flight probes, returns edited state for creation replay, and never revives a deleted action', async () => {
        await isolated(async ({ origin, a, generate }) => {
            const id = randomUUID()
            const input = {
                requestId: id,
                name: 'Original',
                baseUrl: 'https://vectors.example.com/v1',
                model: 'embedding-v1',
                apiKey: 'HTTP_ONLY_KEY',
            }
            expect((await request(origin, 'account/embedding-models', a, input)).status).toBe(201)
            let complete!: (result: EmbeddingResult) => void
            generate.mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        complete = resolve
                    })
            )
            const probe = request(origin, `account/embedding-models/${id}/test`, a)
            await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
            const edit = await request(
                origin,
                `account/embedding-models/${id}`,
                a,
                { name: 'Edited', baseUrl: input.baseUrl, model: 'embedding-v2', revision: 1, apiKey: '' },
                'PUT'
            )
            expect(edit.status).toBe(200)
            expect(await edit.json()).toMatchObject({ name: 'Edited', revision: 2 })
            complete({
                model: 'provider-model-v1',
                dimensions: 2,
                vectors: [
                    [1, 0],
                    [0, 1],
                ],
            })
            expect((await probe).status).toBe(409)
            const replay = await request(origin, 'account/embedding-models', a, input)
            const current = (await replay.json()) as EmbeddingModel
            expect(current).toMatchObject({ name: 'Edited', model: 'embedding-v2', revision: 2 })
            expect(current.verifiedAt).toBeUndefined()
            generate.mockRejectedValueOnce(new EmbeddingError('authentication', '向量模型认证失败，请检查 API key。'))
            const failed = await request(origin, `account/embedding-models/${id}/test`, a)
            expect(failed.status).toBe(400)
            expect(await failed.text()).not.toContain(input.apiKey)
            expect((await request(origin, `account/embedding-models/${id}`, a, undefined, 'DELETE')).status).toBe(200)
            expect((await request(origin, 'account/embedding-models', a, input)).status).toBe(409)
            expect((await request(origin, `account/embedding-models/${id}`, a, undefined, 'GET')).status).toBe(404)
            expect(generate).toHaveBeenCalledTimes(2)
        })
    })
})
