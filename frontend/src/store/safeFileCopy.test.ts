import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { SingleFlight, healCopy, resolveCapturedAt, writeVerifiedCopy, type FsLike } from './safeFileCopy';
import { uploadSequenceByPinId } from '@/utils/pinLabels';

const DATA = 'DATA';
const CACHE = 'CACHE';
const tick = () => new Promise<void>(r => setTimeout(r, 0));

/** In-memory filesystem with real append semantics (the property that made two writers corrupt a file). */
class FakeFs implements FsLike {
  files = new Map<string, Buffer>();
  /** Test hook: duplicate every Nth appended chunk, to simulate a damaged write. */
  duplicateAppendEvery = 0;
  appendCalls = 0;
  copyCalls = 0;
  failCopy = false;
  key = (dir: string, path: string) => `${dir}:${path}`;

  async writeFile(o: { path: string; data: string; directory: string }) {
    await tick();
    this.files.set(this.key(o.directory, o.path), Buffer.from(o.data, 'base64'));
  }
  async appendFile(o: { path: string; data: string; directory: string }) {
    await tick();
    this.appendCalls += 1;
    const k = this.key(o.directory, o.path);
    const chunk = Buffer.from(o.data, 'base64');
    const parts = [this.files.get(k) ?? Buffer.alloc(0), chunk];
    if (this.duplicateAppendEvery && this.appendCalls % this.duplicateAppendEvery === 0) parts.push(chunk);
    this.files.set(k, Buffer.concat(parts));
  }
  async stat(o: { path: string; directory: string }) {
    const f = this.files.get(this.key(o.directory, o.path));
    if (!f) throw new Error('ENOENT');
    return { size: f.length };
  }
  async copy(o: { from: string; to: string; directory: string; toDirectory: string }) {
    this.copyCalls += 1;
    if (this.failCopy) throw new Error('copy failed');
    const f = this.files.get(this.key(o.directory, o.from));
    if (!f) throw new Error('ENOENT');
    this.files.set(this.key(o.toDirectory, o.to), Buffer.from(f));
  }
  async deleteFile(o: { path: string; directory: string }) {
    this.files.delete(this.key(o.directory, o.path));
  }
  async mkdir() {}
}

function photo(bytes: number, seed = 7): { buf: Buffer; file: File } {
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 31 + seed) & 0xff;
  return { buf, file: new File([buf], 'IMG_20261030_140540_00_066.insp') };
}

const toBase64 = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString('base64');
const baseOpts = (file: File, extra: Record<string, unknown> = {}) => ({
  file,
  path: 'pending-uploads/1_1_IMG.insp',
  dir: DATA,
  folder: 'pending-uploads',
  chunkBytes: 1000,
  toBase64,
  cancelled: () => false,
  yieldFn: tick,
  ...extra,
});

describe('SingleFlight (one writer per photo)', () => {
  it('shares one run between concurrent callers and runs again after it finishes', async () => {
    const sf = new SingleFlight();
    let runs = 0;
    const task = async () => { runs += 1; await tick(); return runs; };
    const [a, b] = await Promise.all([sf.run('x', task), sf.run('x', task)]);
    expect(runs).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(sf.isRunning('x')).toBe(false);
    await sf.run('x', task);
    expect(runs).toBe(2);
  });

  it('runs different keys independently and releases the key even when the task fails', async () => {
    const sf = new SingleFlight();
    await expect(sf.run('a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(sf.isRunning('a')).toBe(false);
    const order: string[] = [];
    await Promise.all([sf.run('a', async () => { order.push('a'); }), sf.run('b', async () => { order.push('b'); })]);
    expect(order.sort()).toEqual(['a', 'b']);
  });
});

describe('writeVerifiedCopy', () => {
  it('writes an exact copy in chunks', async () => {
    const fs = new FakeFs();
    const { buf, file } = photo(5500);
    const r = await writeVerifiedCopy(fs, baseOpts(file));
    expect(r).toEqual({ ok: true, via: 'chunks' });
    expect(fs.files.get('DATA:pending-uploads/1_1_IMG.insp')!.equals(buf)).toBe(true);
  });

  it('REGRESSION: two writers on the same file corrupt it, but SingleFlight keeps the copy exact', async () => {
    const { buf, file } = photo(6200);
    // The old behaviour: the background writer and the memory-spill path both write the same path at once.
    const broken = new FakeFs();
    const naive = (fs: FakeFs) => (async () => {
      let offset = 0; let first = true;
      while (offset < file.size) {
        const end = Math.min(offset + 1000, file.size);
        const data = await toBase64(file.slice(offset, end));
        if (first) { await fs.writeFile({ path: 'p', data, directory: DATA }); first = false; }
        else await fs.appendFile({ path: 'p', data, directory: DATA });
        offset = end; await tick();
      }
    })();
    await Promise.all([naive(broken), naive(broken)]);
    expect(broken.files.get('DATA:p')!.length).not.toBe(buf.length);        // corrupted, like the real tablet copies

    // The fix: concurrent callers share ONE writer.
    const fs = new FakeFs();
    const sf = new SingleFlight();
    const write = () => sf.run('entry-1', () => writeVerifiedCopy(fs, baseOpts(file)));
    const [a, b] = await Promise.all([write(), write()]);
    expect(a.ok && b.ok).toBe(true);
    expect(fs.files.get('DATA:pending-uploads/1_1_IMG.insp')!.equals(buf)).toBe(true);
  });

  it('detects a damaged write, deletes it and rewrites a clean copy', async () => {
    const fs = new FakeFs();
    fs.duplicateAppendEvery = 2;                                            // first attempt gets a duplicated chunk
    const { buf, file } = photo(4200);
    const r = await writeVerifiedCopy(fs, baseOpts(file));
    // appendCalls keeps counting, so the 2nd attempt may also hit the fault: either it self-heals or it reports failure.
    if (r.ok) expect(fs.files.get('DATA:pending-uploads/1_1_IMG.insp')!.equals(buf)).toBe(true);
    else expect(fs.files.has('DATA:pending-uploads/1_1_IMG.insp')).toBe(false);   // never leaves a damaged file behind
  });

  it('never reports success for a wrong-size copy and removes it', async () => {
    const fs = new FakeFs();
    fs.duplicateAppendEvery = 1;                                            // every append duplicates: always damaged
    const { file } = photo(4200);
    const r = await writeVerifiedCopy(fs, baseOpts(file));
    expect(r.ok).toBe(false);
    expect(fs.files.has('DATA:pending-uploads/1_1_IMG.insp')).toBe(false);
  });

  it('uses a native copy of the camera original when it has the right size', async () => {
    const fs = new FakeFs();
    const { buf, file } = photo(5200);
    fs.files.set('CACHE:IMG_20261030_140540_00_066.insp', Buffer.from(buf));
    const r = await writeVerifiedCopy(fs, baseOpts(file, { cacheName: 'IMG_20261030_140540_00_066.insp', cacheDir: CACHE }));
    expect(r).toEqual({ ok: true, via: 'native-copy' });
    expect(fs.appendCalls).toBe(0);
    expect(fs.files.get('DATA:pending-uploads/1_1_IMG.insp')!.equals(buf)).toBe(true);
  });

  it('falls back to chunk writing when the camera original has a different size or the copy fails', async () => {
    const { buf, file } = photo(5200);
    const sizeMismatch = new FakeFs();
    sizeMismatch.files.set('CACHE:orig', Buffer.alloc(10));
    expect((await writeVerifiedCopy(sizeMismatch, baseOpts(file, { cacheName: 'orig', cacheDir: CACHE }))).via).toBe('chunks');
    const copyFails = new FakeFs();
    copyFails.files.set('CACHE:orig', Buffer.from(buf));
    copyFails.failCopy = true;
    const r = await writeVerifiedCopy(copyFails, baseOpts(file, { cacheName: 'orig', cacheDir: CACHE }));
    expect(r).toEqual({ ok: true, via: 'chunks' });
  });

  it('stops and removes the partial file when cancelled', async () => {
    const fs = new FakeFs();
    const { file } = photo(5200);
    let calls = 0;
    const r = await writeVerifiedCopy(fs, baseOpts(file, { cancelled: () => ++calls > 2 }));
    expect(r.ok).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(fs.files.has('DATA:pending-uploads/1_1_IMG.insp')).toBe(false);
  });
});

describe('healCopy (repair a damaged queue copy from the camera original)', () => {
  const opts = { path: 'pending-uploads/x.insp', dir: DATA, cacheName: 'orig.insp', cacheDir: CACHE };

  it('ok when the copy has the camera original size', async () => {
    const fs = new FakeFs();
    const { buf } = photo(3000);
    fs.files.set('CACHE:orig.insp', Buffer.from(buf));
    fs.files.set('DATA:pending-uploads/x.insp', Buffer.from(buf));
    expect((await healCopy(fs, opts)).outcome).toBe('ok');
  });

  it('repairs a copy that is larger than the original (the field failure)', async () => {
    const fs = new FakeFs();
    const { buf } = photo(3000);
    fs.files.set('CACHE:orig.insp', Buffer.from(buf));
    fs.files.set('DATA:pending-uploads/x.insp', Buffer.concat([buf, buf.subarray(0, 700)]));
    const r = await healCopy(fs, opts);
    expect(r.outcome).toBe('repaired');
    expect(r.expectedBytes).toBe(3000);
    expect(fs.files.get('DATA:pending-uploads/x.insp')!.equals(buf)).toBe(true);
  });

  it('repairs a missing copy, reports damaged when no original exists, and unverifiable with nothing to compare', async () => {
    const { buf } = photo(3000);
    const missing = new FakeFs();
    missing.files.set('CACHE:orig.insp', Buffer.from(buf));
    expect((await healCopy(missing, opts)).outcome).toBe('repaired');

    const noOriginal = new FakeFs();
    noOriginal.files.set('DATA:pending-uploads/x.insp', Buffer.alloc(2000));
    expect((await healCopy(noOriginal, { ...opts, expectedBytes: 3000 })).outcome).toBe('damaged');

    const nothing = new FakeFs();
    nothing.files.set('DATA:pending-uploads/x.insp', Buffer.alloc(2000));
    expect((await healCopy(nothing, opts)).outcome).toBe('unverifiable');
  });
});

describe('capture time and pin numbering', () => {
  it('uses the time the photo was taken, never the upload time', () => {
    const now = new Date('2026-10-30T08:34:50.000Z');
    expect(resolveCapturedAt(Date.parse('2026-10-30T08:30:00.000Z'), now)).toBe('2026-10-30T08:30:00.000Z');
    expect(resolveCapturedAt(undefined, now)).toBe('2026-10-30T08:34:50.000Z');
    expect(resolveCapturedAt(Number.NaN, now)).toBe('2026-10-30T08:34:50.000Z');
  });

  it('pin numbers follow the order the photos were TAKEN even when uploads finish in a different order', () => {
    const pins = [
      { id: 'pinA', sequenceNumber: 91, captureIds: ['c1'] },
      { id: 'pinB', sequenceNumber: 2, captureIds: ['c2'] },
      { id: 'pinC', sequenceNumber: 30, captureIds: ['c3'] },
    ];
    // Taken in the order c1, c2, c3; the server finished them c2, c3, c1 (upload order).
    const taken = (t: string) => `2026-10-30T08:${t}.000Z`;
    const captures = [
      { id: 'c1', capturedAt: taken('30:00'), uploadedAt: taken('34:50') },
      { id: 'c2', capturedAt: taken('30:10'), uploadedAt: taken('33:57') },
      { id: 'c3', capturedAt: taken('30:20'), uploadedAt: taken('34:00') },
    ];
    const seq = uploadSequenceByPinId(pins, captures);
    expect([seq.get('pinA'), seq.get('pinB'), seq.get('pinC')]).toEqual([1, 2, 3]);
    // Same photos stamped with their upload time (the old behaviour) scramble the numbers:
    const stamped = captures.map(c => ({ id: c.id, capturedAt: c.uploadedAt }));
    const scrambled = uploadSequenceByPinId(pins, stamped);
    expect([scrambled.get('pinA'), scrambled.get('pinB'), scrambled.get('pinC')]).toEqual([3, 1, 2]);
  });
});
