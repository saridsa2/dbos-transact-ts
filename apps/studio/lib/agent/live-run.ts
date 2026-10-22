import { z } from 'zod';

// These are presentation receipts from /work-items/:id/events, never provider messages.
const cursorSchema = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((id) => BigInt(id) <= 9223372036854775807n);
const envelope = z.object({
  id: cursorSchema,
  kind: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});
const call = z.object({ callId: z.string().min(1), turn: z.number().int().nonnegative() });
const usage = z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() });
export type RunSpan = {
  id: string;
  kind: 'model' | 'tool';
  turn: number;
  name?: string;
  startedAt: string | null;
  endedAt: string | null;
  state: 'running' | 'completed' | 'failed';
  usage?: z.infer<typeof usage>;
};
export type LiveRun = {
  workId: string;
  cursor: string;
  spans: RunSpan[];
  // A streamed answer is provisional until the durable session snapshot arrives.
  answer: { callId: string; text: string } | null;
};
export const emptyLiveRun = (workId: string): LiveRun => ({ workId, cursor: '0', spans: [], answer: null });

/** Replayed SSE receipts are idempotent. Cursors remain strings beyond JS's safe integer range. */
export function receiveRunEvent(run: LiveRun, input: unknown): LiveRun {
  const event = envelope.parse(input);
  if (BigInt(event.id) <= BigInt(run.cursor)) return run;
  const next = { ...run, cursor: event.id };
  if (!['model_start', 'model_end', 'tool_start', 'tool_end', 'text'].includes(event.kind)) return next;
  const base = call.parse(event.payload);
  if (event.kind === 'text') {
    const { text } = z.object({ text: z.string() }).parse(event.payload);
    return {
      ...next,
      answer: {
        callId: base.callId,
        text: ((run.answer?.callId === base.callId ? run.answer.text : '') + text).slice(-65536),
      },
    };
  }
  const kind = event.kind.startsWith('model') ? 'model' : 'tool';
  const starting = event.kind.endsWith('start');
  const previous = run.spans.find((span) => span.id === base.callId && span.kind === kind);
  const span: RunSpan = previous
    ? { ...previous }
    : { id: base.callId, kind, turn: base.turn, startedAt: null, endedAt: null, state: 'running' };
  if (kind === 'tool') span.name = z.object({ name: z.string().min(1) }).parse(event.payload).name;
  if (starting) span.startedAt = event.createdAt;
  else {
    const result = z
      .object({ failed: z.boolean().optional(), error: z.boolean().optional(), usage: usage.optional() })
      .parse(event.payload);
    span.endedAt = event.createdAt;
    span.state = result.failed || result.error ? 'failed' : 'completed';
    if (result.usage) span.usage = result.usage;
  }
  next.spans = previous ? run.spans.map((item) => (item === previous ? span : item)) : [...run.spans, span];
  if (kind === 'model') {
    const result = z.object({ hasTools: z.boolean().optional(), failed: z.boolean().optional() }).parse(event.payload);
    if (starting || result.hasTools || result.failed) next.answer = null;
  }
  return next;
}

/** Missing receipts stay unknown; wall-clock waiting does not manufacture call durations. */
export function spanDuration(span: RunSpan): number | null {
  if (!span.startedAt || !span.endedAt) return null;
  return Math.max(0, Date.parse(span.endedAt) - Date.parse(span.startedAt));
}
