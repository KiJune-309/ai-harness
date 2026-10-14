import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { defineTool } from './defineTool.ts'
import { ToolRegistry } from './registry.ts'

/**
 * Creates metadata for snapshot tests.
 * @param name - Tool identifier.
 * @returns A frozen tool.
 */
function makeTool(name: string) {
    return defineTool({
        name,
        description: 'Return text',
        parameters: z.strictObject({ text: z.string() }),
        output: z.string(),
        /**
         * Returns text.
         * @param args - Parsed arguments.
         * @returns Text.
         */
        execute(args) {
            return args.text
        },
    })
}

// Preserve multiline documentation on nested test callbacks.
// prettier-ignore
describe(
    'ToolRegistry schemas',
    /**
     * Groups model snapshot assertions.
     * @returns Nothing.
     */
    () => {
        test(
            'exports only ordered model descriptor fields without execution',
            /**
             * Checks projection boundaries.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry()
                // Counts tool body invocations to detect unintended side effects.
                let calls = 0
                const external = Object.freeze({
                    ...makeTool('a'),
                    host: { secret: 'server-only' },
                    /**
                     * Detects unintended execution.
                     * @returns Text.
                     */
                    async execute() {
                        calls++
                        return 'executed'
                    },
                })
                registry.registry([external, makeTool('b')])
                const schemas = registry.schemas()
                expect(
                    schemas.map(
                        /**
                         * Reads exported identities.
                         * @param schema - Descriptor.
                         * @returns Its name.
                         */
                        schema => schema.name
                    )
                ).toEqual(['a', 'b'])
                expect(Object.keys(schemas[0]).sort()).toEqual(['description', 'name', 'parameters'])
                expect(calls).toBe(0)
            }
        )
        test(
            'returns independent snapshots of all nested parameters',
            /**
             * Checks copy isolation.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry(),
                    tool = makeTool('a')
                registry.registry(tool)
                const first = registry.schemas(),
                    second = registry.schemas()
                expect(first).not.toBe(second)
                expect(first[0]).not.toBe(second[0])
                expect(first[0].parameters).not.toBe(second[0].parameters)
                expect(first[0].parameters.properties).not.toBe(second[0].parameters.properties)
                Reflect.set(first[0], 'description', 'changed')
                const properties = first[0].parameters.properties
                if (properties === null || typeof properties !== 'object') throw new Error('Expected properties')
                Reflect.set(properties, 'text', { type: 'number' })
                expect(registry.get('a')?.description).toBe('Return text')
                expect(second[0].parameters.properties).toEqual({ text: { type: 'string' } })
                expect(registry.schemas()[0].parameters.properties).toEqual({ text: { type: 'string' } })
            }
        )
        test(
            'exports empty registries',
            /**
             * Checks empty snapshots.
             * @returns Nothing.
             */
            () => {
                expect(new ToolRegistry().schemas()).toEqual([])
            }
        )
        test(
            'reflects changes without rewriting prior snapshots',
            /**
             * Checks snapshot lifetime.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry(),
                    // Tool named "a" used to check registration order and reference identity.
                    a = makeTool('a'),
                    // Tool named "b" used to check registration order and reference identity.
                    b = makeTool('b')
                registry.registry([a, b])
                const old = registry.schemas()
                registry.delete('a')
                expect(
                    registry.schemas().map(
                        /**
                         * Reads a name.
                         * @param schema - Descriptor.
                         * @returns Its identity.
                         */
                        schema => schema.name
                    )
                ).toEqual(['b'])
                registry.registry(a)
                expect(
                    registry.schemas().map(
                        /**
                         * Reads a name.
                         * @param schema - Descriptor.
                         * @returns Its identity.
                         */
                        schema => schema.name
                    )
                ).toEqual(['b', 'a'])
                expect(
                    old.map(
                        /**
                         * Reads a name.
                         * @param schema - Prior descriptor.
                         * @returns Its identity.
                         */
                        schema => schema.name
                    )
                ).toEqual(['a', 'b'])
            }
        )
        test(
            'serializes as pure JSON',
            /**
             * Checks model transport values.
             * @returns Nothing.
             */
            () => {
                const registry = new ToolRegistry()
                registry.registry(makeTool('a'))
                const schemas = registry.schemas()
                expect(JSON.parse(JSON.stringify(schemas))).toEqual(schemas)
                expect(Reflect.ownKeys(schemas[0].parameters)).not.toContain('~standard')
            }
        )
    }
)
