import { z } from 'zod'
import { getJsonIssues } from './json.ts'

/**
 * Checks that a parameter description is lossless JSON with an object schema root.
 * @param value - Candidate parameter schema description.
 * @returns Whether the value describes an object-rooted parameter schema.
 * @throws The original error if inspecting the candidate's properties or prototype fails.
 */
function isParameterSchema(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        getJsonIssues(value).length === 0 &&
        Reflect.get(value, 'type') === 'object'
    )
}

/**
 * Descriptor structure exposed to model consumers.
 */
export const toolSchema = z.object({
    name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    // Preserve the required standalone JSDoc lines on the refinement callback.
    // prettier-ignore
    description: z.string().refine(
        /**
         * Checks whether a tool description contains non-whitespace text.
         * @param text - Description string to inspect.
         * @returns Whether the trimmed description is nonempty.
         */
        text => text.trim().length > 0
    ),
    parameters: z.custom<Record<string, unknown>>(isParameterSchema, 'Expected lossless object-rooted JSON Schema'),
})
