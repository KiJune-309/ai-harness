'use client'

import type { ComponentProps, ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { cn } from 'cn'
import { Alert, AlertAction, AlertDescription } from './alert'
import { Button } from './button'

export type FeedbackVariant = 'success' | 'info' | 'warning' | 'error' | 'loading'

type FeedbackMessageProps = ComponentProps<'div'> & {
    variant?: FeedbackVariant
    action?: ReactNode
}

const feedbackIcons = {
    success: CircleCheck,
    info: Info,
    warning: TriangleAlert,
    error: CircleAlert,
    loading: LoaderCircle,
}

/**
 * Presents a concrete message without a redundant status heading.
 * @param props - Semantic state, message content, optional action, and supported container attributes.
 * @returns An accessible shared feedback surface with a semantic icon and color.
 */
export function FeedbackMessage({ variant = 'info', children, action, className, role, ...props }: FeedbackMessageProps) {
    const Icon = feedbackIcons[variant]
    return (
        <Alert
            data-feedback={variant}
            variant={variant === 'error' ? 'destructive' : variant === 'loading' ? 'info' : variant}
            role={role ?? (variant === 'error' ? 'alert' : 'status')}
            aria-atomic="true"
            className={cn('gap-y-0 [overflow-wrap:anywhere] [&>svg]:row-span-1', className)}
            {...props}
        >
            <Icon aria-hidden="true" className={variant === 'loading' ? 'motion-safe:animate-spin' : undefined} />
            <AlertDescription>{children}</AlertDescription>
            {action && <AlertAction>{action}</AlertAction>}
        </Alert>
    )
}

type FeedbackToastProps = Omit<FeedbackMessageProps, 'action'> & {
    onDismiss: () => void
    dismissLabel?: string
}

/**
 * Shows dismissible operation feedback above the mobile navigation.
 * @param props - Concrete message, semantic state, dismiss callback, and supported feedback attributes.
 * @returns A shared floating feedback message; timing remains controlled by its caller.
 */
export function FeedbackToast({ variant = 'success', onDismiss, dismissLabel = '关闭提示', className, ...props }: FeedbackToastProps) {
    return (
        <FeedbackMessage
            variant={variant}
            className={cn(
                'fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 min-h-16 w-auto max-w-[min(24rem,calc(100vw-2rem))] content-center shadow-(--shadow-overlay) motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-(--motion-normal) md:bottom-4',
                className
            )}
            action={
                <Button variant="ghost" size="icon-sm" aria-label={dismissLabel} onClick={onDismiss}>
                    <X aria-hidden="true" />
                </Button>
            }
            {...props}
        />
    )
}
