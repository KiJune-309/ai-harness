import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { humanDecisionActionSchema, humanDecisionSchema, humanRequestSchema, sendChatMessageSchema } from '../src/index.js'

describe('human-loop public contracts', () => {
    it('binds a bottom-composer answer to an exact request without accepting editable approval parameters', () => {
        const response = { requestId: randomUUID(), version: 1 }
        expect(sendChatMessageSchema.parse({ requestId: randomUUID(), content: '开发者', humanResponse: response }).humanResponse).toEqual(
            response
        )
        expect(
            humanDecisionActionSchema.safeParse({ actionId: randomUUID(), version: 1, decision: 'approve', arguments: { changed: true } })
                .success
        ).toBe(false)
        expect(humanDecisionActionSchema.safeParse({ actionId: randomUUID(), version: 1, decision: 'answer' }).success).toBe(false)
    })

    it('requires real answer text only for the answer decision and preserves complete safe request previews', () => {
        const decision = { requestId: randomUUID(), humanRequestId: randomUUID(), version: 1 }
        expect(humanDecisionSchema.safeParse({ ...decision, decision: 'answer' }).success).toBe(false)
        expect(humanDecisionSchema.safeParse({ ...decision, decision: 'approve', answer: '确认' }).success).toBe(false)
        const now = new Date().toISOString()
        const request = {
            id: randomUUID(),
            version: 1,
            callId: 'test-call',
            status: 'pending',
            kind: 'approval',
            createdAt: now,
            updatedAt: now,
            approval: {
                toolId: 'test-write',
                toolVersion: '1',
                action: '写入',
                target: 'row',
                scope: 'isolated test only',
                arguments: { body: '完整正文' },
            },
        }
        expect(humanRequestSchema.parse(request)).toEqual(request)
        expect(humanRequestSchema.safeParse({ ...request, credential: 'private' }).success).toBe(false)
    })
})
