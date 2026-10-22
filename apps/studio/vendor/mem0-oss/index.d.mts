/** Adapted Mem0 OSS public injection seam; see PROVENANCE.json. */
export class Memory {
 constructor(config: Record<string, unknown>, components: {
  disableEntityBoost?: boolean;
  embedder: { embed(text: string, action?: string): Promise<number[]> };
  llm: unknown; vectorStore: unknown;
  idFor(metadata: Record<string, unknown>): string;
 });
 add(text: string, options: Record<string, unknown>): Promise<{results: unknown[]}>;
 search(query: string, options: Record<string, unknown>): Promise<{results: Array<{id: string; score: number; metadata?: Record<string, unknown>}>}>;
}
