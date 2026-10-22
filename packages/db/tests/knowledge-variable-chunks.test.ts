import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { KnowledgeChunk } from '@ai-harness/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createPostgresKnowledgeStore, type KnowledgeLease } from '../src/index.js'

const sourceText = '甲😀乙。\n'.repeat(80)
const points = Array.from(sourceText)

/**
 * Creates a trusted processing lease with a maximum length and overlap budget.
 * @returns One owned lease and its immutable original parameters.
 */
function lease(): KnowledgeLease {
    const now = '2026-10-18T00:00:00.000Z'
    return {
        scope: { userId: randomUUID(), workspaceId: 'variable-chunk-fixture' },
        leaseToken: randomUUID(),
        generation: 1,
        record: {
            document: {
                id: randomUUID(),
                fileName: 'variable.txt',
                format: 'txt',
                size: Buffer.byteLength(sourceText),
                status: 'processing',
                chunkSize: 200,
                overlap: 100,
                chunkCount: 0,
                characterCount: 0,
                attempt: 1,
                createdAt: now,
                updatedAt: now,
            },
            objectKey: 'private-fixture-source',
            sha256: 'a'.repeat(64),
            fingerprint: 'b'.repeat(64),
        },
    }
}

/**
 * Builds complete source-aligned chunks independently of the production splitter.
 * @param job - Owned document identity.
 * @param ranges - Explicit half-open Unicode source ranges.
 * @returns The original Unicode count and exact identified chunk bodies.
 */
function batch(
    job: KnowledgeLease,
    ranges = [
        [0, 130],
        [100, 260],
        [250, 400],
    ]
) {
    return {
        characterCount: points.length,
        chunks: ranges.map(([charStart, charEnd], offset): KnowledgeChunk => ({
            id: randomUUID(),
            documentId: job.record.document.id,
            index: offset + 1,
            content: points.slice(charStart, charEnd).join(''),
            characterCount: charEnd - charStart,
            charStart,
            charEnd,
        })),
    }
}

/**
 * Captures transaction effects without replacing the production complete-batch validator.
 * @returns The public store and observable isolated database transport.
 */
function persistence() {
    const query = vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>(async () => ({
        rows: [],
        rowCount: 1,
    }))
    const release = vi.fn()
    const connect = vi.fn(async () => ({ query, release }))
    const store = createPostgresKnowledgeStore({ connect } as unknown as pg.Pool)
    return { store, query, release, connect }
}

describe('maximum-budget knowledge batch validation', () => {
    it('commits short middle chunks and variable actual overlap without changing IDs or source offsets', async () => {
        const job = lease()
        const result = batch(job)
        const { store, query, release } = persistence()
        expect(await store.complete(job, result)).toBe(true)
        const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO harness_knowledge_chunks'))!
        expect(JSON.parse(insert[1]![3] as string)).toEqual(result.chunks)
        expect(query.mock.calls[0]![0]).toBe('BEGIN')
        expect(query.mock.calls.at(-1)![0]).toBe('COMMIT')
        expect(release).toHaveBeenCalledOnce()
    })

    it('accepts zero actual overlap within a nonzero budget and retains legacy fixed windows as a valid case', async () => {
        for (const ranges of [
            [
                [0, 90],
                [90, 240],
                [240, 400],
            ],
            [
                [0, 200],
                [100, 300],
                [200, 400],
            ],
        ]) {
            const job = lease()
            const { store } = persistence()
            expect(await store.complete(job, batch(job, ranges))).toBe(true)
        }
    })

    it.each(['gap', 'start', 'end', 'budget', 'intersection', 'origin', 'tail', 'length', 'sequence', 'count', 'document'] as const)(
        'rejects invalid %s before any transaction or metadata write',
        async kind => {
            const job = lease()
            const result = batch(job)
            const chunk = result.chunks[1]!
            if (kind === 'gap') {
                chunk.charStart = 131
                chunk.content = points.slice(131, chunk.charEnd).join('')
                chunk.characterCount = chunk.charEnd - chunk.charStart
            }
            if (kind === 'start') {
                chunk.charStart = 0
                chunk.charEnd = 160
                chunk.content = points.slice(0, 160).join('')
                chunk.characterCount = 160
            }
            if (kind === 'end') {
                chunk.charEnd = 130
                chunk.content = points.slice(chunk.charStart, 130).join('')
                chunk.characterCount = 30
            }
            if (kind === 'budget') job.record.document.overlap = 20
            if (kind === 'intersection') chunk.content = '错' + Array.from(chunk.content).slice(1).join('')
            if (kind === 'origin') {
                const first = result.chunks[0]!
                first.charStart = 1
                first.content = points.slice(1, first.charEnd).join('')
                first.characterCount -= 1
            }
            if (kind === 'tail') result.characterCount += 1
            if (kind === 'length') {
                const first = result.chunks[0]!
                first.charEnd = 201
                first.characterCount = 201
                first.content = points.slice(0, 201).join('')
            }
            if (kind === 'sequence') chunk.index = 1
            if (kind === 'count') chunk.characterCount += 1
            if (kind === 'document') chunk.documentId = randomUUID()
            const { store, connect } = persistence()
            await expect(store.complete(job, result)).rejects.toThrow()
            expect(connect).not.toHaveBeenCalled()
        }
    )

    it('keeps the existing lease CAS and rolls back without publishing chunks for a stale worker', async () => {
        const job = lease()
        const { store, query, release } = persistence()
        query.mockImplementation(async sql => ({ rows: [], rowCount: sql.includes("SET status='ready'") ? 0 : 1 }))
        expect(await store.complete(job, batch(job))).toBe(false)
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO harness_knowledge_chunks'))).toBe(false)
        expect(query.mock.calls.at(-1)![0]).toBe('ROLLBACK')
        expect(release).toHaveBeenCalledOnce()
    })
})
