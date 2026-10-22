import { z } from 'zod'
import { accountEmailSchema } from './accounts.js'

export const workspaceInputSchema = z
    .object({
        name: z.string().trim().min(1, '请填写工作空间名称。').max(60, '工作空间名称最多 60 个字。'),
        description: z.string().trim().max(500, '工作空间说明最多 500 个字。'),
    })
    .strict()
export const createWorkspaceSchema = workspaceInputSchema.extend({ requestId: z.uuid() })
export const teamWorkspaceSchema = workspaceInputSchema
    .extend({
        id: z.string().min(1),
        kind: z.enum(['legacy', 'team']),
        role: z.enum(['owner', 'member']),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict()
export const workspaceMemberSchema = z
    .object({
        userId: z.uuid(),
        name: z.string(),
        email: accountEmailSchema,
        role: z.enum(['owner', 'member']),
        joinedAt: z.iso.datetime(),
    })
    .strict()
export const workspaceInvitationSchema = z
    .object({
        id: z.uuid(),
        workspaceId: z.string().min(1),
        workspaceName: z.string(),
        workspaceDescription: z.string(),
        email: accountEmailSchema,
        inviterName: z.string(),
        status: z.enum(['pending', 'accepted', 'declined', 'revoked', 'expired']),
        createdAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
    })
    .strict()
export const inviteWorkspaceMemberSchema = z.object({ requestId: z.uuid(), email: accountEmailSchema }).strict()
export const respondWorkspaceInvitationSchema = z.object({ accept: z.boolean() }).strict()
export const workspaceDirectorySchema = z
    .object({ currentId: z.string().min(1), workspaces: z.array(teamWorkspaceSchema), invitations: z.array(workspaceInvitationSchema) })
    .strict()
export const workspaceDetailSchema = z
    .object({ workspace: teamWorkspaceSchema, members: z.array(workspaceMemberSchema), invitations: z.array(workspaceInvitationSchema) })
    .strict()

export type WorkspaceInput = z.infer<typeof workspaceInputSchema>
export type CreateWorkspace = z.infer<typeof createWorkspaceSchema>
export type TeamWorkspace = z.infer<typeof teamWorkspaceSchema>
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>
export type WorkspaceInvitation = z.infer<typeof workspaceInvitationSchema>
export type InviteWorkspaceMember = z.infer<typeof inviteWorkspaceMemberSchema>
export type WorkspaceDirectory = z.infer<typeof workspaceDirectorySchema>
export type WorkspaceDetail = z.infer<typeof workspaceDetailSchema>
