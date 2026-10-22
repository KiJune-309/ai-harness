'use client'

import type { ComponentProps, MouseEventHandler, ReactNode } from 'react'
import { cn } from 'cn'
import { Button } from './button'

export type EmptyStateProps = Omit<ComponentProps<'div'>, 'title' | 'children'> & {
    icon?: ReactNode
    title: ReactNode
    description?: ReactNode
    titleAs?: 'h2' | 'h3' | 'h4'
    actionLabel?: string
    actionIcon?: ReactNode
    onAction?: MouseEventHandler<HTMLButtonElement>
    actionVariant?: ComponentProps<typeof Button>['variant']
    actionDisabled?: boolean
    actionProps?: Omit<ComponentProps<'button'>, 'children' | 'onClick' | 'disabled' | 'type'>
}

/**
 * Displays a reusable empty state with caller-provided content and an optional action.
 * @param props - Icon, text, heading level, button presentation, click handler and container attributes.
 * @returns The empty-state layout; business actions run only through the supplied click handler.
 */
export function EmptyState({
    icon,
    title,
    description,
    titleAs: Title = 'h2',
    actionLabel,
    actionIcon,
    onAction,
    actionVariant = 'outline',
    actionDisabled = false,
    actionProps,
    className,
    ...props
}: EmptyStateProps) {
    return (
        <div
            data-slot="empty-state"
            className={cn('flex min-h-52 min-w-0 flex-col items-center justify-center gap-3 px-5 py-8 text-center', className)}
            {...props}
        >
            {icon && (
                <div data-slot="empty-state-icon" aria-hidden="true" className="shrink-0 text-muted-foreground [&_svg]:size-6">
                    {icon}
                </div>
            )}
            <Title className="max-w-full text-[length:var(--type-subheading)] font-semibold wrap-anywhere">{title}</Title>
            {description && <p className="max-w-lg text-sm leading-relaxed text-muted-foreground wrap-anywhere">{description}</p>}
            {actionLabel && onAction && (
                <Button
                    {...actionProps}
                    type="button"
                    variant={actionVariant}
                    disabled={actionDisabled}
                    onClick={onAction}
                    className={cn('h-auto min-h-10 max-w-full whitespace-normal wrap-anywhere', actionProps?.className)}
                >
                    {actionIcon && (
                        <span aria-hidden="true" className="inline-flex shrink-0">
                            {actionIcon}
                        </span>
                    )}
                    {actionLabel}
                </Button>
            )}
        </div>
    )
}
