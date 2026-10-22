import { randomUUID } from 'node:crypto'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, type DeepSeekOptions } from './deepseek.ts'
import { createModelFetch, validateModelBaseUrl, type ModelAddressOptions } from './model-connection.ts'

/** One private, consistent model configuration resolved by the authorized API. */
export interface ModelConnection {
    apiKey: string
    baseUrl: string
    model: string
}

/** OpenAI Chat Completions adapter using the core's canonical stream protocol. */
export class OpenAiCompatibleAdapter extends DeepSeekAdapter {
    /**
     * Bind one private connection to the approved address policy.
     * @param connection - Current user-owned connection, never a public snapshot.
     * @param policy - Server-owned exact-origin exceptions.
     * @param transport - Optional explicitly injected test transport.
     * @throws Error when the address or credentials are invalid.
     */
    constructor(connection: ModelConnection, policy: ModelAddressOptions = {}, transport?: typeof fetch) {
        const baseUrl = validateModelBaseUrl(connection.baseUrl, policy)
        super({ ...connection, baseUrl, compatibility: 'openai', fetch: transport ?? createModelFetch(policy) })
    }
}

/**
 * Test one saved connection with a small, explicit real streaming request.
 * @param connection - User-owned connection resolved by the API.
 * @param options - Server address policy, cancellation, and optional test transport.
 * @returns Fulfillment only after a valid provider response completes.
 * @throws Error with a safe message when the test fails or is cancelled.
 */
export async function testModelConnection(
    connection: ModelConnection,
    options: ModelAddressOptions & Pick<DeepSeekOptions, 'fetch'> & { signal?: AbortSignal } = {}
): Promise<void> {
    const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])])
    try {
        const adapter = new OpenAiCompatibleAdapter(connection, options, options.fetch)
        // The canonical stream is exercised without creating a business conversation.
        const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
        let finished = false
        for await (const chunk of adapter.stream({
            provider: `connection-test-${randomUUID()}`,
            model: connection.model,
            messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply OK.' }], source: { kind: 'user' } })],
            maxTokens: 32,
            signal,
        })) {
            if (chunk.type === 'finish') finished = true
        }
        if (!finished) throw new Error('Incomplete model test.')
    } catch (error) {
        if (options.signal?.aborted) throw new Error('连接测试已取消。')
        if (signal.aborted) throw Object.assign(new Error('连接测试超时，请稍后重试。'), { kind: 'timeout' })
        if (error instanceof LlmError && error.code === 'AUTH')
            throw Object.assign(new Error('模型鉴权失败，请检查 API Key。'), { kind: 'authentication' })
        throw new Error('连接测试失败，请检查模型地址、模型标识、API Key 及网络后重试。')
    }
}
