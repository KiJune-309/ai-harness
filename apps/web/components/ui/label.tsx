'use client'

import * as React from 'react'
import { cn } from 'cn'

/**
 * Renders the official shadcn Label component with its default presentation.
 * @param props - Official component properties and supported DOM attributes.
 * @returns The component rendered with the official default styles and behavior.
 */
function Label({ className, ...props }: React.ComponentProps<'label'>) {
    return (
        <label
            data-slot="label"
            className={cn(
                'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                className
            )}
            {...props}
        />
    )
}

export { Label }
