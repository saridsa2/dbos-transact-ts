import { z } from 'zod';
import { id } from '../knowledge/contracts';
export const agentResourceSchema = z
  .object({ id, name: z.string().min(1).max(300), kind: z.enum(['ontology', 'process', 'source', 'workflow']) })
  .strict();
export type AgentResource = z.infer<typeof agentResourceSchema>;
export function agentResourceHref(ref: AgentResource) {
  return `${ref.kind === 'workflow' ? '/flows' : ref.kind === 'ontology' ? '/ontology' : ref.kind === 'source' ? '/sources' : ref.kind === 'process' ? '/processes' : '/knowledge'}?${ref.kind === 'workflow' ? 'flow' : 'id'}=${encodeURIComponent(ref.id)}`;
}
/** References come from recorded, authorized tool results, never model-written URLs or guessed IDs. */
export function collectAgentResources(calls: readonly { name: string; result: unknown }[]): AgentResource[] {
  const found = new Map<string, AgentResource>();
  const add = (value: unknown, kind?: string) => {
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    const parsed = agentResourceSchema.safeParse({ id: v.id, name: v.name, kind: kind ?? v.kind });
    if (parsed.success) found.set(`${parsed.data.kind}:${parsed.data.id}`, parsed.data);
  };
  for (const call of calls) {
    if (!call.result || typeof call.result !== 'object') continue;
    const result = call.result as Record<string, unknown>;
    if (call.name === 'workspace_describe_v1') {
      if (Array.isArray(result.knowledge)) result.knowledge.forEach((v) => add(v));
      if (Array.isArray(result.workflows)) result.workflows.forEach((v) => add(v, 'workflow'));
    } else if (call.name === 'artifact_read_v1') add(result.artifact);
  }
  return [...found.values()].slice(0, 500);
}
