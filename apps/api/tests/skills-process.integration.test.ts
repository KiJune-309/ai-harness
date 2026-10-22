import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { AgentDefinition, ChatConversation, SkillRecord } from '@ai-harness/contracts'
import { expect, it } from 'vitest'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'restores exact Skill history/actions, frozen work and bound Cordis methods across three independent production processes',
    async () => {
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const schema = `sf019_process_${randomUUID().replaceAll('-', '')}`
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        await admin.query(`CREATE SCHEMA ${schema}`)
        const pool = new pg.Pool({ connectionString: url.toString() })
        const captures: Record<string, unknown>[] = []
        const provider = createServer(async (request, response) => {
            let raw = ''
            for await (const chunk of request) raw += String(chunk)
            captures.push(JSON.parse(raw))
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end(
                'data: {"choices":[{"index":0,"delta":{"content":"本人进程分析"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
            )
        })
        await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
        const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
        const reservation = createServer()
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
        const port = (reservation.address() as AddressInfo).port
        await new Promise<void>((resolve, reject) => reservation.close(error => (error ? reject(error) : resolve())))
        const token = 'sf019-independent-production-process-test-token'
        const base = `http://127.0.0.1:${port}/api`
        let child: ChildProcess | undefined

        /**
         * Shuts down only the currently owned production child with a bounded fallback.
         * @returns After the child has exited and released its pool.
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
         * Boots actual compiled main.js with stable private keys and disposable PostgreSQL scope.
         * @returns After its real guarded HTTP endpoint is ready.
         * @throws Error when the child exits early or readiness expires.
         */
        async function boot(): Promise<void> {
            child = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
                env: {
                    ...process.env,
                    DATABASE_URL: url.toString(),
                    HARNESS_API_TOKEN: token,
                    ACCOUNT_ENCRYPTION_KEY: 'c'.repeat(64),
                    HARNESS_WORKSPACE_ID: 'sf019-process-home',
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
                    COLLABORATION_POLL_MS: '20',
                },
                stdio: 'ignore',
            })
            for (let attempt = 0; attempt < 120; attempt++) {
                if (child.exitCode !== null) throw new Error('Test-owned Skill API exited before readiness.')
                const response = await fetch(`${base}/account/me`, { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined)
                if (response?.status === 401) {
                    await response.body?.cancel()
                    return
                }
                await delay(50)
            }
            throw new Error('Test-owned Skill API readiness timed out.')
        }

        /**
         * Calls the independent process without printing sessions or private configuration.
         * @param session - Real opaque session from account registration.
         * @param path - API route within the test schema.
         * @param body - Optional full strict mutation.
         * @param method - Explicit verb or inferred GET/POST.
         * @returns Unconsumed actual HTTP response.
         */
        async function call(
            session: string,
            path: string,
            body?: unknown,
            method = body === undefined ? 'GET' : 'POST'
        ): Promise<Response> {
            return fetch(`${base}/${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json',
                    ...(session ? { 'x-harness-session': session } : {}),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }

        /**
         * Requires a successful actual public response and reads its nonsecret typed body.
         * @param session - Real test-owned identity.
         * @param path - Actual route.
         * @param body - Optional strict mutation.
         * @param method - Optional explicit HTTP verb.
         * @returns Parsed committed result.
         */
        async function json<T>(session: string, path: string, body?: unknown, method?: string): Promise<T> {
            const response = await call(session, path, body, method)
            expect(response.ok, `${path} status ${response.status}`).toBe(true)
            return response.json() as Promise<T>
        }

        /**
         * Executes a real owner turn then waits for durable worker completion when the source is bound.
         * @param session - Actual owner session.
         * @param id - Frozen ordinary or bound conversation.
         * @returns The completed immutable work record.
         */
        async function run(session: string, id: string): Promise<ChatConversation> {
            const response = await call(session, `chat/conversations/${id}/messages`, {
                requestId: randomUUID(),
                content: '仅继续本人分析',
            })
            expect(response.ok).toBe(true)
            await response.text()
            for (let attempt = 0; attempt < 180; attempt++) {
                const chat = await json<ChatConversation>(session, `chat/conversations/${id}`)
                if (!chat.activeRequestId) return chat
                await delay(50)
            }
            throw new Error('Test-owned persistent Skill turn timed out.')
        }
        try {
            await boot()
            const response = await call('', 'account/register', {
                username: 'Skills process A',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent skills password',
            })
            expect(response.status).toBe(201)
            await response.json()
            const session = response.headers.get('x-harness-session')!
            const bResponse = await call('', 'account/register', {
                username: 'Skills process B',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent skills password',
            })
            expect(bResponse.status).toBe(201)
            const b = (await bResponse.json()) as { id: string }
            const model = await json<{ modelId: string }>(session, 'account/models', {
                requestId: randomUUID(),
                name: '进程本人模型',
                baseUrl: `${origin}/v1`,
                model: 'process-owner',
                apiKey: 'nonsecret-process-provider-key',
            })
            const create = {
                requestId: randomUUID(),
                title: '进程方法',
                description: '',
                content: 'PERSISTENT_METHOD_V1\n${literal.mustRemain}',
            }
            const skill = await json<SkillRecord>(session, 'chat/skills', create)
            const configuration = {
                name: '进程Agent',
                description: '',
                modelId: model.modelId,
                systemPrompt: 'PROCESS_ORIGINAL_PROMPT',
                toolIds: [],
                openingMessages: [],
            }
            const agent = await json<AgentDefinition>(session, 'chat/agents', {
                ...configuration,
                skillRefs: [{ skillId: skill.id, version: 1 }],
            })
            const original = await json<ChatConversation>(session, 'chat/conversations', { agentId: agent.id })
            const task = await json<{ id: string; agent: AgentDefinition }>(session, 'chat/tasks', {
                requestId: randomUUID(),
                title: '持久任务',
                goal: '本人目标',
                agentId: agent.id,
            })
            expect(captures).toHaveLength(0)
            await run(session, original.id)
            expect(JSON.stringify(captures.at(-1))).toContain('PERSISTENT_METHOD_V1')
            await json(session, 'chat/collaboration/commands', {
                type: 'delegate',
                requestId: randomUUID(),
                source: { kind: 'conversation', id: original.id },
                recipientId: b.id,
                title: '完整人工交接',
                goal: 'ONLY_EXPLICIT_SHARED_GOAL',
                context: 'ONLY_EXPLICIT_SHARED_CONTEXT',
            })
            await stop()

            await boot()
            expect(await json(session, 'chat/skills', create)).toEqual(skill)
            expect((await json<ChatConversation>(session, `chat/conversations/${original.id}`)).agent?.skillSnapshots).toEqual(
                agent.skillSnapshots
            )
            const edit = { requestId: randomUUID(), version: 1, title: '进程方法', description: '', content: 'PERSISTENT_METHOD_V2' }
            const v2 = await json<SkillRecord>(session, `chat/skills/${skill.id}`, edit, 'PUT')
            await json(session, `chat/agents/${agent.id}`, { ...configuration, skillRefs: [{ skillId: skill.id, version: 2 }] }, 'PUT')
            await run(session, original.id)
            expect(JSON.stringify(captures.at(-1))).toContain('PERSISTENT_METHOD_V1')
            expect(JSON.stringify(captures.at(-1))).not.toContain('PERSISTENT_METHOD_V2')
            const sourceBefore = (
                await pool.query('SELECT session_id,header FROM harness_collaboration_sources WHERE source_id=$1', [original.id])
            ).rows[0]
            expect(sourceBefore.header).not.toBeNull()
            await stop()

            await boot()
            expect(await json(session, `chat/skills/${skill.id}`, edit, 'PUT')).toEqual(v2)
            expect(await json(session, 'chat/skills', create)).toEqual(skill)
            expect(await json(session, `chat/skills/${skill.id}/versions/1`)).toEqual(skill)
            expect((await json<{ versions: unknown[] }>(session, `chat/skills/${skill.id}/versions`)).versions).toHaveLength(2)
            expect((await json<{ agent: AgentDefinition }>(session, `chat/tasks/${task.id}`)).agent.skillSnapshots).toEqual(
                agent.skillSnapshots
            )
            await pool.query('ALTER TABLE harness_skill_versions RENAME TO isolated_skill_versions')
            try {
                expect((await call(session, 'chat/skills')).status).toBe(503)
                await run(session, original.id)
            } finally {
                await pool.query('ALTER TABLE isolated_skill_versions RENAME TO harness_skill_versions')
            }
            expect(JSON.stringify(captures.at(-1))).toContain('PERSISTENT_METHOD_V1')
            expect(
                (await pool.query('SELECT session_id FROM harness_collaboration_sources WHERE source_id=$1', [original.id])).rows[0]
                    .session_id
            ).toBe(sourceBefore.session_id)
            const fresh = await json<ChatConversation>(session, 'chat/conversations', { agentId: agent.id })
            await run(session, fresh.id)
            expect(JSON.stringify(captures.at(-1))).toContain('PERSISTENT_METHOD_V2')
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_skill_actions')).rows[0].n).toBe(2)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_skill_versions')).rows[0].n).toBe(2)
        } finally {
            await stop()
            await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
            await pool.end()
            await admin.query(`DROP SCHEMA ${schema} CASCADE`)
            await admin.end()
        }
    },
    90000
)
