import { randomUUID } from 'node:crypto'
import type {
    ChatConversation,
    CollaborationActionResult,
    CollaborationDispatch,
    CollaborationProject,
    CollaborationProjectProgress,
    PersonalTask,
} from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import { workflowApi, workflowUntil, type WorkflowProviderInput } from './workflow-api-fixture.js'

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'derives real Task completion/restoration and three-person source progress without modifying collaboration facts or performing work on reads',
    async () => {
        await workflowApi(async ({ json, call, pool, people, behavior, calls }) => {
            const task = await json<PersonalTask>('A', 'chat/tasks', {
                requestId: randomUUID(),
                title: '旧任务真实来源',
                goal: 'PRIVATE_TASK_GOAL_NOT_BOARD',
            })
            expect(task.messages).toEqual([])
            const delegated = await json<CollaborationActionResult>('A', 'chat/collaboration/commands', {
                type: 'delegate',
                requestId: randomUUID(),
                source: { kind: 'task', id: task.id },
                recipientId: people.get('B')!.id,
                title: 'B真实协作工作',
                goal: 'PRIVATE_B_GOAL',
                context: 'PRIVATE_REVIEWED_CONTEXT',
            })
            const projectPath = `chat/collaboration/projects/${delegated.projectId}`
            const progressPath = `${projectPath}/progress`
            const initial = await json<CollaborationProject>('A', projectPath)
            const aNode = initial.nodes.find(node => node.ownerId === people.get('A')!.id)!
            const bChat = delegated.conversationId!
            let progress = await json<CollaborationProjectProgress>('A', progressPath)
            expect(progress.nodes.find(node => node.id === aNode.id)).toMatchObject({ sourceAvailable: true, started: false })
            expect(progress.nodes.find(node => node.id === delegated.nodeId)).toMatchObject({ sourceAvailable: true, started: false })
            expect((await json<PersonalTask>('A', `chat/tasks/${task.id}`)).task.started).toBe(false)
            expect((await json<ChatConversation>('B', `chat/conversations/${bChat}`)).messages).toMatchObject([
                { role: 'assistant', kind: 'opening' },
            ])
            expect(calls).toHaveLength(0)

            /**
             * Executes original human text through the real Task or ordinary bound-source endpoint and actual provider.
             * @param owner - Genuine authenticated source owner.
             * @param id - Exact source identity.
             * @param kind - Source kind retained from its original work.
             * @param content - New owner-authored input.
             * @param tool - Optional deterministic native tool to exercise an offered capability.
             * @param body - Full reviewed outgoing body.
             * @param mention - Optional original explicit coworker mention.
             * @returns After its durable execution settles.
             */
            async function turn(
                owner: string,
                id: string,
                kind: 'task' | 'conversation',
                content: string,
                tool?: string,
                body = '',
                mention?: string
            ): Promise<void> {
                await workflowUntil(
                    () =>
                        json<{ sourceState?: { activeRequestId?: string } }>(
                            owner,
                            `chat/collaboration/source-events?sourceKind=${kind}&sourceId=${id}`
                        ),
                    page => !page.sourceState?.activeRequestId
                )
                let attempted = false
                behavior.respond = (input: WorkflowProviderInput) => {
                    if (attempted || !tool || input.model !== owner) return undefined
                    const metadata = input.tools?.find(candidate => candidate.function.name === tool)
                    if (!metadata) return undefined
                    attempted = true
                    return {
                        name: tool,
                        args: {
                            slotId: metadata.function.parameters.properties.slotId.enum[0],
                            content: body,
                            ...(tool === 'collaboration_handoff' ? { title: 'C真实下游' } : {}),
                        },
                    }
                }
                const response = await call(owner, `chat/${kind === 'task' ? 'tasks' : 'conversations'}/${id}/messages`, {
                    requestId: randomUUID(),
                    content,
                    ...(mention ? { mentions: [{ userId: people.get(mention)!.id, name: `Person ${mention}`, start: 0, end: 9 }] } : {}),
                })
                expect(response.ok, response.ok ? '' : `${owner} ${content} ${response.status}: ${await response.text()}`).toBe(true)
                await response.text()
                await workflowUntil(
                    () =>
                        json<{ sourceState?: { activeRequestId?: string } }>(
                            owner,
                            `chat/collaboration/source-events?sourceKind=${kind}&sourceId=${id}`
                        ),
                    page => !page.sourceState?.activeRequestId
                )
                if (tool) expect(attempted).toBe(true)
            }

            /**
             * Confirms exactly the current source's fully persisted draft through the dedicated human endpoint.
             * @param owner - Real source owner.
             * @param id - Exact original Task or conversation identity.
             * @param kind - Exact source kind.
             * @returns Its reviewed draft and idempotently committed result.
             */
            async function confirm(owner: string, id: string, kind: 'task' | 'conversation') {
                const events = await json<{ pendingDispatches: CollaborationDispatch[] }>(
                    owner,
                    `chat/collaboration/source-events?sourceKind=${kind}&sourceId=${id}`
                )
                const draft = events.pendingDispatches.find(candidate => candidate.status === 'pending')!
                expect(draft).toBeTruthy()
                const command = { type: 'confirm-dispatch', requestId: randomUUID(), draftId: draft.id, version: draft.version }
                const result = await json<CollaborationActionResult>(owner, 'chat/collaboration/commands', command)
                expect(await json(owner, 'chat/collaboration/commands', command)).toEqual(result)
                return { draft, result }
            }

            await turn(
                'B',
                bChat,
                'conversation',
                '请回复这个问题：已明确接收约束',
                'collaboration_reply',
                'PRIVATE_B_EXACT_INITIAL_ANSWER'
            )
            await confirm('B', bChat, 'conversation')
            await workflowUntil(
                () =>
                    json<{ sourceState?: { activeRequestId?: string } }>(
                        'A',
                        `chat/collaboration/source-events?sourceKind=task&sourceId=${task.id}`
                    ),
                page => !page.sourceState?.activeRequestId
            )
            const priorTask = await json<PersonalTask>('A', `chat/tasks/${task.id}`)
            if (!priorTask.task.started) {
                const started = await call('A', `chat/tasks/${task.id}/start`, { requestId: randomUUID() })
                expect(started.ok, started.ok ? '' : `Task start ${started.status}: ${await started.text()}`).toBe(true)
                await started.text()
                await workflowUntil(
                    () =>
                        json<{ sourceState?: { activeRequestId?: string } }>(
                            'A',
                            `chat/collaboration/source-events?sourceKind=task&sourceId=${task.id}`
                        ),
                    page => !page.sourceState?.activeRequestId
                )
            } else await turn('A', task.id, 'task', '仅在本人任务中分析，不联系同事')
            progress = await workflowUntil(
                () => json<CollaborationProjectProgress>('A', progressPath),
                page => page.nodes.find(node => node.id === aNode.id)?.status === 'ready'
            )
            expect(progress.nodes.find(node => node.id === aNode.id)).toMatchObject({
                sourceAvailable: true,
                started: true,
                canContinue: true,
            })
            expect(progress.waits).toEqual([])
            const aSession = (await pool.query('SELECT session_id FROM harness_collaboration_sources WHERE source_id=$1', [task.id]))
                .rows[0].session_id
            const aggregateBeforeComplete = (await pool.query('SELECT data FROM harness_collaboration_state')).rows
            const completed = await json<PersonalTask>('A', `chat/tasks/${task.id}/status`, { status: 'completed' }, 'PUT')
            expect(completed.task.status).toBe('completed')
            progress = await json<CollaborationProjectProgress>('A', progressPath)
            expect(progress.nodes.find(node => node.id === aNode.id)).toMatchObject({
                status: 'completed',
                started: true,
                sourceAvailable: true,
                canContinue: false,
                ownHref: `/?conversation=${task.id}`,
            })
            expect(progress.waits.some(wait => wait.fromNodeId === aNode.id || wait.targetNodeId === aNode.id)).toBe(false)
            expect((await pool.query('SELECT data FROM harness_collaboration_state')).rows).toEqual(aggregateBeforeComplete)
            await json('A', `chat/tasks/${task.id}/status`, { restore: true }, 'PUT')
            expect((await json<CollaborationProjectProgress>('A', progressPath)).nodes.find(node => node.id === aNode.id)).toMatchObject({
                status: 'ready',
                started: true,
                canContinue: true,
            })
            expect((await pool.query('SELECT data FROM harness_collaboration_state')).rows).toEqual(aggregateBeforeComplete)

            await turn(
                'B',
                bChat,
                'conversation',
                '@Person C 请将此工作交给这位同事处理，先给我发送草稿',
                'collaboration_handoff',
                'PRIVATE_C_REVIEWED_GOAL',
                'C'
            )
            const c = await confirm('B', bChat, 'conversation')
            progress = await json<CollaborationProjectProgress>('A', progressPath)
            expect(progress.nodes).toHaveLength(3)
            expect(progress.nodes.find(node => node.id === c.result.nodeId)).toMatchObject({ started: false, sourceAvailable: true })
            expect(progress.waits.some(wait => wait.fromNodeId === delegated.nodeId && wait.targetNodeId === c.result.nodeId)).toBe(true)
            await turn(
                'C',
                c.result.conversationId!,
                'conversation',
                '请回复这个问题：评估完成',
                'collaboration_reply',
                'PRIVATE_C_EXACT_ANSWER'
            )
            await confirm('C', c.result.conversationId!, 'conversation')
            await turn('B', bChat, 'conversation', '请向上游补问：目标QPS是多少？', 'collaboration_question', 'PRIVATE_B_TO_A_QUESTION')
            const asked = await confirm('B', bChat, 'conversation')
            progress = await json<CollaborationProjectProgress>('A', progressPath)
            expect(
                progress.waits.some(
                    wait => wait.fromNodeId === delegated.nodeId && wait.targetNodeId === aNode.id && wait.kind === 'upstream'
                )
            ).toBe(true)
            const waitingAggregate = (await pool.query('SELECT data FROM harness_collaboration_state')).rows
            expect((await call('A', `chat/tasks/${task.id}/status`, { status: 'completed' }, 'PUT')).status).toBe(409)
            expect((await pool.query('SELECT data FROM harness_collaboration_state')).rows).toEqual(waitingAggregate)
            expect(
                (await json<CollaborationProjectProgress>('A', progressPath)).waits.some(wait => wait.id === asked.result.questionId)
            ).toBe(true)
            await turn('A', task.id, 'task', '确认')
            expect(
                (
                    await json<{ pendingDispatches: CollaborationDispatch[] }>(
                        'A',
                        `chat/collaboration/source-events?sourceKind=task&sourceId=${task.id}`
                    )
                ).pendingDispatches.filter(draft => draft.status === 'pending')
            ).toEqual([])
            await turn('A', task.id, 'task', '请回复这个问题：目标为500QPS', 'collaboration_reply', 'PRIVATE_A_EXACT_REPLY_500')
            const answer = await confirm('A', task.id, 'task')
            expect(answer.draft.questionId).toBe(asked.result.questionId)
            expect(answer.draft.questionVersion).toBe(1)
            await workflowUntil(
                () => json<CollaborationProjectProgress>('A', progressPath),
                page => page.waits.length === 0 && page.nodes.find(node => node.id === aNode.id)?.status === 'ready'
            )
            await json('A', `chat/tasks/${task.id}/status`, { status: 'completed' }, 'PUT')
            const beforeCancel = await json<CollaborationProject>('A', projectPath)
            await json('A', 'chat/collaboration/commands', {
                type: 'cancel',
                requestId: randomUUID(),
                nodeId: aNode.id,
                revision: beforeCancel.nodes.find(node => node.id === aNode.id)!.revision,
            })
            await json('A', `chat/tasks/${task.id}/status`, { restore: true }, 'PUT')
            expect((await json<CollaborationProjectProgress>('A', progressPath)).nodes.find(node => node.id === aNode.id)).toMatchObject({
                status: 'cancelled',
                canContinue: false,
            })

            for (const [name, id, kind] of [
                ['B', bChat, 'conversation'],
                ['C', c.result.conversationId!, 'conversation'],
            ] as const)
                await workflowUntil(
                    () =>
                        json<{ sourceState?: { activeRequestId?: string } }>(
                            name,
                            `chat/collaboration/source-events?sourceKind=${kind}&sourceId=${id}`
                        ),
                    page => !page.sourceState?.activeRequestId
                )
            const beforeReads = (await pool.query('SELECT data FROM harness_collaboration_state')).rows
            const countsBefore = (
                await pool.query(
                    'SELECT (SELECT count(*) FROM harness_chat_conversations)::int AS chats,(SELECT count(*) FROM harness_collaboration_jobs)::int AS jobs'
                )
            ).rows
            await pool.query(
                "UPDATE harness_account_models SET data=jsonb_set(data,'{encryptedApiKey}','\"test-owned-unreadable-cipher\"'::jsonb)"
            )
            const callsBefore = calls.length
            for (let index = 0; index < 10; index++) {
                const page = await json<CollaborationProjectProgress>('A', progressPath)
                expect(page.nodes).toHaveLength(3)
                expect(JSON.stringify(page)).not.toMatch(/PRIVATE_|goal|context|content|messages|sourceId|source_id|skill|agent|apiKey/)
                expect(page.nodes.filter(node => node.ownHref).map(node => node.ownerId)).toEqual([people.get('A')!.id])
            }
            expect(calls).toHaveLength(callsBefore)
            expect((await pool.query('SELECT data FROM harness_collaboration_state')).rows).toEqual(beforeReads)
            expect(
                (
                    await pool.query(
                        'SELECT (SELECT count(*) FROM harness_chat_conversations)::int AS chats,(SELECT count(*) FROM harness_collaboration_jobs)::int AS jobs'
                    )
                ).rows
            ).toEqual(countsBefore)
            expect(
                (await pool.query('SELECT session_id FROM harness_collaboration_sources WHERE source_id=$1', [task.id])).rows[0].session_id
            ).toBe(aSession)
            expect((await call('D', progressPath)).status).toBe(404)
            await pool.query('ALTER TABLE harness_chat_conversations RENAME TO isolated_board_sources')
            try {
                expect((await call('A', progressPath)).status).toBe(503)
            } finally {
                await pool.query('ALTER TABLE isolated_board_sources RENAME TO harness_chat_conversations')
            }
            expect((await json<CollaborationProjectProgress>('A', progressPath)).nodes).toHaveLength(3)
            const project = await json<CollaborationProject>('A', projectPath)
            await json('A', 'chat/collaboration/commands', {
                type: 'revoke',
                requestId: randomUUID(),
                projectId: project.id,
                userId: people.get('B')!.id,
                revision: project.revision,
            })
            expect((await call('B', progressPath)).status).toBe(404)
        })
    },
    90000
)
