import { authoringDefinitions } from './definitions';
import { validateContracts, ports } from './contracts';
import type { AgentFlow, FlowNodeData } from '../flows/types';
import { compileParameter, parameterReferences, codeSchema, type CodeDefinition, type Parameter } from './model';
import { nodeBindings, type Binding, type NativeOperation } from '../native/model';
const bindingFields = new Set([
  'input',
  'value',
  'items',
  'initial',
  'handles',
  'workflowID',
  'durationMS',
  'instruction',
  'timeoutSeconds',
  'partition',
  'delaySeconds',
]);
export function compileAuthoringGraph(
  flow: AgentFlow,
  seal?: (code: CodeDefinition) => CodeDefinition,
  depth = 0,
): AgentFlow {
  if (flow.authoringVersion === 2 && !flow._compiled) return compileScoped(flow, seal, depth);
  if (flow.authoringVersion !== 1 || flow._compiled) return flow;
  if (depth > 12) throw new Error('Authoring graph nesting exceeds 12.');
  function upstream(id: string) {
    const seen = new Set([id]);
    const pending = [id];
    while (pending.length) {
      const target = pending.pop()!;
      for (const e of flow.edges)
        if (e.target === target && !seen.has(e.source)) {
          seen.add(e.source);
          pending.push(e.source);
        }
    }
    seen.delete(id);
    return seen;
  }
  function parameter(p: Parameter, node?: FlowNodeData) {
    for (const id of parameterReferences(p))
      if (!node || !upstream(node.id).has(id))
        throw new Error(`Node ${node?.name ?? 'variables'}: expression must reference an upstream node: ${id}.`);
    return compileParameter(p);
  }
  const nodes = flow.nodes.map((node) => {
    const params = node.config.parameters ?? {};
    if (node.kind === 'code' || node.config.code) {
      const definition = seal ? seal(codeSchema.parse(node.config.code)) : codeSchema.parse(node.config.code);
      return {
        ...node,
        kind: 'step' as const,
        config: {
          ...node.config,
          code: definition,
          operation: {
            kind: 'step' as const,
            handler: 'stackproc.code.v1',
            input: {
              source: 'object' as const,
              fields: {
                definition: { source: 'literal' as const, value: definition },
                input: parameter(params.input ?? { mode: 'fixed', value: {} }, node),
              },
            },
          },
        },
      };
    }
    if (node.kind === 'setVariables')
      return {
        ...node,
        kind: 'assign' as const,
        config: {
          ...node.config,
          variableAssignment: true,
          operation: {
            kind: 'assign' as const,
            value: parameter(params.values ?? { mode: 'object', fields: {} }, node),
          },
        },
      };
    if (!node.config.operation) return node;
    const op = structuredClone(node.config.operation) as unknown as Record<string, unknown>;
    const runtimeFields: Record<string, Binding> = {};
    for (const [key, p] of Object.entries(params)) {
      const b = parameter(p, node);
      if (bindingFields.has(key)) {
        if (!Object.hasOwn(op, key) && !['partition', 'delaySeconds'].includes(key))
          throw new Error(`Unknown parameter '${key}'.`);
        op[key] = b;
      } else if (
        key === 'predicate.left' ||
        key === 'predicate.right' ||
        key === 'while.left' ||
        key === 'while.right'
      ) {
        const [group, side] = key.split('.');
        if (!op[group]) throw new Error('Predicate not supported on this node.');
        (op[group] as Record<string, unknown>)[side] = b;
      } else if (/^branches\.\d+\.input$/.test(key) && Array.isArray(op.branches)) {
        const index = Number(key.split('.')[1]);
        if (!op.branches[index]) throw new Error('Unknown branch parameter.');
        (op.branches[index] as { input: Binding }).input = b;
      } else if (['topic', 'key'].includes(key) && Object.hasOwn(op, key)) {
        op[key] = 'runtime-value';
        runtimeFields[key] = b;
      } else throw new Error(`Node ${node.name}: '${key}' is a static execution setting, not a data parameter.`);
    }
    return { ...node, config: { ...node.config, runtimeFields, operation: op as unknown as NativeOperation } };
  });
  const variables = Object.fromEntries(Object.entries(flow.variables ?? {}).map(([key, p]) => [key, parameter(p)]));
  // Variable declarations may depend on workflow inputs, but not execution order or prior values.
  for (const b of Object.values(variables))
    for (const leaf of nodeBindings(b))
      if (
        leaf.source === 'expression' &&
        /\$(?:vars|nodes|item|state|execution|nodeInput|index)\b/.test(leaf.expression)
      )
        throw new Error('Initial variables may reference workflow input only.');
  return {
    ...flow,
    nodes,
    definitions: flow.definitions
      ? Object.fromEntries(
          Object.entries(flow.definitions).map(([k, v]) => [k, compileAuthoringGraph(v, seal, depth + 1)]),
        )
      : undefined,
    _compiled: { version: 1, variables },
  };
}

function compileScoped(
  flow: AgentFlow,
  seal: ((code: CodeDefinition) => CodeDefinition) | undefined,
  depth: number,
): AgentFlow {
  validateContracts(flow);
  const nodes = flow.nodes.map((node) => {
    const authoredKind = node.kind;
    const offering = authoringDefinitions[authoredKind];
    if (
      node.config.offering &&
      offering &&
      (node.config.offering.id !== offering.id || node.config.offering.version !== offering.version)
    )
      throw new Error(`Node ${node.name}: unsupported offering version.`);
    const {
      compiledUpdates: _updates,
      variableAssignment: _assignment,
      runtimeFields: _fields,
      authoredKind: _kind,
      ...clean
    } = node.config;
    node = {
      ...node,
      config: {
        ...clean,
        ports: ports(node),
        ...(offering ? { offering: { id: offering.id, version: offering.version } } : {}),
      },
    };
    if (node.config.code)
      node = {
        ...node,
        config: {
          ...node.config,
          code: {
            ...node.config.code,
            inputSchema: node.config.ports?.input?.schema ?? {},
            outputSchema: node.config.ports?.output?.schema ?? {},
          },
        },
      };
    if (node.kind === 'construct' || node.kind === 'merge')
      return {
        ...node,
        kind: 'assign' as const,
        config: {
          ...node.config,
          authoredKind,
          operation: { kind: 'assign' as const, value: { source: 'literal' as const, value: null } },
        },
      };
    return { ...node, config: { ...node.config, authoredKind } };
  });
  const normalized: AgentFlow = {
    ...flow,
    authoringVersion: 1,
    variables: Object.fromEntries((flow.declarations ?? []).map((d) => [d.id, d.initial])),
    nodes,
  };
  const compiled = compileAuthoringGraph(normalized, seal, depth);
  for (const node of compiled.nodes) {
    if (node.config.authoredKind === 'merge') {
      const ids = new Set<string>();
      node.config.compiledUpdates = Object.fromEntries(
        (node.config.merge?.updates ?? []).map((update) => {
          if (ids.has(update.variableId)) throw new Error('Duplicate variable update target.');
          ids.add(update.variableId);
          for (const ref of parameterReferences(update.value)) {
            const upstream = new Set<string>();
            const pending = [node.id];
            while (pending.length) {
              const id = pending.pop()!;
              for (const e of flow.edges)
                if (e.target === id && !upstream.has(e.source)) {
                  upstream.add(e.source);
                  pending.push(e.source);
                }
            }
            if (!upstream.has(ref)) throw new Error(`Merge ${node.name}: reference ${ref} is not upstream.`);
          }
          return [update.variableId, compileParameter(update.value)];
        }),
      );
    }
  }
  return { ...compiled, authoringVersion: 2, _compiled: { version: 2, variables: compiled._compiled!.variables } };
}
