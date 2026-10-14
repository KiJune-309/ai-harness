import type { z } from 'zod'
import type { createLLMOptionsSchema } from './schemas.ts'
import { providerFactory } from './providerFactory.ts'
import type { LLMProvider } from './types.ts'

export type CreateLLMOptions = Readonly<z.infer<typeof createLLMOptionsSchema>>

export const LLMFactory = (config: CreateLLMOptions): LLMProvider => providerFactory(config.provider, config)

export { providerFactory } from './providerFactory.ts'
export { OpenAIProvider, openaiProvider } from './providers/openaiProvider.ts'
export { AnthropicProvider, anthropicProvider } from './providers/anthropicProvider.ts'
export type { AssistantMessage, ChatOptions, ChatResponse, Message, Provider, ProviderConfig, ToolCall, ToolDefinition } from './types.ts'
export {
    providerSchema,
    providerConfigSchema,
    messageSchema,
    chatOptionsSchema,
    createLLMOptionsSchema,
    toolCallSchema,
    toolDefinitionSchema,
} from './schemas.ts'
export { LLMProvider } from './providers/baseProvider.ts'
