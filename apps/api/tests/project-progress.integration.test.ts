import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type {
    ChatConversation,
    CollaborationActionResult,
    CollaborationDispatch,
    CollaborationProject,
    CollaborationProjectProgress,
} from '@ai-harness/contracts'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { expect, it } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig } from './config-fixture.js'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

/**
 * Waits for real durable worker settlement with a bounded deadline.
 * @param read - Read-only actual API or database observation.
 * @param accept - Required persisted condition.
 * @returns The first accepted observation.
 * @throws Error when no accepted state is observed within the deadline.
 */
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; attempt < 150; attempt++) {
        const value = await read()
        if (accept(value)) return value
        await delay(50)
    }
    throw new Error('Controlled three-person collaboration did not reach the expected durable state.')
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'starts private work without decrypting credentials and preserves real A to B to C plus exact reverse replies through owner-confirmed drafts',
    async () => {
        const schema = `sf017_api_${randomUUID().replaceAll('-', '')}`
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const pool = new pg.Pool({ connectionString: url.toString() })
        const people = new Map<string, { id: string; session: string; modelId?: string }>()
        const calls: { model: string; key: string; text: string; tools: string[] }[] = []
        const emitted = new Set<string>()
        const provider = createServer(async (request, response) => {
            let raw = ''
            for await (const chunk of request) raw += String(chunk)
            const body = JSON.parse(raw) as {
                model: string
                messages: unknown[]
                tools?: { function: { name: string; parameters: { properties: { slotId: { enum: string[] } } } } }[]
            }
            const text = JSON.stringify(body.messages)
            calls.push({
                model: body.model,
                key: request.headers.authorization ?? '',
                text,
                tools: body.tools?.map(tool => tool.function.name) ?? [],
            })
            let tool: { name: string; args: object } | undefined
            for (const [model, marker, name, slot, content] of [
                ['A', 'REQUEST_HANDOFF_B', 'collaboration_handoff', `contact:${people.get('B')?.id}`, 'SHARED_B_ASSESSMENT_REQUEST'],
                ['B', 'REQUEST_QUESTION_A', 'collaboration_question', 'upstream', 'PRIVATE_QUESTION_B_TO_A'],
                ['A', 'REQUEST_EXACT_ANSWER', 'collaboration_reply', '', 'EXACT_ANSWER_500QPS'],
                ['B', 'REQUEST_HANDOFF_C', 'collaboration_handoff', `contact:${people.get('C')?.id}`, 'SHARED_C_ASSESSMENT_REQUEST'],
            ]) {
                const key = `${body.model}:${marker}`
                const metadata = body.tools?.find(candidate => candidate.function.name === name)
                if (body.model !== model || !text.includes(marker!) || emitted.has(key) || !metadata) continue
                emitted.add(key)
                tool = {
                    name: name!,
                    args: {
                        slotId: slot || metadata.function.parameters.properties.slotId.enum[0],
                        content,
                        ...(name === 'collaboration_handoff' ? { title: marker === 'REQUEST_HANDOFF_B' ? 'B评估' : 'C评估' } : {}),
                    },
                }
                break
            }
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            if (tool)
                response.end(
                    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
                )
            else
                response.end(
                    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${body.model}的私人分析已完成。` }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
                )
        })
        await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
        const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
        const config = readTestApiConfig({
            DATABASE_URL: url.toString(),
            HARNESS_WORKSPACE_ID: schema,
            HARNESS_API_TOKEN: 'sf017-controlled-provider-private-server-token',
            OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
            COLLABORATION_POLL_MS: '20',
        })
        let app: NestExpressApplication | undefined
        let base = ''

        /**
         * Calls actual guarded API endpoints using a real opaque human session.
         * @param owner - Fixture account name, empty for registration.
         * @param path - API path.
         * @param body - Optional strict JSON mutation.
         * @returns Unconsumed real HTTP response.
         */
        async function call(owner: string, path: string, body?: unknown): Promise<Response> {
            return fetch(`${base}/${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers: {
                    authorization: `Bearer ${config.token}`,
                    'content-type': 'application/json',
                    'x-harness-session': people.get(owner)?.session ?? '',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }

        /**
         * Reads confirmed API JSON while keeping private headers out of failure diagnostics.
         * @param owner - Actual source owner.
         * @param path - API route.
         * @param body - Optional strict mutation.
         * @returns Confirmed public result.
         */
        async function json<T>(owner: string, path: string, body?: unknown): Promise<T> {
            const response = await call(owner, path, body)
            expect(response.ok, path).toBe(true)
            return response.json() as Promise<T>
        }

        /**
         * Sends an original owner input through its real bound ordinary chat and waits for settlement.
         * @param owner - Actual private chat owner.
         * @param id - Persisted ordinary conversation.
         * @param content - Actual owner prompt.
         * @param recipient - Optional explicitly selected colleague mention.
         * @returns The saved private conversation after its real Cordis turn.
         */
        async function input(owner: string, id: string, content: string, recipient?: string): Promise<ChatConversation> {
            const response = await call(owner, `chat/conversations/${id}/messages`, {
                requestId: randomUUID(),
                content: recipient ? content.replace(`@${recipient}`, `@Person ${recipient}`) : content,
                ...(recipient
                    ? {
                          mentions: [
                              { userId: people.get(recipient)!.id, name: `Person ${recipient}`, start: 0, end: recipient.length + 8 },
                          ],
                      }
                    : {}),
            })
            expect(response.ok, `${owner}: ${content}: ${response.status} ${response.ok ? '' : await response.text()}`).toBe(true)
            await response.text()
            return until(
                () => json<ChatConversation>(owner, `chat/conversations/${id}`),
                chat => !chat.activeRequestId
            )
        }

        /**
         * Reads exact persisted source events, including immutable pending draft previews.
         * @param owner - Actual source owner.
         * @param id - Source conversation.
         * @returns The source projection.
         */
        async function events(owner: string, id: string) {
            return json<{
                pendingDispatches: CollaborationDispatch[]
                questions: { id: string; status: string }[]
                sourceState?: { activeRequestId?: string }
            }>(owner, `chat/collaboration/source-events?sourceKind=conversation&sourceId=${id}`)
        }

        /**
         * Confirms only the exact immutable human-reviewed preview and verifies duplicate delivery protection.
         * @param owner - Authenticated source owner.
         * @param id - Source conversation.
         * @returns The reviewed preview and its committed delivery result.
         */
        async function confirm(owner: string, id: string) {
            const page = await until(
                () => events(owner, id),
                value => !value.sourceState?.activeRequestId && value.pendingDispatches.some(draft => draft.status === 'pending')
            )
            const draft = page.pendingDispatches.find(value => value.status === 'pending')!
            const action = { type: 'confirm-dispatch', requestId: randomUUID(), draftId: draft.id, version: draft.version }
            const result = await json<CollaborationActionResult>(owner, 'chat/collaboration/commands', action)
            expect(await json(owner, 'chat/collaboration/commands', action)).toEqual(result)
            return { draft, result }
        }

        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            app = await createApiApp(config, {
                logger: false,
                knowledgeWorkerOptions: { enabled: false },
                vectorWorkerOptions: { enabled: false },
            })
            await app.listen(0, '127.0.0.1')
            base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`
            for (const name of ['A', 'B', 'C', 'D']) {
                const registered = await call('', 'account/register', {
                    username: `Person ${name}`,
                    email: `${name.toLowerCase()}@${schema.replaceAll('_', '-')}.test`,
                    password: 'Controlled progress password',
                })
                expect(registered.status).toBe(201)
                people.set(name, {
                    id: ((await registered.json()) as { id: string }).id,
                    session: registered.headers.get('x-harness-session')!,
                })
                if (name !== 'D')
                    people.get(name)!.modelId = (
                        await json<{ id: string }>(name, 'account/models', {
                            requestId: randomUUID(),
                            name: `${name}个人连接`,
                            baseUrl: `${origin}/v1`,
                            model: name,
                            apiKey: `fixture-key-${name}`,
                        })
                    ).id
            }
            const created = await json<CollaborationActionResult>('A', 'chat/collaboration/commands', {
                type: 'project-create',
                requestId: randomUUID(),
                name: '三人责任链',
                description: 'PRIVATE_PROJECT_DESCRIPTION_NOT_FOR_MODEL',
                memberIds: [people.get('B')!.id, people.get('C')!.id],
            })
            const projectPath = `chat/collaboration/projects/${created.projectId}`
            let project = await json<CollaborationProject>('A', projectPath)
            await json('A', 'chat/collaboration/commands', {
                type: 'note-publish',
                requestId: randomUUID(),
                projectId: project.id,
                revision: project.revision,
                title: '私有注入检查',
                content: 'PRIVATE_PROJECT_NOTES_NOT_FOR_MODEL',
            })
            project = await json('A', projectPath)
            const start = {
                type: 'project-start',
                requestId: randomUUID(),
                projectId: project.id,
                revision: project.revision,
                title: 'A本人工作',
                goal: 'PRIVATE_EXPLICIT_A_GOAL',
            }
            for (const fields of [
                { title: '' },
                { title: '名'.repeat(121) },
                { goal: ' '.repeat(2) },
                { goal: '目'.repeat(32001) },
                { ownerId: people.get('B')!.id },
            ])
                expect((await call('A', 'chat/collaboration/commands', { ...start, ...fields, requestId: randomUUID() })).status).toBe(400)
            expect((await call('D', 'chat/collaboration/commands', start)).status).toBe(404)
            const originalModel = (
                await pool.query('SELECT data FROM harness_account_models WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                    schema,
                    people.get('A')!.id,
                    people.get('A')!.modelId,
                ])
            ).rows[0].data
            await pool.query(
                "UPDATE harness_account_models SET data=jsonb_set(data,'{encryptedApiKey}','\"invalid-fixture-ciphertext\"'::jsonb) WHERE workspace_id=$1 AND user_id=$2 AND id=$3",
                [schema, people.get('A')!.id, people.get('A')!.modelId]
            )
            const started = await json<CollaborationActionResult>('A', 'chat/collaboration/commands', start)
            expect(await json('A', 'chat/collaboration/commands', start)).toEqual(started)
            const aChat = started.conversationId!
            expect((await json<ChatConversation>('A', `chat/conversations/${aChat}`)).messages).toEqual([])
            expect(calls).toHaveLength(0)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_jobs')).rows[0].n).toBe(0)
            expect((await json<{ notifications: unknown[] }>('B', 'chat/collaboration/notifications')).notifications).toEqual([])
            await pool.query('UPDATE harness_account_models SET data=$4::jsonb WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                schema,
                people.get('A')!.id,
                people.get('A')!.modelId,
                JSON.stringify(originalModel),
            ])
            const aSession = (
                await pool.query(
                    'SELECT session_id FROM harness_collaboration_sources WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3',
                    [schema, people.get('A')!.id, aChat]
                )
            ).rows[0].session_id
            await input('A', aChat, 'PRIVATE_A_ANALYSIS 请先在本聊天分析目标，不要联系同事。')
            expect(calls[0]).toMatchObject({
                model: 'A',
                key: 'Bearer fixture-key-A',
                text: expect.stringContaining('PRIVATE_EXPLICIT_A_GOAL'),
            })
            expect(calls.every(call => !/PRIVATE_PROJECT_(DESCRIPTION|NOTES)_NOT_FOR_MODEL/.test(call.text))).toBe(true)
            await pool.query('ALTER TABLE harness_collaboration_state RENAME TO sf017_unavailable_state')
            try {
                expect((await call('A', `${projectPath}/progress`)).status).toBe(503)
            } finally {
                await pool.query('ALTER TABLE sf017_unavailable_state RENAME TO harness_collaboration_state')
            }
            expect((await json<CollaborationProjectProgress>('A', `${projectPath}/progress`)).nodes).toHaveLength(1)
            expect((await events('A', aChat)).pendingDispatches).toEqual([])
            await input('A', aChat, '@B 请评估当前事项，先起草交接让我确认。REQUEST_HANDOFF_B', 'B')
            expect((await json<CollaborationProjectProgress>('A', `${projectPath}/progress`)).nodes).toHaveLength(1)
            const bSent = await confirm('A', aChat)
            expect(bSent.result.projectId).toBe(project.id)
            expect(bSent.draft.recipientName).toBe('Person B')
            const bChat = bSent.result.conversationId!
            const bNode = bSent.result.nodeId!
            expect((await json<ChatConversation>('B', `chat/conversations/${bChat}`)).messages).toMatchObject([
                { role: 'assistant', kind: 'opening' },
            ])
            expect(calls.filter(call => call.model === 'B')).toHaveLength(0)
            const bSession = (
                await pool.query(
                    'SELECT session_id FROM harness_collaboration_sources WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3',
                    [schema, people.get('B')!.id, bChat]
                )
            ).rows[0].session_id
            await input('B', bChat, 'PRIVATE_B_ANALYSIS 先帮我理解收到的工作，不要回传。')
            await input('B', bChat, '确认')
            expect((await events('B', bChat)).pendingDispatches).toEqual([])
            await input('B', bChat, '请向上游A补问约束，先给我完整发送草稿。REQUEST_QUESTION_A')
            const beforeAsk = await events('A', aChat)
            expect(beforeAsk.questions).toHaveLength(1)
            expect(
                (await json<ChatConversation>('A', `chat/conversations/${aChat}`)).messages.some(message =>
                    message.content.includes('PRIVATE_QUESTION_B_TO_A')
                )
            ).toBe(false)
            const asked = await confirm('B', bChat)
            expect(asked.draft.kind).toBe('ask')
            const waiting = await json<CollaborationProjectProgress>('A', `${projectPath}/progress`)
            expect(
                waiting.waits.some(wait => wait.kind === 'upstream' && wait.fromNodeId === bNode && wait.targetNodeId === started.nodeId)
            ).toBe(true)
            expect(JSON.stringify(waiting)).not.toMatch(/PRIVATE_|goal|context|question|answer|sourceId|source_id|apiKey/)
            expect((await events('A', aChat)).questions.some(question => question.id === asked.result.questionId)).toBe(true)
            await input('A', aChat, '确认')
            expect((await events('A', aChat)).pendingDispatches.filter(draft => draft.status === 'pending')).toEqual([])
            await input('A', aChat, '请将“EXACT_ANSWER_500QPS”回复给刚才向我提问的B，先给我确认。REQUEST_EXACT_ANSWER')
            expect((await events('A', aChat)).questions.find(question => question.id === asked.result.questionId)?.status).toBe('pending')
            const answered = await confirm('A', aChat)
            expect(answered.draft.kind).toBe('answer')
            expect(answered.draft.questionId).toBe(asked.result.questionId)
            await until(
                () => json<ChatConversation>('B', `chat/conversations/${bChat}`),
                chat => !chat.activeRequestId && chat.messages.some(message => message.content.includes('EXACT_ANSWER_500QPS'))
            )
            expect(
                (await json<ChatConversation>('B', `chat/conversations/${bChat}`)).messages.filter(message =>
                    message.content.includes('EXACT_ANSWER_500QPS')
                )
            ).toHaveLength(1)
            await input('B', bChat, '@C 请评估刚才澄清后的事项，先给我交接草稿。REQUEST_HANDOFF_C', 'C')
            const cSent = await confirm('B', bChat)
            expect(cSent.result.projectId).toBe(project.id)
            const progress = await json<CollaborationProjectProgress>('C', `${projectPath}/progress`)
            expect(progress.nodes).toHaveLength(3)
            expect(progress.nodes.find(node => node.id === bNode)?.upstreamNodeId).toBe(started.nodeId)
            expect(progress.nodes.find(node => node.id === cSent.result.nodeId)?.upstreamNodeId).toBe(bNode)
            expect(progress.nodes.filter(node => node.ownHref).map(node => node.ownerId)).toEqual([people.get('C')!.id])
            expect((await call('A', `chat/conversations/${cSent.result.conversationId}`)).status).toBe(404)
            expect((await call('D', `${projectPath}/progress`)).status).toBe(404)
            expect(calls.filter(call => call.model === 'C')).toHaveLength(0)
            expect(
                (
                    await pool.query(
                        'SELECT session_id FROM harness_collaboration_sources WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3',
                        [schema, people.get('A')!.id, aChat]
                    )
                ).rows[0].session_id
            ).toBe(aSession)
            expect(
                (
                    await pool.query(
                        'SELECT session_id FROM harness_collaboration_sources WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3',
                        [schema, people.get('B')!.id, bChat]
                    )
                ).rows[0].session_id
            ).toBe(bSession)
            expect(calls.filter(call => call.model === 'B').at(-1)?.text).toContain('PRIVATE_B_ANALYSIS')
            expect((await json<{ projects: CollaborationProject[] }>('A', 'chat/collaboration/projects')).projects).toHaveLength(1)
            expect(calls.every(call => !/PRIVATE_PROJECT_(DESCRIPTION|NOTES)_NOT_FOR_MODEL/.test(call.text))).toBe(true)
        } finally {
            await app?.close()
            await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
            await pool.end()
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    60000
)
