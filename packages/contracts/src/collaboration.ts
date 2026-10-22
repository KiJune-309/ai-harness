import { z } from 'zod'
import { workflowNodeOriginSchema } from './workflow-template.js'

export const collaborationSourceSchema = z.object({ kind: z.enum(['conversation', 'task']), id: z.uuid() }).strict()
export const collaborationPersonSchema = z.object({ id: z.uuid(), name: z.string().min(1) }).strict()
export const collaborationSourceStateSchema = z
    .object({ revision: z.number().int().nonnegative(), activeRequestId: z.uuid().optional(), updatedAt: z.iso.datetime() })
    .strict()
export const collaborationPendingContactSchema = z
    .object({ requestId: z.uuid(), people: z.array(collaborationPersonSchema).max(20) })
    .strict()
export const personMentionSchema = z
    .object({ userId: z.uuid(), name: z.string().min(1).max(100), start: z.number().int().nonnegative(), end: z.number().int().positive() })
    .strict()
export const collaborationNodeStatusSchema = z.enum([
    'awaiting-activation',
    'ready',
    'running',
    'waiting-upstream',
    'waiting-owner',
    'failed',
    'cancelled',
    'completed',
])
export const collaborationMemberSchema = collaborationPersonSchema.extend({
    role: z.enum(['owner', 'member']),
    status: z.enum(['pending', 'active', 'revoked']),
})
export const collaborationAdoptionSchema = z.object({ artifactId: z.uuid(), version: z.number().int().positive() }).strict()
export const collaborationNodeSchema = z
    .object({
        id: z.uuid(),
        projectId: z.uuid(),
        ownerId: z.uuid(),
        ownerName: z.string(),
        title: z.string(),
        goal: z.string(),
        context: z.string(),
        source: collaborationSourceSchema.nullable(),
        upstreamNodeId: z.uuid().nullable(),
        workflowOrigin: workflowNodeOriginSchema.optional(),
        agentLabel: z.string().nullable(),
        status: collaborationNodeStatusSchema,
        revision: z.number().int().positive(),
        adoptions: z.array(collaborationAdoptionSchema),
        canActivate: z.boolean(),
        canManage: z.boolean(),
        canWork: z.boolean(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const collaborationArtifactSchema = z
    .object({
        id: z.uuid(),
        projectId: z.uuid(),
        nodeId: z.uuid(),
        title: z.string(),
        content: z.string(),
        version: z.number().int().positive(),
        authorId: z.uuid(),
        createdAt: z.iso.datetime(),
    })
    .strict()
export const collaborationProjectNoteSchema = z
    .object({
        id: z.uuid(),
        projectId: z.uuid(),
        title: z.string().trim().min(1).max(120),
        content: z.string().trim().min(1).max(32_000),
        version: z.number().int().positive(),
        authorId: z.uuid(),
        authorName: z.string().min(1),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const collaborationProjectSchema = z
    .object({
        id: z.uuid(),
        name: z.string(),
        description: z.string(),
        ownerId: z.uuid(),
        revision: z.number().int().positive(),
        members: z.array(collaborationMemberSchema),
        nodes: z.array(collaborationNodeSchema),
        artifacts: z.array(collaborationArtifactSchema),
        notes: z.array(collaborationProjectNoteSchema).default([]),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const collaborationProgressNodeSchema = z
    .object({
        id: z.uuid(),
        title: z.string(),
        ownerId: z.uuid(),
        ownerName: z.string(),
        upstreamNodeId: z.uuid().nullable(),
        status: collaborationNodeStatusSchema,
        authorized: z.boolean(),
        sourceAvailable: z.boolean(),
        started: z.boolean().nullable(),
        canContinue: z.boolean(),
        ownHref: z
            .string()
            .regex(/^\/\?conversation=[0-9a-f-]{36}$/)
            .optional(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const collaborationProgressWaitSchema = z
    .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        fromNodeId: z.uuid(),
        targetNodeId: z.uuid(),
        kind: z.enum(['downstream', 'upstream', 'self']),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const collaborationProjectProgressSchema = z
    .object({
        projectId: z.uuid(),
        revision: z.number().int().positive(),
        updatedAt: z.iso.datetime(),
        nodes: z.array(collaborationProgressNodeSchema),
        waits: z.array(collaborationProgressWaitSchema),
    })
    .strict()
export const collaborationEventSchema = z
    .object({
        id: z.uuid(),
        sequence: z.number().int().positive(),
        projectId: z.uuid().nullable(),
        nodeId: z.uuid().nullable(),
        targetNodeId: z.uuid().nullable(),
        source: collaborationSourceSchema.nullable(),
        authorId: z.uuid(),
        authorName: z.string(),
        authorKind: z.enum(['human', 'agent']),
        kind: z.enum(['delegation', 'question', 'answer', 'artifact', 'adoption', 'decision', 'revision', 'cancelled', 'message']),
        content: z.string(),
        questionId: z.uuid().nullable(),
        version: z.number().int().positive(),
        createdAt: z.iso.datetime(),
    })
    .strict()
export const collaborationQuestionSchema = z
    .object({
        id: z.uuid(),
        projectId: z.uuid(),
        nodeId: z.uuid(),
        targetNodeId: z.uuid(),
        version: z.number().int().positive(),
        question: z.string(),
        context: z.string(),
        status: z.enum(['pending', 'answered', 'rejected', 'cancelled', 'expired']),
        answer: z.string().nullable(),
        decision: z.enum(['information', 'approved', 'rejected']).nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const collaborationMessageSchema = z
    .object({
        id: z.uuid(),
        threadId: z.uuid(),
        senderId: z.uuid(),
        recipientId: z.uuid(),
        senderName: z.string(),
        recipientName: z.string(),
        content: z.string(),
        authorKind: z.enum(['human', 'agent']),
        sequence: z.number().int().positive(),
        createdAt: z.iso.datetime(),
    })
    .strict()
export const collaborationNotificationSchema = z
    .object({
        id: z.uuid(),
        sequence: z.number().int().positive(),
        title: z.string(),
        content: z.string(),
        projectId: z.uuid().nullable(),
        nodeId: z.uuid().nullable(),
        eventId: z.uuid().nullable(),
        questionId: z.uuid().nullable(),
        threadId: z.uuid().nullable(),
        source: collaborationSourceSchema.nullable(),
        read: z.boolean(),
        createdAt: z.iso.datetime(),
    })
    .strict()

const action = { requestId: z.uuid() }
const nodeAction = { ...action, nodeId: z.uuid(), revision: z.number().int().positive() }
const body = z.string().trim().min(1).max(32_000)
const projectIdentity = z.uuid().toLowerCase()
export const collaborationCommandSchema = z.discriminatedUnion('type', [
    z
        .object({
            requestId: projectIdentity,
            type: z.literal('project-start'),
            projectId: projectIdentity,
            revision: z.number().int().positive(),
            title: z.string().trim().min(1).max(120),
            goal: body,
        })
        .strict(),
    z
        .object({
            requestId: projectIdentity,
            type: z.literal('project-create'),
            name: z.string().trim().min(1).max(120),
            description: z.string().trim().max(2000),
            memberIds: z
                .array(projectIdentity)
                .max(20)
                .refine(ids => new Set(ids).size === ids.length, '成员不能重复。'),
        })
        .strict(),
    z
        .object({
            requestId: projectIdentity,
            type: z.literal('project-update'),
            projectId: projectIdentity,
            revision: z.number().int().positive(),
            name: z.string().trim().min(1).max(120),
            description: z.string().trim().max(2000),
        })
        .strict(),
    z
        .object({
            requestId: projectIdentity,
            type: z.literal('project-members-add'),
            projectId: projectIdentity,
            revision: z.number().int().positive(),
            memberIds: z
                .array(projectIdentity)
                .max(20)
                .refine(ids => new Set(ids).size === ids.length, '成员不能重复。'),
        })
        .strict(),
    z
        .object({
            requestId: projectIdentity,
            type: z.literal('note-publish'),
            projectId: projectIdentity,
            revision: z.number().int().positive(),
            title: z.string().trim().min(1).max(120),
            content: body,
        })
        .strict(),
    z
        .object({
            requestId: projectIdentity,
            type: z.literal('note-edit'),
            projectId: projectIdentity,
            revision: z.number().int().positive(),
            noteId: projectIdentity,
            version: z.number().int().positive(),
            title: z.string().trim().min(1).max(120),
            content: body,
        })
        .strict(),
    z.object({ ...action, type: z.literal('fixed-contact'), contactRequestId: projectIdentity, content: body }).strict(),
    z.object({ ...action, type: z.literal('confirm-dispatch'), draftId: z.uuid(), version: z.number().int().positive() }).strict(),
    z.object({ ...action, type: z.literal('cancel-dispatch'), draftId: z.uuid(), version: z.number().int().positive() }).strict(),
    z
        .object({
            ...action,
            type: z.literal('message'),
            recipientId: z.uuid(),
            content: z
                .string()
                .min(1)
                .max(32_000)
                .refine(value => Boolean(value.trim()), '消息不能为空。'),
            source: collaborationSourceSchema.optional(),
        })
        .strict(),
    z
        .object({
            ...action,
            type: z.literal('delegate'),
            source: collaborationSourceSchema,
            recipientId: z.uuid(),
            title: z.string().trim().min(1).max(120),
            goal: body,
            context: z.string().max(64_000),
            projectId: z.uuid().optional(),
            upstreamNodeId: z.uuid().optional(),
        })
        .strict(),
    z.object({ ...nodeAction, type: z.literal('activate'), agentId: z.uuid().optional() }).strict(),
    z
        .object({
            ...nodeAction,
            type: z.literal('publish'),
            title: z.string().trim().min(1).max(120),
            content: z.string().trim().min(1).max(128_000),
            artifactId: z.uuid().optional(),
        })
        .strict(),
    z.object({ ...nodeAction, type: z.literal('adopt'), artifactId: z.uuid(), version: z.number().int().positive() }).strict(),
    z
        .object({
            ...nodeAction,
            type: z.literal('ask'),
            targetNodeId: z.uuid(),
            question: body,
            context: z.string().max(64_000).default(''),
        })
        .strict(),
    z
        .object({
            ...action,
            type: z.literal('answer'),
            questionId: z.uuid(),
            version: z.number().int().positive(),
            content: body,
            decision: z.enum(['information', 'approved', 'rejected']).default('information'),
        })
        .strict(),
    z.object({ ...nodeAction, type: z.literal('revise'), goal: body, context: z.string().max(64_000) }).strict(),
    z.object({ ...nodeAction, type: z.literal('cancel') }).strict(),
    z
        .object({ ...nodeAction, type: z.literal('retry'), agentId: z.uuid().optional(), useDefaultModel: z.literal(true).optional() })
        .strict()
        .refine(value => !(value.agentId && value.useDefaultModel), '请选择一个 Agent 或本人默认模型。'),
    z
        .object({ ...action, type: z.literal('revoke'), projectId: z.uuid(), userId: z.uuid(), revision: z.number().int().positive() })
        .strict(),
    z
        .object({
            ...action,
            type: z.literal('read'),
            notificationIds: z.array(z.uuid()).max(100),
            messageIds: z.array(z.uuid()).max(100).default([]),
        })
        .strict(),
])
export const collaborationActionResultSchema = z
    .object({
        requestId: z.uuid(),
        projectId: z.uuid().optional(),
        nodeId: z.uuid().optional(),
        eventId: z.uuid().optional(),
        questionId: z.uuid().optional(),
        artifactId: z.uuid().optional(),
        noteId: z.uuid().optional(),
        noteVersion: z.number().int().positive().optional(),
        messageId: z.uuid().optional(),
        threadId: z.uuid().optional(),
        taskId: z.uuid().optional(),
        conversationId: z.uuid().optional(),
        draftId: z.uuid().optional(),
        draftVersion: z.number().int().positive().optional(),
        dispatchStatus: z.enum(['pending', 'sent', 'cancelled', 'superseded']).optional(),
    })
    .strict()
export const collaborationDispatchSchema = z
    .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        source: collaborationSourceSchema,
        kind: z.enum(['message', 'delegate', 'ask', 'answer', 'fixed-contact']),
        targetNodeId: z.uuid().optional(),
        targetTitle: z.string().optional(),
        fixedKind: z.enum(['handoff', 'question', 'reply', 'message']).optional(),
        recipientId: z.uuid(),
        recipientName: z.string(),
        title: z.string().optional(),
        content: z.string(),
        goal: z.string().optional(),
        context: z.string().optional(),
        questionId: z.uuid().optional(),
        questionVersion: z.number().int().positive().optional(),
        question: z.string().optional(),
        decision: z.enum(['information', 'approved', 'rejected']).optional(),
        status: z.enum(['pending', 'sent', 'cancelled', 'superseded']),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        result: collaborationActionResultSchema.optional(),
    })
    .strict()

export const collaborationNodeDetailSchema = z
    .object({
        node: collaborationNodeSchema,
        events: z.array(collaborationEventSchema),
        questions: z.array(collaborationQuestionSchema),
        artifacts: z.array(collaborationArtifactSchema),
    })
    .strict()

export type CollaborationSource = z.infer<typeof collaborationSourceSchema>
export type CollaborationPerson = z.infer<typeof collaborationPersonSchema>
export type PersonMention = z.infer<typeof personMentionSchema>
export type CollaborationMember = z.infer<typeof collaborationMemberSchema>
export type CollaborationNode = z.infer<typeof collaborationNodeSchema>
export type CollaborationNodeStatus = z.infer<typeof collaborationNodeStatusSchema>
export type CollaborationProgressNode = z.infer<typeof collaborationProgressNodeSchema>
export type CollaborationProgressWait = z.infer<typeof collaborationProgressWaitSchema>
export type CollaborationProjectProgress = z.infer<typeof collaborationProjectProgressSchema>
export type CollaborationProjectNote = z.infer<typeof collaborationProjectNoteSchema>
export type CollaborationProject = z.infer<typeof collaborationProjectSchema>
export type CollaborationEvent = z.infer<typeof collaborationEventSchema>
export type CollaborationQuestion = z.infer<typeof collaborationQuestionSchema>
export type CollaborationArtifact = z.infer<typeof collaborationArtifactSchema>
export type CollaborationMessage = z.infer<typeof collaborationMessageSchema>
export type CollaborationNotification = z.infer<typeof collaborationNotificationSchema>
export type CollaborationCommand = z.infer<typeof collaborationCommandSchema>
export type CollaborationActionResult = z.infer<typeof collaborationActionResultSchema>
export type CollaborationNodeDetail = z.infer<typeof collaborationNodeDetailSchema>

export type CollaborationDispatch = z.infer<typeof collaborationDispatchSchema>
export type CollaborationDispatchCommand = Extract<
    CollaborationCommand,
    { type: 'message' | 'delegate' | 'ask' | 'answer' | 'fixed-contact' }
>
