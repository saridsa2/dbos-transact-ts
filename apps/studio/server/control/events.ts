import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import type { WorkspaceNotification } from '../../lib/control/contracts';
import { z } from 'zod';
import { ControlError, type ControlPlane } from './service';

const titles: Record<string, string> = {
  'run.requested': 'Workflow execution queued',
  'run.started': 'Workflow execution started',
  'run.completed': 'Workflow execution completed',
  'run.failed': 'Workflow execution failed',
  'run.waiting': 'Workflow is waiting for input',
  'run.resumed': 'Workflow execution resumed',
  'run.debounced': 'Debounced execution submitted',
  'workflow.saved': 'Workflow saved',
  'connection.created': 'Connection added',
  'connection.updated': 'Connection updated',
  'connection.revoked': 'Connection access revoked',
  'credential.rotated': 'Connection credential rotated',
  'member.invited': 'Workspace invitation created',
  'member.role_changed': 'Workspace role updated',
  'member.removed': 'Workspace membership updated',
  'invitation.accepted': 'A member joined the workspace',
  'invitation.revoked': 'Workspace invitation revoked',
  'workspace.created': 'Workspace created',
  'review.decided': 'Workflow review completed',
};
const notification = (row: any): WorkspaceNotification => ({
  id: row.id,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  kind: row.entity_type === 'run' ? 'execution' : 'workspace',
  title: titles[row.action] ?? 'Workspace updated',
  resourceName: row.resource_name ?? undefined,
  readAt: row.read_at ? new Date(row.read_at).toISOString() : undefined,
  createdAt: new Date(row.created_at).toISOString(),
});
export class WorkspaceEvents {
  private emitter = new EventEmitter();
  private client?: PoolClient;
  private reconnect?: ReturnType<typeof setTimeout>;
  private stopped = false;
  constructor(private pool: Pool) {
    this.emitter.setMaxListeners(0);
  }
  async start() {
    if (this.stopped) return;
    const client = await this.pool.connect();
    this.client = client;
    client.on('notification', ({ payload }) => {
      if (payload) this.emitter.emit(payload);
    });
    const lost = () => {
      if (this.client !== client) return;
      this.client = undefined;
      client.release(true);
      if (!this.stopped) this.reconnect = setTimeout(() => void this.start().catch(lostAgain), 1000);
    };
    const lostAgain = () => {
      if (!this.stopped) this.reconnect = setTimeout(() => void this.start().catch(lostAgain), 1000);
    };
    client.on('error', lost);
    client.on('end', lost);
    try {
      await client.query('LISTEN stackplane_workspace_events');
    } catch (error) {
      lost();
      throw error;
    }
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.reconnect);
    const client = this.client;
    this.client = undefined;
    client?.release(true);
    this.emitter.removeAllListeners();
  }
  async list(workspaceId: string, after?: string, limit = 30, notificationsOnly = false, userId?: string) {
    const rows = await this.pool.query(
      `SELECT e.id::text,e.action,e.entity_type,e.entity_id,e.created_at,
       COALESCE(r.flow_name,f.graph->>'name',c.name) AS resource_name,n.read_at
       FROM cp_workspace_events e
       LEFT JOIN studio_runs r ON e.entity_type='run' AND r.id=e.entity_id AND r.workspace_id=e.workspace_id
       LEFT JOIN studio_flows f ON e.entity_type='workflow' AND f.id=e.entity_id AND f.workspace_id=e.workspace_id
       LEFT JOIN cp_connections c ON e.entity_type='connection' AND c.id=e.entity_id AND c.workspace_id=e.workspace_id
       LEFT JOIN cp_notification_reads n ON n.event_id=e.id AND n.user_id=$5
       WHERE e.workspace_id=$1 AND ($2::bigint IS NULL OR e.id>$2::bigint) AND (NOT $4::boolean OR action <> 'execution.progress')
       ORDER BY e.id ${after === undefined ? 'DESC' : 'ASC'} LIMIT $3`,
      [workspaceId, after ?? null, limit, notificationsOnly, userId ?? null],
    );
    return rows.rows.map(notification);
  }
  async markRead(workspaceId: string, userId: string, input: unknown) {
    const { ids } = z
      .object({
        ids: z
          .array(
            z
              .string()
              .regex(/^\d{1,19}$/)
              .refine((id) => /^\d+$/.test(id) && BigInt(id) <= 9223372036854775807n),
          )
          .min(1)
          .max(30),
      })
      .strict()
      .parse(input);
    const result = await this.pool.query(
      `INSERT INTO cp_notification_reads(user_id,event_id)
       SELECT $1,e.id FROM cp_workspace_events e WHERE e.workspace_id=$2 AND e.id=ANY($3::bigint[]) AND e.action <> 'execution.progress'
       ON CONFLICT(user_id,event_id) DO UPDATE SET read_at=cp_notification_reads.read_at
       RETURNING event_id::text AS id, read_at AS "readAt"`,
      [userId, workspaceId, ids],
    );
    return result.rows;
  }
  async stream(request: IncomingMessage, response: ServerResponse, control: ControlPlane, url: URL) {
    const ctx = await control.context(request);
    if (url.searchParams.get('workspace') !== ctx.workspace.id) throw new ControlError(403, 'Workspace access denied.');
    const cursor = request.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0';
    if (typeof cursor !== 'string' || !/^\d{1,20}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n)
      throw new ControlError(400, 'Invalid event cursor.');
    let after = cursor,
      closed = false,
      pumping = false,
      pending = false;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 1500\n\n');
    const pump = async () => {
      if (closed) return;
      if (pumping) {
        pending = true;
        return;
      }
      pumping = true;
      try {
        do {
          pending = false;
          const current = await control.context(request);
          if (current.workspace.id !== ctx.workspace.id || current.workspace.role !== ctx.workspace.role)
            throw new ControlError(403, 'Workspace access changed.');
          let batch: WorkspaceNotification[];
          do {
            batch = await this.list(ctx.workspace.id, after, 100, false, ctx.user.id);
            for (const event of batch) {
              if (closed) return;
              response.write(`id: ${event.id}\nevent: workspace\ndata: ${JSON.stringify(event)}\n\n`);
              after = event.id;
              if (response.writableLength > 256 * 1024) {
                response.end();
                return;
              }
            }
          } while (batch.length === 100 && !closed);
        } while (pending && !closed);
      } catch (error) {
        if (!closed) {
          response.write(`event: ${error instanceof ControlError ? 'access-changed' : 'reconnect'}\ndata: {}\n\n`);
          response.end();
        }
      } finally {
        pumping = false;
      }
    };
    const changed = () => void pump();
    this.emitter.on(ctx.workspace.id, changed);
    const heartbeat = setInterval(() => {
      if (!closed) {
        response.write(': heartbeat\n\n');
        void pump();
      }
    }, 10000);
    response.once('close', () => {
      closed = true;
      clearInterval(heartbeat);
      this.emitter.off(ctx.workspace.id, changed);
    });
    await pump();
    if (!closed && !response.writableEnded)
      response.write(`event: ready\ndata: ${JSON.stringify({ cursor: after })}\n\n`);
  }
}
