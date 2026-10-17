import { randomUUID } from 'node:crypto'
import {
    createProjectSchema,
    createTemplateSchema,
    createTaskSchema,
    launchTemplateSchema,
    personalTaskSchema,
    projectInputSchema,
    updateTemplateSchema,
    updateTaskProjectSchema,
    updateTaskStatusSchema,
    type AgentDefinition,
    type ChatConversation,
    type ChatMessage,
    type ChatStatus,
    type ChatStreamEvent,
    type CreateProject,
    type CreateTemplate,
    type CreateTask,
    type LaunchTemplate,
    type PersonalProject,
    type PersonalTask,
    type ProjectDetail,
    type ProjectInput,
    type ProjectTemplate,
    type SendChatMessage,
    type TemplateInput,
    type TemplateLaunchResult,
    type UpdateTemplate,
    type UpdateTaskProject,
    type UpdateTaskStatus,
} from '@ai-harness/contracts'
import { ChatRuntimeError, type ChatRuntime } from '@ai-harness/chat-runtime'
import {
    TemplateConflictError,
    type ChatScope,
    type ChatStore,
    type ProjectStore,
    type ProjectTemplateStore,
    type StoredProject,
    type StoredProjectTemplate,
} from '@ai-harness/db'
import {
    BadRequestException,
    ConflictException,
    HttpException,
    HttpStatus,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common'
import type { ApiConfig } from './config.js'
import type { AgentService } from './agent-service.js'

interface ActiveTurn {
    requestId: string
    controller: AbortController
    done: Promise<ChatConversation>
}

type ExecutionMode = 'chat' | 'task-start' | 'task-message'

/**
 * Build an unambiguous authorization-scoped activity key.
 * @param scope - Trusted identity established by the API guard.
 * @param id - Conversation identifier authorized within that scope.
 * @returns A private map key containing all ownership dimensions.
 */
function turnKey(scope: ChatScope, id: string): string {
    return JSON.stringify([scope.workspaceId, scope.userId, id])
}

/**
 * Select a safe failure message for the client stream.
 * @param error - Runtime refusal or unexpected server failure.
 * @returns Text that never includes remote bodies, connection strings, or keys.
 */
function errorMessage(error: unknown): string {
    return error instanceof ChatRuntimeError ? error.message : '本次回答未能完成，请稍后重试。'
}

/** Coordinates authorized storage, idempotent turns, and process-owned Cordis execution. */
export class ChatService {
    private readonly turns = new Map<string, ActiveTurn>()
    private readonly mutations = new Map<string, Promise<void>>()
    private closing: Promise<void> | undefined

    /**
     * Retain initialized server resources for all chat requests.
     * @param store - Workspace-filtered conversation persistence.
     * @param runtime - Initialized Cordis runtime, absent until a key is configured.
     * @param config - Immutable server settings.
     * @param agents - Authorized saved Agent definitions for new conversations.
     */
    constructor(
        private readonly store: ChatStore,
        private readonly runtime: ChatRuntime | undefined,
        private readonly config: ApiConfig,
        private readonly agents?: AgentService
    ) {}

    /**
     * Return public connection state without exposing credentials.
     * @returns Model and persistence availability for the chat UI.
     */
    status(): ChatStatus {
        return { configured: Boolean(this.runtime), model: this.config.model, storage: this.config.databaseUrl ? 'postgres' : 'memory' }
    }

    /**
     * List only the caller's conversations.
     * @param scope - Trusted user and workspace identity.
     * @returns Conversations ordered by their latest activity.
     */
    async list(scope: ChatScope): Promise<ChatConversation[]> {
        const conversations = await this.store.list(scope)
        return conversations.filter(conversation => !conversation.task).map(conversation => this.withActivity(scope, conversation))
    }

    /**
     * Resolve one conversation within the authorized scope.
     * @param scope - Trusted identity.
     * @param id - Requested conversation UUID.
     * @returns The caller-owned conversation and its current activity.
     * @throws NotFoundException when it is absent or owned by someone else.
     */
    async get(scope: ChatScope, id: string): Promise<ChatConversation> {
        const conversation = await this.store.get(scope, id)
        if (!conversation || conversation.task) throw new NotFoundException('未找到这段对话。')
        return this.withActivity(scope, conversation)
    }

    /**
     * Create an empty server-owned conversation.
     * @param scope - Trusted identity.
     * @param title - Optional validated display title.
     * @param agentId - Optional saved Agent resolved within the caller's scope.
     * @returns The persisted empty conversation.
     * @throws TooManyRequestsException when the temporary per-user limit is reached.
     */
    async create(scope: ChatScope, title = '新对话', agentId?: string): Promise<ChatConversation> {
        if ((await this.store.list(scope)).filter(conversation => !conversation.task).length >= 200)
            throw new HttpException('当前对话数量已达到上限。', HttpStatus.TOO_MANY_REQUESTS)
        const now = new Date().toISOString()
        if (agentId && !this.agents) throw new ServiceUnavailableException('Agent 服务尚未连接。')
        const agent = agentId ? await this.agents!.get(scope, agentId) : undefined
        const conversation: ChatConversation = {
            id: randomUUID(),
            title,
            createdAt: now,
            updatedAt: now,
            ...(agent ? { agentId: agent.id, agent } : {}),
            messages: (agent?.openingMessages ?? []).map(content => ({
                id: randomUUID(),
                role: 'assistant',
                content,
                status: 'complete',
                createdAt: now,
                kind: 'opening',
            })),
        }
        await this.store.save(scope, conversation)
        return conversation
    }

    /**
     * List complete personal tasks within the caller's trusted ownership scope.
     * @param scope - Authenticated user and workspace context.
     * @returns Tasks ordered by their most recent persisted update.
     */
    async listTasks(scope: ChatScope): Promise<PersonalTask[]> {
        const conversations = await this.store.list(scope)
        return conversations
            .filter(conversation => conversation.task)
            .map(conversation => personalTaskSchema.parse(this.withActivity(scope, conversation)))
    }

    /**
     * Resolve the shared project store without creating separate process resources.
     * @returns The scoped store owned by conversation persistence.
     * @throws ServiceUnavailableException when an injected legacy store lacks project support.
     */
    private projectStore(): ProjectStore {
        if (!this.store.projects) throw new ServiceUnavailableException('项目存储尚未连接。')
        return this.store.projects
    }

    /**
     * Read one project through both trusted ownership dimensions.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable project identifier.
     * @returns The internal project and immutable creation parameters.
     * @throws NotFoundException for nonexistent or inaccessible projects.
     */
    private async ownedProject(scope: ChatScope, id: string): Promise<StoredProject> {
        const stored = await this.projectStore().get(scope, id)
        if (!stored) throw new NotFoundException('未找到这个项目。')
        return stored
    }

    /**
     * List real personal projects without exposing internal idempotency parameters.
     * @param scope - Authenticated user and workspace context.
     * @returns Scoped projects ordered by their most recent saved update.
     */
    async listProjects(scope: ChatScope): Promise<PersonalProject[]> {
        const projects = await this.projectStore().list(scope)
        return projects.map(stored => stored.project).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    }

    /**
     * Create or replay one project using immutable normalized creation parameters.
     * @param scope - Authenticated user and workspace context.
     * @param input - Name, description and stable creation action identifier.
     * @returns The current project, retaining later edits on a matching creation replay.
     * @throws BadRequestException for invalid fields.
     * @throws ConflictException for concurrent writes or a reused action with different fields.
     */
    async createProject(scope: ChatScope, input: CreateProject): Promise<PersonalProject> {
        const parsed = createProjectSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('请填写有效的项目名称、说明和请求标识。')
        const { requestId, name, description } = parsed.data
        return this.mutate(scope, `project:${requestId}`, async () => {
            const store = this.projectStore()
            const previous = await store.get(scope, requestId)
            if (previous) {
                if (previous.project.templateOrigin || previous.creation.name !== name || previous.creation.description !== description)
                    throw new ConflictException('同一个创建请求标识不能用于不同的项目。')
                return previous.project
            }
            const now = new Date().toISOString()
            const project: PersonalProject = { id: requestId, name, description, createdAt: now, updatedAt: now }
            await store.save(scope, { project, creation: { name, description } })
            return project
        })
    }

    /**
     * Read a project and aggregate its currently owned task snapshots.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable project identifier.
     * @returns The project and actual tasks, including all four work states.
     * @throws NotFoundException for nonexistent or inaccessible projects.
     */
    async getProject(scope: ChatScope, id: string): Promise<ProjectDetail> {
        const stored = await this.ownedProject(scope, id)
        const tasks = (await this.listTasks(scope)).filter(task => task.task.projectId === id)
        if (stored.project.templateOrigin) {
            const order = new Map(stored.project.templateOrigin.taskIds.map((taskId, index) => [taskId, index]))
            tasks.sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER))
        }
        return { project: stored.project, tasks }
    }

    /**
     * Resolve template storage from the existing process-owned persistence resources.
     * @returns The ownership-scoped template store.
     * @throws ServiceUnavailableException when injected legacy resources lack template support.
     */
    private templateStore(): ProjectTemplateStore {
        if (!this.store.templates) throw new ServiceUnavailableException('模板存储尚未连接。')
        return this.store.templates
    }

    /**
     * Resolve a template through the trusted user and workspace scope.
     * @param scope - Authenticated ownership context.
     * @param id - Stable template identifier.
     * @returns Current template and immutable original creation input.
     * @throws NotFoundException for absent or inaccessible templates.
     */
    private async ownedTemplate(scope: ChatScope, id: string): Promise<StoredProjectTemplate> {
        const stored = await this.templateStore().get(scope, id)
        if (!stored) throw new NotFoundException('未找到这个模板。')
        return stored
    }

    /**
     * List real template resources without internal creation or launch records.
     * @param scope - Authenticated ownership context.
     * @returns Templates ordered by most recent update.
     */
    async listTemplates(scope: ChatScope): Promise<ProjectTemplate[]> {
        return (await this.templateStore().list(scope))
            .map(stored => stored.template)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    }

    /**
     * Read one current template for editing and versioned launch preview.
     * @param scope - Authenticated ownership context.
     * @param id - Stable template identifier.
     * @returns The public current template resource.
     * @throws NotFoundException for absent or inaccessible templates.
     */
    async getTemplate(scope: ChatScope, id: string): Promise<ProjectTemplate> {
        return (await this.ownedTemplate(scope, id)).template
    }

    /**
     * Check every distinct saved Agent reference without creating model execution.
     * @param scope - Authenticated ownership context.
     * @param input - Normalized template fields and ordered task selections.
     * @returns After all selected saved Agents have been authorized.
     * @throws NotFoundException for absent or inaccessible Agents.
     * @throws ServiceUnavailableException when saved Agent storage is unavailable.
     */
    private async validateTemplateAgents(scope: ChatScope, input: TemplateInput): Promise<void> {
        const references = new Set(input.tasks.flatMap(task => (task.agentId ? [task.agentId] : [])))
        if (references.size && !this.agents) throw new ServiceUnavailableException('Agent 服务尚未连接。')
        for (const id of references) await this.agents!.get(scope, id)
    }

    /**
     * Create or replay a template while retaining later edits and current version.
     * @param scope - Authenticated ownership context.
     * @param input - Stable creation action and ordered template fields.
     * @returns The saved current template, without running a model.
     * @throws BadRequestException for malformed template input.
     * @throws ConflictException for mismatched actions or concurrent writes.
     * @throws NotFoundException for absent or inaccessible selected Agents.
     */
    async createTemplate(scope: ChatScope, input: CreateTemplate): Promise<ProjectTemplate> {
        const parsed = createTemplateSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('请填写有效的模板名称、任务和请求标识。')
        const { requestId, ...creation } = parsed.data
        return this.mutate(scope, `template:${requestId}`, async () => {
            const previous = await this.templateStore().get(scope, requestId)
            if (previous) {
                if (JSON.stringify(previous.creation) !== JSON.stringify(creation))
                    throw new ConflictException('同一个创建请求标识不能用于不同的模板。')
                return previous.template
            }
            await this.validateTemplateAgents(scope, creation)
            const now = new Date().toISOString()
            const template = { ...creation, id: requestId, version: 1, createdAt: now, updatedAt: now }
            try {
                await this.templateStore().save(scope, { template, creation })
            } catch (error) {
                if (error instanceof TemplateConflictError) throw new ConflictException('模板版本已发生变化，请重新载入后重试。')
                throw error
            }
            return template
        })
    }

    /**
     * Save one complete template revision using its expected current version.
     * @param scope - Authenticated ownership context.
     * @param id - Stable template identifier.
     * @param input - Replacement ordered fields and version read by the editor.
     * @returns A new saved revision preserving original creation parameters.
     * @throws BadRequestException for malformed input.
     * @throws ConflictException for stale versions or concurrent writes.
     * @throws NotFoundException for absent or inaccessible templates or Agents.
     */
    async updateTemplate(scope: ChatScope, id: string, input: UpdateTemplate): Promise<ProjectTemplate> {
        const parsed = updateTemplateSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('请填写有效的模板内容和版本。')
        const { version, ...fields } = parsed.data
        return this.mutate(scope, `template:${id}`, async () => {
            const previous = await this.ownedTemplate(scope, id)
            if (previous.template.version !== version) throw new ConflictException('模板版本已发生变化，请重新载入后重试。')
            await this.validateTemplateAgents(scope, fields)
            const template = { ...previous.template, ...fields, version: version + 1, updatedAt: new Date().toISOString() }
            try {
                await this.templateStore().save(scope, { template, creation: previous.creation }, version)
            } catch (error) {
                if (error instanceof TemplateConflictError) throw new ConflictException('模板版本已发生变化，请重新载入后重试。')
                throw error
            }
            return template
        })
    }

    /**
     * Atomically instantiate one fixed template version or replay its original successful action.
     * @param scope - Authenticated ownership context for template, Agents, project and tasks.
     * @param id - Stable template identifier shown in the launch preview.
     * @param input - Stable launch action, preview version and new project fields.
     * @returns The current original project and its immutable original task identifiers.
     * @throws BadRequestException for malformed launch input.
     * @throws ConflictException for stale versions, mismatched actions or identifier collisions.
     * @throws NotFoundException for inaccessible template or selected Agents.
     * @throws ServiceUnavailableException when atomic persistence is unavailable.
     */
    async launchTemplate(scope: ChatScope, id: string, input: LaunchTemplate): Promise<TemplateLaunchResult> {
        const parsed = launchTemplateSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('请填写有效的项目名称、说明、模板版本和启动标识。')
        const { requestId, version, name, description } = parsed.data
        return this.mutate(scope, `template:${id}`, () =>
            this.mutate(scope, `project:${requestId}`, async () => {
                const stored = await this.ownedTemplate(scope, id)
                const previous = await this.templateStore().getLaunch(scope, requestId)
                if (previous) {
                    if (
                        previous.templateId !== id ||
                        previous.version !== version ||
                        previous.input.name !== name ||
                        previous.input.description !== description
                    )
                        throw new ConflictException('同一个启动请求标识不能用于不同的模板、版本或项目。')
                    const current = await this.ownedProject(scope, requestId)
                    return { project: current.project, taskIds: previous.taskIds }
                }
                if (stored.template.version !== version) throw new ConflictException('模板版本已发生变化，请重新载入预览后再启动。')
                if (await this.projectStore().get(scope, requestId)) throw new ConflictException('这个启动标识已用于其他项目。')
                if (!this.store.instantiateTemplateProject) throw new ServiceUnavailableException('模板原子存储尚未连接。')
                const now = new Date().toISOString()
                const snapshots = new Map<string, AgentDefinition>()
                const tasks: PersonalTask[] = []
                for (const item of stored.template.tasks) {
                    const key = item.agentId ?? 'default'
                    let agent = snapshots.get(key)
                    if (!agent) {
                        agent = await this.taskAgent(scope, item.agentId, now)
                        snapshots.set(key, agent)
                    }
                    tasks.push(
                        this.newTaskSnapshot(
                            {
                                requestId: randomUUID(),
                                title: item.title,
                                goal: item.goal,
                                ...(item.agentId ? { agentId: item.agentId } : {}),
                                projectId: requestId,
                            },
                            agent,
                            now
                        )
                    )
                }
                const taskIds = tasks.map(task => task.id)
                const project: PersonalProject = {
                    id: requestId,
                    name,
                    description,
                    createdAt: now,
                    updatedAt: now,
                    templateOrigin: { templateId: id, version, taskIds },
                }
                try {
                    await this.store.instantiateTemplateProject(scope, {
                        project: { project, creation: { name, description } },
                        tasks,
                        launch: { requestId, templateId: id, version, input: { name, description }, taskIds },
                    })
                } catch (error) {
                    if (error instanceof TemplateConflictError)
                        throw new ConflictException('模板版本或启动标识已发生冲突，请重新载入后重试。')
                    throw error
                }
                return { project, taskIds }
            })
        )
    }

    /**
     * Edit project management fields while preserving its initial creation action.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable project identifier.
     * @param input - New name and description, never forwarded to the model.
     * @returns The saved project with its stable identifier and creation timestamp.
     * @throws BadRequestException for invalid fields.
     * @throws NotFoundException for nonexistent or inaccessible projects.
     * @throws ConflictException for concurrent project writes.
     */
    async updateProject(scope: ChatScope, id: string, input: ProjectInput): Promise<PersonalProject> {
        const parsed = projectInputSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('请填写有效的项目名称和说明。')
        return this.mutate(scope, `project:${id}`, async () => {
            const stored = await this.ownedProject(scope, id)
            if (stored.project.name === parsed.data.name && stored.project.description === parsed.data.description) return stored.project
            const project = { ...stored.project, ...parsed.data, updatedAt: new Date().toISOString() }
            await this.projectStore().save(scope, { project, creation: stored.creation })
            return project
        })
    }

    /**
     * Move or remove one task using the same reservation as status and model writes.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable task identifier.
     * @param input - Target project or null to remove current membership.
     * @returns The latest task, changing only current membership and its update timestamp.
     * @throws BadRequestException for malformed membership input.
     * @throws NotFoundException when either side is nonexistent or inaccessible.
     * @throws ConflictException during generation or another task mutation.
     */
    async updateTaskProject(scope: ChatScope, id: string, input: UpdateTaskProject): Promise<PersonalTask> {
        const parsed = updateTaskProjectSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('项目归属格式不正确。')
        return this.mutate(scope, id, async () => {
            const previous = await this.getTask(scope, id)
            const projectId = parsed.data.projectId
            if (projectId) await this.ownedProject(scope, projectId)
            if (previous.task.projectId === (projectId ?? undefined)) return previous
            const task = { ...previous.task }
            if (projectId) task.projectId = projectId
            else delete task.projectId
            const updated = personalTaskSchema.parse({ ...previous, task, updatedAt: new Date().toISOString() })
            await this.store.save(scope, updated)
            return updated
        })
    }

    /**
     * Create one complete task snapshot without invoking the model, or replay its creation.
     * @param scope - Authenticated user and workspace context.
     * @param input - Validated task title, goal, creation identifier and optional saved Agent.
     * @returns The persisted task, including the original frozen Agent on a matching retry.
     * @throws BadRequestException for malformed fields.
     * @throws ConflictException when an identifier is reused for different content or concurrent work.
     * @throws NotFoundException when the selected Agent is absent or inaccessible.
     */
    async createTask(scope: ChatScope, input: CreateTask): Promise<PersonalTask> {
        const parsed = createTaskSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('请填写有效的任务名称、目标和请求标识。')
        const configuration = parsed.data
        return this.mutate(scope, configuration.requestId, async () => {
            const previous = await this.store.get(scope, configuration.requestId)
            if (previous) {
                if (
                    !previous.task ||
                    previous.title !== configuration.title ||
                    previous.task.goal !== configuration.goal ||
                    previous.task.sourceAgentId !== configuration.agentId ||
                    previous.task.creationProjectId !== configuration.projectId
                )
                    throw new ConflictException('同一个创建请求标识不能用于不同的任务。')
                return personalTaskSchema.parse(this.withActivity(scope, previous))
            }
            if (configuration.projectId) await this.ownedProject(scope, configuration.projectId)
            const now = new Date().toISOString()
            const agent = await this.taskAgent(scope, configuration.agentId, now)
            const task = this.newTaskSnapshot(configuration, agent, now)
            await this.store.save(scope, task)
            return task
        })
    }

    /**
     * Build a complete independent task using an already resolved immutable Agent configuration.
     * @param input - Normalized task fields, stable identifier and optional initial project.
     * @param agent - Resolved configuration frozen for this creation action.
     * @param now - Shared creation timestamp.
     * @returns A validated detached task with unique ordered opening message identifiers.
     */
    private newTaskSnapshot(input: CreateTask, agent: AgentDefinition, now: string): PersonalTask {
        return personalTaskSchema.parse({
            id: input.requestId,
            title: input.title,
            createdAt: now,
            updatedAt: now,
            agentId: agent.id,
            agent,
            task: {
                goal: input.goal,
                status: 'not-started',
                started: false,
                ...(input.agentId ? { sourceAgentId: input.agentId } : {}),
                ...(input.projectId ? { projectId: input.projectId, creationProjectId: input.projectId } : {}),
            },
            messages: agent.openingMessages.map(content => ({
                id: randomUUID(),
                role: 'assistant',
                content,
                status: 'complete',
                createdAt: now,
                kind: 'opening',
            })),
        })
    }

    /**
     * Read one complete personal task through its trusted ownership scope.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable task identifier.
     * @returns The task snapshot and current process-owned generation state.
     * @throws NotFoundException for an absent task, a regular conversation, or another owner's task.
     */
    async getTask(scope: ChatScope, id: string): Promise<PersonalTask> {
        const conversation = await this.store.get(scope, id)
        if (!conversation?.task) throw new NotFoundException('未找到这个任务。')
        return personalTaskSchema.parse(this.withActivity(scope, conversation))
    }

    /**
     * Change a task's explicit work state without racing with model execution.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable task identifier.
     * @param input - Requested status or explicit restoration of the pre-completion state.
     * @returns The saved task; completed tasks retain their history and restore to their prior state.
     * @throws BadRequestException for an invalid status action.
     * @throws ConflictException during generation or when a completed task requires restoration.
     * @throws NotFoundException when the task is absent or inaccessible.
     */
    async updateTaskStatus(scope: ChatScope, id: string, input: UpdateTaskStatus): Promise<PersonalTask> {
        const parsed = updateTaskStatusSchema.safeParse(input)
        if (!parsed.success) throw new BadRequestException('任务状态格式不正确。')
        return this.mutate(scope, id, async () => {
            const previous = await this.getTask(scope, id)
            const action = parsed.data
            const task = { ...previous.task }
            if ('restore' in action) {
                if (task.status !== 'completed') throw new ConflictException('这个任务尚未完成，无需恢复。')
                task.status = task.previousStatus ?? (task.started ? 'in-progress' : 'not-started')
                delete task.previousStatus
            } else {
                if (action.status === task.status) return previous
                if (task.status === 'completed') throw new ConflictException('任务已完成，请先恢复任务。')
                if (action.status === 'completed') task.previousStatus = task.status
                task.status = action.status
            }
            const updated = personalTaskSchema.parse({ ...previous, task, updatedAt: new Date().toISOString() })
            await this.store.save(scope, updated)
            return updated
        })
    }

    /**
     * Freeze the actual Agent settings used by a newly created task.
     * @param scope - Authenticated user and workspace context.
     * @param agentId - Optional saved Agent identifier resolved within the same scope.
     * @param now - Timestamp assigned to a generated system-assistant snapshot.
     * @returns A detached Agent snapshot with its deployment-default prompt already resolved.
     * @throws NotFoundException when a selected saved Agent is absent or inaccessible.
     * @throws ServiceUnavailableException when saved Agent resolution is unavailable.
     */
    private async taskAgent(scope: ChatScope, agentId: string | undefined, now: string): Promise<AgentDefinition> {
        if (agentId) {
            if (!this.agents) throw new ServiceUnavailableException('Agent 服务尚未连接。')
            const agent = await this.agents.get(scope, agentId)
            return { ...agent, systemPrompt: agent.systemPrompt.trim() ? agent.systemPrompt : this.config.systemPrompt }
        }
        return {
            id: randomUUID(),
            name: '通用助手',
            description: '系统默认助手',
            modelId: this.config.model,
            systemPrompt: this.config.systemPrompt,
            toolIds: [],
            openingMessages: [],
            createdAt: now,
            updatedAt: now,
        }
    }

    /**
     * Reserve a scoped task mutation before its first asynchronous read.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable task identifier.
     * @param action - Complete read/validate/save action protected by this reservation.
     * @returns The action's persisted result.
     * @throws ConflictException when another mutation or generation owns the same task.
     * @throws ServiceUnavailableException while application shutdown is draining resources.
     */
    private async mutate<T>(scope: ChatScope, id: string, action: () => Promise<T>): Promise<T> {
        if (this.closing) throw new ServiceUnavailableException('聊天服务正在关闭，请稍后重试。')
        const key = turnKey(scope, id)
        if (this.turns.has(key) || this.mutations.has(key)) throw new ConflictException('这个任务正在处理中，请等待当前操作结束。')
        const done = Promise.withResolvers<void>()
        this.mutations.set(key, done.promise)
        try {
            return await action()
        } finally {
            this.mutations.delete(key)
            done.resolve()
        }
    }

    /**
     * Replace persisted stale activity flags with process-owned activity state.
     * @param scope - Trusted identity.
     * @param conversation - Detached persisted conversation.
     * @returns A snapshot that never reports a prior process's request as live.
     */
    private withActivity(scope: ChatScope, conversation: ChatConversation): ChatConversation {
        const snapshot = { ...conversation }
        delete snapshot.activeRequestId
        const active = this.turns.get(turnKey(scope, conversation.id))
        return { ...snapshot, ...(active ? { activeRequestId: active.requestId } : {}) }
    }

    /**
     * Execute or replay one idempotent user turn and stream its settlement.
     * @param scope - API-authenticated identity.
     * @param id - Owned conversation UUID.
     * @param input - Validated prompt and idempotency key.
     * @param signal - HTTP disconnect cancellation.
     * @param emit - Observer for public SSE events.
     * @returns After the final answer has been saved and emitted.
     * @throws HttpException for validation, ownership, configuration, or concurrency refusals.
     */
    send(scope: ChatScope, id: string, input: SendChatMessage, signal: AbortSignal, emit: (event: ChatStreamEvent) => void): Promise<void> {
        return this.sendTurn(scope, id, input, signal, emit, 'chat')
    }

    /**
     * Start one task by sending its stored goal exactly once as the first user message.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable task identifier.
     * @param requestId - Idempotent identifier retained for retrying this initial turn.
     * @param signal - HTTP disconnection signal.
     * @param emit - Observer for public streaming events.
     * @returns After the goal turn settles and is persisted.
     * @throws HttpException for inaccessible, completed, previously started, or conflicting tasks.
     */
    startTask(scope: ChatScope, id: string, requestId: string, signal: AbortSignal, emit: (event: ChatStreamEvent) => void): Promise<void> {
        return this.sendTurn(scope, id, { requestId }, signal, emit, 'task-start')
    }

    /**
     * Continue an already-started task using its frozen Agent and complete saved context.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable task identifier.
     * @param input - Validated supplementary message and idempotent identifier.
     * @param signal - HTTP disconnection signal.
     * @param emit - Observer for public streaming events.
     * @returns After the supplementary turn settles and is persisted.
     * @throws HttpException for inaccessible, unstarted, completed, or conflicting tasks.
     */
    sendTask(
        scope: ChatScope,
        id: string,
        input: SendChatMessage,
        signal: AbortSignal,
        emit: (event: ChatStreamEvent) => void
    ): Promise<void> {
        return this.sendTurn(scope, id, input, signal, emit, 'task-message')
    }

    /**
     * Execute a serialized regular-chat or task turn through the shared Cordis runtime.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable conversation or task identifier.
     * @param input - User message or the request identifier of an initial task goal.
     * @param signal - HTTP disconnection signal.
     * @param emit - Observer for public streaming events.
     * @param mode - Entry-point kind governing task isolation and lifecycle rules.
     * @returns After a replay or accepted turn has been persisted and emitted.
     * @throws HttpException for validation, ownership, configuration, or concurrency refusals.
     */
    private async sendTurn(
        scope: ChatScope,
        id: string,
        input: SendChatMessage | { requestId: string },
        signal: AbortSignal,
        emit: (event: ChatStreamEvent) => void,
        mode: ExecutionMode
    ): Promise<void> {
        if (this.closing) throw new ServiceUnavailableException('聊天服务正在关闭，请稍后重试。')
        const key = turnKey(scope, id)
        if (this.turns.has(key) || this.mutations.has(key)) throw new ConflictException('这段对话正在处理中，请先停止或等待完成。')
        if (this.turns.size >= 20) throw new HttpException('当前请求较多，请稍后再试。', HttpStatus.TOO_MANY_REQUESTS)
        if (signal.aborted) return
        const controller = new AbortController()
        const done = Promise.withResolvers<ChatConversation>()
        // The cancel route joins this promise; suppress unobserved rejection when no cancellation was requested.
        void done.promise.catch(() => undefined)
        const activity: ActiveTurn = { requestId: input.requestId, controller, done: done.promise }
        this.turns.set(key, activity)
        /**
         * Forward an HTTP disconnect to the owned runtime request.
         * @returns Nothing after signalling cancellation.
         */
        const abort = (): void => controller.abort()
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) controller.abort()
        try {
            // Reserve before the first asynchronous read so a delayed snapshot cannot overwrite a newer completed turn.
            const conversation = await this.store.get(scope, id)
            if (!conversation || (mode === 'chat' ? Boolean(conversation.task) : !conversation.task))
                throw new NotFoundException(mode === 'chat' ? '未找到这段对话。' : '未找到这个任务。')
            if (conversation.task) {
                if (conversation.task.status === 'completed') throw new ConflictException('任务已完成，请先恢复任务。')
                if (mode === 'task-start' && conversation.task.started) {
                    const first = conversation.messages.find(message => message.role === 'user')
                    if (first?.requestId !== input.requestId) throw new ConflictException('任务已经开始，请在原任务中继续补充消息。')
                }
                if (mode === 'task-message' && !conversation.task.started) throw new ConflictException('请先开始执行这个任务。')
            }
            const prompt = mode === 'task-start' ? conversation.task!.goal : (input as SendChatMessage).content
            delete conversation.activeRequestId
            if (controller.signal.aborted) {
                done.resolve(conversation)
                return
            }
            const userIndex = conversation.messages.findIndex(message => message.role === 'user' && message.requestId === input.requestId)
            if (userIndex >= 0 && conversation.messages[userIndex]?.content !== prompt)
                throw new ConflictException('同一个请求标识不能用于不同的问题。')
            const priorAssistant = conversation.messages.find(
                message => message.role === 'assistant' && message.requestId === input.requestId
            )
            if (priorAssistant?.status === 'complete') {
                done.resolve(conversation)
                emit({ type: 'done', conversation })
                return
            }
            if (userIndex >= 0 && conversation.messages.slice(userIndex + 1).some(message => message.role === 'user'))
                throw new ConflictException('这条消息之后已有新的对话，请重新发送问题。')
            if (!this.runtime) throw new ServiceUnavailableException('请在服务端配置 DEEPSEEK_API_KEY 后重启服务。')
            const history = userIndex >= 0 ? conversation.messages.slice(0, userIndex) : conversation.messages
            const now = new Date().toISOString()
            const user: ChatMessage =
                userIndex >= 0
                    ? conversation.messages[userIndex]!
                    : {
                          id: input.requestId,
                          role: 'user',
                          content: prompt,
                          status: 'complete',
                          createdAt: now,
                          requestId: input.requestId,
                      }
            let content = ''
            let reasoning = ''
            let status: ChatMessage['status'] = 'complete'
            let failure: string | undefined
            const pending: ChatConversation = {
                ...conversation,
                title: !conversation.task && !history.some(message => message.role === 'user') ? prompt.slice(0, 64) : conversation.title,
                messages: [...history, user],
                updatedAt: now,
                activeRequestId: input.requestId,
                ...(mode === 'task-start' && !conversation.task!.started
                    ? { task: { ...conversation.task!, started: true, status: 'in-progress' as const } }
                    : {}),
            }
            await this.store.save(scope, pending)
            emit({ type: 'start', conversationId: id, requestId: input.requestId })
            try {
                const result = await this.runtime.run({
                    scope,
                    conversationId: id,
                    history,
                    ...(conversation.agent ? { agent: conversation.agent } : {}),
                    content: prompt,
                    signal: controller.signal,
                    onDelta: delta => {
                        if (delta.type === 'delta') content += delta.text
                        else reasoning += delta.text
                        emit(delta)
                    },
                })
                content = result.content
                reasoning = result.reasoning
                status = result.status
            } catch (error) {
                status = controller.signal.aborted ? 'cancelled' : 'error'
                if (status === 'error') failure = errorMessage(error)
            }
            const settled = { ...pending }
            delete settled.activeRequestId
            const assistant: ChatMessage = {
                id: `${input.requestId}:assistant`,
                role: 'assistant',
                content,
                status,
                ...(reasoning ? { reasoning } : {}),
                createdAt: new Date().toISOString(),
                requestId: input.requestId,
            }
            const result: ChatConversation = { ...settled, messages: [...history, user, assistant], updatedAt: assistant.createdAt }
            await this.store.save(scope, result)
            done.resolve(result)
            if (failure) emit({ type: 'error', message: failure })
            else emit({ type: status === 'cancelled' ? 'cancelled' : 'done', conversation: result })
        } catch (error) {
            done.reject(error)
            throw error
        } finally {
            signal.removeEventListener('abort', abort)
            this.turns.delete(key)
        }
    }

    /**
     * Cancel an owned running turn and wait for its partial answer to be saved.
     * @param scope - Trusted identity.
     * @param id - Conversation UUID.
     * @param requestId - Exact request to cancel, preventing stale buttons from cancelling newer work.
     * @returns The settled conversation, or its current snapshot when no turn is active.
     * @throws ConflictException when the supplied id targets a different live turn.
     */
    async cancel(scope: ChatScope, id: string, requestId: string): Promise<ChatConversation> {
        await this.get(scope, id)
        const active = this.turns.get(turnKey(scope, id))
        if (!active) return this.get(scope, id)
        if (active.requestId !== requestId) throw new ConflictException('这条请求已结束，请刷新对话。')
        active.controller.abort()
        return active.done
    }

    /**
     * Cancel the exact owned task turn and await its persisted partial response.
     * @param scope - Authenticated user and workspace context.
     * @param id - Stable task identifier.
     * @param requestId - Exact turn to cancel, preventing stale actions from affecting newer work.
     * @returns The settled task or its current snapshot when no turn is running.
     * @throws NotFoundException when the task is absent or inaccessible.
     * @throws ConflictException when another live request owns the task.
     */
    async cancelTask(scope: ChatScope, id: string, requestId: string): Promise<PersonalTask> {
        await this.getTask(scope, id)
        const active = this.turns.get(turnKey(scope, id))
        if (!active) return this.getTask(scope, id)
        if (active.requestId !== requestId) throw new ConflictException('这条请求已结束，请刷新任务。')
        active.controller.abort()
        return personalTaskSchema.parse(await active.done)
    }

    /**
     * Stop active turns before closing shared runtime and storage resources.
     * @returns After all owned work and connections have been released.
     */
    close(): Promise<void> {
        this.closing ??= this.releaseResources()
        return this.closing
    }

    /**
     * Drain active requests and release initialized process resources once.
     * @returns After runtime sessions and database connections are closed.
     */
    private async releaseResources(): Promise<void> {
        for (const activity of this.turns.values()) activity.controller.abort()
        await Promise.allSettled([...this.turns.values()].map(activity => activity.done))
        await Promise.allSettled([...this.mutations.values()])
        await this.runtime?.dispose()
        await this.store.close()
    }

    /**
     * Release owned resources when Nest receives a process shutdown signal.
     * @returns The shared shutdown promise.
     */
    onApplicationShutdown(): Promise<void> {
        return this.close()
    }
}
