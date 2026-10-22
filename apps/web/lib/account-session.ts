const sessionEpochKey = 'ai-harness.account-session-epoch'
const sessionChannelName = 'ai-harness.account-session'
const workspaceEpochKey = 'ai-harness.workspace-epoch'
const workspaceChannelName = 'ai-harness.workspace'
const epochPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let lastPublishedEpoch: string | null = null
let lastPublishedWorkspaceEpoch: string | null = null

/**
 * Announces a confirmed identity change to other tabs without sending account data or credentials.
 * @returns Nothing; publishes only an opaque random epoch through available browser transports.
 */
export function notifyAccountChange(): void {
    if (typeof window === 'undefined') return
    const epoch = crypto.randomUUID()
    lastPublishedEpoch = epoch
    try {
        window.localStorage.setItem(sessionEpochKey, epoch)
    } catch {
        // BroadcastChannel remains usable when browser storage is disabled.
    }
    try {
        if (typeof window.BroadcastChannel !== 'function') return
        const channel = new window.BroadcastChannel(sessionChannelName)
        channel.postMessage(epoch)
        channel.close()
    } catch {
        // Storage events and foreground session checks remain available.
    }
}

/**
 * Watches identity changes from other tabs while ignoring this tab's own announcement.
 * @param onChange - Clears mounted private state after a different tab changes identity.
 * @returns Cleanup that closes the channel and removes the storage listener.
 */
export function subscribeAccountChanges(onChange: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined
    let lastReceivedEpoch: string | null = null
    /**
     * Validates a secret-free epoch and delivers each remote change only once.
     * @param value - Untrusted storage or channel payload.
     * @returns Nothing; invokes the subscriber for a new remote epoch.
     */
    function receive(value: unknown) {
        if (typeof value !== 'string' || !epochPattern.test(value) || value === lastPublishedEpoch || value === lastReceivedEpoch) return
        lastReceivedEpoch = value
        onChange()
    }
    /**
     * Filters browser storage events to the account epoch key.
     * @param event - Cross-document storage mutation.
     * @returns Nothing; delivers only a valid account epoch.
     */
    function storageChanged(event: StorageEvent) {
        if (event.key === sessionEpochKey) receive(event.newValue)
    }
    window.addEventListener('storage', storageChanged)
    let channel: BroadcastChannel | null = null
    try {
        if (typeof window.BroadcastChannel === 'function') {
            channel = new window.BroadcastChannel(sessionChannelName)
            channel.onmessage = event => receive(event.data)
        }
    } catch {
        // Foreground verification is retained if both browser transports are unavailable.
    }
    return () => {
        window.removeEventListener('storage', storageChanged)
        channel?.close()
    }
}

/**
 * Announces an explicitly confirmed workspace change without exposing any account data.
 * @returns Nothing; other tabs clear their private state before reverifying.
 */
export function notifyWorkspaceChange(): void {
    if (typeof window === 'undefined') return
    const epoch = crypto.randomUUID()
    lastPublishedWorkspaceEpoch = epoch
    try {
        window.localStorage.setItem(workspaceEpochKey, epoch)
    } catch {
        // BroadcastChannel remains usable when browser storage is disabled.
    }
    try {
        if (typeof window.BroadcastChannel === 'function') {
            const channel = new window.BroadcastChannel(workspaceChannelName)
            channel.postMessage(epoch)
            channel.close()
        }
    } catch {
        // Foreground verification and request context checks remain available.
    }
    window.dispatchEvent(new Event('harness:workspace-changed'))
}

/**
 * Observes workspace changes from this document and other tabs.
 * @param onChange - Clears private state and verifies the persisted active workspace.
 * @returns Cleanup for browser listeners.
 */
export function subscribeWorkspaceChanges(onChange: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined
    let lastReceivedEpoch: string | null = null
    /**
     * Deduplicates validated workspace events arriving over both browser transports.
     * @param value - Untrusted epoch without account data.
     * @returns Nothing after one subscriber notification per remote change.
     */
    function receive(value: unknown): void {
        if (typeof value !== 'string' || !epochPattern.test(value) || value === lastPublishedWorkspaceEpoch || value === lastReceivedEpoch)
            return
        lastReceivedEpoch = value
        onChange()
    }
    /**
     * Delivers only valid workspace epoch announcements from another document.
     * @param event - Browser storage change event.
     * @returns Nothing after notifying the subscriber.
     */
    function changed(event: StorageEvent): void {
        if (event.key === workspaceEpochKey) receive(event.newValue)
    }
    let channel: BroadcastChannel | null = null
    try {
        if (typeof window.BroadcastChannel === 'function') {
            channel = new window.BroadcastChannel(workspaceChannelName)
            channel.onmessage = event => receive(event.data)
        }
    } catch {
        // Storage events, foreground verification, and context checks remain available.
    }
    window.addEventListener('storage', changed)
    window.addEventListener('harness:workspace-changed', onChange)
    return () => {
        window.removeEventListener('storage', changed)
        window.removeEventListener('harness:workspace-changed', onChange)
        channel?.close()
    }
}
