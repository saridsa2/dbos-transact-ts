import type { Ontology } from './ontology';
import type { Process } from './process';
/** Small cross-domain fixtures; no provider or customer data. */
export function knowledgeFixtures(): { name: string; ontology: Ontology; process: Process; expected: number }[] {
  return [
    {
      name: 'Invoice total',
      entity: 'invoice',
      property: 'amount',
      description: 'Calculate an invoice total',
      inputs: { amount: 100, factor: 1.2 },
      formula: '$input.variables.amount * $input.variables.factor',
      expected: 120,
    },
    {
      name: 'Temperature adjustment',
      entity: 'sensor',
      property: 'reading',
      description: 'Adjust a sensor reading',
      inputs: { reading: 20, offset: 3 },
      formula: '$input.variables.reading + $input.variables.offset',
      expected: 23,
    },
  ].map((f) => ({
    name: f.name,
    expected: f.expected,
    ontology: {
      schemaVersion: 1,
      description: f.description,
      entities: [
        {
          id: f.entity,
          name: f.entity,
          description: '',
          evidence: [],
          properties: [
            {
              id: f.property,
              name: f.property,
              type: 'number',
              required: true,
              nullable: false,
              description: '',
              evidence: [],
            },
          ],
        },
      ],
      relationships: [],
    },
    process: {
      schemaVersion: 1,
      purpose: f.description,
      ontologyRefs: [],
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(Object.keys(f.inputs).map((key) => [key, { type: 'number' }])),
        required: Object.keys(f.inputs),
      },
      defaultInput: Object.fromEntries(Object.entries(f.inputs).filter(([, v]) => v !== undefined)) as Record<
        string,
        number
      >,
      steps: [
        {
          id: 'calculate',
          name: 'Calculate value',
          kind: 'construct',
          value: { mode: 'expression', expression: f.formula },
          evidence: [],
        },
        {
          id: 'result',
          name: 'Return result',
          kind: 'return',
          value: { mode: 'expression', expression: '$nodes["calculate"]' },
          evidence: [],
        },
      ],
      questions: [],
    },
  }));
}
