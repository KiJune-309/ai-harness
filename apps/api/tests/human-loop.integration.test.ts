import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { AgentDefinition, ChatConversation, HumanRequest, ProjectFolder } from '@ai-harness/contracts'
import { createCollaborationRuntime } from '@ai-harness/chat-runtime/collaboration'
import { createChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { expect, it } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

/** Provider messages recorded only inside this isolated fixture. */
interface ProviderBody {
    messages: { role: string; content: string; tool_call_id?: string }[]
    tools?: { function: { name: string } }[]
}

/**
 * Encode one actual OpenAI-compatible provider response without using a model stub.
 * @param delta - Native text or tool-call response body.
 * @param finish - Native finish reason.
 * @returns Complete SSE bytes for the real adapter.
 */
function providerStream(delta: Record<string, unknown>, finish = 'stop'): string {
    return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`
}

/**
 * Wait for an actual durable conversation state rather than its accepted acknowledgement.
 * @param read - Authenticated read of the precise conversation.
 * @param accept - Required durable state.
 * @returns The accepted actual conversation.
 * @throws Error if the isolated worker fails to settle within the bounded deadline.
 */
async function settled(
    read: () => Promise<ChatConversation>,
    accept: (conversation: ChatConversation) => boolean
): Promise<ChatConversation> {
    let current: ChatConversation | undefined
    await expect
        .poll(
            async () => {
                current = await read()
                return accept(current)
            },
            { interval: 50, timeout: 15_000 }
        )
        .toBe(true)
        .catch(error => {
            throw new Error(`Actual private fixture state: ${JSON.stringify(current)}`, { cause: error })
        })
    return current!
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'resumes exact private questions and tool approvals through real HTTP, PostgreSQL and a fresh Cordis process graph',
    async () => {
        const schema = `sf022_http_${randomUUID().replaceAll('-', '')}`
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const database = new URL(process.env.TEST_DATABASE_URL!)
        database.searchParams.set('options', `-c search_path=${schema}`)
        const pool = new pg.Pool({ connectionString: database.toString() })
        const observed: ProviderBody[] = []
        const runtimeErrors: string[] = []
        let behavior: 'question' | 'effect' | 'read' | 'plain' = 'question'
        let issueNextCall = true
        const provider = createServer(async (request, response) => {
            let raw = ''
            for await (const bytes of request) raw += String(bytes)
            const body = JSON.parse(raw) as ProviderBody
            observed.push(body)
            const result = body.messages.findLast(message => message.role === 'tool')
            const name = behavior === 'question' ? 'ask-human' : behavior === 'read' ? 'calculator' : 'fixture-write'
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            if (behavior === 'plain' || !issueNextCall) {
                response.end(providerStream({ content: `继续原工作：${result?.content ?? '新的本人要求'}` }))
                return
            }
            issueNextCall = false
            const args =
                behavior === 'question'
                    ? { question: '这份方案主要面向谁？', context: '需要明确目标读者。', options: ['工程团队', '产品团队'] }
                    : behavior === 'read'
                      ? { expression: '12 * 34' }
                      : { value: '必须与完整预览一致的正文' }
            response.end(
                providerStream(
                    {
                        ...(behavior === 'question' ? { content: '先保留这段分析，随后需要你补充目标读者。' } : {}),
                        tool_calls: [
                            {
                                index: 0,
                                id: `call-${behavior}-${randomUUID()}`,
                                type: 'function',
                                function: { name, arguments: JSON.stringify(args) },
                            },
                        ],
                    },
                    'tool_calls'
                )
            )
        })
        await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
        const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
        const config = readTestApiConfig({
            DATABASE_URL: database.toString(),
            HARNESS_WORKSPACE_ID: schema,
            HARNESS_API_TOKEN: 'sf022-isolated-http-server-token-2026',
            DEEPSEEK_API_KEY: 'sf022-controlled-provider-fixture-key',
            DEEPSEEK_BASE_URL: origin,
            OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
            COLLABORATION_POLL_MS: '20',
        })
        const userId = randomUUID()
        const strangerId = randomUUID()
        let app: NestExpressApplication | undefined
        let base = ''
        let headers: Record<string, string>
        let strangerHeaders: Record<string, string>
        /**
         * Start a fresh application and runtime graph against the same isolated durable records.
         * @returns After actual HTTP is listening and authentic sessions are ready.
         */
        async function start(): Promise<void> {
            const store = await createChatStore({ databaseUrl: database.toString() })
            if (!headers) headers = await sessionHeaders(store, config, userId)
            if (!strangerHeaders) strangerHeaders = await sessionHeaders(store, config, strangerId)
            const runtime = await createCollaborationRuntime(
                {
                    apiKey: config.apiKey,
                    baseUrl: config.baseUrl,
                    model: config.model,
                    allowedLocalOrigins: config.allowedLocalOrigins,
                },
                {
                    tools: [
                        {
                            definition: {
                                name: 'fixture-write',
                                description: 'Isolated test-only business write. Never a production capability.',
                                parameters: {
                                    type: 'object',
                                    properties: { value: { type: 'string' } },
                                    required: ['value'],
                                    additionalProperties: false,
                                },
                                output: {
                                    schema: {
                                        type: 'object',
                                        properties: { saved: { type: 'boolean' } },
                                        required: ['saved'],
                                        additionalProperties: false,
                                    },
                                    /**
                                     * Render only the non-secret result of the test-owned business effect.
                                     * @param _args - Frozen original business arguments.
                                     * @param value - Validated canonical test result.
                                     * @returns Safe text for the owner and model.
                                     */
                                    render(_args, value) {
                                        return [
                                            { type: 'text', text: (value as { saved: boolean }).saved ? '已提交隔离业务正文' : '未保存' },
                                        ]
                                    },
                                },
                                /**
                                 * Commit one test effect under the exact original call identity.
                                 * @param args - Actual schema-validated frozen arguments.
                                 * @param exec - Original tool identity and cancellation signal.
                                 * @returns Safe model-visible business result.
                                 */
                                async execute(args, exec) {
                                    exec.signal.throwIfAborted()
                                    await pool.query('INSERT INTO fixture_effects(call_id,value) VALUES($1,$2)', [
                                        exec.callId,
                                        (args as { value: string }).value,
                                    ])
                                    return { saved: true }
                                },
                            },
                            policy: {
                                effect: 'write',
                                version: 'fixture-v1',
                                /**
                                 * Describe the precise test-owned effect without model-authored permission claims.
                                 * @returns The complete non-secret effect target and scope.
                                 */
                                preview() {
                                    return { action: '写入隔离业务正文', target: 'fixture_effects', scope: '仅本测试私有数据库表' }
                                },
                            },
                        },
                    ],
                }
            )
            app = await createApiApp(config, {
                store,
                collaborationRuntime: {
                    /**
                     * Retain isolated runtime diagnostics when the worker correctly redacts public failures.
                     * @param input - Lease-bound actual runtime request.
                     * @returns The real runtime result.
                     * @throws The original error after recording fixture-only stack information.
                     */
                    async run(input) {
                        try {
                            return await runtime.run(input)
                        } catch (error) {
                            runtimeErrors.push(error instanceof Error ? (error.stack ?? error.message) : String(error))
                            throw error
                        }
                    },
                    /**
                     * Dispose the actual test-owned Cordis graph.
                     * @returns After the real runtime has closed.
                     */
                    dispose: () => runtime.dispose(),
                },
                logger: false,
                knowledgeWorkerOptions: { enabled: false },
                vectorWorkerOptions: { enabled: false },
            })
            await app.listen(0, '127.0.0.1')
            base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/chat`
        }
        /**
         * Call a genuine private endpoint and check its actual response status.
         * @param path - Exact chat-relative route.
         * @param body - Optional mutation body.
         * @param status - Expected real HTTP status.
         * @param auth - Real persisted session headers.
         * @returns Parsed public JSON.
         */
        async function json<T>(path: string, body?: unknown, status = body === undefined ? 200 : 201, auth = headers): Promise<T> {
            const response = await fetch(`${base}/${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers: auth,
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
            const value: unknown = await response.json()
            expect(response.status, `${path}: ${JSON.stringify(value)}`).toBe(status)
            return value as T
        }
        /**
         * Send one true human input through the normal streaming endpoint.
         * @param id - Existing private conversation.
         * @param content - Original human content.
         * @param extra - Exact optional human response binding or retained action identity.
         * @returns Accepted server events.
         */
        async function send(id: string, content: string, extra: Record<string, unknown> = {}): Promise<string> {
            const response = await fetch(`${base}/conversations/${id}/messages`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ content, requestId: randomUUID(), ...extra }),
            })
            expect(response.status).toBe(201)
            return response.text()
        }
        /**
         * Create a normal empty private chat and wait for one persisted human request.
         * @returns The original conversation and immutable request.
         */
        async function waiting(): Promise<{ conversation: ChatConversation; request: HumanRequest }> {
            issueNextCall = true
            const conversation = await json<ChatConversation>('conversations', { title: '本人等待测试' })
            await send(conversation.id, behavior === 'question' ? '请先澄清目标读者' : '请执行隔离测试写入')
            const page = await settled(
                () => json<ChatConversation>(`conversations/${conversation.id}`),
                value => !value.activeRequestId && Boolean(value.humanRequests?.some(request => request.status === 'pending'))
            ).catch(error => {
                throw new Error(`Fixture runtime diagnostics: ${JSON.stringify({ runtimeErrors, providerCalls: observed.length })}`, {
                    cause: error,
                })
            })
            return { conversation: page, request: page.humanRequests!.find(request => request.status === 'pending')! }
        }
        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            await pool.query('CREATE TABLE fixture_effects(call_id text PRIMARY KEY,value text NOT NULL)')
            await start()
            const question = await waiting()
            expect(question.request.kind).toBe('question')
            const callCount = observed.length
            expect((await json<ChatConversation>(`conversations/${question.conversation.id}`)).humanRequests).toEqual(
                question.conversation.humanRequests
            )
            expect(observed).toHaveLength(callCount)
            await json(`conversations/${question.conversation.id}`, undefined, 404, strangerHeaders)
            await app!.close()
            app = undefined
            await start()
            const restored = await json<ChatConversation>(`conversations/${question.conversation.id}`)
            expect(restored.humanRequests![0]).toEqual(question.request)
            expect(observed).toHaveLength(callCount)
            const answerId = randomUUID()
            const binding = { requestId: answerId, humanResponse: { requestId: question.request.id, version: question.request.version } }
            await send(question.conversation.id, '工程团队', binding)
            const answered = await settled(
                () => json<ChatConversation>(`conversations/${question.conversation.id}`),
                value =>
                    !value.activeRequestId &&
                    value.messages.some(message => message.role === 'assistant' && message.content.includes('工程团队'))
            )
            expect(answered.messages.filter(message => message.role === 'user' && message.content === '工程团队')).toHaveLength(1)
            expect(answered.messages.some(message => message.role === 'assistant' && message.content.includes('先保留这段分析'))).toBe(true)
            await send(question.conversation.id, '工程团队', binding)
            expect(observed).toHaveLength(callCount + 1)
            const stale = await fetch(`${base}/conversations/${question.conversation.id}/messages`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ content: '另一答案', requestId: randomUUID(), humanResponse: binding.humanResponse }),
            })
            expect(stale.status).toBe(409)
            await stale.body?.cancel()

            behavior = 'effect'
            const approval = await waiting()
            expect(approval.request.kind).toBe('approval')
            if (approval.request.kind !== 'approval') throw new Error('Expected exact approval request.')
            expect(approval.request.approval.arguments).toEqual({ value: '必须与完整预览一致的正文' })
            expect((await pool.query('SELECT * FROM fixture_effects')).rowCount).toBe(0)
            const action = { actionId: randomUUID(), version: approval.request.version, decision: 'approve' }
            await json(
                `conversations/${approval.conversation.id}/human-requests/${approval.request.id}/decisions`,
                action,
                404,
                strangerHeaders
            )
            await app!.close()
            app = undefined
            await start()
            await json(`conversations/${approval.conversation.id}/human-requests/${approval.request.id}/decisions`, action)
            const executed = await settled(
                () => json<ChatConversation>(`conversations/${approval.conversation.id}`),
                value => !value.activeRequestId && value.humanRequests?.some(request => request.status === 'succeeded') === true
            )
            expect(
                executed.messages.at(-1)!.content,
                JSON.stringify({ executed, runtimeErrors, providerCalls: observed.length })
            ).toContain('已提交隔离业务正文')
            await json(`conversations/${approval.conversation.id}/human-requests/${approval.request.id}/decisions`, action)
            expect((await pool.query('SELECT * FROM fixture_effects')).rows).toEqual([
                { call_id: expect.stringMatching(/^call-effect-/), value: '必须与完整预览一致的正文' },
            ])

            const refusal = await waiting()
            await json(`conversations/${refusal.conversation.id}/human-requests/${refusal.request.id}/decisions`, {
                actionId: randomUUID(),
                version: refusal.request.version,
                decision: 'reject',
            })
            await settled(
                () => json<ChatConversation>(`conversations/${refusal.conversation.id}`),
                value => !value.activeRequestId && value.humanRequests?.some(request => request.status === 'rejected') === true
            )
            expect((await pool.query('SELECT * FROM fixture_effects')).rowCount).toBe(1)
            const replaced = await waiting()
            behavior = 'plain'
            await send(replaced.conversation.id, '修改原要求，不执行旧操作')
            await json(
                `conversations/${replaced.conversation.id}/human-requests/${replaced.request.id}/decisions`,
                {
                    actionId: randomUUID(),
                    version: replaced.request.version,
                    decision: 'approve',
                },
                409
            )
            expect((await pool.query('SELECT * FROM fixture_effects')).rowCount).toBe(1)
            await settled(
                () => json<ChatConversation>(`conversations/${replaced.conversation.id}`),
                value => !value.activeRequestId && value.messages.at(-1)?.role === 'assistant'
            )

            behavior = 'question'
            issueNextCall = true
            await send(replaced.conversation.id, '请再次澄清本次目标读者')
            const nextQuestion = await settled(
                () => json<ChatConversation>(`conversations/${replaced.conversation.id}`),
                value => !value.activeRequestId && value.humanRequests?.some(request => request.status === 'pending') === true
            )
            const nextRequest = nextQuestion.humanRequests!.find(request => request.status === 'pending')!
            await send(replaced.conversation.id, '产品团队', {
                humanResponse: { requestId: nextRequest.id, version: nextRequest.version },
            })
            const nextAnswer = await settled(
                () => json<ChatConversation>(`conversations/${replaced.conversation.id}`),
                value => !value.activeRequestId && value.messages.at(-1)?.content.includes('产品团队') === true
            )
            expect(nextAnswer.humanRequests!.find(request => request.id === replaced.request.id)!.status).toBe('superseded')

            behavior = 'read'
            issueNextCall = true
            const reader = await json<AgentDefinition>('agents', {
                name: '只读计算助手',
                description: '',
                modelId: config.model,
                systemPrompt: '使用已授权的只读工具。',
                toolIds: ['calculator', 'current-time'],
                openingMessages: [],
            })
            const folder = await json<ProjectFolder>('project-folders', { requestId: randomUUID(), name: '本人资料文件夹' })
            const reading = await json<ChatConversation>('conversations', { agentId: reader.id, projectFolderId: folder.id })
            await send(reading.id, '计算12乘34')
            const read = await settled(
                () => json<ChatConversation>(`conversations/${reading.id}`),
                value => !value.activeRequestId && value.messages.at(-1)?.content.includes('408') === true
            )
            expect(read.humanRequests ?? []).toHaveLength(0)
            expect(read.projectFolderId).toBe(folder.id)
            expect((await pool.query('SELECT * FROM fixture_effects')).rowCount).toBe(1)
        } finally {
            await app?.close()
            await new Promise<void>(resolve => provider.close(() => resolve()))
            await pool.end()
            await admin.query(`DROP SCHEMA ${schema} CASCADE`)
            await admin.end()
        }
    },
    90_000
)
