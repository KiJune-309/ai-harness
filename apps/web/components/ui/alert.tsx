import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

const alertVariants = cva(
    "group/alert relative grid w-full gap-1 rounded-lg border border-transparent p-4 text-left text-sm has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_minmax(0,1fr)] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
    {
        variants: {
            variant: {
                default: 'border-info-foreground/15 bg-info text-info-foreground *:data-[slot=alert-description]:text-current',
                info: 'border-info-foreground/15 bg-info text-info-foreground *:data-[slot=alert-description]:text-current',
                success: 'border-success-foreground/15 bg-success text-success-foreground *:data-[slot=alert-description]:text-current',
                warning: 'border-warning-foreground/15 bg-warning text-warning-foreground *:data-[slot=alert-description]:text-current',
                destructive: 'border-destructive/15 bg-error text-error-foreground *:data-[slot=alert-description]:text-current',
            },
        },
        defaultVariants: {
            variant: 'default',
        },
    }
)

/**
 * Renders a readable status message using a shared semantic color surface.
 * @param props - Alert variant, content, visual overrides, and supported div attributes.
 * @returns The styled alert with an announcement role.
 */
function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
    return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

/**
 * Renders the primary message within an alert.
 * @param props - Title content, visual overrides, and supported div attributes.
 * @returns The alert title aligned with its optional icon.
 */
function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-title"
            className={cn(
                'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders supporting alert text and inline links.
 * @param props - Description content, visual overrides, and supported div attributes.
 * @returns Muted descriptive content with readable line spacing.
 */
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-description"
            className={cn(
                'text-sm leading-relaxed text-pretty text-muted-foreground [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-3',
                className
            )}
            {...props}
        />
    )
}

/**
 * Positions a compact contextual action within an alert.
 * @param props - Action content, visual overrides, and supported div attributes.
 * @returns The action container inset from the alert edge.
 */
function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
    return <div data-slot="alert-action" className={cn('absolute top-3 right-3', className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
