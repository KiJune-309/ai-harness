import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import type { KnowledgeChunk } from '@ai-harness/contracts'
import { describe, expect, it } from 'vitest'
import { createChatStore, type ChatScope, type KnowledgeStore, type StoredKnowledgeDocument } from '../src/index.js'

/**
 * Runs only inside a random owned schema while retaining public.vector and all existing user data.
 * @param scenario - Actual persistent knowledge assertions.
 * @returns After the test-owned pool and schema have been cleaned up.
 * @throws Error for real PostgreSQL or assertion failures.
 */
async function isolated(scenario: (knowledge: KnowledgeStore, scope: ChatScope) => Promise<void>) {
    const schema = `sf009_variable_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    let store: Awaited<ReturnType<typeof createChatStore>> | undefined
    let owned = false
    try {
        await admin.query(`CREATE SCHEMA ${schema}`)
        owned = true
        store = await createChatStore({ databaseUrl: url.toString() })
        await scenario(store.knowledge!, { userId: randomUUID(), workspaceId: schema })
    } finally {
        await store?.close()
        if (owned) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Creates an independent immutable source record for the real persistence path.
 * @returns Queued original metadata with existing maximum-budget parameters.
 */
function original(): StoredKnowledgeDocument {
    const id = randomUUID()
    const now = new Date().toISOString()
    const digest = createHash('sha256').update(id).digest('hex')
    return {
        document: {
            id,
            fileName: '自然边界😀.txt',
            format: 'txt',
            size: 1200,
            status: 'queued',
            chunkSize: 200,
            overlap: 100,
            chunkCount: 0,
            characterCount: 0,
            attempt: 0,
            createdAt: now,
            updatedAt: now,
        },
        objectKey: `sf009-test/${id}`,
        sha256: digest,
        fingerprint: digest,
    }
}

/**
 * Specifies shorter-than-maximum chunks with decreasing actual overlap and full source coverage.
 * @param id - Real owned document identifier.
 * @returns A known canonical Unicode source and its explicit source-aligned chunks.
 */
function variableBatch(id: string) {
    const text = '甲😀乙。\n'.repeat(80)
    const points = Array.from(text)
    const chunks: KnowledgeChunk[] = [
        [0, 130],
        [100, 260],
        [250, 400],
    ].map(([charStart, charEnd], offset) => ({
        id: randomUUID(),
        documentId: id,
        index: offset + 1,
        content: points.slice(charStart, charEnd).join(''),
        characterCount: charEnd - charStart,
        charStart,
        charEnd,
    }))
    return { text, characterCount: points.length, chunks }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('real PostgreSQL variable knowledge chunks', () => {
    it('atomically stores and reloads shorter chunks, varying overlap, Unicode coordinates, and original chunk identities', async () => {
        await isolated(async (knowledge, scope) => {
            const record = original()
            await knowledge.create(scope, record, async () => undefined)
            const job = (await knowledge.claim(120000))!
            const result = variableBatch(record.document.id)
            expect(await knowledge.complete(job, result)).toBe(true)
            const saved = await knowledge.chunks(scope, record.document.id, 1, 20)
            expect(saved?.chunks).toEqual(result.chunks)
            expect((await knowledge.get(scope, record.document.id))?.document).toMatchObject({
                status: 'ready',
                chunkCount: 3,
                characterCount: 400,
                chunkSize: 200,
                overlap: 100,
            })
            const reconstructed: string[] = []
            for (const chunk of saved!.chunks)
                reconstructed.push(...Array.from(chunk.content).slice(Math.max(0, reconstructed.length - chunk.charStart)))
            expect(reconstructed.join('')).toBe(result.text)
            expect(await knowledge.get({ ...scope, userId: randomUUID() }, record.document.id)).toBeUndefined()
        })
    })

    it('rejects inconsistent intersections without making any metadata or partial chunks visible, then accepts the valid batch', async () => {
        await isolated(async (knowledge, scope) => {
            const record = original()
            await knowledge.create(scope, record, async () => undefined)
            const job = (await knowledge.claim(120000))!
            const result = variableBatch(record.document.id)
            const invalid = structuredClone(result)
            invalid.chunks[1]!.content = '错' + Array.from(invalid.chunks[1]!.content).slice(1).join('')
            await expect(knowledge.complete(job, invalid)).rejects.toThrow('complete ordered source batch')
            expect((await knowledge.get(scope, record.document.id))?.document).toMatchObject({
                status: 'processing',
                chunkCount: 0,
                characterCount: 0,
            })
            expect(await knowledge.chunks(scope, record.document.id, 1, 20)).toMatchObject({ chunks: [], total: 0 })
            expect(await knowledge.complete(job, result)).toBe(true)
        })
    })
})
