'use client'

import { useImperativeHandle, useRef, type ComponentProps } from 'react'
import { LoaderCircle, Search, X } from 'lucide-react'
import { cn } from 'cn'
import { Input } from './input'

export type SearchInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
    value: string
    onValueChange: (value: string) => void
    containerClassName?: string
    clearLabel?: string
    loading?: boolean
}

/**
 * Renders the shared search field with an inset icon and an accessible clear action.
 * @param props - Controlled query, change handler, loading state and native input attributes.
 * @returns A search input that preserves caller filtering, form and keyboard behavior.
 */
export function SearchInput({
    value,
    onValueChange,
    containerClassName,
    className,
    clearLabel = '清空搜索内容',
    loading = false,
    disabled,
    readOnly,
    ref,
    id,
    autoComplete = 'off',
    ...props
}: SearchInputProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => inputRef.current!)

    /**
     * Clears the controlled query and returns focus to the actual search field.
     * @returns Nothing after notifying the caller of the new query.
     */
    function clearQuery() {
        onValueChange('')
        inputRef.current?.focus()
    }

    return (
        <div data-slot="search-input" className={cn('relative w-full min-w-0', containerClassName)}>
            {loading ? (
                <LoaderCircle
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none"
                />
            ) : (
                <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground"
                />
            )}
            <Input
                {...props}
                id={id}
                ref={inputRef}
                type="search"
                value={value}
                onChange={event => onValueChange(event.target.value)}
                autoComplete={autoComplete}
                disabled={disabled}
                readOnly={readOnly}
                aria-label={props['aria-label'] ?? (id || props['aria-labelledby'] ? undefined : '搜索')}
                aria-busy={loading || props['aria-busy']}
                className={cn(
                    'pr-10 pl-10 enabled:hover:border-ring/60 read-only:hover:border-input aria-invalid:enabled:hover:border-destructive [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none pointer-coarse:pr-12',
                    className
                )}
            />
            {value.length > 0 && !readOnly && (
                <button
                    type="button"
                    aria-label={clearLabel}
                    disabled={disabled}
                    onClick={clearQuery}
                    className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-lg text-muted-foreground transition-colors duration-(--motion-fast) hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 pointer-coarse:w-11 motion-reduce:transition-none"
                >
                    <X aria-hidden="true" className="size-4" />
                </button>
            )}
        </div>
    )
}
