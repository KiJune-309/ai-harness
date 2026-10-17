import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentDefinition, PersonalProject, PersonalTask, ProjectDetail } from '@ai-harness/contracts'
import { expect, it } from 'vitest'

const token = 'sf003-local-persistence-test-server-token-20261017'

/**
 * Allocates an ephemeral loopback port for this test's independent API process.
 * @returns An unused local port.
 * @throws Error if the loopback socket cannot open or close.
 */
async function availablePort(): Promise<number> {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert(address && typeof address !== 'string')
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    return address.port
}

/**
 * Drains and stops a test-owned API child, with a bounded forced shutdown fallback.
 * @param child - API process created by this test only.
 * @returns After the process exits.
 */
async function stop(child: ChildProcess | undefined): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000)
    try {
        await exited
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Boots the built API in a distinct operating-system process.
 * @param port - Dedicated local HTTP port.
 * @param modelUrl - Deterministic native-provider fixture URL.
 * @param memory - Whether to use disposable process-local storage instead of real PostgreSQL.
 * @returns A ready child process without exposing credentials in logs.
 * @throws Error when startup fails or readiness times out.
 */
async function boot(port: number, modelUrl: string, memory = false): Promise<ChildProcess> {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
        env: {
            ...process.env,
            HARNESS_API_TOKEN: token,
            HARNESS_WORKSPACE_ID: 'sf003-test',
            DATABASE_URL: memory ? '' : process.env.TEST_DATABASE_URL,
            CHAT_STORE: memory ? 'memory' : '',
            API_HOST: '127.0.0.1',
            API_PORT: String(port),
            DEEPSEEK_API_KEY: 'local-fixture-key',
            DEEPSEEK_BASE_URL: modelUrl,
            DEEPSEEK_MODEL: 'deepseek-flash',
        },
        stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error('Isolated project API exited during startup.')
        const response = await fetch(`http://127.0.0.1:${port}/api/chat/status`, {
            headers: {
                authorization: `Bearer ${token}`,
                'x-harness-user-id': '36ee7dd6-1d63-419a-8be4-3045d72bd92a',
                'x-harness-workspace-id': 'sf003-test',
            },
        }).catch(() => undefined)
        if (response?.ok) {
            await response.body?.cancel()
            return child
        }
        await delay(100)
    }
    await stop(child)
    throw new Error('Isolated project API did not become ready.')
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'preserves real projects, edited creation replay, moved task history and legacy records across API process restarts',
    async () => {
        const provider = createServer(async (request, response) => {
            for await (const chunk of request) void chunk
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Persistent project reply.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
            )
        })
        provider.listen(0, '127.0.0.1')
        await once(provider, 'listening')
        const address = provider.address()
        assert(address && typeof address !== 'string')
        const modelUrl = `http://127.0.0.1:${address.port}`
        const port = await availablePort()
        const user = randomUUID()
        let child: ChildProcess | undefined
        /**
         * Calls the authenticated isolated API using only test-owned identity and resources.
         * @param path - Public resource below the chat API.
         * @param method - HTTP operation.
         * @param body - Optional JSON request payload.
         * @returns The unconsumed HTTP response.
         */
        function call(path: string, method = 'GET', body?: unknown): Promise<Response> {
            return fetch(`http://127.0.0.1:${port}/api/chat${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${token}`,
                    'x-harness-user-id': user,
                    'x-harness-workspace-id': 'sf003-test',
                    'content-type': 'application/json',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }
        /**
         * Reads a successful JSON result while making HTTP refusals fail the test immediately.
         * @param path - API resource path.
         * @param method - HTTP operation.
         * @param body - Optional request data.
         * @returns The parsed public result.
         */
        async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
            const response = await call(path, method, body)
            expect(response.ok).toBe(true)
            return response.json() as Promise<T>
        }
        try {
            child = await boot(port, modelUrl)
            const projectInput = { requestId: randomUUID(), name: 'Original project', description: 'Management metadata only.' }
            const project = await json<PersonalProject>('/projects', 'POST', projectInput)
            const destination = await json<PersonalProject>('/projects', 'POST', {
                requestId: randomUUID(),
                name: 'Destination',
                description: '',
            })
            const edited = await json<PersonalProject>(`/projects/${project.id}`, 'PUT', {
                name: 'Edited project',
                description: 'Current description.',
            })
            const agent = await json<AgentDefinition>('/agents', 'POST', {
                name: 'Frozen project Agent',
                description: '',
                modelId: 'deepseek-flash',
                systemPrompt: 'Original Agent prompt.',
                toolIds: [],
                openingMessages: ['Original greeting.'],
            })
            const input = {
                requestId: randomUUID(),
                title: 'Persistent project task',
                goal: 'Remember Cedar within this task.',
                agentId: agent.id,
                projectId: project.id,
            }
            const task = await json<PersonalTask>('/tasks', 'POST', input)
            const start = await call(`/tasks/${task.id}/start`, 'POST', { requestId: randomUUID() })
            expect(start.ok).toBe(true)
            expect(await start.text()).toContain('"type":"done"')
            await json(`/tasks/${task.id}/status`, 'PUT', { status: 'needs-input' })
            const baseline = await json<PersonalTask>(`/tasks/${task.id}/project`, 'PUT', { projectId: destination.id })
            const legacy = await json<PersonalTask>('/tasks', 'POST', {
                requestId: randomUUID(),
                title: 'Ungrouped legacy task',
                goal: 'Keep original task compatibility.',
            })
            const conversation = await json<{ id: string }>('/conversations', 'POST', { title: 'Ordinary conversation' })
            await stop(child)
            child = await boot(port, modelUrl)
            expect(await json(`/projects/${project.id}`)).toEqual({ project: edited, tasks: [] })
            const detail = await json<ProjectDetail>(`/projects/${destination.id}`)
            expect(detail.tasks).toEqual([baseline])
            expect(detail.tasks[0]?.task.status).toBe('needs-input')
            expect(detail.tasks[0]?.messages.map(message => message.content)).toEqual([
                'Original greeting.',
                input.goal,
                'Persistent project reply.',
            ])
            expect(await json('/projects', 'POST', projectInput)).toEqual(edited)
            expect(await json('/tasks', 'POST', input)).toEqual(baseline)
            expect(await json(`/tasks/${legacy.id}`)).toEqual(legacy)
            expect((await call(`/conversations/${conversation.id}`)).status).toBe(200)
            expect((await json<{ tasks: PersonalTask[] }>('/tasks')).tasks.map(item => item.id).sort()).toEqual([task.id, legacy.id].sort())
            const removed = await json<PersonalTask>(`/tasks/${task.id}/project`, 'PUT', { projectId: null })
            expect(removed.task.projectId).toBeUndefined()
            expect(await json('/tasks', 'POST', input)).toEqual(removed)
            expect((await json<ProjectDetail>(`/projects/${destination.id}`)).tasks).toEqual([])
            await stop(child)
            child = await boot(port, modelUrl, true)
            const temporary = await json<PersonalProject>('/projects', 'POST', {
                requestId: randomUUID(),
                name: 'Temporary project',
                description: '',
            })
            const temporaryTask = await json<PersonalTask>('/tasks', 'POST', {
                requestId: randomUUID(),
                title: 'Temporary membership',
                goal: 'Only this process.',
                projectId: temporary.id,
            })
            expect((await json<ProjectDetail>(`/projects/${temporary.id}`)).tasks.map(item => item.id)).toEqual([temporaryTask.id])
            await stop(child)
            child = await boot(port, modelUrl, true)
            expect((await call(`/projects/${temporary.id}`)).status).toBe(404)
            expect((await call(`/tasks/${temporaryTask.id}`)).status).toBe(404)
            expect(await json('/projects')).toEqual({ projects: [] })
        } finally {
            await stop(child)
            await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
        }
    },
    30_000
)
