import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { ChatConversation, CollaborationProject, WorkflowTemplate, WorkflowPreview, WorkflowLaunchResult } from '@ai-harness/contracts'
import { createChatStore, type ChatStore } from '@ai-harness/db'
import { expect, it } from 'vitest'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'restores saved workflow layout, frozen launch, exact fixed draft and one-time confirmation across independent production API processes',
    async () => {
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const schema = `sf018_process_${randomUUID().replaceAll('-', '')}`
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const reservation = createServer()
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
        const port = (reservation.address() as AddressInfo).port
        await new Promise<void>((resolve, reject) => reservation.close(error => (error ? reject(error) : resolve())))
        const token = 'sf018-independent-process-private-test-token'
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
                    HARNESS_WORKSPACE_ID: 'sf018-process-home',
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
        let store: ChatStore | undefined
        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            await boot()
            const ownerResponse = await call('', 'account/register', {
                username: 'Workflow process owner',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent workflow password',
            })
            expect(ownerResponse.status).toBe(201)
            const owner = (await ownerResponse.json()) as { id: string }
            const ownerSession = ownerResponse.headers.get('x-harness-session')!
            const memberResponse = await call('', 'account/register', {
                username: 'Workflow process member',
                email: `${randomUUID()}@example.test`,
                password: 'Persistent workflow password',
            })
            expect(memberResponse.status).toBe(201)
            const member = (await memberResponse.json()) as { id: string }
            const memberSession = memberResponse.headers.get('x-harness-session')!
            const ids = [randomUUID(), randomUUID()]
            const creation = {
                requestId: randomUUID(),
                name: '进程持久协作模板',
                description: '模板说明',
                nodes: [owner.id, member.id].map((assigneeId, index) => ({
                    id: ids[index],
                    title: `稳定工作${index}`,
                    goal: `持久目标${index}\n第二行`,
                    assigneeId,
                    upstreamNodeId: index === 0 ? null : ids[0],
                    position: { x: 120 + 600 * index, y: 100 + 600 * index },
                })),
            }
            const created = await call(ownerSession, 'chat/workflow-templates', creation)
            expect(created.ok).toBe(true)
            const template = (await created.json()) as WorkflowTemplate
            const path = `chat/workflow-templates/${template.id}`
            const previewResponse = await call(ownerSession, `${path}/preview`, { version: 1, name: '进程实例', description: '共享范围' })
            expect(previewResponse.ok).toBe(true)
            const preview = (await previewResponse.json()) as WorkflowPreview
            const launch = { requestId: randomUUID(), previewId: preview.previewId }
            const launchedResponse = await call(ownerSession, `${path}/launch`, launch)
            expect(launchedResponse.ok).toBe(true)
            const launched = (await launchedResponse.json()) as WorkflowLaunchResult
            const projectPath = `chat/collaboration/projects/${launched.projectId}`
            const project = (await (await call(ownerSession, projectPath)).json()) as CollaborationProject
            const own = project.nodes.find(node => node.ownerId === owner.id)!
            const memberProject = (await (await call(memberSession, projectPath)).json()) as CollaborationProject
            const target = memberProject.nodes.find(node => node.ownerId === member.id)!
            const targetPath = `chat/conversations/${target.source!.id}`
            expect(((await (await call(memberSession, targetPath)).json()) as ChatConversation).messages[0]!.content).toBe(
                preview.nodes[1]!.opening
            )
            store = await createChatStore({ databaseUrl: url.toString() })
            const scope = { workspaceId: 'sf018-process-home', userId: owner.id }
            await store.collaboration!.enqueue(scope, { requestId: randomUUID(), source: own.source!, content: '请把方案交给下游处理' })
            const lease = (await store.collaboration!.claim(30_000))!
            const action = (await store.collaboration!.fixedActions(lease)).actions[0]!
            expect(action.targetNodeId).toBe(target.id)
            const draft = await store.collaboration!.propose(
                scope,
                {
                    type: 'fixed-contact',
                    requestId: randomUUID(),
                    contactRequestId: action.id,
                    content: 'PERSISTENT_FIXED_PROCESS_BODY\n完整第二行',
                },
                { authorKind: 'agent', lease }
            )
            await store.collaboration!.settle(lease, { status: 'waiting' })
            const binding = (await pool.query('SELECT source_id,session_id,bound FROM harness_collaboration_sources ORDER BY source_id'))
                .rows
            await stop()
            await boot()
            expect(await (await call(ownerSession, path)).json()).toEqual(template)
            expect(await (await call(ownerSession, 'chat/workflow-templates', creation)).json()).toEqual(template)
            expect(await (await call(ownerSession, `${path}/launch`, launch)).json()).toEqual(launched)
            const sourcePage = (await (
                await call(ownerSession, `chat/collaboration/source-events?sourceKind=conversation&sourceId=${own.source!.id}`)
            ).json()) as { pendingDispatches: { id: string; version: number; content: string }[] }
            expect(sourcePage.pendingDispatches.find(item => item.id === draft.draftId)!.content).toBe(
                'PERSISTENT_FIXED_PROCESS_BODY\n完整第二行'
            )
            const confirmation = { type: 'confirm-dispatch', requestId: randomUUID(), draftId: draft.draftId, version: draft.draftVersion }
            const sentResponse = await call(ownerSession, 'chat/collaboration/commands', confirmation)
            expect(sentResponse.ok).toBe(true)
            const sent = await sentResponse.json()
            await stop()
            await boot()
            expect(await (await call(ownerSession, `${path}/launch`, launch)).json()).toEqual(launched)
            expect(await (await call(ownerSession, 'chat/collaboration/commands', confirmation)).json()).toEqual(sent)
            const restoredTarget = (await (await call(memberSession, targetPath)).json()) as ChatConversation
            expect(restoredTarget.messages.filter(message => message.content.includes('PERSISTENT_FIXED_PROCESS_BODY'))).toHaveLength(1)
            expect(restoredTarget.messages[0]!.content).toBe(preview.nodes[1]!.opening)
            expect(
                (await pool.query('SELECT source_id,session_id,bound FROM harness_collaboration_sources ORDER BY source_id')).rows
            ).toEqual(binding)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(2)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_workflow_launches')).rows[0].n).toBe(1)
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations WHERE task_data IS NOT NULL')).rows[0].n
            ).toBe(0)
            expect(((await (await call(ownerSession, projectPath)).json()) as CollaborationProject).nodes).toHaveLength(2)
        } finally {
            await stop()
            await store?.close()
            await pool.end()
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    45000
)
