'use client'

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'

/**
 * Renders the official shadcn Collapsible component with its default presentation.
 * @param props - Official component properties and supported DOM attributes.
 * @returns The component rendered with the official default styles and behavior.
 */
function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
    return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

/**
 * Renders the official shadcn CollapsibleTrigger component with its default presentation.
 * @param props - Official component properties and supported DOM attributes.
 * @returns The component rendered with the official default styles and behavior.
 */
function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
    return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
}

/**
 * Renders the official shadcn CollapsibleContent component with its default presentation.
 * @param props - Official component properties and supported DOM attributes.
 * @returns The component rendered with the official default styles and behavior.
 */
function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
    return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
