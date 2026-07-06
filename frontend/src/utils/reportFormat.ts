/** Parse API datetime strings — backend stores UTC without a Z suffix. */
function parseApiDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const hasTz = trimmed.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(trimmed);
    const iso = hasTz
      ? trimmed
      : trimmed.includes('T')
        ? `${trimmed}Z`
        : `${trimmed}T00:00:00Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Human-readable date/time for progress reports (never raw ISO). */
export function formatReportDate(value: string | undefined | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const d = parseApiDate(trimmed);
  if (d) {
    return d.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return trimmed;
}
export function formatReportDateRange(before?: string, after?: string): string {
  const b = formatReportDate(before);
  const a = formatReportDate(after);
  if (b && a) return `${b} → ${a}`;
  return b || a || 'Timeline comparison';
}

/** When the AI report was saved to the library (preferred over analysis createdAt). */
export function formatReportGeneratedAt(
  savedAt?: string | null,
  createdAt?: string | null,
): string {
  return formatReportDate(savedAt ?? createdAt) || '';
}
/** Parse capture date / label to a comparable timestamp (NaN if unknown). */
export function parseCaptureTimestamp(date?: string, dateLabel?: string): number {
  for (const raw of [date, dateLabel]) {
    if (!raw?.trim()) continue;
    const trimmed = raw.trim();
    const t = new Date(trimmed).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return NaN;
}

/** Compact date for compare preview rows (fits narrow panels). */
export function formatCapturePreviewDate(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return trimmed;
}

/** Order two captures chronologically — older = before, newer = after. */
export function orderCapturesChronologically<T extends { date?: string; dateLabel?: string }>(
  itemA: T,
  itemB: T,
  timelineIndexA: number,
  timelineIndexB: number,
): { before: T; after: T } {
  const tA = parseCaptureTimestamp(itemA.date, itemA.dateLabel);
  const tB = parseCaptureTimestamp(itemB.date, itemB.dateLabel);

  if (!Number.isNaN(tA) && !Number.isNaN(tB) && tA !== tB) {
    return tA < tB ? { before: itemA, after: itemB } : { before: itemB, after: itemA };
  }

  // Fall back to timeline position (left = older visit, right = newer).
  return timelineIndexA <= timelineIndexB
    ? { before: itemA, after: itemB }
    : { before: itemB, after: itemA };
}
