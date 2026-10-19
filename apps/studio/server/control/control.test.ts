import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { SecretVault } from './secrets';
import { checkedIdentity, type CredentialResolver } from './auth';
import { ControlPlane } from './service';
import { connectionSchema } from '../../lib/control/contracts';
describe('control plane credential boundaries', () => {
  it('encrypts secrets with unique nonces and binds them to workspace/connection/version', () => {
    const vault = new SecretVault(randomBytes(32));
    const secret = 'fixture-secret';
    const first = vault.seal(secret, 'workspace/connection/1');
    const second = vault.seal(secret, 'workspace/connection/1');
    expect(first.iv).not.toBe(second.iv);
    expect(JSON.stringify(first)).not.toContain(secret);
    expect(vault.open(first, 'workspace/connection/1')).toBe(secret);
    expect(() => vault.open(first, 'other-workspace/connection/1')).toThrow();
    expect(() => vault.open(first, 'workspace/connection/2')).toThrow();
    expect(() =>
      vault.open({ ...first, data: Buffer.from('tampered').toString('base64') }, 'workspace/connection/1'),
    ).toThrow();
  });
  it('normalizes verified identity without interpreting provider role claims', () => {
    const identity = {
      issuer: 'https://identity.example.test',
      subject: 'subject-1',
      email: 'member@example.test',
      displayName: 'Member',
      emailVerified: true,
      role: 'owner',
    };
    expect(checkedIdentity(identity)).not.toHaveProperty('role');
    expect(checkedIdentity({ ...identity, expiresAt: '2000-01-01T00:00:00.000Z' })).toBeNull();
  });
  it('rejects credentials embedded in endpoint settings and requires keys for key providers', () => {
    expect(
      connectionSchema.safeParse({
        name: 'bad',
        provider: 'http',
        config: { endpoint: 'https://user:password@example.test' },
        secret: 'test',
      }).success,
    ).toBe(false);
    expect(
      connectionSchema.safeParse({ name: 'bad', provider: 'openai', config: { apiKey: 'not-allowed' }, secret: 'test' })
        .success,
    ).toBe(false);
    expect(connectionSchema.safeParse({ name: 'missing', provider: 'anthropic', config: {} }).success).toBe(false);
    expect(
      connectionSchema.safeParse({
        name: 'role',
        provider: 'aws-sts',
        config: { roleArn: 'arn:aws:iam::123456789012:role/Example', region: 'us-east-1' },
      }).success,
    ).toBe(true);
  });
  it('resolves temporary credentials only for the matching workspace and rejects stale or expired sessions', async () => {
    const row = {
      id: 'connection',
      workspace_id: 'workspace',
      provider: 'aws-sts',
      status: 'configured',
      revision: 2,
      auth_kind: 'sts',
      config: { roleArn: 'arn:aws:iam::123456789012:role/Example', region: 'us-east-1' },
    };
    const pool = {
      query: async (_sql: string, params: string[]) => ({
        rows: params[0] === row.id && params[1] === row.workspace_id ? [row] : [],
      }),
    } as unknown as Pool;
    let calls = 0;
    let expiresAt = new Date(Date.now() + 3600000).toISOString();
    const resolver: CredentialResolver = {
      resolve: async (input) => {
        calls++;
        expect(input.workspaceId).toBe('workspace');
        return {
          accessKeyId: 'fixture-id',
          secretAccessKey: 'fixture-secret',
          sessionToken: 'fixture-token',
          expiresAt,
        };
      },
    };
    const control = new ControlPlane(pool, new SecretVault(randomBytes(32)), null, resolver);
    await expect(control.resolveCredential('other', 'connection', 2)).rejects.toThrow('unavailable');
    expect(calls).toBe(0);
    await expect(control.resolveCredential('workspace', 'connection', 1)).rejects.toThrow('revision');
    expect(calls).toBe(0);
    expect((await control.resolveCredential('workspace', 'connection', 2)).kind).toBe('sts');
    expiresAt = new Date(Date.now() - 1000).toISOString();
    await expect(control.resolveCredential('workspace', 'connection', 2)).rejects.toThrow('expired');
    row.status = 'revoked';
    await expect(control.resolveCredential('workspace', 'connection', 2)).rejects.toThrow('unavailable');
  });
  it('validates Azure identities and rejects secrets in public connection settings', () => {
    const azure = {
      name: 'Azure fixture',
      provider: 'azure',
      config: { tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222' },
      secret: 'local-fixture',
    };
    expect(connectionSchema.safeParse(azure).success).toBe(true);
    expect(
      connectionSchema.safeParse({ ...azure, config: { ...azure.config, clientSecret: 'wrong-place' } }).success,
    ).toBe(false);
    expect(connectionSchema.safeParse({ ...azure, config: { tenantId: 'invalid', clientId: 'invalid' } }).success).toBe(
      false,
    );
    expect(
      connectionSchema.safeParse({
        name: 'Azure OpenAI',
        provider: 'azure-openai',
        config: { endpoint: 'https://example.openai.azure.com', deployment: 'example' },
        secret: 'fixture',
      }).success,
    ).toBe(true);
  });
});
