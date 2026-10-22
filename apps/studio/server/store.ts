import { ControlError } from './control/service';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import type { AgentFlow, FlowExecutionInput, FlowNodeData, FlowRunEvent } from '../lib/flows/types';

export class StudioStore {
  readonly pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async initialize() {
    await this.pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  }
  async close() {
    await this.pool.end();
  }
  async listFlows(workspaceId?: string): Promise<AgentFlow[]> {
    const result = await this.pool.query(
      'SELECT graph,workspace_id,edit_version FROM studio_flows WHERE ($1::text IS NULL OR workspace_id=$1) ORDER BY updated_at DESC',
      [workspaceId ?? null],
    );
    return result.rows.map((row) => ({ ...row.graph, workspaceId: row.workspace_id, editVersion: row.edit_version }));
  }
  async getFlow(id: string, workspaceId?: string): Promise<AgentFlow | null> {
    const row = (
      await this.pool.query(
        'SELECT graph,workspace_id,edit_version FROM studio_flows WHERE id=$1 AND ($2::text IS NULL OR workspace_id=$2)',
        [id, workspaceId ?? null],
      )
    ).rows[0];
    return row ? { ...row.graph, workspaceId: row.workspace_id, editVersion: row.edit_version } : null;
  }
  async saveFlow(flow: AgentFlow, create = false, workspaceId = flow.workspaceId ?? 'local', actorId?: string) {
    const saved = {
      ...flow,
      workspaceId,
      editVersion: create ? 1 : (flow.editVersion ?? 0) + 1,
      id: create ? crypto.randomUUID() : flow.id,
      updatedAt: new Date().toISOString(),
    };
    if (!create && !flow.editVersion)
      throw new ControlError(409, 'Reload the workflow before saving; this editor has no revision version.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = create
        ? await client.query('INSERT INTO studio_flows(id,graph,workspace_id) VALUES($1,$2,$3) RETURNING id', [
            saved.id,
            saved,
            workspaceId,
          ])
        : await client.query(
            'UPDATE studio_flows SET graph=$2,updated_at=now(),edit_version=edit_version+1 WHERE id=$1 AND workspace_id=$3 AND edit_version=$4 RETURNING id',
            [saved.id, saved, workspaceId, flow.editVersion],
          );
      if (!result.rowCount)
        throw new ControlError(
          409,
          'This workflow was changed or deleted elsewhere. Reload and review before saving. Your draft is retained.',
        );
      await client.query(
        'INSERT INTO studio_flow_revisions(workspace_id,flow_id,edit_version,graph) VALUES($1,$2,$3,$4)',
        [workspaceId, saved.id, saved.editVersion, saved],
      );
      if (actorId)
        await client.query(
          "INSERT INTO cp_audit(workspace_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'workflow.saved','workflow',$3)",
          [workspaceId, actorId, saved.id],
        );
      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async deleteFlow(id: string, workspaceId: string, actorId: string): Promise<boolean> {
    const result = await this.pool.query(
      `WITH deleted AS (
        DELETE FROM studio_flows WHERE id=$1 AND workspace_id=$2 RETURNING id
      ) INSERT INTO cp_audit(workspace_id,actor_id,action,entity_type,entity_id)
        SELECT $2,$3,'workflow.deleted','workflow',id FROM deleted RETURNING entity_id`,
      [id, workspaceId, actorId],
    );
    return Boolean(result.rowCount);
  }
  async createRun(
    id: string,
    flow: AgentFlow,
    input: FlowExecutionInput,
    parentId?: string,
    parentNodeId?: string,
    actorId?: string,
  ) {
    await this.pool.query(
      `WITH created AS (
      INSERT INTO studio_runs(id,flow_id,flow_name,graph,input,parent_id,parent_node_id,workspace_id,actor_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE((SELECT workspace_id FROM studio_runs WHERE id=$6),(SELECT workspace_id FROM studio_flows WHERE id=$2),'local'),COALESCE($8::text,(SELECT actor_user_id FROM studio_runs WHERE id=$6),(SELECT actor_id FROM cp_audit WHERE entity_type='run' AND entity_id=$1 AND action='run.debounced' ORDER BY id DESC LIMIT 1)))
      ON CONFLICT(id) DO NOTHING RETURNING id,workspace_id,actor_user_id
    ) INSERT INTO cp_audit(workspace_id,actor_id,action,entity_type,entity_id,details) SELECT workspace_id,actor_user_id,'run.requested','run',id,jsonb_build_object('flowId',$2::text) FROM created WHERE $8::text IS NOT NULL`,
      [id, flow.id, flow.name, flow, input, parentId ?? null, parentNodeId ?? null, actorId ?? null],
    );
  }
  async run(id: string) {
    return (await this.pool.query('SELECT * FROM studio_runs WHERE id=$1', [id])).rows[0] ?? null;
  }
  async listRuns(workspaceId?: string) {
    return (
      await this.pool.query(
        'SELECT id,flow_id,flow_name,status,created_at,completed_at,error,parent_id,parent_node_id FROM studio_runs WHERE ($1::text IS NULL OR workspace_id=$1) ORDER BY created_at DESC LIMIT 100',
        [workspaceId ?? null],
      )
    ).rows;
  }
  async queuedRuns() {
    return (await this.pool.query("SELECT id,graph,input FROM studio_runs WHERE status='queued' AND parent_id IS NULL"))
      .rows;
  }
  async activeRuns() {
    return (await this.pool.query("SELECT graph FROM studio_runs WHERE status IN ('queued','running','waiting')")).rows;
  }
  async children(id: string) {
    return (
      await this.pool.query(
        'SELECT id,flow_id,flow_name,parent_node_id,status,created_at FROM studio_runs WHERE parent_id=$1 ORDER BY created_at,id',
        [id],
      )
    ).rows;
  }
  async events(id: string, after = -1): Promise<{ sequence: number; event: FlowRunEvent }[]> {
    return (
      await this.pool.query(
        'SELECT sequence,event FROM studio_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence',
        [id, after],
      )
    ).rows;
  }
  async appendEvent(runId: string, sequence: number, event: FlowRunEvent) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        'INSERT INTO studio_events(run_id,sequence,event) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING sequence',
        [runId, sequence, event],
      );
      if (inserted.rowCount) {
        const status =
          event.type === 'run.started' || event.type === 'run.resumed'
            ? 'running'
            : event.type === 'run.waiting'
              ? 'waiting'
              : event.type === 'run.completed'
                ? 'succeeded'
                : event.type === 'run.failed'
                  ? 'failed'
                  : null;
        if (status)
          await client.query(
            `UPDATE studio_runs SET status=$2,output=$3,error=$4,
          completed_at=CASE WHEN $2 IN ('succeeded','failed') THEN now() ELSE NULL END WHERE id=$1`,
            [
              runId,
              status,
              event.type === 'run.completed' ? event.output : null,
              event.type === 'run.failed' ? event.error : null,
            ],
          );
      }
      if (
        inserted.rowCount &&
        ['run.started', 'run.completed', 'run.failed', 'run.waiting', 'run.resumed'].includes(event.type)
      )
        await client.query(
          `INSERT INTO cp_audit(workspace_id,actor_id,action,entity_type,entity_id,details) SELECT workspace_id,actor_user_id,$2,'run',id,$3 FROM studio_runs WHERE id=$1`,
          [runId, event.type, {}],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return event;
  }
  async openApproval(runId: string, node: FlowNodeData) {
    const result = await this.pool.query(
      `INSERT INTO studio_approvals(id,run_id,node_id,node_name,instruction,kind)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,node_id) DO UPDATE SET node_id=EXCLUDED.node_id RETURNING *`,
      [
        crypto.randomUUID(),
        runId,
        node.id,
        node.name,
        node.config.approvalMessage || node.name,
        node.config.escalationKind || 'approval',
      ],
    );
    return result.rows[0];
  }
  async expireApproval(runId: string, nodeId: string) {
    await this.pool.query(
      "UPDATE studio_approvals SET status='expired',resolved_at=now() WHERE run_id=$1 AND node_id=$2 AND status='open'",
      [runId, nodeId],
    );
  }
  async approvals(workspaceId?: string) {
    const { rows } = await this.pool.query(
      `SELECT a.*,r.flow_id,r.flow_name,r.status AS run_status FROM studio_approvals a
      JOIN studio_runs r ON r.id=a.run_id WHERE a.status='open' AND ($1::text IS NULL OR r.workspace_id=$1) ORDER BY a.created_at DESC`,
      [workspaceId ?? null],
    );
    return rows.map((row) => this.approvalSummary(row));
  }
  approvalSummary(row: Record<string, any>) {
    return {
      id: row.id,
      runId: row.run_id,
      flowId: row.flow_id,
      flowName: row.flow_name || '',
      runStatus: row.run_status || 'waiting',
      nodeId: row.node_id,
      nodeName: row.node_name,
      kind: row.kind,
      instruction: row.instruction,
      status: row.status,
      note: row.decision?.note ?? null,
      assigneeLabel: null,
      resolvedBy: row.resolved_by ?? (row.decision ? 'local-developer' : null),
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    };
  }
  async resolve(
    id: string,
    action: 'approve' | 'reject' | 'done',
    note: string,
    workspaceId?: string,
    actorId?: string,
  ) {
    const decision = { approved: action !== 'reject', action, note };
    const { rows } = await this.pool.query(
      `UPDATE studio_approvals SET status=$2,decision=$3,resolved_at=now(),resolved_by=$5
      WHERE id=$1 AND status='open' AND ($4::text IS NULL OR run_id IN (SELECT id FROM studio_runs WHERE workspace_id=$4)) RETURNING *`,
      [
        id,
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'done',
        decision,
        workspaceId ?? null,
        actorId ?? null,
      ],
    );
    const approval = rows[0];
    if (!approval) return null;
    await this.pool.query("UPDATE studio_runs SET status='running' WHERE id=$1 AND status='waiting'", [
      approval.run_id,
    ]);
    return approval;
  }
  async outbox() {
    return (await this.pool.query('SELECT * FROM studio_approvals WHERE decision IS NOT NULL AND NOT sent')).rows;
  }
  async markSent(id: string) {
    await this.pool.query('UPDATE studio_approvals SET sent=true WHERE id=$1', [id]);
  }
}
