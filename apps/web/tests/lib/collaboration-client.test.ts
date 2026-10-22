import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    getCollaborationMessages,
    getCollaborationNotificationPage,
    getCollaborationProjectProgress,
    getSourceCollaboration,
    searchCollaborationPeople,
    sendCollaborationCommand,
} from '../../lib/collaboration-client'

const userId = '4345c647-f6ef-4413-a878-65cd0f9a6db3'
const requestId = '7581903a-a495-496e-8686-b508434cbccf'
const sourceId = 'c92f2b3b-8777-4c6f-8c71-b2302773ad9a'

afterEach(() => vi.unstubAllGlobals())

describe('collaboration client persistence boundary', () => {
    it('reads the independent progress whitelist and rejects private node fields', async () => {
        const projection = {
            projectId: requestId,
            revision: 2,
            updatedAt: '2026-10-20T06:00:00.000Z',
            nodes: [
                {
                    id: sourceId,
                    title: '需求评估',
                    ownerId: userId,
                    ownerName: '张三',
                    upstreamNodeId: null,
                    status: 'ready',
                    authorized: true,
                    sourceAvailable: true,
                    started: false,
                    canContinue: true,
                    ownHref: `/?conversation=${sourceId}`,
                    createdAt: '2026-10-20T05:00:00.000Z',
                    updatedAt: '2026-10-20T06:00:00.000Z',
                },
            ],
            waits: [],
        }
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json(projection))
            .mockResolvedValueOnce(Response.json({ ...projection, nodes: [{ ...projection.nodes[0], goal: '私有目标不可进入总览' }] }))
        vi.stubGlobal('fetch', fetch)
        await expect(getCollaborationProjectProgress(requestId)).resolves.toEqual(projection)
        expect(fetch.mock.calls[0][0]).toBe(`/api/chat/collaboration/projects/${requestId}/progress`)
        await expect(getCollaborationProjectProgress(requestId)).rejects.toThrow()
    })

    it('validates minimal real people and encodes search without client identity claims', async () => {
        const fetch = vi.fn().mockResolvedValue(Response.json({ people: [{ id: userId, name: '张三' }] }))
        vi.stubGlobal('fetch', fetch)
        await expect(searchCollaborationPeople('张 三')).resolves.toEqual([{ id: userId, name: '张三' }])
        expect(fetch.mock.calls[0][0]).toBe('/api/chat/collaboration/people?q=%E5%BC%A0+%E4%B8%89')
        expect(fetch.mock.calls[0][1].headers).toBeUndefined()
    })

    it('queries the original action after a lost response instead of sending again', async () => {
        const fetch = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('private network details'))
            .mockResolvedValueOnce(Response.json({ requestId, messageId: sourceId }))
        vi.stubGlobal('fetch', fetch)
        const command = { type: 'message' as const, requestId, recipientId: userId, content: '会议改到下午三点。' }
        await expect(sendCollaborationCommand(command)).resolves.toEqual({ requestId, messageId: sourceId })
        expect(fetch.mock.calls).toHaveLength(2)
        expect(fetch.mock.calls[0][0]).toBe('/api/chat/collaboration/commands')
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(command)
        expect(fetch.mock.calls[1][0]).toBe(`/api/chat/collaboration/actions/${requestId}`)
        expect(fetch.mock.calls[1][1].method).toBeUndefined()
    })

    it('does not retry unauthorized commands or treat rejected writes as saved', async () => {
        const fetch = vi.fn().mockResolvedValue(Response.json({ message: '没有该事项的权限。' }, { status: 403 }))
        vi.stubGlobal('fetch', fetch)
        await expect(sendCollaborationCommand({ type: 'message', requestId, recipientId: userId, content: '正文' })).rejects.toThrow(
            '没有该事项的权限'
        )
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('keeps source identity and bounded cursors explicit without polling a model', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValue(Response.json({ events: [], nodes: [], questions: [], artifacts: [], nextCursor: 17, hasMore: false }))
        vi.stubGlobal('fetch', fetch)
        const saved = await getSourceCollaboration({ kind: 'task', id: sourceId }, 9)
        expect(saved.nextCursor).toBe(17)
        expect(fetch.mock.calls[0][0]).toBe(`/api/chat/collaboration/source-events?sourceKind=task&sourceId=${sourceId}&cursor=9&limit=50`)
        expect(saved.pendingDispatches).toEqual([])
    })

    it('validates full saved send previews and confirms their exact version without carrying message content', async () => {
        const draft = {
            id: requestId,
            version: 3,
            source: { kind: 'conversation', id: sourceId },
            kind: 'message',
            recipientId: userId,
            recipientName: '张三',
            content: '确认后的完整正文。',
            status: 'pending',
            createdAt: '2026-10-19T06:00:00.000Z',
            updatedAt: '2026-10-19T06:00:00.000Z',
        }
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ events: [], nodes: [], questions: [], artifacts: [], pendingDispatches: [draft] }))
            .mockResolvedValueOnce(Response.json({ requestId, draftId: requestId, draftVersion: 3, dispatchStatus: 'sent' }))
        vi.stubGlobal('fetch', fetch)
        const source = { kind: 'conversation' as const, id: sourceId }
        expect((await getSourceCollaboration(source)).pendingDispatches).toEqual([draft])
        const command = { type: 'confirm-dispatch' as const, requestId, draftId: requestId, version: 3 }
        await expect(sendCollaborationCommand(command)).resolves.toMatchObject({ dispatchStatus: 'sent' })
        expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(command)
        await expect(sendCollaborationCommand({ ...command, content: '换成未经确认的正文' } as never)).rejects.toThrow()
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('encodes exclusive older-page cursors and keeps the durable unread total', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ notifications: [], unread: 207 }))
            .mockResolvedValueOnce(Response.json({ messages: [] }))
        vi.stubGlobal('fetch', fetch)
        await expect(getCollaborationNotificationPage(0, undefined, 101)).resolves.toEqual({
            notifications: [],
            unread: 207,
            authorizedProjectIds: undefined,
        })
        await expect(getCollaborationMessages(sourceId, undefined, 201)).resolves.toEqual([])
        expect(fetch.mock.calls[0][0]).toBe('/api/chat/collaboration/notifications?cursor=0&limit=100&before=101')
        expect(fetch.mock.calls[1][0]).toBe(`/api/chat/collaboration/messages?threadId=${sourceId}&before=201`)
    })
})
