'use client'

import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { cn } from 'cn'

/**
 * Renders the official shadcn Separator component with its default presentation.
 * @param props - Official component properties and supported DOM attributes.
 * @returns The component rendered with the official default styles and behavior.
 */
function Separator({ className, orientation = 'horizontal', ...props }: SeparatorPrimitive.Props) {
    return (
        <SeparatorPrimitive
            data-slot="separator"
            orientation={orientation}
            className={cn(
                'shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
                className
            )}
            {...props}
        />
    )
}

export { Separator }
