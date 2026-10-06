import { providerConfigSchema, providerSchema } from './schemas.ts'
import { AnthropicProvider } from './providers/anthropicProvider.ts'
import { OpenAIProvider } from './providers/openaiProvider.ts'
import type { ChatProvider, Provider, ProviderConfig } from './types.ts'

export type { Provider } from './types.ts'
/** @deprecated Use Provider. */
export type Povider = Provider

export const providerFactory = (provider: Provider, config: ProviderConfig): ChatProvider => {
    const parsedProvider = providerSchema.parse(provider)
    const parsedConfig = providerConfigSchema.parse(config)
    switch (parsedProvider) {
        case 'openai':
            return new OpenAIProvider(parsedConfig)
        case 'anthropic':
            return new AnthropicProvider(parsedConfig)
        default:
            throw new Error(`Unsupported provider: ${provider}`)
    }
}
