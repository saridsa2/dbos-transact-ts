import { describe, it, expect, vi } from 'vitest';
import { SecretVault } from '../../control/secrets';
import { historyModelCall, prepareHistory, HistoryPending, observationSchema, cleanHistoryMessage } from './history';
import { sessionHistory, type AgentContextInput } from '../context';

function host() {
  const rows = new Map<string, any>();
  const vault = new SecretVault(Buffer.alloc(32, 4));
  const service: any = {
    control: { vault },
    pool: {
      query: vi.fn(async (sql: string, p: any[]) => {
        if (sql.startsWith('SELECT')) return { rows: [...rows.values()].filter((r) => r.key === p[2]) };
        if (sql.startsWith('INSERT')) rows.set(p[1], { id: p[1], key: p[4], state: 'issued', request: p[6] });
        if (sql.startsWith('UPDATE'))
          Object.assign(rows.get(p[1]), {
            state: sql.includes("state='failed'") ? 'failed' : 'completed',
            result: p[2],
            private_result: p[3],
          });
        return { rows: [] };
      }),
    },
    budgets: { reserve: vi.fn(async () => ({ allowed: true, outputTokens: 1000 })), settle: vi.fn() },
  };
  const model = {
    complete: vi.fn(async () => ({
      text: '',
      calls: [
        {
          id: 'observation',
          name: 'record_history_observation',
          arguments: { items: [{ kind: 'finding', text: 'Account requires verification.' }], remainingWork: [] },
        },
      ] as any[],
      usage: { input: 100, output: 40 },
      model: 'fixture',
      responseId: 'one',
    })),
  };
  const input = {
    service,
    model,
    workspace: 'w',
    workId: 'a',
    turn: 4,
    modelName: 'fixture',
    secret: 'local',
    signal: new AbortController().signal,
    scopeHash: 'scope',
    historyCalls: { remaining: 4 },
  } as unknown as AgentContextInput;
  return { input, model, service, rows };
}
describe('durable history model boundary', () => {
  it('reuses the encrypted completed response and settles without repeating a provider call', async () => {
    const { input, model, service, rows } = host();
    const first = await historyModelCall(input, 'observe', { text: 'evidence' }, 'same');
    expect(await historyModelCall(input, 'observe', { text: 'evidence' }, 'same')).toEqual(first);
    expect(model.complete).toHaveBeenCalledOnce();
    expect(service.budgets.reserve).toHaveBeenCalledOnce();
    expect(JSON.stringify([...rows.values()])).not.toContain('Account requires verification');
  });
  it('rejects the reported fenced JSON prose and repairs using only the internal result tool', async () => {
    const { input, model, service } = host();
    model.complete.mockResolvedValueOnce({
      text: '```json\n{"items":[],"remainingWork":[]}\n```',
      calls: [],
      usage: { input: 10, output: 8 },
      model: 'fixture',
      responseId: 'reported-format',
    });
    await historyModelCall(input, 'observe', {}, 'fenced-prose');
    const calls = model.complete.mock.calls as unknown[][];
    for (const [request] of calls) {
      const r = request as any;
      expect(r.tools.map((t: any) => t.function.name)).toEqual(['record_history_observation']);
      expect(r.toolChoice).toEqual({ type: 'function', function: { name: 'record_history_observation' } });
    }
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(service.budgets.settle).toHaveBeenCalledTimes(2);
  });
  it('defers a rejected work-history reflection and keeps the prior checkpoint and original receipt cursor', async () => {
    const { input, service, model } = host();
    service.authorize = vi.fn(async () => ({ ctx: {}, work: {} }));
    service.memory = { scope: vi.fn(async () => ({ hash: 'scope' })) };
    service.features = { event: vi.fn() };
    const summary = {
      items: Array.from({ length: 25 }, () => ({ kind: 'finding', text: 'Previously validated evidence.' })),
      remainingWork: [],
    };
    const head = {
      generation: 3,
      cursor: '42',
      summary: service.control.vault.seal(JSON.stringify(summary), 'history:w:work:a:observational_v1:scope:3'),
    };
    const query = service.pool.query.getMockImplementation()!;
    service.pool.query.mockImplementation(async (sql: string, p: any[]) =>
      sql.includes('SELECT * FROM wa_history_heads') ? { rows: [head] } : query(sql, p),
    );
    model.complete.mockResolvedValue({
      text: '',
      calls: [
        {
          id: 'bad',
          name: 'record_history_observation',
          arguments: { items: [{ kind: 'remainingWork', text: 'Still outstanding' }], remainingWork: [] },
        },
      ],
      usage: { input: 10, output: 8 },
      model: 'fixture',
      responseId: 'invalid-kind',
    });
    const result = await prepareHistory(input, 'work', 'session', 0);
    expect(result).toMatchObject({ generation: 3, cursor: '42', summary });
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(service.features.event).toHaveBeenCalledWith(
      'w',
      'a',
      expect.any(String),
      'history_deferred',
      expect.objectContaining({ generation: 3 }),
    );
    expect(service.pool.query.mock.calls.some(([sql]: any[]) => sql.includes('INSERT INTO wa_history_heads'))).toBe(
      false,
    );
  });
  it('never repeats an issued call with an unknown outcome', async () => {
    const { input, model, rows } = host();
    model.complete.mockRejectedValueOnce(Error('connection lost'));
    await expect(historyModelCall(input, 'observe', {}, 'unknown')).rejects.toThrow('connection lost');
    expect([...rows.values()][0].state).toBe('issued');
    await expect(historyModelCall(input, 'observe', {}, 'unknown')).rejects.toThrow('UNCERTAIN');
    expect(model.complete).toHaveBeenCalledOnce();
  });
  it('records invalid output as failed and charges a separate bounded repair', async () => {
    const { input, model, service, rows } = host();
    model.complete.mockResolvedValueOnce({
      text: 'invalid',
      calls: [],
      usage: { input: 10, output: 2 },
      model: 'fixture',
      responseId: 'bad',
    });
    const result = await historyModelCall(input, 'reflect', {}, 'bad');
    expect(result.items[0].kind).toBe('finding');
    expect([...rows.values()][0].state).toBe('failed');
    expect([...rows.values()][0].result.validation.status).toBe('invalid');
    expect([...rows.values()][1].request.repairOf).toBe([...rows.values()][0].id);
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect([...rows.values()][0].result.usage).toEqual({ input: 10, output: 2 });
    expect(service.budgets.settle).toHaveBeenCalledTimes(2);
  });
  it('repairs unsupported kinds without loosening the schema, and reuses both receipts on replay', async () => {
    const { input, model, service, rows } = host();
    const invalid = {
      items: [{ kind: 'constraint', text: 'An independent reviewer is required.' }],
      remainingWork: [],
    };
    model.complete.mockResolvedValueOnce({
      text: '',
      calls: [{ id: 'observation', name: 'record_history_observation', arguments: invalid }],
      usage: { input: 20, output: 10 },
      model: 'fixture',
      responseId: 'invalid-kind',
    });
    await historyModelCall(input, 'observe', { source: 'evidence' }, 'enum');
    const repair = (model.complete.mock.calls as unknown[][])[1][0] as any;
    expect(repair.messages[0].content).toContain('unchanged schema');
    expect(repair.tools[0].function.parameters.properties.items.items.properties.kind.enum).toEqual([
      'finding',
      'decision',
      'action',
      'question',
      'correction',
    ]);
    expect(repair.messages[1].content).toContain('items.0.kind');
    expect(repair.toolChoice.function.name).toBe('record_history_observation');
    await historyModelCall(input, 'observe', {}, 'enum');
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(service.budgets.reserve).toHaveBeenCalledTimes(2);
    expect([...rows.values()].map((r) => r.state)).toEqual(['failed', 'completed']);
    expect(JSON.stringify([...rows.values()])).not.toContain('independent reviewer');
  });
  it('stops after one invalid repair and never retries it during replay', async () => {
    const { input, model, rows } = host();
    model.complete.mockResolvedValue({
      text: '{"items":[{"kind":"constraint","text":"bounded"}],"remainingWork":[]}',
      calls: [],
      usage: { input: 20, output: 10 },
      model: 'fixture',
      responseId: 'invalid',
    });
    await expect(historyModelCall(input, 'observe', {}, 'twice')).rejects.toThrow('after one repair attempt');
    await expect(historyModelCall(input, 'observe', {}, 'twice')).rejects.toThrow('after one repair attempt');
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect([...rows.values()].map((r) => r.state)).toEqual(['failed', 'failed']);
  });
  it('never reissues a repair whose provider outcome is unknown', async () => {
    const { input, model } = host();
    model.complete.mockResolvedValueOnce({
      text: 'invalid',
      calls: [],
      usage: { input: 10, output: 2 },
      model: 'fixture',
      responseId: 'bad',
    });
    model.complete.mockRejectedValueOnce(Error('connection lost'));
    await expect(historyModelCall(input, 'observe', {}, 'repair-unknown')).rejects.toThrow('connection lost');
    await expect(historyModelCall(input, 'observe', {}, 'repair-unknown')).rejects.toThrow('UNCERTAIN');
    expect(model.complete).toHaveBeenCalledTimes(2);
  });
  it('checkpoints before a repair when the maintenance call allowance runs out', async () => {
    const { input, model } = host();
    input.historyCalls!.remaining = 1;
    model.complete.mockResolvedValueOnce({
      text: 'invalid',
      calls: [],
      usage: { input: 10, output: 2 },
      model: 'fixture',
      responseId: 'bad',
    });
    await expect(historyModelCall(input, 'observe', {}, 'yield-repair')).rejects.toBeInstanceOf(HistoryPending);
    expect(model.complete).toHaveBeenCalledOnce();
    input.historyCalls!.remaining = 4;
    await historyModelCall(input, 'observe', {}, 'yield-repair');
    expect(model.complete).toHaveBeenCalledTimes(2);
  });
  it('yields bounded preparation before issuing another call and respects the shared budget', async () => {
    const { input, model, service } = host();
    input.historyCalls!.remaining = 0;
    await expect(historyModelCall(input, 'observe', {}, 'next')).rejects.toBeInstanceOf(HistoryPending);
    expect(model.complete).not.toHaveBeenCalled();
    input.historyCalls!.remaining = 1;
    service.budgets.reserve.mockResolvedValueOnce({ allowed: false });
    await expect(historyModelCall(input, 'observe', {}, 'budget')).rejects.toThrow('BUDGET:');
    expect(model.complete).not.toHaveBeenCalled();
  });
  it('does not invoke maintenance models when the current policy disables compaction', async () => {
    const { input, service, model } = host();
    service.authorize = async () => ({
      work: { execution_snapshot: { definition: { memory: { history: 'observational_v1', working: 'compact' } } } },
    });
    input.options = { compact: false, contextBytes: 180000 } as any;
    service.pool.query.mockResolvedValueOnce({
      rows: Array.from({ length: 21 }, () => ({ role: 'user', content: 'Earlier context' })),
    });
    await expect(sessionHistory(input, 'session')).rejects.toThrow('policy has disabled');
    expect(model.complete).not.toHaveBeenCalled();
    expect(service.budgets.reserve).not.toHaveBeenCalled();
  });
  it('rejects oversized and non-schema output and removes private reasoning from history input', () => {
    expect(() =>
      observationSchema.parse({ items: [{ kind: 'finding', text: 'x'.repeat(12001) }], remainingWork: [] }),
    ).toThrow();
    expect(() => observationSchema.parse({ items: [], remainingWork: [], grantPermissions: true })).toThrow();
    expect(
      cleanHistoryMessage({
        role: 'assistant',
        content: 'Public result',
        reasoning_content: 'secret',
        thinking: 'secret',
      }),
    ).toEqual({ role: 'assistant', content: 'Public result' });
  });
});
