import { describe, expect, it } from 'vitest';
import { isGenericStopLabel, resolveStopLabel } from './pinLabels';

describe('isGenericStopLabel', () => {
  it('treats placeholders as generic and real names as not', () => {
    for (const s of ['', '  ', 'Pin 3', 'Stop 1', 'point 7', 'Capture point', 'Capture', 'pin#12']) {
      expect(isGenericStopLabel(s)).toBe(true);
    }
    for (const s of ['Living Room', 'Master Bedroom', 'Flat 02 · Kitchen', 'Bedroom 2']) {
      expect(isGenericStopLabel(s)).toBe(false);
    }
  });
});

describe('resolveStopLabel', () => {
  it('prefers the live pin Flat · Room', () => {
    expect(resolveStopLabel({
      pin: { flatName: 'Flat 02', roomName: 'Kitchen', label: 'Kitchen' },
      captureRoomName: 'Hall',
      storedLabel: 'Pin 1',
      sequenceNumber: 1,
    })).toBe('Flat 02 · Kitchen');
  });

  it('falls back to a real room name on the capture when the pin is unnamed or missing', () => {
    expect(resolveStopLabel({ pin: null, captureRoomName: 'Master Bedroom', storedLabel: 'Stop 1', sequenceNumber: 1 }))
      .toBe('Master Bedroom');
    expect(resolveStopLabel({ pin: { label: 'Pin 4' }, captureRoomName: 'Balcony', storedLabel: '', sequenceNumber: 4 }))
      .toBe('Balcony');
  });

  it('uses the stored step label when it is a real name', () => {
    expect(resolveStopLabel({ pin: null, captureRoomName: 'Pin 2', storedLabel: 'Flat 01 · Hall', sequenceNumber: 2 }))
      .toBe('Flat 01 · Hall');
  });

  it('only shows "Stop N" when nothing real is known', () => {
    expect(resolveStopLabel({ pin: null, captureRoomName: '', storedLabel: '', sequenceNumber: 7 })).toBe('Stop 7');
    expect(resolveStopLabel({ pin: null, captureRoomName: 'Pin 7', storedLabel: 'Stop 7', sequenceNumber: 7 })).toBe('Stop 7');
  });
});
