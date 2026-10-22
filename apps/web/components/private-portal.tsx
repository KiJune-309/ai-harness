'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

const PrivatePortalContext = createContext<{ container: HTMLElement | null; paused: boolean } | undefined>(undefined)

/**
 * Keeps authenticated overlays inside the same suspended and removable account boundary as their triggers.
 * @param props - Account-owned container, suspension state, and private descendants.
 * @returns Descendants with a shared safe overlay target.
 */
export function PrivatePortalProvider({
    container,
    paused = false,
    children,
}: {
    container: HTMLElement | null
    paused?: boolean
    children: ReactNode
}) {
    return <PrivatePortalContext.Provider value={{ container, paused }}>{children}</PrivatePortalContext.Provider>
}

/**
 * Resolves the authenticated overlay target while preserving normal portals for public components.
 * @returns The private container, null while its host mounts, or undefined for public default portals.
 */
export function usePrivatePortalContainer(): HTMLElement | null | undefined {
    const boundary = useContext(PrivatePortalContext)
    return boundary?.paused ? null : boundary?.container
}

/**
 * Suspends a private overlay at its primitive root so recovery reopens it with normal focus and scroll management.
 * @param props - Original controlled or uncontrolled open state and unchanged primitive event callback.
 * @returns Controlled primitive state that retains the caller's requested open state across account verification.
 */
export function usePrivateOverlayState<Details>({
    open,
    defaultOpen = false,
    onOpenChange,
}: {
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean, details: Details) => void
}): { open: boolean; onOpenChange: (open: boolean, details: Details) => void } {
    const [localOpen, setLocalOpen] = useState(defaultOpen)
    const container = usePrivatePortalContainer()
    /**
     * Preserves the primitive's original interaction details while retaining uncontrolled state.
     * @param nextOpen - Open state requested by the original primitive interaction.
     * @param details - Unmodified primitive details, including cancellation and event metadata.
     * @returns Nothing after updating state and forwarding the caller's callback.
     */
    const changeOpen = useCallback(
        (nextOpen: boolean, details: Details) => {
            onOpenChange?.(nextOpen, details)
            if (details && typeof details === 'object' && 'isCanceled' in details && details.isCanceled) return
            setLocalOpen(nextOpen)
        },
        [onOpenChange]
    )
    return { open: container !== null && (open ?? localOpen), onOpenChange: changeOpen }
}
