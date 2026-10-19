'use client';

import { AlertTriangle, Cable, LockKeyhole } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FlowNodeConfig } from '@/lib/flows/types';
import type { WorkspaceToolProfile } from '@/lib/workspace/resources';

export type ConnectorConnectionOption = {
  id: string;
  name: string;
  connectorKey: string;
  connectorVersion: string;
  environment: string;
  status: string;
};

type ConnectorMetadata = {
  capabilityId: string;
  connectionId: string;
  resource: string;
  operation: string;
  risk: 'read' | 'write';
  schemaVersion: string;
};

export type PrimitiveSchemaField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  enumValues?: string[];
};

function metadataFor(tool: WorkspaceToolProfile): ConnectorMetadata | null {
  const metadata = tool.metadata;
  if (
    tool.kind !== 'connector' ||
    tool.status !== 'active' ||
    !metadata ||
    typeof metadata.capabilityId !== 'string' ||
    typeof metadata.connectionId !== 'string' ||
    typeof metadata.resource !== 'string' ||
    typeof metadata.operation !== 'string' ||
    (metadata.risk !== 'read' && metadata.risk !== 'write') ||
    typeof metadata.schemaVersion !== 'string'
  ) {
    return null;
  }
  return metadata as ConnectorMetadata;
}

export function connectorTools(tools: WorkspaceToolProfile[]) {
  return tools.filter((tool) => metadataFor(tool) !== null);
}

export function schemaFields(schema: Record<string, unknown> | null | undefined): PrimitiveSchemaField[] {
  if (!schema || schema.type !== 'object') {
    return [];
  }
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [],
  );
  return Object.entries(properties).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }
    const field = raw as Record<string, unknown>;
    const type =
      field.type === 'integer' || field.type === 'number'
        ? 'number'
        : field.type === 'boolean'
          ? 'boolean'
          : field.type === 'string'
            ? 'string'
            : null;
    if (!type) {
      return [];
    }
    const enumValues = Array.isArray(field.enum)
      ? field.enum.filter((item): item is string => typeof item === 'string')
      : undefined;
    return [
      {
        key,
        label: typeof field.title === 'string' ? field.title : key,
        type,
        required: required.has(key),
        ...(enumValues?.length ? { enumValues } : {}),
      },
    ];
  });
}

export function buildConnectorBinding(
  tool: WorkspaceToolProfile,
  connection: ConnectorConnectionOption,
): FlowNodeConfig {
  const metadata = metadataFor(tool);
  if (!metadata) {
    return {};
  }
  return {
    capabilityId: metadata.capabilityId,
    connectorConnectionId: metadata.connectionId,
    connectorKey: connection.connectorKey,
    connectorVersion: connection.connectorVersion,
    connectorResource: metadata.resource,
    connectorOperation: metadata.operation,
    connectorEnvironment: connection.environment,
    connectorRisk: metadata.risk,
    connectorSchemaVersion: metadata.schemaVersion,
    connectorInput: {},
    toolId: tool.id,
    toolName: tool.name,
  };
}

export function resetConnectorSelection(config: FlowNodeConfig, from: 'connection' | 'resource'): FlowNodeConfig {
  const operationKeys = new Set([
    'capabilityId',
    'connectorOperation',
    'connectorRisk',
    'connectorSchemaVersion',
    'connectorInput',
    'toolId',
    'toolName',
  ]);
  const connectionKeys = new Set([
    'connectorConnectionId',
    'connectorKey',
    'connectorVersion',
    'connectorEnvironment',
    'connectorResource',
  ]);
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !operationKeys.has(key) && (from !== 'connection' || !connectionKeys.has(key)),
    ),
  ) as FlowNodeConfig;
}

export function ConnectorOperationFields({
  connections: providedConnections,
  onChange,
  tools,
  value,
}: {
  connections?: ConnectorConnectionOption[];
  onChange: (value: FlowNodeConfig) => void;
  tools: WorkspaceToolProfile[];
  value: FlowNodeConfig;
}) {
  const [loadedConnections, setLoadedConnections] = useState<ConnectorConnectionOption[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const connections = providedConnections ?? loadedConnections;
  const importedTools = useMemo(() => connectorTools(tools), [tools]);

  useEffect(() => {
    if (providedConnections) {
      return;
    }
    let mounted = true;
    fetch('/api/connectors/connections', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Connections unavailable.');
        }
        return response.json();
      })
      .then((payload: ConnectorConnectionOption[]) => {
        if (mounted) {
          setLoadedConnections(payload);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoadFailed(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [providedConnections]);

  const connectionIds = new Set(
    importedTools.map((tool) => metadataFor(tool)?.connectionId).filter((id): id is string => Boolean(id)),
  );
  const availableConnections = connections.filter((item) => item.status === 'active' && connectionIds.has(item.id));
  const connection = availableConnections.find((item) => item.id === value.connectorConnectionId);
  const scopedTools = importedTools.filter((tool) => metadataFor(tool)?.connectionId === value.connectorConnectionId);
  const resources = [
    ...new Set(scopedTools.map((tool) => metadataFor(tool)?.resource).filter((item): item is string => Boolean(item))),
  ].sort();
  const operationTools = scopedTools.filter((tool) => metadataFor(tool)?.resource === value.connectorResource);
  const selectedTool = importedTools.find((tool) => metadataFor(tool)?.capabilityId === value.capabilityId);
  const selectedMetadata = selectedTool ? metadataFor(selectedTool) : null;
  const fields = schemaFields(selectedTool?.inputSchema);

  if (importedTools.length === 0) {
    return (
      <div className="full rounded-xl border border-slate-300 border-dashed bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <Cable className="mt-0.5 size-4 text-slate-500" />
          <div>
            <p className="font-medium text-slate-700 text-sm">No imported connector operations</p>
            <p className="mt-1 text-slate-500 text-xs">
              Discover and import a capability from Connections before binding it to this node.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <fieldset className="config-group full">
      <legend className="flex items-center gap-2">
        <LockKeyhole className="size-4 text-sky-700" />
        Governed connector operation
      </legend>
      <div className="mt-3 grid gap-3">
        <label className="config-input full">
          <span>Connection</span>
          <select
            onChange={(event) =>
              onChange({
                ...resetConnectorSelection(value, 'connection'),
                connectorConnectionId: event.target.value || undefined,
              })
            }
            value={value.connectorConnectionId ?? ''}
          >
            <option value="">Select connection</option>
            {availableConnections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.environment}
              </option>
            ))}
          </select>
        </label>
        <label className="config-input full">
          <span>Resource</span>
          <select
            disabled={!value.connectorConnectionId}
            onChange={(event) =>
              onChange({
                ...resetConnectorSelection(value, 'resource'),
                connectorResource: event.target.value || undefined,
              })
            }
            value={value.connectorResource ?? ''}
          >
            <option value="">Select resource</option>
            {resources.map((resource) => (
              <option key={resource} value={resource}>
                {resource}
              </option>
            ))}
          </select>
        </label>
        <label className="config-input full">
          <span>Operation</span>
          <select
            disabled={!value.connectorResource}
            onChange={(event) => {
              const tool = operationTools.find((item) => metadataFor(item)?.capabilityId === event.target.value);
              onChange(
                tool && connection
                  ? { ...value, ...buildConnectorBinding(tool, connection) }
                  : resetConnectorSelection(value, 'resource'),
              );
            }}
            value={value.capabilityId ?? ''}
          >
            <option value="">Select imported operation</option>
            {operationTools.map((tool) => {
              const metadata = metadataFor(tool);
              return (
                <option key={metadata?.capabilityId ?? tool.id} value={metadata?.capabilityId}>
                  {metadata?.operation}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {selectedMetadata && connection ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-600">
            {connection.connectorKey} v{connection.connectorVersion}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-600">
            {connection.environment}
          </span>
          <span
            className={
              selectedMetadata.risk === 'write'
                ? 'rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-[10px] text-amber-800'
                : 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-medium text-[10px] text-emerald-700'
            }
          >
            {selectedMetadata.risk === 'write' ? 'Write' : 'Read'}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-600">
            Schema {selectedMetadata.schemaVersion}
          </span>
        </div>
      ) : null}
      {selectedMetadata?.risk === 'write' ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-medium text-amber-800 text-xs">
          <AlertTriangle className="size-4" />
          Direct signed approval required.
        </p>
      ) : null}

      {fields.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {fields.map((field) => {
            const input = value.connectorInput ?? {};
            if (field.type === 'boolean') {
              return (
                <label className="flex items-center gap-2 text-slate-700 text-xs" key={field.key}>
                  <input
                    checked={input[field.key] === true}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        connectorInput: {
                          ...input,
                          [field.key]: event.target.checked,
                        },
                      })
                    }
                    type="checkbox"
                  />
                  {field.label}
                </label>
              );
            }
            return (
              <label className="config-input" htmlFor={`connector-input-${field.key}`} key={field.key}>
                <span>
                  {field.label}
                  {field.required ? ' *' : ''}
                </span>
                {field.enumValues ? (
                  <select
                    id={`connector-input-${field.key}`}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        connectorInput: {
                          ...input,
                          [field.key]: event.target.value,
                        },
                      })
                    }
                    value={String(input[field.key] ?? '')}
                  >
                    <option value="">Select</option>
                    {field.enumValues.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`connector-input-${field.key}`}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        connectorInput: {
                          ...input,
                          [field.key]: field.type === 'number' ? event.target.valueAsNumber : event.target.value,
                        },
                      })
                    }
                    required={field.required}
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={String(input[field.key] ?? '')}
                  />
                )}
              </label>
            );
          })}
        </div>
      ) : null}
      {loadFailed ? <p className="mt-3 text-rose-600 text-xs">Connection metadata could not be loaded.</p> : null}
    </fieldset>
  );
}
