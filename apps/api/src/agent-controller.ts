import { agentInputSchema, type AgentCatalog, type AgentDefinition } from '@ai-harness/contracts'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common'
import type { ChatRequest } from './auth.js'
import { AgentService } from './agent-service.js'

/**
 * Validate agent route identifiers before passing them to persistence.
 * @param id - Untrusted route identifier.
 * @returns A valid agent UUID.
 * @throws BadRequestException when the identifier is malformed.
 */
function agentId(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        throw new BadRequestException('Agent 标识无效。')
    return id
}

/** Authenticated agent configuration endpoints backed by shared scoped persistence. */
@Controller('chat/agents')
export class AgentController {
    /**
     * Receive the process-owned agent service through an explicit Nest injection token.
     * @param service - Shared scoped agent coordinator.
     */
    constructor(@Inject(AgentService) private readonly service: AgentService) {}

    /**
     * Return public model and tool descriptors for the agent editor.
     * @param request - Request with a validated account session.
     * @returns The server-supported capability catalog without credentials.
     */
    @Get('catalog')
    catalog(@Req() request: ChatRequest): Promise<AgentCatalog> {
        return this.service.catalogFor(request.chatScope)
    }

    /**
     * List the authenticated identity's agent definitions.
     * @param request - Request authenticated by the application guard.
     * @returns Definitions owned by its trusted user and workspace scope.
     */
    @Get()
    async list(@Req() request: ChatRequest): Promise<{ agents: AgentDefinition[] }> {
        return { agents: await this.service.list(request.chatScope) }
    }

    /**
     * Validate and create an agent within the authenticated ownership scope.
     * @param request - Authenticated request with trusted ownership claims.
     * @param body - Untrusted public agent configuration.
     * @returns A persisted agent with server-generated identity and timestamps.
     * @throws BadRequestException for invalid configuration.
     */
    @Post()
    create(@Req() request: ChatRequest, @Body() body: unknown): Promise<AgentDefinition> {
        const parsed = agentInputSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('Agent 配置格式不正确，请检查名称、模型和开场消息。')
        return this.service.create(request.chatScope, parsed.data)
    }

    /**
     * Read an agent only within the authenticated ownership scope.
     * @param request - Authenticated request with trusted ownership claims.
     * @param id - Untrusted agent UUID.
     * @returns The caller-owned agent definition.
     * @throws BadRequestException for a malformed identifier.
     * @throws NotFoundException for absent or foreign-owned agents.
     */
    @Get(':id')
    get(@Req() request: ChatRequest, @Param('id') id: string): Promise<AgentDefinition> {
        return this.service.get(request.chatScope, agentId(id))
    }

    /**
     * Replace the authenticated caller's agent configuration after validation.
     * @param request - Authenticated request with trusted ownership claims.
     * @param id - Untrusted agent UUID.
     * @param body - Untrusted replacement configuration.
     * @returns The updated agent preserving its identity and creation timestamp.
     * @throws BadRequestException for malformed identifiers or configuration.
     * @throws NotFoundException for absent or foreign-owned agents.
     */
    @Put(':id')
    update(@Req() request: ChatRequest, @Param('id') id: string, @Body() body: unknown): Promise<AgentDefinition> {
        const ownedId = agentId(id)
        const parsed = agentInputSchema.safeParse(body)
        if (!parsed.success) throw new BadRequestException('Agent 配置格式不正确，请检查名称、模型和开场消息。')
        return this.service.update(request.chatScope, ownedId, parsed.data)
    }
}
