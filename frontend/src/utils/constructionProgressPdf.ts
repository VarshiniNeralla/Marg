import type {
  ActivityAssessment,
  ActivityStatus,
  FlatProgress,
  FloorProgressSnapshot,
  RoomHeatmapState,
  RoomProgress,
} from '@/services/constructionProgressService';
import { ACTIVITY_STATUS_LABELS } from '@/services/constructionProgressService';
import { exportHtmlToPdf } from '@/utils/htmlToPdf';

const BRAND_NAME = 'SiteVision';
const BRAND_TAGLINE = 'AI Construction Intelligence';

/** A4 CSS px @ 96dpi — keep in sync with htmlToPdf.ts. */
const A4_WIDTH_PX = 794;
/**
 * Usable page-body height after header/footer/padding.
 * Tuned for ~70–90% utilisation without crowding chrome.
 */
const PAGE_BODY_MAX_PX = 920;
const EVIDENCE_MAX_CHARS = 240;
/** Prefer keeping room header + at least this many activity rows together. */
const MIN_ROWS_WITH_HEADER = 2;

const STATUS_COLOR: Record<ActivityStatus, string> = {
  no_evidence: '#94a3b8',
  not_assessed: '#94a3b8',
  not_observable: '#0891b2',
  in_progress: '#d97706',
  completed: '#16a34a',
};

const HEATMAP_COLOR: Record<RoomHeatmapState, string> = {
  no_images: '#cbd5e1',
  uploaded: '#d97706',
  in_progress: '#d97706',
  completed: '#16a34a',
};

const HEATMAP_LABEL: Record<RoomHeatmapState, string> = {
  no_images: 'No Photos Yet',
  uploaded: 'Work In Progress',
  in_progress: 'Work In Progress',
  completed: 'Completed',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function isCommonFlat(flat: FlatProgress): boolean {
  const name = (flat.flatName || '').trim().toLowerCase();
  return name === 'common area' || name === 'common' || name.startsWith('common area');
}

function truncateEvidence(text: string | null | undefined): string {
  const raw = (text || '').trim();
  if (!raw) return '—';
  if (raw.length <= EVIDENCE_MAX_CHARS) return raw;
  return `${raw.slice(0, EVIDENCE_MAX_CHARS - 1).trimEnd()}…`;
}

/** Shared styles for measuring and final PDF (subset + full report CSS later). */
const MEASURE_STYLES = `
  * { box-sizing: border-box; }
  body, div, table, tr, td, th, p, h1, h2, h3, h4, span, li, ul {
    font-family: 'Segoe UI', 'Helvetica Neue', Inter, system-ui, sans-serif;
    margin: 0;
  }
  .section-title { font-size: 15px; font-weight: 700; color: #1a2332; margin: 0 0 8px; }
  .coverage-note, .section-note, .group-hint { font-size: 8.5px; color: #6b7280; margin: 0 0 8px; line-height: 1.4; }
  .room-group-label, .group-title { font-size: 9px; font-weight: 800; color: #8b95a5; text-transform: uppercase; letter-spacing: 0.06em; margin: 8px 0 6px; }
  .flat-title { font-size: 12px; font-weight: 700; color: #1a2332; margin: 0 0 6px; }
  .flat-not-started { padding: 8px 10px; border: 1px dashed #d1d5db; border-radius: 6px; background: #fafbfc; margin-bottom: 6px; }
  .not-started-note { font-size: 9.5px; color: #6b7280; line-height: 1.4; }
  .room-block { margin-bottom: 8px; padding: 8px; border: 1px solid #e4e8ee; border-radius: 6px; background: #fafbfc; }
  .room-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; font-size: 9.5px; }
  .room-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
  .room-dot.inline { margin-right: 6px; vertical-align: middle; }
  .room-name { font-weight: 700; color: #1a2332; }
  .room-meta { color: #6b7280; font-weight: 600; }
  .cont-label { font-weight: 600; color: #8b95a5; font-size: 8px; }
  .cont-footer { font-size: 8px; color: #8b95a5; margin: 4px 0 0; font-style: italic; }
  table.room-activity-table, table.empty-rooms-table, table.activity-table, table.not-started-flats-table {
    width: 100%; border-collapse: collapse; font-size: 9px; background: #fff;
  }
  table.room-activity-table th, table.empty-rooms-table th, table.activity-table th, table.not-started-flats-table th {
    text-align: left; padding: 4px 6px; background: #f1f4f8; color: #4a5568; font-weight: 700;
    text-transform: uppercase; font-size: 7.5px; letter-spacing: 0.03em;
  }
  table.room-activity-table td, table.empty-rooms-table td, table.activity-table td, table.not-started-flats-table td {
    padding: 4px 6px; border-bottom: 1px solid #eef1f5; color: #1a2332; vertical-align: top; line-height: 1.35; height: auto;
  }
  table.room-activity-table td:nth-child(1) { width: 28%; }
  table.room-activity-table td:nth-child(2) { width: 12%; }
  table.room-activity-table td:nth-child(3) { width: 60%; }
  .empty-rooms-block, .rollup-block, .notes-block { margin-bottom: 8px; }
  .status-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 8px; font-weight: 700; }
  .muted { color: #94a3b8; font-style: italic; }
  .findings-list { margin: 0; padding-left: 16px; font-size: 10px; color: #333; line-height: 1.45; }
  .findings-list li { margin-bottom: 4px; }
  .cover-hero { margin-bottom: 14px; }
  .cover-eyebrow { font-size: 10px; font-weight: 800; color: #8b95a5; letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 6px; }
  .cover-title { font-size: 26px; font-weight: 300; color: #1a2332; margin: 0 0 4px; letter-spacing: -0.03em; line-height: 1.1; }
  .cover-subtitle { font-size: 11px; color: #5c6778; margin: 0; font-weight: 500; }
  .project-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 12px; border-top: 1px solid #e4e8ee; }
  .meta-item { padding: 7px 0; border-bottom: 1px solid #e4e8ee; }
  .meta-label { display: block; font-size: 8px; font-weight: 700; color: #8b95a5; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
  .meta-value { display: block; font-size: 11px; font-weight: 600; color: #1a2332; }
  .hero-card { display: flex; gap: 18px; align-items: flex-start; padding: 14px; border: 1px solid #e4e8ee; border-radius: 6px; margin-bottom: 12px; }
  .hero-progress { flex-shrink: 0; text-align: center; }
  .hero-pct { font-size: 34px; font-weight: 800; color: #2563eb; line-height: 1; }
  .hero-pct span { font-size: 16px; }
  .hero-progress-label { font-size: 8px; color: #8b95a5; font-weight: 700; text-transform: uppercase; margin-top: 3px; }
  .hero-body { flex: 1; min-width: 0; }
  .insights-heading { font-size: 9px; font-weight: 800; color: #8b95a5; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 6px; }
  .hero-summary { font-size: 10.5px; color: #333; line-height: 1.5; white-space: pre-wrap; }
  .findings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .finding-card { border: 1px solid #e4e8ee; border-radius: 6px; padding: 8px 10px; }
  .finding-card h3 { font-size: 8px; font-weight: 700; color: #8b95a5; text-transform: uppercase; margin: 0 0 3px; letter-spacing: 0.04em; }
  .finding-card p { font-size: 11px; font-weight: 700; color: #1a2332; margin: 0; }
  .disclaimer { font-size: 8px; color: #8b95a5; line-height: 1.45; }
  .disclaimer p { margin: 0 0 4px; }
`;

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
  // Match printable content width (16mm side padding ≈ 60.5px each).
  wrap.style.cssText = `width:${A4_WIDTH_PX - 121}px;`;
  wrap.innerHTML = html;
  host.appendChild(styleEl);
  host.appendChild(wrap);
  document.body.appendChild(host);
  const height = Math.ceil(wrap.getBoundingClientRect().height);
  document.body.removeChild(host);
  return Math.max(1, height);
}

type FlowBlock = {
  html: string;
  height: number;
  /** Soft keep-with-next: try not to orphan this tiny chrome alone. */
  keepWithNext?: boolean;
};

function block(html: string, keepWithNext = false): FlowBlock {
  return { html, height: measureHtmlHeight(html), keepWithNext };
}

/**
 * Greedy height packer — places blocks onto pages using measured heights.
 * Continues filling the current page whenever the next block fits.
 */
function packFlow(blocks: FlowBlock[], maxBodyPx = PAGE_BODY_MAX_PX): string[] {
  if (blocks.length === 0) return [];

  const pages: string[] = [];
  let current: FlowBlock[] = [];
  let used = 0;

  const flush = () => {
    if (!current.length) return;
    pages.push(current.map(b => b.html).join(''));
    current = [];
    used = 0;
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = i + 1 < blocks.length ? blocks[i + 1] : null;

    // Keep tiny section titles with the following content — if header+next
    // won't fit here, start a new page before placing the header.
    if (b.keepWithNext && next && current.length > 0) {
      if (used + b.height + next.height > maxBodyPx) {
        flush();
      }
    }

    if (used + b.height > maxBodyPx && current.length > 0) {
      flush();
    }

    current.push(b);
    used += b.height;
  }
  flush();
  return pages;
}

function pageShell(inner: string, pageNum: number, totalPages: number): string {
  return `
    <section class="print-page">
      <div class="page-header">
        <div class="brand-lockup">
          <span class="brand-name">${escapeHtml(BRAND_NAME)}</span>
          <span class="brand-divider"></span>
          <span class="brand-doc">Construction Progress Report</span>
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function roomExportPct(room: RoomProgress): number {
  if (room.isComplete) return 100;
  const scorable = room.activities.filter(a => a.status !== 'not_observable');
  if (scorable.length === 0) return room.activities.length > 0 ? 100 : 0;
  return Math.min(99, Math.round(scorable.reduce((n, a) => n + a.completionPct, 0) / scorable.length));
}

function roomExportState(room: RoomProgress): { label: string; color: string } {
  if (room.isComplete) return { label: 'Completed', color: HEATMAP_COLOR.completed };
  if (room.activities.length > 0 || (room.capturesCount ?? 0) > 0 || (room.pinNumbers?.length ?? 0) > 0) {
    return { label: 'Work in Progress', color: HEATMAP_COLOR.in_progress };
  }
  return { label: 'No Photos Yet', color: HEATMAP_COLOR.no_images };
}

function roomHasWorkStarted(room: RoomProgress): boolean {
  return room.isComplete
    || room.activities.length > 0
    || (room.capturesCount ?? 0) > 0
    || (room.pinNumbers?.length ?? 0) > 0;
}

function flatHasWorkStarted(flat: FlatProgress): boolean {
  if ((flat.roomsPhotographed ?? 0) > 0) return true;
  if (flat.completionPct > 0) return true;
  if (flat.roomsComplete > 0) return true;
  return flat.rooms.some(roomHasWorkStarted);
}

function roomIsAnnotated(room: RoomProgress): boolean {
  return (room.pinNumbers?.length ?? 0) > 0;
}

function sortedRoomActivities(room: RoomProgress) {
  return [...room.activities].sort((a, b) => {
    const aDone = a.completionPct >= 100 || a.status === 'completed' ? 0 : 1;
    const bDone = b.completionPct >= 100 || b.status === 'completed' ? 0 : 1;
    if (aDone !== bDone) return aDone - bDone;
    return a.activityName.localeCompare(b.activityName);
  });
}

function isActivityComplete(a: ActivityAssessment): boolean {
  return a.status === 'completed' || a.completionPct >= 100;
}

function buildKeyFindings(snapshot: FloorProgressSnapshot): string[] {
  const findings: string[] = [];
  const cards = snapshot.summaryCards;
  const flats = (snapshot.flatProgress ?? []).filter(f => !isCommonFlat(f));
  const common = (snapshot.flatProgress ?? []).filter(f => isCommonFlat(f));

  findings.push(
    `Overall finishing progress is ${Math.round(snapshot.overallProgressPct)}% with ${cards.roomsCompleted} rooms completed, ${cards.roomsInProgress} in progress, and ${cards.roomsNotStarted} not started.`,
  );

  if (typeof cards.coveragePct === 'number') {
    findings.push(
      `Photo coverage is ${Math.round(cards.coveragePct)}% of roster rooms (${cards.imagesAnalyzed} images analyzed; avg AI confidence ${Math.round(cards.avgConfidencePct)}%).`,
    );
  }

  const active = flats.filter(flatHasWorkStarted);
  const idle = flats.filter(f => !flatHasWorkStarted(f));
  if (active.length) {
    const top = [...active].sort((a, b) => b.completionPct - a.completionPct)[0];
    findings.push(
      `${active.length} flat(s) have started work; leading unit is ${top.flatName} at ${Math.round(top.completionPct)}%.`,
    );
  }
  if (idle.length) {
    findings.push(`${idle.length} flat(s) not started yet: ${idle.map(f => f.flatName).join(', ')}.`);
  }

  if (common.length) {
    const c = common[0];
    const annotated = c.rooms.filter(roomIsAnnotated).length;
    findings.push(
      `Common Area is ${Math.round(c.completionPct)}% complete with ${annotated} annotated capture point(s).`,
    );
  }

  const inProg = snapshot.activities.filter(a => a.status === 'in_progress').length;
  const done = snapshot.activities.filter(a => a.status === 'completed').length;
  findings.push(`Activity rollup: ${done} completed, ${inProg} in progress across flat and common scopes.`);

  return findings.slice(0, 5);
}

// ── Cover ──────────────────────────────────────────────────────────────────────

function buildCoverPage(snapshot: FloorProgressSnapshot, generatedAt: string): string {
  const summary = (snapshot.executiveSummary || '').trim()
    || 'No AI summary is available for this floor yet. Re-run analysis after uploading captures.';
  const findings = buildKeyFindings(snapshot);

  return `
    <div class="cover-hero">
      <p class="cover-eyebrow">${escapeHtml(BRAND_NAME)}</p>
      <h1 class="cover-title">Construction Progress Report</h1>
      <p class="cover-subtitle">AI-estimated finishing progress · generated ${escapeHtml(generatedAt)}</p>
    </div>
    <div class="project-meta">
      <div class="meta-item"><span class="meta-label">Project</span><span class="meta-value">${escapeHtml(snapshot.projectName)}</span></div>
      <div class="meta-item"><span class="meta-label">Tower</span><span class="meta-value">${escapeHtml(snapshot.towerName)}</span></div>
      <div class="meta-item"><span class="meta-label">Floor</span><span class="meta-value">${escapeHtml(snapshot.floorName)}</span></div>
      <div class="meta-item"><span class="meta-label">Last Inspection</span><span class="meta-value">${escapeHtml(formatDate(snapshot.summaryCards.lastInspection))}</span></div>
    </div>
    <div class="hero-card">
      <div class="hero-progress">
        <div class="hero-pct">${Math.round(snapshot.overallProgressPct)}<span>%</span></div>
        <div class="hero-progress-label">Overall Progress</div>
      </div>
      <div class="hero-body">
        <h2 class="insights-heading">AI Insights</h2>
        <p class="hero-summary">${escapeHtml(summary)}</p>
      </div>
    </div>
    <h2 class="section-title">At a Glance</h2>
    <div class="findings-grid">
      <div class="finding-card">
        <h3>Rooms</h3>
        <p>${snapshot.summaryCards.roomsCompleted} completed / ${snapshot.summaryCards.roomsInProgress} in progress / ${snapshot.summaryCards.roomsNotStarted} not started</p>
      </div>
      <div class="finding-card">
        <h3>Activities</h3>
        <p>${snapshot.summaryCards.activitiesCompleted} completed / ${snapshot.summaryCards.activitiesInProgress} in progress / ${snapshot.summaryCards.activitiesNotStarted} not started</p>
      </div>
      <div class="finding-card">
        <h3>Coverage</h3>
        <p>${typeof snapshot.summaryCards.coveragePct === 'number' ? `${Math.round(snapshot.summaryCards.coveragePct)}%` : '—'} of roster rooms photographed</p>
      </div>
      <div class="finding-card">
        <h3>Images · Confidence</h3>
        <p>${snapshot.summaryCards.imagesAnalyzed} images · ${Math.round(snapshot.summaryCards.avgConfidencePct)}% avg</p>
      </div>
    </div>
    <h2 class="section-title">Key Findings</h2>
    <ul class="findings-list">
      ${findings.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
    </ul>
  `;
}

// ── Heatmap (dedicated page) ───────────────────────────────────────────────────

function buildHeatmapPage(snapshot: FloorProgressSnapshot): string | null {
  if (!snapshot.floorPlanImageUrl || snapshot.roomHeatmap.length === 0) return null;

  const pinMarkers = (snapshot.heatmapPins ?? [])
    .map(p => {
      const cy = p.y - 1.8;
      return `<g>
        <circle cx="${p.x}" cy="${cy}" r="1.6" fill="#2563eb" stroke="#fff" stroke-width="0.35"/>
        <text x="${p.x}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="1.6" font-weight="700">${p.sequenceNumber}</text>
      </g>`;
    })
    .join('');

  return `
    <h2 class="section-title page-intro">Floor Plan Heatmap</h2>
    <div class="heatmap-legend">
      ${(Object.keys(HEATMAP_COLOR) as RoomHeatmapState[])
        .filter(state => state !== 'no_images' && state !== 'uploaded')
        .map(state => `
        <div class="legend-item"><span class="legend-dot" style="background:${HEATMAP_COLOR[state]}"></span>${escapeHtml(HEATMAP_LABEL[state])}</div>
      `).join('')}
    </div>
    <div class="heatmap-frame">
      <img src="${escapeHtml(snapshot.floorPlanImageUrl)}" alt="Floor plan" class="heatmap-img" />
      <svg class="heatmap-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${pinMarkers}</svg>
    </div>
  `;
}

// ── Room / flat flowing content ────────────────────────────────────────────────

function roomHeadHtml(room: RoomProgress, continued = false): string {
  const state = roomExportState(room);
  const pct = roomExportPct(room);
  const pinLabel = room.pinNumbers?.length ? `Pins ${room.pinNumbers.join(', ')}` : '';
  return `
    <div class="room-head">
      <span class="room-dot" style="background:${state.color}"></span>
      <span class="room-name">${escapeHtml(room.roomName)}${continued ? ' <span class="cont-label">(continued)</span>' : ''}</span>
      <span class="room-meta">${pct}% · <span style="color:${state.color}">${escapeHtml(state.label)}</span>${pinLabel ? ` · ${escapeHtml(pinLabel)}` : ''}${(room.capturesCount ?? 0) > 0 ? ` · ${room.capturesCount} capture${room.capturesCount === 1 ? '' : 's'}` : ''}</span>
    </div>
  `;
}

function activityRowHtml(a: { activityName: string; completionPct: number; evidence?: string }): string {
  return `
    <tr>
      <td>${escapeHtml(a.activityName)}</td>
      <td>${Math.round(a.completionPct)}%</td>
      <td>${escapeHtml(truncateEvidence(a.evidence))}</td>
    </tr>
  `;
}

function renderDetailedRoomCard(
  room: RoomProgress,
  activities: ReturnType<typeof sortedRoomActivities>,
  opts: { continued?: boolean; moreContinues?: boolean } = {},
): string {
  const rows = activities.map(activityRowHtml).join('');
  return `
    <div class="room-block">
      ${roomHeadHtml(room, opts.continued)}
      <table class="room-activity-table">
        <thead><tr><th>Activity</th><th>Completion</th><th>Evidence / Insight</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${opts.moreContinues ? '<p class="cont-footer">Continued on next page…</p>' : ''}
    </div>
  `;
}

function renderEmptyRoomsSummary(rooms: RoomProgress[], groupLabel: string): string {
  if (!rooms.length) return '';
  const rows = rooms.map(room => {
    const state = roomExportState(room);
    const pct = roomExportPct(room);
    return `
      <tr>
        <td><span class="room-dot inline" style="background:${state.color}"></span>${escapeHtml(room.roomName)}</td>
        <td>${pct}%</td>
        <td style="color:${state.color}">${escapeHtml(state.label)}</td>
      </tr>
    `;
  }).join('');
  return `
    <div class="empty-rooms-block">
      <h4 class="room-group-label">${escapeHtml(groupLabel)} — no scored activities (${rooms.length})</h4>
      <table class="empty-rooms-table">
        <thead><tr><th>Room</th><th>Progress</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/** Split a long room activity table into page-fitting chunks with repeated headers. */
function splitDetailedRoomBlocks(room: RoomProgress, maxChunkPx: number): FlowBlock[] {
  const acts = sortedRoomActivities(room);
  if (acts.length === 0) return [];

  const chromeProbe = `
    <div class="room-block">
      ${roomHeadHtml(room)}
      <table class="room-activity-table">
        <thead><tr><th>Activity</th><th>Completion</th><th>Evidence / Insight</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  const chromeH = measureHtmlHeight(chromeProbe);
  const oneRowH = measureHtmlHeight(renderDetailedRoomCard(room, acts.slice(0, 1)));
  const rowH = Math.max(16, oneRowH - chromeH);

  const blocks: FlowBlock[] = [];
  let cursor = 0;
  let continued = false;

  while (cursor < acts.length) {
    // Prefer keeping header + MIN_ROWS_WITH_HEADER on first chunk of a page.
    let take = Math.min(MIN_ROWS_WITH_HEADER, acts.length - cursor);
    while (cursor + take < acts.length) {
      const probe = renderDetailedRoomCard(room, acts.slice(cursor, cursor + take + 1), { continued });
      if (measureHtmlHeight(probe) > maxChunkPx) break;
      take += 1;
    }
    // Guarantee at least one row even if oversized.
    take = Math.max(1, take);
    // If chrome + one row exceeds max, still emit one row (can't shrink further).
    if (chromeH + rowH > maxChunkPx && take < 1) take = 1;

    const slice = acts.slice(cursor, cursor + take);
    const moreContinues = cursor + take < acts.length;
    const html = renderDetailedRoomCard(room, slice, { continued, moreContinues });
    blocks.push(block(html));
    cursor += take;
    continued = true;
  }
  return blocks;
}

function appendRoomDetailFlow(
  out: FlowBlock[],
  flats: FlatProgress[],
  sectionTitle: string,
  coverageNote: string | null,
  options: { commonAnnotatedOnly?: boolean } = {},
): void {
  if (!flats.length) return;

  let introPending = true;
  const notStarted: FlatProgress[] = [];

  const pushSectionIntro = () => {
    if (!introPending) return;
    out.push(block(`<h2 class="section-title">${escapeHtml(sectionTitle)}</h2>`, true));
    if (coverageNote) out.push(block(`<p class="coverage-note">${escapeHtml(coverageNote)}</p>`));
    introPending = false;
  };

  const flushNotStarted = () => {
    if (!notStarted.length) return;
    pushSectionIntro();
    const rows = notStarted.map(f => `
      <tr>
        <td>${escapeHtml(f.flatName)}</td>
        <td>0%</td>
        <td>Not started yet</td>
        <td>${f.roomsTotal} rooms</td>
      </tr>
    `).join('');
    out.push(block(`
      <div class="empty-rooms-block">
        <h4 class="room-group-label">Flats not started (${notStarted.length})</h4>
        <table class="not-started-flats-table">
          <thead><tr><th>Flat</th><th>Progress</th><th>Status</th><th>Roster</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `));
    notStarted.length = 0;
  };

  for (const flat of flats) {
    if (!options.commonAnnotatedOnly && !flatHasWorkStarted(flat)) {
      notStarted.push(flat);
      continue;
    }
    flushNotStarted();
    pushSectionIntro();

    let rooms = flat.rooms;
    if (options.commonAnnotatedOnly) {
      rooms = rooms.filter(roomIsAnnotated);
      if (!rooms.length) {
        out.push(block(`
          <div class="flat-not-started">
            <h3 class="flat-title">${escapeHtml(flat.flatName)}</h3>
            <p class="not-started-note">No annotated capture points on the common-area plan yet.</p>
          </div>
        `));
        continue;
      }
    }

    const completed = rooms.filter(r => r.isComplete).sort((a, b) => a.roomName.localeCompare(b.roomName));
    const incomplete = rooms.filter(r => !r.isComplete).sort((a, b) => a.roomName.localeCompare(b.roomName));
    const completedEmpty = completed.filter(r => r.activities.length === 0);
    const completedDetailed = completed.filter(r => r.activities.length > 0);
    const incompleteEmpty = incomplete.filter(r => r.activities.length === 0);
    const incompleteDetailed = incomplete.filter(r => r.activities.length > 0);

    out.push(block(
      `<h3 class="flat-title">${escapeHtml(flat.flatName)} — ${Math.round(flat.completionPct)}% (${flat.roomsComplete}/${flat.roomsTotal} rooms complete)</h3>`,
      true,
    ));

    if (completedEmpty.length) {
      out.push(block(renderEmptyRoomsSummary(completedEmpty, 'Completed')));
    }
    for (const room of completedDetailed) {
      out.push(...splitDetailedRoomBlocks(room, PAGE_BODY_MAX_PX - 40));
    }
    if (incompleteEmpty.length) {
      out.push(block(renderEmptyRoomsSummary(incompleteEmpty, 'Not completed')));
    }
    for (const room of incompleteDetailed) {
      out.push(...splitDetailedRoomBlocks(room, PAGE_BODY_MAX_PX - 40));
    }
  }
  flushNotStarted();
}

// ── Activity rollup (multi-page) ───────────────────────────────────────────────

function activityRow(a: ActivityAssessment): string {
  return `
    <tr>
      <td>${escapeHtml(a.name)}</td>
      <td><span class="status-pill" style="background:${STATUS_COLOR[a.status]}22; color:${STATUS_COLOR[a.status]}">${escapeHtml(ACTIVITY_STATUS_LABELS[a.status])}</span></td>
      <td>${Math.round(a.completionPct)}%</td>
      <td>${a.confidencePct > 0 ? `${Math.round(a.confidencePct)}%` : '—'}</td>
    </tr>
  `;
}

function rollupTableHtml(title: string, rows: ActivityAssessment[], continued: boolean, moreContinues: boolean): string {
  return `
    <div class="rollup-block">
      <h2 class="section-title">${escapeHtml(title)}${continued ? ' — Continued' : ''}</h2>
      ${!continued ? '<p class="section-note">Completed activities first, then remaining work.</p>' : ''}
      <table class="activity-table">
        <thead><tr><th>Activity</th><th>Status</th><th>Completion</th><th>Confidence</th></tr></thead>
        <tbody>${rows.map(activityRow).join('')}</tbody>
      </table>
      ${moreContinues ? '<p class="cont-footer">Continued on next page…</p>' : ''}
    </div>
  `;
}

function appendActivityRollupFlow(
  out: FlowBlock[],
  title: string,
  activities: ActivityAssessment[],
  section: 'flat' | 'common',
): void {
  const sectionRows = activities
    .filter(a => a.section === section)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  if (!sectionRows.length) {
    out.push(block(`
      <div class="rollup-block">
        <h2 class="section-title">${escapeHtml(title)}</h2>
        <p class="muted">No ${section === 'flat' ? 'flat' : 'common-area'} activities scored for this floor.</p>
      </div>
    `));
    return;
  }

  const ordered = [
    ...sectionRows.filter(isActivityComplete),
    ...sectionRows.filter(a => !isActivityComplete(a)),
  ];

  const chrome = rollupTableHtml(title, [], false, false);
  const chromeH = measureHtmlHeight(chrome);
  const one = rollupTableHtml(title, ordered.slice(0, 1), false, false);
  const rowH = Math.max(14, measureHtmlHeight(one) - chromeH);
  const maxRowsGuess = Math.max(3, Math.floor((PAGE_BODY_MAX_PX - 60 - chromeH) / rowH));

  let cursor = 0;
  let continued = false;
  while (cursor < ordered.length) {
    let take = Math.min(maxRowsGuess, ordered.length - cursor);
    // Refine with actual measure
    while (take > 1) {
      const probe = rollupTableHtml(title, ordered.slice(cursor, cursor + take), continued, false);
      if (measureHtmlHeight(probe) <= PAGE_BODY_MAX_PX - 20) break;
      take -= 1;
    }
    take = Math.max(1, take);
    while (cursor + take < ordered.length) {
      const probe = rollupTableHtml(title, ordered.slice(cursor, cursor + take + 1), continued, false);
      if (measureHtmlHeight(probe) > PAGE_BODY_MAX_PX - 20) break;
      take += 1;
    }
    const slice = ordered.slice(cursor, cursor + take);
    const more = cursor + take < ordered.length;
    out.push(block(rollupTableHtml(title, slice, continued, more)));
    cursor += take;
    continued = true;
  }
}

function buildNotesHtml(): string {
  return `
    <div class="notes-block">
      <h2 class="section-title">Notes</h2>
      <div class="disclaimer">
        <p>This report was generated automatically using AI-assisted construction image analysis under the ${escapeHtml(BRAND_NAME)} platform.</p>
        <p>Completion percentages are estimates derived from uploaded 360° photo evidence; verify critical milestones on-site before commercial or safety decisions.</p>
        <p>Coverage % is rooms with at least one usable capture divided by the room-map roster — it is not the same as finishing progress.</p>
        <p>Flat works and Common Area works are reported separately. Empty / not-started rooms are listed in compact tables; detailed activity tables continue across pages with repeated headers when needed.</p>
      </div>
    </div>
  `;
}

// ── Assembly ───────────────────────────────────────────────────────────────────

export async function buildConstructionProgressPdfHtml(snapshot: FloorProgressSnapshot): Promise<string> {
  const generatedAt = new Date().toLocaleString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const pages: string[] = [];

  // 1) Executive cover (single packed page)
  pages.push(buildCoverPage(snapshot, generatedAt));

  // 2) Floor plan — dedicated page
  const heatmap = buildHeatmapPage(snapshot);
  if (heatmap) pages.push(heatmap);

  // 3) Flowing room detail + rollups + notes
  const flow: FlowBlock[] = [];
  const flats = snapshot.flatProgress ?? [];
  const residential = flats.filter(f => !isCommonFlat(f));
  const common = flats.filter(f => isCommonFlat(f));

  const coverageLabel = typeof snapshot.summaryCards.coveragePct === 'number'
    ? `Floor photo coverage: ${Math.round(snapshot.summaryCards.coveragePct)}% (rooms with ≥1 capture ÷ roster). Progress below is independent of coverage.`
    : null;

  appendRoomDetailFlow(flow, residential, 'Flat Finishing — Room Detail', coverageLabel);
  appendRoomDetailFlow(
    flow,
    common,
    'Common Area Finishing — Room Detail',
    'Only common-area rooms with annotated capture points are listed.',
    { commonAnnotatedOnly: true },
  );

  appendActivityRollupFlow(flow, 'Flat Finishing Works — Activity Rollup', snapshot.activities, 'flat');
  appendActivityRollupFlow(flow, 'Common Area Finishing Works — Activity Rollup', snapshot.activities, 'common');

  const notes = block(buildNotesHtml());
  const packed = packFlow(flow, PAGE_BODY_MAX_PX);

  // Try to place Notes on the last packed page if space remains.
  if (packed.length === 0) {
    pages.push(notes.html);
  } else {
    const lastHtml = packed[packed.length - 1];
    const lastH = measureHtmlHeight(lastHtml);
    if (lastH + notes.height <= PAGE_BODY_MAX_PX) {
      packed[packed.length - 1] = lastHtml + notes.html;
    } else {
      packed.push(notes.html);
    }
    pages.push(...packed);
  }

  const totalPages = pages.length;
  const body = pages.map((p, i) => pageShell(p, i + 1, totalPages)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Construction Progress — ${escapeHtml(snapshot.floorName)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Segoe UI', 'Helvetica Neue', Inter, system-ui, sans-serif;
      color: #1a2332;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page {
      position: relative; width: 210mm; min-height: 297mm;
      padding: 12mm 16mm 14mm;
      page-break-after: always; break-after: page; display: flex; flex-direction: column;
      background: #fff;
    }
    .print-page:last-child { page-break-after: auto; }
    .page-header {
      display: flex; justify-content: space-between; align-items: flex-end;
      padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1.5px solid #1a2332; flex-shrink: 0;
    }
    .brand-lockup { display: flex; align-items: center; gap: 10px; }
    .brand-name { font-size: 13px; font-weight: 800; color: #1a2332; letter-spacing: 0.12em; text-transform: uppercase; }
    .brand-divider { width: 1px; height: 16px; background: #c4cdd8; }
    .brand-doc { font-size: 11px; font-weight: 600; color: #4a5568; letter-spacing: 0.02em; }
    .brand-tagline { font-size: 8.5px; font-weight: 600; color: #8b95a5; letter-spacing: 0.06em; text-transform: uppercase; }
    .page-footer {
      margin-top: auto; padding-top: 8px; border-top: 1px solid #e4e8ee;
      display: flex; justify-content: space-between; font-size: 7.5px; color: #8b95a5; flex-shrink: 0;
    }
    .footer-brand { font-weight: 700; color: #4a5568; }
    .page-body { flex: 1; min-height: 0; }
    .page-intro { margin-top: 0; }
    ${MEASURE_STYLES}
    .heatmap-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
    .legend-item { display: flex; align-items: center; gap: 5px; font-size: 8.5px; color: #4a5568; font-weight: 600; }
    .legend-dot { width: 8px; height: 8px; border-radius: 3px; display: inline-block; }
    .heatmap-frame { position: relative; width: 100%; border: 1px solid #e4e8ee; border-radius: 6px; overflow: hidden; }
    .heatmap-img { width: 100%; display: block; }
    .heatmap-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export async function exportConstructionProgressPdf(snapshot: FloorProgressSnapshot): Promise<void> {
  const html = await buildConstructionProgressPdfHtml(snapshot);
  await exportHtmlToPdf(html, `Construction-Progress-${snapshot.floorName}`);
}
