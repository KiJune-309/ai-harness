import type { ChatOptions, ChatResponse, Message, ProviderConfig, StreamResponse } from '../types.ts'

export abstract class LLMProvider {
    protected readonly config: ProviderConfig

    constructor(config: ProviderConfig) {
        this.config = { ...config }
    }

    /** Returns the parsed JSON response. */
    abstract chat(messages: readonly Message[], options?: ChatOptions): Promise<ChatResponse>

    /** Yields parsed SSE events until the provider signals completion. */
    abstract stream(messages: readonly Message[], options?: ChatOptions): AsyncIterable<StreamResponse>
}
