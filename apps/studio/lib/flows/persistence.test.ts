import { describe, expect, it, vi } from 'vitest';
import { saveWorkflowDraft } from './persistence';
import { scopedExamples } from '../authoring/examples';

describe('workflow settings persistence', () => {
  it('saves declarations and graph together, retaining stable variable IDs and current run defaults', async () => {
    const flow = structuredClone(scopedExamples()[0].flow);
    flow.declarations![0] = {
      ...flow.declarations![0],
      name: 'Renamed multiplier',
      writable: false,
      initial: { mode: 'fixed', value: 9 },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => Response.json(JSON.parse(init!.body as string)));
    const saved = await saveWorkflowDraft(
      flow,
      JSON.stringify({ variables: { items: [1, 2, 3], factor: 9 } }),
      request,
    );
    expect(request.mock.calls[0][1]?.method).toBe('PUT');
    expect(saved.declarations![0]).toMatchObject({
      id: 'factor',
      name: 'Renamed multiplier',
      writable: false,
      initial: { value: 9 },
    });
    expect(saved.defaultInput?.variables?.factor).toBe(9);
    expect(saved.nodes).toEqual(flow.nodes);
    expect(flow.defaultInput?.variables?.factor).toBe(3);
  });
  it('rejects failed saves so the settings dialog can keep the changes open', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: 'Workspace access denied.' }, { status: 403 }));
    await expect(saveWorkflowDraft(scopedExamples()[0].flow, '{}', request)).rejects.toThrow(
      'Workspace access denied.',
    );
  });
  it('does not submit malformed run defaults or silently replace them', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(saveWorkflowDraft(scopedExamples()[0].flow, '{', request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
