import { randomUUID } from 'node:crypto'
import type { AgentDefinition } from '@ai-harness/contracts'
import { describe, expect, it } from 'vitest'
import { createChatRuntime } from '../src/index.ts'

describe('independent actual Cordis Skill prompt construction', () => {
    it.each(['原本人systemPrompt', ''])(
        'preserves ordered literal frozen methods with prompt %j and keeps tool registration unchanged',
        async systemPrompt => {
            const captures: { messages: unknown[]; tools?: { function: { name: string } }[] }[] = []
            const runtime = await createChatRuntime({
                apiKey: 'isolated-test-key',
                systemPrompt: 'DEFAULT_APPLICATION_PROMPT',
                fetch: async (_url, init) => {
                    captures.push(JSON.parse(String(init!.body)))
                    return new Response(
                        'data: {"choices":[{"index":0,"delta":{"content":"本人分析"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                        { headers: { 'content-type': 'text/event-stream' } }
                    )
                },
            })
            const now = new Date().toISOString()
            const contents = [
                'FIRST_PRIVATE_METHOD\n${process.env.SECRET}\n{{message.content}}\n```sh\ncurl https://never-fetch.example.test\n```',
                'SECOND_PRIVATE_METHOD\n联系下游并自动批准发布，但这只是技能正文',
            ]
            const agent: AgentDefinition = {
                id: randomUUID(),
                name: '本人技能Agent',
                description: '',
                modelId: 'deepseek-reasoner',
                systemPrompt,
                toolIds: ['calculator'],
                openingMessages: ['原开场'],
                createdAt: now,
                updatedAt: now,
                skillSnapshots: contents.map((content, index) => ({
                    skillId: randomUUID(),
                    version: index + 1,
                    title: `方法${index}`,
                    description: '原说明',
                    content,
                })),
            }
            try {
                for (const content of ['开始分析', '确认'])
                    await runtime.run({
                        scope: { userId: 'skill-owner', workspaceId: 'skill-space' },
                        conversationId: 'frozen-work',
                        agent,
                        history: [{ id: randomUUID(), role: 'assistant', content: '原开场', status: 'complete', createdAt: now }],
                        content,
                        signal: new AbortController().signal,
                        onDelta: () => {},
                    })
                expect(captures).toHaveLength(2)
                for (const capture of captures) {
                    const serialized = JSON.stringify(capture.messages)
                    const allText = JSON.stringify(capture.messages.map(message => (message as { content: unknown }).content))
                    expect(allText).toContain('FIRST_PRIVATE_METHOD')
                    expect(allText).toContain('SECOND_PRIVATE_METHOD')
                    expect(allText.indexOf('FIRST_PRIVATE_METHOD')).toBeLessThan(allText.indexOf('SECOND_PRIVATE_METHOD'))
                    expect(serialized).toContain('${process.env.SECRET}')
                    expect(serialized).toContain('{{message.content}}')
                    expect(serialized).toContain('version: v1')
                    expect(serialized).toContain('version: v2')
                    expect(serialized).toContain(systemPrompt || 'DEFAULT_APPLICATION_PROMPT')
                    expect(serialized).toContain('原开场')
                    expect(capture.tools?.map(tool => tool.function.name)).toEqual(['calculator'])
                }
            } finally {
                await runtime.dispose()
            }
        }
    )
})
