import { normaliseError } from '@services/apiClient';

/** The server's own message when a floor plan has not been saved there yet. */
const PLAN_NOT_SAVED = /floor plan not found/i;

/**
 * Importing annotations needs the target floor's plan to exist on the server. A plan that was just uploaded is
 * saved through the (serial) write queue, and each save can take minutes (the server reads the plan's rooms
 * during it), so an import started right after the upload can reach the server first and be refused with
 * "source or target floor plan not found". That is temporary: keep retrying that one error until the plan
 * is saved, and fail immediately on anything else.
 */
export async function retryUntilPlanSaved<T>(
  call: () => Promise<T>,
  opts: { delayMs?: number; maxWaitMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<T> {
  const delayMs = opts.delayMs ?? 4000;
  const maxWaitMs = opts.maxWaitMs ?? 6 * 60 * 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const started = now();
  for (;;) {
    try {
      return await call();
    } catch (err) {
      const e = normaliseError(err);
      const retryable = e.status === 422 && PLAN_NOT_SAVED.test(e.message || '');
      if (!retryable || now() - started >= maxWaitMs) throw err;
      await sleep(delayMs);
    }
  }
}
