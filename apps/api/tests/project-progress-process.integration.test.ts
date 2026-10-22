import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { ChatConversation, CollaborationProject, CollaborationActionResult, CollaborationProjectProgress } from '@ai-harness/contracts'
import { expect, it } from 'vitest'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'restores empty root work, private source sessions, chain and real pending waits across independent production API processes',
    async () => {
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const schema = `sf017_process_${randomUUID().replaceAll('-', '')}`
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const reservation = createServer()
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
        const port = (reservation.address() as AddressInfo).port
        await new Promise<void>((resolve, reject) => reservation.close(error => (error ? reject(error) : resolve())))
        const token = 'sf017-independent-process-private-test-token'
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
                    HARNESS_WORKSPACE_ID: 'sf017-process-home',
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    DEEPSEEK_API_KEY: 'controlled-process-nonsecret-fixture',
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
        const pool = new pg.Pool({ connectionString: url.toString() })
        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            await boot()
            const ownerResponse = await call('', 'account/register', {
                username: 'Progress process owner',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent project password',
            })
            expect(ownerResponse.status).toBe(201)
            const owner = (await ownerResponse.json()) as { id: string }
            const ownerSession = ownerResponse.headers.get('x-harness-session')!
            const memberResponse = await call('', 'account/register', {
                username: 'Progress process member',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent project password',
            })
            expect(memberResponse.status).toBe(201)
            const member = (await memberResponse.json()) as { id: string }
            const memberSession = memberResponse.headers.get('x-harness-session')!
            const created = await call(ownerSession, 'chat/collaboration/commands', {
                type: 'project-create',
                requestId: randomUUID(),
                name: '独立进程责任链',
                description: 'PRIVATE_PROCESS_DESCRIPTION',
                memberIds: [member.id],
            })
            expect(created.ok).toBe(true)
            const result = (await created.json()) as CollaborationActionResult
            const path = `chat/collaboration/projects/${result.projectId}`
            const initial = (await (await call(ownerSession, path)).json()) as CollaborationProject
            const start = {
                type: 'project-start',
                requestId: randomUUID(),
                projectId: result.projectId,
                revision: initial.revision,
                title: '持久空工作',
                goal: 'PRIVATE_EXPLICIT_PROCESS_GOAL',
            }
            const response = await call(ownerSession, 'chat/collaboration/commands', start)
            expect(response.ok).toBe(true)
            const started = (await response.json()) as CollaborationActionResult
            const dialoguePath = `chat/conversations/${started.conversationId}`
            expect(((await (await call(ownerSession, dialoguePath)).json()) as ChatConversation).messages).toEqual([])
            const delegate = {
                type: 'delegate',
                requestId: randomUUID(),
                source: { kind: 'conversation', id: started.conversationId },
                recipientId: member.id,
                title: '成员评估',
                goal: 'PRIVATE_PROCESS_REQUEST',
                context: '',
            }
            const deliveredResponse = await call(ownerSession, 'chat/collaboration/commands', delegate)
            expect(deliveredResponse.ok).toBe(true)
            const delivered = (await deliveredResponse.json()) as CollaborationActionResult
            expect(delivered.projectId).toBe(result.projectId)
            const before = (await (await call(ownerSession, `${path}/progress`)).json()) as CollaborationProjectProgress
            expect(before.nodes).toHaveLength(2)
            expect(before.waits).toHaveLength(1)
            const binding = (
                await pool.query('SELECT user_id,source_id,session_id,bound FROM harness_collaboration_sources ORDER BY source_id')
            ).rows
            expect(binding).toHaveLength(2)
            expect(binding.every(row => row.bound)).toBe(true)
            for (let restart = 0; restart < 2; restart++) {
                await stop()
                await boot()
                expect(await (await call(ownerSession, 'chat/collaboration/commands', start)).json()).toEqual(started)
                expect(await (await call(ownerSession, 'chat/collaboration/commands', delegate)).json()).toEqual(delivered)
                expect(await (await call(ownerSession, `${path}/progress`)).json()).toEqual(before)
                const memberView = (await (await call(memberSession, `${path}/progress`)).json()) as CollaborationProjectProgress
                expect(memberView.waits).toEqual(before.waits)
                expect(memberView.nodes.filter(node => node.ownHref).map(node => node.ownerId)).toEqual([member.id])
                expect(((await (await call(ownerSession, dialoguePath)).json()) as ChatConversation).messages).toEqual([])
                expect(
                    (await pool.query('SELECT user_id,source_id,session_id,bound FROM harness_collaboration_sources ORDER BY source_id'))
                        .rows
                ).toEqual(binding)
                expect(
                    (await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations WHERE user_id=$1', [owner.id])).rows[0].n
                ).toBe(1)
                expect((await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_jobs')).rows[0].n).toBe(0)
                expect(
                    (await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations WHERE task_data IS NOT NULL')).rows[0].n
                ).toBe(0)
            }
        } finally {
            await stop()
            await pool.end()
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    45000
)
