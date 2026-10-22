import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { NestExpressApplication } from '@nestjs/platform-express'
import {
    chatConversationSchema,
    collaborationProjectSchema,
    collaborationNodeDetailSchema,
    type ChatConversation,
    type CollaborationDispatch,
} from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig } from './config-fixture.js'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as {
    Pool: new (options: { connectionString?: string }) => {
        query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
        end(): Promise<void>
    }
}

/**
 * Waits for a durable background result without sending another model request.
 * @param read - Read-only observation of test-owned state.
 * @param accept - Expected terminal predicate.
 * @returns The matching observation.
 * @throws Error when the bounded deadline expires.
 */
async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; attempt < 160; attempt++) {
        const value = await read()
        if (accept(value)) return value
        await delay(50)
    }
    throw new Error('System-model collaboration did not reach the expected durable state.')
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'gives existing and new accounts direct Agent openings, owner-directed upstream questions and durable default-model recovery',
    async () => {
        const schema = `system_model_${randomUUID().replaceAll('-', '')}`
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const database = new URL(process.env.TEST_DATABASE_URL!)
        database.searchParams.set('options', `-c search_path=${schema}`)
        const inspection = new pg.Pool({ connectionString: database.toString() })
        const systemKey = 'test-only-shared-system-provider-key'
        const token = 'test-only-system-model-private-api-token'
        const people = new Map<string, { id: string; session: string }>()
        const requests: { key: string; model: string; content: string }[] = []
        let recipientId = ''
        let replyTarget: { id: string; version: number } | undefined
        const provider = createServer(async (request, response) => {
            let text = ''
            for await (const piece of request) text += String(piece)
            const body = JSON.parse(text) as {
                model: string
                messages: { role: string; content?: string }[]
                tools?: { function: { name: string } }[]
            }
            const content = JSON.stringify(body.messages)
            requests.push({ key: request.headers.authorization ?? '', model: body.model, content })
            const handoff =
                content.includes('NO_CONFIG_HANDOFF') && body.tools?.some(tool => tool.function.name === 'collaboration_handoff')
            const question =
                content.includes('ASK_UPSTREAM') &&
                !content.includes('LOGS-ANSWER') &&
                body.tools?.some(tool => tool.function.name === 'collaboration_question')
            const direct = content.includes('NOTICE_FIXTURE') && body.tools?.some(tool => tool.function.name === 'collaboration_message')
            const peerReply =
                content.includes('REPLY_TO_SENDER') && body.tools?.some(tool => tool.function.name === 'collaboration_message')
            const answerReply =
                content.includes('SEND_UPSTREAM_ANSWER') && body.tools?.some(tool => tool.function.name === 'collaboration_reply')
            const toolName = answerReply
                ? 'collaboration_reply'
                : peerReply || direct
                  ? 'collaboration_message'
                  : handoff
                    ? 'collaboration_handoff'
                    : question
                      ? 'collaboration_question'
                      : undefined
            const delta = toolName
                ? {
                      ...(question ? { content: '我会向上游确认缺少的日志。' } : {}),
                      tool_calls: [
                          {
                              index: 0,
                              id: 'system-handoff',
                              type: 'function',
                              function: {
                                  name: toolName,
                                  arguments: JSON.stringify({
                                      slotId: answerReply
                                          ? `reply:${replyTarget!.id}:${replyTarget!.version}`
                                          : peerReply
                                            ? `peer:${people.get('DefaultC')!.id}`
                                            : handoff || direct
                                              ? `contact:${recipientId}`
                                              : 'upstream',
                                      title: '免配置协作',
                                      content: answerReply
                                          ? 'LOGS-ANSWER：支付页出现超时，相关请求日志已补齐。'
                                          : peerReply
                                            ? '收到，三点参会。'
                                            : direct
                                              ? '会议改到三点。'
                                              : handoff
                                                ? '请使用默认模型评估这个方案。'
                                                : '请补充这个问题的日志。',
                                  }),
                              },
                          },
                      ],
                  }
                : { content: '系统默认模型已处理。' }
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: toolName ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
            )
        })
        await new Promise<void>((resolve, reject) => {
            provider.once('error', reject)
            provider.listen(0, '127.0.0.1', resolve)
        })
        const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
        let app: NestExpressApplication | undefined
        let base = ''

        /**
         * Boots the real API and worker against the same isolated PostgreSQL schema.
         * @param key - Server-owned system key, empty only for the initial configuration-failure scenario.
         * @returns After the test-owned HTTP listener is ready.
         */
        async function boot(key: string): Promise<void> {
            app = await createApiApp(
                readTestApiConfig({
                    HARNESS_API_TOKEN: token,
                    HARNESS_WORKSPACE_ID: schema,
                    DATABASE_URL: database.toString(),
                    DEEPSEEK_API_KEY: key,
                    DEEPSEEK_BASE_URL: `${origin}/v1`,
                    DEEPSEEK_MODEL: 'system-default-fixture',
                    OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
                    COLLABORATION_POLL_MS: '20',
                }),
                { logger: false }
            )
            await app.listen(0, '127.0.0.1')
            base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`
        }

        /**
         * Sends a request using the actual registered account's durable session.
         * @param owner - Test-owned registered account name.
         * @param path - Public API resource.
         * @param body - Optional strict mutation input.
         * @returns The HTTP response with private model material retained on the server.
         */
        async function call(owner: string, path: string, body?: unknown): Promise<Response> {
            return fetch(`${base}/${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json',
                    ...(people.has(owner) ? { 'x-harness-session': people.get(owner)!.session } : {}),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }

        /**
         * Registers an actual account without creating any personal model connection.
         * @param username - Unique test-owned account name.
         * @returns After its durable session and public identity are captured.
         */
        async function register(username: string): Promise<void> {
            const response = await call(username, 'account/register', {
                username,
                email: `${username.toLowerCase()}-${schema}@example.com`,
                password: 'Test-only-password-2026!',
            })
            expect(response.status).toBe(201)
            const user = (await response.json()) as { id: string }
            people.set(username, { id: user.id, session: response.headers.get('x-harness-session')! })
        }

        /**
         * Reads one original source under its real owner session.
         * @param id - Test-owned source identity.
         * @returns Validated private conversation projection.
         */
        async function source(id: string): Promise<ChatConversation> {
            return chatConversationSchema.parse(await (await call('DefaultA', `chat/conversations/${id}`)).json())
        }

        /**
         * Waits for a fully settled preview and confirms its exact persisted version as its human owner.
         * @param owner - Actual source owner.
         * @param kind - Private source kind.
         * @param id - Original source identity.
         * @returns The immutable preview that was confirmed.
         */
        async function confirm(owner: string, kind: 'conversation' | 'task', id: string): Promise<CollaborationDispatch> {
            const page = await waitFor(
                async () =>
                    (await (await call(owner, `chat/collaboration/source-events?sourceKind=${kind}&sourceId=${id}`)).json()) as {
                        pendingDispatches: CollaborationDispatch[]
                        sourceState?: { activeRequestId?: string }
                    },
                value => !value.sourceState?.activeRequestId && value.pendingDispatches.some(item => item.status === 'pending')
            )
            const draft = page.pendingDispatches.find(item => item.status === 'pending')!
            const input = { type: 'confirm-dispatch', requestId: randomUUID(), draftId: draft.id, version: draft.version }
            expect(JSON.stringify(draft)).not.toMatch(/test-only-shared-system-provider-key|apiKey|systemPrompt/)
            const foreign = await call(owner === 'DefaultC' ? 'DefaultA' : 'DefaultC', 'chat/collaboration/commands', input)
            expect(foreign.status).toBe(404)
            const providerCalls = requests.length
            const response = await call(owner, 'chat/collaboration/commands', input)
            expect(response.status, await response.clone().text()).toBe(201)
            const sent = await response.json()
            expect(sent.dispatchStatus).toBe('sent')
            expect(await (await call(owner, 'chat/collaboration/commands', input)).json()).toEqual(sent)
            expect(requests).toHaveLength(providerCalls)
            return draft
        }

        try {
            await admin.query(`CREATE SCHEMA "${schema}"`)
            await boot('')
            await register('DefaultA')
            await register('DefaultB')
            recipientId = people.get('DefaultB')!.id
            const original = chatConversationSchema.parse(await (await call('DefaultA', 'chat/conversations', {})).json())
            const requestId = randomUUID()
            const input = {
                requestId,
                content: '@DefaultB NO_CONFIG_HANDOFF 请评估方案',
                mentions: [{ userId: recipientId, name: 'DefaultB', start: 0, end: 9 }],
            }
            expect((await call('DefaultA', `chat/conversations/${original.id}/messages`, input)).status).toBe(201)
            await waitFor(
                () => source(original.id),
                value => value.messages.some(message => message.role === 'assistant' && message.status === 'error')
            )
            expect(requests).toHaveLength(0)
            const originalJob = await inspection.query('SELECT id FROM harness_collaboration_jobs WHERE trigger_id=$1', [requestId])
            await app!.close()
            app = undefined
            await boot(systemKey)
            await register('DefaultC')
            for (const owner of ['DefaultA', 'DefaultB', 'DefaultC']) {
                const status = await (await call(owner, 'chat/status')).json()
                expect(status).toMatchObject({ configured: true, model: 'system-default-fixture' })
                expect(await (await call(owner, 'account/models')).json()).toEqual({ models: [] })
                const catalog = (await (await call(owner, 'chat/agents/catalog')).json()) as {
                    defaultModelId: string
                    models: { id: string; available: boolean }[]
                }
                expect(catalog.defaultModelId).toBe('system-default-fixture')
                expect(catalog.models).toContainEqual(expect.objectContaining({ id: 'system-default-fixture', available: true }))
                expect(JSON.stringify({ status, catalog })).not.toContain(systemKey)
            }
            const plain = chatConversationSchema.parse(await (await call('DefaultC', 'chat/conversations', {})).json())
            const plainResponse = await call('DefaultC', `chat/conversations/${plain.id}/messages`, {
                requestId: randomUUID(),
                content: '普通聊天免配置',
            })
            expect(await plainResponse.text()).toContain('系统默认模型已处理')
            expect((await call('DefaultA', `chat/conversations/${original.id}/messages`, input)).status).toBe(201)
            await waitFor(
                () => source(original.id),
                value => !value.activeRequestId && value.messages.at(-1)?.content === '我已整理好发送内容，请确认后再发送。'
            )
            expect(await (await call('DefaultA', 'chat/collaboration/projects')).json()).toEqual({ projects: [] })
            expect(await (await call('DefaultB', 'chat/collaboration/notifications')).json()).toMatchObject({ notifications: [] })
            await app!.close()
            app = undefined
            await boot(systemKey)
            const draft = await confirm('DefaultA', 'conversation', original.id)
            expect(draft).toMatchObject({ kind: 'delegate', recipientName: 'DefaultB', content: '请使用默认模型评估这个方案。' })
            const projects = await waitFor(
                async () => {
                    const body = (await (await call('DefaultA', 'chat/collaboration/projects')).json()) as { projects: unknown[] }
                    return body.projects.map(project => collaborationProjectSchema.parse(project))
                },
                value => value.length === 1
            )
            const pending = projects[0]!.nodes.find(node => node.ownerId === recipientId)!
            expect(pending.source).toBeNull()
            expect(pending.canActivate).toBe(false)
            expect(pending.canWork).toBe(false)
            const receiverView = collaborationNodeDetailSchema.parse(
                await (await call('DefaultB', `chat/collaboration/nodes/${pending.id}`)).json()
            )
            expect(receiverView.node.canWork).toBe(true)
            const taskId = receiverView.node.source!.id
            expect(receiverView.node.source!.kind).toBe('conversation')
            const opening = chatConversationSchema.parse(await (await call('DefaultB', `chat/conversations/${taskId}`)).json())
            expect(opening.messages).toHaveLength(1)
            expect(opening.messages[0]).toMatchObject({ role: 'assistant', kind: 'opening', status: 'complete' })
            expect(opening.messages[0]!.content).toContain('DefaultA')
            expect(opening.messages[0]!.content).toContain('请使用默认模型评估这个方案。')
            expect(opening.task).toBeUndefined()
            expect((await (await call('DefaultB', 'chat/conversations')).json()).conversations).toContainEqual(
                expect.objectContaining({ id: taskId, messages: expect.arrayContaining([expect.objectContaining({ kind: 'opening' })]) })
            )
            expect(opening.activeRequestId).toBeUndefined()
            const beforeActivation = requests.length
            const activation = {
                type: 'activate',
                requestId: randomUUID(),
                nodeId: pending.id,
                revision: pending.revision,
            }
            const activated = await call('DefaultB', 'chat/collaboration/commands', activation)
            expect(activated.status).toBe(201)
            const result = (await activated.json()) as { conversationId: string }
            expect(result.conversationId).toBe(taskId)
            expect(await (await call('DefaultB', 'chat/collaboration/commands', activation)).json()).toEqual(result)
            expect(requests).toHaveLength(beforeActivation)
            for (const content of ['帮我理解对方的需求，先和我讨论', '先分析排查步骤，暂时不联系对方']) {
                const inputId = randomUUID()
                expect((await call('DefaultB', `chat/conversations/${taskId}/messages`, { requestId: inputId, content })).status).toBe(201)
                await waitFor(
                    async () => chatConversationSchema.parse(await (await call('DefaultB', `chat/conversations/${taskId}`)).json()),
                    value =>
                        !value.activeRequestId &&
                        value.messages.some(message => message.role === 'assistant' && message.requestId === inputId)
                )
                const state = await (
                    await call('DefaultB', `chat/collaboration/source-events?sourceKind=conversation&sourceId=${taskId}`)
                ).json()
                expect(state.pendingDispatches.filter((draft: CollaborationDispatch) => draft.status === 'pending')).toEqual([])
            }
            const ask = await call('DefaultB', `chat/conversations/${taskId}/messages`, {
                requestId: randomUUID(),
                content: 'ASK_UPSTREAM 帮我向上游问一下缺少的日志。',
            })
            expect(ask.status).toBe(201)
            await ask.text()
            const questionDraft = await confirm('DefaultB', 'conversation', taskId)
            expect(questionDraft).toMatchObject({ kind: 'ask', recipientName: 'DefaultA', content: '请补充这个问题的日志。' })
            const waiting = await waitFor(
                async () =>
                    collaborationNodeDetailSchema.parse(await (await call('DefaultB', `chat/collaboration/nodes/${pending.id}`)).json()),
                value => value.node.status === 'waiting-upstream'
            )
            const upstreamQuestion = waiting.questions.find(item => item.nodeId === pending.id && item.status === 'pending')!
            expect(upstreamQuestion.question).toBe('请补充这个问题的日志。')
            expect((await source(original.id)).messages).toContainEqual(
                expect.objectContaining({
                    kind: 'relay',
                    content: expect.stringContaining('请补充这个问题的日志。'),
                })
            )
            replyTarget = { id: upstreamQuestion.id, version: upstreamQuestion.version }
            for (const content of ['帮我理解这次要提供哪些日志', '确认']) {
                const requestId = randomUUID()
                expect((await call('DefaultA', `chat/conversations/${original.id}/messages`, { requestId, content })).status).toBe(201)
                await waitFor(
                    () => source(original.id),
                    value =>
                        !value.activeRequestId &&
                        value.messages.some(message => message.role === 'assistant' && message.requestId === requestId)
                )
                const state = await (
                    await call('DefaultA', `chat/collaboration/source-events?sourceKind=conversation&sourceId=${original.id}`)
                ).json()
                expect(state.pendingDispatches.filter((draft: CollaborationDispatch) => draft.status === 'pending')).toEqual([])
                expect(state.questions.find((question: { id: string }) => question.id === upstreamQuestion.id)).toMatchObject({
                    status: 'pending',
                    answer: null,
                    decision: null,
                })
            }
            const reply = await call('DefaultA', `chat/conversations/${original.id}/messages`, {
                requestId: randomUUID(),
                content: 'SEND_UPSTREAM_ANSWER 请把这些日志回复给提问的同事：支付页出现超时，相关请求日志已补齐。',
            })
            expect(reply.status).toBe(201)
            const answerDraft = await confirm('DefaultA', 'conversation', original.id)
            expect(answerDraft).toMatchObject({
                kind: 'answer',
                questionId: upstreamQuestion.id,
                questionVersion: upstreamQuestion.version,
                recipientName: 'DefaultB',
                content: 'LOGS-ANSWER：支付页出现超时，相关请求日志已补齐。',
                decision: 'information',
            })
            const finished = await waitFor(
                async () =>
                    chatConversationSchema.parse(await (await call('DefaultB', `chat/conversations/${result.conversationId}`)).json()),
                value => value.messages.some(message => message.role === 'assistant' && message.content === '系统默认模型已处理。')
            )
            expect(finished.agent.modelId).toBe('system-default-fixture')
            expect(finished.messages).toContainEqual(
                expect.objectContaining({ kind: 'relay', content: expect.stringContaining('LOGS-ANSWER') })
            )
            expect(requests.length).toBeGreaterThan(beforeActivation)
            expect((await call('DefaultA', `chat/conversations/${result.conversationId}`)).status).toBe(404)
            const detail = collaborationNodeDetailSchema.parse(
                await (await call('DefaultB', `chat/collaboration/nodes/${pending.id}`)).json()
            )
            expect(JSON.stringify(detail)).not.toMatch(/test-only-shared-system-provider-key|apiKey|systemPrompt/)
            expect(requests.every(request => request.key === `Bearer ${systemKey}` && request.model === 'system-default-fixture')).toBe(
                true
            )
            const noticeSource = chatConversationSchema.parse(await (await call('DefaultC', 'chat/conversations', {})).json())
            expect(
                (
                    await call('DefaultC', `chat/conversations/${noticeSource.id}/messages`, {
                        requestId: randomUUID(),
                        content: '@DefaultB NOTICE_FIXTURE 告诉他会议改到三点',
                        mentions: [{ userId: recipientId, name: 'DefaultB', start: 0, end: 9 }],
                    })
                ).status
            ).toBe(201)
            const noticeDraft = await confirm('DefaultC', 'conversation', noticeSource.id)
            expect(noticeDraft).toMatchObject({ kind: 'message', content: '会议改到三点。' })
            const received = (await (await call('DefaultB', 'chat/conversations')).json()).conversations.map((item: unknown) =>
                chatConversationSchema.parse(item)
            ) as ChatConversation[]
            const noticeChat = received.find(item => item.messages.some(message => message.content.includes('会议改到三点。')))!
            expect(noticeChat).toBeDefined()
            expect(noticeChat.task).toBeUndefined()
            expect(noticeChat.messages).toEqual([
                expect.objectContaining({ role: 'assistant', kind: 'opening', content: 'DefaultC 发来消息：\n\n会议改到三点。' }),
            ])
            const noticeNotifications = await (await call('DefaultB', 'chat/collaboration/notifications')).json()
            expect(noticeNotifications.notifications).toContainEqual(
                expect.objectContaining({ source: { kind: 'conversation', id: noticeChat.id }, content: '会议改到三点。' })
            )
            expect(
                (
                    await call('DefaultB', `chat/conversations/${noticeChat.id}/messages`, {
                        requestId: randomUUID(),
                        content: 'REPLY_TO_SENDER 帮我回复发件人：收到，三点参会。',
                    })
                ).status
            ).toBe(201)
            const replyDraft = await confirm('DefaultB', 'conversation', noticeChat.id)
            expect(replyDraft).toMatchObject({ kind: 'message', recipientName: 'DefaultC', content: '收到，三点参会。' })
            const returned = chatConversationSchema.parse(await (await call('DefaultC', `chat/conversations/${noticeSource.id}`)).json())
            expect(returned.messages).toContainEqual(
                expect.objectContaining({ kind: 'relay', content: expect.stringContaining('收到，三点参会。') })
            )
            expect(await (await call('DefaultC', 'chat/collaboration/projects')).json()).toEqual({ projects: [] })
            const recoveredJobs = await inspection.query('SELECT id FROM harness_collaboration_jobs WHERE trigger_id=$1', [requestId])
            expect(recoveredJobs.rows).toEqual(originalJob.rows)
            expect(
                (await source(original.id)).messages.filter(message => message.role === 'user' && message.requestId === requestId)
            ).toHaveLength(1)
            const models = await inspection.query('SELECT count(*)::int AS count FROM harness_account_models')
            expect(models.rows[0]!.count).toBe(0)
            const journal = await inspection.query('SELECT header,events FROM harness_collaboration_sources')
            expect(JSON.stringify(journal.rows)).not.toContain(systemKey)
        } finally {
            await app?.close()
            provider.closeAllConnections()
            await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
            await inspection.end()
            await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
            await admin.end()
        }
    },
    30_000
)
