import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import * as tools from './tools/index.ts'
import { chatOptionsSchema, LLMFactory } from './LLM/index.ts'

// Preserve the required standalone JSDoc lines on the cleanup callback.
// prettier-ignore
afterEach(
    /**
     * Restores external request state.
     * @returns Nothing.
     */
    () => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    }
)

/**
 * Creates a tool through its public entry.
 * @param body - Optional host body.
 * @returns A registered tool and its registry.
 */
function setup(body?: (args: { text: string }) => string) {
    const tool = tools.defineTool({
        name: 'echo',
        description: 'Return text',
        parameters: z.strictObject({ text: z.string() }),
        output: z.string(),
        /**
         * Returns a host result.
         * @param args - Parsed arguments.
         * @returns Text.
         */
        execute(args) {
            return body ? body(args) : args.text
        },
    })
    const registry = new tools.ToolRegistry()
    registry.registry(tool)
    return { tool, registry }
}

// Preserve multiline documentation on nested test callbacks.
// prettier-ignore
describe(
    'Tools public entry and caller-owned LLM adaptation',
    /**
     * Groups integration assertions.
     * @returns Nothing.
     */
    () => {
        test(
            'uses the public entry end to end',
            /**
             * Checks the complete host flow.
             * @returns A verification promise.
             */
            async () => {
                expect(typeof tools.defineTool).toBe('function')
                const { tool, registry } = setup()
                expect(registry.get('echo')).toBe(tool)
                await expect(registry.get('echo')?.execute({ text: 'hello' }, { userId: 'u', workspaceId: 'w' })).resolves.toBe('hello')
                expect(registry.schemas()[0].name).toBe('echo')
                expect(registry.delete('echo')).toBe(true)
                expect(registry.list()).toEqual([])
            }
        )
        test(
            'adapts descriptors to the independently defined LLM protocol',
            /**
             * Checks structural compatibility.
             * @returns Nothing.
             */
            () => {
                const { registry } = setup()
                expect(chatOptionsSchema.parse({ tools: registry.schemas() }).tools?.[0]).toMatchObject({
                    name: 'echo',
                    description: 'Return text',
                    parameters: { type: 'object', additionalProperties: false },
                })
            }
        )
        test.each(['openai', 'anthropic'] as const)(
            'sends generated descriptions through %s without executing tools',
            /**
             * Checks native provider payloads with simulated HTTP.
             * @param provider - Provider protocol.
             * @returns A verification promise.
             */
            async provider => {
                let executions = 0
                const { registry } = setup(
                    /**
                     * Records unexpected execution.
                     * @param args - Parsed input.
                     * @returns Text.
                     */
                    args => {
                        executions++
                        return args.text
                    }
                )
                const response =
                    provider === 'openai'
                        ? {
                              id: 'chat_test',
                              object: 'chat.completion',
                              created: 0,
                              model: 'test-model',
                              choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'done' } }],
                              usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
                          }
                        : {
                              id: 'msg_test',
                              type: 'message',
                              role: 'assistant',
                              model: 'test-model',
                              content: [{ type: 'text', text: 'done' }],
                              stop_reason: 'end_turn',
                              stop_sequence: null,
                              usage: { input_tokens: 2, output_tokens: 1 },
                          }
                // Provider request payload captured by the fetch mock for protocol assertions.
                let request: unknown
                vi.stubGlobal(
                    'fetch',
                    vi.fn<typeof fetch>(
                        /**
                         * Simulates provider HTTP.
                         * @param _input - Request URL.
                         * @param init - Request body.
                         * @returns A native response.
                         */
                        async (_input, init) => {
                            request = JSON.parse(String(init?.body))
                            return Response.json(response)
                        }
                    )
                )
                const llm = LLMFactory({ provider, apiKey: 'test-key', model: 'test-model', baseUrl: 'https://example.invalid/v1' })
                const result = await llm.chat([{ role: 'user', content: 'hello' }], { tools: registry.schemas() })
                const parameters = {
                    $schema: 'http://json-schema.org/draft-07/schema#',
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                    additionalProperties: false,
                }
                expect(request).toMatchObject({
                    tools:
                        provider === 'openai'
                            ? [{ type: 'function', function: { name: 'echo', description: 'Return text', parameters } }]
                            : [{ name: 'echo', description: 'Return text', input_schema: parameters }],
                })
                expect(result.choices[0].message.content).toBe('done')
                expect(executions).toBe(0)
            }
        )
    }
)
