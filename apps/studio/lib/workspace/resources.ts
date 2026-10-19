export type WorkspaceModelProfile = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  apiKeyRef?: string | null;
  baseUrl?: string | null;
  isDefault: boolean;
  status: 'active' | 'disabled' | 'archived';
  temperature?: number | null;
  maxTokens?: number | null;
};

/**
 * For `kind: "http"` tools, `metadata` carries the HTTP call template read
 * by lib/flows/http-tool.ts: `method` (defaults to GET), `path` appended to
 * `baseUrl`, optional static `headers`, and `apiKeyRef` (an env var name,
 * only honored when it's in the shared ALLOWED_API_KEY_REFS allowlist).
 */
export type WorkspaceToolProfile = {
  id: string;
  name: string;
  kind: string;
  description?: string | null;
  authType: string;
  baseUrl?: string | null;
  status: 'active' | 'disabled' | 'archived';
  inputSchema?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type WorkspaceResourceConfig = {
  models: WorkspaceModelProfile[];
  tools: WorkspaceToolProfile[];
};

export function projectConnectorToolMetadata(record: {
  capabilityId?: string | null;
  kind: string;
  metadata?: unknown;
}): Record<string, unknown> | null {
  if (
    record.kind !== 'connector' ||
    !record.capabilityId ||
    !record.metadata ||
    typeof record.metadata !== 'object' ||
    Array.isArray(record.metadata)
  ) {
    return null;
  }
  const metadata = record.metadata as Record<string, unknown>;
  if (
    typeof metadata.connectionId !== 'string' ||
    typeof metadata.resource !== 'string' ||
    typeof metadata.operation !== 'string' ||
    (metadata.risk !== 'read' && metadata.risk !== 'write') ||
    typeof metadata.schemaVersion !== 'string'
  ) {
    return null;
  }
  return {
    capabilityId: record.capabilityId,
    connectionId: metadata.connectionId,
    ...(typeof metadata.connectorKey === 'string' ? { connectorKey: metadata.connectorKey } : {}),
    ...(typeof metadata.connectorVersion === 'string' ? { connectorVersion: metadata.connectorVersion } : {}),
    ...(typeof metadata.environment === 'string' ? { environment: metadata.environment } : {}),
    resource: metadata.resource,
    operation: metadata.operation,
    ...(typeof metadata.mode === 'string' ? { mode: metadata.mode } : {}),
    risk: metadata.risk,
    schemaVersion: metadata.schemaVersion,
  };
}

export const fallbackWorkspaceResources: WorkspaceResourceConfig = {
  models: [],
  tools: [{ id: 'echo', name: 'Echo input', kind: 'registered', authType: 'server', status: 'active' }],
};
