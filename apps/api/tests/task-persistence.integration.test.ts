import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentDefinition, PersonalTask } from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import { registerSession } from './session-fixture.js'

const token = 'sf002-local-persistence-test-server-token-20261017'

/**
 * Reserve an available loopback port for an isolated API child.
 * @returns An unused ephemeral TCP port.
 * @throws Error when the local socket cannot be opened.
 */
async function availablePort(): Promise<number> {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert(address && typeof address !== 'string')
    const port = address.port
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    return port
}

/**
 * Stop a test-owned API process, allowing its Cordis and database shutdown hooks to drain.
 * @param child - Child process created exclusively for this integration test.
 * @returns After the child exits.
 */
async function stop(child: ChildProcess | undefined): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 4000)
    try {
        await exited
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * Boot the built application in a separate operating-system process against the test database.
 * @param port - Isolated HTTP port.
 * @param modelUrl - Deterministic native DeepSeek fixture endpoint.
 * @param defaults - Deployment defaults changed across the process restart.
 * @param memory - Supply the removed memory setting to verify that startup is rejected.
 * @returns A ready child API process.
 * @throws Error when startup cannot complete; diagnostics never contain credentials.
 */
async function boot(port: number, modelUrl: string, defaults: { model: string; prompt: string }, memory = false): Promise<ChildProcess> {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
        env: {
            ...process.env,
            HARNESS_API_TOKEN: token,
            ACCOUNT_ENCRYPTION_KEY: 'a'.repeat(64),
            OPENAI_ALLOWED_LOCAL_ORIGINS: modelUrl,
            HARNESS_WORKSPACE_ID: 'sf002-test',
            DATABASE_URL: memory ? '' : process.env.TEST_DATABASE_URL,
            CHAT_STORE: memory ? 'memory' : '',
            API_HOST: '127.0.0.1',
            API_PORT: String(port),
            DEEPSEEK_API_KEY: 'local-fixture-key',
            DEEPSEEK_BASE_URL: modelUrl,
            DEEPSEEK_MODEL: defaults.model,
            DEEPSEEK_SYSTEM_PROMPT: defaults.prompt,
        },
        stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error('Isolated API process exited during startup.')
        const response = await fetch(`http://127.0.0.1:${port}/api/account/me`, {
            headers: { authorization: `Bearer ${token}` },
        }).catch(() => undefined)
        if (response?.status === 401) {
            await response.body?.cancel()
            return child
        }
        await delay(100)
    }
    await stop(child)
    throw new Error('Isolated API process did not become ready.')
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'restores complete personal tasks after a real PostgreSQL-backed API process restart',
    async () => {
        const bodies: { model: string; messages: { role: string; content: string }[] }[] = []
        const provider = createServer(async (request, response) => {
            let body = ''
            for await (const chunk of request) body += String(chunk)
            bodies.push(JSON.parse(body))
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Saved task result.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
            )
        })
        provider.listen(0, '127.0.0.1')
        await once(provider, 'listening')
        const address = provider.address()
        assert(address && typeof address !== 'string')
        const providerUrl = `http://127.0.0.1:${address.port}`
        const port = await availablePort()
        const user = randomUUID()
        const sessions = new Map<string, string>()
        let child: ChildProcess | undefined
        /**
         * Call the isolated authenticated task API without exposing the database or provider credentials.
         * @param path - Public API path below /chat.
         * @param method - HTTP operation.
         * @param body - Optional JSON request.
         * @param identity - Optional alternate owner for isolation checks.
         * @returns The unconsumed HTTP response.
         */
        async function call(path: string, method = 'GET', body?: unknown, identity = user): Promise<Response> {
            let session = sessions.get(identity)
            if (!session) {
                session = await registerSession(`http://127.0.0.1:${port}`, token, identity)
                sessions.set(identity, session)
            }
            return fetch(`http://127.0.0.1:${port}/api/chat${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${token}`,
                    'x-harness-session': session,
                    'content-type': 'application/json',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }
        try {
            child = await boot(port, providerUrl, { model: 'deepseek-flash', prompt: 'Original deployment instructions.' })
            const agentInput = {
                name: 'Persistent research Agent',
                description: '',
                modelId: 'deepseek-flash',
                systemPrompt: 'Original custom instructions.',
                toolIds: ['calculator'],
                openingMessages: ['First greeting.', 'Second greeting.'],
            }
            const agentResponse = await call('/agents', 'POST', agentInput)
            expect(agentResponse.ok).toBe(true)
            const agent = (await agentResponse.json()) as AgentDefinition
            const input = {
                requestId: randomUUID(),
                title: 'Persistent task',
                goal: 'Remember project Cedar and calculate 6*7.',
                agentId: agent.id,
            }
            const created = await call('/tasks', 'POST', input)
            expect(created.ok).toBe(true)
            const task = (await created.json()) as PersonalTask
            const start = await call(`/tasks/${task.id}/start`, 'POST', { requestId: randomUUID() })
            expect(start.ok).toBe(true)
            expect(await start.text()).toContain('"type":"done"')
            await call(`/tasks/${task.id}/status`, 'PUT', { status: 'needs-input' }).then(response => response.text())
            await call(`/tasks/${task.id}/status`, 'PUT', { status: 'completed' }).then(response => response.text())
            const baseline = (await (await call(`/tasks/${task.id}`)).json()) as PersonalTask
            expect(baseline.task).toMatchObject({ started: true, status: 'completed', previousStatus: 'needs-input' })
            expect(baseline.messages.map(message => message.content)).toEqual([
                'First greeting.',
                'Second greeting.',
                input.goal,
                'Saved task result.',
            ])
            const defaultTask = (await (
                await call('/tasks', 'POST', {
                    requestId: randomUUID(),
                    title: 'Default snapshot',
                    goal: 'Preserve the default configuration.',
                })
            ).json()) as PersonalTask
            await call(`/agents/${agent.id}`, 'PUT', { ...agentInput, systemPrompt: 'Changed custom instructions.', toolIds: [] }).then(
                response => response.text()
            )
            await stop(child)
            child = await boot(port, providerUrl, { model: 'deepseek-v4-pro', prompt: 'Changed deployment instructions.' })
            const restored = (await (await call(`/tasks/${task.id}`)).json()) as PersonalTask
            expect(restored).toEqual(baseline)
            expect(((await (await call(`/tasks/${defaultTask.id}`)).json()) as PersonalTask).agent).toEqual(defaultTask.agent)
            expect((await call(`/tasks/${task.id}`, 'GET', undefined, randomUUID())).status).toBe(404)
            expect((await call(`/conversations/${task.id}`)).status).toBe(404)
            expect(await (await call('/conversations')).json()).toEqual({ conversations: [] })
            const blocked = await call(`/tasks/${task.id}/messages`, 'POST', {
                requestId: randomUUID(),
                content: 'Cannot continue completed task.',
            })
            expect(blocked.status).toBe(409)
            const resumed = (await (await call(`/tasks/${task.id}/status`, 'PUT', { restore: true })).json()) as PersonalTask
            expect(resumed.task.status).toBe('needs-input')
            expect(resumed.messages).toEqual(baseline.messages)
            const followup = await call(`/tasks/${task.id}/messages`, 'POST', {
                requestId: randomUUID(),
                content: 'Explain the earlier result.',
            })
            expect(await followup.text()).toContain('"type":"done"')
            expect(bodies).toHaveLength(2)
            expect(bodies[1]?.model).toBe('deepseek-flash')
            expect(bodies[1]?.messages[0]?.content).toBe('Original custom instructions.')
            expect(bodies[1]?.messages.some(message => message.role === 'user' && message.content === input.goal)).toBe(true)
            await stop(child)
            await expect(boot(port, providerUrl, { model: 'deepseek-flash', prompt: 'Memory test.' }, true)).rejects.toThrow(
                'exited during startup'
            )
        } finally {
            await stop(child)
            await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
        }
    },
    30_000
)
