import * as React from 'react'
import { cn } from 'cn'

/**
 * Renders a multiline field with comfortable padding and visible focus feedback.
 * @param props - Visual overrides and supported textarea attributes.
 * @returns The styled textarea with its native editing behavior preserved.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
    return (
        <textarea
            data-slot="textarea"
            className={cn(
                'flex field-sizing-content min-h-20 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2.5 text-base leading-relaxed text-foreground transition-colors duration-(--motion-fast) outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm motion-reduce:transition-none dark:bg-input/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
                className
            )}
            {...props}
        />
    )
}

export { Textarea }
