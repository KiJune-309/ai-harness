import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it } from 'vitest'
import { registerProjectKnowledge } from '../src/project-knowledge.ts'
import { createChatRuntime } from '../src/index.ts'

it('registers only project read tools and drives a real Cordis tool round trip', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: 'Fixture.' })
    await ctx.plugin(ToolRuntime)
    try {
        expect(() =>
            registerProjectKnowledge(ctx, { search: async () => ({ matches: [] }), read: async () => ({ chunks: [] }) })
        ).not.toThrow()
    } finally {
        await ctx.fiber.dispose()
    }
    let calls = 0
    const runtime = await createChatRuntime({
        apiKey: 'private-test-key',
        fetch: async (_url, init) => {
            calls++
            const body = JSON.parse(String(init!.body))
            expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain('project-knowledge-search')
            const delta =
                calls === 1
                    ? {
                          tool_calls: [
                              {
                                  index: 0,
                                  id: 'search-test',
                                  type: 'function',
                                  function: { name: 'project-knowledge-search', arguments: '{"query":"事实"}' },
                              },
                          ],
                      }
                    : { content: body.messages.findLast((message: { role: string }) => message.role === 'tool').content }
            return new Response(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'content-type': 'text/event-stream' } }
            )
        },
    })
    try {
        const result = await runtime.run({
            scope: { workspaceId: 'workspace', userId: 'user' },
            conversationId: 'fixture',
            content: '查阅资料',
            agent: {
                id: '123e4567-e89b-42d3-a456-426614174000',
                name: '默认助手',
                description: '',
                modelId: 'deepseek-flash',
                systemPrompt: '回答用户问题。',
                toolIds: [],
                openingMessages: [],
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            },
            history: [],
            signal: new AbortController().signal,
            onDelta() {},
            projectKnowledge: { search: async () => ({ matches: [{ content: '项目事实742' }] }), read: async () => ({ chunks: [] }) },
        })
        expect(result.content).toContain('项目事实742')
        expect(calls).toBe(2)
    } finally {
        await runtime.dispose()
    }
})

it('rejects model-supplied project authority before invoking the fixed read port', async () => {
    let requests = 0
    let searches = 0
    const runtime = await createChatRuntime({
        apiKey: 'private-test-key',
        fetch: async () => {
            requests++
            const delta =
                requests === 1
                    ? {
                          tool_calls: [
                              {
                                  index: 0,
                                  id: 'invalid-scope',
                                  type: 'function',
                                  function: {
                                      name: 'project-knowledge-search',
                                      arguments: JSON.stringify({ query: '资料', projectFolderId: 'other-project', userId: 'other-user' }),
                                  },
                              },
                          ],
                      }
                    : { content: '工具拒绝了越界参数。' }
            return new Response(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: requests === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'content-type': 'text/event-stream' } }
            )
        },
    })
    try {
        const result = await runtime.run({
            scope: { workspaceId: 'workspace', userId: 'owner' },
            conversationId: 'private-conversation',
            content: '查阅资料',
            history: [],
            signal: new AbortController().signal,
            onDelta() {},
            projectKnowledge: {
                search: async () => {
                    searches++
                    return { matches: [] }
                },
                read: async () => ({ chunks: [] }),
            },
        })
        expect(result.status).toBe('complete')
        expect(searches).toBe(0)
        expect(result.content).toContain('拒绝')
    } finally {
        await runtime.dispose()
    }
})
