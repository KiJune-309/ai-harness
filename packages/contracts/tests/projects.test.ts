import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createProjectSchema, createTaskSchema, personalProjectSchema, projectInputSchema, updateTaskProjectSchema } from '../src/index.js'

describe('personal project contracts', () => {
    it('normalizes fields and rejects blank, oversized, forged and unrecognized input', () => {
        const input = { requestId: randomUUID(), name: '  秋季调研  ', description: '  比较方案  ' }
        expect(createProjectSchema.parse(input)).toEqual({ ...input, name: '秋季调研', description: '比较方案' })
        expect(projectInputSchema.parse({ name: '名'.repeat(120), description: '说'.repeat(2000) }).description).toHaveLength(2000)
        expect(projectInputSchema.parse({ name: '允许同名', description: '' }).description).toBe('')
        for (const changes of [
            { name: '  ' },
            { name: '名'.repeat(121) },
            { description: '说'.repeat(2001) },
            { requestId: 'invalid' },
            { userId: randomUUID() },
            { projectId: randomUUID() },
        ])
            expect(createProjectSchema.safeParse({ ...input, ...changes }).success).toBe(false)
    })

    it('keeps original creation data out of strict public responses and edit requests', () => {
        const now = new Date().toISOString()
        const project = { id: randomUUID(), name: '项目', description: '', createdAt: now, updatedAt: now }
        expect(personalProjectSchema.parse(project)).toEqual(project)
        expect(personalProjectSchema.safeParse({ ...project, creation: { name: '旧名称', description: '' } }).success).toBe(false)
        expect(projectInputSchema.safeParse({ name: '项目', description: '', requestId: randomUUID() }).success).toBe(false)
    })

    it('distinguishes an explicit removal from a missing or forged association', () => {
        expect(updateTaskProjectSchema.parse({ projectId: null })).toEqual({ projectId: null })
        const projectId = randomUUID()
        expect(updateTaskProjectSchema.parse({ projectId })).toEqual({ projectId })
        for (const input of [{}, { projectId: 'bad' }, { projectId, status: 'completed' }])
            expect(updateTaskProjectSchema.safeParse(input).success).toBe(false)
        const task = { requestId: randomUUID(), title: '任务', goal: '明确目标' }
        expect(createTaskSchema.parse(task)).toEqual(task)
        expect(createTaskSchema.parse({ ...task, projectId }).projectId).toBe(projectId)
        expect(createTaskSchema.safeParse({ ...task, projectId: null }).success).toBe(false)
    })
})
