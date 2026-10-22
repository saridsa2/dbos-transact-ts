import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { importRdf } from './rdf-import';
import { entityIcons } from './entity-presentation';
import { validateOntology } from './ontology';
const blank = { schemaVersion: 1 as const, description: '', entities: [], relationships: [] };
const rdf = readFileSync(new URL('../../server/fixtures/rdf/ecommerce-step-1.rdf', import.meta.url), 'utf8');
function parse(source: string, previous = blank as import('./ontology').Ontology) {
  const dom = new JSDOM(source, { contentType: 'application/xml' });
  try {
    return importRdf(source, previous, dom.window.document as unknown as Document);
  } finally {
    dom.window.close();
  }
}
describe('Microsoft RDF import projection', () => {
  it('projects the official commerce sample into native entities with application icons, properties and relationships', () => {
    const result = parse(rdf);
    expect(result.model.entities.length).toBeGreaterThan(1);
    expect(result.model.relationships.length).toBeGreaterThan(0);
    expect(result.model.playground?.rdfSource).toBe(rdf);
    expect(validateOntology(result.model).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.document.entityTypes.every((entity) => entityIcons.some((icon) => icon.symbol === entity.icon))).toBe(
      true,
    );
    const again = parse(rdf, result.model);
    expect(again.model.entities.map((entity) => entity.properties.map((p) => p.id))).toEqual(
      result.model.entities.map((entity) => entity.properties.map((p) => p.id)),
    );
  });
  it('rejects oversized input and external entity declarations before parsing', () => {
    expect(() => importRdf('a'.repeat(1024 * 1024 + 1), blank)).toThrow('1 MiB');
    expect(() => importRdf('<!DOCTYPE rdf [<!ENTITY leak SYSTEM "file:///etc/passwd">]><rdf/>', blank)).toThrow('DTD');
  });
});

describe('W3C vocabulary imports (issue #1)', () => {
  for (const [file, minimum] of [
    ['w3c-org.rdf', 7],
    ['w3c-skos.rdf', 4],
  ] as const) {
    it(`previews original ${file} with explicit omitted-reference diagnostics`, () => {
      const source = readFileSync(new URL(`../../server/fixtures/rdf/${file}`, import.meta.url), 'utf8');
      const result = parse(source);
      expect(result.model.entities.length).toBeGreaterThanOrEqual(minimum);
      expect(result.model.playground?.rdfSource).toBe(source);
      expect(validateOntology(result.model).filter((i) => i.severity === 'error')).toEqual([]);
      expect(result.warnings.some((w) => w.includes('omitted: domain'))).toBe(true);
      const ids = new Set(result.model.entities.map((e) => e.id));
      expect(result.model.relationships.every((r) => ids.has(r.sourceId) && ids.has(r.targetId))).toBe(true);
    });
  }
  it('recognizes rdf:Description rdfs:Class declarations without linking external local-name collisions', () => {
    const result = parse(
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:owl="http://www.w3.org/2002/07/owl#"><rdf:Description rdf:about="https://local.test/Person"><rdf:type rdf:resource="http://www.w3.org/2000/01/rdf-schema#Class"/><rdfs:label xml:lang="fr">Personne</rdfs:label><rdfs:label xml:lang="en">Person</rdfs:label></rdf:Description><owl:ObjectProperty rdf:about="https://local.test/knows"><rdfs:domain rdf:resource="https://local.test/Person"/><rdfs:range rdf:resource="https://external.test/Person"/></owl:ObjectProperty></rdf:RDF>`,
    );
    expect(result.model.entities[0].name).toBe('Person');
    expect(result.model.relationships).toEqual([]);
    expect(result.warnings.join(' ')).toContain('https://external.test/Person');
  });
});
