'use client'

import { Handle, MarkerType, Position, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { CirclePlay, CircleStop } from 'lucide-react'

export type WorkflowBoundaryNode = Node<{ kind: 'start' | 'end' }, 'boundary'>

interface WorkflowBoundaryInput {
    id: string
    upstreamNodeId: string | null
    position: { x: number; y: number }
}

/**
 * Derives presentation-only boundaries without adding work, assignees or saved relationships.
 * @param nodes - Existing business nodes whose identities, parents and positions remain unchanged.
 * @returns Two fixed native React Flow nodes and non-editable edges around actual roots and leaves.
 */
export function createWorkflowBoundaries(nodes: readonly WorkflowBoundaryInput[]): { nodes: WorkflowBoundaryNode[]; edges: Edge[] } {
    const roots = nodes.filter(node => node.upstreamNodeId === null)
    const parents = new Set(nodes.map(node => node.upstreamNodeId))
    const leaves = nodes.filter(node => !parents.has(node.id))
    const startX = roots.length ? roots.reduce((sum, node) => sum + node.position.x, 0) / roots.length + 32 : 32
    const endX = leaves.length ? leaves.reduce((sum, node) => sum + node.position.x, 0) / leaves.length + 32 : 32
    const startY = (nodes.length ? Math.min(...nodes.map(node => node.position.y)) : 0) - 144
    const endY = (nodes.length ? Math.max(...nodes.map(node => node.position.y)) : 0) + 224
    const boundaries: WorkflowBoundaryNode[] = (['start', 'end'] as const).map(kind => ({
        id: `workflow-${kind}`,
        type: 'boundary',
        data: { kind },
        position: kind === 'start' ? { x: startX, y: startY } : { x: endX, y: endY },
        width: 160,
        height: 64,
        measured: { width: 160, height: 64 },
        style: { width: 160, height: 64 },
        extent: [
            [-10_000, -10_000],
            [10_000, 10_000],
        ],
        selectable: false,
        draggable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        ariaLabel: `${kind === 'start' ? '开始' : '结束'}节点，流程边界，无需处理人`,
    }))
    const edges: Edge[] = [
        ...roots.map(node => ({
            id: `workflow-start-edge-${node.id}`,
            source: 'workflow-start',
            target: node.id,
        })),
        ...leaves.map(node => ({
            id: `workflow-end-edge-${node.id}`,
            source: node.id,
            target: 'workflow-end',
        })),
    ].map(edge => ({
        ...edge,
        sourceHandle: 'downstream',
        targetHandle: 'upstream',
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        selectable: false,
        focusable: false,
        deletable: false,
        reconnectable: false,
    }))
    return { nodes: boundaries, edges }
}

/**
 * Renders a fixed boundary through React Flow's native node and handle geometry.
 * @param props - Presentation-only start or end node data supplied by React Flow.
 * @returns A neutral boundary marker with only the handle required by its derived edges.
 */
export function WorkflowBoundaryView({ data }: NodeProps<WorkflowBoundaryNode>) {
    const isStart = data.kind === 'start'
    const Icon = isStart ? CirclePlay : CircleStop
    return (
        <div className="relative flex h-full w-full items-center justify-center gap-2 rounded-full border bg-muted/60 px-3 text-card-foreground">
            <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="grid min-w-0 gap-0.5">
                <p className="text-sm font-medium">{isStart ? '开始' : '结束'}</p>
                <p className="text-xs text-muted-foreground">无需处理人</p>
            </div>
            <Handle
                id={isStart ? 'downstream' : 'upstream'}
                type={isStart ? 'source' : 'target'}
                position={isStart ? Position.Bottom : Position.Top}
                isConnectable={false}
                className="workflow-port pointer-events-none"
                aria-hidden="true"
            />
        </div>
    )
}
