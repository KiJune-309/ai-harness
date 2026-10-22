import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { expect, it } from 'vitest'
import { createChatStore, type ChatStore } from '../src/index.js'

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'survives a terminated idle PostgreSQL connection and reopens the same durable records',
    async () => {
        const identity = `sf006_recovery_${randomUUID().replaceAll('-', '')}`
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${identity}`)
        url.searchParams.set('application_name', identity)
        const scope = { userId: randomUUID(), workspaceId: identity }
        const now = new Date().toISOString()
        const conversation = { id: randomUUID(), title: '已持久保存的对话', messages: [], createdAt: now, updatedAt: now }
        let store: ChatStore | undefined
        let schemaCreated = false
        try {
            // Both identifiers contain only a fixed prefix and generated hexadecimal UUID.
            await admin.query(`CREATE SCHEMA ${identity}`)
            schemaCreated = true
            store = await createChatStore({ databaseUrl: url.toString() })
            await store.save(scope, conversation)
            const before = await admin.query<{ pid: number }>('SELECT pid FROM pg_stat_activity WHERE application_name=$1', [identity])
            expect(before.rows).toHaveLength(1)
            const previousPid = before.rows[0]!.pid
            const terminated = await admin.query<{ terminated: boolean }>('SELECT pg_terminate_backend($1) AS terminated', [previousPid])
            expect(terminated.rows[0]!.terminated).toBe(true)
            // Let the driver deliver the terminated idle connection's asynchronous error event.
            await delay(100)
            expect(await store.get(scope, conversation.id)).toEqual(conversation)
            expect(await store.get({ ...scope, userId: randomUUID() }, conversation.id)).toBeUndefined()
            const updated = { ...conversation, title: '重连后继续保存' }
            await store.save(scope, updated)
            expect(await store.get(scope, conversation.id)).toEqual(updated)
            const after = await admin.query<{ pid: number }>('SELECT pid FROM pg_stat_activity WHERE application_name=$1', [identity])
            expect(after.rows).toHaveLength(1)
            expect(after.rows[0]!.pid).not.toBe(previousPid)
        } finally {
            await store?.close()
            if (schemaCreated) await admin.query(`DROP SCHEMA ${identity} CASCADE`)
            await admin.end()
        }
    }
)
