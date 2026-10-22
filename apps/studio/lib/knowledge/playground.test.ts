import { describe, it, expect } from 'vitest';
import { toPlayground, fromPlayground } from './playground';
import { ontologySchema, validateOntology, entityJsonSchema, type Ontology } from './ontology';
const model = (): Ontology => ({
  schemaVersion: 1,
  description: 'Domain',
  entities: [
    {
      id: 'invoice',
      name: 'Invoice',
      description: 'A bill',
      evidence: [{ kind: 'source', revisionId: 'r1', blockId: 'b1' }],
      properties: [
        {
          id: 'total',
          name: 'Total',
          type: 'number',
          required: true,
          nullable: false,
          currency: 'USD',
          description: 'Amount',
          evidence: [],
        },
        {
          id: 'items',
          name: 'Items',
          type: 'array',
          required: false,
          nullable: true,
          description: 'Lines',
          evidence: [],
        },
      ],
    },
    {
      id: 'paid-invoice',
      name: 'Paid invoice',
      description: 'Paid',
      parentId: 'invoice',
      properties: [],
      evidence: [],
    },
  ],
  relationships: [
    { id: 'related', name: 'Related', sourceId: 'invoice', targetId: 'paid-invoice', min: 2, max: 7, evidence: [] },
  ],
});
describe('Microsoft Ontology Playground integration', () => {
  it('round trips stable references, evidence, inheritance, required/null, currency and exact cardinalities', () => {
    const original = model(),
      doc = toPlayground(original, 'Billing');
    doc.entityTypes[0].name = 'Invoice renamed';
    doc.entityTypes[0].properties.reverse();
    doc.entityTypes[0].properties[1].name = 'Amount renamed';
    const result = fromPlayground(doc, original);
    expect(validateOntology(result)).toEqual([]);
    expect(result.entities[0].properties[1]).toMatchObject({
      id: 'total',
      name: 'Amount renamed',
      currency: 'USD',
      required: true,
      nullable: false,
    });
    expect(result.entities[0].evidence).toEqual(original.entities[0].evidence);
    expect(result.entities[1].parentId).toBe('invoice');
    expect(result.relationships[0]).toEqual(original.relationships[0]);
    expect(toPlayground(ontologySchema.parse(JSON.parse(JSON.stringify(result))), 'Billing')).toEqual(doc);
  });
  it('retains richer date, enum, identifiers, relationship attributes and RDF metadata across reload', () => {
    const original = model(),
      doc = toPlayground(original, 'Billing');
    doc.entityTypes[0].properties.push(
      { name: 'Issued', type: 'date', stackprocId: 'issued', isIdentifier: true },
      { name: 'State', type: 'enum', stackprocId: 'state', values: ['Open', 'Paid'] },
    );
    doc.relationships[0].description = 'Descriptive relationship';
    doc.relationships[0].attributes = [{ name: 'reason', type: 'string' }];
    doc.rdfMetadata = {
      ontologyIri: 'https://example.test/invoice',
      imports: ['https://example.test/core'],
      preservedSourceFeatures: ['shacl'],
    };
    const result = ontologySchema.parse(fromPlayground(doc, original));
    expect(result.entities[0].properties.find((p) => p.id === 'issued')).toMatchObject({
      type: 'string',
      format: 'date',
      identifier: true,
    });
    const schema = entityJsonSchema(result, 'invoice') as { properties: Record<string, unknown> };
    expect(schema.properties.issued).toMatchObject({ format: 'date' });
    expect(schema.properties.state).toMatchObject({ enum: ['Open', 'Paid'] });
    expect(toPlayground(result, 'Billing')).toMatchObject(doc);
  });
  it('allocates new property IDs once and does not repurpose deleted references', () => {
    const original = model(),
      doc = toPlayground(original, 'Billing');
    doc.entityTypes[0].properties = [{ name: 'New amount', type: 'integer' }];
    const result = fromPlayground(doc, original),
      id = result.entities[0].properties[0].id;
    expect(id).not.toBe('total');
    expect(id).not.toBe('items');
    const next = fromPlayground(toPlayground(result, 'Billing'), result);
    expect(next.entities[0].properties[0].id).toBe(id);
    expect(next.entities[0].properties[0].required).toBe(false);
  });
  it('updates association cardinality intentionally and cleans up inheritance when a parent is deleted', () => {
    const original = fromPlayground(toPlayground(model(), 'Billing'), model()),
      doc = toPlayground(original, 'Billing');
    doc.relationships[0].cardinality = 'one-to-one';
    const changed = fromPlayground(doc, original);
    expect(changed.relationships[0]).toMatchObject({ min: 0, max: 1 });
    doc.entityTypes = doc.entityTypes.filter((e) => e.id !== 'invoice');
    doc.relationships = [];
    const removed = fromPlayground(doc, changed);
    expect(removed.entities[0].parentId).toBeUndefined();
    expect(validateOntology(removed)).toEqual([]);
  });
  it('rejects unsupported multiple inheritance and malformed editor documents instead of losing data', () => {
    const original = model(),
      doc = toPlayground(original, 'Billing');
    doc.relationships.push({
      id: 'parent2',
      name: 'is a',
      from: 'paid-invoice',
      to: 'paid-invoice',
      kind: 'subclass',
      cardinality: 'many-to-one',
    });
    expect(() => fromPlayground(doc, original)).toThrow('one parent');
    expect(() =>
      fromPlayground({ ...doc, entityTypes: [{ ...doc.entityTypes[0], color: 'url(javascript:evil)' }] }, original),
    ).toThrow();
  });
});

describe('entity configuration schemas', () => {
  it('preserves nested schemas, required/null flags and defaults through JSON save/reopen', () => {
    const original = model(),
      doc = toPlayground(original, 'Billing');
    doc.entityTypes[0].properties.push({
      stackprocId: 'address',
      name: 'Address',
      type: 'object',
      required: true,
      nullable: true,
      schema: {
        type: 'object',
        properties: { lines: { type: 'array', items: { type: 'string' } }, postcode: { type: 'string' } },
        required: ['postcode'],
        additionalProperties: false,
        default: { lines: ['Main street'], postcode: '12345' },
      },
    });
    const projected = ontologySchema.parse(fromPlayground(doc, original));
    expect(validateOntology(projected)).toEqual([]);
    const saved = ontologySchema.parse(JSON.parse(JSON.stringify(projected)));
    expect(
      toPlayground(saved, 'Billing').entityTypes[0].properties.find((p) => p.stackprocId === 'address'),
    ).toMatchObject(doc.entityTypes[0].properties.at(-1)!);
    expect((entityJsonSchema(saved, 'invoice').properties as Record<string, unknown>).address).toMatchObject({
      type: ['object', 'null'],
      required: ['postcode'],
      properties: { lines: { items: { type: 'string' } } },
      default: { postcode: '12345' },
    });
  });
  it('rejects defaults that do not satisfy the property schema', () => {
    const original = model(),
      doc = toPlayground(original, 'Billing');
    doc.entityTypes[0].properties[0].schema = { type: 'number', default: 'wrong' };
    expect(validateOntology(fromPlayground(doc, original))).toContainEqual(
      expect.objectContaining({ code: 'property_schema', severity: 'error' }),
    );
  });
  it('clears a schema when a property type is changed without reusing obsolete constraints', () => {
    const original = model(),
      doc = toPlayground(original, 'Billing');
    doc.entityTypes[0].properties[0].schema = { type: 'number', default: 42 };
    const saved = fromPlayground(doc, original),
      next = toPlayground(saved, 'Billing');
    next.entityTypes[0].properties[0].type = 'string';
    delete next.entityTypes[0].properties[0].schema;
    const changed = fromPlayground(next, saved);
    expect(changed.entities[0].properties[0].schema).toBeUndefined();
    expect(validateOntology(changed)).toEqual([]);
  });
});
