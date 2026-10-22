import { z } from 'zod'

const skillFields = {
    title: z.string().trim().min(1, '请填写技能标题。').max(60, '技能标题最多 60 个字。'),
    description: z.string().trim().max(500, '技能说明最多 500 个字。'),
    content: z.string().trim().min(1, '请填写技能正文。').max(16000, '技能正文最多 16000 个字。'),
}

export const skillInputSchema = z.object(skillFields).strict()
export const createSkillSchema = skillInputSchema.extend({ requestId: z.uuid().toLowerCase() })
export const updateSkillSchema = skillInputSchema.extend({
    requestId: z.uuid().toLowerCase(),
    version: z.number().int().positive(),
})
export const skillRecordSchema = skillInputSchema.extend({
    id: z.uuid().toLowerCase(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export const skillSummarySchema = skillRecordSchema.omit({ content: true })
export const skillVersionSummarySchema = skillRecordSchema.pick({ version: true, title: true, updatedAt: true })
export const skillRefSchema = z.object({ skillId: z.uuid().toLowerCase(), version: z.number().int().positive() }).strict()
export const skillRefsSchema = z
    .array(skillRefSchema)
    .max(5, '最多绑定 5 个技能。')
    .refine(refs => new Set(refs.map(ref => ref.skillId)).size === refs.length, '同一技能不能重复绑定。')
export const skillSnapshotSchema = skillInputSchema.extend({
    skillId: z.uuid().toLowerCase(),
    version: z.number().int().positive(),
})
export const skillSnapshotsSchema = z
    .array(skillSnapshotSchema)
    .max(5, '最多绑定 5 个技能。')
    .refine(snapshots => new Set(snapshots.map(snapshot => snapshot.skillId)).size === snapshots.length, '同一技能不能重复绑定。')
    .refine(
        snapshots => snapshots.reduce((total, snapshot) => total + snapshot.content.length, 0) <= 32000,
        '已选技能正文合计最多 32000 个字。'
    )

export type SkillInput = z.infer<typeof skillInputSchema>
export type CreateSkill = z.infer<typeof createSkillSchema>
export type UpdateSkill = z.infer<typeof updateSkillSchema>
export type SkillRecord = z.infer<typeof skillRecordSchema>
export type SkillSummary = z.infer<typeof skillSummarySchema>
export type SkillVersionSummary = z.infer<typeof skillVersionSummarySchema>
export type SkillRef = z.infer<typeof skillRefSchema>
export type SkillSnapshot = z.infer<typeof skillSnapshotSchema>
