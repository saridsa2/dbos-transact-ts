import type { AgentFlow, FlowNodeData } from '../flows/types';
import { defaultCode } from './model';
const fixed = (value: unknown) => ({ mode: 'fixed' as const, value });
const expression = (expression: string) => ({ mode: 'expression' as const, expression });
function graph(id: string, name: string, steps: FlowNodeData[]): AgentFlow {
  const nodes: FlowNodeData[] = [
    { id: 'start', name: 'Start', kind: 'trigger', config: {}, position: { x: -600, y: 0 } },
    ...steps,
  ];
  nodes.forEach((n, i) => (n.position = { x: -600 + i * 380, y: 0 }));
  return {
    id,
    name,
    schemaVersion: 2,
    authoringVersion: 2,
    declarations: [],
    nodes,
    edges: nodes.slice(1).map((n, i) => ({
      id: `edge-${i}`,
      source: nodes[i].id,
      target: n.id,
      sourcePort: 'value',
      targetPort: 'input',
    })),
  };
}
const node = (id: string, name: string, kind: FlowNodeData['kind'], config: FlowNodeData['config']): FlowNodeData => ({
  id,
  name,
  kind,
  config,
  position: { x: 0, y: 0 },
});
const end = (source: string) =>
  node('result', 'Return result', 'return', {
    operation: { kind: 'return', value: { source: 'expression', expression: source } },
  });
const code = (source: string) => ({
  ...defaultCode(),
  profile: 'pure-transform@1' as const,
  language: 'typescript' as const,
  source,
});
export function scopedExamples() {
  const calculation = graph('scoped-calculation', 'Typed variables and code', [
    node('prepare', 'Set factor in this scope', 'setVariables', {
      parameters: { values: { mode: 'object', fields: { factor: expression('$input.variables.factor') } } },
    }),
    node('construct', 'Construct calculation input', 'construct', {
      parameters: {
        value: {
          mode: 'object',
          fields: {
            items: expression('$input.variables.items'),
            metadata: {
              mode: 'object',
              fields: {
                label: fixed('Local calculation'),
                tags: { mode: 'array', items: [fixed('typed'), fixed('scoped')] },
              },
            },
          },
        },
      },
    }),
    node('calculate', 'Transform numbers', 'code', {
      code: code(
        'const items: number[] = input.items;\nconsole.log("Transforming", items.length, "items");\nreturn items.map(value => value * variables.factor);',
      ),
      parameters: { input: expression('$nodes["construct"]') },
      ports: {
        input: {
          id: 'input',
          schema: {
            type: 'object',
            required: ['items'],
            properties: { items: { type: 'array', items: { type: 'number' } } },
          },
          required: true,
          cardinality: 'single',
        },
        output: {
          id: 'value',
          schema: { type: 'array', items: { type: 'number' } },
          required: true,
          cardinality: 'collection',
        },
      },
    }),
    end('sum($nodes["calculate"])'),
  ]);
  calculation.declarations = [
    { id: 'factor', name: 'Multiplier', schema: { type: 'number' }, initial: fixed(1), writable: true },
  ];
  calculation.defaultInput = { variables: { items: [1, 2, 3], factor: 3 } };
  const documentBody = graph('document-body', 'Normalize one document', [
    node('normalize', 'Normalize current document', 'code', {
      code: code('return {id: input.id, title: input.title.toUpperCase(), index: variables.batchLabel};'),
      parameters: { input: expression('$item') },
    }),
    end('$nodes["normalize"]'),
  ]);
  const documents = graph('scoped-documents', 'Explicit document iteration', [
    node('documents', 'Process each document', 'foreach', {
      operation: {
        kind: 'foreach',
        workflowRef: 'document-body',
        items: { source: 'input', path: 'variables.documents' },
        mode: 'parallel',
        maxItems: 100,
        concurrency: 2,
      },
    }),
    end('$nodes["documents"]'),
  ]);
  documents.declarations = [
    {
      id: 'batchLabel',
      name: 'Batch label',
      schema: { type: 'string' },
      initial: fixed('Review batch'),
      writable: false,
    },
  ];
  documents.definitions = { 'document-body': documentBody };
  documents.defaultInput = {
    variables: {
      documents: [
        { id: 'a', title: 'Guide' },
        { id: 'b', title: 'FAQ' },
        { id: 'c', title: 'Notes' },
      ],
    },
  };
  const customer = graph('customer-child', 'Customer branch', [
    node('customer', 'Construct customer result', 'construct', {
      parameters: { value: { mode: 'object', fields: { accountId: fixed('A-9') } } },
    }),
    end('$nodes["customer"]'),
  ]);
  const inventory = graph('inventory-child', 'Inventory branch', [
    node('inventory', 'Construct inventory result', 'construct', {
      parameters: { value: { mode: 'object', fields: { available: fixed(true) } } },
    }),
    end('$nodes["inventory"]'),
  ]);
  const parallel = graph('scoped-parallel', 'Parallel results and explicit merge', [
    node('enrich', 'Enrich in isolated branches', 'parallel', {
      operation: {
        kind: 'parallel',
        branches: [
          { id: 'customer', workflowRef: 'customer-child', input: { source: 'literal', value: {} } },
          { id: 'inventory', workflowRef: 'inventory-child', input: { source: 'literal', value: {} } },
        ],
      },
    }),
    node('merge', 'Merge exported branch results', 'merge', {
      parameters: {
        value: {
          mode: 'object',
          fields: {
            accountId: expression('$nodes["enrich"].customer.accountId'),
            available: expression('$nodes["enrich"].inventory.available'),
          },
        },
      },
      merge: { updates: [{ variableId: 'accountId', value: expression('$nodes["enrich"].customer.accountId') }] },
    }),
    end('$nodes["merge"]'),
  ]);
  parallel.declarations = [
    { id: 'accountId', name: 'Account ID', schema: { type: ['string', 'null'] }, initial: fixed(null), writable: true },
  ];
  parallel.definitions = { 'customer-child': customer, 'inventory-child': inventory };
  parallel.defaultInput = { variables: {} };
  return [
    {
      id: 'typed-scope-code',
      title: calculation.name,
      description: 'Typed declarations, nested mapping and isolated code. Returns 18. One invocation per node.',
      source: 'Stack Proc · scoped authoring v2',
      flow: calculation,
    },
    {
      id: 'explicit-documents',
      title: documents.name,
      description:
        'Three documents, concurrency 2, isolated child scopes and input-ordered results. No external document service is called.',
      source: 'Stack Proc · scoped authoring v2',
      flow: documents,
    },
    {
      id: 'explicit-merge',
      title: parallel.name,
      description:
        'Named customer/inventory branches export results. Merge explicitly updates the parent account ID. Local construction only.',
      source: 'Stack Proc · scoped authoring v2',
      flow: parallel,
    },
  ];
}
