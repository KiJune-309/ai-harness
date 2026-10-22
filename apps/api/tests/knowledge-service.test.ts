import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { KnowledgeProcessingError, type KnowledgeObjectStore } from '@ai-harness/chat-runtime/knowledge'
import type { KnowledgeProcessingResult } from '@ai-harness/contracts'
import type { KnowledgeLease, KnowledgeStore } from '@ai-harness/db'
import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { decodeMultipartFileName, KnowledgeUploadGuard } from '../src/knowledge-controller.js'
import { KnowledgeService, type KnowledgeProcessor } from '../src/knowledge-service.js'

/**
 * Builds a complete controlled lease for worker resource and shutdown tests.
 * @param bytes - Exact source whose checksum the service must validate.
 * @returns A claimed job in one explicitly isolated ownership scope.
 */
function jobFixture(bytes: Uint8Array): KnowledgeLease {
    const now = new Date().toISOString()
    return {
        scope: { userId: randomUUID(), workspaceId: 'knowledge-worker-test' },
        leaseToken: randomUUID(),
        generation: 1,
        record: {
            objectKey: 'test-only/private-original',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            fingerprint: 'a'.repeat(64),
            document: {
                id: randomUUID(),
                fileName: 'fixture.txt',
                format: 'txt',
                size: bytes.byteLength,
                status: 'processing',
                chunkSize: 1000,
                overlap: 200,
                characterCount: 0,
                chunkCount: 0,
                attempt: 1,
                createdAt: now,
                updatedAt: now,
            },
        },
    }
}

/**
 * Creates explicit fake dependencies for bounded worker lifecycle tests.
 * @param bytes - Exact immutable source bytes.
 * @returns Independent mocks with a single claimable source.
 */
function dependencies(bytes: Uint8Array) {
    const job = jobFixture(bytes)
    const store = {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        chunks: vi.fn(),
        searchProjectChunks: vi.fn(),
        retry: vi.fn(),
        claim: vi.fn().mockResolvedValueOnce(job).mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(true),
        complete: vi.fn().mockResolvedValue(true),
        fail: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
    } satisfies KnowledgeStore
    const objects = {
        put: vi.fn(),
        get: vi.fn().mockResolvedValue(bytes),
        close: vi.fn().mockResolvedValue(undefined),
    } satisfies KnowledgeObjectStore
    return { job, store, objects }
}

/**
 * Creates a minimal HTTP context retaining real finish/close event semantics.
 * @param response - Test-owned response event emitter.
 * @returns A context accepted by the resource admission guard.
 */
function context(response: EventEmitter): ExecutionContext {
    return { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ExecutionContext
}

describe('knowledge bounded upload admission', () => {
    it('admits only four bodies and releases each slot exactly once on finish or disconnect', () => {
        const configured = vi.fn()
        const guard = new KnowledgeUploadGuard({ assertConfigured: configured } as unknown as KnowledgeService)
        const responses = Array.from({ length: 5 }, () => new EventEmitter())
        for (const response of responses.slice(0, 4)) expect(guard.canActivate(context(response))).toBe(true)
        expect(() => guard.canActivate(context(responses[4]!))).toThrow('同时上传')
        responses[0]!.emit('finish')
        responses[0]!.emit('close')
        expect(guard.canActivate(context(responses[4]!))).toBe(true)
        expect(() => guard.canActivate(context(new EventEmitter()))).toThrow('同时上传')
        responses[1]!.emit('close')
        expect(guard.canActivate(context(new EventEmitter()))).toBe(true)
        expect(configured).toHaveBeenCalledTimes(8)
    })

    it('refuses unconfigured storage before allocating an upload slot', () => {
        const service = new KnowledgeService(undefined, undefined)
        expect(service.status().configured).toBe(false)
        const guard = new KnowledgeUploadGuard(service)
        expect(() => guard.canActivate(context(new EventEmitter()))).toThrow('资料库服务尚未连接')
    })
})

describe('knowledge leased worker lifecycle', () => {
    it('aborts a bounded parser and releases durable ownership during graceful shutdown', async () => {
        const { job, store, objects } = dependencies(Buffer.from('known original'))
        const processor = vi.fn<KnowledgeProcessor>(
            (_input, signal) =>
                new Promise((_resolve, reject) => {
                    signal!.addEventListener('abort', () => reject(new KnowledgeProcessingError('stopped')), { once: true })
                })
        )
        const service = new KnowledgeService(store, objects, processor, { pollIntervalMs: 60_000 })
        await vi.waitFor(() => expect(processor).toHaveBeenCalledOnce())
        await service.close()
        expect(store.release).toHaveBeenCalledExactlyOnceWith(job)
        expect(store.complete).not.toHaveBeenCalled()
        expect(store.fail).not.toHaveBeenCalled()
        expect(objects.close).toHaveBeenCalledOnce()
    })

    it('does not commit a parsed batch after lease renewal fails', async () => {
        const { store, objects } = dependencies(Buffer.from('known original'))
        store.heartbeat.mockResolvedValue(false)
        let finish!: (result: KnowledgeProcessingResult) => void
        const processor = vi.fn<KnowledgeProcessor>(
            () =>
                new Promise(resolve => {
                    finish = resolve
                })
        )
        const service = new KnowledgeService(store, objects, processor, { pollIntervalMs: 60_000, heartbeatMs: 5 })
        await vi.waitFor(() => expect(store.heartbeat).toHaveBeenCalledOnce())
        finish({ characterCount: 14, chunks: [{ index: 1, content: 'known original', characterCount: 14, charStart: 0, charEnd: 14 }] })
        await vi.waitFor(() => expect(processor).toHaveBeenCalledOnce())
        await new Promise(resolve => setTimeout(resolve, 5))
        expect(store.complete).not.toHaveBeenCalled()
        expect(store.fail).not.toHaveBeenCalled()
        await service.close()
    })

    it('never sends a corrupt stored original to the parser or reflects storage failures', async () => {
        const { job, store, objects } = dependencies(Buffer.from('known original'))
        objects.get.mockResolvedValue(Buffer.from('different original'))
        const processor = vi.fn<KnowledgeProcessor>()
        const service = new KnowledgeService(store, objects, processor, { pollIntervalMs: 60_000 })
        await vi.waitFor(() => expect(store.fail).toHaveBeenCalledOnce())
        expect(store.fail.mock.calls[0]?.[0]).toBe(job)
        expect(store.fail.mock.calls[0]?.[1]).toContain('原文件已保存')
        expect(processor).not.toHaveBeenCalled()
        await service.close()
    })
})

describe('multipart filename encoding', () => {
    it('decodes actual browser UTF-8 header bytes without damaging native Unicode or Latin-1 names', () => {
        const unicode = '来源😀.md'
        expect(decodeMultipartFileName(Buffer.from(unicode, 'utf8').toString('latin1'))).toBe(unicode)
        expect(decodeMultipartFileName(unicode)).toBe(unicode)
        expect(decodeMultipartFileName('café.md')).toBe('café.md')
        expect(decodeMultipartFileName('plain.txt')).toBe('plain.txt')
    })
})
