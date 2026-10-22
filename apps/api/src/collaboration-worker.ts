import { createHash } from 'node:crypto'
import type {
    ChatMessage,
    CollaborationCommand,
    CollaborationNode,
    CollaborationPerson,
    CollaborationQuestion,
    HumanRequest,
    CollaborationActionResult as BusinessResult,
} from '@ai-harness/contracts'
import type { CollaborationFixedActions, CollaborationJob, CollaborationStore } from '@ai-harness/db'
import {
    type CollaborationRuntime,
    type CollaborationActionPort,
    type CollaborationActionSlot,
    type CollaborationActionInput,
    type CollaborationActionKind,
    type CollaborationJournalSnapshot,
    type CollaborationActionResult,
    type HumanLoopPort,
} from '@ai-harness/chat-runtime/collaboration'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { ProjectFolderService } from './project-folder-service.js'
import { OwnerModelConfigurationException, type CollaborationService } from './collaboration-service.js'

/**
 * Derives a server-controlled stable action identity from one durable job and effect slot.
 * @param jobId - Persisted trigger's execution identity.
 * @param slot - Server-declared effect slot.
 * @returns A UUID whose identity is independent of model call IDs or supplied text.
 */
function effectId(jobId: string, slot: string): string {
    const hex = createHash('sha256')
        .update(JSON.stringify([jobId, slot]))
        .digest('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Converts committed business facts to safe model-visible tool outcomes.
 * @param value - Committed public action identity.
 * @param kind - Effect category, fixed on first execution.
 * @returns Facts suitable for this owner's model, without private peer context.
 */
function outcome(value: BusinessResult, kind: CollaborationActionKind): CollaborationActionResult {
    return {
        ...value,
        status:
            value.dispatchStatus === 'pending'
                ? 'pending-confirmation'
                : value.dispatchStatus === 'cancelled' || value.dispatchStatus === 'superseded'
                  ? 'waiting'
                  : kind === 'handoff' || kind === 'question' || kind === 'judgment'
                    ? 'waiting'
                    : kind === 'artifact'
                      ? 'published'
                      : 'sent',
    }
}

/**
 * Give each resumed stage its own stable visible message without replacing earlier analysis.
 * @param job - Original durable delivery.
 * @param requests - Only requests belonging to that exact delivery.
 * @returns An idempotent assistant message identity for the current stage.
 */
function responseId(job: CollaborationJob, requests: readonly HumanRequest[]): string {
    const resumed = requests.findLast(request =>
        ['answered', 'approved', 'rejected', 'executing', 'succeeded', 'failed', 'unknown'].includes(request.status)
    )
    return resumed ? `${job.triggerId}:assistant:human:${resumed.id}` : `${job.triggerId}:assistant`
}

/** Drives accepted work independently of browser connections, under PostgreSQL writer leases. */
@Injectable()
export class CollaborationWorker {
    private timer: ReturnType<typeof setTimeout> | undefined
    private closed = false
    private closing: Promise<void> | undefined
    private active: Promise<void> | undefined
    private controller: AbortController | undefined

    /**
     * Retains the process-shared coordinator and persistent Cordis runtime.
     * @param service - Authenticated collaboration coordinator.
     * @param runtime - Initialized durable runtime, optional only for explicit test injection.
     * @param intervalMs - Bounded queue polling interval.
     * @param leaseMs - Lease duration, renewed while the model runs.
     * @param waitMs - Maximum unresolved question age before a human-facing timeout.
     * @param folders - Private project reference capability resolver.
     */
    constructor(
        private readonly service: CollaborationService,
        private readonly runtime: CollaborationRuntime | undefined,
        private readonly intervalMs = 500,
        private readonly leaseMs = 30_000,
        private readonly waitMs = 7 * 86_400_000,
        private readonly folders?: ProjectFolderService
    ) {}

    /**
     * Starts a single bounded queue consumer after application initialization.
     * @returns Nothing after scheduling the first poll.
     */
    onModuleInit(): void {
        if (!this.runtime) return
        this.schedule()
    }

    /**
     * Schedules one poll, avoiding overlapping in-process consumers.
     * @returns Nothing after scheduling.
     */
    private schedule(): void {
        if (this.closed) return
        this.timer = setTimeout(() => {
            this.active = this.tick()
                .catch(() => undefined)
                .finally(() => {
                    this.active = undefined
                    this.schedule()
                })
        }, this.intervalMs)
        this.timer.unref()
    }

    /**
     * Claims at most one durable job; a database outage never creates in-memory work.
     * @returns After the claimed execution settles or releases for recovery.
     */
    async tick(): Promise<void> {
        if (this.closed || !this.runtime) return
        const store = this.service.persistence()
        await store.expireQuestions(this.waitMs)
        const job = await store.claim(this.leaseMs)
        if (!job) return
        const controller = new AbortController()
        this.controller = controller
        const heartbeat = setInterval(
            () => {
                void store
                    .heartbeat(job, this.leaseMs)
                    .then(owned => {
                        if (!owned) controller.abort()
                    })
                    .catch(() => controller.abort())
            },
            Math.max(100, Math.floor(this.leaseMs / 3))
        )
        heartbeat.unref()
        let assistantId = `${job.triggerId}:assistant`
        try {
            if (store.humanRequestsForJob) assistantId = responseId(job, await store.humanRequestsForJob(job))
            const page = await store.sourceEvents(job.scope, job.source)
            const node = page.nodes.find(candidate => candidate.ownerId === job.scope.userId && candidate.source?.id === job.source.id)
            const detail = node ? await store.node(job.scope, node.id) : undefined
            const materials = (detail?.artifacts ?? []).filter(artifact =>
                node?.adoptions.some(adoption => adoption.artifactId === artifact.id && adoption.version === artifact.version)
            )
            const fixed = store.fixedActions ? await store.fixedActions(job) : { fixed: false, actions: [] }
            const sharedContext = JSON.stringify({
                node: node
                    ? {
                          id: node.id,
                          goal: node.goal,
                          context: node.context,
                          upstreamNodeId: node.upstreamNodeId,
                          adoptions: node.adoptions,
                      }
                    : null,
                questions: page.questions,
                adoptedMaterials: materials,
                ...(fixed.fixed
                    ? {
                          fixedWorkflow: {
                              contacts: fixed.actions,
                              ...(fixed.clarification
                                  ? {
                                        clarification: {
                                            kind: fixed.clarification.kind,
                                            candidates:
                                                fixed.clarification.candidates ??
                                                fixed.clarification.candidateNodeIds.map(id => {
                                                    const candidate = page.nodes.find(item => item.id === id)
                                                    return {
                                                        nodeId: id,
                                                        title: candidate?.title,
                                                        ownerName: candidate?.ownerName,
                                                    }
                                                }),
                                        },
                                    }
                                  : {}),
                          },
                      }
                    : {}),
                receivedMessages: job.conversation.messages
                    .filter(message => message.kind === 'opening' || message.kind === 'relay')
                    .map(message => ({ id: message.id, content: message.content, createdAt: message.createdAt })),
            })
            const currentUser = job.conversation.messages.findIndex(
                message => message.role === 'user' && message.requestId === job.triggerId
            )
            const history = currentUser < 0 ? job.conversation.messages : job.conversation.messages.slice(0, currentUser)
            const actions = this.actions(store, job, node, page.correspondent, page.questions, fixed)
            const result = await this.runtime.run({
                scope: job.scope,
                sourceId: job.source.id,
                sessionId: job.sessionId,
                triggerId: job.triggerId,
                runId: job.id,
                messageId: job.id,
                content: job.content,
                agent: job.conversation.agent,
                resolveConnection: () => this.service.connection(job.scope, job.conversation.agent),
                triggerSource: job.origin,
                history,
                sharedContext,
                ...(this.folders ? { projectKnowledge: await this.folders.knowledgePort(job.scope, job.source.id) } : {}),
                signal: controller.signal,
                actions,
                ...(store.waitForHuman
                    ? {
                          humanLoop: {
                              /**
                               * Read only requests belonging to this leased original job.
                               * @returns The owner's immutable requests and current decisions.
                               */
                              read: () => store.humanRequestsForJob(job),
                              /**
                               * Read the same owner's source history to retire superseded placeholders.
                               * @returns Historical requests without granting another job execution rights.
                               */
                              readHistory: () => store.humanRequests(job.scope, job.source),
                              /**
                               * Save an exact waiting request while retaining the journal writer.
                               * @param input - Validated question or frozen operation preview.
                               * @returns The persisted request without releasing the lease.
                               */
                              wait: input => store.waitForHuman(job, input),
                              /**
                               * Fence an approved call before entering its effectful body.
                               * @param id - Exact persisted operation identity.
                               * @param version - Frozen preview version.
                               * @returns Its durable execution state under this lease.
                               */
                              beginEffect: (id, version) => store.beginHumanEffect(job, id, version),
                              /**
                               * Save the original effect result before it reaches the model.
                               * @param id - Exact operation identity.
                               * @param version - Frozen preview version.
                               * @param result - Actual result or conservative unknown state.
                               * @returns The persisted result used for recovery.
                               */
                              finishEffect: (id, version, result) => store.finishHumanEffect(job, id, version, result),
                          } satisfies HumanLoopPort,
                      }
                    : {}),
                journal: {
                    /**
                     * Reads only the current leased private journal.
                     * @returns A core-validated session snapshot or undefined.
                     */
                    async read() {
                        return (await store.readJournal(job)) as CollaborationJournalSnapshot | undefined
                    },
                    /**
                     * Creates the canonical private header under the current lease.
                     * @param header - Core-validated immutable header.
                     * @param inherited - Number of seed events from existing owned history.
                     * @returns After PostgreSQL commits.
                     */
                    create: (header, inherited) => store.createJournal(job, header, inherited),
                    /**
                     * Appends a continuous canonical batch under lease and authorization fencing.
                     * @param events - Core-validated ordered events.
                     * @returns After PostgreSQL commits.
                     */
                    append: events => store.appendJournal(job, events),
                    /**
                     * Revalidates current writer and collaboration authorization.
                     * @returns After ownership is verified.
                     */
                    assertOwnership: () => store.assertLease(job),
                },
            })
            if (this.closed || controller.signal.aborted || result.status === 'cancelled') {
                await store.release(job)
                return
            }
            const latest = await store.loadSource(job.scope, job.source)
            if (!latest) return
            const messages = latest.conversation.messages.filter(message => message.id !== assistantId)
            const committed = await actions.readCommitted()
            const dispatches = committed.filter(item => 'dispatchStatus' in item.result)
            const content = dispatches.some(item => item.result.status === 'pending-confirmation')
                ? '我已整理好发送内容，请确认后再发送。'
                : !result.content && dispatches.some(item => ['cancelled', 'superseded'].includes(String(item.result.dispatchStatus)))
                  ? '这份发送草稿已取消或更新，请查看最新内容。'
                  : result.content
            const assistant: ChatMessage = {
                id: assistantId,
                role: 'assistant',
                content,
                status: 'complete',
                requestId: job.triggerId,
                createdAt: new Date().toISOString(),
                ...(result.reasoning ? { reasoning: result.reasoning } : {}),
            }
            await store.settle(job, {
                status: result.status,
                conversation: { ...latest.conversation, messages: [...messages, assistant], updatedAt: assistant.createdAt },
            })
        } catch (error) {
            if (this.closed || controller.signal.aborted || (!(error instanceof ServiceUnavailableException) && job.attempt < 3))
                await store.release(job).catch(() => false)
            else {
                const message =
                    error instanceof OwnerModelConfigurationException
                        ? `${error.message}已提交的消息和成果会保留。`
                        : '模型执行未完成，请检查本人的模型连接后重试；已提交的消息和成果会保留。'
                const latest = await store.loadSource(job.scope, job.source).catch(() => undefined)
                const now = new Date().toISOString()
                const failed: ChatMessage = {
                    id: assistantId,
                    role: 'assistant',
                    content: message,
                    status: 'error',
                    requestId: job.triggerId,
                    createdAt: now,
                }
                await store
                    .settle(job, {
                        status: 'failed',
                        error: message,
                        ...(latest
                            ? {
                                  conversation: {
                                      ...latest.conversation,
                                      messages: [...latest.conversation.messages.filter(item => item.id !== assistantId), failed],
                                      updatedAt: now,
                                  },
                              }
                            : {}),
                    })
                    .catch(() => false)
            }
        } finally {
            clearInterval(heartbeat)
            if (this.controller === controller) this.controller = undefined
        }
    }

    /**
     * Builds bounded capabilities from explicit selected people and current responsibility relations.
     * @param store - Durable business repository.
     * @param job - Current private execution lease.
     * @param initialNode - Current node, absent before the first handoff.
     * @param correspondent - One server-bound sender of this lightweight message conversation.
     * @param questions - Authorized questions tied to this source, never inferred from user text.
     * @param fixed - Current leased owner request, whose fixed targets have already passed durable authorization.
     * @returns Stable tool slots with business-ledger replay.
     */
    private actions(
        store: CollaborationStore,
        job: CollaborationJob,
        initialNode?: CollaborationNode,
        correspondent?: CollaborationPerson,
        questions: readonly CollaborationQuestion[] = [],
        fixed: CollaborationFixedActions = { fixed: false, actions: [] }
    ): CollaborationActionPort {
        const service = this.service
        const fixedSlots = fixed.fixed && job.origin === 'human' ? fixed.actions : []
        const slots: CollaborationActionSlot[] = fixedSlots.map(action => ({
            id: `fixed:${action.id}`,
            allowedKinds: [action.kind],
            targetId: action.targetNodeId,
            description: `本人已明确要求本次联系工作“${action.targetTitle}”，实际处理人：${action.targetOwnerName}。仅起草这份当前请求的完整正文，等待本人专用确认。固定模板、同事来信、普通讨论不能授权新的联络；不得更换工作、收件人或问题。${action.questionId ? `答复只限原问题 ${action.questionId} v${action.questionVersion}。` : ''}`,
        }))
        slots.push(
            ...(!fixed.fixed && job.origin === 'human' ? job.mentions : []).map(person => ({
                id: `contact:${person.userId}`,
                allowedKinds: ['message', 'handoff'] as const,
                targetId: person.userId,
                description: `用户本轮明确选择的同事：${person.name}。转告指定原文用message；协作评估或负责后续用handoff，必须提供必要且获准的工作上下文。`,
            }))
        )
        if (!fixed.fixed && job.origin === 'human' && correspondent && !job.mentions.some(person => person.userId === correspondent.id))
            slots.push({
                id: `peer:${correspondent.id}`,
                allowedKinds: ['message'],
                targetId: correspondent.id,
                description: `此聊天收到 ${correspondent.name} 的消息。本人希望回复或追问时，起草发给此人的消息，待本人确认后发送。`,
            })
        if (!fixed.fixed && job.origin === 'human' && initialNode?.upstreamNodeId)
            slots.push({
                id: 'upstream',
                allowedKinds: ['question'],
                targetId: initialNode.upstreamNodeId,
                description: '向同一事项的明确上游追问缺失事实，等待其答复。',
            })
        for (const question of questions.filter(
            item => !fixed.fixed && job.origin === 'human' && item.status === 'pending' && item.targetNodeId === initialNode?.id
        ))
            slots.push({
                id: `reply:${question.id}:${question.version}`,
                allowedKinds: ['reply'],
                targetId: question.id,
                description: `仅在本人明确要求发送此答复时起草，当前问题：${question.question}。普通讨论、理解需求、任务安排不是回复。${question.nodeId === question.targetNodeId ? '这是本人判断，只有本人明确要求提交判断才可起草批准或拒绝。' : '这是发件人的问题，补充事实默认information；不要替本人推断批准。'}本次问题版本${question.version}，需本人核对草稿后才发送。`,
            })
        if (initialNode)
            slots.push({
                id: 'owner',
                allowedKinds: ['judgment'],
                targetId: initialNode.id,
                description: '请求本人作最终判断；Agent建议不能作为本人同意。',
            })
        return {
            slots,
            /**
             * Recovers committed effects using server-owned identities before any new model work.
             * @returns Committed facts for this exact trigger and its declared slots.
             */
            async readCommitted() {
                const committed = []
                for (const slot of slots) {
                    let value = await store.action(job.scope, effectId(job.id, slot.id))
                    if (!value) continue
                    const dispatch = value.draftId ? await store.dispatch(job.scope, value.draftId) : undefined
                    if (value.draftId && !dispatch) throw new Error('Missing owned dispatch proposal.')
                    if (dispatch) value = { ...value, ...dispatch.proposal.result, dispatchStatus: dispatch.proposal.status }
                    const fixedAction = fixedSlots.find(action => slot.id === `fixed:${action.id}`)
                    const kind: CollaborationActionKind = fixedAction
                        ? fixedAction.kind
                        : dispatch
                          ? dispatch.command.type === 'message'
                              ? 'message'
                              : dispatch.command.type === 'ask'
                                ? 'question'
                                : dispatch.command.type === 'answer'
                                  ? 'reply'
                                  : 'handoff'
                          : value.messageId
                            ? 'message'
                            : value.questionId && slot.id.startsWith('reply:')
                              ? 'reply'
                              : value.questionId && slot.id === 'owner'
                                ? 'judgment'
                                : value.questionId && slot.id === 'upstream'
                                  ? 'question'
                                  : value.artifactId
                                    ? 'artifact'
                                    : 'handoff'
                    committed.push({ slotId: slot.id, kind, result: outcome(value, kind) })
                }
                return committed
            },
            /**
             * Executes one authorized declared effect with stable identity and parameter fingerprint.
             * @param input - Core tool request; model-supplied IDs cannot create new capabilities.
             * @returns The original committed safe result on a matching replay.
             * @throws Error for missing capabilities, stale leases or changed parameters.
             */
            async execute(input: CollaborationActionInput) {
                const slot = slots.find(candidate => candidate.id === input.slotId && candidate.allowedKinds.includes(input.kind))
                if (!slot || input.runId !== job.id || input.messageId !== job.id) throw new Error('Undeclared collaboration capability.')
                await store.assertLease(job)
                const requestId = effectId(job.id, slot.id)
                const page = await store.sourceEvents(job.scope, job.source)
                const node = page.nodes.find(candidate => candidate.ownerId === job.scope.userId && candidate.source?.id === job.source.id)
                let command: CollaborationCommand
                const fixedAction = fixedSlots.find(action => slot.id === `fixed:${action.id}`)
                if (fixedAction) {
                    command = {
                        type: 'fixed-contact',
                        requestId,
                        contactRequestId: fixedAction.id,
                        content: input.arguments.content,
                    }
                } else if (input.kind === 'reply') {
                    const original = questions.find(item => slot.id === `reply:${item.id}:${item.version}`)
                    const question = page.questions.find(
                        item =>
                            item.id === original?.id &&
                            item.version === original.version &&
                            item.status === 'pending' &&
                            item.targetNodeId === node?.id
                    )
                    if (!question) throw new Error('The original question is no longer available for this reply.')
                    command = {
                        type: 'answer',
                        requestId,
                        questionId: question.id,
                        version: question.version,
                        content: input.arguments.content,
                        decision: input.arguments.decision ?? 'information',
                    }
                } else if (input.kind === 'message')
                    command = {
                        type: 'message',
                        requestId,
                        recipientId: slot.targetId!,
                        source: job.source,
                        content: input.arguments.content,
                    }
                else if (input.kind === 'handoff')
                    command = {
                        type: 'delegate',
                        requestId,
                        recipientId: slot.targetId!,
                        source: job.source,
                        title: input.arguments.title?.slice(0, 120) || '协作事项',
                        goal: input.arguments.content,
                        context: input.arguments.content,
                        ...(node ? { projectId: node.projectId, upstreamNodeId: node.id } : {}),
                    }
                else {
                    if (!node) throw new Error('No current responsibility node.')
                    if (input.kind === 'artifact')
                        command = {
                            type: 'publish',
                            requestId,
                            nodeId: node.id,
                            revision: node.revision,
                            title: input.arguments.title?.slice(0, 120) || '工作成果',
                            content: input.arguments.content,
                        }
                    else
                        command = {
                            type: 'ask',
                            requestId,
                            nodeId: node.id,
                            revision: node.revision,
                            targetNodeId: slot.targetId!,
                            question: input.arguments.content,
                            context: node.context,
                        }
                }
                return outcome(await service.command(job.scope, command, { authorKind: 'agent', lease: job }), input.kind)
            },
        }
    }

    /**
     * Stops polling, interrupts only local execution, and releases durable work for another worker.
     * @returns After the current attempt and runtime resources drain.
     */
    close(): Promise<void> {
        return (this.closing ??= this.drain())
    }

    /**
     * Releases the current attempt before disposing the private runtime.
     * @returns After active execution drains.
     */
    private async drain(): Promise<void> {
        this.closed = true
        if (this.timer) clearTimeout(this.timer)
        this.controller?.abort()
        await this.active
        await this.runtime?.dispose()
    }

    /**
     * Drains accepted work before the shared database pool closes.
     * @returns After the worker stops.
     */
    onModuleDestroy(): Promise<void> {
        return this.close()
    }
}
