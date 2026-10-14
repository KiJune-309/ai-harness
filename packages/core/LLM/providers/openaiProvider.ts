import type { ChatOptions, ChatResponse, Message, StreamResponse } from '../types.ts'
import { LLMProvider } from './baseProvider.ts'

const serializeMessages = (messages: readonly Message[]) =>
    messages.map(message => {
        if (message.role === 'assistant') {
            return { role: message.role, content: message.content, tool_calls: message.tool_calls }
        }
        if (message.role === 'tool') {
            return { role: message.role, content: message.content, tool_call_id: message.tool_call_id }
        }
        return { role: message.role, content: message.content }
    })

const serializeTools = (options?: ChatOptions) =>
    options?.tools?.length
        ? options.tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }))
        : undefined

export class OpenAIProvider extends LLMProvider {
    async chat(messages: readonly Message[], options?: ChatOptions): Promise<ChatResponse> {
        const baseUrl = (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
        const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 60_000)
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.apiKey}`,
                Accept: 'application/json',
            },
            body: JSON.stringify({
                model: this.config.model,
                messages: serializeMessages(messages),
                tools: serializeTools(options),
                max_completion_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
                stream: false,
            }),
            signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        })
        if (!response.ok) {
            await response.body?.cancel()
            throw new Error(`Model API request failed (HTTP ${response.status})`)
        }
        return response.json()
    }

    async *stream(messages: readonly Message[], options?: ChatOptions): AsyncGenerator<StreamResponse> {
        const baseUrl = (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
        const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 60_000)
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
                model: this.config.model,
                messages: serializeMessages(messages),
                tools: serializeTools(options),
                max_completion_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
                stream: true,
            }),
            signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        })

        if (!response.ok || !response.body) {
            throw new Error(`HTTP error! status: ${response.status}`)
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''

        const parseEvent = (event: string): StreamResponse | '[DONE]' | undefined => {
            const data = event
                .split(/\r\n|\r|\n/)
                .filter(line => line === 'data' || line.startsWith('data:'))
                .map(line => line.slice(5).replace(/^ /, ''))
                .join('\n')

            if (!data.trim()) return undefined
            if (data.trim() === '[DONE]') return '[DONE]'
            return JSON.parse(data) as StreamResponse
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
                    if (event === '[DONE]') return
                    if (event !== undefined) yield event
                }

                if (done) {
                    // Accept a final event even when the server omits the trailing blank line.
                    const event = parseEvent(buffer)
                    if (event !== undefined && event !== '[DONE]') yield event
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

// Keep the original class export available to existing callers.
export { OpenAIProvider as openaiProvider }
