'use client'

import { usePrivatePortalContainer, usePrivateOverlayState } from '../private-portal'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from 'cn'

import { Button } from '@/components/ui/button'
import { XIcon } from 'lucide-react'

/**
 * Groups an accessible dialog while preserving private overlay state.
 * @param props - Dialog state, change handler, content, and supported root attributes.
 * @returns The dialog root connected to the private overlay lifecycle.
 */
function Dialog({ open, defaultOpen, onOpenChange, ...props }: DialogPrimitive.Root.Props) {
    const overlay = usePrivateOverlayState({ open, defaultOpen, onOpenChange })
    return <DialogPrimitive.Root data-slot="dialog" {...props} {...overlay} />
}

/**
 * Renders the control that opens a dialog.
 * @param props - Trigger content and supported primitive attributes.
 * @returns The dialog trigger with its primitive interaction behavior preserved.
 */
function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

/**
 * Mounts dialog content inside the authorized private portal container.
 * @param props - Portal content and supported primitive attributes.
 * @returns The private dialog portal, or nothing while its container is unavailable.
 */
function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
    const privateContainer = usePrivatePortalContainer()
    if (privateContainer === null) return null

    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} container={privateContainer} />
}

/**
 * Renders a control that closes the current dialog.
 * @param props - Close control content and supported primitive attributes.
 * @returns The dialog close control with its primitive behavior preserved.
 */
function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/**
 * Renders a dimmed backdrop that separates the dialog from the current page.
 * @param props - Visual overrides and supported backdrop attributes.
 * @returns The softly animated dialog backdrop.
 */
function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
    return (
        <DialogPrimitive.Backdrop
            data-slot="dialog-overlay"
            className={cn(
                'fixed inset-0 isolate z-50 bg-black/25 duration-(--motion-normal) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders the dialog surface with comfortable spacing and a responsive width.
 * @param props - Popup content, close button visibility, visual overrides, and supported popup attributes.
 * @returns The dialog surface within its private portal and backdrop.
 */
function DialogContent({
    className,
    children,
    showCloseButton = true,
    ...props
}: DialogPrimitive.Popup.Props & {
    showCloseButton?: boolean
}) {
    return (
        <DialogPortal>
            <DialogOverlay />
            <DialogPrimitive.Popup
                data-slot="dialog-content"
                className={cn(
                    'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100vw_-_2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-[12px] bg-popover p-6 text-sm text-popover-foreground shadow-(--shadow-overlay) ring-1 ring-border duration-(--motion-normal) outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
                    className
                )}
                {...props}
            >
                {children}
                {showCloseButton && (
                    <DialogPrimitive.Close
                        data-slot="dialog-close"
                        render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
                    >
                        <XIcon />
                        <span className="sr-only">关闭对话框</span>
                    </DialogPrimitive.Close>
                )}
            </DialogPrimitive.Popup>
        </DialogPortal>
    )
}

/**
 * Groups a dialog heading and its supporting copy.
 * @param props - Header content, visual overrides, and supported div attributes.
 * @returns The vertically spaced dialog header.
 */
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
}

/**
 * Groups dialog actions on the same surface as the dialog content.
 * @param props - Footer actions, optional close control, visual overrides, and supported div attributes.
 * @returns The responsive footer aligned to the dialog content inset.
 */
function DialogFooter({
    className,
    showCloseButton = false,
    children,
    ...props
}: React.ComponentProps<'div'> & {
    showCloseButton?: boolean
}) {
    return (
        <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props}>
            {children}
            {showCloseButton && <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>}
        </div>
    )
}

/**
 * Renders the accessible dialog heading with a clear visual hierarchy.
 * @param props - Title content, visual overrides, and supported title attributes.
 * @returns The semibold dialog heading with comfortable line spacing.
 */
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
    return (
        <DialogPrimitive.Title
            data-slot="dialog-title"
            className={cn('font-heading text-base leading-[1.4] font-semibold', className)}
            {...props}
        />
    )
}

/**
 * Renders supporting copy associated with the dialog.
 * @param props - Description content, visual overrides, and supported description attributes.
 * @returns Muted descriptive text with readable line spacing and visible links.
 */
function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
    return (
        <DialogPrimitive.Description
            data-slot="dialog-description"
            className={cn(
                'text-sm leading-[1.7] text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
                className
            )}
            {...props}
        />
    )
}

export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogTrigger,
}
