// @vitest-environment jsdom

import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageComposer } from '../../components/message-composer'

/**
 * Mounts a real controlled draft to exercise editor interactions.
 * @param props - Send observer.
 * @returns The shared message composer.
 */
function Editor({ send }: { send: () => void }) {
    const [value, setValue] = useState('')
    const ref = useRef<HTMLTextAreaElement>(null)
    return <MessageComposer id="test-editor" value={value} onChange={setValue} onSend={send} inputRef={ref} placeholder="消息" />
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('message composer', () => {
    it('completes commands before sending and respects IME and multiline input', () => {
        const send = vi.fn()
        render(<Editor send={send} />)
        const editor = screen.getByRole('textbox') as HTMLTextAreaElement
        fireEvent.change(editor, { target: { value: '/plan', selectionStart: 5 } })
        fireEvent.keyDown(editor, { key: 'Enter' })
        expect(editor.value).toContain('制定可执行的计划')
        expect(send).not.toHaveBeenCalled()
        fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
        fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
        expect(send).not.toHaveBeenCalled()
        fireEvent.keyDown(editor, { key: 'Enter' })
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('preserves literal Markdown without a persistent toolbar, preview, or hint', () => {
        const send = vi.fn()
        render(<Editor send={send} />)
        const editor = screen.getByRole('textbox') as HTMLTextAreaElement
        const draft = '**重点**\n<script>alert(1)</script>'
        fireEvent.change(editor, { target: { value: draft } })
        expect(editor.value).toBe(draft)
        expect(screen.queryByRole('group', { name: '消息格式与快捷添加' })).toBeNull()
        for (const name of ['粗体', '斜体', '列表', '代码块', '文件 / Skill', '命令', '预览', '编辑']) {
            expect(screen.queryByRole('button', { name })).toBeNull()
        }
        expect(screen.queryByLabelText('消息预览')).toBeNull()
        expect(document.querySelector('script')).toBeNull()
        expect(document.querySelector('strong')).toBeNull()
        expect(screen.queryByText('Enter 发送，Shift+Enter 换行', { exact: true })).toBeNull()
        expect(editor.getAttribute('aria-describedby')).toBeNull()
        expect(send).not.toHaveBeenCalled()
    })

    it('imports actual file context and rejects oversized imports without changing the draft', async () => {
        render(<Editor send={vi.fn()} />)
        const editor = screen.getByRole('textbox') as HTMLTextAreaElement
        const picker = screen.getByLabelText('选择文本文件或 SKILL.md 文本（仅当前消息）') as HTMLInputElement
        const openPicker = vi.spyOn(picker, 'click')
        fireEvent.change(editor, { target: { value: '@', selectionStart: 1, selectionEnd: 1 } })
        fireEvent.click(screen.getByRole('button', { name: '添加文本文件' }))
        expect(openPicker).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole('group', { name: '添加上下文' })).toBeNull()
        const file = new File(['instructions'], 'SKILL.md', { type: 'text/markdown' })
        Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('请按步骤验证结果。').buffer })
        fireEvent.change(picker, { target: { files: [file] } })
        await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('请按步骤验证结果。'))
        const draft = (screen.getByRole('textbox') as HTMLTextAreaElement).value
        expect(draft).toContain('文件：SKILL.md')
        const oversized = new File(['x'.repeat(96_001)], 'large.txt')
        fireEvent.change(picker, { target: { files: [oversized] } })
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('文件过大'))
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(draft)
    })

    it('offers file and Skill actions and lets Escape dismiss completion', () => {
        render(<Editor send={vi.fn()} />)
        const editor = screen.getByRole('textbox')
        fireEvent.change(editor, { target: { value: '@', selectionStart: 1 } })
        expect(screen.getByRole('button', { name: '添加 SKILL.md 文本（仅当前消息）' })).toBeTruthy()
        fireEvent.keyDown(editor, { key: 'Escape' })
        expect(screen.queryByRole('group', { name: '添加上下文' })).toBeNull()
    })
})
