import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { defineTool } from './defineTool.ts'
import type { Tool } from './types.ts'

const text = defineTool({
    name: 'text',
    description: 'Text',
    parameters: z.strictObject({ text: z.string() }),
    output: z.string(),
    /**
     * Checks inferred argument types and returns the parsed text.
     * @param args - Parsed text arguments whose inferred type is asserted.
     * @returns The parsed text string.
     */
    execute(args) {
        expectTypeOf(args).toEqualTypeOf<{ text: string }>()
        return args.text
    },
})
const object = defineTool({
    name: 'object',
    description: 'Object',
    parameters: z.strictObject({}),
    output: z.strictObject({ value: z.number() }),
    /**
     * Produces an object used to verify output type inference.
     * @returns An object containing a numeric value.
     */
    execute() {
        return { value: 1 }
    },
})
const tools: readonly Tool[] = [text, object]
expectTypeOf(tools).toEqualTypeOf<readonly Tool[]>()
expectTypeOf(text.execute({}, { userId: 'u', workspaceId: 'w' })).toEqualTypeOf<Promise<string>>()
expectTypeOf(object.execute({}, { userId: 'u', workspaceId: 'w' })).toEqualTypeOf<Promise<{ value: number }>>()

// @ts-expect-error Trusted execution context is required.
void text.execute({ text: 'x' })
defineTool({
    name: 'bad',
    description: 'Bad',
    parameters: z.strictObject({}),
    output: z.string(),
    execute:
        /**
         * Supplies an intentionally invalid numeric output for a compile-time error assertion.
         * @returns A number that conflicts with the declared string output schema.
         */
        () =>
            // @ts-expect-error The body must match the declared output.
            1,
})
defineTool({
    name: 'bad_root',
    description: 'Bad root',
    // @ts-expect-error Tool parameter schemas must produce object arguments.
    parameters: z.string(),
    output: z.string(),
    /**
     * Supplies string output for a fixture whose parameter schema has an invalid root type.
     * @returns A string matching the fixture's output schema.
     */
    execute() {
        return 'x'
    },
})
