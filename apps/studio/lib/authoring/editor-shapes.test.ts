import { describe, it, expect } from 'vitest';
import { nodeResultShape, parameterShape, shapeMismatch } from './editor-shapes';
import type { FlowNodeData } from '../flows/types';
describe('editor shape hints', () => {
  it('exposes constructed fields without requiring an execution or evaluating expressions', () => {
    const schema = parameterShape({
      mode: 'object',
      fields: {
        tags: { mode: 'array', items: [{ mode: 'fixed', value: 'typed' }] },
        source: { mode: 'expression', expression: '$input.document' },
        omitted: { mode: 'omit' },
      },
    });
    expect(schema).toEqual({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } }, source: {} },
    });
  });
  it('respects explicit result contracts and rejects known nested type mismatches', () => {
    const n = {
      id: 'construct',
      name: 'Construct data',
      position: { x: 0, y: 0 },
      kind: 'construct',
      config: {
        parameters: { value: { mode: 'fixed', value: 12 } },
        ports: { output: { id: 'value', schema: { type: 'number' }, required: true, cardinality: 'single' } },
      },
    } as FlowNodeData;
    expect(nodeResultShape(n)).toEqual({ type: 'number' });
    expect(
      shapeMismatch({ type: 'array', items: { type: 'string' } }, { type: 'array', items: { type: 'number' } }),
    ).toBeTruthy();
    expect(shapeMismatch({ type: 'number' }, { type: 'integer' })).toBeUndefined();
    expect(shapeMismatch({ type: 'object' }, {})).toBeUndefined();
    expect(shapeMismatch({ type: ['string', 'null'] }, { type: 'string' })).toBeUndefined();
  });
});
