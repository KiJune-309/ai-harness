import { randomUUID } from 'node:crypto'
import {
    agentCatalogSchema,
    agentInputSchema,
    type AgentCatalog,
    type AgentDefinition,
    type AgentInput,
    type SkillRef,
    type SkillSnapshot,
} from '@ai-harness/contracts'
import type { AgentStore, ChatScope, SkillStore } from '@ai-harness/db'
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { AccountService } from './account-service.js'
import { skillFailure } from './skill-service.js'

/** Coordinates scoped agent definitions and validates executable server capabilities. */
export class AgentService {
    private readonly catalogDefinition: AgentCatalog

    /**
     * Retain initialized agent persistence and a credential-free capability catalog.
     * @param store - Agent persistence owned by the application's shared chat store.
     * @param catalog - Public models and tools supported by the initialized runtime.
     * @param accounts - Private account coordinator for user-owned model routes.
     * @param skills - Shared private exact-version skill resolver, omitted only by legacy test fixtures.
     * @throws Error when the server capability catalog is malformed.
     */
    constructor(
        private readonly store: AgentStore | undefined,
        catalog: AgentCatalog,
        private readonly accounts?: AccountService,
        private readonly skills?: SkillStore
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
     * Extend the server catalog with only this account's current model connections.
     * @param scope - API-authenticated account and workspace.
     * @returns A public catalog with no connection secrets.
     */
    async catalogFor(scope: ChatScope): Promise<AgentCatalog> {
        const catalog = this.catalog()
        if (!this.accounts) return catalog
        let models: Awaited<ReturnType<AccountService['listModels']>>
        try {
            models = await this.accounts.listModels(scope)
        } catch (error) {
            return skillFailure(error)
        }
        return {
            ...catalog,
            defaultModelId: models.find(model => model.isDefault)?.modelId ?? catalog.defaultModelId,
            models: [
                ...models.map(model => ({
                    id: model.modelId,
                    label: model.name,
                    provider: 'OpenAI 兼容',
                    available: true,
                    description: model.model,
                })),
                ...catalog.models,
            ],
        }
    }

    /**
     * List definitions owned by the authenticated user and workspace.
     * @param scope - Trusted ownership context established by the API guard.
     * @returns The caller's agent definitions sorted by recent update.
     * @throws ServiceUnavailableException when agent persistence is unavailable.
     */
    async list(scope: ChatScope): Promise<AgentDefinition[]> {
        try {
            return await this.agentStore().list(scope)
        } catch (error) {
            return skillFailure(error)
        }
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
        try {
            const agent = await this.agentStore().get(scope, id)
            if (!agent) throw new NotFoundException('未找到这个 Agent。')
            return agent
        } catch (error) {
            return skillFailure(error)
        }
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
        const { skillRefs, ...configuration } = await this.validate(input, scope)
        const skillSnapshots = skillRefs?.length ? await this.resolveSkills(scope, skillRefs) : skillRefs ? [] : undefined
        const now = new Date().toISOString()
        const agent: AgentDefinition = {
            ...configuration,
            ...(skillSnapshots ? { skillSnapshots } : {}),
            id: randomUUID(),
            createdAt: now,
            updatedAt: now,
        }
        try {
            await this.agentStore().save(scope, agent)
        } catch (error) {
            return skillFailure(error)
        }
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
        const { skillRefs, ...configuration } = await this.validate(input, scope)
        const skillSnapshots =
            skillRefs === undefined ? previous.skillSnapshots : skillRefs.length ? await this.resolveSkills(scope, skillRefs) : []
        const agent: AgentDefinition = {
            ...configuration,
            ...(skillSnapshots ? { skillSnapshots } : {}),
            id: previous.id,
            createdAt: previous.createdAt,
            updatedAt: new Date().toISOString(),
        }
        try {
            await this.agentStore().save(scope, agent)
        } catch (error) {
            return skillFailure(error)
        }
        return agent
    }

    /**
     * Resolves only explicit private exact versions into server-owned frozen Agent content.
     * @param scope - Actual Agent owner and selected workspace.
     * @param refs - Explicit unique ordered version references.
     * @returns Complete ordered immutable snapshots without model execution.
     * @throws ServiceUnavailableException when private skill persistence is unavailable.
     */
    private async resolveSkills(scope: ChatScope, refs: SkillRef[]): Promise<SkillSnapshot[]> {
        try {
            if (!this.skills) throw new ServiceUnavailableException('技能存储尚未连接，无法验证绑定。')
            return await this.skills.resolve(scope, refs)
        } catch (error) {
            return skillFailure(error)
        }
    }

    /**
     * Validate public configuration against the immutable server capability catalog.
     * @param input - Untrusted candidate agent configuration.
     * @param scope - Authenticated account allowed to select its own model routes.
     * @returns A validated and detached agent configuration.
     * @throws BadRequestException when fields, model, or tools cannot be accepted.
     */
    private async validate(input: AgentInput, scope: ChatScope): Promise<AgentInput> {
        const parsed = agentInputSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('Agent 配置格式不正确，请检查名称、模型和开场消息。')
        const model = (await this.catalogFor(scope)).models.find(candidate => candidate.id === parsed.data.modelId)
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
