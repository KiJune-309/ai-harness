import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type {
    ChatConversation,
    CollaborationActionResult,
    CollaborationProject,
    CollaborationProjectProgress,
    WorkflowTemplate,
    WorkflowPreview,
    WorkflowLaunchResult,
} from '@ai-harness/contracts'
import { expect, it } from 'vitest'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'derives identical complete safe board facts across three independent production API processes without new records or model access',
    async () => {
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const schema = `sf020_process_${randomUUID().replaceAll('-', '')}`
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
        const token = 'sf020-independent-production-process-test-token'
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
                    HARNESS_WORKSPACE_ID: 'sf020-process-home',
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
                    COLLABORATION_POLL_MS: '20',
                },
                stdio: 'ignore',
            })
            for (let attempt = 0; attempt < 120; attempt++) {
                if (child.exitCode !== null) throw new Error('Test-owned Board API exited before readiness.')
                const response = await fetch(`${base}/account/me`, { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined)
                if (response?.status === 401) {
                    await response.body?.cancel()
                    return
                }
                await delay(50)
            }
            throw new Error('Test-owned Board API readiness timed out.')
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
            throw new Error('Test-owned persistent Board turn timed out.')
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
            await json<{ modelId: string }>(session, 'account/models', {
                requestId: randomUUID(),
                name: '进程本人模型',
                baseUrl: `${origin}/v1`,
                model: 'process-owner',
                apiKey: 'nonsecret-process-provider-key',
            })
            const bSession = bResponse.headers.get('x-harness-session')!
            await json(bSession, 'account/models', {
                requestId: randomUUID(),
                name: 'B本人路由',
                baseUrl: `${origin}/v1`,
                model: 'process-b',
                apiKey: 'nonsecret-process-b-key',
            })
            const registered = await json<{ user: { id: string } }>(session, 'account/me')
            const created = await json<CollaborationActionResult>(session, 'chat/collaboration/commands', {
                type: 'project-create',
                requestId: randomUUID(),
                name: '重启只读看板',
                description: 'PRIVATE_PROJECT_DESCRIPTION',
                memberIds: [b.id],
            })
            const projectPath = `chat/collaboration/projects/${created.projectId}`
            const started: CollaborationActionResult[] = []
            for (let index = 0; index < 2; index++) {
                const project = await json<CollaborationProject>(session, projectPath)
                started.push(
                    await json<CollaborationActionResult>(session, 'chat/collaboration/commands', {
                        type: 'project-start',
                        requestId: randomUUID(),
                        projectId: project.id,
                        revision: project.revision,
                        title: `本人工作${index}`,
                        goal: 'PRIVATE_GOAL',
                    })
                )
            }
            await run(session, started[0]!.conversationId!)
            await json(session, 'chat/collaboration/commands', {
                type: 'delegate',
                requestId: randomUUID(),
                source: { kind: 'conversation', id: started[0]!.conversationId },
                recipientId: b.id,
                title: '真实同事开场',
                goal: 'ONLY_EXPLICIT_SHARED_GOAL',
                context: 'ONLY_EXPLICIT_SHARED_CONTEXT',
            })
            const initial = await json<CollaborationProjectProgress>(session, `${projectPath}/progress`)
            expect(initial.nodes).toHaveLength(3)
            expect(initial.nodes.find(node => node.id === started[0]!.nodeId)).toMatchObject({ sourceAvailable: true, started: true })
            expect(initial.nodes.find(node => node.id === started[1]!.nodeId)).toMatchObject({ sourceAvailable: true, started: false })
            expect(initial.nodes.find(node => node.ownerId === b.id)).toMatchObject({ sourceAvailable: true, started: false })
            expect(initial.waits).toHaveLength(1)
            const nodeIds = [randomUUID(), randomUUID()]
            const template = await json<WorkflowTemplate>(session, 'chat/workflow-templates', {
                requestId: randomUUID(),
                name: '重启流程',
                description: '',
                nodes: [registered.user.id, b.id].map((assigneeId, index) => ({
                    id: nodeIds[index],
                    title: `固定工作${index}`,
                    goal: 'PRIVATE_FIXED_GOAL',
                    assigneeId,
                    upstreamNodeId: index === 0 ? null : nodeIds[0],
                    position: { x: index * 500, y: 100 },
                })),
            })
            const preview = await json<WorkflowPreview>(session, `chat/workflow-templates/${template.id}/preview`, {
                version: 1,
                name: '重启固定实例',
                description: '',
            })
            const launched = await json<WorkflowLaunchResult>(session, `chat/workflow-templates/${template.id}/launch`, {
                requestId: randomUUID(),
                previewId: preview.previewId,
            })
            const workflowPath = `chat/collaboration/projects/${launched.projectId}/progress`
            const workflow = await json<CollaborationProjectProgress>(session, workflowPath)
            expect(workflow.nodes.every(node => node.sourceAvailable && node.started === false)).toBe(true)
            expect(captures.length).toBeGreaterThan(0)
            const callsBefore = captures.length
            const rowsBefore = (await pool.query('SELECT data FROM harness_collaboration_state')).rows
            const sourcesBefore = (
                await pool.query('SELECT source_id,session_id,header FROM harness_collaboration_sources ORDER BY source_id')
            ).rows
            const countsBefore = (
                await pool.query(
                    'SELECT (SELECT count(*) FROM harness_chat_conversations)::int AS chats,(SELECT count(*) FROM harness_collaboration_jobs)::int AS jobs'
                )
            ).rows
            await stop()
            await pool.query("UPDATE harness_account_models SET data=jsonb_set(data,'{encryptedApiKey}',$1::jsonb)", [
                JSON.stringify('test-owned-unreadable-cipher'),
            ])
            for (let bootIndex = 0; bootIndex < 2; bootIndex++) {
                await boot()
                for (let read = 0; read < 3; read++) {
                    expect(await json(session, `${projectPath}/progress`)).toEqual(initial)
                    expect(await json(session, workflowPath)).toEqual(workflow)
                }
                expect((await pool.query('SELECT data FROM harness_collaboration_state')).rows).toEqual(rowsBefore)
                expect(
                    (await pool.query('SELECT source_id,session_id,header FROM harness_collaboration_sources ORDER BY source_id')).rows
                ).toEqual(sourcesBefore)
                expect(
                    (
                        await pool.query(
                            'SELECT (SELECT count(*) FROM harness_chat_conversations)::int AS chats,(SELECT count(*) FROM harness_collaboration_jobs)::int AS jobs'
                        )
                    ).rows
                ).toEqual(countsBefore)
                expect(captures).toHaveLength(callsBefore)
                await stop()
            }
            expect(
                (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE '%board%'")).rows
            ).toEqual([])
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
