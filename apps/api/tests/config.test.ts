import { describe, expect, it } from 'vitest'
import { readApiConfig } from '../src/config.js'

const token = 'explicit-private-configuration-test-token'
describe('persistent application configuration', () => {
    it('requires PostgreSQL even when the legacy memory variable is set', () => {
        for (const env of [{}, { CHAT_STORE: 'memory' }, { NODE_ENV: 'production', CHAT_STORE: 'memory' }])
            expect(() => readApiConfig({ HARNESS_API_TOKEN: token, ...env })).toThrow('DATABASE_URL')
    })
    it('requires a stable independent account encryption key', () => {
        expect(() => readApiConfig({ HARNESS_API_TOKEN: token, DATABASE_URL: 'postgresql://fixture' })).toThrow(
            'stable ACCOUNT_ENCRYPTION_KEY'
        )
        expect(() =>
            readApiConfig({ HARNESS_API_TOKEN: token, DATABASE_URL: 'postgresql://fixture', ACCOUNT_ENCRYPTION_KEY: 'bad' })
        ).toThrow('64 hexadecimal')
    })
    it('uses only configured persistence and never exposes a memory opt-in', () => {
        const config = readApiConfig({
            HARNESS_API_TOKEN: token,
            DATABASE_URL: 'postgresql://fixture',
            ACCOUNT_ENCRYPTION_KEY: 'b'.repeat(64),
            CHAT_STORE: 'memory',
        })
        expect(config.databaseUrl).toBe('postgresql://fixture')
        expect(config.accountEncryptionKey).toBe('b'.repeat(64))
        expect(config).not.toHaveProperty('allowMemory')
    })
})

describe('private persistent knowledge object configuration', () => {
    const persistent = { HARNESS_API_TOKEN: token, DATABASE_URL: 'postgresql://fixture', ACCOUNT_ENCRYPTION_KEY: 'b'.repeat(64) }
    const s3 = {
        S3_ENDPOINT: 'http://127.0.0.1:9002',
        S3_REGION: 'us-east-1',
        S3_BUCKET: 'private-knowledge',
        S3_ACCESS_KEY_ID: 'test-only-access',
        S3_SECRET_ACCESS_KEY: 'test-only-secret',
    }
    it('keeps knowledge explicitly unconfigured for an independent chat deployment', () => {
        expect(readApiConfig(persistent).knowledgeObjectStorage).toBeUndefined()
        expect(
            readApiConfig({ ...persistent, S3_REGION: 'us-east-1', S3_CREATE_BUCKET: 'true', S3_FORCE_PATH_STYLE: 'true' })
                .knowledgeObjectStorage
        ).toBeUndefined()
    })
    it('requires complete persistent object settings and validates safe endpoints and booleans', () => {
        for (const scenario of [
            { S3_ENDPOINT: s3.S3_ENDPOINT },
            { ...s3, S3_ENDPOINT: 'file:///private/example' },
            { ...s3, S3_ENDPOINT: 'https://user:password@example.test' },
            { ...s3, S3_ENDPOINT: 'https://example.test/path?secret=bad' },
            { ...s3, S3_BUCKET: '../bad' },
            { ...s3, S3_FORCE_PATH_STYLE: 'yes' },
        ])
            expect(() => readApiConfig({ ...persistent, ...scenario })).toThrow()
    })
    it('retains server-only credentials and enables bucket creation only when explicit', () => {
        const result = readApiConfig({ ...persistent, ...s3 }).knowledgeObjectStorage!
        expect(result).toMatchObject({
            endpoint: s3.S3_ENDPOINT,
            bucket: s3.S3_BUCKET,
            accessKeyId: s3.S3_ACCESS_KEY_ID,
            secretAccessKey: s3.S3_SECRET_ACCESS_KEY,
            forcePathStyle: true,
            createBucket: false,
        })
        expect(readApiConfig({ ...persistent, ...s3, S3_CREATE_BUCKET: 'true' }).knowledgeObjectStorage?.createBucket).toBe(true)
    })
})
