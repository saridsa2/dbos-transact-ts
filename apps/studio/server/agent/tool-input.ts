/** Compatibility for providers that encode an object-valued tool field as JSON.
 * Decode exactly once; normal schema and workspace/revision checks still apply.
 */
export function normalizeToolInput(name: string, input: unknown): unknown {
  if (
    !['ontology_propose_v1', 'process_propose_v1'].includes(name) ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  )
    return input;
  const fields = input as Record<string, unknown>;
  if (typeof fields.content !== 'string') return input;
  if (Buffer.byteLength(fields.content) > 262144) throw Error('content: ontology JSON exceeds 256 KiB.');
  let content: unknown;
  try {
    content = JSON.parse(fields.content);
  } catch {
    throw Error('content: provide a valid ontology object; JSON text could not be decoded.');
  }
  if (!content || typeof content !== 'object' || Array.isArray(content))
    throw Error('content: expected an ontology object with schemaVersion, entities and relationships.');
  return { ...fields, content };
}
