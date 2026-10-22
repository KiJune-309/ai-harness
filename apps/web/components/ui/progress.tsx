'use client'

import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { cn } from 'cn'

/**
 * Renders the Progress primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function Progress({ className, children, value, ...props }: ProgressPrimitive.Root.Props) {
    return (
        <ProgressPrimitive.Root value={value} data-slot="progress" className={cn('flex flex-wrap gap-3', className)} {...props}>
            {children}
            <ProgressTrack>
                <ProgressIndicator />
            </ProgressTrack>
        </ProgressPrimitive.Root>
    )
}

/**
 * Renders the ProgressTrack primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
    return (
        <ProgressPrimitive.Track
            className={cn('relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted', className)}
            data-slot="progress-track"
            {...props}
        />
    )
}

/**
 * Renders the ProgressIndicator primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props) {
    return (
        <ProgressPrimitive.Indicator
            data-slot="progress-indicator"
            className={cn('h-full bg-primary transition-[width,transform] duration-180 ease-out motion-reduce:transition-none', className)}
            {...props}
        />
    )
}

/**
 * Renders the ProgressLabel primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
    return <ProgressPrimitive.Label className={cn('text-sm font-medium', className)} data-slot="progress-label" {...props} />
}

/**
 * Renders the ProgressValue primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
    return (
        <ProgressPrimitive.Value
            className={cn('ml-auto text-sm text-muted-foreground tabular-nums', className)}
            data-slot="progress-value"
            {...props}
        />
    )
}

export { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue }
