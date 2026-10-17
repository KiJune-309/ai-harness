import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentCatalog, AgentDefinition, AgentInput } from '@ai-harness/contracts'
import { createAgent, getAgent, getAgentCatalog, listAgents, updateAgent } from '../../lib/agent-client'

const agentId = '64e34de2-6999-4986-8a6c-0f4cc56b4e8a'
const input: AgentInput = {
    name: '研究助手',
    description: '帮助整理问题与依据',
    modelId: 'deepseek-chat',
    systemPrompt: '先给出结论，再说明依据。',
    toolIds: ['calculator'],
    openingMessages: ['你好，今天想研究什么？', '也可以先告诉我你的目标。'],
}
const agent: AgentDefinition = { ...input, id: agentId, createdAt: '2026-10-17T03:00:00.000Z', updatedAt: '2026-10-17T03:00:00.000Z' }
const catalog: AgentCatalog = {
    defaultModelId: 'deepseek-chat',
    models: [{ id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', available: true }],
    tools: [{ id: 'calculator', label: '计算器', description: '计算数学表达式。' }],
}

afterEach(() => vi.unstubAllGlobals())

describe('agent API client', () => {
    it('loads the capability catalog without caching credentials or configuration', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(catalog))
        vi.stubGlobal('fetch', fetchMock)
        const signal = new AbortController().signal

        await expect(getAgentCatalog(signal)).resolves.toEqual(catalog)
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/chat/agents/catalog', {
            cache: 'no-store',
            signal: expect.any(AbortSignal),
        })
    })

    it('rejects unknown runtime tool identifiers from the catalog', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(Response.json({ ...catalog, tools: [{ id: 'shell', label: 'Shell', description: '' }] }))
        )

        await expect(getAgentCatalog()).rejects.toThrow('无效的数据')
    })

    it('validates every saved agent before returning its list', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ agents: [agent] }))
            .mockResolvedValueOnce(Response.json({ agents: [{ ...agent, toolIds: ['shell'] }] }))
        vi.stubGlobal('fetch', fetchMock)

        await expect(listAgents()).resolves.toEqual([agent])
        await expect(listAgents()).rejects.toThrow('无效的数据')
    })

    it('rejects a response without the saved agent collection', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items: [] })))

        await expect(listAgents()).rejects.toThrow('无效的列表')
    })

    it('creates an agent using trimmed input and preserves ordered greetings and tool selections', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(agent))
        vi.stubGlobal('fetch', fetchMock)

        await expect(
            createAgent({ ...input, name: ' 研究助手 ', openingMessages: [' 你好，今天想研究什么？ ', input.openingMessages[1]] })
        ).resolves.toEqual(agent)
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/chat/agents', {
            cache: 'no-store',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: expect.any(AbortSignal),
        })
    })

    it('rejects an empty name, duplicate tools, and empty or excessive greetings before sending a request', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await expect(createAgent({ ...input, name: ' ' })).rejects.toThrow()
        await expect(createAgent({ ...input, toolIds: ['calculator', 'calculator'] })).rejects.toThrow()
        await expect(createAgent({ ...input, openingMessages: [' '] })).rejects.toThrow()
        await expect(createAgent({ ...input, openingMessages: Array.from({ length: 6 }, () => '你好') })).rejects.toThrow()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('saves edits by PUT with the complete current definition and cancellation signal', async () => {
        const revised: AgentInput = { ...input, toolIds: [], openingMessages: [], systemPrompt: '' }
        const saved = { ...agent, ...revised, updatedAt: '2026-10-17T04:00:00.000Z' }
        const fetchMock = vi.fn().mockResolvedValue(Response.json(saved))
        vi.stubGlobal('fetch', fetchMock)
        const signal = new AbortController().signal

        await expect(updateAgent(agentId, revised, signal)).resolves.toEqual(saved)
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/chat/agents/${agentId}`, {
            cache: 'no-store',
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(revised),
            signal: expect.any(AbortSignal),
        })
    })

    it('encodes identifiers as a single URL segment', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(agent))
        vi.stubGlobal('fetch', fetchMock)

        await expect(getAgent('untrusted/path?query')).resolves.toEqual(agent)
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/chat/agents/untrusted%2Fpath%3Fquery', {
            cache: 'no-store',
            signal: expect.any(AbortSignal),
        })
    })

    it('preserves server authorization and validation messages for the editor', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: '找不到这个 Agent。' }, { status: 404 })))

        await expect(getAgent(agentId)).rejects.toThrow('找不到这个 Agent。')
    })

    it('returns readable fallback errors for non-JSON proxy failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>unavailable</html>', { status: 502 })))

        await expect(getAgentCatalog()).rejects.toThrow('Agent 服务请求失败（502）')
    })

    it('rejects malformed saved responses instead of treating the draft as persisted', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...input, id: 'invalid' })))

        await expect(createAgent(input)).rejects.toThrow('无效的数据')
    })

    it('forwards caller cancellation through the combined deadline signal', async () => {
        const failure = new DOMException('The request was aborted', 'AbortError')
        const caller = new AbortController()
        const fetchMock = vi.fn(
            (_url: string, options: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
                })
        )
        vi.stubGlobal('fetch', fetchMock)

        const pending = getAgentCatalog(caller.signal)
        const rejected = expect(pending).rejects.toBe(failure)
        const forwarded = fetchMock.mock.calls[0][1].signal
        expect(forwarded).not.toBe(caller.signal)
        expect(forwarded?.aborted).toBe(false)
        caller.abort(failure)

        await rejected
        expect(forwarded?.aborted).toBe(true)
    })

    it('localizes agent-list network failures without exposing raw transport diagnostics', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('private agent transport diagnostics')))

        await expect(listAgents()).rejects.toThrow('暂时无法连接服务，请检查网络后重试。')
        await expect(listAgents()).rejects.not.toThrow('private agent transport diagnostics')
    })
})
