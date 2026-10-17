import {
    agentDefinitionSchema,
    chatConversationSchema,
    personalProjectSchema,
    personalTaskSchema,
    projectTemplateSchema,
    projectInputSchema,
    templateInputSchema,
    launchTemplateSchema,
    templateLaunchResultSchema,
    type AgentDefinition,
    type ChatConversation,
    type PersonalProject,
    type ProjectInput,
    type PersonalTask,
    type ProjectTemplate,
    type TemplateInput,
} from '@ai-harness/contracts'
import pg from 'pg'

export interface ChatScope {
    userId: string
    workspaceId: string
}

export interface ChatStore {
    agents?: AgentStore
    projects?: ProjectStore
    templates?: ProjectTemplateStore
    /**
     * Creates a project, its initial tasks, and the successful template launch atomically.
     * @param scope - Authenticated ownership context for every batch record.
     * @param batch - Complete new project, task snapshots, and launch identity.
     * @returns After every record has been committed together.
     * @throws TemplateConflictError for stale versions or existing identifiers.
     * @throws Error for invalid data, missing scope, or storage failure.
     */
    instantiateTemplateProject?(scope: ChatScope, batch: TemplateProjectBatch): Promise<void>
    /**
     * Lists conversations belonging to a trusted user and workspace.
     * @param scope - Authenticated user and workspace context.
     * @returns Conversations ordered by their most recent update first.
     * @throws Error when the scope is missing or storage is unavailable.
     */
    list(scope: ChatScope): Promise<ChatConversation[]>
    /**
     * Looks up a conversation within a trusted user and workspace.
     * @param scope - Authenticated user and workspace context.
     * @param id - Conversation identifier.
     * @returns The conversation when owned by this scope, otherwise undefined.
     * @throws Error when the scope is missing or storage is unavailable.
     */
    get(scope: ChatScope, id: string): Promise<ChatConversation | undefined>
    /**
     * Replaces a conversation snapshot within the authenticated scope.
     * @param scope - Authenticated user and workspace context.
     * @param conversation - Complete validated conversation snapshot to save.
     * @returns A promise that resolves after the snapshot is stored.
     * @throws Error for invalid scope, invalid conversation data, or storage failure.
     */
    save(scope: ChatScope, conversation: ChatConversation): Promise<void>
    /**
     * Releases storage resources during application shutdown.
     * @returns A promise that resolves after resources have been released.
     * @throws Error if a database connection cannot be closed.
     */
    close(): Promise<void>
}

export interface AgentStore {
    /**
     * Lists agent definitions belonging to a trusted user and workspace.
     * @param scope - Authenticated ownership context.
     * @returns Independent agent snapshots ordered by most recent update.
     * @throws Error for missing ownership or storage failure.
     */
    list(scope: ChatScope): Promise<AgentDefinition[]>
    /**
     * Reads an agent definition within its trusted ownership scope.
     * @param scope - Authenticated ownership context.
     * @param id - Agent identifier.
     * @returns An independent snapshot when this scope owns the agent.
     * @throws Error for missing ownership or storage failure.
     */
    get(scope: ChatScope, id: string): Promise<AgentDefinition | undefined>
    /**
     * Saves a complete agent definition within its trusted ownership scope.
     * @param scope - Authenticated ownership context.
     * @param agent - Complete validated agent definition.
     * @returns After the definition has been stored.
     * @throws Error for invalid ownership, invalid agent data, or storage failure.
     */
    save(scope: ChatScope, agent: AgentDefinition): Promise<void>
}

export interface StoredProject {
    project: PersonalProject
    creation: ProjectInput
}

export interface ProjectStore {
    /**
     * Lists project records belonging to a trusted user and workspace.
     * @param scope - Authenticated ownership context.
     * @returns Independent records ordered by most recent project update.
     * @throws Error for missing ownership, invalid stored data, or storage failure.
     */
    list(scope: ChatScope): Promise<StoredProject[]>
    /**
     * Reads a project and its original creation parameters within its scope.
     * @param scope - Authenticated ownership context.
     * @param id - Project identifier.
     * @returns An independent owned record when present.
     * @throws Error for missing ownership, invalid stored data, or storage failure.
     */
    get(scope: ChatScope, id: string): Promise<StoredProject | undefined>
    /**
     * Saves current project data and original creation parameters together.
     * @param scope - Authenticated ownership context.
     * @param record - Complete project record including immutable creation input.
     * @returns After the validated record has been stored.
     * @throws Error for invalid ownership, invalid data, or storage failure.
     */
    save(scope: ChatScope, record: StoredProject): Promise<void>
}

export interface StoredProjectTemplate {
    template: ProjectTemplate
    creation: TemplateInput
}

export interface StoredTemplateLaunch {
    requestId: string
    templateId: string
    version: number
    input: ProjectInput
    taskIds: string[]
}

export interface TemplateProjectBatch {
    project: StoredProject
    tasks: PersonalTask[]
    launch: StoredTemplateLaunch
}

export interface ProjectTemplateStore {
    /**
     * Lists template records within the trusted ownership scope.
     * @param scope - Authenticated ownership context.
     * @returns Independent records ordered by latest template update.
     * @throws Error for missing scope, invalid stored data, or storage failure.
     */
    list(scope: ChatScope): Promise<StoredProjectTemplate[]>
    /**
     * Reads a template and its original creation parameters within its scope.
     * @param scope - Authenticated ownership context.
     * @param id - Template identifier.
     * @returns An independent record when owned by this scope.
     * @throws Error for missing scope, invalid stored data, or storage failure.
     */
    get(scope: ChatScope, id: string): Promise<StoredProjectTemplate | undefined>
    /**
     * Inserts a new version-one template or updates the expected existing version.
     * @param scope - Authenticated ownership context.
     * @param record - Current template and its original creation parameters.
     * @param expectedVersion - Existing version required for an update; omitted for insertion.
     * @returns After the validated template has been stored without changing creation parameters.
     * @throws TemplateConflictError when the identifier or expected version conflicts.
     * @throws Error for invalid scope, data, or storage failure.
     */
    save(scope: ChatScope, record: StoredProjectTemplate, expectedVersion?: number): Promise<void>
    /**
     * Reads a successful template launch without exposing another ownership scope.
     * @param scope - Authenticated ownership context.
     * @param requestId - Launch action identifier, also used as the project identifier.
     * @returns Independent original launch parameters and task identifiers when owned.
     * @throws Error for missing scope, invalid stored data, or storage failure.
     */
    getLaunch(scope: ChatScope, requestId: string): Promise<StoredTemplateLaunch | undefined>
}

export class TemplateConflictError extends Error {
    /**
     * Identifies a template version or unique-identifier conflict for API error mapping.
     * @param message - Safe description of the conflicting template operation.
     */
    constructor(message = 'Template version or identifier conflicts with existing data.') {
        super(message)
        this.name = 'TemplateConflictError'
    }
}

export interface ChatStoreOptions {
    databaseUrl?: string
    allowMemory?: boolean
}

interface ConversationRow {
    id: string
    title: string
    created_at: Date | string
    updated_at: Date | string
    messages: unknown
    active_request_id: string | null
    agent_definition?: unknown
    task_data?: unknown
}

interface AgentRow {
    data: unknown
}

interface ProjectRow {
    data: unknown
}

/**
 * Requires a nonempty trusted identity before any scoped storage access.
 * @param scope - Authenticated user and workspace context.
 * @returns Nothing when both ownership fields are present.
 * @throws Error when the user or workspace is absent.
 */
function validateScope(scope: ChatScope): void {
    if (!scope?.userId?.trim() || !scope.workspaceId?.trim()) {
        throw new Error('Chat storage requires a trusted userId and workspaceId.')
    }
}

/**
 * Creates an unambiguous key for a scoped in-memory conversation.
 * @param scope - Authenticated user and workspace context.
 * @param id - Conversation identifier.
 * @returns A serialized ownership and conversation tuple.
 * @throws Error when the ownership context is missing.
 */
function memoryKey(scope: ChatScope, id: string): string {
    validateScope(scope)
    return JSON.stringify([scope.workspaceId, scope.userId, id])
}

/**
 * Validates complete conversation snapshots and requires frozen agents for tasks.
 * @param value - Untrusted incoming or persisted conversation snapshot.
 * @returns A valid ordinary conversation or a complete personal task snapshot.
 * @throws Error when conversation data or the required task agent is invalid.
 */
function validateConversation(value: unknown): ChatConversation {
    const snapshot = chatConversationSchema.parse(value)
    return snapshot.task ? personalTaskSchema.parse(snapshot) : snapshot
}

/**
 * Validates current project fields and the server-only original creation input.
 * @param value - Untrusted incoming or persisted project record.
 * @returns A strictly validated project record with normalized input fields.
 * @throws Error when either record section is malformed or has unknown fields.
 */
function validateProject(value: unknown): StoredProject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Project storage requires a complete project record.')
    }
    const record = value as Record<string, unknown>
    if (Object.keys(record).some(key => key !== 'project' && key !== 'creation')) {
        throw new Error('Project storage record contains unknown fields.')
    }
    return {
        project: personalProjectSchema.parse(record.project),
        creation: projectInputSchema.parse(record.creation),
    }
}

/**
 * Requires an internal record to contain only its explicitly supported sections.
 * @param value - Untrusted persisted or incoming internal record.
 * @param keys - Permitted record property names.
 * @returns The candidate object for section validation.
 * @throws Error when the candidate is not a record or contains unknown properties.
 */
function internalRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
        throw new Error('Template storage requires a complete record without unknown fields.')
    }
    return value as Record<string, unknown>
}

/**
 * Validates a complete template and its immutable original creation input.
 * @param value - Untrusted incoming or persisted template record.
 * @returns A strictly validated template record with normalized fields.
 * @throws Error when either section or the record shape is invalid.
 */
function validateTemplate(value: unknown): StoredProjectTemplate {
    const record = internalRecord(value, ['template', 'creation'])
    return { template: projectTemplateSchema.parse(record.template), creation: templateInputSchema.parse(record.creation) }
}

/**
 * Validates the version progression required for insertion or compare-and-swap.
 * @param record - Fully validated current template record.
 * @param expectedVersion - Prior version for an update, or absent for insertion.
 * @returns Nothing when the new version is the required next integer.
 * @throws TemplateConflictError when the version transition is invalid.
 */
function validateTemplateVersion(record: StoredProjectTemplate, expectedVersion?: number): void {
    if (
        (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) ||
        record.template.version !== (expectedVersion === undefined ? 1 : expectedVersion + 1)
    ) {
        throw new TemplateConflictError('Template version must advance from the expected version.')
    }
}

/**
 * Validates internal original launch parameters and the ordered generated task identifiers.
 * @param value - Untrusted incoming or persisted launch record.
 * @returns A strictly validated independent launch record.
 * @throws Error when the shape, identifiers, version, or project parameters are invalid.
 */
function validateLaunch(value: unknown): StoredTemplateLaunch {
    const record = internalRecord(value, ['requestId', 'templateId', 'version', 'input', 'taskIds'])
    const input = projectInputSchema.parse(record.input)
    const launch = launchTemplateSchema.parse({ ...input, requestId: record.requestId, version: record.version })
    const taskIds = templateLaunchResultSchema.shape.taskIds.parse(record.taskIds)
    if (new Set(taskIds).size !== taskIds.length) throw new Error('Template launch task identifiers must be unique.')
    return {
        requestId: launch.requestId,
        templateId: personalProjectSchema.shape.id.parse(record.templateId),
        version: launch.version,
        input,
        taskIds,
    }
}

/**
 * Validates every initial record and their shared project and launch relationships.
 * @param value - Candidate atomic template instantiation batch.
 * @returns A complete independent batch safe to stage or write in a transaction.
 * @throws Error for malformed records, duplicate tasks, or inconsistent initial relationships.
 */
function validateTemplateBatch(value: TemplateProjectBatch): TemplateProjectBatch {
    const project = validateProject(value.project)
    const launch = validateLaunch(value.launch)
    const tasks = value.tasks.map(task => personalTaskSchema.parse(task))
    const origin = project.project.templateOrigin
    if (
        project.project.id !== launch.requestId ||
        JSON.stringify(project.creation) !== JSON.stringify(launch.input) ||
        !origin ||
        origin.templateId !== launch.templateId ||
        origin.version !== launch.version ||
        JSON.stringify(origin.taskIds) !== JSON.stringify(launch.taskIds) ||
        tasks.length !== launch.taskIds.length ||
        tasks.some(
            (task, index) =>
                task.id !== launch.taskIds[index] ||
                task.task.projectId !== project.project.id ||
                task.task.creationProjectId !== project.project.id ||
                task.task.started ||
                task.task.status !== 'not-started' ||
                task.activeRequestId !== undefined ||
                task.messages.some(message => message.role !== 'assistant' || message.kind !== 'opening')
        )
    ) {
        throw new Error('Template launch records must describe one complete unstarted project and its ordered tasks.')
    }
    return structuredClone({ project, tasks, launch })
}

/**
 * Translates PostgreSQL unique-key conflicts while retaining unrelated storage errors.
 * @param error - Error raised while inserting or updating template records.
 * @returns A recognized conflict error or the original failure.
 */
function templateStorageError(error: unknown): unknown {
    return error && typeof error === 'object' && 'code' in error && error.code === '23505' ? new TemplateConflictError() : error
}

/**
 * Serializes a complete conversation for the shared scoped SQL column order.
 * @param scope - Authenticated ownership context.
 * @param snapshot - Validated complete conversation or task snapshot.
 * @returns Parameter values for a single conversation insert or upsert.
 */
function conversationParameters(scope: ChatScope, snapshot: ChatConversation): unknown[] {
    return [
        scope.workspaceId,
        scope.userId,
        snapshot.id,
        snapshot.title,
        snapshot.createdAt,
        snapshot.updatedAt,
        JSON.stringify(snapshot.messages),
        snapshot.activeRequestId ?? null,
        snapshot.agent ? JSON.stringify(snapshot.agent) : null,
        snapshot.task ? JSON.stringify(snapshot.task) : null,
    ]
}

/**
 * Creates an explicit, process-local store for development and tests.
 * @returns A scoped store whose records are lost when the process exits.
 */
function createMemoryStore(): ChatStore {
    let conversations = new Map<string, { scope: ChatScope; conversation: ChatConversation }>()
    const agents = new Map<string, { scope: ChatScope; agent: AgentDefinition }>()
    let projects = new Map<string, { scope: ChatScope; record: StoredProject }>()
    const templates = new Map<string, { scope: ChatScope; record: StoredProjectTemplate }>()
    let launches = new Map<string, { scope: ChatScope; launch: StoredTemplateLaunch }>()
    return {
        templates: {
            /**
             * Lists independent template snapshots owned by the complete trusted scope.
             * @param scope - Authenticated ownership context.
             * @returns Template records ordered by latest update and stable identifier.
             * @throws Error when ownership is missing.
             */
            async list(scope) {
                validateScope(scope)
                return [...templates.values()]
                    .filter(entry => entry.scope.userId === scope.userId && entry.scope.workspaceId === scope.workspaceId)
                    .map(entry => structuredClone(entry.record))
                    .sort(
                        (first, second) =>
                            second.template.updatedAt.localeCompare(first.template.updatedAt) ||
                            first.template.id.localeCompare(second.template.id)
                    )
            },
            /**
             * Reads an independent template and its original creation parameters.
             * @param scope - Authenticated ownership context.
             * @param id - Template identifier.
             * @returns The owned record when present.
             * @throws Error when ownership is missing.
             */
            async get(scope, id) {
                const record = templates.get(memoryKey(scope, id))?.record
                return record ? structuredClone(record) : undefined
            },
            /**
             * Inserts or compare-and-swaps a template without changing original creation parameters.
             * @param scope - Authenticated ownership context.
             * @param record - Complete current template and creation parameters.
             * @param expectedVersion - Existing version required for update; absent for creation.
             * @returns After the new current record has been published.
             * @throws TemplateConflictError for an existing identifier or mismatched version.
             * @throws Error when scope or record validation fails.
             */
            async save(scope, record, expectedVersion) {
                validateScope(scope)
                const snapshot = validateTemplate(record)
                validateTemplateVersion(snapshot, expectedVersion)
                const key = memoryKey(scope, snapshot.template.id)
                const current = templates.get(key)?.record
                if (expectedVersion === undefined ? current !== undefined : current?.template.version !== expectedVersion) {
                    throw new TemplateConflictError()
                }
                const creation = current?.creation ?? snapshot.creation
                templates.set(key, { scope: { ...scope }, record: structuredClone({ ...snapshot, creation }) })
            },
            /**
             * Reads original successful launch parameters from this scope only.
             * @param scope - Authenticated ownership context.
             * @param requestId - Original launch action identifier.
             * @returns An independent launch record when owned.
             * @throws Error when ownership is missing.
             */
            async getLaunch(scope, requestId) {
                const launch = launches.get(memoryKey(scope, requestId))?.launch
                return launch ? structuredClone(launch) : undefined
            },
        },
        /**
         * Stages a full template project batch and publishes every map without an asynchronous boundary.
         * @param scope - Authenticated ownership context for all records.
         * @param batch - New project, ordered initial task snapshots, and successful launch action.
         * @returns After every validated snapshot has become visible together.
         * @throws TemplateConflictError for stale template versions or existing identifiers.
         * @throws Error when scope, snapshots, or initial relationships are invalid.
         */
        async instantiateTemplateProject(scope, batch) {
            validateScope(scope)
            const snapshot = validateTemplateBatch(batch)
            const current = templates.get(memoryKey(scope, snapshot.launch.templateId))?.record
            if (!current || current.template.version !== snapshot.launch.version) throw new TemplateConflictError()
            const projectKey = memoryKey(scope, snapshot.project.project.id)
            const launchKey = memoryKey(scope, snapshot.launch.requestId)
            if (projects.has(projectKey) || launches.has(launchKey)) throw new TemplateConflictError()
            const stagedProjects = new Map(projects)
            const stagedConversations = new Map(conversations)
            const stagedLaunches = new Map(launches)
            stagedProjects.set(projectKey, { scope: { ...scope }, record: snapshot.project })
            for (const task of snapshot.tasks) {
                const key = memoryKey(scope, task.id)
                if (stagedConversations.has(key)) throw new TemplateConflictError()
                stagedConversations.set(key, { scope: { ...scope }, conversation: task })
            }
            stagedLaunches.set(launchKey, { scope: { ...scope }, launch: snapshot.launch })
            projects = stagedProjects
            conversations = stagedConversations
            launches = stagedLaunches
        },
        projects: {
            /**
             * Lists independent project records within the complete ownership scope.
             * @param scope - Authenticated ownership context.
             * @returns Records sorted by project update and stable identifier.
             * @throws Error when ownership is missing.
             */
            async list(scope) {
                validateScope(scope)
                return [...projects.values()]
                    .filter(entry => entry.scope.userId === scope.userId && entry.scope.workspaceId === scope.workspaceId)
                    .map(entry => structuredClone(entry.record))
                    .sort(
                        (first, second) =>
                            second.project.updatedAt.localeCompare(first.project.updatedAt) ||
                            first.project.id.localeCompare(second.project.id)
                    )
            },
            /**
             * Reads a copy of an owned current project and its creation parameters.
             * @param scope - Authenticated ownership context.
             * @param id - Project identifier.
             * @returns An independent record when the project belongs to this scope.
             * @throws Error when ownership is missing.
             */
            async get(scope, id) {
                const record = projects.get(memoryKey(scope, id))?.record
                return record ? structuredClone(record) : undefined
            },
            /**
             * Validates and stores a complete independent project record.
             * @param scope - Authenticated ownership context.
             * @param record - Current project and original creation input.
             * @returns After the record has been saved.
             * @throws Error when ownership or record validation fails.
             */
            async save(scope, record) {
                validateScope(scope)
                const snapshot = validateProject(record)
                projects.set(memoryKey(scope, snapshot.project.id), { scope: { ...scope }, record: structuredClone(snapshot) })
            },
        },
        agents: {
            /**
             * Lists independent agent snapshots belonging to this ownership scope.
             * @param scope - Authenticated ownership context.
             * @returns Agents sorted by the most recent update.
             * @throws Error when ownership is missing.
             */
            async list(scope) {
                validateScope(scope)
                return [...agents.values()]
                    .filter(entry => entry.scope.userId === scope.userId && entry.scope.workspaceId === scope.workspaceId)
                    .map(entry => structuredClone(entry.agent))
                    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt) || first.id.localeCompare(second.id))
            },
            /**
             * Reads an independent agent snapshot by its complete ownership key.
             * @param scope - Authenticated ownership context.
             * @param id - Agent identifier.
             * @returns The owned agent snapshot when present.
             * @throws Error when ownership is missing.
             */
            async get(scope, id) {
                const agent = agents.get(memoryKey(scope, id))?.agent
                return agent ? structuredClone(agent) : undefined
            },
            /**
             * Validates and stores an independent agent snapshot.
             * @param scope - Authenticated ownership context.
             * @param agent - Complete agent definition.
             * @returns After the snapshot has been saved.
             * @throws Error when ownership or definition validation fails.
             */
            async save(scope, agent) {
                const key = memoryKey(scope, agent.id)
                const snapshot = agentDefinitionSchema.parse(agent)
                agents.set(key, { scope: { ...scope }, agent: structuredClone(snapshot) })
            },
        },
        /**
         * Lists independent snapshots owned by the requested scope.
         * @param scope - Authenticated user and workspace context.
         * @returns Conversation copies sorted by most recent update first.
         * @throws Error when the scope is missing.
         */
        async list(scope) {
            validateScope(scope)
            return [...conversations.values()]
                .filter(entry => entry.scope.userId === scope.userId && entry.scope.workspaceId === scope.workspaceId)
                .map(entry => structuredClone(entry.conversation))
                .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
        },
        /**
         * Reads an independent snapshot by its complete ownership key.
         * @param scope - Authenticated user and workspace context.
         * @param id - Conversation identifier.
         * @returns A conversation copy when this scope owns it.
         * @throws Error when the scope is missing.
         */
        async get(scope, id) {
            const conversation = conversations.get(memoryKey(scope, id))?.conversation
            return conversation ? structuredClone(conversation) : undefined
        },
        /**
         * Validates and saves an independent snapshot under its ownership key.
         * @param scope - Authenticated user and workspace context.
         * @param conversation - Complete conversation snapshot.
         * @returns A promise that resolves after the snapshot is saved.
         * @throws Error when scope or conversation validation fails.
         */
        async save(scope, conversation) {
            const key = memoryKey(scope, conversation.id)
            const snapshot = validateConversation(conversation)
            conversations.set(key, { scope: { ...scope }, conversation: structuredClone(snapshot) })
        },
        /**
         * Releases process-local conversation records.
         * @returns A promise that resolves after the records have been discarded.
         */
        async close() {
            conversations.clear()
            agents.clear()
            projects.clear()
            templates.clear()
            launches.clear()
        },
    }
}

/**
 * Converts a PostgreSQL timestamp into the public ISO timestamp format.
 * @param value - Timestamp returned by the PostgreSQL driver.
 * @returns A normalized ISO timestamp string.
 * @throws RangeError if the database contains an invalid timestamp.
 */
function timestamp(value: Date | string): string {
    return new Date(value).toISOString()
}

/**
 * Validates a persisted record before exposing it to API consumers.
 * @param row - PostgreSQL conversation record.
 * @returns A public conversation with normalized timestamps.
 * @throws Error when persisted conversation data is invalid.
 */
function conversationFromRow(row: ConversationRow): ChatConversation {
    const agent = row.agent_definition ? agentDefinitionSchema.parse(row.agent_definition) : undefined
    return validateConversation({
        id: row.id,
        title: row.title,
        createdAt: timestamp(row.created_at),
        updatedAt: timestamp(row.updated_at),
        messages: row.messages,
        ...(row.active_request_id ? { activeRequestId: row.active_request_id } : {}),
        ...(agent ? { agentId: agent.id, agent } : {}),
        ...(row.task_data !== null && row.task_data !== undefined ? { task: row.task_data } : {}),
    })
}

/**
 * Initializes the PostgreSQL conversation table once per application store.
 * @param pool - Shared application PostgreSQL connection pool.
 * @returns A promise that resolves when the table is available.
 * @throws Error when PostgreSQL cannot initialize the conversation table.
 */
async function initializePostgres(pool: pg.Pool): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS harness_chat_conversations (
            workspace_id text NOT NULL,
            user_id text NOT NULL,
            id uuid NOT NULL,
            title text NOT NULL,
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL,
            messages jsonb NOT NULL,
            active_request_id text,
            PRIMARY KEY (workspace_id, user_id, id)
        )
    `)
    await pool.query('ALTER TABLE harness_chat_conversations ADD COLUMN IF NOT EXISTS active_request_id text')
    await pool.query('ALTER TABLE harness_chat_conversations ADD COLUMN IF NOT EXISTS agent_definition jsonb')
    await pool.query('ALTER TABLE harness_chat_conversations ADD COLUMN IF NOT EXISTS task_data jsonb')
    await pool.query(`
        CREATE TABLE IF NOT EXISTS harness_agent_definitions (
            workspace_id text NOT NULL,
            user_id text NOT NULL,
            id uuid NOT NULL,
            data jsonb NOT NULL,
            PRIMARY KEY (workspace_id, user_id, id)
        )
    `)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS harness_personal_projects (
            workspace_id text NOT NULL,
            user_id text NOT NULL,
            id uuid NOT NULL,
            data jsonb NOT NULL,
            PRIMARY KEY (workspace_id, user_id, id)
        )
    `)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS harness_project_templates (
            workspace_id text NOT NULL,
            user_id text NOT NULL,
            id uuid NOT NULL,
            data jsonb NOT NULL,
            PRIMARY KEY (workspace_id, user_id, id)
        )
    `)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS harness_template_launches (
            workspace_id text NOT NULL,
            user_id text NOT NULL,
            id uuid NOT NULL,
            data jsonb NOT NULL,
            PRIMARY KEY (workspace_id, user_id, id)
        )
    `)
}

/**
 * Creates versioned template and launch persistence using the parent store's shared pool.
 * @param pool - Initialized PostgreSQL pool owned by the conversation store.
 * @returns Scoped template persistence with compare-and-swap updates.
 */
function createPostgresTemplateStore(pool: pg.Pool): ProjectTemplateStore {
    return {
        /**
         * Lists templates constrained by both ownership fields.
         * @param scope - Authenticated ownership context.
         * @returns Validated template records ordered by current update.
         * @throws Error for missing scope, invalid persisted data, or query failure.
         */
        async list(scope) {
            validateScope(scope)
            const result = await pool.query<ProjectRow>(
                `SELECT data FROM harness_project_templates
                 WHERE workspace_id = $1 AND user_id = $2
                 ORDER BY data->'template'->>'updatedAt' DESC, id ASC`,
                [scope.workspaceId, scope.userId]
            )
            return result.rows.map(row => validateTemplate(row.data))
        },
        /**
         * Reads one template within the trusted ownership tuple.
         * @param scope - Authenticated ownership context.
         * @param id - Template identifier.
         * @returns A validated owned template record when present.
         * @throws Error for missing scope, invalid persisted data, or query failure.
         */
        async get(scope, id) {
            validateScope(scope)
            const result = await pool.query<ProjectRow>(
                `SELECT data FROM harness_project_templates
                 WHERE workspace_id = $1 AND user_id = $2 AND id = $3`,
                [scope.workspaceId, scope.userId, id]
            )
            return result.rows[0] ? validateTemplate(result.rows[0].data) : undefined
        },
        /**
         * Inserts a template or atomically advances its expected version while preserving creation input.
         * @param scope - Authenticated ownership context.
         * @param record - Complete current template and original creation input.
         * @param expectedVersion - Existing version required for update; omitted for insertion.
         * @returns After PostgreSQL accepts the next template version.
         * @throws TemplateConflictError for unique-key or compare-and-swap conflicts.
         * @throws Error for invalid scope, invalid data, or query failure.
         */
        async save(scope, record, expectedVersion) {
            validateScope(scope)
            const snapshot = validateTemplate(record)
            validateTemplateVersion(snapshot, expectedVersion)
            try {
                if (expectedVersion === undefined) {
                    await pool.query(
                        `INSERT INTO harness_project_templates (workspace_id, user_id, id, data)
                         VALUES ($1, $2, $3, $4::jsonb)`,
                        [scope.workspaceId, scope.userId, snapshot.template.id, JSON.stringify(snapshot)]
                    )
                } else {
                    const result = await pool.query(
                        `UPDATE harness_project_templates
                         SET data = jsonb_set($4::jsonb, '{creation}', data->'creation')
                         WHERE workspace_id = $1 AND user_id = $2 AND id = $3
                         AND (data->'template'->>'version')::integer = $5
                         RETURNING id`,
                        [scope.workspaceId, scope.userId, snapshot.template.id, JSON.stringify(snapshot), expectedVersion]
                    )
                    if (!result.rows.length) throw new TemplateConflictError()
                }
            } catch (error) {
                throw templateStorageError(error)
            }
        },
        /**
         * Reads one original launch using the full ownership tuple.
         * @param scope - Authenticated ownership context.
         * @param requestId - Successful launch identifier.
         * @returns The validated original launch record when owned.
         * @throws Error for missing scope, invalid persisted data, or query failure.
         */
        async getLaunch(scope, requestId) {
            validateScope(scope)
            const result = await pool.query<ProjectRow>(
                `SELECT data FROM harness_template_launches
                 WHERE workspace_id = $1 AND user_id = $2 AND id = $3`,
                [scope.workspaceId, scope.userId, requestId]
            )
            return result.rows[0] ? validateLaunch(result.rows[0].data) : undefined
        },
    }
}

/**
 * Commits a complete template project batch with a stable template version on one client.
 * @param pool - Application-owned shared PostgreSQL pool.
 * @param scope - Authenticated ownership context for all records.
 * @param batch - New project, ordered initial tasks, and successful launch action.
 * @returns After all records have committed together.
 * @throws TemplateConflictError for stale template versions or existing identifiers.
 * @throws Error for invalid input, missing scope, or database failure; any write is rolled back.
 */
async function instantiatePostgresTemplateProject(pool: pg.Pool, scope: ChatScope, batch: TemplateProjectBatch): Promise<void> {
    validateScope(scope)
    const snapshot = validateTemplateBatch(batch)
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await client.query<ProjectRow>(
            `SELECT data FROM harness_project_templates
             WHERE workspace_id = $1 AND user_id = $2 AND id = $3 FOR SHARE`,
            [scope.workspaceId, scope.userId, snapshot.launch.templateId]
        )
        const current = result.rows[0] ? validateTemplate(result.rows[0].data) : undefined
        if (!current || current.template.version !== snapshot.launch.version) throw new TemplateConflictError()
        await client.query(
            `INSERT INTO harness_personal_projects (workspace_id, user_id, id, data)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [scope.workspaceId, scope.userId, snapshot.project.project.id, JSON.stringify(snapshot.project)]
        )
        for (const task of snapshot.tasks) {
            await client.query(
                `INSERT INTO harness_chat_conversations
                 (workspace_id, user_id, id, title, created_at, updated_at, messages, active_request_id, agent_definition, task_data)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb)`,
                conversationParameters(scope, task)
            )
        }
        await client.query(
            `INSERT INTO harness_template_launches (workspace_id, user_id, id, data)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [scope.workspaceId, scope.userId, snapshot.launch.requestId, JSON.stringify(snapshot.launch)]
        )
        await client.query('COMMIT')
    } catch (error) {
        try {
            await client.query('ROLLBACK')
        } catch {
            // Preserve the operation's original error even if a disconnected client cannot roll back.
        }
        throw templateStorageError(error)
    } finally {
        client.release()
    }
}

/**
 * Creates project persistence using the application's initialized shared pool.
 * @param pool - PostgreSQL pool owned by the conversation store.
 * @returns Scoped project storage with the parent store's lifecycle.
 */
function createPostgresProjectStore(pool: pg.Pool): ProjectStore {
    return {
        /**
         * Lists project records using both trusted ownership predicates.
         * @param scope - Authenticated ownership context.
         * @returns Strictly validated records ordered by current project update.
         * @throws Error for missing ownership, invalid persisted data, or query failure.
         */
        async list(scope) {
            validateScope(scope)
            const result = await pool.query<ProjectRow>(
                `SELECT data FROM harness_personal_projects
                 WHERE workspace_id = $1 AND user_id = $2
                 ORDER BY data->'project'->>'updatedAt' DESC, id ASC`,
                [scope.workspaceId, scope.userId]
            )
            return result.rows.map(row => validateProject(row.data))
        },
        /**
         * Reads one project constrained by its complete ownership tuple.
         * @param scope - Authenticated ownership context.
         * @param id - Project identifier.
         * @returns The validated owned project record when present.
         * @throws Error for missing ownership, invalid persisted data, or query failure.
         */
        async get(scope, id) {
            validateScope(scope)
            const result = await pool.query<ProjectRow>(
                `SELECT data FROM harness_personal_projects
                 WHERE workspace_id = $1 AND user_id = $2 AND id = $3`,
                [scope.workspaceId, scope.userId, id]
            )
            return result.rows[0] ? validateProject(result.rows[0].data) : undefined
        },
        /**
         * Replaces current project and creation input in one scoped statement.
         * @param scope - Authenticated ownership context.
         * @param record - Complete current project and original creation input.
         * @returns After PostgreSQL accepts the validated record.
         * @throws Error for missing ownership, invalid record data, or query failure.
         */
        async save(scope, record) {
            validateScope(scope)
            const snapshot = validateProject(record)
            await pool.query(
                `INSERT INTO harness_personal_projects (workspace_id, user_id, id, data)
                 VALUES ($1, $2, $3, $4::jsonb)
                 ON CONFLICT (workspace_id, user_id, id) DO UPDATE SET data = EXCLUDED.data`,
                [scope.workspaceId, scope.userId, snapshot.project.id, JSON.stringify(snapshot)]
            )
        },
    }
}

/**
 * Creates agent persistence using the application's initialized shared pool.
 * @param pool - PostgreSQL pool owned by the conversation store.
 * @returns Agent storage whose lifecycle is owned by the parent store.
 */
function createPostgresAgentStore(pool: pg.Pool): AgentStore {
    return {
        /**
         * Lists agents using both trusted ownership fields as query parameters.
         * @param scope - Authenticated ownership context.
         * @returns Validated agent definitions ordered by latest update.
         * @throws Error for missing ownership, invalid persisted data, or query failure.
         */
        async list(scope) {
            validateScope(scope)
            const result = await pool.query<AgentRow>(
                `SELECT data FROM harness_agent_definitions
                 WHERE workspace_id = $1 AND user_id = $2
                 ORDER BY data->>'updatedAt' DESC, id ASC`,
                [scope.workspaceId, scope.userId]
            )
            return result.rows.map(row => agentDefinitionSchema.parse(row.data))
        },
        /**
         * Reads one agent constrained by its complete ownership tuple.
         * @param scope - Authenticated ownership context.
         * @param id - Agent identifier.
         * @returns The validated agent when owned by this scope.
         * @throws Error for missing ownership, invalid persisted data, or query failure.
         */
        async get(scope, id) {
            validateScope(scope)
            const result = await pool.query<AgentRow>(
                `SELECT data FROM harness_agent_definitions
                 WHERE workspace_id = $1 AND user_id = $2 AND id = $3`,
                [scope.workspaceId, scope.userId, id]
            )
            return result.rows[0] ? agentDefinitionSchema.parse(result.rows[0].data) : undefined
        },
        /**
         * Replaces an agent snapshot only within its trusted ownership tuple.
         * @param scope - Authenticated ownership context.
         * @param agent - Complete agent definition.
         * @returns After PostgreSQL accepts the validated snapshot.
         * @throws Error for missing ownership, invalid data, or query failure.
         */
        async save(scope, agent) {
            validateScope(scope)
            const snapshot = agentDefinitionSchema.parse(agent)
            await pool.query(
                `INSERT INTO harness_agent_definitions (workspace_id, user_id, id, data)
                 VALUES ($1, $2, $3, $4::jsonb)
                 ON CONFLICT (workspace_id, user_id, id) DO UPDATE SET data = EXCLUDED.data`,
                [scope.workspaceId, scope.userId, snapshot.id, JSON.stringify(snapshot)]
            )
        },
    }
}

/**
 * Opens a PostgreSQL-backed store, or explicit development memory storage.
 * @param options - Server-side database connection and memory opt-in settings.
 * @returns An initialized scoped conversation store.
 * @throws Error when durable storage is unconfigured or PostgreSQL initialization fails.
 */
export async function createChatStore(options: ChatStoreOptions): Promise<ChatStore> {
    if (!options.databaseUrl?.trim()) {
        if (options.allowMemory) return createMemoryStore()
        throw new Error('Set DATABASE_URL for chat persistence, or explicitly set CHAT_STORE=memory for temporary development storage.')
    }

    const pool = new pg.Pool({ connectionString: options.databaseUrl })
    try {
        await initializePostgres(pool)
    } catch (error) {
        await pool.end()
        throw error
    }

    return {
        agents: createPostgresAgentStore(pool),
        projects: createPostgresProjectStore(pool),
        templates: createPostgresTemplateStore(pool),
        /**
         * Persists one complete template project batch using the shared pool's transaction client.
         * @param scope - Authenticated ownership context for every new record.
         * @param batch - Initial project, ordered tasks, and original launch parameters.
         * @returns After all records have committed together.
         * @throws TemplateConflictError for stale versions or existing identifiers.
         * @throws Error for invalid scope, invalid batch data, or storage failure.
         */
        async instantiateTemplateProject(scope, batch) {
            await instantiatePostgresTemplateProject(pool, scope, batch)
        },
        /**
         * Lists conversations filtered by both trusted ownership fields.
         * @param scope - Authenticated user and workspace context.
         * @returns Validated conversations ordered by their most recent update.
         * @throws Error for missing ownership, invalid stored data, or database failures.
         */
        async list(scope) {
            validateScope(scope)
            const result = await pool.query<ConversationRow>(
                `SELECT id, title, created_at, updated_at, messages, active_request_id, agent_definition, task_data
                 FROM harness_chat_conversations
                 WHERE workspace_id = $1 AND user_id = $2
                 ORDER BY updated_at DESC, id ASC`,
                [scope.workspaceId, scope.userId]
            )
            return result.rows.map(conversationFromRow)
        },
        /**
         * Reads a single conversation constrained to the trusted scope.
         * @param scope - Authenticated user and workspace context.
         * @param id - Conversation identifier.
         * @returns The validated record when this scope owns it.
         * @throws Error for missing ownership, invalid stored data, or database failures.
         */
        async get(scope, id) {
            validateScope(scope)
            const result = await pool.query<ConversationRow>(
                `SELECT id, title, created_at, updated_at, messages, active_request_id, agent_definition, task_data
                 FROM harness_chat_conversations
                 WHERE workspace_id = $1 AND user_id = $2 AND id = $3`,
                [scope.workspaceId, scope.userId, id]
            )
            return result.rows[0] ? conversationFromRow(result.rows[0]) : undefined
        },
        /**
         * Replaces a complete conversation only within its trusted ownership scope.
         * @param scope - Authenticated user and workspace context.
         * @param conversation - Complete conversation snapshot.
         * @returns A promise that resolves once the database accepts the snapshot.
         * @throws Error for missing ownership, invalid input, or database failures.
         */
        async save(scope, conversation) {
            validateScope(scope)
            const snapshot = validateConversation(conversation)
            await pool.query(
                `INSERT INTO harness_chat_conversations
                 (workspace_id, user_id, id, title, created_at, updated_at, messages, active_request_id, agent_definition, task_data)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb)
                 ON CONFLICT (workspace_id, user_id, id) DO UPDATE SET
                 title = EXCLUDED.title, created_at = EXCLUDED.created_at,
                 updated_at = EXCLUDED.updated_at, messages = EXCLUDED.messages,
                 active_request_id = EXCLUDED.active_request_id, agent_definition = EXCLUDED.agent_definition,
                 task_data = EXCLUDED.task_data`,
                conversationParameters(scope, snapshot)
            )
        },
        /**
         * Closes the shared PostgreSQL pool on application shutdown.
         * @returns A promise that resolves after all database connections close.
         * @throws Error when the driver cannot complete pool shutdown.
         */
        async close() {
            await pool.end()
        },
    }
}
