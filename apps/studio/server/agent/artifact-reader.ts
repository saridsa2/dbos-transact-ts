import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { importRdf } from '../../lib/knowledge/rdf-import';
import type { KnowledgeArtifact, KnowledgeRevision } from '../../lib/knowledge/contracts';
import type { Ontology } from '../../lib/knowledge/ontology';
import { artifactReadSchema, artifactPageSchema } from '../../lib/agent/artifact-reading';
import type { z } from 'zod';
type Record = { artifact: KnowledgeArtifact; revision: KnowledgeRevision };
type Block = { id: string; text: string; ordinal: number };
const blank: Ontology = { schemaVersion: 1, description: '', entities: [], relationships: [] };
/** The source is read only from a workspace-authorized immutable revision. No external I/O. */
export function readArtifact(record: Record, input: z.infer<typeof artifactReadSchema>, blocks: Block[] = []) {
  if (
    input.view === 'auto' &&
    input.offset === 0 &&
    !input.query &&
    !input.entityId &&
    Buffer.byteLength(JSON.stringify(record)) <= 64000
  )
    return record;
  const { artifact, revision } = record;
  const content = revision.content as any;
  const source: string | undefined =
    artifact.kind === 'source'
      ? content.text
      : artifact.kind === 'ontology'
        ? content.playground?.rdfSource
        : content.bpmnSource?.xml;
  const text = source?.replace(/\r\n?/g, '\n');
  const availableViews = [
    'summary',
    'json',
    ...(text !== undefined ? ['text', 'search'] : []),
    ...(artifact.kind === 'ontology' || artifact.kind === 'source'
      ? ['structure', 'entities', 'entity', 'relationships']
      : []),
  ];
  let view = input.view === 'auto' ? 'summary' : input.view;
  const warnings: string[] = [];
  let model: Ontology | undefined = artifact.kind === 'ontology' ? content : undefined;
  if (['structure', 'entities', 'entity', 'relationships'].includes(view) && !model) {
    if (artifact.kind !== 'source' || !source)
      throw Error('This artifact has no ontology structure. Use json or text views.');
    if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source))
      throw Error('DTD and entity declarations are not supported. Use text/search to inspect this source.');
    let dom: JSDOM | undefined;
    try {
      dom = new JSDOM(source, { contentType: 'application/xml' });
      const parsed = importRdf(source, blank, dom.window.document as unknown as Document);
      model = parsed.model;
      // Source projections are rebuilt per call; random imported property IDs would
      // otherwise change between continuation pages of the same immutable revision.
      for (const entity of model.entities)
        entity.properties.forEach((property, index) => {
          property.id =
            'rdf-' +
            createHash('sha256')
              .update(JSON.stringify([revision.id, entity.id, index, property.name]))
              .digest('hex')
              .slice(0, 32);
        });
      warnings.push(...parsed.warnings.filter((w) => !w.startsWith('Applying replaces')));
    } catch {
      throw Error(
        'This source cannot be projected as RDF/XML. Read it using text/search; do not substitute recalled facts.',
      );
    } finally {
      dom?.window.close();
    }
  }
  const summary = {
    ...(model ? { entityCount: model.entities.length, relationshipCount: model.relationships.length } : {}),
    ...(artifact.kind === 'process'
      ? { elementCount: content.graph?.elements?.length ?? content.steps?.length ?? 0 }
      : {}),
    ...(text !== undefined ? { sourceCharacters: text.length } : {}),
  };
  let body: string,
    format: 'text' | 'json' = 'json';
  const normalizedModel = model
    ? {
        schemaVersion: model.schemaVersion,
        description: model.description,
        entities: model.entities,
        relationships: model.relationships,
      }
    : undefined;
  switch (view) {
    case 'summary':
      body = JSON.stringify(
        {
          name: artifact.name,
          kind: artifact.kind,
          ...summary,
          description: String(content.description ?? content.purpose ?? '').slice(0, 1000),
          guidance:
            'This is an index, not a full read. Use entities, entity, relationships or source text/search. Follow continuation with the returned revisionId. Source assertions must be supported by retrieved text; external imports are not fetched.',
        },
        null,
        2,
      );
      break;
    case 'json':
      body = JSON.stringify(content, null, 2);
      break;
    case 'structure':
      body = JSON.stringify(normalizedModel, null, 2);
      break;
    case 'entities':
      body = JSON.stringify(
        model!.entities.map((e) => ({
          id: e.id,
          name: e.name,
          parentId: e.parentId,
          propertyCount: e.properties.length,
          description: e.description.slice(0, 300),
        })),
        null,
        2,
      );
      break;
    case 'entity': {
      const entity = model!.entities.find((e) => e.id === input.entityId);
      if (!entity) throw Error('Entity not found in this revision. Read the entities index first.');
      body = JSON.stringify(
        {
          entity,
          relationships: model!.relationships.filter((r) => r.sourceId === entity.id || r.targetId === entity.id),
        },
        null,
        2,
      );
      break;
    }
    case 'relationships':
      body = JSON.stringify(model!.relationships, null, 2);
      break;
    case 'text':
    case 'search':
      if (text === undefined) throw Error('This artifact has no retained source text. Use structure or json.');
      body = text;
      format = 'text';
      break;
    default:
      throw Error('Unsupported artifact view.');
  }
  let start = Math.min(input.offset, body.length);
  let matched = true;
  if (view === 'search') {
    const escaped = input.query!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'giu');
    pattern.lastIndex = start;
    const hit = pattern.exec(body);
    matched = !!hit;
    start = hit?.index ?? body.length;
  }
  if (start > 0 && /[\uDC00-\uDFFF]/.test(body[start] ?? '') && /[\uD800-\uDBFF]/.test(body[start - 1])) start--;
  let end = Math.min(body.length, start + input.limit);
  // Both source offsets and continuation offsets use UTF-16 units; never split a surrogate pair.
  if (end < body.length && end > start && /[\uD800-\uDBFF]/.test(body[end - 1])) end--;
  let fragment = body.slice(start, end);
  while (Buffer.byteLength(JSON.stringify(fragment)) > 12000 && end > start) {
    end = start + Math.max(1, Math.floor((end - start) * 0.75));
    if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1])) end--;
    fragment = body.slice(start, end);
  }
  if (!fragment && end === start && start < body.length) {
    end = start + (/[\uD800-\uDBFF]/.test(body[start]) ? 2 : 1);
    fragment = body.slice(start, end);
  }
  const nextOffset = end < body.length ? end : null;
  const evidence: { kind: 'source'; revisionId: string; blockId: string }[] = [];
  if (artifact.kind === 'source' && ['text', 'search'].includes(view)) {
    let cursor = 0;
    for (const block of blocks) {
      const position = body.indexOf(block.text, cursor);
      if (position < 0) continue;
      cursor = position + block.text.length;
      if (position < end && cursor > start && evidence.length < 50)
        evidence.push({ kind: 'source', revisionId: revision.id, blockId: block.id });
    }
  }
  if (view === 'summary')
    warnings.unshift(
      'Only metadata has been read. Retrieve the relevant source or structure before proposing source-grounded changes.',
    );
  if (start > 0) warnings.unshift('This response starts inside the selected view; earlier content is not included.');
  if (nextOffset !== null)
    warnings.unshift('Partial view: more content remains. Continue with the pinned revision and returned offset.');
  if (view === 'search')
    warnings.unshift(
      matched
        ? 'Literal search hit; this is not complete source coverage. Continue to find later hits.'
        : 'No further literal matches. This does not prove the source has no semantically related assertions.',
    );
  if (model && artifact.kind === 'source')
    warnings.unshift(
      'Parsed supported RDF subset only; text/search remains available for omitted or external assertions.',
    );
  const continuation =
    nextOffset === null
      ? null
      : {
          id: artifact.id,
          revisionId: revision.id,
          view,
          offset: nextOffset,
          limit: input.limit,
          ...(input.entityId ? { entityId: input.entityId } : {}),
          ...(input.query ? { query: input.query } : {}),
        };
  return artifactPageSchema.parse({
    artifact: {
      id: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      revisionId: revision.id,
      editVersion: artifact.editVersion,
    },
    revision: { id: revision.id, reviewed: revision.reviewed, contentHash: revision.contentHash },
    availableViews,
    summary,
    page: {
      view,
      format,
      offset: start,
      nextOffset,
      total: body.length,
      text: fragment,
      complete: start === 0 && nextOffset === null && view !== 'search',
      query: input.query,
      entityId: input.entityId,
    },
    evidence,
    warnings: warnings.slice(0, 12).map((w) => (w.length > 300 ? w.slice(0, 297) + '…' : w)),
    continuation,
  });
}
