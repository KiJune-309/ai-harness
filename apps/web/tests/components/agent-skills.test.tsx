// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillRecord, SkillRef, SkillSnapshot } from '@ai-harness/contracts'
import { AgentSkillsEditor, AgentSkillSnapshots, skillBindingError } from '../../components/agent-skills'
import { AgentEditor } from '../../components/agent-editor'
import { TooltipProvider } from '../../components/ui/tooltip'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({
    list: vi.fn(),
    get: vi.fn(),
    resolve: vi.fn(),
    change: vi.fn(),
    catalog: vi.fn(),
    agents: vi.fn(),
    getAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    push: vi.fn(),
}))
vi.mock('../../lib/skill-client', () => ({ listSkills: api.list, getSkill: api.get }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.push }) }))
vi.mock('../../components/account-context', () => ({ useAccount: () => ({ modelLabel: (id: string) => id }) }))
vi.mock('../../lib/agent-client', () => ({
    getAgentCatalog: api.catalog,
    listAgents: api.agents,
    getAgent: api.getAgent,
    createAgent: api.createAgent,
    updateAgent: api.updateAgent,
}))
const records: SkillRecord[] = Array.from({ length: 6 }, (_, index) => ({
    id: `${index + 1}9191919-1919-4919-8919-191919191919`,
    version: 1,
    title: '同名方法',
    description: `说明${index}`,
    content: `正文${index}\n${'${literal}'}`,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
}))

/**
 * Gives the actual picker parent-owned exact references and detached frozen bodies.
 * @param props - Optional already saved binding and snapshot cache.
 * @returns The live editor without replacing its user interactions with stubs.
 */
function Harness({ initialRefs = [], initialSnapshots = [] }: { initialRefs?: SkillRef[]; initialSnapshots?: SkillSnapshot[] }) {
    const [refs, setRefs] = useState(initialRefs)
    const [snapshots, setSnapshots] = useState(initialSnapshots)
    return (
        <>
            <AgentSkillsEditor
                refs={refs}
                snapshots={snapshots}
                onChange={next => {
                    api.change(next)
                    setRefs(next)
                }}
                onResolve={snapshot => {
                    api.resolve(snapshot)
                    setSnapshots(current => [...current, snapshot])
                }}
            />
            <output aria-label="保存引用">{JSON.stringify(refs)}</output>
        </>
    )
}

beforeEach(() => {
    vi.resetAllMocks()
    installAcceptanceBrowser()
    api.list.mockResolvedValue(records)
    api.get.mockImplementation(async (id: string, version: number) => ({ ...records.find(record => record.id === id)!, version }))
    api.catalog.mockResolvedValue({
        defaultModelId: 'fixture-model',
        models: [{ id: 'fixture-model', label: '本人模型', provider: 'openai', available: true }],
        tools: [],
    })
    api.agents.mockResolvedValue([])
})
afterEach(cleanup)

describe('independent exact Agent Skill selection', () => {
    it('keeps selection order and same-name identity, reads full exact text, rejects a sixth and removes only explicit bindings', async () => {
        const user = userEvent.setup()
        render(<Harness />)
        await screen.findByRole('button', { name: `选择技能 同名方法 ${records[0]!.id.slice(0, 8)}` })
        for (const index of [2, 0, 4, 1, 3])
            await user.click(screen.getByRole('button', { name: `选择技能 同名方法 ${records[index]!.id.slice(0, 8)}` }))
        expect(api.change.mock.calls.at(-1)![0].map((ref: SkillRef) => ref.skillId)).toEqual(
            [2, 0, 4, 1, 3].map(index => records[index]!.id)
        )
        await user.click(screen.getByRole('button', { name: `选择技能 同名方法 ${records[5]!.id.slice(0, 8)}` }))
        expect(await screen.findByText('最多绑定 5 个技能。')).toBeTruthy()
        expect(api.get).toHaveBeenCalledTimes(5)
        await user.click(screen.getAllByRole('button', { name: '查看 v1 全文' })[0]!)
        const dialog = await screen.findByRole('dialog', { name: '技能版本全文' })
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: '技能版本全文' })))
        expect(dialog.querySelector('pre')?.textContent).toBe(records[2]!.content)
        await user.click(within(dialog).getByRole('button', { name: '关闭' }))
        await user.click(screen.getAllByRole('button', { name: '移除技能 同名方法' })[0]!)
        expect(api.change.mock.calls.at(-1)![0]).toHaveLength(4)
    })

    it('does not upgrade an existing snapshot until explicit selection and preserves its original position', async () => {
        const record = records[0]!
        const snapshot = {
            skillId: record.id,
            version: 1,
            title: record.title,
            description: record.description,
            content: 'FROZEN_OLD_BODY',
        }
        api.list.mockResolvedValue([{ ...record, version: 2 }])
        render(<Harness initialRefs={[{ skillId: record.id, version: 1 }]} initialSnapshots={[snapshot]} />)
        expect(await screen.findByText('当前 v1，可更新到 v2')).toBeTruthy()
        expect(api.get).not.toHaveBeenCalled()
        expect(api.change).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: '使用新版 v2' }))
        await waitFor(() => expect(api.change).toHaveBeenCalledWith([{ skillId: record.id, version: 2 }]))
        expect(api.get).toHaveBeenCalledWith(record.id, 2)
        expect(api.resolve.mock.calls[0]![0]).toMatchObject({ skillId: record.id, version: 2 })
    })

    it('accepts exactly 32000 characters, rejects 32001 before changing references and keeps bindings on library failure', async () => {
        const snapshots = records
            .slice(0, 2)
            .map(record => ({ skillId: record.id, version: 1, title: record.title, description: '', content: '字'.repeat(16000) }))
        const refs = snapshots.map(({ skillId, version }) => ({ skillId, version }))
        expect(skillBindingError(refs, snapshots)).toBe('')
        expect(
            skillBindingError(
                [...refs, { skillId: records[2]!.id, version: 1 }],
                [...snapshots, { skillId: records[2]!.id, version: 1, title: '一字', description: '', content: '字' }]
            )
        ).toBe('已选技能正文合计最多 32000 个字。')
        api.get.mockResolvedValue({ ...records[2], content: '字' })
        render(<Harness initialRefs={refs} initialSnapshots={snapshots} />)
        await screen.findByRole('button', { name: `选择技能 同名方法 ${records[2]!.id.slice(0, 8)}` })
        fireEvent.click(screen.getByRole('button', { name: `选择技能 同名方法 ${records[2]!.id.slice(0, 8)}` }))
        expect(await screen.findByText('已选技能正文合计最多 32000 个字。')).toBeTruthy()
        expect(api.change).not.toHaveBeenCalled()
        api.list.mockRejectedValueOnce(new Error('库读取失败'))
        fireEvent.click(screen.getByRole('button', { name: '刷新技能库' }))
        expect(await screen.findByText('库读取失败 已绑定版本保持不变。')).toBeTruthy()
        expect(JSON.parse(screen.getByLabelText('保存引用').textContent!)).toEqual(refs)
    })

    it('reads frozen detail without fetching a newer body and rejects a mismatched selected version', async () => {
        const record = records[0]!
        const snapshot = { skillId: record.id, version: 1, title: record.title, description: '', content: 'FROZEN_DETAIL_BODY\n${literal}' }
        const { unmount } = render(<AgentSkillSnapshots snapshots={[snapshot]} />)
        fireEvent.click(screen.getByRole('button', { name: '查看 v1 全文' }))
        expect((await screen.findByRole('dialog', { name: '技能版本全文' })).querySelector('pre')?.textContent).toBe(snapshot.content)
        expect(api.get).not.toHaveBeenCalled()
        expect(api.list).not.toHaveBeenCalled()
        unmount()
        api.get.mockResolvedValueOnce({ ...record, version: 99 })
        render(<Harness />)
        await screen.findByRole('button', { name: `选择技能 同名方法 ${record.id.slice(0, 8)}` })
        fireEvent.click(screen.getByRole('button', { name: `选择技能 同名方法 ${record.id.slice(0, 8)}` }))
        expect(await screen.findByText('技能返回的版本不匹配，请重新载入。')).toBeTruthy()
        expect(api.change).not.toHaveBeenCalled()
    })

    it('checks new actual snapshot identities for available updates even when the selected count stays the same', async () => {
        const first = records[0]!
        const next = records[1]!
        api.list.mockResolvedValueOnce([{ ...first, version: 2 }]).mockResolvedValueOnce([{ ...next, version: 3 }])
        const { rerender } = render(
            <AgentSkillSnapshots
                snapshots={[{ skillId: first.id, version: 1, title: first.title, description: '', content: '原冻结正文' }]}
                checkUpdates
            />
        )
        expect(await screen.findByText('当前 v1，可更新到 v2。编辑 Agent 后可明确使用新版。')).toBeTruthy()
        rerender(
            <AgentSkillSnapshots
                snapshots={[{ skillId: next.id, version: 1, title: next.title, description: '', content: '新身份冻结正文' }]}
                checkUpdates
            />
        )
        expect(await screen.findByText('当前 v1，可更新到 v3。编辑 Agent 后可明确使用新版。')).toBeTruthy()
        expect(api.list).toHaveBeenCalledTimes(2)
        expect(api.get).not.toHaveBeenCalled()
    })

    it('blocks parent creation step, close and submit while an exact Skill body is still being read', async () => {
        const user = userEvent.setup()
        const pending = acceptanceDeferred<SkillRecord>()
        const record = records[0]!
        api.get.mockReturnValueOnce(pending.promise)
        api.createAgent.mockResolvedValue({
            id: '19191919-1919-4919-8919-191919191919',
            name: '父级创建测试',
            description: '',
            modelId: 'fixture-model',
            systemPrompt: '',
            toolIds: [],
            openingMessages: [],
            skillSnapshots: [
                { skillId: record.id, version: 1, title: record.title, description: record.description, content: record.content },
            ],
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        })
        render(
            <TooltipProvider>
                <AgentEditor />
            </TooltipProvider>
        )
        await user.click(await screen.findByRole('button', { name: '新建 Agent' }))
        const dialog = screen.getByRole('dialog', { name: '新建 Agent' })
        fireEvent.change(within(dialog).getByRole('textbox', { name: /^名称/ }), { target: { value: '父级创建测试' } })
        await user.click(within(dialog).getByRole('button', { name: '下一步' }))
        await user.click(await within(dialog).findByRole('button', { name: `选择技能 同名方法 ${record.id.slice(0, 8)}` }))
        for (const name of ['下一步', '上一步', '取消', '关闭新建 Agent'])
            expect((within(dialog).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.submit(document.querySelector('#agent-editor-form')!)
        await user.keyboard('{Escape}')
        expect(screen.getByRole('dialog', { name: '新建 Agent' })).toBeTruthy()
        expect(api.createAgent).not.toHaveBeenCalled()
        await act(async () => pending.resolve(record))
        await waitFor(() => expect((within(dialog).getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(false))
        await user.click(within(dialog).getByRole('button', { name: '下一步' }))
        await user.click(within(dialog).getByRole('button', { name: '确定创建' }))
        await waitFor(() => expect(api.createAgent).toHaveBeenCalledTimes(1))
        expect(api.createAgent.mock.calls[0]![0].skillRefs).toEqual([{ skillId: record.id, version: 1 }])
    })

    it('blocks parent edit save and cancellation until an explicit version upgrade resolves', async () => {
        const user = userEvent.setup()
        const record = records[0]!
        const pending = acceptanceDeferred<SkillRecord>()
        const saved = {
            id: '49494949-4949-4949-8949-494949494949',
            name: '父级详情测试',
            description: '',
            modelId: 'fixture-model',
            systemPrompt: '原prompt',
            toolIds: [],
            openingMessages: [],
            skillSnapshots: [
                { skillId: record.id, version: 1, title: record.title, description: record.description, content: '冻结v1正文' },
            ],
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        }
        api.getAgent.mockResolvedValue(saved)
        api.list.mockResolvedValue([{ ...record, version: 2 }])
        api.get.mockReturnValueOnce(pending.promise)
        api.updateAgent.mockResolvedValue({ ...saved, skillSnapshots: [{ ...saved.skillSnapshots[0], version: 2, content: '新版正文' }] })
        render(
            <TooltipProvider>
                <AgentEditor agentId={saved.id} />
            </TooltipProvider>
        )
        await user.click(await screen.findByRole('button', { name: '编辑 Agent' }))
        await user.click(await screen.findByRole('button', { name: '使用新版 v2' }))
        for (const name of ['保存 Agent', '保存并开始对话', '取消编辑'])
            expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.submit(document.querySelector('#agent-editor-form')!)
        expect(api.updateAgent).not.toHaveBeenCalled()
        await act(async () => pending.resolve({ ...record, version: 2, content: '新版正文' }))
        await waitFor(() => expect((screen.getByRole('button', { name: '保存 Agent' }) as HTMLButtonElement).disabled).toBe(false))
        await user.click(screen.getByRole('button', { name: '保存 Agent' }))
        await waitFor(() => expect(api.updateAgent).toHaveBeenCalledTimes(1))
        expect(api.updateAgent.mock.calls[0]![1].skillRefs).toEqual([{ skillId: record.id, version: 2 }])
    })
})
