import { z } from 'zod'
import type { DefineToolOptions, Tool } from './types.ts'
import { InvalidToolDefinitionError, ToolValidationError } from './errors.ts'
import { cloneJson, freezeJson, getJsonIssues } from './json.ts'
import { toolSchema } from './schemas.ts'

/**
 * Validates and normalizes one argument or output value using the author schema.
 * @param schema - Schema used to parse and normalize the value.
 * @param value - Untrusted arguments or raw implementation output.
 * @param name - Tool name included in validation errors.
 * @param stage - Boundary being validated, either arguments or output.
 * @returns A promise resolving to the parsed, lossless JSON value.
 * @throws ToolValidationError if schema parsing fails or the parsed value cannot be represented losslessly as JSON.
 * @throws The original error if inspecting the parsed value fails.
 */
async function parseValue<S extends z.ZodType>(
    schema: S,
    value: unknown,
    name: string,
    stage: 'arguments' | 'output'
): Promise<z.output<S>> {
    let parsed: z.output<S>
    try {
        parsed = await schema.parseAsync(value)
    } catch (cause) {
        const issues =
            cause instanceof z.ZodError ? cause.issues : [{ code: 'invalid_schema', path: [], message: 'Schema validation failed' }]
        throw new ToolValidationError(name, stage, issues, { cause })
    }
    const issues = getJsonIssues(parsed)
    if (issues.length) throw new ToolValidationError(name, stage, issues)
    return parsed
}

/**
 * Defines a typed tool and freezes a detached snapshot of its model-visible metadata.
 * @param options - Tool identity, argument and output schemas, and execution implementation.
 * @returns A frozen tool whose asynchronous execution validates arguments and output.
 * @throws InvalidToolDefinitionError if the definition is malformed, its schemas are unsupported, or creating the metadata snapshot fails.
 * @throws The original error if reading the tool name fails before definition validation begins.
 */
export function defineTool<P extends z.ZodType<Record<string, unknown>>, O extends z.ZodType>(
    options: DefineToolOptions<P, O>
): Tool<z.output<O>> {
    const name = typeof options?.name === 'string' ? options.name : undefined
    try {
        if (
            !(options?.parameters instanceof z.ZodObject) ||
            !(options.output instanceof z.ZodType) ||
            typeof options.execute !== 'function'
        ) {
            throw new Error('Expected object parameters, an output schema and an execution function')
        }
        // The parser's unknown-key policy is independent of author-provided JSON Schema metadata.
        if (!(options.parameters.def.catchall instanceof z.ZodNever)) throw new Error('Parameters must reject unknown keys')
        // Zod attaches a non-enumerable ~standard runtime adapter; only JSON keywords belong in the wire snapshot.
        const parameters = { ...z.toJSONSchema(options.parameters, { target: 'draft-07', io: 'input', unrepresentable: 'throw' }) }
        if (parameters.type !== 'object' || parameters.additionalProperties !== false)
            throw new Error('Parameters must be a strict object schema')
        z.toJSONSchema(options.output, { target: 'draft-07', io: 'output', unrepresentable: 'throw' })
        const descriptor = toolSchema.parse({ name: options.name, description: options.description, parameters })
        // Capture the author's argument schema for later input parsing.
        const input = options.parameters
        // Capture the author's output schema for later result parsing.
        const output = options.output
        // Capture the original implementation invoked between input and output validation.
        const body = options.execute
        return Object.freeze({
            ...descriptor,
            parameters: freezeJson(cloneJson(descriptor.parameters)),
            /**
             * Validates arguments, invokes the author implementation, and validates its output.
             * @param args - Untrusted arguments that must be lossless JSON and satisfy the argument schema.
             * @param context - Trusted user and workspace context with an optional cancellation signal.
             * @returns A promise resolving to the declared, parsed JSON output.
             * @throws ToolValidationError if argument or output validation fails.
             * @throws The cancellation reason if the signal is already aborted before validation or implementation execution.
             * @throws The original implementation or object-inspection error if execution or JSON inspection fails.
             * @remarks Invokes the author implementation's side effects and awaits its completion even if the signal aborts while it is running.
             */
            async execute(args, context) {
                context.signal?.throwIfAborted()
                const issues = getJsonIssues(args)
                if (issues.length) throw new ToolValidationError(descriptor.name, 'arguments', issues)
                const parsed = await parseValue(input, args, descriptor.name, 'arguments')
                context.signal?.throwIfAborted()
                const value = await body(parsed, context)
                return parseValue(output, value, descriptor.name, 'output')
            },
        })
    } catch (cause) {
        throw new InvalidToolDefinitionError('Invalid tool definition', name, { cause })
    }
}
