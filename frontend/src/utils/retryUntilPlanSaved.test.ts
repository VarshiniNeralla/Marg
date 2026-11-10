import { describe, expect, it, vi } from 'vitest';

vi.mock('@services/apiClient', () => ({
  normaliseError: (e: { status?: number; message?: string }) => ({ status: e?.status ?? 0, message: e?.message ?? '' }),
}));

import { retryUntilPlanSaved } from './retryUntilPlanSaved';

const notSaved = { status: 422, message: 'source or target floor plan not found' };

describe('retryUntilPlanSaved', () => {
  it('retries the "plan not saved yet" refusal until it succeeds', async () => {
    const call = vi.fn().mockRejectedValueOnce(notSaved).mockRejectedValueOnce(notSaved).mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await retryUntilPlanSaved(call, { sleep })).toBe('ok');
    expect(call).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('fails immediately on any other error', async () => {
    const other = { status: 422, message: 'source floor has no labeled predefined pins' };
    const call = vi.fn().mockRejectedValue(other);
    const sleep = vi.fn();
    await expect(retryUntilPlanSaved(call, { sleep })).rejects.toBe(other);
    expect(call).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the maximum wait', async () => {
    let t = 0;
    const call = vi.fn().mockRejectedValue(notSaved);
    await expect(retryUntilPlanSaved(call, {
      maxWaitMs: 10_000, delayMs: 4000, now: () => t, sleep: async ms => { t += ms; },
    })).rejects.toBe(notSaved);
    expect(call.mock.calls.length).toBeGreaterThan(1);
    expect(call.mock.calls.length).toBeLessThan(6);
  });
});
