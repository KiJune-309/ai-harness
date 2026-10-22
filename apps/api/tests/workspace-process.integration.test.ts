import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { TeamWorkspace, WorkspaceDirectory, WorkspaceInvitation } from '@ai-harness/contracts'
import { expect, it } from 'vitest'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'recovers workspace selection, owner membership and pending invitations across independent production API process restarts',
    async () => {
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const schema = `sf015_process_${randomUUID().replaceAll('-', '')}`
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const reservation = createServer()
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
        const port = (reservation.address() as AddressInfo).port
        await new Promise<void>((resolve, reject) => reservation.close(error => (error ? reject(error) : resolve())))
        const token = 'sf015-independent-process-private-test-token'
        const base = `http://127.0.0.1:${port}/api/account`
        let child: ChildProcess | undefined

        /**
         * Stops only the test-owned independent API process with bounded shutdown.
         * @returns After that process has exited.
         */
        async function stop(): Promise<void> {
            if (!child || child.exitCode !== null || child.signalCode !== null) return
            const exited = once(child, 'exit')
            child.kill('SIGTERM')
            const timeout = setTimeout(() => child?.kill('SIGKILL'), 4000)
            try {
                await exited
            } finally {
                clearTimeout(timeout)
            }
        }

        /**
         * Starts the built production API with durable private settings in the isolated schema.
         * @returns After real HTTP readiness is observed.
         * @throws Error for early child failure or readiness timeout.
         */
        async function boot(): Promise<void> {
            child = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
                env: {
                    ...process.env,
                    DATABASE_URL: url.toString(),
                    HARNESS_API_TOKEN: token,
                    ACCOUNT_ENCRYPTION_KEY: 'e'.repeat(64),
                    HARNESS_WORKSPACE_ID: 'sf015-process-home',
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    DEEPSEEK_API_KEY: '',
                    COLLABORATION_POLL_MS: '30000',
                },
                stdio: 'ignore',
            })
            for (let attempt = 0; attempt < 100; attempt++) {
                if (child.exitCode !== null) throw new Error('Test-owned workspace API exited before readiness.')
                const response = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined)
                if (response?.status === 401) {
                    await response.body?.cancel()
                    return
                }
                await delay(50)
            }
            throw new Error('Test-owned workspace API readiness timed out.')
        }

        /**
         * Calls one actual independent process with an optional real opaque session.
         * @param session - Test-owned server-issued session, never printed.
         * @param path - Account API route.
         * @param body - Optional strict mutation fields.
         * @returns Unconsumed real HTTP response.
         */
        async function call(session: string, path: string, body?: unknown): Promise<Response> {
            return fetch(`${base}/${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json',
                    ...(session ? { 'x-harness-session': session } : {}),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }
        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            await boot()
            const ownerResponse = await call('', 'register', {
                username: 'Process owner',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent workspace password',
            })
            expect(ownerResponse.status).toBe(201)
            const ownerSession = ownerResponse.headers.get('x-harness-session')!
            const memberEmail = `${randomUUID()}@example.test`
            const memberResponse = await call('', 'register', {
                username: 'Process member',
                email: memberEmail,
                password: 'Persistent workspace password',
            })
            expect(memberResponse.status).toBe(201)
            const memberSession = memberResponse.headers.get('x-harness-session')!
            const input = { requestId: randomUUID(), name: '独立进程恢复', description: '真实持久成员与邀请' }
            const created = await call(ownerSession, 'workspaces', input)
            expect(created.ok).toBe(true)
            const team = (await created.json()) as TeamWorkspace
            const invitation = (await (
                await call(ownerSession, `workspaces/${team.id}/invitations`, { requestId: randomUUID(), email: memberEmail })
            ).json()) as WorkspaceInvitation
            expect((await call(ownerSession, `workspaces/${team.id}/switch`, {})).ok).toBe(true)
            await stop()
            await boot()
            const directory = (await (await call(ownerSession, 'workspaces')).json()) as WorkspaceDirectory
            expect(directory.currentId).toBe(team.id)
            expect(directory.workspaces.find(item => item.id === team.id)?.role).toBe('owner')
            expect(((await (await call(ownerSession, 'workspaces', input)).json()) as TeamWorkspace).id).toBe(team.id)
            const incoming = (await (await call(memberSession, 'workspaces')).json()) as WorkspaceDirectory
            expect(incoming.invitations.map(item => item.id)).toEqual([invitation.id])
            expect((await call(memberSession, `workspaces/invitations/${invitation.id}/respond`, { accept: true })).ok).toBe(true)
            expect((await call(memberSession, `workspaces/${team.id}/switch`, {})).ok).toBe(true)
            await stop()
            await boot()
            const joined = (await (await call(memberSession, 'workspaces')).json()) as WorkspaceDirectory
            expect(joined.currentId).toBe(team.id)
            expect(joined.workspaces.find(item => item.id === team.id)?.role).toBe('member')
            expect(joined.invitations).toEqual([])
        } finally {
            await stop()
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    45000
)
