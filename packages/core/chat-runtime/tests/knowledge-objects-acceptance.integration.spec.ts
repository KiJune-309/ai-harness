import { createHash, randomUUID } from 'node:crypto'
import { DeleteBucketCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, it } from 'vitest'
import { createKnowledgeObjectStore } from '../src/knowledge-objects.js'

const configured = Boolean(process.env.TEST_S3_ENDPOINT && process.env.TEST_S3_ACCESS_KEY_ID && process.env.TEST_S3_SECRET_ACCESS_KEY)

it.skipIf(!configured)(
    'stores exact original bytes privately on a real S3 service and reopens them through a fresh client',
    async () => {
        const bucket = `sf007-acceptance-${randomUUID().replaceAll('-', '')}`
        const config = {
            endpoint: process.env.TEST_S3_ENDPOINT!,
            region: process.env.TEST_S3_REGION || 'us-east-1',
            bucket,
            accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID!,
            secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY!,
            forcePathStyle: true,
            createBucket: true,
        }
        const admin = new S3Client({
            endpoint: config.endpoint,
            region: config.region,
            forcePathStyle: true,
            maxAttempts: 1,
            credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
        })
        const key = `private/${randomUUID()}/original`
        const original = Buffer.concat([Buffer.from('真实原文件😀\r\n<script>inert source</script>\n'), Buffer.from([0, 1, 255, 128])])
        let created = false
        let store: Awaited<ReturnType<typeof createKnowledgeObjectStore>> | undefined
        try {
            store = await createKnowledgeObjectStore(config)
            created = true
            await store.put(key, original, 'application/octet-stream')
            expect(Buffer.from(await store.get(key))).toEqual(original)
            await store.close()
            store = await createKnowledgeObjectStore({ ...config, createBucket: false })
            const restored = await store.get(key)
            expect(createHash('sha256').update(restored).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'))
            const anonymous = await fetch(`${config.endpoint.replace(/\/$/, '')}/${bucket}/${key}`, { redirect: 'error' })
            expect([401, 403]).toContain(anonymous.status)
            expect(await anonymous.text()).not.toContain('真实原文件')
            await expect(store.get(`private/${randomUUID()}/missing`)).rejects.toThrow('无法读取原文件')
            await expect(store.put('empty', new Uint8Array(), 'text/plain')).rejects.toThrow('大小无效')
        } finally {
            await store?.close()
            if (created) {
                await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
                await admin.send(new DeleteBucketCommand({ Bucket: bucket }))
            }
            admin.destroy()
        }
    },
    30_000
)
