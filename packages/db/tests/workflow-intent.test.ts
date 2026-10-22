import { describe, expect, it } from 'vitest'
import { resolveWorkflowContactIntent, type WorkflowContactCandidate } from '../src/workflow-intent.js'

const upstream: WorkflowContactCandidate = {
    nodeId: '11111111-1111-4111-8111-111111111111',
    title: '客户事实整理',
    ownerId: '44444444-4444-4444-8444-444444444444',
    ownerName: '销售同事',
    direction: 'upstream',
}
const downstream: WorkflowContactCandidate = {
    nodeId: '22222222-2222-4222-8222-222222222222',
    title: '工程评估',
    ownerId: '55555555-5555-4555-8555-555555555555',
    ownerName: '工程同事',
    direction: 'downstream',
}
const branch: WorkflowContactCandidate = { ...downstream, nodeId: '33333333-3333-4333-8333-333333333333', title: '设计评审' }
const qpsQuestion = { id: '66666666-6666-4666-8666-666666666666', version: 2, text: '请补充QPS目标。' }
const timeQuestion = { id: '77777777-7777-4777-8777-777777777777', version: 3, text: '请补充交付时间。' }

describe('bounded owner workflow contact intent', () => {
    it.each(['开始', '请开始', '分析', '请先分析这个方案', '确认', '知道了', '好的', '是的', '帮我分析客户问题', '请继续本人的工作'])(
        'does not authorize ordinary local input: %s',
        content => {
            expect(resolveWorkflowContactIntent({ content, candidates: [upstream, downstream] })).toBeUndefined()
        }
    )

    it.each([
        '> 请把方案交给下游',
        '```text\n请把方案交给下游\n```',
        '“请把方案交给下游”',
        "'请把方案交给下游'",
        '模板要求完成后请交给下游',
        '同事说请把方案交给下游',
        '请分析以下正文：请把方案交给下游',
        '请分析以下正文：\n把方案交给下游',
        '讨论是否应交给下游',
        '如果完成就交给下游',
        '请不要把方案交给下游',
        '请向上游和下游发送消息',
        '把方案交给下游这件事，请帮我先分析一下',
        '向上游补问这件事请先分析一下',
        '交给下游之前先帮我看看方案',
    ])('does not treat reference or hypothetical text as a request: %s', content => {
        expect(resolveWorkflowContactIntent({ content, candidates: [upstream, downstream] })).toBeUndefined()
    })

    it('recognizes explicit natural handoff, upstream question, and ordinary relay without mentions', () => {
        expect(resolveWorkflowContactIntent({ content: '请把这份方案交给下游处理', candidates: [upstream, downstream] })).toEqual({
            kind: 'handoff',
            candidateNodeIds: [downstream.nodeId],
            targetNodeId: downstream.nodeId,
            reason: 'explicit',
        })
        expect(
            resolveWorkflowContactIntent({ content: '麻烦向上游补问：目标QPS是多少？', candidates: [upstream, downstream] })
        ).toMatchObject({
            kind: 'question',
            targetNodeId: upstream.nodeId,
        })
        expect(resolveWorkflowContactIntent({ content: '把说明转告给工程评估', candidates: [upstream, downstream] })).toMatchObject({
            kind: 'message',
            targetNodeId: downstream.nodeId,
        })
        expect(resolveWorkflowContactIntent({ content: '请回传给上游', candidates: [upstream, downstream] })).toMatchObject({
            kind: 'message',
            targetNodeId: upstream.nodeId,
        })
    })

    it('does not silently choose an unrelated sole neighbor or a nonexistent role', () => {
        expect(resolveWorkflowContactIntent({ content: '请把方案交给陌生人', candidates: [downstream] })).toBeUndefined()
        expect(resolveWorkflowContactIntent({ content: '请联系陌生人', candidates: [downstream] })).toBeUndefined()
        expect(resolveWorkflowContactIntent({ content: '请交给下游', candidates: [upstream] })).toBeUndefined()
        expect(resolveWorkflowContactIntent({ content: '请向上游补问', candidates: [downstream] })).toBeUndefined()
    })

    it('keeps branches and same-owner works ambiguous until the owner selects an exact work', () => {
        const request = resolveWorkflowContactIntent({ content: '把方案交给下游', candidates: [downstream, branch] })!
        expect(request.targetNodeId).toBeUndefined()
        expect(request.candidateNodeIds).toEqual([downstream.nodeId, branch.nodeId])
        const nameCollision = { ...branch, ownerName: downstream.title }
        expect(
            resolveWorkflowContactIntent({ content: '把方案交给工程评估', candidates: [downstream, nameCollision] })?.targetNodeId
        ).toBeUndefined()
        expect(
            resolveWorkflowContactIntent({ content: '工程同事', candidates: [downstream, branch], previous: request })?.targetNodeId
        ).toBeUndefined()
        expect(
            resolveWorkflowContactIntent({ content: '就是设计评审', candidates: [downstream, branch], previous: request })
        ).toMatchObject({
            targetNodeId: branch.nodeId,
            reason: 'clarification',
        })
    })

    it('continues genuine unconsumed clarification only inside its original target range', () => {
        const previous = { kind: 'handoff' as const, candidateNodeIds: [downstream.nodeId], targetNodeId: downstream.nodeId }
        expect(
            resolveWorkflowContactIntent({ content: '正文是：请检查吞吐量。', candidates: [downstream, branch], previous })
        ).toMatchObject({
            targetNodeId: downstream.nodeId,
            reason: 'clarification',
        })
        expect(resolveWorkflowContactIntent({ content: '就是设计评审', candidates: [downstream, branch], previous })).toBeUndefined()
        for (const content of ['确认', '知道了', '是的', '请先分析', '帮我分析这个工作', '取消发送'])
            expect(resolveWorkflowContactIntent({ content, candidates: [downstream], previous })).toBeUndefined()
        for (const content of [
            '帮我分析工程评估',
            '解释工程评估的工作说明',
            '请你先分析工程评估',
            '请阅读工程同事的工作',
            '讨论是否应该交给工程评估',
            '工程评估需要我先研究一下',
        ])
            expect(resolveWorkflowContactIntent({ content, candidates: [downstream], previous })).toBeUndefined()
        expect(resolveWorkflowContactIntent({ content: '正文是：可以', candidates: [downstream] })).toBeUndefined()
    })

    it('fixes an exact real reply question while preserving ambiguity across parallel questions', () => {
        const candidate = { ...upstream, questions: [qpsQuestion, timeQuestion] }
        const request = resolveWorkflowContactIntent({ content: '请回复上游', candidates: [candidate] })!
        expect(request.targetNodeId).toBe(upstream.nodeId)
        expect(request.questionId).toBeUndefined()
        expect(request.candidateQuestionIds).toEqual([qpsQuestion.id, timeQuestion.id])
        expect(resolveWorkflowContactIntent({ content: '关于QPS的问题', candidates: [candidate], previous: request })).toMatchObject({
            questionId: qpsQuestion.id,
            reason: 'clarification',
        })
        expect(resolveWorkflowContactIntent({ content: '请回复关于交付时间的问题', candidates: [candidate] })).toMatchObject({
            targetNodeId: upstream.nodeId,
            questionId: timeQuestion.id,
        })
    })

    it('does not turn a plain input into a reply simply because one pending question exists', () => {
        const candidate = { ...upstream, questions: [qpsQuestion] }
        const previous = {
            kind: 'reply' as const,
            candidateNodeIds: [candidate.nodeId],
            targetNodeId: candidate.nodeId,
            candidateQuestionIds: [qpsQuestion.id],
        }
        for (const content of ['是的', '帮我先分析', '确认', '知道了', '请补充QPS目标'])
            expect(resolveWorkflowContactIntent({ content, candidates: [candidate], previous })).toBeUndefined()
        expect(resolveWorkflowContactIntent({ content: '请回复这个问题', candidates: [candidate] })).toMatchObject({
            questionId: qpsQuestion.id,
            targetNodeId: candidate.nodeId,
        })
        expect(
            resolveWorkflowContactIntent({ content: '正文是：已确认。', candidates: [{ ...candidate, questions: [] }], previous })
        ).toBeUndefined()
    })
})
