import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChatRuntime } from '@ai-harness/chat-runtime'
import type { EmbeddingModel, KnowledgeChunk, KnowledgeSearchResult, KnowledgeVectorIndex } from '@ai-harness/contracts'
import { createChatStore, type ChatScope, type ChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { describe, expect, it } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

const token = 'sf008-independent-http-private-fixture-token-20261018'
const fixtureKey = 'sf008-independent-provider-fixture-key'
// The administrator uses the DB package's declared PostgreSQL driver without adding an application dependency.
const { Pool } = createRequire(import.meta.resolve('@ai-harness/db'))('pg') as {
    Pool: new (options: { connectionString?: string }) => { query: (sql: string) => Promise<unknown>; end: () => Promise<void> }
}
interface RecordedRequest {
    path: string
    authorization: string
    payload: { model: string; input: string[]; dimensions?: number }
}
interface Application {
    app: NestExpressApplication
    store: ChatStore
    origin: string
    headers: (userId: string) => Promise<Record<string, string>>
}
interface Context {
    requests: RecordedRequest[]
    providerOrigin: string
    scope: ChatScope
    boot: (vectorAvailable?: boolean) => Promise<Application>
    respond: (behavior: (request: RecordedRequest, response: ServerResponse) => void) => void
}

/**
 * Writes controlled vectors for an actual protocol request while making no claim about a real cloud model's semantic quality.
 * @param request - Captured request from the production core HTTP adapter.
 * @param response - Test-owned provider response writer.
 * @returns Nothing after completing the fixture response.
 */
function vectorResponse(request: RecordedRequest, response: ServerResponse): void {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
        JSON.stringify({
            model: 'independent-controlled-provider-v1',
            data: request.payload.input.map((text, index) => ({
                index,
                embedding: text.includes('反向') || text.startsWith('资料😀3:') ? [-1, 0] : text.startsWith('资料😀2:') ? [0, 1] : [1, 0],
            })),
        })
    )
}

/**
 * Runs authenticated native Nest HTTP, the unmodified embedding adapter, and real pgvector in a disposable schema.
 * @param scenario - Independent public-boundary acceptance assertions.
 * @returns After closing all test applications, provider sockets, and the owned schema.
 * @throws Error when dependencies or assertions fail.
 */
async function isolated(scenario: (context: Context) => Promise<void>): Promise<void> {
    const schema = `sf008_http_${randomUUID().replaceAll('-', '')}`
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const databaseUrl = new URL(process.env.TEST_DATABASE_URL!)
    databaseUrl.searchParams.set('options', `-c search_path=${schema}`)
    const applications: NestExpressApplication[] = []
    const requests: RecordedRequest[] = []
    let behavior = vectorResponse
    const server = createServer((request, response) => {
        void receive()
        /**
         * Receives bounded test traffic and dispatches the scenario's controlled provider response.
         * @returns After request collection or socket failure.
         */
        async function receive(): Promise<void> {
            try {
                const parts: Buffer[] = []
                for await (const part of request) parts.push(Buffer.from(part))
                const recorded = {
                    path: request.url ?? '',
                    authorization: request.headers.authorization ?? '',
                    payload: JSON.parse(Buffer.concat(parts).toString('utf8')) as RecordedRequest['payload'],
                }
                requests.push(recorded)
                behavior(recorded, response)
            } catch {
                response.destroy()
            }
        }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const providerOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const config = readTestApiConfig({
        HARNESS_API_TOKEN: token,
        DATABASE_URL: databaseUrl.toString(),
        OPENAI_ALLOWED_LOCAL_ORIGINS: providerOrigin,
    })
    const runtime: ChatRuntime = {
        /**
         * Refuses chat execution during independent explicit vector acceptance.
         * @returns Never because no chat request is authorized by this fixture.
         * @throws Error if vector configuration unexpectedly invokes the chat runtime.
         */
        async run() {
            throw new Error('Explicit vector acceptance must not execute the chat runtime.')
        },
        /**
         * Releases the fixture runtime without changing persistent state.
         * @returns Nothing after completion.
         */
        async dispose() {},
    }
    let created = false
    try {
        await admin.query(`CREATE SCHEMA ${schema}`)
        created = true
        await scenario({
            requests,
            providerOrigin,
            scope: { workspaceId: config.workspaceId, userId: randomUUID() },
            respond: replacement => {
                behavior = replacement
            },
            /**
             * Reconstructs the actual API with the same stable private key and database after shutdown.
             * @returns Listening test-owned application and genuine persistent session helper.
             * @throws Error if persistent resource or HTTP initialization fails.
             */
            async boot(vectorAvailable = true) {
                const store = await createChatStore({ databaseUrl: databaseUrl.toString() })
                if (!vectorAvailable) store.embeddings = Object.create(store.embeddings!, { vectorAvailable: { value: false } })
                const app = await createApiApp(config, {
                    store,
                    runtime,
                    logger: false,
                    vectorWorkerOptions: { pollIntervalMs: 20, leaseMs: 120_000, heartbeatMs: 10_000 },
                })
                applications.push(app)
                await app.listen(0, '127.0.0.1')
                return {
                    app,
                    store,
                    origin: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
                    headers: id => sessionHeaders(store, config, id),
                }
            },
        })
    } finally {
        for (const app of applications.reverse()) await app.close()
        const closed = new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
        server.closeAllConnections()
        await closed
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Sends strict JSON through the authenticated public HTTP boundary.
 * @param app - Test-owned listening application.
 * @param headers - Genuine account session and private service token.
 * @param path - Relative API route.
 * @param method - Explicit HTTP method.
 * @param body - Optional JSON request fields.
 * @returns Actual HTTP response without suppressing errors.
 */
function request(app: Application, headers: Record<string, string>, path: string, method = 'GET', body?: unknown): Promise<Response> {
    return fetch(`${app.origin}/api${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

/**
 * Creates a fixture model through HTTP and optionally probes the actual controlled protocol server.
 * @param app - Listening API.
 * @param headers - Genuine account session.
 * @param providerOrigin - Server-authorized fixture origin.
 * @param probe - Whether the scenario explicitly requests provider verification.
 * @returns Safe model metadata and replayable creation payload.
 */
async function connection(app: Application, headers: Record<string, string>, providerOrigin: string, probe = true) {
    const input = {
        requestId: randomUUID(),
        name: '独立协议验收连接',
        baseUrl: `${providerOrigin}/v1`,
        model: 'controlled-request-model',
        apiKey: fixtureKey,
    }
    const response = await request(app, headers, '/account/embedding-models', 'POST', input)
    expect(response.status).toBe(201)
    const model = (await response.json()) as EmbeddingModel
    if (!probe) return { model, input }
    const tested = await request(app, headers, `/account/embedding-models/${model.id}/test`, 'POST')
    expect(tested.status).toBe(201)
    return { model: ((await tested.json()) as { model: EmbeddingModel }).model, input }
}

/**
 * Persists independent immutable source fixtures without using or claiming an actual uploaded object.
 * @param app - Real test-owned shared store.
 * @param scope - Source ownership authenticated by the scenario.
 * @param count - Number of exact two-hundred-code-point source chunks.
 * @returns Ready source UUID.
 */
async function source(app: Application, scope: ChatScope, count = 3): Promise<string> {
    const id = randomUUID()
    const now = new Date().toISOString()
    const chunks: KnowledgeChunk[] = Array.from({ length: count }, (_, index) => {
        const prefix = `资料😀${index + 1}:`
        return {
            id: randomUUID(),
            documentId: id,
            index: index + 1,
            content: prefix + '文'.repeat(200 - Array.from(prefix).length),
            characterCount: 200,
            charStart: index * 200,
            charEnd: (index + 1) * 200,
        }
    })
    await app.store.knowledge!.create(
        scope,
        {
            document: {
                id,
                fileName: 'HTTP来源😀.md',
                format: 'md',
                size: 600,
                status: 'queued',
                chunkSize: 200,
                overlap: 0,
                characterCount: 0,
                chunkCount: 0,
                attempt: 0,
                createdAt: now,
                updatedAt: now,
            },
            objectKey: `explicit-isolated-source/${id}`,
            sha256: createHash('sha256').update(id).digest('hex'),
            fingerprint: createHash('sha256').update(`upload:${id}`).digest('hex'),
        },
        async () => undefined
    )
    const job = (await app.store.knowledge!.claim(120_000))!
    expect(job.record.document.id).toBe(id)
    expect(await app.store.knowledge!.complete(job, { characterCount: count * 200, chunks })).toBe(true)
    return id
}

/**
 * Observes durable index state through HTTP within a bounded test window.
 * @param app - Listening API.
 * @param headers - Persisted authorized session.
 * @param id - Owned source UUID.
 * @param expected - Required durable state.
 * @returns The matching authoritative index snapshot.
 * @throws Error if the index never reaches the requested state.
 */
async function indexState(
    app: Application,
    headers: Record<string, string>,
    id: string,
    expected: KnowledgeVectorIndex['status']
): Promise<KnowledgeVectorIndex> {
    for (let attempt = 0; attempt < 300; attempt++) {
        const response = await request(app, headers, `/knowledge/documents/${id}/index`)
        expect(response.status).toBe(200)
        const index = (await response.json()) as KnowledgeVectorIndex
        if (index.status === expected) return index
        await delay(10)
    }
    throw new Error(`The isolated index did not reach ${expected}.`)
}

/**
 * Waits for an observable test-owned protocol event without racing later mutation assertions.
 * @param predicate - Observable event predicate.
 * @returns After the event occurs.
 * @throws Error when the bounded window expires.
 */
async function observed(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 300; attempt++) {
        if (predicate()) return
        await delay(10)
    }
    throw new Error('The isolated protocol event was not observed.')
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent authenticated vector HTTP acceptance with controlled actual provider', () => {
    it('keeps configuration uncharged and keys private, then indexes and retrieves genuine SQL distances under account isolation', async () => {
        await isolated(async context => {
            const app = await context.boot()
            const headers = await app.headers(context.scope.userId)
            const other = await app.headers(randomUUID())
            const { model: untested, input } = await connection(app, headers, context.providerOrigin, false)
            expect(context.requests).toHaveLength(0)
            const id = await source(app, context.scope)
            expect((await request(app, headers, '/knowledge/search', 'POST', { query: '查询' })).status).toBe(409)
            expect(context.requests).toHaveLength(0)
            const tested = await request(app, headers, `/account/embedding-models/${untested.id}/test`, 'POST')
            expect(tested.status).toBe(201)
            const { model } = (await tested.json()) as { model: EmbeddingModel }
            expect(model).toMatchObject({ dimensions: 2, providerModel: 'independent-controlled-provider-v1', revision: 1 })
            expect(context.requests[0]).toMatchObject({
                path: '/v1/embeddings',
                authorization: `Bearer ${fixtureKey}`,
                payload: { input: ['向量连接测试', 'Embedding connection verification'] },
            })
            const privateRecord = await app.store.embeddings!.getModel(context.scope, model.id)
            expect(privateRecord?.encryptedApiKey).not.toContain(fixtureKey)
            expect((await request(app, headers, '/account/embedding-models')).status).toBe(200)
            const safe = await (await request(app, headers, '/account/embedding-models')).text()
            expect(safe).not.toContain(fixtureKey)
            expect(safe).not.toContain('encryptedApiKey')
            expect((await request(app, headers, '/knowledge/search', 'POST', { query: '未建索引' })).status).toBe(409)
            expect(context.requests).toHaveLength(1)
            const operation = { requestId: randomUUID(), modelId: model.id, revision: model.revision }
            expect((await request(app, headers, `/knowledge/documents/${id}/index`, 'POST', operation)).status).toBe(201)
            expect(await indexState(app, headers, id, 'ready')).toMatchObject({ generation: 1, completedChunks: 3, totalChunks: 3 })
            const search = await request(app, headers, '/knowledge/search', 'POST', { query: ' 正向查询 ', topK: 3, documentId: id })
            expect(search.status).toBe(201)
            const result = (await search.json()) as KnowledgeSearchResult
            expect(result.query).toBe('正向查询')
            expect(result.hits.map(hit => hit.chunk.index)).toEqual([1, 2, 3])
            expect(result.hits.map(hit => hit.distance)).toEqual([0, 1, 2])
            expect(result.hits.map(hit => hit.score)).toEqual([1, 0, -1])
            const calls = context.requests.length
            for (const [path, method, body] of [
                [`/account/embedding-models/${model.id}`, 'GET', undefined],
                [`/account/embedding-models/${model.id}/test`, 'POST', undefined],
                [`/account/embedding-models/${model.id}/default`, 'POST', undefined],
                [`/account/embedding-models/${model.id}`, 'DELETE', undefined],
                [`/knowledge/documents/${id}/index`, 'GET', undefined],
                [`/knowledge/documents/${id}/index`, 'POST', operation],
                ['/knowledge/search', 'POST', { query: '越权查询', documentId: id }],
                ['/knowledge/search', 'POST', { query: '不存在', documentId: randomUUID() }],
            ] as const)
                expect((await request(app, other, path, method, body)).status).toBe(404)
            expect(context.requests).toHaveLength(calls)
            for (const body of [{ query: ' ' }, { query: '😀'.repeat(2001) }, { query: '合法', topK: 21 }, { query: '合法', topK: 1.5 }])
                expect((await request(app, headers, '/knowledge/search', 'POST', body)).status).toBe(400)
            expect(context.requests).toHaveLength(calls)
            const anonymous = await fetch(`${app.origin}/api/knowledge/vector-status`, { headers: { authorization: `Bearer ${token}` } })
            expect(anonymous.status).toBe(401)
            expect((await request(app, headers, `/account/embedding-models/${model.id}`, 'DELETE')).status).toBe(200)
            expect((await request(app, headers, '/account/embedding-models', 'POST', input)).status).toBe(409)
            expect((await request(app, headers, `/knowledge/documents/${id}/index`)).status).toBe(200)
            expect(context.requests).toHaveLength(calls)
        })
    })

    it('rejects stale probes after edits and rejects valid legacy-chat ciphertext before any embedding request', async () => {
        await isolated(async context => {
            const app = await context.boot()
            const headers = await app.headers(context.scope.userId)
            const { model, input } = await connection(app, headers, context.providerOrigin, false)
            let held: { record: RecordedRequest; response: ServerResponse } | undefined
            context.respond((record, response) => {
                held = { record, response }
            })
            const pending = request(app, headers, `/account/embedding-models/${model.id}/test`, 'POST')
            await observed(() => Boolean(held))
            const changed = await request(app, headers, `/account/embedding-models/${model.id}`, 'PUT', {
                name: model.name,
                baseUrl: model.baseUrl,
                model: 'changed-request-model',
                revision: 1,
                apiKey: '',
            })
            expect(changed.status).toBe(200)
            expect(await changed.json()).toMatchObject({ revision: 2 })
            vectorResponse(held!.record, held!.response)
            expect((await pending).status).toBe(409)
            const current = (await app.store.embeddings!.getModel(context.scope, model.id))!
            expect(current.model.dimensions).toBeUndefined()
            // This is valid legacy chat AES-GCM for exactly the same owner and model ID; only its purpose differs.
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', Buffer.from('a'.repeat(64), 'hex'), iv)
            cipher.setAAD(Buffer.from(JSON.stringify([context.scope.workspaceId, context.scope.userId, model.id])))
            const ciphertext = Buffer.concat([cipher.update(input.apiKey, 'utf8'), cipher.final()])
            const legacy = [
                'v1',
                iv.toString('base64url'),
                cipher.getAuthTag().toString('base64url'),
                ciphertext.toString('base64url'),
            ].join('.')
            await app.store.embeddings!.updateModel(context.scope, model.id, 2, { model: current.model, encryptedApiKey: legacy })
            const calls = context.requests.length
            const swapped = await request(app, headers, `/account/embedding-models/${model.id}/test`, 'POST')
            expect(swapped.status).toBe(503)
            const publicError = await swapped.text()
            expect(publicError).not.toContain(fixtureKey)
            expect(publicError).not.toContain(legacy)
            expect(context.requests).toHaveLength(calls)
            context.respond(vectorResponse)
            const repaired = await request(app, headers, `/account/embedding-models/${model.id}`, 'PUT', {
                name: model.name,
                baseUrl: model.baseUrl,
                model: 'changed-request-model',
                revision: 3,
                apiKey: 'replacement-controlled-fixture-key',
            })
            expect(repaired.status).toBe(200)
            expect(await repaired.json()).toMatchObject({ revision: 4 })
            expect((await request(app, headers, `/account/embedding-models/${model.id}/test`, 'POST')).status).toBe(201)
            expect(context.requests.at(-1)?.authorization).toBe('Bearer replacement-controlled-fixture-key')
        })
    })

    it('drains an interrupted provider on real Nest shutdown and resumes only missing chunks using persisted sessions and the same generation', async () => {
        await isolated(async context => {
            const first = await context.boot()
            const headers = await first.headers(context.scope.userId)
            const { model } = await connection(first, headers, context.providerOrigin)
            const id = await source(first, context.scope, 18)
            let interrupted = false
            context.respond((record, response) => {
                if (record.payload.input[0]?.startsWith('资料😀17:')) interrupted = true
                else vectorResponse(record, response)
            })
            const action = { requestId: randomUUID(), modelId: model.id, revision: model.revision }
            expect((await request(first, headers, `/knowledge/documents/${id}/index`, 'POST', action)).status).toBe(201)
            await observed(() => interrupted)
            expect(await first.store.embeddings!.getIndex(context.scope, id)).toMatchObject({
                status: 'indexing',
                generation: 1,
                completedChunks: 16,
            })
            await first.app.close()
            context.respond(vectorResponse)
            const callsBeforeRestart = context.requests.length
            const second = await context.boot()
            expect(await indexState(second, headers, id, 'ready')).toMatchObject({ generation: 1, attempt: 2, completedChunks: 18 })
            const resumed = context.requests.slice(callsBeforeRestart)
            expect(resumed).toHaveLength(1)
            expect(resumed[0]!.payload.input).toHaveLength(2)
            expect(resumed[0]!.payload.input[0]).toMatch(/^资料😀17:/)
            expect((await request(second, headers, `/knowledge/documents/${id}/index`, 'POST', action)).status).toBe(201)
            await delay(50)
            expect(context.requests.slice(callsBeforeRestart)).toHaveLength(1)
            const queried = await request(second, headers, '/knowledge/search', 'POST', { query: '正向', topK: 20 })
            expect(queried.status).toBe(201)
            expect(((await queried.json()) as KnowledgeSearchResult).hits).toHaveLength(18)
        })
    })

    it('rejects a query finishing after the default changed and invalidates an index after verified provider identity drift', async () => {
        await isolated(async context => {
            const app = await context.boot()
            const headers = await app.headers(context.scope.userId)
            const { model: first } = await connection(app, headers, context.providerOrigin)
            const { model: second } = await connection(app, headers, context.providerOrigin)
            const id = await source(app, context.scope)
            const action = { requestId: randomUUID(), modelId: first.id, revision: first.revision }
            expect((await request(app, headers, `/knowledge/documents/${id}/index`, 'POST', action)).status).toBe(201)
            await indexState(app, headers, id, 'ready')
            let held: { record: RecordedRequest; response: ServerResponse } | undefined
            context.respond((record, response) => {
                held = { record, response }
            })
            const pending = request(app, headers, '/knowledge/search', 'POST', { query: '旧模型查询', documentId: id })
            await observed(() => Boolean(held))
            const calls = context.requests.length
            expect((await request(app, headers, `/account/embedding-models/${second.id}/default`, 'POST')).status).toBe(201)
            expect(context.requests).toHaveLength(calls)
            vectorResponse(held!.record, held!.response)
            expect((await pending).status).toBe(409)
            expect(await indexState(app, headers, id, 'stale')).toMatchObject({ generation: 1 })
            expect((await request(app, headers, '/knowledge/search', 'POST', { query: '新空间没有索引' })).status).toBe(409)
            expect(context.requests).toHaveLength(calls)
            expect((await request(app, headers, `/account/embedding-models/${first.id}/default`, 'POST')).status).toBe(201)
            context.respond((record, response) => {
                response.writeHead(200, { 'content-type': 'application/json' })
                response.end(
                    JSON.stringify({
                        model: 'independent-controlled-provider-v2',
                        data: record.payload.input.map((_text, index) => ({ index, embedding: [1, 0] })),
                    })
                )
            })
            expect((await request(app, headers, '/knowledge/search', 'POST', { query: '服务发生漂移', documentId: id })).status).toBe(409)
            const tested = await request(app, headers, `/account/embedding-models/${first.id}/test`, 'POST')
            expect(tested.status).toBe(201)
            expect(((await tested.json()) as { model: EmbeddingModel }).model).toMatchObject({
                revision: 2,
                providerModel: 'independent-controlled-provider-v2',
                dimensions: 2,
            })
            await indexState(app, headers, id, 'stale')
            const afterProbe = context.requests.length
            expect((await request(app, headers, '/knowledge/search', 'POST', { query: '旧代不能继续用' })).status).toBe(409)
            expect(context.requests).toHaveLength(afterProbe)
        })
    })

    it('keeps failed partial batches unsearchable and resumes a compatible explicit retry without duplicating checkpoints', async () => {
        await isolated(async context => {
            const app = await context.boot()
            const headers = await app.headers(context.scope.userId)
            const { model } = await connection(app, headers, context.providerOrigin)
            const id = await source(app, context.scope, 18)
            const originalChunks = await app.store.knowledge!.chunks(context.scope, id, 1, 20)
            context.respond((record, response) => {
                if (record.payload.input[0]?.startsWith('资料😀17:')) {
                    response.writeHead(429, { 'content-type': 'application/json' })
                    response.end(JSON.stringify({ error: { message: `private-provider-batch-error:${fixtureKey}` } }))
                } else vectorResponse(record, response)
            })
            const operation = { requestId: randomUUID(), modelId: model.id, revision: model.revision }
            expect((await request(app, headers, `/knowledge/documents/${id}/index`, 'POST', operation)).status).toBe(201)
            const failed = await indexState(app, headers, id, 'failed')
            expect(failed).toMatchObject({ generation: 1, completedChunks: 16, totalChunks: 18 })
            expect(failed.error).not.toContain(fixtureKey)
            expect(failed.error).not.toContain('private-provider-batch-error')
            const calls = context.requests.length
            expect((await request(app, headers, '/knowledge/search', 'POST', { query: '不完整代禁止召回', documentId: id })).status).toBe(
                409
            )
            expect(context.requests).toHaveLength(calls)
            expect(await app.store.knowledge!.chunks(context.scope, id, 1, 20)).toEqual(originalChunks)
            expect((await app.store.knowledge!.get(context.scope, id))?.document.status).toBe('ready')
            context.respond(vectorResponse)
            const retry = { ...operation, requestId: randomUUID() }
            expect((await request(app, headers, `/knowledge/documents/${id}/index/retry`, 'POST', retry)).status).toBe(201)
            expect(await indexState(app, headers, id, 'ready')).toMatchObject({ generation: 1, attempt: 2, completedChunks: 18 })
            expect(context.requests.slice(calls)).toHaveLength(1)
            expect(context.requests[calls]?.payload.input).toHaveLength(2)
            expect((await request(app, headers, `/knowledge/documents/${id}/index/retry`, 'POST', retry)).status).toBe(201)
            await delay(50)
            expect(context.requests.slice(calls)).toHaveLength(1)
        })
    })

    it('reports an explicitly unavailable vector capability with safe 503 and zero provider calls while retaining real sources and accounts', async () => {
        await isolated(async context => {
            const app = await context.boot(false)
            const headers = await app.headers(context.scope.userId)
            const { model } = await connection(app, headers, context.providerOrigin, false)
            const id = await source(app, context.scope)
            const original = await app.store.knowledge!.chunks(context.scope, id, 1, 20)
            const status = await request(app, headers, '/knowledge/vector-status')
            expect(status.status).toBe(200)
            expect(await status.json()).toMatchObject({ available: false, defaultModel: { id: model.id } })
            for (const [path, body] of [
                [`/knowledge/documents/${id}/index`, { requestId: randomUUID(), modelId: model.id, revision: 1 }],
                ['/knowledge/search', { query: '数据库能力缺失不能假检索' }],
            ] as const) {
                const response = await request(app, headers, path, 'POST', body)
                expect(response.status).toBe(503)
                expect(await response.text()).not.toContain(fixtureKey)
            }
            const account = await request(app, headers, '/account/me')
            expect(account.status).toBe(200)
            expect(await app.store.knowledge!.chunks(context.scope, id, 1, 20)).toEqual(original)
            expect((await app.store.knowledge!.get(context.scope, id))?.document.status).toBe('ready')
            expect(context.requests).toHaveLength(0)
        })
    })
})
