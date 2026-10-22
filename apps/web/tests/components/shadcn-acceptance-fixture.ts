import { vi } from 'vitest'

/**
 * Supplies only browser geometry APIs unavailable in jsdom, leaving real component events and portals intact.
 * @param width - Viewport width used by the application's mobile media hook.
 * @returns Nothing; installs deterministic test-only browser API implementations.
 */
export function installAcceptanceBrowser(width = 1280): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string): MediaQueryList => {
            const events = new EventTarget()
            const maximum = /max-width:\s*(\d+)px/.exec(query)
            const minimum = /min-width:\s*(\d+)px/.exec(query)
            return {
                matches: maximum ? width <= Number(maximum[1]) : minimum ? width >= Number(minimum[1]) : false,
                media: query,
                onchange: null,
                addListener: listener => events.addEventListener('change', listener as EventListener),
                removeListener: listener => events.removeEventListener('change', listener as EventListener),
                addEventListener: events.addEventListener.bind(events),
                removeEventListener: events.removeEventListener.bind(events),
                dispatchEvent: events.dispatchEvent.bind(events),
            }
        },
    })
    vi.stubGlobal(
        'ResizeObserver',
        class AcceptanceResizeObserver {
            /**
             * Accepts observation without inventing layout measurements.
             * @returns Nothing.
             */
            observe(): void {}
            /**
             * Releases a no-op observation.
             * @returns Nothing.
             */
            unobserve(): void {}
            /**
             * Disposes of the test observer.
             * @returns Nothing.
             */
            disconnect(): void {}
        }
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
}

/**
 * Creates a controllable response for a real asynchronous UI event.
 * @returns Promise and explicit resolve/reject callbacks without timers or network calls.
 */
export function acceptanceDeferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((done, fail) => {
        resolve = done
        reject = fail
    })
    return { promise, resolve, reject }
}
