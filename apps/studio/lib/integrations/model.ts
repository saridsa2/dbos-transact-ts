import { z } from 'zod';
import { bindingSchema, type Binding, type NativeOperation } from '../native/model';
import type { Connection, Provider } from '../control/contracts';

export type IntegrationOperation = {
  id: string;
  version: number;
  integration: string;
  resource: string;
  action: string;
  title: string;
  description: string;
  connectionProviders: readonly Provider[];
  boundary: 'step' | 'transaction';
  effect: 'read' | 'conditional';
  pagination: 'none' | 'cursor';
  dependencies: readonly string[];
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  implementation: 'defined';
  limits: { maxTimeoutMS: number; maxAttempts: number; maxResultBytes: number };
};
export const integrationNodeSchema = z
  .object({
    operation: z.object({ id: z.string().min(1).max(200), version: z.number().int().positive() }).strict(),
    connection: z.object({ id: z.string().min(1).max(128), revision: z.number().int().positive() }).strict(),
    parameters: bindingSchema,
    policy: z
      .object({
        timeoutMS: z.number().int().min(100).max(300000).default(30000),
        maxAttempts: z.number().int().min(1).max(5).default(1),
        idempotencyKey: z.string().min(1).max(200).optional(),
      })
      .strict()
      .default({ timeoutMS: 30000, maxAttempts: 1 }),
  })
  .strict();
export type IntegrationNode = z.infer<typeof integrationNodeSchema>;
export const operationKey = (operation: { id: string; version: number }) => `${operation.id}@${operation.version}`;

export function publicOperation(operation: IntegrationOperation) {
  const { inputSchema, outputSchema, ...descriptor } = operation;
  return {
    ...descriptor,
    inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
    outputSchema: z.toJSONSchema(outputSchema),
  };
}
/** Adapter installation is server-owned; a saved connection does not install code. */
export function compileIntegrationStep(
  node: IntegrationNode,
  operation: IntegrationOperation,
  installedAdapters: ReadonlySet<string>,
): NativeOperation {
  const checked = integrationNodeSchema.parse(node);
  if (operationKey(checked.operation) !== operationKey(operation))
    throw new Error('Integration operation version mismatch.');
  if (!installedAdapters.has(operationKey(operation)))
    throw new Error(`Integration adapter not installed: ${operationKey(operation)}`);
  return {
    kind: operation.boundary,
    handler: 'integration.dispatch.v1',
    input: {
      source: 'object',
      fields: {
        operation: { source: 'literal', value: checked.operation },
        connection: { source: 'literal', value: checked.connection },
        parameters: checked.parameters as Binding,
        policy: { source: 'literal', value: checked.policy },
      },
    },
  };
}
/** Both a canvas invocation and an agent tool must pass this gate after binding inputs. */
export function validateIntegrationCall(
  operation: IntegrationOperation,
  node: IntegrationNode,
  connection: Connection,
  context: { workspaceId: string; installedAdapters: ReadonlySet<string>; idempotencySupported?: boolean },
  resolvedParameters: unknown,
) {
  const checked = integrationNodeSchema.parse(node);
  if (operationKey(checked.operation) !== operationKey(operation))
    throw new Error('Integration operation version mismatch.');
  if (connection.workspaceId !== context.workspaceId || connection.id !== checked.connection.id)
    throw new Error('Integration connection is unavailable in this workspace.');
  if (connection.status !== 'configured') throw new Error('Integration connection is revoked.');
  if (connection.revision !== checked.connection.revision)
    throw new Error('Integration connection revision changed; reselect the connection.');
  if (!operation.connectionProviders.includes(connection.provider))
    throw new Error('Connection provider is incompatible with this operation.');
  if (!context.installedAdapters.has(operationKey(operation)))
    throw new Error(`Integration adapter not installed: ${operationKey(operation)}`);
  const parameters = operation.inputSchema.parse(resolvedParameters);
  const method = operation.id === 'http.request' ? String((parameters as { method: string }).method) : undefined;
  const safeRead = operation.effect === 'read' || (method !== undefined && ['GET', 'HEAD'].includes(method));
  if (checked.policy.maxAttempts > 1 && !safeRead && (!checked.policy.idempotencyKey || !context.idempotencySupported))
    throw new Error('Retries for side-effecting operations require an idempotency key and verified adapter support.');
  return { operation: checked.operation, connection: checked.connection, parameters, policy: checked.policy };
}
export function integrationToolDefinition(operation: IntegrationOperation) {
  return {
    name: `${operation.id.replaceAll('.', '_')}_v${operation.version}`,
    description: operation.description,
    inputSchema: z.toJSONSchema(operation.inputSchema, { io: 'input' }),
    outputSchema: z.toJSONSchema(operation.outputSchema),
  };
}
