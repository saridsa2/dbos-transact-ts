'use client';
import type React from 'react';
import { GitBranch, X, Hourglass, Check } from 'lucide-react';
import { SettingsIcon, Trash01 } from '@/components/fa-icons';
import { Button as UiButton } from '@/components/base/buttons/button';
import { Tooltip } from '@/components/base/tooltip/tooltip';
import { useLingui } from '@/lib/i18n';
import { Trans } from '@/components/i18n/trans';
import { elbowPath } from '@/lib/graph-editor/elbow-path';
import { ropePath } from '@/lib/flows/geometry';
import { cn } from '@/lib/utils';
import {
  canvasEdgeEndpoints,
  type CanvasNode,
  type CanvasEdge,
  type CanvasAction,
  type CanvasStatus,
  type Point,
  type HandleSide,
  type EdgeSource,
  type EdgeEndpoint,
} from '@/lib/graph-editor/contracts';
const msg = (message: string) => ({ id: message, message });
const truncate = (value: string, max: number) => (value.length > max ? value.slice(0, max - 1) + '…' : value);

export function EdgeLayer({
  connectionPreview,
  edges,
  nodes,
  onCycleEdgeHandles,
  onDeleteEdge,
  onSelectEdge,
  onStartEndpointReconnect,
  reconnectingEdgeId,
  selectedEdgeId,
  selectedNodeId,
  readOnly = false,
  routing = 'rope',
}: {
  connectionPreview: { source: Point; target: Point } | null;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  onCycleEdgeHandles: (edgeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onStartEndpointReconnect: (
    event: React.PointerEvent<HTMLButtonElement>,
    edgeId: string,
    endpoint: EdgeEndpoint,
  ) => void;
  reconnectingEdgeId: string | null;
  selectedEdgeId: string | null;
  selectedNodeId: string | null;
  readOnly?: boolean;
  routing?: 'rope' | 'elbow';
}) {
  const { _ } = useLingui();

  return (
    <>
      <svg aria-hidden="true" className="edge-layer">
        <defs>
          <marker
            id="agent42-arrow"
            markerHeight="8"
            markerUnits="userSpaceOnUse"
            markerWidth="8"
            orient="auto-start-reverse"
            refX="8"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
          <marker
            id="agent42-arrow-active"
            markerHeight="8"
            markerUnits="userSpaceOnUse"
            markerWidth="8"
            orient="auto-start-reverse"
            refX="8"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
          <marker
            id="agent42-arrow-true"
            markerHeight="8"
            markerUnits="userSpaceOnUse"
            markerWidth="8"
            orient="auto-start-reverse"
            refX="8"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
          <marker
            id="agent42-arrow-false"
            markerHeight="8"
            markerUnits="userSpaceOnUse"
            markerWidth="8"
            orient="auto-start-reverse"
            refX="8"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const source = nodes.find((node) => node.id === edge.source);
          const target = nodes.find((node) => node.id === edge.target);
          if (!source || !target) return null;
          const endpoints = canvasEdgeEndpoints(edge, source, target);
          const path =
            routing === 'elbow'
              ? elbowPath(
                  endpoints.source,
                  endpoints.target,
                  edge.sourceHandle ?? 'right',
                  edge.targetHandle ?? 'left',
                  nodes,
                )
              : ropePath(endpoints.source, endpoints.target);
          const branch = edge.branch ?? null;
          const active =
            selectedEdgeId === edge.id ||
            reconnectingEdgeId === edge.id ||
            selectedNodeId === source.id ||
            selectedNodeId === target.id;
          const baseMarker = active
            ? 'agent42-arrow-active'
            : branch
              ? `agent42-arrow-${branch.tone}`
              : 'agent42-arrow';
          return (
            <g
              className={cn('edge-group', active && 'highlighted')}
              data-board-edge="true"
              data-edge-id={edge.id}
              key={edge.id}
              onClick={(event) => {
                event.stopPropagation();
                onSelectEdge(edge.id);
              }}
            >
              <path className="edge-hit" d={path.d} vectorEffect="non-scaling-stroke" />
              <path
                className={cn('edge-base', branch && `is-${branch.tone}`)}
                d={path.d}
                markerEnd={`url(#${baseMarker})`}
                vectorEffect="non-scaling-stroke"
              />
              <path
                className={cn('edge-flow', active && 'is-visible')}
                d={path.d}
                markerEnd={active ? 'url(#agent42-arrow-active)' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
        {connectionPreview ? (
          <g className="connection-preview" data-diagram-connection-preview="true">
            <path
              className="connection-preview-base"
              d={
                (routing === 'elbow'
                  ? elbowPath(connectionPreview.source, connectionPreview.target)
                  : ropePath(connectionPreview.source, connectionPreview.target)
                ).d
              }
              markerEnd="url(#agent42-arrow-active)"
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="connection-preview-flow"
              d={
                (routing === 'elbow'
                  ? elbowPath(connectionPreview.source, connectionPreview.target)
                  : ropePath(connectionPreview.source, connectionPreview.target)
                ).d
              }
              markerEnd="url(#agent42-arrow-active)"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
      </svg>
      <div className="edge-ui-layer">
        {edges.map((edge) => {
          const source = nodes.find((node) => node.id === edge.source);
          const target = nodes.find((node) => node.id === edge.target);
          if (!source || !target) return null;
          const endpoints = canvasEdgeEndpoints(edge, source, target);
          const path =
            routing === 'elbow'
              ? elbowPath(
                  endpoints.source,
                  endpoints.target,
                  edge.sourceHandle ?? 'right',
                  edge.targetHandle ?? 'left',
                  nodes,
                )
              : ropePath(endpoints.source, endpoints.target);
          const branch = edge.branch ?? null;
          const active =
            selectedEdgeId === edge.id ||
            reconnectingEdgeId === edge.id ||
            selectedNodeId === source.id ||
            selectedNodeId === target.id;
          return (
            <div key={`${edge.id}-ui`}>
              <div
                className={cn('edge-ui', active && 'selected')}
                data-edge-id={edge.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge(edge.id);
                }}
                style={
                  {
                    '--edge-label-x': `${Math.round(path.labelX)}px`,
                    '--edge-label-y': `${Math.round(path.labelY - 28)}px`,
                  } as React.CSSProperties
                }
              >
                {branch ? <span className={cn('edge-branch-label', `is-${branch.tone}`)}>{branch.label}</span> : null}
                <div className="edge-label-toolbar" hidden={readOnly}>
                  <button
                    aria-label={_(msg('Reroute edge'))}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCycleEdgeHandles(edge.id);
                      onSelectEdge(edge.id);
                    }}
                    title={_(msg('Reroute edge'))}
                    type="button"
                  >
                    <GitBranch className="size-3" />
                  </button>
                  <button
                    aria-label={_(msg('Delete edge'))}
                    className="edge-delete-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteEdge(edge.id);
                    }}
                    title={_(msg('Delete edge'))}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
              <button
                aria-label={_(msg('Drag source connector'))}
                disabled={readOnly}
                hidden={readOnly}
                className={cn('edge-endpoint-grip source', active && 'selected')}
                data-board-nodrag="true"
                onPointerDown={(event) => onStartEndpointReconnect(event, edge.id, 'source')}
                style={
                  {
                    '--edge-grip-x': `${Math.round(endpoints.source.x)}px`,
                    '--edge-grip-y': `${Math.round(endpoints.source.y)}px`,
                  } as React.CSSProperties
                }
                title={_(msg('Drag source connector'))}
                type="button"
              />
              <button
                aria-label={_(msg('Drag target connector'))}
                disabled={readOnly}
                hidden={readOnly}
                className={cn('edge-endpoint-grip target', active && 'selected')}
                data-board-nodrag="true"
                onPointerDown={(event) => onStartEndpointReconnect(event, edge.id, 'target')}
                style={
                  {
                    '--edge-grip-x': `${Math.round(endpoints.target.x)}px`,
                    '--edge-grip-y': `${Math.round(endpoints.target.y)}px`,
                  } as React.CSSProperties
                }
                title={_(msg('Drag target connector'))}
                type="button"
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

export function BoardNode({
  actions,
  edgeSource,
  node,
  onDelete,
  onFinishEdge,
  onInvokeAction,
  onOpenInspector,
  onPointerDown,
  onSelect,
  onStartEdge,
  pulseNodeIds,
  selected,
  readOnly = false,
  status,
}: {
  actions: CanvasAction[];
  edgeSource: EdgeSource;
  node: CanvasNode;
  onDelete: () => void;
  onFinishEdge: (nodeId: string, handle?: HandleSide) => void;
  onInvokeAction: (id: string) => void;
  onOpenInspector: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>, nodeId: string) => void;
  onSelect: () => void;
  onStartEdge: (nodeId: string, handle?: HandleSide) => void;
  pulseNodeIds: Set<string>;
  selected: boolean;
  readOnly?: boolean;
  status: CanvasStatus;
}) {
  const { _ } = useLingui();
  const meta = node;
  const size = node.size;
  const isBrushSource = edgeSource?.nodeId === node.id;
  const isBrushConnected = pulseNodeIds.has(node.id);
  const Icon = node.icon;
  const chips = node.chips ?? [];

  return (
    <article
      className={cn('board-node', selected && 'selected')}
      tabIndex={0}
      aria-label={node.name}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter') {
          event.preventDefault();
          onOpenInspector();
        }
      }}
      data-board-node="true"
      data-diagram-edge-brush-connected={isBrushConnected ? 'true' : undefined}
      data-diagram-edge-brush-source={isBrushSource ? 'true' : undefined}
      data-node-id={node.id}
      data-node-kind={node.kind}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenInspector();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpenInspector();
      }}
      onPointerDown={(event) => onPointerDown(event, node.id)}
      style={
        {
          '--node-bg': meta.bg,
          '--node-color': meta.color,
          '--node-h': `${size.height}px`,
          '--node-w': `${size.width}px`,
          '--node-x': `${node.position.x}px`,
          '--node-y': `${node.position.y}px`,
        } as React.CSSProperties
      }
    >
      {status !== 'idle' ? (
        <div
          className="node-status-strip"
          data-result-state={status}
          data-agent-state={status === 'running' ? 'working' : status === 'waiting' ? 'waiting' : 'idle'}
        >
          {status === 'running' ? (
            <span className="node-agent-pulse" aria-hidden />
          ) : status === 'waiting' ? (
            <Hourglass className="size-3 text-amber-600" />
          ) : status === 'failed' ? (
            <X className="size-3" />
          ) : (
            <Check className="size-3" />
          )}
          <span>
            {status === 'running' ? (
              <Trans>Running</Trans>
            ) : status === 'waiting' ? (
              <Trans>Waiting</Trans>
            ) : status === 'failed' ? (
              <Trans>Failed</Trans>
            ) : status === 'skipped' ? (
              <Trans>Skipped</Trans>
            ) : (
              <Trans>Done</Trans>
            )}
          </span>
          {actions.length > 0
            ? actions.map((action) => (
                <button
                  className="node-action-chip"
                  data-board-nodrag="true"
                  key={action.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onInvokeAction(action.id);
                  }}
                  type="button"
                >
                  {_(action.labelKey)}
                </button>
              ))
            : null}
        </div>
      ) : null}
      <div className="node-icon">
        <Icon className="size-5" />
      </div>
      <div className="node-copy">
        <h3>{truncate(node.name, 28)}</h3>
        <p>{truncate(node.description || meta.description, 62)}</p>
        {chips.length > 0 && (
          <div className="node-config-chips">
            {chips.map((chip) => (
              <em key={chip}>{chip}</em>
            ))}
          </div>
        )}
        {node.readiness && <span className="node-needs-config">{node.readiness}</span>}
        {node.body}
      </div>
      {selected ? (
        <>
          <div className="selection-ring">
            {(['top', 'right', 'bottom', 'left'] as HandleSide[]).map((side) => (
              <button
                disabled={readOnly}
                aria-label={_(msg(`Connect handle ${side}`))}
                className={`board-side-handle ${side}`}
                data-board-handle="true"
                data-board-handle-id={side}
                data-board-handle-side={side}
                data-board-node-id={node.id}
                data-board-nodrag="true"
                data-connectable="true"
                data-diagram-edge-brush-source-handle={
                  isBrushSource && edgeSource?.handle === side ? 'true' : undefined
                }
                key={side}
                onClick={(event) => {
                  event.stopPropagation();
                  if (readOnly) return;
                  if (edgeSource && edgeSource.nodeId !== node.id) onFinishEdge(node.id, side);
                  else onStartEdge(node.id, side);
                }}
                type="button"
              />
            ))}
          </div>
          <div
            className="node-selection-toolbar"
            role="toolbar"
            aria-label={`Actions for ${node.name}`}
            data-board-nodrag="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <Tooltip title="Settings">
              <UiButton
                color="tertiary"
                iconLeading={SettingsIcon}
                aria-label="Node settings"
                onPress={onOpenInspector}
              />
            </Tooltip>
            <Tooltip title={readOnly ? 'Recorded workflows are read-only' : 'Delete node'}>
              <UiButton
                color="tertiary"
                iconLeading={Trash01}
                aria-label="Delete node"
                isDisabled={readOnly}
                onPress={onDelete}
              />
            </Tooltip>
          </div>
        </>
      ) : null}
    </article>
  );
}
