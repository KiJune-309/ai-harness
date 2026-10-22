import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createKnowledgeObjectStore } from '@ai-harness/chat-runtime/knowledge'
import { createChatStore } from '@ai-harness/db'
import type { KnowledgeDocument } from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import { registerSession } from './session-fixture.js'

const configured = Boolean(
    process.env.TEST_DATABASE_URL &&
    process.env.TEST_S3_ENDPOINT &&
    process.env.TEST_S3_ACCESS_KEY_ID &&
    process.env.TEST_S3_SECRET_ACCESS_KEY
)
const token = 'sf007-independent-process-fixture-server-token-20261017'
const { Pool } = createRequire(import.meta.resolve('@ai-harness/db'))('pg') as {
    Pool: new (options: { connectionString?: string }) => {
        query: (sql: string, parameters?: unknown[]) => Promise<{ rows: { object_key: string }[] }>
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
 * Reserves an ephemeral loopback address for an independently built API process.
 * @returns The available HTTP port after releasing the reservation.
 * @throws Error when the temporary socket cannot be opened or closed.
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
 * Stops only this test's API child and waits for actual operating-system termination.
 * @param child - Explicitly test-owned API process.
 * @param signal - Graceful shutdown or simulated unexpected termination.
 * @returns After the process has exited.
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
    'restores exact sources, complete chunks, failures, and an expired processing lease across independent API processes with real S3 and PostgreSQL',
    async () => {
        const schema = `sf007_process_${randomUUID().replaceAll('-', '')}`
        const bucket = `sf007-process-${randomUUID().replaceAll('-', '')}`
        const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const databaseUrl = new URL(process.env.TEST_DATABASE_URL!)
        databaseUrl.searchParams.set('options', `-c search_path=${schema}`)
        const objectConfig = {
            endpoint: process.env.TEST_S3_ENDPOINT!,
            region: process.env.TEST_S3_REGION || 'us-east-1',
            bucket,
            accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID!,
            secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY!,
            forcePathStyle: true,
            createBucket: true,
        }
        const objectsAdmin = new S3Client({
            endpoint: objectConfig.endpoint,
            region: objectConfig.region,
            credentials: { accessKeyId: objectConfig.accessKeyId, secretAccessKey: objectConfig.secretAccessKey },
            forcePathStyle: true,
            maxAttempts: 1,
        })
        const port = await availablePort()
        const baseUrl = `http://127.0.0.1:${port}`
        let child: ChildProcess | undefined
        let schemaCreated = false
        let bucketCreated = false
        let session = ''

        /**
         * Boots the production API entry point using private test-owned database and object resources.
         * @returns The ready operating-system child without exposing configuration or logs.
         * @throws Error on startup failure or bounded readiness timeout.
         */
        async function boot(): Promise<ChildProcess> {
            const processApi = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
                env: {
                    ...process.env,
                    DATABASE_URL: databaseUrl.toString(),
                    HARNESS_API_TOKEN: token,
                    ACCOUNT_ENCRYPTION_KEY: '7'.repeat(64),
                    HARNESS_WORKSPACE_ID: schema,
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    DEEPSEEK_API_KEY: '',
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
            for (let attempt = 0; attempt < 100; attempt++) {
                if (processApi.exitCode !== null) throw new Error('Test-owned built API exited during startup.')
                const response = await fetch(`${baseUrl}/api/account/me`, { headers: { authorization: `Bearer ${token}` } }).catch(
                    () => undefined
                )
                if (response?.status === 401) {
                    await response.body?.cancel()
                    return processApi
                }
                await response?.body?.cancel()
                await delay(50)
            }
            await stop(processApi)
            throw new Error('Test-owned built API did not become ready.')
        }

        /**
         * Executes only authorized knowledge operations against this independent test process.
         * @param path - Resource beneath the knowledge prefix.
         * @param method - HTTP operation.
         * @param body - Optional actual multipart body.
         * @returns The unconsumed HTTP response.
         */
        async function call(path: string, method = 'GET', body?: FormData): Promise<Response> {
            return fetch(`${baseUrl}/api/knowledge${path}`, {
                method,
                headers: { authorization: `Bearer ${token}`, 'x-harness-session': session },
                ...(body ? { body } : {}),
            })
        }

        /**
         * Waits for an actual terminal public state in the independent process.
         * @param id - Persisted source identity.
         * @param state - Required observed processing state.
         * @returns Matching public metadata.
         * @throws Error for a rejected HTTP request or expired observation deadline.
         */
        async function settled(id: string, state: KnowledgeDocument['status']): Promise<KnowledgeDocument> {
            for (let attempt = 0; attempt < 300; attempt++) {
                const response = await call(`/documents/${id}`)
                expect(response.status).toBe(200)
                const document = (await response.json()) as KnowledgeDocument
                if (document.status === state) return document
                if (document.status === 'failed' && state !== 'failed')
                    throw new Error(`Built parser refused test-owned source: ${document.error}`)
                await delay(25)
            }
            throw new Error('Test-owned durable job did not settle in time.')
        }

        /**
         * Uploads real bytes through the production multipart route.
         * @param fileName - Visible filename used by the parser format boundary.
         * @param text - Exact known source bytes expressed as UTF-8 text.
         * @returns The persisted upload action identity.
         */
        async function upload(fileName: string, text: string): Promise<string> {
            const id = randomUUID()
            const form = new FormData()
            form.set('file', new Blob([text]), fileName)
            form.set('requestId', id)
            form.set('chunkSize', '200')
            form.set('overlap', '100')
            const response = await call('/documents', 'POST', form)
            expect(response.status).toBe(201)
            await response.body?.cancel()
            return id
        }

        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            schemaCreated = true
            const sourceClient = await createKnowledgeObjectStore(objectConfig)
            bucketCreated = true
            await sourceClient.close()
            child = await boot()
            session = await registerSession(baseUrl, token, randomUUID())
            const me = await fetch(`${baseUrl}/api/account/me`, {
                headers: { authorization: `Bearer ${token}`, 'x-harness-session': session },
            })
            const account = (await me.json()) as { user: { id: string } }
            const text = '持久化真实来源😀\r\n' + '恢复后相同的分片正文甲乙😀\n'.repeat(100)
            const id = await upload('进程重启😀.md', text)
            const ready = await settled(id, 'ready')
            const chunks = await (await call(`/documents/${id}/chunks?page=1&pageSize=100`)).json()
            const failedId = await upload('damaged.pdf', 'not a valid PDF')
            const failed = await settled(failedId, 'failed')
            await stop(child, 'SIGKILL')
            child = undefined
            const offlineStore = await createChatStore({ databaseUrl: databaseUrl.toString() })
            let recoveryId: string
            try {
                const scope = { userId: account.user.id, workspaceId: schema }
                const original = (await offlineStore.knowledge!.get(scope, id))!
                recoveryId = randomUUID()
                const interrupted = {
                    ...original,
                    fingerprint: createHash('sha256').update(`interrupted:${recoveryId}`).digest('hex'),
                    document: {
                        ...original.document,
                        id: recoveryId,
                        fileName: '中断恢复.md',
                        status: 'queued' as const,
                        attempt: 0,
                        chunkCount: 0,
                        characterCount: 0,
                    },
                }
                await offlineStore.knowledge!.create(scope, interrupted, async () => undefined)
                expect((await offlineStore.knowledge!.claim(60_000))?.record.document.id).toBe(recoveryId)
                await admin.query(
                    `UPDATE ${schema}.harness_knowledge_documents SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
                    [recoveryId]
                )
            } finally {
                await offlineStore.close()
            }
            child = await boot()
            expect(await (await call(`/documents/${id}`)).json()).toEqual(ready)
            expect(await (await call(`/documents/${id}/chunks?page=1&pageSize=100`)).json()).toEqual(chunks)
            expect(await (await call(`/documents/${failedId}`)).json()).toEqual(failed)
            const download = await call(`/documents/${id}/file`)
            expect(Buffer.from(await download.arrayBuffer())).toEqual(Buffer.from(text))
            expect(await (await call(`/documents/${failedId}/file`)).text()).toBe('not a valid PDF')
            const recovered = await settled(recoveryId, 'ready')
            expect(recovered.attempt).toBe(2)
            expect(recovered.characterCount).toBe(ready.characterCount)
            expect(await (await call(`/documents/${recoveryId}/file`)).text()).toBe(text)
        } finally {
            await stop(child)
            if (schemaCreated) {
                const keys = await admin.query(`SELECT DISTINCT object_key FROM ${schema}.harness_knowledge_documents`)
                for (const row of keys.rows) await objectsAdmin.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.object_key }))
                await admin.query(`DROP SCHEMA ${schema} CASCADE`)
            }
            if (bucketCreated) await objectsAdmin.send(new DeleteBucketCommand({ Bucket: bucket }))
            objectsAdmin.destroy()
            await admin.end()
        }
    },
    40_000
)
