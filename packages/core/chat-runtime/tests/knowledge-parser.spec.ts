import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseKnowledgeDocument, normalizeKnowledgeText, splitKnowledgeText, validateKnowledgeDocx } from '../src/knowledge-parser.js'
import { knowledgeDocx, knowledgePdf } from './knowledge-fixtures.js'

const settings = { chunkSize: 200, overlap: 80 }
describe('real knowledge extraction and Unicode chunking', () => {
    it('preserves every Unicode character with bounded actual overlap while covering normalized text', () => {
        const source = normalizeKnowledgeText('\uFEFF标题\r\n' + '中文😀é\r多段\n'.repeat(180))
        const points = Array.from(source)
        const chunks = splitKnowledgeText(source, settings)
        const restored: string[] = []
        for (const [index, chunk] of chunks.entries()) {
            expect(chunk.index).toBe(index + 1)
            expect(chunk.characterCount).toBe(Array.from(chunk.content).length)
            expect(chunk.content).toBe(points.slice(chunk.charStart, chunk.charEnd).join(''))
            const prior = chunks[index - 1]
            const actualOverlap = prior ? prior.charEnd - chunk.charStart : 0
            expect(actualOverlap).toBeGreaterThanOrEqual(0)
            expect(actualOverlap).toBeLessThanOrEqual(settings.overlap)
            expect(chunk.characterCount).toBeLessThanOrEqual(settings.chunkSize)
            if (prior) {
                expect(chunk.charStart).toBeGreaterThan(prior.charStart)
                expect(chunk.charEnd).toBeGreaterThan(prior.charEnd)
            }
            restored.push(Array.from(chunk.content).slice(actualOverlap).join(''))
        }
        expect(restored.join('')).toBe(source)
        expect(chunks.at(-1)?.charEnd).toBe(points.length)
    })
    it('handles short texts, zero overlap and exact window boundaries without redundant trailing chunks', () => {
        expect(splitKnowledgeText('你好😀', settings)).toMatchObject([{ content: '你好😀', charStart: 0, charEnd: 3 }])
        expect(splitKnowledgeText('x'.repeat(400), { chunkSize: 200, overlap: 0 })).toHaveLength(2)
        expect(splitKnowledgeText('x'.repeat(200), settings)).toHaveLength(1)
    })
    it('packs short paragraphs and ends at paragraph boundaries before using sentence punctuation', () => {
        const first = '甲'.repeat(90) + '。\n\n'
        const second = '乙'.repeat(85) + '！\n\n'
        const third = '丙'.repeat(85) + '。'
        const source = first + second + third
        const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 0 })
        expect(chunks.map(chunk => chunk.content)).toEqual([first + second, third])
        expect(chunks[0]!.characterCount).toBe(181)
        expect(splitKnowledgeText(source, { chunkSize: 200, overlap: 0 })).toEqual(chunks)
    })
    it('splits long paragraphs at complete sentences and retains closing punctuation together', () => {
        const first = '甲'.repeat(79) + '。'
        const second = '乙'.repeat(78) + '！”'
        const third = '丙'.repeat(80) + '？'
        expect(splitKnowledgeText(first + second + third, { chunkSize: 200, overlap: 0 }).map(chunk => chunk.content)).toEqual([
            first + second,
            third,
        ])
        const quoted = '丁'.repeat(198) + '。”'
        expect(splitKnowledgeText(quoted + third, { chunkSize: 200, overlap: 0 })[0]!.content).toBe(quoted)
        for (const punctuation of ['...', '?!.', '!?.']) {
            const sentence = 'A'.repeat(170) + punctuation
            expect(splitKnowledgeText(sentence + 'B'.repeat(80), { chunkSize: 200, overlap: 0 })[0]!.content).toBe(sentence)
        }
    })
    it('uses clause punctuation without treating numeric punctuation as a natural boundary', () => {
        const first = '甲'.repeat(150) + '；'
        const numbers = '价格3.14与1,000和12:30'
        const tail = '乙'.repeat(210)
        const chunks = splitKnowledgeText(first + numbers + tail, { chunkSize: 200, overlap: 0 })
        expect(chunks[0]!.content).toBe(first)
        expect(chunks.map(chunk => chunk.content).join('')).toBe(first + numbers + tail)
        const clause = '甲'.repeat(89) + ',' + '乙'.repeat(89) + ':'
        expect(splitKnowledgeText(clause + tail, { chunkSize: 200, overlap: 0 })[0]!.content).toBe(clause)
    })
    it('repeats a complete suffix sentence within budget and permits zero natural overlap', () => {
        const first = '甲'.repeat(99) + '。'
        const second = '乙'.repeat(59) + '。'
        const third = '丙'.repeat(129) + '。'
        const chunks = splitKnowledgeText(first + second + third, { chunkSize: 200, overlap: 80 })
        expect(chunks.map(chunk => [chunk.charStart, chunk.charEnd])).toEqual([
            [0, 160],
            [100, 290],
        ])
        expect(chunks[1]!.content).toBe(second + third)
        const oversizedSuffix = '乙'.repeat(89) + '。'
        const noOverlap = splitKnowledgeText(first + oversizedSuffix + third, { chunkSize: 200, overlap: 80 })
        expect(noOverlap[1]!.charStart).toBe(noOverlap[0]!.charEnd)
    })
    it('uses character overlap for unbroken text and cannot repeat an old semantic end', () => {
        const hard = splitKnowledgeText('😀'.repeat(420), { chunkSize: 200, overlap: 80 })
        expect(hard.map(chunk => [chunk.charStart, chunk.charEnd])).toEqual([
            [0, 200],
            [120, 320],
            [240, 420],
        ])
        const source = '甲'.repeat(99) + '。' + '乙'.repeat(59) + '。\n\n' + '丙'.repeat(500)
        const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 100 })
        for (let index = 1; index < chunks.length; index++) expect(chunks[index]!.charEnd).toBeGreaterThan(chunks[index - 1]!.charEnd)
        expect(chunks.at(-1)!.charEnd).toBe(Array.from(source).length)
    })
    it('falls back to word whitespace and retains exact page intersections', () => {
        const source = 'alpha '.repeat(80)
        const chunks = splitKnowledgeText(source, { chunkSize: 200, overlap: 20 }, [
            { start: 0, end: 250, page: 1 },
            { start: 251, end: source.length, page: 2 },
        ])
        expect(chunks[0]!.charEnd).toBe(198)
        expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 1 })
        expect(chunks[1]).toMatchObject({ pageStart: 1, pageEnd: 2 })
        expect(chunks.at(-1)).toMatchObject({ pageStart: 2, pageEnd: 2 })
    })
    it('checks the actual semantic chunk count without applying the old exact-overlap estimate', () => {
        const paragraph = '文'.repeat(198) + '\n\n'
        expect(splitKnowledgeText(paragraph.repeat(5000), { chunkSize: 200, overlap: 100 })).toHaveLength(5000)
        const shorterParagraph = '文'.repeat(188) + '\n\n'
        expect(() => splitKnowledgeText(shorterParagraph.repeat(5001), { chunkSize: 200, overlap: 0 })).toThrow('5000')
    })
    it('enforces character, chunk-count and overlap bounds with actionable errors', () => {
        expect(() => splitKnowledgeText('x'.repeat(2_000_001), settings)).toThrow('200 万')
        expect(() => splitKnowledgeText('x'.repeat(1_000_000), { chunkSize: 200, overlap: 100 })).toThrow('5000')
        expect(() => splitKnowledgeText('  \n', settings)).toThrow('可用正文')
        expect(() => splitKnowledgeText('text', { chunkSize: 200, overlap: 101 })).toThrow('一半')
    })
    it('extracts UTF-8 TXT and Markdown as real text including literal HTML', async () => {
        for (const format of ['txt', 'md'] as const) {
            const result = await parseKnowledgeDocument({
                file: Buffer.from('# 中文资料\r\n<script>literal</script>😀'),
                format,
                ...settings,
            })
            expect(result.chunks[0]!.content).toBe('# 中文资料\n<script>literal</script>😀')
        }
    })
    it('rejects malformed UTF-8, binary disguise, empty uploads and invalid PDF contents', async () => {
        for (const bytes of [Buffer.from([0xff]), Buffer.from('binary\0text'), Buffer.from('%PDF-1.7\nnot-text'), Buffer.alloc(0)])
            await expect(parseKnowledgeDocument({ file: bytes, format: 'txt', ...settings })).rejects.toThrow()
        await expect(parseKnowledgeDocument({ file: Buffer.from('disguised'), format: 'pdf', ...settings })).rejects.toThrow('PDF')
    })
    it('extracts actual DOCX XML and never turns source markup into executable HTML', async () => {
        const source = ['资料库测试 😀', '<script>仅正文</script>', '原始第二段']
        const result = await parseKnowledgeDocument({ file: knowledgeDocx(source), format: 'docx', ...settings })
        for (const paragraph of source) expect(result.chunks.map(chunk => chunk.content).join('')).toContain(paragraph)
    })
    it('rejects DOCX metadata bombs, dishonest expanded sizes and truncated archives', () => {
        const source = knowledgeDocx(['有效正文'])
        const bomb = Buffer.from(source)
        const central = bomb.indexOf(Buffer.from('504b0102', 'hex'))
        bomb.writeUInt32LE(40 * 1024 * 1024, central + 24)
        expect(() => validateKnowledgeDocx(bomb)).toThrow('展开后过大')
        const dishonest = Buffer.from(source)
        dishonest.writeUInt32LE(1, central + 24)
        expect(() => validateKnowledgeDocx(dishonest)).toThrow()
        expect(() => validateKnowledgeDocx(source.subarray(0, source.length - 10))).toThrow()
    })
    it('extracts known Chinese PDF text and reports genuine page boundaries', async () => {
        const result = await parseKnowledgeDocument({
            file: knowledgePdf(['中文资料第一页', '独立第二页来源']),
            format: 'pdf',
            ...settings,
        })
        expect(result.pageCount).toBe(2)
        expect(result.chunks.map(chunk => chunk.content).join('')).toContain('中文资料第一页')
        expect(result.chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 2 })
    })
    it('rejects a genuinely encrypted PDF and encrypted Office container signatures', async () => {
        const encrypted = await readFile(new URL('./fixtures/encrypted.pdf', import.meta.url))
        await expect(parseKnowledgeDocument({ file: encrypted, format: 'pdf', ...settings })).rejects.toThrow('加密')
        const officeContainer = Buffer.alloc(512)
        Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(officeContainer)
        expect(() => validateKnowledgeDocx(officeContainer)).toThrow('已加密')
    })
    it('fails empty scanned PDFs and excessive PDF page counts without zero-chunk success', async () => {
        await expect(parseKnowledgeDocument({ file: knowledgePdf(['']), format: 'pdf', ...settings })).rejects.toThrow('可用正文')
        await expect(parseKnowledgeDocument({ file: knowledgePdf(Array(501).fill('page')), format: 'pdf', ...settings })).rejects.toThrow(
            '500 页'
        )
    })
})
