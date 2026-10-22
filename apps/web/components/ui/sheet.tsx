'use client'

import { usePrivatePortalContainer, usePrivateOverlayState } from '../private-portal'

import * as React from 'react'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import { cn } from 'cn'

import { Button } from '@/components/ui/button'
import { XIcon } from 'lucide-react'

/**
 * Renders the Sheet primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function Sheet({ open, defaultOpen, onOpenChange, ...props }: SheetPrimitive.Root.Props) {
    const overlay = usePrivateOverlayState({ open, defaultOpen, onOpenChange })
    return <SheetPrimitive.Root data-slot="sheet" {...props} {...overlay} />
}

/**
 * Renders the SheetTrigger primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

/**
 * Renders the SheetClose primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

/**
 * Renders the SheetPortal primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
    const privateContainer = usePrivatePortalContainer()
    if (privateContainer === null) return null

    return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} container={privateContainer} />
}

/**
 * Renders the SheetOverlay primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
    return (
        <SheetPrimitive.Backdrop
            data-slot="sheet-overlay"
            className={cn(
                'fixed inset-0 z-50 bg-black/25 transition-opacity duration-(--motion-normal) data-ending-style:opacity-0 data-starting-style:opacity-0',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders the SheetContent primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetContent({
    className,
    children,
    side = 'right',
    showCloseButton = true,
    ...props
}: SheetPrimitive.Popup.Props & {
    side?: 'top' | 'right' | 'bottom' | 'left'
    showCloseButton?: boolean
}) {
    return (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Popup
                data-slot="sheet-content"
                data-side={side}
                className={cn(
                    'fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-(--shadow-overlay) transition-[opacity,translate] duration-(--motion-normal) ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[1rem] data-[side=bottom]:data-starting-style:translate-y-[1rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-1rem] data-[side=left]:data-starting-style:translate-x-[-1rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[1rem] data-[side=right]:data-starting-style:translate-x-[1rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-1rem] data-[side=top]:data-starting-style:translate-y-[-1rem] data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm',
                    className
                )}
                {...props}
            >
                {children}
                {showCloseButton && (
                    <SheetPrimitive.Close
                        data-slot="sheet-close"
                        render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
                    >
                        <XIcon />
                        <span className="sr-only">Close</span>
                    </SheetPrimitive.Close>
                )}
            </SheetPrimitive.Popup>
        </SheetPortal>
    )
}

/**
 * Renders the SheetHeader primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return <div data-slot="sheet-header" className={cn('flex flex-col gap-0.5 p-4', className)} {...props} />
}

/**
 * Renders the SheetFooter primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
    return <div data-slot="sheet-footer" className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />
}

/**
 * Renders the SheetTitle primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
    return (
        <SheetPrimitive.Title
            data-slot="sheet-title"
            className={cn('font-heading text-base font-medium text-foreground', className)}
            {...props}
        />
    )
}

/**
 * Renders the SheetDescription primitive with the shared minimal presentation.
 * @param props - Primitive properties, content and supported DOM attributes.
 * @returns The shared component with its accessible primitive behavior preserved.
 */
function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
    return (
        <SheetPrimitive.Description data-slot="sheet-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
    )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
