import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { collaborationCommandSchema, collaborationDispatchSchema, collaborationNodeSchema, sendChatMessageSchema } from '../src/index.js'

describe('collaboration public boundaries', () => {
    it('keeps plain messages compatible and validates stable UTF-16 person bindings', () => {
        expect(sendChatMessageSchema.parse({ requestId: randomUUID(), content: '旧消息' }).content).toBe('旧消息')
        const mention = { userId: randomUUID(), name: '张三', start: 0, end: 3 }
        expect(sendChatMessageSchema.parse({ requestId: randomUUID(), content: '@张三 评估', mentions: [mention] }).mentions).toEqual([
            mention,
        ])
        expect(
            sendChatMessageSchema.safeParse({ requestId: randomUUID(), content: '@张三', mentions: [{ ...mention, start: -1 }] }).success
        ).toBe(false)
    })

    it('rejects forged actor fields, unknown commands and unversioned node writes', () => {
        const message = { type: 'message', requestId: randomUUID(), recipientId: randomUUID(), content: '原文\n保留' }
        expect(collaborationCommandSchema.parse(message).type).toBe('message')
        expect(collaborationCommandSchema.safeParse({ ...message, authorId: randomUUID() }).success).toBe(false)
        expect(collaborationCommandSchema.safeParse({ ...message, scope: { userId: randomUUID() } }).success).toBe(false)
        expect(collaborationCommandSchema.safeParse({ type: 'activate', requestId: randomUUID(), nodeId: randomUUID() }).success).toBe(
            false
        )
        expect(collaborationCommandSchema.safeParse({ ...message, type: 'execute-command' }).success).toBe(false)
    })

    it('confirms only an immutable private draft identity and rejects forged delivery content or provenance', () => {
        const confirmation = { type: 'confirm-dispatch', requestId: randomUUID(), draftId: randomUUID(), version: 1 }
        expect(collaborationCommandSchema.parse(confirmation)).toEqual(confirmation)
        expect(collaborationCommandSchema.safeParse({ ...confirmation, recipientId: randomUUID() }).success).toBe(false)
        expect(collaborationCommandSchema.safeParse({ ...confirmation, content: 'rewritten after review' }).success).toBe(false)
        expect(collaborationCommandSchema.safeParse({ ...confirmation, authorKind: 'human' }).success).toBe(false)
        expect(collaborationCommandSchema.safeParse({ ...confirmation, version: 0 }).success).toBe(false)
        expect(collaborationCommandSchema.safeParse({ ...confirmation, type: 'cancel-dispatch' }).success).toBe(true)
        const now = new Date().toISOString()
        const preview = {
            id: randomUUID(),
            version: 1,
            source: { kind: 'conversation', id: randomUUID() },
            kind: 'delegate',
            recipientId: randomUUID(),
            recipientName: 'KiJune2',
            title: '排查白屏',
            goal: '恢复侧边导航',
            context: '必要上下文原文',
            content: '恢复侧边导航\n\n必要上下文原文',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
        }
        expect(collaborationDispatchSchema.parse(preview)).toEqual(preview)
        expect(collaborationDispatchSchema.safeParse({ ...preview, lease: { token: randomUUID() } }).success).toBe(false)
        expect(collaborationDispatchSchema.safeParse({ ...preview, connection: { apiKey: 'must stay private' } }).success).toBe(false)
        expect(
            collaborationDispatchSchema.parse({
                ...preview,
                kind: 'answer',
                questionId: randomUUID(),
                questionVersion: 2,
                question: '是否批准上线？',
                decision: 'approved',
            })
        ).toMatchObject({ kind: 'answer', questionVersion: 2, decision: 'approved' })
        expect(collaborationDispatchSchema.safeParse({ ...preview, kind: 'answer', decision: 'implicitly-approved' }).success).toBe(false)
    })

    it('does not admit private configuration fields in shared node projections', () => {
        expect(collaborationNodeSchema.shape.agentLabel).toBeDefined()
        expect('agent' in collaborationNodeSchema.shape).toBe(false)
        expect('reasoning' in collaborationNodeSchema.shape).toBe(false)
        expect('connection' in collaborationNodeSchema.shape).toBe(false)
    })

    it('requires an explicit exclusive choice when repairing a failed node model route', () => {
        const retry = { type: 'retry', requestId: randomUUID(), nodeId: randomUUID(), revision: 2 }
        expect(collaborationCommandSchema.safeParse(retry).success).toBe(true)
        expect(collaborationCommandSchema.safeParse({ ...retry, useDefaultModel: true }).success).toBe(true)
        expect(collaborationCommandSchema.safeParse({ ...retry, agentId: randomUUID() }).success).toBe(true)
        expect(collaborationCommandSchema.safeParse({ ...retry, agentId: randomUUID(), useDefaultModel: true }).success).toBe(false)
        expect(collaborationCommandSchema.safeParse({ ...retry, useDefaultModel: false }).success).toBe(false)
    })
})
