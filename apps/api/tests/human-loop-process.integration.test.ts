import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { ChatConversation } from '@ai-harness/contracts'
import { expect, it } from 'vitest'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

/**
 * Encodes a controlled provider response consumed by the actual compiled adapter.
 * @param delta - Native content or tool-call delta.
 * @param finish - Native provider completion reason.
 * @returns OpenAI-compatible streaming response bytes.
 */
function providerStream(delta: Record<string, unknown>, finish = 'stop'): string {
    return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'retains one exact private question across SIGKILL and resumes its original execution once through a fresh production process',
    async () => {
        const schema = `sf022_process_${randomUUID().replaceAll('-', '')}`
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const database = new URL(process.env.TEST_DATABASE_URL!)
        database.searchParams.set('options', `-c search_path=${schema},public`)
        await admin.query(`CREATE SCHEMA ${schema}`)
        const pool = new pg.Pool({ connectionString: database.toString() })
        const captures: { messages: { role: string; content?: unknown }[] }[] = []
        const provider = createServer(async (request, response) => {
            let raw = ''
            for await (const bytes of request) raw += String(bytes)
            const body = JSON.parse(raw) as (typeof captures)[number]
            captures.push(body)
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            const result = body.messages.findLast(message => message.role === 'tool')
            response.end(
                result
                    ? providerStream({ content: '已恢复原工作，按照本人真实答案继续：面向工程团队。' })
                    : providerStream(
                          {
                              tool_calls: [
                                  {
                                      index: 0,
                                      id: 'process-original-question-call',
                                      type: 'function',
                                      function: {
                                          name: 'ask-human',
                                          arguments: JSON.stringify({
                                              question: '这份方案主要面向谁？',
                                              context: '等待本人明确读者后继续原方案。',
                                              options: ['工程团队', '产品团队'],
                                          }),
                                      },
                                  },
                              ],
                          },
                          'tool_calls'
                      )
            )
        })
        await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
        const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
        const reservation = createServer()
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
        const port = (reservation.address() as AddressInfo).port
        await new Promise<void>((resolve, reject) => reservation.close(error => (error ? reject(error) : resolve())))
        const base = `http://127.0.0.1:${port}/api`
        const token = 'sf022-independent-process-private-fixture-token'
        let child: ChildProcess | undefined

        /**
         * Ends only this test's owned child process, including a genuine crash when requested.
         * @param signal - Normal shutdown or deliberate process crash.
         * @returns After the child has exited and released its network sockets.
         */
        async function stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
            if (!child || child.exitCode !== null || child.signalCode !== null) return
            const exited = once(child, 'exit')
            child.kill(signal)
            const timeout = setTimeout(() => child?.kill('SIGKILL'), 4000)
            try {
                await exited
            } finally {
                clearTimeout(timeout)
            }
        }

        /**
         * Boots an independent compiled API and Cordis graph with unchanged private fixture settings.
         * @returns After the real guarded HTTP API becomes ready.
         * @throws Error when startup exits early or exceeds the bounded readiness deadline.
         */
        async function boot(): Promise<void> {
            child = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
                env: {
                    ...process.env,
                    DATABASE_URL: database.toString(),
                    HARNESS_WORKSPACE_ID: schema,
                    HARNESS_API_TOKEN: token,
                    ACCOUNT_ENCRYPTION_KEY: 'd'.repeat(64),
                    DEEPSEEK_API_KEY: 'sf022-controlled-process-provider-key',
                    DEEPSEEK_BASE_URL: origin,
                    DEEPSEEK_MODEL: 'deepseek-flash',
                    OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
                    COLLABORATION_POLL_MS: '20',
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    S3_ENDPOINT: '',
                    S3_BUCKET: '',
                    S3_ACCESS_KEY_ID: '',
                    S3_SECRET_ACCESS_KEY: '',
                },
                stdio: 'ignore',
            })
            for (let attempt = 0; attempt < 160; attempt++) {
                if (child.exitCode !== null || child.signalCode !== null) throw new Error('Test-owned HITL API exited before readiness.')
                const response = await fetch(`${base}/account/me`, { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined)
                if (response?.status === 401) {
                    await response.body?.cancel()
                    return
                }
                await delay(50)
            }
            throw new Error('Test-owned HITL API readiness timed out.')
        }

        /**
         * Calls the real private API without printing its opaque session or service token.
         * @param session - Genuine account session from registration.
         * @param path - Actual API route.
         * @param body - Optional strict mutation payload.
         * @returns The actual unconsumed HTTP response.
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

        /**
         * Reads a successful actual API response without substituting an in-process service.
         * @param session - Real account session.
         * @param path - Precise API resource.
         * @param body - Optional actual mutation payload.
         * @returns Its safe typed JSON body.
         */
        async function json<T>(session: string, path: string, body?: unknown): Promise<T> {
            const response = await call(session, path, body)
            expect(response.ok, `${path}: ${response.status}`).toBe(true)
            return response.json() as Promise<T>
        }

        /**
         * Waits for a real persisted conversation predicate across independent processes.
         * @param session - Original still-valid account session.
         * @param id - Exact original private source.
         * @param accept - Required persisted outcome.
         * @returns The actual current private conversation.
         * @throws Error when the worker fails to settle by the bounded deadline.
         */
        async function settled(
            session: string,
            id: string,
            accept: (conversation: ChatConversation) => boolean
        ): Promise<ChatConversation> {
            let latest: ChatConversation | undefined
            for (let attempt = 0; attempt < 240; attempt++) {
                latest = await json<ChatConversation>(session, `chat/conversations/${id}`)
                if (accept(latest)) return latest
                await delay(50)
            }
            throw new Error(`Test-owned HITL source failed to settle: ${JSON.stringify(latest)}`)
        }

        try {
            await boot()
            const registration = await call('', 'account/register', {
                username: 'HITL process owner',
                email: `${randomUUID()}@example.test`,
                password: 'Isolated persistent HITL password',
            })
            expect(registration.status).toBe(201)
            await registration.json()
            const session = registration.headers.get('x-harness-session')!
            const conversation = await json<ChatConversation>(session, 'chat/conversations', { title: '进程重启后仍回答原问题' })
            const triggerId = randomUUID()
            const response = await call(session, `chat/conversations/${conversation.id}/messages`, {
                requestId: triggerId,
                content: '请先确认方案读者，再继续方案。',
            })
            expect(response.status).toBe(201)
            await response.text()
            const waiting = await settled(
                session,
                conversation.id,
                value => !value.activeRequestId && Boolean(value.humanRequests?.some(request => request.status === 'pending'))
            )
            const request = waiting.humanRequests![0]!
            expect(request).toMatchObject({
                kind: 'question',
                version: 1,
                status: 'pending',
                callId: expect.stringContaining('process-original-question-call'),
                question: { text: '这份方案主要面向谁？' },
            })
            const sourceBefore = (
                await pool.query('SELECT session_id,events FROM harness_collaboration_sources WHERE source_id=$1', [conversation.id])
            ).rows[0]!
            expect(captures).toHaveLength(1)
            const firstPid = child!.pid
            await stop('SIGKILL')

            await boot()
            expect(child!.pid).not.toBe(firstPid)
            const restored = await json<ChatConversation>(session, `chat/conversations/${conversation.id}`)
            expect(restored.humanRequests).toEqual(waiting.humanRequests)
            expect(restored.activeRequestId).toBeUndefined()
            await delay(150)
            expect(captures).toHaveLength(1)
            const actionId = randomUUID()
            const answer = {
                requestId: actionId,
                content: '面向工程团队。',
                humanResponse: { requestId: request.id, version: request.version },
            }
            for (const result of await Promise.all([
                call(session, `chat/conversations/${conversation.id}/messages`, answer),
                call(session, `chat/conversations/${conversation.id}/messages`, answer),
            ])) {
                expect(result.status).toBe(201)
                await result.text()
            }
            const completed = await settled(
                session,
                conversation.id,
                value =>
                    !value.activeRequestId &&
                    value.messages.some(message => message.role === 'assistant' && message.content.includes('已恢复原工作'))
            )
            expect(completed.humanRequests).toMatchObject([{ id: request.id, status: 'answered', answer: '面向工程团队。' }])
            expect(completed.messages.filter(message => message.role === 'user' && message.requestId === actionId)).toHaveLength(1)
            expect(captures).toHaveLength(2)
            expect(JSON.stringify(captures[1])).toContain('面向工程团队。')
            const retry = await call(session, `chat/conversations/${conversation.id}/messages`, answer)
            expect(retry.status).toBe(201)
            await retry.text()
            await delay(100)
            expect(captures).toHaveLength(2)
            const sourceAfter = (
                await pool.query('SELECT session_id FROM harness_collaboration_sources WHERE source_id=$1', [conversation.id])
            ).rows[0]!
            expect(sourceAfter.session_id).toBe(sourceBefore.session_id)
            expect((await pool.query('SELECT count(*)::int AS count FROM harness_human_decisions')).rows[0].count).toBe(1)
            expect((await pool.query('SELECT count(*)::int AS count FROM harness_collaboration_jobs')).rows[0].count).toBe(1)
            expect((await pool.query('SELECT count(*)::int AS count FROM harness_personal_projects')).rows[0].count).toBe(0)
        } finally {
            await stop()
            await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
            await pool.end()
            await admin.query(`DROP SCHEMA ${schema} CASCADE`)
            await admin.end()
        }
    },
    90_000
)
