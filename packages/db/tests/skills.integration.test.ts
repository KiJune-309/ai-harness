import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { SkillRecord } from '@ai-harness/contracts'
import { describe, expect, it } from 'vitest'
import {
    createChatStore,
    SkillAccessError,
    SkillConflictError,
    SkillValidationError,
    type ChatScope,
    type ChatStore,
} from '../src/index.js'

/**
 * Isolates real skill persistence, locks and failures across two application pools.
 * @param run - Assertions using actual stores and a schema-local administration pool.
 * @returns After every test-owned connection and schema has been removed.
 */
async function database(run: (first: ChatStore, second: ChatStore, pool: pg.Pool) => Promise<void>): Promise<void> {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const schema = `sf019_db_${randomUUID().replaceAll('-', '')}`
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const pool = new pg.Pool({ connectionString: url.toString() })
    let first: ChatStore | undefined
    let second: ChatStore | undefined
    try {
        first = await createChatStore({ databaseUrl: url.toString() })
        second = await createChatStore({ databaseUrl: url.toString() })
        await run(first, second, pool)
    } finally {
        await Promise.allSettled([first?.close(), second?.close(), pool.end()])
        await admin.query(`DROP SCHEMA ${schema} CASCADE`)
        await admin.end()
    }
}

/**
 * Creates a genuine account so legacy and explicit team authorization are both exercised.
 * @param store - Real application repository.
 * @returns Its private scope and verified current email.
 */
async function account(store: ChatStore) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const email = `${id}@example.test`
    const scope: ChatScope = { userId: id, workspaceId: 'sf019-home' }
    await store.accounts!.createUser({
        user: { id, username: 'Skills member', email, createdAt: now, updatedAt: now },
        passwordHash: 'isolated-test-verifier',
        workspaceId: scope.workspaceId,
        credentialVersion: 1,
    })
    return { scope, email }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('independent real PostgreSQL Skill acceptance', () => {
    it('commits one create/update across pools, returns immutable original replay and rejects stale competing edits', async () => {
        await database(async (first, second, pool) => {
            const { scope } = await account(first)
            const input = { requestId: randomUUID(), title: ' 同名 ', description: ' 说明 ', content: ' 第一行\n\n第二行 ' }
            const created = await Promise.all([first.skills!.create(scope, input), second.skills!.create(scope, input)])
            expect(created[0]).toEqual(created[1])
            expect(created[0]).toMatchObject({ id: input.requestId, version: 1, title: '同名', content: input.content.trim() })
            await expect(second.skills!.create(scope, { ...input, content: '异参数' })).rejects.toBeInstanceOf(SkillConflictError)
            const edit = { requestId: randomUUID(), version: 1, title: '同名', description: '', content: '第二版\n原换行' }
            const updated = await Promise.all([
                first.skills!.update(scope, input.requestId, edit),
                second.skills!.update(scope, input.requestId, edit),
            ])
            expect(updated[0]).toEqual(updated[1])
            expect(updated[0]!.version).toBe(2)
            await expect(first.skills!.update(scope, input.requestId, { ...edit, requestId: randomUUID() })).rejects.toBeInstanceOf(
                SkillConflictError
            )
            await expect(first.skills!.update(scope, input.requestId, { ...edit, content: '改重放参数' })).rejects.toBeInstanceOf(
                SkillConflictError
            )
            const raced = await Promise.allSettled([
                first.skills!.update(scope, input.requestId, { ...edit, requestId: randomUUID(), version: 2, content: '竞争一' }),
                second.skills!.update(scope, input.requestId, { ...edit, requestId: randomUUID(), version: 2, content: '竞争二' }),
            ])
            expect(raced.filter(result => result.status === 'fulfilled')).toHaveLength(1)
            expect(await second.skills!.create(scope, input)).toEqual(created[0])
            expect(await second.skills!.update(scope, input.requestId, edit)).toEqual(updated[0])
            expect(await first.skills!.get(scope, input.requestId, 1)).toEqual(created[0])
            expect((await second.skills!.versions(scope, input.requestId))!.map(version => version.version)).toEqual([3, 2, 1])
            expect(JSON.stringify(await first.skills!.list(scope))).not.toContain('竞争')
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_skills')).rows[0].n).toBe(1)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_skill_versions')).rows[0].n).toBe(3)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_skill_actions')).rows[0].n).toBe(3)
        })
    })

    it('rolls back failed version/action writes and does not turn missing storage into empty data', async () => {
        await database(async (first, second, pool) => {
            const { scope } = await account(first)
            const input = { requestId: randomUUID(), title: '失败保留', description: '', content: '完整正文' }
            await pool.query(
                "CREATE FUNCTION fail_skill_action() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''test owned failure''; END'"
            )
            await pool.query(
                'CREATE TRIGGER fail_skill_action BEFORE INSERT ON harness_skill_actions FOR EACH ROW EXECUTE FUNCTION fail_skill_action()'
            )
            await expect(first.skills!.create(scope, input)).rejects.toThrow('test owned failure')
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_skills')).rows[0].n).toBe(0)
            expect((await pool.query('SELECT count(*)::int AS n FROM harness_skill_versions')).rows[0].n).toBe(0)
            await pool.query('DROP TRIGGER fail_skill_action ON harness_skill_actions')
            const created = await first.skills!.create(scope, input)
            await pool.query('ALTER TABLE harness_skill_versions RENAME TO isolated_skill_versions')
            await expect(second.skills!.list(scope)).rejects.toThrow()
            await expect(second.skills!.resolve(scope, [{ skillId: created.id, version: 1 }])).rejects.toThrow()
            await pool.query('ALTER TABLE isolated_skill_versions RENAME TO harness_skill_versions')
            expect(await second.skills!.create(scope, input)).toEqual(created)
        })
    })

    it('keeps account/workspace histories private even from the team owner and rechecks removed members before replay', async () => {
        await database(async (first, second) => {
            const owner = await account(first)
            const member = await account(first)
            const input = { requestId: randomUUID(), title: '同名方法', description: '', content: 'PRIVATE_SKILL_NEVER_SHARE' }
            const home = await first.skills!.create(member.scope, input)
            const team = await first.workspaces!.create(owner.scope, { requestId: randomUUID(), name: '技能隔离', description: '' })
            const ownerScope = { ...owner.scope, workspaceId: team.id }
            const memberScope = { ...member.scope, workspaceId: team.id }
            const invitation = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await second.workspaces!.respond(member.scope, invitation.id, true)
            expect(await first.skills!.get(memberScope, home.id)).toBeUndefined()
            const own = await first.skills!.create(memberScope, { ...input, content: 'TEAM_PRIVATE_METHOD' })
            const now = new Date().toISOString()
            const agent = {
                id: randomUUID(),
                name: '本人团队技能Agent',
                description: '',
                modelId: 'fixture',
                systemPrompt: '',
                toolIds: [],
                openingMessages: [],
                skillSnapshots: await first.skills!.resolve(memberScope, [{ skillId: own.id, version: 1 }]),
                createdAt: now,
                updatedAt: now,
            }
            await first.agents!.save(memberScope, agent)
            expect(await second.agents!.get(ownerScope, agent.id)).toBeUndefined()
            expect(await second.skills!.get(ownerScope, own.id)).toBeUndefined()
            expect(await second.skills!.versions(ownerScope, own.id)).toBeUndefined()
            await expect(second.skills!.resolve(ownerScope, [{ skillId: own.id, version: 1 }])).rejects.toBeInstanceOf(SkillAccessError)
            await expect(
                second.skills!.update(ownerScope, own.id, { ...input, requestId: randomUUID(), version: 1 })
            ).rejects.toBeInstanceOf(SkillAccessError)
            await first.workspaces!.remove(ownerScope, team.id, member.scope.userId)
            await expect(second.agents!.get(memberScope, agent.id)).rejects.toBeInstanceOf(SkillAccessError)
            await expect(second.agents!.list(memberScope)).rejects.toBeInstanceOf(SkillAccessError)
            await expect(second.agents!.save(memberScope, agent)).rejects.toBeInstanceOf(SkillAccessError)
            await expect(second.skills!.get(memberScope, own.id)).rejects.toBeInstanceOf(SkillAccessError)
            await expect(second.skills!.create(memberScope, { ...input, content: 'TEAM_PRIVATE_METHOD' })).rejects.toBeInstanceOf(
                SkillAccessError
            )
            const rejoin = await first.workspaces!.invite(ownerScope, team.id, { requestId: randomUUID(), email: member.email })
            await second.workspaces!.respond(member.scope, rejoin.id, true)
            expect(await second.skills!.get(memberScope, own.id)).toEqual(own)
            expect(await second.agents!.get(memberScope, agent.id)).toEqual(agent)
            expect(await second.skills!.get(ownerScope, own.id)).toBeUndefined()
            await expect(first.skills!.list({ userId: randomUUID(), workspaceId: 'sf019-home' })).rejects.toBeInstanceOf(SkillAccessError)
        })
    })

    it('resolves exact ordered detached versions and enforces the combined body bound without guessing latest', async () => {
        await database(async (first, second) => {
            const { scope } = await account(first)
            const records: SkillRecord[] = []
            for (const size of [16000, 16000, 1, 1, 1])
                records.push(
                    await first.skills!.create(scope, {
                        requestId: randomUUID(),
                        title: '同名',
                        description: '',
                        content: '字'.repeat(size),
                    })
                )
            const refs = records
                .slice(0, 2)
                .reverse()
                .map(record => ({ skillId: record.id, version: 1 }))
            const frozen = await first.skills!.resolve(scope, refs)
            expect(frozen.map(snapshot => snapshot.skillId)).toEqual(refs.map(ref => ref.skillId))
            await first.skills!.update(scope, records[0]!.id, {
                requestId: randomUUID(),
                version: 1,
                title: '新标题',
                description: '',
                content: 'v2',
            })
            expect(await second.skills!.resolve(scope, refs)).toEqual(frozen)
            frozen[0]!.content = '篡改本地结果'
            expect((await second.skills!.resolve(scope, refs))[0]!.content).toHaveLength(16000)
            await expect(first.skills!.resolve(scope, [...refs, { skillId: records[2]!.id, version: 1 }])).rejects.toBeInstanceOf(
                SkillValidationError
            )
            await expect(first.skills!.resolve(scope, [{ skillId: records[0]!.id, version: 99 }])).rejects.toBeInstanceOf(SkillAccessError)
            expect(
                await first.skills!.resolve(
                    scope,
                    records.slice(0, 5).map(record => ({ skillId: record.id, version: record.id === records[0]!.id ? 2 : 1 }))
                )
            ).toHaveLength(5)
        })
    })
})
