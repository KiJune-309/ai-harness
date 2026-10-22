import { z } from 'zod'

export const accountUsernameSchema = z.string().trim().min(2, '用户名至少 2 个字。').max(50, '用户名最多 50 个字。')
export const accountEmailSchema = z.string().trim().toLowerCase().email('请输入有效邮箱。').max(254, '邮箱过长。')
export const accountPasswordSchema = z.string().min(12, '密码至少 12 个字符。').max(128, '密码最多 128 个字符。')
export const accountUserSchema = z
    .object({
        id: z.uuid(),
        username: accountUsernameSchema,
        email: accountEmailSchema,
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const registerAccountSchema = z
    .object({ username: accountUsernameSchema, email: accountEmailSchema, password: accountPasswordSchema })
    .strict()
export const loginAccountSchema = z.object({ email: accountEmailSchema, password: accountPasswordSchema }).strict()
export const updateUsernameSchema = z.object({ username: accountUsernameSchema }).strict()
export const updateEmailSchema = z.object({ email: accountEmailSchema, currentPassword: accountPasswordSchema }).strict()
export const updatePasswordSchema = z.object({ currentPassword: accountPasswordSchema, newPassword: accountPasswordSchema }).strict()
export const accountMeSchema = z
    .object({ user: accountUserSchema, storage: z.literal('postgres'), workspaceId: z.string().min(1).optional() })
    .strict()

const modelFields = {
    name: z.string().trim().min(1, '请填写连接名称。').max(60, '连接名称最多 60 个字。'),
    baseUrl: z.string().trim().min(1, '请填写 Base URL。').max(2048, '地址过长。'),
    model: z.string().trim().min(1, '请填写模型标识。').max(120, '模型标识最多 120 个字符。'),
}
export const createAccountModelSchema = z
    .object({ ...modelFields, requestId: z.uuid(), apiKey: z.string().trim().min(1, '请填写 API key。').max(8192, 'API key 过长。') })
    .strict()
export const updateAccountModelSchema = z
    .object({ ...modelFields, apiKey: z.string().trim().max(8192, 'API key 过长。').optional() })
    .strict()
export const accountModelSchema = z
    .object({
        ...modelFields,
        id: z.uuid(),
        modelId: z.string().regex(/^account:[0-9a-f-]{36}$/i),
        hasApiKey: z.boolean(),
        isDefault: z.boolean(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const accountModelsSchema = z.object({ models: z.array(accountModelSchema) }).strict()
export const accountModelTestSchema = z.object({ success: z.literal(true), message: z.string() }).strict()

export type AccountUser = z.infer<typeof accountUserSchema>
export type RegisterAccount = z.infer<typeof registerAccountSchema>
export type LoginAccount = z.infer<typeof loginAccountSchema>
export type UpdateUsername = z.infer<typeof updateUsernameSchema>
export type UpdateEmail = z.infer<typeof updateEmailSchema>
export type UpdatePassword = z.infer<typeof updatePasswordSchema>
export type AccountMe = z.infer<typeof accountMeSchema>
export type AccountModel = z.infer<typeof accountModelSchema>
export type CreateAccountModel = z.infer<typeof createAccountModelSchema>
export type UpdateAccountModel = z.infer<typeof updateAccountModelSchema>
