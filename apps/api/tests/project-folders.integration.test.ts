import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { ChatConversation, KnowledgeDocument, ProjectFolder } from '@ai-harness/contracts'
import { createChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { expect, it } from 'vitest'
import { createApiApp } from '../src/app.js'
import { ProjectFolderService } from '../src/project-folder-service.js'
import { readTestApiConfig } from './config-fixture.js'
import { sessionHeaders } from './session-fixture.js'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

/**
 * Produces one complete provider stream for a normal answer or native tool call.
 * @param delta - Provider-native response delta.
 * @param finish - Standard terminal reason.
 * @returns Complete SSE bytes.
 */
function stream(delta: Record<string, unknown>, finish = 'stop'): string {
    return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'persists project chat and uploaded references through authenticated HTTP and a real Cordis search/read loop',
    async () => {
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const schema = `sf021_api_${randomUUID().replaceAll('-', '')}`
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const observed: string[] = []
        const provider = createServer(async (request, response) => {
            let text = ''
            for await (const bytes of request) text += bytes
            const body = JSON.parse(text) as { tools?: { function: { name: string } }[]; messages: { role: string; content: string }[] }
            const tools = body.tools?.map(tool => tool.function.name) ?? []
            const replies = body.messages.filter(message => message.role === 'tool')
            let result: string
            if (!tools.includes('project-knowledge-search')) result = stream({ content: '普通回答' })
            else if (!replies.length) {
                observed.push('search')
                result = stream(
                    {
                        tool_calls: [
                            {
                                index: 0,
                                id: 'project_search_1',
                                type: 'function',
                                function: { name: 'project-knowledge-search', arguments: JSON.stringify({ query: '暗号' }) },
                            },
                        ],
                    },
                    'tool_calls'
                )
            } else if (replies.length === 1) {
                const matches = JSON.parse(replies[0]!.content) as { matches: { documentId: string }[] }
                expect(matches.matches).toHaveLength(1)
                observed.push('read')
                result = stream(
                    {
                        tool_calls: [
                            {
                                index: 0,
                                id: 'project_read_1',
                                type: 'function',
                                function: {
                                    name: 'project-knowledge-read',
                                    arguments: JSON.stringify({ documentId: matches.matches[0]!.documentId, page: 1 }),
                                },
                            },
                        ],
                    },
                    'tool_calls'
                )
            } else {
                const source = JSON.parse(replies.at(-1)!.content) as { fileName: string; chunks: { content: string; sourceUrl: string }[] }
                const chunk = source.chunks[0]!
                expect(chunk.content).toContain('水杉-742')
                expect(chunk.content).not.toContain('禁止泄漏-B')
                observed.push('answer')
                result = stream({ content: `${chunk.content} [${source.fileName}](${chunk.sourceUrl})` })
            }
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end(result)
        })
        await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
        const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
        const config = readTestApiConfig({
            DATABASE_URL: url.toString(),
            HARNESS_WORKSPACE_ID: 'sf021-private',
            HARNESS_API_TOKEN: 'sf021-private-http-fixture-token',
            DEEPSEEK_API_KEY: 'sf021-controlled-provider-key',
            DEEPSEEK_BASE_URL: origin,
            OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
        })
        const originals = new Map<string, Uint8Array>()
        const objects = {
            /**
             * Retains test-only source bytes while PostgreSQL owns all business and action records.
             * @param key - Private source identity.
             * @param bytes - Original uploaded bytes.
             * @returns After the test adapter saves bytes.
             */
            async put(key: string, bytes: Uint8Array) {
                originals.set(key, new Uint8Array(bytes))
            },
            /**
             * Reads the exact test original for the actual bounded parser.
             * @param key - Private source identity.
             * @returns Detached original bytes.
             */
            async get(key: string) {
                return new Uint8Array(originals.get(key)!)
            },
            /**
             * Releases the isolated object adapter without discarding restart fixtures.
             * @returns Nothing.
             */
            async close() {},
        }
        let app: NestExpressApplication | undefined
        let base = ''
        let headers: Record<string, string>
        let scope: { userId: string; workspaceId: string }
        /**
         * Calls a real authenticated route and checks its HTTP status.
         * @param path - API-relative path.
         * @param body - Optional JSON mutation.
         * @param status - Expected status code.
         * @returns Parsed public JSON.
         */
        async function json<T>(path: string, body?: unknown, status = body === undefined ? 200 : 201): Promise<T> {
            const response = await fetch(`${base}/${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers,
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
            expect(response.status, path).toBe(status)
            return response.json() as Promise<T>
        }
        /**
         * Uploads and waits for a real leased parser to commit complete chunks.
         * @param projectFolderId - Exact authorized project.
         * @param text - Distinctive document body.
         * @returns The completed public material.
         */
        async function upload(projectFolderId: string, text: string): Promise<KnowledgeDocument> {
            const form = new FormData()
            form.set('file', new Blob([text], { type: 'text/plain' }), '同名资料.txt')
            form.set('requestId', randomUUID())
            form.set('chunkSize', '1000')
            form.set('overlap', '0')
            form.set('projectFolderId', projectFolderId)
            const uploadHeaders = { ...headers }
            delete uploadHeaders['content-type']
            const response = await fetch(`${base}/knowledge/documents`, { method: 'POST', headers: uploadHeaders, body: form })
            expect(response.status).toBe(201)
            let document = (await response.json()) as KnowledgeDocument
            await expect
                .poll(
                    async () => {
                        document = await json<KnowledgeDocument>(`knowledge/documents/${document.id}?projectFolderId=${projectFolderId}`)
                        return document.status
                    },
                    { timeout: 10000, interval: 100 }
                )
                .toBe('ready')
            return document
        }
        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            const store = await createChatStore({ databaseUrl: url.toString() })
            scope = { userId: randomUUID(), workspaceId: config.workspaceId }
            headers = await sessionHeaders(store, config, scope.userId)
            app = await createApiApp(config, {
                store,
                logger: false,
                knowledgeObjectStore: objects,
                knowledgeWorkerOptions: { pollIntervalMs: 20 },
                collaborationWorkerOptions: { enabled: false },
                vectorWorkerOptions: { enabled: false },
            })
            await app.listen(0, '127.0.0.1')
            base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`
            const action = { requestId: randomUUID(), name: '项目A' }
            const folder = await json<ProjectFolder>('chat/project-folders', action)
            expect((await json<ProjectFolder>('chat/project-folders', action)).id).toBe(folder.id)
            const other = await json<ProjectFolder>('chat/project-folders', { requestId: randomUUID(), name: '项目B' })
            const source = await upload(folder.id, '项目发布暗号是水杉-742。')
            await upload(other.id, '项目发布暗号是禁止泄漏-B。')
            const creation = { requestId: randomUUID(), projectFolderId: folder.id }
            const conversation = await json<ChatConversation>('chat/conversations', creation)
            expect(conversation.projectFolderId).toBe(folder.id)
            expect((await json<ChatConversation>('chat/conversations', creation)).id).toBe(conversation.id)
            await json('chat/conversations', { ...creation, projectFolderId: other.id }, 409)
            const response = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ requestId: randomUUID(), content: '请查阅项目资料，告诉我发布暗号。' }),
            })
            expect(response.status).toBe(201)
            const answer = await response.text()
            expect(observed, answer).toEqual(['search', 'read', 'answer'])
            expect(answer).toContain('水杉-742')
            expect(answer).toContain(`/rag/${source.id}?projectFolderId=${folder.id}`)
            expect(observed).toEqual(['search', 'read', 'answer'])
            const list = await json<{ conversations: ChatConversation[] }>('chat/conversations')
            expect(list.conversations.filter(item => item.id === conversation.id)).toHaveLength(1)
            expect(list.conversations[0]!.projectFolderId).toBe(folder.id)
            const port = await new ProjectFolderService(store).knowledgePort(scope, conversation.id)
            expect(await port!.read(source.id, 1)).toMatchObject({ documentId: source.id })
            const wrongScope = { ...scope, userId: randomUUID() }
            await expect(new ProjectFolderService(store).get(wrongScope, folder.id)).rejects.toThrow()
            await json('chat/projects', undefined, 410)
            await app.close()
            app = undefined
            const restarted = await createChatStore({ databaseUrl: url.toString() })
            try {
                expect((await restarted.get(scope, conversation.id))?.projectFolderId).toBe(folder.id)
                const restored = await new ProjectFolderService(restarted).knowledgePort(scope, conversation.id)
                expect(JSON.stringify(await restored!.search('暗号'))).toContain('水杉-742')
            } finally {
                await restarted.close()
            }
        } finally {
            await app?.close()
            provider.closeAllConnections()
            await new Promise<void>(resolve => provider.close(() => resolve()))
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    30000
)
