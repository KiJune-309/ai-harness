import { z } from 'zod'
import { getJsonIssues } from './json.ts'

/** Validates JSON Schema structure. @param value - Candidate description. @returns Whether it describes object parameters. */
function isParameterSchema(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        getJsonIssues(value).length === 0 &&
        Reflect.get(value, 'type') === 'object'
    )
}

/** Descriptor structure exposed to model consumers. */
export const toolSchema = z.object({
    name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    description: z
        .string()
        .refine(/** Checks useful text. @param text - Description. @returns Whether text is nonblank. */ text => text.trim().length > 0),
    parameters: z.custom<Record<string, unknown>>(isParameterSchema, 'Expected lossless object-rooted JSON Schema'),
})
