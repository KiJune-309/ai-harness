import type { z } from 'zod'
import type {
    anthropicContentBlockSchema,
    chatOptionsSchema,
    messageSchema,
    providerConfigSchema,
    providerSchema,
    toolCallSchema,
    toolDefinitionSchema,
} from './schemas.ts'

export type Message = z.infer<typeof messageSchema>
export type Provider = z.infer<typeof providerSchema>
/** Server-side configuration shared by both providers. */
export type ProviderConfig = Readonly<z.infer<typeof providerConfigSchema>>
export type ChatOptions = Readonly<z.infer<typeof chatOptionsSchema>>
/** Model-facing function definition, owned by the LLM protocol module. */
export type ToolDefinition = Readonly<z.infer<typeof toolDefinitionSchema>>
/** Function-call protocol shared by model providers. */
export type ToolCall = z.infer<typeof toolCallSchema>
export type AssistantMessage = Extract<Message, { role: 'assistant' }>

export { LLMProvider } from './providers/baseProvider.ts'

export interface ChatResponse {
    base_resp: {
        status_code: number
        status_msg: string
    }
    choices: {
        finish_reason: string | null
        index: number
        message: AssistantMessage
    }[]
    created: number
    id: string
    input_sensitive: boolean
    input_sensitive_type: number
    model: string
    object: 'chat.completion'
    output_sensitive: boolean
    output_sensitive_int: number
    output_sensitive_type: number
    service_tier: string
    usage: {
        completion_tokens: number
        completion_tokens_details: {
            reasoning_tokens: number
        }
        prompt_tokens: number
        prompt_tokens_details: {
            cached_tokens: number
        }
        total_characters: number
        total_tokens: number
    }
}

export interface StreamResponse {
    choices: Choices[]
    created: number
    id: string
    model: string
    object: string
    service_tier: string
    usage: null
}

interface Choices {
    delta: {
        role: 'assistant'
        content: string
    }
    index: number
}

/** Native Anthropic response blocks before conversion to the shared chat format. */
export type AnthropicContentBlock = z.infer<typeof anthropicContentBlockSchema>

export type AnthropicStopReason =
    'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal' | 'model_context_window_exceeded'

export interface AnthropicUsage {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
    cache_creation?: {
        ephemeral_5m_input_tokens: number
        ephemeral_1h_input_tokens: number
    } | null
    service_tier?: string | null
}

/** Non-streaming /messages response; message_start carries the same shape. */
export interface AnthropicChatResponse {
    id: string
    type: 'message'
    role: 'assistant'
    model: string
    content: AnthropicContentBlock[]
    stop_reason: AnthropicStopReason | null
    stop_sequence: string | null
    usage: AnthropicUsage
}

export type AnthropicContentDelta =
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string }
    | { type: 'citations_delta'; citation: unknown }

/** Native SSE events, discriminated by type before conversion to StreamResponse. */
export type AnthropicStreamResponse =
    | { type: 'message_start'; message: AnthropicChatResponse }
    | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
    | { type: 'content_block_delta'; index: number; delta: AnthropicContentDelta }
    | { type: 'content_block_stop'; index: number }
    | {
          type: 'message_delta'
          delta: { stop_reason: AnthropicStopReason | null; stop_sequence: string | null }
          usage: Partial<AnthropicUsage> & Pick<AnthropicUsage, 'output_tokens'>
      }
    | { type: 'message_stop' }
    | { type: 'ping' }
    | { type: 'error'; error: { type: string; message: string } }
