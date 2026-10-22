import 'reflect-metadata'
import { GoneException } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import type { CollaborationCommand } from '@ai-harness/contracts'
import { CollaborationService } from '../src/collaboration-service.js'
import { ChatService } from '../src/chat-service.js'
import { ProjectController } from '../src/project-controller.js'
import { TaskController } from '../src/task-controller.js'
import { TemplateController } from '../src/template-controller.js'
import { WorkflowTemplateController } from '../src/workflow-template-controller.js'
import { WorkflowTemplateService } from '../src/workflow-template-service.js'
import { CollaborationController } from '../src/collaboration-controller.js'
import { assertLegacyProjectCommandAvailable, LegacyProjectsRetiredGuard, throwLegacyProjectRetired } from '../src/legacy-project-policy.js'

describe('retired project API and Agent policy', () => {
    it('refuses retired routes and every project capability while retaining independent message confirmation', () => {
        expect(() => throwLegacyProjectRetired()).toThrow(GoneException)
        expect(() => new LegacyProjectsRetiredGuard().canActivate()).toThrow(GoneException)
        for (const type of [
            'project-create',
            'project-start',
            'project-update',
            'project-members-add',
            'note-publish',
            'note-edit',
            'delegate',
            'activate',
            'publish',
            'adopt',
            'ask',
            'answer',
            'revise',
            'cancel',
            'retry',
            'revoke',
            'fixed-contact',
        ])
            expect(() => assertLegacyProjectCommandAvailable({ type } as CollaborationCommand)).toThrow(GoneException)
        for (const type of ['message', 'read', 'confirm-dispatch', 'cancel-dispatch'])
            expect(() => assertLegacyProjectCommandAvailable({ type } as CollaborationCommand)).not.toThrow()
    })

    it('rejects model handoff before consulting persistence or preparing recipient credentials', async () => {
        const persistence = vi.fn()
        const service = Object.create(CollaborationService.prototype) as CollaborationService
        service.persistence = persistence
        await expect(
            service.command(
                { workspaceId: 'test-workspace', userId: 'b05811dc-8e30-4c3e-a8ae-1e484756bc86' },
                {
                    type: 'delegate',
                    requestId: '870193f8-a9db-40eb-9cd6-b454d960e113',
                    source: { kind: 'conversation', id: '4fe167f6-49e3-4843-8e17-d7f33731ce4c' },
                    recipientId: 'f691a9b1-d2c1-4817-a21e-13c1004903be',
                    title: '旧项目',
                    goal: '不再启动',
                    context: '',
                },
                { authorKind: 'agent' }
            )
        ).rejects.toBeInstanceOf(GoneException)
        expect(persistence).not.toHaveBeenCalled()
    })

    it('returns HTTP 410 from every retired route before invoking injected stores', async () => {
        const coordinator = Object.freeze({})
        const app = await NestFactory.create(
            {
                module: class PolicyTestModule {},
                controllers: [ProjectController, TaskController, TemplateController, WorkflowTemplateController, CollaborationController],
                providers: [
                    { provide: ChatService, useValue: coordinator },
                    { provide: WorkflowTemplateService, useValue: coordinator },
                    { provide: CollaborationService, useValue: coordinator },
                ],
            },
            { logger: false }
        )
        try {
            await app.listen(0, '127.0.0.1')
            const base = await app.getUrl()
            const id = '870193f8-a9db-40eb-9cd6-b454d960e113'
            for (const [method, path] of [
                ['GET', '/chat/projects'],
                ['POST', '/chat/projects'],
                ['GET', `/chat/projects/${id}`],
                ['PUT', `/chat/projects/${id}`],
                ['PUT', `/chat/tasks/${id}/project`],
                ['POST', `/chat/templates/${id}/launch`],
                ['POST', `/chat/workflow-templates/${id}/preview`],
                ['POST', `/chat/workflow-templates/${id}/launch`],
                ['GET', '/chat/collaboration/projects'],
                ['GET', `/chat/collaboration/projects/${id}`],
                ['GET', `/chat/collaboration/projects/${id}/progress`],
                ['GET', `/chat/collaboration/nodes/${id}`],
                ['GET', `/chat/collaboration/nodes/${id}/events`],
            ]) {
                const response = await fetch(`${base}${path}`, { method })
                expect(response.status, `${method} ${path}`).toBe(410)
            }
        } finally {
            await app.close()
        }
    })
})
