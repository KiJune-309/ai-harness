import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ServiceUnavailableException } from '@nestjs/common'
import type {
    ChatConversation,
    CollaborationActionResult,
    CollaborationCommand,
    CollaborationDispatch,
    CollaborationDispatchCommand,
    CollaborationNode,
    CollaborationQuestion,
} from '@ai-harness/contracts'
import type { ChatStore, CollaborationJob, CollaborationLease, CollaborationStore } from '@ai-harness/db'
import { createCollaborationRuntime, type CollaborationJournalSnapshot, type SessionEvent } from '@ai-harness/chat-runtime/collaboration'
import { CollaborationService } from '../src/collaboration-service.js'
import { CollaborationWorker } from '../src/collaboration-worker.js'
import type { AccountService } from '../src/account-service.js'
import { AgentService } from '../src/agent-service.js'
import { createAgentCatalog } from '../src/agent-catalog.js'
import type { ApiConfig } from '../src/config.js'

/** Actual local HTTP request captured before the model fixture responds. */
interface ProviderRequest {
    authorization: string | undefined
    model: string
    messages: { role: string; content: string; tool_call_id?: string }[]
    tools?: { function: { name: string } }[]
}

/** A local HTTP provider exercises real DNS-approved transport, SSE parsing and AgentLoop tools. */
interface ModelFixture {
    origin: string
    requests: ProviderRequest[]
    close(): Promise<void>
}

/**
 * Create a real test-owned local HTTP endpoint; no real provider keys or calls occur.
 * @param next - Produces the next native provider delta and finish reason.
 * @returns The owned endpoint, request capture and resource cleanup.
 */
async function modelFixture(
    next: (request: ProviderRequest, index: number) => { delta: Record<string, unknown>; finish?: string }
): Promise<ModelFixture> {
    const requests: ProviderRequest[] = []
    const server: Server = createServer(async (request, response) => {
        let body = ''
        for await (const piece of request) body += piece.toString()
        const parsed = JSON.parse(body) as Omit<ProviderRequest, 'authorization'>
        const capture = { ...parsed, authorization: request.headers.authorization }
        requests.push(capture)
        const result = next(capture, requests.length)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: result.delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: result.finish ?? 'stop' }] })}\n\ndata: [DONE]\n\n`
        )
    })
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    return {
        origin: `http://127.0.0.1:${address.port}`,
        requests,
        /**
         * Close only the HTTP fixture owned by this test.
         * @returns After its listener and active keep-alive connections close.
         */
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.closeAllConnections()
                server.close(error => (error ? reject(error) : resolve()))
            }),
    }
}

/**
 * Produce one real native collaboration function call.
 * @param kind - Tool category to execute.
 * @param slotId - Existing server-issued effect slot.
 * @param callId - Provider-specific native call identity.
 * @returns Native response fragments consumed by the real provider adapter.
 */
function call(kind: string, slotId: string, callId: string) {
    return {
        delta: {
            tool_calls: [
                {
                    index: 0,
                    id: callId,
                    type: 'function',
                    function: {
                        name: `collaboration_${kind}`,
                        arguments: JSON.stringify({ slotId, content: 'Please provide the missing scale and latency facts.' }),
                    },
                },
            ],
        },
        finish: 'tool_calls',
    }
}

/** Explicit test-only store fake; production construction always requires PostgreSQL. */
class WorkerStoreFixture {
    readonly scope = { workspaceId: 'workspace-fixture', userId: randomUUID() }
    readonly source = { kind: 'conversation' as const, id: randomUUID() }
    readonly recipientId = randomUUID()
    readonly sessionId = randomUUID()
    readonly triggerId = randomUUID()
    readonly jobs: CollaborationJob[] = []
    readonly effects = new Map<string, CollaborationActionResult>()
    readonly commands: CollaborationCommand[] = []
    readonly proposedCommands: CollaborationDispatchCommand[] = []
    readonly drafts = new Map<string, { proposal: CollaborationDispatch; command: CollaborationDispatchCommand }>()
    readonly settlements: { lease: CollaborationLease; status: string }[] = []
    readonly connectionScopes: { userId: string; workspaceId: string; modelId: string }[] = []
    journal: CollaborationJournalSnapshot | undefined
    current: CollaborationJob | undefined
    nodeValue: CollaborationNode | undefined
    questionsValue: CollaborationQuestion[] = []
    failResult = false
    modelAvailable = true
    released = 0
    fastAnswer = false
    readonly now = new Date().toISOString()
    conversation: ChatConversation = {
        id: this.source.id,
        title: 'Owned source',
        messages: [
            {
                id: this.triggerId,
                requestId: this.triggerId,
                role: 'user',
                content: 'Ask my selected colleague.',
                status: 'complete',
                createdAt: this.now,
            },
        ],
        createdAt: this.now,
        updatedAt: this.now,
        agent: {
            id: randomUUID(),
            name: 'Owner assistant',
            description: '',
            modelId: `account:${randomUUID()}`,
            systemPrompt: 'Keep private analysis private.',
            toolIds: [],
            openingMessages: [],
            createdAt: this.now,
            updatedAt: this.now,
        },
    }

    /**
     * Add the initial accepted user trigger with its stable owner and source.
     */
    constructor() {
        this.jobs.push(this.job(this.triggerId, 'human'))
    }

    /**
     * Construct a stable queue item for a known private source.
     * @param triggerId - Durable event/request trigger.
     * @param origin - Actual human or collaboration producer.
     * @returns A private job with a stable logical execution identity.
     */
    job(triggerId: string, origin: 'human' | 'collaboration'): CollaborationJob {
        return {
            id: randomUUID(),
            token: randomUUID(),
            attempt: 1,
            scope: this.scope,
            source: this.source,
            sessionId: this.sessionId,
            triggerId,
            content: origin === 'human' ? 'Ask my selected colleague.' : 'Upstream supplied scale and latency facts. Continue.',
            mentions: origin === 'human' ? [{ userId: this.recipientId, name: 'Coworker B', start: 0, end: 10 }] : [],
            conversation: structuredClone(this.conversation),
            origin,
        }
    }

    /**
     * Build just the explicitly injected persistence methods needed by this worker.
     * @returns A test-only structural fake of the durable repository contract.
     */
    store(): CollaborationStore {
        return {
            expireQuestions: async () => 0,
            claim: async () => {
                if (this.current) return undefined
                const next = this.jobs.shift()
                if (!next) return undefined
                next.conversation = structuredClone(this.conversation)
                this.current = next
                return next
            },
            heartbeat: async () => true,
            assertLease: async lease => {
                if (this.current?.id !== lease.id || this.current.token !== lease.token) throw new Error('Lost test lease')
            },
            sourceEvents: async () => ({ events: [], nodes: this.nodeValue ? [this.nodeValue] : [], questions: this.questionsValue }),
            node: async () => (this.nodeValue ? { node: this.nodeValue, events: [], questions: [], artifacts: [] } : undefined),
            readJournal: async () => structuredClone(this.journal),
            createJournal: async (_lease, header, inheritedEventCount) => {
                this.journal = { header: header as CollaborationJournalSnapshot['header'], inheritedEventCount, events: [] }
            },
            appendJournal: async (_lease, values) => {
                const events = values as SessionEvent[]
                if (!this.journal || events[0]?.seq !== this.journal.events.length) throw new Error('Invalid canonical sequence')
                if (this.failResult && events.some(event => event.type === 'tool/result')) {
                    this.failResult = false
                    throw new Error('Injected journal crash window')
                }
                this.journal.events = [...this.journal.events, ...structuredClone(events)]
            },
            action: async (_scope, id) => this.effects.get(id),
            dispatch: async (_scope, id) => structuredClone(this.drafts.get(id)),
            propose: async (_scope, command, options) => {
                expect(options.authorKind).toBe('agent')
                expect(options.lease?.scope).toEqual(this.scope)
                const prior = this.effects.get(command.requestId)
                if (prior) return prior
                this.proposedCommands.push(structuredClone(command))
                const id = randomUUID()
                const proposal: CollaborationDispatch = {
                    id,
                    version: 1,
                    source: this.source,
                    kind: command.type,
                    recipientId: command.type === 'ask' || command.type === 'answer' ? this.recipientId : command.recipientId,
                    recipientName: 'Coworker B',
                    content:
                        command.type === 'message' || command.type === 'answer'
                            ? command.content
                            : command.type === 'ask'
                              ? command.question
                              : command.context,
                    status: 'pending',
                    createdAt: this.now,
                    updatedAt: this.now,
                }
                this.drafts.set(id, { proposal, command: structuredClone(command) })
                const result: CollaborationActionResult = {
                    requestId: command.requestId,
                    draftId: id,
                    draftVersion: 1,
                    dispatchStatus: 'pending',
                }
                this.effects.set(command.requestId, result)
                return result
            },
            mutate: async (_scope, command, options) => {
                if (command.type === 'confirm-dispatch') {
                    expect(options?.authorKind).not.toBe('agent')
                    expect(_scope).toEqual(this.scope)
                    const draft = this.drafts.get(command.draftId)
                    if (!draft || draft.proposal.version !== command.version) throw new Error('Invalid draft confirmation')
                    if (draft.proposal.status === 'sent') return draft.proposal.result!
                    if (draft.proposal.status !== 'pending') throw new Error('Draft is no longer pending')
                    const delivered = this.deliver(draft.command)
                    const result: CollaborationActionResult = {
                        ...delivered,
                        requestId: command.requestId,
                        draftId: command.draftId,
                        draftVersion: command.version,
                        dispatchStatus: 'sent',
                    }
                    draft.proposal = { ...draft.proposal, status: 'sent', result }
                    return result
                }
                expect(options?.authorKind).toBe('agent')
                expect(options?.lease?.scope).toEqual(this.scope)
                const prior = this.effects.get(command.requestId)
                if (prior) return prior
                const result = this.deliver(command)
                this.effects.set(command.requestId, result)
                return result
            },
            effects: async () => [],
            loadSource: async () => ({
                conversation: structuredClone(this.conversation),
                revision: 1,
                bound: true,
                sessionId: this.sessionId,
            }),
            settle: async (lease, input) => {
                this.settlements.push({ lease, status: input.status })
                if (input.conversation) this.conversation = structuredClone(input.conversation)
                this.current = undefined
                return true
            },
            release: async lease => {
                this.released += 1
                const current = this.current
                this.current = undefined
                if (current && current.id === lease.id) this.jobs.unshift({ ...current, attempt: current.attempt + 1, token: randomUUID() })
                return true
            },
        } as CollaborationStore
    }

    /**
     * Record one actually delivered business effect, separate from a persisted proposal.
     * @param command - Immutable confirmed communication or direct owner-only action.
     * @returns The safe committed business identity.
     */
    deliver(command: CollaborationCommand): CollaborationActionResult {
        this.commands.push(structuredClone(command))
        const result: CollaborationActionResult = {
            requestId: command.requestId,
            ...(command.type === 'message' ? { messageId: randomUUID() } : { questionId: randomUUID() }),
        }
        if (this.fastAnswer && this.nodeValue) {
            this.nodeValue = { ...this.nodeValue, status: 'ready', revision: this.nodeValue.revision + 1 }
            this.jobs.push(this.job(randomUUID(), 'collaboration'))
        }
        return result
    }

    /**
     * Explicitly submit the real owner's review through the same service as a human click.
     * @param service - Actual API coordinator with this isolated injected repository.
     * @returns After the one pending draft has been confirmed without model execution.
     */
    async confirm(service: CollaborationService): Promise<void> {
        const draft = [...this.drafts.values()].find(item => item.proposal.status === 'pending')
        if (!draft) throw new Error('No pending draft')
        await service.command(this.scope, {
            type: 'confirm-dispatch',
            requestId: randomUUID(),
            draftId: draft.proposal.id,
            version: draft.proposal.version,
        })
    }

    /**
     * Create the real coordinator with only private model storage explicitly faked.
     * @param origin - Authorized local fixture endpoint.
     * @param deploymentKey - Test-owned deployment credential, or empty when unconfigured.
     * @returns Service using the actual owner-route resolution code.
     */
    service(origin: string, deploymentKey = 'deployment-secret'): CollaborationService {
        const accounts = {
            defaultModel: async () => undefined,
            getModel: async (scope: typeof this.scope, modelId: string) => {
                this.connectionScopes.push({ ...scope, modelId })
                if (!this.modelAvailable) return undefined
                return { apiKey: 'owner-secret', public: { baseUrl: `${origin}/v1`, model: 'owner-model' } }
            },
        } as unknown as AccountService
        const config = { model: 'deployment-model', apiKey: deploymentKey, systemPrompt: 'Trusted deployment instructions.' } as ApiConfig
        return new CollaborationService(
            { collaboration: this.store() } as ChatStore,
            accounts,
            new AgentService(undefined, createAgentCatalog(config, Boolean(deploymentKey)), accounts),
            config
        )
    }
}

describe('API collaboration worker with real Cordis and local HTTP provider', () => {
    it('keeps discussion private and binds an explicitly requested reviewed reply to the exact received question', async () => {
        const fixture = new WorkerStoreFixture()
        const nodeId = randomUUID()
        const questionId = randomUUID()
        fixture.nodeValue = {
            id: nodeId,
            projectId: randomUUID(),
            ownerId: fixture.scope.userId,
            ownerName: 'Owner',
            title: 'Received context',
            goal: 'Understand the request',
            context: 'Coworker asks for help, not permission to send.',
            source: fixture.source,
            upstreamNodeId: randomUUID(),
            agentLabel: 'Owner assistant',
            status: 'ready',
            revision: 1,
            adoptions: [],
            canActivate: false,
            canManage: true,
            canWork: true,
            createdAt: fixture.now,
            updatedAt: fixture.now,
        }
        fixture.questionsValue = [
            {
                id: questionId,
                projectId: fixture.nodeValue.projectId,
                nodeId: fixture.nodeValue.upstreamNodeId!,
                targetNodeId: nodeId,
                version: 2,
                question: '请给出排查结果',
                context: 'Only this question.',
                status: 'pending',
                answer: null,
                decision: null,
                createdAt: fixture.now,
                updatedAt: fixture.now,
            },
        ]
        fixture.jobs[0]!.mentions = []
        fixture.jobs[0]!.content = '帮我理解对方的需求'
        const model = await modelFixture((request, index) => {
            expect(request.tools?.some(tool => tool.function.name === 'collaboration_artifact') ?? false).toBe(false)
            return index === 4
                ? call('reply', `reply:${questionId}:2`, 'exact-reply')
                : { delta: { content: '先和你讨论需求，保持在本人的聊天里。' } }
        })
        const service = fixture.service(model.origin)
        const worker = new CollaborationWorker(
            service,
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        try {
            await worker.tick()
            for (const content of ['请先分析并安排本地排查', '确认']) {
                const job = fixture.job(randomUUID(), 'human')
                job.mentions = []
                job.content = content
                fixture.jobs.push(job)
                await worker.tick()
            }
            expect(fixture.commands).toHaveLength(0)
            expect(fixture.drafts.size).toBe(0)
            expect(fixture.questionsValue[0]!.status).toBe('pending')
            const explicit = fixture.job(randomUUID(), 'human')
            explicit.mentions = []
            explicit.content = '请把排查结果回复给发件人'
            fixture.jobs.push(explicit)
            await worker.tick()
            expect(fixture.proposedCommands).toEqual([
                expect.objectContaining({ type: 'answer', questionId, version: 2, decision: 'information' }),
            ])
            expect(fixture.commands).toHaveLength(0)
            expect(model.requests).toHaveLength(4)
            expect(fixture.settlements.at(-1)?.status).toBe('waiting')
            await fixture.confirm(service)
            expect(fixture.commands).toEqual([
                expect.objectContaining({
                    type: 'answer',
                    questionId,
                    version: 2,
                    content: 'Please provide the missing scale and latency facts.',
                }),
            ])
            expect(model.requests).toHaveLength(4)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('does not expose fresh communication tools when a coworker reply only wakes local continuation', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.jobs[0]!.origin = 'collaboration'
        fixture.nodeValue = {
            id: randomUUID(),
            projectId: randomUUID(),
            ownerId: fixture.scope.userId,
            ownerName: 'Owner',
            title: 'Assessment',
            goal: 'Assess privately',
            context: 'Received reference material',
            source: fixture.source,
            upstreamNodeId: randomUUID(),
            agentLabel: 'Owner assistant',
            status: 'ready',
            revision: 1,
            adoptions: [],
            canActivate: false,
            canManage: true,
            canWork: true,
            createdAt: fixture.now,
            updatedAt: fixture.now,
        }
        const model = await modelFixture(request => {
            expect(
                request.tools?.some(tool =>
                    [
                        'collaboration_message',
                        'collaboration_handoff',
                        'collaboration_question',
                        'collaboration_reply',
                        'collaboration_artifact',
                    ].includes(tool.function.name)
                ) ?? false
            ).toBe(false)
            return { delta: { content: '继续为本人整理收到的资料。' } }
        })
        const worker = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        try {
            await worker.tick()
            expect(fixture.drafts.size).toBe(0)
            expect(fixture.commands).toHaveLength(0)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('resolves the owner connection, persists a private review draft, and sends only after human confirmation', async () => {
        const fixture = new WorkerStoreFixture()
        const model = await modelFixture((request, index) =>
            index === 1
                ? {
                      ...call('message', `contact:${fixture.recipientId}`, 'native-call-one'),
                      delta: {
                          ...call('message', `contact:${fixture.recipientId}`, 'native-call-one').delta,
                          content: 'The colleague already received this message.',
                      },
                  }
                : {
                      delta: {
                          content: request.messages.some(message => message.role === 'tool')
                              ? 'The message was delivered.'
                              : 'Missing tool result.',
                      },
                  }
        )
        const runtime = await createCollaborationRuntime({ apiKey: 'deployment-secret', allowedLocalOrigins: [model.origin] })
        const worker = new CollaborationWorker(fixture.service(model.origin), runtime)
        try {
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['waiting'])
            expect(fixture.commands).toHaveLength(0)
            expect(fixture.proposedCommands).toHaveLength(1)
            expect(fixture.proposedCommands[0]?.type).toBe('message')
            expect(model.requests).toHaveLength(1)
            expect(
                model.requests[0]?.messages
                    .filter(message => message.role === 'system')
                    .map(message => message.content)
                    .join('\n')
            ).toContain('You coordinate coworkers')
            expect(model.requests[0]?.tools?.some(tool => tool.function.name.includes('confirm'))).toBe(false)
            expect(
                model.requests[0]?.messages
                    .filter(message => message.role === 'system')
                    .map(message => message.content)
                    .join('\n')
            ).toContain('Keep private analysis private')
            expect(
                model.requests.every(request => request.model === 'owner-model' && request.authorization === 'Bearer owner-secret')
            ).toBe(true)
            expect(fixture.connectionScopes[0]?.userId).toBe(fixture.scope.userId)
            expect(fixture.conversation.messages.at(-1)?.content).toBe('我已整理好发送内容，请确认后再发送。')
            await fixture.confirm(fixture.service(model.origin))
            expect(fixture.commands).toHaveLength(1)
            expect(fixture.commands[0]?.type).toBe('message')
            expect(model.requests).toHaveLength(1)
            expect(JSON.stringify(fixture.journal)).not.toMatch(/owner-secret|deployment-secret/)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('keeps a fast upstream reply queued until the concluding wait turn releases its source and tags the reply as collaboration', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.nodeValue = {
            id: randomUUID(),
            projectId: randomUUID(),
            ownerId: fixture.scope.userId,
            ownerName: 'Owner',
            title: 'Assessment',
            goal: 'Assess',
            context: 'Shared authorized context',
            source: fixture.source,
            upstreamNodeId: randomUUID(),
            agentLabel: 'Owner assistant',
            status: 'running',
            revision: 1,
            adoptions: [],
            canActivate: false,
            canManage: true,
            canWork: true,
            createdAt: fixture.now,
            updatedAt: fixture.now,
        }
        fixture.fastAnswer = true
        const model = await modelFixture((_request, index) =>
            index === 1
                ? call('question', 'upstream', 'upstream-call')
                : { delta: { content: 'Assessment continued using the upstream answer.' } }
        )
        const worker = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        try {
            await worker.tick()
            expect(model.requests).toHaveLength(1)
            expect(fixture.settlements.map(item => item.status)).toEqual(['waiting'])
            expect(fixture.jobs).toHaveLength(0)
            expect(fixture.commands).toHaveLength(0)
            expect(fixture.proposedCommands[0]?.type).toBe('ask')
            expect(fixture.nodeValue.status).toBe('running')
            await fixture.confirm(fixture.service(model.origin))
            expect(fixture.commands).toHaveLength(1)
            expect(fixture.jobs).toHaveLength(1)
            expect(fixture.nodeValue.status).toBe('ready')
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['waiting', 'complete'])
            expect(model.requests).toHaveLength(2)
            expect(fixture.journal?.events.some(event => event.type === 'user/message' && event.data.source.kind === 'collaboration')).toBe(
                true
            )
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('settles an already terminal journal after restart without resolving a now-deleted owner model or calling HTTP', async () => {
        const fixture = new WorkerStoreFixture()
        const originalJob = structuredClone(fixture.jobs[0]!)
        const model = await modelFixture(() => ({ delta: { content: 'Persisted terminal answer.' } }))
        const first = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        await first.tick()
        await first.close()
        const resolutions = fixture.connectionScopes.length
        fixture.modelAvailable = false
        fixture.jobs.push({ ...originalJob, token: randomUUID(), attempt: 2 })
        const restarted = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        try {
            await restarted.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['complete', 'complete'])
            expect(fixture.connectionScopes).toHaveLength(resolutions)
            expect(model.requests).toHaveLength(1)
            expect(
                fixture.conversation.messages.filter(message => message.role === 'assistant' && message.requestId === originalJob.triggerId)
            ).toHaveLength(1)
        } finally {
            await restarted.close()
            await model.close()
        }
    })

    it('replays a terminal unconfirmed draft after worker restart without resolving a deleted connection or sending', async () => {
        const fixture = new WorkerStoreFixture()
        const originalJob = structuredClone(fixture.jobs[0]!)
        const model = await modelFixture(() => call('message', `contact:${fixture.recipientId}`, 'one-review-draft'))
        const first = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        await first.tick()
        await first.close()
        const resolutions = fixture.connectionScopes.length
        const originalDraftId = [...fixture.drafts.keys()][0]
        fixture.modelAvailable = false
        fixture.jobs.push({ ...originalJob, token: randomUUID(), attempt: 2 })
        const restarted = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        try {
            await restarted.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['waiting', 'waiting'])
            expect(fixture.connectionScopes).toHaveLength(resolutions)
            expect(model.requests).toHaveLength(1)
            expect(fixture.commands).toHaveLength(0)
            expect(fixture.proposedCommands).toHaveLength(1)
            expect([...fixture.drafts.keys()]).toEqual([originalDraftId])
            expect([...fixture.drafts.values()][0]?.proposal.status).toBe('pending')
            const visible = fixture.conversation.messages.filter(
                message => message.role === 'assistant' && message.requestId === originalJob.triggerId
            )
            expect(visible).toHaveLength(1)
            expect(visible[0]?.content).toBe('我已整理好发送内容，请确认后再发送。')
        } finally {
            await restarted.close()
            await model.close()
        }
    })

    it('keeps a question to this owner as a direct judgment wait without requiring a cross-person send draft', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.nodeValue = {
            id: randomUUID(),
            projectId: randomUUID(),
            ownerId: fixture.scope.userId,
            ownerName: 'Owner',
            title: 'Assessment',
            goal: 'Assess',
            context: 'Shared authorized context',
            source: fixture.source,
            agentLabel: 'Owner assistant',
            status: 'running',
            revision: 1,
            adoptions: [],
            canActivate: false,
            canManage: true,
            canWork: true,
            createdAt: fixture.now,
            updatedAt: fixture.now,
        }
        const model = await modelFixture(() => call('judgment', 'owner', 'owner-decision'))
        const worker = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        try {
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['waiting'])
            expect(fixture.proposedCommands).toHaveLength(0)
            expect(fixture.drafts.size).toBe(0)
            expect(fixture.commands).toHaveLength(1)
            expect(fixture.commands[0]).toMatchObject({ type: 'ask', nodeId: fixture.nodeValue.id, targetNodeId: fixture.nodeValue.id })
            expect(model.requests).toHaveLength(1)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('recovers a pending draft after lost tool-result durability with no send or second draft despite a new native call ID', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.failResult = true
        const model = await modelFixture((_request, index) =>
            index <= 2
                ? call('message', `contact:${fixture.recipientId}`, `native-call-${index}`)
                : { delta: { content: 'Recovered the original delivered message.' } }
        )
        const worker = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        let restarted: CollaborationWorker | undefined
        try {
            await worker.tick()
            expect(fixture.effects.size).toBe(1)
            expect(fixture.released).toBe(1)
            expect(fixture.jobs).toHaveLength(1)
            await worker.close()
            restarted = new CollaborationWorker(
                fixture.service(model.origin),
                await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
            )
            await restarted.tick()
            expect(fixture.effects.size).toBe(1)
            expect(fixture.commands).toHaveLength(0)
            expect(fixture.proposedCommands).toHaveLength(1)
            expect(fixture.drafts.size).toBe(1)
            expect(fixture.settlements.at(-1)?.status).toBe('waiting')
            expect(model.requests).toHaveLength(2)
            expect(fixture.conversation.messages.at(-1)?.content).toBe('我已整理好发送内容，请确认后再发送。')
        } finally {
            await worker.close()
            await restarted?.close()
            await model.close()
        }
    })

    it('treats repeated explicit mentions of the same colleague as the same authorized effect identity', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.jobs[0]!.mentions.push({ ...fixture.jobs[0]!.mentions[0]!, start: 20, end: 30 })
        const model = await modelFixture((_request, index) =>
            index === 1
                ? call('message', `contact:${fixture.recipientId}`, 'one-repeated-recipient')
                : { delta: { content: 'One message to the selected colleague.' } }
        )
        const worker = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        try {
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['waiting'])
            expect(fixture.commands).toHaveLength(0)
            expect(fixture.proposedCommands).toHaveLength(1)
            expect(fixture.effects.size).toBe(1)
            expect(model.requests).toHaveLength(1)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('persists a visible safe failure for an initial transfer when the owner model is unavailable', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.modelAvailable = false
        const model = await modelFixture(() => ({ delta: { content: 'This provider must not be contacted.' } }))
        const worker = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: 'deployment-secret', allowedLocalOrigins: [model.origin] })
        )
        try {
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['failed'])
            const failure = fixture.conversation.messages.find(
                message => message.role === 'assistant' && message.requestId === fixture.triggerId
            )
            expect(failure?.status).toBe('error')
            expect(failure?.content).toContain('模型连接已删除或不可用')
            expect(failure?.content).toContain('已提交的消息和成果会保留')
            expect(model.requests).toHaveLength(0)
            expect(fixture.effects.size).toBe(0)
            expect(fixture.journal).toBeUndefined()
            expect(JSON.stringify(failure)).not.toMatch(/owner-secret|deployment-secret|SELECT|postgresql:/)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('executes a previously saved deployment route without requiring or reading a personal model connection', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.conversation.agent!.modelId = 'deployment-model'
        const model = await modelFixture((_request, index) =>
            index === 1
                ? call('message', `contact:${fixture.recipientId}`, 'native-system-message')
                : { delta: { content: 'The system model delivered the message.' } }
        )
        const worker = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: 'deployment-secret', baseUrl: model.origin })
        )
        try {
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['waiting'])
            expect(fixture.connectionScopes).toHaveLength(0)
            expect(fixture.commands).toHaveLength(0)
            expect(fixture.proposedCommands).toHaveLength(1)
            expect(model.requests).toHaveLength(1)
            expect(
                model.requests.every(
                    request => request.model === 'deployment-model' && request.authorization === 'Bearer deployment-secret'
                )
            ).toBe(true)
            expect(fixture.conversation.messages.at(-1)?.content).toBe('我已整理好发送内容，请确认后再发送。')
            expect(JSON.stringify(fixture.journal)).not.toMatch(/owner-secret|deployment-secret/)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('explains an unconfigured system model without asking every user for personal credentials or contacting a provider', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.conversation.agent!.modelId = 'deployment-model'
        const model = await modelFixture(() => ({ delta: { content: 'This provider must not be contacted.' } }))
        const worker = new CollaborationWorker(
            fixture.service(model.origin, ''),
            await createCollaborationRuntime({ apiKey: '', baseUrl: model.origin })
        )
        try {
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['failed'])
            const failure = fixture.conversation.messages.find(
                message => message.role === 'assistant' && message.requestId === fixture.triggerId
            )
            expect(failure?.status).toBe('error')
            expect(failure?.content).toContain('系统默认模型暂不可用')
            expect(failure?.content).toContain('管理员')
            expect(failure?.content).not.toContain('账户设置')
            expect(failure?.content).toContain('已提交的消息和成果会保留')
            expect(fixture.connectionScopes).toHaveLength(0)
            expect(fixture.released).toBe(0)
            expect(fixture.journal).toBeUndefined()
            expect(fixture.effects.size).toBe(0)
            expect(model.requests).toHaveLength(0)
            expect(JSON.stringify(failure)).not.toMatch(/owner-secret|deployment-secret|SELECT|postgresql:/)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('keeps arbitrary service-unavailable details out of the persisted public failure', async () => {
        const fixture = new WorkerStoreFixture()
        const model = await modelFixture(() => ({ delta: { content: 'This provider must not be contacted.' } }))
        const service = fixture.service(model.origin)
        /**
         * Simulate an unexpected service failure containing private diagnostic details.
         * @returns Never resolves.
         * @throws ServiceUnavailableException carrying test-only secret sentinels.
         */
        service.connection = async () => {
            throw new ServiceUnavailableException('owner-secret deployment-secret SELECT postgresql://private-database')
        }
        const worker = new CollaborationWorker(
            service,
            await createCollaborationRuntime({ apiKey: 'deployment-secret', allowedLocalOrigins: [model.origin] })
        )
        try {
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['failed'])
            const failure = fixture.conversation.messages.find(
                message => message.role === 'assistant' && message.requestId === fixture.triggerId
            )
            expect(failure?.content).toBe('模型执行未完成，请检查本人的模型连接后重试；已提交的消息和成果会保留。')
            expect(JSON.stringify(failure)).not.toMatch(/owner-secret|deployment-secret|SELECT|postgresql:/)
            expect(fixture.journal).toBeUndefined()
            expect(fixture.effects.size).toBe(0)
            expect(model.requests).toHaveLength(0)
        } finally {
            await worker.close()
            await model.close()
        }
    })

    it('uses a database-inherited unconsumed person intent after clarification, then removes the contact capability after consumption', async () => {
        const fixture = new WorkerStoreFixture()
        fixture.jobs[0]!.content = '@Coworker B 请评估方案，缺少数据时先问我。'
        const originalMentions = structuredClone(fixture.jobs[0]!.mentions)
        const model = await modelFixture((request, index) => {
            if (index === 1) return { delta: { content: 'What request rate and latency target should the colleague assess?' } }
            if (index === 2) {
                expect(
                    request.messages.some(message => message.role === 'user' && message.content.includes('500 QPS; p95 below two seconds.'))
                ).toBe(true)
                expect(request.tools?.some(tool => tool.function.name === 'collaboration_handoff')).toBe(true)
                return call('handoff', `contact:${fixture.recipientId}`, 'clarified-handoff')
            }
            expect(request.tools?.some(tool => tool.function.name === 'collaboration_handoff') ?? false).toBe(false)
            return { delta: { content: 'The existing handoff remains available to its recipient.' } }
        })
        const worker = new CollaborationWorker(
            fixture.service(model.origin),
            await createCollaborationRuntime({ apiKey: '', allowedLocalOrigins: [model.origin] })
        )
        try {
            await worker.tick()
            expect(fixture.commands).toHaveLength(0)
            const clarification = fixture.job(randomUUID(), 'human')
            clarification.content = '500 QPS; p95 below two seconds.'
            // These are injected as the repository's still-unconsumed original grant, not parsed from this plain follow-up.
            clarification.mentions = originalMentions
            fixture.jobs.push(clarification)
            await worker.tick()
            expect(fixture.settlements.map(item => item.status)).toEqual(['complete', 'waiting'])
            expect(fixture.commands).toHaveLength(0)
            expect(fixture.proposedCommands).toHaveLength(1)
            expect(fixture.proposedCommands[0]).toMatchObject({
                type: 'delegate',
                recipientId: fixture.recipientId,
                source: fixture.source,
            })
            await fixture.confirm(fixture.service(model.origin))
            expect(fixture.commands).toHaveLength(1)
            const afterConsumption = fixture.job(randomUUID(), 'human')
            afterConsumption.content = 'Show me the current state.'
            // The repository has consumed the original grant, so a later plain input has no contact capability.
            afterConsumption.mentions = []
            fixture.jobs.push(afterConsumption)
            await worker.tick()
            expect(fixture.commands).toHaveLength(1)
            expect(fixture.effects.size).toBe(1)
            expect(model.requests).toHaveLength(3)
        } finally {
            await worker.close()
            await model.close()
        }
    })
})
