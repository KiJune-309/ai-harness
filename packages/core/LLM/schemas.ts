import { z } from 'zod'

/** Model-facing function definition used by provider request serialization. */
export const toolDefinitionSchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
})

/** Shared function-call protocol returned by model providers. */
export const toolCallSchema = z.object({
    id: z.string().min(1),
    type: z.literal('function'),
    function: z.object({
        name: z.string().min(1),
        arguments: z.string(),
    }),
})

export const providerSchema = z.enum(['openai', 'anthropic'])

export const anthropicContentBlockSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string(), citations: z.array(z.unknown()).nullable().optional() }),
    z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }),
    z.object({ type: z.literal('thinking'), thinking: z.string(), signature: z.string() }),
    z.object({ type: z.literal('redacted_thinking'), data: z.string() }),
])

export const messageSchema = z.discriminatedUnion('role', [
    z.object({ role: z.enum(['user', 'system']), content: z.string() }),
    z.object({
        role: z.literal('assistant'),
        content: z.string().nullable(),
        tool_calls: z.array(toolCallSchema).optional(),
        // Preserve signed Anthropic blocks when continuing a tool-use turn.
        providerContent: z.array(anthropicContentBlockSchema).optional(),
    }),
    z.object({ role: z.literal('tool'), content: z.string(), tool_call_id: z.string().min(1) }),
])

export const providerConfigSchema = z.object({
    apiKey: z.string().trim().min(1),
    baseUrl: z
        .url({ protocol: /^https?$/ })
        .pipe(
            z.string().refine(value => {
                const url = new URL(value)
                return !url.username && !url.password && !url.search && !url.hash
            }, 'baseUrl must be an HTTP(S) API root without credentials, query or fragment')
        )
        .optional(),
    model: z.string().trim().min(1),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(1).optional(),
    timeoutMs: z.number().int().positive().max(4_294_967_295).optional(),
})

export const chatOptionsSchema = z.object({
    signal: z.instanceof(AbortSignal).optional(),
    tools: z.array(toolDefinitionSchema).readonly().optional(),
})

export const createLLMOptionsSchema = providerConfigSchema.extend({
    provider: providerSchema,
})
