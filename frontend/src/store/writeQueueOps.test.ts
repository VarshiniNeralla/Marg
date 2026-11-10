import { describe, expect, it } from 'vitest';
import { moveEntryToBack, removeEntry } from './writeQueueOps';

const w = (id: string) => ({ id });

describe('removeEntry', () => {
  it('removes exactly the entry that was handled', () => {
    const a = w('update-pin-[a]');
    const b = w('create-capture-b');
    const q = [a, b];
    expect(removeEntry(q, a)).toBe(true);
    expect(q).toEqual([b]);
  });

  it('REGRESSION: when the in-flight entry was replaced meanwhile, the next change is NOT thrown away', () => {
    // [update(P,[a]) in flight, createCapture(b)], then a newer update replaces the in-flight one:
    const inFlight = w('update-pin-[a]');
    const createB = w('create-capture-b');
    let q = [inFlight, createB];
    const newer = w('update-pin-[a,b]');
    q = q.filter(e => e !== inFlight); // what enqueueWrite does for a newer captureIds patch
    q.push(newer);
    // the first request now finishes. The old code did queue.shift(), which removed createB:
    expect(removeEntry(q, inFlight)).toBe(false); // already gone, so nothing else is touched
    expect(q).toEqual([createB, newer]);          // the capture's create is still queued
  });

  it('does nothing for an entry that was never in the queue', () => {
    const q = [w('x')];
    expect(removeEntry(q, w('x'))).toBe(false); // equal-looking but a different object
    expect(q).toHaveLength(1);
  });
});

describe('moveEntryToBack', () => {
  it('moves that entry to the back and keeps the rest in order', () => {
    const a = w('a'); const b = w('b'); const c = w('c');
    const q = [a, b, c];
    moveEntryToBack(q, a);
    expect(q).toEqual([b, c, a]);
  });

  it('does not re-add an entry that is already gone', () => {
    const a = w('a'); const b = w('b');
    const q = [b];
    moveEntryToBack(q, a);
    expect(q).toEqual([b]);
  });
});
