import { z } from 'zod';
export const id = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/)
  .refine((v) => !['constructor', 'prototype', '__proto__'].includes(v), 'Reserved reference ID.');
export const refSchema = z.object({ artifactId: id, revisionId: id }).strict();
export const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), revisionId: id, blockId: id }).strict(),
  z.object({ kind: z.literal('user'), decisionId: id }).strict(),
  z.object({ kind: z.literal('inference'), taskId: id, explanation: z.string().min(1).max(2000) }).strict(),
]);
export const evidenceList = z.array(evidenceSchema).max(100).default([]);
export const issueSchema = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
});
export type KnowledgeIssue = z.infer<typeof issueSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ArtifactRef = z.infer<typeof refSchema>;
export const artifactKinds = ['ontology', 'process', 'source'] as const;
export type ArtifactKind = (typeof artifactKinds)[number];
export type KnowledgeArtifact = {
  id: string;
  workspaceId: string;
  kind: ArtifactKind;
  name: string;
  editVersion: number;
  revisionId: string;
  publishedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeRevision = {
  id: string;
  artifactId: string;
  parentRevisionId: string | null;
  contentHash: string;
  content: unknown;
  createdAt: string;
  reviewed: boolean;
};
/** Version 1 canonical JSON: sorted object keys, original array order, finite JSON only. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function visit(v: unknown): string {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || !v || ancestors.has(v)) throw new Error('Expected finite, acyclic JSON.');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
      throw new Error('Expected a JSON object.');
    ancestors.add(v);
    if (Array.isArray(v) && Array.from({ length: v.length }, (_, i) => i).some((i) => !Object.hasOwn(v, i)))
      throw new Error('Sparse arrays are not JSON.');
    const result = Array.isArray(v)
      ? `[${v.map(visit).join(',')}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${visit((v as Record<string, unknown>)[k])}`)
          .join(',')}}`;
    ancestors.delete(v);
    return result;
  }
  return visit(value);
}
export async function contentHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
export function duplicateIssues(items: { id: string }[], path: string): KnowledgeIssue[] {
  const seen = new Set<string>();
  return items.flatMap((item, i) => {
    const duplicate = seen.has(item.id);
    seen.add(item.id);
    return duplicate
      ? [
          {
            code: 'duplicate_id',
            path: `${path}.${i}.id`,
            severity: 'error' as const,
            message: `Duplicate ID: ${item.id}`,
          },
        ]
      : [];
  });
}
