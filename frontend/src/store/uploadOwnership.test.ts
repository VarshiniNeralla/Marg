import { describe, expect, it } from 'vitest';
import {
  dropParkedWork, entryBelongsTo, parkWork, planSessionTransition, readLastUserId, readParkedWork, writeLastUserId,
  type KeyValueStore,
} from './uploadOwnership';

function memStore(opts?: { refuseWrites?: boolean }): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { if (!opts?.refuseWrites) map.set(k, v); },
    removeItem: k => { map.delete(k); },
  };
}

describe('planSessionTransition: nothing waiting is ever wiped', () => {
  it('same person logs in again with photos waiting -> keep everything', () => {
    const p = planSessionTransition({ event: 'login', ownerId: 'u1', newUserId: 'u1', hasWaitingWork: true });
    expect(p.wipe).toBe(false);
    expect(p.keepLive).toBe(true);
    expect(p.parkPrevious).toBe(false);
  });

  it('a different person logs in with photos waiting -> park, never wipe, warn', () => {
    const p = planSessionTransition({ event: 'login', ownerId: 'u1', newUserId: 'u2', hasWaitingWork: true });
    expect(p.wipe).toBe(false);
    expect(p.parkPrevious).toBe(true);
    expect(p.needsOwnerWarning).toBe(true);
    expect(p.restoreForNewUser).toBe(true);
  });

  it('logout with photos waiting -> keep', () => {
    const p = planSessionTransition({ event: 'logout', ownerId: 'u1', hasWaitingWork: true });
    expect(p.wipe).toBe(false);
    expect(p.keepLive).toBe(true);
  });

  it('expired session (server confirmed) with photos waiting -> keep', () => {
    const p = planSessionTransition({ event: 'expired', ownerId: 'u1', hasWaitingWork: true });
    expect(p.wipe).toBe(false);
    expect(p.keepLive).toBe(true);
  });

  it('nothing waiting -> the normal clean-up still runs', () => {
    expect(planSessionTransition({ event: 'logout', ownerId: 'u1', hasWaitingWork: false }).wipe).toBe(true);
    expect(planSessionTransition({ event: 'expired', ownerId: null, hasWaitingWork: false }).wipe).toBe(true);
    const login = planSessionTransition({ event: 'login', ownerId: 'u1', newUserId: 'u2', hasWaitingWork: false });
    expect(login.wipe).toBe(true);
    expect(login.needsOwnerWarning).toBe(false);
  });

  it('owner unknown (older install) is treated as the same person, so nothing is lost', () => {
    const p = planSessionTransition({ event: 'login', ownerId: null, newUserId: 'u2', hasWaitingWork: true });
    expect(p.wipe).toBe(false);
    expect(p.keepLive).toBe(true);
  });

  it('wipe is never combined with any keep/park outcome', () => {
    const events = ['login', 'logout', 'expired'] as const;
    for (const event of events) for (const waiting of [true, false]) for (const nu of ['u1', 'u2', null]) {
      const p = planSessionTransition({ event, ownerId: 'u1', newUserId: nu, hasWaitingWork: waiting });
      if (waiting) expect(p.wipe).toBe(false);
      if (p.wipe) expect(p.keepLive || p.parkPrevious).toBe(false);
    }
  });
});

describe('parked work', () => {
  it('round-trips and is removed only on request', () => {
    const s = memStore();
    expect(parkWork(s, 'u1', { workflow: '{"a":1}', writes: '[1]' }, 5)).toBe(true);
    expect(readParkedWork(s, 'u1')).toEqual({ workflow: '{"a":1}', writes: '[1]', parkedAt: 5 });
    expect(readParkedWork(s, 'u2')).toBeNull();
    dropParkedWork(s, 'u1');
    expect(readParkedWork(s, 'u1')).toBeNull();
  });

  it('reports failure when storage silently refuses the copy (so the caller can refuse to wipe)', () => {
    const s = memStore({ refuseWrites: true });
    expect(parkWork(s, 'u1', { workflow: 'x', writes: null })).toBe(false);
  });

  it('remembers the last signed-in person', () => {
    const s = memStore();
    expect(readLastUserId(s)).toBeNull();
    writeLastUserId(s, 'u9');
    expect(readLastUserId(s)).toBe('u9');
  });
});

describe('entryBelongsTo', () => {
  it('only the owner may upload an entry', () => {
    expect(entryBelongsTo('u1', 'u1', 'u1')).toBe(true);
    expect(entryBelongsTo('u1', 'u2', 'u2')).toBe(false);
  });
  it('older entries without an owner follow the last signed-in person, or anyone if unknown', () => {
    expect(entryBelongsTo(undefined, 'u1', 'u1')).toBe(true);
    expect(entryBelongsTo(undefined, 'u2', 'u1')).toBe(false);
    expect(entryBelongsTo(undefined, 'u2', null)).toBe(true);
  });
  it('nobody signed in -> nothing uploads', () => {
    expect(entryBelongsTo('u1', null, 'u1')).toBe(false);
  });
});
