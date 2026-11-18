import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fresh module state (and an empty marker) for every test.
async function load() {
  vi.resetModules();
  return import('./uploadCompletion');
}

describe('trip completion tracking', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal('window', new EventTarget());
  });

  it('is done only when nothing is processing and no changes are waiting', async () => {
    const m = await load();
    expect(m.isTripProcessed(0, 0)).toBe(true);
    expect(m.isTripProcessed(3, 0)).toBe(false);
    expect(m.isTripProcessed(0, 2)).toBe(false);
  });

  it('does not announce while the server is still stitching, then announces exactly once', async () => {
    const m = await load();
    const seen: unknown[] = [];
    window.addEventListener(m.UPLOAD_TRIP_COMPLETE_EVENT, e => seen.push((e as CustomEvent).detail));
    m.armTripCompletion(35, 0);
    expect(m.completeTripIfDone({ stitching: 7, writesPending: 0, failed: [] })).toBe(false);
    expect(seen).toHaveLength(0);
    expect(m.completeTripIfDone({ stitching: 0, writesPending: 0, failed: [] })).toBe(true);
    expect(m.completeTripIfDone({ stitching: 0, writesPending: 0, failed: [] })).toBe(false); // already told
    expect(seen).toEqual([{ total: 35, needAttention: 0 }]);
    expect(m.getPendingCompletion()).toBeNull();
  });

  it('survives an app restart through localStorage', async () => {
    const m1 = await load();
    m1.armTripCompletion(12, 1);
    vi.resetModules();
    const m2 = await import('./uploadCompletion'); // new module instance, same storage
    expect(m2.getPendingCompletion()?.total).toBe(12);
  });

  it('ignores an empty batch and a cleared one', async () => {
    const m = await load();
    m.armTripCompletion(0, 0);
    expect(m.getPendingCompletion()).toBeNull();
    m.armTripCompletion(5, 0);
    m.clearTripCompletion();
    expect(m.completeTripIfDone({ stitching: 0, writesPending: 0, failed: [] })).toBe(false);
  });

  it('words the result honestly, including photos that need attention', async () => {
    const m = await load();
    expect(m.describeTripResult({ total: 35, needAttention: 0 })).toMatchObject({ ok: true, title: 'Trip uploaded' });
    const bad = m.describeTripResult({ total: 35, needAttention: 2 });
    expect(bad.ok).toBe(false);
    expect(bad.body).toContain('33 of 35 photos processed');
    expect(bad.body).toContain('2 need attention');
    expect(m.describeTripResult({ total: 1, needAttention: 1 }).body).toContain('1 needs attention');
  });
});
