import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect, it } from 'vitest'
import type { PersonalTask, ProjectTemplate } from '@ai-harness/contracts'
import { createChatStore, type TemplateProjectBatch } from '../src/index.js'

it.skipIf(!process.env.TEST_DATABASE_URL)(
    'rolls back project, earlier tasks and launch after a real PostgreSQL later-task failure',
    async () => {
        const store = await createChatStore({ databaseUrl: process.env.TEST_DATABASE_URL })
        const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
        const scope = { userId: randomUUID(), workspaceId: 'sf004-transaction' }
        const now = new Date().toISOString()
        const requestId = randomUUID()
        const marker = `rollback-${randomUUID()}`
        const suffix = randomUUID().replaceAll('-', '')
        const trigger = `sf004_failure_${suffix}`
        const fixtureName = `sf004_trigger_${suffix}`
        const template: ProjectTemplate = {
            id: randomUUID(),
            version: 1,
            name: 'Real transaction',
            description: '',
            createdAt: now,
            updatedAt: now,
            tasks: [
                { id: randomUUID(), title: 'First successful insert', goal: 'First goal.' },
                { id: randomUUID(), title: marker, goal: 'Second insert fails.' },
                { id: randomUUID(), title: 'Third task', goal: 'Never become an orphan.' },
            ],
        }
        const taskIds = template.tasks.map(() => randomUUID())
        const tasks: PersonalTask[] = template.tasks.map((entry, index) => ({
            id: taskIds[index]!,
            title: entry.title,
            createdAt: now,
            updatedAt: now,
            messages: [],
            task: { goal: entry.goal, started: false, status: 'not-started', projectId: requestId, creationProjectId: requestId },
            agent: {
                id: randomUUID(),
                name: 'Frozen assistant',
                description: '',
                modelId: 'deepseek-flash',
                systemPrompt: 'Original prompt.',
                toolIds: [],
                openingMessages: [],
                createdAt: now,
                updatedAt: now,
            },
        }))
        const input = { name: 'Atomic project', description: '' }
        const batch: TemplateProjectBatch = {
            project: {
                project: {
                    id: requestId,
                    ...input,
                    createdAt: now,
                    updatedAt: now,
                    templateOrigin: { templateId: template.id, version: 1, taskIds },
                },
                creation: input,
            },
            tasks,
            launch: { requestId, templateId: template.id, version: 1, input, taskIds },
        }
        try {
            await store.templates!.save(scope, { template, creation: { name: template.name, description: '', tasks: template.tasks } })
            // Identifiers and title below are generated test-only alphanumeric values, never user input.
            await pool.query(
                `CREATE FUNCTION ${fixtureName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title = '${marker}' THEN RAISE EXCEPTION 'SF004 controlled second task failure'; END IF; RETURN NEW; END $$`
            )
            await pool.query(
                `CREATE TRIGGER ${trigger} BEFORE INSERT ON harness_chat_conversations FOR EACH ROW EXECUTE FUNCTION ${fixtureName}()`
            )
            await expect(store.instantiateTemplateProject!(scope, batch)).rejects.toThrow('SF004 controlled second task failure')
            expect(await store.projects!.list(scope)).toEqual([])
            expect(await store.list(scope)).toEqual([])
            expect(await store.templates!.getLaunch(scope, requestId)).toBeUndefined()
            await pool.query(`DROP TRIGGER ${trigger} ON harness_chat_conversations`)
            await store.instantiateTemplateProject!(scope, batch)
            expect(await store.projects!.get(scope, requestId)).toEqual(batch.project)
            expect((await store.list(scope)).map(task => task.id).sort()).toEqual([...taskIds].sort())
            expect(await store.templates!.getLaunch(scope, requestId)).toEqual(batch.launch)
        } finally {
            await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON harness_chat_conversations`)
            await pool.query(`DROP FUNCTION IF EXISTS ${fixtureName}()`)
            await pool.end()
            await store.close()
        }
    },
    30_000
)
