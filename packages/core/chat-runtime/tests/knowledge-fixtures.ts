import { deflateRawSync } from 'node:zlib'

/**
 * Computes ZIP CRC32 for deterministic test documents without an office runtime.
 * @param value - Uncompressed XML bytes.
 * @returns The unsigned archive checksum.
 */
function crc32(value: Buffer): number {
    let crc = 0xffffffff
    for (const byte of value) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
}

/**
 * Builds a real minimal DOCX ZIP containing the exact supplied paragraphs.
 * @param paragraphs - Plain text paragraphs to put into document.xml.
 * @returns A complete compressed DOCX file with actual directory checksums.
 */
export function knowledgeDocx(paragraphs: string[]): Buffer {
    /**
     * Escapes fixture paragraphs as literal XML text.
     * @param text - Source paragraph content.
     * @returns XML-safe text without changing its decoded value.
     */
    const escape = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const entries = [
        [
            '[Content_Types].xml',
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ],
        [
            '_rels/.rels',
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ],
        [
            'word/document.xml',
            `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(text => `<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
        ],
    ]
    const locals: Buffer[] = []
    const directories: Buffer[] = []
    let offset = 0
    for (const [name, text] of entries) {
        const filename = Buffer.from(name!)
        const raw = Buffer.from(text!)
        const compressed = deflateRawSync(raw)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50)
        local.writeUInt16LE(20, 4)
        local.writeUInt16LE(8, 8)
        local.writeUInt32LE(crc32(raw), 14)
        local.writeUInt32LE(compressed.length, 18)
        local.writeUInt32LE(raw.length, 22)
        local.writeUInt16LE(filename.length, 26)
        locals.push(local, filename, compressed)
        const directory = Buffer.alloc(46)
        directory.writeUInt32LE(0x02014b50)
        directory.writeUInt16LE(20, 4)
        directory.writeUInt16LE(20, 6)
        directory.writeUInt16LE(8, 10)
        directory.writeUInt32LE(crc32(raw), 16)
        directory.writeUInt32LE(compressed.length, 20)
        directory.writeUInt32LE(raw.length, 24)
        directory.writeUInt16LE(filename.length, 28)
        directory.writeUInt32LE(offset, 42)
        directories.push(directory, filename)
        offset += local.length + filename.length + compressed.length
    }
    const directory = Buffer.concat(directories)
    const footer = Buffer.alloc(22)
    footer.writeUInt32LE(0x06054b50)
    footer.writeUInt16LE(entries.length, 8)
    footer.writeUInt16LE(entries.length, 10)
    footer.writeUInt32LE(directory.length, 12)
    footer.writeUInt32LE(offset, 16)
    return Buffer.concat([...locals, directory, footer])
}

/**
 * Builds an actual PDF with Unicode text mappings and independent page content streams.
 * @param pages - Text to expose on each page through a valid ToUnicode CMap.
 * @returns Complete PDF bytes suitable for real extraction tests.
 */
export function knowledgePdf(pages: string[]): Buffer {
    const objects: string[] = []
    const pageIds = pages.map((_, index) => 7 + index * 2)
    objects.push('<< /Type /Catalog /Pages 2 0 R >>')
    objects.push(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`)
    objects.push(
        '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>'
    )
    objects.push(
        '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 5 0 R >>'
    )
    objects.push(
        '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>'
    )
    const cmap =
        '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /IdentityUCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end'
    objects.push(`<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`)
    for (const [index, text] of pages.entries()) {
        objects.push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${8 + index * 2} 0 R >>`
        )
        const hex = Buffer.from(text, 'utf16le').swap16().toString('hex')
        const stream = `BT /F1 12 Tf 50 780 Td <${hex}> Tj ET`
        objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
    }
    let output = '%PDF-1.7\n'
    const offsets = [0]
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(output))
        output += `${index + 1} 0 obj\n${object}\nendobj\n`
    }
    const xref = Buffer.byteLength(output)
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(output)
}
