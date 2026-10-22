import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { EmbeddingModel, KnowledgeChunk, KnowledgeIndexAction } from '@ai-harness/contracts'
import {
    createChatStore,
    initializeEmbeddingTables,
    embeddingSpace,
    EmbeddingConflictError,
    EmbeddingNotFoundError,
    type ChatScope,
    type EmbeddingStore,
    type KnowledgeStore,
    type StoredEmbeddingModel,
} from '../src/index.js'

interface Context {
    embeddings: EmbeddingStore
    knowledge: KnowledgeStore
    admin: pg.Pool
    schema: string
    scope: ChatScope
}

/**
 * Runs independent vector assertions on real PostgreSQL using an owned disposable schema and the existing public extension.
 * @param scenario - Assertions made through the application's public shared-store API.
 * @returns After closing the test pool and dropping only its isolated schema.
 * @throws Error when persistence or an acceptance assertion fails.
 */
async function isolated(scenario: (context: Context) => Promise<void>): Promise<void> {
    const schema = `sf008_acceptance_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    let store: Awaited<ReturnType<typeof createChatStore>> | undefined
    let created = false
    try {
        await admin.query(`CREATE SCHEMA ${schema}`)
        created = true
        store = await createChatStore({ databaseUrl: url.toString() })
        expect(store.embeddings?.vectorAvailable).toBe(true)
        expect((await admin.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows).toHaveLength(1)
        await scenario({
            embeddings: store.embeddings!,
            knowledge: store.knowledge!,
            admin,
            schema,
            scope: { userId: randomUUID(), workspaceId: schema },
        })
    } finally {
        await store?.close()
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Builds an explicitly controlled model record without using a real cloud credential or claiming provider verification.
 * @param id - Optional stable creation action and model UUID.
 * @returns Initial unverified public metadata and opaque test ciphertext.
 */
function modelRecord(id: string = randomUUID()): StoredEmbeddingModel {
    const now = new Date().toISOString()
    return {
        model: {
            id,
            name: 'Independent fixture connection',
            baseUrl: 'https://controlled-fixture.invalid/v1',
            model: 'fixture-requested-model',
            hasApiKey: true,
            isDefault: false,
            revision: 1,
            createdAt: now,
            updatedAt: now,
        },
        encryptedApiKey: 'opaque-purpose-separated-fixture-ciphertext',
    }
}

/**
 * Creates one controlled verified identity for testing persistent vectors independently of any external provider.
 * @param embeddings - Real scoped PostgreSQL embedding store.
 * @param scope - Trusted fixture ownership.
 * @param dimensions - Controlled vector dimension count.
 * @param id - Optional model UUID to test identical identifiers across owners.
 * @returns Verified fixture metadata.
 */
async function verified(embeddings: EmbeddingStore, scope: ChatScope, dimensions = 2, id?: string): Promise<EmbeddingModel> {
    const record = modelRecord(id)
    await embeddings.createModel(scope, record, createHash('sha256').update(record.model.id).digest('hex'))
    return embeddings.verifyModel(scope, record.model.id, 1, dimensions, 'controlled-provider-snapshot-v1')
}

/**
 * Persists ready immutable source chunks using a deliberately injected object-write fixture, without invoking parsing or cloud services.
 * @param knowledge - Real source metadata and chunk store.
 * @param scope - Trusted fixture ownership.
 * @param count - Number of complete Unicode-aware source chunks.
 * @returns The ready document UUID.
 */
async function readySource(knowledge: KnowledgeStore, scope: ChatScope, count: number): Promise<string> {
    const id = randomUUID()
    const now = new Date().toISOString()
    const chunks: KnowledgeChunk[] = Array.from({ length: count }, (_, index) => {
        const prefix = `资料😀${index + 1}:`
        const content = prefix + '文'.repeat(200 - Array.from(prefix).length)
        return {
            id: randomUUID(),
            documentId: id,
            index: index + 1,
            content,
            characterCount: 200,
            charStart: index * 200,
            charEnd: (index + 1) * 200,
        }
    })
    await knowledge.create(
        scope,
        {
            document: {
                id,
                fileName: '独立向量验收😀.md',
                format: 'md',
                size: Buffer.byteLength(chunks.map(chunk => chunk.content).join('')),
                status: 'queued',
                chunkSize: 200,
                overlap: 0,
                characterCount: 0,
                chunkCount: 0,
                attempt: 0,
                createdAt: now,
                updatedAt: now,
            },
            objectKey: `independent-explicit-source-fixture/${id}`,
            sha256: createHash('sha256')
                .update(chunks.map(chunk => chunk.content).join(''))
                .digest('hex'),
            fingerprint: createHash('sha256').update(id).digest('hex'),
        },
        async () => undefined
    )
    const job = await knowledge.claim(120_000)
    expect(job?.record.document.id).toBe(id)
    expect(await knowledge.complete(job!, { characterCount: count * 200, chunks })).toBe(true)
    return id
}

/**
 * Creates an explicit index action containing the user-confirmed immutable default model revision.
 * @param model - Confirmed default model.
 * @returns A fresh action identity and its frozen model confirmation.
 */
function action(model: EmbeddingModel): KnowledgeIndexAction {
    return { requestId: randomUUID(), modelId: model.id, revision: model.revision }
}

/**
 * Builds a complete small fixture generation through real lease and checkpoint operations.
 * @param context - Owned database test resources.
 * @param scope - Source ownership.
 * @param model - Current verified default model.
 * @param vectors - Independently specified expected vectors.
 * @returns Indexed source UUID.
 */
async function indexed(context: Context, scope: ChatScope, model: EmbeddingModel, vectors: number[][]): Promise<string> {
    const id = await readySource(context.knowledge, scope, vectors.length)
    await context.embeddings.startIndex(scope, id, action(model))
    const job = (await context.embeddings.claim(120_000))!
    expect(job.index.documentId).toBe(id)
    const chunks = await context.embeddings.pendingChunks(job)
    expect(chunks).toHaveLength(vectors.length)
    expect(await context.embeddings.saveBatch(job, chunks, vectors)).toMatchObject({ status: 'ready', completedChunks: vectors.length })
    return id
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent real pgvector acceptance', () => {
    it('serializes creation/defaults, protects probe revisions, and retains deleted creation tombstones', async () => {
        await isolated(async ({ embeddings, scope }) => {
            const record = modelRecord()
            const fingerprint = createHash('sha256').update('same-create-action').digest('hex')
            const created = await Promise.all(Array.from({ length: 8 }, () => embeddings.createModel(scope, record, fingerprint)))
            expect(created.every(model => model.id === record.model.id && model.isDefault)).toBe(true)
            expect(await embeddings.listModels(scope)).toHaveLength(1)
            const tested = await embeddings.verifyModel(scope, record.model.id, 1, 2, 'provider-v1')
            const renamed = await embeddings.updateModel(scope, record.model.id, 1, {
                ...record,
                model: { ...tested, name: 'Renamed only' },
            })
            expect(renamed).toMatchObject({ revision: 1, dimensions: 2, providerModel: 'provider-v1', name: 'Renamed only' })
            const drift = await embeddings.verifyModel(scope, record.model.id, 1, 3, 'provider-v2')
            expect(drift).toMatchObject({ revision: 2, dimensions: 3, providerModel: 'provider-v2' })
            await expect(embeddings.verifyModel(scope, record.model.id, 1, 2, 'provider-v1')).rejects.toBeInstanceOf(EmbeddingConflictError)
            await expect(embeddings.updateModel(scope, record.model.id, 1, record)).rejects.toBeInstanceOf(EmbeddingConflictError)
            const edited = await embeddings.updateModel(scope, record.model.id, 2, {
                model: drift,
                encryptedApiKey: 'changed-independent-fixture-ciphertext',
            })
            expect(edited.revision).toBe(3)
            expect(edited.dimensions).toBeUndefined()
            expect(edited.providerModel).toBeUndefined()
            expect(edited.verifiedAt).toBeUndefined()
            await expect(embeddings.verifyModel(scope, record.model.id, 2, 3, 'provider-v2')).rejects.toBeInstanceOf(EmbeddingConflictError)
            const other = await verified(embeddings, scope)
            await Promise.all([embeddings.setDefaultModel(scope, other.id), embeddings.setDefaultModel(scope, record.model.id)])
            expect((await embeddings.listModels(scope)).filter(item => item.model.isDefault)).toHaveLength(1)
            expect(await embeddings.getModel({ ...scope, userId: randomUUID() }, record.model.id)).toBeUndefined()
            expect(await embeddings.getModel({ ...scope, workspaceId: randomUUID() }, record.model.id)).toBeUndefined()
            expect(await embeddings.deleteModel(scope, record.model.id)).toBe(true)
            await expect(embeddings.createModel(scope, record, fingerprint)).rejects.toBeInstanceOf(EmbeddingConflictError)
            expect(await embeddings.getModel(scope, record.model.id)).toBeUndefined()
        })
    })

    it('computes actual cosine ordering while materializing ownership and dimensional space before distance', async () => {
        await isolated(async context => {
            const { embeddings, scope } = context
            const first = await verified(embeddings, scope)
            const firstId = await indexed(context, scope, first, [
                [1, 0],
                [0, 1],
                [-1, 0],
            ])
            const three = await verified(embeddings, scope, 3)
            await embeddings.setDefaultModel(scope, three.id)
            const threeId = await indexed(context, scope, three, [[1, 0, 0]])
            const foreign = { ...scope, userId: randomUUID() }
            const foreignModel = await verified(embeddings, foreign, 2, first.id)
            const foreignId = await indexed(context, foreign, foreignModel, [[1, 0]])
            await embeddings.setDefaultModel(scope, first.id)
            const space = embeddingSpace(first)!
            const hits = await embeddings.search(scope, space, [1, 0], 20)
            expect(hits.map(hit => hit.chunk.index)).toEqual([1, 2, 3])
            expect(hits.map(hit => hit.distance)).toEqual([0, 1, 2])
            expect(hits.map(hit => hit.score)).toEqual([1, 0, -1])
            expect(hits.every(hit => hit.documentId === firstId && hit.chunk.documentId === firstId)).toBe(true)
            expect((await embeddings.search(scope, space, [-1, 0], 1)).map(hit => hit.chunk.index)).toEqual([3])
            expect(await embeddings.searchable(scope, space, firstId)).toBe(true)
            expect(await embeddings.searchable(scope, space, threeId)).toBe(false)
            expect(await embeddings.search(scope, space, [1, 0], 20, threeId)).toEqual([])
            await expect(embeddings.searchable(scope, space, foreignId)).rejects.toBeInstanceOf(EmbeddingNotFoundError)
            await expect(embeddings.search(scope, space, [1, 0], 5, foreignId)).rejects.toBeInstanceOf(EmbeddingNotFoundError)
            await expect(embeddings.getIndex(foreign, firstId)).rejects.toBeInstanceOf(EmbeddingNotFoundError)
            expect((await embeddings.getIndex(scope, threeId)).status).toBe('stale')
        })
    })

    it('recovers checkpoints in the same generation and rejects every late write from an expired worker', async () => {
        await isolated(async ({ embeddings, knowledge, scope, admin, schema }) => {
            const model = await verified(embeddings, scope)
            const id = await readySource(knowledge, scope, 18)
            const original = action(model)
            const repeats = await Promise.all(Array.from({ length: 8 }, () => embeddings.startIndex(scope, id, original)))
            expect(repeats.every(index => index.generation === 1 && index.status === 'queued')).toBe(true)
            const claims = await Promise.all([embeddings.claim(120_000), embeddings.claim(120_000)])
            expect(claims.filter(Boolean)).toHaveLength(1)
            const old = claims.find(Boolean)!
            const first = await embeddings.pendingChunks(old)
            expect(first).toHaveLength(16)
            expect(
                await embeddings.saveBatch(
                    old,
                    first,
                    first.map(() => [1, 0])
                )
            ).toMatchObject({
                status: 'indexing',
                generation: 1,
                attempt: 1,
                completedChunks: 16,
                totalChunks: 18,
            })
            expect(await embeddings.searchable(scope, embeddingSpace(model)!)).toBe(false)
            await admin.query(`UPDATE ${schema}.harness_vector_jobs SET lease_until=clock_timestamp()-interval '1 second'`)
            const current = (await embeddings.claim(120_000))!
            expect(current.index).toMatchObject({ generation: 1, attempt: 2, completedChunks: 16 })
            expect(current.leaseToken).not.toBe(old.leaseToken)
            const remaining = await embeddings.pendingChunks(current)
            expect(remaining.map(chunk => chunk.index)).toEqual([17, 18])
            expect(
                await embeddings.saveBatch(old, remaining, [
                    [1, 0],
                    [1, 0],
                ])
            ).toBeUndefined()
            expect(await embeddings.fail(old, 'A stale worker must not alter the current attempt.')).toBe(false)
            expect(await embeddings.release(old)).toBe(false)
            expect(await embeddings.heartbeat(old, 120_000)).toBe(false)
            expect(
                await embeddings.saveBatch(current, remaining, [
                    [0, 1],
                    [-1, 0],
                ])
            ).toMatchObject({
                status: 'ready',
                generation: 1,
                attempt: 2,
                completedChunks: 18,
            })
            expect(await embeddings.search(scope, embeddingSpace(model)!, [1, 0], 20)).toHaveLength(18)
            const rebuild = await embeddings.startIndex(scope, id, action(model))
            expect(rebuild).toMatchObject({ generation: 2, completedChunks: 0, status: 'queued' })
            expect(await embeddings.searchable(scope, embeddingSpace(model)!)).toBe(false)
            expect((await embeddings.startIndex(scope, id, original)).generation).toBe(2)
            expect((await admin.query(`SELECT count(*)::int AS count FROM ${schema}.harness_knowledge_vectors`)).rows[0]?.count).toBe(0)
            expect((await knowledge.chunks(scope, id, 1, 20))?.total).toBe(18)
        })
    })

    it('rolls checkpoint SQL failures back and rejects invalid float32 vectors without partial publication', async () => {
        await isolated(async ({ embeddings, knowledge, scope, admin, schema }) => {
            const model = await verified(embeddings, scope)
            const id = await readySource(knowledge, scope, 3)
            await embeddings.startIndex(scope, id, action(model))
            const job = (await embeddings.claim(120_000))!
            const chunks = await embeddings.pendingChunks(job)
            for (const invalid of [
                [0, 0],
                [1e100, 0],
                [1e-100, 0],
                [NaN, 0],
                [Infinity, 0],
                [1, 0, 0],
            ]) {
                await expect(embeddings.saveBatch(job, chunks, [[1, 0], invalid, [0, 1]])).rejects.toBeInstanceOf(Error)
            }
            await admin.query(
                `CREATE FUNCTION ${schema}.reject_vector_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.chunk_index=2 THEN RAISE EXCEPTION 'Controlled independent checkpoint failure'; END IF; RETURN NEW; END $$`
            )
            await admin.query(
                `CREATE TRIGGER reject_vector_checkpoint BEFORE INSERT ON ${schema}.harness_knowledge_vectors FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_vector_checkpoint()`
            )
            await expect(
                embeddings.saveBatch(job, chunks, [
                    [1, 0],
                    [0, 1],
                    [-1, 0],
                ])
            ).rejects.toThrow('Controlled independent checkpoint failure')
            expect((await admin.query(`SELECT count(*)::int AS count FROM ${schema}.harness_knowledge_vectors`)).rows[0]?.count).toBe(0)
            expect(await embeddings.getIndex(scope, id)).toMatchObject({ status: 'indexing', completedChunks: 0 })
            expect(await embeddings.searchable(scope, embeddingSpace(model)!)).toBe(false)
            await admin.query(`DROP TRIGGER reject_vector_checkpoint ON ${schema}.harness_knowledge_vectors`)
            expect(
                await embeddings.saveBatch(job, chunks, [
                    [1, 0],
                    [0, 1],
                    [-1, 0],
                ])
            ).toMatchObject({ status: 'ready', completedChunks: 3 })
        })
    })

    it('checks the user-confirmed default before indexing and refuses incompatible retries or late batch commits', async () => {
        await isolated(async ({ embeddings, knowledge, scope }) => {
            const first = await verified(embeddings, scope)
            const second = await verified(embeddings, scope, 3)
            const id = await readySource(knowledge, scope, 2)
            await embeddings.setDefaultModel(scope, second.id)
            await expect(embeddings.startIndex(scope, id, action(first))).rejects.toBeInstanceOf(EmbeddingConflictError)
            expect(await embeddings.getIndex(scope, id)).toMatchObject({ status: 'none', generation: 0 })
            await embeddings.setDefaultModel(scope, first.id)
            await embeddings.startIndex(scope, id, action(first))
            const old = (await embeddings.claim(120_000))!
            const chunks = await embeddings.pendingChunks(old)
            await embeddings.setDefaultModel(scope, second.id)
            await expect(
                embeddings.saveBatch(old, chunks, [
                    [1, 0],
                    [0, 1],
                ])
            ).rejects.toBeInstanceOf(EmbeddingConflictError)
            expect(await embeddings.fail(old, 'Default changed during a controlled fixture request.')).toBe(true)
            await expect(embeddings.startIndex(scope, id, action(second), true)).rejects.toBeInstanceOf(EmbeddingConflictError)
            const rebuilt = await embeddings.startIndex(scope, id, action(second))
            expect(rebuilt).toMatchObject({ generation: 2, completedChunks: 0, model: { id: second.id, dimensions: 3 } })
            const current = (await embeddings.claim(120_000))!
            const pending = await embeddings.pendingChunks(current)
            expect(
                await embeddings.saveBatch(current, pending, [
                    [1, 0, 0],
                    [0, 1, 0],
                ])
            ).toMatchObject({ status: 'ready', generation: 2 })
            await expect(embeddings.search(scope, embeddingSpace(first)!, [1, 0], 5)).rejects.toBeInstanceOf(EmbeddingConflictError)
            expect(await embeddings.search(scope, embeddingSpace(second)!, [1, 0, 0], 5)).toHaveLength(2)
        })
    })

    it('preserves cosine direction for nonzero representable float32 extremes without publishing NaN distances', async () => {
        await isolated(async context => {
            const { embeddings, scope } = context
            const model = await verified(embeddings, scope)
            const id = await indexed(context, scope, model, [
                [3e38, 0],
                [1e-40, 0],
                [-3e38, 0],
                [0, 1e-40],
            ])
            for (const query of [
                [3e38, 0],
                [1e-40, 0],
            ]) {
                const hits = await embeddings.search(scope, embeddingSpace(model)!, query, 5, id)
                expect(hits.map(hit => hit.chunk.index)).toEqual([1, 2, 4, 3])
                expect(hits.map(hit => hit.distance)).toEqual([0, 0, 1, 2])
                expect(hits.map(hit => hit.score)).toEqual([1, 1, 0, -1])
                expect(hits.every(hit => Number.isFinite(hit.distance) && Number.isFinite(hit.score))).toBe(true)
            }
            expect((await embeddings.search(scope, embeddingSpace(model)!, [-1e-40, 0], 1, id))[0]?.chunk.index).toBe(3)
        })
    })
})

describe('independent optional-vector initialization fault injection', () => {
    it('rolls only optional initialization back for controlled missing-extension and insufficient-privilege failures', async () => {
        for (const code of ['42501', '58P01']) {
            const statements: string[] = []
            const query = vi.fn(async (sql: string) => {
                statements.push(sql)
                if (sql.startsWith('CREATE EXTENSION')) throw Object.assign(new Error('Controlled optional capability failure.'), { code })
                return { rows: [] }
            })
            const available = await initializeEmbeddingTables({ query } as unknown as Pick<pg.Pool, 'query'>)
            expect(available).toBe(false)
            expect(statements.slice(-3)).toEqual([
                'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public',
                'ROLLBACK TO SAVEPOINT harness_optional_vector',
                'RELEASE SAVEPOINT harness_optional_vector',
            ])
            expect(statements.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS harness_knowledge_vectors'))).toBe(false)
            expect(statements.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS harness_embedding_models'))).toBe(true)
        }
    })

    it('propagates a controlled real database connection error instead of treating it as an optional capability or memory mode', async () => {
        const failure = Object.assign(new Error('Controlled persistent connection lost.'), { code: '08006' })
        const query = vi.fn(async (sql: string) => {
            if (sql.startsWith('CREATE EXTENSION')) throw failure
            return { rows: [] }
        })
        await expect(initializeEmbeddingTables({ query } as unknown as Pick<pg.Pool, 'query'>)).rejects.toBe(failure)
        expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK TO SAVEPOINT harness_optional_vector')).toBe(true)
    })
})
