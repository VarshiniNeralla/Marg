/** A pop-up alert is for something that just happened. Anything older stays in the bell, never as a pop-up. */
export const ALERT_MAX_AGE_MS = 15 * 60 * 1000;

/** Server times may come without a zone ("2026-11-21T10:00:00"); they are UTC, so say so before parsing. */
function parseServerTime(value: string): number {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const iso = value.includes('T') && !hasZone ? `${value}Z` : value;
  return Date.parse(iso);
}

/** True when the notification was created within the last `maxAgeMs`. A missing or unreadable time is NOT recent. */
export function isRecentNotification(createdAt: string | undefined, now = Date.now(), maxAgeMs = ALERT_MAX_AGE_MS): boolean {
  if (!createdAt) return false;
  const t = parseServerTime(createdAt);
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  // A small negative age is clock skew between this device and the server; still "just now".
  return age <= maxAgeMs && age >= -5 * 60 * 1000;
}
