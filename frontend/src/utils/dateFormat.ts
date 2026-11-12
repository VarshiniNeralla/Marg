import { parseServerTime } from '@/utils/notificationTime';

export const EMPTY_DATE = '—';

const LOCALE = 'en-IN';

/** `12 Nov 2026` in an explicit time zone (pure and testable). */
export function formatDateIn(value: string | null | undefined, timeZone?: string): string {
  const ms = parseServerTime(value);
  if (ms === null) return EMPTY_DATE;
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric', month: 'short', year: 'numeric', ...(timeZone ? { timeZone } : {}),
  }).format(new Date(ms));
}

/** `12 Nov 2026, 11:53 am` in an explicit time zone. */
export function formatDateTimeIn(value: string | null | undefined, timeZone?: string): string {
  const ms = parseServerTime(value);
  if (ms === null) return EMPTY_DATE;
  const d = new Date(ms);
  const tz = timeZone ? { timeZone } : {};
  const date = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', ...tz }).format(d);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true, ...tz }).format(d);
  return `${date}, ${time.replace(/\s?(AM|PM)/i, (_m, ap: string) => ` ${ap.toLowerCase()}`)}`;
}

/** Device-local date, e.g. `12 Nov 2026`. */
export function formatDate(value: string | null | undefined): string {
  return formatDateIn(value);
}

/** Device-local date and time, e.g. `12 Nov 2026, 11:53 am`. */
export function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeIn(value);
}

/** `just now`, `5 min ago`, `3 h ago`, `2 d ago`, then a calendar date. */
export function formatRelativeAge(value: string | null | undefined, now: number = Date.now()): string {
  const ms = parseServerTime(value);
  if (ms === null) return EMPTY_DATE;
  const diffMin = Math.floor((now - ms) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDate(value);
}
