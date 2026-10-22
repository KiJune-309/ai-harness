import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import type { KnowledgeChunk } from '@ai-harness/contracts'
import { createChatStore, type ChatScope, type ChatStore, type StoredKnowledgeDocument } from '../src/index.js'
import { createPostgresProjectFolderStore, ProjectFolderAccessError, ProjectFolderConflictError } from '../src/project-folders.js'

/**
 * Runs folder and knowledge assertions in an isolated schema using two actual application pools.
 * @param scenario - Assertions against initialized durable stores and the isolated schema pool.
 * @returns After the test-owned schema and connections have been removed.
 * @throws Error for unavailable PostgreSQL or failed assertions.
 */
async function database(scenario: (first: ChatStore, second: ChatStore, pool: pg.Pool) => Promise<void>): Promise<void> {
    const schema = `sf021_folders_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    let first: ChatStore | undefined
    let second: ChatStore | undefined
    try {
        first = await createChatStore({ databaseUrl: url.toString() })
        second = await createChatStore({ databaseUrl: url.toString() })
        await scenario(first, second, pool)
    } finally {
        await Promise.allSettled([first?.close(), second?.close(), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Creates an actual persisted account authorized for its historical private workspace.
 * @param store - Initialized account repository sharing the test schema.
 * @param workspaceId - Historical private workspace used by this account.
 * @returns Its server-owned identity context.
 */
async function account(store: ChatStore, workspaceId = 'sf021-private'): Promise<ChatScope> {
    const id = randomUUID()
    const now = new Date().toISOString()
    await store.accounts!.createUser({
        user: { id, username: '项目用户', email: `${id}@example.test`, createdAt: now, updatedAt: now },
        passwordHash: 'isolated-test-verifier',
        workspaceId,
        credentialVersion: 1,
    })
    return { userId: id, workspaceId }
}

/**
 * Builds one immutable queued source with optional private project membership.
 * @param projectFolderId - Exact folder identity, omitted for ordinary personal library content.
 * @returns Valid original metadata and private source references for an isolated upload.
 */
function original(projectFolderId?: string): StoredKnowledgeDocument {
    const id = randomUUID()
    const now = new Date().toISOString()
    return {
        document: {
            id,
            ...(projectFolderId ? { projectFolderId } : {}),
            fileName: '同名资料.md',
            format: 'md',
            size: 5000,
            status: 'queued',
            chunkSize: 200,
            overlap: 0,
            characterCount: 0,
            chunkCount: 0,
            attempt: 0,
            createdAt: now,
            updatedAt: now,
        },
        objectKey: `private-test/${id}`,
        sha256: createHash('sha256').update(`source:${id}`).digest('hex'),
        fingerprint: createHash('sha256').update(`upload:${id}`).digest('hex'),
    }
}

/**
 * Commits a complete long source through the actual durable lease and chunk operations.
 * @param store - Shared application knowledge repository.
 * @param scope - Actual source owner and workspace.
 * @param record - Queued source and exact optional project membership.
 * @param text - Complete source text used to independently build bounded chunks.
 * @returns After the whole ready generation has committed.
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

describe.skipIf(!process.env.TEST_DATABASE_URL)('private project folder PostgreSQL acceptance', () => {
    it('replays one normalized creation across pools and isolates identical names and identities by owner and workspace', async () => {
        await database(async (first, second, pool) => {
            const scope = await account(first)
            const other = await account(first)
            const input = { requestId: randomUUID(), name: ' 网站改版 ' }
            const folders = createPostgresProjectFolderStore(pool)
            const created = await Promise.all([
                folders.create(scope, input),
                second.projectFolders!.create(scope, { ...input, requestId: input.requestId.toUpperCase() }),
            ])
            expect(created[0]).toEqual(created[1])
            expect(created[0]).toMatchObject({ id: input.requestId, name: '网站改版' })
            await expect(folders.create(scope, { ...input, name: '客户方案' })).rejects.toBeInstanceOf(ProjectFolderConflictError)
            expect(await folders.get(other, input.requestId)).toBeUndefined()
            expect(await folders.list(other)).toEqual([])
            await folders.create(other, { ...input, name: '网站改版' })
            expect(await folders.list(scope)).toEqual([created[0]])
            expect((await folders.list(other))[0]?.id).toBe(input.requestId)
            await expect(folders.list({ ...scope, workspaceId: 'foreign-workspace' })).rejects.toBeInstanceOf(ProjectFolderAccessError)
            await pool.query('UPDATE harness_project_folders SET name=$4 WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                scope.workspaceId,
                scope.userId,
                input.requestId,
                '持久化后的当前名称',
            ])
            expect((await second.projectFolders!.create(scope, input)).name).toBe('持久化后的当前名称')
        })
    })

    it('refuses a folder read after persisted team membership is removed', async () => {
        await database(async (first, _second, pool) => {
            const owner = await account(first)
            const member = await account(first)
            const workspace = await first.workspaces!.create(owner, { requestId: randomUUID(), name: '团队', description: '' })
            await pool.query('INSERT INTO harness_workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [
                workspace.id,
                member.userId,
                'member',
            ])
            const scope = { ...member, workspaceId: workspace.id }
            const folder = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: '本人的项目' })
            const source = original(folder.id)
            await ready(first, scope, source, '撤权前可读的资料'.repeat(40))
            expect((await first.projectFolders!.get(scope, folder.id))?.id).toBe(folder.id)
            expect((await first.knowledge!.searchProjectChunks(scope, folder.id, { query: '' })).length).toBeGreaterThan(0)
            await pool.query('DELETE FROM harness_workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspace.id, member.userId])
            await expect(first.projectFolders!.get(scope, folder.id)).rejects.toBeInstanceOf(ProjectFolderAccessError)
            expect(await first.knowledge!.get(scope, source.document.id, folder.id)).toBeUndefined()
            expect(await first.knowledge!.chunks(scope, source.document.id, 1, 20, folder.id)).toBeUndefined()
            expect(await first.knowledge!.searchProjectChunks(scope, folder.id, { query: '' })).toEqual([])
            expect((await first.knowledge!.list(scope, { page: 1, pageSize: 20, query: '', projectFolderId: folder.id })).total).toBe(0)
            await expect(
                first.knowledge!.create(scope, original(folder.id), async () => {
                    throw new Error('Should not write a revoked source.')
                })
            ).rejects.toThrow('未找到此项目')
        })
    })

    it('filters lists, exact reads and bounded ready chunk retrieval by the complete private project tuple', async () => {
        await database(async (first, second) => {
            const scope = await account(first)
            const other = await account(first)
            const a = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: '同名项目' })
            const b = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: '同名项目' })
            const foreign = await first.projectFolders!.create(other, { requestId: a.id, name: '同名项目' })
            const aSource = original(a.id)
            const bSource = original(b.id)
            const foreignSource = original(foreign.id)
            const personalSource = original()
            await ready(first, scope, aSource, 'A预算%_😀'.repeat(900))
            await ready(first, scope, bSource, 'B机密'.repeat(80))
            await ready(first, other, foreignSource, '他人机密'.repeat(80))
            await ready(first, scope, personalSource, '未归项目的机密'.repeat(80))
            const pending = original(a.id)
            await first.knowledge!.create(scope, pending, async () => undefined)

            const list = await second.knowledge!.list(scope, { page: 1, pageSize: 20, query: '', projectFolderId: a.id })
            expect(list.total).toBe(2)
            expect(new Set(list.documents.map(item => item.id))).toEqual(new Set([aSource.document.id, pending.document.id]))
            expect(await second.knowledge!.get(scope, bSource.document.id, a.id)).toBeUndefined()
            expect(await second.knowledge!.chunks(scope, bSource.document.id, 1, 20, a.id)).toBeUndefined()
            expect((await second.knowledge!.chunks(scope, aSource.document.id, 1, 20, a.id))?.chunks.length).toBe(20)
            const matches = await second.knowledge!.searchProjectChunks(scope, a.id, { query: '%_', limit: 20 })
            expect(matches).toHaveLength(20)
            expect(matches.every(item => item.documentId === aSource.document.id && item.fileName === '同名资料.md')).toBe(true)
            const later = await second.knowledge!.searchProjectChunks(scope, a.id, {
                query: '',
                documentId: aSource.document.id,
                offset: 20,
                limit: 20,
            })
            expect(later[0]?.chunk.index).toBe(21)
            expect(later.length).toBeGreaterThan(0)
            expect(await second.knowledge!.searchProjectChunks(scope, a.id, { query: '机密' })).toEqual([])
            expect(await second.knowledge!.searchProjectChunks(scope, a.id, { query: '', documentId: bSource.document.id })).toEqual([])
            expect(await second.knowledge!.searchProjectChunks({ ...scope, workspaceId: 'foreign' }, a.id, { query: '' })).toEqual([])
            expect((await second.knowledge!.searchProjectChunks(other, foreign.id, { query: '' }))[0]?.documentId).toBe(
                foreignSource.document.id
            )
            expect((await second.knowledge!.get(scope, personalSource.document.id))?.document.projectFolderId).toBeUndefined()
        })
    })

    it('checks folder ownership before object persistence and prevents cross-project replay even with an unchanged fingerprint', async () => {
        await database(async first => {
            const scope = await account(first)
            const other = await account(first)
            const a = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: 'A' })
            const b = await first.projectFolders!.create(scope, { requestId: randomUUID(), name: 'B' })
            const foreign = await first.projectFolders!.create(other, { requestId: randomUUID(), name: '他人项目' })
            let writes = 0
            const source = original(a.id)
            await first.knowledge!.create(scope, source, async () => {
                writes += 1
            })
            await first.knowledge!.create(scope, source, async () => {
                writes += 1
            })
            expect(writes).toBe(1)
            await expect(
                first.knowledge!.create(scope, { ...source, document: { ...source.document, projectFolderId: b.id } }, async () => {
                    writes += 1
                })
            ).rejects.toThrow()
            await expect(
                first.knowledge!.create(scope, original(foreign.id), async () => {
                    writes += 1
                })
            ).rejects.toThrow('未找到此项目')
            expect(writes).toBe(1)
            expect((await first.knowledge!.list(scope, { page: 1, pageSize: 20, query: '' })).total).toBe(1)
            for (const input of [{ query: '', limit: 21 }, { query: '', offset: 5000 }, { query: 'x'.repeat(181) }])
                await expect(first.knowledge!.searchProjectChunks(scope, a.id, input)).rejects.toThrow('Invalid project knowledge query')
        })
    })
})
