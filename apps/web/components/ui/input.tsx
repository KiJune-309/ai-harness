import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from 'cn'

/**
 * Renders a single-line input with consistent spacing and visible focus feedback.
 * @param props - Input type, visual overrides, and supported input attributes.
 * @returns The styled input with its native form behavior preserved.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
    return (
        <InputPrimitive
            type={type}
            data-slot="input"
            className={cn(
                'h-(--control-height) w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground transition-colors duration-(--motion-fast) outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm pointer-coarse:min-h-11 motion-reduce:transition-none dark:bg-input/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
                className
            )}
            {...props}
        />
    )
}

export { Input }
