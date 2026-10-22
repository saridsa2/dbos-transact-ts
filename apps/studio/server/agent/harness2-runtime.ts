import { DBOS } from '@dbos-inc/dbos-sdk';
import { resolve } from 'node:path';
import { contentHash } from '../../lib/knowledge/contracts';
import type { AgentService } from './service';
import type { NodeRegistry } from '../registry';
import type { AgentModel } from './model';
import { ControlError } from '../control/service';
import { drainWorkspaceRequests } from './intake';
import { createHarness2Bridge } from './harness2-bridge';
import { runHarness2Process } from './harness2-process';
import { runAgentTool } from './tools';

/** DBOS lifecycle adapter. The model/tool loop lives entirely in the upstream executor. */
export function createHarness2AgentRuntime(service: AgentService, registry: NodeRegistry, fixture?: AgentModel) {
  if (fixture) {
    if (process.env.STUDIO_INTEGRATION !== '1')
      throw new Error('Legacy agent models are test fixtures only; production requires Harness2.');
    // Explicit old-contract tests are not evidence of Harness2 production integration.
    return import('./legacy-runtime').then(({ createLegacyAgentRuntime }) =>
      createLegacyAgentRuntime(service, registry, fixture),
    );
  }
  return Promise.resolve(createHarness2Runtime(service, registry));
}
function createHarness2Runtime(service: AgentService, registry: NodeRegistry) {
  const owner = crypto.randomUUID();
  async function gate(workspace: string, workId: string, fence: string, startTurn: number) {
    const authorized = await service.authorize(workspace, workId);
    const row = (
      await service.pool.query(
        `UPDATE wa_workspace_leases SET expires_at=now()+interval '180 seconds' WHERE workspace_id=$1 AND work_item_id=$2 AND owner=$3 AND fence=$4 AND expires_at>now()
      AND NOT EXISTS(SELECT 1 FROM wa_command_outbox WHERE workspace_id=$1 AND work_item_id=$2 AND start_turn>$5) RETURNING fence`,
        [workspace, workId, owner, fence, startTurn],
      )
    ).rows[0];
    if (!row) throw new ControlError(409, 'Executor activation lost its workspace lease.');
    return authorized;
  }
  async function execute(workspace: string, workId: string, startTurn: number) {
    const initial = await service.authorize(workspace, workId).catch(() => null);
    if (!initial || !['queued', 'preparing', 'reasoning', 'executing_tool'].includes(initial.work.state)) return;
    const acquired = (
      await service.pool.query(
        `INSERT INTO wa_workspace_leases(workspace_id,work_item_id,owner,expires_at) VALUES($1,$2,$3,now()+interval '180 seconds')
      ON CONFLICT(workspace_id) DO UPDATE SET work_item_id=$2,owner=$3,fence=wa_workspace_leases.fence+1,expires_at=now()+interval '180 seconds'
      WHERE wa_workspace_leases.expires_at<now() OR wa_workspace_leases.work_item_id=$2 RETURNING fence::text`,
        [workspace, workId, owner],
      )
    ).rows[0];
    if (!acquired) return;
    const fence = acquired.fence as string;
    const abort = new AbortController();
    let bridge: Awaited<ReturnType<typeof createHarness2Bridge>> | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    let serial = Promise.resolve();
    let requestIssued = false;
    try {
      const auth = await gate(workspace, workId, fence, startTurn);
      if (!auth.config.allowModel || auth.config.mode === 'observe') {
        const context = await runAgentTool(service, registry, auth.ctx, workId, 'workspace_describe_v1', {});
        await service.activity(
          workspace,
          workId,
          'context',
          'Workspace indexed in Observe mode; no executor or model was called.',
          context,
        );
        await service.settle(
          workspace,
          workId,
          'completed',
          'Workspace context is available. Enable MiniMax assistance in Agent settings to work on this request. No model request was made.',
        );
        return;
      }
      const credentialConnection = (await service.control.connections(auth.ctx)).find(
        (c) =>
          c.id === auth.config.connectionId &&
          c.provider === 'minimax' &&
          c.revision === auth.config.connectionRevision &&
          c.status === 'configured',
      );
      if (!credentialConnection)
        throw new ControlError(403, 'The selected MiniMax connection changed or is unavailable.');
      const credential = await service.control.resolveCredential(
        workspace,
        credentialConnection.id,
        credentialConnection.revision,
      );
      if (!('secret' in credential) || !credential.secret)
        throw new ControlError(422, 'MiniMax credential is unavailable.');
      const existing = (
        await service.pool.query(
          'SELECT * FROM wa_executor_runs WHERE workspace_id=$1 AND work_item_id=$2 AND start_turn=$3',
          [workspace, workId, startTurn],
        )
      ).rows[0];
      if (existing) {
        if (existing.state === 'completed' && existing.summary) {
          await service.settle(workspace, workId, 'completed', existing.summary);
          return;
        }
        throw new Error('An earlier executor activation has no completion receipt. It was not repeated.');
      }
      const previous = (
        await service.pool.query(
          "SELECT session_id FROM wa_executor_runs WHERE workspace_id=$1 AND work_item_id=$2 AND state='completed' ORDER BY start_turn DESC LIMIT 1",
          [workspace, workId],
        )
      ).rows[0];
      const pinned = auth.work.engine_provenance;
      const harness = (
        await service.pool.query(
          pinned?.harnessVersionId
            ? 'SELECT * FROM wa_harness_versions WHERE workspace_id=$1 AND id=$2'
            : "SELECT * FROM wa_harness_versions WHERE workspace_id=$1 AND state='adopted'",
          pinned?.harnessVersionId ? [workspace, pinned.harnessVersionId] : [workspace],
        )
      ).rows[0];
      const session = await service.session(auth.ctx, auth.work.session_id);
      const answers = (
        await service.pool.query(
          'SELECT content FROM wa_decisions WHERE workspace_id=$1 AND work_item_id=$2 ORDER BY created_at,id',
          [workspace, workId],
        )
      ).rows.map((r) => r.content);
      const prompt = JSON.stringify({
        currentRequest: auth.work.goal,
        workspaceContext: auth.work.request_context,
        conversation: session.messages.slice(-20).map((m: any) => ({ role: m.role, content: m.content })),
        acceptedAnswers: answers,
        instructions:
          'Use authorized stackproc tools. Answer only the current request. Previously answered questions must not be repeated. Stop immediately after asking a question or staging a proposal.',
      });
      await service.pool.query(
        "INSERT INTO wa_executor_runs(workspace_id,work_item_id,start_turn,state,request_hash) VALUES($1,$2,$3,'issued',$4)",
        [workspace, workId, startTurn, await contentHash({ prompt, harness: harness?.content_hash ?? 'baseline' })],
      );
      requestIssued = true;
      let finalText = '',
        executorError = '';
      let steps = 0;
      bridge = await createHarness2Bridge(async (name, args, requestId) => {
        let result: unknown;
        const run = serial.then(async () => {
          const current = await gate(workspace, workId, fence, startTurn);
          if (!['queued', 'preparing', 'reasoning', 'executing_tool'].includes(current.work.state))
            throw new Error('This activation is paused or finished; no further tools are allowed.');
          const key = `oc:${startTurn}:${requestId}`;
          const hash = await contentHash({ name, args });
          const prior = (
            await service.pool.query(
              "SELECT * FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND kind='tool' AND call_key=$3",
              [workspace, workId, key],
            )
          ).rows[0];
          if (prior) {
            if (prior.request_hash !== hash || prior.state !== 'completed')
              throw new Error('Tool receipt is uncertain or the request ID was reused.');
            result = prior.result;
            return;
          }
          if (current.work.tool_count >= current.config.limits.tools) {
            await service.settle(workspace, workId, 'budget_exhausted', 'Workspace tool budget reached.');
            abort.abort();
            throw new Error('Tool budget reached.');
          }
          const id = crypto.randomUUID();
          await service.pool.query(
            "INSERT INTO wa_calls(workspace_id,id,work_item_id,turn_no,kind,call_key,state,request_hash,request) VALUES($1,$2,$3,$4,'tool',$5,'issued',$6,$7)",
            [workspace, id, workId, startTurn, key, hash, { name, arguments: args, providerId: requestId }],
          );
          await service.pool.query("UPDATE wa_work_items SET state='executing_tool' WHERE workspace_id=$1 AND id=$2", [
            workspace,
            workId,
          ]);
          try {
            result = await runAgentTool(service, registry, current.ctx, workId, name, args);
          } catch (error) {
            result = { error: error instanceof Error ? error.message : 'Workspace operation failed.' };
          }
          await service.control.transaction(async (c) => {
            await c.query(
              "UPDATE wa_calls SET state='completed',result=$3,completed_at=now() WHERE workspace_id=$1 AND id=$2",
              [workspace, id, result],
            );
            await c.query('UPDATE wa_work_items SET tool_count=tool_count+1 WHERE workspace_id=$1 AND id=$2', [
              workspace,
              workId,
            ]);
            await service.activity(workspace, workId, 'tool', name, { turn: startTurn, callId: requestId, result }, c);
          });
          const value = result as any;
          if (value?.question || value?.proposalId) {
            await service.settle(
              workspace,
              workId,
              value.question ? 'waiting_for_user' : 'ready_for_review',
              value.question ?? value.summary,
              startTurn + Math.max(1, steps),
            );
            pauseTimer = setTimeout(() => abort.abort(), 250);
          } else
            await service.pool.query(
              "UPDATE wa_work_items SET state='reasoning' WHERE workspace_id=$1 AND id=$2 AND state='executing_tool'",
              [workspace, workId],
            );
        });
        serial = run.catch(() => {});
        await run;
        return result;
      });
      timer = setInterval(() => void gate(workspace, workId, fence, startTurn).catch(() => abort.abort()), 1000);
      await DBOS.runStep(
        async () => {
          await runHarness2Process(
            {
              command: 'execute',
              root: resolve('.studio/harness2/workspaces', workspace, workId),
              model: String(credentialConnection.config.model ?? 'MiniMax-M2.7'),
              secret: credential.secret,
              prompt,
              steps: Math.max(1, auth.config.limits.turns - auth.work.turn_no),
              outputTokens: auth.config.limits.outputTokens,
              bridge: { url: bridge!.url, token: bridge!.token },
              sessionId: previous?.session_id,
              harnessTree: harness?.tree,
              timeout: 180,
            },
            async (event) => {
              if (event.type === 'provenance') {
                if (pinned?.harnessFingerprint && event.harnessFingerprint !== pinned.harnessFingerprint)
                  throw new Error('The pinned harness changed. Start a new work item.');
                const { type: _type, ...engine } = event;
                const provenance = { ...engine, harnessVersionId: harness?.id ?? null };
                await service.pool.query(
                  'UPDATE wa_executor_runs SET provenance=$4 WHERE workspace_id=$1 AND work_item_id=$2 AND start_turn=$3',
                  [workspace, workId, startTurn, provenance],
                );
                await service.pool.query(
                  'UPDATE wa_work_items SET engine_provenance=$3 WHERE workspace_id=$1 AND id=$2',
                  [workspace, workId, provenance],
                );
                await service.activity(
                  workspace,
                  workId,
                  'engine',
                  'Harness2 installed the execution harness; OpenCode is executing this request.',
                  provenance,
                );
              }
              if (event.type !== 'executor_event') return;
              const upstream = event.event;
              if (upstream.sessionID)
                await service.pool.query(
                  'UPDATE wa_executor_runs SET session_id=$4 WHERE workspace_id=$1 AND work_item_id=$2 AND start_turn=$3',
                  [workspace, workId, startTurn, upstream.sessionID],
                );
              if (upstream.type === 'step_start') {
                if (++steps > auth.config.limits.turns - auth.work.turn_no) {
                  abort.abort();
                  throw new Error('Executor turn budget reached.');
                }
                await service.pool.query(
                  "UPDATE wa_work_items SET state='reasoning' WHERE workspace_id=$1 AND id=$2 AND state IN ('queued','preparing','reasoning')",
                  [workspace, workId],
                );
                await service.activity(workspace, workId, 'model', 'OpenCode started a MiniMax reasoning step.', {
                  step: steps,
                  executor: 'opencode',
                });
              }
              if (
                upstream.type === 'step_finish' &&
                ['length', 'content-filter', 'error'].includes(upstream.part?.reason)
              )
                executorError = 'The upstream executor could not finish within the configured model response limit.';
              if (upstream.type === 'text' && typeof upstream.part?.text === 'string') finalText += upstream.part.text;
              if (upstream.type === 'error')
                executorError = 'MiniMax/OpenCode reported an execution error. No success was recorded.';
            },
            abort.signal,
          );
        },
        { name: `harness2:executor:${startTurn}`, retriesAllowed: false },
      );
      await serial;
      const current = await service.authorize(workspace, workId);
      if (['waiting_for_user', 'ready_for_review', 'cancelled', 'budget_exhausted'].includes(current.work.state)) {
        await service.pool.query(
          "UPDATE wa_executor_runs SET state='completed',completed_at=now() WHERE workspace_id=$1 AND work_item_id=$2 AND start_turn=$3",
          [workspace, workId, startTurn],
        );
        return;
      }
      if (executorError) throw new Error(executorError);
      if (!finalText.trim()) throw new Error('OpenCode completed without a final response.');
      await service.pool.query(
        "UPDATE wa_executor_runs SET state='completed',summary=$4,completed_at=now() WHERE workspace_id=$1 AND work_item_id=$2 AND start_turn=$3",
        [workspace, workId, startTurn, finalText],
      );
      await service.pool.query('UPDATE wa_work_items SET turn_no=turn_no+$3 WHERE workspace_id=$1 AND id=$2', [
        workspace,
        workId,
        steps,
      ]);
      await service.settle(workspace, workId, 'completed', finalText);
    } catch (error) {
      await serial;
      const current = (
        await service.pool.query('SELECT state FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [workspace, workId])
      ).rows[0];
      if (
        current &&
        ['waiting_for_user', 'ready_for_review', 'cancelled', 'budget_exhausted'].includes(current.state)
      ) {
        await service.pool.query(
          "UPDATE wa_executor_runs SET state='completed',completed_at=now() WHERE workspace_id=$1 AND work_item_id=$2 AND start_turn=$3",
          [workspace, workId, startTurn],
        );
        return;
      }
      const message = error instanceof Error ? error.message : 'Harness2 executor failed.';
      const state = requestIssued
        ? 'uncertain'
        : error instanceof ControlError && error.status === 403
          ? 'suspended'
          : 'failed';
      await service.pool.query(
        'UPDATE wa_executor_runs SET state=$4,error=$5,completed_at=now() WHERE workspace_id=$1 AND work_item_id=$2 AND start_turn=$3',
        [workspace, workId, startTurn, state === 'uncertain' ? 'uncertain' : 'failed', message],
      );
      await service.settle(workspace, workId, state, message);
    } finally {
      if (timer) clearInterval(timer);
      if (pauseTimer) clearTimeout(pauseTimer);
      abort.abort();
      await bridge?.close();
      await service.pool.query(
        'DELETE FROM wa_workspace_leases WHERE workspace_id=$1 AND work_item_id=$2 AND owner=$3 AND fence=$4',
        [workspace, workId, owner, fence],
      );
    }
  }
  const activation = DBOS.registerWorkflow(execute, { name: 'stackproc.agent.activate.v1' });
  let reconciling = false;
  return {
    async initialize() {
      await DBOS.registerQueue('stackproc.agent.harness.v1', {
        globalConcurrency: 4,
        workerConcurrency: 2,
        partitionConcurrency: 1,
      });
    },
    async reconcile() {
      if (reconciling) return;
      reconciling = true;
      try {
        await service.ingest();
        await drainWorkspaceRequests(service);
        const rows = (
          await service.pool.query(`SELECT o.* FROM wa_command_outbox o WHERE delivered_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM wa_command_outbox newer WHERE newer.workspace_id=o.workspace_id AND newer.work_item_id=o.work_item_id AND newer.start_turn>o.start_turn)
        AND NOT EXISTS(SELECT 1 FROM wa_workspace_leases l WHERE l.workspace_id=o.workspace_id AND l.expires_at>now()) ORDER BY created_at,id LIMIT 25`)
        ).rows;
        const seen = new Set<string>();
        for (const row of rows) {
          if (seen.has(row.workspace_id)) continue;
          seen.add(row.workspace_id);
          await DBOS.startWorkflow(activation, {
            workflowID: `wa:${row.workspace_id}:${row.id}`,
            queueName: 'stackproc.agent.harness.v1',
            enqueueOptions: { queuePartitionKey: row.workspace_id },
          })(row.workspace_id, row.work_item_id, row.start_turn);
          await service.pool.query('UPDATE wa_command_outbox SET delivered_at=now() WHERE workspace_id=$1 AND id=$2', [
            row.workspace_id,
            row.id,
          ]);
        }
      } finally {
        reconciling = false;
      }
    },
  };
}
