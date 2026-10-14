import type { Tool } from './types.ts'
import { DuplicateToolError, InvalidToolDefinitionError } from './errors.ts'
import { isFrozenJson } from './json.ts'
import { toolSchema } from './schemas.ts'

/** Checks immutable host definitions without evaluating getters. @param value - Candidate tool. @returns Nothing, narrowing valid tools. @throws InvalidToolDefinitionError for mutable or malformed metadata. */
function assertTool(value: unknown): asserts value is Tool {
    if (value === null || typeof value !== 'object') throw new InvalidToolDefinitionError('Expected a frozen tool object')
    const fields = Object.getOwnPropertyDescriptors(value)
    const name: unknown = fields.name?.value
    const toolName = typeof name === 'string' ? name : undefined
    for (const key of ['name', 'description', 'parameters', 'execute']) {
        if (!fields[key] || !('value' in fields[key]))
            throw new InvalidToolDefinitionError('Tool fields must be own data properties', toolName)
    }
    const result = toolSchema.safeParse({ name, description: fields.description.value, parameters: fields.parameters.value })
    if (!result.success || !Object.isFrozen(value) || typeof fields.execute.value !== 'function' || !isFrozenJson(result.data.parameters)) {
        throw new InvalidToolDefinitionError('Expected an immutable tool with valid metadata and an execution function', toolName)
    }
}

/** Instance-owned registry of host-provided tools. */
export class ToolRegistry {
    readonly #tools = new Map<string, Tool>()

    /** Registers tools atomically in submission order. @param tools - One tool or a batch. @returns Nothing. @throws InvalidToolDefinitionError or DuplicateToolError; failure leaves the collection unchanged. */
    registry(tools: Tool | readonly Tool[]): void {
        const candidates: readonly unknown[] = Array.isArray(tools) ? tools : [tools]
        const accepted: Tool[] = []
        const names = new Set<string>()
        for (const candidate of candidates) {
            assertTool(candidate)
            if (names.has(candidate.name) || this.#tools.has(candidate.name)) throw new DuplicateToolError(candidate.name)
            names.add(candidate.name)
            accepted.push(candidate)
        }
        for (const tool of accepted) this.#tools.set(tool.name, tool)
    }
    /** Lists tools. @returns Registered tool references. */
    list(): readonly Tool[] {
        return [...this.#tools.values()]
    }
    /** Gets a tool. @param name - Exact identifier. @returns A tool or undefined. */
    get(name: string): Tool | undefined {
        return this.#tools.get(name)
    }
    /** Removes a registration without revoking prior references or executions. @param name - Exact identifier. @returns Whether a registration was removed. */
    delete(name: string): boolean {
        return this.#tools.delete(name)
    }
}
