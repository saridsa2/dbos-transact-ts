import { z } from 'zod';
import { parameterSchema, codeSchema } from '../authoring/model';
import { declarationSchema, portSchema, mergeSchema } from '../authoring/contracts';
import { compileAuthoringGraph } from '../authoring/compiler';
import type { AgentFlow } from './types';
import { nativeKinds, operationSchema, queueSchema, nodeBindings } from '../native/model';

const text = z.string().max(100000);
const config = z
  .object({
    ports: z.object({ input: portSchema.optional(), output: portSchema.optional() }).optional(),
    merge: mergeSchema.optional(),
    parameters: z.record(z.string(), parameterSchema).optional(),
    code: codeSchema.optional(),
    prompt: text.optional(),
    expression: text.optional(),
    approvalMessage: text.optional(),
    toolId: text.optional(),
    toolName: text.optional(),
    model: text.optional(),
    modelProfileId: text.optional(),
    outputKey: text.optional(),
    inputFromNodeId: text.optional(),
    conditionMode: z.enum(['legacy', 'model']).optional(),
    execution: z
      .object({
        maxAttempts: z.number().int().min(1).max(20).optional(),
        timeoutMS: z.number().positive().max(3600000).optional(),
        intervalSeconds: z.number().positive().max(3600).optional(),
      })
      .optional(),
  })
  .passthrough();

export const flowSchema = z.object({
  editVersion: z.number().int().positive().optional(),
  authoringVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  declarations: z.array(declarationSchema).max(100).optional(),
  captures: z
    .array(declarationSchema.omit({ initial: true, writable: true }))
    .max(100)
    .optional(),
  variables: z.record(z.string(), parameterSchema).optional(),
  schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  definitions: z.record(z.string(), z.unknown()).optional(),
  queues: z.array(queueSchema).max(50).optional(),
  schedule: z.object({ enabled: z.boolean(), cron: z.string().min(1), timezone: z.string().optional() }).optional(),
  defaultInput: z
    .object({ userInput: z.string().optional(), variables: z.record(z.string(), z.json()).optional() })
    .optional(),
  sourceReference: z.string().optional(),
  generationManifestId: z.string().max(128).optional(),
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  description: text.optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        kind: z.enum([
          'trigger',
          'prompt',
          'llm',
          'tool',
          'condition',
          'approval',
          'output',
          'code',
          'setVariables',
          'construct',
          'merge',
          ...nativeKinds,
        ]),
        name: z.string().min(1).max(200),
        description: text.optional(),
        config,
        position: z.object({ x: z.number().finite(), y: z.number().finite() }),
      }),
    )
    .max(50),
  edges: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        source: text,
        target: text,
        sourcePort: z.literal('value').optional(),
        targetPort: z.literal('input').optional(),
        sourceHandle: z.enum(['top', 'right', 'bottom', 'left']).optional(),
        targetHandle: z.enum(['top', 'right', 'bottom', 'left']).optional(),
        label: text.optional(),
        condition: z.enum(['true', 'false', 'always', 'success', 'error', 'timeout']).optional(),
      }),
    )
    .max(500),
  createdAt: text.optional(),
  updatedAt: text.optional(),
});

export function parseFlow(value: unknown): AgentFlow {
  const flow = flowSchema.parse(value) as AgentFlow;
  for (const node of flow.nodes) {
    if (flow.schemaVersion === 2) {
      if (node.config.operationDraft !== undefined)
        throw new Error(`Node ${node.name}: fix the invalid operation JSON before saving.`);
      if (['code', 'setVariables', 'construct', 'merge'].includes(node.kind)) {
        if (!flow.authoringVersion) throw new Error('Code and variables nodes require Stack Proc authoring version 1.');
        if (node.kind === 'code') node.config.code = codeSchema.parse(node.config.code);
      } else if (node.kind !== 'trigger') {
        if (flow.authoringVersion === 2) {
          if (node.config.operation && node.config.operation.kind !== node.kind)
            throw new Error('Operation kind must match the node.');
          continue;
        }
        node.config.operation = operationSchema.parse(node.config.operation);
        if (node.kind !== node.config.operation.kind)
          throw new Error(`Node ${node.name}: kind and operation do not match.`);
      }
    } else if (nativeKinds.includes(node.kind as (typeof nativeKinds)[number]))
      throw new Error('Native nodes require schemaVersion 2.');
  }
  return flow;
}

export function validateFlow(flow: AgentFlow) {
  if (flow.authoringVersion && !flow._compiled) return validateFlow(compileAuthoringGraph(flow));
  parseFlow(flow);
  if (flow._compiled?.version === 2)
    for (const node of flow.nodes) if (node.kind !== 'trigger') operationSchema.parse(node.config.operation);
  if (!flow.nodes.length) throw new Error('Add at least one node before running.');
  const ids = new Set(flow.nodes.map((node) => node.id));
  if (ids.size !== flow.nodes.length) throw new Error('Every node must have a unique id.');
  if (new Set(flow.edges.map((edge) => edge.id)).size !== flow.edges.length)
    throw new Error('Every edge must have a unique id.');
  const incoming = new Map(flow.nodes.map((node) => [node.id, 0]));
  for (const edge of flow.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`Edge ${edge.id} references a missing node.`);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }
  // The inherited traversal executes a node once per run. Reject cycles rather
  // than silently treating a loop as a completed DAG.
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length) {
    const id = ready.shift()!;
    visited++;
    for (const edge of flow.edges.filter((edge) => edge.source === id)) {
      const count = incoming.get(edge.target)! - 1;
      incoming.set(edge.target, count);
      if (count === 0) ready.push(edge.target);
    }
  }
  if (visited !== flow.nodes.length) throw new Error('Cycles are not supported by this executor.');
  if (flow.schemaVersion === 2) {
    if (flow.nodes.filter((node) => node.kind === 'trigger').length !== 1)
      throw new Error('Native graphs need exactly one trigger.');
    const reachable = new Set<string>();
    const pending = [flow.nodes.find((node) => node.kind === 'trigger')!.id];
    while (pending.length) {
      const id = pending.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...flow.edges.filter((edge) => edge.source === id).map((edge) => edge.target));
    }
    if (reachable.size !== flow.nodes.length) throw new Error('Native nodes must be connected to the trigger.');
    const queueKeys = new Set(flow.queues?.map((queue) => queue.key));
    if (queueKeys.size !== (flow.queues?.length ?? 0)) throw new Error('Queue keys must be unique.');
    for (const node of flow.nodes) {
      const op = node.config.operation;
      if (!op) continue;
      if ('queueRef' in op && op.queueRef && !queueKeys.has(op.queueRef))
        throw new Error(`Node ${node.name}: unknown queue resource.`);
      for (const binding of nodeBindings(op))
        if (binding.source === 'node') {
          if (!ids.has(binding.nodeId))
            throw new Error(`Node ${node.name}: binding references missing node ${binding.nodeId}.`);
          const seen = new Set<string>();
          const queue = [binding.nodeId];
          while (queue.length) {
            const id = queue.shift()!;
            if (seen.has(id)) continue;
            seen.add(id);
            queue.push(...flow.edges.filter((edge) => edge.source === id).map((edge) => edge.target));
          }
          if (!seen.has(node.id) || binding.nodeId === node.id)
            throw new Error(`Node ${node.name}: bindings must reference upstream nodes.`);
        }
    }
  }
  for (const node of flow.nodes) {
    if (node.kind === 'trigger' && incomingEdges(flow, node.id))
      throw new Error('Triggers cannot have incoming edges.');
    if (node.config.inputFromNodeId && !ids.has(node.config.inputFromNodeId))
      throw new Error(`Unknown input source for ${node.name}.`);
  }
}
function incomingEdges(flow: AgentFlow, id: string) {
  return flow.edges.some((edge) => edge.target === id);
}
