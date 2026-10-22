'use client'

import { usePrivatePortalContainer, usePrivateOverlayState } from '../private-portal'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from 'cn'

/**
 * Renders the TooltipProvider primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
    return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

/**
 * Renders the Tooltip primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function Tooltip({ open, defaultOpen, onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
    const overlay = usePrivateOverlayState({ open, defaultOpen, onOpenChange })
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} {...overlay} />
}

/**
 * Renders the TooltipTrigger primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/**
 * Renders the TooltipContent primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function TooltipContent({
    className,
    side = 'top',
    sideOffset = 4,
    align = 'center',
    alignOffset = 0,
    children,
    ...props
}: TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
    const privateContainer = usePrivatePortalContainer()
    if (privateContainer === null) return null

    return (
        <TooltipPrimitive.Portal container={privateContainer}>
            <TooltipPrimitive.Positioner
                align={align}
                alignOffset={alignOffset}
                side={side}
                sideOffset={sideOffset}
                className="isolate z-50"
            >
                <TooltipPrimitive.Popup
                    data-slot="tooltip-content"
                    className={cn(
                        'z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-lg bg-foreground shadow-(--shadow-overlay) px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
                        className
                    )}
                    {...props}
                >
                    {children}
                    <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
                </TooltipPrimitive.Popup>
            </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
    )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
