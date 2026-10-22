import { z } from 'zod'

const identity = z.uuid().toLowerCase()
export const workflowPositionSchema = z.object({ x: z.number().int().min(0).max(1000), y: z.number().int().min(0).max(1000) }).strict()
export const workflowTemplateNodeSchema = z
    .object({
        id: identity,
        title: z.string().trim().min(1).max(120),
        goal: z.string().trim().min(1).max(8000),
        assigneeId: identity,
        upstreamNodeId: identity.nullable(),
        position: workflowPositionSchema,
    })
    .strict()
export const workflowTemplateInputSchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000),
        nodes: z.array(workflowTemplateNodeSchema).min(2).max(8),
    })
    .strict()
    .superRefine((value, context) => {
        const ids = new Set(value.nodes.map(node => node.id))
        if (ids.size !== value.nodes.length) context.addIssue({ code: 'custom', path: ['nodes'], message: '节点编号不能重复。' })
        if (value.nodes.reduce((sum, node) => sum + node.goal.length, 0) > 32_000)
            context.addIssue({ code: 'custom', path: ['nodes'], message: '工作说明合计不能超过32000字。' })
        if (value.nodes.filter(node => node.upstreamNodeId === null).length !== 1)
            context.addIssue({ code: 'custom', path: ['nodes'], message: '流程必须恰好有一个起点。' })
        const nodes = new Map(value.nodes.map(node => [node.id, node]))
        for (const [index, node] of value.nodes.entries()) {
            if (node.upstreamNodeId && (!ids.has(node.upstreamNodeId) || node.upstreamNodeId === node.id))
                context.addIssue({ code: 'custom', path: ['nodes', index, 'upstreamNodeId'], message: '请选择有效的其他上游节点。' })
            const visited = new Set<string>([node.id])
            let parent = node.upstreamNodeId
            while (parent && nodes.has(parent)) {
                if (visited.has(parent)) {
                    context.addIssue({ code: 'custom', path: ['nodes', index, 'upstreamNodeId'], message: '上下游关系不能形成环。' })
                    break
                }
                visited.add(parent)
                parent = nodes.get(parent)!.upstreamNodeId
            }
        }
    })
export const createWorkflowTemplateSchema = workflowTemplateInputSchema.safeExtend({ requestId: identity })
export const updateWorkflowTemplateSchema = workflowTemplateInputSchema.safeExtend({ version: z.number().int().positive() })
export const workflowTemplateReadNodeSchema = workflowTemplateNodeSchema.extend({ assigneeName: z.string(), assigneeActive: z.boolean() })
export const workflowTemplateSchema = z
    .object({
        id: identity,
        name: z.string(),
        description: z.string(),
        nodes: z.array(workflowTemplateReadNodeSchema).min(2).max(8),
        version: z.number().int().positive(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const createWorkflowPreviewSchema = z
    .object({
        version: z.number().int().positive(),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000),
        assignees: z
            .array(z.object({ nodeId: identity, assigneeId: identity }).strict())
            .max(8)
            .optional(),
    })
    .strict()
    .refine(
        value => !value.assignees || new Set(value.assignees.map(node => node.nodeId)).size === value.assignees.length,
        '节点处理人不能重复指定。'
    )
export const workflowPreviewSchema = z
    .object({
        previewId: identity,
        templateId: identity,
        version: z.number().int().positive(),
        project: z.object({ name: z.string(), description: z.string() }).strict(),
        nodes: z
            .array(workflowTemplateReadNodeSchema.extend({ opening: z.string().nullable() }))
            .min(2)
            .max(8),
        members: z.array(z.object({ userId: identity, displayName: z.string(), role: z.enum(['owner', 'member']) }).strict()),
        scope: z.string(),
        createdAt: z.iso.datetime(),
    })
    .strict()
export const workflowLaunchSchema = z.object({ requestId: identity, previewId: identity }).strict()
export const workflowLaunchResultSchema = z.object({ projectId: identity, nodeIds: z.array(identity).min(2).max(8) }).strict()
export const workflowNodeOriginSchema = z
    .object({ templateId: identity, version: z.number().int().positive(), nodeId: identity, position: workflowPositionSchema })
    .strict()

export type WorkflowTemplateInput = z.infer<typeof workflowTemplateInputSchema>
export type CreateWorkflowTemplate = z.infer<typeof createWorkflowTemplateSchema>
export type UpdateWorkflowTemplate = z.infer<typeof updateWorkflowTemplateSchema>
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>
export type CreateWorkflowPreview = z.infer<typeof createWorkflowPreviewSchema>
export type WorkflowPreview = z.infer<typeof workflowPreviewSchema>
export type WorkflowLaunch = z.infer<typeof workflowLaunchSchema>
export type WorkflowLaunchResult = z.infer<typeof workflowLaunchResultSchema>
