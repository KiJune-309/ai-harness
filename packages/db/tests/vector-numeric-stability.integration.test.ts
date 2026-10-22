import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { createChatStore, embeddingSpace } from '../src/index.js'

/**
 * Persists extreme finite float32 directions through real scoped checkpoints and compares true SQL cosine distances.
 * @returns After the owned random schema is removed, without modifying shared extension or user records.
 */
async function verifyExtremeDirections(): Promise<void> {
    const schema = `sf008_numeric_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    let store: Awaited<ReturnType<typeof createChatStore>> | undefined
    let created = false
    try {
        await admin.query(`CREATE SCHEMA ${schema}`)
        created = true
        store = await createChatStore({ databaseUrl: url.toString() })
        const embeddings = store.embeddings!
        expect(embeddings.vectorAvailable).toBe(true)
        const scope = { userId: randomUUID(), workspaceId: schema }
        const now = new Date().toISOString()
        const modelId = randomUUID()
        await embeddings.createModel(
            scope,
            {
                model: {
                    id: modelId,
                    name: 'Numeric fixture',
                    baseUrl: 'https://fixture.example.com/v1',
                    model: 'fixture-model',
                    hasApiKey: true,
                    isDefault: false,
                    revision: 1,
                    createdAt: now,
                    updatedAt: now,
                },
                encryptedApiKey: 'explicit-test-only-opaque-ciphertext',
            },
            'a'.repeat(64)
        )
        const model = await embeddings.verifyModel(scope, modelId, 1, 2, 'fixture-provider-v1')
        const id = randomUUID()
        const vectors = [
            [3e38, 0],
            [-3e38, 0],
            [0, 3e38],
            [1e-40, 0],
            [-1e-40, 0],
            [0, 1e-40],
        ]
        const source = '文'.repeat(200 * vectors.length)
        const chunks = vectors.map((_vector, index) => ({
            id: randomUUID(),
            documentId: id,
            index: index + 1,
            content: '文'.repeat(200),
            characterCount: 200,
            charStart: index * 200,
            charEnd: (index + 1) * 200,
        }))
        await store.knowledge!.create(
            scope,
            {
                document: {
                    id,
                    fileName: 'numeric.md',
                    format: 'md',
                    size: Buffer.byteLength(source),
                    status: 'queued',
                    chunkSize: 200,
                    overlap: 0,
                    characterCount: 0,
                    chunkCount: 0,
                    attempt: 0,
                    createdAt: now,
                    updatedAt: now,
                },
                objectKey: `explicit-test-only/${id}`,
                sha256: createHash('sha256').update(source).digest('hex'),
                fingerprint: 'b'.repeat(64),
            },
            async () => undefined
        )
        const parsing = await store.knowledge!.claim(60000)
        await store.knowledge!.complete(parsing!, { characterCount: source.length, chunks })
        await embeddings.startIndex(scope, id, { requestId: randomUUID(), modelId, revision: 1 })
        const job = (await embeddings.claim(60000))!
        const pending = await embeddings.pendingChunks(job)
        for (const invalid of [1e100, 1e-100]) {
            const malformed = vectors.map(vector => [...vector])
            malformed[0] = [invalid, 0]
            await expect(embeddings.saveBatch(job, pending, malformed)).rejects.toThrow('Invalid pgvector float32')
        }
        expect(await embeddings.saveBatch(job, pending, vectors)).toMatchObject({ status: 'ready', completedChunks: 6 })
        const space = embeddingSpace(model)!
        for (const query of [
            [3e38, 0],
            [1e-40, 0],
        ]) {
            const hits = await embeddings.search(scope, space, query, 6, id)
            expect(hits).toHaveLength(6)
            expect(hits.map(hit => hit.chunk.index)).toEqual([1, 4, 3, 6, 2, 5])
            for (const [position, hit] of hits.entries()) {
                expect(Number.isFinite(hit.distance)).toBe(true)
                expect(hit.distance).toBeCloseTo(position < 2 ? 0 : position < 4 ? 1 : 2, 6)
                expect(hit.score).toBeCloseTo(1 - hit.distance, 6)
            }
        }
        const reversed = await embeddings.search(scope, space, [-3e38, 0], 6, id)
        expect(reversed.map(hit => hit.chunk.index)).toEqual([2, 5, 3, 6, 1, 4])
        const perpendicular = await embeddings.search(scope, space, [0, 1e-40], 6, id)
        expect(perpendicular.slice(0, 2).map(hit => hit.chunk.index)).toEqual([3, 6])
        expect(perpendicular.every(hit => Number.isFinite(hit.distance))).toBe(true)
        const physical = await admin.query<{ direction: string }>(
            `SELECT embedding::text AS direction FROM ${schema}.harness_knowledge_vectors`
        )
        for (const row of physical.rows) expect(Math.hypot(...(JSON.parse(row.direction) as number[]))).toBeCloseTo(1, 6)
    } finally {
        await store?.close()
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('real pgvector extreme magnitude stability', () => {
    it('preserves same, opposite, and perpendicular cosine directions for huge and tiny finite float32 values', verifyExtremeDirections)
})
