export interface WorkflowRelationship {
    id: string
    upstreamNodeId: string | null
}

/**
 * Restricts a React Flow position to the existing persisted coordinate range.
 * @param value - Native flow-space pointer or keyboard coordinate.
 * @returns A finite rounded coordinate between zero and one thousand.
 */
export function boundedPosition(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1000, Math.round(value))) : 0
}

/**
 * Validates an explicit upstream replacement without guessing relationships from layout.
 * @param nodes - Current stable relationships, including temporarily disconnected drafts.
 * @param targetId - Node whose unique upstream will be replaced.
 * @param sourceId - Explicit upstream identity or null to disconnect the node.
 * @param previousTargetId - Old target to disconnect when an existing edge is retargeted.
 * @returns Whether the relationship avoids missing nodes, self references and cycles.
 */
export function canSetWorkflowUpstream(
    nodes: readonly WorkflowRelationship[],
    targetId: string,
    sourceId: string | null,
    previousTargetId?: string
): boolean {
    const byId = new Map(nodes.map(node => [node.id, node]))
    if (!byId.has(targetId) || (previousTargetId && !byId.has(previousTargetId))) return false
    if (sourceId === null) return true
    if (byId.get(targetId)!.upstreamNodeId === sourceId && (!previousTargetId || previousTargetId === targetId)) return false
    const visited = new Set<string>([targetId])
    let current: string | null = sourceId
    while (current) {
        if (visited.has(current)) return false
        visited.add(current)
        const node = byId.get(current)
        if (!node) return false
        current = current === previousTargetId && previousTargetId !== targetId ? null : node.upstreamNodeId
    }
    return true
}
