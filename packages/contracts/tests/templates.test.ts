import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
    createTemplateSchema,
    launchTemplateSchema,
    personalProjectSchema,
    projectTemplateSchema,
    templateInputSchema,
    updateTemplateSchema,
} from '../src/index.js'

const entry = { id: randomUUID(), title: ' 核对方案 ', goal: ' 明确交付目标 ' }
const input = { name: ' 每周调研 ', description: ' 保留蓝图 ', tasks: [entry] }

describe('project task template contracts', () => {
    it('normalizes ordered inputs and rejects invalid fields, sizes, duplicate IDs and excessive total goals', () => {
        expect(templateInputSchema.parse(input)).toEqual({
            name: '每周调研',
            description: '保留蓝图',
            tasks: [{ ...entry, title: '核对方案', goal: '明确交付目标' }],
        })
        for (const changes of [
            { name: ' ' },
            { name: '名'.repeat(121) },
            { description: '说'.repeat(2001) },
            { tasks: [] },
            { tasks: Array.from({ length: 9 }, () => ({ ...entry, id: randomUUID() })) },
            { tasks: [entry, entry] },
            { tasks: [{ ...entry, goal: ' ' }] },
            { tasks: [{ ...entry, title: '名'.repeat(121) }] },
            { tasks: [{ ...entry, goal: '目'.repeat(8001) }] },
            { tasks: Array.from({ length: 5 }, () => ({ ...entry, id: randomUUID(), goal: '目'.repeat(8000) })) },
            { tasks: [{ ...entry, agentId: 'forged' }] },
            { apiKey: 'private' },
        ])
            expect(templateInputSchema.safeParse({ ...input, ...changes }).success).toBe(false)
        expect(
            templateInputSchema.parse({
                ...input,
                tasks: Array.from({ length: 4 }, () => ({ ...entry, id: randomUUID(), goal: '目'.repeat(8000) })),
            }).tasks
        ).toHaveLength(4)
    })

    it('requires explicit request and version fields while keeping storage internals private', () => {
        const now = new Date().toISOString()
        const template = { ...templateInputSchema.parse(input), id: randomUUID(), version: 1, createdAt: now, updatedAt: now }
        expect(projectTemplateSchema.parse(template)).toEqual(template)
        expect(projectTemplateSchema.safeParse({ ...template, creation: input }).success).toBe(false)
        expect(createTemplateSchema.safeParse({ ...input, requestId: randomUUID() }).success).toBe(true)
        expect(createTemplateSchema.safeParse(input).success).toBe(false)
        for (const version of [0, -1, 1.5, '1']) expect(updateTemplateSchema.safeParse({ ...input, version }).success).toBe(false)
        expect(
            launchTemplateSchema.safeParse({ name: '实例', description: '', requestId: randomUUID(), version: 1, tasks: [entry] }).success
        ).toBe(false)
    })

    it('accepts legacy projects and preserves optional template origin order', () => {
        const now = new Date().toISOString()
        const project = { id: randomUUID(), name: '旧项目', description: '', createdAt: now, updatedAt: now }
        expect(personalProjectSchema.parse(project)).toEqual(project)
        const templateOrigin = { templateId: randomUUID(), version: 2, taskIds: [randomUUID(), randomUUID()] }
        expect(personalProjectSchema.parse({ ...project, templateOrigin }).templateOrigin).toEqual(templateOrigin)
    })
})
