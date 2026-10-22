import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChatRuntime } from '@ai-harness/chat-runtime'
import { parseKnowledgeDocument, type KnowledgeObjectStore } from '@ai-harness/chat-runtime/knowledge'
import { createChatStore, type ChatStore } from '@ai-harness/db'
import type { KnowledgeDocument } from '@ai-harness/contracts'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp, type ApiResources } from '../src/app.js'
import { readTestApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

const token = 'sf007-independent-http-private-fixture-token-20261017'
// The schema administrator uses the database package's own driver rather than adding a production API dependency.
const { Pool } = createRequire(import.meta.resolve('@ai-harness/db'))('pg') as {
    Pool: new (options: { connectionString?: string }) => { query: (sql: string) => Promise<unknown>; end: () => Promise<void> }
}

interface Context {
    databaseUrl: string
    objects: KnowledgeObjectStore
    sources: Map<string, Uint8Array>
    writes: () => number
    unavailable: (enabled: boolean) => void
    boot: (processor?: ApiResources['knowledgeProcessor']) => Promise<{ app: NestExpressApplication; baseUrl: string; store: ChatStore }>
}

/**
 * Runs real authenticated Nest HTTP and PostgreSQL against a private test-owned source fixture.
 * @param scenario - HTTP acceptance assertions using isolated resources.
 * @returns After all applications and the random test schema have been cleaned up.
 * @throws Error for dependency failures or failed assertions.
 */
async function isolated(scenario: (context: Context) => Promise<void>): Promise<void> {
    const schema = `sf007_http_${randomUUID().replaceAll('-', '')}`
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    const applications: NestExpressApplication[] = []
    const sources = new Map<string, Uint8Array>()
    let writes = 0
    let unavailable = false
    const objects: KnowledgeObjectStore = {
        /**
         * Persists an independent copy in this explicitly injected test fixture.
         * @param key - Opaque server-generated reference.
         * @param bytes - Original upload bytes.
         * @returns After the fixture write is acknowledged.
         * @throws Error when the scenario simulates an object-service outage.
         */
        async put(key, bytes) {
            if (unavailable) throw new Error('Private fixture storage is unavailable.')
            writes += 1
            sources.set(key, Uint8Array.from(bytes))
        },
        /**
         * Reads a copy of the exact original bytes in the isolated fixture.
         * @param key - Database-authorized source reference.
         * @returns Exact original bytes.
         * @throws Error when the test simulates a missing or unavailable object.
         */
        async get(key) {
            if (unavailable || !sources.has(key)) throw new Error('Private fixture source is unavailable.')
            return Uint8Array.from(sources.get(key)!)
        },
        /**
         * Keeps test-owned source bytes available across isolated API reconstruction.
         * @returns Nothing after completing the fixture lifecycle operation.
         */
        async close() {},
    }
    const runtime: ChatRuntime = {
        /**
         * Refuses unexpected model execution during a document-ingestion test.
         * @returns Never; model execution is outside this acceptance scenario.
         * @throws Error if ingestion incorrectly attempts to call a language model.
         */
        async run() {
            throw new Error('Document ingestion must not execute the chat model.')
        },
        /**
         * Releases the empty test-owned runtime.
         * @returns Nothing after completion.
         */
        async dispose() {},
    }
    let created = false
    try {
        await admin.query(`CREATE SCHEMA ${schema}`)
        created = true
        await scenario({
            databaseUrl: url.toString(),
            objects,
            sources,
            writes: () => writes,
            unavailable: enabled => {
                unavailable = enabled
            },
            /**
             * Opens the actual Nest application and shared PostgreSQL store on an isolated port.
             * @param processor - Optional bounded scenario processor; defaults to the real parser.
             * @returns The ready HTTP application and its private test-owned store.
             * @throws Error if HTTP or persistent resource initialization fails.
             */
            async boot(processor = parseKnowledgeDocument) {
                const config = readTestApiConfig({ HARNESS_API_TOKEN: token, DATABASE_URL: url.toString() })
                const store = await createChatStore({ databaseUrl: url.toString() })
                const app = await createApiApp(config, {
                    store,
                    runtime,
                    logger: false,
                    knowledgeObjectStore: objects,
                    knowledgeProcessor: processor,
                    knowledgeWorkerOptions: { pollIntervalMs: 20, leaseMs: 120_000 },
                })
                applications.push(app)
                await app.listen(0, '127.0.0.1')
                const address = app.getHttpServer().address() as AddressInfo
                return { app, baseUrl: `http://127.0.0.1:${address.port}`, store }
            },
        })
    } finally {
        for (const app of applications.reverse()) await app.close()
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Builds browser-style multipart input with one source and the canonical action fields.
 * @param action - Stable upload action UUID.
 * @param content - Known original source text.
 * @param fileName - Filename presented by the user.
 * @returns A multipart body containing the actual original bytes.
 */
function multipart(action: string, content: string, fileName = '来源😀.md'): FormData {
    const form = new FormData()
    form.set('file', new Blob([content]), fileName)
    form.set('requestId', action)
    form.set('chunkSize', '200')
    form.set('overlap', '100')
    return form
}

/**
 * Waits for the durable public status rather than inferring progress from polling frequency.
 * @param baseUrl - Actual isolated API origin.
 * @param id - Persisted source UUID.
 * @param headers - Genuine test-owned authenticated session.
 * @param status - Expected terminal or processing state.
 * @returns The observed matching public metadata.
 * @throws Error when the bounded observation window expires.
 */
async function status(
    baseUrl: string,
    id: string,
    headers: Record<string, string>,
    status: KnowledgeDocument['status']
): Promise<KnowledgeDocument> {
    let observed: KnowledgeDocument | undefined
    for (let attempt = 0; attempt < 200; attempt++) {
        const response = await fetch(`${baseUrl}/api/knowledge/documents/${id}`, { headers })
        expect(response.status).toBe(200)
        const document = (await response.json()) as KnowledgeDocument
        observed = document
        if (document.status === status) return document
        await delay(10)
    }
    throw new Error(
        `The test-owned document did not enter expected state ${status}; last observed ${observed?.status}, attempt ${observed?.attempt}, public error ${observed?.error ?? 'none'}.`
    )
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent knowledge HTTP acceptance', () => {
    it('rejects unauthorized, oversized, empty, path-bearing, and invalid-parameter multipart uploads before source persistence', async () => {
        await isolated(async context => {
            const { baseUrl, store } = await context.boot()
            const config = readTestApiConfig({ HARNESS_API_TOKEN: token })
            const a = await sessionHeaders(store, config, randomUUID())
            const uploadHeaders = { authorization: a.authorization!, 'x-harness-session': a['x-harness-session']! }
            const anonymous = await fetch(`${baseUrl}/api/knowledge/documents`, {
                method: 'POST',
                headers: { authorization: a.authorization! },
                body: multipart(randomUUID(), 'An unauthorized original'),
            })
            expect(anonymous.status).toBe(401)
            const oversized = multipart(randomUUID(), 'placeholder')
            oversized.set('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'too-large.txt')
            expect(
                (await fetch(`${baseUrl}/api/knowledge/documents`, { method: 'POST', headers: uploadHeaders, body: oversized })).status
            ).toBe(413)
            for (const form of [
                multipart(randomUUID(), '', 'empty.txt'),
                multipart(randomUUID(), '<svg/>', 'unsupported.svg'),
                multipart(randomUUID(), 'A source', '../escape.md'),
            ]) {
                expect(
                    (await fetch(`${baseUrl}/api/knowledge/documents`, { method: 'POST', headers: uploadHeaders, body: form })).status
                ).toBe(400)
            }
            const invalid = multipart(randomUUID(), 'Known source')
            invalid.set('overlap', '101')
            expect(
                (await fetch(`${baseUrl}/api/knowledge/documents`, { method: 'POST', headers: uploadHeaders, body: invalid })).status
            ).toBe(400)
            const list = await fetch(`${baseUrl}/api/knowledge/documents`, { headers: a })
            expect(await list.json()).toMatchObject({ total: 0, documents: [] })
            expect(context.writes()).toBe(0)
        })
    })

    it('uploads actual Unicode text, preserves replay, denies foreign identities, and downloads only verified original bytes', async () => {
        await isolated(async context => {
            const { baseUrl, store } = await context.boot()
            const config = readTestApiConfig({ HARNESS_API_TOKEN: token })
            const a = await sessionHeaders(store, config, randomUUID())
            const b = await sessionHeaders(store, config, randomUUID())
            const uploadHeaders = { authorization: a.authorization!, 'x-harness-session': a['x-harness-session']! }
            const id = randomUUID()
            const text = '\uFEFF第一段😀\r\n<script>globalThis.documentMustNotExecute=true</script>\r第二段\n' + '资料甲😀乙\n'.repeat(100)
            const uploaded = await fetch(`${baseUrl}/api/knowledge/documents`, {
                method: 'POST',
                headers: uploadHeaders,
                body: multipart(id, text),
            })
            expect(uploaded.status).toBe(201)
            expect(await uploaded.json()).toMatchObject({ id, fileName: '来源😀.md', status: 'queued' })
            const ready = await status(baseUrl, id, a, 'ready')
            expect(ready.chunkCount).toBeGreaterThan(1)
            expect(ready.fileName).toBe('来源😀.md')
            const chunkResponse = await fetch(`${baseUrl}/api/knowledge/documents/${id}/chunks?page=1&pageSize=100`, { headers: a })
            const chunkText = await chunkResponse.text()
            expect(chunkText).toContain('<script>globalThis.documentMustNotExecute=true</script>')
            expect(chunkText).not.toContain('objectKey')
            expect(chunkText).not.toContain('private-fixture')
            const replay = await fetch(`${baseUrl}/api/knowledge/documents`, {
                method: 'POST',
                headers: uploadHeaders,
                body: multipart(id, text),
            })
            expect(replay.status).toBe(201)
            expect(await replay.json()).toMatchObject({ id, status: 'ready' })
            expect(context.writes()).toBe(1)
            const conflict = await fetch(`${baseUrl}/api/knowledge/documents`, {
                method: 'POST',
                headers: uploadHeaders,
                body: multipart(id, text + 'changed'),
            })
            expect(conflict.status).toBe(409)
            for (const path of [`documents/${id}`, `documents/${id}/chunks`, `documents/${id}/file`]) {
                expect((await fetch(`${baseUrl}/api/knowledge/${path}`, { headers: b })).status).toBe(404)
                expect((await fetch(`${baseUrl}/api/knowledge/${path}`, { headers: { authorization: a.authorization! } })).status).toBe(401)
            }
            const deniedRetry = await fetch(`${baseUrl}/api/knowledge/documents/${id}/retry`, {
                method: 'POST',
                headers: b,
                body: JSON.stringify({ requestId: randomUUID() }),
            })
            expect(deniedRetry.status).toBe(404)
            const forged = await fetch(`${baseUrl}/api/knowledge/documents/${id}`, {
                headers: { ...b, 'x-harness-user-id': randomUUID(), 'x-harness-workspace-id': 'personal' },
            })
            expect(forged.status).toBe(404)
            const list = await fetch(`${baseUrl}/api/knowledge/documents`, { headers: b })
            expect(await list.json()).toMatchObject({ total: 0, documents: [] })
            const original = await fetch(`${baseUrl}/api/knowledge/documents/${id}/file`, { headers: a })
            expect(original.status).toBe(200)
            expect(original.headers.get('content-disposition')).toContain('attachment; filename="document.md"; filename*=UTF-8\'\'')
            expect(original.headers.get('content-disposition')).toContain(encodeURIComponent('来源😀.md'))
            expect(original.headers.get('x-content-type-options')).toBe('nosniff')
            expect(original.headers.get('cache-control')).toContain('no-store')
            expect(original.headers.get('content-type')).toBe('application/octet-stream')
            expect(Buffer.from(await original.arrayBuffer())).toEqual(Buffer.from(text))
            const sourceKey = [...context.sources.keys()][0]!
            const correct = context.sources.get(sourceKey)!
            context.sources.set(sourceKey, new TextEncoder().encode('corrupt'))
            const corrupt = await fetch(`${baseUrl}/api/knowledge/documents/${id}/file`, { headers: a })
            expect(corrupt.status).toBe(503)
            expect(await corrupt.text()).not.toContain('checksum')
            context.sources.set(sourceKey, correct)
            const badId = randomUUID()
            const bad = await fetch(`${baseUrl}/api/knowledge/documents`, {
                method: 'POST',
                headers: uploadHeaders,
                body: multipart(badId, 'not a PDF', 'broken.pdf'),
            })
            expect(bad.status).toBe(201)
            expect(await status(baseUrl, badId, a, 'failed')).toMatchObject({ chunkCount: 0, attempt: 1 })
            const failedOriginal = await fetch(`${baseUrl}/api/knowledge/documents/${badId}/file`, { headers: a })
            expect(failedOriginal.status).toBe(200)
            expect(await failedOriginal.text()).toBe('not a PDF')
            const retryId = randomUUID()
            const retried = await fetch(`${baseUrl}/api/knowledge/documents/${badId}/retry`, {
                method: 'POST',
                headers: a,
                body: JSON.stringify({ requestId: retryId }),
            })
            expect(retried.status).toBe(201)
            await status(baseUrl, badId, a, 'failed')
            const sameRetry = await fetch(`${baseUrl}/api/knowledge/documents/${badId}/retry`, {
                method: 'POST',
                headers: a,
                body: JSON.stringify({ requestId: retryId }),
            })
            expect(await sameRetry.json()).toMatchObject({ status: 'failed', attempt: 2 })
            expect(context.writes()).toBe(2)
            context.unavailable(true)
            expect((await fetch(`${baseUrl}/api/knowledge/documents/${id}/file`, { headers: a })).status).toBe(503)
            const failedUploadId = randomUUID()
            const failedUpload = await fetch(`${baseUrl}/api/knowledge/documents`, {
                method: 'POST',
                headers: uploadHeaders,
                body: multipart(failedUploadId, 'A new source'),
            })
            expect(failedUpload.status).toBe(503)
            expect((await fetch(`${baseUrl}/api/knowledge/documents/${failedUploadId}`, { headers: a })).status).toBe(404)
            context.unavailable(false)
            expect((await fetch(`${baseUrl}/api/knowledge/documents/${id}/file`, { headers: a })).status).toBe(200)
        })
    })

    it('releases an interrupted processing job and resumes the same original after reconstructing the application', async () => {
        await isolated(async context => {
            let entered = false
            const first = await context.boot(async (_input, signal) => {
                entered = true
                return new Promise((_resolve, reject) =>
                    signal?.addEventListener('abort', () => reject(new Error('Test-owned process shutdown.')), { once: true })
                )
            })
            const release = vi.spyOn(first.store.knowledge!, 'release')
            const config = readTestApiConfig({ HARNESS_API_TOKEN: token })
            const headers = await sessionHeaders(first.store, config, randomUUID())
            const uploadHeaders = { authorization: headers.authorization!, 'x-harness-session': headers['x-harness-session']! }
            const id = randomUUID()
            const text = '应用重建后仍保留的正文😀\n'.repeat(70)
            const response = await fetch(`${first.baseUrl}/api/knowledge/documents`, {
                method: 'POST',
                headers: uploadHeaders,
                body: multipart(id, text),
            })
            expect(response.status).toBe(201)
            await status(first.baseUrl, id, headers, 'processing')
            for (let attempt = 0; !entered && attempt < 100; attempt++) await delay(10)
            expect(entered).toBe(true)
            await first.app.close()
            expect(release).toHaveBeenCalledOnce()
            await expect(release.mock.results[0]!.value).resolves.toBe(true)
            const second = await context.boot()
            const ready = await status(second.baseUrl, id, headers, 'ready')
            expect(ready.id).toBe(id)
            expect(ready.attempt).toBe(2)
            expect(context.writes()).toBe(1)
            const original = await fetch(`${second.baseUrl}/api/knowledge/documents/${id}/file`, { headers })
            expect(await original.text()).toBe(text)
        })
    })
})
