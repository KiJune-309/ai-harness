import { randomUUID } from 'node:crypto'
import { createMemoryChatStore, type EmbeddingStore, type StoredEmbeddingModel } from '@ai-harness/db'
import { describe, expect, it, vi } from 'vitest'
import { AccountService } from '../src/account-service.js'
import { EmbeddingService, type EmbeddingGenerator } from '../src/embedding-service.js'
import { readTestApiConfig } from './config-fixture.js'

/**
 * Creates explicit isolated credential fixtures without enabling a production memory mode.
 * @returns Real account cryptography plus an explicitly injected private embedding record fixture.
 */
async function fixture() {
    const config = readTestApiConfig({ HARNESS_API_TOKEN: 'embedding-purpose-test-private-server-token' })
    const store = createMemoryChatStore()
    const scope = { userId: randomUUID(), workspaceId: config.workspaceId }
    const now = new Date().toISOString()
    await store.accounts!.createUser({
        user: { id: scope.userId, username: 'Credential fixture', email: `${scope.userId}@example.test`, createdAt: now, updatedAt: now },
        workspaceId: scope.workspaceId,
        passwordHash: 'isolated-fixture-hash',
        credentialVersion: 1,
    })
    const accounts = new AccountService(store.accounts, config)
    const records = new Map<string, StoredEmbeddingModel>()
    const persistence = {
        createModel: vi.fn(async (_scope, record: StoredEmbeddingModel) => {
            records.set(record.model.id, structuredClone(record))
            return record.model
        }),
        getModel: vi.fn(async (_scope, id: string) => records.get(id)),
        verifyModel: vi.fn(async (_scope, id: string, _revision: number, dimensions: number, providerModel: string) => {
            const record = records.get(id)!
            record.model = { ...record.model, dimensions, providerModel, verifiedAt: new Date().toISOString() }
            return record.model
        }),
        updateModel: vi.fn(async (_scope, id: string, _revision: number, record: StoredEmbeddingModel) => {
            records.set(id, record)
            return record.model
        }),
    } satisfies Partial<EmbeddingStore>
    const generate = vi.fn<EmbeddingGenerator>().mockResolvedValue({
        model: 'provider-v1',
        dimensions: 2,
        vectors: [
            [1, 0],
            [0, 1],
        ],
    })
    const embeddings = new EmbeddingService(persistence as unknown as EmbeddingStore, config, accounts, generate)
    return { config, store, scope, accounts, records, generate, embeddings }
}

describe('independent embedding credential cryptography', () => {
    it('encrypts write-only keys without implicit calls and decrypts only for an explicit fixed-text probe', async () => {
        const f = await fixture()
        const input = {
            requestId: randomUUID(),
            name: 'Private embeddings',
            baseUrl: 'https://vectors.example.com/v1',
            model: 'embedding-model',
            apiKey: 'EMBEDDING_PRIVATE_SENTINEL',
        }
        const model = await f.embeddings.create(f.scope, input)
        expect(f.generate).not.toHaveBeenCalled()
        const originalCiphertext = f.records.get(model.id)!.encryptedApiKey
        expect(originalCiphertext).not.toContain(input.apiKey)
        expect(JSON.stringify(model)).not.toContain(input.apiKey)
        await f.embeddings.update(f.scope, model.id, {
            name: 'Renamed',
            baseUrl: input.baseUrl,
            model: input.model,
            revision: 1,
            apiKey: '',
        })
        expect(f.records.get(model.id)!.encryptedApiKey).toBe(originalCiphertext)
        expect(f.generate).not.toHaveBeenCalled()
        const tested = await f.embeddings.test(f.scope, model.id)
        expect(tested.model.dimensions).toBe(2)
        expect(f.generate.mock.calls[0]?.[0]).toMatchObject({ apiKey: input.apiKey, model: input.model })
        expect(f.generate.mock.calls[0]?.[1]).toEqual(['向量连接测试', 'Embedding connection verification'])
        expect(JSON.stringify(tested)).not.toContain(input.apiKey)
        await f.store.close()
    })

    it('rejects legacy chat ciphertext at the same owner and UUID while preserving original chat decryption', async () => {
        const f = await fixture()
        const id = randomUUID()
        const input = {
            requestId: id,
            name: 'Embedding purpose',
            baseUrl: 'https://vectors.example.com/v1',
            model: 'embedding-model',
            apiKey: 'EMBEDDING_ONLY_KEY',
        }
        await f.embeddings.create(f.scope, input)
        const ownCiphertext = f.records.get(id)!.encryptedApiKey
        await f.accounts.createModel(f.scope, { ...input, name: 'Legacy chat purpose', apiKey: 'LEGACY_CHAT_ONLY_KEY' })
        const legacy = await f.store.accounts!.getModel(f.scope, id)
        f.records.get(id)!.encryptedApiKey = legacy!.encryptedApiKey
        await expect(f.embeddings.test(f.scope, id)).rejects.toThrow('向量模型凭据不可用')
        expect(f.generate).not.toHaveBeenCalled()
        expect((await f.accounts.getModel(f.scope, id))?.apiKey).toBe('LEGACY_CHAT_ONLY_KEY')
        await f.embeddings.update(f.scope, id, {
            name: input.name,
            baseUrl: input.baseUrl,
            model: input.model,
            revision: 1,
            apiKey: 'EXPLICIT_RECOVERY_KEY',
        })
        expect(f.generate).not.toHaveBeenCalled()
        await f.embeddings.test(f.scope, id)
        expect(f.generate.mock.calls[0]?.[0].apiKey).toBe('EXPLICIT_RECOVERY_KEY')
        expect((await f.accounts.getModel(f.scope, id))?.apiKey).toBe('LEGACY_CHAT_ONLY_KEY')
        f.generate.mockClear()
        f.records.get(id)!.encryptedApiKey = ownCiphertext
        await f.embeddings.test(f.scope, id)
        expect(f.generate.mock.calls[0]?.[0].apiKey).toBe(input.apiKey)
        await f.store.close()
    })
})
