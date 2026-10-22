import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyKnowledgeRequest } from '../../server/knowledge-proxy'

const token = 'sf007-independent-server-fixture-token-20261017'
const session = 'k'.repeat(43)
const bodyLimit = 10 * 1024 * 1024 + 64 * 1024

/**
 * Constructs an authenticated upload whose body can be controlled independently of its declared size.
 * @param body - Actual incoming browser bytes or stream.
 * @param headers - Untrusted overrides for the request headers.
 * @param signal - Optional cancellation signal from the browser.
 * @returns A same-origin multipart request accepted by the real proxy boundary.
 */
function uploadRequest(body: BodyInit, headers: Record<string, string> = {}, signal?: AbortSignal): Request {
    return new Request('https://harness.example/api/knowledge/documents', {
        method: 'POST',
        headers: {
            cookie: `harness_account_session=${session}`,
            origin: 'https://harness.example',
            'content-type': 'multipart/form-data; boundary=independent-fixture',
            ...headers,
        },
        body,
        ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
        ...(signal ? { signal } : {}),
    } as RequestInit)
}

/**
 * Supplies isolated server configuration without reading local application secrets.
 * @param upstream - Observable fixture fetch implementation.
 * @returns Private proxy settings used only by this test.
 */
function configuration(upstream: typeof fetch) {
    return { token, apiUrl: 'http://private-api.example:3001', fetch: upstream }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('independent knowledge upload resource boundary', () => {
    it.each([undefined, '1'])('cancels an actually oversized stream even with content-length %s', async declaredLength => {
        let cancelled = false
        const stream = new ReadableStream<Uint8Array>({
            /**
             * Emits enough actual bytes to exceed the upload bound.
             * @param controller - Browser request producer.
             * @returns Nothing after the bytes are queued.
             */
            start(controller) {
                controller.enqueue(new Uint8Array(bodyLimit))
                controller.enqueue(new Uint8Array(1))
            },
            /**
             * Records cancellation of the untrusted body rather than draining unlimited input.
             * @returns Nothing after updating the observation.
             */
            cancel() {
                cancelled = true
            },
        })
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ accepted: true }))
        const response = await proxyKnowledgeRequest(
            uploadRequest(stream, declaredLength ? { 'content-length': declaredLength } : {}),
            ['documents'],
            configuration(upstream)
        )
        expect(response.status).toBe(413)
        expect(cancelled).toBe(true)
        expect(upstream).not.toHaveBeenCalled()
    })

    it('releases the incoming body reader when the browser disconnects before any bytes arrive', async () => {
        const browser = new AbortController()
        let producer: ReadableStreamDefaultController<Uint8Array> | undefined
        let cancelled = false
        const stream = new ReadableStream<Uint8Array>({
            /**
             * Leaves the incoming upload stalled until cancellation or test cleanup.
             * @param controller - Browser-side producer retained for bounded cleanup.
             * @returns Nothing after retaining the controller.
             */
            start(controller) {
                producer = controller
            },
            /**
             * Records cancellation of a stalled request body.
             * @returns Nothing after updating the observation.
             */
            cancel() {
                cancelled = true
            },
        })
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ accepted: true }))
        const pending = proxyKnowledgeRequest(uploadRequest(stream, {}, browser.signal), ['documents'], configuration(upstream))
        try {
            browser.abort()
            await vi.waitFor(() => expect(cancelled).toBe(true), { timeout: 250, interval: 10 })
            const response = await pending
            expect(response.ok).toBe(false)
            expect(upstream).not.toHaveBeenCalled()
        } finally {
            if (!cancelled) producer?.close()
            await pending
        }
    })

    it('applies its deadline while buffering a stalled browser body and makes the upload slot reusable', async () => {
        vi.useFakeTimers()
        let producer: ReadableStreamDefaultController<Uint8Array> | undefined
        let cancelled = false
        const stream = new ReadableStream<Uint8Array>({
            /**
             * Retains a stalled producer until timeout or bounded test cleanup.
             * @param controller - Browser request producer.
             * @returns Nothing after retaining the controller.
             */
            start(controller) {
                producer = controller
            },
            /**
             * Observes cancellation imposed by the proxy deadline.
             * @returns Nothing after updating the observation.
             */
            cancel() {
                cancelled = true
            },
        })
        const upstream = vi.fn<typeof fetch>(async () => Response.json({ accepted: true }))
        const pending = proxyKnowledgeRequest(uploadRequest(stream), ['documents'], configuration(upstream))
        try {
            await vi.advanceTimersByTimeAsync(60_001)
            expect(cancelled).toBe(true)
            expect((await pending).ok).toBe(false)
            expect(upstream).not.toHaveBeenCalled()
        } finally {
            if (!cancelled) producer?.close()
            await pending
        }
        const response = await proxyKnowledgeRequest(uploadRequest('bounded upload'), ['documents'], configuration(upstream))
        expect(response.status).toBe(200)
        expect(upstream).toHaveBeenCalledOnce()
    })
})
