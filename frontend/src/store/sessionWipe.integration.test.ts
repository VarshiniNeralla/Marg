/**
 * The first deliverable of the offline feature, tested on the REAL sessionIsolation code:
 * logging in again, logging out and an expired session never delete waiting photos, their files or unsent changes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const ls = new Map<string, string>();
  const refuse = { writes: false };
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => { if (!refuse.writes) ls.set(k, String(v)); },
    removeItem: (k: string) => { ls.delete(k); },
    clear: () => ls.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return {
    ls,
    refuse,
    waitingPhotos: 0,
    pendingWrites: 0,
    resetToSeed: vi.fn(),
    retryApiSnapshot: vi.fn(),
    rehydrate: vi.fn(async () => {}),
    clearWriteQueue: vi.fn(),
    replaceWriteQueueFromRaw: vi.fn(),
    clearFileUploadQueue: vi.fn(async () => {}),
    claimUnownedPhotos: vi.fn(async () => {}),
    queryClear: vi.fn(),
    lockedToOthers: 0,
    writeQueueRaw: '[{"id":"w1"}]',
  };
});

vi.mock('@/services/queryClient', () => ({ queryClient: { clear: h.queryClear } }));
vi.mock('./workflowStore', () => ({
  useWorkflowStore: Object.assign(() => ({}), {
    getState: () => ({ resetToSeed: h.resetToSeed, retryApiSnapshot: h.retryApiSnapshot }),
    persist: { rehydrate: h.rehydrate },
  }),
}));
vi.mock('./settingsStore', () => ({ useSettingsStore: { getState: () => ({ resetToDefaults: vi.fn() }) } }));
vi.mock('./writeQueue', () => ({
  clearWriteQueue: h.clearWriteQueue,
  exportWriteQueueRaw: () => h.writeQueueRaw,
  pendingWriteCount: () => h.pendingWrites,
  replaceWriteQueueFromRaw: h.replaceWriteQueueFromRaw,
}));
vi.mock('./fileUploadQueue', () => ({
  waitingPhotoCount: async () => h.waitingPhotos,
  photosLockedToOthers: async () => h.lockedToOthers,
  claimUnownedPhotos: h.claimUnownedPhotos,
  clearFileUploadQueue: h.clearFileUploadQueue,
}));

import { endClientSession, previewLoginTransition, startClientSession } from './sessionIsolation';
import { WORKFLOW_STORE_KEY } from './persistence';
import { LAST_USER_KEY, parkedKey } from './uploadOwnership';

beforeEach(() => {
  h.ls.clear();
  h.refuse.writes = false;
  h.waitingPhotos = 0;
  h.pendingWrites = 0;
  h.lockedToOthers = 0;
  vi.clearAllMocks();
});

function expectNothingDeleted() {
  expect(h.resetToSeed).not.toHaveBeenCalled();
  expect(h.clearWriteQueue).not.toHaveBeenCalled();
  expect(h.clearFileUploadQueue).not.toHaveBeenCalled();
}

describe('waiting photos survive every way a session can end', () => {
  beforeEach(() => {
    h.waitingPhotos = 12;
    h.ls.set(LAST_USER_KEY, 'u1');
  });

  it('logout with photos waiting deletes nothing', async () => {
    await endClientSession('logout');
    expectNothingDeleted();
  });

  it('an expired session (server confirmed) deletes nothing', async () => {
    await endClientSession('expired');
    expectNothingDeleted();
  });

  it('unsent pin/capture changes alone also protect everything', async () => {
    h.waitingPhotos = 0;
    h.pendingWrites = 4;
    await endClientSession('logout');
    expectNothingDeleted();
  });

  it('the same person logging in again keeps photos, files and unsent changes', async () => {
    const ok = await startClientSession('u1');
    expect(ok).toBe(true);
    expectNothingDeleted();
    expect(h.ls.get(parkedKey('u1'))).toBeUndefined(); // nothing needed parking
    expect(h.ls.get(LAST_USER_KEY)).toBe('u1');
  });
});

describe('a different person logging in', () => {
  beforeEach(() => {
    h.waitingPhotos = 7;
    h.ls.set(LAST_USER_KEY, 'u1');
    h.ls.set(WORKFLOW_STORE_KEY, '{"state":{"capturePins":["pin-of-u1"]},"version":3}');
  });

  it('is told about the other person\'s waiting photos before anything happens', async () => {
    h.lockedToOthers = 7;
    const preview = await previewLoginTransition('u2');
    expect(preview).toEqual({ lockedPhotos: 7, differentPerson: true });
    expectNothingDeleted(); // previewing changes nothing
  });

  it('parks the first person\'s work, never deletes their photos, and gives the new person a clean store', async () => {
    const ok = await startClientSession('u2');
    expect(ok).toBe(true);

    // The first person's floors/pins and unsent changes are safe in a parked copy...
    const parked = JSON.parse(h.ls.get(parkedKey('u1'))!) as { workflow: string; writes: string };
    expect(parked.workflow).toContain('pin-of-u1');
    expect(parked.writes).toBe(h.writeQueueRaw);
    // ...their photos were pinned to them, and were NOT cleared from the file queue.
    expect(h.claimUnownedPhotos).toHaveBeenCalledWith('u1');
    expect(h.clearFileUploadQueue).not.toHaveBeenCalled();
    // The new person starts clean.
    expect(h.resetToSeed).toHaveBeenCalled();
    expect(h.clearWriteQueue).toHaveBeenCalled();
    expect(h.ls.get(LAST_USER_KEY)).toBe('u2');
  });

  it('hands the work back when the first person signs in again', async () => {
    await startClientSession('u2');
    h.ls.set(WORKFLOW_STORE_KEY, '{"state":{"capturePins":[]},"version":3}'); // u2's (empty) store
    h.waitingPhotos = 0; // u2 has nothing of their own waiting
    vi.clearAllMocks();

    await startClientSession('u1');
    expect(h.ls.get(WORKFLOW_STORE_KEY)).toContain('pin-of-u1'); // u1's store is back
    expect(h.rehydrate).toHaveBeenCalled();
    expect(h.replaceWriteQueueFromRaw).toHaveBeenCalledWith(h.writeQueueRaw);
    expect(h.ls.get(parkedKey('u1'))).toBeUndefined(); // handed back, parked copy removed
    expect(h.clearFileUploadQueue).toHaveBeenCalledTimes(1); // only because nothing of u2's was waiting
  });

  it('REFUSES to go on if the first person\'s work cannot be copied safely (nothing is reset)', async () => {
    h.refuse.writes = true; // e.g. storage full
    const ok = await startClientSession('u2');
    expect(ok).toBe(false);
    expectNothingDeleted();
  });
});

describe('nothing waiting: the normal clean-up still happens', () => {
  it('logout clears everything', async () => {
    h.ls.set(LAST_USER_KEY, 'u1');
    await endClientSession('logout');
    expect(h.resetToSeed).toHaveBeenCalled();
    expect(h.clearFileUploadQueue).toHaveBeenCalled();
  });

  it('a different person logging in gets a clean store with no parking', async () => {
    h.ls.set(LAST_USER_KEY, 'u1');
    expect(await startClientSession('u2')).toBe(true);
    expect(h.resetToSeed).toHaveBeenCalled();
    expect(h.ls.get(parkedKey('u1'))).toBeUndefined();
  });
});

describe('one company never sees another company data on the same device', () => {
  it('owner not recorded + writes waiting: the previous data is parked and the store is reset for the new person', async () => {
    h.pendingWrites = 2;
    h.ls.set(WORKFLOW_STORE_KEY, '{"state":{"captures":["my-home-capture"]}}');
    const ok = await startClientSession('kohinoor-manager', 'kohinoor-org');
    expect(ok).toBe(true);
    expect(h.resetToSeed).toHaveBeenCalledTimes(1);                       // not left on screen
    expect(h.ls.get(parkedKey('unattributed'))).toContain('my-home-capture'); // ...and not deleted
    expect(h.clearFileUploadQueue).not.toHaveBeenCalled();
  });

  it('data recorded for another company is parked even when the same user id is reused', async () => {
    h.pendingWrites = 1;
    h.ls.set(LAST_USER_KEY, 'u1');
    h.ls.set('sitesurelabs-store-tenant-v1', 'myhome-org');
    h.ls.set(WORKFLOW_STORE_KEY, '{"state":{"captures":["x"]}}');
    await startClientSession('u1', 'kohinoor-org');
    expect(h.resetToSeed).toHaveBeenCalledTimes(1);
    expect(h.ls.get('sitesurelabs-store-tenant-v1')).toBe('kohinoor-org');
  });

  it('the same person in the same company keeps their live data', async () => {
    h.pendingWrites = 1;
    h.ls.set(LAST_USER_KEY, 'u1');
    h.ls.set('sitesurelabs-store-tenant-v1', 'myhome-org');
    await startClientSession('u1', 'myhome-org');
    expect(h.resetToSeed).not.toHaveBeenCalled();
  });
});
