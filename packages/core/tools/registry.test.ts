import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { defineTool } from './defineTool.ts'
import { ToolRegistry } from './registry.ts'
import { DuplicateToolError, InvalidToolDefinitionError } from './errors.ts'

/**
 * Creates a real named tool.
 * @param name - Unique identifier.
 * @returns A frozen executable tool.
 */
function makeTool(name: string) {
    return defineTool({
        name,
        description: 'Echo',
        parameters: z.strictObject({}),
        output: z.string(),
        /**
         * Returns the tool identity.
         * @returns Its name.
         */
        execute() {
            return name
        },
    })
}

// Preserve multiline documentation on nested test callbacks.
// prettier-ignore
describe(
    'ToolRegistry management',
    /**
     * Groups collection assertions.
     * @returns Nothing.
     */
    () => {
        test(
            'registers single and batch tools in order',
            /**
             * Checks identity and order.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry(),
                    // Tool named "a" used to check registration order and reference identity.
                    a = makeTool('a'),
                    // Tool named "b" used to check registration order and reference identity.
                    b = makeTool('b'),
                    // Tool named "c" used to check registration order and reference identity.
                    c = makeTool('c')
                expect(registry.list()).toEqual([])
                registry.registry(a)
                registry.registry([b, c])
                expect(registry.list()).toEqual([a, b, c])
                expect(registry.get('a')).toBe(a)
            }
        )
        test(
            'rejects all duplicate registrations without replacement',
            /**
             * Checks collision behavior.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry(),
                    // Tool named "a" used to check registration order and reference identity.
                    a = makeTool('a')
                registry.registry(a)
                for (const input of [a, makeTool('a'), [makeTool('b'), makeTool('b')]]) {
                    expect(
                        /**
                         * Attempts duplicate registration.
                         * @returns Nothing.
                         * @throws A name conflict.
                         */
                        () => registry.registry(input)
                    ).toThrow(DuplicateToolError)
                    expect(registry.list()).toEqual([a])
                }
            }
        )
        test(
            'rejects the entire batch when its last item is invalid',
            /**
             * Checks atomic insertion.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry(),
                    // Tool named "a" used to check registration order and reference identity.
                    a = makeTool('a'),
                    // Tool named "b" used to check registration order and reference identity.
                    b = makeTool('b')
                registry.registry(a)
                for (const last of [a, { ...makeTool('c') }, Object.freeze({ ...makeTool('c'), execute: undefined })]) {
                    expect(
                        /**
                         * Exercises untyped registration.
                         * @returns Nothing.
                         * @throws A batch error.
                         */
                        () => Reflect.apply(registry.registry, registry, [[b, last]])
                    ).toThrow()
                    expect(registry.list()).toEqual([a])
                    expect(registry.get('b')).toBeUndefined()
                }
            }
        )
        test(
            'accepts empty batches and host-defined frozen tools',
            /**
             * Checks standard interoperability.
             * @returns A verification promise.
             */
            async () => {
                const registry = new ToolRegistry()
                registry.registry([])
                const external = Object.freeze({
                    name: 'external',
                    description: 'External',
                    parameters: Object.freeze({ type: 'object' }),
                    /**
                     * Executes host behavior.
                     * @returns A host result.
                     */
                    async execute() {
                        return 'host'
                    },
                })
                registry.registry(external)
                expect(registry.get('external')).toBe(external)
                await expect(external.execute()).resolves.toBe('host')
            }
        )
        test(
            'rejects mutable metadata, non-JSON descriptions and accessors',
            /**
             * Checks external definition integrity.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry(),
                    tool = makeTool('a')
                const invalid = [
                    { ...tool },
                    Object.freeze({ ...tool, parameters: Object.freeze({ type: 'object', properties: {} }) }),
                    Object.freeze({ ...tool, parameters: Object.freeze({ type: 'object', extra: undefined }) }),
                ]
                let reads = 0
                const accessor = Object.freeze({
                    ...tool,
                    /**
                     * Detects metadata reads.
                     * @returns A changing name.
                     */
                    get name() {
                        reads++
                        return 'changing'
                    },
                })
                invalid.push(accessor)
                for (const value of invalid)
                    expect(
                        /**
                         * Validates a host definition.
                         * @returns Nothing.
                         * @throws InvalidToolDefinitionError.
                         */
                        () => registry.registry(value)
                    ).toThrow(InvalidToolDefinitionError)
                expect(registry.list()).toEqual([])
                expect(reads).toBe(0)
            }
        )
        test(
            'isolates list arrays and registry instances',
            /**
             * Checks collection ownership.
             * @returns Nothing.
             */
            () => {
                const first = new ToolRegistry(),
                    second = new ToolRegistry(),
                    // Tool named "a" used to check registration order and reference identity.
                    a = makeTool('a')
                first.registry(a)
                const list = first.list()
                Reflect.deleteProperty(list, '0')
                expect(first.get('a')).toBe(a)
                expect(second.get('a')).toBeUndefined()
                second.registry(a)
                first.delete('a')
                expect(second.list()).toEqual([a])
            }
        )
        test(
            'uses exact names and safely handles prototype-like identifiers',
            /**
             * Checks Map lookup semantics.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry()
                for (const name of ['echo', 'Echo', '__proto__', 'constructor']) registry.registry(makeTool(name))
                expect(registry.list().length).toBe(4)
                expect(registry.get('__proto__')?.name).toBe('__proto__')
                expect(registry.get('Echo')?.name).toBe('Echo')
                expect(registry.get('')).toBeUndefined()
                expect(registry.get('missing')).toBeUndefined()
            }
        )
        test(
            'deletes idempotently and appends re-registrations',
            /**
             * Checks reference lifetime.
             * @returns A verification promise.
             */
            async () => {
                const registry = new ToolRegistry(),
                    // Tool named "a" used to check registration order and reference identity.
                    a = makeTool('a'),
                    // Tool named "b" used to check registration order and reference identity.
                    b = makeTool('b')
                registry.registry([a, b])
                expect(registry.delete('a')).toBe(true)
                expect(registry.delete('a')).toBe(false)
                expect(registry.get('a')).toBeUndefined()
                await expect(a.execute({}, { userId: 'u', workspaceId: 'w' })).resolves.toBe('a')
                registry.registry(a)
                expect(registry.list()).toEqual([b, a])
            }
        )
    }
)
