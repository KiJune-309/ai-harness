import { describe, expect, it } from 'vitest'
import type { CollaborationProgressNode, CollaborationProgressWait, CollaborationProjectProgress } from '@ai-harness/contracts'
import { BOARD_COLUMNS, buildProjectBoard, type BoardCard } from '../../lib/project-board'

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const time = '2026-10-20T00:00:00.000Z'

/**
 * Creates stable disjoint identities so sorting, duplicate names and exact links are observable.
 * @param index - Deterministic fixture sequence.
 * @returns A canonical fixture UUID.
 */
function id(index: number): string {
    return `${index.toString(16).padStart(8, '0')}-2020-4020-8020-202020202020`
}

/**
 * Builds only safe public work metadata, without any private messages or source fields.
 * @param index - Stable node identity.
 * @param changes - Explicit persistent-state variations under test.
 * @returns One complete safe node.
 */
function node(index: number, changes: Partial<CollaborationProgressNode> = {}): CollaborationProgressNode {
    return {
        id: id(index),
        title: `同名工作${index}`,
        ownerId: owner,
        ownerName: '同名同事',
        upstreamNodeId: null,
        status: 'ready',
        authorized: true,
        sourceAvailable: true,
        started: true,
        canContinue: true,
        ownHref: `/?conversation=${id(index + 1000)}`,
        createdAt: time,
        updatedAt: time,
        ...changes,
    }
}

/**
 * Creates one exact pending relation, including intentionally malformed historical variations.
 * @param index - Stable question identity.
 * @param from - Actual requestor work.
 * @param target - Actual target work.
 * @param changes - Direction or timestamps to exercise.
 * @returns Safe pending metadata without question body.
 */
function wait(
    index: number,
    from: CollaborationProgressNode,
    target: CollaborationProgressNode,
    changes: Partial<CollaborationProgressWait> = {}
): CollaborationProgressWait {
    return {
        id: id(index + 100),
        version: 1,
        fromNodeId: from.id,
        targetNodeId: target.id,
        kind: 'downstream',
        createdAt: time,
        updatedAt: time,
        ...changes,
    }
}

/**
 * Builds one complete authorized project response, preserving supplied node and wait order.
 * @param nodes - Entire safe work collection.
 * @param waits - Entire safe pending collection.
 * @returns A complete snapshot accepted by the board model.
 */
function progress(nodes: CollaborationProgressNode[], waits: CollaborationProgressWait[] = []): CollaborationProjectProgress {
    return { projectId: id(900), revision: 1, updatedAt: time, nodes, waits }
}

/**
 * Flattens derived groups without sorting or slicing again in the test.
 * @param value - Actual model result.
 * @returns Every matching card exactly as returned.
 */
function cards(value: ReturnType<typeof buildProjectBoard>): BoardCard[] {
    return value.columns.flatMap(column => column.cards)
}

describe('independent complete read-only project board model', () => {
    it('uses all six priorities exactly once without confusing ready, absent sources or stale generic waits with completion', () => {
        const nodes = [
            node(1, { authorized: false, status: 'failed', sourceAvailable: false, started: null }),
            node(2, { status: 'cancelled', sourceAvailable: false }),
            node(3, { status: 'completed', sourceAvailable: false }),
            node(4, { sourceAvailable: false, started: null, status: 'running' }),
            node(5, { started: null }),
            node(6, { status: 'awaiting-activation', started: false }),
            node(7, { status: 'failed' }),
            node(8, { status: 'running', started: false }),
            node(9, { started: false }),
            node(10),
            node(11, { status: 'waiting-upstream' }),
            node(12, { started: false }),
            node(13, { upstreamNodeId: id(12), ownerId: other }),
        ]
        const original = structuredClone(nodes)
        const model = buildProjectBoard(progress(nodes, [wait(1, nodes[11]!, nodes[12]!)]), owner)
        expect(BOARD_COLUMNS.map(column => column.id)).toEqual(['unstarted', 'running', 'waiting', 'ready', 'check', 'ended'])
        expect(model.total).toBe(13)
        const byId = new Map(cards(model).map(card => [card.node.id, card]))
        for (const [index, column] of [
            [1, 'ended'],
            [2, 'ended'],
            [3, 'ended'],
            [4, 'check'],
            [5, 'check'],
            [6, 'check'],
            [7, 'check'],
            [8, 'running'],
            [9, 'unstarted'],
            [10, 'ready'],
            [11, 'ready'],
            [12, 'waiting'],
        ] as const)
            expect(byId.get(id(index))!.column).toBe(column)
        expect(byId.get(id(1))!.statusLabel).toBe('授权已撤销')
        expect(byId.get(id(2))!.statusLabel).toBe('已取消')
        expect(byId.get(id(3))!.statusLabel).toBe('历史已完成')
        expect(byId.get(id(11))!.hint).toBe('当前无有效等待。')
        expect(nodes).toEqual(original)
        expect(new Set(cards(model).map(card => card.node.id)).size).toBe(13)
    })

    it('filters and counts all forty-one same-column works before any visual limit and distinguishes stable same-name owners', () => {
        const nodes = Array.from({ length: 41 }, (_, index) => node(index + 1, { ownerId: index % 2 ? other : owner }))
        const complete = progress([...nodes, nodes[0]!])
        const full = buildProjectBoard(complete, owner)
        expect(full.total).toBe(41)
        expect(full.columns.find(column => column.id === 'ready')!.cards).toHaveLength(41)
        const filtered = buildProjectBoard(complete, owner, { query: '00000029', ownerId: owner, pendingOnly: false })
        expect(filtered.total).toBe(41)
        expect(filtered.matched).toBe(1)
        expect(cards(filtered)[0]!.node.id).toBe(id(41))
        expect(filtered.columns.find(column => column.id === 'ready')!.total).toBe(41)
        expect(full.owners.map(person => person.id).sort()).toEqual([owner, other])
        expect(buildProjectBoard(complete, owner, { query: '不存在', ownerId: '', pendingOnly: false }).matched).toBe(0)
        expect(buildProjectBoard(complete, owner, { query: '', ownerId: other, pendingOnly: false }).matched).toBe(20)
    })

    it('retains all incoming outgoing and self waits on running/failed cards and filters only the real target owner', () => {
        const a = node(1, { status: 'running' })
        const b = node(2, { ownerId: other, upstreamNodeId: a.id, status: 'failed' })
        const c = node(3, { ownerId: other, upstreamNodeId: a.id })
        const waits = [
            wait(1, a, b),
            wait(2, b, a, { kind: 'upstream' }),
            wait(3, a, c),
            wait(4, a, a, { kind: 'self' }),
            wait(5, c, a, { kind: 'upstream' }),
        ]
        const model = buildProjectBoard(
            progress(
                [a, b, c],
                [
                    ...waits,
                    waits[3]!,
                    wait(6, a, b, { kind: 'self' }),
                    wait(7, a, c, { kind: 'upstream' }),
                    { ...waits[0]!, id: id(300), targetNodeId: id(999) },
                ]
            ),
            owner
        )
        const aCard = cards(model).find(card => card.node.id === a.id)!
        const bCard = cards(model).find(card => card.node.id === b.id)!
        expect(aCard.column).toBe('running')
        expect(aCard.waits).toHaveLength(5)
        expect(aCard.waits.filter(item => item.direction === 'self')).toHaveLength(1)
        expect(aCard.waits.filter(item => item.direction === 'incoming')).toHaveLength(2)
        expect(aCard.waits.filter(item => item.direction === 'outgoing')).toHaveLength(2)
        expect(bCard.column).toBe('check')
        expect(bCard.waits).toHaveLength(2)
        expect(
            cards(buildProjectBoard(progress([a, b, c], waits), owner, { query: '', ownerId: '', pendingOnly: true })).map(
                card => card.node.id
            )
        ).toEqual([a.id])
        expect(
            cards(buildProjectBoard(progress([a, b, c], waits), other, { query: '', ownerId: '', pendingOnly: true }))
                .map(card => card.node.id)
                .sort()
        ).toEqual([b.id, c.id].sort())
        for (const terminal of [
            { ...b, authorized: false },
            { ...b, status: 'cancelled' as const },
            { ...b, status: 'completed' as const },
            { ...b, sourceAvailable: false },
        ])
            expect(
                cards(buildProjectBoard(progress([a, terminal], [waits[0]!, waits[1]!]), owner)).every(card => card.waits.length === 0)
            ).toBe(true)
    })

    it('sorts real pending targets by oldest request before recent work and retains stable ID ties for nonpending cards', () => {
        const targetOne = node(1, { updatedAt: '2026-10-20T10:00:00.000Z' })
        const targetTwo = node(2, { updatedAt: '2026-10-20T11:00:00.000Z' })
        const source = node(3, { ownerId: other, upstreamNodeId: targetOne.id })
        const sourceTwo = node(4, { ownerId: other, upstreamNodeId: targetTwo.id })
        const latest = node(5, { updatedAt: '2026-10-20T12:00:00.000Z' })
        const tieOne = node(6),
            tieTwo = node(7)
        const waits = [
            wait(1, source, targetOne, { kind: 'upstream', createdAt: '2026-10-20T09:00:00.000Z' }),
            wait(2, sourceTwo, targetTwo, { kind: 'upstream', createdAt: '2026-10-20T08:00:00.000Z' }),
        ]
        const ready = buildProjectBoard(
            progress([tieTwo, source, latest, targetOne, tieOne, targetTwo, sourceTwo], waits),
            owner
        ).columns.find(column => column.id === 'ready')!
        expect(ready.cards.map(card => card.node.id)).toEqual([targetTwo.id, targetOne.id, latest.id, tieOne.id, tieTwo.id])
    })

    it('exposes only bounded own navigation and preserves terminal history while never generating a source-repair or foreign link', () => {
        const nodes = [
            node(1),
            node(2, { ownerId: other }),
            node(3, { status: 'failed' }),
            node(4, { status: 'cancelled' }),
            node(5, { authorized: false }),
            node(6, { sourceAvailable: false, started: null }),
            node(7, { status: 'awaiting-activation' }),
            node(8, { ownHref: 'https://attacker.example.test/private' }),
            node(9, { upstreamNodeId: id(999) }),
        ]
        const byId = new Map(cards(buildProjectBoard(progress(nodes), owner)).map(card => [card.node.id, card]))
        expect(byId.get(id(1))!.ownHref).toBe(nodes[0]!.ownHref)
        expect(byId.get(id(2))!.ownHref).toBeNull()
        expect(byId.get(id(3))!.repairHref).toBe(`/projects/${id(900)}?node=${id(3)}`)
        expect(byId.get(id(3))!.canContinue).toBe(false)
        expect(byId.get(id(4))!.ownHref).toBe(nodes[3]!.ownHref)
        expect(byId.get(id(5))!.canContinue).toBe(false)
        for (const index of [6, 7, 8]) {
            expect(byId.get(id(index))!.ownHref).toBeNull()
            expect(byId.get(id(index))!.repairHref).toBeNull()
        }
        expect(byId.get(id(9))!.upstreamUnavailable).toBe(true)
        expect(byId.get(id(9))!.upstream).toBeNull()
    })
})
