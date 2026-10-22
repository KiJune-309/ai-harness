import type {
    ChatConversation,
    CreateWorkflowPreview,
    CreateWorkflowTemplate,
    TemplateCatalogEntry,
    UpdateWorkflowTemplate,
    WorkflowLaunch,
} from '@ai-harness/contracts'
import type { ChatScope } from '@ai-harness/db'
import { Injectable, NotFoundException } from '@nestjs/common'
import { CollaborationService } from './collaboration-service.js'
import { ChatService } from './chat-service.js'
import { throwLegacyProjectRetired } from './legacy-project-policy.js'

/** Coordinates human-owned workflow graphs and complete immutable startup previews. */
@Injectable()
export class WorkflowTemplateService {
    /**
     * Retains the existing collaboration and personal-template coordinators.
     * @param collaboration - Scoped PostgreSQL collaboration and non-secret route preparation.
     * @param chat - Existing personal template behavior.
     */
    constructor(
        private readonly collaboration: CollaborationService,
        private readonly chat: ChatService
    ) {}

    /**
     * Lists both stable template kinds without error-driven fallback.
     * @param scope - Verified template owner.
     * @returns One kind-aware private directory.
     */
    async catalog(scope: ChatScope): Promise<TemplateCatalogEntry[]> {
        const [personal, workflows] = await Promise.all([
            this.chat.listTemplates(scope),
            this.collaboration.query(store => store.workflowTemplates(scope)),
        ])
        return [
            ...personal.map(template => ({ kind: 'personal' as const, template })),
            ...workflows.map(template => ({ kind: 'workflow' as const, template })),
        ].sort((a, b) => b.template.updatedAt.localeCompare(a.template.updatedAt))
    }

    /**
     * Resolves an exact saved kind before reading that kind's owned record.
     * @param scope - Verified owner and workspace.
     * @param id - Stable template identity.
     * @returns Exactly one typed template.
     * @throws NotFoundException for an absent or foreign template.
     */
    async get(scope: ChatScope, id: string): Promise<TemplateCatalogEntry> {
        return this.collaboration.query(async store => {
            const kind = await store.templateKind(scope, id)
            if (kind === 'personal') return { kind, template: await this.chat.getTemplate(scope, id) }
            const template = kind === 'workflow' ? await store.workflowTemplate(scope, id) : undefined
            if (!template) throw new NotFoundException('未找到此模板。')
            return { kind: 'workflow', template }
        })
    }

    /**
     * Creates or replays a complete privately owned workflow graph.
     * @param scope - Verified owner.
     * @param input - Normalized graph and stable creation action.
     * @returns The saved workflow template.
     */
    create(scope: ChatScope, input: CreateWorkflowTemplate) {
        const { requestId, ...graph } = input
        return this.collaboration.query(store => store.saveWorkflowTemplate(scope, requestId, graph))
    }

    /**
     * Saves the complete graph against its expected version.
     * @param scope - Verified owner.
     * @param id - Saved workflow identity.
     * @param input - Replacement graph and expected version.
     * @returns The saved next revision.
     */
    update(scope: ChatScope, id: string, input: UpdateWorkflowTemplate) {
        const { version, ...graph } = input
        return this.collaboration.query(store => store.saveWorkflowTemplate(scope, id, graph, version))
    }

    /**
     * Freezes exact recipients, full openings and sharing scope for human review.
     * @param scope - Actual initiating owner.
     * @param id - Saved workflow identity.
     * @param input - Explicit saved version and instance fields.
     * @returns Complete immutable server preview.
     */
    preview(scope: ChatScope, id: string, input: CreateWorkflowPreview) {
        throwLegacyProjectRetired()
        return this.collaboration.query(store => store.previewWorkflow(scope, id, input))
    }

    /**
     * Launches only a reviewed preview using empty per-node private conversations.
     * @param scope - Actual human initiator.
     * @param id - Original saved template identity.
     * @param input - Stable action and immutable reviewed preview.
     * @returns One original shared project and distinct responsibility IDs.
     */
    launch(scope: ChatScope, id: string, input: WorkflowLaunch) {
        throwLegacyProjectRetired()
        return this.collaboration.query(async store => {
            const replay = await store.workflowLaunchReplay(scope, id, input)
            if (replay) return replay
            const preview = await store.validateWorkflowPreview(scope, id, input.previewId)
            const conversations: Record<string, ChatConversation> = {}
            try {
                for (const node of preview.nodes)
                    conversations[node.id] = await this.collaboration.workflowDialogue(
                        { workspaceId: scope.workspaceId, userId: node.assigneeId },
                        node.title
                    )
            } catch (error) {
                // A recipient may leave between preflight and metadata reads; report its stale review as a conflict.
                await store.validateWorkflowPreview(scope, id, input.previewId)
                throw error
            }
            return store.launchWorkflow(scope, id, input, conversations)
        })
    }
}
