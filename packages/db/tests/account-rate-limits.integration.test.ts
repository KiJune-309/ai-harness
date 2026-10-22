import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createChatStore, type ChatStore } from '../src/index.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const schema = `sf006_limits_${randomUUID().replaceAll('-', '')}`
const stores: ChatStore[] = []
let admin: pg.Pool | undefined
let isolatedUrl: string

/**
 * Creates a non-secret isolated identity for one frequency-control fixture.
 * @returns SHA256 fixture identity matching the private store's key constraints.
 */
function identity(): string {
    return createHash('sha256').update(randomUUID()).digest('hex')
}

describe.skipIf(!databaseUrl)('real PostgreSQL shared authentication frequency control', () => {
    beforeAll(async () => {
        admin = new pg.Pool({ connectionString: databaseUrl })
        const url = new URL(databaseUrl!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        isolatedUrl = url.toString()
        // The identifier is entirely generated from a fixed prefix and hexadecimal UUID.
        await admin.query(`CREATE SCHEMA ${schema}`)
        stores.push(...(await Promise.all([createChatStore({ databaseUrl: isolatedUrl }), createChatStore({ databaseUrl: isolatedUrl })])))
    })
    afterAll(async () => {
        await Promise.all(stores.map(store => store.close()))
        if (admin) {
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    })

    it('atomically accepts only the declared source ceiling across independent pools and restart', async () => {
        const key = identity()
        const now = Date.now()
        const results = await Promise.all(
            Array.from({ length: 30 }, (_, index) => stores[index % 2]!.accounts!.consumeRateLimit(key, 10, 60000, now))
        )
        expect(results.filter(Boolean)).toHaveLength(10)
        const restarted = await createChatStore({ databaseUrl: isolatedUrl })
        try {
            expect(await restarted.accounts!.consumeRateLimit(key, 10, 60000, now)).toBe(false)
            expect(await restarted.accounts!.consumeRateLimit(key, 10, 60000, now + 60000)).toBe(true)
        } finally {
            await restarted.close()
        }
    })

    it('serializes concurrent email verification and persists exactly ten failures before denying hashing', async () => {
        const key = identity()
        const now = Date.now()
        const verifier = vi.fn(async () => false)
        const results = await Promise.all(
            Array.from({ length: 24 }, (_, index) => stores[index % 2]!.accounts!.verifyLogin(key, 10, 60000, now, verifier))
        )
        expect(results.filter(result => result === 'failed')).toHaveLength(10)
        expect(results.filter(result => result === 'limited')).toHaveLength(14)
        expect(verifier).toHaveBeenCalledTimes(10)
        const restarted = await createChatStore({ databaseUrl: isolatedUrl })
        try {
            const success = vi.fn(async () => true)
            expect(await restarted.accounts!.verifyLogin(key, 10, 60000, now, success)).toBe('limited')
            expect(success).not.toHaveBeenCalled()
            expect(await restarted.accounts!.verifyLogin(key, 10, 60000, now + 60000, success)).toBe('verified')
            expect(success).toHaveBeenCalledTimes(1)
        } finally {
            await restarted.close()
        }
    })

    it('commits failures, clears only successful email state and releases rejected verification locks', async () => {
        const emailKey = identity()
        const sourceKey = identity()
        const now = Date.now()
        await stores[0]!.accounts!.consumeRateLimit(sourceKey, 1, 60000, now)
        expect(await stores[0]!.accounts!.verifyLogin(emailKey, 2, 60000, now, async () => false)).toBe('failed')
        await expect(
            stores[0]!.accounts!.verifyLogin(emailKey, 2, 60000, now, async () => {
                throw new Error('Isolated verifier failure')
            })
        ).rejects.toThrow('Isolated verifier failure')
        expect(await stores[1]!.accounts!.verifyLogin(emailKey, 2, 60000, now, async () => true)).toBe('verified')
        expect(await stores[1]!.accounts!.verifyLogin(emailKey, 2, 60000, now, async () => false)).toBe('failed')
        expect(await stores[1]!.accounts!.verifyLogin(emailKey, 2, 60000, now, async () => false)).toBe('failed')
        expect(await stores[1]!.accounts!.consumeRateLimit(sourceKey, 1, 60000, now)).toBe(false)
    })

    it('keeps identities opaque and performs bounded expired cleanup', async () => {
        const inspector = new pg.Pool({ connectionString: isolatedUrl })
        const now = Date.now()
        try {
            const keys = Array.from({ length: 300 }, () => identity())
            await inspector.query(
                'INSERT INTO harness_account_rate_limits(key,attempts,expires_at) SELECT unnest($1::text[]),1,$2::timestamptz',
                [keys, new Date(now - 60000).toISOString()]
            )
            await stores[0]!.accounts!.consumeRateLimit(identity(), 1, 60000, now)
            const remaining = await inspector.query<{ count: string }>(
                'SELECT count(*) FROM harness_account_rate_limits WHERE key=ANY($1::text[])',
                [keys]
            )
            expect(Number(remaining.rows[0]!.count)).toBe(172)
            const rows = await inspector.query<{ key: string }>('SELECT key FROM harness_account_rate_limits')
            expect(rows.rows.every(row => /^[a-f0-9]{64}$/.test(row.key))).toBe(true)
        } finally {
            await inspector.end()
        }
    })
})
