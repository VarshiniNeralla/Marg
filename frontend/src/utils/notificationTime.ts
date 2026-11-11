/**
 * Notifications created in the browser store a literal label such as "Just now";
 * notifications created by the server (for example "progress analysis ready")
 * carry an ISO timestamp. Show the first as-is and turn the second into friendly text.
 */
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Epoch ms for a server timestamp, or null if it is missing or not a date. A bare timestamp is UTC. */
export function parseServerTime(value: string | null | undefined): number | null {
  if (!value || !ISO_LIKE.test(value)) return null;
  // Server timestamps are UTC; Mongo may drop the offset, so treat a bare one as UTC.
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const ms = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function formatNotificationTime(value: string, now: Date = new Date()): string {
  const ms = parseServerTime(value);
  if (ms === null) return value;
  const when = new Date(ms);

  const diffMin = Math.round((now.getTime() - when.getTime()) / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const sameDay = when.toDateString() === now.toDateString();
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (when.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${when.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}
