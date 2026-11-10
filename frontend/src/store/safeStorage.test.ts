import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedJsonStorage } from './safeStorage';

type S = { n: number };

/** Minimal browser stand-ins (the project has no jsdom): a Map-backed localStorage plus window / document event targets. */
function installFakeBrowser() {
  const data = new Map<string, string>();
  const setItem = vi.fn((k: string, v: string) => { data.set(k, v); });
  const localStorageFake = {
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem,
    removeItem: (k: string) => { data.delete(k); },
  };
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as string });
  vi.stubGlobal('localStorage', localStorageFake);
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  return { data, setItem, win, doc };
}

describe('createDebouncedJsonStorage', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces a burst of writes into ONE localStorage write holding the latest value', () => {
    const b = installFakeBrowser();
    const st = createDebouncedJsonStorage<S>(400);
    for (let i = 1; i <= 50; i++) st.setItem('k', { state: { n: i }, version: 1 });
    expect(b.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(b.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(b.data.get('k') as string)).toEqual({ state: { n: 50 }, version: 1 });
  });

  it('read-after-write sees the pending value before it is flushed', () => {
    const b = installFakeBrowser();
    const st = createDebouncedJsonStorage<S>(400);
    st.setItem('k', { state: { n: 7 }, version: 1 });
    expect(b.data.has('k')).toBe(false);
    expect(st.getItem('k')).toEqual({ state: { n: 7 }, version: 1 });
  });

  it('flushes immediately when the page is hidden, so nothing is lost on exit', () => {
    const b = installFakeBrowser();
    const st = createDebouncedJsonStorage<S>(400);
    st.setItem('k', { state: { n: 3 }, version: 1 });
    (b.doc as { visibilityState: string }).visibilityState = 'hidden';
    b.doc.dispatchEvent(new Event('visibilitychange'));
    expect(JSON.parse(b.data.get('k') as string)).toEqual({ state: { n: 3 }, version: 1 });
  });

  it('flushes on pagehide', () => {
    const b = installFakeBrowser();
    const st = createDebouncedJsonStorage<S>(400);
    st.setItem('k', { state: { n: 9 }, version: 1 });
    b.win.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(b.data.get('k') as string).state.n).toBe(9);
  });

  it('does not flush while the page is merely visible', () => {
    const b = installFakeBrowser();
    const st = createDebouncedJsonStorage<S>(400);
    st.setItem('k', { state: { n: 1 }, version: 1 });
    b.doc.dispatchEvent(new Event('visibilitychange')); // still 'visible'
    expect(b.setItem).not.toHaveBeenCalled();
  });

  it('reads a value that was already stored, and survives corrupt or missing data', () => {
    const b = installFakeBrowser();
    b.data.set('good', JSON.stringify({ state: { n: 1 }, version: 1 }));
    b.data.set('bad', '{not json');
    const st = createDebouncedJsonStorage<S>(400);
    expect(st.getItem('good')).toEqual({ state: { n: 1 }, version: 1 });
    expect(st.getItem('bad')).toBeNull();
    expect(st.getItem('missing')).toBeNull();
  });

  it('removeItem drops a pending write and the stored value', () => {
    const b = installFakeBrowser();
    const st = createDebouncedJsonStorage<S>(400);
    st.setItem('k', { state: { n: 1 }, version: 1 });
    st.removeItem('k');
    vi.advanceTimersByTime(1000);
    expect(b.data.has('k')).toBe(false);
  });
});
