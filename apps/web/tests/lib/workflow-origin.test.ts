import { describe, expect, it } from 'vitest'
import { projectTemplateOrigins } from '../../components/project-progress'

describe('workflow origin display whitelist', () => {
    it('copies only immutable public identity and version without sources, goals, or graph configuration', () => {
        const origin = { templateId: 'template', version: 3, nodeId: 'original-node', position: { x: 100, y: 200 } }
        const project = {
            nodes: [
                {
                    id: 'instance-node',
                    workflowOrigin: origin,
                    goal: 'private-goal',
                    context: 'private-context',
                    source: { kind: 'conversation', id: 'private-chat' },
                },
                { id: 'new-manual-root' },
            ],
        }
        const visible = projectTemplateOrigins(project as never)
        expect(visible).toEqual({ 'instance-node': { templateId: 'template', version: 3, nodeId: 'original-node' } })
        expect(visible['instance-node']).not.toBe(origin)
        expect(JSON.stringify(visible)).not.toMatch(/position|private|source|goal|context/)
        expect(project.nodes[0]!.workflowOrigin).toEqual(origin)
    })
})
