import { ToolStore } from './tools/store';
import { toolRoutes } from './tools/routes';
import { agentRoutes } from './agent/routes';
import type { AgentService } from './agent/service';
import { knowledgeRoutes } from './knowledge/routes';
import type { KnowledgeStore } from './knowledge/store';
import type { IntelligenceService } from './intelligence/service';
import { browserOrigins } from './browser-origins';
import { codeSchema } from '../lib/authoring/model';
import { isolatedCodeRunner } from './code/runner';
import { integrationCatalog } from '../lib/integrations/catalog';
import type { WorkspaceEvents } from './control/events';
import { ControlPlane, ControlError } from './control/service';
import { controlRoutes } from './control/routes';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { validateCrontab, validateTimezone } from '@dbos-inc/dbos-sdk/internal/scheduler/crontab';
import { nativeExamples } from '../lib/native/examples';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { parseFlow, validateFlow } from '../lib/flows/validation';
import type { AgentFlow } from '../lib/flows/types';
import { NodeRegistry } from './registry';
import { StudioStore } from './store';
import type { createRuntime } from './runtime';

const inputSchema = z.object({
  userInput: z.string().max(100000).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});
const decisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'done']),
  note: z.string().max(10000).optional(),
});

export function createStudioServer(
  store: StudioStore,
  runtime: ReturnType<typeof createRuntime>,
  registry: NodeRegistry,
  control: ControlPlane,
  workspaceEvents: WorkspaceEvents,
  intelligenceServices?: { knowledge: KnowledgeStore; intelligence: IntelligenceService; agent?: AgentService },
) {
  const handleAgent = intelligenceServices?.agent ? agentRoutes(intelligenceServices.agent, body, json) : undefined;
  const handleControl = controlRoutes(control, body, json);
  const handleKnowledge = intelligenceServices
    ? knowledgeRoutes(control, intelligenceServices.knowledge, intelligenceServices.intelligence, body, json)
    : undefined;
  const handleTools = toolRoutes(new ToolStore(control), body, json);
  const allowedOrigins = browserOrigins();
  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/auth/')) {
        if (control.adapter?.handle && (await control.adapter.handle(request, response))) return;
        return json(response, 404, { error: 'Authentication route not configured.' });
      }
      // Keep the API on loopback. Private preview proxies must use an explicitly
      // configured browser origin; application authentication still applies.
      if (
        !['GET', 'HEAD'].includes(request.method || '') &&
        request.headers.origin &&
        !allowedOrigins.has(request.headers.origin)
      ) {
        return json(response, 403, { error: 'Origin is not allowed.' });
      }
      if (url.pathname === '/api/health') return json(response, 200, { status: 'ok', engine: 'dbos' });
      if (url.pathname === '/api/control/events' && request.method === 'GET')
        return await workspaceEvents.stream(request, response, control, url);
      if (url.pathname === '/api/control/notifications' && request.method === 'GET') {
        const ctx = await control.context(request);
        const events = await workspaceEvents.list(ctx.workspace.id, undefined, 30, true, ctx.user.id);
        return json(response, 200, { events, cursor: events[0]?.id ?? '0' });
      }
      if (url.pathname === '/api/control/notifications/read' && request.method === 'POST') {
        const ctx = await control.context(request);
        return json(response, 200, await workspaceEvents.markRead(ctx.workspace.id, ctx.user.id, await body(request)));
      }
      if (await handleTools(request, response, url)) return;
      if (await handleControl(request, response, url)) return;
      if (handleAgent && (await handleAgent(request, response, url))) return;
      if (handleKnowledge && (await handleKnowledge(request, response, url))) return;
      const ctx = await control.context(
        request,
        ['GET', 'HEAD'].includes(request.method ?? 'GET') ? 'read' : 'execute',
      );
      if (url.pathname === '/api/integrations/catalog' && request.method === 'GET')
        return json(response, 200, integrationCatalog());
      if (url.pathname === '/api/authoring/test-code' && request.method === 'POST') {
        const payload = z
          .object({ definition: codeSchema, input: z.json(), variables: z.record(z.string(), z.json()).default({}) })
          .parse(await body(request));
        const abort = new AbortController();
        response.once('close', () => {
          if (!response.writableEnded) abort.abort();
        });
        try {
          const result = await isolatedCodeRunner.execute(
            payload.definition,
            payload.input,
            payload.variables,
            abort.signal,
          );
          await control.audit(ctx, 'code.tested', 'workflow', 'code-test', {
            revision: result.revision,
            success: true,
          });
          return json(response, 200, result);
        } catch (err) {
          await control.audit(ctx, 'code.tested', 'workflow', 'code-test', { success: false });
          return json(response, 422, { error: err instanceof Error ? err.message : 'Code test failed.' });
        }
      }
      if (url.pathname === '/api/native/catalog') {
        const catalog = registry.nativeCatalog();
        const offerings = await new ToolStore(control).offerings(ctx);
        return json(response, 200, {
          ...catalog,
          steps: [
            ...catalog.steps,
            ...offerings
              .filter((t) => t.build.manifest.exposure.includes('workflow'))
              .map((t) => ({
                id: `workspace_tool.${t.id}.r${t.revision}`,
                name: `${t.build.manifest.name} · r${t.revision}`,
              })),
          ],
        });
      }
      if (url.pathname === '/api/examples') return json(response, 200, nativeExamples());
      if (url.pathname === '/api/health') return json(response, 200, { status: 'ok', engine: 'dbos' });
      if (url.pathname === '/api/workspace/resources' && request.method === 'GET')
        return json(response, 200, registry.resources());
      if (url.pathname === '/api/workspace/prompts' || url.pathname === '/api/prompts') return json(response, 200, []);
      if (url.pathname === '/api/connectors/connections') return json(response, 200, []);
      if (url.pathname === '/api/flows' && request.method === 'GET')
        return json(response, 200, await store.listFlows(ctx.workspace.id));
      if (url.pathname === '/api/flows' && request.method === 'POST') {
        const flow = { ...parseFlow(await body(request)), workspaceId: ctx.workspace.id };
        if (flow.authoringVersion === 2) {
          flow.diagnostics = [];
          try {
            validateFlow(flow);
          } catch (err) {
            flow.diagnostics = [
              { path: 'workflow', message: err instanceof Error ? err.message : 'Incomplete configuration' },
            ];
          }
        }
        validateSchedule(flow);
        if (flow.schedule?.enabled) await runtime.native.validate(flow);
        const saved = await store.saveFlow(flow, true, ctx.workspace.id, ctx.user.id);
        await runtime.native.syncSchedule(saved);
        return json(response, 201, saved);
      }
      if (url.pathname === '/api/flows/run' && request.method === 'POST') {
        const payload = z.object({ flow: z.unknown(), input: inputSchema.optional() }).parse(await body(request));
        const flow = { ...parseFlow(payload.flow), workspaceId: ctx.workspace.id };
        validateFlow(flow);
        if (!(await store.getFlow(flow.id, ctx.workspace.id)))
          return json(response, 400, { error: 'Save the flow before running it.' });
        const id = await runtime.start(flow, payload.input, ctx.user.id);
        return streamRun(request, response, store, id, -1);
      }
      const debounceMatch = url.pathname.match(/^\/api\/flows\/([^/]+)\/debounce$/);
      if (debounceMatch && request.method === 'POST') {
        const flow = await store.getFlow(decodeURIComponent(debounceMatch[1]), ctx.workspace.id);
        if (!flow || flow.schemaVersion !== 2) return json(response, 404, { error: 'Native workflow not found.' });
        const payload = z
          .object({
            key: z.string().min(1).max(128),
            periodMS: z.number().int().positive().max(86400000),
            input: inputSchema.optional(),
          })
          .parse(await body(request));
        const receipt = await runtime.native.debounce(
          flow,
          payload.input ?? flow.defaultInput ?? {},
          payload.key,
          payload.periodMS,
          ctx.user.id,
        );
        await control.audit(ctx, 'run.debounced', 'run', receipt.runId, {
          flowId: flow.id,
          dispatchId: receipt.dispatchId,
        });
        return json(response, 202, receipt);
      }
      const flowMatch = url.pathname.match(/^\/api\/flows\/([^/]+)$/);
      if (flowMatch) {
        const id = decodeURIComponent(flowMatch[1]);
        if (request.method === 'GET') {
          const flow = await store.getFlow(id, ctx.workspace.id);
          return json(response, flow ? 200 : 404, flow || { error: 'Flow not found.' });
        }
        if (request.method === 'DELETE') {
          const flow = await store.getFlow(id, ctx.workspace.id);
          if (!flow) return json(response, 404, { error: 'Flow not found.' });
          await runtime.native.syncSchedule({ ...flow, schedule: undefined });
          const deleted = await store.deleteFlow(id, ctx.workspace.id, ctx.user.id);
          return json(response, deleted ? 200 : 404, deleted ? { deleted: true } : { error: 'Flow not found.' });
        }
        if (request.method === 'PUT') {
          if (!(await store.getFlow(id, ctx.workspace.id))) return json(response, 404, { error: 'Flow not found.' });
          const flow = { ...parseFlow(await body(request)), workspaceId: ctx.workspace.id };
          if (flow.authoringVersion === 2) {
            flow.diagnostics = [];
            try {
              validateFlow(flow);
            } catch (err) {
              flow.diagnostics = [
                { path: 'workflow', message: err instanceof Error ? err.message : 'Incomplete configuration' },
              ];
            }
          }
          validateSchedule(flow);
          if (flow.schedule?.enabled) await runtime.native.validate(flow);
          const saved = await store.saveFlow({ ...flow, id }, false, ctx.workspace.id, ctx.user.id);
          await runtime.native.syncSchedule(saved);
          return json(response, 200, saved);
        }
      }
      if (url.pathname === '/api/runs' && request.method === 'GET')
        return json(response, 200, await store.listRuns(ctx.workspace.id));
      const messageMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/messages$/);
      if (messageMatch && request.method === 'POST') {
        const id = decodeURIComponent(messageMatch[1]);
        const run = await store.run(id);
        if (!run || run.workspace_id !== ctx.workspace.id || run.graph.schemaVersion !== 2)
          return json(response, 404, { error: 'Native run not found.' });
        if (!['queued', 'running', 'waiting'].includes(run.status))
          return json(response, 409, { error: 'This run is already finished.' });
        const payload = z
          .object({ topic: z.string().min(1).max(128), value: z.json(), idempotencyKey: z.string().min(1).max(128) })
          .parse(await body(request));
        await DBOS.send(id, payload.value, payload.topic, `studio-message:${payload.idempotencyKey}`);
        return json(response, 202, { sent: true });
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)(\/events)?$/);
      if (runMatch && request.method === 'GET') {
        const id = decodeURIComponent(runMatch[1]);
        const run = await store.run(id);
        if (!run || run.workspace_id !== ctx.workspace.id) return json(response, 404, { error: 'Run not found.' });
        if (runMatch[2]) {
          const after = z.coerce
            .number()
            .int()
            .min(-1)
            .parse(url.searchParams.get('after') ?? -1);
          return streamRun(request, response, store, id, after);
        }
        return json(response, 200, { ...run, events: await store.events(id), children: await store.children(id) });
      }
      if (url.pathname === '/api/escalations' && request.method === 'GET')
        return json(response, 200, await store.approvals(ctx.workspace.id));
      const approvalMatch = url.pathname.match(/^\/api\/escalations\/([^/]+)$/);
      if (approvalMatch && request.method === 'POST') {
        const { action, note } = decisionSchema.parse(await body(request));
        const approval = await store.resolve(
          decodeURIComponent(approvalMatch[1]),
          action,
          note ?? '',
          ctx.workspace.id,
          ctx.user.id,
        );
        if (!approval) return json(response, 409, { error: 'Approval is already resolved or does not exist.' });
        await control.audit(ctx, 'review.decided', 'run', approval.run_id, { action, nodeId: approval.node_id });
        await runtime.reconcile();
        return json(response, 200, {
          escalation: store.approvalSummary(approval),
          run: { id: approval.run_id, status: 'running' },
        });
      }
      return json(response, 404, { error: 'Route not found.' });
    } catch (error) {
      if (error instanceof ControlError) return json(response, error.status, { error: error.message });
      if (response.headersSent) {
        response.end();
        return;
      }
      const message = error instanceof Error ? error.message : 'Request failed.';
      const badInput =
        error instanceof z.ZodError ||
        /Cycles|[Nn]ode|Edge|Triggers|before running|Flow|[Nn]ative|[Bb]inding|[Qq]ueue|[Ww]orkflow reference|cron|timezone/.test(
          message,
        );
      json(response, badInput ? 400 : 500, {
        error: badInput ? message : 'Service request failed. Check the service log.',
      });
      if (!badInput) console.error(error);
    }
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<unknown> {
  let raw = '';
  let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk);
    if (length > (request.url?.startsWith('/api/tools/') ? 2 * 1024 * 1024 : 1024 * 1024))
      throw new z.ZodError([{ code: 'custom', path: [], message: 'Request body is too large.' }]);
    raw += chunk;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Request body must be JSON.' }]);
  }
}
async function streamRun(
  request: IncomingMessage,
  response: ServerResponse,
  store: StudioStore,
  id: string,
  after: number,
) {
  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  let closed = false;
  response.on('close', () => {
    closed = true;
  });
  while (!closed) {
    // Read status before events, so observing terminal status guarantees the
    // corresponding terminal event's transaction is visible in the next read.
    const run = await store.run(id);
    for (const row of await store.events(id, after)) {
      if (closed) return;
      response.write(`${JSON.stringify({ ...row.event, sequence: row.sequence })}\n`);
      after = row.sequence;
    }
    if (!run || ['succeeded', 'failed', 'waiting', 'cancelled'].includes(run.status)) {
      response.end();
      return;
    }
    await delay(100);
  }
}

function validateSchedule(flow: AgentFlow) {
  if (flow.schedule?.enabled)
    try {
      validateCrontab(flow.schedule.cron);
      if (flow.schedule.timezone) validateTimezone(flow.schedule.timezone);
    } catch (error) {
      throw new z.ZodError([
        { code: 'custom', path: ['schedule'], message: error instanceof Error ? error.message : 'Invalid schedule.' },
      ]);
    }
}
