// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowTemplate, WorkflowTemplateInput } from '@ai-harness/contracts'
import { TemplateWorkspace } from '../../components/template-workspace'
import { WorkflowTemplateEditor } from '../../components/workflow-template'
import type { WorkflowGraphNode } from '../../components/workflow-graph'
import { acceptanceDeferred } from './shadcn-acceptance-fixture'
import { installWorkflowFlowBrowser } from './workflow-react-flow-fixture'

const api = vi.hoisted(() => ({
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    preview: vi.fn(),
    launch: vi.fn(),
    search: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    catalog: vi.fn(),
    catalogGet: vi.fn(),
    status: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.push, replace: api.replace }) }))
vi.mock('../../components/account-context', () => ({
    useAccount: () => ({
        user: { id: '48484848-4848-4848-8848-484848484848', username: '真实本人' },
        modelLabel: (value: string) => value,
    }),
}))
vi.mock('../../lib/workflow-template-client', () => ({
    listTemplateCatalog: api.catalog,
    getTemplateCatalogEntry: api.catalogGet,
    getWorkflowTemplate: api.get,
    createWorkflowTemplate: api.create,
    updateWorkflowTemplate: api.update,
    previewWorkflowTemplate: api.preview,
    launchWorkflowTemplate: api.launch,
}))
vi.mock('../../lib/collaboration-client', () => ({ searchCollaborationPeople: api.search }))
vi.mock('../../lib/chat-client', async () => ({
    ...(await vi.importActual<typeof import('../../lib/chat-client')>('../../lib/chat-client')),
    getChatStatus: api.status,
}))

const ids = ['18181818-1818-4818-8818-181818181818', '28282828-2828-4828-8828-282828282828', '38383838-3838-4838-8838-383838383838']
const original: WorkflowGraphNode[] = ids.map((id, index) => ({
    id,
    title: ['销售整理', '产品判断', '工程评估'][index]!,
    ownerName: index === 0 ? '本人负责人' : '真实同名同事',
    upstreamNodeId: index === 0 ? null : ids[index - 1]!,
    position: { x: 100 + index * 250, y: 100 + index * 250 },
}))
let restoreHitTesting: (() => void) | undefined
beforeEach(() => {
    restoreHitTesting = installWorkflowFlowBrowser(390)
    for (const mock of Object.values(api)) mock.mockReset()
    api.search.mockResolvedValue([])
    api.catalog.mockResolvedValue([])
    api.status.mockResolvedValue({ configured: true, model: 'safe-fixture', storage: 'postgres' })
})
afterEach(() => {
    cleanup()
    restoreHitTesting?.()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const ownerId = '48484848-4848-4848-8848-484848484848'
const colleagueId = '58585858-5858-4858-8858-585858585858'
const templateId = '68686868-6868-4868-8868-686868686868'
const now = '2026-10-20T01:00:00.000Z'
const savedTemplate: WorkflowTemplate = {
    id: templateId,
    name: '客户反馈固定流程',
    description: 'TEMPLATE_DESCRIPTION_PRIVATE',
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: original.map((node, index) => ({
        ...node,
        goal: `节点${index}完整工作说明\n第二行`,
        assigneeId: index === 0 ? ownerId : colleagueId,
        assigneeName: index === 0 ? '真实本人' : '真实同名同事',
        assigneeActive: true,
    })),
}

/**
 * Returns a full saved response while preserving normalized human-edited node identities.
 * @param input - Explicit graph fields sent by the real editor.
 * @param version - Confirmed server version.
 * @returns A valid server-owned graph with real public assignee labels.
 */
function confirmTemplate(input: WorkflowTemplateInput, version: number): WorkflowTemplate {
    return {
        ...savedTemplate,
        ...input,
        version,
        nodes: input.nodes.map(node => ({
            ...node,
            assigneeName: node.assigneeId === ownerId ? '真实本人' : '真实同名同事',
            assigneeActive: true,
        })),
    }
}

/**
 * Opens one exact responsibility through its real native React Flow wrapper, or selects it with the native keyboard.
 * @param id - Stable responsibility identity rather than a possibly duplicated display name.
 * @param edit - Whether the explicit pointer action should open its modal editor.
 * @returns The selected native canvas node.
 */
function selectFlowNode(id: string, edit = true): HTMLElement {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
    expect(node).not.toBeNull()
    if (edit) fireEvent.click(node!)
    else {
        act(() => node!.focus())
        fireEvent.keyDown(node!, { key: 'Enter', code: 'Enter' })
    }
    return node!
}

/**
 * Closes the modal while retaining the explicitly edited node in the unsaved template draft.
 * @param user - Real user-event keyboard and pointer driver.
 * @returns Completion after the modal is removed and the background editor becomes usable.
 */
async function finishNodeEdit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const dialog = screen.getByRole('dialog', { name: '编辑节点' })
    await user.click(within(dialog).getByRole('button', { name: '完成编辑' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑节点' })).toBeNull())
}

describe('independent retained workflow editor', () => {
    it('keeps node properties out of the page and edits them in a focused portal while Escape and completion retain only the unsaved draft', async () => {
        const user = userEvent.setup()
        const rendered = render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
        expect(window.innerWidth).toBe(390)
        expect(screen.queryByRole('dialog', { name: '编辑节点' })).toBeNull()
        expect(screen.queryByLabelText('节点名称')).toBeNull()
        expect(screen.queryByLabelText('工作说明')).toBeNull()
        const editorForm = screen.getByLabelText('模板名称').closest('form')!
        const originalFieldCount = editorForm.querySelectorAll('input, textarea, select').length
        selectFlowNode(ids[1]!)
        let dialog = await screen.findByRole('dialog', { name: '编辑节点' })
        expect(rendered.container.contains(dialog)).toBe(false)
        expect(editorForm.contains(dialog)).toBe(false)
        expect(editorForm.querySelectorAll('input, textarea, select')).toHaveLength(originalFieldCount)
        expect(within(dialog).queryByRole('button', { name: '取消' })).toBeNull()
        expect(dialog.textContent).toMatch(/草稿/)
        expect(dialog.textContent).toMatch(/保存模板/)
        const title = within(dialog).getByLabelText('节点名称')
        await waitFor(() => expect(document.activeElement).toBe(title))
        fireEvent.change(title, { target: { value: '弹窗内完整节点名称' } })
        fireEvent.change(within(dialog).getByLabelText('工作说明'), { target: { value: '弹窗内完整正文\n关闭不会丢失' } })
        await user.keyboard('{Tab}')
        expect(dialog.contains(document.activeElement)).toBe(true)
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑节点' })).toBeNull())
        const opener = screen.getByRole('button', { name: '编辑节点' })
        await waitFor(() => expect(document.activeElement).toBe(opener))
        expect(screen.queryByLabelText('节点名称')).toBeNull()
        await user.click(opener)
        dialog = await screen.findByRole('dialog', { name: '编辑节点' })
        expect(within(dialog).getByLabelText('节点名称')).toHaveProperty('value', '弹窗内完整节点名称')
        expect(within(dialog).getByLabelText('工作说明')).toHaveProperty('value', '弹窗内完整正文\n关闭不会丢失')
        expect(within(dialog).getByLabelText('上游节点')).toHaveProperty('value', ids[0])
        await user.click(within(dialog).getByRole('button', { name: '关闭对话框' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑节点' })).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(opener))
        await user.click(opener)
        dialog = await screen.findByRole('dialog', { name: '编辑节点' })
        expect(within(dialog).getByLabelText('工作说明')).toHaveProperty('value', '弹窗内完整正文\n关闭不会丢失')
        await finishNodeEdit(user)
        await waitFor(() => expect(document.activeElement).toBe(opener))
        expect(editorForm.querySelectorAll('input, textarea, select')).toHaveLength(originalFieldCount)
        expect(api.update).not.toHaveBeenCalled()
        expect(api.create).not.toHaveBeenCalled()
        expect(api.preview).not.toHaveBeenCalled()
        expect(api.launch).not.toHaveBeenCalled()
    })

    it('opens and focuses the exact invalid responsibility when a human saves instead of revealing inline properties', async () => {
        const user = userEvent.setup()
        render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
        selectFlowNode(ids[2]!)
        fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '' } })
        await finishNodeEdit(user)
        selectFlowNode(ids[0]!, false)
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        const dialog = await screen.findByRole('dialog', { name: '编辑节点' })
        expect(document.querySelector<HTMLElement>('.react-flow__node-workflow.selected')?.dataset.id).toBe(ids[2])
        const title = within(dialog).getByLabelText('节点名称')
        expect(title).toHaveProperty('value', '')
        expect(title.getAttribute('aria-invalid')).toBe('true')
        await waitFor(() => expect(document.activeElement).toBe(title))
        expect(within(dialog).getByLabelText('工作说明')).toHaveProperty('value', savedTemplate.nodes[2]!.goal)
        expect(api.update).not.toHaveBeenCalled()
        expect(api.create).not.toHaveBeenCalled()
    })

    it('adds one stable selected downstream from the visible canvas toolbar, reveals it, and retains its complete draft through a failed save', async () => {
        const user = userEvent.setup()
        api.update.mockRejectedValueOnce(new Error('保存暂不可用'))
        api.update.mockImplementationOnce(async (_id: string, input: WorkflowTemplateInput) => confirmTemplate(input, 2))
        render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3))
        expect(screen.queryByRole('radio')).toBeNull()
        expect(screen.queryByRole('radiogroup')).toBeNull()
        expect(screen.queryByRole('list', { name: '完整节点列表' })).toBeNull()
        expect(screen.queryByRole('button', { name: /添加下游节点/ })).toBeNull()
        const add = screen.getByRole('button', { name: '添加节点（3/8）' })
        expect(screen.getAllByRole('button', { name: /添加节点/ })).toHaveLength(1)
        const canvas = screen.getByLabelText('流程画布')
        expect(add.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        await user.click(screen.getByRole('button', { name: '操作说明' }))
        expect(screen.getByText(/新节点默认作为当前选中节点的下游/)).toBeTruthy()
        selectFlowNode(ids[1]!, false)
        const viewport = canvas.querySelector<HTMLElement>('.react-flow__viewport')!
        await waitFor(() => expect(viewport.style.transform).toContain('scale('))
        const before = viewport.style.transform
        await user.click(add)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(4))
        const added = [...document.querySelectorAll<HTMLElement>('.react-flow__node-workflow')].find(
            node => !ids.includes(node.dataset.id!)
        )!
        const addedId = added.dataset.id!
        expect(addedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(added.classList.contains('selected')).toBe(true)
        expect(screen.getByLabelText('节点名称')).toHaveProperty('value', '')
        expect(screen.getByLabelText('工作说明')).toHaveProperty('value', '')
        expect(screen.getByLabelText('上游节点')).toHaveProperty('value', ids[1])
        expect(within(added).getByText('未设置处理人')).toBeTruthy()
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('节点名称')))
        await waitFor(() => {
            expect(viewport.style.transform).not.toBe(before)
            const bounds = canvas.querySelector<HTMLElement>('.react-flow')!.getBoundingClientRect()
            const rect = added.getBoundingClientRect()
            expect(rect.left).toBeGreaterThanOrEqual(bounds.left)
            expect(rect.right).toBeLessThanOrEqual(bounds.right)
            expect(rect.top).toBeGreaterThanOrEqual(bounds.top)
            expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom)
        })
        expect(api.create).not.toHaveBeenCalled()
        expect(api.update).not.toHaveBeenCalled()
        expect(api.preview).not.toHaveBeenCalled()
        expect(api.launch).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '新增质量检查' } })
        fireEvent.change(screen.getByLabelText('工作说明'), { target: { value: '本人的新增完整工作说明\n保留全部正文' } })
        await user.click(screen.getByRole('button', { name: `选择我自己 · ${ownerId.slice(0, 8)}` }))
        await finishNodeEdit(user)
        expect((screen.getByRole('button', { name: '暂不可启动' }) as HTMLButtonElement).disabled).toBe(true)
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        await screen.findByText('保存暂不可用')
        selectFlowNode(addedId)
        expect(screen.getByLabelText('节点名称')).toHaveProperty('value', '新增质量检查')
        expect(screen.getByLabelText('工作说明')).toHaveProperty('value', '本人的新增完整工作说明\n保留全部正文')
        expect(document.querySelector<HTMLElement>('.react-flow__node.selected')?.dataset.id).toBe(addedId)
        const first = api.update.mock.calls[0]![1] as WorkflowTemplateInput
        expect(first.nodes.slice(0, 3)).toEqual(
            savedTemplate.nodes.map(({ id, title, goal, assigneeId, upstreamNodeId, position }) => ({
                id,
                title,
                goal,
                assigneeId,
                upstreamNodeId,
                position,
            }))
        )
        expect(first.nodes[3]).toMatchObject({
            id: addedId,
            title: '新增质量检查',
            goal: '本人的新增完整工作说明\n保留全部正文',
            assigneeId: ownerId,
            upstreamNodeId: ids[1],
        })
        await finishNodeEdit(user)
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        await screen.findByText('协作流程已保存 · v2')
        expect(api.update.mock.calls[1]![1].nodes).toEqual(first.nodes)
        expect(api.preview).not.toHaveBeenCalled()
        expect(api.launch).not.toHaveBeenCalled()
    })

    it('keeps each added responsibility independent and disables the sole creation entry exactly at eight nodes', async () => {
        const user = userEvent.setup()
        render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3))
        let previousId = ids[0]!
        const addedIds: string[] = []
        for (let count = 3; count < 8; count++) {
            await user.click(screen.getByRole('button', { name: `添加节点（${count}/8）` }))
            await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(count + 1))
            const addedId = document.querySelector<HTMLElement>('.react-flow__node.selected')!.dataset.id!
            expect([...ids, ...addedIds]).not.toContain(addedId)
            expect(screen.getByLabelText('上游节点')).toHaveProperty('value', previousId)
            expect(screen.getByLabelText('节点名称')).toHaveProperty('value', '')
            addedIds.push(addedId)
            previousId = addedId
            await finishNodeEdit(user)
        }
        const full = screen.getByRole('button', { name: '添加节点（8/8）' }) as HTMLButtonElement
        expect(full.disabled).toBe(true)
        await user.dblClick(full)
        expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(8)
        expect(new Set([...document.querySelectorAll<HTMLElement>('.react-flow__node-workflow')].map(node => node.dataset.id)).size).toBe(8)
        for (const id of ids) expect(document.querySelector(`.react-flow__node[data-id="${id}"]`)).not.toBeNull()
        expect(api.create).not.toHaveBeenCalled()
        expect(api.update).not.toHaveBeenCalled()
        expect(api.preview).not.toHaveBeenCalled()
        expect(api.launch).not.toHaveBeenCalled()
        expect(api.push).not.toHaveBeenCalled()
        expect(api.replace).not.toHaveBeenCalled()
    })

    it('adds to a fresh two-node draft, permits an explicit upstream change, and blocks further creation while the human save is pending', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<WorkflowTemplate>()
        api.create.mockReturnValueOnce(pending.promise)
        render(<WorkflowTemplateEditor />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(2))
        const initialIds = [...document.querySelectorAll<HTMLElement>('.react-flow__node-workflow')].map(node => node.dataset.id!)
        expect(document.querySelectorAll('.react-flow__node-boundary')).toHaveLength(2)
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(4)
        expect(screen.queryByLabelText('节点名称')).toBeNull()
        selectFlowNode(initialIds[0]!)
        expect((screen.getByRole('button', { name: '删除节点' }) as HTMLButtonElement).disabled).toBe(true)
        await finishNodeEdit(user)
        selectFlowNode(initialIds[1]!, false)
        await user.click(screen.getByRole('button', { name: '添加节点（2/8）' }))
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3))
        const addedId = document.querySelector<HTMLElement>('.react-flow__node.selected')!.dataset.id!
        expect(initialIds).not.toContain(addedId)
        expect(screen.getByLabelText('上游节点')).toHaveProperty('value', initialIds[1])
        await finishNodeEdit(user)
        fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '从空白草稿明确创建' } })
        const allIds = [...initialIds, addedId]
        for (const [index, id] of allIds.entries()) {
            selectFlowNode(id)
            fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: `本人填写责任${index + 1}` } })
            fireEvent.change(screen.getByLabelText('工作说明'), { target: { value: `本人完整说明${index + 1}\n保持正文` } })
            await user.click(screen.getByRole('button', { name: `选择我自己 · ${ownerId.slice(0, 8)}` }))
            if (id === addedId) await user.selectOptions(screen.getByLabelText('上游节点'), initialIds[0]!)
            await finishNodeEdit(user)
        }
        expect(api.create).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
        const add = screen.getByRole('button', { name: '添加节点（3/8）' }) as HTMLButtonElement
        expect(add.disabled).toBe(true)
        expect(screen.getByRole('button', { name: '编辑节点' })).toHaveProperty('disabled', true)
        expect(screen.queryByLabelText('节点名称')).toBeNull()
        fireEvent.click(document.querySelector(`.react-flow__node-workflow[data-id="${addedId}"]`)!)
        expect(screen.queryByRole('dialog', { name: '编辑节点' })).toBeNull()
        await user.dblClick(add)
        expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3)
        expect(api.create).toHaveBeenCalledTimes(1)
        const input = api.create.mock.calls[0]![0] as WorkflowTemplateInput
        expect(input.nodes.map(node => node.id)).toEqual(allIds)
        expect(input.nodes.map(node => node.upstreamNodeId)).toEqual([null, initialIds[0], initialIds[0]])
        expect(input.nodes.map(node => node.goal)).toEqual(allIds.map((_, index) => `本人完整说明${index + 1}\n保持正文`))
        expect(input.nodes.every(node => node.assigneeId === ownerId)).toBe(true)
        await act(async () => pending.resolve(confirmTemplate(input, 1)))
        await screen.findByText('协作流程已保存 · v1')
        expect(screen.getByRole('button', { name: '添加节点（3/8）' })).toHaveProperty('disabled', false)
        expect([...document.querySelectorAll<HTMLElement>('.react-flow__node-workflow')].map(node => node.dataset.id)).toEqual(allIds)
        expect(api.preview).not.toHaveBeenCalled()
        expect(api.launch).not.toHaveBeenCalled()
    })

    it('chooses an exact same-name assignee without moving, merging or reparenting independent responsibilities', async () => {
        const user = userEvent.setup()
        const anotherColleague = '69696969-6969-4969-8969-696969696969'
        api.search.mockResolvedValue([
            { id: colleagueId, name: '真实同名同事' },
            { id: anotherColleague, name: '真实同名同事' },
        ])
        api.update.mockImplementation(async (_id: string, input: WorkflowTemplateInput) => confirmTemplate(input, 2))
        render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
        selectFlowNode(ids[1]!)
        await user.type(screen.getByLabelText('搜索处理人'), '同名')
        const results = await screen.findByRole('list', { name: '处理人搜索结果' })
        await user.click(await within(results).findByRole('button', { name: new RegExp(anotherColleague.slice(0, 8)) }))
        await finishNodeEdit(user)
        expect((screen.getByRole('button', { name: '暂不可启动' }) as HTMLButtonElement).disabled).toBe(true)
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        await screen.findByText('协作流程已保存 · v2')
        const sent = api.update.mock.calls[0]![1] as WorkflowTemplateInput
        expect(sent.nodes.map(node => node.id)).toEqual(ids)
        expect(sent.nodes[1]!.assigneeId).toBe(anotherColleague)
        expect(sent.nodes[0]!.assigneeId).toBe(ownerId)
        expect(sent.nodes[2]!.assigneeId).toBe(colleagueId)
        expect(sent.nodes.map(node => node.position)).toEqual(savedTemplate.nodes.map(node => node.position))
        expect(sent.nodes.map(node => node.upstreamNodeId)).toEqual(savedTemplate.nodes.map(node => node.upstreamNodeId))
    })

    it('requires an explicit single-root repair before saving a graph whose selected edge was disconnected', async () => {
        const user = userEvent.setup()
        render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(2))
        fireEvent.click(document.querySelector(`.react-flow__edge[data-id="workflow-edge-${ids[2]}"]`)!)
        await user.click(screen.getByRole('button', { name: '移除所选连接' }))
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        expect(await screen.findByText('流程必须恰好有一个起点。')).toBeTruthy()
        expect(api.update).not.toHaveBeenCalled()
        await finishNodeEdit(user)
        selectFlowNode(ids[2]!)
        expect((screen.getByLabelText('上游节点') as HTMLSelectElement).value).toBe('')
        await user.selectOptions(screen.getByLabelText('上游节点'), ids[0]!)
        await finishNodeEdit(user)
        api.update.mockImplementation(async (_id: string, input: WorkflowTemplateInput) => confirmTemplate(input, 2))
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        await screen.findByText('协作流程已保存 · v2')
        expect(api.update.mock.calls[0]![1].nodes[2]).toMatchObject({ id: ids[2], upstreamNodeId: ids[0], assigneeId: colleagueId })
    })

    it('retains exact selected work, moved layout, assignee and full goal through a version conflict and explicit comparison', async () => {
        const user = userEvent.setup()
        api.update.mockRejectedValueOnce(Object.assign(new Error('模板已有新版本'), { status: 409 }))
        api.get.mockResolvedValue({
            ...savedTemplate,
            version: 2,
            nodes: savedTemplate.nodes.map(node => ({ ...node, goal: '服务器最新目标' })),
        })
        api.update.mockImplementationOnce(async (_id: string, input: WorkflowTemplateInput & { version: number }) =>
            confirmTemplate(input, input.version + 1)
        )
        render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
        selectFlowNode(ids[1]!)
        fireEvent.change(screen.getByLabelText('工作说明'), { target: { value: '本地完整目标\n不能丢失' } })
        await finishNodeEdit(user)
        const nativeNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${ids[1]}"]`)!
        act(() => nativeNode.focus())
        await user.keyboard('{ArrowRight}')
        expect((screen.getByRole('button', { name: '暂不可启动' }) as HTMLButtonElement).disabled).toBe(true)
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        await screen.findByText('模板已有新版本')
        selectFlowNode(ids[1]!)
        expect((screen.getByLabelText('工作说明') as HTMLTextAreaElement).value).toBe('本地完整目标\n不能丢失')
        expect(api.update.mock.calls[0]![1].nodes[1]).toMatchObject({ id: ids[1], assigneeId: colleagueId, upstreamNodeId: ids[0] })
        const movedPosition = api.update.mock.calls[0]![1].nodes[1].position
        expect(movedPosition.x).toBeGreaterThan(savedTemplate.nodes[1]!.position.x)
        await finishNodeEdit(user)
        await user.click(screen.getByRole('button', { name: '重新读取，保留本地草稿' }))
        const compare = await screen.findByRole('dialog', { name: '核对最新版本 v2' })
        expect(within(compare).getAllByText('服务器最新目标')).toHaveLength(3)
        await user.click(within(compare).getByRole('button', { name: '保留本地草稿，采用最新版本基准' }))
        selectFlowNode(ids[1]!)
        expect((screen.getByLabelText('工作说明') as HTMLTextAreaElement).value).toBe('本地完整目标\n不能丢失')
        expect(screen.getByLabelText('节点名称')).toHaveProperty('value', '产品判断')
        await finishNodeEdit(user)
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        await screen.findByText('协作流程已保存 · v3')
        expect(api.update.mock.calls[1]![1]).toMatchObject({ version: 2 })
        expect(api.update.mock.calls[1]![1].nodes[1]).toMatchObject({ goal: '本地完整目标\n不能丢失', position: movedPosition })
    })

    it('shows affected children before deletion and retains broken references until an explicit upstream repair', async () => {
        const user = userEvent.setup()
        render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
        selectFlowNode(ids[1]!)
        await user.click(screen.getByRole('button', { name: '删除节点' }))
        const dialog = await screen.findByRole('dialog', { name: '删除这个节点？' })
        expect(within(dialog).getByText(`工程评估 · ${ids[2]!.slice(0, 8)}`)).toBeTruthy()
        await user.click(within(dialog).getByRole('button', { name: '删除节点' }))
        expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(2)
        expect(document.querySelector(`.react-flow__node[data-id="${ids[1]}"]`)).toBeNull()
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        expect(api.update).not.toHaveBeenCalled()
        await finishNodeEdit(user)
        selectFlowNode(ids[2]!)
        expect((screen.getByLabelText('上游节点') as HTMLSelectElement).value).toBe(ids[1])
        expect((screen.getByRole('button', { name: '删除节点' }) as HTMLButtonElement).disabled).toBe(true)
        expect(screen.getByRole('option', { name: new RegExp(`需要重新选择上游.*${ids[1]!.slice(0, 8)}`) })).toBeTruthy()
        await user.selectOptions(screen.getByLabelText('上游节点'), ids[0]!)
        await finishNodeEdit(user)
        api.update.mockImplementation(async (_id: string, input: WorkflowTemplateInput) => confirmTemplate(input, 2))
        await user.click(screen.getByRole('button', { name: '保存模板' }))
        await screen.findByText('协作流程已保存 · v2')
        expect(api.update.mock.calls[0]![1].nodes[1]).toMatchObject({ id: ids[2], upstreamNodeId: ids[0] })
    })
})

it('shows only workflow templates even when the compatible catalog also returns legacy personal data', async () => {
    const user = userEvent.setup()
    const personalId = '98989898-9898-4898-8898-989898989898'
    api.catalog.mockResolvedValue([
        { kind: 'workflow', template: savedTemplate },
        {
            kind: 'personal',
            template: {
                id: personalId,
                name: savedTemplate.name,
                description: '仅本人个人清单检索词',
                version: 2,
                tasks: [{ id: ids[0], title: '私有任务', goal: '仅本人目标' }],
                createdAt: now,
                updatedAt: now,
            },
        },
    ])
    render(<TemplateWorkspace />)
    await screen.findByText('1 个模板')
    expect(screen.getAllByRole('heading', { level: 2, name: savedTemplate.name })).toHaveLength(1)
    expect(screen.queryByRole('radio', { name: '个人清单' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: '模板类型筛选' })).toBeNull()
    expect(screen.queryByRole('link', { name: new RegExp(personalId.slice(0, 8)) })).toBeNull()
    expect(screen.queryByText('仅本人个人清单检索词')).toBeNull()
    expect(screen.queryByText('仅本人目标')).toBeNull()
    expect(screen.getByRole('link', { name: new RegExp(templateId.slice(0, 8)) })).toBeTruthy()
    const create = screen.getByText('新建模板').closest('a')
    expect(create?.getAttribute('href')).toBe('/templates/new')
    await user.type(screen.getByRole('searchbox', { name: '搜索模板名称或说明' }), '仅本人个人清单检索词')
    expect(screen.getByRole('heading', { name: '没有找到相关模板' })).toBeTruthy()
    expect(screen.getByText('1 个模板')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(screen.getByRole('heading', { level: 2, name: savedTemplate.name })).toBeTruthy()
})

it('offers the workflow empty state when the compatible directory contains only a legacy personal list', async () => {
    api.catalog.mockResolvedValue([
        {
            kind: 'personal',
            template: {
                id: templateId,
                name: '不再呈现的旧个人模板',
                description: '私有历史数据',
                version: 1,
                tasks: [{ id: ids[0], title: '旧任务', goal: '旧私有工作目标' }],
                createdAt: now,
                updatedAt: now,
            },
        },
    ])
    render(<TemplateWorkspace />)
    expect(await screen.findByRole('heading', { name: '创建第一份协作流程' })).toBeTruthy()
    expect(screen.getByText('0 个模板')).toBeTruthy()
    expect(screen.queryByText('不再呈现的旧个人模板')).toBeNull()
    expect(screen.queryByText('私有历史数据')).toBeNull()
    expect(screen.queryByRole('radio', { name: '个人清单' })).toBeNull()
})

it('retains workflow editing while preventing retired project launches', async () => {
    const user = userEvent.setup()
    render(<WorkflowTemplateEditor initialTemplate={savedTemplate} />)
    const launch = screen.getByRole('button', { name: '暂不可启动' }) as HTMLButtonElement
    expect(launch.disabled).toBe(true)
    await user.click(launch)
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.launch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存模板' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '启动协作流程' })).toBeNull()
})
