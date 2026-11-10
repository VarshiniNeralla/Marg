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
