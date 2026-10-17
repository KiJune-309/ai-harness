import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type {
    AgentDefinition,
    PersonalProject,
    PersonalTask,
    ProjectDetail,
    ProjectTemplate,
    TemplateLaunchResult,
} from '@ai-harness/contracts'
import { expect, it } from 'vitest'

const token = 'sf004-local-persistence-test-server-token-20261017'

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
            HARNESS_WORKSPACE_ID: 'sf004-test',
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
                'x-harness-workspace-id': 'sf004-test',
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
    'restores templates and original launches across PostgreSQL API restarts without undoing later work',
    async () => {
        const provider = createServer(async (request, response) => {
            for await (const chunk of request) void chunk
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Persistent template reply.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
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
         * Sends a request to the isolated test-owned API without logging private configuration.
         * @param path - Resource below the chat API.
         * @param method - HTTP operation.
         * @param body - Optional public JSON payload.
         * @returns The unconsumed response.
         */
        function call(path: string, method = 'GET', body?: unknown): Promise<Response> {
            return fetch(`http://127.0.0.1:${port}/api/chat${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${token}`,
                    'x-harness-user-id': user,
                    'x-harness-workspace-id': 'sf004-test',
                    'content-type': 'application/json',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }
        /**
         * Parses JSON only after confirming that the API operation succeeded.
         * @param path - Public resource path.
         * @param method - HTTP operation.
         * @param body - Optional request data.
         * @returns The typed public response.
         */
        async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
            const response = await call(path, method, body)
            expect(response.ok).toBe(true)
            return response.json() as Promise<T>
        }
        try {
            child = await boot(port, modelUrl)
            const agent = await json<AgentDefinition>('/agents', 'POST', {
                name: 'Template assistant',
                description: '',
                modelId: 'deepseek-flash',
                systemPrompt: 'Original frozen prompt.',
                toolIds: [],
                openingMessages: ['Original greeting.'],
            })
            const initial = {
                requestId: randomUUID(),
                name: 'Weekly blueprint',
                description: '',
                tasks: [
                    { id: randomUUID(), title: 'First original task', goal: 'Remember Cedar.', agentId: agent.id },
                    { id: randomUUID(), title: 'Second task', goal: 'Keep Maple separate.', agentId: agent.id },
                    { id: randomUUID(), title: 'Default task', goal: 'Use deployment defaults.' },
                ],
            }
            const template = await json<ProjectTemplate>('/templates', 'POST', initial)
            const launch = { requestId: randomUUID(), version: template.version, name: 'This week', description: 'Management only.' }
            const created = await json<TemplateLaunchResult>(`/templates/${template.id}/launch`, 'POST', launch)
            expect(created.taskIds).toHaveLength(3)
            const firstId = created.taskIds[0]!
            const start = await call(`/tasks/${firstId}/start`, 'POST', { requestId: randomUUID() })
            expect(start.ok).toBe(true)
            expect(await start.text()).toContain('"type":"done"')
            const destination = await json<PersonalProject>('/projects', 'POST', {
                requestId: randomUUID(),
                name: 'Moved destination',
                description: '',
            })
            const moved = await json<PersonalTask>(`/tasks/${firstId}/project`, 'PUT', { projectId: destination.id })
            const renamed = await json<PersonalProject>(`/projects/${created.project.id}`, 'PUT', {
                name: 'Renamed instance',
                description: 'Later management fields.',
            })
            const changed = await json<ProjectTemplate>(`/templates/${template.id}`, 'PUT', {
                name: 'Edited blueprint',
                description: 'Next launch only.',
                tasks: [...template.tasks].reverse(),
                version: template.version,
            })
            await json(`/agents/${agent.id}`, 'PUT', {
                name: agent.name,
                description: '',
                modelId: agent.modelId,
                systemPrompt: 'Changed after launch.',
                toolIds: [],
                openingMessages: ['Changed greeting.'],
            })
            const legacyTask = await json<PersonalTask>('/tasks', 'POST', {
                requestId: randomUUID(),
                title: 'Ungrouped legacy',
                goal: 'Preserve compatibility.',
            })
            const ordinary = await json<{ id: string }>('/conversations', 'POST', { title: 'Legacy chat' })
            await stop(child)
            child = await boot(port, modelUrl)
            expect(await json(`/templates/${template.id}`)).toEqual(changed)
            expect(await json('/templates', 'POST', initial)).toEqual(changed)
            expect(await json(`/templates/${template.id}/launch`, 'POST', launch)).toEqual({ project: renamed, taskIds: created.taskIds })
            expect(await json(`/tasks/${firstId}`)).toEqual(moved)
            expect(moved.messages.map(message => message.content)).toEqual([
                'Original greeting.',
                initial.tasks[0]!.goal,
                'Persistent template reply.',
            ])
            expect((await json<ProjectDetail>(`/projects/${created.project.id}`)).tasks.map(task => task.id)).toEqual(
                created.taskIds.slice(1)
            )
            expect(await json(`/tasks/${legacyTask.id}`)).toEqual(legacyTask)
            expect((await call(`/conversations/${ordinary.id}`)).status).toBe(200)
            await stop(child)
            child = await boot(port, modelUrl, true)
            const temporary = await json<ProjectTemplate>('/templates', 'POST', {
                ...initial,
                requestId: randomUUID(),
                tasks: [{ id: randomUUID(), title: 'Temporary', goal: 'Only this process.' }],
            })
            const temporaryLaunch = await json<TemplateLaunchResult>(`/templates/${temporary.id}/launch`, 'POST', {
                ...launch,
                requestId: randomUUID(),
                version: temporary.version,
            })
            expect((await json<ProjectDetail>(`/projects/${temporaryLaunch.project.id}`)).tasks).toHaveLength(1)
            await stop(child)
            child = await boot(port, modelUrl, true)
            expect((await call(`/templates/${temporary.id}`)).status).toBe(404)
            expect((await call(`/projects/${temporaryLaunch.project.id}`)).status).toBe(404)
            expect(await json('/templates')).toEqual({ templates: [] })
        } finally {
            await stop(child)
            await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
        }
    },
    30_000
)
