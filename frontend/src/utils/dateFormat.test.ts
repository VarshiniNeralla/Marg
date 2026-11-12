import { describe, expect, it } from 'vitest';
import { parseServerTime } from '@/utils/notificationTime';
import {
  formatDate, formatDateIn, formatDateTime, formatDateTimeIn, formatRelativeAge,
} from './dateFormat';

describe('dateFormat', () => {
  it('treats a naive timestamp as UTC', () => {
    expect(parseServerTime('2026-11-12T06:23:38.704000')).toBe(Date.UTC(2026, 10, 12, 6, 23, 38, 704));
    expect(parseServerTime('2026-11-12T06:23:38.704000Z')).toBe(parseServerTime('2026-11-12T06:23:38.704000'));
  });

  it('formats the date with the year in an explicit zone', () => {
    expect(formatDateIn('2026-11-12T06:23:38.704000', 'Asia/Kolkata')).toBe('12 Nov 2026');
    expect(formatDateIn('2026-11-12T06:23:38.704000', 'UTC')).toBe('12 Nov 2026');
  });

  it('shifts the day across zones when the instant demands it', () => {
    // 20:00 UTC on the 12th is already the 13th in IST.
    expect(formatDateIn('2026-11-12T20:00:00', 'UTC')).toBe('12 Nov 2026');
    expect(formatDateIn('2026-11-12T20:00:00', 'Asia/Kolkata')).toBe('13 Nov 2026');
  });

  it('formats date and time in am/pm', () => {
    expect(formatDateTimeIn('2026-11-12T06:23:38.704000', 'Asia/Kolkata')).toBe('12 Nov 2026, 11:53 am');
    expect(formatDateTimeIn('2026-11-12T18:05:00Z', 'UTC')).toBe('12 Nov 2026, 6:05 pm');
  });

  it('returns a dash for null, empty and invalid values', () => {
    for (const v of [null, undefined, '', 'garbage', '2026-13-45T99:99']) {
      expect(formatDate(v)).toBe('—');
      expect(formatDateTime(v)).toBe('—');
      expect(formatRelativeAge(v)).toBe('—');
    }
  });

  it('device-local helpers include the year', () => {
    expect(formatDate('2026-11-12T06:23:38')).toMatch(/2026/);
    expect(formatDateTime('2026-11-12T06:23:38')).toMatch(/2026/);
  });

  it('formats relative age', () => {
    const base = Date.UTC(2026, 10, 12, 6, 0, 0);
    expect(formatRelativeAge('2026-11-12T06:00:00', base + 20_000)).toBe('just now');
    expect(formatRelativeAge('2026-11-12T06:00:00', base + 5 * 60_000)).toBe('5 min ago');
    expect(formatRelativeAge('2026-11-12T06:00:00', base + 3 * 3_600_000)).toBe('3 h ago');
    expect(formatRelativeAge('2026-11-12T06:00:00', base + 2 * 86_400_000)).toBe('2 d ago');
  });
});
