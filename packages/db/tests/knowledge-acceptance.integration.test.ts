import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { KnowledgeChunk } from '@ai-harness/contracts'
import { createChatStore, KnowledgeConflictError, type ChatScope, type KnowledgeStore, type StoredKnowledgeDocument } from '../src/index.js'

interface Context {
    knowledge: KnowledgeStore
    admin: pg.Pool
    schema: string
    scope: ChatScope
}

/**
 * Runs an acceptance scenario in a unique schema on a real PostgreSQL instance.
 * @param scenario - Independent storage assertions using the public shared-store API.
 * @returns After the scenario and its test-owned schema have been cleaned up.
 * @throws Error when PostgreSQL or any scenario assertion fails.
 */
async function isolated(scenario: (context: Context) => Promise<void>): Promise<void> {
    const schema = `sf007_acceptance_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    let store: Awaited<ReturnType<typeof createChatStore>> | undefined
    let created = false
    try {
        await admin.query(`CREATE SCHEMA ${schema}`)
        created = true
        store = await createChatStore({ databaseUrl: url.toString() })
        expect(store.knowledge).toBeDefined()
        await scenario({ knowledge: store.knowledge!, admin, schema, scope: { userId: randomUUID(), workspaceId: schema } })
    } finally {
        await store?.close()
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Builds a queued record containing only public fixture metadata and deterministic private source references.
 * @returns A valid new record for an independent upload action.
 */
function original(): StoredKnowledgeDocument {
    const id = randomUUID()
    const now = new Date().toISOString()
    return {
        document: {
            id,
            fileName: '真实资料_100%_😀.md',
            format: 'md',
            size: 32,
            status: 'queued',
            chunkSize: 200,
            overlap: 100,
            characterCount: 0,
            chunkCount: 0,
            attempt: 0,
            createdAt: now,
            updatedAt: now,
        },
        objectKey: `private-fixture/${id}`,
        sha256: createHash('sha256').update('original source fixture').digest('hex'),
        fingerprint: createHash('sha256').update(`upload:${id}`).digest('hex'),
    }
}

/**
 * Creates a Unicode-aware complete chunk batch independently from the production parser.
 * @param record - Original immutable chunk settings and document identity.
 * @param text - Canonical source text to divide into fixed windows.
 * @returns Identified chunks and the canonical source character count.
 */
function completeBatch(record: StoredKnowledgeDocument, text = '甲😀乙\n'.repeat(135)) {
    const points = Array.from(text)
    const chunks: KnowledgeChunk[] = []
    const { chunkSize, overlap, id } = record.document
    for (let start = 0; start < points.length; start += chunkSize - overlap) {
        const end = Math.min(start + chunkSize, points.length)
        chunks.push({
            id: randomUUID(),
            documentId: id,
            index: chunks.length + 1,
            content: points.slice(start, end).join(''),
            characterCount: end - start,
            charStart: start,
            charEnd: end,
        })
        if (end === points.length) break
    }
    return { characterCount: points.length, chunks }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent durable knowledge acceptance', () => {
    it('serializes identical upload actions, scopes literal searches, and retries a source-write failure without a ghost record', async () => {
        await isolated(async ({ knowledge, scope }) => {
            const record = original()
            let sourceWrites = 0
            const results = await Promise.all(
                Array.from({ length: 8 }, () =>
                    knowledge.create(scope, record, async () => {
                        sourceWrites += 1
                    })
                )
            )
            expect(sourceWrites).toBe(1)
            expect(results.every(result => result.document.id === record.document.id)).toBe(true)
            expect((await knowledge.list(scope, { page: 1, pageSize: 10, query: '%' })).total).toBe(1)
            expect((await knowledge.list(scope, { page: 1, pageSize: 10, query: 'nonexistent' })).total).toBe(0)
            await expect(
                knowledge.create(scope, { ...record, fingerprint: 'f'.repeat(64) }, async () => {
                    sourceWrites += 1
                })
            ).rejects.toBeInstanceOf(KnowledgeConflictError)
            expect(sourceWrites).toBe(1)
            for (const other of [
                { ...scope, userId: randomUUID() },
                { ...scope, workspaceId: 'different-workspace' },
            ]) {
                expect(await knowledge.get(other, record.document.id)).toBeUndefined()
                expect(await knowledge.chunks(other, record.document.id, 1, 20)).toBeUndefined()
                expect(await knowledge.retry(other, record.document.id, randomUUID())).toBeUndefined()
                expect((await knowledge.list(other, { page: 1, pageSize: 20, query: '' })).documents).toEqual([])
            }
            const failed = original()
            await expect(
                knowledge.create(scope, failed, async () => {
                    throw new Error('Test-owned private object fixture unavailable.')
                })
            ).rejects.toThrow('fixture unavailable')
            expect(await knowledge.get(scope, failed.document.id)).toBeUndefined()
            expect((await knowledge.list(scope, { page: 1, pageSize: 20, query: '' })).total).toBe(1)
            await knowledge.create(scope, failed, async () => undefined)
            expect((await knowledge.get(scope, failed.document.id))?.document.status).toBe('queued')
        })
    })

    it('recovers an expired lease while refusing every late write from the previous worker', async () => {
        await isolated(async ({ knowledge, admin, schema, scope }) => {
            const record = original()
            await knowledge.create(scope, record, async () => undefined)
            const concurrent = await Promise.all([knowledge.claim(120_000), knowledge.claim(120_000)])
            expect(concurrent.filter(Boolean)).toHaveLength(1)
            const old = concurrent.find(Boolean)!
            expect(old.generation).toBe(1)
            expect(await knowledge.chunks(scope, record.document.id, 1, 20)).toMatchObject({ chunks: [], total: 0 })
            await admin.query(`UPDATE ${schema}.harness_knowledge_documents SET lease_until=clock_timestamp()-interval '1 second'`)
            expect(await knowledge.heartbeat(old, 120_000)).toBe(false)
            const current = await knowledge.claim(120_000)
            expect(current?.generation).toBe(2)
            expect(current?.leaseToken).not.toBe(old.leaseToken)
            expect(await knowledge.complete(old, completeBatch(record))).toBe(false)
            expect(await knowledge.fail(old, 'A stale worker cannot fail the recovered job.')).toBe(false)
            expect(await knowledge.release(old)).toBe(false)
            expect(await knowledge.heartbeat(old, 120_000)).toBe(false)
            expect((await knowledge.get(scope, record.document.id))?.document.status).toBe('processing')
            expect(await knowledge.complete(current!, completeBatch(record))).toBe(true)
            const page = await knowledge.chunks(scope, record.document.id, 1, 2)
            expect(page?.chunks).toHaveLength(2)
            const all: KnowledgeChunk[] = []
            for (let pageNumber = 1; pageNumber <= Math.ceil(page!.total / 2); pageNumber++) {
                const next = await knowledge.chunks(scope, record.document.id, pageNumber, 2)
                all.push(...next!.chunks)
            }
            expect(all).toHaveLength(page!.total)
            expect(all).toEqual(completeBatch(record).chunks.map((chunk, index) => ({ ...chunk, id: all[index]!.id })))
            expect((await knowledge.get(scope, record.document.id))?.document).toMatchObject({
                status: 'ready',
                attempt: 2,
                characterCount: 540,
                chunkCount: all.length,
            })
        })
    })

    it('rolls ready metadata back when chunk persistence fails, then commits a complete readable batch', async () => {
        await isolated(async ({ knowledge, admin, schema, scope }) => {
            const record = original()
            await knowledge.create(scope, record, async () => undefined)
            const job = (await knowledge.claim(120_000))!
            const batch = completeBatch(record)
            await admin.query(
                `CREATE FUNCTION ${schema}.reject_acceptance_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test-owned chunk failure'; END $$`
            )
            await admin.query(
                `CREATE TRIGGER reject_acceptance_chunk BEFORE INSERT ON ${schema}.harness_knowledge_chunks FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_acceptance_chunk()`
            )
            await expect(knowledge.complete(job, batch)).rejects.toThrow('Test-owned chunk failure')
            expect((await knowledge.get(scope, record.document.id))?.document).toMatchObject({
                status: 'processing',
                characterCount: 0,
                chunkCount: 0,
            })
            expect(await knowledge.chunks(scope, record.document.id, 1, 20)).toMatchObject({ chunks: [], total: 0 })
            expect((await admin.query(`SELECT count(*)::integer AS count FROM ${schema}.harness_knowledge_chunks`)).rows[0]?.count).toBe(0)
            await admin.query(`DROP TRIGGER reject_acceptance_chunk ON ${schema}.harness_knowledge_chunks`)
            expect(await knowledge.complete(job, batch)).toBe(true)
            expect((await knowledge.chunks(scope, record.document.id, 1, 20))?.chunks).toEqual(batch.chunks)
        })
    })

    it('persists retry identities so replay cannot start another processing generation', async () => {
        await isolated(async ({ knowledge, scope }) => {
            const record = original()
            await knowledge.create(scope, record, async () => undefined)
            const failedJob = (await knowledge.claim(120_000))!
            expect(await knowledge.fail(failedJob, 'A controlled parse failure.')).toBe(true)
            const action = randomUUID()
            const repeated = await Promise.all(Array.from({ length: 8 }, () => knowledge.retry(scope, record.document.id, action)))
            expect(repeated.every(item => item?.status === 'queued')).toBe(true)
            const retriedJob = (await knowledge.claim(120_000))!
            expect(retriedJob.generation).toBe(2)
            expect(await knowledge.retry(scope, record.document.id, action)).toMatchObject({ status: 'processing', attempt: 2 })
            await expect(knowledge.retry(scope, record.document.id, randomUUID())).rejects.toBeInstanceOf(KnowledgeConflictError)
            expect(await knowledge.fail(retriedJob, 'Second controlled parse failure.')).toBe(true)
            expect(await knowledge.retry(scope, record.document.id, action)).toMatchObject({ status: 'failed', attempt: 2 })
            expect(await knowledge.claim(120_000)).toBeUndefined()
            const second = original()
            await knowledge.create(scope, second, async () => undefined)
            const secondJob = (await knowledge.claim(120_000))!
            await knowledge.fail(secondJob, 'Second document failure.')
            await expect(knowledge.retry(scope, second.document.id, action)).rejects.toBeInstanceOf(KnowledgeConflictError)
            expect(await knowledge.retry(scope, record.document.id, randomUUID())).toMatchObject({ status: 'queued', attempt: 2 })
            expect((await knowledge.claim(120_000))?.generation).toBe(3)
        })
    })
})
