import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { KnowledgeChunk } from '@ai-harness/contracts'
import { createChatStore, type ChatScope, type ChatStore, type StoredKnowledgeDocument } from '@ai-harness/db'
import { expect, it } from 'vitest'
import { ProjectFolderService } from '../src/project-folder-service.js'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

/**
 * Produces a project source whose filename and chronological position are independently observable.
 * @param folderId - Exact private project, omitted for ungrouped personal material.
 * @param index - Stable fixture file number and increasing creation timestamp.
 * @returns Queued public metadata plus inert private source references.
 */
function source(folderId: string | undefined, index: number): StoredKnowledgeDocument {
    const id = randomUUID()
    const timestamp = new Date(Date.UTC(2026, 9, 22, 0, 0, index)).toISOString()
    return {
        document: {
            id,
            ...(folderId ? { projectFolderId: folderId } : {}),
            fileName: `资料-${index}.md`,
            format: 'md',
            size: 3600,
            status: 'queued',
            chunkSize: 200,
            overlap: 0,
            characterCount: 0,
            chunkCount: 0,
            attempt: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
        },
        objectKey: `private-isolated-pagination/${id}`,
        sha256: createHash('sha256').update(id).digest('hex'),
        fingerprint: createHash('sha256').update(`upload:${id}`).digest('hex'),
    }
}

/**
 * Commits one complete fixture source through the actual PostgreSQL processing lease.
 * @param store - Shared initialized real repository.
 * @param scope - Actual document owner and workspace.
 * @param record - Immutable queued source and project membership.
 * @param text - Exact source text used to construct independently checked Unicode chunk ranges.
 * @returns After ready metadata and complete chunks are atomically committed.
 */
async function ready(store: ChatStore, scope: ChatScope, record: StoredKnowledgeDocument, text: string): Promise<void> {
    await store.knowledge!.create(scope, record, async () => undefined)
    const lease = (await store.knowledge!.claim(120_000))!
    expect(lease.record.document.id).toBe(record.document.id)
    const points = Array.from(text)
    const chunks: KnowledgeChunk[] = []
    for (let start = 0; start < points.length; start += 200) {
        const end = Math.min(start + 200, points.length)
        chunks.push({
            id: randomUUID(),
            documentId: record.document.id,
            index: chunks.length + 1,
            content: points.slice(start, end).join(''),
            characterCount: end - start,
            charStart: start,
            charEnd: end,
        })
    }
    expect(await store.knowledge!.complete(lease, { characterCount: points.length, chunks })).toBe(true)
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'enumerates every project file and search page even when a newer long material fills the initial six chunks',
    async () => {
        const schema = `sf021_material_pages_${randomUUID().replaceAll('-', '')}`
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        await admin.query(`CREATE SCHEMA ${schema}`)
        let store: ChatStore | undefined
        try {
            store = await createChatStore({ databaseUrl: url.toString() })
            const scope = { userId: randomUUID(), workspaceId: 'sf021-material-pages-home' }
            const now = new Date().toISOString()
            await store.accounts!.createUser({
                user: { id: scope.userId, username: '资料分页用户', email: `${scope.userId}@example.test`, createdAt: now, updatedAt: now },
                passwordHash: 'isolated-test-verifier',
                workspaceId: scope.workspaceId,
                credentialVersion: 1,
            })
            const a = await store.projectFolders!.create(scope, { requestId: randomUUID(), name: 'A' })
            const b = await store.projectFolders!.create(scope, { requestId: randomUUID(), name: 'B' })
            const small: StoredKnowledgeDocument[] = []
            for (let index = 1; index <= 21; index++) {
                const record = source(a.id, index)
                await ready(store, scope, record, `共享检索词：第 ${index} 份项目资料。`)
                small.push(record)
            }
            const long = source(a.id, 22)
            await ready(store, scope, long, '共享检索词和长文正文'.padEnd(200, '甲').repeat(18))
            const foreign = source(b.id, 23)
            const ungrouped = source(undefined, 24)
            await ready(store, scope, foreign, '共享检索词：其他项目秘密。')
            await ready(store, scope, ungrouped, '共享检索词：未归项目的私人资料。')
            const failed = source(a.id, 25)
            await store.knowledge!.create(scope, failed, async () => undefined)
            const failedLease = (await store.knowledge!.claim(120_000))!
            expect(await store.knowledge!.fail(failedLease, '测试解析失败状态')).toBe(true)
            const pending = source(a.id, 26)
            await store.knowledge!.create(scope, pending, async () => undefined)
            const conversation = {
                id: randomUUID(),
                title: '项目资料分页',
                messages: [],
                projectFolderId: a.id,
                createdAt: now,
                updatedAt: now,
            }
            await store.create!(scope, conversation, { title: conversation.title, projectFolderId: a.id })
            const port = (await new ProjectFolderService(store).knowledgePort(scope, conversation.id))!
            const firstPage = (await port.list!(1)) as {
                total: number
                hasMore: boolean
                documents: { documentId: string; status: string; fileName: string }[]
            }
            const secondPage = (await port.list!(2)) as typeof firstPage
            expect(firstPage.total).toBe(24)
            expect(firstPage.documents).toHaveLength(20)
            expect(firstPage.hasMore).toBe(true)
            expect(secondPage.documents).toHaveLength(4)
            expect(secondPage.hasMore).toBe(false)
            const listed = [...firstPage.documents, ...secondPage.documents]
            expect(new Set(listed.map(item => item.documentId)).size).toBe(24)
            expect(listed.map(item => item.status)).toEqual(expect.arrayContaining(['queued', 'failed']))
            expect(listed.map(item => item.documentId)).not.toContain(foreign.document.id)
            expect(listed.map(item => item.documentId)).not.toContain(ungrouped.document.id)

            const found: { documentId: string; index: number; sourceUrl: string }[] = []
            let hasMore = true
            for (let page = 1; page <= 10 && hasMore; page++) {
                const result = (await port.search('共享检索词', page)) as {
                    hasMore: boolean
                    matches: { documentId: string; index: number; sourceUrl: string }[]
                }
                if (page === 1) {
                    expect(result.matches).toHaveLength(6)
                    expect(result.matches.every(item => item.documentId === long.document.id)).toBe(true)
                    expect(result.hasMore).toBe(true)
                }
                hasMore = result.hasMore
                found.push(...result.matches)
            }
            expect(hasMore).toBe(false)
            expect(found).toHaveLength(39)
            expect(new Set(found.map(item => `${item.documentId}:${item.index}`)).size).toBe(39)
            expect(new Set(found.map(item => item.documentId))).toEqual(new Set([...small.map(item => item.document.id), long.document.id]))
            expect(found.every(item => item.sourceUrl.includes(`projectFolderId=${a.id}`))).toBe(true)
            const tail = (await port.read(long.document.id, 5)) as { total: number; chunks: { index: number }[] }
            expect(tail.total).toBe(18)
            expect(tail.chunks.map(chunk => chunk.index)).toEqual([17, 18])
        } finally {
            await store?.close()
            await admin.query(`DROP SCHEMA ${schema} CASCADE`)
            await admin.end()
        }
    },
    30_000
)
