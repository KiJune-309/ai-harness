import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

const badgeVariants = cva(
    'group/badge inline-flex min-h-6 w-fit min-w-0 max-w-full items-center justify-center gap-1 rounded-[4px] border border-transparent px-2 py-0.5 text-xs leading-4 font-medium whitespace-normal transition-colors duration-(--motion-fast) [overflow-wrap:anywhere] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 motion-reduce:transition-none dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3! [&>svg]:shrink-0',
    {
        variants: {
            variant: {
                default: 'bg-secondary text-secondary-foreground [a]:hover:bg-accent',
                secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
                success: 'bg-success text-success-foreground [a]:hover:bg-success/80',
                info: 'bg-info text-info-foreground [a]:hover:bg-info/80',
                warning: 'bg-warning text-warning-foreground [a]:hover:bg-warning/80',
                destructive:
                    'bg-error text-error-foreground focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-error/80',
                outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
                ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
                link: 'text-primary underline-offset-4 hover:underline',
            },
        },
        defaultVariants: {
            variant: 'default',
        },
    }
)

/**
 * Renders a compact, wrapping label with low-emphasis semantic colors.
 * @param props - Badge content, visual variant, render override, and supported attributes.
 * @returns The styled label with its requested element and behavior preserved.
 */
function Badge({
    className,
    variant = 'default',
    render,
    ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
    return useRender({
        defaultTagName: 'span',
        props: mergeProps<'span'>(
            {
                className: cn(badgeVariants({ variant }), className),
            },
            props
        ),
        render,
        state: {
            slot: 'badge',
            variant,
        },
    })
}

export { Badge, badgeVariants }
