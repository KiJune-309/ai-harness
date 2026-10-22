import { describe, expect, it } from 'vitest'
import { groupProjectRelations } from '../../lib/project-relations'

/**
 * Builds immutable responsibility metadata independent of private work text.
 * @param id - Stable work identity.
 * @param upstreamNodeId - Actual stored upstream reference.
 * @returns One minimal node for relationship traversal tests.
 */
function node(id: string, upstreamNodeId: string | null) {
    return { id, upstreamNodeId, createdAt: '2026-10-20T00:00:00.000Z', ownerId: 'same-person' }
}

describe('bounded project responsibility grouping', () => {
    it('preserves multiple roots, every branch, and several works owned by one person', () => {
        const records = [node('c', 'b'), node('other', null), node('branch', 'a'), node('b', 'a'), node('a', null)]
        const result = groupProjectRelations(records)
        expect(result.roots.map(group => group.nodes.map(item => item.id))).toEqual([['a', 'b', 'c', 'branch'], ['other']])
        expect(result.unresolved).toEqual([])
        expect(records.map(item => item.id)).toEqual(['c', 'other', 'branch', 'b', 'a'])
    })

    it('keeps missing upstream references, self references, and cycles finite without inventing repairs', () => {
        const records = [
            node('root', null),
            node('missing', 'private-hidden-parent'),
            node('child', 'missing'),
            node('cycle-a', 'cycle-b'),
            node('cycle-b', 'cycle-a'),
            node('self', 'self'),
        ]
        const result = groupProjectRelations(records)
        expect(result.roots[0]?.nodes.map(item => item.id)).toEqual(['root'])
        expect(result.unresolved.map(item => item.id)).toEqual(['child', 'cycle-a', 'cycle-b', 'missing', 'self'])
        const all = [...result.roots.flatMap(group => group.nodes), ...result.unresolved]
        expect(new Set(all.map(item => item.id)).size).toBe(records.length)
        expect(records.find(item => item.id === 'missing')?.upstreamNodeId).toBe('private-hidden-parent')
    })

    it('handles deep valid chains iteratively and displays repeated identifiers only once', () => {
        const chain = Array.from({ length: 5000 }, (_, index) =>
            node(String(index).padStart(5, '0'), index === 0 ? null : String(index - 1).padStart(5, '0'))
        )
        const result = groupProjectRelations([...chain, chain[2]!])
        expect(result.roots).toHaveLength(1)
        expect(result.roots[0]?.nodes).toHaveLength(5000)
        expect(result.unresolved).toHaveLength(0)
    })
})
