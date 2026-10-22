import {
    attributionHeaders,
    LlmAdapter,
    LlmError,
    ToolCallId,
    type ContentBlock,
    type GenerateOptions,
    type LlmResolvedModelInfo,
    type RequestMessage,
    type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { readSseData } from './sse.ts'

/** Server-owned settings for one DeepSeek connection. */
export interface DeepSeekOptions {
    apiKey: string
    baseUrl?: string
    model?: string
    maxTokens?: number
    timeoutMs?: number
    fetch?: typeof fetch
    compatibility?: 'openai'
}

/** Model-visible Chat Completions message without runtime metadata. */
interface WireMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    reasoning_content?: string
    tool_call_id?: string
    tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
}

/** Validated provider delta; raw provider objects never leave this package. */
interface ProviderEvent {
    text?: string
    reasoning?: string
    finish?: 'stop' | 'length' | 'tool_calls'
    tools?: { index: number; id?: string; name?: string; arguments?: string }[]
    usage?: { inputTokens: number; outputTokens: number }
}

/**
 * Check the shape of an untrusted JSON object without evaluating provider data.
 * @param value - Parsed JSON value.
 * @returns Whether the value is an object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate one Chat Completions SSE payload including fragmented native tool calls.
 * @param payload - One SSE data payload.
 * @returns Detached text, reasoning, tool fragments, finish, and token facts.
 * @throws LlmError for malformed JSON, invalid choices, or invalid tool fragments.
 */
function parseEvent(payload: string): ProviderEvent {
    let value: unknown
    try {
        value = JSON.parse(payload)
    } catch {
        throw new LlmError('DeepSeek returned malformed streaming data.', 'INVALID_RESPONSE')
    }
    if (!isRecord(value) || !Array.isArray(value.choices) || value.error !== undefined) {
        throw new LlmError('DeepSeek returned an invalid response.', 'INVALID_RESPONSE')
    }
    const result: ProviderEvent = {}
    if (value.usage !== undefined && value.usage !== null) {
        const usage = value.usage
        if (!isRecord(usage) || !Number.isSafeInteger(usage.prompt_tokens) || !Number.isSafeInteger(usage.completion_tokens)) {
            throw new LlmError('DeepSeek returned invalid token usage.', 'INVALID_RESPONSE')
        }
        const inputTokens = usage.prompt_tokens as number
        const outputTokens = usage.completion_tokens as number
        if (inputTokens < 0 || outputTokens < 0) throw new LlmError('DeepSeek returned invalid token usage.', 'INVALID_RESPONSE')
        result.usage = { inputTokens, outputTokens }
    }
    if (value.choices.length === 0) return result
    if (value.choices.length !== 1 || !isRecord(value.choices[0])) {
        throw new LlmError('DeepSeek returned an invalid response choice.', 'INVALID_RESPONSE')
    }
    const choice = value.choices[0]
    if (choice.index !== undefined && choice.index !== 0)
        throw new LlmError('DeepSeek returned an invalid response choice.', 'INVALID_RESPONSE')
    if (!isRecord(choice.delta)) throw new LlmError('DeepSeek returned an invalid response delta.', 'INVALID_RESPONSE')
    const delta = choice.delta
    if (delta.function_call !== undefined) throw new LlmError('Legacy function calls are unsupported.', 'INVALID_RESPONSE')
    if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
        if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 16) {
            throw new LlmError('DeepSeek returned invalid tool calls.', 'INVALID_RESPONSE')
        }
        result.tools = delta.tool_calls.map(call => {
            if (!isRecord(call) || !Number.isSafeInteger(call.index) || (call.index as number) < 0 || (call.index as number) >= 16) {
                throw new LlmError('DeepSeek returned an invalid tool call index.', 'INVALID_RESPONSE')
            }
            if (call.type !== undefined && call.type !== 'function') throw new LlmError('Unsupported tool type.', 'INVALID_RESPONSE')
            if (call.id !== undefined && typeof call.id !== 'string') throw new LlmError('Invalid tool call id.', 'INVALID_RESPONSE')
            if (call.function !== undefined && !isRecord(call.function)) {
                throw new LlmError('Invalid tool function.', 'INVALID_RESPONSE')
            }
            const fn = call.function as Record<string, unknown> | undefined
            if (
                (fn?.name !== undefined && typeof fn.name !== 'string') ||
                (fn?.arguments !== undefined && typeof fn.arguments !== 'string')
            ) {
                throw new LlmError('Invalid tool function fragment.', 'INVALID_RESPONSE')
            }
            return {
                index: call.index as number,
                ...(typeof call.id === 'string' ? { id: call.id } : {}),
                ...(typeof fn?.name === 'string' ? { name: fn.name } : {}),
                ...(typeof fn?.arguments === 'string' ? { arguments: fn.arguments } : {}),
            }
        })
    }
    for (const key of ['content', 'reasoning_content'] as const) {
        const text = delta[key]
        if (text !== undefined && text !== null && typeof text !== 'string') {
            throw new LlmError('DeepSeek returned an invalid text delta.', 'INVALID_RESPONSE')
        }
        if (typeof text === 'string') {
            if (key === 'content') result.text = text
            else result.reasoning = text
        }
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'length' && choice.finish_reason !== 'tool_calls') {
            throw new LlmError('DeepSeek did not complete the response.', 'INVALID_RESPONSE')
        }
        result.finish = choice.finish_reason
    }
    return result
}

/**
 * Project canonical role-ordered history including native tool calls and results.
 * @param messages - Core-derived history in conversation order.
 * @param includeReasoning - Whether the provider accepts DeepSeek reasoning fields.
 * @returns Chat Completions messages preserving call/result correlation and reasoning.
 * @throws LlmError when unsupported content reaches the text/tool adapter.
 */
function wireMessages(messages: readonly RequestMessage[], includeReasoning = true): WireMessage[] {
    return messages.map(message => {
        let text = ''
        let reasoning = ''
        const calls: NonNullable<WireMessage['tool_calls']> = []
        for (const block of message.content) {
            if (block.type === 'text') text += block.text
            else if (block.type === 'reasoning' && message.role === 'assistant') reasoning += block.text
            else if (block.type === 'tool-call' && message.role === 'assistant') {
                calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } })
            } else if ((block.type === 'tool-addition' || block.type === 'tool-removal') && message.role === 'developer') {
                // Complete declarations are sent in the current request's tools field.
                continue
            } else throw new LlmError('Unsupported chat message content.', 'INVALID_MESSAGE')
        }
        return {
            role: message.role === 'developer' ? 'system' : message.role,
            content: text,
            ...(reasoning && includeReasoning ? { reasoning_content: reasoning } : {}),
            ...(calls.length ? { tool_calls: calls } : {}),
            ...(message.role === 'tool' ? { tool_call_id: message.toolCallId } : {}),
        }
    })
}

/** Direct DeepSeek Chat Completions provider for the Cordis LLM service. */
export class DeepSeekAdapter extends LlmAdapter {
    private readonly endpoint: string
    private readonly request: typeof fetch
    private readonly timeoutMs: number

    /**
     * Validate server configuration once without exposing secrets in diagnostics.
     * @param options - Trusted connection and request settings.
     * @throws LlmError when a setting is unusable.
     */
    constructor(private readonly options: DeepSeekOptions) {
        super()
        if (!options.apiKey.trim() || !/^[\x21-\x7e]+$/.test(options.apiKey.trim())) {
            throw new LlmError('A valid DEEPSEEK_API_KEY is required.', 'CONFIGURATION')
        }
        let base: URL
        try {
            base = new URL(options.baseUrl ?? 'https://api.deepseek.com')
        } catch {
            throw new LlmError('DEEPSEEK_BASE_URL must be an HTTP or HTTPS URL.', 'CONFIGURATION')
        }
        if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
            throw new LlmError('DEEPSEEK_BASE_URL must be an HTTP or HTTPS URL without credentials.', 'CONFIGURATION')
        }
        this.endpoint = `${base.href.replace(/\/$/, '')}/chat/completions`
        this.request = options.fetch ?? fetch
        this.timeoutMs = options.timeoutMs ?? 120_000
        if (
            !Number.isSafeInteger(this.timeoutMs) ||
            this.timeoutMs <= 0 ||
            (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0))
        ) {
            throw new LlmError('DeepSeek timeout and token limits must be positive integers.', 'CONFIGURATION')
        }
    }

    /**
     * Resolve configured model identity without a provider catalog request.
     * @param provider - Registered route name.
     * @param model - Configured DeepSeek model name.
     * @returns Text-chat model metadata for the core loop.
     */
    override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return { provider, id: model, name: model, inputModalities: ['text'] }
    }

    /**
     * Stream validated DeepSeek deltas through the canonical core block protocol.
     * @param options - Immutable request assembled by the actual agent loop.
     * @returns Text, reasoning, complete native tool calls, usage, and one finish chunk.
     * @throws LlmError for timeout, connectivity, provider refusal, or invalid data.
     */
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const timeout = new AbortController()
        const timer = setTimeout(() => timeout.abort(), this.timeoutMs)
        const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal
        const blocks: ContentBlock[] = []
        const calls = new Map<number, { index: number; id: string; name: string; arguments: string }>()
        let finish: ProviderEvent['finish']
        try {
            signal.throwIfAborted()
            const messages = wireMessages(options.messages, this.options.compatibility !== 'openai')
            if (options.system) messages.unshift({ role: 'system', content: options.system })
            const response = await this.request(this.endpoint, {
                method: 'POST',
                headers: {
                    ...attributionHeaders(),
                    authorization: `Bearer ${this.options.apiKey.trim()}`,
                    'content-type': 'application/json',
                    accept: 'text/event-stream',
                },
                body: JSON.stringify({
                    model: options.model,
                    messages,
                    stream: true,
                    stream_options: { include_usage: true },
                    ...(options.tools?.length
                        ? {
                              tools: options.tools.map(tool => ({
                                  type: 'function',
                                  function: {
                                      name: tool.name,
                                      description: tool.description,
                                      parameters: tool.parameters,
                                  },
                              })),
                              tool_choice: 'auto',
                          }
                        : {}),
                    ...((options.maxTokens ?? this.options.maxTokens) ? { max_tokens: options.maxTokens ?? this.options.maxTokens } : {}),
                }),
                signal,
                redirect: 'error',
            })
            if (signal.aborted) {
                await response.body?.cancel().catch(() => undefined)
                signal.throwIfAborted()
            }
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined)
                const code =
                    response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR'
                throw new LlmError(`DeepSeek request failed (HTTP ${response.status}).`, code, { status: response.status })
            }
            if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
                await response.body?.cancel().catch(() => undefined)
                throw new LlmError('DeepSeek did not return an event stream.', 'INVALID_RESPONSE')
            }
            for await (const payload of readSseData(response.body, signal)) {
                signal.throwIfAborted()
                if (payload === '[DONE]') break
                const event = parseEvent(payload)
                if (finish && (event.text || event.reasoning || event.finish || event.tools?.length))
                    throw new LlmError('DeepSeek sent content after completion.', 'INVALID_RESPONSE')
                for (const type of ['reasoning', 'text'] as const) {
                    const text = type === 'text' ? event.text : event.reasoning
                    if (!text) continue
                    let block = blocks.at(-1)
                    if (!block || block.type !== type) {
                        const created: ContentBlock = type === 'text' ? { type: 'text', text: '' } : { type: 'reasoning', text: '' }
                        blocks.push(created)
                        block = created
                        yield { type: 'block-start', index: blocks.length - 1, blockType: type }
                    }
                    if (!block || (block.type !== 'text' && block.type !== 'reasoning'))
                        throw new LlmError('Invalid stream block.', 'INVALID_RESPONSE')
                    block.text += text
                    yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index: blocks.length - 1, text }
                }
                for (const fragment of event.tools ?? []) {
                    let call = calls.get(fragment.index)
                    if (!call) {
                        call = { index: blocks.length, id: '', name: '', arguments: '' }
                        calls.set(fragment.index, call)
                        blocks.push({ type: 'tool-call', id: ToolCallId('pending'), name: '', arguments: '' })
                        yield { type: 'block-start', index: call.index, blockType: 'tool-call' }
                    }
                    call.id += fragment.id ?? ''
                    call.name += fragment.name ?? ''
                    call.arguments += fragment.arguments ?? ''
                    if (call.id.length > 256 || call.name.length > 64 || call.arguments.length > 65_536) {
                        throw new LlmError('Tool call exceeds its size limit.', 'INVALID_RESPONSE')
                    }
                }
                if (event.usage) yield { type: 'usage', usage: event.usage }
                if (event.finish) finish = event.finish
            }
            signal.throwIfAborted()
            if (!finish) throw new LlmError('DeepSeek response ended before completion.', 'INCOMPLETE_RESPONSE')
            if (calls.size > 0 !== (finish === 'tool_calls')) {
                throw new LlmError('DeepSeek returned inconsistent tool completion.', 'INVALID_RESPONSE')
            }
            const ids = new Set<string>()
            for (const call of calls.values()) {
                if (!call.id || !/^[\w-]+$/.test(call.id) || ids.has(call.id) || !options.tools?.some(tool => tool.name === call.name)) {
                    throw new LlmError('DeepSeek requested an unavailable tool.', 'UNEXPECTED_TOOL_CALL')
                }
                ids.add(call.id)
                const id = ToolCallId(call.id)
                blocks[call.index] = { type: 'tool-call', id, name: call.name, arguments: call.arguments }
                yield { type: 'tool-call-delta', index: call.index, id, name: call.name, argumentsDelta: call.arguments }
            }
            for (const [index, block] of blocks.entries()) yield { type: 'block-end', index, block }
            yield { type: 'finish', reason: { kind: finish === 'length' ? 'max-tokens' : finish === 'tool_calls' ? 'tool-calls' : 'stop' } }
        } catch (error: unknown) {
            if (options.signal?.aborted) throw new LlmError('Chat request cancelled.', 'ABORTED')
            if (timeout.signal.aborted) throw new LlmError('DeepSeek request timed out.', 'TIMEOUT')
            if (error instanceof LlmError) throw error
            throw new LlmError('DeepSeek could not be reached.', 'PROVIDER_UNAVAILABLE')
        } finally {
            clearTimeout(timer)
        }
    }
}
