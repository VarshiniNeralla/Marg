import { describe, expect, it } from 'vitest';
import { formatNotificationTime } from './notificationTime';

const NOW = new Date('2026-11-11T12:00:00Z');

describe('formatNotificationTime', () => {
  it('leaves browser-created labels untouched', () => {
    expect(formatNotificationTime('Just now', NOW)).toBe('Just now');
    expect(formatNotificationTime('2 hours ago', NOW)).toBe('2 hours ago');
    expect(formatNotificationTime('', NOW)).toBe('');
  });

  it('formats recent server timestamps as minutes', () => {
    expect(formatNotificationTime('2026-11-11T11:59:40Z', NOW)).toBe('Just now');
    expect(formatNotificationTime('2026-11-11T11:45:00Z', NOW)).toBe('15 min ago');
  });

  it('treats a timestamp without a zone as UTC (what Mongo returns)', () => {
    expect(formatNotificationTime('2026-11-11T11:30:00', NOW)).toBe('30 min ago');
    expect(formatNotificationTime('2026-11-11 11:30:00', NOW)).toBe('30 min ago');
  });

  it('uses Today / Yesterday / a date for older ones', () => {
    expect(formatNotificationTime('2026-11-11T05:00:00Z', NOW)).toMatch(/^Today, /);
    expect(formatNotificationTime('2026-11-10T08:00:00Z', NOW)).toMatch(/^Yesterday, /);
    expect(formatNotificationTime('2026-10-01T08:00:00Z', NOW)).toMatch(/^1 Oct|Oct 1/);
  });

  it('returns the input when it is not a valid date', () => {
    expect(formatNotificationTime('2026-99-99T99:99', NOW)).toBe('2026-99-99T99:99');
  });
});
