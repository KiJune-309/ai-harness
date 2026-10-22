import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { AccountConflictError, createChatStore, type StoredAccount, type StoredAccountModel } from '../src/index.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const now = '2026-10-17T00:00:00.000Z'
/**
 * Creates an isolated persisted account fixture.
 * @param email - Unique test email.
 * @returns Private account record.
 */
function user(email: string): StoredAccount {
    return {
        user: { id: randomUUID(), username: 'Persisted owner', email, createdAt: now, updatedAt: now },
        passwordHash: 'private-scrypt-verifier-fixture',
        credentialVersion: 1,
        workspaceId: 'account-pg-tests',
    }
}
/**
 * Creates an encrypted configuration fixture without retaining plaintext keys.
 * @returns Private model record.
 */
function model(): StoredAccountModel {
    const id = randomUUID()
    return {
        model: {
            id,
            modelId: `account:${id}`,
            name: 'Persisted model',
            baseUrl: 'https://example.com/v1',
            model: 'model-a',
            hasApiKey: true,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
        },
        encryptedApiKey: 'v1.nonce.tag.ciphertext',
        creationFingerprint: 'original-hmac',
    }
}

describe.skipIf(!databaseUrl)('real PostgreSQL account transactions', () => {
    it('allows only one account to claim the same new email during concurrent credential updates', async () => {
        const store = await createChatStore({ databaseUrl })
        const cleanup = new pg.Pool({ connectionString: databaseUrl })
        const first = user(`${randomUUID()}@example.com`),
            second = user(`${randomUUID()}@example.com`),
            contestedEmail = `${randomUUID()}@example.com`
        try {
            await store.accounts!.createUser(first)
            await store.accounts!.createUser(second)
            const sessions = [first, second].map(owner => ({
                tokenHash: randomUUID(),
                userId: owner.user.id,
                credentialVersion: 1,
                createdAt: now,
                expiresAt: '2099-10-24T00:00:00.000Z',
            }))
            for (const session of sessions) await store.accounts!.saveSession(session)
            const results = await Promise.allSettled(
                [first, second].map(owner =>
                    store.accounts!.updateCredentials(owner.user.id, owner.passwordHash, { email: contestedEmail, now })
                )
            )
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
            expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.any(AccountConflictError) })
            const winner = await store.accounts!.getByEmail(contestedEmail)
            expect(winner).toBeDefined()
            for (const [index, owner] of [first, second].entries()) {
                const account = await store.accounts!.getById(owner.user.id)
                const session = await store.accounts!.getSession(sessions[index]!.tokenHash, now)
                if (owner.user.id === winner!.user.id) {
                    expect(account!.credentialVersion).toBe(2)
                    expect(session).toBeUndefined()
                } else {
                    expect(account!.user.email).toBe(owner.user.email)
                    expect(account!.credentialVersion).toBe(1)
                    expect(session).toEqual(owner)
                }
            }
        } finally {
            await store.close()
            await cleanup.query('DELETE FROM harness_accounts WHERE id=ANY($1::uuid[])', [[first.user.id, second.user.id]])
            await cleanup.end()
        }
    })
    it('initializes an entirely empty schema from four independent connection pools concurrently', async () => {
        const admin = new pg.Pool({ connectionString: databaseUrl })
        const schema = `sf005_${randomUUID().replaceAll('-', '')}`
        const isolatedUrl = new URL(databaseUrl!)
        isolatedUrl.searchParams.set('options', `-c search_path=${schema}`)
        const opened: Awaited<ReturnType<typeof createChatStore>>[] = []
        try {
            // The generated identifier contains only a fixed prefix and random hexadecimal characters.
            await admin.query(`CREATE SCHEMA ${schema}`)
            const results = await Promise.allSettled(
                Array.from({ length: 4 }, () => createChatStore({ databaseUrl: isolatedUrl.toString() }))
            )
            for (const result of results) if (result.status === 'fulfilled') opened.push(result.value)
            expect(results.every(result => result.status === 'fulfilled')).toBe(true)
            const tables = await admin.query<{ tablename: string }>('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])
            expect(tables.rows.map(row => row.tablename).sort()).toEqual(
                [
                    'harness_account_models',
                    'harness_account_rate_limits',
                    'harness_account_sessions',
                    'harness_accounts',
                    'harness_agent_definitions',
                    'harness_skills',
                    'harness_skill_versions',
                    'harness_skill_actions',
                    'harness_chat_conversations',
                    'harness_collaboration_contact_intents',
                    'harness_collaboration_dispatches',
                    'harness_collaboration_job_intents',
                    'harness_collaboration_jobs',
                    'harness_collaboration_rate_limits',
                    'harness_collaboration_sources',
                    'harness_collaboration_state',
                    'harness_collaboration_thread_sources',
                    'harness_knowledge_chunks',
                    'harness_knowledge_documents',
                    'harness_knowledge_retry_actions',
                    'harness_embedding_models',
                    'harness_embedding_create_actions',
                    'harness_vector_jobs',
                    'harness_vector_actions',
                    ...(opened[0]!.embeddings!.vectorAvailable ? ['harness_knowledge_vectors'] : []),
                    'harness_personal_projects',
                    'harness_project_templates',
                    'harness_template_launches',
                    'harness_workspaces',
                    'harness_workspace_members',
                    'harness_workflow_previews',
                    'harness_workflow_launches',
                    'harness_workflow_contact_intents',
                    'harness_workspace_invitations',
                    'harness_workspace_sessions',
                ].sort()
            )
            const owner = user(`${randomUUID()}@example.com`)
            await opened[0]!.accounts!.createUser(owner)
            expect(await opened[3]!.accounts!.getById(owner.user.id)).toEqual(owner)
        } finally {
            await Promise.all(opened.map(store => store.close()))
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    })
    it('serializes unique-email races, defaults and credential revocation across shared-pool restart', async () => {
        const store = await createChatStore({ databaseUrl })
        const email = `${randomUUID()}@example.com`
        const owner = user(email),
            duplicate = user(email),
            other = user(`${randomUUID()}@example.com`)
        const cleanup = new pg.Pool({ connectionString: databaseUrl })
        let restarted: Awaited<ReturnType<typeof createChatStore>> | undefined
        let originalClosed = false
        try {
            const creates = await Promise.allSettled([store.accounts!.createUser(owner), store.accounts!.createUser(duplicate)])
            expect(creates.filter(result => result.status === 'fulfilled')).toHaveLength(1)
            expect(creates.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.any(AccountConflictError) })
            const actual = await store.accounts!.getByEmail(email)
            await store.accounts!.createUser(other)
            const scope = { userId: actual!.user.id, workspaceId: actual!.workspaceId }
            const first = model(),
                second = model()
            await Promise.all([store.accounts!.saveModel(scope, first, true), store.accounts!.saveModel(scope, second, true)])
            expect((await store.accounts!.listModels(scope)).filter(record => record.model.isDefault)).toHaveLength(1)
            await Promise.all([
                store.accounts!.setDefaultModel(scope, first.model.id, now),
                store.accounts!.setDefaultModel(scope, second.model.id, now),
            ])
            expect((await store.accounts!.listModels(scope)).filter(record => record.model.isDefault)).toHaveLength(1)
            const session = {
                tokenHash: randomUUID(),
                userId: actual!.user.id,
                credentialVersion: 1,
                createdAt: now,
                expiresAt: '2099-10-24T00:00:00.000Z',
            }
            await store.accounts!.saveSession(session)
            await expect(
                store.accounts!.updateCredentials(scope.userId, actual!.passwordHash, { email: other.user.email, now })
            ).rejects.toBeInstanceOf(AccountConflictError)
            expect(await store.accounts!.getSession(session.tokenHash, now)).toEqual(actual)
            await store.close()
            originalClosed = true
            restarted = await createChatStore({ databaseUrl })
            expect(await restarted.accounts!.getSession(session.tokenHash, now)).toEqual(actual)
            expect(await restarted.accounts!.getModel(scope, first.model.id)).toMatchObject({ encryptedApiKey: first.encryptedApiKey })
            expect(await restarted.accounts!.getModel({ ...scope, userId: other.user.id }, first.model.id)).toBeUndefined()
            await restarted.accounts!.updateCredentials(scope.userId, actual!.passwordHash, { passwordHash: 'replacement-verifier', now })
            expect(await restarted.accounts!.getSession(session.tokenHash, now)).toBeUndefined()
            expect(await restarted.accounts!.saveSession(session)).toBe(false)
            await restarted.accounts!.setDefaultModel(scope, second.model.id, now)
            await restarted.accounts!.deleteModel(scope, second.model.id)
            expect((await restarted.accounts!.listModels(scope)).every(record => !record.model.isDefault)).toBe(true)
        } finally {
            if (!originalClosed) await store.close()
            await restarted?.close()
            await cleanup.query('DELETE FROM harness_accounts WHERE id=ANY($1::uuid[])', [
                [owner.user.id, duplicate.user.id, other.user.id],
            ])
            await cleanup.end()
        }
    })
})
