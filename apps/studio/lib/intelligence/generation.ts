import { normalizeProcessLanes } from '../processes/lanes';
import { assertCapturedProcessWorkflows, projectProcess } from '../processes/projection';
import { processGraphIssues } from '../processes/model';
import { linearProcess } from '../processes/model';
import { processDocumentSchema } from '../knowledge/process';
import type { AgentFlow } from '../flows/types';
import { parseFlow, validateFlow } from '../flows/validation';
import { compileAuthoringGraph } from '../authoring/compiler';
import { processSchema, validateProcess } from '../knowledge/process';
import { contentHash, type ArtifactRef } from '../knowledge/contracts';
export async function generateWorkflow(
  name: string,
  value: unknown,
  processRef: ArtifactRef,
): Promise<{ flow: AgentFlow; manifest: Record<string, unknown> }> {
  const parsedSource = processDocumentSchema.parse(value);
  const source = parsedSource.schemaVersion === 2 ? normalizeProcessLanes(parsedSource) : parsedSource;
  if (
    source.schemaVersion === 2 &&
    (Boolean(source.lanes?.length) ||
      source.graph.elements.some(
        (n) =>
          n.kind === 'decision' ||
          n.kind === 'merge' ||
          (n.kind === 'activity' && ['operation', 'agent'].includes(n.binding.kind)),
      ))
  ) {
    const issues = processGraphIssues(source);
    if (issues.length) throw new Error(issues.map((i) => i.message).join(' '));
    assertCapturedProcessWorkflows(source);
    const flow = parseFlow(projectProcess(source, name, crypto.randomUUID()));
    validateFlow(compileAuthoringGraph(flow));
    return {
      flow,
      manifest: {
        schemaVersion: 2,
        generator: 'visual-structured-process@3',
        process: processRef,
        ontologyRefs: source.ontologyRefs,
        graphHash: await contentHash(flow),
        lanes: source.lanes ?? [],
        entry: { processElementId: source.graph.elements.find((n) => n.kind === 'start')!.id, nodeId: 'trigger' },
        elements: source.graph.elements.map((n) => ({
          processElementId: n.id,
          nodeId: n.kind === 'start' ? 'trigger' : n.id,
          nodeIds: [n.kind === 'start' ? 'trigger' : n.id],
          evidence: n.evidence,
          ...(n.laneId ? { laneId: n.laneId } : {}),
          ...(n.kind === 'activity' && n.binding.kind === 'agent' ? { agent: n.binding.definition } : {}),
          ...(n.kind === 'activity' && n.binding.kind === 'operation' ? { binding: n.binding.operation } : {}),
        })),
      },
    };
  }
  const process = source.schemaVersion === 2 ? linearProcess(source) : processSchema.parse(value),
    issues = validateProcess(process);
  if (issues.length) throw new Error(issues.map((i) => i.message).join(' '));
  const flow: AgentFlow = {
    id: crypto.randomUUID(),
    name,
    schemaVersion: 2,
    authoringVersion: 2,
    declarations: [],
    description: process.purpose,
    defaultInput: { variables: process.defaultInput },
    nodes: [
      {
        id: 'trigger',
        kind: 'trigger',
        name: 'Start',
        position: { x: 0, y: 0 },
        config: {
          ports: {
            output: {
              id: 'value',
              schema: { type: 'object', properties: { variables: process.inputSchema }, required: ['variables'] },
              cardinality: 'single',
              required: true,
            },
          },
        },
      },
      ...process.steps.map((step, i) => ({
        id: step.id,
        name: step.name,
        kind: step.kind === 'return' ? ('return' as const) : ('construct' as const),
        position: { x: (i + 1) * 360, y: 0 },
        config:
          step.kind === 'requirement'
            ? {}
            : step.kind === 'return'
              ? {
                  operation: { kind: 'return' as const, value: { source: 'literal' as const, value: null } },
                  parameters: { value: step.value },
                }
              : { parameters: { value: step.value } },
      })),
    ],
    edges: [],
  };
  flow.edges = flow.nodes
    .slice(1)
    .map((n, i) => ({ id: `edge-${n.id}`, source: flow.nodes[i].id, target: n.id, condition: 'always' }));
  const parsed = parseFlow(flow);
  validateFlow(compileAuthoringGraph(parsed));
  return {
    flow: parsed,
    manifest: {
      schemaVersion: 1,
      generator: source.schemaVersion === 2 ? 'visual-linear-process@2' : 'linear-process@1',
      process: processRef,
      ontologyRefs: process.ontologyRefs,
      graphHash: await contentHash(parsed),
      ...(source.schemaVersion === 2
        ? { entry: { processElementId: source.graph.elements.find((n) => n.kind === 'start')!.id, nodeId: 'trigger' } }
        : {}),
      elements: process.steps.map((s) => ({ processElementId: s.id, nodeId: s.id, evidence: s.evidence })),
    },
  };
}
