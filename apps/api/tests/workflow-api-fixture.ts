import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChatConversation, CollaborationActionResult, CollaborationDispatch } from '@ai-harness/contracts'
import { expect } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig } from './config-fixture.js'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

export interface WorkflowProviderInput {
    model: string
    messages: unknown[]
    tools?: { function: { name: string; parameters: { properties: { slotId: { enum: string[] } } } } }[]
}
export interface WorkflowProviderCall extends WorkflowProviderInput {
    authorization: string
}
export interface WorkflowProviderTool {
    name: string
    args: Record<string, unknown>
}

/**
 * Observes actual persistent settlement rather than assuming an HTTP acknowledgement completed execution.
 * @param read - Read-only real API or PostgreSQL observation.
 * @param accept - Required persisted state.
 * @returns The accepted durable observation.
 * @throws Error if the bounded local-worker deadline expires.
 */
export async function workflowUntil<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; attempt < 180; attempt++) {
        const value = await read()
        if (accept(value)) return value
        await delay(50)
    }
    throw new Error('Test-owned workflow did not reach the required durable state.')
}

/**
 * Runs actual authenticated HTTP and Cordis execution in a disposable PostgreSQL schema and loopback provider.
 * @param run - Independent assertions and deterministic provider responses.
 * @returns After the test-owned API, provider, pools and schema are fully released.
 * @throws Error for assertion, actual transport or database failure.
 */
export async function workflowApi(run: (fixture: Awaited<ReturnType<typeof openWorkflowApi>>) => Promise<void>): Promise<void> {
    const fixture = await openWorkflowApi()
    try {
        await run(fixture)
    } finally {
        await fixture.close()
    }
}

/**
 * Creates real accounts with distinct encrypted model routes and returns bounded test controls.
 * @returns A private test-owned transport, provider recorder and isolated database pool.
 * @throws Error when schema creation, application setup or test registration fails.
 */
async function openWorkflowApi() {
    const schema = `sf018_api_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    const people = new Map<string, { id: string; session: string; modelId: string }>()
    const calls: WorkflowProviderCall[] = []
    const behavior: { respond: (input: WorkflowProviderInput) => WorkflowProviderTool | undefined } = { respond: () => undefined }
    const provider = createServer(async (request, response) => {
        let raw = ''
        for await (const chunk of request) raw += String(chunk)
        const body = JSON.parse(raw) as WorkflowProviderInput
        calls.push({ ...body, authorization: request.headers.authorization ?? '' })
        const tool = behavior.respond(body)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        if (tool) {
            response.end(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
            )
        } else {
            response.end(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${body.model}的本人分析。` }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
            )
        }
    })
    await admin.query(`CREATE SCHEMA ${schema}`)
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
    const config = readTestApiConfig({
        DATABASE_URL: url.toString(),
        HARNESS_WORKSPACE_ID: schema,
        HARNESS_API_TOKEN: 'sf018-controlled-provider-test-server-token',
        OPENAI_ALLOWED_LOCAL_ORIGINS: origin,
        COLLABORATION_POLL_MS: '20',
    })
    const app = await createApiApp(config, {
        logger: false,
        knowledgeWorkerOptions: { enabled: false },
        vectorWorkerOptions: { enabled: false },
    })
    await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`

    /**
     * Calls the actual guarded API with a server-issued session, keeping private headers out of test output.
     * @param owner - Actual fixture account, empty only for registration.
     * @param path - Relative API route.
     * @param body - Optional strict JSON mutation.
     * @param method - Explicit HTTP verb, otherwise inferred from body presence.
     * @returns The unconsumed actual HTTP response.
     */
    async function call(owner: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Response> {
        return fetch(`${base}/${path}`, {
            method,
            headers: {
                authorization: `Bearer ${config.token}`,
                'content-type': 'application/json',
                'x-harness-session': people.get(owner)?.session ?? '',
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
    }

    /**
     * Reads successful public JSON without exposing headers, database URLs or provider credentials.
     * @param owner - Actual fixture owner.
     * @param path - API route.
     * @param body - Optional strict mutation.
     * @param method - Optional explicit HTTP verb.
     * @returns The actual parsed public result.
     */
    async function json<T>(owner: string, path: string, body?: unknown, method?: string): Promise<T> {
        const response = await call(owner, path, body, method)
        const result = await response.json()
        expect(response.ok, `${path}: ${response.status} ${response.ok ? '' : JSON.stringify(result)}`).toBe(true)
        return result as T
    }

    /**
     * Reads the current source's real immutable dispatch previews and question identities.
     * @param owner - Actual private source owner.
     * @param conversationId - Exact persisted ordinary source.
     * @returns The real source projection.
     */
    async function events(owner: string, conversationId: string) {
        return json<{
            pendingDispatches: CollaborationDispatch[]
            questions: { id: string; status: string; version: number }[]
            sourceState?: { activeRequestId?: string }
        }>(owner, `chat/collaboration/source-events?sourceKind=conversation&sourceId=${conversationId}`)
    }

    /**
     * Submits a real owner input without mentions and waits for its durable Cordis turn to finish.
     * @param owner - Actual private chat owner.
     * @param conversationId - Exact fixed source.
     * @param content - Original human input, never synthesized from a template.
     * @returns The persisted conversation after execution.
     */
    async function input(owner: string, conversationId: string, content: string): Promise<ChatConversation> {
        const response = await call(owner, `chat/conversations/${conversationId}/messages`, { requestId: randomUUID(), content })
        expect(response.ok, `${owner} input ${response.status}`).toBe(true)
        await response.text()
        return workflowUntil(
            () => json<ChatConversation>(owner, `chat/conversations/${conversationId}`),
            conversation => !conversation.activeRequestId
        )
    }

    /**
     * Executes the dedicated human confirmation for the exact saved preview and verifies idempotent replay.
     * @param owner - Original source owner who reviews the draft.
     * @param conversationId - Exact saved fixed source.
     * @returns The complete draft and its real committed result.
     */
    async function confirm(owner: string, conversationId: string) {
        const page = await workflowUntil(
            () => events(owner, conversationId),
            value => !value.sourceState?.activeRequestId && value.pendingDispatches.some(draft => draft.status === 'pending')
        )
        const draft = page.pendingDispatches.find(candidate => candidate.status === 'pending')!
        const command = { type: 'confirm-dispatch', requestId: randomUUID(), draftId: draft.id, version: draft.version }
        const result = await json<CollaborationActionResult>(owner, 'chat/collaboration/commands', command)
        expect(await json(owner, 'chat/collaboration/commands', command)).toEqual(result)
        return { draft, result, command }
    }

    /**
     * Releases only the test-owned services, records and connections.
     * @returns After schema cleanup completes.
     */
    async function close(): Promise<void> {
        await app.close()
        await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
        await pool.end()
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
        await admin.end()
    }
    try {
        for (const name of ['A', 'B', 'C', 'D']) {
            const response = await call('', 'account/register', {
                username: `Person ${name}`,
                email: `${randomUUID()}@example.test`,
                password: 'Persistent workflow password',
            })
            expect(response.status).toBe(201)
            people.set(name, {
                id: ((await response.json()) as { id: string }).id,
                session: response.headers.get('x-harness-session')!,
                modelId: '',
            })
            people.get(name)!.modelId = (
                await json<{ id: string }>(name, 'account/models', {
                    requestId: randomUUID(),
                    name: `${name}模型`,
                    baseUrl: `${origin}/v1`,
                    model: name,
                    apiKey: `workflow-test-key-${name}`,
                })
            ).id
        }
        return { app, pool, people, calls, behavior, schema, origin, call, json, input, events, confirm, close }
    } catch (cause) {
        await close()
        throw cause
    }
}
