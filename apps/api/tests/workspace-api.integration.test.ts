import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type {
    AccountModel,
    AccountUser,
    ChatConversation,
    TeamWorkspace,
    WorkspaceDetail,
    WorkspaceDirectory,
    WorkspaceInvitation,
} from '@ai-harness/contracts'
import { createChatStore } from '@ai-harness/db'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { expect, it, vi } from 'vitest'
import { createApiApp } from '../src/app.js'
import { readTestApiConfig } from './config-fixture.js'

const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as typeof import('pg')

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'enforces real HTTP sessions, workspace roles, isolation, removal, restart and database outage boundaries',
    async () => {
        const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const schema = `sf015_api_${randomUUID().replaceAll('-', '')}`
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.searchParams.set('options', `-c search_path=${schema}`)
        const config = readTestApiConfig({
            HARNESS_API_TOKEN: 'sf015-private-http-isolated-token-32bytes',
            HARNESS_WORKSPACE_ID: 'sf015-home',
            DATABASE_URL: url.toString(),
            DEEPSEEK_API_KEY: 'sf015-private-system-fixture-key',
        })
        const modelTester = vi.fn(async () => {})
        const people = new Map<string, { user: AccountUser; session: string; email: string }>()
        let app: NestExpressApplication | undefined
        let base = ''

        /**
         * Opens a new actual API and fresh connection pool against the retained schema.
         * @returns After the HTTP listener is ready.
         */
        async function boot(): Promise<void> {
            app = await createApiApp(config, {
                logger: false,
                testAccountModel: modelTester,
                collaborationWorkerOptions: { enabled: false },
                vectorWorkerOptions: { enabled: false },
                knowledgeWorkerOptions: { enabled: false },
                knowledgeObjectStore: {
                    /**
                     * Rejects unexpected object writes in this metadata-only isolation test.
                     * @returns A rejected operation because no source upload is expected.
                     * @throws Error for an unexpected upload.
                     */
                    async put() {
                        throw new Error('Unexpected metadata-test source upload.')
                    },
                    /**
                     * Rejects unexpected object reads in this metadata-only isolation test.
                     * @returns A rejected operation because metadata does not read source bytes.
                     * @throws Error for an unexpected source read.
                     */
                    async get() {
                        throw new Error('Unexpected metadata-test source read.')
                    },
                    /**
                     * Completes the explicitly injected object's test lifecycle.
                     * @returns Nothing after the fixture is released.
                     */
                    async close() {},
                },
            })
            await app.listen(0, '127.0.0.1')
            base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`
        }

        /**
         * Calls actual guarded routes with a real server-issued account session.
         * @param person - Named test account, or empty for unauthenticated requests.
         * @param path - Public API route.
         * @param body - Optional strict public mutation body.
         * @param method - HTTP verb.
         * @param extra - Additional untrusted headers for stale-page and impersonation checks.
         * @returns Unconsumed HTTP response.
         */
        async function call(
            person: string,
            path: string,
            body?: unknown,
            method = body === undefined ? 'GET' : 'POST',
            extra: Record<string, string> = {}
        ): Promise<Response> {
            const session = people.get(person)?.session
            return fetch(`${base}/${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${config.token}`,
                    'content-type': 'application/json',
                    ...(session ? { 'x-harness-session': session } : {}),
                    ...extra,
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        }

        /**
         * Reads confirmed public JSON while keeping credential-bearing failures private.
         * @param person - Named real account.
         * @param path - API route.
         * @param body - Optional mutation fields.
         * @param method - HTTP verb.
         * @returns Confirmed typed public response.
         */
        async function json<T>(person: string, path: string, body?: unknown, method?: string): Promise<T> {
            const response = await call(person, path, body, method)
            expect(response.ok, `${method ?? 'GET/POST'} ${path}`).toBe(true)
            return response.json() as Promise<T>
        }

        try {
            await admin.query(`CREATE SCHEMA ${schema}`)
            await boot()
            for (const name of ['Owner', 'Member', 'Outsider']) {
                const email = `${randomUUID()}@example.test`
                const response = await call('', 'account/register', { username: name, email, password: 'Workspace test password 42' })
                expect(response.status).toBe(201)
                people.set(name, {
                    email,
                    user: (await response.json()) as AccountUser,
                    session: response.headers.get('x-harness-session')!,
                })
            }
            const owner = people.get('Owner')!
            const member = people.get('Member')!
            expect((await call('', 'account/workspaces', undefined, 'GET', { 'x-harness-user-id': owner.user.id })).status).toBe(401)
            for (const invalid of [
                { name: '', description: '' },
                { name: ' '.repeat(2), description: '' },
                { name: '长'.repeat(61), description: '' },
                { name: '长度', description: '长'.repeat(501) },
            ])
                expect((await call('Owner', 'account/workspaces', { ...invalid, requestId: randomUUID() })).status).toBe(400)
            const homeModel = await json<AccountModel>('Owner', 'account/models', {
                requestId: randomUUID(),
                name: '仅默认空间',
                baseUrl: 'https://example.test/v1',
                model: 'private-model',
                apiKey: 'private-owner-key',
            })
            const oldChat = await json<ChatConversation>('Owner', 'chat/conversations', { title: '默认私有记录' })
            const oldAgent = await json<{ id: string }>('Owner', 'chat/agents', {
                name: '默认私有 Agent',
                description: '',
                modelId: homeModel.modelId,
                systemPrompt: '仅本人默认范围可见',
                toolIds: [],
                openingMessages: [],
            })
            const oldTask = await json<{ id: string }>('Owner', 'chat/tasks', {
                requestId: randomUUID(),
                title: '默认任务',
                goal: '不执行的原有目标',
            })
            const oldProject = await json<{ id: string }>('Owner', 'chat/projects', {
                requestId: randomUUID(),
                name: '默认项目',
                description: '原有私有描述',
            })
            const oldTemplate = await json<{ id: string }>('Owner', 'chat/templates', {
                requestId: randomUUID(),
                name: '默认任务模板',
                description: '',
                tasks: [{ id: randomUUID(), title: '任务节点', goal: '保留本人目标' }],
            })
            const oldEmbedding = await json<{ id: string }>('Owner', 'account/embedding-models', {
                requestId: randomUUID(),
                name: '默认向量连接',
                baseUrl: 'https://example.test/v1',
                model: 'private-embedding',
                apiKey: 'private-embedding-key',
            })
            const oldDocument = {
                id: randomUUID(),
                fileName: '默认私有资料.txt',
                format: 'txt' as const,
                size: 5,
                status: 'queued' as const,
                chunkSize: 1000,
                overlap: 200,
                characterCount: 0,
                chunkCount: 0,
                attempt: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
            const seedStore = await createChatStore({ databaseUrl: url.toString() })
            try {
                await seedStore.knowledge!.create(
                    { userId: owner.user.id, workspaceId: config.workspaceId },
                    {
                        document: oldDocument,
                        objectKey: 'isolated/private-object',
                        sha256: 'a'.repeat(64),
                        fingerprint: 'b'.repeat(64),
                    },
                    async () => {}
                )
            } finally {
                await seedStore.close()
            }
            const scopedPaths = [
                ['chat/agents', 'agents', `chat/agents/${oldAgent.id}`],
                ['chat/tasks', 'tasks', `chat/tasks/${oldTask.id}`],
                ['chat/projects', 'projects', `chat/projects/${oldProject.id}`],
                ['chat/templates', 'templates', `chat/templates/${oldTemplate.id}`],
                ['account/embedding-models', 'models', `account/embedding-models/${oldEmbedding.id}`],
                ['knowledge/documents', 'documents', `knowledge/documents/${oldDocument.id}`],
            ] as const
            const input = { requestId: randomUUID(), name: '长'.repeat(60), description: '说'.repeat(500) }
            const teams = await Promise.all([
                json<TeamWorkspace>('Owner', 'account/workspaces', input),
                json<TeamWorkspace>('Owner', 'account/workspaces', input),
            ])
            const team = teams[0]!
            expect(teams[1]).toEqual(team)
            const teamRoute = `account/workspaces/${team.id}`
            expect((await json<WorkspaceDirectory>('Owner', 'account/workspaces')).workspaces).toHaveLength(2)
            expect((await json<WorkspaceDirectory>('Member', 'account/workspaces')).workspaces).toHaveLength(1)
            expect((await call('Member', teamRoute)).status).toBe(403)
            expect((await call('Member', `${teamRoute}/switch`, {})).status).toBe(403)
            const invitation = await json<WorkspaceInvitation>('Owner', `${teamRoute}/invitations`, {
                requestId: randomUUID(),
                email: ` ${member.email.toUpperCase()} `,
            })
            expect(invitation.email).toBe(member.email)
            expect((await json<WorkspaceDetail>('Owner', teamRoute)).members).toHaveLength(1)
            expect(
                (await call('Owner', `${teamRoute}/invitations`, { requestId: randomUUID(), email: `${randomUUID()}@example.test` })).status
            ).toBe(409)
            expect((await call('Owner', `${teamRoute}/invitations`, { requestId: randomUUID(), email: owner.email })).status).toBe(409)
            expect((await call('Owner', `${teamRoute}/invitations`, { requestId: randomUUID(), email: member.email })).status).toBe(409)
            expect((await json<WorkspaceDirectory>('Member', 'account/workspaces')).invitations).toMatchObject([
                { id: invitation.id, inviterName: 'Owner' },
            ])
            const respondRoute = `account/workspaces/invitations/${invitation.id}/respond`
            expect((await call('Outsider', respondRoute, { accept: true })).status).toBe(403)
            const accepts = await Promise.all([
                call('Member', respondRoute, { accept: true }),
                call('Member', respondRoute, { accept: true }),
            ])
            expect(accepts.every(response => response.ok)).toBe(true)
            expect((await json<{ workspaceId: string }>('Member', 'account/me')).workspaceId).toBe(config.workspaceId)
            expect((await json<WorkspaceDetail>('Member', teamRoute)).invitations).toEqual([])
            expect((await call('Member', teamRoute, { name: '越权', description: '' }, 'PUT')).status).toBe(403)
            expect((await call('Member', `${teamRoute}/invitations`, { requestId: randomUUID(), email: owner.email })).status).toBe(403)
            expect((await call('Member', `${teamRoute}/invitations/${invitation.id}`, undefined, 'DELETE')).status).toBe(403)
            expect((await call('Owner', `${teamRoute}/invitations`, { requestId: randomUUID(), email: member.email })).status).toBe(409)
            expect((await call('Member', `${teamRoute}/members/${owner.user.id}`, undefined, 'DELETE')).status).toBe(403)
            expect((await call('Owner', `${teamRoute}/leave`, {})).status).toBe(409)
            expect((await call('Owner', `${teamRoute}/members/${owner.user.id}`, undefined, 'DELETE')).status).toBe(409)
            expect(
                await json<TeamWorkspace>('Owner', teamRoute, { name: '已更新的团队名称', description: '已更新的团队说明' }, 'PUT')
            ).toMatchObject({ name: '已更新的团队名称' })
            expect((await json<WorkspaceDetail>('Owner', teamRoute)).workspace.description).toBe('已更新的团队说明')
            await json('Owner', `${teamRoute}/switch`, {})
            const newLogin = await call('', 'account/login', { email: owner.email, password: 'Workspace test password 42' })
            expect(newLogin.ok).toBe(true)
            const newSession = newLogin.headers.get('x-harness-session')!
            const freshAccount = await call('Owner', 'account/me', undefined, 'GET', { 'x-harness-session': newSession })
            expect(((await freshAccount.json()) as { workspaceId: string }).workspaceId).toBe(config.workspaceId)
            expect((await json<{ workspaceId: string }>('Owner', 'account/me')).workspaceId).toBe(team.id)
            expect((await json<{ models: AccountModel[] }>('Owner', 'account/models')).models).toEqual([])
            expect((await json<{ conversations: ChatConversation[] }>('Owner', 'chat/conversations')).conversations).toEqual([])
            expect((await call('Owner', `chat/conversations/${oldChat.id}`)).status).toBe(404)
            for (const [listPath, collection, detailPath] of scopedPaths) {
                expect((await json<Record<string, unknown[]>>('Owner', listPath))[collection]).toEqual([])
                expect((await call('Owner', detailPath)).status, detailPath).toBe(404)
            }
            expect((await call('Owner', `knowledge/documents/${oldDocument.id}/index`)).status).toBe(404)
            const stale = await call('Owner', 'chat/conversations', { title: '旧标签页写入' }, 'POST', {
                'x-harness-context': config.workspaceId,
            })
            expect(stale.status).toBe(409)
            expect(stale.headers.get('x-harness-context-changed')).toBe('1')
            const teamModel = await json<AccountModel>('Owner', 'account/models', {
                requestId: randomUUID(),
                name: '团队个人连接',
                baseUrl: 'https://example.test/v1',
                model: 'team-private',
                apiKey: 'private-team-key',
            })
            const teamChat = await json<ChatConversation>('Owner', 'chat/conversations', { title: '团队本人记录' })
            await json('Member', `${teamRoute}/switch`, {})
            expect((await call('Member', `chat/conversations/${teamChat.id}`)).status).toBe(404)
            expect((await json<{ models: AccountModel[] }>('Member', 'account/models')).models).toEqual([])
            expect((await call('Member', `account/models/${teamModel.id}`, undefined, 'DELETE')).status).toBe(404)
            const memberChat = await json<ChatConversation>('Member', 'chat/conversations', { title: '成员自己的历史' })
            expect(memberChat.agent?.modelId.startsWith('account:')).toBe(false)
            expect((await call('Owner', `chat/conversations/${memberChat.id}`)).status).toBe(404)
            await app!.close()
            app = undefined
            await boot()
            expect((await json<{ workspaceId: string }>('Owner', 'account/me')).workspaceId).toBe(team.id)
            expect((await json<WorkspaceDetail>('Owner', teamRoute)).members).toHaveLength(2)
            expect(await json<ChatConversation>('Member', `chat/conversations/${memberChat.id}`)).toMatchObject({ id: memberChat.id })
            await json('Owner', `${teamRoute}/members/${member.user.id}`, undefined, 'DELETE')
            const revoked = await call('Member', `chat/conversations/${memberChat.id}`, undefined, 'GET', { 'x-harness-context': team.id })
            expect(revoked.status).toBe(409)
            expect((await json<{ workspaceId: string }>('Member', 'account/me')).workspaceId).toBe(config.workspaceId)
            expect((await call('Member', teamRoute)).status).toBe(403)
            expect((await call('Member', `${teamRoute}/switch`, {})).status).toBe(403)
            expect((await json<{ people: unknown[] }>('Owner', 'chat/collaboration/people?q=Member')).people).toEqual([])
            const rejoin = await json<WorkspaceInvitation>('Owner', `${teamRoute}/invitations`, {
                requestId: randomUUID(),
                email: member.email,
            })
            await json('Member', `account/workspaces/invitations/${rejoin.id}/respond`, { accept: true })
            expect((await json<{ workspaceId: string }>('Member', 'account/me')).workspaceId).toBe(config.workspaceId)
            await json('Member', `${teamRoute}/switch`, {})
            expect(await json<ChatConversation>('Member', `chat/conversations/${memberChat.id}`)).toMatchObject({ id: memberChat.id })
            await json('Member', `${teamRoute}/leave`, {})
            expect((await json<{ workspaceId: string }>('Member', 'account/me')).workspaceId).toBe(config.workspaceId)
            await json('Owner', `account/workspaces/${config.workspaceId}/switch`, {})
            expect((await json<{ models: AccountModel[] }>('Owner', 'account/models')).models).toMatchObject([{ id: homeModel.id }])
            expect(await json<ChatConversation>('Owner', `chat/conversations/${oldChat.id}`)).toMatchObject({ id: oldChat.id })
            for (const [listPath, collection, detailPath] of scopedPaths) {
                expect((await json<Record<string, unknown[]>>('Owner', listPath))[collection]).toHaveLength(1)
                expect((await call('Owner', detailPath)).status, detailPath).toBe(200)
            }
            expect((await call('Owner', `chat/conversations/${teamChat.id}`)).status).toBe(404)
            const pending = await json<WorkspaceInvitation>('Owner', `${teamRoute}/invitations`, {
                requestId: randomUUID(),
                email: member.email,
            })
            await app!.close()
            app = undefined
            await boot()
            expect((await json<WorkspaceDirectory>('Member', 'account/workspaces')).invitations).toMatchObject([{ id: pending.id }])
            expect(modelTester).not.toHaveBeenCalled()
            const failure = new pg.Pool({ connectionString: url.toString() })
            try {
                await failure.query('ALTER TABLE harness_workspaces RENAME TO sf015_outage_workspaces')
                expect((await call('Owner', 'account/workspaces')).status).toBe(503)
                expect((await call('Owner', 'chat/conversations')).status).toBe(503)
            } finally {
                await failure.query('ALTER TABLE sf015_outage_workspaces RENAME TO harness_workspaces')
                await failure.end()
            }
            expect((await json<WorkspaceDirectory>('Owner', 'account/workspaces')).workspaces).toHaveLength(2)
        } finally {
            await app?.close()
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
            await admin.end()
        }
    },
    60000
)
