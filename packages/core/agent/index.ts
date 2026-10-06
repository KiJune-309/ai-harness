import type { z } from 'zod'
import { createAgentOptionsSchema } from './schemas.ts'
import { providerFactory } from './providerFactory.ts'
import type { ChatOptions, ChatProvider, Message } from './types.ts'

export type CreateAgentOptions = Readonly<z.infer<typeof createAgentOptionsSchema>>

export class AgentRegistry {
    readonly sessionId: string
    readonly providerSDK: ChatProvider

    constructor(config: CreateAgentOptions) {
        const { sessionId } = createAgentOptionsSchema.pick({ sessionId: true }).parse(config)
        this.sessionId = sessionId
        this.providerSDK = providerFactory(config.provider, config)
    }

    chat(messages: readonly Message[], options?: ChatOptions) {
        return this.providerSDK.chat(messages, options)
    }

    stream(messages: readonly Message[], options?: ChatOptions) {
        return this.providerSDK.stream(messages, options)
    }
}

export const AgentFactory = (config: CreateAgentOptions): AgentRegistry => new AgentRegistry(config)

export { providerFactory } from './providerFactory.ts'
export { OpenAIProvider, openaiProvider } from './providers/openaiProvider.ts'
export { AnthropicProvider, anthropicProvider } from './providers/anthropicProvider.ts'
export type { ChatOptions, Message, Provider, ProviderConfig } from './types.ts'
export { providerSchema, providerConfigSchema, messageSchema, chatOptionsSchema, createAgentOptionsSchema } from './schemas.ts'
export { ChatProvider } from './providers/baseProvider.ts'
