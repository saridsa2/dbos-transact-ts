import { Mem0Index, type MemoryEmbedder } from './context/mem0-index';
import { ContextBudget } from './context-budget';
import { WorkspaceGraphMemory } from './context/graph-memory';
import { ContextMemory } from './context-memory';
import { ContextUploads } from './context-uploads';
import { AgentDefinitions } from './definitions';
import { AgentSetup } from './setup';
import { AgentCoordination } from './coordination';
import { CoordinatorReview } from './coordinator-review';
import type { AgentExecutionSnapshot } from '../../lib/agent/definitions';
import { SessionLifecycle } from './session-lifecycle';
import { ToolStore } from '../tools/store';
import { usageTotals } from './context';
import { schemaValidator } from '../workspace-harness/schema';
import { AgentTasks } from './tasks';
import { AgentFeatures } from './features';
import { AgentExtensions } from '../workspace-harness/extensions';
import { collectAgentResources } from '../../lib/agent/resource-links';
import { interactionResponseSchema, interactionErrors, interactionAnswerMatches } from '../../lib/agent/interactions';
import { enqueueWorkspaceRequest } from './intake';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { agentConfigurationSchema, messageSchema, type AgentConfiguration } from '../../lib/agent/contracts';
import { contentHash, id } from '../../lib/knowledge/contracts';
import type { Context } from '../../lib/control/contracts';
import { ControlError } from '../control/service';
import type { KnowledgeStore } from '../knowledge/store';
import type { StudioStore } from '../store';
export class AgentService {
  readonly memoryIndex: Mem0Index;
  readonly budgets = new ContextBudget(this);
  readonly memory = new ContextMemory(this);
  readonly memoryGraph = new WorkspaceGraphMemory(this);
  readonly definitions = new AgentDefinitions(this);
  readonly setup = new AgentSetup(this);
  readonly coordination = new AgentCoordination(this);
  readonly automaticReview = new CoordinatorReview(this);
  readonly contextUploads = new ContextUploads(this);
  readonly lifecycle = new SessionLifecycle(this);
  readonly tasks = new AgentTasks(this);
  readonly features = new AgentFeatures(this);
  constructor(
    readonly knowledge: KnowledgeStore,
    readonly studio: StudioStore,
    readonly extensions: AgentExtensions = new AgentExtensions(),
    memoryEmbedder?: MemoryEmbedder,
  ) {
    this.memoryIndex = new Mem0Index(this, memoryEmbedder);
  }
  get control() {
    return this.knowledge.control;
  }
  get pool() {
    return this.knowledge.pool;
  }
  async initialize() {
    await new ToolStore(this.control).initialize();
    for (const [version, file] of [
      [1, '001-core.sql'],
      [2, '002-shell-intake.sql'],
      [3, '003-response-resources.sql'],
      [4, '004-harness2-engine.sql'],
      [5, '005-harness-concepts.sql'],
      [6, '006-session-lifecycle.sql'],
      [7, '007-context-uploads.sql'],
      [8, '008-agent-definitions.sql'],
      [9, '009-agent-setup.sql'],
      [10, '010-agent-suggestions.sql'],
      [11, '011-agent-draft-generation.sql'],
      [12, '012-agent-setup-review-history.sql'],
      [13, '013-coordinator-knowledge-review.sql'],
      [14, '014-context-memory.sql'],
      [15, '015-context-budget.sql'],
      [16, '016-long-history.sql'],
      [17, '017-knowledge-graph.sql'],
      [18, '018-workspace-understanding-graph.sql'],
    ] as const) {
      const sql = await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      await this.control.transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended('stackproc-agent-migrations',0))");
        await c.query(
          'CREATE TABLE IF NOT EXISTS wa_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
        );
        const row = (await c.query('SELECT checksum FROM wa_migrations WHERE version=$1', [version])).rows[0];
        if (row && row.checksum !== checksum)
          throw new Error('Agent migration checksum mismatch. Add a new migration.');
        if (!row) {
          await c.query(sql);
          await c.query('INSERT INTO wa_migrations(version,checksum) VALUES($1,$2)', [version, checksum]);
        }
      });
    }
  }
  async configuration(ctx: Context) {
    const row = (
      await this.pool.query('SELECT sponsor_id,edit_version,enabled,config FROM wa_agents WHERE workspace_id=$1', [
        ctx.workspace.id,
      ])
    ).rows[0];
    return row ? { ...row.config, sponsorId: row.sponsor_id, editVersion: row.edit_version } : null;
  }
  async configure(ctx: Context, input: unknown) {
    if (!['owner', 'admin'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Only workspace administrators can configure the agent.');
    const data = agentConfigurationSchema.parse(input);
    this.extensions.resolve(data.runtime?.extensions ?? []);
    for (const skill of data.runtime?.skills ?? []) await this.features.skillContext(ctx, [skill]);
    if (data.allowModel) {
      const connection = (await this.control.connections(ctx)).find(
        (c) =>
          c.id === data.connectionId &&
          c.revision === data.connectionRevision &&
          c.provider === 'minimax' &&
          c.status === 'configured',
      );
      if (!connection) throw new ControlError(422, 'Select a configured MiniMax connection in this workspace.');
    }
    await this.control.transaction(async (c) => {
      await this.definitions.lock(c, ctx.workspace.id);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-config:'||$1,0))", [ctx.workspace.id]);
      const row = (
        await c.query('SELECT edit_version FROM wa_agents WHERE workspace_id=$1 FOR UPDATE', [ctx.workspace.id])
      ).rows[0];
      if ((row?.edit_version ?? 0) !== data.expectedVersion)
        throw new ControlError(409, 'Agent configuration changed. Reload before saving.');
      await c.query(
        `INSERT INTO wa_agents(workspace_id,sponsor_id,enabled,config) VALUES($1,$2,$3,$4)
        ON CONFLICT(workspace_id) DO UPDATE SET sponsor_id=$2,enabled=$3,config=$4,edit_version=wa_agents.edit_version+1,updated_at=now()`,
        [ctx.workspace.id, ctx.user.id, data.enabled, data],
      );
      await this.control.audit(ctx, 'agent.configured', 'workspace_agent', ctx.workspace.id, {}, c);
    });
    return this.configuration(ctx);
  }
  async activities(ctx: Context) {
    return {
      items: (
        await this.pool.query(
          `SELECT w.id,w.session_id AS "sessionId",w.goal,w.state,w.created_at AS "createdAt",w.updated_at AS "updatedAt",w.request_context AS context
       FROM wa_work_items w JOIN wa_sessions s ON s.workspace_id=w.workspace_id AND s.id=w.session_id WHERE w.workspace_id=$1 AND s.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM wa_agent_tasks t WHERE t.workspace_id=w.workspace_id AND t.child_work_id=w.id)
       ORDER BY w.updated_at DESC,w.id DESC LIMIT 100`,
          [ctx.workspace.id],
        )
      ).rows,
    };
  }
  async sessions(ctx: Context, archived = false) {
    return this.lifecycle.list(ctx, archived);
  }
  async createSession(ctx: Context, input: unknown, agentId?: string | null) {
    const data = z
      .object({ clientKey: id, title: z.string().trim().min(1).max(200) })
      .strict()
      .parse(input);
    return this.control.transaction(async (c) => {
      const found = (
        await c.query('SELECT id,title FROM wa_sessions WHERE workspace_id=$1 AND created_by=$2 AND client_key=$3', [
          ctx.workspace.id,
          ctx.user.id,
          data.clientKey,
        ])
      ).rows[0];
      if (found) {
        if (found.title !== data.title)
          throw new ControlError(409, 'Session key was already used for another request.');
        return { id: found.id };
      }
      const result = await c.query(
        `INSERT INTO wa_sessions(workspace_id,id,created_by,title,client_key) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(workspace_id,created_by,client_key) DO NOTHING RETURNING id`,
        [ctx.workspace.id, crypto.randomUUID(), ctx.user.id, data.title, data.clientKey],
      );
      if (result.rowCount) {
        const bound =
          agentId === undefined
            ? (
                await c.query('SELECT agent_id FROM wa_workspace_agent_bindings WHERE workspace_id=$1', [
                  ctx.workspace.id,
                ])
              ).rows[0]?.agent_id
            : agentId;
        if (bound)
          await c.query('UPDATE wa_sessions SET agent_id=$3 WHERE workspace_id=$1 AND id=$2', [
            ctx.workspace.id,
            result.rows[0].id,
            bound,
          ]);
      }
      if (!result.rowCount) {
        const existing = (
          await c.query('SELECT id,title FROM wa_sessions WHERE workspace_id=$1 AND created_by=$2 AND client_key=$3', [
            ctx.workspace.id,
            ctx.user.id,
            data.clientKey,
          ])
        ).rows[0];
        if (existing.title !== data.title)
          throw new ControlError(409, 'Session key was already used for another request.');
        return { id: existing.id };
      }
      return { id: result.rows[0].id };
    });
  }
  async session(ctx: Context, sessionId: string, before?: string) {
    if (before && !/^\d{1,18}$/.test(before)) throw new ControlError(400, 'Invalid message cursor.');
    const session = (
      await this.pool.query(
        'SELECT id,title,edit_version AS "editVersion",archived_at AS "archivedAt" FROM wa_sessions WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',
        [ctx.workspace.id, sessionId],
      )
    ).rows[0];
    if (!session) throw new ControlError(404, 'Agent session not found.');
    const messages = (
      await this.pool.query(
        `SELECT id,role,content,attachments,resource_refs AS "resources",work_item_id AS "workItemId",ordinal::text,created_at AS "createdAt" FROM
      (SELECT * FROM wa_messages WHERE workspace_id=$1 AND session_id=$2 AND ($3::bigint IS NULL OR ordinal<$3) ORDER BY ordinal DESC LIMIT 100) m ORDER BY m.ordinal`,
        [ctx.workspace.id, sessionId, before ?? null],
      )
    ).rows;
    const workItems = (
      await this.pool.query(
        'SELECT id,state,goal,edit_version AS "editVersion",error,created_at FROM wa_work_items WHERE workspace_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 30',
        [ctx.workspace.id, sessionId],
      )
    ).rows;
    const refs = new Map<string, ReturnType<typeof collectAgentResources>>();
    for (const message of messages) {
      if (message.role !== 'assistant' || !message.workItemId || message.resources?.length) continue;
      if (!refs.has(message.workItemId))
        refs.set(
          message.workItemId,
          collectAgentResources(
            (
              await this.pool.query(
                "WITH RECURSIVE family(id) AS (SELECT $2::text UNION SELECT t.child_work_id FROM wa_agent_tasks t JOIN family f ON t.parent_work_id=f.id WHERE t.workspace_id=$1) SELECT request->>'name' AS name,result FROM wa_calls WHERE workspace_id=$1 AND work_item_id IN (SELECT id FROM family) AND kind='tool' AND state='completed' ORDER BY turn_no,created_at,id",
                [ctx.workspace.id, message.workItemId],
              )
            ).rows,
          ),
        );
      message.resources = refs.get(message.workItemId);
    }
    return { session, messages, workItems, contextUploads: await this.contextUploads.pending(ctx, sessionId) };
  }
  async message(
    ctx: Context,
    sessionId: string,
    input: unknown,
    requestContext: unknown = {},
    snapshot?: AgentExecutionSnapshot,
  ) {
    const data = messageSchema.parse(input),
      hash = await contentHash({
        text: data.text,
        attachments: data.attachments,
        ...(data.outputSchema ? { outputSchema: data.outputSchema } : {}),
      });
    if (data.outputSchema) schemaValidator(data.outputSchema);
    for (const ref of data.attachments) {
      const artifact = await this.knowledge.get(ctx, ref.id, ref.revisionId);
      if (artifact.artifact.kind !== ref.kind)
        throw new ControlError(422, 'Attachment kind does not match its artifact.');
    }
    return this.control.transaction(async (c) => {
      if (snapshot) await this.definitions.lock(c, ctx.workspace.id);
      const session = (
        await c.query('SELECT * FROM wa_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          sessionId,
        ])
      ).rows[0];
      if (!session || session.deleted_at) throw new ControlError(404, 'Agent session not found.');
      if ((session.agent_id ?? null) !== (snapshot?.ref.agentId ?? null))
        throw new ControlError(409, 'This session belongs to another agent. Start a new session.');
      if (session.archived_at)
        throw new ControlError(409, 'Restore this conversation before sending a new instruction.');
      const duplicate = (
        await c.query(
          `SELECT m.id,m.request_hash,w.id AS work_id FROM wa_messages m JOIN wa_work_items w
        ON w.workspace_id=m.workspace_id AND w.id=m.id WHERE m.workspace_id=$1 AND m.session_id=$2 AND m.client_key=$3`,
          [ctx.workspace.id, sessionId, data.clientMessageId],
        )
      ).rows[0];
      if (duplicate) {
        if (duplicate.request_hash !== hash)
          throw new ControlError(409, 'Message key was already used with different content.');
        return { messageId: duplicate.id, workItemId: duplicate.work_id };
      }
      if (session.edit_version !== data.expectedSessionVersion)
        throw new ControlError(409, 'Session changed. Refresh before sending.');
      const config = (await c.query('SELECT * FROM wa_agents WHERE workspace_id=$1', [ctx.workspace.id])).rows[0];
      if (!config?.enabled) throw new ControlError(422, 'Configure and enable the workspace agent first.');
      const active = (
        await c.query(
          "SELECT id FROM wa_work_items WHERE workspace_id=$1 AND session_id=$2 AND state IN ('queued','preparing','reasoning','executing_tool','waiting_for_tasks','ready_for_review') LIMIT 1",
          [ctx.workspace.id, sessionId],
        )
      ).rows[0];
      if (active)
        throw new ControlError(
          409,
          'This session already has active work. Cancel or resolve it before starting another goal.',
        );
      const workId = crypto.randomUUID();
      const ordinal = Number(
        (
          await c.query(
            'SELECT COALESCE(max(ordinal),0)+1 AS n FROM wa_messages WHERE workspace_id=$1 AND session_id=$2',
            [ctx.workspace.id, sessionId],
          )
        ).rows[0].n,
      );
      await c.query(
        "INSERT INTO wa_messages(workspace_id,id,session_id,ordinal,role,actor_id,client_key,request_hash,content,attachments) VALUES($1,$2,$3,$4,'user',$5,$6,$7,$8,$9)",
        [
          ctx.workspace.id,
          workId,
          sessionId,
          ordinal,
          ctx.user.id,
          data.clientMessageId,
          hash,
          data.text,
          JSON.stringify(data.attachments),
        ],
      );
      await c.query(
        `INSERT INTO wa_work_items(workspace_id,id,session_id,sponsor_id,state,goal,config_revision,config_snapshot,attachments,request_context)
        VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9)`,
        [
          ctx.workspace.id,
          workId,
          sessionId,
          config.sponsor_id,
          data.text,
          config.edit_version,
          config.config,
          JSON.stringify(data.attachments),
          requestContext,
        ],
      );
      if (data.outputSchema)
        await c.query('UPDATE wa_work_items SET output_schema=$3 WHERE workspace_id=$1 AND id=$2', [
          ctx.workspace.id,
          workId,
          data.outputSchema,
        ]);
      if (snapshot) {
        await c.query(
          'UPDATE wa_work_items SET execution_snapshot=$3,sponsor_id=$4,config_snapshot=$5 WHERE workspace_id=$1 AND id=$2',
          [
            ctx.workspace.id,
            workId,
            snapshot,
            snapshot.actorId,
            (await this.definitions.access(ctx.workspace.id, snapshot)).config,
          ],
        );
        if (snapshot.definition.outputSchema)
          await c.query('UPDATE wa_work_items SET output_schema=$3 WHERE workspace_id=$1 AND id=$2', [
            ctx.workspace.id,
            workId,
            snapshot.definition.outputSchema,
          ]);
      }
      await c.query(
        'UPDATE wa_sessions SET edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [ctx.workspace.id, sessionId],
      );
      await this.enqueue(c, ctx.workspace.id, workId, `start:${workId}`);
      await this.control.audit(ctx, 'agent.work_queued', 'agent_work_item', workId, {}, c);
      return { messageId: workId, workItemId: workId };
    });
  }
  async enqueue(c: PoolClient, workspace: string, work: string, key: string) {
    await c.query(
      'INSERT INTO wa_command_outbox(workspace_id,id,work_item_id,command_key,start_turn) SELECT $1,$2,$3,$4,turn_no FROM wa_work_items WHERE workspace_id=$1 AND id=$3 ON CONFLICT(workspace_id,command_key) DO NOTHING',
      [workspace, crypto.randomUUID(), work, key],
    );
  }
  async work(ctx: Context, workId: string) {
    const row = (
      await this.pool.query(
        'SELECT (execution_snapshot->\'definition\'->\'memory\' IS NOT NULL) AS "memoryProfile",id,session_id AS "sessionId",state,goal,error,engine_provenance AS "engine",edit_version AS "editVersion",turn_no AS "turns",tool_count AS "tools",structured_result AS result FROM wa_work_items WHERE workspace_id=$1 AND id=$2',
        [ctx.workspace.id, workId],
      )
    ).rows[0];
    if (!row) throw new ControlError(404, 'Agent work item not found.');
    return {
      ...row,
      messages: (
        await this.pool.query(
          `SELECT id,role,content,ordinal::text,work_item_id AS "workItemId",resource_refs AS resources
         FROM wa_messages WHERE workspace_id=$1 AND (work_item_id=$2 OR id=$2) ORDER BY ordinal LIMIT 100`,
          [ctx.workspace.id, workId],
        )
      ).rows,
      plan:
        (
          await this.pool.query('SELECT revision,steps FROM wa_agent_plans WHERE workspace_id=$1 AND work_item_id=$2', [
            ctx.workspace.id,
            workId,
          ])
        ).rows[0] ?? null,
      tasks: (await this.tasks.list(ctx, workId)).items,
      usage: await usageTotals(this, ctx.workspace.id, workId),
      approval:
        (
          await this.pool.query(
            "SELECT result->'approval' AS approval FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND result ? 'approval' ORDER BY created_at DESC LIMIT 1",
            [ctx.workspace.id, workId],
          )
        ).rows[0]?.approval ?? null,
      interaction:
        row.state === 'waiting_for_user'
          ? ((
              await this.pool.query(
                "SELECT result->'interaction' AS interaction FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND kind='tool' AND (request->>'name' IN ('ask_user_v1','ask_user_v2') OR result ? 'interaction') AND result->>'skipped' IS DISTINCT FROM 'true' ORDER BY turn_no DESC,created_at DESC,id DESC LIMIT 1",
                [ctx.workspace.id, workId],
              )
            ).rows[0]?.interaction ?? null)
          : null,
      activity: (
        await this.pool.query(
          'SELECT id,kind,summary,detail,created_at AS "createdAt" FROM wa_activity WHERE workspace_id=$1 AND work_item_id=$2 ORDER BY created_at,id LIMIT 200',
          [ctx.workspace.id, workId],
        )
      ).rows,
      proposals: (
        await this.pool.query(
          'SELECT p.id,p.artifact_id AS "artifactId",p.expected_version AS "expectedVersion",p.content,p.content_hash AS hash,p.summary,p.state,p.receipt,a.kind FROM wa_change_sets p JOIN wi_artifacts a ON a.workspace_id=p.workspace_id AND a.id=p.artifact_id WHERE p.workspace_id=$1 AND p.work_item_id=$2 ORDER BY p.created_at',
          [ctx.workspace.id, workId],
        )
      ).rows,
    };
  }
  async authorize(workspace: string, workId: string) {
    const work = (
      await this.pool.query('SELECT * FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [workspace, workId])
    ).rows[0];
    if (!work) throw new ControlError(404, 'Agent work item not found.');
    const session = (
      await this.pool.query('SELECT deleted_at FROM wa_sessions WHERE workspace_id=$1 AND id=$2', [
        workspace,
        work.session_id,
      ])
    ).rows[0];
    if (!session || session.deleted_at) throw new ControlError(409, 'This conversation was deleted.');
    if (work.state === 'cancelled') throw new ControlError(409, 'Agent work was cancelled.');
    if (work.execution_snapshot)
      return { work, ...(await this.definitions.access(workspace, work.execution_snapshot)) };
    const ctx = await this.control.authorizePrincipal(work.sponsor_id, workspace, 'execute');
    const config = await this.configuration(ctx);
    if (!config?.enabled || config.editVersion !== work.config_revision)
      throw new ControlError(
        403,
        'Agent configuration was changed or disabled. Start a new work item under the new policy.',
      );
    return { ctx, work, config: work.config_snapshot as AgentConfiguration };
  }
  async activity(
    workspace: string,
    workId: string,
    kind: string,
    summary: string,
    detail: unknown = {},
    c: PoolClient | typeof this.pool = this.pool,
  ) {
    await c.query(
      'INSERT INTO wa_activity(workspace_id,id,work_item_id,kind,summary,detail) VALUES($1,$2,$3,$4,$5,$6)',
      [workspace, crypto.randomUUID(), workId, kind, summary, detail],
    );
  }
  async settle(workspace: string, workId: string, state: string, summary: string, nextTurn?: number) {
    await this.control.transaction(async (c) => {
      const first = (
        await c.query('SELECT session_id FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [workspace, workId])
      ).rows[0];
      if (!first) return;
      await c.query('SELECT id FROM wa_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
        workspace,
        first.session_id,
      ]);
      const row = (
        await c.query('SELECT * FROM wa_work_items WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspace, workId])
      ).rows[0];
      if (!row || ['cancelled', 'completed'].includes(row.state)) return;
      await c.query(
        'UPDATE wa_work_items SET state=$3,error=$4,turn_no=COALESCE($5,turn_no),edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [
          workspace,
          workId,
          state,
          ['failed', 'suspended', 'uncertain', 'budget_exhausted'].includes(state) ? summary : null,
          nextTurn ?? null,
        ],
      );
      await c.query('SELECT id FROM wa_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
        workspace,
        row.session_id,
      ]);
      const ordinal = Number(
        (
          await c.query(
            'SELECT COALESCE(max(ordinal),0)+1 AS n FROM wa_messages WHERE workspace_id=$1 AND session_id=$2',
            [workspace, row.session_id],
          )
        ).rows[0].n,
      );
      await c.query(
        "INSERT INTO wa_messages(workspace_id,id,session_id,ordinal,role,content,work_item_id,resource_refs) VALUES($1,$2,$3,$4,'assistant',$5,$6,$7)",
        [
          workspace,
          crypto.randomUUID(),
          row.session_id,
          ordinal,
          summary,
          workId,
          JSON.stringify(
            collectAgentResources(
              (
                await c.query(
                  "WITH RECURSIVE family(id) AS (SELECT $2::text UNION SELECT t.child_work_id FROM wa_agent_tasks t JOIN family f ON t.parent_work_id=f.id WHERE t.workspace_id=$1) SELECT request->>'name' AS name,result FROM wa_calls WHERE workspace_id=$1 AND work_item_id IN (SELECT id FROM family) AND kind='tool' AND state='completed' ORDER BY turn_no,created_at,id",
                  [workspace, workId],
                )
              ).rows,
            ),
          ),
        ],
      );
      await c.query(
        'UPDATE wa_sessions SET edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [workspace, row.session_id],
      );
      await this.activity(workspace, workId, state, summary, {}, c);
      const ctx = await this.control.authorizePrincipal(row.sponsor_id, workspace, 'read').catch(() => null);
      if (ctx) await this.control.audit(ctx, `agent.${state}`, 'agent_work_item', workId, {}, c);
    });
  }
  async cancel(ctx: Context, workId: string, input: unknown) {
    const data = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(input);
    await this.control.transaction(async (c) => {
      const updated = await c.query(
        "UPDATE wa_work_items SET state='cancelled',edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND edit_version=$3 AND state NOT IN ('completed','cancelled') RETURNING id",
        [ctx.workspace.id, workId, data.expectedVersion],
      );
      if (!updated.rowCount) throw new ControlError(409, 'Work item changed. Refresh before cancelling.');
      await c.query(
        "WITH RECURSIVE descendants(id) AS (SELECT child_work_id FROM wa_agent_tasks WHERE workspace_id=$1 AND parent_work_id=$2 UNION ALL SELECT t.child_work_id FROM wa_agent_tasks t JOIN descendants d ON t.parent_work_id=d.id WHERE t.workspace_id=$1) UPDATE wa_work_items SET state='cancelled',edit_version=edit_version+1 WHERE workspace_id=$1 AND id IN (SELECT id FROM descendants) AND state NOT IN ('completed','cancelled')",
        [ctx.workspace.id, workId],
      );
      await this.activity(ctx.workspace.id, workId, 'cancelled', 'Cancelled by a workspace member.', {}, c);
      await this.control.audit(ctx, 'agent.cancelled', 'agent_work_item', workId, {}, c);
    });
    return this.work(ctx, workId);
  }
  async answer(ctx: Context, workId: string, input: unknown) {
    const data = z
      .object({
        clientKey: id,
        expectedVersion: z.number().int().positive(),
        answer: z.string().trim().min(1).max(10000),
        remember: z.boolean().default(false),
        response: interactionResponseSchema.optional(),
      })
      .strict()
      .parse(input);
    await this.control.transaction(async (c) => {
      const session = (
        await c.query(
          'SELECT s.deleted_at FROM wa_sessions s JOIN wa_work_items w ON w.workspace_id=s.workspace_id AND w.session_id=s.id WHERE w.workspace_id=$1 AND w.id=$2 FOR UPDATE OF s',
          [ctx.workspace.id, workId],
        )
      ).rows[0];
      if (!session || session.deleted_at) throw new ControlError(404, 'Agent session not found.');
      const work = (
        await c.query('SELECT * FROM wa_work_items WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          workId,
        ])
      ).rows[0];
      if (!work) throw new ControlError(404, 'Work item not found.');
      const duplicate = (
        await c.query('SELECT content FROM wa_decisions WHERE workspace_id=$1 AND work_item_id=$2 AND client_key=$3', [
          ctx.workspace.id,
          workId,
          data.clientKey,
        ])
      ).rows[0];
      if (duplicate) {
        if ((await contentHash(duplicate.content)) !== (await contentHash(data)))
          throw new ControlError(409, 'Decision key was reused.');
        return;
      }
      if (work.state !== 'waiting_for_user' || work.edit_version !== data.expectedVersion)
        throw new ControlError(409, 'This question has changed or is already answered.');
      const pendingInteraction = (
        await c.query(
          "SELECT result->'interaction' AS interaction FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND kind='tool' AND (request->>'name' IN ('ask_user_v1','ask_user_v2') OR result ? 'interaction') AND result->>'skipped' IS DISTINCT FROM 'true' ORDER BY turn_no DESC,created_at DESC,id DESC LIMIT 1",
          [ctx.workspace.id, workId],
        )
      ).rows[0]?.interaction;
      if (pendingInteraction) {
        if (!data.response) throw new ControlError(400, 'Complete the requested fields before continuing.');
        const errors = interactionErrors(pendingInteraction, data.response);
        if (Object.keys(errors).length) throw new ControlError(400, Object.values(errors).join(' '));
        if (!interactionAnswerMatches(data.answer, data.response))
          throw new ControlError(400, 'Answer does not match the submitted fields.');
      } else if (data.response) throw new ControlError(409, 'This work item has no structured question.');
      if (pendingInteraction && data.response)
        await c.query(
          "UPDATE wa_tool_approvals SET state=$4,actor_id=$5,decided_at=now() WHERE workspace_id=$1 AND work_item_id=$2 AND id=$3 AND state='pending'",
          [
            ctx.workspace.id,
            workId,
            pendingInteraction.id,
            data.response.values.approved === true ? 'approved' : 'denied',
            ctx.user.id,
          ],
        );
      const decisionId = crypto.randomUUID();
      await c.query(
        "INSERT INTO wa_decisions(workspace_id,id,work_item_id,actor_id,client_key,kind,content) VALUES($1,$2,$3,$4,$5,'answer',$6)",
        [ctx.workspace.id, decisionId, workId, ctx.user.id, data.clientKey, data],
      );
      if (pendingInteraction && data.response) {
        const proposed = await c.query(
          "UPDATE wa_memory_proposals SET state=$4 WHERE workspace_id=$1 AND work_item_id=$2 AND id=$3 AND state='pending' RETURNING content",
          [
            ctx.workspace.id,
            workId,
            pendingInteraction.id,
            data.response.values.approved === true ? 'accepted' : 'rejected',
          ],
        );
        if (proposed.rowCount && data.response.values.approved === true)
          await c.query(
            'INSERT INTO wa_memories(workspace_id,id,work_item_id,decision_id,content) VALUES($1,$2,$3,$4,$5)',
            [ctx.workspace.id, crypto.randomUUID(), workId, decisionId, proposed.rows[0].content],
          );
      }
      if (data.remember)
        await c.query(
          'INSERT INTO wa_memories(workspace_id,id,work_item_id,decision_id,content) VALUES($1,$2,$3,$4,$5)',
          [ctx.workspace.id, crypto.randomUUID(), workId, decisionId, data.answer],
        );
      await c.query(
        "UPDATE wa_work_items SET state='queued',edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [ctx.workspace.id, workId],
      );
      await this.activity(ctx.workspace.id, workId, 'answer', data.answer, { decisionId }, c);
      await this.enqueue(c, ctx.workspace.id, workId, `answer:${decisionId}`);
      await this.control.audit(ctx, 'agent.answered', 'agent_work_item', workId, {}, c);
    });
    return this.work(ctx, workId);
  }
  async ingest() {
    const events = (
      await this.pool.query('SELECT * FROM wa_domain_outbox WHERE delivered_at IS NULL ORDER BY created_at,id LIMIT 25')
    ).rows;
    for (const event of events) {
      // A knowledge commit can land after coordinator reconciliation but before
      // this legacy intake pass. Leave claimed events for the coordinator so
      // legacy acknowledgement cannot erase its pending change.
      if (
        event.event_type === 'knowledge.saved' &&
        (
          await this.pool.query(
            `SELECT 1 FROM wa_coordinator_rules q JOIN wa_agent_revisions r ON r.workspace_id=q.workspace_id AND r.agent_id=q.target->>'agentId' AND r.revision=(q.target->>'revision')::int AND r.content_hash=q.target->>'hash' WHERE q.workspace_id=$1 AND q.enabled AND (r.definition->'context'->>'scope'='workspace_inventory' OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.definition->'context'->'resources') e WHERE e->>'id'=$2)) LIMIT 1`,
            [event.workspace_id, event.entity_id],
          )
        ).rowCount
      )
        continue;
      const agent = (await this.pool.query('SELECT * FROM wa_agents WHERE workspace_id=$1', [event.workspace_id]))
        .rows[0];
      let workId: string | null = null;
      if (
        agent?.enabled &&
        agent.config.mode === 'assist' &&
        agent.config.allowModel &&
        agent.config.triggers.includes(event.event_type)
      ) {
        const ctx = await this.control
          .authorizePrincipal(agent.sponsor_id, event.workspace_id, 'execute')
          .catch(() => null);
        if (ctx) {
          const attachments = [];
          if (['source', 'ontology', 'process'].includes(event.entity_kind)) {
            const artifact = await this.knowledge.get(ctx, event.entity_id).catch(() => null);
            if (artifact)
              attachments.push({
                kind: artifact.artifact.kind,
                id: artifact.artifact.id,
                revisionId: artifact.revision.id,
              });
          }
          const alreadyQueued = (
            await this.pool.query('SELECT id FROM wa_requests WHERE workspace_id=$1 AND source_event_id=$2 LIMIT 1', [
              event.workspace_id,
              event.id,
            ])
          ).rowCount;
          if (!alreadyQueued)
            await enqueueWorkspaceRequest(
              this,
              ctx,
              {
                clientRequestId: event.id,
                kind: 'goal',
                text: `Inspect the committed ${event.event_type} change for ${event.entity_kind} ${event.entity_id}. Explain relevant domain consistency issues; do not apply or publish changes.`,
                context: { surface: 'workspace' },
                attachments,
              },
              'workspace-event',
              event.id,
            );
        }
      }
      await this.control.transaction(async (c) => {
        await c.query(
          'INSERT INTO wa_inbox(workspace_id,id,source_event_id,payload,work_item_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,source_event_id) DO NOTHING',
          [
            event.workspace_id,
            crypto.randomUUID(),
            event.id,
            { type: event.event_type, kind: event.entity_kind, id: event.entity_id },
            workId,
          ],
        );
        await c.query('UPDATE wa_domain_outbox SET delivered_at=now() WHERE workspace_id=$1 AND id=$2', [
          event.workspace_id,
          event.id,
        ]);
      });
    }
  }
  async applyProposal(ctx: Context, proposalId: string, input: unknown) {
    const data = z
      .object({ hash: z.string().length(64) })
      .strict()
      .parse(input);
    return this.control.transaction(async (c) => {
      const session = (
        await c.query(
          'SELECT s.deleted_at FROM wa_sessions s JOIN wa_work_items w ON w.workspace_id=s.workspace_id AND w.session_id=s.id JOIN wa_change_sets p ON p.workspace_id=w.workspace_id AND p.work_item_id=w.id WHERE p.workspace_id=$1 AND p.id=$2 FOR UPDATE OF s',
          [ctx.workspace.id, proposalId],
        )
      ).rows[0];
      if (!session || session.deleted_at) throw new ControlError(404, 'Agent session not found.');
      const proposal = (
        await c.query('SELECT * FROM wa_change_sets WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          proposalId,
        ])
      ).rows[0];
      if (!proposal) throw new ControlError(404, 'Proposal not found.');
      if (proposal.content_hash !== data.hash)
        throw new ControlError(409, 'Proposal changed. Review its current content.');
      if (proposal.state === 'applied') return proposal.receipt;
      if (proposal.state !== 'proposed') throw new ControlError(409, 'Proposal is no longer available.');
      await this.authorize(ctx.workspace.id, proposal.work_item_id);
      const item = await this.knowledge.get(ctx, proposal.artifact_id, undefined, c);
      const saved = await this.knowledge.save(
        ctx,
        {
          name: item.artifact.name,
          kind: item.artifact.kind,
          content: proposal.content,
          expectedVersion: proposal.expected_version,
        },
        proposal.artifact_id,
        c,
      );
      const receipt = {
        artifactId: saved.artifact.id,
        revisionId: saved.revision.id,
        editVersion: saved.artifact.editVersion,
      };
      await c.query("UPDATE wa_change_sets SET state='applied',receipt=$3 WHERE workspace_id=$1 AND id=$2", [
        ctx.workspace.id,
        proposalId,
        receipt,
      ]);
      await c.query(
        "UPDATE wa_work_items SET state='completed',edit_version=edit_version+1 WHERE workspace_id=$1 AND id=$2 AND state='ready_for_review'",
        [ctx.workspace.id, proposal.work_item_id],
      );
      await this.activity(
        ctx.workspace.id,
        proposal.work_item_id,
        'applied',
        'Reviewed knowledge proposal applied.',
        receipt,
        c,
      );
      await this.control.audit(ctx, 'agent.applied', 'agent_work_item', proposal.work_item_id, {}, c);
      // Suppress the agent's own accepted change as a recursive ambient trigger.
      await c.query(
        "UPDATE wa_domain_outbox SET delivered_at=now() WHERE workspace_id=$1 AND entity_id=$2 AND delivered_at IS NULL AND event_type='knowledge.saved' AND created_at>=transaction_timestamp()",
        [ctx.workspace.id, proposal.artifact_id],
      );
      return receipt;
    });
  }
}
