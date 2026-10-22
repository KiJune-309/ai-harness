import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyAccountChange, notifyWorkspaceChange, subscribeAccountChanges, subscribeWorkspaceChanges } from '../../lib/account-session'

const epoch = 'ae537ba3-de31-4185-b8c3-e70fd9b9c8ed'

class TestChannel {
    static instances: TestChannel[] = []
    closed = false
    onmessage: ((event: { data: unknown }) => void) | null = null

    /**
     * Creates a controlled same-origin channel endpoint for transport tests.
     * @param name - Channel name used by the subscription.
     */
    constructor(readonly name: string) {
        TestChannel.instances.push(this)
    }

    /**
     * Delivers a transport payload to open peer endpoints.
     * @param value - Simulated channel payload.
     * @returns Nothing; synchronously delivers the controlled message.
     */
    postMessage(value: unknown) {
        for (const peer of TestChannel.instances)
            if (peer !== this && !peer.closed && peer.name === this.name) peer.onmessage?.({ data: value })
    }

    /**
     * Releases this endpoint without removing other subscribers.
     * @returns Nothing; marks this endpoint as closed.
     */
    close() {
        this.closed = true
    }
}

let events: EventTarget
const setItem = vi.fn()

/**
 * Emits a browser-compatible storage event without requiring a DOM dependency.
 * @param key - Changed browser storage key.
 * @param newValue - Opaque stored payload.
 * @returns Nothing; dispatches to the test window.
 */
function storage(key: string, newValue: unknown) {
    events.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }))
}

beforeEach(() => {
    events = new EventTarget()
    setItem.mockReset()
    TestChannel.instances = []
    vi.stubGlobal('window', {
        localStorage: { setItem },
        BroadcastChannel: TestChannel,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
    })
})

describe('cross-tab workspace notifications', () => {
    it('announces only an opaque workspace epoch and notifies the current document', () => {
        const changed = vi.fn()
        const unsubscribe = subscribeWorkspaceChanges(changed)
        notifyWorkspaceChange()
        expect(changed).toHaveBeenCalledOnce()
        expect(setItem.mock.calls[0]?.[0]).toBe('ai-harness.workspace-epoch')
        expect(setItem.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/)
        expect(TestChannel.instances.some(channel => channel.name === 'ai-harness.workspace')).toBe(true)
        unsubscribe()
        notifyWorkspaceChange()
        expect(changed).toHaveBeenCalledOnce()
    })

    it('deduplicates a remote change across storage and channel and closes the listener', () => {
        const changed = vi.fn()
        const unsubscribe = subscribeWorkspaceChanges(changed)
        const peer = new TestChannel('ai-harness.workspace')
        peer.postMessage(epoch)
        storage('ai-harness.workspace-epoch', epoch)
        storage('ai-harness.workspace-epoch', 'not-a-workspace-epoch')
        expect(changed).toHaveBeenCalledOnce()
        unsubscribe()
        peer.postMessage('b86eed44-1937-48a6-9be5-e1c474783ca8')
        expect(changed).toHaveBeenCalledOnce()
    })
})
afterEach(() => vi.unstubAllGlobals())

describe('cross-tab account session notifications', () => {
    it('publishes only a fresh random epoch and closes its temporary channel', () => {
        notifyAccountChange()
        notifyAccountChange()
        expect(setItem).toHaveBeenCalledTimes(2)
        const first = setItem.mock.calls[0]
        const second = setItem.mock.calls[1]
        expect(first?.[0]).toBe('ai-harness.account-session-epoch')
        expect(first?.[1]).toMatch(/^[0-9a-f-]{36}$/)
        expect(second?.[1]).not.toBe(first?.[1])
        expect(TestChannel.instances.every(channel => channel.closed)).toBe(true)
    })

    it('accepts a remote change once across both transports and rejects other payloads', () => {
        const changed = vi.fn()
        const unsubscribe = subscribeAccountChanges(changed)
        const peer = new TestChannel('ai-harness.account-session')
        peer.postMessage({ user: 'must-not-be-used' })
        storage('unrelated-setting', epoch)
        storage('ai-harness.account-session-epoch', 'bad-epoch')
        expect(changed).not.toHaveBeenCalled()
        peer.postMessage(epoch)
        storage('ai-harness.account-session-epoch', epoch)
        expect(changed).toHaveBeenCalledOnce()
        unsubscribe()
    })

    it('ignores the publishing tab itself and cleans up both transport listeners', () => {
        const changed = vi.fn()
        const unsubscribe = subscribeAccountChanges(changed)
        notifyAccountChange()
        expect(changed).not.toHaveBeenCalled()
        storage('ai-harness.account-session-epoch', epoch)
        expect(changed).toHaveBeenCalledOnce()
        unsubscribe()
        storage('ai-harness.account-session-epoch', '3e06193b-1848-4418-a528-85c73e59651d')
        new TestChannel('ai-harness.account-session').postMessage('c39b24fd-8500-4beb-8b91-5c75912dce73')
        expect(changed).toHaveBeenCalledOnce()
        expect(TestChannel.instances[0]?.closed).toBe(true)
    })

    it('keeps channel delivery usable when browser storage is denied', () => {
        setItem.mockImplementation(() => {
            throw new Error('storage denied')
        })
        expect(() => notifyAccountChange()).not.toThrow()
        const changed = vi.fn()
        const unsubscribe = subscribeAccountChanges(changed)
        new TestChannel('ai-harness.account-session').postMessage(epoch)
        expect(changed).toHaveBeenCalledOnce()
        unsubscribe()
    })
})
