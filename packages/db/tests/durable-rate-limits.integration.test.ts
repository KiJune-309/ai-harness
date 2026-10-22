import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { expect, it } from 'vitest'
import { createChatStore, type ChatStore } from '../src/index.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const token = 'sf006-shared-rate-isolated-server-private-token'
const encryptionKey = 'd'.repeat(64)
const windowMs = 15 * 60 * 1000

/**
 * Allocates an isolated loopback API port.
 * @returns An available test-owned port.
 * @throws Error when the temporary socket cannot open or close.
 */
async function availablePort(): Promise<number> {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert(address && typeof address !== 'string')
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    return address.port
}

/**
 * Stops only an API process owned by this isolated test.
 * @param child - Test-owned child process.
 * @returns After exit, with bounded escalation for a hung child.
 */
async function stop(child: ChildProcess | undefined): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000)
    try {
        await exited
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Starts an independent compiled API against the dedicated test schema.
 * @param port - Test-owned loopback port.
 * @param url - Private dedicated schema connection URL, never logged.
 * @param workspaceId - Isolated account workspace.
 * @returns Ready child process whose credential-bearing output is suppressed.
 * @throws Error for startup failure or readiness timeout.
 */
async function boot(port: number, url: string, workspaceId: string): Promise<ChildProcess> {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../apps/api/lib/main.js', import.meta.url))], {
        env: {
            ...process.env,
            HARNESS_API_TOKEN: token,
            ACCOUNT_ENCRYPTION_KEY: encryptionKey,
            HARNESS_WORKSPACE_ID: workspaceId,
            DATABASE_URL: url,
            CHAT_STORE: 'memory',
            API_HOST: '127.0.0.1',
            API_PORT: String(port),
            DEEPSEEK_API_KEY: '',
        },
        stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error('Isolated rate-limit API exited during startup.')
        const response = await fetch(`http://127.0.0.1:${port}/api/account/me`, { headers: { authorization: `Bearer ${token}` } }).catch(
            () => undefined
        )
        if (response?.status === 401) {
            await response.body?.cancel()
            return child
        }
        await delay(100)
    }
    await stop(child)
    throw new Error('Isolated rate-limit API did not become ready.')
}

/**
 * Derives the documented private authentication identity for real database inspection.
 * @param workspaceId - Isolated deployment scope.
 * @param categoryKey - Internal category and source or normalized email.
 * @returns HMAC-SHA256 opaque bucket identity.
 */
function bucketKey(workspaceId: string, categoryKey: string): string {
    return createHmac('sha256', Buffer.from(encryptionKey, 'hex'))
        .update(JSON.stringify([workspaceId, categoryKey]))
        .digest('hex')
}

it.skipIf(!databaseUrl)(
    'preserves authentication limits across two independent API processes, concurrent HTTP attempts, restart and expiry',
    async () => {
        const schema = `sf006_http_limits_${randomUUID().replaceAll('-', '')}`
        const workspaceId = `sf006-rate-http-${randomUUID()}`
        const admin = new pg.Pool({ connectionString: databaseUrl })
        const url = new URL(databaseUrl!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const isolatedUrl = url.toString()
        const inspector = new pg.Pool({ connectionString: isolatedUrl })
        const ports = await Promise.all([availablePort(), availablePort()])
        const children: (ChildProcess | undefined)[] = []
        let store: ChatStore | undefined
        /**
         * Posts one public authentication operation to a selected isolated API process.
         * @param index - Process index.
         * @param path - Register or login action.
         * @param body - Fixture-only credential fields, never logged.
         * @returns Actual HTTP status after discarding secret-bearing response bodies and headers.
         */
        async function status(index: number, path: 'register' | 'login', body: unknown): Promise<number> {
            const response = await fetch(`http://127.0.0.1:${ports[index]}/api/account/${path}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify(body),
            })
            await response.body?.cancel()
            return response.status
        }
        try {
            // The schema identifier is made only from a fixed prefix and hexadecimal UUID.
            await admin.query(`CREATE SCHEMA ${schema}`)
            store = await createChatStore({ databaseUrl: isolatedUrl })
            const password = 'Isolated durable fixture password '
            const salt = randomBytes(16)
            const verifier = scryptSync(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })
            const email = `${randomUUID()}@example.com`
            const otherEmail = `${randomUUID()}@example.com`
            const now = new Date().toISOString()
            for (const address of [email, otherEmail])
                await store.accounts!.createUser({
                    user: { id: randomUUID(), username: 'Shared rate fixture', email: address, createdAt: now, updatedAt: now },
                    passwordHash: `scrypt$131072$8$1$${salt.toString('base64url')}$${verifier.toString('base64url')}`,
                    credentialVersion: 1,
                    workspaceId,
                })
            children.push(...(await Promise.all(ports.map(port => boot(port, isolatedUrl, workspaceId)))))

            const registration = { username: 'x', email: 'invalid', password: 'short' }
            const registered = await Promise.all(Array.from({ length: 12 }, (_, index) => status(index % 2, 'register', registration)))
            expect(registered.filter(code => code === 400)).toHaveLength(10)
            expect(registered.filter(code => code === 429)).toHaveLength(2)
            await stop(children[0])
            children[0] = await boot(ports[0]!, isolatedUrl, workspaceId)
            expect(await status(0, 'register', registration)).toBe(429)

            const wrong = { email, password: 'Wrong isolated fixture password' }
            const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) => status(index % 2, 'login', wrong)))
            expect(attempts.filter(code => code === 401)).toHaveLength(10)
            expect(attempts.filter(code => code === 429)).toHaveLength(2)
            const emailKey = bucketKey(workspaceId, `failed:${email}`)
            const bucket = await inspector.query<{ attempts: number }>('SELECT attempts FROM harness_account_rate_limits WHERE key=$1', [
                emailKey,
            ])
            expect(bucket.rows[0]!.attempts).toBe(10)
            await stop(children[1])
            children[1] = await boot(ports[1]!, isolatedUrl, workspaceId)
            expect(await status(1, 'login', { email, password })).toBe(429)
            await inspector.query('UPDATE harness_account_rate_limits SET expires_at=$2 WHERE key=$1', [
                emailKey,
                new Date(Date.now() - 1).toISOString(),
            ])
            expect(await status(1, 'login', wrong)).toBe(401)

            const successfulEmailKey = bucketKey(workspaceId, `failed:${otherEmail}`)
            for (let index = 0; index < 9; index++)
                await store.accounts!.verifyLogin(successfulEmailKey, 10, windowMs, Date.now(), async () => false)
            // Both real servers see their loopback peer as the same source and must share this exact bucket.
            const sourceKey = bucketKey(workspaceId, 'login:127.0.0.1')
            await inspector.query('UPDATE harness_account_rate_limits SET attempts=59 WHERE key=$1', [sourceKey])
            expect(await status(0, 'login', { email: otherEmail, password })).toBe(201)
            const source = await inspector.query<{ attempts: number }>('SELECT attempts FROM harness_account_rate_limits WHERE key=$1', [
                sourceKey,
            ])
            expect(source.rows[0]!.attempts).toBe(60)
            expect((await inspector.query('SELECT key FROM harness_account_rate_limits WHERE key=$1', [successfulEmailKey])).rowCount).toBe(
                0
            )
            expect(await status(1, 'login', { email: 'invalid', password: 'short' })).toBe(429)
            await stop(children[0])
            children[0] = await boot(ports[0]!, isolatedUrl, workspaceId)
            expect(await status(0, 'login', { email: otherEmail, password })).toBe(429)
            await inspector.query('UPDATE harness_account_rate_limits SET expires_at=$2 WHERE key=$1', [
                sourceKey,
                new Date(Date.now() - 1).toISOString(),
            ])
            expect(await status(0, 'login', { email: 'invalid', password: 'short' })).toBe(400)
            const keys = await inspector.query<{ key: string }>('SELECT key FROM harness_account_rate_limits')
            expect(keys.rows.every(row => /^[a-f0-9]{64}$/.test(row.key))).toBe(true)
        } finally {
            await Promise.all(children.map(child => stop(child)))
            await store?.close()
            await inspector.end()
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    60000
)
