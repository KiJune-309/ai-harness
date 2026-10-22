import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { KnowledgeChunkDraft } from '@ai-harness/contracts'
import { normalizeKnowledgeText, splitKnowledgeText } from '../src/knowledge-parser.js'

/**
 * Independently checks every source interval and reconstructs Unicode text without assuming an exact configured overlap.
 * @param source - Canonical original text.
 * @param chunks - Complete candidate result.
 * @param maximum - Configured hard character limit.
 * @param overlap - Configured maximum overlap.
 * @returns Nothing after verifying source preservation and strict progress.
 */
function coverage(source: string, chunks: KnowledgeChunkDraft[], maximum: number, overlap: number): void {
    const points = Array.from(source)
    const restored: string[] = []
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.length).toBeLessThanOrEqual(5000)
    let previous: KnowledgeChunkDraft | undefined
    for (const [offset, chunk] of chunks.entries()) {
        expect(chunk.index).toBe(offset + 1)
        expect(chunk.characterCount).toBe(Array.from(chunk.content).length)
        expect(chunk.characterCount).toBe(chunk.charEnd - chunk.charStart)
        expect(chunk.characterCount).toBeGreaterThan(0)
        expect(chunk.characterCount).toBeLessThanOrEqual(maximum)
        expect(chunk.content).toBe(points.slice(chunk.charStart, chunk.charEnd).join(''))
        const actualOverlap = previous ? previous.charEnd - chunk.charStart : 0
        if (previous) {
            expect(chunk.charStart).toBeGreaterThan(previous.charStart)
            expect(chunk.charEnd).toBeGreaterThan(previous.charEnd)
            expect(actualOverlap).toBeGreaterThanOrEqual(0)
            expect(actualOverlap).toBeLessThanOrEqual(overlap)
            expect(actualOverlap).toBeLessThan(previous.characterCount)
            if (actualOverlap)
                expect(Array.from(chunk.content).slice(0, actualOverlap).join('')).toBe(
                    Array.from(previous.content).slice(-actualOverlap).join('')
                )
        } else expect(chunk.charStart).toBe(0)
        restored.push(Array.from(chunk.content).slice(actualOverlap).join(''))
        previous = chunk
    }
    expect(previous?.charEnd).toBe(points.length)
    expect(restored.join('')).toBe(source)
}

describe('independent paragraph and punctuation chunking acceptance', () => {
    it('merges short paragraphs, prefers paragraphs before later punctuation, and remains deterministic', () => {
        const first = '甲'.repeat(79) + '\n\n'
        const second = '乙'.repeat(69) + '\n\n'
        const third = '丙'.repeat(139) + '\n\n'
        const source = first + second + third + '丁'.repeat(99)
        const settings = { chunkSize: 200, overlap: 0 }
        const chunks = splitKnowledgeText(source, settings)
        expect(chunks.map(chunk => [chunk.charStart, chunk.charEnd])).toEqual([
            [0, 152],
            [152, 293],
            [293, 392],
        ])
        expect(splitKnowledgeText(source, settings)).toEqual(chunks)
        coverage(source, chunks, 200, 0)
        for (const [prefix, expectedEnd] of [
            ['甲'.repeat(79) + '\n\n' + '乙'.repeat(98) + '。', 81],
            ['甲'.repeat(119) + '\n' + '乙'.repeat(59) + '。', 120],
            ['甲'.repeat(119) + '。' + '乙'.repeat(59) + '，', 120],
        ] as const) {
            const value = prefix + '丙'.repeat(100)
            const result = splitKnowledgeText(value, settings)
            expect(result[0]?.charEnd).toBe(expectedEnd)
            coverage(value, result, 200, 0)
        }
        expect(splitKnowledgeText('短段\n\n第二段。\n第三段！', settings)).toHaveLength(1)
    })

    it('keeps bounded punctuation clusters and closures while excluding punctuation inside numeric values', () => {
        for (const prefixSize of [175, 195, 198]) {
            const source = '甲'.repeat(prefixSize) + '！？。”）' + '乙'.repeat(100)
            const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 0 })
            if (prefixSize <= 195) {
                expect(chunks[0]?.charEnd).toBe(prefixSize + 5)
                expect(chunks[0]?.content.endsWith('！？。”）')).toBe(true)
            }
            coverage(source, chunks, 200, 0)
        }
        for (const numeric of ['3.14', '1,000', '12:30']) {
            const source = '甲'.repeat(140) + '，' + '乙'.repeat(52) + numeric + '丙'.repeat(100)
            const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 0 })
            expect(chunks[0]?.charEnd).toBe(141)
            coverage(source, chunks, 200, 0)
        }
        for (const mark of ['.', '?', '!']) {
            const source = 'A'.repeat(140) + mark + ' ' + 'B'.repeat(140)
            const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 0 })
            expect(chunks[0]?.content.trimEnd().endsWith(mark)).toBe(true)
            coverage(source, chunks, 200, 0)
        }
        for (const run of ['...', '?!.', '!?.']) {
            const source = 'A'.repeat(170) + run + 'B'.repeat(80)
            const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 0 })
            expect(chunks[0]?.charEnd).toBe(170 + run.length)
            expect(chunks[0]?.content.endsWith(run)).toBe(true)
            coverage(source, chunks, 200, 0)
        }
    })

    it('repeats whole fitting sentences and uses zero overlap instead of cutting an oversized natural unit', () => {
        const source =
            '甲'.repeat(119) + '。' + '乙'.repeat(59) + '。' + '丙'.repeat(139) + '。' + '丁'.repeat(119) + '。' + '戊'.repeat(119) + '。'
        const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 80 })
        expect(chunks.map(chunk => [chunk.charStart, chunk.charEnd])).toEqual([
            [0, 180],
            [120, 320],
            [320, 440],
            [440, 560],
        ])
        expect(chunks[0]!.charEnd - chunks[1]!.charStart).toBe(60)
        expect(chunks[1]!.charEnd - chunks[2]!.charStart).toBe(0)
        coverage(source, chunks, 200, 80)
    })

    it('never repeats an entire short preceding chunk and still applies bounded character overlap to genuinely unbroken text', () => {
        const source = '甲'.repeat(59) + '。' + '乙'.repeat(149) + '。' + '丙'.repeat(149) + '。'
        const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 100 })
        expect(chunks.map(chunk => [chunk.charStart, chunk.charEnd])).toEqual([
            [0, 60],
            [60, 210],
            [210, 360],
        ])
        coverage(source, chunks, 200, 100)
        const unbroken = '界😀'.repeat(450)
        const hard = splitKnowledgeText(unbroken, { chunkSize: 200, overlap: 100 })
        expect(hard).toHaveLength(8)
        expect(hard[0]!.charEnd - hard[1]!.charStart).toBe(100)
        coverage(unbroken, hard, 200, 100)
    })

    it('preserves leading, trailing, combining, and long whitespace content across randomized source boundaries', () => {
        const whitespace = normalizeKnowledgeText('\uFEFF  开头😀\r\n\r\n' + ' '.repeat(701) + '\t结尾é  \r\n')
        coverage(whitespace, splitKnowledgeText(whitespace, { chunkSize: 200, overlap: 100 }), 200, 100)
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom('甲', 'A', '😀', 'e', '\u0301', '\n', '\t', ' ', '。', '？', ',', '.', '3', '4', '”', ')'), {
                    maxLength: 1800,
                }),
                fc.constantFrom(200, 400, 1000),
                fc.integer({ min: 0, max: 500 }),
                (characters, chunkSize, requestedOverlap) => {
                    const source = '首' + characters.join('') + '末'
                    const overlap = Math.min(requestedOverlap, Math.floor(chunkSize / 2))
                    coverage(source, splitKnowledgeText(source, { chunkSize, overlap }), chunkSize, overlap)
                }
            ),
            { numRuns: 60, seed: 20261018 }
        )
    })

    it('enforces the actual semantic chunk count and accepts the two-million-code-point boundary', () => {
        const paragraph = '甲'.repeat(188) + '\n\n'
        const allowed = splitKnowledgeText(paragraph.repeat(5000), { chunkSize: 200, overlap: 0 })
        expect(allowed).toHaveLength(5000)
        expect(allowed.every(chunk => chunk.characterCount === 190)).toBe(true)
        expect(() => splitKnowledgeText(paragraph.repeat(5001), { chunkSize: 200, overlap: 0 })).toThrow('5000')
        const maximum = splitKnowledgeText('界'.repeat(2_000_000), { chunkSize: 4000, overlap: 0 })
        expect(maximum).toHaveLength(500)
        expect(maximum.at(-1)?.charEnd).toBe(2_000_000)
        expect(() => splitKnowledgeText('界'.repeat(2_000_001), { chunkSize: 4000, overlap: 0 })).toThrow('200 万')
    })

    it('recomputes genuine PDF page intersections from shortened Unicode intervals', () => {
        const pageText = [
            '第一页' + '甲'.repeat(116) + '。\n\n',
            '第二页' + '乙'.repeat(116) + '。\n\n',
            '第三页' + '丙'.repeat(116) + '。\n\n',
        ]
        const pages: { start: number; end: number; page: number }[] = []
        let start = 0
        for (const [index, text] of pageText.entries()) {
            const length = Array.from(text).length
            pages.push({ start, end: start + length, page: index + 1 })
            start += length + 1
        }
        const source = pageText.join('\n')
        const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 0 }, pages)
        expect(chunks.map(chunk => [chunk.pageStart, chunk.pageEnd])).toEqual([
            [1, 1],
            [2, 2],
            [3, 3],
        ])
        expect(chunks.some(chunk => chunk.characterCount < 200)).toBe(true)
        coverage(source, chunks, 200, 0)
    })
})
