import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import {
    collaborationProjectSchema,
    collaborationNodeDetailSchema,
    chatConversationSchema,
    type CollaborationDispatch,
} from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { readTestApiConfig } from './config-fixture.js'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as {
    Pool: new (options: { connectionString?: string }) => { query(sql: string): Promise<unknown>; end(): Promise<void> }
}

/**
 * Waits for an actual durable application state without polling the model itself.
 * @param read - Read-only state observation.
 * @param accept - Expected state predicate.
 * @returns The first matching observation.
 * @throws Error when the bounded deadline expires.
 */
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
    for (let i = 0; i < 160; i++) {
        const value = await read()
        if (accept(value)) return value
        await delay(50)
    }
    throw new Error('Durable collaboration did not reach expected state.')
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'routes real coworkers through original sources, private models and durable PostgreSQL recovery',
    async () => {
        const schema = `sf014_api_${randomUUID().replaceAll('-', '')}`
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const people = new Map<string, { id: string; session: string }>()
        const calls: { model: string; key: string; text: string; tools: string[] }[] = []
        const counts = new Map<string, number>()
        const modelIds = new Map<string, string>()
        let recipientId = ''
        const provider = createServer(async (request, response) => {
            let raw = ''
            for await (const chunk of request) raw += String(chunk)
            const body = JSON.parse(raw) as { model: string; messages: unknown[]; tools?: { function: { name: string } }[] }
            calls.push({
                model: body.model,
                key: request.headers.authorization ?? '',
                text: JSON.stringify(body.messages),
                tools: body.tools?.map(tool => tool.function.name) ?? [],
            })
            const count = (counts.get(body.model) ?? 0) + 1
            counts.set(body.model, count)
            let tool: { name: string; args: object } | undefined
            if (body.model === 'Sales' && count === 2)
                tool = {
                    name: 'collaboration_handoff',
                    args: {
                        slotId: `contact:${recipientId}`,
                        title: '性能改进',
                        content: '请评估支付页性能方案。已知客户在高峰支付页慢，交接需要补充规模和P95目标。',
                    },
                }
            if (body.model === 'Product' && count === 1)
                tool = { name: 'collaboration_question', args: { slotId: 'upstream', content: '请补充支付页QPS与P95目标。' } }
            if (body.model === 'Product' && count === 3)
                tool = { name: 'collaboration_judgment', args: { slotId: 'owner', content: '请确认这份性能评估，模型建议尚未获批准。' } }
            if (body.model === 'Product' && count === 5)
                tool = {
                    name: 'collaboration_handoff',
                    args: {
                        slotId: `contact:${people.get('Engineering')!.id}`,
                        title: '工程评估',
                        content: '请基于产品已确认的支付页500QPS、P95小于200ms方案评估缓存改进可行性。',
                    },
                }
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            if (tool)
                response.end(
                    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call-${body.model}-${count}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
                )
            else
                response.end(
                    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: body.model === 'Sales' && count === 1 ? '请先补充具体页面场景和高峰QPS，再交给产品评估。' : body.model === 'Product' && count === 2 ? '私下方案草案：支付页500QPS，P95小于200ms，建议工程确认缓存方案。' : `${body.model}已收到上下文，供本人判断。` }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
                )
        })
        await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
        const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
        const config = readTestApiConfig({
            HARNESS_API_TOKEN: 'sf014-real-pg-private-token-20261019',
            HARNESS_WORKSPACE_ID: schema,
            DATABASE_URL: url.toString(),
            OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
            COLLABORATION_POLL_MS: '20',
        })
        let app: { close(): Promise<void> } | undefined
        let base = ''
        /**
         * Starts an actual API and worker against the same persistent schema.
         * @returns After its HTTP listener is ready.
         */
        async function boot(): Promise<void> {
            const reservation = createServer()
            await new Promise<void>((resolve, reject) => {
                reservation.once('error', reject)
                reservation.listen(0, '127.0.0.1', resolve)
            })
            const port = (reservation.address() as AddressInfo).port
            await new Promise<void>((resolve, reject) => reservation.close(error => (error ? reject(error) : resolve())))
            const child = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
                env: {
                    ...process.env,
                    DATABASE_URL: url.toString(),
                    HARNESS_API_TOKEN: config.token,
                    ACCOUNT_ENCRYPTION_KEY: config.accountEncryptionKey,
                    HARNESS_WORKSPACE_ID: schema,
                    API_HOST: '127.0.0.1',
                    API_PORT: String(port),
                    OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
                    DEEPSEEK_API_KEY: '',
                    COLLABORATION_POLL_MS: '20',
                },
                stdio: 'ignore',
            })
            app = {
                /**
                 * Stops only this test-owned process and waits for its database resources to drain.
                 * @returns After the child exits.
                 */
                async close() {
                    if (child.exitCode !== null || child.signalCode !== null) return
                    const exited = once(child, 'exit')
                    child.kill('SIGTERM')
                    const timeout = setTimeout(() => child.kill('SIGKILL'), 4000)
                    try {
                        await exited
                    } finally {
                        clearTimeout(timeout)
                    }
                },
            }
            base = `http://127.0.0.1:${port}/api`
            for (let attempt = 0; attempt < 100; attempt++) {
                if (child.exitCode !== null) throw new Error('Test-owned API process exited during startup.')
                const response = await fetch(`${base}/account/me`, { headers: { authorization: `Bearer ${config.token}` } }).catch(
                    () => undefined
                )
                if (response?.status === 401) {
                    await response.body?.cancel()
                    return
                }
                await delay(50)
            }
            throw new Error('Test-owned API process failed to become ready.')
        }
        /**
         * Performs a request with a real account session.
         * @param owner - Registered fixture account name.
         * @param path - API path.
         * @param body - Optional mutation body.
         * @param method - HTTP method.
         * @returns Raw HTTP response.
         */
        async function call(owner: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Response> {
            return fetch(`${base}/${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${config.token}`,
                    'x-harness-session': people.get(owner)?.session ?? '',
                    'content-type': 'application/json',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }
        /**
         * Submits one versioned human command and requires a real successful commit.
         * @param owner - Actual human author.
         * @param body - Strict collaboration command.
         * @returns Committed action result.
         */
        async function command(owner: string, body: object) {
            const response = await call(owner, 'chat/collaboration/commands', body)
            expect(response.status, await response.clone().text()).toBe(201)
            return (await response.json()) as {
                projectId: string
                nodeId: string
                questionId: string
                conversationId: string
                artifactId: string
                messageId: string
            }
        }
        /**
         * Confirms only a settled immutable Agent preview using the real source owner's account session.
         * @param owner - Actual sender.
         * @param kind - Original private source kind.
         * @param id - Original private source identity.
         * @returns The reviewed preview.
         */
        async function confirm(owner: string, kind: 'conversation' | 'task', id: string): Promise<CollaborationDispatch> {
            const page = await until(
                async () =>
                    (await (await call(owner, `chat/collaboration/source-events?sourceKind=${kind}&sourceId=${id}`)).json()) as {
                        pendingDispatches: CollaborationDispatch[]
                        sourceState?: { activeRequestId?: string }
                    },
                value => !value.sourceState?.activeRequestId && value.pendingDispatches.some(item => item.status === 'pending')
            )
            const draft = page.pendingDispatches.find(item => item.status === 'pending')!
            await command(owner, { type: 'confirm-dispatch', requestId: randomUUID(), draftId: draft.id, version: draft.version })
            return draft
        }
        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            await boot()
            for (const name of ['Sales', 'Product', 'Engineering', 'Unrelated']) {
                const response = await fetch(`${base}/account/register`, {
                    method: 'POST',
                    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
                    body: JSON.stringify({
                        username: name,
                        email: `${name.toLowerCase()}@${schema.replaceAll('_', '-')}.test`,
                        password: 'Fixture-password-2026!',
                    }),
                })
                expect(response.status, await response.clone().text()).toBe(201)
                const account = (await response.json()) as { id: string }
                people.set(name, { id: account.id, session: response.headers.get('x-harness-session')! })
                if (name !== 'Unrelated') {
                    const savedModel = await call(name, 'account/models', {
                        requestId: randomUUID(),
                        name: `${name} model`,
                        baseUrl: `${origin}/v1`,
                        model: name,
                        apiKey: `private-${name}`,
                    })
                    expect(savedModel.status).toBe(201)
                    modelIds.set(name, ((await savedModel.json()) as { id: string }).id)
                }
            }
            recipientId = people.get('Product')!.id
            const source = chatConversationSchema.parse(await (await call('Sales', 'chat/conversations', {})).json())
            const unknown = await call('Sales', `chat/conversations/${source.id}/messages`, {
                requestId: randomUUID(),
                content: '@未知同事 请评估方案',
            })
            expect(unknown.status).toBe(400)
            const forgedSpan = await call('Sales', `chat/conversations/${source.id}/messages`, {
                requestId: randomUUID(),
                content: '> @Product 请评估方案',
                mentions: [{ userId: recipientId, name: 'Product', start: 2, end: 10 }],
            })
            expect(forgedSpan.status).toBe(400)
            expect(calls).toHaveLength(0)
            const requestId = randomUUID()
            const accepted = await call('Sales', `chat/conversations/${source.id}/messages`, {
                requestId,
                content: '@Product请评估支付页方案',
                mentions: [{ userId: recipientId, name: 'Product', start: 0, end: 8 }],
            })
            expect(accepted.status, await accepted.clone().text()).toBe(201)
            expect(await accepted.text()).toContain('"type":"done"')
            const clarified = await until(
                async () => chatConversationSchema.parse(await (await call('Sales', `chat/conversations/${source.id}`)).json()),
                value =>
                    !value.activeRequestId &&
                    value.messages.some(message => message.role === 'assistant' && message.content.includes('请先补充'))
            )
            expect(clarified.messages.at(-1)?.content).toContain('高峰QPS')
            expect(await (await call('Sales', 'chat/collaboration/projects')).json()).toEqual({ projects: [] })
            const supplied = await call('Sales', `chat/conversations/${source.id}/messages`, {
                requestId: randomUUID(),
                content: '场景是支付页，高峰500QPS。请继续此前请Product评估的工作。',
            })
            expect(supplied.ok).toBe(true)
            await supplied.text()
            expect((await confirm('Sales', 'conversation', source.id)).recipientName).toBe('Product')
            const project = await until(
                async () => {
                    const body = (await (await call('Sales', 'chat/collaboration/projects')).json()) as { projects: unknown[] }
                    return body.projects.map(value => collaborationProjectSchema.parse(value))
                },
                value => value.length === 1
            )
            const projectId = project[0].id
            const sharedProductNode = project[0].nodes.find(node => node.ownerId === recipientId)!
            expect(sharedProductNode.source).toBeNull()
            const productNode = collaborationNodeDetailSchema.parse(
                await (await call('Product', `chat/collaboration/nodes/${sharedProductNode.id}`)).json()
            ).node
            expect(productNode.source).toEqual({ kind: 'conversation', id: expect.any(String) })
            expect(productNode.status).toBe('ready')
            const productTaskId = productNode.source!.id
            const productOpening = chatConversationSchema.parse(await (await call('Product', `chat/conversations/${productTaskId}`)).json())
            expect(productOpening.agent?.modelId).toBe(`account:${modelIds.get('Product')}`)
            expect(productOpening.task).toBeUndefined()
            expect(productOpening.activeRequestId).toBeUndefined()
            expect(productOpening.messages).toEqual([
                expect.objectContaining({
                    role: 'assistant',
                    kind: 'opening',
                    status: 'complete',
                    content: expect.stringContaining('Sales 发来消息：'),
                }),
            ])
            expect(productOpening.messages[0].content).toContain('已知客户在高峰支付页慢')
            expect(JSON.stringify(productOpening)).not.toMatch(/private-Sales|private-Product|apiKey/)
            expect(calls.map(item => item.model)).toEqual(['Sales', 'Sales'])
            expect((await call('Unrelated', `chat/collaboration/projects/${projectId}`)).status).toBe(404)
            expect((await call('Sales', `chat/conversations/${productTaskId}`)).status).toBe(404)
            expect((await call('Engineering', `chat/conversations/${productTaskId}`)).status).toBe(404)
            const productNotifications = (await (await call('Product', 'chat/collaboration/notifications')).json()) as {
                notifications: { nodeId: string | null; source: { kind: string; id: string } | null }[]
            }
            expect(productNotifications.notifications.find(item => item.nodeId === productNode.id)?.source).toEqual(productNode.source)
            const openProduct = {
                type: 'activate',
                requestId: randomUUID(),
                nodeId: productNode.id,
                revision: productNode.revision,
            }
            const activated = await command('Product', openProduct)
            expect(await command('Product', openProduct)).toEqual(activated)
            expect(activated.conversationId).toBe(productTaskId)
            expect(activated.conversationId).not.toBe(productNode.id)
            expect((await call('Sales', `chat/conversations/${activated.conversationId}`)).status).toBe(404)
            const reopenedProduct = await command('Product', { ...openProduct, requestId: randomUUID() })
            expect(reopenedProduct.conversationId).toBe(productTaskId)
            await delay(80)
            expect(calls.filter(item => item.model === 'Product')).toHaveLength(0)
            expect(
                chatConversationSchema.parse(await (await call('Product', `chat/conversations/${productTaskId}`)).json()).messages
            ).toEqual(productOpening.messages)
            const productReply = await call('Product', `chat/conversations/${productTaskId}/messages`, {
                requestId: randomUUID(),
                content: '帮我向上游询问支付页QPS与P95目标。',
            })
            expect(productReply.ok).toBe(true)
            await productReply.text()
            expect((await confirm('Product', 'conversation', productTaskId)).kind).toBe('ask')
            const detail = await until(
                async () =>
                    collaborationNodeDetailSchema.parse(await (await call('Product', `chat/collaboration/nodes/${productNode.id}`)).json()),
                value => value.questions.some(question => question.nodeId === productNode.id && question.status === 'pending')
            )
            const question = detail.questions.find(item => item.nodeId === productNode.id && item.targetNodeId !== productNode.id)!
            const originalEvents = (await (
                await call('Sales', `chat/collaboration/source-events?sourceKind=conversation&sourceId=${source.id}`)
            ).json()) as { questions: { id: string }[] }
            expect(originalEvents.questions.some(item => item.id === question.id)).toBe(true)
            await app!.close()
            app = undefined
            await boot()
            expect(calls.filter(item => item.model === 'Product')).toHaveLength(1)
            expect((await call('Product', `account/models/${modelIds.get('Product')}`, undefined, 'DELETE')).ok).toBe(true)
            expect(
                (
                    await call(
                        'Sales',
                        `account/models/${modelIds.get('Sales')}`,
                        { name: 'Sales changed', baseUrl: `${origin}/v1`, model: 'Sales', apiKey: 'private-Sales-changed' },
                        'PUT'
                    )
                ).ok
            ).toBe(true)
            const answer = {
                type: 'answer',
                requestId: randomUUID(),
                questionId: question.id,
                version: question.version,
                content: '支付页500QPS，P95小于200ms',
                decision: 'information',
            }
            const answered = await command('Sales', answer)
            expect(await command('Sales', answer)).toEqual(answered)
            const failedModel = await until(
                async () =>
                    collaborationNodeDetailSchema.parse(await (await call('Product', `chat/collaboration/nodes/${productNode.id}`)).json()),
                value => value.node.status === 'failed'
            )
            const failedTask = chatConversationSchema.parse(
                await (await call('Product', `chat/conversations/${activated.conversationId}`)).json()
            )
            expect(failedTask.messages.some(message => message.status === 'error')).toBe(true)
            expect(calls.filter(item => item.model === 'Product')).toHaveLength(1)
            expect(
                (
                    await call('Product', 'account/models', {
                        requestId: randomUUID(),
                        name: 'Product repaired',
                        baseUrl: `${origin}/v1`,
                        model: 'Product',
                        apiKey: 'private-Product-repaired',
                    })
                ).ok
            ).toBe(true)
            await command('Product', {
                type: 'retry',
                requestId: randomUUID(),
                nodeId: productNode.id,
                revision: failedModel.node.revision,
                useDefaultModel: true,
            })
            const privateProposal = await until(
                async () => chatConversationSchema.parse(await (await call('Product', `chat/conversations/${productTaskId}`)).json()),
                value => !value.activeRequestId && value.messages.at(-1)?.content.includes('私下方案草案：支付页500QPS') === true
            )
            const recovered = collaborationNodeDetailSchema.parse(
                await (await call('Product', `chat/collaboration/nodes/${productNode.id}`)).json()
            )
            expect(recovered.node.status).toBe('ready')
            expect(privateProposal.activeRequestId).toBeUndefined()
            expect(privateProposal.messages.at(-1)?.content).toContain('私下方案草案：支付页500QPS，P95小于200ms')
            expect(recovered.artifacts).toEqual([])
            expect(
                recovered.questions.some(
                    item => item.nodeId === productNode.id && item.targetNodeId === productNode.id && item.status === 'pending'
                )
            ).toBe(false)
            const recoveredCall = calls.filter(item => item.model === 'Product').at(-1)!
            expect(recoveredCall.tools).toEqual(['collaboration_judgment'])
            expect(
                collaborationProjectSchema.parse(await (await call('Sales', `chat/collaboration/projects/${projectId}`)).json()).artifacts
            ).toEqual([])
            expect(
                chatConversationSchema
                    .parse(await (await call('Sales', `chat/conversations/${source.id}`)).json())
                    .messages.some(message => message.content.includes('私下方案草案'))
            ).toBe(false)
            const publishedProposal = await command('Product', {
                type: 'publish',
                requestId: randomUUID(),
                nodeId: productNode.id,
                revision: recovered.node.revision,
                title: '方案v1',
                content: '支付页500QPS，P95小于200ms，建议工程确认缓存方案。',
            })
            const ownJudgment = await call('Product', `chat/conversations/${productTaskId}/messages`, {
                requestId: randomUUID(),
                content: '请在本聊天向我提出这份性能方案的最终判断问题，先不要转发给同事。',
            })
            expect(ownJudgment.ok).toBe(true)
            await ownJudgment.text()
            const judged = await until(
                async () =>
                    collaborationNodeDetailSchema.parse(await (await call('Product', `chat/collaboration/nodes/${productNode.id}`)).json()),
                value => value.node.status === 'waiting-owner' && value.artifacts.length === 1
            )
            expect(judged.artifacts[0]).toMatchObject({ id: publishedProposal.artifactId, version: 1, authorId: recipientId })
            expect(judged.artifacts[0].content).toContain('500QPS')
            expect(
                calls
                    .filter(item => item.model === 'Product')
                    .slice(1)
                    .every(item => item.key === 'Bearer private-Product-repaired')
            ).toBe(true)
            expect(calls.filter(item => item.model === 'Product').at(-1)?.text).toContain('500QPS')
            const ownDecision = judged.questions.find(
                item => item.nodeId === productNode.id && item.targetNodeId === productNode.id && item.status === 'pending'
            )!
            expect(ownDecision.decision).toBeNull()
            await command('Product', {
                type: 'answer',
                requestId: randomUUID(),
                questionId: ownDecision.id,
                version: ownDecision.version,
                content: '确认评估内容，交工程进一步判断',
                decision: 'approved',
            })
            await until(
                async () =>
                    (await (await call('Product', `chat/conversations/${activated.conversationId}`)).json()) as {
                        activeRequestId?: string
                    },
                value => !value.activeRequestId
            )
            const latest = collaborationNodeDetailSchema.parse(
                await (await call('Product', `chat/collaboration/nodes/${productNode.id}`)).json()
            )
            const salesQuestion = latest.questions.find(
                item => item.targetNodeId === productNode.id && item.nodeId !== productNode.id && item.status === 'pending'
            )!
            await command('Product', {
                type: 'answer',
                requestId: randomUUID(),
                questionId: salesQuestion.id,
                version: salesQuestion.version,
                content: '产品已确认500QPS与P95目标，继续工程评估。',
                decision: 'approved',
            })
            await until(
                async () => calls.filter(item => item.model === 'Sales').length,
                value => value >= 3
            )
            await until(
                async () => chatConversationSchema.parse(await (await call('Sales', `chat/conversations/${source.id}`)).json()),
                value => !value.activeRequestId
            )
            const plain = await call('Sales', `chat/conversations/${source.id}/messages`, {
                requestId: randomUUID(),
                content: '继续整理已确认的结论',
            })
            expect(plain.ok).toBe(true)
            await plain.text()
            await until(
                async () => calls.filter(item => item.model === 'Sales').length,
                value => value >= 4
            )
            const engineeringPrompt = await call('Product', `chat/conversations/${activated.conversationId}/messages`, {
                requestId: randomUUID(),
                content: '@Engineering 请基于刚才确认的方案做工程可行性评估',
                mentions: [{ userId: people.get('Engineering')!.id, name: 'Engineering', start: 0, end: '@Engineering'.length }],
            })
            expect(engineeringPrompt.ok).toBe(true)
            await engineeringPrompt.text()
            expect((await confirm('Product', 'conversation', activated.conversationId)).recipientName).toBe('Engineering')
            const handedToEngineering = await until(
                async () =>
                    collaborationProjectSchema.parse(await (await call('Product', `chat/collaboration/projects/${projectId}`)).json()),
                value => value.nodes.some(node => node.ownerId === people.get('Engineering')!.id)
            )
            const engineering = { nodeId: handedToEngineering.nodes.find(node => node.ownerId === people.get('Engineering')!.id)!.id }
            expect(calls.filter(item => item.model === 'Product').at(-1)?.text).toContain('500QPS')
            const engineeringNode = collaborationNodeDetailSchema.parse(
                await (await call('Engineering', `chat/collaboration/nodes/${engineering.nodeId}`)).json()
            )
            expect(engineeringNode.node.source).toEqual({ kind: 'conversation', id: expect.any(String) })
            expect(engineeringNode.node.status).toBe('ready')
            const engineeringTaskId = engineeringNode.node.source!.id
            const engineeringOpening = chatConversationSchema.parse(
                await (await call('Engineering', `chat/conversations/${engineeringTaskId}`)).json()
            )
            expect(engineeringOpening.agent?.modelId).toBe(`account:${modelIds.get('Engineering')}`)
            expect(engineeringOpening.activeRequestId).toBeUndefined()
            expect(engineeringOpening.messages).toEqual([
                expect.objectContaining({
                    role: 'assistant',
                    kind: 'opening',
                    status: 'complete',
                    content: expect.stringContaining('Product 发来消息：'),
                }),
            ])
            expect(engineeringOpening.messages[0].content).toContain('500QPS')
            expect(engineeringOpening.messages[0].content).toContain('P95小于200ms')
            expect((await call('Product', `chat/conversations/${engineeringTaskId}`)).status).toBe(404)
            expect((await call('Sales', `chat/conversations/${engineeringTaskId}`)).status).toBe(404)
            expect(calls.filter(item => item.model === 'Engineering')).toHaveLength(0)
            const openEngineering = {
                type: 'activate',
                requestId: randomUUID(),
                nodeId: engineering.nodeId,
                revision: engineeringNode.node.revision,
            }
            const engineeringTask = await command('Engineering', openEngineering)
            expect(await command('Engineering', openEngineering)).toEqual(engineeringTask)
            expect(engineeringTask.conversationId).toBe(engineeringTaskId)
            await delay(80)
            expect(calls.filter(item => item.model === 'Engineering')).toHaveLength(0)
            expect(
                chatConversationSchema.parse(await (await call('Engineering', `chat/conversations/${engineeringTaskId}`)).json()).messages
            ).toEqual(engineeringOpening.messages)
            const engineeringReply = await call('Engineering', `chat/conversations/${engineeringTaskId}/messages`, {
                requestId: randomUUID(),
                content: '请基于上游提供的方案做工程可行性评估。',
            })
            expect(engineeringReply.ok).toBe(true)
            await engineeringReply.text()
            await until(
                async () =>
                    chatConversationSchema.parse(
                        await (await call('Engineering', `chat/conversations/${engineeringTask.conversationId}`)).json()
                    ),
                value => !value.activeRequestId && value.messages.some(message => message.role === 'assistant' && !message.kind)
            )
            expect(
                calls.some(
                    item => item.model === 'Engineering' && item.key === 'Bearer private-Engineering' && item.text.includes('500QPS')
                )
            ).toBe(true)
            const cDetail = collaborationNodeDetailSchema.parse(
                await (await call('Engineering', `chat/collaboration/nodes/${engineering.nodeId}`)).json()
            )
            await command('Engineering', {
                type: 'adopt',
                requestId: randomUUID(),
                nodeId: engineering.nodeId,
                revision: cDetail.node.revision,
                artifactId: judged.artifacts[0].id,
                version: 1,
            })
            const bBeforeVersion = collaborationNodeDetailSchema.parse(
                await (await call('Product', `chat/collaboration/nodes/${productNode.id}`)).json()
            )
            await command('Product', {
                type: 'publish',
                requestId: randomUUID(),
                nodeId: productNode.id,
                revision: bBeforeVersion.node.revision,
                artifactId: judged.artifacts[0].id,
                title: '方案v2',
                content: 'NEW-V2-CONTEXT-ONLY，新的1000QPS方案',
            })
            const cStillV1 = collaborationNodeDetailSchema.parse(
                await (await call('Engineering', `chat/collaboration/nodes/${engineering.nodeId}`)).json()
            )
            expect(cStillV1.node.adoptions).toEqual([{ artifactId: judged.artifacts[0].id, version: 1 }])
            const useV1 = await call('Engineering', `chat/conversations/${engineeringTask.conversationId}/messages`, {
                requestId: randomUUID(),
                content: '按我已采用的版本继续判断',
            })
            expect(useV1.ok).toBe(true)
            await useV1.text()
            await until(
                async () => calls.filter(item => item.model === 'Engineering').length,
                value => value >= 2
            )
            expect(calls.filter(item => item.model === 'Engineering').at(-1)?.text).toContain('500QPS')
            expect(calls.filter(item => item.model === 'Engineering').at(-1)?.text).not.toContain('NEW-V2-CONTEXT-ONLY')
            await until(
                async () =>
                    chatConversationSchema.parse(
                        await (await call('Engineering', `chat/conversations/${engineeringTask.conversationId}`)).json()
                    ),
                value => !value.activeRequestId
            )
            const cBeforeV2 = collaborationNodeDetailSchema.parse(
                await (await call('Engineering', `chat/collaboration/nodes/${engineering.nodeId}`)).json()
            )
            await command('Engineering', {
                type: 'adopt',
                requestId: randomUUID(),
                nodeId: engineering.nodeId,
                revision: cBeforeV2.node.revision,
                artifactId: judged.artifacts[0].id,
                version: 2,
            })
            const useV2 = await call('Engineering', `chat/conversations/${engineeringTask.conversationId}/messages`, {
                requestId: randomUUID(),
                content: '请使用我明确采用的新版本继续判断',
            })
            expect(useV2.ok).toBe(true)
            await useV2.text()
            await until(
                async () => calls.filter(item => item.model === 'Engineering').length,
                value => value >= 3
            )
            expect(calls.filter(item => item.model === 'Engineering').at(-1)?.text).toContain('NEW-V2-CONTEXT-ONLY')
            const shared = collaborationProjectSchema.parse(await (await call('Sales', `chat/collaboration/projects/${projectId}`)).json())
            expect(new Set(shared.nodes.map(node => node.ownerId)).size).toBe(3)
            expect(JSON.stringify(shared)).not.toMatch(/private-Product|systemPrompt|reasoning|apiKey/)
            expect(latest.node.ownerId).toBe(recipientId)
            const text = '会议改到三点。\n请准时参加！'
            const direct = { type: 'message', requestId: randomUUID(), recipientId, content: text }
            const sent = await command('Sales', direct)
            expect(await command('Sales', direct)).toEqual(sent)
            expect((await call('Sales', 'chat/collaboration/commands', { ...direct, content: 'changed' })).status).toBe(409)
            const thread = (await (await call('Product', 'chat/collaboration/messages')).json()) as {
                messages: { id: string; content: string }[]
            }
            expect(thread.messages.filter(item => item.id === sent.messageId)).toEqual([expect.objectContaining({ content: text })])
            expect(await (await call('Unrelated', 'chat/collaboration/messages')).json()).toEqual({ messages: [] })
            const readBefore = (await (await call('Product', 'chat/collaboration/notifications')).json()) as {
                notifications: { id: string; read: boolean }[]
                unread: number
            }
            const nextMessage = await command('Sales', {
                type: 'message',
                requestId: randomUUID(),
                recipientId,
                content: '阅读期间新到的消息',
            })
            await command('Product', {
                type: 'read',
                requestId: randomUUID(),
                notificationIds: readBefore.notifications.map(item => item.id),
                messageIds: [sent.messageId],
            })
            const readAfter = (await (await call('Product', 'chat/collaboration/notifications')).json()) as {
                notifications: { read: boolean; content: string }[]
                unread: number
            }
            expect(readAfter.unread).toBe(1)
            expect(readAfter.notifications.find(item => item.content === '阅读期间新到的消息')?.read).toBe(false)
            expect(nextMessage.messageId).not.toBe(sent.messageId)
            const beforeRevoke = collaborationProjectSchema.parse(
                await (await call('Sales', `chat/collaboration/projects/${projectId}`)).json()
            )
            await command('Sales', {
                type: 'revoke',
                requestId: randomUUID(),
                projectId,
                userId: recipientId,
                revision: beforeRevoke.revision,
            })
            expect((await call('Product', `chat/collaboration/projects/${projectId}`)).status).toBe(404)
            expect((await call('Product', `chat/conversations/${activated.conversationId}`)).status).toBe(200)
            expect(
                ((await (await call('Product', 'chat/collaboration/messages')).json()) as { messages: unknown[] }).messages
            ).toHaveLength(2)
            const finalProject = collaborationProjectSchema.parse(
                await (await call('Sales', `chat/collaboration/projects/${projectId}`)).json()
            )
            const rootNode = finalProject.nodes.find(node => node.ownerId === people.get('Sales')!.id)!
            const unicodeArtifact = await command('Sales', {
                type: 'publish',
                requestId: randomUUID(),
                nodeId: rootNode.id,
                revision: rootNode.revision,
                title: '完整Unicode成果',
                content: '中'.repeat(128_000),
            })
            const persistedLargeArtifact = collaborationProjectSchema.parse(
                await (await call('Sales', `chat/collaboration/projects/${projectId}`)).json()
            )
            expect(persistedLargeArtifact.artifacts.find(artifact => artifact.id === unicodeArtifact.artifactId)?.content.length).toBe(
                128_000
            )
            // Ensure new personal content remains private even after the collaboration grant ends.
            expect((await call('Engineering', `chat/conversations/${activated.conversationId}`)).status).toBe(404)
        } finally {
            await app?.close()
            provider.closeAllConnections()
            await new Promise<void>(resolve => provider.close(() => resolve()))
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    40_000
)
