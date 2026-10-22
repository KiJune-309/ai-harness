export interface ProjectRelationNode {
    id: string
    upstreamNodeId: string | null
    createdAt: string
}

export interface ProjectRelationGroups<T> {
    roots: { rootId: string; nodes: T[] }[]
    unresolved: T[]
}

/**
 * Orders real responsibility chains without recursion, inferred parents, or repeated nodes.
 * @param records - Authorized metadata nodes whose upstream references may contain historical defects.
 * @returns Stable root chains and one unresolved group for cycles or unavailable upstream references.
 */
export function groupProjectRelations<T extends ProjectRelationNode>(records: readonly T[]): ProjectRelationGroups<T> {
    const byId = new Map<string, T>()
    for (const record of records) if (!byId.has(record.id)) byId.set(record.id, record)
    const ordered = [...byId.values()].sort(
        (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )
    const children = new Map<string, T[]>()
    for (const record of ordered) {
        if (!record.upstreamNodeId || !byId.has(record.upstreamNodeId)) continue
        const siblings = children.get(record.upstreamNodeId) ?? []
        siblings.push(record)
        children.set(record.upstreamNodeId, siblings)
    }
    const visited = new Set<string>()
    const roots: ProjectRelationGroups<T>['roots'] = []
    for (const root of ordered.filter(record => record.upstreamNodeId === null)) {
        const nodes: T[] = []
        const remaining = [root]
        while (remaining.length > 0) {
            const node = remaining.pop()!
            if (visited.has(node.id)) continue
            visited.add(node.id)
            nodes.push(node)
            const downstream = children.get(node.id) ?? []
            for (let index = downstream.length - 1; index >= 0; index -= 1) remaining.push(downstream[index]!)
        }
        roots.push({ rootId: root.id, nodes })
    }
    return { roots, unresolved: ordered.filter(record => !visited.has(record.id)) }
}
