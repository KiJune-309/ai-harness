import { z } from 'zod'
import type { DefineToolOptions, Tool } from './types.ts'
import { InvalidToolDefinitionError, ToolValidationError } from './errors.ts'
import { cloneJson, freezeJson, getJsonIssues } from './json.ts'
import { toolSchema } from './schemas.ts'

/** Validates and normalizes one boundary value. @param schema - Author schema. @param value - Candidate data. @param name - Tool identity. @param stage - Validation phase. @returns Parsed JSON data. @throws ToolValidationError for schema or JSON violations. */
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

/** Defines a typed tool with immutable model metadata. @param options - Author configuration. @returns A frozen tool with validated asynchronous execution. @throws InvalidToolDefinitionError for unsupported or malformed definitions. */
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
        // Zod attaches a non-enumerable ~standard runtime adapter; only JSON keywords belong in the wire snapshot.
        const parameters = { ...z.toJSONSchema(options.parameters, { target: 'draft-07', io: 'input', unrepresentable: 'throw' }) }
        if (parameters.type !== 'object' || parameters.additionalProperties !== false)
            throw new Error('Parameters must be a strict object schema')
        z.toJSONSchema(options.output, { target: 'draft-07', io: 'output', unrepresentable: 'throw' })
        const descriptor = toolSchema.parse({ name: options.name, description: options.description, parameters })
        const input = options.parameters
        const output = options.output
        const body = options.execute
        return Object.freeze({
            ...descriptor,
            parameters: freezeJson(cloneJson(descriptor.parameters)),
            /** Validates input, runs the body and validates output. @param args - Untrusted JSON arguments. @param context - Trusted host context. @returns Declared JSON output. @throws ToolValidationError, the cancellation reason, or the original body exception. */
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
