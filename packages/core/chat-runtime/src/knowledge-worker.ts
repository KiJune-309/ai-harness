import { parentPort, workerData } from 'node:worker_threads'
import { KnowledgeProcessingError, parseKnowledgeDocument } from './knowledge-parser.js'

/**
 * Runs one bounded parsing job in this isolated thread and sends only its result or a safe error.
 * @returns After one response has been delivered to the parent process.
 */
async function run(): Promise<void> {
    try {
        parentPort?.postMessage({ result: await parseKnowledgeDocument(workerData) })
    } catch (error) {
        parentPort?.postMessage({ error: error instanceof KnowledgeProcessingError ? error.message : '文件解析失败，请检查格式后重试。' })
    } finally {
        parentPort?.close()
    }
}
void run()
