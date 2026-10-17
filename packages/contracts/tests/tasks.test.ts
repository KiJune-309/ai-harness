import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTaskSchema, personalTaskSchema, chatConversationSchema, updateTaskStatusSchema } from '../src/index.js'

describe('personal task contracts', () => {
    it('normalizes creation while rejecting blank, oversized, forged, and unknown fields', () => {
        const input = { requestId: randomUUID(), title: '  调研  ', goal: '  比较三个方案  ' }
        expect(createTaskSchema.parse(input)).toEqual({ ...input, title: '调研', goal: '比较三个方案' })
        for (const changes of [
            { title: '  ' },
            { title: '名'.repeat(121) },
            { goal: '\n ' },
            { goal: 'a'.repeat(32_001) },
            { requestId: 'forged' },
            { agentId: 'forged' },
            { userId: randomUUID() },
        ])
            expect(createTaskSchema.safeParse({ ...input, ...changes }).success).toBe(false)
    })

    it('accepts old chat snapshots while requiring task metadata and frozen Agent configuration for tasks', () => {
        const now = new Date().toISOString()
        const chat = { id: randomUUID(), title: '原对话', messages: [], createdAt: now, updatedAt: now }
        expect(chatConversationSchema.parse(chat)).toEqual(chat)
        expect(personalTaskSchema.safeParse(chat).success).toBe(false)
        const task = { goal: '交付结果', status: 'not-started', started: false }
        expect(personalTaskSchema.safeParse({ ...chat, task }).success).toBe(false)
        const agent = {
            id: randomUUID(),
            name: '通用助手',
            description: '',
            modelId: 'deepseek-flash',
            systemPrompt: '保持清晰。',
            toolIds: [],
            openingMessages: [],
            createdAt: now,
            updatedAt: now,
        }
        expect(personalTaskSchema.parse({ ...chat, task, agent }).task).toEqual(task)
        expect(personalTaskSchema.safeParse({ ...chat, task: { ...task, status: 'invented' }, agent }).success).toBe(false)
    })

    it('only allows explicit status transitions or restoration', () => {
        expect(updateTaskStatusSchema.parse({ restore: true })).toEqual({ restore: true })
        expect(updateTaskStatusSchema.parse({ status: 'completed' })).toEqual({ status: 'completed' })
        for (const value of [{}, { restore: false }, { status: 'finished' }, { status: 'in-progress', restore: true }, { goal: 'changed' }])
            expect(updateTaskStatusSchema.safeParse(value).success).toBe(false)
    })
})
