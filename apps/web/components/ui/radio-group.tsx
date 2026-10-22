'use client'

import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { cn } from 'cn'

/**
 * Groups mutually exclusive options with consistent vertical spacing.
 * @param props - Selection state, option controls, and supported group attributes.
 * @returns The radio group with its primitive keyboard behavior preserved.
 */
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
    return <RadioGroupPrimitive data-slot="radio-group" className={cn('grid w-full gap-2', className)} {...props} />
}

/**
 * Renders a radio option with a clear selected indicator and visible keyboard focus.
 * @param props - Option value, visual overrides, and supported radio attributes.
 * @returns The radio control with its primitive selection behavior preserved.
 */
function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
    return (
        <RadioPrimitive.Root
            data-slot="radio-group-item"
            className={cn(
                'group/radio-group-item peer relative flex aspect-square size-[18px] shrink-0 rounded-full border border-input transition-colors duration-(--motion-fast) outline-none motion-reduce:transition-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary',
                className
            )}
            {...props}
        >
            <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="flex size-full items-center justify-center">
                <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
            </RadioPrimitive.Indicator>
        </RadioPrimitive.Root>
    )
}

export { RadioGroup, RadioGroupItem }
