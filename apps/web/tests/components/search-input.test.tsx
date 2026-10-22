// @vitest-environment jsdom

import { createRef, useState, type FormEvent, type Ref } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchInput } from '../../components/ui/search-input'

afterEach(cleanup)

/**
 * Exercises controlled search within a real form and with an external input ref.
 * @param props - Native input ref and observable form submission callback.
 * @returns The caller-owned query, field and submit boundary.
 */
function SearchForm({ inputRef, onSubmit }: { inputRef: Ref<HTMLInputElement>; onSubmit: (event: FormEvent) => void }) {
    const [query, setQuery] = useState('')
    return (
        <form onSubmit={onSubmit}>
            <label htmlFor="query">搜索资料</label>
            <SearchInput id="query" ref={inputRef} value={query} onValueChange={setQuery} />
            <output aria-label="当前查询">{query || '全部资料'}</output>
        </form>
    )
}

describe('shared search interactions', () => {
    it('clears a caller-owned query by keyboard, restores input focus and does not submit its form', async () => {
        const user = userEvent.setup()
        const ref = createRef<HTMLInputElement>()
        const submit = vi.fn((event: FormEvent) => event.preventDefault())
        render(<SearchForm inputRef={ref} onSubmit={submit} />)
        const input = screen.getByRole('searchbox', { name: '搜索资料' }) as HTMLInputElement
        expect(ref.current).toBe(input)
        await user.type(input, '产品设计😀')
        expect(screen.getByLabelText('当前查询').textContent).toBe('产品设计😀')
        await user.tab()
        expect(document.activeElement).toBe(screen.getByRole('button', { name: '清空搜索内容' }))
        await user.keyboard('{Enter}')
        expect(input.value).toBe('')
        expect(screen.getByLabelText('当前查询').textContent).toBe('全部资料')
        expect(document.activeElement).toBe(input)
        expect(screen.queryByRole('button', { name: '清空搜索内容' })).toBeNull()
        expect(submit).not.toHaveBeenCalled()
    })

    it('prevents clear or edit actions while disabled or read-only', async () => {
        const user = userEvent.setup()
        const changed = vi.fn()
        const { rerender } = render(<SearchInput aria-label="搜索技能" value="已保存的查询" onValueChange={changed} disabled />)
        await user.click(screen.getByRole('button', { name: '清空搜索内容' }))
        await user.type(screen.getByRole('searchbox', { name: '搜索技能' }), '改动')
        expect(changed).not.toHaveBeenCalled()
        rerender(<SearchInput aria-label="搜索技能" value="已保存的查询" onValueChange={changed} readOnly />)
        expect(screen.queryByRole('button', { name: '清空搜索内容' })).toBeNull()
        await user.type(screen.getByRole('searchbox', { name: '搜索技能' }), '改动')
        expect(changed).not.toHaveBeenCalled()
    })
})
