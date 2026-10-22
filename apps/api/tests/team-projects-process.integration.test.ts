import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { CollaborationProject, CollaborationActionResult } from '@ai-harness/contracts'
import { expect, it } from 'vitest'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'restores shared projects, members, immutable note versions and action replays across independent production API processes',
    async () => {
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const schema = `sf016_process_${randomUUID().replaceAll('-', '')}`
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const reservation = createServer()
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
        const port = (reservation.address() as AddressInfo).port
        await new Promise<void>((resolve, reject) => reservation.close(error => (error ? reject(error) : resolve())))
        const token = 'sf016-independent-process-private-test-token'
        const base = `http://127.0.0.1:${port}/api`
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
                    HARNESS_WORKSPACE_ID: 'sf016-process-home',
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    DEEPSEEK_API_KEY: '',
                    COLLABORATION_POLL_MS: '30000',
                },
                stdio: 'ignore',
            })
            for (let attempt = 0; attempt < 100; attempt++) {
                if (child.exitCode !== null) throw new Error('Test-owned workspace API exited before readiness.')
                const response = await fetch(`${base}/account/me`, { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined)
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
            const ownerResponse = await call('', 'account/register', {
                username: 'Project process owner',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent project password',
            })
            expect(ownerResponse.status).toBe(201)
            const ownerSession = ownerResponse.headers.get('x-harness-session')!
            const memberResponse = await call('', 'account/register', {
                username: 'Project process member',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent project password',
            })
            expect(memberResponse.status).toBe(201)
            const member = (await memberResponse.json()) as { id: string }
            const memberSession = memberResponse.headers.get('x-harness-session')!
            const create = {
                type: 'project-create',
                requestId: randomUUID(),
                name: '独立进程项目',
                description: '持久人工共享',
                memberIds: [member.id],
            }
            const created = await call(ownerSession, 'chat/collaboration/commands', create)
            expect(created.ok).toBe(true)
            const result = (await created.json()) as CollaborationActionResult
            const path = `chat/collaboration/projects/${result.projectId}`
            const initial = (await (await call(memberSession, path)).json()) as CollaborationProject
            const publish = {
                type: 'note-publish',
                requestId: randomUUID(),
                projectId: result.projectId,
                revision: initial.revision,
                title: '资料v1',
                content: '完整第一版\n第二行',
            }
            const first = await call(memberSession, 'chat/collaboration/commands', publish)
            expect(first.ok).toBe(true)
            const note = (await first.json()) as CollaborationActionResult
            const edit = {
                type: 'note-edit',
                requestId: randomUUID(),
                projectId: result.projectId,
                noteId: note.noteId,
                revision: ((await (await call(memberSession, path)).json()) as CollaborationProject).revision,
                version: 1,
                title: '资料v2',
                content: '第二版完整正文',
            }
            expect((await call(memberSession, 'chat/collaboration/commands', edit)).ok).toBe(true)
            await stop()
            await boot()
            const restored = (await (await call(ownerSession, path)).json()) as CollaborationProject
            expect(restored.members.filter(person => person.status === 'active')).toHaveLength(2)
            expect(restored.notes.map(note => note.version)).toEqual([1, 2])
            expect(restored.notes.map(note => note.content)).toEqual(['完整第一版\n第二行', '第二版完整正文'])
            expect(
                ((await (await call(ownerSession, 'chat/collaboration/commands', create)).json()) as CollaborationActionResult).projectId
            ).toBe(result.projectId)
            expect(
                ((await (await call(memberSession, 'chat/collaboration/commands', publish)).json()) as CollaborationActionResult)
                    .noteVersion
            ).toBe(1)
            expect(
                ((await (await call(memberSession, 'chat/collaboration/commands', edit)).json()) as CollaborationActionResult).noteVersion
            ).toBe(2)
            expect(((await (await call(memberSession, path)).json()) as CollaborationProject).notes).toHaveLength(2)
            await stop()
            await boot()
            expect(((await (await call(memberSession, path)).json()) as CollaborationProject).notes).toHaveLength(2)
        } finally {
            await stop()
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    45000
)
