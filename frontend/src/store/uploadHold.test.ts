import { describe, expect, it } from 'vitest';
import { computeHeld, defaultModeForRole, effectiveMode, parseSession } from './uploadHold';

describe('hold rule', () => {
  it('manual mode holds until Upload now moves the session to uploading', () => {
    expect(computeHeld('manual', 'open')).toBe(true);
    expect(computeHeld('manual', 'uploading')).toBe(false);
  });

  it('auto mode never holds (today behaviour is untouched)', () => {
    expect(computeHeld('auto', 'open')).toBe(false);
    expect(computeHeld('auto', 'uploading')).toBe(false);
  });
});

describe('mode defaults', () => {
  it('field engineers default to Upload when I tap, others to auto', () => {
    expect(defaultModeForRole('field_engineer')).toBe('manual');
    expect(defaultModeForRole('manager')).toBe('auto');
    expect(defaultModeForRole('admin')).toBe('auto');
    expect(defaultModeForRole(undefined)).toBe('auto');
  });

  it('an explicit choice beats the role default', () => {
    expect(effectiveMode('auto', 'field_engineer')).toBe('auto');
    expect(effectiveMode('manual', 'admin')).toBe('manual');
    expect(effectiveMode(null, 'field_engineer')).toBe('manual');
  });
});

describe('saved session', () => {
  it('empty or corrupt storage gives a clean open session', () => {
    for (const raw of [null, '', '{nope', '[]']) {
      const s = parseSession(raw);
      expect(s.phase).toBe('open');
      expect(s.batchTotal).toBe(0);
    }
  });

  it('an interrupted upload comes back as uploading so it carries on, with its progress', () => {
    const s = parseSession(JSON.stringify({ mode: 'manual', phase: 'uploading', batchTotal: 40, batchDone: 12, startedAt: 5 }));
    expect(s.phase).toBe('uploading');
    expect(s.batchTotal).toBe(40);
    expect(s.batchDone).toBe(12);
    expect(s.mode).toBe('manual');
  });

  it('ignores unknown values', () => {
    const s = parseSession(JSON.stringify({ mode: 'weird', phase: 'zzz', batchTotal: 'x' }));
    expect(s.mode).toBeNull();
    expect(s.phase).toBe('open');
    expect(s.batchTotal).toBe(0);
  });
});

describe('partial Upload now (ticked floors only)', () => {
  it('points outside the selection stay held even though the hold is released', async () => {
    const { computePhotoHeld } = await import('./uploadHold');
    expect(computePhotoHeld(false, false, 'manual', ['a'], 'a')).toBe(false);
    expect(computePhotoHeld(false, false, 'manual', ['a'], 'b')).toBe(true);
  });
  it('no selection means everything; hold and write-order always win', async () => {
    const { computePhotoHeld } = await import('./uploadHold');
    expect(computePhotoHeld(false, false, 'manual', null, 'b')).toBe(false);
    expect(computePhotoHeld(true, false, 'manual', ['a'], 'a')).toBe(true);
    expect(computePhotoHeld(false, true, 'manual', ['a'], 'a')).toBe(true);
    expect(computePhotoHeld(false, false, 'auto', ['a'], 'b')).toBe(false);
  });
  it('the selection survives an app restart', () => {
    const s = parseSession(JSON.stringify({ phase: 'uploading', scopePinIds: ['p1', 7, 'p2'] }));
    expect(s.scopePinIds).toEqual(['p1', 'p2']);
  });
});

describe('what "Upload when I tap" holds back', () => {
  it('holds only pin / room / capture details, never tours or publishing', async () => {
    const { isHeldWriteOp } = await import('./uploadHold');
    for (const op of ['createCapturePin', 'updateCapturePin', 'createRoom', 'createFlat', 'createCapture']) expect(isHeldWriteOp(op)).toBe(true);
    for (const op of ['createTour', 'updateTour', 'deleteTour', 'updateCapturePublish', 'createNotification', 'createAuditLog', 'updateProject', 'createFloorPlan']) expect(isHeldWriteOp(op)).toBe(false);
  });
});

describe('one-time repair of a stored "Automatically" choice for field engineers', () => {
  it('clears it once for a field engineer, never for other roles, and never again', async () => {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(), key: () => null, length: 0,
    } as Storage;
    const hold = await import('./uploadHold');

    hold.setUploadMode('auto');
    expect(hold.applyFieldEngineerModeDefaultOnce('manager')).toBe(false);          // other roles are left alone
    expect(hold.getUploadSession().mode).toBe('auto');

    expect(hold.applyFieldEngineerModeDefaultOnce('field_engineer')).toBe(true);    // repaired
    expect(hold.getUploadSession().mode).toBeNull();
    expect(hold.effectiveMode(hold.getUploadSession().mode, 'field_engineer')).toBe('manual');

    hold.setUploadMode('auto');                                                      // a deliberate later choice sticks
    expect(hold.applyFieldEngineerModeDefaultOnce('field_engineer')).toBe(false);
    expect(hold.getUploadSession().mode).toBe('auto');
  });
});

describe('a partial Upload now only sends the ticked points', () => {
  const pinOf = (cid: string) => ({ c1: 'pinA', c2: 'pinB' } as Record<string, string>)[cid];

  it('works out which point a held change belongs to', async () => {
    const { pinOfHeldWrite } = await import('./uploadHold');
    expect(pinOfHeldWrite('createCapturePin', [{ id: 'pinA' }], pinOf)).toBe('pinA');
    expect(pinOfHeldWrite('updateCapturePin', ['pinB', { x: 1 }], pinOf)).toBe('pinB');
    expect(pinOfHeldWrite('createCapture', [{ id: 'c2' }], pinOf)).toBe('pinB');
    expect(pinOfHeldWrite('createRoom', [{ id: 'r1' }], pinOf)).toBeNull();      // structure, not one point
    expect(pinOfHeldWrite('createCapture', [{ id: 'unknown' }], pinOf)).toBeNull();
  });

  it('holds the details of points that were not ticked, sends the ticked ones and everything unrelated', async () => {
    const { isWriteOutOfScope } = await import('./uploadHold');
    const scope = ['pinA'];
    expect(isWriteOutOfScope('createCapturePin', [{ id: 'pinB' }], scope, 'uploading', pinOf)).toBe(true);
    expect(isWriteOutOfScope('createCapture', [{ id: 'c2' }], scope, 'uploading', pinOf)).toBe(true);
    expect(isWriteOutOfScope('createCapturePin', [{ id: 'pinA' }], scope, 'uploading', pinOf)).toBe(false);
    expect(isWriteOutOfScope('createCapture', [{ id: 'c1' }], scope, 'uploading', pinOf)).toBe(false);
    expect(isWriteOutOfScope('createRoom', [{ id: 'r1' }], scope, 'uploading', pinOf)).toBe(false);
    expect(isWriteOutOfScope('createTour', [{ id: 't' }], scope, 'uploading', pinOf)).toBe(false);
    // a change whose point cannot be worked out is never held back forever
    expect(isWriteOutOfScope('createCapture', [{ id: 'unknown' }], scope, 'uploading', pinOf)).toBe(false);
  });

  it('applies nothing unless a partial upload is actually running', async () => {
    const { isWriteOutOfScope } = await import('./uploadHold');
    expect(isWriteOutOfScope('createCapturePin', [{ id: 'pinB' }], ['pinA'], 'open', pinOf)).toBe(false);
    expect(isWriteOutOfScope('createCapturePin', [{ id: 'pinB' }], null, 'uploading', pinOf)).toBe(false);
  });
});
