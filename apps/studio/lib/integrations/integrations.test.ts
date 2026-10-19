import { describe, it, expect } from 'vitest';
import { integrationCatalog, integrationOperation, integrationOperations } from './catalog';
import {
  compileIntegrationStep,
  integrationNodeSchema,
  integrationToolDefinition,
  operationKey,
  validateIntegrationCall,
} from './model';
import type { Connection } from '../control/contracts';
const http = integrationOperation('http.request', 1);
const node = integrationNodeSchema.parse({
  operation: { id: http.id, version: 1 },
  connection: { id: 'http-1', revision: 2 },
  parameters: { source: 'input', path: 'variables' },
});
const connection: Connection = {
  id: 'http-1',
  workspaceId: 'workspace-1',
  name: 'HTTP fixture',
  provider: 'http',
  config: { endpoint: 'https://example.test' },
  authKind: 'bearer',
  status: 'configured',
  revision: 2,
  hasSecret: true,
  secretVersion: 1,
  updatedAt: '2026-10-18T00:00:00Z',
  validationStatus: 'not_tested',
  credentialMode: 'stored',
  resolverAvailable: false,
};
const context = { workspaceId: 'workspace-1', installedAdapters: new Set(['http.request@1']) };
describe('integration operation definitions', () => {
  it('publishes unique versioned, serializable definitions with accurate adapter status', () => {
    expect(new Set(integrationOperations.map(operationKey)).size).toBe(integrationOperations.length);
    const catalog = JSON.parse(JSON.stringify(integrationCatalog()));
    expect(catalog).toHaveLength(8);
    expect(catalog.every((item: any) => item.implementation === 'defined' && item.inputSchema.type === 'object')).toBe(
      true,
    );
    expect(() => integrationOperation('http.request', 99)).toThrow('Unknown integration operation');
  });
  it('derives agent tool schemas from the same operation used by the canvas', () => {
    const tool = integrationToolDefinition(http),
      descriptor = integrationCatalog().find((item) => item.id === http.id)!;
    expect(tool.name).toBe('http_request_v1');
    expect(tool.inputSchema).toEqual(descriptor.inputSchema);
    expect(tool.outputSchema).toEqual(descriptor.outputSchema);
  });
  it('rejects embedded credentials and origin overrides in HTTP node parameters', () => {
    expect(() => http.inputSchema.parse({ path: 'https://other.example.test' })).toThrow();
    expect(() => http.inputSchema.parse({ path: '//other.example.test' })).toThrow();
    expect(() =>
      http.inputSchema.parse({ path: '/data', headers: [{ name: 'Authorization', value: 'secret' }] }),
    ).toThrow();
    expect(() => integrationNodeSchema.parse({ ...node, secret: 'inline-key' })).toThrow();
  });
  it('validates bounded pagination and represents file results as artifacts', () => {
    const list = integrationOperation('azure.blob.list', 1);
    expect(() => list.inputSchema.parse({ account: 'storageaccount', container: 'documents', limit: 1001 })).toThrow();
    expect(list.inputSchema.parse({ account: 'storageaccount', container: 'documents' })).toHaveProperty('limit', 100);
    const read = integrationOperation('aws.s3.read', 1);
    expect(() => read.outputSchema.parse({ body: 'file-bytes' })).toThrow();
    expect(
      read.outputSchema.parse({ artifact: { id: 'artifact-1', mediaType: 'text/plain', sizeBytes: 42 } }),
    ).toHaveProperty('artifact.id', 'artifact-1');
  });
  it('enforces tenant scope, revision, provider compatibility and revocation before dispatch', () => {
    expect(() =>
      validateIntegrationCall(http, node, connection, { ...context, workspaceId: 'other' }, { path: '/data' }),
    ).toThrow('workspace');
    expect(() =>
      validateIntegrationCall(http, node, { ...connection, revision: 3 }, context, { path: '/data' }),
    ).toThrow('revision');
    expect(() =>
      validateIntegrationCall(http, node, { ...connection, provider: 'azure' }, context, { path: '/data' }),
    ).toThrow('incompatible');
    expect(() =>
      validateIntegrationCall(http, node, { ...connection, status: 'revoked' }, context, { path: '/data' }),
    ).toThrow('revoked');
  });
  it('never compiles a definition into an executable node without an installed adapter', () => {
    expect(() => compileIntegrationStep(node, http, new Set())).toThrow('not installed');
    const step = compileIntegrationStep(node, http, context.installedAdapters);
    expect(step.kind).toBe('step');
    expect(step).toHaveProperty('handler', 'integration.dispatch.v1');
    expect(JSON.stringify(step)).not.toContain('secret');
    expect(step).toHaveProperty('input.fields.parameters', node.parameters);
  });
  it('prevents unsafe retries for mutations while allowing explicit read retries', () => {
    const retryNode = { ...node, policy: { timeoutMS: 30000, maxAttempts: 3 } };
    expect(() =>
      validateIntegrationCall(http, retryNode, connection, context, { method: 'POST', path: '/orders' }),
    ).toThrow('idempotency');
    expect(
      validateIntegrationCall(http, retryNode, connection, context, { method: 'GET', path: '/orders' }),
    ).toHaveProperty('policy.maxAttempts', 3);
    expect(() =>
      validateIntegrationCall(
        http,
        { ...retryNode, policy: { ...retryNode.policy, idempotencyKey: 'stable-call-id' } },
        connection,
        context,
        { method: 'POST', path: '/orders' },
      ),
    ).toThrow('adapter support');
    expect(
      validateIntegrationCall(
        http,
        { ...retryNode, policy: { ...retryNode.policy, idempotencyKey: 'stable-call-id' } },
        connection,
        { ...context, idempotencySupported: true },
        { method: 'POST', path: '/orders' },
      ),
    ).toHaveProperty('policy.idempotencyKey', 'stable-call-id');
  });
});
