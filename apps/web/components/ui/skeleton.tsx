import { cn } from 'cn'

/**
 * Marks content that is still loading with a quiet, shared placeholder.
 * @param props - Visual overrides and supported placeholder attributes.
 * @returns A loading placeholder that respects reduced motion preferences.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div data-slot="skeleton" className={cn('animate-pulse rounded-[6px] bg-muted motion-reduce:animate-none', className)} {...props} />
    )
}

export { Skeleton }
