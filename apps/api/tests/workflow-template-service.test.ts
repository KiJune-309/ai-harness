import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ConflictException, ServiceUnavailableException } from '@nestjs/common'
import type { ChatConversation, WorkflowPreview } from '@ai-harness/contracts'
import type { ChatScope, CollaborationStore } from '@ai-harness/db'
import type { ChatService } from '../src/chat-service.js'
import type { CollaborationService } from '../src/collaboration-service.js'
import { WorkflowTemplateService } from '../src/workflow-template-service.js'

/**
 * Builds an explicitly injected service-only fixture without database, model or credential access.
 * @returns Stable review fields and spies for checking preflight before route metadata preparation.
 */
function fixture() {
    const scope: ChatScope = { userId: randomUUID(), workspaceId: randomUUID() }
    const templateId = randomUUID()
    const input = { requestId: randomUUID(), previewId: randomUUID() }
    const preview: WorkflowPreview = {
        previewId: input.previewId,
        templateId,
        version: 1,
        project: { name: 'Reviewed workflow', description: '' },
        nodes: [
            {
                id: randomUUID(),
                title: 'Prepare',
                goal: 'Private work',
                assigneeId: scope.userId,
                assigneeName: 'Owner',
                assigneeActive: true,
                upstreamNodeId: null,
                position: { x: 0, y: 0 },
                opening: null,
            },
            {
                id: randomUUID(),
                title: 'Review',
                goal: 'Private review',
                assigneeId: randomUUID(),
                assigneeName: 'Coworker',
                assigneeActive: true,
                upstreamNodeId: null,
                position: { x: 500, y: 500 },
                opening: 'Exact frozen reference',
            },
        ],
        members: [],
        scope: 'Reviewed scope',
        createdAt: new Date().toISOString(),
    }
    preview.nodes[1]!.upstreamNodeId = preview.nodes[0]!.id
    const result = { projectId: input.requestId, nodeIds: [randomUUID(), randomUUID()] }
    const store = {
        workflowLaunchReplay: vi.fn().mockResolvedValue(undefined),
        validateWorkflowPreview: vi.fn().mockResolvedValue(preview),
        launchWorkflow: vi.fn().mockResolvedValue(result),
    }
    const collaboration = {
        query: async <T>(action: (store: CollaborationStore) => Promise<T>): Promise<T> => action(store as unknown as CollaborationStore),
        workflowDialogue: vi.fn().mockImplementation(async (_scope: ChatScope, title: string): Promise<ChatConversation> => ({
            id: randomUUID(),
            title,
            messages: [],
            createdAt: preview.createdAt,
            updatedAt: preview.createdAt,
        })),
    }
    const service = new WorkflowTemplateService(collaboration as unknown as CollaborationService, {} as ChatService)
    return { scope, templateId, input, preview, result, store, collaboration, service }
}

describe('workflow startup qualification before route metadata', () => {
    it('rejects an invalid frozen review before reading any assignee route or creating any work', async () => {
        const test = fixture()
        const conflict = new ConflictException('Reviewed member has left; review again.')
        test.store.validateWorkflowPreview.mockRejectedValue(conflict)
        await expect(test.service.launch(test.scope, test.templateId, test.input)).rejects.toBe(conflict)
        expect(test.collaboration.workflowDialogue).not.toHaveBeenCalled()
        expect(test.store.launchWorkflow).not.toHaveBeenCalled()
    })

    it('rechecks a metadata failure so concurrent membership revocation becomes an explicit review conflict', async () => {
        const test = fixture()
        const conflict = new ConflictException('Reviewed membership changed during metadata preparation.')
        test.store.validateWorkflowPreview.mockResolvedValueOnce(test.preview).mockRejectedValueOnce(conflict)
        test.collaboration.workflowDialogue.mockRejectedValue(new Error('Private route ownership ended'))
        await expect(test.service.launch(test.scope, test.templateId, test.input)).rejects.toBe(conflict)
        expect(test.store.validateWorkflowPreview).toHaveBeenCalledTimes(2)
        expect(test.store.launchWorkflow).not.toHaveBeenCalled()
    })

    it('preserves a genuine route-storage failure when the frozen review remains current', async () => {
        const test = fixture()
        const unavailable = new ServiceUnavailableException('Private metadata store unavailable')
        test.collaboration.workflowDialogue.mockRejectedValue(unavailable)
        await expect(test.service.launch(test.scope, test.templateId, test.input)).rejects.toBe(unavailable)
        expect(test.store.validateWorkflowPreview).toHaveBeenCalledTimes(2)
        expect(test.store.launchWorkflow).not.toHaveBeenCalled()
    })

    it('keeps replay independent of old qualifications and sends first startup through the final atomic guard', async () => {
        const test = fixture()
        expect(await test.service.launch(test.scope, test.templateId, test.input)).toEqual(test.result)
        expect(test.store.validateWorkflowPreview).toHaveBeenCalledWith(test.scope, test.templateId, test.input.previewId)
        expect(test.collaboration.workflowDialogue.mock.invocationCallOrder[0]).toBeGreaterThan(
            test.store.validateWorkflowPreview.mock.invocationCallOrder[0]!
        )
        const snapshots = test.store.launchWorkflow.mock.calls[0]![3] as Record<string, ChatConversation>
        expect(Object.keys(snapshots)).toEqual(test.preview.nodes.map(node => node.id))
        expect(new Set(Object.values(snapshots).map(chat => chat.id)).size).toBe(2)
        test.store.workflowLaunchReplay.mockResolvedValue(test.result)
        test.store.validateWorkflowPreview.mockClear()
        test.collaboration.workflowDialogue.mockClear()
        expect(await test.service.launch(test.scope, test.templateId, test.input)).toEqual(test.result)
        expect(test.store.validateWorkflowPreview).not.toHaveBeenCalled()
        expect(test.collaboration.workflowDialogue).not.toHaveBeenCalled()
    })
})
