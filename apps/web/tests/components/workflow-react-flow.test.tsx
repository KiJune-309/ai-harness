// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowGraph, type WorkflowGraphNode } from '../../components/workflow-graph'
import { installWorkflowFlowBrowser } from './workflow-react-flow-fixture'

const ids = ['18181818-1818-4818-8818-181818181818', '28282828-2828-4828-8828-282828282828', '38383838-3838-4838-8838-383838383838']
const original: WorkflowGraphNode[] = ids.map((id, index) => ({
    id,
    title: ['销售整理', '产品判断', '工程评估'][index]!,
    ownerName: index === 0 ? '本人负责人' : '真实同名同事',
    upstreamNodeId: index === 0 ? null : ids[index - 1]!,
    position: { x: 100 + index * 250, y: 100 + index * 250 },
}))
const changes = { move: vi.fn(), upstream: vi.fn(), edit: vi.fn(), select: vi.fn() }
let restoreHitTesting: (() => void) | undefined

/**
 * Gives the real React Flow graph a controlled draft without replacing its event handlers.
 * @param props - Whether editing capabilities are exposed to the graph.
 * @returns The real canvas and snapshots of the parent-owned node data and selection.
 */
function GraphHarness({ readOnly = false, initialNodes = original }: { readOnly?: boolean; initialNodes?: WorkflowGraphNode[] }) {
    const [nodes, setNodes] = useState(initialNodes)
    const [selected, setSelected] = useState(ids[0]!)
    return (
        <>
            <WorkflowGraph
                nodes={nodes}
                selectedId={selected}
                onSelect={id => {
                    changes.select(id)
                    setSelected(id)
                }}
                onEditNode={readOnly ? undefined : changes.edit}
                onMove={
                    readOnly
                        ? undefined
                        : (nodeId, position) => {
                              changes.move(nodeId, position)
                              setNodes(current => current.map(node => (node.id === nodeId ? { ...node, position } : node)))
                          }
                }
                onUpstreamChange={
                    readOnly
                        ? undefined
                        : (targetId, upstreamNodeId, previousTargetId) => {
                              changes.upstream(targetId, upstreamNodeId, previousTargetId)
                              setNodes(current =>
                                  current.map(node =>
                                      node.id === targetId
                                          ? { ...node, upstreamNodeId }
                                          : node.id === previousTargetId
                                            ? { ...node, upstreamNodeId: null }
                                            : node
                                  )
                              )
                          }
                }
            />
            <output aria-label="父组件布局草稿">{JSON.stringify(nodes)}</output>
            <output aria-label="实际选中节点">{selected}</output>
        </>
    )
}

/**
 * Reads only the actual application's controlled node draft.
 * @returns Stable node identities, assignments, upstream references and saved coordinates.
 */
function draft(): WorkflowGraphNode[] {
    return JSON.parse(screen.getByLabelText('父组件布局草稿').textContent!) as WorkflowGraphNode[]
}

/**
 * Finds one real native React Flow node rather than substituting a mock component.
 * @param id - Exact responsibility identity.
 * @returns The actual focusable and draggable node wrapper.
 */
function flowNode(id: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
    expect(node).not.toBeNull()
    return node!
}

/**
 * Finds a native React Flow source or target handle within an exact node.
 * @param id - Exact responsibility identity.
 * @param kind - Actual connection endpoint direction.
 * @returns The real handle used by React Flow's click-to-connect interactions.
 */
function handle(id: string, kind: 'source' | 'target'): HTMLElement {
    const element = flowNode(id).querySelector<HTMLElement>(`.react-flow__handle.${kind}`)
    expect(element).not.toBeNull()
    return element!
}

beforeEach(() => {
    restoreHitTesting = installWorkflowFlowBrowser(390)
    for (const mock of Object.values(changes)) mock.mockReset()
})

afterEach(() => {
    cleanup()
    restoreHitTesting?.()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('independent native React Flow interactions', () => {
    it('renders exactly one immutable start and end around existing responsibility nodes without adding work to the parent draft', async () => {
        const user = userEvent.setup()
        render(<GraphHarness />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(4))
        const boundaries = [...document.querySelectorAll<HTMLElement>('.react-flow__node-boundary')]
        expect(boundaries).toHaveLength(2)
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(5)
        expect(boundaries.map(node => node.textContent)).toEqual(
            expect.arrayContaining([expect.stringContaining('开始'), expect.stringContaining('结束')])
        )
        const boundaryEdges = [...document.querySelectorAll<HTMLElement>('.react-flow__edge')].filter(
            edge => !edge.dataset.id?.startsWith('workflow-edge-')
        )
        expect(boundaryEdges).toHaveLength(2)
        for (const edge of boundaryEdges) {
            expect(edge.classList.contains('selectable')).toBe(false)
            expect(edge.querySelector('.react-flow__edgeupdater')).toBeNull()
            fireEvent.click(edge)
        }
        for (const node of boundaries) {
            expect(ids).not.toContain(node.dataset.id)
            expect(node.classList.contains('draggable')).toBe(false)
            expect(node.classList.contains('selectable')).toBe(false)
            expect(node.querySelector('.react-flow__handle.connectable')).toBeNull()
            fireEvent.click(node)
            fireEvent.doubleClick(node)
            fireEvent.keyDown(node, { key: 'ArrowRight', code: 'ArrowRight' })
            fireEvent.keyDown(node, { key: 'Delete', code: 'Delete' })
            const rect = node.getBoundingClientRect()
            fireEvent.mouseDown(node, { button: 0, buttons: 1, view: window, clientX: rect.x + 40, clientY: rect.y + 20 })
            fireEvent.mouseMove(window, { buttons: 1, view: window, clientX: rect.x + 90, clientY: rect.y + 60 })
            fireEvent.mouseUp(window, { button: 0, view: window, clientX: rect.x + 90, clientY: rect.y + 60 })
            await user.click(node.querySelector<HTMLElement>('.react-flow__handle')!)
        }
        await user.click(screen.getByRole('button', { name: '适应全部节点' }))
        expect(screen.queryByRole('button', { name: '移除所选连接' })).toBeNull()
        expect(draft()).toEqual(original)
        for (const mock of Object.values(changes)) expect(mock).not.toHaveBeenCalled()
    })

    it('projects every explicit root and leaf through fixed boundaries without silently repairing an invalid multiple-root draft', async () => {
        const multipleRoots = original.map((node, index) => ({ ...node, upstreamNodeId: index === 1 ? null : node.upstreamNodeId }))
        render(<GraphHarness initialNodes={multipleRoots} />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(5))
        expect(document.querySelectorAll('.react-flow__node-boundary')).toHaveLength(2)
        expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(1)
        expect(draft()).toEqual(multipleRoots)
        expect(changes.upstream).not.toHaveBeenCalled()
        expect(changes.edit).not.toHaveBeenCalled()
        expect(changes.move).not.toHaveBeenCalled()
    })

    it('opens editing only through a deliberate node-body or explicit editor action while native Enter and handles keep their own behavior', async () => {
        const user = userEvent.setup()
        render(<GraphHarness />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3))
        const node = flowNode(ids[1]!)
        act(() => node.focus())
        await user.keyboard('{Enter}')
        expect(screen.getByLabelText('实际选中节点').textContent).toBe(ids[1])
        expect(changes.edit).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: '编辑节点' }))
        expect(changes.edit).toHaveBeenCalledExactlyOnceWith(ids[1])
        changes.edit.mockClear()
        fireEvent.click(node.querySelector('p')!)
        expect(changes.edit).toHaveBeenCalledExactlyOnceWith(ids[1])
        changes.edit.mockClear()
        await user.click(handle(ids[0]!, 'source'))
        await user.click(handle(ids[2]!, 'target'))
        await waitFor(() => expect(draft()[2]!.upstreamNodeId).toBe(ids[0]))
        expect(changes.edit).not.toHaveBeenCalled()
    })

    it('selects the exact same-name responsibility and moves it with native keyboard interaction without changing its owner or edge', async () => {
        const user = userEvent.setup()
        render(<GraphHarness />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3))
        const node = flowNode(ids[1]!)
        act(() => node.focus())
        await user.keyboard('{Enter}')
        expect(screen.getByLabelText('实际选中节点').textContent).toBe(ids[1])
        await user.keyboard('{ArrowRight}')
        await waitFor(() => expect(changes.move).toHaveBeenCalled())
        const moved = draft()
        expect(moved[1]!.position.x).toBeGreaterThan(original[1]!.position.x)
        expect(moved[1]!.position.y).toBe(original[1]!.position.y)
        expect(moved[0]).toEqual(original[0])
        expect(moved[2]).toEqual(original[2])
        expect(moved.map(({ id, title, ownerName, upstreamNodeId }) => ({ id, title, ownerName, upstreamNodeId }))).toEqual(
            original.map(({ id, title, ownerName, upstreamNodeId }) => ({ id, title, ownerName, upstreamNodeId }))
        )
        expect(changes.upstream).not.toHaveBeenCalled()
        expect(changes.edit).not.toHaveBeenCalled()
    })

    it('performs a real native node drag and retains independent world coordinates for every other responsibility', async () => {
        render(<GraphHarness />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(2))
        const node = flowNode(ids[0]!)
        const rect = node.getBoundingClientRect()
        fireEvent.mouseDown(node, { button: 0, buttons: 1, view: window, clientX: rect.x + 40, clientY: rect.y + 40 })
        fireEvent.mouseMove(window, { buttons: 1, view: window, clientX: rect.x + 60, clientY: rect.y + 60 })
        fireEvent.mouseMove(window, { buttons: 1, view: window, clientX: rect.x + 90, clientY: rect.y + 100 })
        fireEvent.mouseUp(window, { button: 0, view: window, clientX: rect.x + 90, clientY: rect.y + 100 })
        await waitFor(() => expect(changes.move).toHaveBeenCalled())
        const moved = draft()
        expect(moved[0]!.position).not.toEqual(original[0]!.position)
        expect(moved[0]!.position.x).toBeGreaterThanOrEqual(0)
        expect(moved[0]!.position.x).toBeLessThanOrEqual(1000)
        expect(moved[0]!.position.y).toBeGreaterThanOrEqual(0)
        expect(moved[0]!.position.y).toBeLessThanOrEqual(1000)
        expect(moved.slice(1)).toEqual(original.slice(1))
        expect(moved[0]!.upstreamNodeId).toBeNull()
        expect(changes.upstream).not.toHaveBeenCalled()
        expect(changes.edit).not.toHaveBeenCalled()
    })

    it('connects real handles by explicit clicks, replaces a single parent, and rejects duplicate, self and cycle connections', async () => {
        const user = userEvent.setup()
        render(<GraphHarness />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(2))
        await user.click(handle(ids[0]!, 'source'))
        await user.click(handle(ids[2]!, 'target'))
        await waitFor(() => expect(draft()[2]!.upstreamNodeId).toBe(ids[0]))
        expect(draft()[1]!.upstreamNodeId).toBe(ids[0])
        expect(changes.upstream.mock.calls.at(-1)?.slice(0, 2)).toEqual([ids[2], ids[0]])
        expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(2)
        const count = changes.upstream.mock.calls.length
        for (const [source, target] of [
            [ids[0]!, ids[2]!],
            [ids[0]!, ids[0]!],
            [ids[2]!, ids[0]!],
        ]) {
            await user.click(handle(source, 'source'))
            await user.click(handle(target, 'target'))
            expect(changes.upstream).toHaveBeenCalledTimes(count)
        }
        expect(draft()[0]!.upstreamNodeId).toBeNull()
        expect(draft()[2]!.upstreamNodeId).toBe(ids[0])
        expect(changes.move).not.toHaveBeenCalled()
    })

    it('keeps zoom and pan out of the draft and maps a subsequent native drag back into world coordinates', async () => {
        const user = userEvent.setup()
        render(<GraphHarness />)
        const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3))
        const initial = viewport.style.transform
        await user.click(screen.getByRole('button', { name: '放大流程图' }))
        await waitFor(() => expect(viewport.style.transform).not.toBe(initial))
        const zoomed = viewport.style.transform
        const pane = document.querySelector<HTMLElement>('.react-flow__pane')!
        fireEvent.mouseDown(pane, { button: 0, buttons: 1, view: window, clientX: 40, clientY: 40 })
        fireEvent.mouseMove(window, { buttons: 1, view: window, clientX: 100, clientY: 110 })
        fireEvent.mouseUp(window, { button: 0, view: window, clientX: 100, clientY: 110 })
        await waitFor(() => expect(viewport.style.transform).not.toBe(zoomed))
        expect(draft()).toEqual(original)
        expect(changes.move).not.toHaveBeenCalled()
        expect(changes.upstream).not.toHaveBeenCalled()
        const zoom = Number(/scale\(([\d.]+)\)/.exec(viewport.style.transform)![1])
        const node = flowNode(ids[1]!)
        const rect = node.getBoundingClientRect()
        fireEvent.mouseDown(node, { button: 0, buttons: 1, view: window, clientX: rect.x + 40, clientY: rect.y + 40 })
        fireEvent.mouseMove(window, { buttons: 1, view: window, clientX: rect.x + 60, clientY: rect.y + 60 })
        fireEvent.mouseMove(window, { buttons: 1, view: window, clientX: rect.x + 120, clientY: rect.y + 110 })
        fireEvent.mouseUp(window, { button: 0, view: window, clientX: rect.x + 120, clientY: rect.y + 110 })
        await waitFor(() => expect(changes.move).toHaveBeenCalled())
        expect(draft()[1]!.position.x).toBeCloseTo(Math.round(original[1]!.position.x + 60 / zoom), 0)
        expect(draft()[1]!.position.y).toBeCloseTo(Math.round(original[1]!.position.y + 50 / zoom), 0)
        expect(draft()[0]).toEqual(original[0])
        expect(draft()[2]).toEqual(original[2])
        expect(changes.upstream).not.toHaveBeenCalled()
    })

    it('disconnects only the explicitly selected edge and never deletes work through the native Delete key', async () => {
        const user = userEvent.setup()
        render(<GraphHarness />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(2))
        const edge = document.querySelector<SVGGElement>(`.react-flow__edge[data-id="workflow-edge-${ids[2]}"]`)!
        fireEvent.click(edge)
        await user.click(screen.getByRole('button', { name: '移除所选连接' }))
        expect(draft()[2]!.upstreamNodeId).toBeNull()
        expect(draft().slice(0, 2)).toEqual(original.slice(0, 2))
        expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(1)
        expect(changes.upstream.mock.calls.at(-1)?.slice(0, 2)).toEqual([ids[2], null])
        const previous = draft()
        act(() => flowNode(ids[1]!).focus())
        await user.keyboard('{Delete}')
        expect(draft()).toEqual(previous)
        expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3)
    })

    it('retargets a native existing edge atomically without leaving the old target attached or creating parallel parents', async () => {
        const user = userEvent.setup()
        render(<GraphHarness />)
        await waitFor(() => expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(2))
        await user.click(screen.getByRole('button', { name: '适应全部节点' }))
        await waitFor(() => {
            const canvas = document.querySelector<HTMLElement>('.react-flow')!.getBoundingClientRect()
            const target = handle(ids[2]!, 'target').getBoundingClientRect()
            expect(target.left).toBeGreaterThanOrEqual(canvas.left)
            expect(target.right).toBeLessThanOrEqual(canvas.right)
            expect(target.top).toBeGreaterThanOrEqual(canvas.top)
            expect(target.bottom).toBeLessThanOrEqual(canvas.bottom)
        })
        const edge = document.querySelector<SVGGElement>(`.react-flow__edge[data-id="workflow-edge-${ids[1]}"]`)!
        const updater = edge.querySelector('.react-flow__edgeupdater-target')!
        expect(updater).not.toBeNull()
        const oldTarget = handle(ids[1]!, 'target').getBoundingClientRect()
        const nextTarget = handle(ids[2]!, 'target').getBoundingClientRect()
        const clientX = nextTarget.x + nextTarget.width / 2
        const clientY = nextTarget.y + nextTarget.height / 2
        fireEvent.mouseDown(updater, { button: 0, view: window, clientX: oldTarget.x + 6, clientY: oldTarget.y + 6 })
        fireEvent.mouseMove(document, { buttons: 1, view: window, clientX: clientX + 1, clientY: clientY + 1 })
        fireEvent.mouseMove(document, { buttons: 1, view: window, clientX, clientY })
        fireEvent.mouseUp(document, { button: 0, view: window, clientX, clientY })
        await waitFor(() => expect(changes.upstream).toHaveBeenCalledExactlyOnceWith(ids[2], ids[0], ids[1]))
        expect(draft()[0]).toEqual(original[0])
        expect(draft()[1]!.upstreamNodeId).toBeNull()
        expect(draft()[2]!.upstreamNodeId).toBe(ids[0])
        expect(document.querySelectorAll('.react-flow__edge[data-id^="workflow-edge-"]')).toHaveLength(1)
        expect(changes.move).not.toHaveBeenCalled()
    })

    it('keeps only the native canvas and offers keyboard-selected responsibility direction controls without changing ownership or edges', async () => {
        const user = userEvent.setup()
        render(<GraphHarness />)
        expect(screen.queryByRole('radio')).toBeNull()
        expect(screen.queryByRole('radiogroup')).toBeNull()
        expect(screen.queryByRole('list', { name: '完整节点列表' })).toBeNull()
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3))
        act(() => flowNode(ids[1]!).focus())
        await user.keyboard('{Enter}')
        expect(screen.getByLabelText('实际选中节点').textContent).toBe(ids[1])
        await user.click(screen.getByRole('button', { name: '向右移动节点' }))
        await user.click(screen.getByRole('button', { name: '向下移动节点' }))
        expect(draft()[1]).toEqual({ ...original[1], position: { x: 370, y: 370 } })
        expect(draft()[0]).toEqual(original[0])
        expect(draft()[2]).toEqual(original[2])
        expect(changes.upstream).not.toHaveBeenCalled()
    })

    it('keeps native responsibilities selectable and exposes no creation, editing or alternate-list controls in a read-only preview', async () => {
        render(<GraphHarness readOnly />)
        expect(document.querySelectorAll('.react-flow')).toHaveLength(1)
        expect(document.querySelector('.react-flow__handle.connectable')).toBeNull()
        expect(screen.queryByRole('button', { name: /删除.*连线/ })).toBeNull()
        expect(screen.queryByRole('radio')).toBeNull()
        expect(screen.queryByRole('list', { name: '完整节点列表' })).toBeNull()
        expect(screen.queryByRole('button', { name: /添加节点/ })).toBeNull()
        expect(screen.queryByRole('button', { name: '编辑节点' })).toBeNull()
        expect(screen.queryByRole('group', { name: '调整所选节点位置' })).toBeNull()
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node-workflow')).toHaveLength(3))
        fireEvent.click(flowNode(ids[2]!))
        expect(screen.getByLabelText('实际选中节点').textContent).toBe(ids[2])
        expect(flowNode(ids[2]!).classList.contains('selected')).toBe(true)
        expect(draft()).toEqual(original)
        expect(changes.move).not.toHaveBeenCalled()
        expect(changes.upstream).not.toHaveBeenCalled()
    })
})
