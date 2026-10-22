import { describe, expect, it } from 'vitest'
import { boundedPosition, canSetWorkflowUpstream } from '../../lib/workflow-connections'
describe('bounded workflow layout', () => {
    it('bounds normalized pointer and keyboard changes while rejecting nonfinite coordinates', () => {
        expect([-20, 0, 999.6, 1200, NaN, Infinity].map(boundedPosition)).toEqual([0, 0, 1000, 1000, 0, 0])
    })
    it('allows explicit reparenting or disconnection but refuses self, missing and ancestor cycles without mutating the draft', () => {
        const nodes = Object.freeze([
            Object.freeze({ id: 'A', upstreamNodeId: null }),
            Object.freeze({ id: 'B', upstreamNodeId: 'A' }),
            Object.freeze({ id: 'C', upstreamNodeId: 'B' }),
            Object.freeze({ id: 'D', upstreamNodeId: 'A' }),
        ])
        expect(canSetWorkflowUpstream(nodes, 'C', 'A')).toBe(true)
        expect(canSetWorkflowUpstream(nodes, 'C', null)).toBe(true)
        expect(canSetWorkflowUpstream(nodes, 'A', 'C')).toBe(false)
        expect(canSetWorkflowUpstream(nodes, 'B', 'B')).toBe(false)
        expect(canSetWorkflowUpstream(nodes, 'absent', 'A')).toBe(false)
        expect(canSetWorkflowUpstream(nodes, 'B', 'absent')).toBe(false)
        expect(nodes[2]!.upstreamNodeId).toBe('B')
    })

    it('validates a retargeted edge against the atomic detached old target and rejects a missing reconnection endpoint', () => {
        const nodes = [
            { id: 'A', upstreamNodeId: null },
            { id: 'B', upstreamNodeId: 'A' },
            { id: 'C', upstreamNodeId: 'B' },
        ]
        expect(canSetWorkflowUpstream(nodes, 'A', 'C')).toBe(false)
        expect(canSetWorkflowUpstream(nodes, 'A', 'C', 'B')).toBe(true)
        expect(canSetWorkflowUpstream(nodes, 'A', 'C', 'missing')).toBe(false)
        expect(nodes).toEqual([
            { id: 'A', upstreamNodeId: null },
            { id: 'B', upstreamNodeId: 'A' },
            { id: 'C', upstreamNodeId: 'B' },
        ])
    })
})
