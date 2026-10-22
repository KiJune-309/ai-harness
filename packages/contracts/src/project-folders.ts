import { z } from 'zod'

/**
 * Canonicalizes a validated UUID before action locking and project equality comparisons.
 * @param value - Syntactically valid UUID supplied by the public contract.
 * @returns The same stable identity in lowercase.
 */
function canonicalProjectFolderId(value: string): string {
    return value.toLowerCase()
}

export const projectFolderIdSchema = z.uuid().transform(canonicalProjectFolderId)

export const projectFolderNameSchema = z.string().trim().min(1, '请填写项目名称。').max(120, '项目名称最多 120 个字。')

export const createProjectFolderSchema = z.object({ requestId: projectFolderIdSchema, name: projectFolderNameSchema }).strict()

export const projectFolderSchema = z
    .object({ id: projectFolderIdSchema, name: projectFolderNameSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
    .strict()

export const projectFoldersSchema = z.object({ projects: z.array(projectFolderSchema) }).strict()

export type CreateProjectFolder = z.infer<typeof createProjectFolderSchema>
export type ProjectFolder = z.infer<typeof projectFolderSchema>

export const projectKnowledgeListInputSchema = z.object({ page: z.number().int().min(1).max(100_000) }).strict()
export const projectKnowledgeSearchInputSchema = z
    .object({ query: z.string().max(180), page: z.number().int().min(1).max(834).default(1) })
    .strict()
export const projectKnowledgeReadInputSchema = z
    .object({ documentId: z.uuid().transform(value => value.toLowerCase()), page: z.number().int().min(1).max(1250) })
    .strict()
