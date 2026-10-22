'use client'

import { usePrivatePortalContainer, usePrivateOverlayState } from '../private-portal'

import * as React from 'react'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { cn } from 'cn'

import { Button } from '@/components/ui/button'

/**
 * Groups an accessible confirmation dialog with private overlay state.
 * @param props - Dialog state, change handler, content, and supported root attributes.
 * @returns The alert dialog root connected to the private overlay lifecycle.
 */
function AlertDialog({ open, defaultOpen, onOpenChange, ...props }: AlertDialogPrimitive.Root.Props) {
    const overlay = usePrivateOverlayState({ open, defaultOpen, onOpenChange })
    return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} {...overlay} />
}

/**
 * Renders the control that opens a confirmation dialog.
 * @param props - Trigger content and supported primitive attributes.
 * @returns The alert dialog trigger with its primitive behavior preserved.
 */
function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
    return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

/**
 * Mounts confirmation content inside the authorized private portal container.
 * @param props - Portal content and supported primitive attributes.
 * @returns The private portal, or nothing while its container is unavailable.
 */
function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
    const privateContainer = usePrivatePortalContainer()
    if (privateContainer === null) return null

    return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} container={privateContainer} />
}

/**
 * Renders a dimmed backdrop behind a confirmation dialog.
 * @param props - Visual overrides and supported backdrop attributes.
 * @returns The softly animated confirmation backdrop.
 */
function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
    return (
        <AlertDialogPrimitive.Backdrop
            data-slot="alert-dialog-overlay"
            className={cn(
                'fixed inset-0 isolate z-50 bg-black/25 duration-(--motion-normal) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders a responsive confirmation surface with comfortable content spacing.
 * @param props - Dialog size, content, visual overrides, and supported popup attributes.
 * @returns The confirmation surface within its private portal and backdrop.
 */
function AlertDialogContent({
    className,
    size = 'default',
    ...props
}: AlertDialogPrimitive.Popup.Props & {
    size?: 'default' | 'sm'
}) {
    return (
        <AlertDialogPortal>
            <AlertDialogOverlay />
            <AlertDialogPrimitive.Popup
                data-slot="alert-dialog-content"
                data-size={size}
                className={cn(
                    'group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100vw_-_2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-[12px] bg-popover p-6 text-popover-foreground shadow-(--shadow-overlay) ring-1 ring-border duration-(--motion-normal) outline-none data-[size=sm]:max-w-[min(20rem,calc(100vw_-_2rem))] data-[size=default]:sm:max-w-md data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
                    className
                )}
                {...props}
            />
        </AlertDialogPortal>
    )
}

/**
 * Groups confirmation media, heading, and supporting copy.
 * @param props - Header content, visual overrides, and supported div attributes.
 * @returns The responsive header grid for the selected dialog size.
 */
function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-dialog-header"
            className={cn(
                'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]',
                className
            )}
            {...props}
        />
    )
}

/**
 * Groups confirmation and cancellation controls on the same surface as the dialog content.
 * @param props - Footer controls, visual overrides, and supported div attributes.
 * @returns The responsive action group aligned to the content inset.
 */
function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-dialog-footer"
            className={cn(
                'flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders a compact visual cue beside the confirmation message.
 * @param props - Media content, visual overrides, and supported div attributes.
 * @returns The muted media container with responsive header placement.
 */
function AlertDialogMedia({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-dialog-media"
            className={cn(
                "mb-2 inline-flex size-10 items-center justify-center rounded-[6px] bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders the accessible heading for a confirmation dialog.
 * @param props - Title content, visual overrides, and supported title attributes.
 * @returns The semibold heading aligned to the optional media.
 */
function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
    return (
        <AlertDialogPrimitive.Title
            data-slot="alert-dialog-title"
            className={cn(
                'font-heading text-base leading-[1.4] font-semibold sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders supporting copy associated with the confirmation message.
 * @param props - Description content, visual overrides, and supported description attributes.
 * @returns Muted text with readable line spacing and visible links.
 */
function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
    return (
        <AlertDialogPrimitive.Description
            data-slot="alert-dialog-description"
            className={cn(
                'text-sm leading-[1.7] text-pretty text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders the confirmation action using the shared button hierarchy.
 * @param props - Action content, visual variant, and supported button attributes.
 * @returns The styled action button without adding submission permissions.
 */
function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof Button>) {
    return <Button data-slot="alert-dialog-action" className={cn(className)} {...props} />
}

/**
 * Renders the cancellation control using a secondary button treatment.
 * @param props - Cancel content, visual variant, size, and supported close attributes.
 * @returns The close control with the primitive focus and cancellation behavior preserved.
 */
function AlertDialogCancel({
    className,
    variant = 'outline',
    size = 'default',
    ...props
}: AlertDialogPrimitive.Close.Props & Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
    return (
        <AlertDialogPrimitive.Close
            data-slot="alert-dialog-cancel"
            className={cn(className)}
            render={<Button variant={variant} size={size} />}
            {...props}
        />
    )
}

export {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogOverlay,
    AlertDialogPortal,
    AlertDialogTitle,
    AlertDialogTrigger,
}
