import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  canExecute,
  canManage,
  connectionConfigs,
  connectionSchema,
  providers,
  type Connection,
  type Context,
  type Identity,
  type Role,
  type Session,
  type User,
  type Workspace,
} from '../../lib/control/contracts';
import { checkedIdentity, cookie, type AuthAdapter, type CredentialResolver } from './auth';
import { SecretVault } from './secrets';
export class ControlError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const userRow = (row: Record<string, any>): User => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  issuer: row.issuer,
  emailVerified: row.email_verified,
});
export class ControlPlane {
  constructor(
    readonly pool: Pool,
    readonly vault: SecretVault,
    readonly adapter: AuthAdapter | null,
    readonly resolver: CredentialResolver | null,
  ) {}
  get mode() {
    return this.adapter ? ('external' as const) : ('development' as const);
  }
  async initialize() {
    await this.pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async ensureUser(identity: Identity): Promise<User> {
    const result = await this.pool.query(
      `INSERT INTO cp_users(id,issuer,subject,email,display_name,email_verified) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(issuer,subject) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,email_verified=EXCLUDED.email_verified RETURNING *`,
      [
        randomUUID(),
        identity.issuer,
        identity.subject,
        identity.email.toLowerCase(),
        identity.displayName,
        identity.emailVerified,
      ],
    );
    return userRow(result.rows[0]);
  }
  async authenticate(request: IncomingMessage): Promise<User | null> {
    if (this.adapter) {
      let identity: Identity | null;
      try {
        identity = checkedIdentity(await this.adapter.authenticate(request));
      } catch {
        throw new ControlError(401, 'Identity verification failed.');
      }
      return identity ? this.ensureUser(identity) : null;
    }
    const token = cookie(request, 'studio_session');
    if (!token) return null;
    const result = await this.pool.query(
      'SELECT u.* FROM cp_sessions s JOIN cp_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [tokenHash(token)],
    );
    return result.rows[0] ? userRow(result.rows[0]) : null;
  }
  async developmentSession(input: unknown) {
    if (this.adapter) throw new ControlError(404, 'Development identity is disabled.');
    const value = z
      .object({ email: z.email().max(320), displayName: z.string().trim().min(1).max(150) })
      .strict()
      .parse(input);
    const user = await this.ensureUser({
      issuer: 'studio-development',
      subject: value.email.toLowerCase(),
      email: value.email,
      displayName: value.displayName,
      emailVerified: false,
    });
    const token = randomBytes(32).toString('base64url');
    await this.pool.query(
      "INSERT INTO cp_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [tokenHash(token), user.id],
    );
    return { token, user };
  }
  async logout(request: IncomingMessage) {
    const token = cookie(request, 'studio_session');
    if (token) await this.pool.query('DELETE FROM cp_sessions WHERE token_hash=$1', [tokenHash(token)]);
  }
  async workspaces(userId: string): Promise<Workspace[]> {
    return (
      await this.pool.query(
        `SELECT w.id,w.name,w.customer_id AS "customerId",c.name AS "customerName",m.role FROM cp_memberships m JOIN cp_workspaces w ON w.id=m.workspace_id JOIN cp_customers c ON c.id=w.customer_id WHERE m.user_id=$1 ORDER BY w.created_at,w.id`,
        [userId],
      )
    ).rows;
  }
  async session(request: IncomingMessage): Promise<Session> {
    const user = await this.authenticate(request);
    const workspaces = user ? await this.workspaces(user.id) : [];
    const selected = request.headers['x-studio-workspace'] || cookie(request, 'studio_workspace');
    const workspace =
      (selected ? workspaces.find((w) => w.id === selected) : workspaces[0]) ??
      (request.headers['x-studio-workspace'] ? null : (workspaces[0] ?? null));
    const legacyImportAvailable = user
      ? Boolean(
          (await this.pool.query("SELECT 1 FROM cp_customers WHERE id='local' AND owner_user_id IS NULL")).rowCount,
        )
      : false;
    return {
      mode: this.mode,
      adapter: this.adapter?.name ?? 'Local development identity',
      user,
      workspaces,
      workspace,
      legacyImportAvailable,
      ...(this.adapter?.loginUrl ? { loginUrl: this.adapter.loginUrl } : {}),
    };
  }
  async context(request: IncomingMessage, permission: 'read' | 'execute' | 'manage' = 'read'): Promise<Context> {
    const session = await this.session(request);
    if (!session.user) throw new ControlError(401, 'Sign in to continue.');
    if (!session.workspace) throw new ControlError(403, 'Select a workspace you belong to.');
    if (permission === 'manage' && !canManage(session.workspace.role))
      throw new ControlError(403, 'An owner or admin role is required.');
    if (permission === 'execute' && !canExecute(session.workspace.role))
      throw new ControlError(403, 'A viewer cannot change or execute workflows.');
    return { user: session.user, workspace: session.workspace };
  }
  async audit(
    ctx: Context,
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown> = {},
    client: Pool | PoolClient = this.pool,
  ) {
    await client.query(
      'INSERT INTO cp_audit(workspace_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
      [ctx.workspace.id, ctx.user.id, action, entityType, entityId, details],
    );
  }
  async onboard(user: User, input: unknown): Promise<string> {
    const value = z
      .object({
        customerName: z.string().trim().min(1).max(150),
        workspaceName: z.string().trim().min(1).max(150),
        adoptLocalWorkspace: z.boolean().default(false),
      })
      .strict()
      .parse(input);
    return this.transaction(async (client) => {
      let customerId: string = randomUUID();
      let workspaceId: string = randomUUID();
      if (value.adoptLocalWorkspace) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('studio-local-onboarding'))");
        const local = await client.query("SELECT owner_user_id FROM cp_customers WHERE id='local' FOR UPDATE");
        if (local.rows[0]?.owner_user_id)
          throw new ControlError(409, 'Existing local workflows have already been assigned.');
        customerId = 'local';
        workspaceId = 'local';
        await client.query('UPDATE cp_customers SET name=$1,owner_user_id=$2 WHERE id=$3', [
          value.customerName,
          user.id,
          customerId,
        ]);
        await client.query('UPDATE cp_workspaces SET name=$1 WHERE id=$2', [value.workspaceName, workspaceId]);
      } else {
        await client.query('INSERT INTO cp_customers(id,name,owner_user_id) VALUES($1,$2,$3)', [
          customerId,
          value.customerName,
          user.id,
        ]);
        await client.query('INSERT INTO cp_workspaces(id,customer_id,name) VALUES($1,$2,$3)', [
          workspaceId,
          customerId,
          value.workspaceName,
        ]);
      }
      await client.query("INSERT INTO cp_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')", [
        workspaceId,
        user.id,
      ]);
      await this.audit(
        {
          user,
          workspace: {
            id: workspaceId,
            name: value.workspaceName,
            customerId,
            customerName: value.customerName,
            role: 'owner',
          },
        },
        'workspace.created',
        'workspace',
        workspaceId,
        { adoptedLocal: value.adoptLocalWorkspace },
        client,
      );
      return workspaceId;
    });
  }
  async members(ctx: Context) {
    return (
      await this.pool.query(
        `SELECT u.id,u.email,u.display_name AS "displayName",m.role FROM cp_memberships m JOIN cp_users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.display_name`,
        [ctx.workspace.id],
      )
    ).rows;
  }
  async updateMember(ctx: Context, id: string, input: unknown) {
    const { role } = z
      .object({ role: z.enum(['admin', 'editor', 'viewer']) })
      .strict()
      .parse(input);
    return this.transaction(async (client) => {
      const target = (
        await client.query('SELECT role FROM cp_memberships WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE', [
          ctx.workspace.id,
          id,
        ])
      ).rows[0];
      if (!target) throw new ControlError(404, 'Member not found.');
      if (target.role === 'owner') throw new ControlError(409, 'Owner transfer requires a separate account operation.');
      if (ctx.workspace.role !== 'owner' && (role === 'admin' || target.role === 'admin'))
        throw new ControlError(403, 'Only an owner can assign or change admins.');
      await client.query('UPDATE cp_memberships SET role=$3 WHERE workspace_id=$1 AND user_id=$2', [
        ctx.workspace.id,
        id,
        role,
      ]);
      await this.audit(ctx, 'member.role_changed', 'user', id, { role }, client);
    });
  }
  async removeMember(ctx: Context, id: string) {
    return this.transaction(async (client) => {
      const target = (
        await client.query('SELECT role FROM cp_memberships WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE', [
          ctx.workspace.id,
          id,
        ])
      ).rows[0];
      if (!target) throw new ControlError(404, 'Member not found.');
      if (target.role === 'owner') throw new ControlError(409, 'The workspace owner cannot be removed.');
      if (target.role === 'admin' && ctx.workspace.role !== 'owner')
        throw new ControlError(403, 'Only an owner can remove an admin.');
      await client.query('DELETE FROM cp_memberships WHERE workspace_id=$1 AND user_id=$2', [ctx.workspace.id, id]);
      await this.audit(ctx, 'member.removed', 'user', id, {}, client);
    });
  }
  async invite(ctx: Context, input: unknown) {
    const value = z
      .object({ email: z.email().max(320), role: z.enum(['admin', 'editor', 'viewer']) })
      .strict()
      .parse(input);
    if (value.role === 'admin' && ctx.workspace.role !== 'owner')
      throw new ControlError(403, 'Only an owner can invite admins.');
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await this.transaction(async (client) => {
      await client.query(
        "INSERT INTO cp_invitations(id,workspace_id,email,role,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6)",
        [id, ctx.workspace.id, value.email.toLowerCase(), value.role, tokenHash(token), ctx.user.id],
      );
      await this.audit(
        ctx,
        'member.invited',
        'invitation',
        id,
        { email: value.email.toLowerCase(), role: value.role },
        client,
      );
    });
    return { id, token, path: `/control?invite=${encodeURIComponent(token)}` };
  }
  async invitations(ctx: Context) {
    return (
      await this.pool.query(
        `SELECT id,email,role,expires_at AS "expiresAt",accepted_at AS "acceptedAt" FROM cp_invitations WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [ctx.workspace.id],
      )
    ).rows;
  }
  async revokeInvitation(ctx: Context, id: string) {
    await this.transaction(async (client) => {
      const result = await client.query(
        'UPDATE cp_invitations SET token_hash=NULL,expires_at=now() WHERE id=$1 AND workspace_id=$2 AND accepted_at IS NULL RETURNING id',
        [id, ctx.workspace.id],
      );
      if (!result.rowCount) throw new ControlError(404, 'Pending invitation not found.');
      await this.audit(ctx, 'invitation.revoked', 'invitation', id, {}, client);
    });
  }
  async accept(user: User, input: unknown) {
    const { token } = z
      .object({ token: z.string().min(20).max(100) })
      .strict()
      .parse(input);
    if (this.adapter && !user.emailVerified)
      throw new ControlError(403, 'Verify your email with your identity provider before accepting an invitation.');
    return this.transaction(async (client) => {
      const invitation = (
        await client.query(
          'SELECT * FROM cp_invitations WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL FOR UPDATE',
          [tokenHash(token)],
        )
      ).rows[0];
      if (!invitation) throw new ControlError(409, 'Invitation is expired, revoked or already used.');
      if (invitation.email !== user.email.toLowerCase())
        throw new ControlError(403, 'Sign in using the email address this invitation was sent to.');
      await client.query(
        'INSERT INTO cp_memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [invitation.workspace_id, user.id, invitation.role],
      );
      await client.query('UPDATE cp_invitations SET accepted_at=now(),token_hash=NULL WHERE id=$1', [invitation.id]);
      await client.query(
        'INSERT INTO cp_audit(workspace_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [
          invitation.workspace_id,
          user.id,
          'invitation.accepted',
          'invitation',
          invitation.id,
          { role: invitation.role },
        ],
      );
      return invitation.workspace_id as string;
    });
  }
  async connections(ctx: Context): Promise<Connection[]> {
    return (
      await this.pool.query(
        'SELECT c.*,s.version AS secret_version FROM cp_connections c LEFT JOIN cp_connection_secrets s ON s.connection_id=c.id WHERE c.workspace_id=$1 ORDER BY c.updated_at DESC',
        [ctx.workspace.id],
      )
    ).rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      provider: row.provider,
      config: row.config,
      authKind: row.auth_kind,
      status: row.status,
      revision: row.revision,
      hasSecret: row.secret_version !== null,
      secretVersion: row.secret_version ?? 0,
      updatedAt: row.updated_at.toISOString(),
      validationStatus: 'not_tested',
      credentialMode: row.auth_kind === 'sts' ? 'temporary' : 'stored',
      resolverAvailable: row.auth_kind === 'sts' ? this.resolver !== null : true,
    }));
  }
  async createConnection(ctx: Context, input: unknown) {
    const value = connectionSchema.parse(input);
    const id = randomUUID();
    const authKind = providers.find((p) => p.id === value.provider)!.auth;
    const config = connectionConfigs[value.provider].parse(value.config);
    await this.transaction(async (client) => {
      await client.query(
        'INSERT INTO cp_connections(id,workspace_id,name,provider,config,auth_kind,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, ctx.workspace.id, value.name, value.provider, config, authKind, ctx.user.id],
      );
      if (value.secret)
        await client.query('INSERT INTO cp_connection_secrets(connection_id,version,sealed) VALUES($1,1,$2)', [
          id,
          this.vault.seal(value.secret, `${ctx.workspace.id}/${id}/1`),
        ]);
      await this.audit(ctx, 'connection.created', 'connection', id, { provider: value.provider, revision: 1 }, client);
    });
    return id;
  }
  async updateConnection(ctx: Context, id: string, input: unknown) {
    const value = z
      .object({
        revision: z.number().int().positive(),
        name: z.string().trim().min(1).max(150),
        config: z.record(z.string(), z.unknown()),
      })
      .strict()
      .parse(input);
    await this.transaction(async (client) => {
      const row = (
        await client.query('SELECT * FROM cp_connections WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
          id,
          ctx.workspace.id,
        ])
      ).rows[0];
      if (!row) throw new ControlError(404, 'Connection not found.');
      if (row.status === 'revoked' || row.revision !== value.revision)
        throw new ControlError(409, 'Connection is revoked or changed. Refresh before editing.');
      const provider = row.provider as keyof typeof connectionConfigs;
      const config = connectionConfigs[provider].parse(value.config);
      await client.query(
        'UPDATE cp_connections SET name=$2,config=$3,revision=revision+1,updated_at=now() WHERE id=$1',
        [id, value.name, config],
      );
      await this.audit(ctx, 'connection.updated', 'connection', id, { revision: row.revision + 1 }, client);
    });
  }
  async rotateConnection(ctx: Context, id: string, input: unknown) {
    const value = z
      .object({ revision: z.number().int().positive(), secret: z.string().min(1).max(20000) })
      .strict()
      .parse(input);
    await this.transaction(async (client) => {
      const row = (
        await client.query('SELECT * FROM cp_connections WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
          id,
          ctx.workspace.id,
        ])
      ).rows[0];
      if (!row) throw new ControlError(404, 'Connection not found.');
      if (row.status === 'revoked') throw new ControlError(409, 'This connection is revoked. Create a new connection.');
      if (row.revision !== value.revision) throw new ControlError(409, 'Connection changed. Refresh before rotating.');
      const old = (await client.query('SELECT version FROM cp_connection_secrets WHERE connection_id=$1', [id]))
        .rows[0];
      const version = (old?.version ?? 0) + 1;
      await client.query(
        'INSERT INTO cp_connection_secrets(connection_id,version,sealed) VALUES($1,$2,$3) ON CONFLICT(connection_id) DO UPDATE SET version=EXCLUDED.version,sealed=EXCLUDED.sealed',
        [id, version, this.vault.seal(value.secret, `${ctx.workspace.id}/${id}/${version}`)],
      );
      await client.query('UPDATE cp_connections SET revision=revision+1,updated_at=now() WHERE id=$1', [id]);
      await this.audit(
        ctx,
        'credential.rotated',
        'connection',
        id,
        { revision: row.revision + 1, secretVersion: version },
        client,
      );
    });
  }
  async revokeConnection(ctx: Context, id: string, input: unknown) {
    const { revision } = z.object({ revision: z.number().int().positive() }).strict().parse(input);
    await this.transaction(async (client) => {
      const result = await client.query(
        "UPDATE cp_connections SET status='revoked',revision=revision+1,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND revision=$3 AND status='configured' RETURNING revision",
        [id, ctx.workspace.id, revision],
      );
      if (!result.rowCount)
        throw new ControlError(409, 'Connection is unavailable or changed. Refresh before revoking.');
      await client.query('DELETE FROM cp_connection_secrets WHERE connection_id=$1', [id]);
      await this.audit(ctx, 'connection.revoked', 'connection', id, { revision: result.rows[0].revision }, client);
    });
  }
  /** Worker-only broker. Never expose its return value through HTTP. */
  async resolveCredential(workspaceId: string, id: string, revision: number) {
    const row = (
      await this.pool.query(
        'SELECT c.*,s.version AS secret_version,s.sealed FROM cp_connections c LEFT JOIN cp_connection_secrets s ON s.connection_id=c.id WHERE c.id=$1 AND c.workspace_id=$2',
        [id, workspaceId],
      )
    ).rows[0];
    if (!row || row.status !== 'configured') throw new ControlError(404, 'Connection unavailable.');
    if (row.revision !== revision) throw new ControlError(409, 'Connection revision is unavailable.');
    const secret = row.sealed ? this.vault.open(row.sealed, `${workspaceId}/${id}/${row.secret_version}`) : undefined;
    if (row.auth_kind !== 'sts') return { kind: row.auth_kind, secret };
    if (!this.resolver) throw new ControlError(503, 'Configure a temporary credential resolver for AWS STS.');
    const result = z
      .object({
        accessKeyId: z.string().min(1),
        secretAccessKey: z.string().min(1),
        sessionToken: z.string().min(1),
        expiresAt: z.iso.datetime(),
      })
      .parse(
        await this.resolver.resolve({
          workspaceId,
          connectionId: id,
          revision,
          provider: row.provider,
          config: row.config,
          secret,
        }),
      );
    if (new Date(result.expiresAt).getTime() < Date.now() + 60000)
      throw new ControlError(503, 'Temporary credential resolver returned an expired or nearly expired session.');
    return { kind: 'sts', ...result };
  }
  async auditEvents(ctx: Context, before?: string) {
    if (before && !/^\d+$/.test(before)) throw new ControlError(400, 'Invalid audit cursor.');
    const rows = (
      await this.pool.query(
        `SELECT a.id::text,a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",COALESCE(u.display_name,'System') AS actor,a.created_at AS "createdAt",a.details FROM cp_audit a LEFT JOIN cp_users u ON u.id=a.actor_id WHERE a.workspace_id=$1 AND ($2::bigint IS NULL OR a.id<$2::bigint) ORDER BY a.id DESC LIMIT 100`,
        [ctx.workspace.id, before ?? null],
      )
    ).rows;
    return { events: rows, nextCursor: rows.length === 100 ? rows.at(-1).id : null };
  }
}
