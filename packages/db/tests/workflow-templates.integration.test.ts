import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { workflowTemplateInputSchema, type ChatConversation, type WorkflowTemplateInput, type WorkflowPreview } from '@ai-harness/contracts'
import { CollaborationAccessError, CollaborationConflictError, createChatStore, type ChatScope, type ChatStore } from '../src/index.js'

/**
 * Provides two independent real PostgreSQL stores in a disposable schema.
 * @param run - Assertions against the test-owned scope and pools.
 * @returns After all stores, connections and the schema are released.
 */
async function database(run: (first: ChatStore, second: ChatStore, pool: pg.Pool) => Promise<void>): Promise<void> {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const schema = `sf018_db_${randomUUID().replaceAll('-', '')}`
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    let first: ChatStore | undefined
    let second: ChatStore | undefined
    try {
        first = await createChatStore({ databaseUrl: url.toString() })
        second = await createChatStore({ databaseUrl: url.toString() })
        await run(first, second, pool)
    } finally {
        await Promise.allSettled([first?.close(), second?.close(), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Seeds an account without any model connection or private business records.
 * @param store - Real account persistence.
 * @param name - Public identity used by safe projections.
 * @returns The stable historical scope and normalized email.
 */
async function account(store: ChatStore, name: string) {
    const userId = randomUUID()
    const scope: ChatScope = { userId, workspaceId: 'sf018-home' }
    const email = `${userId}@example.test`
    const now = new Date().toISOString()
    await store.accounts!.createUser({
        user: { id: userId, username: name, email, createdAt: now, updatedAt: now },
        passwordHash: 'explicit-isolated-test-verifier',
        credentialVersion: 1,
        workspaceId: scope.workspaceId,
    })
    return { scope, email }
}

/**
 * Separates Workspace ownership, project ownership, project membership and outsider identities.
 * @param store - Real shared-pool persistence.
 * @returns Four effective teammates and a nonmember, with deliberately different owners.
 */
async function teammates(store: ChatStore) {
    const workspaceOwner = await account(store, 'Workspace owner')
    const owner = await account(store, 'Project owner')
    const member = await account(store, 'Project member')
    const candidate = await account(store, 'Candidate')
    const outsider = await account(store, 'Outsider')
    const team = await store.workspaces!.create(workspaceOwner.scope, { requestId: randomUUID(), name: '团队项目测试', description: '' })
    for (const person of [owner, member, candidate]) {
        const invitation = await store.workspaces!.invite(workspaceOwner.scope, team.id, { requestId: randomUUID(), email: person.email })
        await store.workspaces!.respond(person.scope, invitation.id, true)
    }
    return {
        workspaceOwner: { ...workspaceOwner.scope, workspaceId: team.id },
        owner: { ...owner.scope, workspaceId: team.id },
        member: { ...member.scope, workspaceId: team.id },
        candidate: { ...candidate.scope, workspaceId: team.id },
        outsider: { ...outsider.scope, workspaceId: team.id },
        home: owner.scope,
        memberHome: member.scope,
        memberEmail: member.email,
    }
}

/**
 * Prepares only the API's non-secret empty owner dialogue snapshot.
 * @param title - Explicit private work title.
 * @returns A valid ordinary empty conversation without model execution.
 */
function dialogue(title = '本人工作'): ChatConversation {
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        title,
        messages: [],
        createdAt: now,
        updatedAt: now,
        agent: {
            id: randomUUID(),
            name: '本人 Agent',
            description: '',
            modelId: 'system-fixture',
            systemPrompt: 'PRIVATE_PROMPT',
            toolIds: [],
            openingMessages: [],
            createdAt: now,
            updatedAt: now,
        },
    }
}

/**
 * Creates a stable connected tree while allowing one real person to own adjacent works.
 * @param people - Actual assignee identities in node order.
 * @returns An independently editable complete valid template graph.
 */
function graph(people: string[]): WorkflowTemplateInput {
    const ids = people.map(() => randomUUID())
    return {
        name: '固定责任流程',
        description: 'PRIVATE_TEMPLATE_DESCRIPTION',
        nodes: people.map((assigneeId, index) => ({
            id: ids[index]!,
            title: `工作${index + 1}`,
            goal: `PRIVATE_GOAL_${index + 1}\n完成后请交给下游，仅作模板参考。`,
            assigneeId,
            upstreamNodeId: index === 0 ? null : ids[index - 1]!,
            position: { x: index * 200, y: index * 200 },
        })),
    }
}

/**
 * Prepares distinct non-secret empty ordinary route snapshots for every original node.
 * @param preview - Actual frozen server preview.
 * @returns Empty conversations keyed by original stable node identity.
 */
function dialogues(preview: WorkflowPreview): Record<string, ChatConversation> {
    return Object.fromEntries(preview.nodes.map(node => [node.id, dialogue(node.title)]))
}

/**
 * Builds a legacy kindless personal template without workflow ownership or graph fields.
 * @param id - Exact saved template identity, including a deliberate cross-kind collision.
 * @returns A valid original personal blueprint record.
 */
function personal(id: string) {
    const now = new Date().toISOString()
    const input = { name: '旧个人清单', description: '个人说明', tasks: [{ id: randomUUID(), title: '个人任务', goal: '本人任务目标' }] }
    return { template: { id, ...input, version: 1, createdAt: now, updatedAt: now }, creation: input }
}

describe('independent workflow graph contract boundaries', () => {
    it('accepts only a complete canonical two-to-eight-node finite tree within every text limit', () => {
        const valid = graph([randomUUID(), randomUUID()])
        expect(workflowTemplateInputSchema.safeParse(valid).success).toBe(true)
        const eight = graph(Array.from({ length: 8 }, () => randomUUID()))
        eight.nodes = eight.nodes.map((node, index) => ({ ...node, position: { x: index * 100, y: index * 100 }, goal: '目'.repeat(4000) }))
        expect(workflowTemplateInputSchema.safeParse({ ...eight, name: '名'.repeat(120), description: '说'.repeat(2000) }).success).toBe(
            true
        )
        const invalid = [
            { ...valid, nodes: [valid.nodes[0]!] },
            { ...valid, nodes: graph(Array.from({ length: 9 }, () => randomUUID())).nodes },
            { ...valid, name: ' ' },
            { ...valid, name: '名'.repeat(121) },
            { ...valid, description: '说'.repeat(2001) },
            { ...valid, nodes: valid.nodes.map(node => ({ ...node, id: valid.nodes[0]!.id })) },
            { ...valid, nodes: valid.nodes.map(node => ({ ...node, upstreamNodeId: null })) },
            { ...valid, nodes: valid.nodes.map(node => ({ ...node, upstreamNodeId: node.id })) },
            { ...valid, nodes: valid.nodes.map((node, index) => ({ ...node, upstreamNodeId: valid.nodes[1 - index]!.id })) },
            { ...valid, nodes: [valid.nodes[0]!, { ...valid.nodes[1]!, upstreamNodeId: randomUUID() }] },
            { ...valid, nodes: [valid.nodes[0]!, { ...valid.nodes[1]!, goal: '目'.repeat(8001) }] },
            { ...eight, nodes: eight.nodes.map(node => ({ ...node, goal: '目'.repeat(4001) })) },
            ...[NaN, Infinity, -1, 1001, 0.5].map(x => ({
                ...valid,
                nodes: [valid.nodes[0]!, { ...valid.nodes[1]!, position: { x, y: 10 } }],
            })),
            { ...valid, nodes: [valid.nodes[0]!, { ...valid.nodes[1]!, ownerId: randomUUID() }] },
        ]
        for (const value of invalid) expect(workflowTemplateInputSchema.safeParse(value).success).toBe(false)
        const canonical = workflowTemplateInputSchema.parse({
            ...valid,
            nodes: valid.nodes.map(node => ({
                ...node,
                id: node.id.toUpperCase(),
                assigneeId: node.assigneeId.toUpperCase(),
                upstreamNodeId: node.upstreamNodeId?.toUpperCase() ?? null,
            })),
        })
        expect(canonical.nodes).toEqual(valid.nodes)
    })
})

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent real PostgreSQL workflow templates', () => {
    it('fences cancelled, superseded, revoked, rejoined and terminal fixed targets without copying or reviving their sources', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            const id = randomUUID()
            await first.collaboration!.saveWorkflowTemplate(people.owner, id, graph([people.owner.userId, people.member.userId]))

            /**
             * Launches a newly reviewed instance without reusing a previous revoked grant.
             * @returns Fresh project, fixed source and target identities plus the exact launch action.
             */
            async function fresh() {
                const preview = await first.collaboration!.previewWorkflow(people.owner, id, {
                    version: 1,
                    name: '撤权边界实例',
                    description: '',
                })
                const action = { requestId: randomUUID(), previewId: preview.previewId }
                const result = await first.collaboration!.launchWorkflow(people.owner, id, action, dialogues(preview))
                const root = (await first.collaboration!.node(people.owner, result.nodeIds[0]!))!.node
                const target = (await first.collaboration!.node(people.member, result.nodeIds[1]!))!.node
                return { action, result, root, target }
            }

            /**
             * Stages a real leased explicit-owner draft while leaving target effects uncommitted.
             * @param source - Exact current fixed source.
             * @returns The dedicated immutable preview confirmation command.
             */
            async function stage(source: NonNullable<Awaited<ReturnType<typeof fresh>>['root']['source']>) {
                await first.collaboration!.enqueue(people.owner, { requestId: randomUUID(), source, content: '请把方案交给下游处理' })
                const lease = (await first.collaboration!.claim(30_000))!
                const allowed = (await first.collaboration!.fixedActions(lease)).actions[0]!
                expect(allowed).toBeDefined()
                const draft = await first.collaboration!.propose(
                    people.owner,
                    {
                        type: 'fixed-contact',
                        requestId: randomUUID(),
                        contactRequestId: allowed.id,
                        content: '未经最终确认不能投递的完整正文',
                    },
                    { authorKind: 'agent', lease }
                )
                await first.collaboration!.settle(lease, { status: 'waiting' })
                return { type: 'confirm-dispatch' as const, requestId: randomUUID(), draftId: draft.draftId!, version: draft.draftVersion! }
            }

            const original = await fresh()
            const cancelled = await stage(original.root.source!)
            await second.collaboration!.mutate(people.owner, {
                type: 'cancel-dispatch',
                requestId: randomUUID(),
                draftId: cancelled.draftId,
                version: cancelled.version,
            })
            await expect(second.collaboration!.mutate(people.owner, cancelled)).rejects.toThrow()
            const replaced = await stage(original.root.source!)
            await first.collaboration!.enqueue(people.owner, { requestId: randomUUID(), source: original.root.source!, content: '确认' })
            const ordinary = (await first.collaboration!.claim(30_000))!
            expect((await first.collaboration!.fixedActions(ordinary)).actions).toEqual([])
            await first.collaboration!.settle(ordinary, { status: 'complete' })
            await expect(second.collaboration!.mutate(people.owner, replaced)).rejects.toThrow()
            const revoked = await stage(original.root.source!)
            await first.collaboration!.mutate(people.owner, {
                type: 'revoke',
                requestId: randomUUID(),
                projectId: original.result.projectId,
                revision: (await first.collaboration!.project(people.owner, original.result.projectId))!.revision,
                userId: people.member.userId,
            })
            await expect(second.collaboration!.mutate(people.owner, revoked)).rejects.toThrow()
            await first.collaboration!.mutate(people.owner, {
                type: 'project-members-add',
                requestId: randomUUID(),
                projectId: original.result.projectId,
                revision: (await first.collaboration!.project(people.owner, original.result.projectId))!.revision,
                memberIds: [people.member.userId],
            })
            await expect(second.collaboration!.mutate(people.owner, revoked)).rejects.toThrow()
            expect(await second.collaboration!.launchWorkflow(people.owner, id, original.action, {})).toEqual(original.result)
            expect((await second.get(people.member, original.target.source!.id))!.messages).toHaveLength(1)
            const workspace = await fresh()
            const oldWorkspaceDraft = await stage(workspace.root.source!)
            await first.workspaces!.remove(people.workspaceOwner, people.owner.workspaceId, people.member.userId)
            await expect(second.collaboration!.mutate(people.owner, oldWorkspaceDraft)).rejects.toThrow()
            const invitation = await first.workspaces!.invite(people.workspaceOwner, people.owner.workspaceId, {
                requestId: randomUUID(),
                email: people.memberEmail,
            })
            await first.workspaces!.respond(people.memberHome, invitation.id, true)
            await expect(second.collaboration!.mutate(people.owner, oldWorkspaceDraft)).rejects.toThrow()
            for (const terminal of ['cancelled', 'completed']) {
                const instance = await fresh()
                const pending = await stage(instance.root.source!)
                if (terminal === 'cancelled') {
                    await second.collaboration!.mutate(people.member, {
                        type: 'cancel',
                        requestId: randomUUID(),
                        nodeId: instance.target.id,
                        revision: (await second.collaboration!.node(people.member, instance.target.id))!.node.revision,
                    })
                } else {
                    // A historical completed responsibility is a controlled persistent fixture, not a new completion UI.
                    const state = (
                        await pool.query('SELECT data FROM harness_collaboration_state WHERE workspace_id=$1', [people.owner.workspaceId])
                    ).rows[0].data
                    state.nodes[instance.target.id].status = 'completed'
                    await pool.query('UPDATE harness_collaboration_state SET data=$2::jsonb WHERE workspace_id=$1', [
                        people.owner.workspaceId,
                        JSON.stringify(state),
                    ])
                }
                await expect(second.collaboration!.mutate(people.owner, pending)).rejects.toThrow()
                expect((await second.get(people.member, instance.target.source!.id))!.messages).toHaveLength(1)
                expect(await second.collaboration!.launchWorkflow(people.owner, id, instance.action, {})).toEqual(instance.result)
                expect((await second.collaboration!.project(people.owner, instance.result.projectId))!.nodes).toHaveLength(2)
            }
        })
    }, 30000)

    it('treats adjacent works owned by the same person as distinct fixed sources and denies a direct Agent ask bypass', async () => {
        await database(async (first, second) => {
            const people = await teammates(first)
            const id = randomUUID()
            const input = graph([people.member.userId, people.member.userId])
            await first.collaboration!.saveWorkflowTemplate(people.owner, id, input)
            const preview = await first.collaboration!.previewWorkflow(people.owner, id, {
                version: 1,
                name: '同人不同工作',
                description: '',
            })
            const launch = await first.collaboration!.launchWorkflow(
                people.owner,
                id,
                { requestId: randomUUID(), previewId: preview.previewId },
                dialogues(preview)
            )
            const child = (await first.collaboration!.node(people.member, launch.nodeIds[1]!))!.node
            const parent = (await first.collaboration!.node(people.member, launch.nodeIds[0]!))!.node
            expect(child.source!.id).not.toBe(parent.source!.id)
            await first.collaboration!.enqueue(people.member, {
                requestId: randomUUID(),
                source: child.source!,
                content: '分析这个工作的目标',
            })
            const ordinary = (await first.collaboration!.claim(30_000))!
            await expect(
                second.collaboration!.mutate(
                    people.member,
                    {
                        type: 'ask',
                        requestId: randomUUID(),
                        nodeId: child.id,
                        revision: (await first.collaboration!.node(people.member, child.id))!.node.revision,
                        targetNodeId: parent.id,
                        question: '同账户跨节点恶意越过固定请求',
                        context: '',
                    },
                    { authorKind: 'agent', lease: ordinary }
                )
            ).rejects.toThrow()
            expect(await second.collaboration!.fixedActions(ordinary)).toEqual({ fixed: true, actions: [] })
            await first.collaboration!.settle(ordinary, { status: 'complete' })
            await first.collaboration!.enqueue(people.member, {
                requestId: randomUUID(),
                source: child.source!,
                content: '请向上游补问：这个约束是什么？',
            })
            const explicit = (await first.collaboration!.claim(30_000))!
            const allowed = (await second.collaboration!.fixedActions(explicit)).actions[0]!
            expect(allowed.targetNodeId).toBe(parent.id)
            const staged = await first.collaboration!.propose(
                people.member,
                { type: 'fixed-contact', requestId: randomUUID(), contactRequestId: allowed.id, content: 'SAME_PERSON_FIXED_QUESTION' },
                { authorKind: 'agent', lease: explicit }
            )
            await first.collaboration!.settle(explicit, { status: 'waiting' })
            const delivered = await second.collaboration!.mutate(people.member, {
                type: 'confirm-dispatch',
                requestId: randomUUID(),
                draftId: staged.draftId!,
                version: staged.draftVersion!,
            })
            expect(delivered.nodeId).toBe(parent.id)
            expect(
                (await second.get(people.member, parent.source!.id))!.messages.some(message =>
                    message.content.includes('SAME_PERSON_FIXED_QUESTION')
                )
            ).toBe(true)
            expect((await second.collaboration!.project(people.member, launch.projectId))!.nodes).toHaveLength(2)
        })
    }, 30000)

    it('rejects forged fixed and legacy Agent tools under a genuine human lease without an exact current persisted contact request', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            const id = randomUUID()
            const input = graph([people.owner.userId, people.member.userId, people.candidate.userId])
            await first.collaboration!.saveWorkflowTemplate(people.owner, id, input)
            const preview = await first.collaboration!.previewWorkflow(people.owner, id, {
                version: 1,
                name: '恶意工具边界',
                description: '',
            })
            const launch = await first.collaboration!.launchWorkflow(
                people.owner,
                id,
                { requestId: randomUUID(), previewId: preview.previewId },
                dialogues(preview)
            )
            const middle = (await first.collaboration!.node(people.member, launch.nodeIds[1]!))!.node
            const source = middle.source!
            for (const content of [
                '开始',
                '分析',
                '确认',
                '知道了',
                '请先分析本人的工作，不要联系同事。',
                '模板写着“完成后请交给下游”，请解释这句话。',
                '> 请把方案交给下游',
                '讨论是否应交给下游',
                '把方案交给下游这件事，请帮我先分析一下',
                '向上游补问这件事请先分析一下',
            ]) {
                await first.collaboration!.enqueue(people.member, { requestId: randomUUID(), source, content })
                const lease = (await first.collaboration!.claim(30_000))!
                expect(lease.origin).toBe('human')
                expect(await second.collaboration!.fixedActions(lease)).toEqual({ fixed: true, actions: [] })
                const options = { authorKind: 'agent' as const, lease }
                await expect(
                    second.collaboration!.propose(
                        people.member,
                        { type: 'fixed-contact', requestId: randomUUID(), contactRequestId: randomUUID(), content: '恶意固定外发' },
                        options
                    )
                ).rejects.toThrow()
                await expect(
                    second.collaboration!.propose(
                        people.member,
                        {
                            type: 'ask',
                            requestId: randomUUID(),
                            nodeId: middle.id,
                            revision: (await first.collaboration!.node(people.member, middle.id))!.node.revision,
                            targetNodeId: launch.nodeIds[0]!,
                            question: '恶意沿旧问答工具外发',
                            context: '',
                        },
                        options
                    )
                ).rejects.toThrow()
                await expect(
                    second.collaboration!.propose(
                        people.member,
                        {
                            type: 'delegate',
                            requestId: randomUUID(),
                            source,
                            recipientId: people.candidate.userId,
                            title: '恶意新复制责任',
                            goal: '未经本人要求',
                            context: '',
                        },
                        options
                    )
                ).rejects.toThrow()
                await expect(
                    second.collaboration!.propose(
                        people.member,
                        {
                            type: 'message',
                            requestId: randomUUID(),
                            source,
                            recipientId: people.owner.userId,
                            content: '恶意沿旧消息工具外发',
                        },
                        options
                    )
                ).rejects.toThrow()
                expect((await second.collaboration!.sourceEvents(people.member, source)).pendingDispatches).toEqual([])
                expect(await first.collaboration!.settle(lease, { status: 'complete' })).toBe(true)
            }
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_workflow_contact_intents')).rows[0].n).toBe(0)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(3)
            expect((await first.collaboration!.project(people.owner, launch.projectId))!.nodes).toHaveLength(3)
            expect(
                (await first.get(people.owner, (await first.collaboration!.node(people.owner, launch.nodeIds[0]!))!.node.source!.id))!
                    .messages
            ).toEqual([])
        })
    }, 30000)

    it('requires genuine target clarification and never turns discussion of an exact candidate title into a renewed capability', async () => {
        await database(async (first, second) => {
            const people = await teammates(first)
            const id = randomUUID()
            const input = graph([people.owner.userId, people.member.userId, people.member.userId])
            input.nodes[2]!.upstreamNodeId = input.nodes[0]!.id
            input.nodes[1]!.title = '工程评估'
            input.nodes[2]!.title = '设计评审'
            await first.collaboration!.saveWorkflowTemplate(people.owner, id, input)
            const preview = await first.collaboration!.previewWorkflow(people.owner, id, {
                version: 1,
                name: '多目标澄清',
                description: '',
            })
            const launch = await first.collaboration!.launchWorkflow(
                people.owner,
                id,
                { requestId: randomUUID(), previewId: preview.previewId },
                dialogues(preview)
            )
            const root = (await first.collaboration!.node(people.owner, launch.nodeIds[0]!))!.node
            for (const discussion of ['帮我分析工程评估', '解释工程评估的工作说明', '工程评估的工作目标是什么？']) {
                await first.collaboration!.enqueue(people.owner, {
                    requestId: randomUUID(),
                    source: root.source!,
                    content: '请把方案交给下游',
                })
                const initial = (await first.collaboration!.claim(30_000))!
                const ambiguous = await first.collaboration!.fixedActions(initial)
                expect(ambiguous.actions).toEqual([])
                expect(ambiguous.clarification?.candidateNodeIds.sort()).toEqual(launch.nodeIds.slice(1).sort())
                await first.collaboration!.settle(initial, { status: 'complete' })
                await first.collaboration!.enqueue(people.owner, { requestId: randomUUID(), source: root.source!, content: discussion })
                const ordinary = (await first.collaboration!.claim(30_000))!
                expect(await second.collaboration!.fixedActions(ordinary)).toEqual({ fixed: true, actions: [] })
                await expect(
                    second.collaboration!.propose(
                        people.owner,
                        { type: 'fixed-contact', requestId: randomUUID(), contactRequestId: randomUUID(), content: '恶意扩展本轮讨论' },
                        { authorKind: 'agent', lease: ordinary }
                    )
                ).rejects.toThrow()
                await first.collaboration!.settle(ordinary, { status: 'complete' })
            }
            await first.collaboration!.enqueue(people.owner, { requestId: randomUUID(), source: root.source!, content: '请把方案交给下游' })
            const unclear = (await first.collaboration!.claim(30_000))!
            await first.collaboration!.settle(unclear, { status: 'complete' })
            await first.collaboration!.enqueue(people.owner, { requestId: randomUUID(), source: root.source!, content: '就是设计评审' })
            const selected = (await first.collaboration!.claim(30_000))!
            const allowed = await second.collaboration!.fixedActions(selected)
            expect(allowed.actions).toHaveLength(1)
            expect(allowed.actions[0]!.targetNodeId).toBe(launch.nodeIds[2])
            await first.collaboration!.settle(selected, { status: 'complete' })
        })
    }, 30000)

    it('keeps immutable kind and exact ownership under colliding personal/workflow IDs and concurrent updates', async () => {
        await database(async (first, second) => {
            const people = await teammates(first)
            const input = graph([people.owner.userId, people.member.userId])
            const legacy = personal(randomUUID())
            await first.templates!.save(people.owner, legacy)
            expect(await first.collaboration!.templateKind(people.owner, legacy.template.id)).toBe('personal')
            await expect(second.collaboration!.saveWorkflowTemplate(people.owner, legacy.template.id, input)).rejects.toThrow()
            const id = randomUUID()
            const saved = await first.collaboration!.saveWorkflowTemplate(people.owner, id, input)
            expect(saved.version).toBe(1)
            expect(await second.collaboration!.saveWorkflowTemplate(people.owner, id.toUpperCase(), input)).toEqual(saved)
            await expect(second.templates!.save(people.owner, personal(id), 1)).rejects.toThrow()
            expect(await first.templates!.list(people.owner)).toEqual([legacy])
            await expect(second.templates!.get(people.owner, id)).rejects.toThrow()
            expect(await second.collaboration!.workflowTemplates(people.member)).toEqual([])
            expect(await second.collaboration!.workflowTemplate(people.home, id)).toBeUndefined()
            await expect(second.collaboration!.saveWorkflowTemplate(people.owner, id, { ...input, name: '重放改内容' })).rejects.toThrow()
            const edits = await Promise.allSettled([
                first.collaboration!.saveWorkflowTemplate(people.owner, id, { ...input, name: '并发一' }, 1),
                second.collaboration!.saveWorkflowTemplate(people.owner, id, { ...input, name: '并发二' }, 1),
            ])
            expect(edits.filter(edit => edit.status === 'fulfilled')).toHaveLength(1)
            expect((await first.collaboration!.workflowTemplate(people.owner, id))!.version).toBe(2)
            await expect(
                first.collaboration!.saveWorkflowTemplate(people.owner, randomUUID(), graph([people.owner.userId, people.outsider.userId]))
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            for (let iteration = 0; iteration < 3; iteration++) {
                const sharedId = randomUUID()
                const collision = await Promise.allSettled([
                    first.templates!.save(people.owner, personal(sharedId)),
                    second.collaboration!.saveWorkflowTemplate(people.owner, sharedId, input),
                ])
                expect(collision.filter(value => value.status === 'fulfilled')).toHaveLength(1)
            }
        })
    }, 30000)

    it('freezes complete exact openings and creates a separate ordinary source per same-person node without a hidden owner work', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            const id = randomUUID()
            const input = graph([people.member.userId, people.member.userId, people.candidate.userId])
            await first.collaboration!.saveWorkflowTemplate(people.owner, id, input)
            const preview = await first.collaboration!.previewWorkflow(people.owner, id, {
                version: 1,
                name: '实际新项目',
                description: '本次完整共享说明\n第二行',
            })
            expect(preview.members.map(member => member.userId).sort()).toEqual(
                [people.owner.userId, people.member.userId, people.candidate.userId].sort()
            )
            expect(
                preview.nodes.every(
                    node =>
                        typeof node.opening === 'string' && node.opening.includes(node.goal) && node.opening.includes(people.owner.userId)
                )
            ).toBe(true)
            const launch = { requestId: randomUUID(), previewId: preview.previewId }
            const snapshots = dialogues(preview)
            const results = await Promise.all([
                first.collaboration!.launchWorkflow(people.owner, id, launch, snapshots),
                second.collaboration!.launchWorkflow(people.owner, id, launch, dialogues(preview)),
            ])
            expect(results[1]).toEqual(results[0])
            const result = results[0]!
            expect(result.nodeIds).toHaveLength(3)
            const project = (await first.collaboration!.project(people.owner, result.projectId))!
            expect(project.nodes).toHaveLength(3)
            expect(project.nodes.some(node => node.ownerId === people.owner.userId)).toBe(false)
            expect((await first.collaboration!.progress(people.owner, result.projectId)).nodes.some(node => node.ownHref)).toBe(false)
            const sources = new Set<string>()
            for (const [index, original] of preview.nodes.entries()) {
                const scope = { ...people.owner, userId: original.assigneeId }
                const node = (await second.collaboration!.node(scope, result.nodeIds[index]!))!.node
                expect(node.workflowOrigin).toEqual({ templateId: id, version: 1, nodeId: original.id, position: original.position })
                const chat = (await second.get(scope, node.source!.id))!
                sources.add(node.source!.id)
                expect(chat.messages).toHaveLength(1)
                expect(chat.messages[0]).toMatchObject({ role: 'assistant', kind: 'opening', content: original.opening })
                expect(Buffer.from(chat.messages[0]!.content)).toEqual(Buffer.from(original.opening!))
                expect(chat.task).toBeUndefined()
                expect(await second.get(people.owner, chat.id)).toBeUndefined()
                expect(chat.agent!.systemPrompt).toBe('PRIVATE_PROMPT')
            }
            expect(sources.size).toBe(3)
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_sources WHERE bound AND header IS NULL')).rows[0].n
            ).toBe(3)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_collaboration_jobs')).rows[0].n).toBe(0)
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations WHERE task_data IS NOT NULL')).rows[0].n
            ).toBe(0)
            expect((await first.collaboration!.notifications(people.member)).notifications).toEqual([])
            const changed = {
                ...input,
                nodes: input.nodes.map(node => ({
                    ...node,
                    assigneeId: people.owner.userId,
                    goal: '后续新版目标',
                    position: { x: 900, y: 900 },
                })),
            }
            await first.collaboration!.saveWorkflowTemplate(people.owner, id, changed, 1)
            expect(await second.collaboration!.launchWorkflow(people.owner, id, launch, {})).toEqual(result)
            expect((await second.collaboration!.project(people.owner, result.projectId))!.nodes.map(node => node.workflowOrigin)).toEqual(
                project.nodes.map(node => node.workflowOrigin)
            )
            const newPreview = await second.collaboration!.previewWorkflow(people.owner, id, {
                version: 2,
                name: '新一版实例',
                description: '',
            })
            const newResult = await first.collaboration!.launchWorkflow(
                people.owner,
                id,
                { requestId: randomUUID(), previewId: newPreview.previewId },
                dialogues(newPreview)
            )
            const own = (await second.collaboration!.project(people.owner, newResult.projectId))!
            for (const node of own.nodes) expect((await second.get(people.owner, node.source!.id))!.messages).toEqual([])
        })
    }, 30000)

    it('rejects stale versions and pre-removal membership generations without silently replacing a namesake or saved assignment', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            await pool.query('UPDATE harness_accounts SET username=$2 WHERE id=$1', [people.candidate.userId, 'Project member'])
            const id = randomUUID()
            const input = graph([people.owner.userId, people.member.userId])
            await first.collaboration!.saveWorkflowTemplate(people.owner, id, input)
            const preview = await first.collaboration!.previewWorkflow(people.owner, id, { version: 1, name: '预览一', description: '' })
            await first.workspaces!.remove(people.workspaceOwner, people.owner.workspaceId, people.member.userId)
            const stale = (await second.collaboration!.workflowTemplate(people.owner, id))!
            expect(stale.nodes[1]).toMatchObject({ assigneeId: people.member.userId, assigneeActive: false })
            await expect(
                second.collaboration!.previewWorkflow(people.owner, id, { version: 1, name: '失效原处理人', description: '' })
            ).rejects.toBeInstanceOf(CollaborationAccessError)
            const substitute = await second.collaboration!.previewWorkflow(people.owner, id, {
                version: 1,
                name: '仅本次替换',
                description: '',
                assignees: [{ nodeId: input.nodes[1]!.id, assigneeId: people.candidate.userId }],
            })
            expect(substitute.nodes[1]!.assigneeId).toBe(people.candidate.userId)
            expect((await first.collaboration!.workflowTemplate(people.owner, id))!.nodes[1]!.assigneeId).toBe(people.member.userId)
            const invitation = await first.workspaces!.invite(people.workspaceOwner, people.owner.workspaceId, {
                requestId: randomUUID(),
                email: people.memberEmail,
            })
            await first.workspaces!.respond(people.memberHome, invitation.id, true)
            await expect(
                second.collaboration!.launchWorkflow(
                    people.owner,
                    id,
                    { requestId: randomUUID(), previewId: preview.previewId },
                    dialogues(preview)
                )
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            const fresh = await first.collaboration!.previewWorkflow(people.owner, id, {
                version: 1,
                name: '重新人工预览',
                description: '',
            })
            await first.collaboration!.saveWorkflowTemplate(people.owner, id, { ...input, name: '已更新为v2' }, 1)
            await expect(
                second.collaboration!.launchWorkflow(
                    people.owner,
                    id,
                    { requestId: randomUUID(), previewId: fresh.previewId },
                    dialogues(fresh)
                )
            ).rejects.toBeInstanceOf(CollaborationConflictError)
        })
    }, 30000)

    it('rolls back a partially inserted launch before retrying and never replays old work into a removed recipient', async () => {
        await database(async (first, second, pool) => {
            const people = await teammates(first)
            const id = randomUUID()
            await first.collaboration!.saveWorkflowTemplate(
                people.owner,
                id,
                graph([people.owner.userId, people.member.userId, people.candidate.userId])
            )
            const preview = await first.collaboration!.previewWorkflow(people.owner, id, {
                version: 1,
                name: '事务失败实例',
                description: '',
            })
            const action = { requestId: randomUUID(), previewId: preview.previewId }
            const snapshots = dialogues(preview)
            await pool.query(
                `CREATE FUNCTION sf018_fail_opening() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${people.member.userId}' THEN RAISE EXCEPTION 'controlled launch insertion failure'; END IF; RETURN NEW; END $$`
            )
            await pool.query(
                'CREATE TRIGGER sf018_chat_failure BEFORE INSERT ON harness_chat_conversations FOR EACH ROW EXECUTE FUNCTION sf018_fail_opening()'
            )
            await expect(first.collaboration!.launchWorkflow(people.owner, id, action, snapshots)).rejects.toThrow()
            expect(await second.collaboration!.projects(people.owner)).toEqual([])
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(0)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_workflow_launches')).rows[0].n).toBe(0)
            await pool.query('DROP TRIGGER sf018_chat_failure ON harness_chat_conversations')
            const launched = await first.collaboration!.launchWorkflow(people.owner, id, action, snapshots)
            const other = await first.collaboration!.previewWorkflow(people.owner, id, { version: 1, name: '另一预览', description: '' })
            await expect(
                second.collaboration!.launchWorkflow(people.owner, id, { ...action, previewId: other.previewId }, {})
            ).rejects.toBeInstanceOf(CollaborationConflictError)
            const project = (await first.collaboration!.project(people.owner, launched.projectId))!
            await first.collaboration!.mutate(people.owner, {
                type: 'revoke',
                requestId: randomUUID(),
                projectId: launched.projectId,
                revision: project.revision,
                userId: people.member.userId,
            })
            expect(await second.collaboration!.launchWorkflow(people.owner, id, action, {})).toEqual(launched)
            const replayed = (await second.collaboration!.project(people.owner, launched.projectId))!
            expect(replayed.members.find(member => member.id === people.member.userId)!.status).toBe('revoked')
            expect(replayed.nodes.find(node => node.ownerId === people.member.userId)!.status).toBe('cancelled')
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_chat_conversations')).rows[0].n).toBe(3)
            expect((await second.collaboration!.notifications(people.member)).notifications).toEqual([])
        })
    }, 30000)
})
