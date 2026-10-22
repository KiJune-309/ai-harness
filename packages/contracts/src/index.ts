import { z } from 'zod'
import { personMentionSchema } from './collaboration.js'
import { humanRequestSchema, humanResponseSchema } from './human-loop.js'
export * from './accounts.js'
export * from './knowledge.js'
export * from './embeddings.js'
export * from './collaboration.js'
export * from './workspaces.js'
export * from './workflow-template.js'
export * from './skills.js'
export * from './project-folders.js'
export * from './human-loop.js'
import { workflowTemplateSchema } from './workflow-template.js'
import { skillRefsSchema, skillSnapshotsSchema } from './skills.js'

export const agentToolIdSchema = z.enum(['calculator', 'current-time'])

const agentFields = {
    name: z.string().trim().min(1, '请为 Agent 起一个名字。').max(60, '名称最多 60 个字。'),
    description: z.string().trim().max(200, '简介最多 200 个字。'),
    modelId: z.string().trim().min(1, '请选择一个模型。').max(120),
    systemPrompt: z.string().max(32_000, '系统提示词最多 32000 个字。'),
    toolIds: z
        .array(agentToolIdSchema)
        .max(2)
        .refine(ids => new Set(ids).size === ids.length, '不能重复选择工具。'),
    openingMessages: z
        .array(z.string().trim().min(1, '开场消息不能为空。').max(2000, '每条开场消息最多 2000 个字。'))
        .max(5, '最多配置 5 条开场消息。'),
}

export const agentInputSchema = z.object({ ...agentFields, skillRefs: skillRefsSchema.optional() }).strict()
export const agentDefinitionSchema = z
    .object({
        ...agentFields,
        skillSnapshots: skillSnapshotsSchema.optional(),
        id: z.uuid(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()

export const agentCatalogSchema = z.object({
    defaultModelId: z.string().min(1),
    models: z.array(
        z.object({ id: z.string(), label: z.string(), provider: z.string(), available: z.boolean(), description: z.string().optional() })
    ),
    tools: z.array(z.object({ id: agentToolIdSchema, label: z.string(), description: z.string() })),
})

export type AgentToolId = z.infer<typeof agentToolIdSchema>
export type AgentInput = z.infer<typeof agentInputSchema>
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>
export type AgentCatalog = z.infer<typeof agentCatalogSchema>

export const taskStatusSchema = z.enum(['not-started', 'in-progress', 'needs-input', 'completed'])
export const pendingTaskStatusSchema = z.enum(['not-started', 'in-progress', 'needs-input'])
export const taskMetadataSchema = z
    .object({
        goal: z.string().trim().min(1).max(32_000),
        status: taskStatusSchema,
        started: z.boolean(),
        previousStatus: pendingTaskStatusSchema.optional(),
        sourceAgentId: z.uuid().optional(),
        projectId: z.uuid().optional(),
        creationProjectId: z.uuid().optional(),
    })
    .strict()
export const createTaskSchema = z
    .object({
        requestId: z.uuid(),
        title: z.string().trim().min(1, '请填写任务名称。').max(120, '任务名称最多 120 个字。'),
        goal: z.string().trim().min(1, '请填写任务目标。').max(32_000, '任务目标最多 32000 个字。'),
        agentId: z.uuid().optional(),
        projectId: z.uuid().optional(),
    })
    .strict()
export const updateTaskStatusSchema = z.union([
    z.object({ status: taskStatusSchema }).strict(),
    z.object({ restore: z.literal(true) }).strict(),
])
export type TaskStatus = z.infer<typeof taskStatusSchema>
export type TaskMetadata = z.infer<typeof taskMetadataSchema>
export type CreateTask = z.infer<typeof createTaskSchema>
export type UpdateTaskStatus = z.infer<typeof updateTaskStatusSchema>

export const projectInputSchema = z
    .object({
        name: z.string().trim().min(1, '请填写项目名称。').max(120, '项目名称最多 120 个字。'),
        description: z.string().trim().max(2000, '项目说明最多 2000 个字。'),
    })
    .strict()
export const createProjectSchema = projectInputSchema.extend({ requestId: z.uuid() })
export const personalProjectSchema = projectInputSchema.extend({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    templateOrigin: z
        .object({ templateId: z.uuid(), version: z.number().int().positive(), taskIds: z.array(z.uuid()).min(1).max(8) })
        .strict()
        .optional(),
})
export const updateTaskProjectSchema = z.object({ projectId: z.uuid().nullable() }).strict()
export type ProjectInput = z.infer<typeof projectInputSchema>
export type CreateProject = z.infer<typeof createProjectSchema>
export type PersonalProject = z.infer<typeof personalProjectSchema>
export type UpdateTaskProject = z.infer<typeof updateTaskProjectSchema>

export const templateTaskSchema = z
    .object({
        id: z.uuid(),
        title: z.string().trim().min(1, '请填写任务名称。').max(120, '任务名称最多 120 个字。'),
        goal: z.string().trim().min(1, '请填写任务目标。').max(8000, '每个任务目标最多 8000 个字。'),
        agentId: z.uuid().optional(),
    })
    .strict()
export const templateInputSchema = projectInputSchema
    .extend({
        tasks: z.array(templateTaskSchema).min(1, '至少保留一个任务。').max(8, '最多配置 8 个任务。'),
    })
    .refine(input => new Set(input.tasks.map(task => task.id)).size === input.tasks.length, {
        message: '任务条目标识不能重复。',
        path: ['tasks'],
    })
    .refine(input => input.tasks.reduce((total, task) => total + task.goal.length, 0) <= 32000, {
        message: '所有任务目标合计最多 32000 个字。',
        path: ['tasks'],
    })
export const createTemplateSchema = templateInputSchema.safeExtend({ requestId: z.uuid() })
export const updateTemplateSchema = templateInputSchema.safeExtend({ version: z.number().int().positive() })
export const projectTemplateSchema = templateInputSchema.safeExtend({
    id: z.uuid(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export const launchTemplateSchema = projectInputSchema.extend({ requestId: z.uuid(), version: z.number().int().positive() })
export const templateLaunchResultSchema = z.object({ project: personalProjectSchema, taskIds: z.array(z.uuid()).min(1).max(8) }).strict()
export type TemplateTask = z.infer<typeof templateTaskSchema>
export const templateCatalogEntrySchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('personal'), template: projectTemplateSchema }).strict(),
    z.object({ kind: z.literal('workflow'), template: workflowTemplateSchema }).strict(),
])
export type TemplateCatalogEntry = z.infer<typeof templateCatalogEntrySchema>
export type TemplateInput = z.infer<typeof templateInputSchema>
export type CreateTemplate = z.infer<typeof createTemplateSchema>
export type UpdateTemplate = z.infer<typeof updateTemplateSchema>
export type ProjectTemplate = z.infer<typeof projectTemplateSchema>
export type LaunchTemplate = z.infer<typeof launchTemplateSchema>
export type TemplateLaunchResult = z.infer<typeof templateLaunchResultSchema>

export const chatMessageSchema = z.object({
    id: z.string().min(1),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    reasoning: z.string().optional(),
    status: z.enum(['complete', 'cancelled', 'error']),
    createdAt: z.iso.datetime(),
    requestId: z.uuid().optional(),
    kind: z.enum(['opening', 'relay']).optional(),
})

export const chatConversationSchema = z.object({
    id: z.uuid(),
    title: z.string().min(1).max(128),
    messages: z.array(chatMessageSchema),
    humanRequests: z.array(humanRequestSchema).optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    activeRequestId: z.uuid().optional(),
    projectFolderId: z
        .uuid()
        .transform(value => value.toLowerCase())
        .optional(),
    agentId: z.uuid().optional(),
    agent: agentDefinitionSchema.optional(),
    task: taskMetadataSchema.optional(),
})

export const personalTaskSchema = chatConversationSchema.extend({ task: taskMetadataSchema, agent: agentDefinitionSchema })
export type PersonalTask = z.infer<typeof personalTaskSchema>
export const projectDetailSchema = z.object({ project: personalProjectSchema, tasks: z.array(personalTaskSchema) }).strict()
export type ProjectDetail = z.infer<typeof projectDetailSchema>

export const chatStatusSchema = z.object({
    configured: z.boolean(),
    model: z.string(),
    storage: z.literal('postgres'),
})

export const createConversationSchema = z
    .object({
        title: z.string().trim().min(1).max(128).optional(),
        agentId: z.uuid().optional(),
        projectFolderId: z
            .uuid()
            .transform(value => value.toLowerCase())
            .optional(),
        requestId: z
            .uuid()
            .transform(value => value.toLowerCase())
            .optional(),
    })
    .strict()
export const sendChatMessageSchema = z
    .object({
        content: z.string().trim().min(1).max(32_000),
        requestId: z.uuid(),
        mentions: z.array(personMentionSchema).max(20).optional(),
        humanResponse: humanResponseSchema.optional(),
    })
    .strict()
export const cancelChatMessageSchema = z.object({ requestId: z.uuid() }).strict()
export const deleteConversationResultSchema = z.object({ id: z.uuid(), deleted: z.literal(true) }).strict()

export const chatStreamEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('start'), conversationId: z.uuid(), requestId: z.uuid() }),
    z.object({ type: z.literal('delta'), text: z.string() }),
    z.object({ type: z.literal('reasoning'), text: z.string() }),
    z.object({ type: z.literal('done'), conversation: chatConversationSchema }),
    z.object({ type: z.literal('cancelled'), conversation: chatConversationSchema }),
    z.object({ type: z.literal('error'), message: z.string() }),
])

export type ChatMessage = z.infer<typeof chatMessageSchema>
export type ChatConversation = z.infer<typeof chatConversationSchema>
export type ChatStatus = z.infer<typeof chatStatusSchema>
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>
export type SendChatMessage = z.infer<typeof sendChatMessageSchema>
