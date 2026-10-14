import { describe, expect, test } from 'vitest'
import { toolSchema } from './schemas.ts'
import { DuplicateToolError, InvalidToolDefinitionError, ToolValidationError } from './errors.ts'

const descriptor = { name: 'echo', description: 'Return text', parameters: { type: 'object', properties: { text: { type: 'string' } } } }

// Preserve multiline documentation on nested test callbacks.
// prettier-ignore
describe(
    'Tool standards',
    /**
     * Groups descriptor assertions.
     * @returns Nothing.
     */
    () => {
        test(
            'accepts descriptors and preserves names',
            /**
             * Checks supported descriptors.
             * @returns Nothing.
             */
            () => {
                expect(toolSchema.parse(descriptor)).toEqual(descriptor)
                expect(toolSchema.parse({ ...descriptor, name: 'Echo' }).name).toBe('Echo')
                expect(toolSchema.safeParse({ ...descriptor, name: 'a'.repeat(64) }).success).toBe(true)
            }
        )
        test.each(['', 'a'.repeat(65), ' echo', 'echo.', '中文'])(
            'rejects invalid names: %s',
            /**
             * Checks exact name validation.
             * @param name - Invalid name.
             * @returns Nothing.
             */
            name => {
                expect(toolSchema.safeParse({ ...descriptor, name }).success).toBe(false)
            }
        )
        test(
            'rejects blank descriptions and invalid parameter schemas',
            /**
             * Checks descriptor constraints.
             * @returns Nothing.
             */
            () => {
                expect(toolSchema.safeParse({ ...descriptor, description: '  ' }).success).toBe(false)
                for (const parameters of [[], { type: 'string' }, { type: 'object', default: undefined }]) {
                    expect(toolSchema.safeParse({ ...descriptor, parameters }).success).toBe(false)
                }
            }
        )
        test(
            'preserves error codes, validation stages and original causes',
            /**
             * Checks host error routing.
             * @returns Nothing.
             */
            () => {
                const cause = new Error('original')
                const definition = new InvalidToolDefinitionError('Invalid definition', 'echo', { cause })
                expect(definition).toMatchObject({ name: 'InvalidToolDefinitionError', code: 'INVALID_TOOL_DEFINITION', toolName: 'echo', cause })
                expect(new DuplicateToolError('echo')).toMatchObject({ code: 'DUPLICATE_TOOL', toolName: 'echo' })
                const issues = [{ code: 'invalid_type', path: ['text'], message: 'Expected string' }]
                expect(new ToolValidationError('echo', 'arguments', issues, { cause })).toMatchObject({
                    code: 'INVALID_TOOL_ARGUMENTS',
                    stage: 'arguments',
                    issues,
                    cause,
                })
                expect(new ToolValidationError('echo', 'output', issues).code).toBe('INVALID_TOOL_OUTPUT')
            }
        )
    }
)
