import type { AgentDefinition, AgentToolId, ChatMessage } from '@ai-harness/contracts'
import { describe, expect, it } from 'vitest'
import { createChatRuntime, type ChatRunInput } from '../src/index.ts'

/** Provider request facts retained by mocked transport only. */
interface RequestBody {
    model: string
    tools?: { function: { name: string; parameters: unknown } }[]
    messages: {
        role: string
        content: string
        reasoning_content?: string
        tool_call_id?: string
        tool_calls?: { id: string; function: { name: string; arguments: string } }[]
    }[]
}

/**
 * Encode arbitrary provider fragments as a complete, fragmented SSE response.
 * @param fragments - Native provider deltas including optional terminal reason.
 * @returns A streaming response split across JSON and UTF-8 boundaries.
 */
function stream(fragments: { delta: Record<string, unknown>; finish?: string }[]): Response {
    const payload =
        fragments
            .map(({ delta, finish }) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`)
            .join('') + 'data: [DONE]\n\n'
    const bytes = new TextEncoder().encode(payload)
    return new Response(
        new ReadableStream({
            /**
             * Push deterministic UTF-8 fragments to exercise the actual SSE parser.
             * @param controller - Response stream controller.
             * @returns Nothing; closes the in-memory response.
             */
            start(controller) {
                for (let index = 0; index < bytes.length; index += 5) controller.enqueue(bytes.slice(index, index + 5))
                controller.close()
            },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
    )
}

/**
 * Return a finished assistant text response.
 * @param text - Visible response text.
 * @returns A complete native SSE response.
 */
function completed(text: string): Response {
    return stream([{ delta: { content: text } }, { delta: {}, finish: 'stop' }])
}

/**
 * Return one native function call with every identity field fragmented.
 * @param name - Requested tool name.
 * @param args - JSON arguments for the selected safe tool.
 * @returns A complete provider tool request for the real core loop.
 */
function toolCall(name: string, args: Record<string, unknown>): Response {
    const argumentText = JSON.stringify(args)
    return stream([
        { delta: { reasoning_content: 'Use the selected capability.' } },
        {
            delta: {
                tool_calls: [
                    { index: 0, id: 'call-', type: 'function', function: { name: name.slice(0, 3), arguments: argumentText.slice(0, 7) } },
                ],
            },
        },
        { delta: { tool_calls: [{ index: 0, id: '1', function: { name: name.slice(3), arguments: argumentText.slice(7) } }] } },
        { delta: {}, finish: 'tool_calls' },
    ])
}

/**
 * Build a saved API-authorized agent snapshot.
 * @param toolIds - Explicit safe capabilities selected for this agent.
 * @param changes - Optional saved configuration overrides.
 * @returns A complete stable agent definition.
 */
function definition(toolIds: AgentToolId[] = [], changes: Partial<AgentDefinition> = {}): AgentDefinition {
    return {
        id: '891efdf9-e5b9-46f0-8ac5-d78db8b281b2',
        name: 'Custom helper',
        description: '',
        modelId: 'deepseek-reasoner',
        systemPrompt: 'Answer as my custom agent. Keep {{literal}} braces.',
        toolIds,
        openingMessages: ['Hello from your agent.'],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        ...changes,
    }
}

/**
 * Build a fresh runtime invocation with optional selected agent.
 * @param agent - Saved authorized agent snapshot.
 * @param changes - Additional per-request overrides.
 * @returns A complete invocation with isolated cancellation and conversation identity.
 */
function input(agent?: AgentDefinition, changes: Partial<ChatRunInput> = {}): ChatRunInput {
    return {
        scope: { userId: 'owner', workspaceId: 'workspace' },
        conversationId: 'conversation',
        history: [],
        content: 'Calculate (2 + 3) * 4.',
        signal: new AbortController().signal,
        onDelta: () => undefined,
        ...(agent ? { agent } : {}),
        ...changes,
    }
}

describe('user-created Cordis agents', () => {
    it('uses the chosen model and exact literal prompt while executing a native fragmented tool call through a second model request', async () => {
        const requests: RequestBody[] = []
        const runtime = await createChatRuntime({
            apiKey: 'server-key',
            model: 'deepseek-flash',
            systemPrompt: 'Deployment default.',
            fetch: async (_url, init) => {
                const request = JSON.parse(String(init!.body)) as RequestBody
                requests.push(request)
                return requests.length === 1 ? toolCall('calculator', { expression: '(2 + 3) * 4' }) : completed('The answer is 20.')
            },
        })
        try {
            const result = await runtime.run(input(definition(['calculator'])))
            expect(result).toMatchObject({ content: 'The answer is 20.', status: 'complete' })
            expect(requests).toHaveLength(2)
            for (const request of requests) {
                expect(request.model).toBe('deepseek-reasoner')
                expect(request.messages[0]).toEqual({ role: 'system', content: 'Answer as my custom agent. Keep {{literal}} braces.' })
                expect(request.tools?.map(tool => tool.function.name)).toEqual(['calculator'])
                expect(request.tools![0]!.function.parameters).toMatchObject({ required: ['expression'], additionalProperties: false })
            }
            const secondHistory = requests[1]!.messages
            expect(secondHistory.find(message => message.role === 'assistant')).toMatchObject({
                reasoning_content: 'Use the selected capability.',
                tool_calls: [{ id: 'call-1', function: { name: 'calculator', arguments: '{"expression":"(2 + 3) * 4"}' } }],
            })
            expect(secondHistory.find(message => message.role === 'tool')).toEqual({
                role: 'tool',
                tool_call_id: 'call-1',
                content: '{"expression":"(2 + 3) * 4","result":20}',
            })
        } finally {
            await runtime.dispose()
        }
    })

    it('inherits the deployment prompt for empty or whitespace-only agent prompts while keeping the selected tools and model', async () => {
        const requests: RequestBody[] = []
        const runtime = await createChatRuntime({
            apiKey: 'key',
            model: 'deepseek-flash',
            systemPrompt: 'Deployment default.',
            fetch: async (_url, init) => {
                requests.push(JSON.parse(String(init!.body)) as RequestBody)
                return completed('Default behavior.')
            },
        })
        try {
            for (const systemPrompt of ['', '  \n\t']) {
                const result = await runtime.run(input(definition(['calculator'], { systemPrompt })))
                expect(result.status).toBe('complete')
                const request = requests.at(-1)!
                expect(request.model).toBe('deepseek-reasoner')
                expect(request.messages[0]).toEqual({ role: 'system', content: 'Deployment default.' })
                expect(request.tools?.map(tool => tool.function.name)).toEqual(['calculator'])
            }
        } finally {
            await runtime.dispose()
        }
    })

    it('preserves leading assistant introductions as assistant context without synthetic user messages or turns', async () => {
        const requests: RequestBody[] = []
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async (_url, init) => {
                requests.push(JSON.parse(String(init!.body)) as RequestBody)
                return completed('Hello back.')
            },
        })
        const greeting: ChatMessage = {
            id: 'opening-message',
            role: 'assistant',
            content: 'Hello from your agent.',
            kind: 'opening',
            status: 'complete',
            createdAt: new Date(0).toISOString(),
        }
        try {
            expect((await runtime.run(input(definition(), { history: [greeting], content: 'Hi.' }))).status).toBe('complete')
            expect(requests[0]!.messages).toEqual([
                { role: 'system', content: 'Answer as my custom agent. Keep {{literal}} braces.' },
                { role: 'assistant', content: 'Hello from your agent.' },
                { role: 'user', content: 'Hi.' },
            ])
        } finally {
            await runtime.dispose()
        }
    })

    it('isolates tools and prompts between simultaneous agent scopes and a default conversation', async () => {
        const requests: RequestBody[] = []
        const allStarted = Promise.withResolvers<void>()
        let fetches = 0
        const runtime = await createChatRuntime({
            apiKey: 'key',
            systemPrompt: 'Deployment default.',
            fetch: async (_url, init) => {
                const request = JSON.parse(String(init!.body)) as RequestBody
                requests.push(request)
                fetches += 1
                if (fetches === 3) allStarted.resolve()
                await allStarted.promise
                return completed('ok')
            },
        })
        try {
            const results = await Promise.all([
                runtime.run(input(definition(['calculator'], { systemPrompt: 'Calculate only.' }), { conversationId: 'calculator' })),
                runtime.run(input(definition(['current-time'], { systemPrompt: 'Time only.' }), { conversationId: 'time' })),
                runtime.run(input(undefined, { conversationId: 'default' })),
            ])
            expect(results.every(result => result.status === 'complete')).toBe(true)
            const byPrompt = new Map(requests.map(request => [request.messages[0]!.content, request]))
            expect(byPrompt.get('Calculate only.')?.tools?.map(tool => tool.function.name)).toEqual(['calculator'])
            expect(byPrompt.get('Time only.')?.tools?.map(tool => tool.function.name)).toEqual(['current-time'])
            expect(byPrompt.get('Deployment default.')?.tools).toBeUndefined()
            await runtime.run(input(undefined, { conversationId: 'after-disposal' }))
            expect(requests.at(-1)?.tools).toBeUndefined()
        } finally {
            allStarted.resolve()
            await runtime.dispose()
        }
    })

    it('refuses a model-requested tool that was not enabled for the current agent', async () => {
        let fetches = 0
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async () => {
                fetches += 1
                return toolCall('current-time', {})
            },
        })
        try {
            await expect(runtime.run(input(definition(['calculator'])))).rejects.toMatchObject({ code: 'DEEPSEEK_REQUEST_FAILED' })
            expect(fetches).toBe(1)
        } finally {
            await runtime.dispose()
        }
    })

    it('bounds repeated model tool requests and releases the conversation reservation afterward', async () => {
        let fetches = 0
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async () => {
                fetches += 1
                return toolCall('calculator', { expression: '2 + 2' })
            },
        })
        try {
            await expect(runtime.run(input(definition(['calculator'])))).rejects.toMatchObject({ code: 'AGENT_STEP_LIMIT' })
            expect(fetches).toBe(8)
            await expect(runtime.run(input(definition(['calculator'])))).rejects.toMatchObject({ code: 'AGENT_STEP_LIMIT' })
            expect(fetches).toBe(16)
        } finally {
            await runtime.dispose()
        }
    })

    it('cancels a stalled request after a tool result and prevents another iteration', async () => {
        const controller = new AbortController()
        let fetches = 0
        let readerCancelled = false
        const secondRequest = Promise.withResolvers<void>()
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async () => {
                fetches += 1
                if (fetches === 1) return toolCall('calculator', { expression: '2 + 2' })
                secondRequest.resolve()
                return new Response(
                    new ReadableStream({
                        /**
                         * Observe cancellation of the stalled second provider response.
                         * @returns Nothing; records reader cleanup.
                         */
                        cancel() {
                            readerCancelled = true
                        },
                    }),
                    { headers: { 'content-type': 'text/event-stream' } }
                )
            },
        })
        try {
            const pending = runtime.run(input(definition(['calculator']), { signal: controller.signal }))
            await secondRequest.promise
            controller.abort()
            expect((await pending).status).toBe('cancelled')
            expect(readerCancelled).toBe(true)
            expect(fetches).toBe(2)
        } finally {
            await runtime.dispose()
        }
    })

    it('rejects arbitrary code, excessive nesting, invalid arithmetic, and unsupported timezones as safe tool errors', async () => {
        for (const [tool, args] of [
            ['calculator', { expression: 'process.exit()' }],
            ['calculator', { expression: '('.repeat(34) + '1' + ')'.repeat(34) }],
            ['calculator', { expression: '1 / 0' }],
            ['calculator', { expression: '1 +' }],
            ['current-time', { timezone: 'Invalid/Timezone' }],
        ] as const) {
            const requests: RequestBody[] = []
            const runtime = await createChatRuntime({
                apiKey: 'key',
                fetch: async (_url, init) => {
                    requests.push(JSON.parse(String(init!.body)) as RequestBody)
                    return requests.length === 1 ? toolCall(tool, args) : completed('Please use valid input.')
                },
            })
            try {
                expect((await runtime.run(input(definition([tool])))).status).toBe('complete')
                const result = requests[1]!.messages.find(message => message.role === 'tool')!
                expect(result.content).toContain('Error')
                expect(result.tool_call_id).toBe('call-1')
            } finally {
                await runtime.dispose()
            }
        }
    })

    it('reads current UTC and validated IANA local time through the actual tool runtime', async () => {
        const requests: RequestBody[] = []
        const before = Date.now()
        const runtime = await createChatRuntime({
            apiKey: 'key',
            fetch: async (_url, init) => {
                requests.push(JSON.parse(String(init!.body)) as RequestBody)
                return requests.length === 1 ? toolCall('current-time', { timezone: 'Asia/Shanghai' }) : completed('Time checked.')
            },
        })
        try {
            expect((await runtime.run(input(definition(['current-time'])))).status).toBe('complete')
            const result = JSON.parse(requests[1]!.messages.find(message => message.role === 'tool')!.content)
            expect(Date.parse(result.iso)).toBeGreaterThanOrEqual(before)
            expect(Date.parse(result.iso)).toBeLessThanOrEqual(Date.now())
            expect(result.timezone).toBe('Asia/Shanghai')
            expect(result.localTime).toContain(String(new Date(before).getUTCFullYear()))
        } finally {
            await runtime.dispose()
        }
    })
})
