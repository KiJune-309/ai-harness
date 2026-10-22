import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AgentDefinition, CollaborationCommand, CollaborationDispatch } from '@ai-harness/contracts'
import type { ChatScope, ChatStore, CollaborationLease, CollaborationStore } from '@ai-harness/db'
import type { AccountService } from '../src/account-service.js'
import { createAgentCatalog } from '../src/agent-catalog.js'
import { AgentService } from '../src/agent-service.js'
import { CollaborationService } from '../src/collaboration-service.js'
import type { ApiConfig } from '../src/config.js'

/**
 * Creates a scoped coordinator with explicit test-only account and repository fakes.
 * @param settings - Trusted system model settings overridden for this test.
 * @returns Real model routing and activation code with observable scoped persistence calls.
 */
function serviceFixture(settings: Partial<ApiConfig> = {}) {
    const scope: ChatScope = { userId: randomUUID(), workspaceId: 'default-model-workspace' }
    const config = {
        apiKey: 'system-private-key',
        model: 'deepseek-flash',
        systemPrompt: 'Trusted server prompt.',
        ...settings,
    } as ApiConfig
    const personalId = randomUUID()
    const personal = {
        public: { modelId: `account:${personalId}`, baseUrl: 'https://private-model.example/v1', model: 'private-model' },
        apiKey: 'owner-private-key',
    }
    const getModel = vi.fn(async () => personal as typeof personal | undefined)
    const defaultModel = vi.fn(async () => undefined as { modelId: string } | undefined)
    const accounts = { getModel, defaultModel } as unknown as AccountService
    const nodeId = randomUUID()
    const mutate = vi.fn<CollaborationStore['mutate']>(async (_scope: ChatScope, command: CollaborationCommand) => ({
        requestId: command.requestId,
        nodeId,
    }))
    const propose = vi.fn<CollaborationStore['propose']>(async (_scope, command) => ({
        requestId: command.requestId,
        draftId: randomUUID(),
        draftVersion: 1,
        dispatchStatus: 'pending',
    }))
    const dispatch = vi.fn<CollaborationStore['dispatch']>(async () => undefined)
    const persistence = {
        action: vi.fn(async () => undefined),
        node: vi.fn(async () => ({ node: { id: nodeId, ownerId: scope.userId, title: 'Owned task', goal: 'Resolve the report.' } })),
        mutate,
        propose,
        dispatch,
    } as unknown as CollaborationStore
    const agents = new AgentService(undefined, createAgentCatalog(config, Boolean(config.apiKey)), accounts)
    const service = new CollaborationService({ collaboration: persistence } as ChatStore, accounts, agents, config)
    return { service, scope, config, agents, getModel, defaultModel, personal, personalId, nodeId, mutate, propose, dispatch, persistence }
}

/**
 * Produces a frozen owner Agent snapshot containing only a public model route.
 * @param modelId - Non-secret route selected by the owner.
 * @returns An executable snapshot with no provider credentials.
 */
function agent(modelId: string): AgentDefinition {
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        name: 'Owner Agent',
        description: '',
        modelId,
        systemPrompt: 'Owner instructions.',
        toolIds: [],
        openingMessages: [],
        createdAt: now,
        updatedAt: now,
    }
}

describe('Collaboration system default model routing', () => {
    it('uses the private runtime default for sources without an Agent or with an authorized system route', async () => {
        const fixture = serviceFixture()
        await expect(fixture.service.connection(fixture.scope)).resolves.toBeUndefined()
        await expect(fixture.service.connection(fixture.scope, agent('deepseek-flash'))).resolves.toBeUndefined()
        await expect(fixture.service.connection(fixture.scope, agent('deepseek-v4-pro'))).resolves.toBeUndefined()
        expect(fixture.getModel).not.toHaveBeenCalled()
    })

    it('accepts only the server catalog and refuses arbitrary model identifiers', async () => {
        const fixture = serviceFixture({ model: 'server-default', agentModels: ['approved-alternative'] })
        await expect(fixture.service.connection(fixture.scope, agent('approved-alternative'))).resolves.toBeUndefined()
        await expect(fixture.service.connection(fixture.scope, agent('arbitrary-model'))).rejects.toThrow('不受系统支持')
        await expect(fixture.service.connection(fixture.scope, agent('deepseek-v4-pro'))).rejects.toThrow('不受系统支持')
        expect(fixture.getModel).not.toHaveBeenCalled()
    })

    it('keeps explicit personal routes scoped to their owner and never silently substitutes a system credential', async () => {
        const fixture = serviceFixture()
        await expect(fixture.service.connection(fixture.scope, agent(`account:${fixture.personalId}`))).resolves.toEqual({
            apiKey: 'owner-private-key',
            baseUrl: 'https://private-model.example/v1',
            model: 'private-model',
        })
        expect(fixture.getModel).toHaveBeenCalledWith(fixture.scope, fixture.personalId)
        fixture.getModel.mockResolvedValueOnce(undefined)
        await expect(fixture.service.connection(fixture.scope, agent(`account:${randomUUID()}`))).rejects.toThrow('个人模型连接已删除')
    })

    it('reports an unavailable deployment model without exposing credentials or asking the user to configure one', async () => {
        const fixture = serviceFixture({ apiKey: '' })
        await expect(fixture.service.connection(fixture.scope)).rejects.toThrow('系统默认模型暂不可用')
        await expect(fixture.service.connection(fixture.scope)).rejects.not.toThrow('账户设置')
        expect(fixture.getModel).not.toHaveBeenCalled()
    })

    it('opens a legacy receiver dialogue with the system model without resolving credentials or starting execution', async () => {
        const fixture = serviceFixture()
        expect(fixture.mutate).not.toHaveBeenCalled()
        await fixture.service.command(fixture.scope, { type: 'activate', requestId: randomUUID(), nodeId: fixture.nodeId, revision: 1 })
        const options = fixture.mutate.mock.calls[0]?.[2] as unknown as {
            agent: AgentDefinition
            recipientConversation: { agent: AgentDefinition; messages: unknown[] }
            openingOnly: boolean
        }
        expect(options.agent.modelId).toBe('deepseek-flash')
        expect(options.agent.description).toBe('系统默认模型')
        expect(options.recipientConversation.agent).toEqual(options.agent)
        expect(options.recipientConversation.messages).toEqual([])
        expect(options.openingOnly).toBe(true)
        expect(fixture.defaultModel).toHaveBeenCalledWith(fixture.scope)
        expect(fixture.getModel).not.toHaveBeenCalled()
        expect(JSON.stringify(options)).not.toMatch(/system-private-key|owner-private-key/)
    })

    it('keeps a receiver personal default when explicitly configured', async () => {
        const fixture = serviceFixture()
        fixture.defaultModel.mockResolvedValueOnce({ modelId: `account:${fixture.personalId}` })
        await fixture.service.command(fixture.scope, { type: 'activate', requestId: randomUUID(), nodeId: fixture.nodeId, revision: 1 })
        const options = fixture.mutate.mock.calls[0]?.[2] as unknown as { agent: AgentDefinition }
        expect(options.agent.modelId).toBe(`account:${fixture.personalId}`)
        expect(fixture.getModel).not.toHaveBeenCalled()
    })

    it('prepares the real receiver private dialogue for a handoff without borrowing the sender model', async () => {
        const fixture = serviceFixture()
        const recipientId = randomUUID()
        const requestId = randomUUID()
        await fixture.service.command(fixture.scope, {
            type: 'delegate',
            requestId,
            recipientId,
            source: { kind: 'conversation', id: randomUUID() },
            title: '请评估这个问题',
            goal: '检查上游提供的报错',
            context: '上游尚未提供日志',
        })
        const options = fixture.mutate.mock.calls[0]?.[2]
        expect(options?.recipientConversation?.agent.modelId).toBe('deepseek-flash')
        expect(options?.recipientConversation?.messages).toEqual([])
        expect(options?.recipientConversation?.task).toBeUndefined()
        expect(fixture.defaultModel).toHaveBeenCalledWith({ ...fixture.scope, userId: recipientId })
        expect(fixture.getModel).not.toHaveBeenCalled()
        expect(JSON.stringify(options)).not.toMatch(/system-private-key|owner-private-key/)
    })

    it('stages Agent content without preparing or executing a receiver dialogue until the human confirms the saved version', async () => {
        const fixture = serviceFixture()
        const command = {
            type: 'delegate' as const,
            requestId: randomUUID(),
            recipientId: randomUUID(),
            source: { kind: 'conversation' as const, id: randomUUID() },
            title: '请定位白屏',
            goal: '点击侧边按钮后白屏，期望打开对应页面',
            context: '项目 ai-harness，index 文件',
        }
        const lease = { id: randomUUID(), token: randomUUID(), scope: fixture.scope, source: command.source } as CollaborationLease
        const result = await fixture.service.command(fixture.scope, command, { authorKind: 'agent', lease })
        expect(result.dispatchStatus).toBe('pending')
        expect(fixture.propose).toHaveBeenCalledWith(fixture.scope, command, { authorKind: 'agent', lease })
        expect(fixture.mutate).not.toHaveBeenCalled()
        expect(fixture.defaultModel).not.toHaveBeenCalled()
        expect(fixture.getModel).not.toHaveBeenCalled()
        fixture.dispatch.mockResolvedValueOnce({
            proposal: { id: result.draftId, version: 1, status: 'pending' } as CollaborationDispatch,
            command,
        })
        const confirmation = { type: 'confirm-dispatch', requestId: randomUUID(), draftId: result.draftId, version: 1 }
        await fixture.service.command(fixture.scope, confirmation)
        expect(fixture.mutate).toHaveBeenCalledWith(fixture.scope, confirmation, {
            recipientConversation: expect.objectContaining({
                title: command.title,
                messages: [],
            }),
        })
        expect(fixture.defaultModel).toHaveBeenCalledWith({ ...fixture.scope, userId: command.recipientId })
        expect(fixture.getModel).not.toHaveBeenCalled()
    })

    it('rejects model confirmation and confirmation bodies and lets cancellation commit without preparing any receiver', async () => {
        const fixture = serviceFixture()
        const command = { type: 'confirm-dispatch', requestId: randomUUID(), draftId: randomUUID(), version: 1 }
        await expect(fixture.service.command(fixture.scope, command, { authorKind: 'agent' })).rejects.toThrow('必须由本人操作')
        await expect(fixture.service.command(fixture.scope, { ...command, content: 'hidden replacement' })).rejects.toThrow('格式不正确')
        expect(fixture.mutate).not.toHaveBeenCalled()
        await fixture.service.command(fixture.scope, { ...command, type: 'cancel-dispatch' })
        expect(fixture.dispatch).not.toHaveBeenCalled()
        expect(fixture.defaultModel).not.toHaveBeenCalled()
        expect(fixture.mutate).toHaveBeenCalledOnce()
    })

    it('only stages an Agent-authored exact answer and leaves approval and receiver model execution to human review', async () => {
        const fixture = serviceFixture()
        const command = {
            type: 'answer',
            requestId: randomUUID(),
            questionId: randomUUID(),
            version: 2,
            content: '请将这段事实回复给发件人。',
            decision: 'information',
        }
        const result = await fixture.service.command(fixture.scope, command, {
            authorKind: 'agent',
            lease: {
                id: randomUUID(),
                token: randomUUID(),
                scope: fixture.scope,
                source: { kind: 'conversation', id: randomUUID() },
            } as CollaborationLease,
        })
        expect(result.dispatchStatus).toBe('pending')
        expect(fixture.propose).toHaveBeenCalledWith(fixture.scope, command, expect.objectContaining({ authorKind: 'agent' }))
        expect(fixture.mutate).not.toHaveBeenCalled()
        expect(fixture.defaultModel).not.toHaveBeenCalled()
        expect(fixture.getModel).not.toHaveBeenCalled()
    })

    it('rejects Agent publishing instead of letting private work bypass the reviewed sending path', async () => {
        const fixture = serviceFixture()
        const command = {
            type: 'publish',
            requestId: randomUUID(),
            nodeId: fixture.nodeId,
            revision: 1,
            title: 'Private analysis',
            content: 'This work has not been reviewed for sharing.',
        }
        await expect(fixture.service.command(fixture.scope, command, { authorKind: 'agent' })).rejects.toThrow('本人明确提交')
        expect(fixture.propose).not.toHaveBeenCalled()
        expect(fixture.mutate).not.toHaveBeenCalled()
        await fixture.service.command(fixture.scope, command)
        expect(fixture.mutate).toHaveBeenCalledWith(fixture.scope, command, {})
        expect(fixture.defaultModel).not.toHaveBeenCalled()
        expect(fixture.getModel).not.toHaveBeenCalled()
    })

    it('rejects a foreign receiver activation before looking up or running any model', async () => {
        const fixture = serviceFixture()
        await expect(
            fixture.service.command(
                { ...fixture.scope, userId: randomUUID() },
                { type: 'activate', requestId: randomUUID(), nodeId: fixture.nodeId, revision: 1 }
            )
        ).rejects.toThrow('未找到本人负责的任务')
        expect(fixture.defaultModel).not.toHaveBeenCalled()
        expect(fixture.getModel).not.toHaveBeenCalled()
        expect(fixture.mutate).not.toHaveBeenCalled()
    })

    it('lets an owner repair a failed node by explicitly choosing the system default without a personal connection', async () => {
        const fixture = serviceFixture()
        await fixture.service.command(fixture.scope, {
            type: 'retry',
            requestId: randomUUID(),
            nodeId: fixture.nodeId,
            revision: 1,
            useDefaultModel: true,
        })
        const options = fixture.mutate.mock.calls[0]?.[2] as unknown as { agent: AgentDefinition }
        expect(options.agent.modelId).toBe('deepseek-flash')
        expect(fixture.getModel).not.toHaveBeenCalled()
    })
})
