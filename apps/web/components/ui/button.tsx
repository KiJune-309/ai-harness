import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

const buttonVariants = cva(
    "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-(--motion-fast) ease-out outline-none active:translate-y-px disabled:transform-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 pointer-coarse:min-h-11 pointer-coarse:min-w-11 motion-reduce:transition-none dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    {
        variants: {
            variant: {
                default: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95',
                outline:
                    'border-border bg-background text-foreground hover:bg-muted/70 aria-expanded:bg-muted dark:border-input dark:bg-input/20 dark:hover:bg-input/40',
                secondary:
                    'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary',
                ghost: 'text-muted-foreground hover:bg-muted/70 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
                destructive:
                    'bg-error text-error-foreground hover:bg-destructive/15 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:hover:bg-destructive/20 dark:focus-visible:ring-destructive/40',
                link: 'text-primary underline-offset-4 hover:underline',
            },
            size: {
                default: 'h-(--control-height) gap-2 px-3.5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5',
                xs: "h-(--control-height-sm) gap-1 rounded-[6px] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
                sm: "h-(--control-height-sm) gap-1.5 rounded-[6px] px-3 text-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
                lg: 'h-(--control-height-lg) gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4',
                icon: 'size-(--control-height)',
                'icon-xs':
                    "size-(--control-height-sm) rounded-[6px] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
                'icon-sm': 'size-(--control-height-sm) rounded-[6px] in-data-[slot=button-group]:rounded-lg',
                'icon-lg': 'size-(--control-height-lg)',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    }
)

/**
 * Renders an accessible button with the application action hierarchy and sizing.
 * @param props - Button behavior, visual variant, size, and supported DOM attributes.
 * @returns The styled button with the primitive interaction behavior preserved.
 */
function Button({
    className,
    variant = 'default',
    size = 'default',
    ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
    return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
