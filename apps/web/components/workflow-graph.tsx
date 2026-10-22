'use client'

import {
    Background,
    ConnectionMode,
    Controls,
    Handle,
    MarkerType,
    Position,
    ReactFlow,
    type AriaLabelConfig,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
    type NodeProps,
    type ReactFlowInstance,
} from '@xyflow/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pencil, Plus } from 'lucide-react'
import { boundedPosition, canSetWorkflowUpstream } from '../lib/workflow-connections'
import { createWorkflowBoundaries, WorkflowBoundaryView, type WorkflowBoundaryNode } from './workflow-boundaries'
import { Button } from './ui/button'
import { FeedbackMessage } from './ui/feedback-message'
import { Disclosure } from './ui/disclosure'

export { boundedPosition } from '../lib/workflow-connections'

export interface WorkflowGraphNode {
    id: string
    title: string
    ownerName: string
    upstreamNodeId: string | null
    position: { x: number; y: number }
}

type WorkFlowNode = Node<{ title: string; ownerName: string; shortId: string }, 'workflow'>
type FlowNode = WorkFlowNode | WorkflowBoundaryNode

const ariaLabels: Partial<AriaLabelConfig> = {
    'node.a11yDescription.default': '按 Enter 选择节点，使用方向键调整布局，或使用编辑节点按钮打开编辑弹窗。',
    'node.a11yDescription.keyboardDisabled': '按 Tab 浏览节点，在节点属性或完整预览中查看内容。',
    'edge.a11yDescription.default': '按 Enter 选择连接，可通过移除所选连接按钮断开上游关系。',
    'controls.ariaLabel': '流程图视图控制',
    'controls.zoomIn.ariaLabel': '放大流程图',
    'controls.zoomOut.ariaLabel': '缩小流程图',
    'controls.fitView.ariaLabel': '适应全部节点',
    'handle.ariaLabel': '节点连接点',
}

/**
 * Presents safe metadata inside React Flow's native node wrapper.
 * @param props - Native data, selection state and connection availability.
 * @returns A themed node with real upstream and downstream handles.
 */
function WorkflowFlowNode({ data, selected, isConnectable }: NodeProps<WorkFlowNode>) {
    return (
        <div
            className={`relative flex h-full min-w-0 flex-col justify-center gap-2 rounded-xl border bg-card p-4 text-card-foreground transition-[border-color,box-shadow] duration-(--motion-fast) ease-(--motion-ease) motion-reduce:transition-none ${selected ? 'border-foreground ring-1 ring-foreground/15' : 'border-border'}`}
        >
            <Handle
                id="upstream"
                type="target"
                position={Position.Top}
                isConnectable={isConnectable}
                className="workflow-port"
                aria-label={`上游连接点 ${data.title || '未命名节点'} ${data.shortId}`}
            />
            <p className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">{data.title || '未命名节点'}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{data.ownerName}</p>
            <p className="text-xs text-muted-foreground">{data.shortId}</p>
            <Handle
                id="downstream"
                type="source"
                position={Position.Bottom}
                isConnectable={isConnectable}
                className="workflow-port"
                aria-label={`下游连接点 ${data.title || '未命名节点'} ${data.shortId}`}
            />
        </div>
    )
}

const nodeTypes = { workflow: WorkflowFlowNode, boundary: WorkflowBoundaryView }

/**
 * Edits layout and explicit upstream relationships through the real React Flow engine.
 * @param props - Safe node labels, explicit reveal identity and editable draft callbacks.
 * @returns Native graph interactions, node creation and keyboard layout controls.
 */
export function WorkflowGraph({
    nodes,
    selectedId,
    onSelect,
    onEditNode,
    onMove,
    onUpstreamChange,
    onAddNode,
    revealNodeId,
    disabled = false,
}: {
    nodes: WorkflowGraphNode[]
    selectedId: string
    onSelect: (id: string) => void
    onEditNode?: (id: string) => void
    onMove?: (id: string, position: { x: number; y: number }) => void
    onUpstreamChange?: (nodeId: string, upstreamNodeId: string | null, previousTargetId?: string) => void
    onAddNode?: () => void
    revealNodeId?: string | null
    disabled?: boolean
}) {
    const id = useId()
    const [flow, setFlow] = useState<ReactFlowInstance<FlowNode> | null>(null)
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
    const [feedback, setFeedback] = useState<{ content: string; variant: 'success' | 'warning' } | null>(null)
    // Initial framing is fixed at mount so later selection and zoom changes stay under the user's control.
    const [initialFocusNodeId] = useState(() =>
        onMove || onUpstreamChange || onEditNode ? (nodes.find(node => node.id === selectedId)?.id ?? nodes[0]?.id) : undefined
    )
    const reconnecting = useRef<Edge | null>(null)
    const canMove = Boolean(onMove) && !disabled
    const canConnect = Boolean(onUpstreamChange) && !disabled
    const selected = nodes.find(node => node.id === selectedId)
    const boundaries = useMemo(() => createWorkflowBoundaries(nodes), [nodes])
    const flowNodes = useMemo<FlowNode[]>(
        () => [
            ...nodes.map<WorkFlowNode>(node => ({
                id: node.id,
                type: 'workflow',
                position: node.position,
                data: { title: node.title, ownerName: node.ownerName, shortId: node.id.slice(0, 8) },
                selected: node.id === selectedId,
                draggable: canMove,
                connectable: canConnect,
                deletable: false,
                ariaLabel: `节点 ${node.title || '未命名节点'} ${node.id.slice(0, 8)}`,
                width: 224,
                height: 144,
                measured: { width: 224, height: 144 },
                style: { width: 224, height: 144 },
            })),
            ...boundaries.nodes,
        ],
        [nodes, selectedId, canMove, canConnect, boundaries]
    )
    const flowEdges = useMemo<Edge[]>(
        () =>
            nodes.flatMap(node => {
                const upstream = nodes.find(candidate => candidate.id === node.upstreamNodeId)
                if (!upstream || upstream.id === node.id) return []
                const edgeId = `workflow-edge-${node.id}`
                return [
                    {
                        id: edgeId,
                        source: upstream.id,
                        target: node.id,
                        sourceHandle: 'downstream',
                        targetHandle: 'upstream',
                        type: 'smoothstep',
                        selected: edgeId === selectedEdgeId,
                        deletable: false,
                        reconnectable: canConnect,
                        markerEnd: { type: MarkerType.ArrowClosed },
                        ariaLabel: `上游 ${upstream.title || '未命名节点'} 至 ${node.title || '未命名节点'} ${node.id.slice(0, 8)}`,
                    },
                ]
            }),
        [nodes, selectedEdgeId, canConnect]
    )
    const selectedEdge = flowEdges.find(edge => edge.id === selectedEdgeId)
    const renderedEdges = useMemo(() => [...flowEdges, ...boundaries.edges], [flowEdges, boundaries])

    useEffect(() => {
        if (!flow || !revealNodeId) return
        void flow.fitView({ nodes: [{ id: revealNodeId }], padding: 0.4, minZoom: 0.85, maxZoom: 1 })
    }, [flow, revealNodeId])

    /**
     * Propagates native flow-space moves and node selections into the existing draft.
     * @param changes - React Flow pointer, keyboard, measurement and selection changes.
     * @returns Nothing; movement never changes a responsibility relationship.
     */
    const changeNodes = useCallback(
        (changes: NodeChange<FlowNode>[]): void => {
            if (disabled) return
            for (const change of changes) {
                if (!('id' in change) || !nodes.some(node => node.id === change.id)) continue
                if (change.type === 'position' && change.position && onMove)
                    onMove(change.id, { x: boundedPosition(change.position.x), y: boundedPosition(change.position.y) })
                if (change.type === 'select' && change.selected) {
                    onSelect(change.id)
                    setSelectedEdgeId(null)
                }
            }
        },
        [disabled, nodes, onMove, onSelect]
    )

    /**
     * Keeps native edge selection without allowing work deletion through the graph.
     * @param changes - Native edge selection changes.
     * @returns Nothing after retaining only the selected connection.
     */
    const changeEdges = useCallback(
        (changes: EdgeChange[]): void => {
            if (disabled) return
            for (const change of changes)
                if (change.type === 'select' && flowEdges.some(edge => edge.id === change.id))
                    setSelectedEdgeId(current => (change.selected ? change.id : current === change.id ? null : current))
        },
        [disabled, flowEdges]
    )

    /**
     * Validates a native connection against actual ancestry and the old reconnection target.
     * @param connection - Explicit flow source and target identities.
     * @returns Whether the target can receive this unique upstream without a cycle.
     */
    const validConnection = useCallback(
        (connection: Connection | Edge): boolean => {
            if (!canConnect || !connection.source || !connection.target) return false
            return canSetWorkflowUpstream(nodes, connection.target, connection.source, reconnecting.current?.target)
        },
        [canConnect, nodes]
    )

    /**
     * Applies one explicitly drawn relationship as the target's unique upstream.
     * @param connection - Native source-to-target connection.
     * @param previousTargetId - Previous target to detach during edge reconnection.
     * @returns Nothing after one atomic draft-only callback; does not save or launch work.
     */
    function connect(connection: Connection, previousTargetId?: string): void {
        if (
            !canConnect ||
            !connection.source ||
            !connection.target ||
            !canSetWorkflowUpstream(nodes, connection.target, connection.source, previousTargetId)
        ) {
            setFeedback({ content: '无法连接：请选择有效节点，并避免连接自身或形成循环。', variant: 'warning' })
            return
        }
        onUpstreamChange?.(connection.target, connection.source, previousTargetId)
        onSelect(connection.target)
        setSelectedEdgeId(`workflow-edge-${connection.target}`)
        setFeedback({ content: '连接已更新，目标节点只保留这一个上游。保存后生效。', variant: 'success' })
    }

    /**
     * Moves the selected native node without requiring a precise pointer gesture.
     * @param x - Horizontal change in persisted flow coordinates.
     * @param y - Vertical change in persisted flow coordinates.
     * @returns Nothing after updating the same layout draft as native dragging.
     */
    function moveSelected(x: number, y: number): void {
        if (!selected || !canMove) return
        onMove?.(selected.id, {
            x: boundedPosition(selected.position.x + x),
            y: boundedPosition(selected.position.y + y),
        })
    }

    return (
        <section className="grid min-w-0 gap-3" aria-label="流程布局与节点选择">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold">流程画布</h2>
                {onAddNode && (
                    <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={disabled || nodes.length >= 8}
                        onClick={onAddNode}
                    >
                        <Plus className="size-4" />
                        添加节点（{nodes.length}/8）
                    </Button>
                )}
            </div>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 text-xs text-muted-foreground">
                <p>开始和结束为固定流程边界，无需处理人；流程包含 2–8 个工作节点。</p>
                <Disclosure title="操作说明" className="min-w-0 sm:max-w-lg" triggerClassName="text-xs">
                    <div className="grid gap-2 pb-2 leading-relaxed">
                        {onAddNode && <p>新节点默认作为当前选中节点的下游，创建后可在节点属性中修改上游。</p>}
                        <p>
                            {canMove || canConnect
                                ? '拖动节点调整布局，选中后可用方向键移动。由下方连接点连到目标上方，会替换目标的唯一上游；也可在节点属性中设置。'
                                : '可缩放和平移查看完整流程；节点内容及实际处理人见下方完整预览。'}
                        </p>
                    </div>
                </Disclosure>
            </div>
            <div className="h-[420px] min-w-0 overflow-hidden rounded-xl border bg-muted/15 sm:h-[560px]" aria-label="流程画布">
                <ReactFlow<FlowNode>
                    id={`workflow-flow-${id}`}
                    className="workflow-flow"
                    nodes={flowNodes}
                    edges={renderedEdges}
                    nodeTypes={nodeTypes}
                    onInit={setFlow}
                    onNodesChange={changeNodes}
                    onEdgesChange={changeEdges}
                    onNodeClick={(event, node) => {
                        if (disabled || node.type !== 'workflow') return
                        onSelect(node.id)
                        setSelectedEdgeId(null)
                        if (!(event.target instanceof Element && event.target.closest('.react-flow__handle'))) onEditNode?.(node.id)
                    }}
                    onNodeDragStart={(_, node) => {
                        if (!disabled && node.type === 'workflow') onSelect(node.id)
                    }}
                    onEdgeClick={(_, edge) => {
                        if (!disabled && flowEdges.some(candidate => candidate.id === edge.id)) setSelectedEdgeId(edge.id)
                    }}
                    onPaneClick={() => setSelectedEdgeId(null)}
                    onConnect={connection => connect(connection)}
                    onReconnectStart={(_, edge) => {
                        reconnecting.current = edge
                    }}
                    onReconnect={(edge, connection) => connect(connection, edge.target)}
                    onReconnectEnd={() => {
                        reconnecting.current = null
                    }}
                    isValidConnection={validConnection}
                    connectionMode={ConnectionMode.Strict}
                    connectOnClick
                    nodesDraggable={canMove}
                    nodesConnectable={canConnect}
                    edgesReconnectable={canConnect}
                    elementsSelectable={!disabled}
                    nodesFocusable={!disabled}
                    edgesFocusable={!disabled}
                    disableKeyboardA11y={disabled || !onMove}
                    deleteKeyCode={null}
                    multiSelectionKeyCode={null}
                    nodeExtent={[
                        [0, 0],
                        [1224, 1144],
                    ]}
                    fitView
                    fitViewOptions={{
                        nodes: initialFocusNodeId ? [{ id: initialFocusNodeId }] : undefined,
                        padding: 0.2,
                        minZoom: initialFocusNodeId ? 0.85 : 0.2,
                        maxZoom: 1,
                    }}
                    minZoom={0.2}
                    maxZoom={2}
                    ariaLabelConfig={ariaLabels}
                >
                    <Background gap={20} size={1} />
                    <Controls showInteractive={false} fitViewOptions={{ padding: 0.2, minZoom: 0.2, maxZoom: 1 }} />
                </ReactFlow>
            </div>
            {selected && (
                <p role="status" className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    已选择“{selected.title || '未命名节点'}” · {selected.id.slice(0, 8)} · 位置 {selected.position.x}, {selected.position.y}
                </p>
            )}
            {selected && onEditNode && (
                <Button
                    id="workflow-edit-selected"
                    type="button"
                    variant="outline"
                    className="min-h-11 justify-self-start"
                    disabled={disabled}
                    onClick={() => onEditNode(selected.id)}
                >
                    <Pencil className="size-4" />
                    编辑节点
                </Button>
            )}
            {selected && onMove && (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="调整所选节点位置">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11"
                        aria-label="向左移动节点"
                        disabled={!canMove || selected.position.x <= 0}
                        onClick={() => moveSelected(-20, 0)}
                    >
                        <ArrowLeft className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11"
                        aria-label="向上移动节点"
                        disabled={!canMove || selected.position.y <= 0}
                        onClick={() => moveSelected(0, -20)}
                    >
                        <ArrowUp className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11"
                        aria-label="向下移动节点"
                        disabled={!canMove || selected.position.y >= 1000}
                        onClick={() => moveSelected(0, 20)}
                    >
                        <ArrowDown className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11"
                        aria-label="向右移动节点"
                        disabled={!canMove || selected.position.x >= 1000}
                        onClick={() => moveSelected(20, 0)}
                    >
                        <ArrowRight className="size-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">每次移动 20 个布局单位</span>
                </div>
            )}
            {selectedEdge && canConnect && (
                <div className="grid min-w-0 gap-2 rounded-xl border p-3">
                    <p className="text-sm [overflow-wrap:anywhere]">
                        已选择连接：{nodes.find(node => node.id === selectedEdge.source)?.title || '未命名节点'} →{' '}
                        {nodes.find(node => node.id === selectedEdge.target)?.title || '未命名节点'}
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            onUpstreamChange?.(selectedEdge.target, null)
                            setSelectedEdgeId(null)
                            setFeedback({ content: '连接已移除。请在保存前重新检查流程起点及上下游。', variant: 'success' })
                        }}
                    >
                        移除所选连接
                    </Button>
                </div>
            )}
            {feedback && <FeedbackMessage variant={feedback.variant}>{feedback.content}</FeedbackMessage>}
        </section>
    )
}
