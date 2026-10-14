import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { defineTool } from './defineTool.ts'
import { InvalidToolDefinitionError, ToolValidationError } from './errors.ts'

const context = { userId: 'user_test', workspaceId: 'workspace_test' }
const options = {
    name: 'echo',
    description: 'Return text',
    parameters: z.strictObject({ text: z.string() }),
    output: z.string(),
    /**
     * Returns parsed text.
     * @param args - Validated arguments.
     * @returns The text.
     */
    execute(args: { text: string }) {
        return args.text
    },
}

/**
 * Creates a controlled asynchronous gate.
 * @returns A promise and its release callback.
 */
function gate() {
    // Releases the controlled work by resolving its pending gate promise.
    let resolve!: () => void
    const promise = new Promise<void>(
        /**
         * Saves the release callback.
         * @param release - Resolver.
         * @returns Nothing.
         */
        release => {
            resolve = release
        }
    )
    return { promise, resolve }
}

/**
 * Records settlement without an unhandled rejection.
 * @param promise - Tool execution.
 * @returns The eventual outcome.
 */
function settle<T>(promise: Promise<T>) {
    return promise.then(
        /**
         * Records success.
         * @param value - Tool result.
         * @returns A success outcome.
         */
        value => ({ ok: true as const, value }),
        /**
         * Records failure.
         * @param error - Rejection.
         * @returns A failure outcome.
         */
        (error: unknown) => ({ ok: false as const, error })
    )
}

/**
 * Waits for owned work to begin, failing if it ends early.
 * @param entered - Entry gate.
 * @param outcome - Tool settlement.
 * @returns A promise resolving when controlled work has begun.
 * @throws Error if execution settles before entering controlled work.
 */
async function waitForEntry(entered: Promise<void>, outcome: Promise<unknown>) {
    await Promise.race([
        entered,
        outcome.then(
            /**
             * Detects premature settlement.
             * @returns Never.
             * @throws If the body never entered.
             */
            () => {
                throw new Error('Execution ended before entering controlled work')
            }
        ),
    ])
}

// Preserve multiline documentation on nested test callbacks.
// prettier-ignore
describe(
    'defineTool',
    /**
     * Groups execution boundary assertions.
     * @returns Nothing.
     */
    () => {
        test(
            'defines immutable descriptions and returns parsed results',
            /**
             * Checks author snapshots.
             * @returns A verification promise.
             */
            async () => {
                const config = { ...options }
                const tool = defineTool(config)
                config.name = 'changed'
                expect(tool.name).toBe('echo')
                expect(tool.parameters).toMatchObject({ type: 'object', required: ['text'], additionalProperties: false })
                expect(Object.isFrozen(tool)).toBe(true)
                expect(Object.isFrozen(tool.parameters.properties)).toBe(true)
                await expect(tool.execute({ text: 'hello' }, context)).resolves.toBe('hello')
            }
        )

        test.each([
            z.strictObject({ text: z.string() }),
            z.object({ text: z.string() }).strict(),
            z.object({ text: z.string() }).catchall(z.never()),
        ])(
            'accepts equivalent strict objects',
            /**
             * Checks strict author schemas.
             * @param parameters - Strict schema.
             * @returns Nothing.
             */
            parameters => {
                expect(defineTool({ ...options, parameters }).parameters.additionalProperties).toBe(false)
            }
        )
        test.each([z.object({ text: z.string() }), z.looseObject({ text: z.string() }), z.object({ text: z.string() }).catchall(z.string())])(
            'rejects open or stripping roots',
            /**
             * Checks author policy.
             * @param parameters - Non-strict schema.
             * @returns Nothing.
             */
            parameters => {
                expect(
                    /**
                     * Attempts to define a tool with a non-strict argument schema.
                     * @returns A tool if the invalid definition is incorrectly accepted.
                     * @throws InvalidToolDefinitionError for an open or stripping argument schema.
                     */
                    () => defineTool({ ...options, parameters })
                ).toThrow(InvalidToolDefinitionError)
            }
        )
        test.each([
            z.object({ text: z.string() }).meta({ additionalProperties: false }),
            z.looseObject({ text: z.string() }).meta({ additionalProperties: false }),
            z.object({ text: z.string() }).catchall(z.string()).meta({ additionalProperties: false }),
        ])(
            'rejects metadata that masks a non-strict parameter policy',
            /**
             * Checks that author metadata cannot replace runtime strictness.
             * @param parameters - Non-strict schema with strict-looking metadata.
             * @returns Nothing.
             */
            parameters => {
                expect(
                    /**
                     * Attempts to define a non-strict tool.
                     * @returns The invalid tool if validation fails to reject it.
                     * @throws InvalidToolDefinitionError for the non-strict definition.
                     */
                    () => defineTool({ ...options, parameters })
                ).toThrow(InvalidToolDefinitionError)
            }
        )

        test.each(['arguments', 'output'] as const)(
            'rejects custom array serialization at the %s boundary',
            /**
             * Checks JSON fidelity before execution and after output parsing.
             * @param stage - Validation boundary being exercised.
             * @returns A verification promise.
             */
            async stage => {
                class ChangedArray extends Array<number> {
                    /**
                     * Replaces the array during serialization.
                     * @returns An incompatible JSON object.
                     */
                    toJSON() {
                        return { changed: true }
                    }
                }
                const customPrototype = Object.create(Array.prototype, {
                    toJSON: {
                        /**
                         * Replaces the array during serialization.
                         * @returns An incompatible JSON object.
                         */
                        value() {
                            return { changed: true }
                        },
                    },
                })
                const values = [new ChangedArray(1, 2), Object.setPrototypeOf([1, 2], customPrototype)]
                // Counts tool body invocations to detect unintended side effects.
                let calls = 0
                for (const value of values) {
                    const tool = defineTool({
                        ...options,
                        parameters: z.strictObject({ values: z.any() }),
                        output: z.any(),
                        /**
                         * Records execution and supplies a custom array result.
                         * @returns An array with custom serialization behavior.
                         */
                        execute() {
                            calls++
                            return value
                        },
                    })
                    await expect(tool.execute({ values: stage === 'arguments' ? value : [] }, context)).rejects.toMatchObject({
                        code: stage === 'arguments' ? 'INVALID_TOOL_ARGUMENTS' : 'INVALID_TOOL_OUTPUT',
                    })
                }
                expect(calls).toBe(stage === 'arguments' ? 0 : values.length)
            }
        )

        test.each([
            { name: 'bad.name' },
            { description: ' ' },
            { execute: undefined },
            { parameters: z.string() },
            { output: z.date() },
            { output: z.string().transform(Number) },
        ])(
            'rejects malformed or unrepresentable configurations',
            /**
             * Exercises JavaScript callers bypassing static types.
             * @param change - Invalid config field.
             * @returns Nothing.
             */
            change => {
                expect(
                    /**
                     * Passes malformed configuration to the untyped definition boundary.
                     * @returns A tool if the invalid configuration is incorrectly accepted.
                     * @throws InvalidToolDefinitionError for malformed or unsupported configuration.
                     */
                    () => Reflect.apply(defineTool, undefined, [{ ...options, ...change }])
                ).toThrow(InvalidToolDefinitionError)
            }
        )
        test.each([
            { output: z.string(), value: 'ok' },
            { output: z.number(), value: 2 },
            { output: z.boolean(), value: true },
            { output: z.null(), value: null },
            { output: z.array(z.number()), value: [1, 2] },
            { output: z.strictObject({ value: z.number() }), value: { value: 3 } },
        ])(
            'supports JSON output roots',
            /**
             * Checks declared output types.
             * @param example - Schema and result.
             * @returns A verification promise.
             */
            async example => {
                const tool = defineTool({
                    ...options,
                    output: example.output,
                    /**
                     * Returns fixture data.
                     * @returns Declared JSON output.
                     */
                    execute() {
                        return example.value
                    },
                })
                await expect(tool.execute({ text: 'hello' }, context)).resolves.toEqual(example.value)
            }
        )
        test(
            'validates arguments before starting the body',
            /**
             * Checks validation side effects.
             * @returns A verification promise.
             */
            async () => {
                // Counts tool body invocations to detect unintended side effects.
                let calls = 0
                const tool = defineTool({
                    ...options,
                    /**
                     * Counts execution.
                     * @param args - Parsed input.
                     * @returns Text.
                     */
                    execute(args) {
                        calls++
                        return args.text
                    },
                })
                for (const input of [{}, { text: 2 }, { text: 'hi', extra: true }, { text: undefined }, null, [], { text: new Date() }]) {
                    await expect(tool.execute(input, context)).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' })
                }
                expect(calls).toBe(0)
            }
        )
        test(
            'applies defaults and checks nested constraints asynchronously',
            /**
             * Checks schema-owned normalization.
             * @returns A verification promise.
             */
            async () => {
                const parameters = z.strictObject({ text: z.string().default('fallback'), choices: z.array(z.enum(['a', 'b'])).optional() })
                const output = z.string().refine(
                    /**
                     * Checks async output.
                     * @param value - Parsed string.
                     * @returns Whether output is nonempty.
                     */
                    async value => value.length > 0
                )
                const tool = defineTool({ ...options, parameters, output })
                await expect(tool.execute({}, context)).resolves.toBe('fallback')
                await expect(tool.execute({ choices: ['c'] }, context)).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' })
                const defaultOutput = defineTool({
                    ...options,
                    output: z.string().default('output'),
                    /**
                     * Uses output default.
                     * @returns Missing output.
                     */
                    execute() {
                        return undefined
                    },
                })
                await expect(defaultOutput.execute({ text: 'x' }, context)).resolves.toBe('output')
            }
        )
        test(
            'distinguishes output failures from original body errors',
            /**
             * Checks exception ownership.
             * @returns A verification promise.
             */
            async () => {
                const invalid = defineTool({ ...options, output: z.string().min(10) })
                await expect(invalid.execute({ text: 'x' }, context)).rejects.toBeInstanceOf(ToolValidationError)
                await expect(invalid.execute({ text: 'x' }, context)).rejects.toMatchObject({
                    code: 'INVALID_TOOL_OUTPUT',
                    stage: 'output',
                    cause: expect.any(z.ZodError),
                })
                const nonJson = defineTool({
                    ...options,
                    output: z.string().optional(),
                    /**
                     * Produces invalid JSON.
                     * @returns Undefined.
                     */
                    execute() {
                        return undefined
                    },
                })
                await expect(nonJson.execute({ text: 'x' }, context)).rejects.toMatchObject({ code: 'INVALID_TOOL_OUTPUT' })
                for (const original of [new Error('body error'), z.string().safeParse(2).error!]) {
                    const throwing = defineTool({
                        ...options,
                        /**
                         * Throws a tool-owned error.
                         * @throws The original error.
                         * @returns Never.
                         */
                        execute() {
                            throw original
                        },
                    })
                    await expect(throwing.execute({ text: 'x' }, context)).rejects.toBe(original)
                }
            }
        )
        test(
            'does not invoke a pre-aborted body',
            /**
             * Checks early cancellation.
             * @returns A verification promise.
             */
            async () => {
                const abort = new AbortController()
                const reason = new Error('cancelled')
                abort.abort(reason)
                // Counts tool body invocations to detect unintended side effects.
                let calls = 0
                const tool = defineTool({
                    ...options,
                    /**
                     * Counts execution.
                     * @param args - Parsed input.
                     * @returns Text.
                     */
                    execute(args) {
                        calls++
                        return args.text
                    },
                })
                await expect(tool.execute({ text: 'x' }, { ...context, signal: abort.signal })).rejects.toBe(reason)
                expect(calls).toBe(0)
            }
        )
        test(
            'does not start after cancellation during validation',
            /**
             * Checks the asynchronous cancellation window.
             * @returns A verification promise.
             */
            async () => {
                // Signals that asynchronous validation has started.
                const entered = gate(),
                    // Keeps validation pending until cancellation is requested.
                    release = gate()
                const abort = new AbortController()
                const reason = new Error('cancelled')
                // Counts tool body invocations to detect unintended side effects.
                let calls = 0
                const parameters = z.strictObject({
                    text: z.string().refine(
                        /**
                         * Holds validation.
                         * @returns Whether validation succeeded.
                         */
                        async () => {
                            entered.resolve()
                            await release.promise
                            return true
                        }
                    ),
                })
                const tool = defineTool({
                    ...options,
                    parameters,
                    /**
                     * Counts execution.
                     * @param args - Parsed input.
                     * @returns Text.
                     */
                    execute(args) {
                        calls++
                        return args.text
                    },
                })
                const pending = tool.execute({ text: 'x' }, { ...context, signal: abort.signal })
                const outcome = settle(pending)
                await waitForEntry(entered.promise, outcome)
                abort.abort(reason)
                release.resolve()
                const result = await outcome
                expect(result.ok).toBe(false)
                if (result.ok) throw new Error('Expected cancellation')
                expect(result.error).toBe(reason)
                expect(calls).toBe(0)
            }
        )
        test(
            'passes trusted context and drains cooperative work',
            /**
             * Checks owned work settlement.
             * @returns A verification promise.
             */
            async () => {
                // Signals that the tool body has started its controlled work.
                const entered = gate(),
                    // Allows the body to observe cancellation and finish cleanup.
                    release = gate()
                const abort = new AbortController()
                const trusted = { ...context, signal: abort.signal }
                let cleaned = false
                const reason = new Error('cancelled')
                const tool = defineTool({
                    ...options,
                    /**
                     * Runs cooperative work.
                     * @param args - Parsed input.
                     * @param exec - Trusted context.
                     * @returns Text after work finishes.
                     * @throws Cancellation reason.
                     */
                    async execute(args, exec) {
                        expect(exec).toBe(trusted)
                        entered.resolve()
                        try {
                            await release.promise
                            exec.signal?.throwIfAborted()
                            return args.text
                        } finally {
                            cleaned = true
                        }
                    },
                })
                const outcome = settle(tool.execute({ text: 'x' }, trusted))
                await waitForEntry(entered.promise, outcome)
                abort.abort(reason)
                expect(cleaned).toBe(false)
                release.resolve()
                const result = await outcome
                expect(result.ok).toBe(false)
                if (result.ok) throw new Error('Expected cancellation')
                expect(result.error).toBe(reason)
                expect(cleaned).toBe(true)
            }
        )
    }
)
