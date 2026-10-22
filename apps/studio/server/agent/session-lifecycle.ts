import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Context } from '../../lib/control/contracts';
import { ControlError } from '../control/service';
import type { AgentService } from './service';

// Built-ins only read workspace state or stage session-local plans/proposals.
// Accepted changes and workspace memories are checked separately below.
export const sessionLocalTools = [
  'workspace_describe_v1',
  'artifact_read_v1',
  'capability_search_v1',
  'ontology_validate_v1',
  'ontology_propose_v1',
  'process_propose_v1',
  'ask_user_v1',
  'ask_user_v2',
  'memory_search_v1',
  'agent_tool_search_v1',
  'memory_search_v2',
  'agent_result_read_v2',
  'agent_history_read_v1',
  'agent_memory_propose_v2',
  'agent_memory_propose_v1',
  'agent_result_read_v1',
  'agent_skill_read_v1',
  'agent_plan_v1',
  'agent_delegate_v1',
  'agent_task_status_v1',
  'agent_task_result_v1',
  'agent_code_v1',
];
const executing = ['queued', 'preparing', 'reasoning', 'executing_tool', 'waiting_for_tasks', 'uncertain'];
export class SessionLifecycle {
  constructor(private readonly service: AgentService) {}
  async list(ctx: Context, archived = false, sessionId?: string, client?: PoolClient) {
    const db = client ?? this.service.pool;
    const rows = (
      await db.query(
        `
      WITH RECURSIVE family(session_id,id) AS (
        SELECT session_id,id FROM wa_work_items WHERE workspace_id=$1
        UNION SELECT f.session_id,t.child_work_id FROM family f JOIN wa_agent_tasks t ON t.parent_work_id=f.id AND t.workspace_id=$1
      )
      SELECT s.id,s.title,s.edit_version AS "editVersion",s.updated_at AS "updatedAt",s.archived_at AS "archivedAt",
        EXISTS(SELECT 1 FROM family f JOIN wa_work_items w ON w.workspace_id=$1 AND w.id=f.id WHERE f.session_id=s.id AND w.state=ANY($4::text[]))
        OR EXISTS(SELECT 1 FROM wa_requests r WHERE r.workspace_id=$1 AND r.state='queued' AND (r.session_id=s.id OR r.payload->>'sessionId'=s.id OR r.payload->>'workItemId' IN (SELECT id FROM family WHERE session_id=s.id))) AS busy,
        EXISTS(SELECT 1 FROM family f JOIN wa_work_items w ON w.workspace_id=$1 AND w.id=f.id WHERE f.session_id=s.id AND w.request_context ? 'processActivity')
        OR EXISTS(SELECT 1 FROM wa_context_uploads u WHERE u.workspace_id=$1 AND u.session_id=s.id)
        OR EXISTS(SELECT 1 FROM family f JOIN wa_change_sets p ON p.workspace_id=$1 AND p.work_item_id=f.id WHERE f.session_id=s.id AND p.state='applied')
        OR EXISTS(SELECT 1 FROM family f JOIN wa_memories m ON m.workspace_id=$1 AND m.work_item_id=f.id WHERE f.session_id=s.id)
        OR EXISTS(SELECT 1 FROM family f JOIN wa_memory_entries m ON m.workspace_id=$1 AND m.origin_work_id=f.id WHERE f.session_id=s.id AND m.state IN ('approved','revoked'))
        OR EXISTS(SELECT 1 FROM family f JOIN wa_memory_proposals m ON m.workspace_id=$1 AND m.work_item_id=f.id WHERE f.session_id=s.id AND m.state='accepted')
        OR EXISTS(SELECT 1 FROM family f JOIN wa_tool_approvals a ON a.workspace_id=$1 AND a.work_item_id=f.id WHERE f.session_id=s.id AND a.consumed_call_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM family f JOIN wa_calls c ON c.workspace_id=$1 AND c.work_item_id=f.id WHERE f.session_id=s.id AND c.kind='tool' AND c.tool_effect='write' AND c.state<>'prepared') AS modified,
        EXISTS(SELECT 1 FROM family f JOIN wa_calls c ON c.workspace_id=$1 AND c.work_item_id=f.id WHERE f.session_id=s.id AND c.kind='tool' AND (c.state IN ('issued','uncertain') OR (c.tool_effect IS NULL AND NOT COALESCE(c.request->>'name'=ANY($5::text[]),false)))) AS unverified
      FROM wa_sessions s WHERE s.workspace_id=$1 AND s.deleted_at IS NULL
        AND ($3::text IS NOT NULL AND s.id=$3 OR $3::text IS NULL AND (s.archived_at IS NOT NULL)=$2)
      ORDER BY s.updated_at DESC,s.id LIMIT 100`,
        [ctx.workspace.id, archived, sessionId ?? null, executing, sessionLocalTools],
      )
    ).rows;
    return {
      items: rows.map(({ busy, modified, unverified, ...row }) => ({
        ...row,
        canDelete: !busy && !modified && !unverified,
        deleteBlockedReason: modified
          ? 'This conversation modified the workspace. Archive it to retain its history.'
          : busy
            ? 'Wait for work to finish or stop it before deleting.'
            : unverified
              ? 'Tool outcomes cannot be verified. Archive this conversation instead.'
              : null,
      })),
    };
  }
  async change(ctx: Context, sessionId: string, action: 'archive' | 'restore' | 'delete', input: unknown) {
    if (!['owner', 'admin', 'editor'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Workspace editor access is required.');
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(input);
    return this.service.control.transaction(async (c) => {
      const session = (
        await c.query('SELECT * FROM wa_sessions WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [
          ctx.workspace.id,
          sessionId,
        ])
      ).rows[0];
      if (!session) throw new ControlError(404, 'Agent session not found.');
      if (session.edit_version !== expectedVersion)
        throw new ControlError(409, 'Conversation changed. Refresh before trying again.');
      if (action === 'delete') {
        const policy = (await this.list(ctx, false, sessionId, c)).items[0];
        if (!policy.canDelete) throw new ControlError(409, policy.deleteBlockedReason!);
      }
      await c.query(
        `UPDATE wa_sessions SET ${action === 'delete' ? 'deleted_at=now()' : action === 'archive' ? 'archived_at=now()' : 'archived_at=NULL'},edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2`,
        [ctx.workspace.id, sessionId],
      );
      if (action !== 'restore')
        await c.query('DELETE FROM wa_agent_channels WHERE workspace_id=$1 AND session_id=$2', [
          ctx.workspace.id,
          sessionId,
        ]);
      if (action !== 'restore')
        await c.query('DELETE FROM wa_agent_channels_v2 WHERE workspace_id=$1 AND session_id=$2', [
          ctx.workspace.id,
          sessionId,
        ]);
      await this.service.control.audit(
        ctx,
        `agent.session_${action === 'delete' ? 'deleted' : action === 'archive' ? 'archived' : 'restored'}`,
        'agent_session',
        sessionId,
        {},
        c,
      );
      return { id: sessionId, action };
    });
  }
}
