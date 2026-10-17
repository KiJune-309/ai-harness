import { LlmError } from '@deepseek-ai/dsh-llm'

const MAX_EVENT_BYTES = 1024 * 1024

/**
 * Read SSE data events across arbitrary UTF-8 fragments and line endings.
 * @param body - Provider response body owned by the current request.
 * @param signal - Request cancellation, including the provider timeout.
 * @returns Data payloads with multiline data fields joined according to SSE.
 * @throws LlmError when an event exceeds the input bound or UTF-8 is invalid.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
    const reader = body.getReader()
    /**
     * Unblock a pending stream read when cancellation arrives.
     * @returns Nothing; cancellation convergence is awaited by the reader loop.
     */
    const cancel = (): void => {
        void reader.cancel().catch(() => undefined)
    }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let pending = ''
    let data: string[] = []
    let eventLength = 0
    try {
        while (true) {
            const read = await reader.read()
            pending += decoder.decode(read.value, { stream: !read.done })
            if (pending.length > MAX_EVENT_BYTES) throw new LlmError('DeepSeek response event is too large.', 'INVALID_RESPONSE')
            let lineEnd = pending.search(/[\r\n]/)
            while (lineEnd >= 0) {
                if (!read.done && pending[lineEnd] === '\r' && lineEnd === pending.length - 1) break
                const line = pending.slice(0, lineEnd)
                const separatorLength = pending[lineEnd] === '\r' && pending[lineEnd + 1] === '\n' ? 2 : 1
                pending = pending.slice(lineEnd + separatorLength)
                if (line === '') {
                    if (data.length > 0) yield data.join('\n')
                    data = []
                    eventLength = 0
                } else if (line.startsWith('data:')) {
                    const value = line.slice(5).replace(/^ /, '')
                    eventLength += value.length
                    if (eventLength > MAX_EVENT_BYTES) throw new LlmError('DeepSeek response event is too large.', 'INVALID_RESPONSE')
                    data.push(value)
                }
                lineEnd = pending.search(/[\r\n]/)
            }
            if (read.done) {
                if (pending.startsWith('data:')) data.push(pending.slice(5).replace(/^ /, ''))
                if (data.length > 0) yield data.join('\n')
                break
            }
        }
    } catch (error: unknown) {
        if (error instanceof TypeError && error.message.includes('encoded data')) {
            throw new LlmError('DeepSeek response is not valid UTF-8.', 'INVALID_RESPONSE')
        }
        throw error
    } finally {
        signal.removeEventListener('abort', cancel)
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
    }
}
