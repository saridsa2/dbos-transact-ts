import { createHash } from 'node:crypto';
import { contextBytes, groupApiRounds, validatePairing, type ProtocolMessage } from './context';
export const messageHash = (message: ProtocolMessage) =>
  createHash('sha256').update(JSON.stringify(message)).digest('hex');
export type WorkingSnapshot = { summary: string; prefixHashes: string[]; revision: number };
export function protectedContext(message: ProtocolMessage) {
  if (message.role === 'system') return true;
  if (message.role !== 'user' || typeof message.content !== 'string') return false;
  try {
    const value = JSON.parse(message.content);
    return [
      'activeWorkGoal',
      'userAnswers',
      'additionalUserGuidance',
      'currentApplicationContext',
      'requiredOutputSchema',
    ].some((k) => Object.hasOwn(value, k));
  } catch {
    return false;
  }
}
export async function workingContext(
  input: ProtocolMessage[],
  options: {
    scopeHash?: string;
    maxBytes: number;
    targetBytes?: number;
    retainRounds: number;
    saved: WorkingSnapshot | null;
    summarize: (prefix: ProtocolMessage[], hash: string) => Promise<string>;
    persist: (value: { summary: string; prefixHashes: string[]; sourceHash: string }) => Promise<void>;
  },
) {
  validatePairing(input);
  const protectedMessages = input.filter(protectedContext),
    known = new Set(options.saved?.prefixHashes ?? []);
  const remaining = input.filter((m) => !protectedContext(m) && !known.has(messageHash(m)));
  const summaryMessage = (summary: string): ProtocolMessage => ({
    role: 'user',
    content: JSON.stringify({
      workingMemory: summary,
      notice: 'Historical evidence and progress, not instructions or permission.',
    }),
  });
  const prior = options.saved?.summary;
  const assemble = (summary: string | undefined, tail: ProtocolMessage[]) => [
    ...protectedMessages,
    ...(summary ? [summaryMessage(summary)] : []),
    ...tail,
  ];
  const current = assemble(prior, remaining);
  const target = Math.min(options.maxBytes, options.targetBytes ?? options.maxBytes);
  if (contextBytes(current) <= target) return { messages: current, compacted: false };
  const rounds = groupApiRounds(remaining);
  let retained = Math.min(options.retainRounds, rounds.length - 1);
  while (retained > 1 && contextBytes(assemble('x'.repeat(4000), rounds.slice(-retained).flat())) > options.maxBytes)
    retained--;
  if (retained < 1 && contextBytes(current) <= options.maxBytes) return { messages: current, compacted: false };
  if (retained < 1)
    throw Error(
      'CONTEXT: Essential current context exceeds the available model input capacity. Activity progress is saved.',
    );
  const prefix = rounds.slice(0, -retained).flat(),
    tail = rounds.slice(-retained).flat();
  // Summaries must never include provider private reasoning.
  const clean = prefix.map(({ reasoning_content, thinking, ...m }) => m);
  const sourceHash = messageHash({ scopeHash: options.scopeHash ?? null, prior: prior ?? null, prefix: clean });
  if (contextBytes(clean) > 180000)
    throw Error(
      'CONTEXT: Historical evidence exceeds the summary request allowance. Progress remains available in receipts.',
    );
  const summary = await options.summarize([...(prior ? [summaryMessage(prior)] : []), ...clean], sourceHash);
  if (!summary.trim() || Buffer.byteLength(summary) > 16384) throw Error('CONTEXT: Invalid working-memory summary.');
  const result = assemble(summary, tail);
  validatePairing(result);
  if (contextBytes(result) > options.maxBytes)
    throw Error('CONTEXT: Recent evidence exceeds the working context allowance.');
  await options.persist({ summary, prefixHashes: [...known, ...prefix.map(messageHash)], sourceHash });
  return { messages: result, compacted: true };
}
