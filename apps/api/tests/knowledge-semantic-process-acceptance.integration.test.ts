import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createKnowledgeObjectStore } from '@ai-harness/chat-runtime/knowledge'
import type { KnowledgeChunk, KnowledgeDocument } from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import { registerSession } from './session-fixture.js'

const configured = Boolean(
    process.env.TEST_DATABASE_URL &&
    process.env.TEST_S3_ENDPOINT &&
    process.env.TEST_S3_ACCESS_KEY_ID &&
    process.env.TEST_S3_SECRET_ACCESS_KEY
)
const token = 'sf009-independent-production-worker-private-token-20261018'
const text = '甲'.repeat(79) + '\n\n' + '乙'.repeat(69) + '\n\n' + '丙'.repeat(139) + '\n\n' + '丁'.repeat(99)
const original = Buffer.from(text.replaceAll('\n', '\r\n'))
const expectedRanges = [
    [0, 152],
    [152, 293],
    [293, 392],
]
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
const { Pool } = createRequire(import.meta.resolve('@ai-harness/db'))('pg') as {
    Pool: new (options: { connectionString?: string }) => {
        query: Query
        connect: () => Promise<{ query: Query; release: () => void }>
        end: () => Promise<void>
    }
}
const { S3Client, DeleteObjectCommand, DeleteBucketCommand } = createRequire(import.meta.resolve('@ai-harness/chat-runtime/knowledge'))(
    '@aws-sdk/client-s3'
) as {
    S3Client: new (options: unknown) => { send: (command: unknown) => Promise<unknown>; destroy: () => void }
    DeleteObjectCommand: new (options: { Bucket: string; Key: string }) => unknown
    DeleteBucketCommand: new (options: { Bucket: string }) => unknown
}

/**
 * Reserves an ephemeral loopback port for an independently built production API process.
 * @returns The available port after closing the temporary reservation.
 * @throws Error when a temporary socket cannot be opened or released.
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
 * Terminates only this test's child process and waits for actual operating-system exit.
 * @param child - Explicitly owned production API child.
 * @param signal - Graceful shutdown or intentional crash simulation.
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

it.skipIf(!configured)(
    'uses the actual compiled parser worker for real S3 uploads, explicit failed retries, and crash lease recovery without model requests',
    async () => {
        const schema = `sf009_process_${randomUUID().replaceAll('-', '')}`
        const bucket = `sf009-process-${randomUUID().replaceAll('-', '')}`
        const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const databaseUrl = new URL(process.env.TEST_DATABASE_URL!)
        databaseUrl.searchParams.set('options', `-c search_path=${schema}`)
        databaseUrl.searchParams.set('application_name', schema)
        const objectConfig = {
            endpoint: process.env.TEST_S3_ENDPOINT!,
            region: process.env.TEST_S3_REGION || 'us-east-1',
            bucket,
            accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID!,
            secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY!,
            forcePathStyle: true,
            createBucket: true,
        }
        const objects = new S3Client({
            endpoint: objectConfig.endpoint,
            region: objectConfig.region,
            credentials: { accessKeyId: objectConfig.accessKeyId, secretAccessKey: objectConfig.secretAccessKey },
            forcePathStyle: true,
            maxAttempts: 1,
        })
        const port = await availablePort()
        const origin = `http://127.0.0.1:${port}`
        let providerCalls = 0
        const provider = createServer((_request, response) => {
            providerCalls += 1
            response.writeHead(500)
            response.end('Unexpected model request.')
        })
        provider.listen(0, '127.0.0.1')
        await once(provider, 'listening')
        const providerOrigin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
        let child: ChildProcess | undefined
        let session = ''
        let schemaCreated = false
        let bucketCreated = false
        let blocker: Awaited<ReturnType<typeof admin.connect>> | undefined
        const lockKey = parseInt(randomUUID().replaceAll('-', '').slice(0, 7), 16)

        /**
         * Starts the actual built entry point without any parser or storage dependency injection.
         * @returns The listening test-owned API OS process.
         * @throws Error for startup failure or readiness timeout.
         */
        async function boot(): Promise<ChildProcess> {
            const api = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
                env: {
                    ...process.env,
                    DATABASE_URL: databaseUrl.toString(),
                    HARNESS_API_TOKEN: token,
                    ACCOUNT_ENCRYPTION_KEY: '9'.repeat(64),
                    HARNESS_WORKSPACE_ID: schema,
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    DEEPSEEK_API_KEY: 'explicit-test-owned-model-trap-key',
                    DEEPSEEK_BASE_URL: `${providerOrigin}/v1`,
                    DEEPSEEK_MODEL: 'must-not-be-called',
                    OPENAI_ALLOWED_LOCAL_ORIGINS: providerOrigin,
                    S3_ENDPOINT: objectConfig.endpoint,
                    S3_REGION: objectConfig.region,
                    S3_BUCKET: bucket,
                    S3_ACCESS_KEY_ID: objectConfig.accessKeyId,
                    S3_SECRET_ACCESS_KEY: objectConfig.secretAccessKey,
                    S3_FORCE_PATH_STYLE: 'true',
                    S3_CREATE_BUCKET: 'false',
                },
                stdio: 'ignore',
            })
            for (let attempt = 0; attempt < 200; attempt++) {
                if (api.exitCode !== null) throw new Error('The independent production worker API exited during startup.')
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
            throw new Error('The independent production worker API did not become ready.')
        }

        /**
         * Sends genuine authenticated requests to this test's production process.
         * @param path - API-relative resource path.
         * @param method - Explicit operation.
         * @param body - Optional actual multipart or JSON payload.
         * @returns Unconsumed HTTP response.
         */
        function call(path: string, method = 'GET', body?: FormData | Record<string, unknown>): Promise<Response> {
            return fetch(`${origin}/api${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${token}`,
                    'x-harness-session': session,
                    ...(body instanceof FormData || body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
            })
        }

        /**
         * Uploads exact CRLF source bytes through the normal HTTP route.
         * @returns The stable action/document UUID after actual durable acceptance.
         */
        async function upload(): Promise<string> {
            const id = randomUUID()
            const form = new FormData()
            form.set('file', new Blob([original]), '真实worker段落😀.txt')
            form.set('requestId', id)
            form.set('chunkSize', '200')
            form.set('overlap', '0')
            const response = await call('/knowledge/documents', 'POST', form)
            expect(response.status).toBe(201)
            await response.body?.cancel()
            return id
        }

        /**
         * Waits for an authoritative document state rather than simulating processing progress.
         * @param id - Test-owned source UUID.
         * @param expected - Required durable state.
         * @returns Observed metadata in that state.
         * @throws Error when the expected state is not reached within the bounded window.
         */
        async function state(id: string, expected: KnowledgeDocument['status']): Promise<KnowledgeDocument> {
            for (let attempt = 0; attempt < 400; attempt++) {
                const response = await call(`/knowledge/documents/${id}`)
                expect(response.status).toBe(200)
                const document = (await response.json()) as KnowledgeDocument
                if (document.status === expected) return document
                if (document.status === 'failed' && expected === 'ready') throw new Error(`The production worker failed: ${document.error}`)
                await delay(20)
            }
            throw new Error(`The independent production worker source did not reach ${expected}.`)
        }

        /**
         * Checks actual stored intervals and original bytes independently from the source-mode parser.
         * @param id - Ready source UUID.
         * @returns Exact public chunk page for preservation checks across restart.
         */
        async function verify(id: string) {
            const response = await call(`/knowledge/documents/${id}/chunks?page=1&pageSize=20`)
            expect(response.status).toBe(200)
            const page = (await response.json()) as { chunks: KnowledgeChunk[]; total: number }
            expect(page.total).toBe(3)
            expect(page.chunks.map(chunk => [chunk.charStart, chunk.charEnd])).toEqual(expectedRanges)
            expect(page.chunks.map(chunk => chunk.content).join('')).toBe(text)
            const file = await call(`/knowledge/documents/${id}/file`)
            expect(file.status).toBe(200)
            expect(
                createHash('sha256')
                    .update(Buffer.from(await file.arrayBuffer()))
                    .digest('hex')
            ).toBe(createHash('sha256').update(original).digest('hex'))
            return page
        }

        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            schemaCreated = true
            const sourceClient = await createKnowledgeObjectStore(objectConfig)
            bucketCreated = true
            await sourceClient.close()
            child = await boot()
            session = await registerSession(origin, token, randomUUID())
            const firstId = await upload()
            const firstReady = await state(firstId, 'ready')
            const firstChunks = await verify(firstId)
            await admin.query(
                `CREATE FUNCTION ${schema}.fail_semantic_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.chunk_index=2 THEN RAISE EXCEPTION 'Independent deliberate persistence failure'; END IF; RETURN NEW; END $$`
            )
            await admin.query(
                `CREATE TRIGGER fail_semantic_insert BEFORE INSERT ON ${schema}.harness_knowledge_chunks FOR EACH ROW EXECUTE FUNCTION ${schema}.fail_semantic_insert()`
            )
            const failedId = await upload()
            expect(await state(failedId, 'failed')).toMatchObject({ attempt: 1, chunkCount: 0, characterCount: 0 })
            expect((await (await call(`/knowledge/documents/${failedId}/chunks?page=1&pageSize=20`)).json()).chunks).toEqual([])
            await admin.query(`DROP TRIGGER fail_semantic_insert ON ${schema}.harness_knowledge_chunks`)
            const retry = { requestId: randomUUID() }
            expect((await call(`/knowledge/documents/${failedId}/retry`, 'POST', retry)).status).toBe(201)
            expect(await state(failedId, 'ready')).toMatchObject({ attempt: 2, chunkCount: 3 })
            await verify(failedId)
            expect((await call(`/knowledge/documents/${failedId}/retry`, 'POST', retry)).status).toBe(201)
            blocker = await admin.connect()
            await blocker.query('SELECT pg_advisory_lock($1)', [lockKey])
            await admin.query(
                `CREATE FUNCTION ${schema}.hold_semantic_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lockKey}); RETURN NEW; END $$`
            )
            await admin.query(
                `CREATE TRIGGER hold_semantic_insert BEFORE INSERT ON ${schema}.harness_knowledge_chunks FOR EACH ROW EXECUTE FUNCTION ${schema}.hold_semantic_insert()`
            )
            const interruptedId = await upload()
            let held = false
            for (let attempt = 0; attempt < 400; attempt++) {
                const waiting = await admin.query(
                    "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                    [schema]
                )
                if (Number(waiting.rows[0]?.count) > 0) {
                    held = true
                    break
                }
                await delay(20)
            }
            expect(held).toBe(true)
            expect(await state(interruptedId, 'processing')).toMatchObject({ attempt: 1, chunkCount: 0 })
            const previousPid = child.pid
            await stop(child, 'SIGKILL')
            child = undefined
            await blocker.query('SELECT pg_advisory_unlock($1)', [lockKey])
            blocker.release()
            blocker = undefined
            await admin.query(`DROP TRIGGER hold_semantic_insert ON ${schema}.harness_knowledge_chunks`)
            await admin.query(
                `UPDATE ${schema}.harness_knowledge_documents SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
                [interruptedId]
            )
            child = await boot()
            expect(child.pid).not.toBe(previousPid)
            expect(await state(interruptedId, 'ready')).toMatchObject({ attempt: 2, chunkCount: 3, characterCount: 392 })
            await verify(interruptedId)
            expect(await (await call(`/knowledge/documents/${firstId}`)).json()).toEqual(firstReady)
            expect(await verify(firstId)).toEqual(firstChunks)
            expect((await admin.query(`SELECT count(*)::int AS count FROM ${schema}.harness_vector_jobs`)).rows[0]?.count).toBe(0)
            expect((await admin.query(`SELECT count(*)::int AS count FROM ${schema}.harness_knowledge_vectors`)).rows[0]?.count).toBe(0)
            expect(providerCalls).toBe(0)
        } finally {
            if (blocker) {
                await blocker.query('SELECT pg_advisory_unlock($1)', [lockKey])
                blocker.release()
            }
            await stop(child)
            if (schemaCreated) {
                const keys = await admin.query(`SELECT DISTINCT object_key FROM ${schema}.harness_knowledge_documents`)
                for (const row of keys.rows) await objects.send(new DeleteObjectCommand({ Bucket: bucket, Key: String(row.object_key) }))
                await admin.query(`DROP SCHEMA ${schema} CASCADE`)
            }
            if (bucketCreated) await objects.send(new DeleteBucketCommand({ Bucket: bucket }))
            objects.destroy()
            await admin.end()
            const closed = new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
            provider.closeAllConnections()
            await closed
        }
    },
    40_000
)
