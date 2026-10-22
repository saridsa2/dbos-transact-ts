import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  definitionSchema,
  agentRevisionRefSchema,
  type AgentExecutionSnapshot,
  type AgentDefinition,
  type AgentRevisionRef,
} from '../../lib/agent/definitions';
import { contentHash } from '../../lib/knowledge/contracts';
import type { Context } from '../../lib/control/contracts';
import { ControlError } from '../control/service';
import { schemaValidator } from '../workspace-harness/schema';
import type { AgentService } from './service';
import { harnessOptionsSchema } from '../workspace-harness/options';

const command = z.object({ clientKey: z.string().uuid(), expectedVersion: z.number().int().nonnegative() }).strict();
const admin = (ctx: Context) => {
  if (!['owner', 'admin'].includes(ctx.workspace.role))
    throw new ControlError(403, 'Only administrators can publish or operate workspace agents.');
};
export class AgentDefinitions {
  constructor(readonly service: AgentService) {}
  async understanding(ctx: Context, snapshot?: AgentExecutionSnapshot) {
    const row = (
      await this.service.pool.query(
        `SELECT b.agent_id AS "agentId",b.revision,b.content_hash AS hash,b.edit_version AS "editVersion",d.enabled,d.archived_at AS "archivedAt",u.id AS "understandingId",u.content,u.coverage,u.source_refs AS sources FROM wa_workspace_agent_bindings b JOIN wa_agent_definitions d ON d.workspace_id=b.workspace_id AND d.id=b.agent_id LEFT JOIN wa_workspace_understandings u ON u.workspace_id=b.workspace_id AND u.id=b.understanding_id WHERE b.workspace_id=$1`,
        [ctx.workspace.id],
      )
    ).rows[0];
    if (!row) return null;
    if (
      snapshot &&
      (snapshot.ref.agentId !== row.agentId ||
        snapshot.ref.revision !== row.revision ||
        snapshot.definition.kind !== 'coordinator')
    )
      return null;
    if (
      snapshot?.definition.context.scope === 'selected' &&
      (row.sources ?? []).some(
        (ref: any) =>
          !(snapshot.contextResources ?? snapshot.definition.context.resources).some(
            (r) => r.id === ref.id && (snapshot.definition.context.followHead || r.revisionId === ref.revisionId),
          ),
      )
    )
      return null;
    const stale = [];
    for (const source of row.sources ?? []) {
      const current = (
        await this.service.pool.query('SELECT revision_id FROM wi_artifacts WHERE workspace_id=$1 AND id=$2', [
          ctx.workspace.id,
          source.id,
        ])
      ).rows[0];
      if (current?.revision_id !== source.revisionId) stale.push(source.id);
    }
    return { ...row, staleSourceIds: stale };
  }
  async lock(c: PoolClient, workspace: string) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-v2-command:'||$1,0))", [workspace]);
  }
  async mutate(ctx: Context, operation: string, key: string, input: unknown, fn: (c: PoolClient) => Promise<any>) {
    const hash = await contentHash(input);
    return this.service.control.transaction(async (c) => {
      await this.lock(c, ctx.workspace.id);
      const old = (
        await c.query(
          'SELECT request_hash,result FROM wa_agent_commands WHERE workspace_id=$1 AND actor_id=$2 AND operation=$3 AND client_key=$4',
          [ctx.workspace.id, ctx.user.id, operation, key],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw new ControlError(409, 'Command key was reused for another request.');
        return old.result;
      }
      const result = await fn(c);
      await c.query(
        'INSERT INTO wa_agent_commands(workspace_id,actor_id,operation,client_key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
        [ctx.workspace.id, ctx.user.id, operation, key, hash, result],
      );
      return result;
    });
  }
  async list(ctx: Context) {
    return {
      items: (
        await this.service.pool.query(
          `SELECT id,kind,name,edit_version AS "editVersion",published_revision AS "publishedRevision",enabled,archived_at AS "archivedAt",draft->>'description' AS description,draft_hash AS "draftHash" FROM wa_agent_definitions WHERE workspace_id=$1 AND NOT system_template ORDER BY updated_at DESC,id DESC LIMIT 100`,
          [ctx.workspace.id],
        )
      ).rows,
    };
  }
  async get(ctx: Context, id: string, c: PoolClient | typeof this.service.pool = this.service.pool) {
    const row = (
      await c.query(
        'SELECT d.*,r.content_hash AS published_hash,r.definition AS published_definition FROM wa_agent_definitions d LEFT JOIN wa_agent_revisions r ON r.workspace_id=d.workspace_id AND r.agent_id=d.id AND r.revision=d.published_revision WHERE d.workspace_id=$1 AND d.id=$2',
        [ctx.workspace.id, id],
      )
    ).rows[0];
    if (!row) throw new ControlError(404, 'Agent definition not found.');
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      draft: row.draft,
      draftHash: row.draft_hash,
      editVersion: row.edit_version,
      publishedRevision: row.published_revision,
      published: row.published_revision
        ? {
            agentId: row.id,
            revision: row.published_revision,
            hash: row.published_hash,
            definition: row.published_definition,
          }
        : null,
      enabled: row.enabled,
      archivedAt: row.archived_at,
      systemTemplate: row.system_template,
    };
  }
  async summary(ctx: Context, id: string) {
    const definition = await this.get(ctx, id);
    const runs = (
      await this.service.pool.query(
        `SELECT id,session_id AS "sessionId",state,created_at AS "createdAt",updated_at AS "updatedAt",error FROM wa_work_items WHERE workspace_id=$1 AND execution_snapshot->'ref'->>'agentId'=$2 ORDER BY created_at DESC LIMIT 100`,
        [ctx.workspace.id, id],
      )
    ).rows;
    const activity = (
      await this.service.pool.query(
        `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,count(*)::int AS runs,count(*) FILTER(WHERE state IN ('failed','uncertain','budget_exhausted'))::int AS failed FROM wa_work_items WHERE workspace_id=$1 AND execution_snapshot->'ref'->>'agentId'=$2 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC')-interval '13 days') AT TIME ZONE 'UTC' GROUP BY 1 ORDER BY 1`,
        [ctx.workspace.id, id],
      )
    ).rows;
    return { definition, runs, activity, timezone: 'UTC' };
  }
  async save(ctx: Context, id: string | undefined, input: unknown) {
    if (!['owner', 'admin', 'editor'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Agent draft editing requires an editor role.');
    const data = command.extend({ definition: definitionSchema }).parse(input);
    if (data.definition.kind === 'coordinator') admin(ctx);
    if (data.definition.outputSchema) schemaValidator(data.definition.outputSchema);
    const hash = await contentHash(data.definition);
    return this.mutate(ctx, `definition.save:${id ?? 'new'}`, data.clientKey, data, async (c) => {
      let agentId = id;
      if (agentId) {
        const old = await this.get(ctx, agentId, c);
        if (old.systemTemplate) throw new ControlError(403, 'Platform setup templates cannot be edited.');
        if (old.editVersion !== data.expectedVersion || old.archivedAt)
          throw new ControlError(409, 'Agent draft changed or was archived.');
        if (old.kind !== data.definition.kind) throw new ControlError(422, 'Agent kind cannot change.');
        await c.query(
          'UPDATE wa_agent_definitions SET name=$3,draft=$4,draft_hash=$5,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2',
          [ctx.workspace.id, agentId, data.definition.name, data.definition, hash],
        );
      } else {
        if (data.expectedVersion !== 0) throw new ControlError(409, 'A new agent requires version zero.');
        agentId = crypto.randomUUID();
        await c.query(
          'INSERT INTO wa_agent_definitions(workspace_id,id,kind,name,owner_id,draft,draft_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [ctx.workspace.id, agentId, data.definition.kind, data.definition.name, ctx.user.id, data.definition, hash],
        );
      }
      await this.service.control.audit(ctx, 'agent.definition_drafted', 'agent_definition', agentId, { hash }, c);
      return this.get(ctx, agentId, c);
    });
  }
  async duplicate(ctx: Context, id: string, input: unknown) {
    admin(ctx);
    const data = command.parse(input);
    return this.mutate(ctx, `definition.duplicate:${id}`, data.clientKey, data, async (c) => {
      const old = await this.get(ctx, id, c);
      if (old.systemTemplate) throw new ControlError(403, 'Platform templates cannot be duplicated.');
      if (old.editVersion !== data.expectedVersion) throw new ControlError(409, 'Agent draft changed.');
      const definition = definitionSchema.parse({ ...old.draft, name: `${old.name.slice(0, 143)} (copy)` });
      const copy = crypto.randomUUID(),
        hash = await contentHash(definition);
      await c.query(
        'INSERT INTO wa_agent_definitions(workspace_id,id,kind,name,owner_id,draft,draft_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [ctx.workspace.id, copy, definition.kind, definition.name, ctx.user.id, definition, hash],
      );
      await this.service.control.audit(
        ctx,
        'agent.definition_duplicated',
        'agent_definition',
        copy,
        { sourceId: id, hash },
        c,
      );
      return this.get(ctx, copy, c);
    });
  }
  async publish(ctx: Context, id: string, input: unknown) {
    admin(ctx);
    const data = command.extend({ draftHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input);
    return this.mutate(ctx, `definition.publish:${id}`, data.clientKey, data, async (c) => {
      const old = await this.get(ctx, id, c);
      if (old.systemTemplate) throw new ControlError(403, 'Platform setup templates cannot be published.');
      if (old.editVersion !== data.expectedVersion || old.draftHash !== data.draftHash || old.archivedAt)
        throw new ControlError(409, 'The reviewed draft changed.');
      const definition = definitionSchema.parse(old.draft);
      await this.validate(ctx, definition, c);
      const revision = Number(
        (
          await c.query(
            'SELECT COALESCE(max(revision),0)+1 AS n FROM wa_agent_revisions WHERE workspace_id=$1 AND agent_id=$2',
            [ctx.workspace.id, id],
          )
        ).rows[0].n,
      );
      await c.query(
        'INSERT INTO wa_agent_revisions(workspace_id,agent_id,revision,definition,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [ctx.workspace.id, id, revision, definition, old.draftHash, ctx.user.id],
      );
      await c.query(
        'UPDATE wa_agent_definitions SET published_revision=$3,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [ctx.workspace.id, id, revision],
      );
      await this.service.control.audit(
        ctx,
        'agent.definition_published',
        'agent_definition',
        id,
        { revision, hash: old.draftHash },
        c,
      );
      return { agentId: id, revision, hash: old.draftHash, editVersion: old.editVersion + 1 };
    });
  }
  async validate(ctx: Context, definition: AgentDefinition, c: PoolClient) {
    const row = (await c.query('SELECT config FROM wa_agents WHERE workspace_id=$1', [ctx.workspace.id])).rows[0];
    if (
      !row ||
      definition.model.connectionId !== row.config.connectionId ||
      definition.model.connectionRevision !== row.config.connectionRevision
    )
      throw new ControlError(422, 'Select the MiniMax connection revision authorized by workspace policy.');
    for (const r of definition.context.resources) {
      const item = await this.service.knowledge.get(ctx, r.id, r.revisionId);
      if (item.artifact.kind !== r.kind) throw new ControlError(422, 'Context resource kind mismatch.');
    }
    if (definition.outputSchema) schemaValidator(definition.outputSchema);
  }
  async operate(ctx: Context, id: string, operation: 'pause' | 'resume' | 'archive', input: unknown) {
    admin(ctx);
    const data = command.parse(input);
    return this.mutate(ctx, `definition.${operation}:${id}`, data.clientKey, data, async (c) => {
      const old = await this.get(ctx, id, c);
      if (old.systemTemplate)
        throw new ControlError(403, 'Platform setup templates cannot be operated through the registry.');
      if (old.editVersion !== data.expectedVersion || old.archivedAt)
        throw new ControlError(409, 'Agent state changed.');
      if (operation === 'resume' && !old.publishedRevision)
        throw new ControlError(422, 'Publish this agent before enabling it.');
      await c.query(
        `UPDATE wa_agent_definitions SET enabled=$3,archived_at=CASE WHEN $4 THEN now() ELSE archived_at END,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2`,
        [ctx.workspace.id, id, operation === 'resume', operation === 'archive'],
      );
      if (operation === 'resume') {
        const waiting = (
          await c.query(
            "UPDATE wa_work_items SET state='queued',edit_version=edit_version+1,error=NULL WHERE workspace_id=$1 AND execution_snapshot->'ref'->>'agentId'=$2 AND state='suspended' RETURNING id,turn_no",
            [ctx.workspace.id, id],
          )
        ).rows;
        for (const work of waiting)
          await this.service.enqueue(c, ctx.workspace.id, work.id, `agent-resume:${id}:${old.editVersion}:${work.id}`);
      }
      await this.service.control.audit(ctx, `agent.definition_${operation}`, 'agent_definition', id, {}, c);
      return this.get(ctx, id, c);
    });
  }
  async resolve(ctx: Context, ref: AgentRevisionRef, c: PoolClient): Promise<AgentExecutionSnapshot> {
    agentRevisionRefSchema.parse(ref);
    const row = (
      await c.query(
        'SELECT d.enabled,d.archived_at,r.definition,r.content_hash FROM wa_agent_definitions d JOIN wa_agent_revisions r ON r.workspace_id=d.workspace_id AND r.agent_id=d.id WHERE d.workspace_id=$1 AND d.id=$2 AND r.revision=$3',
        [ctx.workspace.id, ref.agentId, ref.revision],
      )
    ).rows[0];
    if (!row) throw new ControlError(404, 'Agent revision not found.');
    if (!row.enabled || row.archived_at) throw new ControlError(409, 'This agent is paused or archived.');
    if (row.content_hash !== ref.hash) throw new ControlError(409, 'Agent revision hash mismatch.');
    const definition = definitionSchema.parse(row.definition);
    await this.validate(ctx, definition, c);
    const policy = (
      await c.query('SELECT edit_version,enabled,config FROM wa_agents WHERE workspace_id=$1', [ctx.workspace.id])
    ).rows[0];
    if (!policy?.enabled || !policy.config.allowModel || policy.config.mode !== 'assist')
      throw new ControlError(422, 'Enable MiniMax assistance in workspace policy first.');
    const contextResources = [];
    for (const ref of definition.context.resources) {
      if (definition.context.followHead) {
        const current = await this.service.knowledge.get(ctx, ref.id);
        if (current.artifact.kind !== ref.kind) throw new ControlError(422, 'Context resource kind changed.');
        contextResources.push({ ...ref, revisionId: current.revision.id });
      } else contextResources.push(ref);
    }
    const snapshot = {
      schemaVersion: 1 as const,
      ref,
      definition,
      contextResources,
      actorId: ctx.user.id,
      workspacePolicyVersion: policy.edit_version,
      policyCeiling: { limits: policy.config.limits, runtime: harnessOptionsSchema.parse(policy.config.runtime ?? {}) },
    };
    return { ...snapshot, hash: await contentHash(snapshot) };
  }
  async processSnapshot(
    ctx: Context,
    definition: z.infer<typeof import('../../lib/processes/agent').processNamedAgentDefinitionSchema>,
    c: PoolClient,
  ) {
    const execution = await this.resolve(ctx, definition.agentRef, c);
    if (execution.definition.kind !== 'specialist' || execution.definition.interaction !== 'structured_output')
      throw new ControlError(422, 'Process activities require a published structured-output specialist.');
    if ((await contentHash(execution.definition.outputSchema)) !== (await contentHash(definition.outputSchema)))
      throw new ControlError(422, 'Process output schema must match the published specialist contract.');
    execution.policyCeiling.limits.turns = Math.min(execution.policyCeiling.limits.turns, definition.maxTurns);
    execution.policyCeiling.runtime.durationMs = Math.min(
      execution.policyCeiling.runtime.durationMs,
      definition.deadlineSeconds * 1000,
    );
    const { hash: _hash, ...unsigned } = execution;
    execution.hash = await contentHash(unsigned);
    return execution;
  }
  async access(workspace: string, snapshot: AgentExecutionSnapshot) {
    const ctx = await this.service.control.authorizePrincipal(snapshot.actorId, workspace, 'execute');
    if (snapshot.automaticReview) {
      const rule = (
        await this.service.pool.query(
          'SELECT r.enabled,r.edit_version,b.agent_id,b.revision FROM wa_coordinator_rules r LEFT JOIN wa_workspace_agent_bindings b ON b.workspace_id=r.workspace_id WHERE r.workspace_id=$1',
          [workspace],
        )
      ).rows[0];
      if (
        !rule?.enabled ||
        rule.edit_version !== snapshot.automaticReview.ruleVersion ||
        rule.agent_id !== snapshot.ref.agentId ||
        rule.revision !== snapshot.ref.revision
      )
        throw new ControlError(403, 'The automatic review rule was changed or paused.');
    }
    const policy = await this.service.configuration(ctx);
    const row = (
      await this.service.pool.query(
        'SELECT enabled,archived_at FROM wa_agent_definitions WHERE workspace_id=$1 AND id=$2',
        [workspace, snapshot.ref.agentId],
      )
    ).rows[0];
    if (!row?.enabled || row.archived_at) throw new ControlError(403, 'The selected agent is paused or archived.');
    if (
      !policy?.enabled ||
      !policy.allowModel ||
      policy.mode !== 'assist' ||
      policy.connectionId !== snapshot.definition.model.connectionId ||
      policy.connectionRevision !== snapshot.definition.model.connectionRevision
    )
      throw new ControlError(403, 'Workspace model permission changed.');
    const limits = {
      turns: Math.min(policy.limits.turns, snapshot.definition.limits.turns, snapshot.policyCeiling.limits.turns),
      tools: Math.min(policy.limits.tools, snapshot.definition.limits.tools, snapshot.policyCeiling.limits.tools),
      outputTokens: Math.min(
        policy.limits.outputTokens,
        snapshot.definition.limits.outputTokens,
        snapshot.policyCeiling.limits.outputTokens,
      ),
    };
    const current = harnessOptionsSchema.parse(policy.runtime ?? {}),
      pinned = snapshot.policyCeiling.runtime;
    return {
      ctx,
      config: {
        ...policy,
        limits,
        runtime: {
          ...pinned,
          contextBytes: Math.min(current.contextBytes, pinned.contextBytes),
          totalTokens: Math.min(current.totalTokens, pinned.totalTokens),
          maxTotalTokens: Math.min(
            current.maxTotalTokens ?? current.totalTokens,
            pinned.maxTotalTokens ?? pinned.totalTokens,
          ),
          durationMs: Math.min(current.durationMs, pinned.durationMs),
          compact:
            !!snapshot.definition.memory &&
            snapshot.definition.memory.working === 'compact' &&
            current.compact &&
            pinned.compact,
          concurrency: 1,
          mcp: [],
          extensions: [],
          skills: [],
          delegation: false,
          maxChildren: 1,
          maxDepth: 1,
        },
      },
    };
  }
  async guard(ctx: Context, workId: string, name: string, args: any) {
    const row = (
      await this.service.pool.query('SELECT execution_snapshot FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [
        ctx.workspace.id,
        workId,
      ])
    ).rows[0];
    const snapshot = row?.execution_snapshot as AgentExecutionSnapshot | undefined;
    if (!snapshot) return null;
    await this.access(ctx.workspace.id, snapshot);
    if (!snapshot.definition.tools.includes(name as any))
      throw new ControlError(403, 'Tool is outside the selected agent profile.');
    const scope = {
      ...snapshot.definition.context,
      resources: snapshot.contextResources ?? snapshot.definition.context.resources,
    };
    if (
      args.id &&
      ['artifact_read_v1', 'ontology_validate_v1', 'ontology_propose_v1', 'process_propose_v1'].includes(name)
    ) {
      const ref = scope.resources.find((r) => r.id === args.id);
      if (scope.scope === 'selected' && !ref) throw new ControlError(404, 'Resource is outside this agent context.');
      if (ref) {
        if (args.revisionId && args.revisionId !== ref.revisionId)
          throw new ControlError(403, 'Resource revision is outside this agent context.');
        if (['artifact_read_v1', 'ontology_validate_v1'].includes(name)) args.revisionId = ref.revisionId;
        else {
          const head = await this.service.knowledge.get(ctx, args.id);
          if (head.revision.id !== ref.revisionId)
            throw new ControlError(
              409,
              'The selected resource changed. Start a new assignment with its current revision.',
            );
        }
      }
    }
    return snapshot;
  }
}
