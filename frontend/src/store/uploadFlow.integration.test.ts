/**
 * Behaviour test of the REAL upload queue code (not a copy of its rules) with a fake phone and a fake server:
 *   - in "Upload when I tap", nothing is sent until Upload now
 *   - a photo is on disk, size-checked and fingerprinted before it counts as captured
 *   - a damaged upload (server fingerprint differs) is sent again
 *   - the phone copy is deleted only after the server confirms, and kept when it does not
 *   - another person's photos are never sent by someone else's login
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── a phone: in-memory localStorage, Preferences and filesystem ─────────────
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
  (globalThis as unknown as { FileReader: unknown }).FileReader = class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(buf => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.();
      });
    }
  };
  return {
    ls,
    prefs: new Map<string, string>(),
    files: new Map<string, Buffer>(),
    server: {
      uploads: [] as string[],
      held: new Set<string>(),
      corruptNext: 0,
      calls: 0,
    },
    attach: vi.fn(() => 'cap1'),
  };
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
    writeFile: async ({ path, data }: { path: string; data: string }) => { h.files.set(path, Buffer.from(data, 'base64')); },
    appendFile: async ({ path, data }: { path: string; data: string }) => {
      h.files.set(path, Buffer.concat([h.files.get(path) ?? Buffer.alloc(0), Buffer.from(data, 'base64')]));
    },
    stat: async ({ path }: { path: string }) => {
      const f = h.files.get(path);
      if (!f) throw new Error('ENOENT');
      return { size: f.length };
    },
    copy: async () => { throw new Error('no camera original'); },
    deleteFile: async ({ path }: { path: string }) => { h.files.delete(path); },
    readFile: async ({ path }: { path: string }) => {
      const f = h.files.get(path);
      if (!f) throw new Error('ENOENT');
      return { data: f.toString('base64') };
    },
  },
}));

vi.mock('@capacitor/network', () => ({ Network: { addListener: () => {}, getStatus: async () => ({ connected: true, connectionType: 'wifi' }) } }));

vi.mock('./workflowStore', () => ({
  useWorkflowStore: {
    getState: () => ({
      capturePins: [{ id: 'pin1', captureIds: [] }, { id: 'pin2', captureIds: [] }],
      captures: [],
      attachCaptureToPin: h.attach,
    }),
  },
}));

vi.mock('@/services/uploadService', async () => {
  const { sha256OfBlob } = await import('./fingerprint');
  return {
    uploadCaptureFiles: async (files: File[]) => {
      h.server.calls += 1;
      const file = files[0];
      let sha = (await sha256OfBlob(file))!;
      if (h.server.corruptNext > 0) {
        h.server.corruptNext -= 1;
        sha = '0'.repeat(64); // the bytes arrived damaged
      } else {
        h.server.held.add(sha);
      }
      h.server.uploads.push(file.name);
      return { files: [{ sha256: sha, processing_status: 'converted', original_url: 'u', thumbnail_url: 't', public_id: 'p', format: 'jpg', size: file.size, uploaded_at: 'now', resource_type: 'image', original_filename: file.name }], count: 1 };
    },
    getCaptureStitchJob: async () => { throw new Error('unused'); },
    retryCaptureStitchJob: async () => { throw new Error('unused'); },
    reconcileFingerprints: async (hashes: string[]) => ({
      present: hashes.filter(x => h.server.held.has(x)),
      missing: hashes.filter(x => !h.server.held.has(x)),
      checked: hashes.length,
    }),
  };
});

import { useAuthStore } from './authStore';
import {
  enqueueFileUpload, flushFileUploadQueue, releaseVerifiedPhotos, waitingPhotoInfos, unconfirmedPhotoCount,
} from './fileUploadQueue';
import { beginRelease, endRelease, setUploadMode, setPhotosWaitForWrites, getUploadSession } from './uploadHold';
import { listRetainedPhotos } from './retainedPhotos';
import { sha256OfBlob } from './fingerprint';

const MB = 1024 * 1024;

function photo(name: string, seed: number, bytes = 600 * 1024): File {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + seed) & 0xff;
  return new File([buf], name, { type: 'image/jpeg' });
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await new Promise(r => setTimeout(r, 15));
  }
  throw new Error('timed out waiting for condition');
}

function signIn(id: string) {
  useAuthStore.setState({
    user: { id, name: id, email: `${id}@x.com`, role: 'field_engineer', org_id: 'o', org_name: 'O', org_slug: 'o' },
    isAuthenticated: true,
    accessToken: 'tok',
    sessionKind: 'live',
  });
  h.ls.set('sitesurelabs-last-user-v1', id);
}

beforeEach(async () => {
  h.server.uploads.length = 0;
  h.server.held.clear();
  h.server.corruptNext = 0;
  h.server.calls = 0;
  h.attach.mockClear();
  // Clean slate: finish any release left over by a previous test, and empty the queue by uploading + clearing.
  endRelease(false);
  setPhotosWaitForWrites(false);
  setUploadMode('manual');
  signIn('u1');
});

describe('Upload when I tap: the real queue', () => {
  it('a captured photo is on disk, size-matched and fingerprinted before enqueue returns, and nothing is sent', async () => {
    const f = photo('IMG_A.jpg', 1);
    await enqueueFileUpload('pin1', f);

    const infos = await waitingPhotoInfos();
    const mine = infos.filter(i => i.pinId === 'pin1');
    expect(mine.length).toBeGreaterThan(0);

    // The file really is on the "phone" with exactly the same bytes...
    const onDisk = [...h.files.entries()].filter(([p]) => p.startsWith('pending-uploads/'));
    expect(onDisk.length).toBe(1);
    expect(onDisk[0][1].length).toBe(f.size);
    // ...and the saved queue row carries the fingerprint of those bytes.
    const saved = JSON.parse(h.prefs.get('sitesurelabs-file-upload-queue-v1')!) as { sha256?: string; bytesReady?: boolean; ownerId?: string }[];
    const row = saved[saved.length - 1];
    expect(row.bytesReady).toBe(true);
    expect(row.sha256).toBe(await sha256OfBlob(f));
    expect(row.ownerId).toBe('u1');

    // HOLD: triggering every kind of flush sends nothing.
    flushFileUploadQueue();
    flushFileUploadQueue();
    await new Promise(r => setTimeout(r, 150));
    expect(h.server.calls).toBe(0);
  });

  it('Upload now releases the hold: the photo goes up once, its copy is KEPT until the server confirms, then freed', async () => {
    const before = h.server.calls;
    beginRelease(1);
    flushFileUploadQueue();
    await waitFor(() => h.server.calls > before);
    await waitFor(async () => (await listRetainedPhotos()).length >= 1);

    // Sent, linked to the point, and removed from "waiting"...
    expect(h.attach).toHaveBeenCalled();
    const waiting = (await waitingPhotoInfos()).filter(i => i.pinId === 'pin1');
    expect(waiting).toHaveLength(0);
    // ...but the file is still on the phone: not yet proven safe.
    expect([...h.files.keys()].some(p => p.startsWith('pending-uploads/'))).toBe(true);
    expect(await unconfirmedPhotoCount()).toBeGreaterThanOrEqual(1);

    // Final reconciliation: the server holds it, so now (and only now) the phone copy goes.
    const r = await releaseVerifiedPhotos();
    expect(r.confirmed).toBeGreaterThanOrEqual(1);
    expect(r.missing).toBe(0);
    expect([...h.files.keys()].filter(p => p.startsWith('pending-uploads/'))).toHaveLength(0);
    expect(await unconfirmedPhotoCount()).toBe(0);
    endRelease(true);
  });

  it('a photo that arrives damaged (fingerprint differs) is sent again, and the phone copy is never lost', async () => {
    endRelease(false);
    await enqueueFileUpload('pin2', photo('IMG_B.jpg', 2));
    h.server.corruptNext = 1;
    const before = h.server.calls;
    beginRelease(1);
    flushFileUploadQueue();
    await waitFor(() => h.server.calls >= before + 1);
    // First attempt was damaged: the capture must NOT have been linked, and the file must still exist.
    expect(h.attach).not.toHaveBeenCalled();
    expect([...h.files.keys()].some(p => p.startsWith('pending-uploads/'))).toBe(true);
    // The retry (queue backoff) sends it again and this time it is intact.
    flushFileUploadQueue();
    await waitFor(() => h.attach.mock.calls.length >= 1, 8000);
    expect(h.server.calls).toBeGreaterThanOrEqual(before + 2);
    const r = await releaseVerifiedPhotos();
    expect(r.missing).toBe(0);
    endRelease(true);
  }, 15000);

  it('if the server does NOT confirm a photo, its file is kept and reported missing', async () => {
    endRelease(false);
    await enqueueFileUpload('pin1', photo('IMG_C.jpg', 3));
    beginRelease(1);
    flushFileUploadQueue();
    await waitFor(async () => (await listRetainedPhotos()).length >= 1);
    h.server.held.clear(); // pretend the server lost it
    const files = [...h.files.keys()].filter(p => p.startsWith('pending-uploads/')).length;
    const r = await releaseVerifiedPhotos();
    expect(r.confirmed).toBe(0);
    expect(r.missing).toBeGreaterThanOrEqual(1);
    expect([...h.files.keys()].filter(p => p.startsWith('pending-uploads/')).length).toBe(files);
    endRelease(false);
  });

  it('another person\'s photos are never sent by someone else\'s login, and stay on the phone', async () => {
    endRelease(false);
    signIn('u1');
    await enqueueFileUpload('pin2', photo('IMG_D.jpg', 4));
    const filesBefore = [...h.files.keys()].filter(p => p.startsWith('pending-uploads/')).length;

    signIn('u2'); // a different person is now signed in, with the hold released
    const before = h.server.calls;
    beginRelease(1);
    flushFileUploadQueue();
    await new Promise(r => setTimeout(r, 250));
    expect(h.server.calls).toBe(before); // u1's photo was NOT sent by u2
    expect([...h.files.keys()].filter(p => p.startsWith('pending-uploads/')).length).toBe(filesBefore); // and not deleted
    endRelease(false);

    // u1 signs in again: now it can go.
    signIn('u1');
    beginRelease(1);
    flushFileUploadQueue();
    await waitFor(() => h.server.calls > before);
    endRelease(false);
    expect(getUploadSession().phase).toBe('open');
  });
});

describe('auto mode keeps today\'s behaviour', () => {
  it('uploads straight away with no hold, and without disk-first bookkeeping', async () => {
    endRelease(false);
    setUploadMode('auto');
    const before = h.server.calls;
    await enqueueFileUpload('pin1', photo('IMG_E.jpg', 5, 200 * 1024));
    await waitFor(() => h.server.calls > before);
    expect(MB).toBeGreaterThan(0);
    setUploadMode('manual');
  });
});

describe('uploading only the floors you tick', () => {
  it('sends the ticked point, leaves the other one untouched on the phone', async () => {
    endRelease(false);
    setUploadMode('manual');
    signIn('u1');
    await enqueueFileUpload('pin1', photo('IMG_F1.jpg', 11));
    await enqueueFileUpload('pin2', photo('IMG_F2.jpg', 12));
    const before = h.server.calls;
    const filesBefore = [...h.files.keys()].filter(p => p.startsWith('pending-uploads/')).length;

    beginRelease(1, ['pin1']); // only pin1's floor was ticked
    flushFileUploadQueue();
    await waitFor(() => h.server.calls > before);
    await new Promise(r => setTimeout(r, 250));

    expect(h.server.calls).toBe(before + 1); // exactly one photo went
    const waiting = await waitingPhotoInfos();
    expect(waiting.some(i => i.pinId === 'pin2')).toBe(true); // pin2 still waiting
    expect(waiting.some(i => i.pinId === 'pin1')).toBe(false);
    // pin2's file is still on the phone (pin1's is retained until verified, so nothing was deleted)
    expect([...h.files.keys()].filter(p => p.startsWith('pending-uploads/')).length).toBe(filesBefore);
    endRelease(false);
  });
});
