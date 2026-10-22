import { describe, it, expect, vi } from 'vitest';
import { readSetupProgress } from './setup-progress';
describe('setup progress snapshots', () => {
  it('waits for work status before exposing the next setup snapshot', async () => {
    let resolveWork!: (work: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ id: 'setup', request: { work_item_id: 'work' } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveWork = resolve;
          }),
      );
    let published = false;
    const pending = readSetupProgress(request, 'setup').then((snapshot) => {
      published = true;
      return snapshot;
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('work-items/work'));
    expect(published).toBe(false);
    resolveWork({ id: 'work', state: 'reasoning' });
    expect((await pending).work.state).toBe('reasoning');
  });
  it('keeps intake rejection visible without requesting missing work', async () => {
    const request = vi.fn().mockResolvedValue({ id: 'setup', request: { state: 'rejected' } });
    expect((await readSetupProgress(request, 'setup')).request.state).toBe('rejected');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not replace a current snapshot when the work request fails', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ request: { work_item_id: 'work' } })
      .mockRejectedValueOnce(new Error('Temporary network error'));
    await expect(readSetupProgress(request, 'setup')).rejects.toThrow('Temporary network error');
  });
});
