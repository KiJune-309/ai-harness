import { Worker } from 'node:worker_threads'
import { knowledgeProcessingResultSchema, type KnowledgeProcessingResult } from '@ai-harness/contracts'
import { KnowledgeProcessingError, type KnowledgeProcessingInput } from './knowledge-parser.js'
export {
    KnowledgeProcessingError,
    normalizeKnowledgeText,
    parseKnowledgeDocument,
    splitKnowledgeText,
    validateKnowledgeDocx,
    type KnowledgeProcessingInput,
} from './knowledge-parser.js'
export { createKnowledgeObjectStore, type KnowledgeObjectStore, type KnowledgeObjectStorageConfig } from './knowledge-objects.js'

/**
 * Processes one document with a strict memory budget and a thirty-second hard deadline.
 * @param input - Complete bounded upload and explicit chunk settings.
 * @param signal - Optional shutdown cancellation that terminates the worker thread.
 * @returns The complete validated result, without publishing partial chunks.
 * @throws KnowledgeProcessingError when parsing fails, exceeds resources, or is cancelled.
 */
export async function processKnowledgeDocument(input: KnowledgeProcessingInput, signal?: AbortSignal): Promise<KnowledgeProcessingResult> {
    if (signal?.aborted) throw new KnowledgeProcessingError('资料处理已暂停，将在服务恢复后继续。')
    const url = new URL(import.meta.url.endsWith('.ts') ? '../lib/knowledge-worker.js' : './knowledge-worker.js', import.meta.url)
    const worker = new Worker(url, {
        workerData: input,
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    })
    try {
        return await new Promise<KnowledgeProcessingResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                void worker.terminate()
                reject(new KnowledgeProcessingError('文件处理超过 30 秒，请拆分文件后重试。'))
            }, 30_000)
            /**
             * Stops this thread when the owning API is shutting down.
             * @returns Nothing after rejecting the pending parsing job.
             */
            function abort(): void {
                void worker.terminate()
                reject(new KnowledgeProcessingError('资料处理已暂停，将在服务恢复后继续。'))
            }
            /**
             * Releases parent-side listeners and the deadline once the worker exits.
             * @returns Nothing; event-loop resources are no longer retained.
             */
            function cleanup(): void {
                clearTimeout(timer)
                signal?.removeEventListener('abort', abort)
            }
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted) abort()
            worker.once('message', (message: unknown) => {
                cleanup()
                if (message && typeof message === 'object' && 'result' in message) {
                    const parsed = knowledgeProcessingResultSchema.safeParse(message.result)
                    if (parsed.success) {
                        resolve(parsed.data)
                        return
                    }
                }
                reject(
                    new KnowledgeProcessingError(
                        message && typeof message === 'object' && 'error' in message && typeof message.error === 'string'
                            ? message.error
                            : '资料处理未成功，请重试。'
                    )
                )
            })
            worker.once('error', () => {
                cleanup()
                reject(new KnowledgeProcessingError('文件处理超出资源限制或发生错误，请拆分文件后重试。'))
            })
            worker.once('exit', () => {
                cleanup()
                reject(new KnowledgeProcessingError('资料处理已中断，请重试。'))
            })
        })
    } finally {
        await worker.terminate()
    }
}
