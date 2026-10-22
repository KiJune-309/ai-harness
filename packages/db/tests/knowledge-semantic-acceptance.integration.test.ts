import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { KnowledgeChunk } from '@ai-harness/contracts'
import { createChatStore, type ChatScope, type KnowledgeStore, type StoredKnowledgeDocument } from '../src/index.js'

interface Context {
    knowledge: KnowledgeStore
    admin: pg.Pool
    schema: string
    scope: ChatScope
}
const originalText = '甲😀乙丙'.repeat(105)

/**
 * Runs independent persistence assertions in a disposable real PostgreSQL schema without changing existing sources or vectors.
 * @param scenario - Assertions against the application-owned public storage API.
 * @returns After closing the pool and removing only the test-owned schema.
 * @throws Error when PostgreSQL or an assertion fails.
 */
async function isolated(scenario: (context: Context) => Promise<void>): Promise<void> {
    const schema = `sf009_acceptance_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    let store: Awaited<ReturnType<typeof createChatStore>> | undefined
    let created = false
    try {
        await admin.query(`CREATE SCHEMA ${schema}`)
        created = true
        store = await createChatStore({ databaseUrl: url.toString() })
        await scenario({ knowledge: store.knowledge!, admin, schema, scope: { userId: randomUUID(), workspaceId: schema } })
    } finally {
        await store?.close()
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Creates a queued immutable source fixture whose object persistence is explicitly injected only for this storage test.
 * @param knowledge - Actual PostgreSQL source store.
 * @param scope - Trusted fixture ownership.
 * @returns The newly persisted source record with a hard maximum and an overlap budget.
 */
async function source(knowledge: KnowledgeStore, scope: ChatScope): Promise<StoredKnowledgeDocument> {
    const id = randomUUID()
    const now = new Date().toISOString()
    const record: StoredKnowledgeDocument = {
        document: {
            id,
            fileName: '段落存储独立验收😀.txt',
            format: 'txt',
            size: Buffer.byteLength(originalText),
            status: 'queued',
            chunkSize: 200,
            overlap: 80,
            characterCount: 0,
            chunkCount: 0,
            attempt: 0,
            createdAt: now,
            updatedAt: now,
        },
        objectKey: `explicit-source-write-fixture/${id}`,
        sha256: createHash('sha256').update(originalText).digest('hex'),
        fingerprint: createHash('sha256').update(id).digest('hex'),
    }
    await knowledge.create(scope, record, async () => undefined)
    return record
}

/**
 * Constructs independent exact source intervals rather than reusing the production splitter under test.
 * @param record - Immutable document identity and source settings.
 * @param ranges - Explicit independently chosen Unicode intervals.
 * @returns A complete identified candidate batch.
 */
function batch(
    record: StoredKnowledgeDocument,
    ranges = [
        [0, 150],
        [90, 270],
        [270, 420],
    ]
) {
    const points = Array.from(originalText)
    const chunks: KnowledgeChunk[] = ranges.map(([start, end], index) => ({
        id: randomUUID(),
        documentId: record.document.id,
        index: index + 1,
        content: points.slice(start, end).join(''),
        characterCount: end! - start!,
        charStart: start!,
        charEnd: end!,
    }))
    return { characterCount: points.length, chunks }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent real PostgreSQL variable-chunk acceptance', () => {
    it('persists complete short chunks with variable sixty/zero overlap while preserving original metadata and ownership', async () => {
        await isolated(async ({ knowledge, scope }) => {
            const record = await source(knowledge, scope)
            const job = (await knowledge.claim(120_000))!
            const expected = batch(record)
            expect(await knowledge.complete(job, expected)).toBe(true)
            const saved = await knowledge.chunks(scope, record.document.id, 1, 20)
            expect(saved?.chunks).toEqual(expected.chunks)
            expect(saved?.chunks.map(chunk => chunk.characterCount)).toEqual([150, 180, 150])
            expect(saved!.chunks[0]!.charEnd - saved!.chunks[1]!.charStart).toBe(60)
            expect(saved!.chunks[1]!.charEnd - saved!.chunks[2]!.charStart).toBe(0)
            expect(await knowledge.get(scope, record.document.id)).toMatchObject({
                objectKey: record.objectKey,
                sha256: record.sha256,
                document: { status: 'ready', characterCount: 420, chunkCount: 3, chunkSize: 200, overlap: 80 },
            })
            const restored = saved!.chunks
                .map((chunk, index) =>
                    Array.from(chunk.content)
                        .slice(index ? saved!.chunks[index - 1]!.charEnd - chunk.charStart : 0)
                        .join('')
                )
                .join('')
            expect(restored).toBe(originalText)
            for (const foreign of [
                { ...scope, userId: randomUUID() },
                { ...scope, workspaceId: randomUUID() },
            ]) {
                expect(await knowledge.chunks(foreign, record.document.id, 1, 20)).toBeUndefined()
                expect(await knowledge.get(foreign, record.document.id)).toBeUndefined()
            }
        })
    })

    it('rejects gaps, repeated coverage, over-budget intersections, changed overlap text, and incomplete sources without publishing any partial batch', async () => {
        await isolated(async ({ knowledge, scope, admin, schema }) => {
            const record = await source(knowledge, scope)
            const job = (await knowledge.claim(120_000))!
            const candidates = [
                batch(record, [
                    [1, 150],
                    [90, 270],
                    [270, 420],
                ]),
                batch(record, [
                    [0, 150],
                    [151, 300],
                    [300, 420],
                ]),
                batch(record, [
                    [0, 150],
                    [0, 180],
                    [180, 380],
                    [380, 420],
                ]),
                batch(record, [
                    [0, 150],
                    [90, 140],
                    [140, 340],
                    [340, 420],
                ]),
                batch(record, [
                    [0, 150],
                    [69, 249],
                    [249, 420],
                ]),
                batch(record, [
                    [0, 150],
                    [90, 270],
                    [270, 419],
                ]),
                batch(record, [
                    [0, 201],
                    [121, 300],
                    [300, 420],
                ]),
            ]
            const changedIntersection = batch(record)
            changedIntersection.chunks[1]!.content = '坏' + Array.from(changedIntersection.chunks[1]!.content).slice(1).join('')
            candidates.push(changedIntersection)
            const mismatchedLength = batch(record)
            mismatchedLength.chunks[1]!.characterCount -= 1
            candidates.push(mismatchedLength)
            const repeatedOrdinal = batch(record)
            repeatedOrdinal.chunks[1]!.index = 1
            candidates.push(repeatedOrdinal)
            for (const candidate of candidates) {
                await expect(knowledge.complete(job, candidate)).rejects.toBeInstanceOf(Error)
                expect((await knowledge.get(scope, record.document.id))?.document).toMatchObject({
                    status: 'processing',
                    characterCount: 0,
                    chunkCount: 0,
                })
                expect((await admin.query(`SELECT count(*)::int AS count FROM ${schema}.harness_knowledge_chunks`)).rows[0]?.count).toBe(0)
                expect((await knowledge.chunks(scope, record.document.id, 1, 20))?.chunks).toEqual([])
            }
            await expect(knowledge.complete(job, { characterCount: 420, chunks: [] })).rejects.toBeInstanceOf(Error)
            expect(await knowledge.complete(job, batch(record))).toBe(true)
        })
    })

    it('rolls a middle-insert database failure back and later commits the same complete variable batch', async () => {
        await isolated(async ({ knowledge, scope, admin, schema }) => {
            const record = await source(knowledge, scope)
            const job = (await knowledge.claim(120_000))!
            const expected = batch(record)
            await admin.query(
                `CREATE FUNCTION ${schema}.reject_semantic_middle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.chunk_index=2 THEN RAISE EXCEPTION 'Independent variable-chunk checkpoint failure'; END IF; RETURN NEW; END $$`
            )
            await admin.query(
                `CREATE TRIGGER reject_semantic_middle BEFORE INSERT ON ${schema}.harness_knowledge_chunks FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_semantic_middle()`
            )
            await expect(knowledge.complete(job, expected)).rejects.toThrow('Independent variable-chunk checkpoint failure')
            expect((await knowledge.get(scope, record.document.id))?.document).toMatchObject({
                status: 'processing',
                characterCount: 0,
                chunkCount: 0,
            })
            expect((await admin.query(`SELECT count(*)::int AS count FROM ${schema}.harness_knowledge_chunks`)).rows[0]?.count).toBe(0)
            await admin.query(`DROP TRIGGER reject_semantic_middle ON ${schema}.harness_knowledge_chunks`)
            expect(await knowledge.complete(job, expected)).toBe(true)
            expect((await knowledge.chunks(scope, record.document.id, 1, 20))?.chunks).toEqual(expected.chunks)
        })
    })

    it('retains lease fencing and accepts historical fixed windows as a safe special case', async () => {
        await isolated(async ({ knowledge, scope, admin, schema }) => {
            const record = await source(knowledge, scope)
            const old = (await knowledge.claim(120_000))!
            await admin.query(`UPDATE ${schema}.harness_knowledge_documents SET lease_until=clock_timestamp()-interval '1 second'`)
            const current = (await knowledge.claim(120_000))!
            expect(current.generation).toBe(old.generation + 1)
            expect(await knowledge.complete(old, batch(record))).toBe(false)
            expect(await knowledge.fail(old, 'Stale workers must not fail a recovered parse.')).toBe(false)
            expect(await knowledge.release(old)).toBe(false)
            expect(await knowledge.heartbeat(old, 120_000)).toBe(false)
            expect(await knowledge.complete(current, batch(record))).toBe(true)
            const historical = await source(knowledge, scope)
            const legacyLease = (await knowledge.claim(120_000))!
            const fixed = batch(historical, [
                [0, 200],
                [120, 320],
                [240, 420],
            ])
            expect(await knowledge.complete(legacyLease, fixed)).toBe(true)
            expect((await knowledge.chunks(scope, historical.document.id, 1, 20))?.chunks).toEqual(fixed.chunks)
        })
    })
})
