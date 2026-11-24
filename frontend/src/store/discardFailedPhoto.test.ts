import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake phone: in-memory localStorage, saved settings (Preferences) and files, so the REAL queue code runs unchanged.
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
  return { ls, prefs: new Map<string, string>(), deleted: [] as string[] };
});

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: h.prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { h.prefs.set(key, value); },
    remove: async ({ key }: { key: string }) => { h.prefs.delete(key); },
  },
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Cache: 'CACHE' },
  Filesystem: {
    mkdir: async () => {},
    writeFile: async () => {},
    appendFile: async () => {},
    stat: async () => ({ size: 1024 }),
    copy: async () => { throw new Error('no camera original'); },
    deleteFile: async ({ path }: { path: string }) => { h.deleted.push(path); },
    readFile: async () => ({ data: '' }),
    getUri: async ({ path }: { path: string }) => ({ uri: `file://${path}` }),
  },
}));
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: async () => ({ connected: false, connectionType: 'none' }),
    addListener: async () => ({ remove: async () => {} }),
  },
}));

const QUEUE_KEY = 'sitesurelabs-file-upload-queue-v1';

const failedEntry = (over: Record<string, unknown> = {}) => ({
  id: 'fq1', pinId: 'pinX', fileUri: 'pending-uploads/x.insp', fileName: 'x.insp', mimeType: 'application/octet-stream',
  attempts: 1, createdAt: 1, status: 'failed', failKind: 'stitch', errorMessage: '422: Could not stitch x.insp',
  stitchJobId: 'job1', bytesReady: true, ...over,
});

function seed(entries: unknown[]) {
  h.prefs.set(QUEUE_KEY, JSON.stringify(entries));
}

function saved(): { pinId: string }[] {
  return JSON.parse(h.prefs.get(QUEUE_KEY) ?? '[]');
}

async function freshQueue() {
  vi.resetModules();
  const queue = await import('./fileUploadQueue');
  const { useWorkflowStore } = await import('./workflowStore');
  return { queue, useWorkflowStore };
}

beforeEach(() => {
  h.prefs.clear();
  h.ls.clear();
  h.deleted.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('discardFailedPhoto', () => {
  it('removes the failed photo from the queue, deletes its file, and unlinks the dead capture', async () => {
    seed([failedEntry(), failedEntry({ id: 'fq2', pinId: 'pinY', fileUri: 'pending-uploads/y.insp', stitchJobId: 'job2' })]);
    const { queue, useWorkflowStore } = await freshQueue();
    const unlink = vi.spyOn(useWorkflowStore.getState(), 'discardStitchFailedCapture');

    await queue.discardFailedPhoto('pinX');

    expect(saved().map(e => e.pinId)).toEqual(['pinY']);        // only that point's photo is gone
    expect(h.deleted).toEqual(['pending-uploads/x.insp']);      // its file is deleted, nobody else's
    expect(unlink).toHaveBeenCalledWith('pinX', 'job1');        // the dead capture no longer sits on the point
    expect(queue.fileUploadErrorForPin('pinX')).toBeUndefined();
  });

  it('still works for a photo that has no server job (a plain failed upload)', async () => {
    seed([failedEntry({ failKind: 'upload', stitchJobId: undefined })]);
    const { queue, useWorkflowStore } = await freshQueue();
    const unlink = vi.spyOn(useWorkflowStore.getState(), 'discardStitchFailedCapture');

    await queue.discardFailedPhoto('pinX');

    expect(saved()).toEqual([]);
    expect(h.deleted).toEqual(['pending-uploads/x.insp']);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('does nothing harmful when the point has no queued photo', async () => {
    seed([failedEntry({ pinId: 'other' })]);
    const { queue } = await freshQueue();
    await expect(queue.discardFailedPhoto('missing')).resolves.toBeUndefined();
    expect(saved().length).toBe(1);
    expect(h.deleted).toEqual([]);
  });

  it('tells an open panel the queue changed so the list refreshes at once', async () => {
    seed([failedEntry()]);
    const { queue } = await freshQueue();
    const target = new EventTarget();
    vi.stubGlobal('window', target); // the events only fire where there is a window
    let changed = 0;
    target.addEventListener(queue.FILE_QUEUE_CHANGED_EVENT, () => { changed++; });
    await queue.discardFailedPhoto('pinX');
    expect(changed).toBeGreaterThan(0);
  });

  it('shows plain wording, not the technical text, for a failed photo that is still waiting', async () => {
    seed([failedEntry()]);
    const { queue } = await freshQueue();
    await queue.waitingPhotoInfos(); // loads the saved queue
    const message = queue.fileUploadErrorForPin('pinX') ?? '';
    expect(message).not.toMatch(/422|stitch|\.insp/i);
    expect(message.length).toBeGreaterThan(10);
  });
});
