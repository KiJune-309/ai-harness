import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { defineTool } from './defineTool.ts'
import type { Tool } from './types.ts'

const text = defineTool({
    name: 'text',
    description: 'Text',
    parameters: z.strictObject({ text: z.string() }),
    output: z.string(),
    /** Preserves parameter inference. @param args - Parsed text. @returns String output. */ execute(args) {
        expectTypeOf(args).toEqualTypeOf<{ text: string }>()
        return args.text
    },
})
const object = defineTool({
    name: 'object',
    description: 'Object',
    parameters: z.strictObject({}),
    output: z.strictObject({ value: z.number() }),
    /** Produces typed object output. @returns A value object. */ execute() {
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
    // @ts-expect-error The body must match the declared output.
    execute: () => 1,
})
defineTool({
    name: 'bad_root',
    description: 'Bad root',
    // @ts-expect-error Tool parameter schemas must produce object arguments.
    parameters: z.string(),
    output: z.string(),
    execute: () => 'x',
})
