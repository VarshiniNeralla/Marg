/**
 * Changes recorded under one company's login are never sent while another company is signed in
 * (they stay in the queue, so nothing is lost, and go out only for the company that made them).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const ls = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => { ls.set(k, String(v)); },
    removeItem: (k: string) => { ls.delete(k); },
    clear: () => ls.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  Object.assign(globalThis, { addEventListener: () => {}, removeEventListener: () => {}, window: globalThis, location: { href: "http://localhost/" }, document: { addEventListener: () => {}, visibilityState: "visible" } });
  return { ls, org: 'org-myhome', sent: [] as unknown[][] };
});

vi.mock('@capacitor/network', () => ({ Network: { addListener: vi.fn(), getStatus: async () => ({ connected: true }) } }));
vi.mock('@/services/workflowApiService', () => ({
  workflowApiService: {
    createCapture: vi.fn(async (...a: unknown[]) => { h.sent.push(a); return {}; }),
  },
}));
vi.mock('./authStore', () => ({
  isFieldEngineer: () => false,
  useAuthStore: { getState: () => ({ isAuthenticated: true, user: { org_id: h.org, role: 'admin' } }) },
}));
vi.mock('./tombstones', () => ({ isTombstoned: () => false }));
vi.mock('./uploadHold', () => ({ isHeldWriteOp: () => false, isUploadHeld: () => false }));

import { clearWriteQueue, enqueueWrite, flushWriteQueue, pendingWriteCount } from './writeQueue';

const tick = () => new Promise(r => setTimeout(r, 20));

beforeEach(() => {
  h.sent.length = 0;
  h.org = 'org-myhome';
  clearWriteQueue();
});

describe('write queue and company boundaries', () => {
  it('sends a change for the company that is signed in', async () => {
    enqueueWrite('createCapture', [{ id: 'c1' }] as never);
    await tick();
    expect(h.sent).toHaveLength(1);
    expect(pendingWriteCount()).toBe(0);
  });

  it('a change made by one company is NOT sent after another company signs in, and is not lost', async () => {
    const w = await import('./writeQueue');
    h.org = 'org-kohinoor';                                    // Kohinoor signs in on a browser that still holds this
    w.replaceWriteQueueFromRaw(JSON.stringify([
      { id: 'wq1', op: 'createCapture', args: [{ id: 'c-stale' }], attempts: 0, createdAt: 1, tenant: 'org-myhome' },
    ]));
    flushWriteQueue();
    await tick();
    expect(h.sent).toHaveLength(0);                            // never sent into Kohinoor
    expect(pendingWriteCount()).toBe(1);                       // and still kept

    h.org = 'org-myhome';                                      // goes out only when its own company is back
    flushWriteQueue();
    await tick();
    expect(h.sent).toHaveLength(1);
    expect(pendingWriteCount()).toBe(0);
  });

  it('a foreign change does not block this company own changes', async () => {
    const w = await import('./writeQueue');
    h.org = 'org-kohinoor';
    w.replaceWriteQueueFromRaw(JSON.stringify([
      { id: 'wq1', op: 'createCapture', args: [{ id: 'c-stale' }], attempts: 0, createdAt: 1, tenant: 'org-myhome' },
    ]));
    enqueueWrite('createCapture', [{ id: 'c-kohinoor' }] as never);
    await tick();
    expect(h.sent).toHaveLength(1);
    expect((h.sent[0][0] as { id: string }).id).toBe('c-kohinoor');
    expect(pendingWriteCount()).toBe(1);                       // the foreign one is still waiting
  });

  it('older queued changes without a company tag still go out (the server refuses foreign ones)', async () => {
    const w = await import('./writeQueue');
    h.org = 'org-kohinoor';
    w.replaceWriteQueueFromRaw(JSON.stringify([
      { id: 'wq1', op: 'createCapture', args: [{ id: 'c-legacy' }], attempts: 0, createdAt: 1 },
    ]));
    await tick();
    expect(h.sent).toHaveLength(1);
  });
});
