import { z } from 'zod';
import { toolArguments } from '../../lib/agent/contracts';
import { contentHash } from '../../lib/knowledge/contracts';
import type { Context } from '../../lib/control/contracts';
import { ControlError } from '../control/service';
import type { AgentService } from './service';
import { enqueueWorkspaceRequest } from './intake';
export class AgentCoordination {
  constructor(readonly service: AgentService) {}
  async specialists(ctx: Context, query: string) {
    return {
      items: (
        await this.service.pool.query(
          `SELECT d.id AS "agentId",r.revision,r.content_hash AS hash,r.definition->>'name' AS name,r.definition->>'description' AS description FROM wa_agent_definitions d JOIN wa_agent_revisions r ON r.workspace_id=d.workspace_id AND r.agent_id=d.id AND r.revision=d.published_revision WHERE d.workspace_id=$1 AND d.kind='specialist' AND d.enabled AND d.archived_at IS NULL AND (r.definition->>'name' ILIKE $2 OR r.definition->>'description' ILIKE $2) ORDER BY d.name,d.id LIMIT 50`,
          [ctx.workspace.id, `%${query.replaceAll('%', '').replaceAll('_', '')}%`],
        )
      ).rows,
    };
  }
  async list(ctx: Context) {
    return {
      items: (
        await this.service.pool.query(
          `SELECT s.id,s.proposal,s.state,s.edit_version AS "editVersion",s.content_hash AS hash,s.created_at AS "createdAt",a.id AS "assignmentId",r.work_item_id AS "workItemId",w.state AS "workState" FROM wa_agent_suggestions s LEFT JOIN wa_agent_assignments a ON a.workspace_id=s.workspace_id AND a.suggestion_id=s.id LEFT JOIN wa_requests r ON r.workspace_id=a.workspace_id AND r.id=a.request_id LEFT JOIN wa_work_items w ON w.workspace_id=r.workspace_id AND w.id=r.work_item_id WHERE s.workspace_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 100`,
          [ctx.workspace.id],
        )
      ).rows,
    };
  }
  async propose(ctx: Context, workId: string, input: unknown) {
    const proposal = toolArguments.workspace_suggestion_propose_v1.parse(input);
    const { work } = await this.service.authorize(ctx.workspace.id, workId),
      snapshot = work.execution_snapshot;
    if (!snapshot || snapshot.definition.kind !== 'coordinator')
      throw new ControlError(403, 'Suggestions require the active coordinator.');
    return this.service.control.transaction(async (c) => {
      await this.service.definitions.lock(c, ctx.workspace.id);
      const binding = (
        await c.query('SELECT agent_id,revision FROM wa_workspace_agent_bindings WHERE workspace_id=$1', [
          ctx.workspace.id,
        ])
      ).rows[0];
      if (binding?.agent_id !== snapshot.ref.agentId || binding.revision !== snapshot.ref.revision)
        throw new ControlError(409, 'The workspace coordinator changed.');
      const receipts = (
        await c.query(
          "SELECT id,result FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND id=ANY($3::text[]) AND kind='tool' AND state='completed' AND request->>'name'='artifact_read_v1' AND NOT(result ? 'error')",
          [ctx.workspace.id, workId, proposal.evidenceReceiptIds],
        )
      ).rows;
      if (receipts.length !== proposal.evidenceReceiptIds.length)
        throw new ControlError(422, 'Suggestion evidence must reference successful source reads in this activity.');
      if (
        proposal.basis === 'observed' &&
        (!receipts.length ||
          proposal.context.some(
            (ref) =>
              !receipts.some((r) => r.result.artifact?.id === ref.id && r.result.revision?.id === ref.revisionId),
          ))
      )
        throw new ControlError(
          422,
          'Observed findings require recorded source evidence. Use an inspection-gap suggestion for unread material.',
        );
      for (const ref of proposal.context) {
        if (
          snapshot.definition.context.scope === 'selected' &&
          !(snapshot.contextResources ?? snapshot.definition.context.resources).some(
            (r: any) => r.id === ref.id && r.revisionId === ref.revisionId,
          )
        )
          throw new ControlError(403, 'Suggested context is outside the coordinator scope.');
        const item = await this.service.knowledge.get(ctx, ref.id, ref.revisionId);
        if (item.artifact.kind !== ref.kind) throw new ControlError(422, 'Suggested resource kind mismatch.');
      }
      if (proposal.executor) {
        const executor = await this.service.definitions.resolve(ctx, proposal.executor, c);
        if (executor.definition.kind !== 'specialist') throw new ControlError(422, 'Select a published specialist.');
      }
      const finding = await contentHash({ key: proposal.key }),
        evidence = await contentHash([...proposal.context].sort((a, b) => a.id.localeCompare(b.id)));
      const existing = (
        await c.query(
          'SELECT id,state FROM wa_agent_suggestions WHERE workspace_id=$1 AND coordinator_id=$2 AND finding_key=$3 AND evidence_hash=$4',
          [ctx.workspace.id, snapshot.ref.agentId, finding, evidence],
        )
      ).rows[0];
      if (existing) return { id: existing.id, state: existing.state, summary: proposal.goal };
      await c.query(
        "UPDATE wa_agent_suggestions SET state='superseded',edit_version=edit_version+1 WHERE workspace_id=$1 AND coordinator_id=$2 AND finding_key=$3 AND state='proposed'",
        [ctx.workspace.id, snapshot.ref.agentId, finding],
      );
      const id = crypto.randomUUID(),
        hash = await contentHash(proposal);
      await c.query(
        'INSERT INTO wa_agent_suggestions(workspace_id,id,coordinator_id,coordinator_revision,work_id,finding_key,evidence_hash,proposal,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [ctx.workspace.id, id, snapshot.ref.agentId, snapshot.ref.revision, workId, finding, evidence, proposal, hash],
      );
      await this.service.control.audit(ctx, 'agent.suggestion_proposed', 'agent_suggestion', id, { workId }, c);
      return { id, state: 'proposed', summary: proposal.goal };
    });
  }
  async decide(ctx: Context, id: string, action: 'accept' | 'dismiss', input: unknown) {
    if (!['owner', 'admin', 'editor'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Editor access is required.');
    const data = z
      .object({
        clientKey: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(input);
    return this.service.definitions.mutate(ctx, `suggestion.${action}:${id}`, data.clientKey, data, async (c) => {
      const row = (
        await c.query('SELECT * FROM wa_agent_suggestions WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          id,
        ])
      ).rows[0];
      if (!row) throw new ControlError(404, 'Suggestion not found.');
      if (row.state !== 'proposed' || row.edit_version !== data.expectedVersion || row.content_hash !== data.hash)
        throw new ControlError(409, 'The suggestion changed or was already decided.');
      const proposal = toolArguments.workspace_suggestion_propose_v1.parse(row.proposal);
      let assignmentId: string | undefined, requestId: string | undefined;
      if (action === 'accept') {
        if (!proposal.executor) throw new ControlError(422, 'Publish and select a specialist before assignment.');
        const executor = await this.service.definitions.resolve(ctx, proposal.executor, c);
        if (
          executor.definition.kind !== 'specialist' ||
          executor.definition.tools.some(
            (t) =>
              ![
                'workspace_describe_v1',
                'artifact_read_v1',
                'capability_search_v1',
                'ontology_validate_v1',
                'ask_user_v2',
              ].includes(t),
          )
        )
          throw new ControlError(422, 'Initial specialist assignments require a read-only agent profile.');
        for (const ref of proposal.context) {
          const current = (
            await c.query('SELECT revision_id FROM wi_artifacts WHERE workspace_id=$1 AND id=$2 FOR SHARE', [
              ctx.workspace.id,
              ref.id,
            ])
          ).rows[0];
          if (current?.revision_id !== ref.revisionId)
            throw new ControlError(409, 'Suggestion evidence changed. Request a refreshed suggestion.');
          if (
            !(executor.contextResources ?? executor.definition.context.resources).some(
              (r) => r.id === ref.id && r.revisionId === ref.revisionId,
            )
          )
            throw new ControlError(403, 'Context is outside the specialist profile.');
        }
        assignmentId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        await c.query(
          'INSERT INTO wa_sessions(workspace_id,id,created_by,title,client_key,agent_id) VALUES($1,$2,$3,$4,$5,$6)',
          [
            ctx.workspace.id,
            sessionId,
            ctx.user.id,
            proposal.goal.slice(0, 200),
            `assignment:${assignmentId}`,
            proposal.executor.agentId,
          ],
        );
        const request = await enqueueWorkspaceRequest(
          this.service,
          ctx,
          {
            clientRequestId: crypto.randomUUID(),
            text: `${proposal.goal}\nCompletion criteria: ${proposal.successCriteria}`,
            agent: proposal.executor,
            sessionId,
            attachments: proposal.context,
            context: { surface: 'intelligence' },
          },
          'workbench',
          undefined,
          c,
        );
        requestId = request.requestId;
        await c.query(
          'INSERT INTO wa_agent_assignments(workspace_id,id,suggestion_id,actor_id,request_id,executor) VALUES($1,$2,$3,$4,$5,$6)',
          [ctx.workspace.id, assignmentId, id, ctx.user.id, requestId, proposal.executor],
        );
      }
      await c.query(
        'UPDATE wa_agent_suggestions SET state=$3,edit_version=edit_version+1 WHERE workspace_id=$1 AND id=$2',
        [ctx.workspace.id, id, action === 'accept' ? 'accepted' : 'dismissed'],
      );
      await this.service.control.audit(
        ctx,
        `agent.suggestion_${action}`,
        'agent_suggestion',
        id,
        { ...(assignmentId ? { assignmentId } : {}) },
        c,
      );
      return {
        id,
        state: action === 'accept' ? 'accepted' : 'dismissed',
        ...(assignmentId ? { assignmentId, requestId } : {}),
      };
    });
  }
}
