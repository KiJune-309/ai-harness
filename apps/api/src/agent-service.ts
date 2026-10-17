import { randomUUID } from 'node:crypto'
import { agentCatalogSchema, agentInputSchema, type AgentCatalog, type AgentDefinition, type AgentInput } from '@ai-harness/contracts'
import type { AgentStore, ChatScope } from '@ai-harness/db'
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'

/** Coordinates scoped agent definitions and validates executable server capabilities. */
export class AgentService {
    private readonly catalogDefinition: AgentCatalog

    /**
     * Retain initialized agent persistence and a credential-free capability catalog.
     * @param store - Agent persistence owned by the application's shared chat store.
     * @param catalog - Public models and tools supported by the initialized runtime.
     * @throws Error when the server capability catalog is malformed.
     */
    constructor(
        private readonly store: AgentStore | undefined,
        catalog: AgentCatalog
    ) {
        this.catalogDefinition = agentCatalogSchema.parse(catalog)
    }

    /**
     * Return a detached public capability catalog without private provider settings.
     * @returns Available model and tool descriptors and the default model identifier.
     */
    catalog(): AgentCatalog {
        return structuredClone(this.catalogDefinition)
    }

    /**
     * List definitions owned by the authenticated user and workspace.
     * @param scope - Trusted ownership context established by the API guard.
     * @returns The caller's agent definitions sorted by recent update.
     * @throws ServiceUnavailableException when agent persistence is unavailable.
     */
    list(scope: ChatScope): Promise<AgentDefinition[]> {
        return this.agentStore().list(scope)
    }

    /**
     * Read an agent through its authenticated ownership scope.
     * @param scope - Trusted user and workspace context.
     * @param id - Agent identifier.
     * @returns The caller-owned agent definition.
     * @throws NotFoundException when the agent is absent or owned by another scope.
     * @throws ServiceUnavailableException when agent persistence is unavailable.
     */
    async get(scope: ChatScope, id: string): Promise<AgentDefinition> {
        const agent = await this.agentStore().get(scope, id)
        if (!agent) throw new NotFoundException('未找到这个 Agent。')
        return agent
    }

    /**
     * Create a validated agent using only recognized models and registered tools.
     * @param scope - Trusted user and workspace context.
     * @param input - Candidate public configuration without credentials or ownership fields.
     * @returns The newly persisted definition with server-assigned identity and timestamps.
     * @throws BadRequestException for malformed or unsupported configuration.
     * @throws ServiceUnavailableException when agent persistence is unavailable.
     */
    async create(scope: ChatScope, input: AgentInput): Promise<AgentDefinition> {
        const configuration = this.validate(input)
        const now = new Date().toISOString()
        const agent: AgentDefinition = { ...configuration, id: randomUUID(), createdAt: now, updatedAt: now }
        await this.agentStore().save(scope, agent)
        return agent
    }

    /**
     * Replace one owned agent's configuration while preserving its identity and creation time.
     * @param scope - Trusted user and workspace context.
     * @param id - Existing agent identifier.
     * @param input - Replacement public configuration.
     * @returns The persisted agent with a refreshed update timestamp.
     * @throws BadRequestException for malformed or unsupported configuration.
     * @throws NotFoundException when the agent is absent or belongs to another scope.
     * @throws ServiceUnavailableException when agent persistence is unavailable.
     */
    async update(scope: ChatScope, id: string, input: AgentInput): Promise<AgentDefinition> {
        const previous = await this.get(scope, id)
        const configuration = this.validate(input)
        const agent: AgentDefinition = {
            ...configuration,
            id: previous.id,
            createdAt: previous.createdAt,
            updatedAt: new Date().toISOString(),
        }
        await this.agentStore().save(scope, agent)
        return agent
    }

    /**
     * Validate public configuration against the immutable server capability catalog.
     * @param input - Untrusted candidate agent configuration.
     * @returns A validated and detached agent configuration.
     * @throws BadRequestException when fields, model, or tools cannot be accepted.
     */
    private validate(input: AgentInput): AgentInput {
        const parsed = agentInputSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('Agent 配置格式不正确，请检查名称、模型和开场消息。')
        const model = this.catalogDefinition.models.find(candidate => candidate.id === parsed.data.modelId)
        if (!model) throw new BadRequestException('所选模型不受支持。')
        const tools = new Set(this.catalogDefinition.tools.map(tool => tool.id))
        if (parsed.data.toolIds.some(id => !tools.has(id))) throw new BadRequestException('所选工具不受支持。')
        return parsed.data
    }

    /**
     * Require initialized shared agent persistence before performing a scoped operation.
     * @returns The initialized agent store.
     * @throws ServiceUnavailableException when persistence is unavailable.
     */
    private agentStore(): AgentStore {
        if (!this.store) throw new ServiceUnavailableException('Agent 存储暂时不可用，请稍后重试。')
        return this.store
    }
}
