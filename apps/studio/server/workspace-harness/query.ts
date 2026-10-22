/**
 * Stack Proc standalone source port.
 * Source: vendor/claude-source-reference/{query.ts,services/tools/toolOrchestration.ts}.txt.
 * Ports the model -> tools -> continuation lifecycle; CLI/global state has been
 * replaced with host callbacks. This is NOT the published Claude Agent SDK or
 * an unmodified Claude Code engine. DBOS checkpoints each callback in the host.
 */
export type ToolCall = { id: string; name: string; arguments: unknown };
export type Reply = { text: string; calls: ToolCall[] };
export type ToolResult = {
  question?: string;
  proposalId?: string;
  summary?: string;
  budgetExhausted?: boolean;
  pendingTasks?: string[];
};
export type Suspension = {
  state: 'waiting_for_user' | 'ready_for_review' | 'waiting_for_tasks';
  message: string;
  nextTurn: number;
};
export interface QueryHost {
  startTurn: number;
  maxTurns: number;
  concurrency?: number;
  isReadOnly?(name: string): boolean;
  complete(turn: number): Promise<Reply | null>;
  runTool(call: ToolCall, turn: number, index: number): Promise<ToolResult | null>;
  skipTool(call: ToolCall, turn: number, index: number): Promise<void>;
  checkpoint(nextTurn: number): Promise<void>;
  validateFinal?(text: string, turn: number): Promise<boolean>;
  finish(text: string): Promise<void>;
  suspend(suspension: Suspension): Promise<void>;
  exhausted(): Promise<void>;
}
/** Only host-declared reads may overlap. Questions, approvals and mutations
 * remain serial barriers; all issued reads drain before an activation settles.
 */
export async function query(host: QueryHost): Promise<void> {
  if (!Number.isInteger(host.startTurn) || host.startTurn < 0 || !Number.isInteger(host.maxTurns) || host.maxTurns < 1)
    throw new Error('Invalid harness turn limits.');
  for (let turn = host.startTurn; turn < host.maxTurns; turn++) {
    const reply = await host.complete(turn);
    if (!reply) return; // Host has already settled policy, cancellation or budget.
    if (reply.calls.length > 8 || new Set(reply.calls.map((call) => call.id)).size !== reply.calls.length)
      throw new Error('Invalid or duplicate tool calls. No tool was dispatched.');
    if (!reply.calls.length) {
      if (!reply.text.trim()) throw new Error('The model completed without a response.');
      if (host.validateFinal && !(await host.validateFinal(reply.text, turn))) {
        await host.checkpoint(turn + 1);
        continue;
      }
      await host.checkpoint(turn + 1);
      await host.finish(reply.text);
      return;
    }
    let paused: Suspension | undefined;
    let exhausted = false;
    for (let index = 0; index < reply.calls.length; ) {
      if (paused || exhausted) {
        await host.skipTool(reply.calls[index], turn, index);
        index++;
        continue;
      }
      const batch: { call: ToolCall; index: number }[] = [];
      const parallel = host.isReadOnly?.(reply.calls[index].name) === true;
      const limit = parallel ? Math.max(1, Math.min(8, host.concurrency ?? 1)) : 1;
      do {
        batch.push({ call: reply.calls[index], index });
        index++;
      } while (
        batch.length < limit &&
        index < reply.calls.length &&
        host.isReadOnly?.(reply.calls[index].name) === true
      );
      // Invoke in source order so the durable host assigns stable checkpoint IDs.
      const outcomes = await Promise.allSettled(batch.map((item) => host.runTool(item.call, turn, item.index)));
      const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      if (failure) throw failure.reason; // Drain every issued read before releasing the activation.
      for (const outcome of outcomes) {
        const result = (outcome as PromiseFulfilledResult<ToolResult | null>).value;
        if (result?.budgetExhausted) exhausted = true;
        else if (result?.pendingTasks?.length)
          paused = { state: 'waiting_for_tasks', message: 'Waiting for delegated research tasks.', nextTurn: turn + 1 };
        else if (result?.question || result?.proposalId)
          paused = {
            state: result.question ? 'waiting_for_user' : 'ready_for_review',
            message: result.question ?? result.summary ?? 'Changes are ready for review.',
            nextTurn: turn + 1,
          };
      }
    }
    if (exhausted) return;
    if (paused) {
      await host.suspend(paused);
      return;
    }
    await host.checkpoint(turn + 1);
  }
  await host.exhausted();
}
