import { randomUUID } from 'node:crypto'
import {
    collaborationCommandSchema,
    type AgentDefinition,
    type ChatConversation,
    type CollaborationCommand,
    type CollaborationSource,
    type PersonMention,
} from '@ai-harness/contracts'
import {
    CollaborationAccessError,
    CollaborationConflictError,
    CollaborationRateLimitError,
    type ChatScope,
    type ChatStore,
    type CollaborationStore,
    type CollaborationMutationOptions,
} from '@ai-harness/db'
import {
    BadRequestException,
    ConflictException,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common'
import type { ModelConnection } from '@ai-harness/chat-runtime'
import type { AccountService } from './account-service.js'
import type { AgentService } from './agent-service.js'
import type { ApiConfig } from './config.js'
import { assertLegacyProjectCommandAvailable } from './legacy-project-policy.js'

/** Describes only fixed, safe model setup failures that can be shown to the source owner. */
export class OwnerModelConfigurationException extends ServiceUnavailableException {
    /**
     * Creates actionable feedback without including provider responses or private credentials.
     * @param reason - Server-determined unavailable private or deployment route.
     */
    constructor(reason: 'system-unavailable' | 'unsupported' | 'unavailable') {
        super(
            reason === 'unavailable'
                ? '此对话或任务的个人模型连接已删除或不可用，请到账户设置检查，并选择本人有效的模型连接后重试。'
                : reason === 'unsupported'
                  ? '此对话或任务选择的模型当前不受系统支持，请选择可用模型后重试。'
                  : '系统默认模型暂不可用，请联系管理员检查系统模型配置后重试。'
        )
    }
}

/**
 * Converts scoped persistence failures to safe HTTP errors.
 * @param error - Private database or validation failure.
 * @returns Never returns.
 * @throws A safe HTTP error without SQL, model credentials or provider bodies.
 */
export function collaborationFailure(error: unknown): never {
    if (error instanceof CollaborationRateLimitError) throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS)
    if (error instanceof CollaborationAccessError) throw new NotFoundException(error.message)
    if (error instanceof CollaborationConflictError) throw new ConflictException(error.message)
    if (error instanceof HttpException) throw error
    throw new ServiceUnavailableException('协作服务暂时不可用，请保留输入并用原请求重试。')
}

/** Coordinates authenticated collaboration without transferring private task ownership. */
@Injectable()
export class CollaborationService {
    /**
     * Retains process-shared stores and the owner-scoped account resolvers.
     * @param store - PostgreSQL business store or explicitly injected test store.
     * @param accounts - Owner-scoped private model service.
     * @param agents - Owner-scoped Agent service.
     * @param config - Trusted deployment defaults.
     */
    constructor(
        private readonly store: ChatStore,
        private readonly accounts: AccountService,
        private readonly agents: AgentService,
        private readonly config: ApiConfig
    ) {}

    /**
     * Resolves the durable collaboration repository without a memory fallback.
     * @returns The shared collaboration store.
     * @throws ServiceUnavailableException if an injected legacy store lacks collaboration.
     */
    persistence(): CollaborationStore {
        if (!this.store.collaboration) throw new ServiceUnavailableException('协作存储尚未连接。')
        return this.store.collaboration
    }

    /**
     * Runs a scoped repository operation and redacts storage failures.
     * @param action - Authorized repository operation.
     * @returns Its result after persistence succeeds.
     * @throws A safe HTTP error on failure.
     */
    async query<T>(action: (store: CollaborationStore) => Promise<T>): Promise<T> {
        try {
            return await action(this.persistence())
        } catch (error) {
            return collaborationFailure(error)
        }
    }

    /**
     * Executes a strict, idempotent command with server-owned authority and private dialogue preparation.
     * @param scope - Identity established by the persisted session guard.
     * @param candidate - Untrusted command.
     * @param authority - Server-only tool author and lease, absent for public human requests.
     * @returns The committed action outcome.
     * @throws A safe validation, access, version or storage error.
     */
    async command(scope: ChatScope, candidate: unknown, authority: Pick<CollaborationMutationOptions, 'authorKind' | 'lease'> = {}) {
        const parsed = collaborationCommandSchema.safeParse(candidate)
        if (!parsed.success) throw new BadRequestException('协作内容或版本格式不正确。')
        const command = parsed.data
        assertLegacyProjectCommandAvailable(command)
        return this.query(async persistence => {
            if (
                (command.type.startsWith('project-') ||
                    command.type === 'note-publish' ||
                    command.type === 'note-edit' ||
                    command.type === 'revoke') &&
                (authority.authorKind === 'agent' || authority.lease)
            )
                throw new NotFoundException('项目管理与共享资料必须由本人明确提交。')
            if (command.type === 'publish' && (authority.authorKind === 'agent' || authority.lease))
                throw new NotFoundException('共享成果需由本人明确提交。')
            if (command.type === 'project-start') {
                const replay = await persistence.action(scope, command.requestId)
                if (replay) return persistence.mutate(scope, command, authority)
                const project = await persistence.project(scope, command.projectId)
                if (!project || !project.members.some(member => member.id === scope.userId && member.status === 'active'))
                    throw new NotFoundException('未找到此协作项目。')
                if (project.revision !== command.revision) throw new ConflictException('项目已变化，请重新读取后开始工作。')
                const agent = await this.activationAgent(scope)
                const ownerConversation = this.initialDialogue(agent, command.title)
                return persistence.mutate(scope, command, { ...authority, ownerConversation })
            }
            if (command.type === 'confirm-dispatch' || command.type === 'cancel-dispatch') {
                if (authority.authorKind === 'agent' || authority.lease) throw new NotFoundException('发送确认必须由本人操作。')
                const replay = await persistence.action(scope, command.requestId)
                if (replay || command.type === 'cancel-dispatch') return persistence.mutate(scope, command)
                const dispatch = await persistence.dispatch(scope, command.draftId)
                if (!dispatch) throw new NotFoundException('未找到此发送草稿。')
                assertLegacyProjectCommandAvailable(dispatch.command)
                if ((dispatch.command.type !== 'delegate' && dispatch.command.type !== 'message') || dispatch.proposal.status !== 'pending')
                    return persistence.mutate(scope, command)
                const recipientConversation = await this.recipientDialogue(scope, dispatch.command)
                return persistence.mutate(scope, command, { recipientConversation })
            }
            if (
                authority.authorKind === 'agent' &&
                (command.type === 'fixed-contact' ||
                    command.type === 'message' ||
                    command.type === 'delegate' ||
                    command.type === 'answer' ||
                    (command.type === 'ask' && command.targetNodeId !== command.nodeId))
            )
                return persistence.propose(scope, command, authority)
            if (command.type === 'fixed-contact') throw new NotFoundException('固定联络只能由当前授权 Agent 起草并由本人确认。')
            if (command.type === 'delegate' || command.type === 'message') {
                const replay = await persistence.action(scope, command.requestId)
                if (replay) return persistence.mutate(scope, command, authority)
                const recipientConversation = await this.recipientDialogue(scope, command)
                return persistence.mutate(scope, command, { ...authority, recipientConversation })
            }
            if (command.type === 'retry' && (command.agentId || command.useDefaultModel)) {
                const replay = await persistence.action(scope, command.requestId)
                if (replay) return persistence.mutate(scope, command, authority)
                const detail = await persistence.node(scope, command.nodeId)
                if (!detail || detail.node.ownerId !== scope.userId) throw new NotFoundException('未找到本人负责的任务。')
                const agent = await this.activationAgent(scope, command.agentId)
                await this.connection(scope, agent)
                return persistence.mutate(scope, command, { ...authority, agent })
            }
            if (command.type !== 'activate') return persistence.mutate(scope, command, authority)
            const replay = await persistence.action(scope, command.requestId)
            // Replaying through the repository still verifies the original command fingerprint.
            if (replay) return persistence.mutate(scope, command, authority)
            const detail = await persistence.node(scope, command.nodeId)
            if (!detail || detail.node.ownerId !== scope.userId) throw new NotFoundException('未找到本人负责的任务。')
            if (detail.node.source) return persistence.mutate(scope, command, { ...authority, openingOnly: true })
            const agent = await this.activationAgent(scope, command.agentId)
            const recipientConversation = this.initialDialogue(agent, detail.node.title)
            return persistence.mutate(scope, command, { ...authority, recipientConversation, agent, openingOnly: true })
        })
    }

    /**
     * Prepares the receiver's non-secret dialogue only when an authorized send will be committed.
     * @param scope - Authenticated sender and workspace.
     * @param command - Immutable server-loaded or directly human-authored handoff.
     * @returns An empty receiver-owned ordinary conversation without executing a model.
     * @throws NotFoundException when the recipient is inaccessible.
     */
    private async recipientDialogue(
        scope: ChatScope,
        command: Extract<CollaborationCommand, { type: 'delegate' | 'message' }>
    ): Promise<ChatConversation> {
        try {
            const agent = await this.activationAgent({ workspaceId: scope.workspaceId, userId: command.recipientId })
            return this.initialDialogue(agent, command.type === 'delegate' ? command.title : command.content.slice(0, 40))
        } catch (error) {
            if (error instanceof UnauthorizedException) throw new NotFoundException('未找到此协作收件人。')
            throw error
        }
    }

    /**
     * Prepares an empty private chat without executing a provider or fabricating user input.
     * @param agent - Actual owner's non-secret default or explicitly selected Agent snapshot.
     * @param title - Explicit work title or authorized incoming communication title.
     * @returns An empty private dialogue; only a real communication may add a later attributed opening.
     */
    private initialDialogue(agent: AgentDefinition, title: string): ChatConversation {
        const now = new Date().toISOString()
        return {
            id: randomUUID(),
            title,
            agent,
            messages: [],
            createdAt: now,
            updatedAt: now,
        }
    }

    /**
     * Prepares one empty workflow node conversation using only its actual owner's non-secret route metadata.
     * @param scope - Verified actual assignee and workspace, revalidated transactionally by launch.
     * @param title - Frozen node title.
     * @returns An empty ordinary private conversation without decrypting credentials or running a model.
     */
    async workflowDialogue(scope: ChatScope, title: string): Promise<ChatConversation> {
        return this.initialDialogue(await this.activationAgent(scope), title)
    }

    /**
     * Resolves the receiving person's selected Agent, personal default, or authorized system default.
     * @param scope - Actual node owner.
     * @param agentId - Optional own saved Agent.
     * @returns A private Agent snapshot containing only its non-secret model route.
     * @throws A scoped access or persistence error if the requested owner configuration cannot be read.
     */
    private async activationAgent(scope: ChatScope, agentId?: string): Promise<AgentDefinition> {
        if (agentId) {
            const agent = await this.agents.get(scope, agentId)
            return { ...agent, systemPrompt: agent.systemPrompt.trim() || this.config.systemPrompt }
        }
        const model = await this.accounts.defaultModel(scope)
        const now = new Date().toISOString()
        return {
            id: randomUUID(),
            name: '通用助手',
            description: model ? '本人默认模型' : '系统默认模型',
            systemPrompt: this.config.systemPrompt,
            modelId: model?.modelId ?? this.agents.catalog().defaultModelId,
            toolIds: [],
            openingMessages: [],
            createdAt: now,
            updatedAt: now,
        }
    }

    /**
     * Resolves an owner's private connection or validates an authorized deployment model before execution.
     * @param scope - Actual source owner, never the project creator by substitution.
     * @param agent - Owner's frozen private Agent snapshot.
     * @returns An owner-only decrypted connection, or undefined to use the private server-owned runtime configuration.
     * @throws OwnerModelConfigurationException for deleted, foreign, unsupported or unavailable routes.
     */
    async connection(scope: ChatScope, agent?: AgentDefinition): Promise<ModelConnection | undefined> {
        const route = agent?.modelId
        if (route?.startsWith('account:')) {
            const model = await this.accounts.getModel(scope, route.slice('account:'.length))
            if (!model) throw new OwnerModelConfigurationException('unavailable')
            return { apiKey: model.apiKey, baseUrl: model.public.baseUrl, model: model.public.model }
        }
        const catalog = this.agents.catalog()
        const model = catalog.models.find(candidate => candidate.id === (route ?? catalog.defaultModelId))
        if (!model) throw new OwnerModelConfigurationException('unsupported')
        if (!model.available || !this.config.apiKey) throw new OwnerModelConfigurationException('system-unavailable')
        return undefined
    }

    /**
     * Determines whether this original source must continue through its durable session.
     * @param scope - Actual source owner.
     * @param source - Original private work location.
     * @returns Whether a canonical session was already bound.
     */
    async isBound(scope: ChatScope, source: CollaborationSource): Promise<boolean> {
        if (!this.store.collaboration) return false
        return this.query(async persistence => Boolean((await persistence.loadSource(scope, source))?.bound))
    }

    /**
     * Validates explicit person bindings and accepts a background turn before acknowledging it.
     * @param scope - Authenticated source owner.
     * @param source - Original conversation or own task.
     * @param input - Stable request, literal user content and selected people.
     * @returns The persisted private projection, whose activity can be polled.
     * @throws A safe error when people, ownership or durable acceptance fail.
     */
    async accept(
        scope: ChatScope,
        source: CollaborationSource,
        input: { requestId: string; content: string; mentions?: PersonMention[] }
    ): Promise<ChatConversation> {
        return this.query(async persistence => {
            const forbidden: [number, number][] = []
            for (const match of input.content.matchAll(/```[\s\S]*?(?:```|$)|`[^`\n]*`|^\s*>.*$/gm))
                forbidden.push([match.index!, match.index! + match[0].length])
            for (const mention of input.mentions ?? []) {
                const token = `@${mention.name}`
                if (
                    input.content.slice(mention.start, mention.end) !== token ||
                    mention.end > input.content.length ||
                    (mention.start > 0 && /[\p{L}\p{N}_.@]/u.test(input.content[mention.start - 1]!)) ||
                    forbidden.some(([start, end]) => mention.start < end && mention.end > start)
                )
                    throw new BadRequestException('人员提及已变化或位于引用材料中，请重新选择收件人。')
                const matches = await persistence.people(scope, mention.name)
                if (!matches.some(person => person.id === mention.userId && person.name === mention.name))
                    throw new BadRequestException('收件人不可用，请重新选择同事。')
            }
            await persistence.enqueue(scope, { ...input, source })
            const snapshot = await persistence.loadSource(scope, source)
            if (!snapshot) throw new NotFoundException('未找到原工作对话。')
            return snapshot.conversation
        })
    }
}
