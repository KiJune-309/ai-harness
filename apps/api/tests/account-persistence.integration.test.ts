import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { AccountModel, AccountUser, AgentDefinition, PersonalTask } from '@ai-harness/contracts'
import { createChatStore } from '@ai-harness/db'
import { expect, it } from 'vitest'

const token = 'sf005-isolated-persistence-private-server-token'
const encryptionKey = 'c'.repeat(64)
const fixtureKey = 'sf005-private-openai-fixture-key'

/**
 * Allocates a loopback port for a test-owned independent API process.
 * @returns An available loopback port.
 * @throws Error if the temporary socket cannot open or close.
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
 * Stops only a child API created by this test with a bounded shutdown fallback.
 * @param child - Test-owned API child.
 * @returns After its operating-system process exits.
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
 * Boots the production API artifact with real PostgreSQL and an explicitly allowed local provider.
 * @param port - Dedicated loopback API port.
 * @param providerOrigin - Administrator-controlled exact local model origin.
 * @returns Ready test-owned API process whose secret-bearing output remains suppressed.
 * @throws Error on early exit or readiness timeout.
 */
async function boot(port: number, providerOrigin: string): Promise<ChildProcess> {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../lib/main.js', import.meta.url))], {
        env: {
            ...process.env,
            HARNESS_API_TOKEN: token,
            ACCOUNT_ENCRYPTION_KEY: encryptionKey,
            OPENAI_ALLOWED_LOCAL_ORIGINS: providerOrigin,
            HARNESS_WORKSPACE_ID: 'sf005-persistence',
            DATABASE_URL: process.env.TEST_DATABASE_URL,
            CHAT_STORE: '',
            API_HOST: '127.0.0.1',
            API_PORT: String(port),
            DEEPSEEK_API_KEY: '',
        },
        stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error('Isolated account API exited during startup.')
        const response = await fetch(`http://127.0.0.1:${port}/api/account/me`, { headers: { authorization: `Bearer ${token}` } }).catch(
            () => undefined
        )
        if (response?.status === 401) {
            await response.body?.cancel()
            return child
        }
        await delay(100)
    }
    await stop(child)
    throw new Error('Isolated account API did not become ready.')
}

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'restores real accounts, encrypted personal models, sessions and executable Cordis task history across independent API processes',
    async () => {
        const requests: {
            path: string
            authorization: string | undefined
            body: { model: string; messages: { role: string; content: unknown }[] }
        }[] = []
        const provider = createServer(async (request, response) => {
            const buffers: Buffer[] = []
            for await (const chunk of request) buffers.push(Buffer.from(chunk))
            const body = JSON.parse(Buffer.concat(buffers).toString('utf8'))
            requests.push({ path: request.url ?? '', authorization: request.headers.authorization, body })
            const answer = requests.length === 1 ? 'Persistent private first reply.' : 'Persistent private continued reply.'
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
            )
        })
        provider.listen(0, '127.0.0.1')
        await once(provider, 'listening')
        const address = provider.address()
        assert(address && typeof address !== 'string')
        const origin = `http://127.0.0.1:${address.port}`
        const port = await availablePort()
        const initialEmail = `${randomUUID()}@example.com`,
            changedEmail = `${randomUUID()}@example.com`
        const initialPassword = 'Private original password ',
            changedPassword = 'Private changed password '
        let session = ''
        let child: ChildProcess | undefined
        /**
         * Calls one isolated API endpoint without logging credential-bearing headers or bodies.
         * @param path - Path below the API prefix.
         * @param method - HTTP operation.
         * @param body - Optional strict public request fields.
         * @param suppliedSession - Optional explicit session used for revocation checks.
         * @returns Unconsumed HTTP response.
         */
        async function call(path: string, method = 'GET', body?: unknown, suppliedSession = session): Promise<Response> {
            return fetch(`http://127.0.0.1:${port}/api${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${token}`,
                    ...(suppliedSession ? { 'x-harness-session': suppliedSession } : {}),
                    'content-type': 'application/json',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }
        /**
         * Parses a successful API response while keeping failed payloads out of diagnostics.
         * @param path - API resource path.
         * @param method - HTTP method.
         * @param body - Optional request fields.
         * @returns Safe typed public JSON result.
         */
        async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
            const response = await call(path, method, body)
            expect(response.ok).toBe(true)
            return response.json() as Promise<T>
        }
        /**
         * Logs into the isolated API and retains the opaque private response header in memory only.
         * @param email - Current normalized login email.
         * @param password - Current untrimmed password.
         * @returns Public user after actual scrypt verification.
         */
        async function login(email: string, password: string): Promise<AccountUser> {
            const response = await call('/account/login', 'POST', { email, password })
            expect(response.ok).toBe(true)
            session = response.headers.get('x-harness-session')!
            expect(Boolean(session)).toBe(true)
            return response.json() as Promise<AccountUser>
        }
        try {
            child = await boot(port, origin)
            const registered = await call('/account/register', 'POST', {
                username: 'Persistent owner',
                email: initialEmail,
                password: initialPassword,
            })
            expect(registered.status).toBe(201)
            session = registered.headers.get('x-harness-session')!
            const user = (await registered.json()) as AccountUser
            const initialSession = session
            const first = await json<AccountModel>('/account/models', 'POST', {
                requestId: randomUUID(),
                name: 'Primary personal provider',
                baseUrl: `${origin}/v1`,
                model: 'fixture-original',
                apiKey: fixtureKey,
            })
            const second = await json<AccountModel>('/account/models', 'POST', {
                requestId: randomUUID(),
                name: 'Secondary personal provider',
                baseUrl: `${origin}/v1`,
                model: 'fixture-secondary',
                apiKey: fixtureKey,
            })
            await json(`/account/models/${second.id}/default`, 'POST')
            await json(`/account/models/${first.id}/default`, 'POST')
            const model = await json<AccountModel>(`/account/models/${first.id}`, 'PUT', {
                name: 'Saved primary provider',
                baseUrl: `${origin}/v1`,
                model: 'fixture-current',
                apiKey: '',
            })
            expect(requests).toHaveLength(0)
            const agent = await json<AgentDefinition>('/chat/agents', 'POST', {
                name: 'Persistent personal agent',
                description: '',
                modelId: model.modelId,
                systemPrompt: 'Keep the original Cedar task context.',
                toolIds: ['calculator'],
                openingMessages: ['Original private greeting.'],
            })
            const task = await json<PersonalTask>('/chat/tasks', 'POST', {
                requestId: randomUUID(),
                title: 'Persistent personal task',
                goal: 'Remember Cedar and the number 37.',
                agentId: agent.id,
            })
            const started = await call(`/chat/tasks/${task.id}/start`, 'POST', { requestId: randomUUID() })
            expect(started.ok).toBe(true)
            expect(await started.text()).toContain('"type":"done"')
            expect(requests).toHaveLength(1)
            expect(requests[0]!.path).toBe('/v1/chat/completions')
            expect(requests[0]!.body.model).toBe('fixture-current')
            expect(requests[0]!.authorization === `Bearer ${fixtureKey}`).toBe(true)
            const renamed = await json<AccountUser>('/account/username', 'PUT', { username: 'Renamed persistent owner' })
            expect(renamed.id).toBe(user.id)
            await login(initialEmail, initialPassword)
            const secondSession = session
            await json('/account/email', 'PUT', { email: changedEmail, currentPassword: initialPassword })
            expect((await call('/account/me', 'GET', undefined, initialSession)).status).toBe(401)
            expect((await call('/account/me', 'GET', undefined, secondSession)).status).toBe(401)
            await login(changedEmail, initialPassword)
            const emailSession = session
            await json('/account/password', 'PUT', { currentPassword: initialPassword, newPassword: changedPassword })
            expect((await call('/account/me', 'GET', undefined, emailSession)).status).toBe(401)
            await login(changedEmail, changedPassword)
            const saved = await json<PersonalTask>(`/chat/tasks/${task.id}`)
            await stop(child)
            child = await boot(port, origin)
            const me = await json<{ user: AccountUser; storage: string }>('/account/me')
            expect(me).toMatchObject({
                user: { id: user.id, username: 'Renamed persistent owner', email: changedEmail },
                storage: 'postgres',
            })
            expect((await call('/account/login', 'POST', { email: initialEmail, password: initialPassword })).status).toBe(401)
            expect((await call('/account/login', 'POST', { email: changedEmail, password: initialPassword })).status).toBe(401)
            expect((await login(changedEmail, changedPassword)).id).toBe(user.id)
            const restored = await json<{ models: AccountModel[] }>('/account/models')
            expect(restored.models.find(candidate => candidate.id === model.id)).toEqual(model)
            expect(restored.models.filter(candidate => candidate.isDefault).map(candidate => candidate.id)).toEqual([model.id])
            expect(await json(`/chat/agents/${agent.id}`)).toEqual(agent)
            expect(await json(`/chat/tasks/${task.id}`)).toEqual(saved)
            const continuation = 'Continue the original Cedar task after restarting the API.'
            const continued = await call(`/chat/tasks/${task.id}/messages`, 'POST', {
                requestId: randomUUID(),
                content: continuation,
            })
            expect(continued.ok).toBe(true)
            expect(await continued.text()).toContain('"type":"done"')
            expect(requests).toHaveLength(2)
            const request = requests[1]!
            expect(request.path).toBe('/v1/chat/completions')
            expect(request.body.model).toBe('fixture-current')
            expect(request.authorization === `Bearer ${fixtureKey}`).toBe(true)
            const contents = request.body.messages.map(message => message.content)
            for (const content of [
                agent.systemPrompt,
                agent.openingMessages[0],
                task.task.goal,
                'Persistent private first reply.',
                continuation,
            ])
                expect(contents.filter(value => value === content)).toHaveLength(1)
            const after = await json<PersonalTask>(`/chat/tasks/${task.id}`)
            expect(after.agent).toEqual(agent)
            expect(after.messages.at(-1)?.content).toBe('Persistent private continued reply.')
            const inspector = await createChatStore({ databaseUrl: process.env.TEST_DATABASE_URL })
            try {
                const privateAccount = await inspector.accounts!.getById(user.id)
                const privateModel = await inspector.accounts!.getModel({ userId: user.id, workspaceId: 'sf005-persistence' }, model.id)
                expect(privateAccount!.passwordHash).toMatch(/^scrypt\$131072\$8\$1\$/)
                expect(privateAccount!.passwordHash.includes(changedPassword)).toBe(false)
                expect(privateModel!.encryptedApiKey.startsWith('v1.')).toBe(true)
                expect(JSON.stringify(privateModel).includes(fixtureKey)).toBe(false)
            } finally {
                await inspector.close()
            }
        } finally {
            await stop(child)
            await new Promise<void>((resolve, reject) => provider.close(error => (error ? reject(error) : resolve())))
        }
    },
    30000
)
