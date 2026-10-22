import type pg from 'pg'
import type { ChatScope } from './index.js'
import { workspaceAccess } from './workspaces.js'

/**
 * Installs a content-free deletion barrier for late snapshots and retried creation actions.
 * @param client - Schema initialization transaction.
 * @returns After the durable identity barrier and write guard exist.
 * @throws Error when PostgreSQL cannot install the deletion guard.
 */
export async function initializeConversationDeletion(client: Pick<pg.PoolClient, 'query'>): Promise<void> {
    await client.query(`CREATE TABLE IF NOT EXISTS harness_deleted_conversations (
        workspace_id text NOT NULL,user_id text NOT NULL,id uuid NOT NULL,deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(workspace_id,user_id,id)
    )`)
    await client.query(`CREATE OR REPLACE FUNCTION harness_reject_deleted_conversation() RETURNS trigger AS $$
        BEGIN
            PERFORM pg_advisory_xact_lock(hashtextextended(json_build_array(NEW.workspace_id,NEW.user_id,NEW.id)::text, 24));
            IF EXISTS(SELECT 1 FROM harness_deleted_conversations d
                WHERE d.workspace_id=NEW.workspace_id AND d.user_id=NEW.user_id AND d.id=NEW.id) THEN
                RAISE EXCEPTION 'Conversation was deleted.' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`)
    await client.query('DROP TRIGGER IF EXISTS harness_deleted_conversation_guard ON harness_chat_conversations')
    await client.query(`CREATE TRIGGER harness_deleted_conversation_guard BEFORE INSERT OR UPDATE ON harness_chat_conversations
        FOR EACH ROW EXECUTE FUNCTION harness_reject_deleted_conversation()`)
}

/**
 * Deletes one ordinary private chat and its exact execution records without recalling delivered messages.
 * @param pool - Initialized application PostgreSQL pool.
 * @param scope - Real authenticated account and currently authorized workspace.
 * @param id - Exact ordinary conversation identity chosen by its owner.
 * @returns Whether this scope deleted the chat, including a matching repeated deletion.
 * @throws Error when authorization or persistence fails; all deletions roll back together.
 */
export async function deletePostgresConversation(pool: pg.Pool, scope: ChatScope, id: string): Promise<boolean> {
    const client = await pool.connect()
    const values = [scope.workspaceId, scope.userId, id]
    try {
        await client.query('BEGIN')
        if (!(await workspaceAccess(client, scope, true))) throw new Error('Conversation workspace is unavailable.')
        // The durable worker takes the aggregate lock before source/job locks at every write barrier.
        await client.query('SELECT workspace_id FROM harness_collaboration_state WHERE workspace_id=$1 FOR UPDATE', [scope.workspaceId])
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended(json_build_array($1::text,$2::text,$3::uuid)::text, 24))', values)
        const existing = await client.query<{ task_data: unknown }>(
            'SELECT task_data FROM harness_chat_conversations WHERE workspace_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE',
            values
        )
        if (!existing.rowCount || existing.rows[0].task_data) {
            const previous = await client.query(
                'SELECT 1 FROM harness_deleted_conversations WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
                values
            )
            await client.query('COMMIT')
            return !existing.rowCount && Boolean(previous.rowCount)
        }
        await client.query(
            'SELECT source_id FROM harness_collaboration_sources WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3 FOR UPDATE',
            values
        )
        await client.query(
            'INSERT INTO harness_deleted_conversations(workspace_id,user_id,id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            values
        )
        await client.query('DELETE FROM harness_collaboration_dispatches WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3', values)
        await client.query('DELETE FROM harness_workflow_contact_intents WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3', values)
        await client.query(
            `DELETE FROM harness_collaboration_job_intents WHERE
            job_id IN (SELECT id FROM harness_collaboration_jobs WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3)
            OR intent_id IN (SELECT id FROM harness_collaboration_contact_intents WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3)`,
            values
        )
        // Human decisions cascade with their exact requests/jobs. Deleting jobs fences every old lease.
        await client.query('DELETE FROM harness_collaboration_jobs WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3', values)
        await client.query(
            'DELETE FROM harness_collaboration_contact_intents WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3',
            values
        )
        await client.query('DELETE FROM harness_collaboration_thread_sources WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3', values)
        await client.query('DELETE FROM harness_collaboration_sources WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3', values)
        await client.query('DELETE FROM harness_chat_conversations WHERE workspace_id=$1 AND user_id=$2 AND id=$3', values)
        await client.query('COMMIT')
        return true
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}
