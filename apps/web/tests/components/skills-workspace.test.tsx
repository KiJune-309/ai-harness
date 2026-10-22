// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Link from 'next/link'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillRecord } from '@ai-harness/contracts'
import { SkillWorkspace } from '../../components/skills-workspace'
import { acceptanceDeferred, installAcceptanceBrowser } from './shadcn-acceptance-fixture'

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), versions: vi.fn(), create: vi.fn(), update: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.push }) }))
vi.mock('../../lib/skill-client', () => ({
    listSkills: api.list,
    getSkill: api.get,
    listSkillVersions: api.versions,
    createSkill: api.create,
    updateSkill: api.update,
}))
const original: SkillRecord = {
    id: '19191919-1919-4919-8919-191919191919',
    title: '检查方法',
    description: '搜索说明',
    content: '第一行\n\n${literal}\n<script>window.UNSAFE=true</script>\nhttps://not-fetch.example.test',
    version: 1,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
}

beforeEach(() => {
    vi.resetAllMocks()
    installAcceptanceBrowser()
    api.list.mockResolvedValue([])
    api.get.mockResolvedValue(original)
    api.versions.mockResolvedValue([{ version: 1, title: original.title, updatedAt: original.updatedAt }])
})
afterEach(cleanup)

describe('independent real Skill library components', () => {
    it('distinguishes failure, empty and same-name search without changing the complete count or creating examples', async () => {
        api.list.mockRejectedValueOnce(new Error('真实存储暂不可用'))
        render(<SkillWorkspace />)
        expect(await screen.findByText('真实存储暂不可用')).toBeTruthy()
        expect(screen.queryByText('还没有技能')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: '刷新' }))
        expect(await screen.findByText('还没有技能')).toBeTruthy()
        api.list.mockResolvedValue([original, { ...original, id: '29292929-2929-4929-8929-292929292929', description: '第二份' }])
        fireEvent.click(screen.getByRole('button', { name: '刷新' }))
        expect(await screen.findByText('2 个技能')).toBeTruthy()
        expect(screen.getAllByRole('link', { name: '检查方法' })).toHaveLength(2)
        expect(screen.getByText('19191919')).toBeTruthy()
        expect(screen.getByText('29292929')).toBeTruthy()
        fireEvent.change(screen.getByRole('searchbox', { name: '搜索技能' }), { target: { value: '第二份' } })
        expect(screen.getAllByRole('link', { name: '检查方法' })).toHaveLength(1)
        expect(screen.getByText('2 个技能')).toBeTruthy()
        fireEvent.change(screen.getByRole('searchbox', { name: '搜索技能' }), { target: { value: '不存在' } })
        expect(screen.getByText('没有匹配的技能')).toBeTruthy()
    })

    it('focuses the first invalid field, protects cancellation and retains the same create action through a lost response', async () => {
        const user = userEvent.setup()
        render(<SkillWorkspace />)
        await screen.findByText('还没有技能')
        await user.click(screen.getByRole('button', { name: '新建技能' }))
        const dialog = screen.getByRole('dialog', { name: '新建技能' })
        await user.click(within(dialog).getByRole('button', { name: '保存技能' }))
        expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: '技能标题' }))
        fireEvent.change(within(dialog).getByRole('textbox', { name: '技能标题' }), { target: { value: 'A'.repeat(61) } })
        await user.click(within(dialog).getByRole('button', { name: '保存技能' }))
        expect(within(dialog).getByText('技能标题最多 60 个字。')).toBeTruthy()
        fireEvent.change(within(dialog).getByRole('textbox', { name: '技能标题' }), { target: { value: '新方法' } })
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Markdown 正文' }), { target: { value: original.content } })
        await user.click(within(dialog).getByRole('button', { name: '取消' }))
        await user.click(screen.getByRole('button', { name: '继续编辑' }))
        expect((screen.getByRole('textbox', { name: 'Markdown 正文' }) as HTMLTextAreaElement).value).toBe(original.content)
        api.create.mockRejectedValueOnce(new Error('响应中断，请用原请求重试')).mockResolvedValueOnce(original)
        await user.click(screen.getByRole('button', { name: '保存技能' }))
        expect(await screen.findByText('响应中断，请用原请求重试')).toBeTruthy()
        await user.click(screen.getByRole('button', { name: '保存技能' }))
        await waitFor(() => expect(api.push).toHaveBeenCalledWith(`/skills/${original.id}`))
        expect(api.create.mock.calls[1]![0]).toEqual(api.create.mock.calls[0]![0])
        expect(api.create.mock.calls[0]![0].content).toBe(original.content)
    })

    it('blocks duplicate create submits until the original action settles', async () => {
        const pending = acceptanceDeferred<SkillRecord>()
        api.create.mockReturnValue(pending.promise)
        render(<SkillWorkspace />)
        await screen.findByText('还没有技能')
        fireEvent.click(screen.getByRole('button', { name: '新建技能' }))
        fireEvent.change(screen.getByRole('textbox', { name: '技能标题' }), { target: { value: '方法' } })
        fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 正文' }), { target: { value: '正文' } })
        const form = screen.getByRole('textbox', { name: '技能标题' }).closest('form')!
        fireEvent.submit(form)
        fireEvent.submit(form)
        expect(api.create).toHaveBeenCalledTimes(1)
        await act(async () => pending.resolve(original))
        expect(api.push).toHaveBeenCalledTimes(1)
    })

    it('preserves every local field on 409 and requires explicit latest comparison and a new human submit', async () => {
        const user = userEvent.setup()
        const latest = { ...original, version: 2, content: '服务器不同正文' }
        api.update
            .mockRejectedValueOnce(Object.assign(new Error('版本冲突'), { status: 409 }))
            .mockResolvedValueOnce({ ...original, version: 3, content: '本地完整正文\n第二行' })
        render(<SkillWorkspace skillId={original.id} />)
        await screen.findByRole('heading', { name: original.title, level: 1 })
        fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 正文' }), { target: { value: '本地完整正文\n第二行' } })
        await user.click(screen.getByRole('button', { name: '保存新版本' }))
        expect(await screen.findByText('版本冲突')).toBeTruthy()
        expect((screen.getByRole('button', { name: '保存新版本' }) as HTMLButtonElement).disabled).toBe(true)
        api.get.mockResolvedValueOnce(latest)
        await user.click(screen.getByRole('button', { name: '重读最新版本' }))
        const compare = await screen.findByRole('dialog', { name: '核对最新版本与本地输入' })
        await waitFor(() => expect(document.activeElement).toBe(within(compare).getByRole('heading', { name: '核对最新版本与本地输入' })))
        expect(within(compare).getByText('服务器不同正文')).toBeTruthy()
        expect(within(compare).getByText('本地完整正文 第二行')).toBeTruthy()
        await user.click(within(compare).getByRole('button', { name: '保留本地并采用最新基准' }))
        expect(api.update).toHaveBeenCalledTimes(1)
        expect((screen.getByRole('textbox', { name: 'Markdown 正文' }) as HTMLTextAreaElement).value).toBe('本地完整正文\n第二行')
        await user.click(screen.getByRole('button', { name: '保存新版本' }))
        await screen.findByText('已保存 v3')
        expect(api.update.mock.calls[1]![1]).toMatchObject({ version: 2, content: '本地完整正文\n第二行' })
        expect(api.update.mock.calls[1]![1].requestId).not.toBe(api.update.mock.calls[0]![1].requestId)
    })

    it('opens exact immutable history as literal text and refuses a mismatched historical response', async () => {
        const user = userEvent.setup()
        render(<SkillWorkspace skillId={original.id} />)
        await screen.findByRole('heading', { name: original.title, level: 1 })
        await user.click(screen.getByRole('button', { name: '查看 v1' }))
        const dialog = await screen.findByRole('dialog', { name: '技能版本全文' })
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: '技能版本全文' })))
        await waitFor(() => expect(dialog.querySelector('pre')?.textContent).toBe(original.content))
        expect(dialog.querySelector('script')).toBeNull()
        expect(dialog.querySelector('a')).toBeNull()
        expect(api.get.mock.calls.at(-1)).toEqual([original.id, 1])
        await user.click(within(dialog).getByRole('button', { name: '关闭' }))
        api.get.mockResolvedValueOnce({ ...original, version: 2 })
        await user.click(screen.getByRole('button', { name: '查看 v1' }))
        expect(await screen.findByText('技能版本返回不匹配，请重试。')).toBeTruthy()
    })

    it('returns to the library after explicitly discarding an edited detail navigation', async () => {
        const user = userEvent.setup()
        render(<SkillWorkspace skillId={original.id} />)
        await screen.findByRole('heading', { name: original.title, level: 1 })
        fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 正文' }), { target: { value: '未保存修改' } })
        await user.click(screen.getByRole('link', { name: '返回 Skills' }))
        expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeTruthy()
        await user.click(screen.getByRole('button', { name: '放弃修改' }))
        await waitFor(() => expect(api.push).toHaveBeenCalledWith('/skills'))
        expect(api.update).not.toHaveBeenCalled()
    })

    it('ignores a delayed previous identity response after moving to a new owned route', async () => {
        const stale = acceptanceDeferred<SkillRecord>()
        const next = { ...original, id: '39393939-3939-4939-8939-393939393939', title: '新范围技能', content: '新范围正文' }
        api.get.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(next)
        const { rerender } = render(<SkillWorkspace skillId={original.id} />)
        rerender(<SkillWorkspace skillId={next.id} />)
        await screen.findByRole('heading', { name: next.title, level: 1 })
        await act(async () => stale.resolve(original))
        expect(screen.queryByRole('heading', { name: original.title, level: 1 })).toBeNull()
        expect((screen.getByRole('textbox', { name: 'Markdown 正文' }) as HTMLTextAreaElement).value).toBe(next.content)
        expect(api.get.mock.calls[0]![2].aborted).toBe(true)
    })

    it('guards a real same-origin sidebar anchor and navigates to that exact destination only after explicit discard', async () => {
        const user = userEvent.setup()
        render(
            <>
                <Link href="/agents?from=skills">侧栏 Agents</Link>
                <SkillWorkspace skillId={original.id} />
            </>
        )
        await screen.findByRole('heading', { name: original.title, level: 1 })
        fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 正文' }), { target: { value: '跨页面前的未保存完整稿' } })
        await user.click(screen.getByRole('link', { name: '侧栏 Agents' }))
        await user.click(screen.getByRole('button', { name: '继续编辑' }))
        expect(api.push).not.toHaveBeenCalled()
        expect((screen.getByRole('textbox', { name: 'Markdown 正文' }) as HTMLTextAreaElement).value).toBe('跨页面前的未保存完整稿')
        await user.click(screen.getByRole('link', { name: '侧栏 Agents' }))
        await user.click(screen.getByRole('button', { name: '放弃修改' }))
        await waitFor(() => expect(api.push).toHaveBeenCalledWith('/agents?from=skills'))
        expect(api.update).not.toHaveBeenCalled()
    })
})
