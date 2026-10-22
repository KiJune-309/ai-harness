import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createChatStore, type ChatScope } from '@ai-harness/db'
import type { EmbeddingModel, KnowledgeChunk, KnowledgeSearchResult, KnowledgeVectorIndex } from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import { registerSession } from './session-fixture.js'

const token = 'sf008-independent-process-fixture-private-token-20261018'
const fixtureKey = 'sf008-independent-process-controlled-provider-key'
// The test-owned administrator uses the DB package's own driver and never changes the public extension or main schema.
const { Pool } = createRequire(import.meta.resolve('@ai-harness/db'))('pg') as {
    Pool: new (options: { connectionString?: string }) => {
        query: (sql: string, parameters?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
        end: () => Promise<void>
    }
}

/**
 * Reserves an available loopback port for a production child process.
 * @returns Port number after releasing the temporary reservation.
 * @throws Error when socket reservation fails.
 */
async function availablePort(): Promise<number> {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert(address && typeof address !== 'string')
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    return address.port
}

/**
 * Terminates only this test's OS process and waits for actual exit.
 * @param child - Explicitly test-owned API child.
 * @param signal - Graceful shutdown or deliberate crash simulation.
 * @returns After the child has exited.
 */
async function stop(child: ChildProcess | undefined, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill(signal)
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    try {
        await exited
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * Persists controlled immutable source chunks for testing vector process recovery independently from source ingestion.
 * @param databaseUrl - Isolated real PostgreSQL schema.
 * @param scope - Genuine account and workspace obtained from the public API.
 * @param count - Number of complete two-hundred-character chunks.
 * @returns Ready source UUID.
 * @throws Error if source persistence or its ready publication fails.
 */
async function source(databaseUrl: string, scope: ChatScope, count: number): Promise<string> {
    const store = await createChatStore({ databaseUrl })
    try {
        const id = randomUUID()
        const now = new Date().toISOString()
        const chunks: KnowledgeChunk[] = Array.from({ length: count }, (_, index) => {
            const prefix = `进程来源😀${index + 1}:`
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
        await store.knowledge!.create(
            scope,
            {
                document: {
                    id,
                    fileName: '独立进程来源😀.md',
                    format: 'md',
                    size: count * 600,
                    status: 'queued',
                    chunkSize: 200,
                    overlap: 0,
                    characterCount: 0,
                    chunkCount: 0,
                    attempt: 0,
                    createdAt: now,
                    updatedAt: now,
                },
                objectKey: `explicit-isolated-source-fixture/${id}`,
                sha256: createHash('sha256').update(id).digest('hex'),
                fingerprint: createHash('sha256').update(`source:${id}`).digest('hex'),
            },
            async () => undefined
        )
        const job = (await store.knowledge!.claim(120_000))!
        expect(job.record.document.id).toBe(id)
        expect(await store.knowledge!.complete(job, { characterCount: count * 200, chunks })).toBe(true)
        return id
    } finally {
        await store.close()
    }
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'retains real vectors, configuration, sessions, and committed checkpoints across independent production OS processes after a crash',
    async () => {
        const schema = `sf008_process_${randomUUID().replaceAll('-', '')}`
        const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const databaseUrl = new URL(process.env.TEST_DATABASE_URL!)
        databaseUrl.searchParams.set('options', `-c search_path=${schema}`)
        const port = await availablePort()
        const origin = `http://127.0.0.1:${port}`
        const requests: { input: string[]; model: string }[] = []
        let holdFinalBatch = false
        let sawFinalBatch = false
        const server = createServer((request, response) => {
            void receive()
            /**
             * Handles actual bounded embedding HTTP requests and deliberately stalls one uncommitted batch.
             * @returns After receiving and dispatching one controlled provider request.
             */
            async function receive(): Promise<void> {
                try {
                    const parts: Buffer[] = []
                    for await (const part of request) parts.push(Buffer.from(part))
                    const payload = JSON.parse(Buffer.concat(parts).toString('utf8')) as { input: string[]; model: string }
                    requests.push(payload)
                    if (holdFinalBatch && payload.input[0]?.startsWith('进程来源😀17:')) {
                        sawFinalBatch = true
                        return
                    }
                    response.writeHead(200, { 'content-type': 'application/json' })
                    response.end(
                        JSON.stringify({
                            model: 'independent-process-provider-v1',
                            data: payload.input.map((text, index) => ({
                                index,
                                embedding: text.startsWith('进程来源😀2:') ? [0, 1] : text.startsWith('进程来源😀3:') ? [-1, 0] : [1, 0],
                            })),
                        })
                    )
                } catch {
                    response.destroy()
                }
            }
        })
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        const providerOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        let child: ChildProcess | undefined
        let created = false
        let session = ''

        /**
         * Boots the actual production API bundle in an independent operating-system process with stable private configuration.
         * @returns The ready child process after an actual authenticated-boundary readiness probe.
         * @throws Error for startup failure or bounded readiness timeout.
         */
        async function boot(): Promise<ChildProcess> {
            const api = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
                env: {
                    ...process.env,
                    DATABASE_URL: databaseUrl.toString(),
                    HARNESS_API_TOKEN: token,
                    ACCOUNT_ENCRYPTION_KEY: '8'.repeat(64),
                    HARNESS_WORKSPACE_ID: schema,
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    OPENAI_ALLOWED_LOCAL_ORIGINS: providerOrigin,
                    DEEPSEEK_API_KEY: '',
                    S3_ENDPOINT: '',
                    S3_BUCKET: '',
                    S3_ACCESS_KEY_ID: '',
                    S3_SECRET_ACCESS_KEY: '',
                },
                stdio: 'ignore',
            })
            for (let attempt = 0; attempt < 150; attempt++) {
                if (api.exitCode !== null) throw new Error('The isolated production API exited during startup.')
                const response = await fetch(`${origin}/api/account/me`, { headers: { authorization: `Bearer ${token}` } }).catch(
                    () => undefined
                )
                if (response?.status === 401) {
                    await response.body?.cancel()
                    return api
                }
                await response?.body?.cancel()
                await delay(50)
            }
            await stop(api)
            throw new Error('The isolated production API did not become ready.')
        }

        /**
         * Performs one public operation using the same genuine persistent session across process lifetimes.
         * @param path - API-relative route.
         * @param method - Explicit HTTP method.
         * @param body - Optional JSON payload.
         * @returns Actual unconsumed HTTP response.
         */
        function call(path: string, method = 'GET', body?: unknown): Promise<Response> {
            return fetch(`${origin}/api${path}`, {
                method,
                headers: { authorization: `Bearer ${token}`, 'x-harness-session': session, 'content-type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }

        /**
         * Observes a complete durable generation through the independent production HTTP process.
         * @param id - Source UUID.
         * @returns Ready authoritative index metadata.
         * @throws Error if the generation fails or never becomes ready.
         */
        async function ready(id: string): Promise<KnowledgeVectorIndex> {
            for (let attempt = 0; attempt < 300; attempt++) {
                const response = await call(`/knowledge/documents/${id}/index`)
                expect(response.status).toBe(200)
                const index = (await response.json()) as KnowledgeVectorIndex
                if (index.status === 'ready') return index
                if (index.status === 'failed') throw new Error(`The isolated provider generation failed: ${index.error}`)
                await delay(25)
            }
            throw new Error('The isolated vector generation did not become ready.')
        }

        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            created = true
            child = await boot()
            const initialPid = child.pid
            session = await registerSession(origin, token, randomUUID())
            const me = (await (await call('/account/me')).json()) as { user: { id: string } }
            const scope = { userId: me.user.id, workspaceId: schema }
            const creation = {
                requestId: randomUUID(),
                name: '独立进程向量连接',
                baseUrl: `${providerOrigin}/v1`,
                model: 'process-fixture-model',
                apiKey: fixtureKey,
            }
            const createdModel = await call('/account/embedding-models', 'POST', creation)
            expect(createdModel.status).toBe(201)
            const initialModel = (await createdModel.json()) as EmbeddingModel
            const probe = await call(`/account/embedding-models/${initialModel.id}/test`, 'POST')
            expect(probe.status).toBe(201)
            const model = ((await probe.json()) as { model: EmbeddingModel }).model
            const small = await source(databaseUrl.toString(), scope, 3)
            const smallAction = { requestId: randomUUID(), modelId: model.id, revision: model.revision }
            expect((await call(`/knowledge/documents/${small}/index`, 'POST', smallAction)).status).toBe(201)
            const originalIndex = await ready(small)
            const originalSearch = (await (
                await call('/knowledge/search', 'POST', { query: '恢复前后完全一致', topK: 3, documentId: small })
            ).json()) as KnowledgeSearchResult
            expect(originalSearch.hits.map(hit => hit.distance)).toEqual([0, 1, 2])
            const originalVectors = (
                await admin.query(
                    `SELECT document_id,generation,chunk_index,model_id,revision,dimensions,provider_model,embedding::text FROM ${schema}.harness_knowledge_vectors WHERE document_id=$1 ORDER BY chunk_index`,
                    [small]
                )
            ).rows
            const recovery = await source(databaseUrl.toString(), scope, 18)
            const recoveryAction = { requestId: randomUUID(), modelId: model.id, revision: model.revision }
            holdFinalBatch = true
            expect((await call(`/knowledge/documents/${recovery}/index`, 'POST', recoveryAction)).status).toBe(201)
            for (let attempt = 0; attempt < 300 && !sawFinalBatch; attempt++) await delay(10)
            expect(sawFinalBatch).toBe(true)
            expect(await (await call(`/knowledge/documents/${recovery}/index`)).json()).toMatchObject({
                status: 'indexing',
                generation: 1,
                attempt: 1,
                completedChunks: 16,
                totalChunks: 18,
            })
            await stop(child, 'SIGKILL')
            child = undefined
            await admin.query(
                `UPDATE ${schema}.harness_vector_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE document_id=$1`,
                [recovery]
            )
            holdFinalBatch = false
            const callsBeforeRestart = requests.length
            child = await boot()
            expect(child.pid).not.toBe(initialPid)
            expect(await ready(recovery)).toMatchObject({ generation: 1, attempt: 2, completedChunks: 18 })
            expect(requests.slice(callsBeforeRestart)).toHaveLength(1)
            expect(requests[callsBeforeRestart]!.input).toHaveLength(2)
            expect(requests[callsBeforeRestart]!.input[0]).toMatch(/^进程来源😀17:/)
            expect(await (await call(`/account/embedding-models/${model.id}`)).json()).toEqual(model)
            expect(await (await call('/knowledge/vector-status')).json()).toMatchObject({ available: true, defaultModel: model })
            expect(await (await call(`/knowledge/documents/${small}/index`)).json()).toEqual(originalIndex)
            expect(
                (
                    await admin.query(
                        `SELECT document_id,generation,chunk_index,model_id,revision,dimensions,provider_model,embedding::text FROM ${schema}.harness_knowledge_vectors WHERE document_id=$1 ORDER BY chunk_index`,
                        [small]
                    )
                ).rows
            ).toEqual(originalVectors)
            expect(
                await (await call('/knowledge/search', 'POST', { query: '恢复前后完全一致', topK: 3, documentId: small })).json()
            ).toEqual(originalSearch)
            const callsAfterQuery = requests.length
            expect((await call(`/knowledge/documents/${recovery}/index`, 'POST', recoveryAction)).status).toBe(201)
            await delay(100)
            expect(requests).toHaveLength(callsAfterQuery)
            expect((await call('/account/embedding-models', 'POST', creation)).status).toBe(201)
            expect(requests).toHaveLength(callsAfterQuery)
        } finally {
            await stop(child)
            const closed = new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
            server.closeAllConnections()
            await closed
            if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
            await admin.end()
        }
    },
    30_000
)
