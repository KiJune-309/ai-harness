import type { AnthropicChatResponse, AnthropicStreamResponse, ChatResponse, StreamResponse, ChatOptions, Message } from '../types.ts'
import { ChatProvider } from './baseProvider.ts'

export class AnthropicProvider extends ChatProvider {
    async chat(messages: readonly Message[], options?: ChatOptions): Promise<ChatResponse> {
        const system = messages.filter(message => message.role === 'system').map(message => ({ type: 'text', text: message.content }))
        const baseUrl = (this.config.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '')
        const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 60_000)
        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-api-key': this.config.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: this.config.model,
                system: system.length ? system : undefined,
                messages: messages.filter(message => message.role !== 'system').map(({ role, content }) => ({ role, content })),
                max_tokens: this.config.maxTokens ?? 4096,
                temperature: this.config.temperature,
                stream: false,
            }),
            signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        })
        if (!response.ok) {
            await response.body?.cancel()
            throw new Error(`Model API request failed (HTTP ${response.status})`)
        }
        const result: AnthropicChatResponse = await response.json()
        const content = result.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('')
        const cachedTokens = result.usage.cache_read_input_tokens ?? 0
        const cacheCreationTokens = result.usage.cache_creation_input_tokens ?? 0
        const promptTokens = result.usage.input_tokens + cachedTokens + cacheCreationTokens
        const finishReasons: Record<string, string> = {
            end_turn: 'stop',
            stop_sequence: 'stop',
            max_tokens: 'length',
            model_context_window_exceeded: 'length',
            tool_use: 'tool_calls',
            refusal: 'content_filter',
        }

        return {
            base_resp: { status_code: 0, status_msg: '' },
            choices: [
                {
                    finish_reason: result.stop_reason === null ? null : (finishReasons[result.stop_reason] ?? result.stop_reason),
                    index: 0,
                    message: { role: 'assistant', content },
                },
            ],
            created: Math.floor(Date.now() / 1000),
            id: result.id,
            model: result.model,
            object: 'chat.completion',
            service_tier: typeof result.usage.service_tier === 'string' ? result.usage.service_tier : 'default',
            // Anthropic does not provide these moderation or character-count fields.
            input_sensitive: false,
            input_sensitive_type: 0,
            output_sensitive: false,
            output_sensitive_int: 0,
            output_sensitive_type: 0,
            usage: {
                completion_tokens: result.usage.output_tokens,
                completion_tokens_details: { reasoning_tokens: 0 },
                prompt_tokens: promptTokens,
                prompt_tokens_details: { cached_tokens: cachedTokens },
                total_characters: 0,
                total_tokens: promptTokens + result.usage.output_tokens,
            },
        }
    }

    async *stream(messages: readonly Message[], options?: ChatOptions): AsyncGenerator<StreamResponse> {
        const system = messages.filter(message => message.role === 'system').map(message => ({ type: 'text', text: message.content }))
        const baseUrl = (this.config.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '')
        const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 60_000)
        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                'x-api-key': this.config.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: this.config.model,
                system: system.length ? system : undefined,
                messages: messages.filter(message => message.role !== 'system').map(({ role, content }) => ({ role, content })),
                max_tokens: this.config.maxTokens ?? 4096,
                temperature: this.config.temperature,
                stream: true,
            }),
            signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        })
        if (!response.ok) {
            await response.body?.cancel()
            throw new Error(`Model API request failed (HTTP ${response.status})`)
        }
        if (!response.body) {
            throw new Error('Model API response has no stream body')
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''
        let id = ''
        let model = this.config.model
        let serviceTier = 'default'
        const created = Math.floor(Date.now() / 1000)

        const toStreamResponse = (event: AnthropicStreamResponse): StreamResponse | undefined => {
            let content: string
            switch (event.type) {
                case 'message_start':
                    id = event.message.id
                    model = event.message.model
                    if (typeof event.message.usage.service_tier === 'string') serviceTier = event.message.usage.service_tier
                    content = ''
                    break
                case 'content_block_start':
                    if (event.content_block.type !== 'text' || typeof event.content_block.text !== 'string' || !event.content_block.text)
                        return undefined
                    content = event.content_block.text
                    break
                case 'content_block_delta':
                    if (event.delta.type !== 'text_delta' || typeof event.delta.text !== 'string') return undefined
                    content = event.delta.text
                    break
                default:
                    return undefined
            }

            return {
                choices: [{ delta: { role: 'assistant', content }, index: 0 }],
                created,
                id,
                model,
                object: 'chat.completion.chunk',
                service_tier: serviceTier,
                usage: null,
            }
        }

        const parseEvent = (event: string): AnthropicStreamResponse | undefined => {
            const data = event
                .split(/\r\n|\r|\n/)
                .filter(line => line === 'data' || line.startsWith('data:'))
                .map(line => line.slice(5).replace(/^ /, ''))
                .join('\n')

            if (!data.trim()) return undefined
            const parsed = JSON.parse(data) as AnthropicStreamResponse
            if (parsed.type === 'error') {
                throw new Error(`Anthropic stream error (${parsed.error.type}): ${parsed.error.message}`)
            }
            if (parsed.type === 'ping') return undefined
            return parsed
        }

        try {
            while (true) {
                const { value, done } = await reader.read()
                buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })

                // Network chunks may contain several events or only part of one.
                let boundary: RegExpExecArray | null
                while ((boundary = /\r?\n\r?\n|\r\r/.exec(buffer)) !== null) {
                    const event = parseEvent(buffer.slice(0, boundary.index))
                    buffer = buffer.slice(boundary.index + boundary[0].length)
                    if (event?.type === 'message_stop') return
                    if (event !== undefined) {
                        const chunk = toStreamResponse(event)
                        if (chunk !== undefined) yield chunk
                    }
                }

                if (done) {
                    const event = parseEvent(buffer)
                    if (event !== undefined && event.type !== 'message_stop') {
                        const chunk = toStreamResponse(event)
                        if (chunk !== undefined) yield chunk
                    }
                    return
                }
            }
        } finally {
            try {
                await reader.cancel()
            } catch {
                // A failed or aborted stream may already be closed.
            } finally {
                reader.releaseLock()
            }
        }
    }
}

export { AnthropicProvider as anthropicProvider }
