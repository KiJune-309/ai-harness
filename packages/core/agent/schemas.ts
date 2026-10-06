import { z } from 'zod'

export const providerSchema = z.enum(['openai', 'anthropic'])

export const messageSchema = z.object({
    role: z.enum(['user', 'system', 'assistant', 'tools']),
    content: z.string(),
})

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
})

export const createAgentOptionsSchema = providerConfigSchema.extend({
    sessionId: z.string().trim().min(1),
    provider: providerSchema,
})
