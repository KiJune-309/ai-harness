import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import mammoth from 'mammoth'
import { inflateRawSync } from 'node:zlib'
import {
    KNOWLEDGE_MAX_CHARACTERS,
    KNOWLEDGE_MAX_CHUNKS,
    KNOWLEDGE_MAX_FILE_SIZE,
    KNOWLEDGE_MAX_PAGES,
    knowledgeChunkingSchema,
    knowledgeFormatSchema,
    knowledgeProcessingResultSchema,
    type KnowledgeChunkDraft,
    type KnowledgeFormat,
    type KnowledgeProcessingResult,
} from '@ai-harness/contracts'

export interface KnowledgeProcessingInput {
    file: Uint8Array
    format: KnowledgeFormat
    chunkSize: number
    overlap: number
}

/**
 * Signals an actionable document failure without reflecting source content or parser internals.
 */
export class KnowledgeProcessingError extends Error {}

/**
 * Normalizes source line endings without silently trimming meaningful text or changing offsets later.
 * @param text - Extracted source text.
 * @returns Text using LF with the leading BOM and NUL bytes removed.
 */
export function normalizeKnowledgeText(text: string): string {
    return text
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .replaceAll('\u0000', '')
}

const closingKnowledgePunctuation = new Set(['”', '’', '」', '』', '》', '〉', '】', '〕', '）', ')', ']', '}', '»', '›', '"', "'"])

/**
 * Classifies sentence and clause punctuation while preserving common numeric and technical tokens.
 * @param characters - Original Unicode code points.
 * @param position - Candidate punctuation position.
 * @returns Sentence priority two, clause priority three, or undefined for ordinary source characters.
 */
function knowledgePunctuationLevel(characters: readonly string[], position: number): number | undefined {
    const character = characters[position]!
    if ('。！？!?'.includes(character)) return 2
    const previous = characters[position - 1] ?? ''
    const next = characters[position + 1]
    const betweenDigits = /^[0-9]$/.test(previous) && /^[0-9]$/.test(next ?? '')
    if (character === '.') {
        if (betweenDigits) return undefined
        return next === undefined || /\s/u.test(next) || closingKnowledgePunctuation.has(next) || next === '.' ? 2 : undefined
    }
    if ('，；：、'.includes(character)) return 3
    if (',;:'.includes(character)) {
        if ((character === ',' || character === ':') && betweenDigits) return undefined
        if (character === ':' && next === '/') return undefined
        return 3
    }
    return undefined
}

/**
 * Scans once to retain ordered source boundaries without copying or trimming any original unit.
 * @param characters - Complete bounded Unicode source.
 * @returns Five ordered levels for paragraphs, lines, sentences, clauses, and other whitespace.
 */
function knowledgeTextBoundaries(characters: readonly string[]): number[][] {
    const boundaries: number[][] = [[], [], [], [], []]
    let position = 0
    while (position < characters.length) {
        if (/\s/u.test(characters[position]!)) {
            let lines = 0
            do {
                const character = characters[position]!
                if (character === '\u2029') lines += 2
                else if ('\n\r\u2028'.includes(character)) lines += 1
                position += 1
            } while (position < characters.length && /\s/u.test(characters[position]!))
            boundaries[lines > 1 ? 0 : lines === 1 ? 1 : 4]!.push(position)
            continue
        }
        let level = knowledgePunctuationLevel(characters, position)
        if (level === undefined) {
            position += 1
            continue
        }
        position += 1
        while (position < characters.length) {
            // Once a sentence-ending run starts, its trailing periods belong to that same run.
            const nextLevel = level === 2 && characters[position] === '.' ? 2 : knowledgePunctuationLevel(characters, position)
            if (nextLevel === undefined && !closingKnowledgePunctuation.has(characters[position]!)) break
            if (nextLevel !== undefined) level = Math.min(level, nextLevel)
            position += 1
        }
        boundaries[level]!.push(position)
    }
    return boundaries
}

/**
 * Locates an ordered boundary without rescanning earlier source characters.
 * @param boundaries - One ascending priority level.
 * @param minimum - Smallest acceptable boundary position.
 * @returns Index of the first boundary at or beyond minimum, or the array length.
 */
function knowledgeBoundaryIndex(boundaries: readonly number[], minimum: number): number {
    let low = 0
    let high = boundaries.length
    while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (boundaries[middle]! < minimum) low = middle + 1
        else high = middle
    }
    return low
}

/**
 * Chooses the furthest boundary at the highest usable priority while requiring new source coverage.
 * @param boundaries - Ordered natural boundaries by priority.
 * @param coveredEnd - Exclusive end already covered by previous chunks.
 * @param maximum - This chunk's hard source-position limit.
 * @returns A natural end or a marked character-limit fallback.
 */
function knowledgeChunkEnd(boundaries: readonly number[][], coveredEnd: number, maximum: number): { end: number; hardCut: boolean } {
    for (const level of boundaries) {
        const end = level[knowledgeBoundaryIndex(level, maximum + 1) - 1]
        if (end !== undefined && end > coveredEnd) return { end, hardCut: false }
    }
    return { end: maximum, hardCut: true }
}

/**
 * Repeats only a complete natural suffix within budget, using character overlap solely after a hard cut.
 * @param boundaries - Ordered natural boundaries by priority.
 * @param start - Current chunk's source start.
 * @param end - Current chunk's exclusive end.
 * @param overlap - Maximum permitted repeated code points.
 * @param hardCut - Whether no usable natural end was available for the current chunk.
 * @returns A strictly later next start that cannot duplicate the entire current chunk.
 */
function knowledgeOverlapStart(boundaries: readonly number[][], start: number, end: number, overlap: number, hardCut: boolean): number {
    const minimum = Math.max(start + 1, end - overlap)
    for (const level of boundaries) {
        const boundary = level[knowledgeBoundaryIndex(level, minimum)]
        if (boundary !== undefined && boundary < end) return boundary
    }
    return hardCut ? minimum : end
}

/**
 * Splits Unicode source at paragraph and punctuation boundaries with bounded natural overlap and exact offsets.
 * @param text - Already normalized document text.
 * @param settings - Validated maximum character length and overlap budget.
 * @param pages - Optional start/end offsets of actual PDF pages in this same text.
 * @returns Sequential nonempty chunks that completely cover the source.
 * @throws KnowledgeProcessingError for empty or oversized content and excessive chunk counts.
 */
export function splitKnowledgeText(
    text: string,
    settings: { chunkSize: number; overlap: number },
    pages: { start: number; end: number; page: number }[] = []
): KnowledgeChunkDraft[] {
    const { chunkSize, overlap } = knowledgeChunkingSchema.parse(settings)
    const characters = Array.from(text)
    if (!text.trim()) throw new KnowledgeProcessingError('没有提取到可用正文。扫描件暂不支持，请先进行 OCR 或上传文字版文件。')
    if (characters.length > KNOWLEDGE_MAX_CHARACTERS) throw new KnowledgeProcessingError('正文超过 200 万字符，请拆分文件后上传。')
    if (Math.ceil(characters.length / chunkSize) > KNOWLEDGE_MAX_CHUNKS)
        throw new KnowledgeProcessingError('分片数量超过 5000，请增大分片长度或拆分文件。')
    const boundaries = knowledgeTextBoundaries(characters)
    const chunks: KnowledgeChunkDraft[] = []
    let start = 0
    let coveredEnd = 0
    while (coveredEnd < characters.length) {
        if (chunks.length >= KNOWLEDGE_MAX_CHUNKS) throw new KnowledgeProcessingError('分片数量超过 5000，请增大分片长度或拆分文件。')
        const maximum = Math.min(start + chunkSize, characters.length)
        const { end, hardCut } =
            maximum === characters.length ? { end: maximum, hardCut: false } : knowledgeChunkEnd(boundaries, coveredEnd, maximum)
        const sourcePages = pages.filter(page => page.start < end && page.end > start)
        chunks.push({
            index: chunks.length + 1,
            content: characters.slice(start, end).join(''),
            characterCount: end - start,
            charStart: start,
            charEnd: end,
            ...(sourcePages.length ? { pageStart: sourcePages[0]!.page, pageEnd: sourcePages.at(-1)!.page } : {}),
        })
        if (end === characters.length) break
        coveredEnd = end
        start = knowledgeOverlapStart(boundaries, start, end, overlap, hardCut)
    }
    return chunks
}

/**
 * Rejects encrypted, ambiguous, or excessive DOCX archives before an XML parser expands any entry.
 * @param input - Complete bounded upload bytes.
 * @returns Nothing when ZIP metadata proves a bounded, ordinary DOCX archive.
 * @throws KnowledgeProcessingError for malformed or dangerous archive metadata.
 */
export function validateKnowledgeDocx(input: Uint8Array): void {
    const data = Buffer.from(input)
    const failure = 'Word 文件无效、已加密或展开后过大，请上传未加密的 DOCX 文件。'
    /**
     * Stops malformed archives without revealing their entry content.
     * @returns Never; always throws the safe document error.
     */
    const invalid = (): never => {
        throw new KnowledgeProcessingError(failure)
    }
    if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50) invalid()
    let footer = -1
    for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset -= 1) {
        if (data.readUInt32LE(offset) === 0x06054b50 && offset + 22 + data.readUInt16LE(offset + 20) === data.length) {
            footer = offset
            break
        }
    }
    if (footer < 0) invalid()
    if (data.readUInt16LE(footer + 4) || data.readUInt16LE(footer + 6)) invalid()
    const entries = data.readUInt16LE(footer + 10)
    const directorySize = data.readUInt32LE(footer + 12)
    const directoryStart = data.readUInt32LE(footer + 16)
    if (
        !entries ||
        entries > 2048 ||
        entries !== data.readUInt16LE(footer + 8) ||
        directorySize === 0xffffffff ||
        directoryStart === 0xffffffff ||
        directoryStart + directorySize !== footer
    )
        invalid()
    let cursor = directoryStart
    let expanded = 0
    const names = new Set<string>()
    for (let index = 0; index < entries; index += 1) {
        if (cursor + 46 > footer || data.readUInt32LE(cursor) !== 0x02014b50) invalid()
        const flags = data.readUInt16LE(cursor + 8)
        const method = data.readUInt16LE(cursor + 10)
        const compressed = data.readUInt32LE(cursor + 20)
        const uncompressed = data.readUInt32LE(cursor + 24)
        const nameSize = data.readUInt16LE(cursor + 28)
        const extraSize = data.readUInt16LE(cursor + 30)
        const commentSize = data.readUInt16LE(cursor + 32)
        const local = data.readUInt32LE(cursor + 42)
        if (
            flags & 1 ||
            ![0, 8].includes(method) ||
            [compressed, uncompressed, local].includes(0xffffffff) ||
            cursor + 46 + nameSize + extraSize + commentSize > footer ||
            local + 30 > directoryStart ||
            data.readUInt32LE(local) !== 0x04034b50
        )
            invalid()
        const name = data.toString('utf8', cursor + 46, cursor + 46 + nameSize)
        if (names.has(name) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) invalid()
        names.add(name)
        expanded += uncompressed
        if (
            expanded > 32 * 1024 * 1024 ||
            local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28) + compressed > directoryStart
        )
            invalid()
        const bodyStart = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
        if (
            data.readUInt16LE(local + 6) & 1 ||
            data.readUInt16LE(local + 8) !== method ||
            data.toString('utf8', local + 30, local + 30 + data.readUInt16LE(local + 26)) !== name
        )
            invalid()
        try {
            const compressedBytes = data.subarray(bodyStart, bodyStart + compressed)
            const decoded = method === 8 ? inflateRawSync(compressedBytes, { maxOutputLength: Math.max(1, uncompressed) }) : compressedBytes
            if (decoded.byteLength !== uncompressed) invalid()
        } catch {
            invalid()
        }
        cursor += 46 + nameSize + extraSize + commentSize
    }
    if (cursor !== footer || !names.has('[Content_Types].xml') || !names.has('word/document.xml')) invalid()
}

/**
 * Extracts real text from a bounded PDF without rendering, evaluating scripts, or fetching document URLs.
 * @param file - PDF bytes supplied directly rather than an external URL.
 * @returns Normalized text and real page boundaries expressed in Unicode characters.
 * @throws KnowledgeProcessingError for encrypted, malformed, empty, or excessive PDFs.
 */
async function extractPdf(
    file: Uint8Array
): Promise<{ text: string; pages: { start: number; end: number; page: number }[]; pageCount: number }> {
    if (!Buffer.from(file.subarray(0, 1024)).includes(Buffer.from('%PDF-')))
        throw new KnowledgeProcessingError('PDF 内容与格式不符，请上传有效的 PDF 文件。')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const require = createRequire(import.meta.url)
    const assets = dirname(require.resolve('pdfjs-dist/package.json'))
    const task = pdfjs.getDocument({
        data: Uint8Array.from(file),
        useSystemFonts: false,
        disableFontFace: true,
        isOffscreenCanvasSupported: false,
        useWorkerFetch: false,
        cMapUrl: join(assets, 'cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: join(assets, 'standard_fonts/'),
        wasmUrl: join(assets, 'wasm/'),
        verbosity: 0,
    })
    try {
        const document = await task.promise
        if (document.numPages > KNOWLEDGE_MAX_PAGES) throw new KnowledgeProcessingError('PDF 超过 500 页，请拆分文件后上传。')
        const parts: string[] = []
        const pages: { start: number; end: number; page: number }[] = []
        let position = 0
        for (let number = 1; number <= document.numPages; number += 1) {
            const page = await document.getPage(number)
            const result = await page.getTextContent()
            const text = normalizeKnowledgeText(
                result.items.map(item => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join('')
            )
            const size = Array.from(text).length
            if (position + size > KNOWLEDGE_MAX_CHARACTERS) throw new KnowledgeProcessingError('正文超过 200 万字符，请拆分文件后上传。')
            pages.push({ start: position, end: position + size, page: number })
            parts.push(text)
            position += size
            if (number < document.numPages) {
                parts.push('\n')
                position += 1
            }
            page.cleanup()
        }
        return { text: parts.join(''), pages, pageCount: document.numPages }
    } catch (error) {
        if (error instanceof KnowledgeProcessingError) throw error
        throw new KnowledgeProcessingError('PDF 无法提取正文，请检查文件是否损坏、加密或属于扫描件。')
    } finally {
        await task.destroy()
    }
}

/**
 * Extracts and chunks actual uploaded text without using a language model.
 * @param input - Immutable file bytes, supported format, and explicit character settings.
 * @returns Validated full results ready for one atomic database commit.
 * @throws KnowledgeProcessingError for invalid content or bounded parser failures.
 */
export async function parseKnowledgeDocument(input: KnowledgeProcessingInput): Promise<KnowledgeProcessingResult> {
    if (!input.file.byteLength || input.file.byteLength > KNOWLEDGE_MAX_FILE_SIZE)
        throw new KnowledgeProcessingError('文件大小须为 1 字节至 10 MiB。')
    knowledgeFormatSchema.parse(input.format)
    knowledgeChunkingSchema.parse({ chunkSize: input.chunkSize, overlap: input.overlap })
    let text: string
    let pages: { start: number; end: number; page: number }[] = []
    let pageCount: number | undefined
    if (input.format === 'pdf') {
        const extracted = await extractPdf(input.file)
        text = extracted.text
        pages = extracted.pages
        pageCount = extracted.pageCount
    } else if (input.format === 'docx') {
        validateKnowledgeDocx(input.file)
        try {
            const result = await mammoth.extractRawText({ buffer: Buffer.from(input.file) })
            text = normalizeKnowledgeText(result.value)
        } catch {
            throw new KnowledgeProcessingError('Word 文件无法提取正文，请检查文件是否损坏或已加密。')
        }
    } else {
        try {
            text = normalizeKnowledgeText(new TextDecoder('utf-8', { fatal: true }).decode(input.file))
        } catch {
            throw new KnowledgeProcessingError('文本不是有效的 UTF-8 编码，请转换为 UTF-8 后重新上传。')
        }
        const binaryControl = Array.from(text).some(char => {
            const code = char.charCodeAt(0)
            return (code > 0 && code < 9) || (code >= 14 && code <= 31)
        })
        const zipHeader = input.file[0] === 0x50 && input.file[1] === 0x4b && input.file[2] === 3 && input.file[3] === 4
        if (text.trimStart().startsWith('%PDF-') || zipHeader || binaryControl || Buffer.from(input.file).includes(0))
            throw new KnowledgeProcessingError('文件内容不是纯文本，请使用真实的文件格式上传。')
    }
    const chunks = splitKnowledgeText(text, { chunkSize: input.chunkSize, overlap: input.overlap }, pages)
    return knowledgeProcessingResultSchema.parse({ characterCount: Array.from(text).length, ...(pageCount ? { pageCount } : {}), chunks })
}
