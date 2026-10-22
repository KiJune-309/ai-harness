import type { CollaborationProgressNode, CollaborationProgressWait, CollaborationProjectProgress } from '@ai-harness/contracts'

export const BOARD_COLUMNS = [
    { id: 'unstarted', label: '未开始' },
    { id: 'running', label: '执行中' },
    { id: 'waiting', label: '等待协作' },
    { id: 'ready', label: '可继续' },
    { id: 'check', label: '需要检查' },
    { id: 'ended', label: '已结束' },
] as const

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]['id']

export interface BoardFilters {
    query: string
    ownerId: string
    pendingOnly: boolean
}

export const EMPTY_BOARD_FILTERS: Readonly<BoardFilters> = { query: '', ownerId: '', pendingOnly: false }

export interface BoardWait {
    id: string
    direction: 'incoming' | 'outgoing' | 'self'
    text: string
    createdAt: string
    pendingForViewer: boolean
}

export interface BoardCard {
    node: CollaborationProgressNode
    column: BoardColumnId
    statusLabel: string
    hint: string | null
    waits: BoardWait[]
    pendingForViewer: boolean
    ownHref: string | null
    canContinue: boolean
    repairHref: string | null
    upstream: CollaborationProgressNode | null
    upstreamUnavailable: boolean
}

interface BoardClassification {
    column: BoardColumnId
    statusLabel: string
    hint: string | null
}

/**
 * Normalizes local search text without changing stored work or person identities.
 * @param value - Human-entered search or public searchable metadata.
 * @returns Comparable Unicode text for a literal substring search.
 */
function searchable(value: string): string {
    return value.normalize('NFKC').trim().toLocaleLowerCase()
}

/**
 * Checks whether a public node may remain an endpoint of an actual pending request.
 * @param node - A node from the same complete safe project projection.
 * @returns Whether its source and current authorization support a pending relationship.
 */
function pendingEndpoint(node: CollaborationProgressNode | undefined): node is CollaborationProgressNode {
    return Boolean(node?.authorized && node.sourceAvailable && !['cancelled', 'completed', 'awaiting-activation'].includes(node.status))
}

/**
 * Checks request direction against actual responsibility identities before displaying it.
 * @param wait - Server-projected pending metadata without question content.
 * @param byId - Current project's unique nodes.
 * @returns Whether both endpoints and the claimed direction are supported by the projection.
 */
function validWait(wait: CollaborationProgressWait, byId: ReadonlyMap<string, CollaborationProgressNode>): boolean {
    const from = byId.get(wait.fromNodeId)
    const target = byId.get(wait.targetNodeId)
    if (!pendingEndpoint(from) || !pendingEndpoint(target)) return false
    if (wait.kind === 'self') return from.id === target.id
    if (from.id === target.id) return false
    const upstream = from.upstreamNodeId === target.id
    const downstream = target.upstreamNodeId === from.id
    return wait.kind === 'upstream' ? upstream && !downstream : downstream && !upstream
}

/**
 * Assigns exactly one board group using persistent terminal, source, execution and waiting facts.
 * @param node - One safe work record with explicit source availability and actual user-input metadata.
 * @param outgoing - Whether it has at least one legitimate outgoing pending request.
 * @returns The first matching display state without changing the stored node.
 */
function classify(node: CollaborationProgressNode, outgoing: boolean): BoardClassification {
    if (!node.authorized) return { column: 'ended', statusLabel: '授权已撤销', hint: null }
    if (node.status === 'cancelled') return { column: 'ended', statusLabel: '已取消', hint: null }
    if (node.status === 'completed') return { column: 'ended', statusLabel: '历史已完成', hint: null }
    if (!node.sourceAvailable) return { column: 'check', statusLabel: '工作来源暂不可用', hint: '请刷新确认或查看原有工作入口。' }
    if (node.started === null) return { column: 'check', statusLabel: '开始状态暂不可确认', hint: '请刷新确认来源状态。' }
    if (node.status === 'awaiting-activation')
        return { column: 'check', statusLabel: '等待本人打开（历史记录）', hint: '请查看原有工作入口，不会自动激活。' }
    if (node.status === 'failed') return { column: 'check', statusLabel: '执行失败', hint: '可从原有工作入口查看失败原因。' }
    if (node.status === 'running') return { column: 'running', statusLabel: '执行中', hint: null }
    if (outgoing) return { column: 'waiting', statusLabel: '等待协作', hint: null }
    if (!node.started) return { column: 'unstarted', statusLabel: '尚无本人输入', hint: '收到开场或转告不算本人开始。' }
    return {
        column: 'ready',
        statusLabel: '可继续',
        hint: node.status.startsWith('waiting-') ? '当前无有效等待。' : null,
    }
}

/**
 * Accepts only the current viewer's exact server-projected local conversation link.
 * @param node - Safe work projection whose private source identifier is not exposed separately.
 * @param userId - Authenticated viewer identity.
 * @returns The original bounded local URL or null without a navigation grant.
 */
function ownChatHref(node: CollaborationProgressNode, userId: string | undefined): string | null {
    if (
        node.ownerId !== userId ||
        !node.sourceAvailable ||
        !node.ownHref ||
        !/^\/\?conversation=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:&event=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.test(
            node.ownHref
        )
    )
        return null
    return node.ownHref
}

/**
 * Orders cards by real incoming work for the viewer, oldest pending time, then stable work metadata.
 * @param left - First derived card.
 * @param right - Second derived card.
 * @returns The comparison result without mutating source order or saving a business ordering.
 */
function compareCards(left: BoardCard, right: BoardCard): number {
    if (left.pendingForViewer !== right.pendingForViewer) return left.pendingForViewer ? -1 : 1
    if (left.pendingForViewer) {
        const leftTime = left.waits.find(wait => wait.pendingForViewer)!.createdAt
        const rightTime = right.waits.find(wait => wait.pendingForViewer)!.createdAt
        const byPending = leftTime.localeCompare(rightTime)
        if (byPending) return byPending
        return left.node.id.localeCompare(right.node.id)
    }
    return right.node.updatedAt.localeCompare(left.node.updatedAt) || left.node.id.localeCompare(right.node.id)
}

/**
 * Derives complete read-only board groups, filters and counts from one safe project snapshot.
 * @param progress - Complete authorized progress metadata, never private conversations or tasks.
 * @param userId - Authenticated viewer used for actual incoming waits and own navigation.
 * @param filters - Local intersection filters, applied before any UI display limit.
 * @returns All matching sorted cards per group, full counters and stable owner choices.
 */
export function buildProjectBoard(
    progress: CollaborationProjectProgress,
    userId: string | undefined,
    filters: BoardFilters = EMPTY_BOARD_FILTERS
) {
    const byId = new Map<string, CollaborationProgressNode>()
    for (const node of progress.nodes) if (!byId.has(node.id)) byId.set(node.id, node)
    const waitingByNode = new Map<string, BoardWait[]>()
    const outgoing = new Set<string>()
    const seenWaits = new Set<string>()
    for (const wait of progress.waits) {
        if (seenWaits.has(wait.id) || !validWait(wait, byId)) continue
        seenWaits.add(wait.id)
        const from = byId.get(wait.fromNodeId)!
        const target = byId.get(wait.targetNodeId)!
        outgoing.add(from.id)
        const mine = target.ownerId === userId
        const base = { id: wait.id, createdAt: wait.createdAt }
        const fromWaits = waitingByNode.get(from.id) ?? []
        fromWaits.push({
            ...base,
            direction: wait.kind === 'self' ? 'self' : 'outgoing',
            text:
                wait.kind === 'self'
                    ? '等待本人判断'
                    : `等待${target.ownerName}${wait.kind === 'upstream' ? '补充信息' : '处理协作请求'}（${target.title} · ${target.id.slice(0, 8)}）`,
            pendingForViewer: wait.kind === 'self' && mine,
        })
        waitingByNode.set(from.id, fromWaits)
        if (from.id !== target.id) {
            const targetWaits = waitingByNode.get(target.id) ?? []
            targetWaits.push({
                ...base,
                direction: 'incoming',
                text: `${from.ownerName}的“${from.title}”（${from.id.slice(0, 8)}）正在等待此工作${wait.kind === 'upstream' ? '补充信息' : '处理协作请求'}`,
                pendingForViewer: mine,
            })
            waitingByNode.set(target.id, targetWaits)
        }
    }
    const owners = new Map<string, { id: string; name: string; historical: boolean }>()
    const cards: BoardCard[] = []
    for (const node of byId.values()) {
        const previousOwner = owners.get(node.ownerId)
        owners.set(node.ownerId, {
            id: node.ownerId,
            name: node.ownerName,
            historical: (previousOwner?.historical ?? true) && !node.authorized,
        })
        const state = classify(node, outgoing.has(node.id))
        const waits = (waitingByNode.get(node.id) ?? []).sort(
            (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
        )
        const terminal = state.column === 'ended'
        const href = ownChatHref(node, userId)
        const canContinue = Boolean(href && node.authorized && node.canContinue && !terminal && state.column !== 'check')
        const repairHref =
            href && node.authorized && node.canContinue && node.status === 'failed' && node.started !== null
                ? `/projects/${progress.projectId}?node=${node.id}`
                : null
        const upstream = node.upstreamNodeId ? byId.get(node.upstreamNodeId) : undefined
        const visibleUpstream = upstream && upstream.id !== node.id && upstream.authorized && upstream.sourceAvailable ? upstream : null
        cards.push({
            node,
            ...state,
            waits,
            pendingForViewer: waits.some(wait => wait.pendingForViewer),
            ownHref: terminal || canContinue ? href : null,
            canContinue,
            repairHref,
            upstream: visibleUpstream,
            upstreamUnavailable: Boolean(node.upstreamNodeId && !visibleUpstream),
        })
    }
    const query = searchable(filters.query)
    const filtered = cards.filter(
        card =>
            (!query || searchable(`${card.node.title}\n${card.node.ownerName}\n${card.node.id}\n${card.node.ownerId}`).includes(query)) &&
            (!filters.ownerId || card.node.ownerId === filters.ownerId) &&
            (!filters.pendingOnly || card.pendingForViewer)
    )
    return {
        total: cards.length,
        matched: filtered.length,
        columns: BOARD_COLUMNS.map(column => ({
            ...column,
            total: cards.filter(card => card.column === column.id).length,
            cards: filtered.filter(card => card.column === column.id).sort(compareCards),
        })),
        owners: [...owners.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    }
}
