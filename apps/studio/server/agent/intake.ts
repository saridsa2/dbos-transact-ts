import { interactionErrors, interactionAnswerMatches } from '../../lib/agent/interactions';
import type { AgentService } from './service';
import type { Context } from '../../lib/control/contracts';
import { workspaceRequestSchema } from '../../lib/agent/contracts';
import { contentHash } from '../../lib/knowledge/contracts';
import { ControlError } from '../control/service';
import type { PoolClient } from 'pg';
const blocked = [
  'queued',
  'preparing',
  'reasoning',
  'executing_tool',
  'waiting_for_user',
  'waiting_for_tasks',
  'ready_for_review',
];
export async function enqueueWorkspaceRequest(
  service: AgentService,
  ctx: Context,
  input: unknown,
  origin: 'shell' | 'workbench' | 'workspace-event' = 'shell',
  sourceEventId?: string,
  transaction?: PoolClient,
  restriction?: { totalTokens: number; ruleVersion: number },
) {
  const data = workspaceRequestSchema.parse(input);
  if (origin !== 'workspace-event') origin = data.origin;
  const hash = await contentHash({ data, origin, ...(restriction ? { restriction } : {}) });
  const submit = async (c: PoolClient) => {
    await service.definitions.lock(c, ctx.workspace.id);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-intake-submit:'||$1,0))", [ctx.workspace.id]);
    const prior = (
      await c.query('SELECT * FROM wa_requests WHERE workspace_id=$1 AND actor_id=$2 AND client_key=$3', [
        ctx.workspace.id,
        ctx.user.id,
        data.clientRequestId,
      ])
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new ControlError(409, 'Request key was already used for another intent.');
      return receipt(prior);
    }
    const configuration = await service.configuration(ctx);
    if (!configuration?.enabled) throw new ControlError(422, 'Enable the workspace agent in Agent settings first.');
    const bound =
      data.kind === 'goal' && !data.agent && origin !== 'workspace-event'
        ? data.sessionId
          ? (
              await c.query(
                'SELECT d.id AS agent_id,r.revision,r.content_hash FROM wa_sessions s JOIN wa_agent_definitions d ON d.workspace_id=s.workspace_id AND d.id=s.agent_id JOIN wa_agent_revisions r ON r.workspace_id=d.workspace_id AND r.agent_id=d.id AND r.revision=d.published_revision WHERE s.workspace_id=$1 AND s.id=$2',
                [ctx.workspace.id, data.sessionId],
              )
            ).rows[0]
          : (
              await c.query(
                'SELECT agent_id,revision,content_hash FROM wa_workspace_agent_bindings WHERE workspace_id=$1',
                [ctx.workspace.id],
              )
            ).rows[0]
        : null;
    const target =
      data.agent ??
      (bound ? { agentId: bound.agent_id, revision: bound.revision, hash: bound.content_hash } : undefined);
    const snapshot = target ? await service.definitions.resolve(ctx, target, c) : undefined;
    if (snapshot && restriction) {
      snapshot.policyCeiling.runtime.totalTokens = Math.min(
        snapshot.policyCeiling.runtime.totalTokens,
        restriction.totalTokens,
      );
      snapshot.automaticReview = { ruleVersion: restriction.ruleVersion };
      const { hash: _old, ...value } = snapshot;
      snapshot.hash = await contentHash(value);
    }
    const attachments = [...data.attachments];
    if (data.context.resource && !attachments.some((a) => a.id === data.context.resource!.id))
      attachments.push(data.context.resource);
    if (attachments.length > 10) throw new ControlError(422, 'Attach at most ten saved resources.');
    if (snapshot) {
      if (data.context.workflowId)
        throw new ControlError(422, 'Named agent workflow context is not supported in this profile.');
      if (data.outputSchema) throw new ControlError(422, 'Named agents use their published output contract.');
      if (
        snapshot.definition.context.scope === 'selected' &&
        attachments.some(
          (a) =>
            !(snapshot.contextResources ?? snapshot.definition.context.resources).some(
              (r) => r.id === a.id && r.revisionId === a.revisionId,
            ),
        )
      )
        throw new ControlError(403, 'Attachment is outside the published agent context.');
    }
    for (const ref of attachments) {
      const item = await service.knowledge.get(ctx, ref.id, ref.revisionId);
      if (item.artifact.kind !== ref.kind)
        throw new ControlError(422, 'The request resource kind does not match its artifact.');
    }
    let workflow: { id: string; editVersion: number | undefined } | undefined;
    if (data.context.workflowId) {
      const flow = await service.studio.getFlow(data.context.workflowId, ctx.workspace.id);
      if (!flow) throw new ControlError(404, 'Workflow context was not found in this workspace.');
      workflow = { id: flow.id, editVersion: flow.editVersion };
    }
    if (data.sessionId) {
      const session = (
        await c.query(
          'SELECT deleted_at,archived_at,agent_id FROM wa_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [ctx.workspace.id, data.sessionId],
        )
      ).rows[0];
      if (!session || session.deleted_at) throw new ControlError(404, 'Agent session not found.');
      if (session.archived_at && data.kind === 'goal')
        throw new ControlError(409, 'Restore this conversation before sending a new instruction.');
      if (data.kind === 'goal' && (session.agent_id ?? null) !== (snapshot?.ref.agentId ?? null))
        throw new ControlError(409, 'The session belongs to another agent.');
    }
    if (data.kind === 'answer') {
      const item = await service.work(ctx, data.workItemId!);
      if (data.sessionId && data.sessionId !== item.sessionId)
        throw new ControlError(409, 'The question belongs to another conversation.');
      if (item.state !== 'waiting_for_user' || item.editVersion !== data.expectedVersion)
        throw new ControlError(409, 'The question changed or was already answered.');
      if (item.interaction) {
        if (!data.response) throw new ControlError(400, 'Complete the requested fields before continuing.');
        const errors = interactionErrors(item.interaction, data.response);
        if (Object.keys(errors).length) throw new ControlError(400, Object.values(errors).join(' '));
        if (!interactionAnswerMatches(data.text, data.response))
          throw new ControlError(400, 'Answer does not match the submitted fields.');
      } else if (data.response) throw new ControlError(409, 'There is no structured question to answer.');
    }
    const requestId = crypto.randomUUID();
    const payload = { ...data, attachments, context: { ...data.context, ...(workflow ? { workflow } : {}) } };
    const result = (
      await c.query(
        `INSERT INTO wa_requests(workspace_id,id,actor_id,client_key,request_hash,origin,kind,payload,config_revision,source_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          ctx.workspace.id,
          requestId,
          ctx.user.id,
          data.clientRequestId,
          hash,
          origin,
          data.kind,
          payload,
          configuration.editVersion,
          sourceEventId ?? null,
        ],
      )
    ).rows[0];
    if (snapshot)
      await c.query('UPDATE wa_requests SET execution_snapshot=$3 WHERE workspace_id=$1 AND id=$2', [
        ctx.workspace.id,
        requestId,
        snapshot,
      ]);
    if (data.kind === 'goal' && data.sessionId && attachments.length) {
      for (const ref of attachments)
        await c.query(
          'UPDATE wa_context_uploads SET request_id=$4 WHERE workspace_id=$1 AND session_id=$2 AND artifact_id=$3 AND revision_id=$5 AND request_id IS NULL AND detached_at IS NULL',
          [ctx.workspace.id, data.sessionId, ref.id, requestId, ref.revisionId],
        );
      await service.control.audit(
        ctx,
        'agent.context_attached',
        'agent_session',
        data.sessionId,
        { requestId, references: attachments.map((ref) => `${ref.kind}:${ref.id}:${ref.revisionId}`).join(', ') },
        c,
      );
    }
    await service.control.audit(ctx, 'agent.request_queued', 'agent_request', requestId, {}, c);
    return receipt(result);
  };
  return transaction ? submit(transaction) : service.control.transaction(submit);
}
function receipt(row: any) {
  return {
    requestId: row.id,
    state: row.state,
    sessionId: row.session_id,
    workItemId: row.work_item_id,
    error: row.error,
  };
}
export async function drainWorkspaceRequests(service: AgentService) {
  const workspaces = (
    await service.pool.query(
      "SELECT workspace_id,min(created_at) AS first FROM wa_requests WHERE state='queued' GROUP BY workspace_id ORDER BY first LIMIT 25",
    )
  ).rows;
  for (const { workspace_id: workspace } of workspaces) {
    const lock = await service.pool.connect();
    try {
      if (
        !(
          await lock.query("SELECT pg_try_advisory_lock(hashtextextended('wa-intake-drain:'||$1,0)) AS acquired", [
            workspace,
          ])
        ).rows[0].acquired
      )
        continue;
      const row = (
        await lock.query(
          `SELECT r.* FROM wa_requests r WHERE r.workspace_id=$1 AND r.state='queued' AND (r.kind='answer' OR NOT EXISTS(
            SELECT 1 FROM wa_work_items w WHERE w.workspace_id=r.workspace_id AND w.state=ANY($2::text[]) AND w.session_id=COALESCE(r.payload->>'sessionId',CASE WHEN r.execution_snapshot IS NOT NULL THEN (SELECT session_id FROM wa_agent_channels_v2 c WHERE c.workspace_id=r.workspace_id AND c.agent_id=r.execution_snapshot->'ref'->>'agentId' AND c.actor_id=r.actor_id) ELSE (SELECT session_id FROM wa_agent_channels c WHERE c.workspace_id=r.workspace_id) END)))
            ORDER BY CASE r.kind WHEN 'answer' THEN 0 ELSE 1 END,r.created_at,r.id LIMIT 1`,
          [workspace, blocked],
        )
      ).rows[0];
      if (!row) continue;
      let ctx: Context | undefined;
      try {
        ctx = await service.control.authorizePrincipal(row.actor_id, workspace, 'execute');
        const configuration = await service.configuration(ctx);
        if (!configuration?.enabled || (!row.execution_snapshot && configuration.editVersion !== row.config_revision))
          throw new ControlError(
            403,
            'Agent policy changed before dispatch. Submit this request again under the current settings.',
          );
        const data = row.payload;
        if (row.execution_snapshot) await service.definitions.access(workspace, row.execution_snapshot);
        let sessionId: string, workId: string;
        if (row.kind === 'answer') {
          const result = await service.answer(ctx, data.workItemId, {
            clientKey: row.id,
            expectedVersion: data.expectedVersion,
            answer: data.text,
            remember: data.remember,
            ...(data.response ? { response: data.response } : {}),
          });
          sessionId = result.sessionId;
          workId = result.id;
        } else {
          // One durable workspace channel; new requests wait while its current work needs a decision/review.
          let channel = data.sessionId
            ? { session_id: data.sessionId }
            : (await lock.query('SELECT session_id FROM wa_agent_channels WHERE workspace_id=$1', [workspace])).rows[0];
          if (row.execution_snapshot && !data.sessionId) {
            const snapshot = row.execution_snapshot;
            channel = (
              await lock.query(
                'SELECT session_id FROM wa_agent_channels_v2 WHERE workspace_id=$1 AND agent_id=$2 AND actor_id=$3',
                [workspace, snapshot.ref.agentId, row.actor_id],
              )
            ).rows[0];
            if (!channel) {
              const created = await service.createSession(
                ctx,
                {
                  clientKey: `agent:${snapshot.ref.agentId}:${row.actor_id}:${row.id}`,
                  title: snapshot.definition.name,
                },
                snapshot.ref.agentId,
              );
              await lock.query('UPDATE wa_sessions SET agent_id=$3 WHERE workspace_id=$1 AND id=$2', [
                workspace,
                created.id,
                snapshot.ref.agentId,
              ]);
              await lock.query(
                'INSERT INTO wa_agent_channels_v2(workspace_id,agent_id,actor_id,session_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
                [workspace, snapshot.ref.agentId, row.actor_id, created.id],
              );
              channel = { session_id: created.id };
            }
          }
          if (!channel) {
            const created = await service.createSession(
              ctx,
              {
                clientKey: `workspace-agent:${workspace}`,
                title: 'Workspace agent',
              },
              null,
            );
            await lock.query(
              'INSERT INTO wa_agent_channels(workspace_id,session_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
              [workspace, created.id],
            );
            channel = { session_id: created.id };
          }
          sessionId = channel.session_id;
          // A crash after message persistence but before queue acknowledgement must reuse that message.
          const existing = (
            await lock.query(
              'SELECT w.id FROM wa_messages m JOIN wa_work_items w ON w.workspace_id=m.workspace_id AND w.id=m.id WHERE m.workspace_id=$1 AND m.session_id=$2 AND m.client_key=$3',
              [workspace, sessionId, row.id],
            )
          ).rows[0];
          if (existing) workId = existing.id;
          else {
            const busy = (
              await lock.query(
                'SELECT 1 FROM wa_work_items WHERE workspace_id=$1 AND session_id=$2 AND state=ANY($3::text[]) LIMIT 1',
                [workspace, sessionId, blocked],
              )
            ).rowCount;
            if (busy) continue;
            const session = await service.session(ctx, sessionId);
            const result = await service.message(
              ctx,
              sessionId,
              {
                clientMessageId: row.id,
                expectedSessionVersion: session.session.editVersion,
                text: data.text,
                ...(data.outputSchema ? { outputSchema: data.outputSchema } : {}),
                attachments: data.attachments,
              },
              data.context,
              row.execution_snapshot ?? undefined,
            );
            workId = result.workItemId;
          }
        }
        await service.control.transaction(async (c) => {
          await c.query(
            "UPDATE wa_requests SET state='dispatched',session_id=$3,work_item_id=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2",
            [workspace, row.id, sessionId, workId],
          );
          if (row.source_event_id)
            await c.query('UPDATE wa_inbox SET work_item_id=$3 WHERE workspace_id=$1 AND source_event_id=$2', [
              workspace,
              row.source_event_id,
              workId,
            ]);
          await c.query(
            `INSERT INTO wa_agent_tasks(workspace_id,id,parent_work_id,child_work_id,title,depth,request_hash,request_key)
            SELECT a.workspace_id,a.id,s.work_id,$3,s.proposal->>'goal',1,s.content_hash,a.id FROM wa_agent_assignments a JOIN wa_agent_suggestions s ON s.workspace_id=a.workspace_id AND s.id=a.suggestion_id WHERE a.workspace_id=$1 AND a.request_id=$2 ON CONFLICT DO NOTHING`,
            [workspace, row.id, workId],
          );
          await service.control.audit(ctx!, 'agent.request_dispatched', 'agent_request', row.id, {}, c);
        });
      } catch (error) {
        if (!(error instanceof ControlError)) throw error;
        // Concurrent draft/session changes can be re-read before a later dispatch; revoked/invalid requests stop.
        if (error.status === 409 && row.kind === 'goal') continue;
        await lock.query(
          "UPDATE wa_requests SET state='rejected',error=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [workspace, row.id, error.message],
        );
        if (ctx) await service.control.audit(ctx, 'agent.request_rejected', 'agent_request', row.id, {});
      }
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtextextended('wa-intake-drain:'||$1,0))", [workspace]);
      lock.release();
    }
  }
}
export async function ambientWorkspaceState(service: AgentService, ctx: Context, selectedSessionId?: string) {
  const channel = (
    await service.pool.query('SELECT session_id FROM wa_agent_channels WHERE workspace_id=$1', [ctx.workspace.id])
  ).rows[0];
  const detail = selectedSessionId
    ? await service.session(ctx, selectedSessionId)
    : channel
      ? await service.session(ctx, channel.session_id)
      : null;
  const latest = detail?.workItems[0];
  const work = latest ? await service.work(ctx, latest.id) : null;
  const requests = (
    await service.pool.query(
      'SELECT id,origin,kind,state,error,session_id AS "sessionId",COALESCE(work_item_id,payload->>\'workItemId\') AS "workItemId",payload->>\'text\' AS text,created_at AS "createdAt" FROM wa_requests WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT 20',
      [ctx.workspace.id],
    )
  ).rows;
  const count = (
    await service.pool.query("SELECT count(*) AS n FROM wa_requests WHERE workspace_id=$1 AND state='queued'", [
      ctx.workspace.id,
    ])
  ).rows[0].n;
  return {
    configuration: await service.configuration(ctx),
    session: detail?.session ?? null,
    messages: detail?.messages.slice(-20) ?? [],
    work,
    requests,
    queuedCount: Number(count),
    modelQueue: 'stackproc.agent.harness.v1',
  };
}

export async function workspaceRequestReceipt(service: AgentService, ctx: Context, requestId: string) {
  const row = (
    await service.pool.query('SELECT * FROM wa_requests WHERE workspace_id=$1 AND id=$2', [ctx.workspace.id, requestId])
  ).rows[0];
  if (!row) throw new ControlError(404, 'Workspace request not found.');
  return receipt(row);
}
