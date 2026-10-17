import type { AgentDefinition, ChatMessage } from '@ai-harness/contracts'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
    createAssistantMessage,
    createSystemMessage,
    createUserMessage,
    type ContentBlock,
    type LlmFailure,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createHash, randomUUID } from 'node:crypto'
import { DeepSeekAdapter, type DeepSeekOptions } from './deepseek.ts'
import { registerAgentTools } from './tools.ts'

const MAX_MODEL_STEPS = 8

export type { DeepSeekOptions } from './deepseek.ts'

/** Deployment settings owned by the API process. */
export interface ChatRuntimeOptions extends DeepSeekOptions {
    systemPrompt?: string
}

/** One authenticated invocation; the API supplies trusted history and scope. */
export interface ChatRunInput {
    scope: { userId: string; workspaceId: string }
    conversationId: string
    agent?: AgentDefinition
    history: ChatMessage[]
    content: string
    signal: AbortSignal
    onDelta: (delta: { type: 'delta' | 'reasoning'; text: string }) => void
}

/** Settled model output; partial cancelled output is retained for presentation. */
export interface ChatRunResult {
    content: string
    reasoning: string
    status: 'complete' | 'cancelled'
}

/** Stable application entry point backed by Cordis services and AgentLoop. */
export interface ChatRuntime {
    run(input: ChatRunInput): Promise<ChatRunResult>
    dispose(): Promise<void>
}

/** Safe application error whose text never contains provider response bodies. */
export class ChatRuntimeError extends Error {
    /**
     * Create a public runtime refusal without retaining secret-bearing causes.
     * @param message - Safe text suitable for an API response.
     * @param code - Stable application-facing diagnostic category.
     */
    constructor(
        message: string,
        readonly code: string
    ) {
        super(message)
        this.name = 'ChatRuntimeError'
    }
}

/** One reserved conversation activity, including its shutdown cancellation. */
interface Activity {
    controller: AbortController
    done: Promise<ChatRunResult>
}

/**
 * Derive an opaque identity from all trusted authorization boundaries.
 * @param input - API-authorized user, workspace, and conversation identity.
 * @returns An unambiguous key without exposing user or workspace identifiers.
 */
function activityKey(input: ChatRunInput): string {
    return createHash('sha256')
        .update(JSON.stringify([input.scope.userId, input.scope.workspaceId, input.conversationId]))
        .digest('hex')
}

/**
 * Seed canonical core events from the API's authorized durable conversation.
 * @param history - Prior persisted messages in their original role order.
 * @param model - DeepSeek model used to attribute restored assistant messages.
 * @returns Dense, balanced session events containing model-visible history.
 */
function historySeed(history: readonly ChatMessage[], model: string): SessionEvent[] {
    const events: SessionEvent[] = []
    if (history.length > 0) {
        events.push({
            type: 'system/message',
            seq: SessionSeq(0),
            time: 1,
            surfaceOp: 'append',
            data: { turn: 0, step: 0, message: createSystemMessage('') },
        })
    }
    let turn = 0
    for (const message of history) {
        if (message.status === 'error') continue
        if (message.role === 'user') {
            if (turn > 0) {
                events.push(
                    { type: 'step/end', seq: SessionSeq(events.length), time: 1, data: { turn, step: 1 } },
                    { type: 'turn/end', seq: SessionSeq(events.length + 1), time: 1, data: { turn, reason: { kind: 'completed' } } }
                )
            }
            turn += 1
            events.push(
                { type: 'turn/start', seq: SessionSeq(events.length), time: 1, data: { turn } },
                { type: 'step/start', seq: SessionSeq(events.length + 1), time: 1, data: { turn, step: 1 } },
                {
                    type: 'user/message',
                    seq: SessionSeq(events.length + 2),
                    time: 1,
                    surfaceOp: 'append',
                    data: createUserMessage({ content: [{ type: 'text', text: message.content }], source: { kind: 'user' } }),
                }
            )
        } else {
            const content: ContentBlock[] = []
            if (message.reasoning) content.push({ type: 'reasoning', text: message.reasoning })
            if (message.content) content.push({ type: 'text', text: message.content })
            if (content.length === 0) continue
            events.push({
                type: 'assistant/message',
                seq: SessionSeq(events.length),
                time: 1,
                surfaceOp: 'append',
                data: {
                    turn,
                    step: turn === 0 ? 0 : 1,
                    message: createAssistantMessage({ content, source: { provider: 'deepseek', model } }),
                    stream: [],
                    ...(message.status === 'cancelled' ? { interrupted: true as const } : {}),
                },
            })
        }
    }
    if (turn > 0) {
        events.push(
            { type: 'step/end', seq: SessionSeq(events.length), time: 1, data: { turn, step: 1 } },
            { type: 'turn/end', seq: SessionSeq(events.length + 1), time: 1, data: { turn, reason: { kind: 'completed' } } }
        )
    }
    return events
}

/**
 * Translate internal failures to safe, actionable application categories.
 * @param failure - Provider-neutral failure facts emitted by the core loop.
 * @returns A sanitized error with no remote text or credential-bearing cause.
 */
function publicFailure(failure: Pick<LlmFailure, 'code'> | undefined): ChatRuntimeError {
    switch (failure?.code) {
        case 'AUTH':
            return new ChatRuntimeError('DeepSeek authentication failed. Check DEEPSEEK_API_KEY on the server.', 'DEEPSEEK_AUTH')
        case 'RATE_LIMIT':
            return new ChatRuntimeError('DeepSeek is busy. Please try again shortly.', 'DEEPSEEK_RATE_LIMIT')
        case 'TIMEOUT':
            return new ChatRuntimeError('DeepSeek took too long to respond. Please try again.', 'DEEPSEEK_TIMEOUT')
        default:
            return new ChatRuntimeError('DeepSeek could not complete this response. Please try again.', 'DEEPSEEK_REQUEST_FAILED')
    }
}

/**
 * Release an owned agent without propagating internal cleanup diagnostics.
 * @param handle - Published agent capability, absent if setup never completed.
 * @returns Fulfillment after the agent and its session are released.
 * @throws ChatRuntimeError when the underlying lifecycle cannot unwind.
 */
async function disposeAgent(handle: AgentHandle | undefined): Promise<void> {
    try {
        await handle?.dispose()
    } catch {
        throw new ChatRuntimeError('Chat resources could not be released.', 'RUNTIME_CLEANUP')
    }
}

/** Process-owned runtime with isolated, request-owned agent handles. */
class CordisChatRuntime implements ChatRuntime {
    private readonly activities = new Map<string, Activity>()
    private disposed = false
    private disposing: Promise<void> | undefined

    /**
     * Retain the initialized service graph and immutable model choice.
     * @param ctx - Cordis context fully initialized before public use.
     * @param model - Configured model route supplied to each fresh agent.
     * @param maxTokens - Optional conversation-model output cap.
     */
    constructor(
        private readonly ctx: Context,
        private readonly model: string,
        private readonly maxTokens: number | undefined
    ) {}

    /**
     * Run one turn against fresh authorized history and reserve its scoped key.
     * @param input - Authenticated turn, cancellation, and streaming observer.
     * @returns The complete or cancelled assistant output.
     * @throws ChatRuntimeError if shutting down, busy, or a provider request fails.
     */
    async run(input: ChatRunInput): Promise<ChatRunResult> {
        if (this.disposed) throw new ChatRuntimeError('Chat runtime is shutting down.', 'RUNTIME_CLOSED')
        const key = activityKey(input)
        if (this.activities.has(key))
            throw new ChatRuntimeError('A response is already running for this conversation.', 'CONVERSATION_BUSY')
        if (input.signal.aborted) return { content: '', reasoning: '', status: 'cancelled' }
        const controller = new AbortController()
        const activity: Activity = { controller, done: Promise.resolve({ content: '', reasoning: '', status: 'cancelled' }) }
        this.activities.set(key, activity)
        activity.done = this.execute(input, key, AbortSignal.any([input.signal, controller.signal]))
        try {
            return await activity.done
        } finally {
            this.activities.delete(key)
        }
    }

    /**
     * Drive a real Cordis agent and release every observer and session afterward.
     * @param input - Current request with trusted conversation history.
     * @param key - Full authorization-scope hash for the temporary session.
     * @param signal - User cancellation combined with runtime shutdown.
     * @returns The delivered text and reasoning after core turn settlement.
     * @throws ChatRuntimeError for an unsuccessful or inconsistent settlement.
     */
    private async execute(input: ChatRunInput, key: string, signal: AbortSignal): Promise<ChatRunResult> {
        let handle: AgentHandle | undefined
        const unsubscribe: (() => void)[] = []
        let content = ''
        let reasoning = ''
        let turnEnd: TurnEndReason | undefined
        let failure: LlmFailure | undefined
        let observerFailed = false
        let modelSteps = 0
        let stepLimitReached = false
        const model = input.agent?.modelId ?? this.model
        try {
            handle = await this.ctx.agents.create({
                sessionId: SessionId(`${key}-${randomUUID()}`),
                seed: historySeed(input.history, model),
                agentOptions: {
                    provider: 'deepseek',
                    model,
                    ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
                },
                signal,
                /**
                 * Compose only this request's unpublished agent context.
                 * @param agentCtx - Agent-owned prompt and tool registration scope.
                 * @param agent - Scoped core loop driver.
                 * @returns Nothing; the handle owns all registrations and listeners.
                 */
                setup(agentCtx, agent) {
                    if (input.agent) {
                        if (input.agent.systemPrompt.trim()) {
                            agentCtx.systemPrompt.section({
                                name: 'application:agent-prompt',
                                order: 0,
                                text: input.agent.systemPrompt,
                                interpolate: false,
                                complete: true,
                            })
                        }
                        registerAgentTools(agentCtx, input.agent.toolIds)
                    }
                    agentCtx.on('agent/pre-step', (_payload, next) => {
                        modelSteps += 1
                        if (modelSteps <= MAX_MODEL_STEPS) return next()
                        stepLimitReached = true
                        agent.cancel({ kind: 'hook', reason: 'Agent reached its model step limit.' })
                        return Promise.resolve({ kind: 'reject' as const })
                    })
                },
            })
            const { agent } = handle
            unsubscribe.push(
                this.ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
                    if (subject !== agent || frame.type !== 'chunk') return
                    const { chunk } = frame
                    if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted'))
                        failure = chunk.reason.failure
                    if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return
                    if (chunk.type === 'text-delta') content += chunk.text
                    else reasoning += chunk.text
                    try {
                        input.onDelta({ type: chunk.type === 'text-delta' ? 'delta' : 'reasoning', text: chunk.text })
                    } catch {
                        observerFailed = true
                        agent.cancel({ kind: 'user' })
                    }
                }),
                this.ctx.on('session/event', (session, event) => {
                    if (session !== agent.session || event.type !== 'turn/end') return
                    turnEnd = event.data.reason
                }),
                this.ctx.on('agent/error', ({ agent: subject }) => {
                    if (subject === agent && !failure) failure = { code: 'RUNTIME_ERROR', message: 'Chat execution failed.' }
                })
            )
            /**
             * Cancel the active core turn when the request or runtime stops.
             * @returns Nothing; the core owns orderly cancellation settlement.
             */
            const cancel = (): void => agent.cancel({ kind: 'user' })
            signal.addEventListener('abort', cancel, { once: true })
            unsubscribe.push(() => signal.removeEventListener('abort', cancel))
            signal.throwIfAborted()
            agent.followup(createUserMessage({ content: [{ type: 'text', text: input.content }], source: { kind: 'user' } }))
            await agent.whenIdle()
            if (signal.aborted || observerFailed) return { content, reasoning, status: 'cancelled' }
            if (stepLimitReached)
                throw new ChatRuntimeError('Agent reached its tool step limit. Please try a simpler request.', 'AGENT_STEP_LIMIT')
            if (turnEnd?.kind === 'error') throw publicFailure(turnEnd.error)
            if (failure || (turnEnd?.kind !== 'completed' && turnEnd?.kind !== 'max-tokens')) throw publicFailure(failure)
            return { content, reasoning, status: 'complete' }
        } catch (error: unknown) {
            if (signal.aborted || observerFailed) return { content, reasoning, status: 'cancelled' }
            if (error instanceof ChatRuntimeError) throw error
            throw publicFailure(failure)
        } finally {
            for (const dispose of unsubscribe.reverse()) dispose()
            await disposeAgent(handle)
        }
    }

    /**
     * Cancel active work, join all owned turns, and unload the service graph.
     * @returns Fulfillment after every agent and Cordis plugin has unwound.
     */
    dispose(): Promise<void> {
        this.disposed = true
        this.disposing ??= this.shutdown()
        return this.disposing
    }

    /**
     * Perform the single shared shutdown transaction.
     * @returns Fulfillment after active turns and the context are disposed.
     */
    private async shutdown(): Promise<void> {
        const activities = [...this.activities.values()]
        for (const activity of activities) activity.controller.abort()
        await Promise.allSettled(activities.map(activity => activity.done))
        await this.ctx.fiber.dispose()
    }
}

/**
 * Initialize the stable chat entry point with the actual Cordis core services.
 * @param options - Server-owned DeepSeek credentials and deployment settings.
 * @returns A ready runtime; initialization and connections are shared by turns.
 * @throws ChatRuntimeError when configuration or service initialization fails.
 */
export async function createChatRuntime(options: ChatRuntimeOptions): Promise<ChatRuntime> {
    const ctx = new Context()
    try {
        const adapter = new DeepSeekAdapter(options)
        const model = options.model?.trim() || 'deepseek-flash'
        await ctx.plugin(LlmRuntime)
        await ctx.plugin(SessionStore)
        await ctx.plugin(SessionProjectionRegistry)
        await ctx.plugin(SystemPrompt, {
            includeHarnessIdentity: false,
            personaPrefix: options.systemPrompt ?? 'You are a helpful assistant.',
        })
        await ctx.plugin(ToolRuntime)
        await ctx.plugin(AgentRegistry)
        await ctx.plugin(AgentLoop, { agents: [] })
        ctx.llm.registerAdapter(['deepseek'], adapter)
        return new CordisChatRuntime(ctx, model, options.maxTokens)
    } catch {
        await ctx.fiber.dispose().catch(() => undefined)
        throw new ChatRuntimeError('DeepSeek chat could not initialize. Check the server configuration.', 'RUNTIME_CONFIGURATION')
    }
}
