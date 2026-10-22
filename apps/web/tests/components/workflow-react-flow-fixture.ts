import { vi } from 'vitest'
import { installAcceptanceBrowser } from './shadcn-acceptance-fixture'

/**
 * Reads the CSS translation and scale produced by the real React Flow viewport.
 * @param transform - Browser style value unavailable to jsdom's layout engine.
 * @returns The real CSS transform numbers, with normal browser identity defaults.
 */
function transformValues(transform: string) {
    const translate = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform)
    const scale = /scale\(([\d.]+)\)/.exec(transform)
    return { x: Number(translate?.[1] ?? 0), y: Number(translate?.[2] ?? 0), zoom: Number(scale?.[1] ?? 1) }
}

/**
 * Supplies stable test geometry only for the canvas and nodes that jsdom cannot measure.
 * @param element - Real React Flow DOM element.
 * @returns A canvas, node, or handle size; unrelated UI keeps its original measurements.
 */
function flowSize(element: HTMLElement) {
    if (element.classList.contains('react-flow__node'))
        return { width: Number.parseFloat(element.style.width) || 224, height: Number.parseFloat(element.style.height) || 144 }
    if (element.classList.contains('react-flow__handle')) return { width: 12, height: 12 }
    if (element.matches('.react-flow, .react-flow__renderer, .react-flow__pane')) return { width: 800, height: 640 }
    return null
}

/**
 * Adds only missing layout primitives, leaving the actual React Flow event/state engine intact.
 * @param width - Viewport used by the application's mobile media query.
 * @returns Cleanup for the absent document hit-testing API; Vitest restores the spies and globals.
 */
export function installWorkflowFlowBrowser(width = 1280): () => void {
    installAcceptanceBrowser(width)
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get!
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!.get!
    const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    const NativeMouseEvent = MouseEvent
    vi.stubGlobal(
        'MouseEvent',
        class FlowMouseEvent extends NativeMouseEvent {
            /**
             * Supplies the real event view absent from user-event while avoiding jsdom's wrapped Window conversion.
             * @param type - Browser mouse event type.
             * @param options - Native event coordinates and modifiers.
             */
            constructor(type: string, options: MouseEventInit = {}) {
                const { view, ...nativeOptions } = options
                super(type, nativeOptions)
                Object.defineProperty(this, 'view', { configurable: true, value: view ?? window })
            }
        }
    )
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: (x: number, y: number) =>
            [...document.querySelectorAll<HTMLElement>('.react-flow__handle')].find(element => {
                const rect = element.getBoundingClientRect()
                return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
            }) ?? null,
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return flowSize(this)?.width ?? originalWidth.call(this)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return flowSize(this)?.height ?? originalHeight.call(this)
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const size = flowSize(this)
        if (!size) return originalRect.call(this)
        const node = this.classList.contains('react-flow__node') ? this : this.closest<HTMLElement>('.react-flow__node')
        if (!node) return new DOMRect(0, 0, size.width, size.height)
        const position = transformValues(node.style.transform)
        const viewport = transformValues(
            node.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? ''
        )
        let x = position.x * viewport.zoom + viewport.x
        let y = position.y * viewport.zoom + viewport.y
        if (this.classList.contains('react-flow__handle')) {
            const dimensions = flowSize(node)!
            x += (dimensions.width / 2 - 6) * viewport.zoom
            y += (this.dataset.handlepos === 'bottom' ? dimensions.height - 6 : -6) * viewport.zoom
        }
        return new DOMRect(x, y, size.width * viewport.zoom, size.height * viewport.zoom)
    })
    vi.stubGlobal(
        'DOMMatrixReadOnly',
        class FlowCssMatrix {
            readonly m22: number

            /**
             * Exposes the CSS scale that React Flow reads from the browser matrix API.
             * @param transform - Actual viewport CSS transform.
             */
            constructor(transform: string) {
                this.m22 = transformValues(transform).zoom
            }
        }
    )
    vi.stubGlobal(
        'ResizeObserver',
        class FlowResizeObserver {
            private readonly callback: ResizeObserverCallback
            private readonly targets = new Set<Element>()

            /**
             * Retains the real component's size observer callback.
             * @param callback - React Flow's own geometry observer.
             */
            constructor(callback: ResizeObserverCallback) {
                this.callback = callback
            }

            /**
             * Reports the measured DOM geometry asynchronously without inventing node changes.
             * @param target - Real observed canvas or node.
             * @returns Nothing after scheduling the browser-like observation.
             */
            observe(target: Element): void {
                this.targets.add(target)
                queueMicrotask(() => {
                    if (!this.targets.has(target) || !target.isConnected) return
                    const contentRect = target.getBoundingClientRect()
                    this.callback(
                        [
                            { target, contentRect, borderBoxSize: [{ inlineSize: contentRect.width, blockSize: contentRect.height }] },
                        ] as unknown as ResizeObserverEntry[],
                        this as unknown as ResizeObserver
                    )
                })
            }

            /**
             * Stops the requested browser geometry observation.
             * @param target - Previously observed element.
             * @returns Nothing.
             */
            unobserve(target: Element): void {
                this.targets.delete(target)
            }

            /**
             * Releases all pending observation callbacks when the real component unmounts.
             * @returns Nothing.
             */
            disconnect(): void {
                this.targets.clear()
            }
        }
    )
    /**
     * Restores document hit testing after the real component has unmounted.
     * @returns Nothing.
     */
    return function restoreHitTesting(): void {
        if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest)
        else Reflect.deleteProperty(document, 'elementFromPoint')
    }
}
