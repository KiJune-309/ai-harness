import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { expect, it } from 'vitest'
import { createPostgresCollaborationStore } from '../src/collaboration.js'

it('propagates unavailable persistent storage instead of accepting volatile messages or jobs', async () => {
    const offline = new Error('controlled database outage')
    const pool = {
        /**
         * Simulates an unavailable database query without retaining any business data.
         * @returns A rejected operation.
         */
        async query(): Promise<never> {
            throw offline
        },
        /**
         * Simulates a failed transaction connection before any action can commit.
         * @returns A rejected connection.
         */
        async connect(): Promise<never> {
            throw offline
        },
    } as unknown as pg.Pool
    const store = createPostgresCollaborationStore(pool)
    const scope = { workspaceId: randomUUID(), userId: randomUUID() }
    await expect(store.messages(scope)).rejects.toBe(offline)
    await expect(
        store.mutate(scope, { type: 'message', requestId: randomUUID(), recipientId: randomUUID(), content: 'not accepted' })
    ).rejects.toBe(offline)
    await expect(
        store.enqueue(scope, { requestId: randomUUID(), source: { kind: 'conversation', id: randomUUID() }, content: 'not queued' })
    ).rejects.toBe(offline)
})
