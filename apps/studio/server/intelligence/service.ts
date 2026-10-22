import { implementationHash } from '../../lib/processes/implementation';
import { ToolStore } from '../tools/store';
import { z } from 'zod';
import type { Context } from '../../lib/control/contracts';
import { taskRequestSchema, analysisSchema } from '../../lib/intelligence/contracts';
import { generateWorkflow } from '../../lib/intelligence/generation';
import { contentHash } from '../../lib/knowledge/contracts';
import { processDocumentSchema as processSchema } from '../../lib/knowledge/process';
import { ControlError } from '../control/service';
import { KnowledgeStore, taskRow } from '../knowledge/store';
export class IntelligenceService {
  constructor(readonly knowledge: KnowledgeStore) {}
  validateNamedAgent?: (
    ctx: Context,
    definition: import('zod').z.infer<typeof import('../../lib/processes/agent').processNamedAgentDefinitionSchema>,
  ) => Promise<unknown>;
  validateRuntime?: (flow: import('../../lib/flows/types').AgentFlow) => Promise<unknown>;
  get control() {
    return this.knowledge.control;
  }
  get pool() {
    return this.knowledge.pool;
  }
  async list(ctx: Context, cursor?: string) {
    const result = await this.pool.query(
      'SELECT * FROM wi_tasks WHERE workspace_id=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 51',
      [ctx.workspace.id, cursor ?? null],
    );
    return {
      items: result.rows.slice(0, 50).map(taskRow),
      nextCursor: result.rows.length > 50 ? result.rows[49].id : null,
    };
  }
  async create(ctx: Context, input: unknown) {
    const data = taskRequestSchema.parse(input),
      source = await this.knowledge.get(ctx, data.sourceId, data.sourceRevisionId);
    if (source.artifact.kind !== 'source') throw new ControlError(422, 'Select a process source.');
    const connections = await this.control.connections(ctx);
    const connection = connections.find(
      (c) =>
        c.id === data.connectionId &&
        c.revision === data.connectionRevision &&
        c.provider === 'minimax' &&
        c.status === 'configured',
    );
    if (!connection) throw new ControlError(422, 'Select a configured MiniMax connection in this workspace.');
    const taskId = crypto.randomUUID();
    await this.control.transaction(async (client) => {
      await client.query(
        'INSERT INTO wi_tasks(workspace_id,id,name,actor_id,source_id,source_revision_id,connection_id,connection_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          ctx.workspace.id,
          taskId,
          source.artifact.name,
          ctx.user.id,
          data.sourceId,
          data.sourceRevisionId,
          data.connectionId,
          data.connectionRevision,
        ],
      );
      await client.query("INSERT INTO wi_outbox(id,workspace_id,task_id,kind) VALUES($1,$2,$3,'start')", [
        `start:${taskId}`,
        ctx.workspace.id,
        taskId,
      ]);
      await this.control.audit(ctx, 'intelligence.requested', 'intelligence_task', taskId, {}, client);
    });
    return (await this.knowledge.task(ctx, taskId)).record;
  }
  async validateAnalysis(ctx: Context, taskId: string, input: unknown) {
    const analysis = analysisSchema.parse(input),
      task = await this.knowledge.task(ctx, taskId);
    function markUncited(value: unknown) {
      if (Array.isArray(value)) {
        value.forEach(markUncited);
        return;
      }
      if (value && typeof value === 'object') {
        const element = value as Record<string, unknown>;
        if (Array.isArray(element.evidence) && element.evidence.length === 0)
          element.evidence.push({
            kind: 'inference',
            taskId,
            explanation: 'No document citation was supplied. Confirm this assertion during review.',
          });
        Object.values(element).forEach(markUncited);
      }
    }
    markUncited(analysis);
    await this.knowledge.validate(ctx, 'ontology', analysis.ontology);
    await this.knowledge.validate(ctx, 'process', analysis.process);
    const blocks = new Set(
      (await this.knowledge.blocks(ctx, task.record.sourceId, task.record.sourceRevisionId)).map((b) => b.id),
    );
    function check(v: unknown) {
      if (Array.isArray(v)) {
        v.forEach(check);
        return;
      }
      if (v && typeof v === 'object') {
        const e = v as Record<string, unknown>;
        if (e.kind === 'source' && (e.revisionId !== task.record.sourceRevisionId || !blocks.has(e.blockId)))
          throw new ControlError(422, 'Analysis evidence must cite a block in the selected source revision.');
        if (e.kind === 'inference' && e.taskId !== taskId)
          throw new ControlError(422, 'Inference must reference this task.');
        Object.values(e).forEach(check);
      }
    }
    check(analysis);
    return analysis;
  }
  async revise(ctx: Context, taskId: string, input: unknown) {
    const data = z
      .object({ expectedVersion: z.number().int().positive(), analysis: analysisSchema })
      .strict()
      .parse(input);
    const analysis = await this.validateAnalysis(ctx, taskId, data.analysis);
    const status = analysis.process.questions.some((q) => !q.answer?.trim()) ? 'needs_clarification' : 'ready';
    await this.control.transaction(async (client) => {
      const task = (
        await client.query('SELECT * FROM wi_tasks WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          taskId,
        ])
      ).rows[0];
      if (!task) throw new ControlError(404, 'Task not found.');
      if (task.edit_version !== data.expectedVersion)
        throw new ControlError(409, 'Task changed. Reload before saving.');
      if (!['ready', 'needs_clarification'].includes(task.status))
        throw new ControlError(409, 'This task cannot be edited in its current state.');
      await client.query(
        'UPDATE wi_tasks SET analysis=$3,summary=$4,status=$5,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [ctx.workspace.id, taskId, analysis, analysis.summary, status],
      );
      if (status === 'ready')
        await client.query(
          "INSERT INTO wi_outbox(id,workspace_id,task_id,kind) VALUES($1,$2,$3,'answer') ON CONFLICT DO NOTHING",
          [`revised:${taskId}:${data.expectedVersion}`, ctx.workspace.id, taskId],
        );
      await client.query(
        'INSERT INTO wi_proposal_revisions(workspace_id,task_id,task_version,analysis,actor_id) VALUES($1,$2,$3,$4,$5)',
        [ctx.workspace.id, taskId, data.expectedVersion + 1, analysis, ctx.user.id],
      );
      await this.control.audit(ctx, 'intelligence.revised', 'intelligence_task', taskId, {}, client);
    });
    return (await this.knowledge.task(ctx, taskId)).record;
  }
  async answers(ctx: Context, taskId: string, input: unknown) {
    const data = z
      .object({
        expectedVersion: z.number().int().positive(),
        answers: z.record(z.string(), z.string().trim().min(1).max(5000)),
      })
      .strict()
      .parse(input);
    await this.control.transaction(async (client) => {
      const row = (
        await client.query('SELECT * FROM wi_tasks WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          taskId,
        ])
      ).rows[0];
      if (!row) throw new ControlError(404, 'Task not found.');
      if (row.edit_version !== data.expectedVersion || row.status !== 'needs_clarification')
        throw new ControlError(409, 'This clarification is no longer current. Reload the task.');
      const questions = analysisSchema.parse(row.analysis).process.questions;
      if (
        !Object.keys(data.answers).length ||
        Object.keys(data.answers).some((key) => !questions.some((q) => q.id === key))
      )
        throw new ControlError(422, 'Answer the current questions only.');
      await client.query(
        'INSERT INTO wi_decisions(workspace_id,id,task_id,task_version,actor_id,answers) VALUES($1,$2,$3,$4,$5,$6)',
        [ctx.workspace.id, crypto.randomUUID(), taskId, row.edit_version, ctx.user.id, data.answers],
      );
      await client.query(
        "UPDATE wi_tasks SET answers=answers || $3::jsonb,status='queued',edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [ctx.workspace.id, taskId, JSON.stringify(data.answers)],
      );
      await client.query("INSERT INTO wi_outbox(id,workspace_id,task_id,kind,payload) VALUES($1,$2,$3,'answer',$4)", [
        `answer:${taskId}:${row.edit_version}`,
        ctx.workspace.id,
        taskId,
        { version: row.edit_version + 1 },
      ]);
      await this.control.audit(ctx, 'intelligence.answered', 'intelligence_task', taskId, {}, client);
    });
    return (await this.knowledge.task(ctx, taskId)).record;
  }
  async cancel(ctx: Context, taskId: string) {
    await this.control.transaction(async (client) => {
      const result = await client.query(
        "UPDATE wi_tasks SET status='cancelled',edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status IN ('queued','analyzing','needs_clarification','ready') RETURNING id",
        [ctx.workspace.id, taskId],
      );
      if (!result.rowCount) {
        await this.knowledge.task(ctx, taskId);
        return;
      }
      await client.query(
        "INSERT INTO wi_outbox(id,workspace_id,task_id,kind) VALUES($1,$2,$3,'cancel') ON CONFLICT DO NOTHING",
        [`cancel:${taskId}`, ctx.workspace.id, taskId],
      );
      await this.control.audit(ctx, 'intelligence.cancelled', 'intelligence_task', taskId, {}, client);
    });
    return (await this.knowledge.task(ctx, taskId)).record;
  }
  async acceptKnowledge(ctx: Context, taskId: string, input: unknown) {
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(input);
    const task = (await this.knowledge.task(ctx, taskId)).record;
    if (
      !['ready', 'needs_clarification'].includes(task.status) ||
      task.editVersion !== expectedVersion ||
      !task.analysis
    )
      throw new ControlError(409, 'Review the current proposal first.');
    const analysis = await this.validateAnalysis(ctx, taskId, task.analysis);
    return this.control.transaction(async (client) => {
      const locked = (
        await client.query('SELECT * FROM wi_tasks WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          taskId,
        ])
      ).rows[0];
      if (locked.edit_version !== expectedVersion || !['ready', 'needs_clarification'].includes(locked.status))
        throw new ControlError(409, 'The proposal changed. Reload before accepting.');
      const previous = (
        await client.query(
          'SELECT * FROM wi_knowledge_acceptances WHERE workspace_id=$1 AND task_id=$2 AND task_version=$3',
          [ctx.workspace.id, taskId, expectedVersion],
        )
      ).rows[0];
      if (previous) return { ontologyId: previous.ontology_id, processId: previous.process_id };
      const ontologyId = crypto.randomUUID(),
        ontologyRevision = crypto.randomUUID(),
        processId = crypto.randomUUID(),
        processRevision = crypto.randomUUID();
      const process = {
        ...analysis.process,
        ontologyRefs: [...analysis.process.ontologyRefs, { artifactId: ontologyId, revisionId: ontologyRevision }],
      };
      for (const item of [
        { id: ontologyId, revision: ontologyRevision, kind: 'ontology', content: analysis.ontology },
        { id: processId, revision: processRevision, kind: 'process', content: process },
      ]) {
        await client.query('INSERT INTO wi_artifacts(workspace_id,id,kind,name,revision_id) VALUES($1,$2,$3,$4,$5)', [
          ctx.workspace.id,
          item.id,
          item.kind,
          task.name,
          item.revision,
        ]);
        await client.query(
          'INSERT INTO wi_revisions(workspace_id,id,artifact_id,content_hash,content,created_by) VALUES($1,$2,$3,$4,$5,$6)',
          [ctx.workspace.id, item.revision, item.id, await contentHash(item.content), item.content, ctx.user.id],
        );
        await client.query('INSERT INTO wi_reviews(workspace_id,revision_id,actor_id) VALUES($1,$2,$3)', [
          ctx.workspace.id,
          item.revision,
          ctx.user.id,
        ]);
      }
      await client.query(
        'INSERT INTO wi_knowledge_acceptances(workspace_id,task_id,task_version,ontology_id,ontology_revision_id,process_id,process_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [ctx.workspace.id, taskId, expectedVersion, ontologyId, ontologyRevision, processId, processRevision],
      );
      await this.control.audit(
        ctx,
        'intelligence.knowledge_accepted',
        'intelligence_task',
        taskId,
        { ontologyId, processId },
        client,
      );
      return { ontologyId, processId };
    });
  }
  async previewProcess(ctx: Context, artifactId: string, input: unknown) {
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(input);
    const current = await this.knowledge.get(ctx, artifactId);
    if (current.artifact.kind !== 'process' || current.artifact.editVersion !== expectedVersion)
      throw new ControlError(409, 'The process changed. Save and reload before compiling.');
    const generated = await checkedGeneration(current.artifact.name, current.revision.content, {
      artifactId,
      revisionId: current.revision.id,
    });
    const captured = (
      this.validateRuntime
        ? await this.validateRuntime({ ...generated.flow, workspaceId: ctx.workspace.id })
        : generated.flow
    ) as import('../../lib/flows/types').AgentFlow;
    for (const flow of [captured, ...Object.values(captured.definitions ?? {})])
      for (const node of flow.nodes) {
        const op = node.config.operation;
        if (op?.kind !== 'step' || !op.handler.startsWith('workspace_tool.')) continue;
        const match = op.handler.match(/^workspace_tool\.([a-f0-9-]{36})\.r([1-9][0-9]*)$/);
        if (!match) throw new ControlError(422, 'Invalid workspace tool binding.');
        const build = await new ToolStore(this.control).releaseBuild(ctx, match[1], Number(match[2]));
        if (!build.manifest.exposure.includes('workflow'))
          throw new ControlError(403, `${node.name}: tool is not exposed to workflows.`);
      }
    const process = processSchema.parse(current.revision.content);
    if (process.schemaVersion === 2)
      for (const element of process.graph.elements) {
        if (element.kind !== 'activity' || element.binding.kind !== 'agent') continue;
        if ('agentRef' in element.binding.definition) {
          if (!this.validateNamedAgent) throw new ControlError(422, 'Named process agents are unavailable.');
          await this.validateNamedAgent(ctx, element.binding.definition);
          continue;
        }
        const policy = (
          await this.pool.query('SELECT enabled,edit_version,config FROM wa_agents WHERE workspace_id=$1', [
            ctx.workspace.id,
          ])
        ).rows[0];
        if (
          !policy?.enabled ||
          !policy.config.allowModel ||
          policy.edit_version !== element.binding.definition.configurationRevision
        )
          throw new ControlError(
            409,
            `${element.name}: workspace agent policy changed or MiniMax is disabled. Rebind and review this activity.`,
          );
      }
    const digest = await contentHash({
      compiler: 'process-compiler@3',
      revision: current.revision.id,
      name: current.artifact.name,
      content: current.revision.content,
    });
    return {
      digest,
      revisionId: current.revision.id,
      reviewed: current.revision.reviewed,
      manifest: generated.manifest,
      nodes: generated.flow.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
      connections: generated.flow.edges,
      subprocesses: Object.entries(generated.flow.definitions ?? {}).map(([id, f]) => ({ id, name: f.name })),
    };
  }
  async processImplementations(ctx: Context, artifactId: string) {
    const current = await this.knowledge.get(ctx, artifactId);
    if (current.artifact.kind !== 'process') throw new ControlError(422, 'Select a process.');
    const rows = (
      await this.pool.query(
        `SELECT g.process_revision_id,g.flow_id,g.manifest,g.graph,f.graph AS current_graph
      FROM wi_manual_generations g JOIN wi_revisions r ON r.workspace_id=g.workspace_id AND r.id=g.process_revision_id
      LEFT JOIN studio_flows f ON f.workspace_id=g.workspace_id AND f.id=g.flow_id
      WHERE g.workspace_id=$1 AND r.artifact_id=$2 ORDER BY r.created_at DESC,r.id`,
        [ctx.workspace.id, artifactId],
      )
    ).rows;
    const items = await Promise.all(
      rows.map(async (row) => ({
        revisionId: row.process_revision_id,
        flowId: row.flow_id,
        manifest: row.manifest,
        available: !!row.current_graph,
        currentRevision: row.process_revision_id === current.revision.id,
        drifted:
          !!row.current_graph &&
          (await implementationHash(row.graph)) !== (await implementationHash(row.current_graph)),
      })),
    );
    return { items };
  }
  async generateProcess(ctx: Context, artifactId: string, input: unknown) {
    const { expectedVersion, previewDigest } = z
      .object({
        expectedVersion: z.number().int().positive(),
        previewDigest: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(input);
    const current = await this.knowledge.get(ctx, artifactId);
    if (
      current.artifact.kind !== 'process' ||
      !current.revision.reviewed ||
      current.artifact.editVersion !== expectedVersion
    )
      throw new ControlError(409, 'Save and review the current process revision first.');
    if (previewDigest) {
      const preview = await this.previewProcess(ctx, artifactId, { expectedVersion });
      if (preview.digest !== previewDigest)
        throw new ControlError(409, 'Compilation preview is stale. Review the latest preview.');
    }
    for (const ref of processSchema.parse(current.revision.content).ontologyRefs) {
      const referenced = await this.knowledge.get(ctx, ref.artifactId, ref.revisionId);
      if (referenced.artifact.kind !== 'ontology' || !referenced.revision.reviewed)
        throw new ControlError(422, 'Review every referenced ontology revision before generating a workflow.');
    }
    const generated = await checkedGeneration(current.artifact.name, current.revision.content, {
      artifactId,
      revisionId: current.revision.id,
    });
    generated.manifest.previewDigest =
      previewDigest ?? (await this.previewProcess(ctx, artifactId, { expectedVersion })).digest;
    const graph = {
      ...generated.flow,
      editVersion: 1,
      workspaceId: ctx.workspace.id,
      sourceReference: `process:${current.revision.id}`,
    };
    return this.control.transaction(async (client) => {
      const head = (
        await client.query('SELECT edit_version FROM wi_artifacts WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          artifactId,
        ])
      ).rows[0];
      if (head?.edit_version !== expectedVersion) throw new ControlError(409, 'The process changed. Reload first.');
      const existing = (
        await client.query(
          'SELECT flow_id FROM wi_manual_generations WHERE workspace_id=$1 AND process_revision_id=$2',
          [ctx.workspace.id, current.revision.id],
        )
      ).rows[0];
      if (existing) return { flowId: existing.flow_id };
      await client.query('INSERT INTO studio_flows(id,graph,workspace_id) VALUES($1,$2,$3)', [
        graph.id,
        graph,
        ctx.workspace.id,
      ]);
      await client.query(
        'INSERT INTO studio_flow_revisions(workspace_id,flow_id,edit_version,graph) VALUES($1,$2,1,$3)',
        [ctx.workspace.id, graph.id, graph],
      );
      await client.query(
        'INSERT INTO wi_manual_generations(workspace_id,process_revision_id,flow_id,manifest,graph) VALUES($1,$2,$3,$4,$5)',
        [ctx.workspace.id, current.revision.id, graph.id, generated.manifest, graph],
      );
      await this.control.audit(
        ctx,
        'workflow.saved',
        'workflow',
        graph.id,
        { processRevision: current.revision.id },
        client,
      );
      return { flowId: graph.id };
    });
  }
  async apply(ctx: Context, taskId: string, input: unknown) {
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(input);
    const old = (
      await this.pool.query('SELECT flow_id FROM wi_applications WHERE workspace_id=$1 AND task_id=$2', [
        ctx.workspace.id,
        taskId,
      ])
    ).rows[0];
    if (old) return { flowId: old.flow_id };
    const { record } = await this.knowledge.task(ctx, taskId);
    if (record.status !== 'ready' || record.editVersion !== expectedVersion || !record.analysis)
      throw new ControlError(409, 'Review the current ready proposal before applying.');
    const analysis = await this.validateAnalysis(ctx, taskId, record.analysis);
    const accepted = (
      await this.pool.query(
        'SELECT * FROM wi_knowledge_acceptances WHERE workspace_id=$1 AND task_id=$2 AND task_version=$3',
        [ctx.workspace.id, taskId, expectedVersion],
      )
    ).rows[0];
    const ontologyId = accepted?.ontology_id ?? crypto.randomUUID(),
      ontologyRevision = accepted?.ontology_revision_id ?? crypto.randomUUID(),
      processId = accepted?.process_id ?? crypto.randomUUID(),
      processRevision = accepted?.process_revision_id ?? crypto.randomUUID();
    const process = {
      ...analysis.process,
      ontologyRefs: [...analysis.process.ontologyRefs, { artifactId: ontologyId, revisionId: ontologyRevision }],
    };
    for (const ref of analysis.process.ontologyRefs) {
      const referenced = await this.knowledge.get(ctx, ref.artifactId, ref.revisionId);
      if (referenced.artifact.kind !== 'ontology' || !referenced.revision.reviewed)
        throw new ControlError(422, 'Review every referenced ontology revision before generating a workflow.');
    }
    const generated = await checkedGeneration(record.name, process, {
      artifactId: processId,
      revisionId: processRevision,
    });
    const flow = {
      ...generated.flow,
      editVersion: 1,
      workspaceId: ctx.workspace.id,
      sourceReference: `intelligence:${taskId}`,
      generationManifestId: taskId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.control.transaction(async (client) => {
      // Membership is locked alongside the mutation, not cached in a durable step.
      const member = (
        await client.query('SELECT role FROM cp_memberships WHERE workspace_id=$1 AND user_id=$2 FOR SHARE', [
          ctx.workspace.id,
          ctx.user.id,
        ])
      ).rows[0];
      if (!member || member.role === 'viewer') throw new ControlError(403, 'Editor access is required.');
      const task = (
        await client.query('SELECT * FROM wi_tasks WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          taskId,
        ])
      ).rows[0];
      const existing = (
        await client.query('SELECT flow_id FROM wi_applications WHERE workspace_id=$1 AND task_id=$2', [
          ctx.workspace.id,
          taskId,
        ])
      ).rows[0];
      if (existing) {
        flow.id = existing.flow_id;
        return;
      }
      if (!task || task.edit_version !== expectedVersion || task.status !== 'ready')
        throw new ControlError(409, 'The proposal changed. Reload before applying.');
      for (const item of accepted
        ? []
        : [
            { id: ontologyId, revision: ontologyRevision, kind: 'ontology', content: analysis.ontology },
            { id: processId, revision: processRevision, kind: 'process', content: process },
          ]) {
        await client.query('INSERT INTO wi_artifacts(workspace_id,id,kind,name,revision_id) VALUES($1,$2,$3,$4,$5)', [
          ctx.workspace.id,
          item.id,
          item.kind,
          record.name,
          item.revision,
        ]);
        await client.query(
          'INSERT INTO wi_revisions(workspace_id,id,artifact_id,content_hash,content,created_by) VALUES($1,$2,$3,$4,$5,$6)',
          [ctx.workspace.id, item.revision, item.id, await contentHash(item.content), item.content, ctx.user.id],
        );
        await client.query('INSERT INTO wi_reviews(workspace_id,revision_id,actor_id) VALUES($1,$2,$3)', [
          ctx.workspace.id,
          item.revision,
          ctx.user.id,
        ]);
      }
      await client.query('INSERT INTO studio_flows(id,graph,workspace_id) VALUES($1,$2,$3)', [
        flow.id,
        flow,
        ctx.workspace.id,
      ]);
      await client.query(
        'INSERT INTO studio_flow_revisions(workspace_id,flow_id,edit_version,graph) VALUES($1,$2,1,$3)',
        [ctx.workspace.id, flow.id, flow],
      );
      await client.query(
        'INSERT INTO wi_applications(workspace_id,task_id,flow_id,manifest,graph) VALUES($1,$2,$3,$4,$5)',
        [
          ctx.workspace.id,
          taskId,
          flow.id,
          {
            ...generated.manifest,
            graphHash: await contentHash(flow),
            source: { artifactId: record.sourceId, revisionId: record.sourceRevisionId },
          },
          flow,
        ],
      );
      await client.query(
        "UPDATE wi_tasks SET status='applied',flow_id=$3,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [ctx.workspace.id, taskId, flow.id],
      );
      await this.control.audit(ctx, 'intelligence.applied', 'intelligence_task', taskId, { flowId: flow.id }, client);
      await this.control.audit(ctx, 'workflow.saved', 'workflow', flow.id, {}, client);
    });
    return { flowId: flow.id };
  }
}

async function checkedGeneration(...args: Parameters<typeof generateWorkflow>) {
  try {
    return await generateWorkflow(...args);
  } catch (err) {
    throw new ControlError(422, err instanceof Error ? err.message : 'Process cannot be generated.');
  }
}
