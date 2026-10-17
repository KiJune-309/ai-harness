import { randomUUID } from 'node:crypto'
import type { ChatRuntime } from '@ai-harness/chat-runtime'
import type { AgentInput, ChatStreamEvent } from '@ai-harness/contracts'
import { createChatStore } from '@ai-harness/db'
import { describe, expect, it, vi } from 'vitest'
import { createAgentCatalog } from '../src/agent-catalog.js'
import { AgentService } from '../src/agent-service.js'
import { ChatService } from '../src/chat-service.js'
import { readApiConfig } from '../src/config.js'

const scope = { userId: randomUUID(), workspaceId: 'personal' }
const config = readApiConfig({ HARNESS_API_TOKEN: 'chat-agent-test-server-token-long-enough', CHAT_STORE: 'memory' })
const input: AgentInput = {
    name: '数字助手',
    description: '精确回答数学问题',
    modelId: 'deepseek-v4-pro',
    systemPrompt: '先核对计算，再用中文简短回答。',
    toolIds: ['calculator'],
    openingMessages: ['你好，我是你的数字助手。', '告诉我需要计算的表达式。'],
}

/**
 * Submit one user turn while collecting its public terminal event.
 * @param chat - Initialized chat service.
 * @param id - Owned conversation identifier.
 * @param content - Current user prompt.
 * @returns Ordered public stream events.
 */
async function send(chat: ChatService, id: string, content: string): Promise<ChatStreamEvent[]> {
    const events: ChatStreamEvent[] = []
    await chat.send(scope, id, { content, requestId: randomUUID() }, new AbortController().signal, event => events.push(event))
    return events
}

describe('saved Agent conversation configuration', () => {
    it('persists ordered greetings once and executes the authorized frozen model, prompt, and tool snapshot', async () => {
        const store = await createChatStore({ allowMemory: true })
        const agents = new AgentService(store.agents, createAgentCatalog(config, true))
        const runtime = {
            run: vi.fn<ChatRuntime['run']>(async () => ({ content: '42', reasoning: '', status: 'complete' })),
            dispose: vi.fn(async () => undefined),
        }
        const chat = new ChatService(store, runtime, config, agents)
        try {
            const definition = await agents.create(scope, input)
            const conversation = await chat.create(scope, undefined, definition.id)
            expect(conversation.agent).toEqual(definition)
            expect(conversation.messages.map(message => [message.role, message.kind, message.content])).toEqual(
                input.openingMessages.map(text => ['assistant', 'opening', text])
            )
            await agents.update(scope, definition.id, { ...input, modelId: 'deepseek-flash', systemPrompt: '新的提示词', toolIds: [] })
            expect((await send(chat, conversation.id, '6*7')).at(-1)?.type).toBe('done')
            const first = runtime.run.mock.calls[0]![0]
            expect(first.agent).toEqual(definition)
            expect(first.history.map(message => message.content)).toEqual(input.openingMessages)
            await send(chat, conversation.id, '再解释一次')
            const saved = await chat.get(scope, conversation.id)
            expect(saved.messages.filter(message => message.kind === 'opening')).toHaveLength(2)
            expect(saved.messages).toHaveLength(6)
            const fresh = await chat.create(scope, undefined, definition.id)
            expect(fresh.agent?.systemPrompt).toBe('新的提示词')
            expect(fresh.agent?.toolIds).toEqual([])
        } finally {
            await chat.close()
        }
    })

    it('refuses a foreign Agent before creating a conversation or revealing its configuration', async () => {
        const store = await createChatStore({ allowMemory: true })
        const agents = new AgentService(store.agents, createAgentCatalog(config, true))
        const chat = new ChatService(store, undefined, config, agents)
        try {
            const privateAgent = await agents.create({ ...scope, userId: randomUUID() }, input)
            await expect(chat.create(scope, undefined, privateAgent.id)).rejects.toMatchObject({ status: 404 })
            expect(await chat.list(scope)).toEqual([])
        } finally {
            await chat.close()
        }
    })
})
