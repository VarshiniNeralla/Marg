/**
 * Drishti Chat → professional construction intelligence PDF.
 *
 * Layout engine mirrors constructionProgressPdf.ts:
 * measure each block → greedy pack into A4 body height → only break when needed.
 * Content meaning is preserved; only presentation / hierarchy change.
 */
import type {
  DrishtiConversationDetail,
  DrishtiEvidenceRef,
  DrishtiMessage,
  DrishtiMetric,
} from '@/types/drishti';
import { exportHtmlToPdf } from '@/utils/htmlToPdf';

const BRAND_NAME = 'SiteVision';
const BRAND_TAGLINE = 'AI Construction Intelligence';
const A4_WIDTH_PX = 794;
/**
 * Usable page-body height after header/footer/padding.
 * Keep well under A4 so packed pages never overflow into html2canvas
 * slicing (which produced blank "footer-only" PDF sheets).
 */
const PAGE_BODY_MAX_PX = 860;
const CONTENT_WIDTH_PX = A4_WIDTH_PX - 121; // ~16mm side margins

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline **bold** → <strong>, matching DrishtiMarkdown. */
function inlineMarkdownToHtml(text: string): string {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map(part => {
      const bold = /^\*\*([^*]+)\*\*$/.exec(part);
      if (bold) return `<strong>${escapeHtml(bold[1])}</strong>`;
      return escapeHtml(part);
    })
    .join('');
}

/**
 * Convert the Drishti markdown subset (headings, bullets, **bold**) to HTML.
 * Same rules as DrishtiMarkdown.tsx — keeps PDF output consistent with chat UI.
 */
function richTextToHtml(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const parts: string[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const body = inlineMarkdownToHtml(paragraphLines.join('\n').trim());
    if (body) parts.push(`<p class="answer-p">${body}</p>`);
    paragraphLines = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    parts.push(`<ul class="blist">${listItems.map(i => `<li>${inlineMarkdownToHtml(i)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(line);

    if (headingMatch) {
      flushParagraph();
      flushList();
      parts.push(`<div class="md-heading">${inlineMarkdownToHtml(headingMatch[2].trim())}</div>`);
    } else if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1].trim());
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphLines.push(line);
    }
  }
  flushParagraph();
  flushList();
  return parts.join('');
}

function formatWhen(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function formatDateLong(iso: string | undefined | null): string {
  if (!iso) return new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function padQ(n: number): string {
  return String(n).padStart(2, '0');
}

// ── Status detection (presentation only) ─────────────────────────────────────

type DataStatus =
  | 'not_configured'
  | 'no_evidence'
  | 'insufficient_data'
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | null;

const STATUS_LABEL: Record<Exclude<DataStatus, null>, string> = {
  not_configured: 'Not Configured',
  no_evidence: 'No Photo Evidence',
  insufficient_data: 'Insufficient Data',
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const STATUS_TONE: Record<Exclude<DataStatus, null>, string> = {
  not_configured: '#64748b',
  no_evidence: '#94a3b8',
  insufficient_data: '#b45309',
  not_started: '#64748b',
  in_progress: '#d97706',
  completed: '#16a34a',
};

function detectStatus(text: string): DataStatus {
  const t = text.toLowerCase();
  // Never treat structured / multi-line answers as compact status cards —
  // those need full markdown rendering.
  if (text.includes('\n') || /^\s*[-*]\s+/m.test(text) || (text.match(/\*\*/g) || []).length >= 2) {
    return null;
  }
  if (/\bnot configured\b|\bis not configured\b|\bhasn't been configured\b|\bhas not been configured\b/.test(t)) {
    return 'not_configured';
  }
  if (/\bno (photo )?evidence\b|\bnot (yet )?captured\b|\bhas not been captured\b|\bhaven't been captured\b|\bno captures?\b/.test(t)
    && t.length < 420) {
    return 'no_evidence';
  }
  if (/\binsufficient (data|evidence)\b|\bnot enough (data|evidence)\b|\bcannot (be )?assessed\b|\bunable to assess\b/.test(t)) {
    return 'insufficient_data';
  }
  if (/\bnot started\b|\bhas not started\b/.test(t) && t.length < 360) {
    return 'not_started';
  }
  if (/\bcompleted\b|\b100%\b/.test(t) && t.length < 280 && !/\bin progress\b/.test(t)) {
    return 'completed';
  }
  if (/\bin progress\b|\bpartially\b/.test(t) && t.length < 220) {
    return 'in_progress';
  }
  return null;
}

// ── Content-aware restructuring (same words, better layout) ──────────────────

/** Parse "Flat 01: Room A, Room B" style text into table rows. */
function parseFlatRoomRows(text: string): { flat: string; rooms: string }[] | null {
  const rows: { flat: string; rooms: string }[] = [];
  // Prefer explicit line-based rows
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const lineRe = /^(?:[-•*]?\s*)?(Flat\s*0*\d+|Common\s*Area[^\n:–—]*)\s*[:\-–—]\s*(.+)$/i;

  for (const line of lines) {
    const m = line.match(lineRe);
    if (m) {
      rows.push({ flat: m[1].trim(), rooms: m[2].trim().replace(/\.\s*$/, '') });
      continue;
    }
    if (rows.length && /^[A-Za-z0-9]/.test(line) && !/^(facts?|insights?|recommend)/i.test(line) && line.includes(',')) {
      const last = rows[rows.length - 1];
      last.rooms = `${last.rooms}, ${line}`;
    }
  }

  if (rows.length >= 2) return rows;

  // Inline prose: "Flat 01: A, B. Flat 02: C, D."
  const inlineRe = /(Flat\s*0*\d+|Common\s*Area)\s*[:\-–—]\s*([^]*?)(?=(?:Flat\s*0*\d+|Common\s*Area)\s*[:\-–—]|$)/gi;
  const inlineRows: { flat: string; rooms: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(text)) !== null) {
    const rooms = m[2].replace(/\s+/g, ' ').trim().replace(/[.;]\s*$/, '');
    if (rooms.split(',').length >= 2 || rooms.length > 8) {
      inlineRows.push({ flat: m[1].trim(), rooms });
    }
  }
  return inlineRows.length >= 2 ? inlineRows : null;
}

/** Group bullet-like lines under Flat Finishing / Common Area headings when present. */
function groupActivityLines(text: string): { title: string; items: string[] }[] | null {
  const lines = text.split(/\n+/).map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  if (lines.length < 6) return null;

  const groups: { title: string; items: string[] }[] = [];
  let current: { title: string; items: string[] } | null = null;

  const isHeading = (l: string) =>
    /^(flat finishing(\s+works)?|common area(\s+works)?|activities being tracked|corridor works|staircase works|residential works)\s*:?$/i.test(l);

  for (const line of lines) {
    if (isHeading(line)) {
      current = { title: line.replace(/:$/, ''), items: [] };
      groups.push(current);
      continue;
    }
    if (!current) continue; // skip lead-in narrative until a real heading
    if (line.length > 100) continue;
    current.items.push(line);
  }

  const useful = groups.filter(g => g.items.length >= 2);
  return useful.length >= 1 && useful.some(g => g.items.length >= 3) ? useful : null;
}

function renderBulletList(items: string[]): string {
  if (!items.length) return '';
  return `<ul class="blist">${items.map(i => `<li>${inlineMarkdownToHtml(i)}</li>`).join('')}</ul>`;
}

function renderMetricCards(metrics: DrishtiMetric[]): string {
  if (!metrics.length) return '';
  const n = metrics.length;
  const cols = n === 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : n === 4 ? 4 : 3;
  return `
    <div class="metric-grid cols-${cols}${n === 1 ? ' single' : ''}">
      ${metrics.map(m => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(m.label)}</div>
          <div class="metric-value">${escapeHtml(m.value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSectionList(kind: 'facts' | 'insights' | 'recommendations' | 'evidence', title: string, items: string[]): string {
  if (!items.length) return '';
  return `
    <div class="sec sec-${kind}">
      <div class="sec-label">${escapeHtml(title)}</div>
      ${renderBulletList(items)}
    </div>
  `;
}

function evidenceLines(evidence: DrishtiEvidenceRef[]): string[] {
  return evidence.map(e => {
    const where = [e.flatName, e.roomName].filter(Boolean).join(' · ');
    if (where && e.note) return `${where}: ${e.note}`;
    if (where) return where;
    return e.note || '—';
  });
}

function renderStatusBlock(status: Exclude<DataStatus, null>, summary: string): string {
  const tone = STATUS_TONE[status];
  return `
    <div class="status-block" style="border-left-color:${tone}">
      <div class="status-kicker">Data Status</div>
      <div class="status-value" style="color:${tone}">${escapeHtml(STATUS_LABEL[status])}</div>
      <div class="status-summary">${inlineMarkdownToHtml(summary)}</div>
    </div>
  `;
}

function renderAnswerBody(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';

  // Flat → rooms table (strip markdown markers from cells for clean table text)
  const flatRows = parseFlatRoomRows(trimmed.replace(/\*\*/g, ''));
  if (flatRows) {
    const firstFlatIdx = trimmed.search(/Flat\s*0*\d+|Common\s*Area/i);
    const lead = firstFlatIdx > 0 ? trimmed.slice(0, firstFlatIdx).trim() : '';
    return `
      ${lead ? richTextToHtml(lead) : ''}
      <div class="sec-label">Rooms Not Yet Captured</div>
      <table class="room-table">
        <thead><tr><th>Flat</th><th>Rooms</th></tr></thead>
        <tbody>
          ${flatRows.map(r => `
            <tr>
              <td class="flat-cell">${escapeHtml(r.flat)}</td>
              <td class="rooms-cell">${inlineMarkdownToHtml(r.rooms)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Activity groups — strip ** for grouping, render chips escaped
  const groups = groupActivityLines(trimmed.replace(/\*\*/g, ''));
  if (groups) {
    const firstHeading = trimmed.search(/flat finishing|common area|activities being tracked/i);
    const lead = firstHeading > 20 ? trimmed.slice(0, firstHeading).trim() : '';
    return `
      ${lead ? richTextToHtml(lead) : ''}
      <div class="sec-label">Activities Being Tracked</div>
      ${groups.map(g => `
        <div class="activity-group">
          <div class="activity-group-title">${escapeHtml(g.title)}</div>
          <div class="chip-wrap">
            ${g.items.map(i => `<span class="act-chip">${inlineMarkdownToHtml(i)}</span>`).join('')}
          </div>
        </div>
      `).join('')}
    `;
  }

  // Default: full markdown subset (bullets, headings, bold)
  return richTextToHtml(trimmed);
}

// ── Measure + pack ───────────────────────────────────────────────────────────

const MEASURE_STYLES = `
  * { box-sizing: border-box; }
  body, div, p, h1, h2, h3, span, li, ul, table, tr, td, th {
    font-family: 'Segoe UI', 'Helvetica Neue', Inter, system-ui, sans-serif;
    margin: 0;
  }
  .cover-brand-row { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px; }
  .cover-brand { font-size:11px; font-weight:800; letter-spacing:0.14em; text-transform:uppercase; color:#1a2332; }
  .cover-drishti { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#2563eb; }
  .cover-tagline { font-size:8px; font-weight:600; color:#8b95a5; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 14px; }
  .cover-doc-type { font-size:9px; font-weight:800; color:#8b95a5; letter-spacing:0.12em; text-transform:uppercase; margin:0 0 6px; }
  .cover-project { font-size:22px; font-weight:300; color:#1a2332; letter-spacing:-0.02em; margin:0 0 8px; line-height:1.15; }
  .cover-title { font-size:13px; font-weight:600; color:#334155; margin:0 0 4px; line-height:1.35; }
  .cover-sub { font-size:9.5px; color:#64748b; margin:0 0 12px; }
  .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:0; border-top:1px solid #e4e8ee; margin-bottom:14px; }
  .meta-item { padding:7px 10px 7px 0; border-bottom:1px solid #e4e8ee; }
  .meta-label { display:block; font-size:7.5px; font-weight:700; color:#8b95a5; text-transform:uppercase; letter-spacing:0.07em; margin-bottom:2px; }
  .meta-value { display:block; font-size:10.5px; font-weight:600; color:#1a2332; }
  .snap-label { font-size:9px; font-weight:800; color:#8b95a5; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 8px; }
  .metric-grid { display:grid; gap:6px; margin-bottom:10px; }
  .metric-grid.cols-1 { grid-template-columns:1fr; }
  .metric-grid.cols-2 { grid-template-columns:1fr 1fr; }
  .metric-grid.cols-3 { grid-template-columns:1fr 1fr 1fr; }
  .metric-grid.cols-4 { grid-template-columns:1fr 1fr 1fr 1fr; }
  .metric-grid.single { grid-template-columns:minmax(120px, 180px); }
  .metric-card { border:1px solid #e4e8ee; border-radius:4px; padding:6px 8px; background:#fafbfc; }
  .metric-label { font-size:7px; font-weight:700; color:#8b95a5; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px; }
  .metric-value { font-size:12px; font-weight:800; color:#1a2332; line-height:1.15; }
  .takeaway { border-left:3px solid #2563eb; padding:8px 10px; background:#f8fafc; margin-bottom:4px; }
  .takeaway-label { font-size:7.5px; font-weight:800; color:#8b95a5; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:4px; }
  .takeaway-text { font-size:10.5px; color:#334155; line-height:1.45; }
  .section-head { font-size:12px; font-weight:700; color:#1a2332; margin:4px 0 8px; padding-bottom:4px; border-bottom:1px solid #e4e8ee; }
  .q-block { background:#f1f5f9; border-radius:4px; padding:6px 9px; margin-bottom:4px; }
  .q-meta { display:flex; align-items:center; gap:8px; margin-bottom:3px; }
  .q-num { font-size:9px; font-weight:800; color:#2563eb; letter-spacing:0.04em; }
  .q-badge { font-size:7px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.06em;
    border:1px solid #cbd5e1; border-radius:3px; padding:1px 5px; }
  .q-text { font-size:11px; font-weight:600; color:#1a2332; line-height:1.35; }
  .a-label { font-size:7.5px; font-weight:800; color:#8b95a5; letter-spacing:0.08em; text-transform:uppercase; margin:2px 0 4px; }
  .answer-lead, .answer-p { font-size:10.5px; color:#1a2332; line-height:1.45; margin:0 0 6px; white-space:pre-wrap; }
  .answer-p strong, .blist strong, .status-summary strong, .act-chip strong, .takeaway-text strong { font-weight:700; }
  .md-heading { font-size:11px; font-weight:700; color:#1a2332; margin:6px 0 4px; }
  .status-block { border-left:3px solid #94a3b8; padding:5px 9px; background:#f8fafc; margin-bottom:6px; }
  .status-kicker { font-size:7px; font-weight:800; color:#8b95a5; letter-spacing:0.08em; text-transform:uppercase; }
  .status-value { font-size:11px; font-weight:800; margin:2px 0 3px; }
  .status-summary { font-size:10px; color:#475569; line-height:1.4; }
  .sec { margin:6px 0 2px; }
  .sec-label { font-size:7.5px; font-weight:800; color:#8b95a5; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 3px; }
  .sec-insights { border-left:2px solid #f59e0b; padding-left:8px; }
  .sec-recommendations { border-left:2px solid #2563eb; padding-left:8px; }
  .sec-evidence { border-top:1px dashed #e4e8ee; padding-top:6px; }
  .blist { margin:0; padding-left:14px; }
  .blist li { font-size:9.5px; color:#1a2332; line-height:1.35; margin-bottom:1px; }
  .room-table { width:100%; border-collapse:collapse; font-size:9px; margin-bottom:6px; }
  .room-table th { text-align:left; padding:3px 6px; background:#f1f4f8; color:#4a5568; font-weight:700;
    text-transform:uppercase; font-size:7px; letter-spacing:0.04em; }
  .room-table td { padding:3px 6px; border-bottom:1px solid #eef1f5; vertical-align:top; line-height:1.35; }
  .flat-cell { width:18%; font-weight:700; white-space:nowrap; }
  .rooms-cell { width:82%; }
  .activity-group { margin-bottom:6px; }
  .activity-group-title { font-size:8px; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 4px; }
  .chip-wrap { display:flex; flex-wrap:wrap; gap:3px; }
  .act-chip { display:inline-block; font-size:8px; color:#1a2332; background:#f1f5f9; border:1px solid #e2e8f0;
    border-radius:3px; padding:2px 6px; line-height:1.3; }
  .cont-label { font-size:8px; font-weight:700; color:#8b95a5; letter-spacing:0.04em; text-transform:uppercase; margin:0 0 6px; }
  .qa-divider { height:1px; background:#eef1f5; margin:8px 0 8px; }
  .findings-block, .followups-block { margin-top:2px; }
  .findings-item { font-size:10px; color:#1a2332; line-height:1.4; margin:0 0 5px; padding-left:8px; border-left:2px solid #cbd5e1; }
  .empty-note { font-size:10px; color:#94a3b8; font-style:italic; }
`;

type FlowBlock = {
  html: string;
  height: number;
  keepWithNext?: boolean;
  /** Soft tag for continuation headers when a turn splits. */
  turnId?: string;
  continuedLabel?: string;
};

function measureHtmlHeight(html: string): number {
  const host = document.createElement('div');
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    `width:${A4_WIDTH_PX}px`,
    'visibility:hidden',
    'pointer-events:none',
  ].join(';');
  const styleEl = document.createElement('style');
  styleEl.textContent = MEASURE_STYLES;
  const wrap = document.createElement('div');
  wrap.style.cssText = `width:${CONTENT_WIDTH_PX}px;`;
  wrap.innerHTML = html;
  host.appendChild(styleEl);
  host.appendChild(wrap);
  document.body.appendChild(host);
  const height = Math.ceil(wrap.getBoundingClientRect().height);
  document.body.removeChild(host);
  return Math.max(1, height);
}

function block(html: string, opts?: Partial<FlowBlock>): FlowBlock {
  return {
    html,
    height: measureHtmlHeight(html),
    keepWithNext: opts?.keepWithNext,
    turnId: opts?.turnId,
    continuedLabel: opts?.continuedLabel,
  };
}

/**
 * Greedy packer. Continuation chrome is prepended to the next content block
 * (never flushed alone — that produced blank PDF pages with only a footer).
 */
function packFlow(blocks: FlowBlock[], maxBodyPx = PAGE_BODY_MAX_PX): string[] {
  if (!blocks.length) return [];
  const pages: string[] = [];
  let current: FlowBlock[] = [];
  let used = 0;
  let openTurn: string | null = null;
  const MIN_KEEP_PX = 72;

  const flush = () => {
    if (!current.length) return;
    // Drop pages that are only tiny chrome (would rasterize as blank sheets)
    const substantive = current.some(b => !b.html.includes('class="cont-label"') || b.height > 40);
    if (substantive) {
      pages.push(current.map(b => b.html).join(''));
    }
    const lastTurn = [...current].reverse().find(b => b.turnId);
    openTurn = lastTurn?.turnId ?? null;
    current = [];
    used = 0;
  };

  const aheadKeepHeight = (from: number): number => {
    let h = 0;
    for (let j = from; j < blocks.length && h < MIN_KEEP_PX; j++) {
      h += blocks[j].height;
    }
    return h;
  };

  for (let i = 0; i < blocks.length; i++) {
    let b = blocks[i];

    // Prepend continuation label into this block when starting a new page mid-turn
    if (current.length === 0 && openTurn && b.turnId === openTurn && b.continuedLabel) {
      const contHtml = `<div class="cont-label">${escapeHtml(b.continuedLabel)}</div>`;
      const merged = `${contHtml}${b.html}`;
      b = {
        ...b,
        html: merged,
        height: measureHtmlHeight(merged),
      };
    }

    if (b.keepWithNext && current.length > 0) {
      const need = b.height + aheadKeepHeight(i + 1);
      if (used + need > maxBodyPx) {
        flush();
        // Re-apply continuation after flush if still mid-turn
        if (openTurn && b.turnId === openTurn && b.continuedLabel && !b.html.includes('class="cont-label"')) {
          const contHtml = `<div class="cont-label">${escapeHtml(b.continuedLabel)}</div>`;
          const merged = `${contHtml}${b.html}`;
          b = { ...b, html: merged, height: measureHtmlHeight(merged) };
        }
      }
    }

    if (used + b.height > maxBodyPx && current.length > 0) {
      flush();
      if (openTurn && b.turnId === openTurn && b.continuedLabel && !b.html.includes('class="cont-label"')) {
        const contHtml = `<div class="cont-label">${escapeHtml(b.continuedLabel)}</div>`;
        const merged = `${contHtml}${b.html}`;
        b = { ...b, html: merged, height: measureHtmlHeight(merged) };
      }
    }

    // Oversized single block: still place it (splitTallHtml should have prevented most)
    current.push(b);
    used += b.height;
    if (b.turnId) openTurn = b.turnId;
  }
  flush();
  return pages.filter(p => p.trim().length > 0);
}

/** Split a tall HTML list/table into smaller measured chunks. */
function splitTallHtml(html: string, maxPx: number, continuedLabel: string, turnId: string): FlowBlock[] {
  const h = measureHtmlHeight(html);
  if (h <= maxPx) {
    return [block(html, { turnId, continuedLabel })];
  }

  // Try splitting table rows
  const rowMatch = html.match(/([\s\S]*?<tbody>)([\s\S]*?)(<\/tbody>[\s\S]*)/);
  if (rowMatch) {
    const [, head, body, tail] = rowMatch;
    const rows = body.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
    if (rows.length >= 2) {
      const out: FlowBlock[] = [];
      let chunkRows: string[] = [];
      let first = true;
      const flushChunk = () => {
        if (!chunkRows.length) return;
        const piece = `${first ? head : head.replace('</thead>', '</thead><!--cont-->')}${chunkRows.join('')}${tail}`;
        // Rebuild with thead always
        const full = `${head}${chunkRows.join('')}${tail}`;
        out.push(block(full, {
          turnId,
          continuedLabel: first ? continuedLabel : `${continuedLabel} — continued`,
        }));
        chunkRows = [];
        first = false;
        void piece;
      };
      for (const row of rows) {
        chunkRows.push(row);
        const probe = `${head}${chunkRows.join('')}${tail}`;
        if (measureHtmlHeight(probe) > maxPx - 20 && chunkRows.length > 1) {
          chunkRows.pop();
          flushChunk();
          chunkRows = [row];
        }
      }
      flushChunk();
      return out.length ? out : [block(html, { turnId, continuedLabel })];
    }
  }

  // Split chip wraps / bullet lists by item count
  const chips = html.match(/<span class="act-chip">[\s\S]*?<\/span>/g);
  if (chips && chips.length >= 8) {
    const wrapOpen = html.indexOf('<div class="chip-wrap">');
    if (wrapOpen >= 0) {
      const before = html.slice(0, wrapOpen);
      const afterMatch = html.slice(wrapOpen).match(/<\/div>([\s\S]*)$/);
      const after = afterMatch ? afterMatch[1] : '';
      const out: FlowBlock[] = [];
      let start = 0;
      let first = true;
      while (start < chips.length) {
        let end = start + 1;
        while (end <= chips.length) {
          const probe = `${before}<div class="chip-wrap">${chips.slice(start, end).join('')}</div>${after}`;
          if (measureHtmlHeight(probe) > maxPx - 24 && end > start + 1) {
            end -= 1;
            break;
          }
          if (end === chips.length) break;
          end += 1;
        }
        const piece = `${first ? before : ''}<div class="chip-wrap">${chips.slice(start, end).join('')}</div>${end >= chips.length ? after : ''}`;
        out.push(block(piece, {
          turnId,
          continuedLabel: first ? continuedLabel : `${continuedLabel} — continued`,
        }));
        first = false;
        start = end;
      }
      return out;
    }
  }

  // Paragraph / list fallback: split by top-level blocks so we never hand a
  // taller-than-A4 page to html2canvas (slicing caused blank PDF sheets).
  const topBlocks = html.match(/<(?:p|ul|div|table)[\s\S]*?(?:<\/(?:p|ul|div|table)>)/g);
  if (topBlocks && topBlocks.length >= 2) {
    const out: FlowBlock[] = [];
    let chunk: string[] = [];
    let first = true;
    const flushChunk = () => {
      if (!chunk.length) return;
      out.push(block(chunk.join(''), {
        turnId,
        continuedLabel: first ? continuedLabel : `${continuedLabel} — continued`,
      }));
      chunk = [];
      first = false;
    };
    for (const piece of topBlocks) {
      chunk.push(piece);
      if (measureHtmlHeight(chunk.join('')) > maxPx - 20 && chunk.length > 1) {
        chunk.pop();
        flushChunk();
        chunk = [piece];
      }
    }
    flushChunk();
    if (out.length) return out;
  }

  return [block(html, { turnId, continuedLabel })];
}

// ── Conversation pairing ─────────────────────────────────────────────────────

type QaTurn = {
  qNum: number;
  question: string;
  askedAt?: string;
  answer: DrishtiMessage | null;
  isFollowUp: boolean;
};

function pairTurns(messages: DrishtiMessage[]): QaTurn[] {
  const turns: QaTurn[] = [];
  let qNum = 0;
  let i = 0;
  const seenQuestions = new Map<string, number>();

  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'user') {
      qNum += 1;
      const key = m.content.trim().toLowerCase();
      const prev = seenQuestions.get(key);
      const isFollowUp = prev != null;
      seenQuestions.set(key, qNum);
      const next = messages[i + 1];
      const answer = next && next.role === 'assistant' ? next : null;
      turns.push({
        qNum,
        question: m.content,
        askedAt: m.createdAt,
        answer,
        isFollowUp: isFollowUp || /^\s*(what about|what other|and |also |follow.?up|additionally|any other)/i.test(m.content),
      });
      i += answer ? 2 : 1;
      continue;
    }
    // Orphan assistant message
    qNum += 1;
    turns.push({
      qNum,
      question: '(Continued analysis)',
      answer: m,
      isFollowUp: true,
    });
    i += 1;
  }
  return turns;
}

function buildCoverBlocks(opts: {
  title: string;
  projectName: string;
  messages: DrishtiMessage[];
  conversation?: DrishtiConversationDetail | null;
  snapshotMetrics: DrishtiMetric[];
  keyTakeaway: string | null;
}): FlowBlock[] {
  const { title, projectName, messages, conversation, snapshotMetrics, keyTakeaway } = opts;
  const generated = formatDateLong(conversation?.updatedAt || conversation?.createdAt);

  const blocks: FlowBlock[] = [];
  blocks.push(block(`
    <div class="cover-brand-row">
      <span class="cover-brand">${escapeHtml(BRAND_NAME)}</span>
      <span class="cover-drishti">Drishti</span>
    </div>
    <p class="cover-tagline">${escapeHtml(BRAND_TAGLINE)}</p>
    <p class="cover-doc-type">Project Progress Report</p>
    <h1 class="cover-project">${escapeHtml(projectName || 'Project')}</h1>
    <p class="cover-title">${escapeHtml(title || 'Untitled chat')}</p>
    <p class="cover-sub">Conversation export · ${escapeHtml(generated)}</p>
  `, { keepWithNext: true }));

  blocks.push(block(`
    <div class="meta-grid">
      <div class="meta-item"><span class="meta-label">Project</span><span class="meta-value">${escapeHtml(projectName || '—')}</span></div>
      <div class="meta-item"><span class="meta-label">Messages</span><span class="meta-value">${messages.length}</span></div>
      <div class="meta-item"><span class="meta-label">Started</span><span class="meta-value">${escapeHtml(formatWhen(conversation?.createdAt))}</span></div>
      <div class="meta-item"><span class="meta-label">Updated</span><span class="meta-value">${escapeHtml(formatWhen(conversation?.updatedAt))}</span></div>
    </div>
  `));

  if (snapshotMetrics.length) {
    blocks.push(block(`<div class="snap-label">Executive Snapshot</div>`, { keepWithNext: true }));
    blocks.push(block(renderMetricCards(snapshotMetrics.slice(0, 6))));
  }

  if (keyTakeaway) {
    blocks.push(block(`
      <div class="takeaway">
        <div class="takeaway-label">Key Takeaway</div>
        <div class="takeaway-text">${inlineMarkdownToHtml(keyTakeaway)}</div>
      </div>
    `));
  }

  return blocks;
}

function buildTurnBlocks(turn: QaTurn): FlowBlock[] {
  const turnId = `q${turn.qNum}`;
  const blocks: FlowBlock[] = [];
  const cont = `Question ${padQ(turn.qNum)} — continued`;
  const contAnalysis = `Question ${padQ(turn.qNum)} — Drishti analysis continued`;

  blocks.push(block(`<div class="qa-divider"></div>`));

  const qHtml = `
    <div class="q-block">
      <div class="q-meta">
        <span class="q-num">${padQ(turn.qNum)}</span>
        <span class="q-badge">${turn.isFollowUp ? 'Follow-up' : 'Question'}</span>
      </div>
      <div class="q-text">${escapeHtml(turn.question)}</div>
    </div>
  `;

  if (!turn.answer) {
    blocks.push(block(qHtml, { keepWithNext: true, turnId, continuedLabel: cont }));
    blocks.push(block(`<p class="empty-note">No response recorded for this question.</p>`, { turnId }));
    return blocks;
  }

  const payload = turn.answer.structuredPayload;
  const content = (payload?.answer || turn.answer.content || '').trim();
  const status = detectStatus(content);

  // Keep question + Drishti label + first payload together to avoid orphans
  const opening = `
    ${qHtml}
    <div class="a-label">Drishti Analysis</div>
  `;
  blocks.push(block(opening, { keepWithNext: true, turnId, continuedLabel: contAnalysis }));

  if (status && content.length < 500) {
    blocks.push(block(renderStatusBlock(status, content), { turnId, continuedLabel: cont }));
  } else {
    const bodyHtml = renderAnswerBody(content);
    blocks.push(...splitTallHtml(bodyHtml, PAGE_BODY_MAX_PX - 80, contAnalysis, turnId));
  }

  const metrics = payload?.metrics ?? [];
  if (metrics.length) {
    blocks.push(block(renderMetricCards(metrics), { turnId, continuedLabel: cont }));
  }

  if (payload?.facts?.length) {
    // Skip facts that merely repeat the short status summary
    const facts = status && content.length < 500
      ? payload.facts.filter(f => f.trim().toLowerCase() !== content.trim().toLowerCase())
      : payload.facts;
    if (facts.length) {
      blocks.push(block(renderSectionList('facts', 'Facts', facts), { turnId, continuedLabel: cont }));
    }
  }
  if (payload?.insights?.length) {
    blocks.push(block(renderSectionList('insights', 'Insights', payload.insights), { turnId, continuedLabel: cont }));
  }
  if (payload?.recommendations?.length) {
    blocks.push(block(renderSectionList('recommendations', 'Recommendations', payload.recommendations), { turnId, continuedLabel: cont }));
  }
  if (payload?.evidence?.length) {
    blocks.push(block(renderSectionList('evidence', 'Evidence', evidenceLines(payload.evidence)), { turnId, continuedLabel: cont }));
  }

  return blocks;
}

function collectSnapshotMetrics(messages: DrishtiMessage[]): DrishtiMetric[] {
  const seen = new Set<string>();
  const out: DrishtiMetric[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.structuredPayload?.metrics?.length) continue;
    for (const metric of m.structuredPayload.metrics) {
      const key = metric.label.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(metric);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

function collectKeyTakeaway(messages: DrishtiMessage[]): string | null {
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const p = m.structuredPayload;
    if (p?.insights?.[0]) return p.insights[0];
    const answer = (p?.answer || m.content || '').trim();
    if (answer) {
      // First 1–2 sentences, unchanged wording
      const cut = answer.match(/^(.+?[.!?])(?:\s+|$)/);
      return (cut?.[1] || answer).slice(0, 320);
    }
  }
  return null;
}

function collectImportantFindings(turns: QaTurn[]): string[] {
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const t of turns) {
    const p = t.answer?.structuredPayload;
    if (!p) continue;
    for (const src of [...(p.insights || []), ...(p.recommendations || []).slice(0, 1)]) {
      const key = src.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      findings.push(src);
      if (findings.length >= 8) return findings;
    }
  }
  return findings;
}

function collectFollowUps(turns: QaTurn[]): string[] {
  const asked = new Set(turns.map(t => t.question.trim().toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of turns) {
    for (const q of t.answer?.structuredPayload?.followUpQuestions ?? []) {
      const key = q.trim().toLowerCase();
      if (!key || seen.has(key) || asked.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (out.length >= 10) return out;
    }
  }
  return out;
}

function pageShell(inner: string, pageNum: number, totalPages: number): string {
  return `
    <section class="print-page">
      <div class="page-header">
        <div class="brand-lockup">
          <span class="brand-name">${escapeHtml(BRAND_NAME)}</span>
          <span class="brand-divider"></span>
          <span class="brand-doc">Drishti Chat</span>
        </div>
        <span class="brand-tagline">${escapeHtml(BRAND_TAGLINE)}</span>
      </div>
      <div class="page-body">${inner}</div>
      <div class="page-footer">
        <div class="footer-brand">${escapeHtml(BRAND_NAME)}</div>
        <div class="footer-page">Page ${pageNum} of ${totalPages}</div>
      </div>
    </section>
  `;
}

const FINAL_STYLES = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Segoe UI', 'Helvetica Neue', Inter, system-ui, sans-serif;
    color: #1a2332; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Fixed A4 box — never grow past one sheet (avoids html2canvas slice blanks). */
  .print-page {
    position: relative; width: 210mm; height: 297mm; max-height: 297mm;
    padding: 12mm 16mm 18mm; overflow: hidden; background: #fff;
    page-break-after: always; box-sizing: border-box;
  }
  .print-page:last-child { page-break-after: auto; }
  .page-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    padding-bottom: 6px; margin-bottom: 10px; border-bottom: 1.5px solid #1a2332;
  }
  .brand-lockup { display: flex; align-items: center; gap: 8px; }
  .brand-name { font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
  .brand-divider { width: 1px; height: 14px; background: #c4cdd8; }
  .brand-doc { font-size: 10px; font-weight: 600; color: #4a5568; }
  .brand-tagline { font-size: 8px; font-weight: 600; color: #8b95a5; letter-spacing: 0.06em; text-transform: uppercase; }
  .page-footer {
    position: absolute; left: 16mm; right: 16mm; bottom: 10mm;
    padding-top: 6px; border-top: 1px solid #e4e8ee;
    display: flex; justify-content: space-between; font-size: 7.5px; color: #8b95a5;
    background: #fff;
  }
  .footer-brand { font-weight: 700; color: #4a5568; }
  .page-body { padding-bottom: 8mm; }
  ${MEASURE_STYLES}
`;

/** Build full HTML document for Drishti chat PDF (also used by preview / tests). */
export function buildDrishtiChatPdfHtml(opts: {
  title: string;
  projectName: string;
  messages: DrishtiMessage[];
  conversation?: DrishtiConversationDetail | null;
}): string {
  const { title, projectName, messages, conversation } = opts;
  const turns = pairTurns(messages);
  const snapshotMetrics = collectSnapshotMetrics(messages);
  const keyTakeaway = collectKeyTakeaway(messages);
  const findings = collectImportantFindings(turns);
  const followUps = collectFollowUps(turns);

  const flow: FlowBlock[] = [];
  flow.push(...buildCoverBlocks({
    title, projectName, messages, conversation, snapshotMetrics, keyTakeaway,
  }));

  flow.push(block(`<div class="section-head">Conversation &amp; Analysis</div>`, { keepWithNext: true }));

  if (!turns.length) {
    flow.push(block(`<p class="empty-note">No messages in this chat yet.</p>`));
  } else {
    for (const turn of turns) {
      flow.push(...buildTurnBlocks(turn));
    }
  }

  if (findings.length) {
    flow.push(block(`<div class="section-head">Important Findings</div>`, { keepWithNext: true }));
    flow.push(block(`
      <div class="findings-block">
        ${findings.map(f => `<div class="findings-item">${inlineMarkdownToHtml(f)}</div>`).join('')}
      </div>
    `));
  }

  if (followUps.length) {
    flow.push(block(`<div class="section-head">Follow-up / Remaining Questions</div>`, { keepWithNext: true }));
    flow.push(block(`
      <div class="followups-block">
        ${renderBulletList(followUps)}
      </div>
    `));
  }

  const packed = packFlow(flow, PAGE_BODY_MAX_PX);
  const total = Math.max(1, packed.length);
  const body = packed.map((p, i) => pageShell(p, i + 1, total)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Drishti — ${escapeHtml(title || 'Chat')}</title>
  <style>${FINAL_STYLES}</style>
</head>
<body>${body}</body>
</html>`;
}

export async function exportDrishtiChatPdf(opts: {
  title: string;
  projectName: string;
  messages: DrishtiMessage[];
  conversation?: DrishtiConversationDetail | null;
}): Promise<void> {
  const html = buildDrishtiChatPdfHtml(opts);
  const fileName = buildDrishtiPdfFileName(opts.title);
  await exportHtmlToPdf(html, fileName, { appendTimestamp: false });
}

/** e.g. What-is-the-overall-project-progress_17-08-26 */
function buildDrishtiPdfFileName(title: string): string {
  const when = new Date();
  const dd = String(when.getDate()).padStart(2, '0');
  const mm = String(when.getMonth() + 1).padStart(2, '0');
  const yy = String(when.getFullYear()).slice(-2);
  const chat = (title || 'Drishti-Chat')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'Drishti-Chat';
  return `${chat}_${dd}-${mm}-${yy}`;
}
