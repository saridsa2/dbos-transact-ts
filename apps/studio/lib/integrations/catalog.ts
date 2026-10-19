import { z } from 'zod';
import { operationKey, publicOperation, type IntegrationOperation } from './model';

const jsonObject = z.record(z.string(), z.json());
const relativePath = z
  .string()
  .min(1)
  .max(4000)
  .regex(/^\/(?!\/)[^?#\r\n]*$/)
  .describe('Path relative to the selected connection endpoint. Query parameters are separate.');
const artifact = z
  .object({
    id: z.string().min(1),
    mediaType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().optional(),
  })
  .strict();
const objects = z
  .object({
    items: z
      .array(
        z.object({ key: z.string(), sizeBytes: z.number().int().nonnegative(), etag: z.string().optional() }).strict(),
      )
      .max(1000),
    nextCursor: z.string().optional(),
  })
  .strict();
const listFields = {
  prefix: z.string().max(2000).optional(),
  cursor: z.string().max(8000).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
};
const blobFields = { account: z.string().regex(/^[a-z0-9]{3,24}$/), container: z.string().min(3).max(63) };
const bucketFields = { bucket: z.string().min(3).max(255) };
const httpInput = z
  .object({
    method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    path: relativePath,
    query: z.record(z.string(), z.string()).default({}),
    headers: z
      .array(
        z
          .object({
            name: z.enum(['Accept', 'Content-Type', 'User-Agent', 'If-Match', 'If-None-Match', 'X-Correlation-ID']),
            value: z.string().max(8000),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    body: z.json().optional(),
  })
  .strict()
  .describe('Authorization, cookies and API keys are supplied by the connection broker, never request parameters.');
const mcpTool = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: jsonObject,
    outputSchema: jsonObject.optional(),
  })
  .strict();
const base = {
  version: 1,
  implementation: 'defined',
  pagination: 'none',
  boundary: 'step',
  effect: 'read',
  limits: { maxTimeoutMS: 300000, maxAttempts: 5, maxResultBytes: 4 * 1024 * 1024 },
} as const;

/** Definitions only. No descriptor is advertised as an installed/live provider adapter. */
export const integrationOperations: readonly IntegrationOperation[] = [
  {
    ...base,
    id: 'http.request',
    integration: 'http',
    resource: 'request',
    action: 'send',
    title: 'HTTP request',
    description: 'Send a bounded HTTP request through an authorized endpoint connection.',
    connectionProviders: ['http'],
    effect: 'conditional',
    dependencies: ['http-transport', 'endpoint-policy'],
    inputSchema: httpInput,
    outputSchema: z
      .object({ status: z.number().int(), headers: z.record(z.string(), z.string()), body: z.json() })
      .strict(),
  },
  {
    ...base,
    id: 'mcp.tools.list',
    integration: 'mcp',
    resource: 'tool',
    action: 'list',
    title: 'Discover MCP tools',
    description: 'Discover tools and their schemas from a connected MCP server.',
    connectionProviders: ['mcp'],
    pagination: 'cursor',
    dependencies: ['mcp-client'],
    inputSchema: z.object({ cursor: z.string().max(8000).optional() }).strict(),
    outputSchema: z.object({ tools: z.array(mcpTool), nextCursor: z.string().optional() }).strict(),
  },
  {
    ...base,
    id: 'mcp.tool.call',
    integration: 'mcp',
    resource: 'tool',
    action: 'call',
    title: 'Call MCP tool',
    description: 'Call a discovered MCP tool with validated arguments and a pinned schema.',
    connectionProviders: ['mcp'],
    effect: 'conditional',
    dependencies: ['mcp-client', 'tool-schema-discovery'],
    inputSchema: z
      .object({
        tool: z.string().min(1).max(200),
        schemaFingerprint: z.string().min(1).max(200),
        arguments: jsonObject,
      })
      .strict(),
    outputSchema: z
      .object({ content: z.array(jsonObject), structuredContent: jsonObject.optional(), isError: z.boolean() })
      .strict(),
  },
  {
    ...base,
    id: 'postgres.query',
    integration: 'postgres',
    resource: 'query',
    action: 'read',
    title: 'Query Postgres',
    description: 'Execute a parameterized query in a read-only datasource transaction.',
    connectionProviders: ['postgres'],
    boundary: 'transaction',
    dependencies: ['external-postgres-datasource', 'read-only-transaction'],
    inputSchema: z
      .object({
        sql: z.string().min(1).max(50000),
        values: z.array(z.json()).max(100).default([]),
        maxRows: z.number().int().min(1).max(1000).default(100),
      })
      .strict(),
    outputSchema: z.object({ rows: z.array(jsonObject).max(1000), rowCount: z.number().int().nonnegative() }).strict(),
  },
  {
    ...base,
    id: 'azure.blob.list',
    integration: 'azure-blob',
    resource: 'blob',
    action: 'list',
    title: 'List Azure blobs',
    description: 'List a bounded page of blob metadata in an Azure storage container.',
    connectionProviders: ['azure'],
    pagination: 'cursor',
    dependencies: ['azure-token-exchange', 'azure-blob-client'],
    inputSchema: z.object({ ...blobFields, ...listFields }).strict(),
    outputSchema: objects,
  },
  {
    ...base,
    id: 'azure.blob.read',
    integration: 'azure-blob',
    resource: 'blob',
    action: 'read',
    title: 'Read Azure blob',
    description:
      'Read a blob into an immutable private artifact instead of storing file bytes in workflow checkpoints.',
    connectionProviders: ['azure'],
    dependencies: ['azure-token-exchange', 'azure-blob-client', 'private-artifact-store'],
    inputSchema: z
      .object({
        ...blobFields,
        key: z.string().min(1).max(2000),
        ifMatch: z.string().max(300).optional(),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(100 * 1024 * 1024)
          .default(10 * 1024 * 1024),
      })
      .strict(),
    outputSchema: z.object({ artifact, etag: z.string().optional() }).strict(),
  },
  {
    ...base,
    id: 'aws.s3.list',
    integration: 'aws-s3',
    resource: 'object',
    action: 'list',
    title: 'List S3 objects',
    description: 'List a bounded page of object metadata using temporary AWS credentials.',
    connectionProviders: ['aws-sts'],
    pagination: 'cursor',
    dependencies: ['aws-sts-resolver', 's3-client'],
    inputSchema: z.object({ ...bucketFields, ...listFields }).strict(),
    outputSchema: objects,
  },
  {
    ...base,
    id: 'aws.s3.read',
    integration: 'aws-s3',
    resource: 'object',
    action: 'read',
    title: 'Read S3 object',
    description: 'Read an S3 object into an immutable private artifact using temporary AWS credentials.',
    connectionProviders: ['aws-sts'],
    dependencies: ['aws-sts-resolver', 's3-client', 'private-artifact-store'],
    inputSchema: z
      .object({
        ...bucketFields,
        key: z.string().min(1).max(2000),
        versionId: z.string().max(1000).optional(),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(100 * 1024 * 1024)
          .default(10 * 1024 * 1024),
      })
      .strict(),
    outputSchema: z.object({ artifact, etag: z.string().optional(), versionId: z.string().optional() }).strict(),
  },
];
const byKey = new Map(integrationOperations.map((operation) => [operationKey(operation), operation]));
export function integrationOperation(id: string, version: number): IntegrationOperation {
  const operation = byKey.get(`${id}@${version}`);
  if (!operation) throw new Error(`Unknown integration operation: ${id}@${version}`);
  return operation;
}
export const integrationCatalog = () => integrationOperations.map(publicOperation);
