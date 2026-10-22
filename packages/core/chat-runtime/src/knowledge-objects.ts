import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { KNOWLEDGE_MAX_FILE_SIZE } from '@ai-harness/contracts'

export interface KnowledgeObjectStorageConfig {
    endpoint: string
    region: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle?: boolean
    createBucket?: boolean
}
export interface KnowledgeObjectStore {
    /**
     * Persists exact upload bytes under a server-generated private key.
     * @param key - Scoped opaque object identity, never an uploaded filename.
     * @param bytes - Original bounded upload bytes.
     * @param contentType - Server-verified media type.
     * @returns After the durable object server confirms the write.
     */
    put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
    /**
     * Reads bounded original bytes from a previously authorized object reference.
     * @param key - Private object key obtained from scoped database metadata.
     * @returns The complete original file bytes.
     */
    get(key: string): Promise<Uint8Array>
    /**
     * Releases process-owned object service connections.
     * @returns After the client has been disposed.
     */
    close(): Promise<void>
}

/**
 * Creates one process-owned S3 client without granting any public object permissions.
 * @param config - Private server-only connection credentials and bucket identity.
 * @returns A bounded object store after the configured bucket has been checked.
 * @throws Error with a safe message when the object service is unavailable.
 */
export async function createKnowledgeObjectStore(config: KnowledgeObjectStorageConfig): Promise<KnowledgeObjectStore> {
    const client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        forcePathStyle: config.forcePathStyle ?? true,
        maxAttempts: 1,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    })
    try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal: AbortSignal.timeout(10_000) })
    } catch (error) {
        const missing =
            error &&
            typeof error === 'object' &&
            '$metadata' in error &&
            (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404
        if (config.createBucket && missing) {
            try {
                await client.send(new CreateBucketCommand({ Bucket: config.bucket }), { abortSignal: AbortSignal.timeout(10_000) })
            } catch (creation) {
                if (!creation || typeof creation !== 'object' || !('name' in creation) || creation.name !== 'BucketAlreadyOwnedByYou') {
                    client.destroy()
                    throw new Error('资料文件存储无法初始化，请检查服务配置。')
                }
            }
        } else {
            client.destroy()
            throw new Error('资料文件存储无法初始化，请检查服务配置。')
        }
    }
    return {
        /**
         * Writes the unmodified original under a private scoped key with a bounded deadline.
         * @param key - Server-owned opaque object reference.
         * @param bytes - Bounded original data.
         * @param contentType - Verified file media type.
         * @returns After the object server acknowledges durable storage.
         * @throws Error with a safe message for invalid data or storage failures.
         */
        async put(key, bytes, contentType) {
            if (!bytes.byteLength || bytes.byteLength > KNOWLEDGE_MAX_FILE_SIZE) throw new Error('资料文件大小无效。')
            try {
                await client.send(
                    new PutObjectCommand({
                        Bucket: config.bucket,
                        Key: key,
                        Body: bytes,
                        ContentLength: bytes.byteLength,
                        ContentType: contentType,
                    }),
                    { abortSignal: AbortSignal.timeout(10_000) }
                )
            } catch {
                throw new Error('资料文件保存失败，请检查存储服务后重试。')
            }
        },
        /**
         * Reads a bounded original with no redirect or public URL exposed to the browser.
         * @param key - Authorized opaque object reference.
         * @returns Exact stored bytes.
         * @throws Error with a safe message for missing, excessive, or unavailable objects.
         */
        async get(key) {
            const signal = AbortSignal.timeout(10_000)
            try {
                const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: signal })
                if (!response.Body || (response.ContentLength ?? 0) > KNOWLEDGE_MAX_FILE_SIZE) {
                    if (response.Body && 'destroy' in response.Body) response.Body.destroy()
                    throw new Error('Invalid original size')
                }
                const parts: Uint8Array[] = []
                let size = 0
                for await (const part of response.Body as AsyncIterable<Uint8Array>) {
                    size += part.byteLength
                    if (size > KNOWLEDGE_MAX_FILE_SIZE || signal.aborted) {
                        if ('destroy' in response.Body) response.Body.destroy()
                        throw new Error('Original exceeds bounds')
                    }
                    parts.push(part)
                }
                if (!size) throw new Error('Empty original')
                return Buffer.concat(parts, size)
            } catch {
                throw new Error('无法读取原文件，请检查存储服务后重试。')
            }
        },
        /**
         * Disposes only this process-owned client.
         * @returns After sockets have been released.
         */
        async close() {
            client.destroy()
        },
    }
}
