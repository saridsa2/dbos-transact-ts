import { packTool, unpackTool } from './package';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ToolStore } from './store';
import { developerAuthRoutes } from './auth';
import { ControlError } from '../control/service';
import { builtinToolSource } from './builtin-source';
export function toolRoutes(
  store: ToolStore,
  body: (r: IncomingMessage) => Promise<any>,
  json: (r: ServerResponse, status: number, value: unknown) => void,
) {
  const auth = developerAuthRoutes(store.control, body, json);
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (!url.pathname.startsWith('/api/tools')) return false;
    try {
      if (await auth(req, res, url)) return true;
      const method = req.method ?? 'GET',
        mutating = !['GET', 'HEAD'].includes(method);
      const ctx = await store.control.context(
        req,
        /\/(releases|bindings|archive)$/.test(url.pathname) ? 'manage' : mutating ? 'execute' : 'read',
      );
      const match = url.pathname.match(
        /^\/api\/tools\/([a-f0-9-]{36})(?:\/(tests|releases|bindings|history|archive|export))?$/,
      );
      const builtin = url.pathname.match(/^\/api\/tools\/builtins\/([a-z][a-z0-9_]*_v\d+)$/);
      if (builtin && method === 'GET') {
        res.setHeader('cache-control', 'no-store');
        json(res, 200, await builtinToolSource(builtin[1]));
        return true;
      }
      if (url.pathname === '/api/tools' && method === 'GET') {
        json(res, 200, { items: await store.list(ctx) });
        return true;
      }
      if (url.pathname === '/api/tools/packages/decode' && method === 'POST') {
        const p = z
          .object({ archive: z.string().max(1500000) })
          .strict()
          .parse(await body(req));
        json(res, 200, { files: unpackTool(Buffer.from(p.archive, 'base64')) });
        return true;
      }
      if (url.pathname === '/api/tools/uploads' && method === 'POST') {
        const value = await store.save(ctx, await body(req));
        await store.control.audit(ctx, 'tool.draft_saved', 'tool', 'upload');
        json(res, 200, value);
        return true;
      }
      if (!match) {
        json(res, 404, { error: 'Tool route not found.' });
        return true;
      }
      const [, id, action] = match;
      let result: unknown;
      if (action === 'export' && method === 'GET') {
        const d = await store.get(ctx, id);
        const bytes = packTool(d.files);
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename=tool-${id}.sptool`,
          'content-length': bytes.byteLength,
          'cache-control': 'no-store',
        });
        res.end(bytes);
        return true;
      }
      if (!action && method === 'GET') result = await store.get(ctx, id);
      else if (action === 'history' && method === 'GET') result = await store.history(ctx, id);
      else if (action === 'tests' && method === 'POST') {
        const p = z
          .object({ hash: z.string(), fixture: z.string().max(80).optional() })
          .strict()
          .parse(await body(req));
        const abort = new AbortController();
        res.once('close', () => {
          if (!res.writableEnded) abort.abort();
        });
        if (req.headers.accept?.includes('text/event-stream')) {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'x-accel-buffering': 'no',
          });
          const emit = (event: unknown) => {
            if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
          };
          try {
            const tested = await store.test(ctx, id, p.hash, abort.signal, p.fixture, emit);
            await store.control.audit(ctx, 'tool.tests', 'tool', id);
            emit({ phase: 'completed', result: tested });
          } catch (e) {
            emit({ phase: 'failed', error: e instanceof Error ? e.message : 'Test failed.' });
          }
          res.end();
          return true;
        }
        result = await store.test(ctx, id, p.hash, abort.signal, p.fixture);
      } else if (action === 'releases' && method === 'POST') result = await store.publish(ctx, id, await body(req));
      else if (action === 'bindings' && method === 'POST') result = await store.bind(ctx, id, await body(req));
      else if (action === 'archive' && method === 'POST')
        result = await store.archive(
          ctx,
          id,
          z.object({ expectedVersion: z.number().int() }).parse(await body(req)).expectedVersion,
        );
      else throw new ControlError(405, 'Method not allowed.');
      if (mutating) await store.control.audit(ctx, `tool.${action}`, 'tool', id);
      json(res, 200, result);
      return true;
    } catch (e) {
      json(res, e instanceof ControlError ? e.status : e instanceof z.ZodError ? 422 : 400, {
        error: e instanceof Error ? e.message : 'Tool request failed.',
      });
      return true;
    }
  };
}
