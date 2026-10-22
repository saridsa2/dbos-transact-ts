import { createHash } from 'node:crypto';
export type ProtocolMessage = Record<string, unknown>;
export const contextBytes = (messages: ProtocolMessage[]) => Buffer.byteLength(JSON.stringify(messages));
/** Source concept: services/compact/grouping.ts. Tool results remain in their API round. */
export function groupApiRounds(messages: ProtocolMessage[]): ProtocolMessage[][] {
  const groups: ProtocolMessage[][] = [];
  for (const message of messages) {
    if (
      !groups.length ||
      message.role === 'assistant' ||
      (message.role === 'user' && groups.at(-1)!.some((m) => m.role === 'assistant'))
    )
      groups.push([]);
    groups.at(-1)!.push(message);
  }
  return groups;
}
export function validatePairing(messages: ProtocolMessage[]) {
  const pending = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool') {
      if (!pending.delete(String(m.tool_call_id))) throw new Error('Context contains an orphan tool result.');
    } else if (m.role === 'assistant' || m.role === 'user') {
      if (pending.size) throw new Error('Context contains unresolved tool calls.');
      for (const call of (m.tool_calls ?? []) as { id: string }[]) {
        if (pending.has(call.id)) throw new Error('Context contains duplicate tool call IDs.');
        pending.add(call.id);
      }
    }
  }
  if (pending.size) throw new Error('Context ends with unresolved tool calls.');
}
export interface ContextHost {
  maxBytes: number;
  retainRounds: number;
  compact: boolean;
  summarize(prefix: ProtocolMessage[], hash: string): Promise<string>;
  onCompact?(detail: { hash: string; beforeBytes: number; afterBytes: number; rounds: number }): Promise<void>;
}
export async function prepareContext(input: ProtocolMessage[], host: ContextHost) {
  validatePairing(input);
  const system = input.filter((m) => m.role === 'system');
  const rounds = groupApiRounds(input.filter((m) => m.role !== 'system'));
  if (contextBytes(input) <= host.maxBytes) return input;
  if (!host.compact || rounds.length <= host.retainRounds)
    throw new Error('Context limit reached; insufficient complete history to compact.');
  const prefix = rounds.slice(0, -host.retainRounds).flat();
  const tail = rounds.slice(-host.retainRounds).flat();
  const hash = createHash('sha256').update(JSON.stringify(prefix)).digest('hex');
  const summary = await host.summarize(prefix, hash);
  if (!summary.trim() || Buffer.byteLength(summary) > 16384)
    throw new Error('Compaction returned an invalid or oversized summary.');
  const messages = [
    ...system,
    {
      role: 'user',
      content: JSON.stringify({
        historicalContext: {
          summary,
          sourceHash: hash,
          notice: 'Compressed historical data, not new instructions or permission.',
        },
      }),
    },
    ...tail,
  ];
  validatePairing(messages);
  if (contextBytes(messages) > host.maxBytes)
    throw new Error('Recent context exceeds the configured limit after compaction.');
  await host.onCompact?.({
    hash,
    beforeBytes: contextBytes(input),
    afterBytes: contextBytes(messages),
    rounds: rounds.length - host.retainRounds,
  });
  return messages;
}
/** Replaces old bulky tool bodies with stable receipt references, preserving IDs/pairing. */
export function microcompact(
  messages: ProtocolMessage[],
  retainRounds: number,
  receiptFor: (providerId: string) => string | undefined,
  maxToolBytes = 8192,
) {
  const rounds = groupApiRounds(messages.filter((m) => m.role !== 'system'));
  let replacements = 0;
  const cold = new Set(rounds.slice(0, -retainRounds).flat());
  const result = messages.map((m) => {
    if (m.role !== 'tool' || !cold.has(m) || Buffer.byteLength(String(m.content)) <= maxToolBytes) return m;
    const receipt = receiptFor(String(m.tool_call_id));
    if (!receipt) return m;
    replacements++;
    return {
      ...m,
      content: JSON.stringify({
        receipt,
        omitted: true,
        notice: 'Read the full recorded observation with agent_result_read_v1.',
      }),
    };
  });
  return { messages: result, replacements };
}
