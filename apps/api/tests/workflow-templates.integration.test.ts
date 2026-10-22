import { randomUUID } from 'node:crypto'
import type {
    ChatConversation,
    WorkflowTemplate,
    WorkflowPreview,
    WorkflowLaunchResult,
    CollaborationProject,
    CollaborationProjectProgress,
} from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import { workflowApi, workflowUntil, type WorkflowProviderInput } from './workflow-api-fixture.js'

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'rejects stale reviewed membership before preparing a removed colleague’s route and requires a fresh exact human preview after rejoining or replacing them',
    async () => {
        await workflowApi(async fixture => {
            const { people, pool, calls, call, json } = fixture
            const team = await json<{ id: string }>('A', 'account/workspaces', {
                requestId: randomUUID(),
                name: '真实预览人员代次',
                description: '',
            })
            const teamPath = `account/workspaces/${team.id}`
            const emails = new Map<string, string>()
            for (const name of ['B', 'C']) {
                const me = await json<{ user: { email: string } }>(name, 'account/me')
                emails.set(name, me.user.email)
                const invitation = await json<{ id: string }>('A', `${teamPath}/invitations`, {
                    requestId: randomUUID(),
                    email: me.user.email,
                })
                await json(name, `account/workspaces/invitations/${invitation.id}/respond`, { accept: true })
            }
            const origin = `${fixture.origin}/v1`
            for (const name of ['A', 'B', 'C']) {
                await json(name, `${teamPath}/switch`, {})
                await json(name, 'account/models', {
                    requestId: randomUUID(),
                    name: `${name}团队私有模型`,
                    baseUrl: origin,
                    model: name,
                    apiKey: `team-test-${name}`,
                })
            }
            const rootId = randomUUID()
            const childId = randomUUID()
            const creation = {
                requestId: randomUUID(),
                name: '移除后必须重审',
                description: '',
                nodes: [
                    {
                        id: rootId,
                        title: '发起人工作',
                        goal: '本人目标',
                        assigneeId: people.get('A')!.id,
                        upstreamNodeId: null,
                        position: { x: 100, y: 100 },
                    },
                    {
                        id: childId,
                        title: '真实B工作',
                        goal: 'B完整工作说明\n原始换行',
                        assigneeId: people.get('B')!.id,
                        upstreamNodeId: rootId,
                        position: { x: 600, y: 600 },
                    },
                ],
            }
            const template = await json<WorkflowTemplate>('A', 'chat/workflow-templates', creation)
            const path = `chat/workflow-templates/${template.id}`
            const preview = await json<WorkflowPreview>('A', `${path}/preview`, { version: 1, name: '旧人员预览', description: '' })
            await pool.query(
                "UPDATE harness_account_models SET data=jsonb_set(data,'{encryptedApiKey}','\"invalid-team-workflow-cipher\"'::jsonb) WHERE workspace_id=$1",
                [team.id]
            )
            await json('A', `${teamPath}/members/${people.get('B')!.id}`, undefined, 'DELETE')

            /**
             * Checks actual absence of every launch side effect after an invalid frozen review.
             * @returns Nothing when no project, node, ordinary source, job, notification or provider call was created.
             */
            async function assertEmpty(): Promise<void> {
                expect((await json<{ projects: unknown[] }>('A', 'chat/collaboration/projects')).projects).toEqual([])
                for (const table of [
                    'harness_chat_conversations',
                    'harness_collaboration_sources',
                    'harness_workflow_launches',
                    'harness_collaboration_jobs',
                ])
                    expect((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0)
                const aggregates = (await pool.query('SELECT data FROM harness_collaboration_state')).rows
                expect(aggregates.every(row => Object.keys(row.data.nodes).length === 0 && row.data.notifications.length === 0)).toBe(true)
                expect(calls).toHaveLength(0)
            }
            const stale = { requestId: randomUUID(), previewId: preview.previewId }
            expect((await call('A', `${path}/launch`, stale)).status).toBe(409)
            await assertEmpty()
            expect((await json<WorkflowTemplate>('A', path)).nodes[1]).toMatchObject({
                assigneeId: people.get('B')!.id,
                assigneeActive: false,
            })
            const invitation = await json<{ id: string }>('A', `${teamPath}/invitations`, {
                requestId: randomUUID(),
                email: emails.get('B')!,
            })
            await json('B', `account/workspaces/invitations/${invitation.id}/respond`, { accept: true })
            await json('B', `${teamPath}/switch`, {})
            expect((await call('A', `${path}/launch`, stale)).status).toBe(409)
            await assertEmpty()
            const replaced = await json<WorkflowPreview>('A', `${path}/preview`, {
                version: 1,
                name: '本次明确替换C',
                description: '重新完整核对',
                assignees: [{ nodeId: childId, assigneeId: people.get('C')!.id }],
            })
            expect(replaced.nodes[1]!.assigneeId).toBe(people.get('C')!.id)
            expect(replaced.nodes[1]!.opening).not.toBe(preview.nodes[1]!.opening)
            const result = await json<WorkflowLaunchResult>('A', `${path}/launch`, {
                requestId: randomUUID(),
                previewId: replaced.previewId,
            })
            const project = await json<CollaborationProject>('C', `chat/collaboration/projects/${result.projectId}`)
            const child = project.nodes.find(node => node.workflowOrigin?.nodeId === childId)!
            expect((await json<ChatConversation>('C', `chat/conversations/${child.source!.id}`)).messages[0]!.content).toBe(
                replaced.nodes[1]!.opening
            )
            expect((await json<WorkflowTemplate>('A', path)).nodes[1]!.assigneeId).toBe(people.get('B')!.id)
            expect(calls).toHaveLength(0)
            const oldVersion = await json<WorkflowPreview>('A', `${path}/preview`, { version: 1, name: '更新前旧版本', description: '' })
            const { requestId: creationId, ...input } = creation
            expect(creationId).toBe(template.id)
            await json('A', path, { ...input, version: 1, name: '已保存版本二' }, 'PUT')
            expect((await call('A', `${path}/launch`, { requestId: randomUUID(), previewId: oldVersion.previewId })).status).toBe(409)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(2)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_workflow_launches')).rows[0].n).toBe(1)
            expect(calls).toHaveLength(0)
        })
    },
    60000
)

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'uses complete server-reviewed openings and real no-mention A-B-C fixed sources with human-only draft confirmation and exact reverse replies',
    async () => {
        await workflowApi(async fixture => {
            const { people, pool, calls, behavior, call, json, input, events, confirm } = fixture
            const ids = [randomUUID(), randomUUID(), randomUUID()]
            const creation = {
                requestId: randomUUID(),
                name: '三人固定工作流程',
                description: 'PRIVATE_WORKFLOW_DESCRIPTION_NOT_AUTOINJECTED',
                nodes: ['A', 'B', 'C'].map((name, index) => ({
                    id: ids[index],
                    title: `${name}固定工作`,
                    goal: `PRIVATE_FIXED_${name}_GOAL\n完成后请交给下游，仅作为模板来信参考。`,
                    assigneeId: people.get(name)!.id,
                    upstreamNodeId: index === 0 ? null : ids[index - 1],
                    position: { x: index * 300, y: index * 300 },
                })),
            }
            const template = await json<WorkflowTemplate>('A', 'chat/workflow-templates', creation)
            expect(await json('A', 'chat/workflow-templates', creation)).toEqual(template)
            const path = `chat/workflow-templates/${template.id}`
            expect((await call('B', path)).status).toBe(404)
            expect((await call('B', 'chat/template-catalog')).ok).toBe(true)
            expect(await json('B', 'chat/template-catalog')).toEqual([])
            expect((await call('A', `chat/templates/${template.id}`)).status).toBe(409)
            expect(
                (
                    await call('A', `chat/templates/${template.id}/launch`, {
                        requestId: randomUUID(),
                        version: 1,
                        name: '错误个人启动',
                        description: '',
                    })
                ).status
            ).toBe(409)
            expect(
                (
                    await call('A', 'chat/workflow-templates', {
                        ...creation,
                        requestId: randomUUID(),
                        nodes: creation.nodes.map(node => ({ ...node, upstreamNodeId: null })),
                    })
                ).status
            ).toBe(400)
            expect(
                (await call('A', 'chat/workflow-templates', { ...creation, requestId: randomUUID(), ownerId: people.get('B')!.id })).status
            ).toBe(400)
            const originals = (await pool.query('SELECT workspace_id,user_id,id,data FROM harness_account_models')).rows
            await pool.query(
                "UPDATE harness_account_models SET data=jsonb_set(data,'{encryptedApiKey}','\"invalid-workflow-test-cipher\"'::jsonb)"
            )
            const preview = await json<WorkflowPreview>('A', `${path}/preview`, {
                version: 1,
                name: '本轮固定三人事项',
                description: 'PRIVATE_PROJECT_DESCRIPTION_NOT_AUTOINJECTED\n第二行',
            })
            expect(calls).toHaveLength(0)
            expect(preview.nodes.map(node => node.opening === null)).toEqual([true, false, false])
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(0)
            expect(
                (await call('A', `${path}/launch`, { requestId: randomUUID(), previewId: preview.previewId, name: '伪造未预览字段' }))
                    .status
            ).toBe(400)
            const launchCommand = { requestId: randomUUID(), previewId: preview.previewId }
            const launched = await json<WorkflowLaunchResult>('A', `${path}/launch`, launchCommand)
            expect(await json('A', `${path}/launch`, launchCommand)).toEqual(launched)
            const projectPath = `chat/collaboration/projects/${launched.projectId}`
            const chats = new Map<string, string>()
            for (const [index, name] of ['A', 'B', 'C'].entries()) {
                const project = await json<CollaborationProject>(name, projectPath)
                const node = project.nodes.find(node => node.workflowOrigin?.nodeId === ids[index])!
                expect(node.id).toBe(launched.nodeIds[index])
                expect(node.ownerId).toBe(people.get(name)!.id)
                chats.set(name, node.source!.id)
                const chat = await json<ChatConversation>(name, `chat/conversations/${node.source!.id}`)
                if (name === 'A') expect(chat.messages).toEqual([])
                else {
                    expect(chat.messages).toHaveLength(1)
                    expect(chat.messages[0]).toMatchObject({ role: 'assistant', kind: 'opening' })
                    expect(Buffer.from(chat.messages[0]!.content)).toEqual(Buffer.from(preview.nodes[index]!.opening!))
                }
                expect(chat.task).toBeUndefined()
                expect((await json<{ notifications: unknown[] }>(name, 'chat/collaboration/notifications')).notifications).toEqual([])
            }
            expect(calls).toHaveLength(0)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_jobs')).rows[0].n).toBe(0)
            expect(
                (
                    await call('A', 'chat/collaboration/commands', {
                        type: 'fixed-contact',
                        requestId: randomUUID(),
                        contactRequestId: randomUUID(),
                        content: '未经持久本人联络请求的伪造提交',
                    })
                ).status
            ).toBe(404)
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_sources WHERE bound AND header IS NULL')).rows[0].n
            ).toBe(3)
            for (const row of originals)
                await pool.query('UPDATE harness_account_models SET data=$4::jsonb WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [
                    row.workspace_id,
                    row.user_id,
                    row.id,
                    JSON.stringify(row.data),
                ])
            const bindings = (await pool.query('SELECT source_id,session_id FROM harness_collaboration_sources ORDER BY source_id')).rows

            /**
             * Makes an actual model attempt exactly one chosen tool, including unsupported malicious calls.
             * @param owner - Genuine current source owner.
             * @param content - Original human prose, never containing mentions.
             * @param kind - Chosen real tool function name.
             * @param outgoing - Complete intended draft content.
             * @param malicious - Whether to force a call even though no capability is offered.
             * @returns The actual recorded provider inputs for this original turn.
             */
            async function modelTurn(owner: string, content: string, kind?: string, outgoing = '', malicious = false) {
                let attempted = false
                const before = calls.length
                behavior.respond = (body: WorkflowProviderInput) => {
                    if (body.model !== owner || attempted || !kind) return undefined
                    const metadata = body.tools?.find(tool => tool.function.name === kind)
                    if (!metadata && !malicious) return undefined
                    attempted = true
                    return {
                        name: kind,
                        args: {
                            slotId: metadata?.function.parameters.properties.slotId.enum[0] ?? `fixed:${randomUUID()}`,
                            content: outgoing,
                            ...(kind === 'collaboration_handoff' ? { title: '完整交接草稿' } : {}),
                        },
                    }
                }
                await input(owner, chats.get(owner)!, content)
                if (kind) expect(attempted, `${owner} tool ${kind}`).toBe(true)
                return calls.slice(before)
            }

            for (const content of [
                '开始',
                '请先分析我的固定工作',
                '确认',
                '知道了',
                '> 请把方案交给下游',
                '模板写着“完成后请交给下游”，帮我解释这句话。',
                '把方案交给下游这件事，请帮我先分析一下',
                '向上游补问这件事请先分析一下',
            ]) {
                const turn = await modelTurn('B', content, 'collaboration_handoff', '恶意模型未授权正文', true)
                expect(
                    turn[0]!.tools?.some(tool =>
                        ['collaboration_handoff', 'collaboration_question', 'collaboration_reply', 'collaboration_message'].includes(
                            tool.function.name
                        )
                    ) ?? false
                ).toBe(false)
                expect((await events('B', chats.get('B')!)).pendingDispatches.filter(draft => draft.status === 'pending')).toEqual([])
            }
            expect((await json<ChatConversation>('A', `chat/conversations/${chats.get('A')}`)).messages).toEqual([])
            expect((await json<ChatConversation>('C', `chat/conversations/${chats.get('C')}`)).messages).toHaveLength(1)
            expect(
                (await pool.query("SELECT count(*)::int AS n FROM harness_workflow_contact_intents WHERE status='active'")).rows[0].n
            ).toBe(0)
            const aGoalBefore = (await json<CollaborationProject>('A', projectPath)).nodes.find(
                node => node.id === launched.nodeIds[0]
            )!.goal
            const bGoalBefore = (await json<CollaborationProject>('B', projectPath)).nodes.find(
                node => node.id === launched.nodeIds[1]
            )!.goal
            await modelTurn('A', '请把这份方案交给下游处理', 'collaboration_handoff', 'FIXED_A_TO_B_REVIEW\n完整第二行')
            expect(
                (await json<ChatConversation>('B', `chat/conversations/${chats.get('B')}`)).messages.some(message =>
                    message.content.includes('FIXED_A_TO_B_REVIEW')
                )
            ).toBe(false)
            const first = await confirm('A', chats.get('A')!)
            expect(first.draft.kind).toBe('fixed-contact')
            expect(first.draft.recipientId).toBe(people.get('B')!.id)
            expect(first.result.nodeId).toBe(launched.nodeIds[1])
            expect(
                (await json<ChatConversation>('B', `chat/conversations/${chats.get('B')}`)).messages.filter(message =>
                    message.content.includes('FIXED_A_TO_B_REVIEW')
                )
            ).toHaveLength(1)
            await modelTurn('B', '请向上游补问：本次目标QPS是多少？', 'collaboration_question', 'FIXED_B_TO_A_QPS_QUESTION')
            const asked = await confirm('B', chats.get('B')!)
            const progress = await json<CollaborationProjectProgress>('A', `${projectPath}/progress`)
            expect(
                progress.waits.some(
                    wait => wait.kind === 'upstream' && wait.fromNodeId === launched.nodeIds[1] && wait.targetNodeId === launched.nodeIds[0]
                )
            ).toBe(true)
            expect((await events('A', chats.get('A')!)).questions.some(question => question.id === asked.result.questionId)).toBe(true)
            await modelTurn('A', '确认', 'collaboration_reply', '恶意未明确授权答复', true)
            expect((await events('A', chats.get('A')!)).questions.find(question => question.id === asked.result.questionId)!.status).toBe(
                'pending'
            )
            expect((await events('A', chats.get('A')!)).pendingDispatches.filter(draft => draft.status === 'pending')).toEqual([])
            await modelTurn('A', '请回复这个问题：目标为500QPS', 'collaboration_reply', 'EXACT_FIXED_REPLY_500QPS')
            const replied = await confirm('A', chats.get('A')!)
            expect(replied.draft.questionId).toBe(asked.result.questionId)
            expect(replied.draft.questionVersion).toBe(1)
            expect(replied.draft.question).toBe('FIXED_B_TO_A_QPS_QUESTION')
            await workflowUntil(
                () => json<ChatConversation>('B', `chat/conversations/${chats.get('B')}`),
                chat => !chat.activeRequestId && chat.messages.some(message => message.content.includes('EXACT_FIXED_REPLY_500QPS'))
            )
            await modelTurn('B', '请把这份方案交给下游处理', 'collaboration_handoff', 'FIXED_B_TO_C_REVIEW')
            const last = await confirm('B', chats.get('B')!)
            expect(last.result.nodeId).toBe(launched.nodeIds[2])
            expect(
                (await json<ChatConversation>('C', `chat/conversations/${chats.get('C')}`)).messages.filter(message =>
                    message.content.includes('FIXED_B_TO_C_REVIEW')
                )
            ).toHaveLength(1)
            expect(calls.some(call => call.model === 'C')).toBe(false)
            await modelTurn('C', '请回复这个问题：评估已完成', 'collaboration_reply', 'FIXED_C_ORIGINAL_REPLY')
            await confirm('C', chats.get('C')!)
            await modelTurn('C', '请回传给上游：额外补充说明', 'collaboration_message', 'FIXED_C_UPSTREAM_RELAY_WITHOUT_QUESTION')
            const relay = await confirm('C', chats.get('C')!)
            expect(relay.draft.questionId).toBeUndefined()
            expect(relay.result.questionId).toBeUndefined()
            await modelTurn('C', '请把方案交给下游', 'collaboration_handoff', '不存在叶节点下游', true)
            expect((await events('C', chats.get('C')!)).pendingDispatches.filter(draft => draft.status === 'pending')).toEqual([])
            const after = await json<CollaborationProject>('A', projectPath)
            expect(after.nodes).toHaveLength(3)
            expect(after.nodes.find(node => node.id === launched.nodeIds[0])!.goal).toBe(aGoalBefore)
            expect((await json<CollaborationProject>('B', projectPath)).nodes.find(node => node.id === launched.nodeIds[1])!.goal).toBe(
                bGoalBefore
            )
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(3)
            expect((await pool.query('SELECT source_id,session_id FROM harness_collaboration_sources ORDER BY source_id')).rows).toEqual(
                bindings
            )
            for (const name of ['A', 'B', 'C'])
                expect(calls.find(call => call.model === name)!.authorization).toBe(`Bearer workflow-test-key-${name}`)
            expect(calls.every(call => !JSON.stringify(call.messages).includes('PRIVATE_WORKFLOW_DESCRIPTION_NOT_AUTOINJECTED'))).toBe(true)
            expect(calls.every(call => !JSON.stringify(call.messages).includes('PRIVATE_PROJECT_DESCRIPTION_NOT_AUTOINJECTED'))).toBe(true)
            await pool.query('ALTER TABLE harness_project_templates RENAME TO sf018_unavailable_templates')
            try {
                expect((await call('A', 'chat/template-catalog')).status).toBe(503)
            } finally {
                await pool.query('ALTER TABLE sf018_unavailable_templates RENAME TO harness_project_templates')
            }
            expect((await json<WorkflowTemplate>('A', path)).nodes.map(node => node.id)).toEqual(ids)
        })
    },
    90000
)
