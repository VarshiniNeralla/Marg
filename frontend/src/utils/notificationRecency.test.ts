import { describe, expect, it } from 'vitest';
import { isRecentNotification } from './notificationRecency';

const NOW = Date.parse('2026-11-27T06:30:00Z');

describe('isRecentNotification', () => {
  it('is true for something that just happened', () => {
    expect(isRecentNotification('2026-11-27T06:25:00Z', NOW)).toBe(true);
  });
  it('is false for a report finished days ago (the repeating pop-up)', () => {
    expect(isRecentNotification('2026-11-21T10:00:00Z', NOW)).toBe(false);
    expect(isRecentNotification('2026-11-27T05:00:00Z', NOW)).toBe(false);
  });
  it('treats a time without a zone as UTC, not local time', () => {
    expect(isRecentNotification('2026-11-27T06:25:00', NOW)).toBe(true);
    expect(isRecentNotification('2026-11-27T01:00:00', NOW)).toBe(false);
  });
  it('accepts a small clock difference between device and server', () => {
    expect(isRecentNotification('2026-11-27T06:32:00Z', NOW)).toBe(true);
    expect(isRecentNotification('2026-11-27T07:30:00Z', NOW)).toBe(false);
  });
  it('is false when the time is missing or unreadable', () => {
    expect(isRecentNotification(undefined, NOW)).toBe(false);
    expect(isRecentNotification('', NOW)).toBe(false);
    expect(isRecentNotification('not a date', NOW)).toBe(false);
  });
});
