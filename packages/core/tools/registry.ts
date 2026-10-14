import type { Tool, ToolSchema } from './types.ts'
import { DuplicateToolError, InvalidToolDefinitionError } from './errors.ts'
import { cloneJson, isFrozenJson } from './json.ts'
import { toolSchema } from './schemas.ts'

/**
 * Checks immutable host definitions without evaluating their metadata getters.
 * @param value - Candidate tool.
 * @returns Nothing, narrowing valid tools.
 * @throws InvalidToolDefinitionError if the tool is mutable or its metadata or execution entry is malformed.
 * @throws The original error if inspecting the tool's properties or frozen state fails.
 */
function assertTool(value: unknown): asserts value is Tool {
    if (value === null || typeof value !== 'object') throw new InvalidToolDefinitionError('Expected a frozen tool object')
    // Read descriptors so tool metadata can be checked without invoking accessor properties.
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

/**
 * Instance-owned registry of host-provided tools.
 */
export class ToolRegistry {
    readonly #tools = new Map<string, Tool>()

    /**
     * Exports model descriptions in registration order without executing tools.
     * @returns New descriptor objects with deeply copied JSON schemas, detached from registry state.
     * @throws DataCloneError if native structured cloning cannot copy a registered parameter schema.
     */
    schemas(): readonly ToolSchema[] {
        // Preserve the required standalone JSDoc lines on the projection callback.
        // prettier-ignore
        return this.list().map(
            /**
             * Projects the model-visible fields from a registered tool.
             * @param tool - Frozen registered tool to describe.
             * @returns A detached model description with a cloned parameter schema.
             * @throws DataCloneError if native structured cloning cannot copy the parameter schema.
             */
            tool => ({
                name: tool.name,
                description: tool.description,
                parameters: cloneJson(tool.parameters),
            })
        )
    }

    /**
     * Validates an entire submission before registering its tools in submission order.
     * @param tools - A single frozen tool or an ordered batch of frozen tools.
     * @returns Nothing.
     * @throws InvalidToolDefinitionError if any submitted tool has invalid or mutable metadata.
     * @throws DuplicateToolError if a name already exists in the registry or appears more than once in the batch.
     * @throws The original error if inspecting a submitted tool fails.
     * @remarks Adds registrations only after every submitted tool passes validation, leaving the registry unchanged on validation failure.
     */
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
    /**
     * Lists registered tools in registration order.
     * @returns A new array containing the original frozen tool references.
     */
    list(): readonly Tool[] {
        return [...this.#tools.values()]
    }
    /**
     * Looks up a registered tool by its exact, case-sensitive name.
     * @param name - Exact tool identifier.
     * @returns The registered tool, or undefined if no registration exists.
     */
    get(name: string): Tool | undefined {
        return this.#tools.get(name)
    }
    /**
     * Removes a registration without revoking existing tool references or executions.
     * @param name - Exact tool identifier to remove.
     * @returns Whether a registration was removed.
     */
    delete(name: string): boolean {
        return this.#tools.delete(name)
    }
}
