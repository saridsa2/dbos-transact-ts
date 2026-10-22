import { importBpmn, BPMN_IMPORT_LIMIT } from '../../lib/processes/bpmn-import';
import { JSDOM } from 'jsdom';
import { importRdf, RDF_IMPORT_LIMIT } from '../../lib/knowledge/rdf-import';
import { ontologySchema } from '../../lib/knowledge/ontology';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { ControlPlane } from '../control/service';
import type { KnowledgeStore } from './store';
import type { IntelligenceService } from '../intelligence/service';
import { validateOntology } from '../../lib/knowledge/ontology';
import { validateProcess } from '../../lib/knowledge/process';
export function knowledgeRoutes(
  control: ControlPlane,
  k: KnowledgeStore,
  intelligence: IntelligenceService,
  body: (r: IncomingMessage) => Promise<unknown>,
  json: (r: ServerResponse, status: number, data: unknown) => void,
) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;
    if (!path.startsWith('/api/knowledge/') && !path.startsWith('/api/intelligence/')) return false;
    const method = request.method ?? 'GET',
      permission = method === 'GET' ? 'read' : path.endsWith('/publish') ? 'manage' : 'execute';
    const ctx = await control.context(request, permission);
    const send = (status: number, data: unknown) => {
      json(response, status, data);
      return true;
    };
    if (path === '/api/knowledge/bpmn/preview' && method === 'POST') {
      const data = z
        .object({ source: z.string().min(1).max(BPMN_IMPORT_LIMIT), processId: z.string().max(2000).optional() })
        .strict()
        .parse(await body(request));
      if (Buffer.byteLength(data.source) > BPMN_IMPORT_LIMIT || /<!\s*(DOCTYPE|ENTITY)\b/i.test(data.source))
        return send(400, {
          error: 'Use self-contained BPMN XML no larger than 1 MiB, without DTD or entity declarations.',
        });
      let dom: JSDOM | undefined;
      try {
        dom = new JSDOM(data.source, { contentType: 'application/xml' });
        return send(200, importBpmn(data.source, dom.window.document as unknown as Document, data.processId));
      } catch (error) {
        return send(422, { error: error instanceof Error ? error.message : 'Could not parse BPMN XML.' });
      } finally {
        dom?.window.close();
      }
    }
    if (path === '/api/knowledge/rdf/preview' && method === 'POST') {
      const data = z
        .object({ source: z.string().min(1).max(RDF_IMPORT_LIMIT), previous: ontologySchema })
        .strict()
        .parse(await body(request));
      if (Buffer.byteLength(data.source) > RDF_IMPORT_LIMIT || /<!\s*(DOCTYPE|ENTITY)\b/i.test(data.source))
        return send(400, {
          error: 'Use self-contained RDF/XML no larger than 1 MiB, without DTD or entity declarations.',
        });
      // No scripts, resource loader, or external entity resolver is enabled.
      let dom: JSDOM | undefined;
      try {
        dom = new JSDOM(data.source, { contentType: 'application/xml' });
        return send(200, importRdf(data.source, data.previous, dom.window.document as unknown as Document));
      } catch (error) {
        return send(422, { error: error instanceof Error ? error.message : 'Could not parse RDF/XML.' });
      } finally {
        dom?.window.close();
      }
    }
    const revision = path.match(/^\/api\/knowledge\/revisions\/([^/]+)$/);
    if (revision && method === 'GET') {
      const found = (
        await k.pool.query('SELECT artifact_id FROM wi_revisions WHERE workspace_id=$1 AND id=$2', [
          ctx.workspace.id,
          decodeURIComponent(revision[1]),
        ])
      ).rows[0];
      return found
        ? send(200, await k.get(ctx, found.artifact_id, decodeURIComponent(revision[1])))
        : send(404, { error: 'Revision not found.' });
    }
    if (path === '/api/knowledge/artifacts') {
      if (method === 'GET')
        return send(
          200,
          await k.list(ctx, url.searchParams.get('kind') ?? undefined, url.searchParams.get('cursor') ?? undefined),
        );
      if (method === 'POST') return send(201, await k.save(ctx, await body(request)));
    }
    const artifact = path.match(
      /^\/api\/knowledge\/artifacts\/([^/]+)(?:\/(review|publish|blocks|generate|compile-preview|implementations))?$/,
    );
    if (artifact) {
      const id = decodeURIComponent(artifact[1]);
      if (method === 'GET') {
        if (artifact[2] === 'implementations') return send(200, await intelligence.processImplementations(ctx, id));
        if (artifact[2] === 'blocks')
          return send(200, await k.blocks(ctx, id, z.string().min(1).parse(url.searchParams.get('revision'))));
        const data = await k.get(ctx, id, url.searchParams.get('revision') ?? undefined);
        const issues =
          data.artifact.kind === 'ontology'
            ? validateOntology(data.revision.content)
            : data.artifact.kind === 'process'
              ? validateProcess(data.revision.content)
              : [];
        return send(200, { ...data, issues });
      }
      if (method === 'POST' && artifact[2] === 'compile-preview')
        return send(200, await intelligence.previewProcess(ctx, id, await body(request)));
      if (method === 'POST' && artifact[2] === 'generate')
        return send(200, await intelligence.generateProcess(ctx, id, await body(request)));
      if (method === 'PUT' && !artifact[2]) return send(200, await k.save(ctx, await body(request), id));
      if (method === 'POST' && (artifact[2] === 'review' || artifact[2] === 'publish'))
        return send(200, await k.review(ctx, id, await body(request), artifact[2] === 'publish'));
    }
    if (path === '/api/intelligence/capabilities' && method === 'GET')
      return send(200, {
        model: { provider: 'minimax', adapter: 'minimax.authoring@1', installed: true, output: 'validated-json' },
        formats: ['text/plain', 'text/markdown'],
        generation: {
          version: 1,
          operations: ['construct', 'return'],
          constraints: ['linear', 'max-49-actions'],
          unavailable: ['external-integrations', 'agent-loops', 'conditional-routes', 'human-approval', 'OCR'],
        },
      });
    if (path === '/api/intelligence/tasks') {
      if (method === 'GET') return send(200, await intelligence.list(ctx, url.searchParams.get('cursor') ?? undefined));
      if (method === 'POST') return send(202, await intelligence.create(ctx, await body(request)));
    }
    const task = path.match(/^\/api\/intelligence\/tasks\/([^/]+)(?:\/(answers|cancel|apply|manifest|knowledge))?$/);
    if (task) {
      const id = decodeURIComponent(task[1]);
      if (method === 'GET' && task[2] === 'manifest') {
        await k.task(ctx, id);
        const row = (
          await k.pool.query('SELECT manifest FROM wi_applications WHERE workspace_id=$1 AND task_id=$2', [
            ctx.workspace.id,
            id,
          ])
        ).rows[0];
        return send(row ? 200 : 404, row?.manifest ?? { error: 'Generation manifest not found.' });
      }
      if (method === 'GET' && !task[2]) return send(200, (await k.task(ctx, id)).record);
      if (method === 'PUT' && !task[2]) return send(200, await intelligence.revise(ctx, id, await body(request)));
      if (method === 'POST' && task[2] === 'answers')
        return send(200, await intelligence.answers(ctx, id, await body(request)));
      if (method === 'POST' && task[2] === 'cancel') return send(200, await intelligence.cancel(ctx, id));
      if (method === 'POST' && task[2] === 'knowledge')
        return send(200, await intelligence.acceptKnowledge(ctx, id, await body(request)));
      if (method === 'POST' && task[2] === 'apply')
        return send(200, await intelligence.apply(ctx, id, await body(request)));
    }
    return send(404, { error: 'Knowledge endpoint not found.' });
  };
}
