import { z } from 'zod'

export const humanRequestStatusSchema = z.enum([
    'pending',
    'answered',
    'approved',
    'rejected',
    'cancelled',
    'superseded',
    'invalid',
    'executing',
    'succeeded',
    'failed',
    'unknown',
])

export const humanQuestionSchema = z
    .object({
        text: z.string().trim().min(1).max(32_000),
        context: z.string().max(32_000).optional(),
        options: z.array(z.string().min(1).max(2000)).max(12).optional(),
    })
    .strict()

export const humanApprovalSchema = z
    .object({
        toolId: z.string().min(1).max(200),
        toolVersion: z.string().min(1).max(100),
        action: z.string().min(1).max(2000),
        target: z.string().min(1).max(4000),
        scope: z.string().min(1).max(8000),
        arguments: z.record(z.string(), z.unknown()),
    })
    .strict()

const waitFields = { callId: z.string().min(1).max(500) }
export const humanWaitInputSchema = z.discriminatedUnion('kind', [
    z.object({ ...waitFields, kind: z.literal('question'), question: humanQuestionSchema }).strict(),
    z.object({ ...waitFields, kind: z.literal('approval'), approval: humanApprovalSchema }).strict(),
])

const requestFields = {
    id: z.uuid(),
    version: z.number().int().positive(),
    callId: waitFields.callId,
    status: humanRequestStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    answer: z.string().max(32_000).optional(),
    result: z.string().max(32_000).optional(),
}
export const humanRequestSchema = z.discriminatedUnion('kind', [
    z.object({ ...requestFields, kind: z.literal('question'), question: humanQuestionSchema }).strict(),
    z.object({ ...requestFields, kind: z.literal('approval'), approval: humanApprovalSchema }).strict(),
])

export const humanResponseSchema = z.object({ requestId: z.uuid(), version: z.number().int().positive() }).strict()
export const humanDecisionSchema = z
    .object({
        requestId: z.uuid(),
        humanRequestId: z.uuid(),
        version: z.number().int().positive(),
        decision: z.enum(['answer', 'approve', 'reject', 'cancel']),
        answer: z.string().trim().min(1).max(32_000).optional(),
    })
    .strict()
    .refine(value => (value.decision === 'answer' ? value.answer !== undefined : value.answer === undefined), '答案只适用于本人问题。')

export const humanDecisionActionSchema = z
    .object({ actionId: z.uuid(), version: z.number().int().positive(), decision: z.enum(['approve', 'reject', 'cancel']) })
    .strict()

export type HumanRequestStatus = z.infer<typeof humanRequestStatusSchema>
export type HumanQuestion = z.infer<typeof humanQuestionSchema>
export type HumanApproval = z.infer<typeof humanApprovalSchema>
export type HumanWaitInput = z.infer<typeof humanWaitInputSchema>
export type HumanRequest = z.infer<typeof humanRequestSchema>
export type HumanResponse = z.infer<typeof humanResponseSchema>
export type HumanDecision = z.infer<typeof humanDecisionSchema>
export type HumanDecisionAction = z.infer<typeof humanDecisionActionSchema>
