import { describe, it, expect } from 'vitest';
import { canonicalJson, contentHash } from './contracts';
import { validateOntology, entityJsonSchema } from './ontology';
import { validateProcess } from './process';
import { knowledgeFixtures } from './fixtures';
import { generateWorkflow } from '../intelligence/generation';
import { compileAuthoringGraph } from '../authoring/compiler';
import { bind } from '../native/model';
import { executeScopedGraph } from '../authoring/scoped-executor';
describe('domain-independent knowledge contracts', () => {
  it('hashes key permutations identically but preserves array order', async () => {
    expect(await contentHash({ b: 2, a: { c: 3 } })).toBe(await contentHash({ a: { c: 3 }, b: 2 }));
    expect(await contentHash([1, 2])).not.toBe(await contentHash([2, 1]));
    expect(canonicalJson({ z: -0 })).toBe('{"z":0}');
    for (const bad of [NaN, Infinity, undefined, new Date(), { x: undefined }, new Array(2)])
      expect(() => canonicalJson(bad)).toThrow();
    const circular: any = {};
    circular.self = circular;
    expect(() => canonicalJson(circular)).toThrow();
  });
  for (const f of knowledgeFixtures())
    it(`generates and executes ${f.name} with the same compiler`, async () => {
      expect(validateOntology(f.ontology)).toEqual([]);
      expect(validateProcess(f.process)).toEqual([]);
      const generated = await generateWorkflow(f.name, f.process, { artifactId: 'process', revisionId: 'revision' });
      const graph = compileAuthoringGraph(generated.flow);
      const events = [];
      for await (const event of executeScopedGraph(
        graph,
        generated.flow.defaultInput ?? {},
        'fixture',
        async (node, context) =>
          node.kind === 'trigger'
            ? { value: context.input }
            : { value: bind((node.config.operation as any).value, context) },
      ))
        events.push(event);
      const last = events.at(-1) as any;
      expect(last.type).toBe('run.completed');
      expect(last.output.result).toBe(f.expected);
      expect(generated.manifest.elements).toHaveLength(2);
      expect(
        (await generateWorkflow(f.name, f.process, { artifactId: 'process', revisionId: 'revision' })).flow.nodes.map(
          (n) => n.id,
        ),
      ).toEqual(generated.flow.nodes.map((n) => n.id));
    });
  it('rejects cyclic inheritance, missing relationships and invalid cardinality', () => {
    const f = knowledgeFixtures()[0].ontology;
    f.entities[0].parentId = f.entities[0].id;
    f.relationships.push({
      id: 'r',
      name: 'references',
      sourceId: 'missing',
      targetId: 'invoice',
      min: 2,
      max: 1,
      evidence: [],
    });
    expect(validateOntology(f).map((i) => i.code)).toEqual(
      expect.arrayContaining(['inheritance_cycle', 'unknown_entity', 'cardinality']),
    );
  });
  it('projects stable property IDs with requiredness and annotations', () => {
    const f = knowledgeFixtures()[0].ontology;
    f.entities[0].properties[0].currency = 'USD';
    expect(entityJsonSchema(f, 'invoice')).toMatchObject({
      type: 'object',
      required: ['amount'],
      properties: { amount: { type: 'number', 'x-currency': 'USD' } },
    });
  });
  it('retains unsupported actions and questions without generating fake nodes', async () => {
    const f = knowledgeFixtures()[0].process;
    f.steps.unshift({
      id: 'pay',
      name: 'Pay supplier',
      kind: 'requirement',
      capability: 'Payment adapter required',
      evidence: [],
    });
    f.questions.push({ id: 'threshold', question: 'Who approves payment?' });
    expect(validateProcess(f).map((i) => i.code)).toEqual(['missing_capability', 'unanswered_question']);
    await expect(generateWorkflow('Incomplete', f, { artifactId: 'p', revisionId: 'r' })).rejects.toThrow(
      'Payment adapter required',
    );
  });
  it('rejects downstream references and duplicate IDs before producing a graph', async () => {
    const f = knowledgeFixtures()[0].process;
    if (f.steps[0].kind === 'construct') f.steps[0].value = { mode: 'expression', expression: '$nodes["result"]' };
    await expect(generateWorkflow('Invalid', f, { artifactId: 'p', revisionId: 'r' })).rejects.toThrow();
    f.steps[1].id = f.steps[0].id;
    expect(validateProcess(f).some((i) => i.code === 'duplicate_id')).toBe(true);
  });
});
