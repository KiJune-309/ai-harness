import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import {
    CollaborationAccessError,
    createChatStore,
    WorkspaceAccessError,
    WorkspaceConflictError,
    type ChatScope,
    type ChatStore,
} from '../src/index.js'

/**
 * Runs membership acceptance against isolated real PostgreSQL pools.
 * @param run - Assertions using stores and a schema-local administration pool.
 * @returns After all pools and the test-owned schema are released.
 */
async function database(run: (first: ChatStore, second: ChatStore, pool: pg.Pool) => Promise<void>): Promise<void> {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const schema = `sf015_db_${randomUUID().replaceAll('-', '')}`
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    let first: ChatStore | undefined
    let second: ChatStore | undefined
    try {
        first = await createChatStore({ databaseUrl: url.toString() })
        second = await createChatStore({ databaseUrl: url.toString() })
        await run(first, second, pool)
    } finally {
        await Promise.allSettled([first?.close(), second?.close(), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Persists a real account and a hash-only session in the historical deployment scope.
 * @param store - Real PostgreSQL repository.
 * @returns Stable identity, current email and private test session hash.
 */
async function account(store: ChatStore) {
    const userId = randomUUID()
    const now = new Date().toISOString()
    const scope: ChatScope = { userId, workspaceId: 'sf015-home' }
    const email = `${userId}@example.test`
    const sessionHash = randomUUID()
    await store.accounts!.createUser({
        user: { id: userId, username: `Member ${userId.slice(0, 8)}`, email, createdAt: now, updatedAt: now },
        passwordHash: 'isolated-non-login-test-verifier',
        workspaceId: scope.workspaceId,
        credentialVersion: 1,
    })
    await store.accounts!.saveSession({
        userId,
        tokenHash: sessionHash,
        credentialVersion: 1,
        createdAt: now,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
    })
    return { scope, email, sessionHash }
}

/**
 * Persists an immutable queued source in a specific scope without parsing or cloud access.
 * @param store - Real PostgreSQL metadata store.
 * @param scope - Owner and workspace under test.
 * @returns The queued document identifier.
 */
async function queuedDocument(store: ChatStore, scope: ChatScope): Promise<string> {
    const id = randomUUID()
    const now = new Date().toISOString()
    await store.knowledge!.create(
        scope,
        {
            document: {
                id,
                fileName: '授权分片.txt',
                format: 'txt',
                size: 3,
                status: 'queued',
                chunkSize: 200,
                overlap: 0,
                characterCount: 0,
                chunkCount: 0,
                attempt: 0,
                createdAt: now,
                updatedAt: now,
            },
            objectKey: `isolated/${id}`,
            sha256: 'a'.repeat(64),
            fingerprint: 'b'.repeat(64),
        },
        async () => {}
    )
    return id
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent real PostgreSQL workspace acceptance', () => {
    it('serializes creation, terminal invitation races, role changes, expiry and private-content recovery', async () => {
        await database(async (first, second, pool) => {
            const owner = await account(first)
            const member = await account(first)
            const outsider = await account(first)
            const input = { requestId: randomUUID(), name: '产品研发', description: '工作空间验收' }
            const created = await Promise.all([first.workspaces!.create(owner.scope, input), second.workspaces!.create(owner.scope, input)])
            expect(created[0]).toEqual(created[1])
            const team = created[0]!
            const ownerScope = { ...owner.scope, workspaceId: team.id }
            const memberScope = { ...member.scope, workspaceId: team.id }
            expect((await first.workspaces!.detail(owner.scope, team.id)).members).toMatchObject([
                { userId: owner.scope.userId, role: 'owner' },
            ])
            await expect(second.workspaces!.create(owner.scope, { ...input, name: '其他内容' })).rejects.toBeInstanceOf(
                WorkspaceConflictError
            )
            await expect(first.workspaces!.detail(outsider.scope, team.id)).rejects.toBeInstanceOf(WorkspaceAccessError)
            await expect(first.workspaces!.select(member.scope, member.sessionHash, team.id)).rejects.toBeInstanceOf(WorkspaceAccessError)
            const invitation = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            expect(invitation.status).toBe('pending')
            expect(invitation.workspaceDescription).toBe(input.description)
            expect(new Date(invitation.expiresAt).getTime() - new Date(invitation.createdAt).getTime()).toBe(7 * 86400000)
            await expect(first.workspaces!.respond(outsider.scope, invitation.id, true)).rejects.toBeInstanceOf(WorkspaceAccessError)
            await expect(
                first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            ).rejects.toBeInstanceOf(WorkspaceConflictError)
            await Promise.all([
                first.workspaces!.respond(member.scope, invitation.id, true),
                second.workspaces!.respond(member.scope, invitation.id, true),
            ])
            expect((await first.workspaces!.detail(memberScope, team.id)).members).toHaveLength(2)
            expect((await first.workspaces!.detail(memberScope, team.id)).invitations).toEqual([])
            expect(await first.workspaces!.current(member.scope, member.sessionHash)).toBe(member.scope.workspaceId)
            await first.workspaces!.select(member.scope, member.sessionHash, team.id)
            expect(await second.workspaces!.current(member.scope, member.sessionHash)).toBe(team.id)
            expect((await first.collaboration!.people(ownerScope, 'Member')).map(person => person.id)).toEqual([member.scope.userId])
            await expect(first.workspaces!.update(memberScope, team.id, { name: '越权', description: '' })).rejects.toBeInstanceOf(
                WorkspaceAccessError
            )
            await expect(first.workspaces!.remove(ownerScope, team.id, owner.scope.userId)).rejects.toBeInstanceOf(WorkspaceConflictError)
            const now = new Date().toISOString()
            const conversation = { id: randomUUID(), title: '成员私有历史', messages: [], createdAt: now, updatedAt: now }
            await first.save(memberScope, conversation)
            expect(await second.get(ownerScope, conversation.id)).toBeUndefined()
            await first.workspaces!.remove(ownerScope, team.id, member.scope.userId)
            expect(await second.workspaces!.access(memberScope)).toBe(false)
            expect(await second.workspaces!.current(member.scope, member.sessionHash)).toBe(member.scope.workspaceId)
            expect(await second.collaboration!.people(ownerScope, 'Member')).toEqual([])
            const rejoin = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await second.workspaces!.respond(member.scope, rejoin.id, true)
            expect(await second.workspaces!.current(member.scope, member.sessionHash)).toBe(member.scope.workspaceId)
            expect(await second.get(memberScope, conversation.id)).toEqual(conversation)
            await second.workspaces!.remove(memberScope, team.id, member.scope.userId)
            const contested = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            const raced = await Promise.allSettled([
                first.workspaces!.respond(member.scope, contested.id, true),
                second.workspaces!.revoke(ownerScope, team.id, contested.id),
            ])
            expect(raced.filter(result => result.status === 'fulfilled')).toHaveLength(1)
            const terminal = await pool.query<{ status: string }>('SELECT status FROM harness_workspace_invitations WHERE id=$1', [
                contested.id,
            ])
            expect(['accepted', 'revoked']).toContain(terminal.rows[0]!.status)
            expect(await first.workspaces!.access(memberScope)).toBe(terminal.rows[0]!.status === 'accepted')
            if (await first.workspaces!.access(memberScope)) await first.workspaces!.remove(ownerScope, team.id, member.scope.userId)
            const expired = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await pool.query("UPDATE harness_workspace_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [
                expired.id,
            ])
            await expect(second.workspaces!.respond(member.scope, expired.id, true)).rejects.toBeInstanceOf(WorkspaceConflictError)
            await expect(first.workspaces!.revoke(ownerScope, team.id, expired.id)).rejects.toBeInstanceOf(WorkspaceConflictError)
            const declined = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await second.workspaces!.respond(member.scope, declined.id, false)
            await expect(first.workspaces!.respond(member.scope, declined.id, true)).rejects.toBeInstanceOf(WorkspaceConflictError)
            expect(await first.workspaces!.access(memberScope)).toBe(false)
        })
    }, 30000)

    it('binds invitations to the original account when email changes and another account claims the address', async () => {
        await database(async (first, second) => {
            const owner = await account(first)
            const recipient = await account(first)
            const replacement = await account(first)
            const team = await first.workspaces!.create(owner.scope, { requestId: randomUUID(), name: '稳定身份', description: '' })
            const invitation = await first.workspaces!.invite(owner.scope, team.id, { requestId: randomUUID(), email: recipient.email })
            const now = new Date().toISOString()
            const changedEmail = `${randomUUID()}@example.test`
            await first.accounts!.updateCredentials(recipient.scope.userId, 'isolated-non-login-test-verifier', {
                email: changedEmail,
                now,
            })
            await expect(
                first.workspaces!.invite(owner.scope, team.id, { requestId: randomUUID(), email: changedEmail })
            ).rejects.toBeInstanceOf(WorkspaceConflictError)
            await first.accounts!.updateCredentials(replacement.scope.userId, 'isolated-non-login-test-verifier', {
                email: recipient.email,
                now,
            })
            expect((await second.workspaces!.directory(recipient.scope, recipient.sessionHash)).invitations.map(item => item.id)).toEqual([
                invitation.id,
            ])
            expect((await second.workspaces!.directory(replacement.scope, replacement.sessionHash)).invitations).toEqual([])
            await expect(second.workspaces!.respond(replacement.scope, invitation.id, true)).rejects.toBeInstanceOf(WorkspaceAccessError)
            await second.workspaces!.respond(recipient.scope, invitation.id, true)
            expect(await first.workspaces!.access({ ...recipient.scope, workspaceId: team.id })).toBe(true)
            expect(await first.workspaces!.access({ ...replacement.scope, workspaceId: team.id })).toBe(false)
        })
    }, 30000)

    it('cancels revoked jobs and incoming drafts permanently and permits only explicit human delivery to current teammates', async () => {
        await database(async (first, second, pool) => {
            const owner = await account(first)
            const member = await account(first)
            const outsider = await account(first)
            const team = await first.workspaces!.create(owner.scope, { requestId: randomUUID(), name: '执行权限', description: '' })
            const ownerScope = { ...owner.scope, workspaceId: team.id }
            const memberScope = { ...member.scope, workspaceId: team.id }
            const invitation = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await first.workspaces!.respond(member.scope, invitation.id, true)
            const now = new Date().toISOString()
            const agent = {
                id: randomUUID(),
                name: 'Private fixture',
                description: '',
                modelId: 'system-fixture',
                systemPrompt: 'Private prompt',
                toolIds: [],
                openingMessages: [],
                createdAt: now,
                updatedAt: now,
            }
            const ownerChat = { id: randomUUID(), title: 'Owner private', agent, messages: [], createdAt: now, updatedAt: now }
            const memberChat = {
                id: randomUUID(),
                title: 'Member private',
                agent: { ...agent, id: randomUUID() },
                messages: [],
                createdAt: now,
                updatedAt: now,
            }
            await first.save(ownerScope, ownerChat)
            await first.save(memberScope, memberChat)
            const source = { kind: 'conversation' as const, id: ownerChat.id }
            const memberSource = { kind: 'conversation' as const, id: memberChat.id }
            const command = {
                type: 'message' as const,
                requestId: randomUUID(),
                source,
                recipientId: member.scope.userId,
                content: 'Explicitly reviewed whole message.',
            }
            const delivered = await first.collaboration!.mutate(ownerScope, command, {
                recipientConversation: { ...memberChat, id: randomUUID(), title: '真实同事转达' },
            })
            expect(delivered.conversationId).toBeDefined()
            const receiver = await first.get(memberScope, delivered.conversationId!)
            expect(receiver?.messages).toMatchObject([
                { role: 'assistant', kind: 'opening', content: expect.stringContaining(command.content) },
            ])
            expect(await second.get(ownerScope, delivered.conversationId!)).toBeUndefined()
            await expect(
                second.collaboration!.mutate(ownerScope, { ...command, requestId: randomUUID(), recipientId: outsider.scope.userId })
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            const input = {
                requestId: randomUUID(),
                source,
                content: '@Member 请联系同事。',
                mentions: [{ userId: member.scope.userId, name: 'Member', start: 0, end: 7 }],
            }
            await first.collaboration!.enqueue(ownerScope, input)
            const ownerJob = (await first.collaboration!.claim(30000))!
            const proposed = await first.collaboration!.propose(
                ownerScope,
                { ...command, requestId: randomUUID() },
                { authorKind: 'agent', lease: ownerJob }
            )
            expect(proposed.draftId).toBeDefined()
            await expect(
                first.collaboration!.mutate(
                    ownerScope,
                    { type: 'confirm-dispatch', requestId: randomUUID(), draftId: proposed.draftId!, version: proposed.draftVersion! },
                    { authorKind: 'agent', lease: ownerJob }
                )
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            expect(await first.collaboration!.settle(ownerJob, { status: 'complete' })).toBe(true)
            const memberInput = { requestId: randomUUID(), source: memberSource, content: '本人的未执行旧请求' }
            const queued = await first.collaboration!.enqueue(memberScope, memberInput)
            const memberJob = (await second.collaboration!.claim(30000))!
            expect(memberJob.id).toBe(queued.jobId)
            await first.workspaces!.remove(ownerScope, team.id, member.scope.userId)
            expect(await second.collaboration!.heartbeat(memberJob, 30000)).toBe(false)
            await expect(second.collaboration!.assertLease(memberJob)).rejects.toBeInstanceOf(CollaborationAccessError)
            expect(await second.collaboration!.settle(memberJob, { status: 'complete' })).toBe(false)
            await expect(
                second.collaboration!.mutate(ownerScope, {
                    type: 'confirm-dispatch',
                    requestId: randomUUID(),
                    draftId: proposed.draftId!,
                    version: proposed.draftVersion!,
                })
            ).rejects.toThrow()
            const statuses = await pool.query<{ status: string }>('SELECT status FROM harness_collaboration_jobs WHERE id=$1', [
                queued.jobId,
            ])
            expect(statuses.rows[0]!.status).toBe('cancelled')
            const rejoin = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await second.workspaces!.respond(member.scope, rejoin.id, true)
            expect(await second.collaboration!.enqueue(memberScope, memberInput)).toEqual(queued)
            expect(await second.collaboration!.claim(30000)).toBeUndefined()
            await expect(
                second.collaboration!.mutate(ownerScope, {
                    type: 'confirm-dispatch',
                    requestId: randomUUID(),
                    draftId: proposed.draftId!,
                    version: proposed.draftVersion!,
                })
            ).rejects.toThrow()
            expect((await second.get(memberScope, delivered.conversationId!))?.messages).toMatchObject([
                { content: expect.stringContaining(command.content) },
            ])
        })
    }, 30000)

    it('fences knowledge and vector worker leases on member removal and cannot claim nonmember uploads', async () => {
        await database(async (first, second) => {
            const owner = await account(first)
            const member = await account(first)
            const outsider = await account(first)
            const team = await first.workspaces!.create(owner.scope, { requestId: randomUUID(), name: '知识处理权限', description: '' })
            const ownerScope = { ...owner.scope, workspaceId: team.id }
            const memberScope = { ...member.scope, workspaceId: team.id }
            const invitation = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await first.workspaces!.respond(member.scope, invitation.id, true)
            const id = await queuedDocument(first, memberScope)
            await queuedDocument(first, { ...outsider.scope, workspaceId: team.id })
            const parseLease = (await first.knowledge!.claim(30000))!
            expect(parseLease.record.document.id).toBe(id)
            expect(await second.knowledge!.claim(30000)).toBeUndefined()
            await first.workspaces!.remove(ownerScope, team.id, member.scope.userId)
            const chunk = { id: randomUUID(), documentId: id, index: 1, content: '授权分片', characterCount: 4, charStart: 0, charEnd: 4 }
            expect(await second.knowledge!.heartbeat(parseLease, 30000)).toBe(false)
            expect(await second.knowledge!.complete(parseLease, { characterCount: 4, chunks: [chunk] })).toBe(false)
            const rejoin = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await second.workspaces!.respond(member.scope, rejoin.id, true)
            const readyId = await queuedDocument(first, memberScope)
            const readyLease = (await first.knowledge!.claim(30000))!
            expect(readyLease.record.document.id).toBe(readyId)
            const readyChunk = { ...chunk, id: randomUUID(), documentId: readyId }
            expect(await first.knowledge!.complete(readyLease, { characterCount: 4, chunks: [readyChunk] })).toBe(true)
            expect(first.embeddings!.vectorAvailable).toBe(true)
            const now = new Date().toISOString()
            const modelId = randomUUID()
            await first.embeddings!.createModel(
                memberScope,
                {
                    model: {
                        id: modelId,
                        name: '独立向量模型',
                        baseUrl: 'https://fixture.invalid/v1',
                        model: 'embedding-fixture',
                        hasApiKey: true,
                        isDefault: false,
                        revision: 1,
                        createdAt: now,
                        updatedAt: now,
                    },
                    encryptedApiKey: 'isolated-test-ciphertext',
                },
                'c'.repeat(64)
            )
            const verified = await first.embeddings!.verifyModel(memberScope, modelId, 1, 2, 'provider-fixture')
            await first.embeddings!.startIndex(memberScope, readyId, { requestId: randomUUID(), modelId, revision: verified.revision })
            const vectorLease = (await second.embeddings!.claim(30000))!
            expect(vectorLease.scope).toEqual(memberScope)
            const pending = await second.embeddings!.pendingChunks(vectorLease)
            expect(pending).toHaveLength(1)
            await first.workspaces!.remove(ownerScope, team.id, member.scope.userId)
            expect(await second.embeddings!.heartbeat(vectorLease, 30000)).toBe(false)
            expect(await second.embeddings!.saveBatch(vectorLease, pending, [[1, 0]])).toBeUndefined()
            expect(await second.embeddings!.claim(30000)).toBeUndefined()
            expect(await second.knowledge!.claim(30000)).toBeUndefined()
        })
    }, 30000)
})
