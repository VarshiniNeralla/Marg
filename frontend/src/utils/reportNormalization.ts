import type {
  ChangeDetected,
  ProgressAnalysisReport,
  StructuredChange,
  ComparisonMeta,
} from '@/services/progressAnalysisService';
import {
  polishExecutiveSummary,
  polishFallbackSummary,
  polishProgressDescription,
} from '@/utils/reportCopy';

export { SECTION_EMPTY_MESSAGES } from '@/utils/reportCopy';
export {
  BRAND_NAME,
  BRAND_TAGLINE,
  BRAND_REPORT_TITLE,
  BRAND_REPORT_SUBTITLE,
  BRAND_FOOTER,
  REPORT_VERSION,
} from '@/utils/reportBranding';

export type ImportanceLevel = 'High' | 'Medium' | 'Low';

export interface NormalizedChange {
  text: string;
  importance: ImportanceLevel;
  category: string;
}

export interface NormalizedStructuredChange {
  category: string;
  area: string;
  changeType: string;
  beforeState: string;
  afterState: string;
  impact: ImportanceLevel;
  confidence: number;
}

export interface NormalizedProgressReport {
  summary: string;
  overallProgress: { percentage: number; description: string };
  comparison: ComparisonMeta | null;
  changes: NormalizedStructuredChange[];
  changesDetected: NormalizedChange[];
  completedWork: string[];
  newlyAdded: string[];
  removedItems: string[];
  pendingWork: string[];
  qualityObservations: string[];
  risks: string[];
  recommendedNextSteps: string[];
  confidence: number;
}

const TEXT_KEYS = [
  'observation', 'change', 'description', 'text', 'item', 'risk',
  'step', 'work', 'title', 'note', 'recommendation', 'summary', 'message',
] as const;

const NOISE_VALUES = new Set(['none', 'n/a', 'na', 'null', 'undefined', '[]', '{}', 'no changes', 'unchanged']);

export function ensureSentence(text: string): string {
  let t = text.trim().replace(/^["'{]+|["'}]+$/g, '').trim();
  if (!t) return '';
  const normalized = t.charAt(0).toUpperCase() + t.slice(1);
  if (/[.!?]$/.test(normalized)) return normalized;
  return `${normalized}.`;
}

function tryParseDictString(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    try {
      const fixed = trimmed
        .replace(/'/g, '"')
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
      return JSON.parse(fixed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export function extractTextFromItem(item: unknown): string | null {
  if (item == null) return null;
  if (typeof item === 'string') {
    const parsed = tryParseDictString(item);
    if (parsed) return extractTextFromItem(parsed);
    const t = item.trim();
    if (!t || NOISE_VALUES.has(t.toLowerCase())) return null;
    return t;
  }
  if (typeof item === 'number' || typeof item === 'boolean') {
    return String(item);
  }
  if (Array.isArray(item)) {
    const parts = item.map(extractTextFromItem).filter(Boolean) as string[];
    return parts.length ? parts.join('; ') : null;
  }
  if (typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim() && !NOISE_VALUES.has(val.trim().toLowerCase())) {
        return val.trim();
      }
    }
    const parts = Object.entries(obj)
      .filter(([k, v]) => k !== 'importance' && typeof v === 'string' && v.trim())
      .map(([, v]) => (v as string).trim());
    return parts.length ? parts.join(' — ') : null;
  }
  return null;
}

function normalizeImportance(value: unknown): ImportanceLevel {
  const s = String(value ?? 'Medium');
  if (s === 'High' || s === 'Low') return s;
  return 'Medium';
}

export function humanizeListItem(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  if (NOISE_VALUES.has(lower)) {
    return '';
  }
  if (lower === 'no visible defects' || lower.includes('no visible defects')) {
    return 'No visible defects were observed during the comparison.';
  }
  return ensureSentence(t);
}

export function humanizeChange(category: string, change: string): string {
  const cat = category.trim() || 'General';
  const ch = change.trim();
  if (!ch && !cat) return '';

  const lowerCh = ch.toLowerCase();
  const lowerCat = cat.toLowerCase();

  if (lowerCh === 'no changes' || lowerCh === 'none' || lowerCh === 'unchanged') {
    return ensureSentence(
      `No visible changes were observed in the ${lowerCat} area compared to the previous capture.`,
    );
  }

  if (!ch) {
    return ensureSentence(`Updates were noted within the ${lowerCat} scope of work.`);
  }

  if (ch.length > 50 || /[.!?]$/.test(ch) || ch.split(/\s+/).length >= 9) {
    if (lowerCh.startsWith(lowerCat)) return ensureSentence(ch);
    return ensureSentence(ch);
  }

  const verbMap: Record<string, string> = {
    installed: 'has been installed in the visible area',
    completed: 'has been completed in the visible section',
    removed: 'has been removed from the visible area',
    added: 'has been newly added',
    painted: 'has received paint application',
    'in progress': 'is currently in progress',
    pending: 'remains pending completion',
    finished: 'appears finished in the inspected zone',
  };

  for (const [verb, phrase] of Object.entries(verbMap)) {
    if (lowerCh === verb || lowerCh.endsWith(verb)) {
      return ensureSentence(`${cat} work ${phrase}.`);
    }
  }

  if (lowerCh.includes(':')) {
    return ensureSentence(ch);
  }

  return ensureSentence(`${cat} — ${ch.charAt(0).toLowerCase() + ch.slice(1)}.`);
}

function normalizeChangeItem(item: unknown): NormalizedChange | null {
  if (typeof item === 'string') {
    const parsed = tryParseDictString(item);
    if (parsed) return normalizeChangeItem(parsed);
    const t = item.trim();
    if (!t) return null;
    return { text: ensureSentence(t), importance: 'Medium', category: 'General' };
  }
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    const category = String(obj.category ?? obj.type ?? 'General').trim() || 'General';
    const change = String(
      obj.change ?? obj.observation ?? obj.description ?? obj.text ?? '',
    ).trim();
    if (!change && !category) return null;
    const text = humanizeChange(category, change || category);
    if (!text) return null;
    return {
      text,
      importance: normalizeImportance(obj.importance),
      category,
    };
  }
  return null;
}

function normalizeStringArray(raw: unknown): string[] {
  if (raw == null) return [];
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of items) {
    const text = extractTextFromItem(item);
    if (!text) continue;
    const humanized = humanizeListItem(text);
    if (humanized) out.push(humanized);
  }
  return out;
}

export function normalizeProgressReport(report: ProgressAnalysisReport): NormalizedProgressReport {
  const progressBlock = report.progress ?? report.overallProgress;
  const pct = Math.max(0, Math.min(100, Number(progressBlock?.percentage) || 0));
  const summaryRaw = extractTextFromItem(report.summary) ?? report.summary ?? '';
  const summary = summaryRaw
    ? polishExecutiveSummary(summaryRaw, pct)
    : polishFallbackSummary();

  const progressDesc = extractTextFromItem(progressBlock?.description)
    ?? progressBlock?.description
    ?? '';

  const structured: NormalizedStructuredChange[] = [];
  const rawChanges = (report.changes?.length ? report.changes : null) as StructuredChange[] | null;
  if (rawChanges) {
    for (const c of rawChanges) {
      const impact = normalizeImportance(c.impact);
      structured.push({
        category: (c.category || 'General').trim() || 'General',
        area: (c.area || '').trim(),
        changeType: (c.changeType || '').trim(),
        beforeState: (c.beforeState || '').trim(),
        afterState: (c.afterState || '').trim(),
        impact,
        confidence: Math.max(0, Math.min(100, Number(c.confidence) || 0)),
      });
    }
  }

  const changes: NormalizedChange[] = [];
  if (structured.length) {
    for (const c of structured) {
      const text = humanizeChange(
        c.category,
        [c.area, c.beforeState && c.afterState ? `${c.beforeState} → ${c.afterState}` : (c.afterState || c.beforeState)]
          .filter(Boolean)
          .join(' — '),
      );
      if (text) changes.push({ text, importance: c.impact, category: c.category });
    }
  } else {
    for (const item of report.changesDetected ?? []) {
      const normalized = normalizeChangeItem(item);
      if (normalized) changes.push(normalized);
    }
  }

  let comparison: ComparisonMeta | null = null;
  if (report.comparison) {
    const view = report.comparison.viewConsistency;
    const vis = report.comparison.visibility;
    comparison = {
      sameLocation: Boolean(report.comparison.sameLocation),
      viewConsistency: view === 'good' || view === 'poor' ? view : 'fair',
      visibility: vis === 'good' || vis === 'poor' ? vis : 'fair',
      comparisonConfidence: Math.max(0, Math.min(100, Number(report.comparison.comparisonConfidence) || 0)),
    };
  }

  return {
    summary,
    overallProgress: {
      percentage: pct,
      description: polishProgressDescription(progressDesc, pct),
    },
    comparison,
    changes: structured,
    changesDetected: changes,
    completedWork: normalizeStringArray(report.completedWork),
    newlyAdded: normalizeStringArray(report.newlyAdded),
    removedItems: normalizeStringArray(report.removedItems),
    pendingWork: normalizeStringArray(report.pendingWork),
    qualityObservations: normalizeStringArray(report.qualityObservations),
    risks: normalizeStringArray(report.risks),
    recommendedNextSteps: normalizeStringArray(report.recommendedNextSteps),
    confidence: Math.max(0, Math.min(100, Number(report.confidence) || 0)),
  };
}

export function formatChangeForDisplay(change: ChangeDetected | NormalizedChange): NormalizedChange {
  if ('text' in change && typeof change.text === 'string') {
    return change as NormalizedChange;
  }
  const c = change as ChangeDetected;
  return normalizeChangeItem(c) ?? {
    text: humanizeChange(c.category, c.change),
    importance: normalizeImportance(c.importance),
    category: c.category || 'General',
  };
}
