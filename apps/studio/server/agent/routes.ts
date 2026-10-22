import { listAgentSchedules, saveAgentSchedule } from './schedules';
import { discoverMcp } from './mcp';
import { enqueueWorkspaceRequest, ambientWorkspaceState, workspaceRequestReceipt } from './intake';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AgentService } from './service';
import { ControlError } from '../control/service';
export function agentRoutes(
  service: AgentService,
  body: (request: IncomingMessage) => Promise<unknown>,
  json: (response: ServerResponse, status: number, data: unknown) => void,
) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const path = url.pathname;
    if (!path.startsWith('/api/agent/')) return false;
    try {
      response.setHeader('Cache-Control', 'no-store');
      const method = request.method ?? 'GET';
      const ctx = await service.control.context(
        request,
        method === 'GET' || path === '/api/agent/context-uploads'
          ? 'read'
          : path.endsWith('/configuration')
            ? 'manage'
            : 'execute',
      );
      const send = (data: unknown, status = 200) => {
        json(response, status, data);
        return true;
      };
      if (path === '/api/agent/memory/graph' && method === 'GET') return send(await service.memoryGraph.inspect(ctx));
      if (path === '/api/agent/memory/graph/status' && method === 'GET')
        return send(await service.memoryGraph.status(ctx));
      if (path === '/api/agent/memory/status' && method === 'GET') return send(await service.memory.status(ctx));
      if (path === '/api/agent/memory' && method === 'GET')
        return send(await service.memory.list(ctx, url.searchParams.get('cursor') ?? undefined));
      const memoryReview = path.match(/^\/api\/agent\/memory\/([^/]+)\/review$/);
      if (memoryReview && method === 'POST')
        return send(await service.memory.review(ctx, decodeURIComponent(memoryReview[1]), await body(request)));
      const memoryProposal = path.match(/^\/api\/agent\/work-items\/([^/]+)\/memory$/);
      if (memoryProposal && method === 'POST') {
        const value = z
          .object({ clientKey: z.string().uuid(), proposal: z.unknown() })
          .strict()
          .parse(await body(request));
        return send(
          await service.memory.propose(ctx, decodeURIComponent(memoryProposal[1]), value.proposal, value.clientKey),
          201,
        );
      }
      const context = path.match(/^\/api\/agent\/work-items\/([^/]+)\/context$/);
      if (context && method === 'GET') return send(await service.memory.inspect(ctx, decodeURIComponent(context[1])));
      const memoryResume = path.match(/^\/api\/agent\/work-items\/([^/]+)\/resume$/);
      if (memoryResume && method === 'POST')
        return send(await service.budgets.resume(ctx, decodeURIComponent(memoryResume[1]), await body(request)), 202);
      if (path === '/api/agent/coordinator-review') {
        if (method === 'GET') return send(await service.automaticReview.get(ctx));
        if (method === 'PUT') return send(await service.automaticReview.save(ctx, await body(request)));
      }
      const summary = path.match(/^\/api\/agent\/definitions\/([^/]+)\/summary$/);
      if (summary && method === 'GET')
        return send(await service.definitions.summary(ctx, decodeURIComponent(summary[1])));
      if (path === '/api/agent/definition-drafts/generate' && method === 'POST')
        return send(await service.setup.start(ctx, await body(request), 'specialist'), 202);
      if (path === '/api/agent/suggestions' && method === 'GET') return send(await service.coordination.list(ctx));
      const suggestion = path.match(/^\/api\/agent\/suggestions\/([^/]+)\/(accept|dismiss)$/);
      if (suggestion && method === 'POST')
        return send(
          await service.coordination.decide(
            ctx,
            decodeURIComponent(suggestion[1]),
            suggestion[2] as 'accept' | 'dismiss',
            await body(request),
          ),
        );
      if (path === '/api/agent/setup-runs') {
        if (method === 'GET') return send(await service.setup.list(ctx));
        if (method === 'POST') return send(await service.setup.start(ctx, await body(request)), 202);
      }
      const setup = path.match(/^\/api\/agent\/setup-runs\/([^/]+)(?:\/(activate|revise))?$/);
      if (setup) {
        if (!setup[2] && method === 'GET') return send(await service.setup.get(ctx, decodeURIComponent(setup[1])));
        if (setup[2] === 'activate' && method === 'POST')
          return send(await service.setup.activate(ctx, decodeURIComponent(setup[1]), await body(request)));
        if (setup[2] === 'revise' && method === 'POST')
          return send(await service.setup.revise(ctx, decodeURIComponent(setup[1]), await body(request)));
      }
      if (path === '/api/agent/definitions') {
        if (method === 'GET') return send(await service.definitions.list(ctx));
        if (method === 'POST') return send(await service.definitions.save(ctx, undefined, await body(request)), 201);
      }
      const definition = path.match(
        /^\/api\/agent\/definitions\/([^/]+)(?:\/(publish|pause|resume|archive|duplicate))?$/,
      );
      if (definition) {
        const id = decodeURIComponent(definition[1]),
          action = definition[2];
        if (!action && method === 'GET') return send(await service.definitions.get(ctx, id));
        if (!action && method === 'PATCH') return send(await service.definitions.save(ctx, id, await body(request)));
        if (action === 'duplicate' && method === 'POST')
          return send(await service.definitions.duplicate(ctx, id, await body(request)), 201);
        if (action === 'publish' && method === 'POST')
          return send(await service.definitions.publish(ctx, id, await body(request)));
        if (['pause', 'resume', 'archive'].includes(action) && method === 'POST')
          return send(
            await service.definitions.operate(ctx, id, action as 'pause' | 'resume' | 'archive', await body(request)),
          );
      }
      if (path === '/api/agent/context-permissions') {
        if (method === 'GET') return send(await service.contextUploads.permissions(ctx));
        if (method === 'PUT') return send(await service.contextUploads.configure(ctx, await body(request)));
      }
      if (path === '/api/agent/context-uploads' && method === 'POST')
        return send(await service.contextUploads.upload(ctx, await body(request)), 201);
      const detach = path.match(/^\/api\/agent\/sessions\/([^/]+)\/context\/([^/]+)\/detach$/);
      if (detach && method === 'POST')
        return send(
          await service.contextUploads.detach(ctx, decodeURIComponent(detach[1]), decodeURIComponent(detach[2])),
        );
      const skill = path.match(/^\/api\/agent\/skills\/([^/]+)$/);
      if (skill && method === 'GET') {
        const row = (
          await service.pool.query(
            'SELECT id,name,description,content,revision,enabled FROM wa_skills WHERE workspace_id=$1 AND id=$2',
            [ctx.workspace.id, decodeURIComponent(skill[1])],
          )
        ).rows[0];
        if (!row) throw new ControlError(404, 'Skill not found.');
        return send(row);
      }
      const schedule = path.match(/^\/api\/agent\/schedules\/([^/]+)$/);
      if (schedule && method === 'GET') {
        const row = (
          await service.pool.query(
            'SELECT id,name,cron,timezone,goal,revision,enabled FROM wa_agent_schedules WHERE workspace_id=$1 AND id=$2',
            [ctx.workspace.id, decodeURIComponent(schedule[1])],
          )
        ).rows[0];
        if (!row) throw new ControlError(404, 'Schedule not found.');
        return send(row);
      }
      if (path === '/api/agent/schedules') {
        if (method === 'GET') return send(await listAgentSchedules(service, ctx));
        if (method === 'POST') return send(await saveAgentSchedule(service, ctx, await body(request)), 202);
      }
      if (path === '/api/agent/mcp/discover' && method === 'POST') {
        const binding = z
          .object({ connectionId: z.string().uuid(), revision: z.number().int().positive() })
          .strict()
          .parse(await body(request));
        return send(await discoverMcp(service, ctx, binding.connectionId, binding.revision));
      }
      if (path === '/api/agent/skills') {
        if (method === 'GET') return send(await service.features.skills(ctx));
        if (method === 'POST') return send(await service.features.saveSkill(ctx, await body(request)), 201);
      }
      if (path === '/api/agent/extensions' && method === 'GET') return send({ items: service.extensions.list() });
      const fork = path.match(/^\/api\/agent\/sessions\/([^/]+)\/fork$/);
      if (fork && method === 'POST')
        return send(await service.features.fork(ctx, decodeURIComponent(fork[1]), await body(request)), 201);
      const guidance = path.match(/^\/api\/agent\/work-items\/([^/]+)\/steer$/);
      if (guidance && method === 'POST')
        return send(await service.features.steer(ctx, decodeURIComponent(guidance[1]), await body(request)), 202);
      const stream = path.match(/^\/api\/agent\/work-items\/([^/]+)\/events$/);
      if (stream && method === 'GET') {
        await service.features.stream(
          request,
          response,
          ctx,
          decodeURIComponent(stream[1]),
          String(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0'),
        );
        return true;
      }
      const queuedRequest = path.match(/^\/api\/agent\/requests\/([^/]+)$/);
      if (queuedRequest && method === 'GET')
        return send(await workspaceRequestReceipt(service, ctx, decodeURIComponent(queuedRequest[1])));
      if (path === '/api/agent/ambient' && method === 'GET')
        return send(await ambientWorkspaceState(service, ctx, url.searchParams.get('session') ?? undefined));
      if (path === '/api/agent/requests' && method === 'POST')
        return send(await enqueueWorkspaceRequest(service, ctx, await body(request)), 202);
      if (path === '/api/agent/state' && method === 'GET')
        return send({
          coordinator: await service.definitions.understanding(ctx),
          configuration: await service.configuration(ctx),
          capabilities: {
            persistentSessions: true,
            tools: true,
            model: 'minimax',
            ambient: true,
            workflowGeneration: false,
          },
        });
      if (path === '/api/agent/configuration' && method === 'PUT')
        return send(await service.configure(ctx, await body(request)));
      if (path === '/api/agent/understanding' && method === 'GET')
        return send(await service.definitions.understanding(ctx));
      if (path === '/api/agent/activities' && method === 'GET') return send(await service.activities(ctx));
      if (path === '/api/agent/sessions') {
        if (method === 'GET') return send(await service.sessions(ctx, url.searchParams.get('archived') === 'true'));
        if (method === 'POST') return send(await service.createSession(ctx, await body(request)), 201);
      }
      const lifecycle = path.match(/^\/api\/agent\/sessions\/([^/]+)\/(archive|restore|delete)$/);
      if (lifecycle && method === 'POST')
        return send(
          await service.lifecycle.change(
            ctx,
            decodeURIComponent(lifecycle[1]),
            lifecycle[2] as 'archive' | 'restore' | 'delete',
            await body(request),
          ),
        );
      const session = path.match(/^\/api\/agent\/sessions\/([^/]+)(?:\/(messages))?$/);
      if (session) {
        if (method === 'GET' && !session[2])
          return send(
            await service.session(ctx, decodeURIComponent(session[1]), url.searchParams.get('before') ?? undefined),
          );
        if (method === 'POST' && session[2])
          return send(await service.message(ctx, decodeURIComponent(session[1]), await body(request)), 202);
      }
      const work = path.match(/^\/api\/agent\/work-items\/([^/]+)(?:\/(cancel|decisions))?$/);
      if (work) {
        const workId = decodeURIComponent(work[1]);
        if (method === 'GET' && !work[2]) return send(await service.work(ctx, workId));
        if (method === 'POST' && work[2] === 'cancel')
          return send(await service.cancel(ctx, workId, await body(request)));
        if (method === 'POST' && work[2] === 'decisions')
          return send(await service.answer(ctx, workId, await body(request)), 202);
      }
      const proposal = path.match(/^\/api\/agent\/change-sets\/([^/]+)\/apply$/);
      if (proposal && method === 'POST')
        return send(await service.applyProposal(ctx, decodeURIComponent(proposal[1]), await body(request)));
      return send({ error: { code: 'not_found', message: 'Agent endpoint not found.' } }, 404);
    } catch (error) {
      const status = error instanceof ControlError ? error.status : error instanceof z.ZodError ? 400 : 500;
      json(response, status, {
        error: {
          code:
            status === 409
              ? 'stale_revision'
              : status === 403
                ? 'denied'
                : status === 400
                  ? 'invalid_input'
                  : 'agent_error',
          message:
            error instanceof z.ZodError
              ? 'Agent request does not match its schema.'
              : error instanceof Error
                ? error.message
                : 'Agent request failed.',
          ...(error instanceof z.ZodError
            ? { fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }
            : {}),
        },
      });
      return true;
    }
  };
}
