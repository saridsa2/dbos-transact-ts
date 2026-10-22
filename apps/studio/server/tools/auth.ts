import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ControlError, tokenHash, type ControlPlane } from '../control/service';
const scopes = ['tools:read', 'tools:write', 'tools:test', 'tools:publish', 'tools:enable'];
export function developerAuthRoutes(
  control: ControlPlane,
  body: (r: IncomingMessage) => Promise<any>,
  json: (r: ServerResponse, status: number, value: unknown) => void,
) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    if (url.pathname === '/api/tools/auth/session' && request.method === 'GET') {
      const ctx = await control.context(request, 'read');
      const bearer = request.headers.authorization?.replace(/^Bearer /, '');
      const table = bearer?.startsWith('pcc_ws_') ? 'wt_workspace_api_keys' : 'wt_developer_tokens';
      const credential = bearer
        ? (await control.pool.query(`SELECT scopes,expires_at FROM ${table} WHERE token_hash=$1`, [tokenHash(bearer)]))
            .rows[0]
        : null;
      response.setHeader('Cache-Control', 'no-store');
      json(response, 200, {
        workspaceId: ctx.workspace.id,
        workspaceName: ctx.workspace.name,
        user: ctx.user.email,
        scopes: credential?.scopes,
        expiresAt: credential?.expires_at,
      });
      return true;
    }
    const keyMatch = url.pathname.match(/^\/api\/tools\/auth\/keys(?:\/([a-f0-9-]{36})\/revoke)?$/);
    if (keyMatch) {
      if (request.headers.authorization) throw new ControlError(403, 'Manage API keys from your signed-in browser.');
      const ctx = await control.context(request, 'manage');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'GET' && !keyMatch[1]) {
        const result = await control.pool.query(
          'SELECT id,name,prefix,scopes,expires_at AS "expiresAt",revoked,created_at AS "createdAt" FROM wt_workspace_api_keys WHERE workspace_id=$1 ORDER BY created_at DESC',
          [ctx.workspace.id],
        );
        json(response, 200, { keys: result.rows });
      } else if (request.method === 'POST' && keyMatch[1]) {
        const id = z.uuid().parse(keyMatch[1]);
        await control.transaction(async (c) => {
          const result = await c.query(
            'UPDATE wt_workspace_api_keys SET revoked=true WHERE workspace_id=$1 AND id=$2 RETURNING id',
            [ctx.workspace.id, id],
          );
          if (!result.rowCount) throw new ControlError(404, 'API key not found.');
          await control.audit(ctx, 'workspace.api_key_revoked', 'api_key', id, {}, c);
        });
        json(response, 200, { revoked: true });
      } else if (request.method === 'POST') {
        const p = z
          .object({
            name: z.string().trim().min(1).max(80),
            days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
            scopes: z
              .array(z.enum(['tools:read', 'tools:write', 'tools:test', 'tools:publish', 'tools:enable']))
              .min(1)
              .max(5),
          })
          .strict()
          .parse(await body(request));
        const id = randomUUID(),
          token = 'pcc_ws_' + randomBytes(32).toString('base64url'),
          expiresAt = new Date(Date.now() + p.days * 86400000).toISOString();
        await control.transaction(async (c) => {
          await c.query(
            'INSERT INTO wt_workspace_api_keys(id,workspace_id,user_id,name,token_hash,prefix,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              id,
              ctx.workspace.id,
              ctx.user.id,
              p.name,
              tokenHash(token),
              token.slice(0, 14),
              JSON.stringify([...new Set(p.scopes)]),
              expiresAt,
            ],
          );
          await control.audit(
            ctx,
            'workspace.api_key_created',
            'api_key',
            id,
            { name: p.name, scopes: p.scopes, expiresAt },
            c,
          );
        });
        json(response, 201, { id, token, expiresAt, workspaceId: ctx.workspace.id });
      } else throw new ControlError(405, 'Method not allowed.');
      return true;
    }
    if (url.pathname === '/api/tools/auth/device' && request.method === 'POST') {
      const { challenge } = z
        .object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .strict()
        .parse(await body(request));
      const count = await control.pool.query(
        "SELECT count(*) FROM wt_device_logins WHERE created_at>now()-interval '15 minutes'",
      );
      if (Number(count.rows[0].count) >= 100) throw new ControlError(429, 'Too many login requests. Try later.');
      const code = randomBytes(8).toString('hex').toUpperCase(),
        id = randomUUID();
      await control.pool.query(
        "INSERT INTO wt_device_logins(id,code_hash,challenge,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
        [id, tokenHash(code), challenge],
      );
      json(response, 200, {
        id,
        code,
        verificationPath: `/tools?authorize=${encodeURIComponent(code)}`,
        expiresIn: 600,
        interval: 3,
      });
      return true;
    }
    if (url.pathname === '/api/tools/auth/approve' && request.method === 'POST') {
      if (request.headers.authorization)
        throw new ControlError(403, 'Approve developer access from your signed-in browser.');
      const ctx = await control.context(request, 'execute');
      const { code } = z
        .object({ code: z.string().regex(/^[A-F0-9]{16}$/) })
        .strict()
        .parse(await body(request));
      const result = await control.pool.query(
        'UPDATE wt_device_logins SET approved=true,user_id=$2,workspace_id=$3 WHERE code_hash=$1 AND NOT approved AND NOT consumed AND expires_at>now() RETURNING id',
        [tokenHash(code), ctx.user.id, ctx.workspace.id],
      );
      if (!result.rowCount) throw new ControlError(410, 'Code expired or was already approved.');
      await control.audit(ctx, 'tool.developer_access_approved', 'tool', 'developer-login');
      json(response, 200, { approved: true });
      return true;
    }
    if (url.pathname === '/api/tools/auth/token' && request.method === 'POST') {
      const p = z
        .object({ id: z.uuid(), verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/) })
        .strict()
        .parse(await body(request));
      const result = await control.transaction(async (c) => {
        const d = (await c.query('SELECT * FROM wt_device_logins WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
        if (
          !d ||
          d.consumed ||
          new Date(d.expires_at).getTime() < Date.now() ||
          d.challenge !== createHash('sha256').update(p.verifier).digest('base64url')
        )
          throw new ControlError(410, 'Login expired or invalid.');
        if (!d.approved) return { pending: true };
        const token = 'sp_dev_' + randomBytes(32).toString('base64url');
        await c.query(
          "INSERT INTO wt_developer_tokens(token_hash,user_id,workspace_id,scopes,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",
          [tokenHash(token), d.user_id, d.workspace_id, JSON.stringify(scopes)],
        );
        await c.query('UPDATE wt_device_logins SET consumed=true WHERE id=$1', [p.id]);
        return { token, workspaceId: d.workspace_id, expiresAt: new Date(Date.now() + 3600000).toISOString() };
      });
      response.setHeader('Cache-Control', 'no-store');
      json(response, 200, result);
      return true;
    }
    if (url.pathname === '/api/tools/auth/revoke' && request.method === 'POST') {
      const user = await control.authenticate(request);
      if (!user) throw new ControlError(401, 'Sign in.');
      const bearer = request.headers.authorization?.replace(/^Bearer /, '');
      if (bearer)
        await control.pool.query('UPDATE wt_developer_tokens SET revoked=true WHERE token_hash=$1 AND user_id=$2', [
          tokenHash(bearer),
          user.id,
        ]);
      else await control.pool.query('UPDATE wt_developer_tokens SET revoked=true WHERE user_id=$1', [user.id]);
      json(response, 200, { revoked: true });
      return true;
    }
    return false;
  };
}
