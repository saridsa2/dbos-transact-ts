export type HookEvent =
  | 'session_start'
  | 'before_model'
  | 'after_model'
  | 'before_tool'
  | 'after_tool'
  | 'before_compact'
  | 'after_compact'
  | 'stop'
  | 'error';
export type HookContext = Readonly<{
  workspaceId: string;
  workId: string;
  invocationId: string;
  turn: number;
  tool?: string;
  signal: AbortSignal;
}>;
export type HookDecision = void | { deny: string };
export type HarnessHook = (event: HookEvent, context: HookContext) => Promise<HookDecision>;
/** Trusted host modules only. Hooks never receive provider secrets or private reasoning. */
export class HarnessHooks {
  constructor(private readonly hooks: readonly HarnessHook[] = []) {}
  async run(event: HookEvent, context: Omit<HookContext, 'signal'>, signal?: AbortSignal) {
    for (const hook of this.hooks) {
      const timeout = AbortSignal.timeout(5000);
      const scoped = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let listener: () => void = () => {};
      try {
        const decision = await Promise.race([
          Promise.resolve().then(() => hook(event, Object.freeze({ ...context, signal: scoped }))),
          new Promise<never>((_, reject) => {
            listener = () => reject(new Error(`Harness hook timed out or was cancelled (${event}).`));
            if (scoped.aborted) listener();
            else scoped.addEventListener('abort', listener, { once: true });
          }),
        ]);
        if (decision?.deny) throw new Error(`Harness hook denied ${event}: ${decision.deny.slice(0, 500)}`);
      } finally {
        scoped.removeEventListener('abort', listener);
      }
    }
  }
}
