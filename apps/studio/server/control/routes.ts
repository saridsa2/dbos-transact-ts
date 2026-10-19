import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { providers } from '../../lib/control/contracts';
import { ControlError, ControlPlane } from './service';
type Json = (response: ServerResponse, status: number, value: unknown) => void;
export function controlRoutes(
  control: ControlPlane,
  readBody: (request: IncomingMessage) => Promise<unknown>,
  json: Json,
) {
  const workspaceCookie = (response: ServerResponse, id: string) =>
    response.setHeader(
      'set-cookie',
      `studio_workspace=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;
    if (!path.startsWith('/api/control/')) return false;
    if (path === '/api/control/session' && request.method === 'GET') {
      json(response, 200, await control.session(request));
      return true;
    }
    if (path === '/api/control/session/development' && request.method === 'POST') {
      const { token } = await control.developmentSession(await readBody(request));
      response.setHeader('set-cookie', `studio_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
      json(response, 201, { signedIn: true });
      return true;
    }
    if (path === '/api/control/session' && request.method === 'DELETE') {
      await control.logout(request);
      response.setHeader('set-cookie', [
        'studio_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
        'studio_workspace=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      ]);
      json(response, 200, { signedOut: true });
      return true;
    }
    const user = await control.authenticate(request);
    if (!user) throw new ControlError(401, 'Sign in to continue.');
    if (path === '/api/control/onboarding' && request.method === 'POST') {
      const id = await control.onboard(user, await readBody(request));
      workspaceCookie(response, id);
      json(response, 201, { workspaceId: id });
      return true;
    }
    if (path === '/api/control/invitations/accept' && request.method === 'POST') {
      const id = await control.accept(user, await readBody(request));
      workspaceCookie(response, id);
      json(response, 200, { workspaceId: id });
      return true;
    }
    if (path === '/api/control/workspace' && request.method === 'POST') {
      const { id } = z
        .object({ id: z.string().min(1).max(128) })
        .strict()
        .parse(await readBody(request));
      if (!(await control.workspaces(user.id)).some((w) => w.id === id))
        throw new ControlError(403, 'Workspace access denied.');
      workspaceCookie(response, id);
      json(response, 200, { workspaceId: id });
      return true;
    }
    const ctx = await control.context(request, request.method === 'GET' ? 'read' : 'manage');
    if (path === '/api/control/providers' && request.method === 'GET') {
      json(response, 200, providers);
      return true;
    }
    if (path === '/api/control/members' && request.method === 'GET') {
      json(response, 200, await control.members(ctx));
      return true;
    }
    const member = path.match(/^\/api\/control\/members\/([^/]+)$/);
    if (member && request.method === 'PATCH') {
      await control.updateMember(ctx, decodeURIComponent(member[1]), await readBody(request));
      json(response, 200, { updated: true });
      return true;
    }
    if (member && request.method === 'DELETE') {
      await control.removeMember(ctx, decodeURIComponent(member[1]));
      json(response, 200, { removed: true });
      return true;
    }
    if (path === '/api/control/invitations' && request.method === 'POST') {
      json(response, 201, await control.invite(ctx, await readBody(request)));
      return true;
    }
    if (path === '/api/control/invitations' && request.method === 'GET') {
      if (!['owner', 'admin'].includes(ctx.workspace.role))
        throw new ControlError(403, 'An owner or admin role is required.');
      json(response, 200, await control.invitations(ctx));
      return true;
    }
    const invitation = path.match(/^\/api\/control\/invitations\/([^/]+)$/);
    if (invitation && request.method === 'DELETE') {
      await control.revokeInvitation(ctx, decodeURIComponent(invitation[1]));
      json(response, 200, { revoked: true });
      return true;
    }
    if (path === '/api/control/connections' && request.method === 'GET') {
      json(response, 200, await control.connections(ctx));
      return true;
    }
    if (path === '/api/control/connections' && request.method === 'POST') {
      const id = await control.createConnection(ctx, await readBody(request));
      json(response, 201, { id });
      return true;
    }
    const editConnection = path.match(/^\/api\/control\/connections\/([^/]+)$/);
    if (editConnection && request.method === 'PATCH') {
      await control.updateConnection(ctx, decodeURIComponent(editConnection[1]), await readBody(request));
      json(response, 200, { updated: true });
      return true;
    }
    const connection = path.match(/^\/api\/control\/connections\/([^/]+)\/(rotate|revoke)$/);
    if (connection && request.method === 'POST') {
      const id = decodeURIComponent(connection[1]);
      if (connection[2] === 'rotate') await control.rotateConnection(ctx, id, await readBody(request));
      else await control.revokeConnection(ctx, id, await readBody(request));
      json(response, 200, { updated: true });
      return true;
    }
    if (path === '/api/control/audit' && request.method === 'GET') {
      if (!['owner', 'admin'].includes(ctx.workspace.role))
        throw new ControlError(403, 'An owner or admin role is required.');
      json(response, 200, await control.auditEvents(ctx, url.searchParams.get('before') ?? undefined));
      return true;
    }
    if (path === '/api/control/runs' && request.method === 'GET') {
      const rows = await control.pool.query(
        `SELECT r.id,r.flow_id,r.flow_name,r.status,r.created_at,r.completed_at,r.parent_id,COALESCE(u.display_name,CASE WHEN r.parent_id IS NULL THEN 'System / earlier local run' ELSE 'Parent workflow' END) AS actor FROM studio_runs r LEFT JOIN cp_users u ON u.id=r.actor_user_id WHERE r.workspace_id=$1 ORDER BY r.created_at DESC LIMIT 100`,
        [ctx.workspace.id],
      );
      json(response, 200, rows.rows);
      return true;
    }
    json(response, 404, { error: 'Control plane route not found.' });
    return true;
  };
}
