import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768

/**
 * Subscribes to the official Sidebar breakpoint without synchronously updating state in an effect.
 * @param onChange - Callback invoked when the viewport crosses the breakpoint.
 * @returns Cleanup for the viewport listener.
 */
function subscribeMobileViewport(onChange: () => void): () => void {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
}

/**
 * Reads the current client viewport for the official Sidebar layout.
 * @returns Whether the viewport is below the shared mobile breakpoint.
 */
function getMobileViewport(): boolean {
    return window.innerWidth < MOBILE_BREAKPOINT
}

/**
 * Supplies a stable Sidebar snapshot while rendering outside the browser.
 * @returns False until a client viewport is available.
 */
function getServerMobileViewport(): boolean {
    return false
}

/**
 * Tracks the official Sidebar mobile breakpoint using an external viewport subscription.
 * @returns Whether the current viewport uses the mobile Sidebar Sheet.
 */
export function useIsMobile(): boolean {
    return useSyncExternalStore(subscribeMobileViewport, getMobileViewport, getServerMobileViewport)
}
