import { describe, expect, it } from 'vitest';
import { dropParkedWorkFile, parkWorkFile, readParkedWorkFile, type ParkFs } from './parkedWorkFile';

function fakeFs(opts: { failWrite?: boolean; corrupt?: boolean } = {}) {
  const files = new Map<string, string>();
  const fs: ParkFs = {
    writeFile: async ({ path, data }) => { if (opts.failWrite) throw new Error('quota'); files.set(path, opts.corrupt ? data.slice(1) : data); },
    readFile: async ({ path }) => { const d = files.get(path); if (d === undefined) throw new Error('missing'); return { data: d }; },
    deleteFile: async ({ path }) => { files.delete(path); },
  };
  return { fs, files };
}

describe('parked work in file storage', () => {
  it('saves a copy, reads it back, and removes it', async () => {
    const { fs, files } = fakeFs();
    expect(await parkWorkFile('u1', { workflow: '{"a":1}', writes: '[1]' }, 7, fs)).toBe(true);
    expect(await readParkedWorkFile('u1', fs)).toEqual({ workflow: '{"a":1}', writes: '[1]', parkedAt: 7 });
    expect(await readParkedWorkFile('u2', fs)).toBeNull();
    await dropParkedWorkFile('u1', fs);
    expect(files.size).toBe(0);
  });

  it('reports failure when the write is refused', async () => {
    expect(await parkWorkFile('u1', { workflow: 'x', writes: null }, 1, fakeFs({ failWrite: true }).fs)).toBe(false);
  });

  it('does not call a copy saved when it reads back different', async () => {
    expect(await parkWorkFile('u1', { workflow: 'x', writes: null }, 1, fakeFs({ corrupt: true }).fs)).toBe(false);
  });
});
