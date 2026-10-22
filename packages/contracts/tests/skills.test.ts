import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
    agentInputSchema,
    agentDefinitionSchema,
    createSkillSchema,
    skillRefsSchema,
    skillSnapshotsSchema,
    updateSkillSchema,
} from '../src/index.js'

describe('independent private Skill contract acceptance', () => {
    it('normalizes only outside whitespace and rejects unknown, oversized or blank public fields', () => {
        const input = {
            requestId: randomUUID(),
            title: ' 标题 ',
            description: ' 说明 ',
            content: ' 第一行\n\n${process.env.SECRET}\n```sh\ncurl https://example.test\n``` ',
        }
        expect(createSkillSchema.parse(input)).toEqual({ ...input, title: '标题', description: '说明', content: input.content.trim() })
        expect(
            createSkillSchema.safeParse({ ...input, title: '字'.repeat(60), description: '字'.repeat(500), content: '字'.repeat(16000) })
                .success
        ).toBe(true)
        for (const change of [
            { title: '' },
            { title: '  ' },
            { title: '字'.repeat(61) },
            { description: '字'.repeat(501) },
            { content: ' \n ' },
            { content: '字'.repeat(16001) },
            { ownerId: randomUUID() },
        ])
            expect(createSkillSchema.safeParse({ ...input, ...change }).success).toBe(false)
        expect(updateSkillSchema.safeParse({ ...input, version: 1 }).success).toBe(true)
        expect(updateSkillSchema.safeParse({ ...input, version: 0 }).success).toBe(false)
    })

    it('requires ordered distinct exact references and refuses client-resolved snapshots', () => {
        const refs = Array.from({ length: 5 }, () => ({ skillId: randomUUID(), version: 1 }))
        expect(skillRefsSchema.parse(refs)).toEqual(refs)
        expect(skillRefsSchema.safeParse([...refs, { skillId: randomUUID(), version: 1 }]).success).toBe(false)
        expect(skillRefsSchema.safeParse([refs[0], { ...refs[0], version: 2 }]).success).toBe(false)
        expect(skillRefsSchema.safeParse([refs[0], { ...refs[0], skillId: refs[0]!.skillId.toUpperCase() }]).success).toBe(false)
        const input = { name: '本人Agent', description: '', modelId: 'fixture', systemPrompt: '原prompt', toolIds: [], openingMessages: [] }
        expect(agentInputSchema.parse(input).skillRefs).toBeUndefined()
        expect(agentInputSchema.parse({ ...input, skillRefs: refs }).skillRefs).toEqual(refs)
        expect(agentInputSchema.safeParse({ ...input, skillSnapshots: [] }).success).toBe(false)
        expect(agentInputSchema.safeParse({ ...input, skillRefs: [{ ...refs[0], content: '伪正文' }] }).success).toBe(false)
        const now = new Date().toISOString()
        expect(agentDefinitionSchema.safeParse({ ...input, id: randomUUID(), createdAt: now, updatedAt: now }).success).toBe(true)
        const snapshots = refs.slice(0, 2).map(ref => ({ ...ref, title: '方法', description: '', content: '字'.repeat(16000) }))
        expect(skillSnapshotsSchema.safeParse(snapshots).success).toBe(true)
        expect(skillSnapshotsSchema.safeParse([...snapshots, { ...refs[2], title: '一字', description: '', content: '字' }]).success).toBe(
            false
        )
    })
})
