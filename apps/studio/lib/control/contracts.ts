import { z } from 'zod';
export const roles = ['owner', 'admin', 'editor', 'viewer'] as const;
export type Role = (typeof roles)[number];
export const identitySchema = z.object({
  issuer: z.string().min(1).max(500),
  subject: z.string().min(1).max(500),
  email: z.email().max(320),
  displayName: z.string().min(1).max(150),
  emailVerified: z.boolean(),
  expiresAt: z.iso.datetime().optional(),
});
export type Identity = z.infer<typeof identitySchema>;
export type User = { id: string; email: string; displayName: string; issuer: string; emailVerified: boolean };
export type Workspace = { id: string; name: string; customerId: string; customerName: string; role: Role };
export type Context = { user: User; workspace: Workspace };
export type Session = {
  mode: 'development' | 'external';
  adapter: string;
  user: User | null;
  workspaces: Workspace[];
  workspace: Workspace | null;
  legacyImportAvailable: boolean;
  loginUrl?: string;
};
export const providers = [
  { id: 'openai', name: 'OpenAI', category: 'Models', auth: 'api_key' },
  { id: 'anthropic', name: 'Anthropic / Claude', category: 'Models', auth: 'api_key' },
  { id: 'microsoft-foundry', name: 'Microsoft Foundry', category: 'Models and agents', auth: 'api_key' },
  { id: 'azure', name: 'Microsoft Azure', category: 'Cloud services', auth: 'client_secret' },
  { id: 'azure-openai', name: 'Azure OpenAI', category: 'Models', auth: 'api_key' },
  { id: 'http', name: 'HTTP service', category: 'External sources', auth: 'bearer' },
  { id: 'mcp', name: 'MCP server', category: 'Tools and sources', auth: 'bearer' },
  { id: 'postgres', name: 'PostgreSQL', category: 'Data sources', auth: 'password' },
  { id: 'aws-sts', name: 'AWS STS role', category: 'Temporary credentials', auth: 'sts' },
] as const;
export type Provider = (typeof providers)[number]['id'];
const endpoint = z.url().refine((value) => {
  const u = new URL(value);
  return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
}, 'Use an HTTP(S) endpoint without embedded credentials, query parameters or fragments.');
export const connectionConfigs = {
  openai: z.object({ project: z.string().max(200).optional() }).strict(),
  anthropic: z.object({}).strict(),
  'microsoft-foundry': z
    .object({
      endpoint,
      project: z.string().max(200).optional(),
      deployment: z.string().max(200).optional(),
      apiVersion: z.string().max(100).optional(),
    })
    .strict(),
  azure: z.object({ tenantId: z.uuid(), clientId: z.uuid(), subscriptionId: z.uuid().optional() }).strict(),
  'azure-openai': z
    .object({ endpoint, deployment: z.string().min(1).max(200), apiVersion: z.string().max(100).optional() })
    .strict(),
  http: z.object({ endpoint }).strict(),
  mcp: z.object({ endpoint }).strict(),
  postgres: z
    .object({
      host: z.string().min(1).max(300),
      port: z.number().int().min(1).max(65535).default(5432),
      database: z.string().min(1).max(200),
      username: z.string().min(1).max(200),
    })
    .strict(),
  'aws-sts': z
    .object({
      roleArn: z.string().regex(/^arn:aws(?:-us-gov|-cn)?:iam::\d{12}:role\/.+/),
      region: z.string().min(1).max(100),
      durationSeconds: z.number().int().min(900).max(43200).default(3600),
    })
    .strict(),
};
export const connectionSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    provider: z.enum([
      'openai',
      'anthropic',
      'microsoft-foundry',
      'azure',
      'azure-openai',
      'http',
      'mcp',
      'postgres',
      'aws-sts',
    ]),
    config: z.record(z.string(), z.unknown()),
    secret: z.string().min(1).max(20000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const result = connectionConfigs[value.provider].safeParse(value.config);
    if (!result.success)
      ctx.addIssue({ code: 'custom', path: ['config'], message: 'Connection settings do not match this provider.' });
    if (value.provider !== 'aws-sts' && !value.secret)
      ctx.addIssue({ code: 'custom', path: ['secret'], message: 'A credential is required.' });
  });
export type Connection = {
  id: string;
  workspaceId: string;
  name: string;
  provider: Provider;
  config: Record<string, unknown>;
  authKind: string;
  status: 'configured' | 'revoked';
  revision: number;
  hasSecret: boolean;
  secretVersion: number;
  updatedAt: string;
  validationStatus: 'not_tested';
  credentialMode: 'stored' | 'temporary';
  resolverAvailable: boolean;
};
export type Member = { id: string; email: string; displayName: string; role: Role };
export type AuditEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: string;
  createdAt: string;
  details: Record<string, unknown>;
};
export const canManage = (role: Role) => role === 'owner' || role === 'admin';
export const canExecute = (role: Role) => role !== 'viewer';

export type WorkspaceNotification = {
  id: string;
  kind: 'execution' | 'workspace';
  action: string;
  entityType: string;
  entityId: string;
  title: string;
  resourceName?: string;
  readAt?: string;
  createdAt: string;
};
