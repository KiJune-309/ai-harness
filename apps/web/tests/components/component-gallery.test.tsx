// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ComponentGallery } from '../../components/component-gallery'

afterEach(cleanup)

describe('minimal component gallery interactions', () => {
    it('shows concrete feedback without duplicate titles and announces errors separately', async () => {
        const user = userEvent.setup()
        render(<ComponentGallery />)
        await user.click(screen.getByRole('tab', { name: '浮层与反馈' }))
        const feedback = within(screen.getByRole('region', { name: '操作反馈' }))
        expect(feedback.getAllByRole('status')).toHaveLength(3)
        expect(feedback.getByRole('alert').textContent).toBe('保存失败，你的输入已保留，请稍后重试。')
        expect(feedback.getByText('演示操作已完成，未保存业务数据。')).toBeTruthy()
        expect(feedback.queryByText('操作已完成')).toBeNull()
        expect(feedback.queryByText('一些有用的提示')).toBeNull()
        expect(feedback.queryByText('暂时未能完成')).toBeNull()
    })

    it('keeps form errors next to the field and reports validation without claiming a save', async () => {
        const user = userEvent.setup()
        render(<ComponentGallery />)
        await user.click(screen.getByRole('tab', { name: '基础控件' }))
        await user.click(screen.getByRole('button', { name: '验证表单' }))
        const name = screen.getByRole('textbox', { name: '名称必填' })
        expect(name.getAttribute('aria-invalid')).toBe('true')
        expect(document.activeElement).toBe(name)
        expect(screen.getByRole('alert').textContent).toContain('请填写名称')
        await user.type(name, '每周工作整理')
        await user.click(screen.getByRole('button', { name: '验证表单' }))
        expect(name.getAttribute('aria-invalid')).toBe('false')
        expect(screen.getByText('验证通过：每周工作整理。这次演示不会保存数据。')).toBeTruthy()
        await user.click(screen.getByRole('button', { name: '关闭演示提示' }))
        expect(screen.queryByText('验证通过：每周工作整理。这次演示不会保存数据。')).toBeNull()
    })

    it('exposes reversible motion examples through accessible controls and keyboard feedback', async () => {
        const user = userEvent.setup()
        render(<ComponentGallery />)
        await user.click(screen.getByRole('tab', { name: '动效' }))
        const hide = screen.getByRole('button', { name: '隐藏演示内容' })
        const content = document.getElementById(hide.getAttribute('aria-controls')!)!
        expect(hide.getAttribute('aria-expanded')).toBe('true')
        await user.click(hide)
        expect(content.getAttribute('aria-hidden')).toBe('true')
        expect(content.hasAttribute('inert')).toBe(true)
        await user.click(screen.getByRole('button', { name: '显示演示内容' }))
        expect(content.getAttribute('aria-hidden')).toBe('false')
        expect(content.hasAttribute('inert')).toBe(false)
        const expand = screen.getByRole('button', { name: '查看动效规则' })
        await user.click(expand)
        expect(expand.getAttribute('aria-expanded')).toBe('true')
        expect(screen.getByText(/常用反馈控制在 120–180 ms/)).toBeTruthy()
        await user.click(expand)
        expect(expand.getAttribute('aria-expanded')).toBe('false')
        const feedback = screen.getByRole('button', { name: '触发反馈' })
        feedback.focus()
        await user.keyboard('{Enter}')
        expect(screen.getByText('已触发 1 次本地反馈。')).toBeTruthy()
        await user.keyboard('{Enter}')
        expect(screen.getByText('已触发 2 次本地反馈。')).toBeTruthy()
    })
})
