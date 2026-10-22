import { parseRDF } from '../../vendor/ontology-playground/src/lib/rdf/parser';
import { playgroundDocumentSchema, type PlaygroundDocument } from './playground-document';
import { fromPlayground } from './playground';
import { validateOntology, type Ontology } from './ontology';
import { normalizeEntityIcon } from './entity-presentation';
import { entityColors } from './material-colors';
export const RDF_IMPORT_LIMIT = 1024 * 1024;
export function prepareImportedOntology(input: unknown, previous: Ontology) {
  const document = playgroundDocumentSchema.parse(input);
  if (!document.entityTypes.length) throw new Error('No supported entity classes were found in this RDF/XML document.');
  const projectionWarnings: string[] = [];
  // The native model has one parent. Retain the complete assertions in rdfSource.
  const parents = new Set<string>();
  document.relationships = document.relationships.filter((relationship) => {
    if (relationship.kind !== 'subclass') return true;
    if (parents.has(relationship.from)) {
      projectionWarnings.push(
        `Additional parent ${relationship.from} → ${relationship.to} omitted: the editor supports one parent per entity. Original assertions remain in RDF source.`,
      );
      return false;
    }
    parents.add(relationship.from);
    return true;
  });
  document.entityTypes = document.entityTypes.map((entity, index) => ({
    ...entity,
    icon: normalizeEntityIcon(entity.icon, entity.name, entity.description),
    color: entityColors[index % entityColors.length].hex,
  }));
  // Reuse IDs for unchanged properties on an explicit replacement of the same model.
  for (const entity of document.entityTypes) {
    const old = previous.entities.find((item) => item.id === entity.id);
    for (const property of entity.properties)
      property.stackprocId ??= old?.properties.find((item) => item.name === property.name)?.id;
  }
  const model = fromPlayground(document, previous);
  const errors = validateOntology(model).filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join(' '));
  return { model, document: model.playground!, warnings: [...importWarnings(document), ...projectionWarnings] };
}
function importWarnings(document: PlaygroundDocument) {
  const warnings = [
    'Applying replaces the current ontology draft. Save creates a revision; Undo restores the previous draft.',
  ];
  if (document.rdfMetadata?.imports.length)
    warnings.push('Referenced OWL imports are retained as metadata. External documents are not fetched.');
  if (document.rdfMetadata?.preservedSourceFeatures.includes('shacl'))
    warnings.push('SHACL metadata is retained where supported; this editor does not execute SHACL validation.');
  return warnings;
}
export function importRdf(source: string, previous: Ontology, xmlDocument?: Document) {
  if (!source.trim()) throw new Error('Choose an RDF/XML file or paste RDF/XML text.');
  if (new TextEncoder().encode(source).byteLength > RDF_IMPORT_LIMIT)
    throw new Error('RDF/XML imports must be 1 MiB or smaller.');
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source))
    throw new Error('DTD and entity declarations are not supported. Use self-contained RDF/XML.');
  const parsed = parseRDF(source, xmlDocument);
  const proposal = prepareImportedOntology(parsed.ontology, previous);
  proposal.document.rdfSource = source;
  proposal.warnings.push(...parsed.warnings);
  if (parsed.bindings.length)
    proposal.warnings.push('Source data bindings are not activated as workspace connections.');
  return proposal;
}
