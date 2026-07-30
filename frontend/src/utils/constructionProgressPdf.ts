import type { ActivityAssessment, ActivityStatus, FloorProgressSnapshot, RoomHeatmapEntry, RoomHeatmapState } from '@/services/constructionProgressService';
import { ACTIVITY_STATUS_LABELS } from '@/services/constructionProgressService';
import { exportHtmlToPdf } from '@/utils/htmlToPdf';
import { resolveCaptureImageUrls } from '@/utils/evidenceImages';

const BRAND_NAME = 'SiteVision';
const BRAND_TAGLINE = 'AI Construction Intelligence';

const STATUS_COLOR: Record<ActivityStatus, string> = {
  not_started: '#94a3b8',
  in_progress: '#d97706',
  mostly_complete: '#2563eb',
  completed: '#16a34a',
  unable_to_determine: '#cbd5e1',
};

const HEATMAP_COLOR: Record<RoomHeatmapState, string> = {
  no_images: '#cbd5e1',
  uploaded: '#0891b2',
  in_progress: '#d97706',
  completed: '#16a34a',
};

const HEATMAP_LABEL: Record<RoomHeatmapState, string> = {
  no_images: 'No Photos Yet',
  uploaded: 'Photos Uploaded',
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

// ── Cover / executive summary page ────────────────────────────────────────────

function buildCoverPage(snapshot: FloorProgressSnapshot, generatedAt: string): string {
  return `
    <div class="cover-hero">
      <p class="cover-eyebrow">${escapeHtml(BRAND_NAME)}</p>
      <h1 class="cover-title">Construction Progress Report</h1>
      <p class="cover-subtitle">AI-estimated finishing progress, generated ${escapeHtml(generatedAt)}</p>
    </div>
    <div class="project-meta">
      <div class="meta-item"><span class="meta-label">Project</span><span class="meta-value">${escapeHtml(snapshot.projectName)}</span></div>
      <div class="meta-item"><span class="meta-label">Tower</span><span class="meta-value">${escapeHtml(snapshot.towerName)}</span></div>
      <div class="meta-item"><span class="meta-label">Floor</span><span class="meta-value">${escapeHtml(snapshot.floorName)}</span></div>
      <div class="meta-item"><span class="meta-label">Last Inspection</span><span class="meta-value">${escapeHtml(formatDate(snapshot.summaryCards.lastInspection))}</span></div>
    </div>
    <div class="hero-card avoid-break">
      <div class="hero-progress">
        <div class="hero-pct">${Math.round(snapshot.overallProgressPct)}<span>%</span></div>
        <div class="hero-progress-label">Overall Progress</div>
      </div>
      <div class="hero-body">
        <p class="hero-summary">${escapeHtml(snapshot.executiveSummary)}</p>
      </div>
    </div>
    <h2 class="section-title page-intro">At a Glance</h2>
    <div class="findings-grid">
      <div class="finding-card">
        <h3>Rooms</h3>
        <p>${snapshot.summaryCards.roomsCompleted} completed / ${snapshot.summaryCards.roomsPending} pending</p>
      </div>
      <div class="finding-card">
        <h3>Activities</h3>
        <p>${snapshot.summaryCards.activitiesCompleted} completed / ${snapshot.summaryCards.activitiesPending} pending</p>
      </div>
      <div class="finding-card">
        <h3>Images Analyzed</h3>
        <p>${snapshot.summaryCards.imagesAnalyzed}</p>
      </div>
      <div class="finding-card">
        <h3>Average AI Confidence</h3>
        <p>${Math.round(snapshot.summaryCards.avgConfidencePct)}%</p>
      </div>
    </div>
  `;
}

// ── Floor plan heatmap page ────────────────────────────────────────────────────

function polygonToPoints(polygon: RoomHeatmapEntry['polygon']): string {
  return polygon.map(p => `${p.x},${p.y}`).join(' ');
}

function buildHeatmapPage(snapshot: FloorProgressSnapshot): string | null {
  if (!snapshot.floorPlanImageUrl || snapshot.roomHeatmap.length === 0) return null;

  const polygons = snapshot.roomHeatmap
    .map(r => `<polygon points="${polygonToPoints(r.polygon)}" fill="${HEATMAP_COLOR[r.state]}" fill-opacity="0.38" stroke="${HEATMAP_COLOR[r.state]}" stroke-width="0.3" />`)
    .join('');

  const noImageCount = snapshot.roomHeatmap.filter(r => r.state === 'no_images').length;
  const coverageNote = noImageCount > 0
    ? `<p class="coverage-note"><strong>${noImageCount} of ${snapshot.roomHeatmap.length} rooms</strong> have no photos uploaded yet — grey areas are a coverage gap, not an analysis failure.</p>`
    : '';

  return `
    <h2 class="section-title page-intro">Floor Plan Heatmap</h2>
    <div class="heatmap-legend">
      ${(Object.keys(HEATMAP_COLOR) as RoomHeatmapState[]).map(state => `
        <div class="legend-item"><span class="legend-dot" style="background:${HEATMAP_COLOR[state]}"></span>${escapeHtml(HEATMAP_LABEL[state])}</div>
      `).join('')}
    </div>
    <div class="heatmap-frame avoid-break">
      <img src="${escapeHtml(snapshot.floorPlanImageUrl)}" alt="Floor plan" class="heatmap-img" />
      <svg class="heatmap-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${polygons}</svg>
    </div>
    ${coverageNote}
  `;
}

// ── Activity tables ────────────────────────────────────────────────────────────

function activityRows(activities: ActivityAssessment[], section: 'flat' | 'common'): string {
  return activities
    .filter(a => a.section === section)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
    .map(a => `
      <tr>
        <td>${escapeHtml(a.name)}</td>
        <td><span class="status-pill" style="background:${STATUS_COLOR[a.status]}22; color:${STATUS_COLOR[a.status]}">${escapeHtml(ACTIVITY_STATUS_LABELS[a.status])}</span></td>
        <td>${Math.round(a.completionPct)}%</td>
        <td>${a.confidencePct > 0 ? `${Math.round(a.confidencePct)}%` : '—'}</td>
      </tr>
    `)
    .join('');
}

const ACTIVITY_TABLE_STYLE = `
  <style>
    table.activity-table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 20px; }
    table.activity-table th { text-align: left; padding: 6px 8px; background: #f1f4f8; color: #4a5568; font-weight: 700; text-transform: uppercase; font-size: 8px; letter-spacing: 0.04em; }
    table.activity-table td { padding: 6px 8px; border-bottom: 1px solid #e4e8ee; color: #1a2332; }
    .status-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 8px; font-weight: 700; }
  </style>
`;

function buildActivitiesPage(title: string, activities: ActivityAssessment[], section: 'flat' | 'common'): string {
  return `
    ${ACTIVITY_TABLE_STYLE}
    <h2 class="section-title page-intro">${escapeHtml(title)}</h2>
    <table class="activity-table">
      <thead><tr><th>Activity</th><th>Status</th><th>Completion</th><th>Confidence</th></tr></thead>
      <tbody>${activityRows(activities, section)}</tbody>
    </table>
  `;
}

// ── Room-by-room status page (per flat) ───────────────────────────────────────

function buildRoomStatusPage(snapshot: FloorProgressSnapshot): string | null {
  if (snapshot.roomHeatmap.length === 0) return null;
  const byFlat = new Map<string, RoomHeatmapEntry[]>();
  snapshot.roomHeatmap.forEach(r => {
    const list = byFlat.get(r.flatName) ?? [];
    list.push(r);
    byFlat.set(r.flatName, list);
  });

  const sections = Array.from(byFlat.entries()).map(([flatName, rooms]) => `
    <div class="flat-block avoid-break">
      <h3 class="flat-title">${escapeHtml(flatName)}</h3>
      <div class="room-grid">
        ${rooms.map(r => `
          <div class="room-chip">
            <span class="room-dot" style="background:${HEATMAP_COLOR[r.state]}"></span>
            <span class="room-name">${escapeHtml(r.roomName)}</span>
            <span class="room-state" style="color:${HEATMAP_COLOR[r.state]}">${escapeHtml(HEATMAP_LABEL[r.state])}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  return `
    <style>
      .flat-block { margin-bottom: 16px; }
      .flat-title { font-size: 11px; font-weight: 700; color: #1a2332; margin: 0 0 8px; }
      .room-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .room-chip { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #e4e8ee; border-radius: 6px; font-size: 8.5px; }
      .room-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .room-name { flex: 1; color: #1a2332; font-weight: 600; }
      .room-state { font-weight: 700; font-size: 7.5px; }
    </style>
    <h2 class="section-title page-intro">Room-by-Room Status</h2>
    ${sections}
  `;
}

// ── Evidence appendix (real photos) ───────────────────────────────────────────

function buildEvidencePages(
  activities: ActivityAssessment[],
  imageUrls: Map<string, string>,
): string[] {
  const withEvidence = activities.filter(a => a.evidenceCaptureIds.some(id => imageUrls.has(id)));
  if (withEvidence.length === 0) return [];

  // Chunk activities across pages, roughly 4 per page (each with up to 3 photos).
  const CHUNK = 4;
  const pages: string[] = [];
  for (let i = 0; i < withEvidence.length; i += CHUNK) {
    const chunk = withEvidence.slice(i, i + CHUNK);
    const blocks = chunk.map(a => {
      const photos = a.evidenceCaptureIds
        .map(id => imageUrls.get(id))
        .filter((u): u is string => !!u)
        .slice(0, 3)
        .map(url => `<img src="${escapeHtml(url)}" class="evidence-photo" />`)
        .join('');
      return `
        <div class="evidence-block avoid-break">
          <div class="evidence-header">
            <span class="status-pill" style="background:${STATUS_COLOR[a.status]}22; color:${STATUS_COLOR[a.status]}">${escapeHtml(ACTIVITY_STATUS_LABELS[a.status])}</span>
            <h3>${escapeHtml(a.name)}</h3>
          </div>
          <div class="evidence-photos">${photos}</div>
        </div>
      `;
    }).join('');

    pages.push(`
      <style>
        .evidence-block { margin-bottom: 18px; }
        .evidence-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .evidence-header h3 { font-size: 10px; font-weight: 700; color: #1a2332; margin: 0; }
        .evidence-photos { display: flex; gap: 6px; }
        .evidence-photo { width: 31%; aspect-ratio: 16/9; object-fit: cover; border-radius: 5px; border: 1px solid #e4e8ee; }
      </style>
      <h2 class="section-title page-intro">Photo Evidence${i === 0 ? '' : ' (continued)'}</h2>
      ${blocks}
    `);
  }
  return pages;
}

// ── Assembly ───────────────────────────────────────────────────────────────────

export async function buildConstructionProgressPdfHtml(snapshot: FloorProgressSnapshot): Promise<string> {
  const generatedAt = new Date().toLocaleString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const allEvidenceIds = snapshot.activities.flatMap(a => a.evidenceCaptureIds);
  const imageUrls = allEvidenceIds.length > 0
    ? await resolveCaptureImageUrls(allEvidenceIds).catch(() => new Map<string, string>())
    : new Map<string, string>();

  const pages: string[] = [buildCoverPage(snapshot, generatedAt)];

  const heatmapPage = buildHeatmapPage(snapshot);
  if (heatmapPage) pages.push(heatmapPage);

  const roomStatusPage = buildRoomStatusPage(snapshot);
  if (roomStatusPage) pages.push(roomStatusPage);

  pages.push(buildActivitiesPage('Flat Finishing Works', snapshot.activities, 'flat'));
  pages.push(buildActivitiesPage('Common Area Finishing Works', snapshot.activities, 'common'));

  pages.push(...buildEvidencePages(snapshot.activities, imageUrls));

  const disclaimerPage = `
    <h2 class="section-title page-intro">Notes</h2>
    <div class="disclaimer avoid-break">
      <p>This report was generated automatically using AI-assisted construction image analysis under the ${escapeHtml(BRAND_NAME)} platform.</p>
      <p>Completion percentages are estimates derived from uploaded 360° photo evidence; verify critical milestones on-site before commercial or safety decisions.</p>
      <p>Rooms shown in grey on the heatmap have no photos uploaded yet — this reflects a photo-coverage gap, not a failed or incomplete analysis.</p>
    </div>
  `;
  pages.push(disclaimerPage);

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
      position: relative; width: 210mm; min-height: 297mm; padding: 14mm 18mm 20mm;
      page-break-after: always; break-after: page; display: flex; flex-direction: column;
    }
    .print-page:last-child { page-break-after: auto; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 10px; margin-bottom: 18px; border-bottom: 1.5px solid #1a2332; }
    .brand-lockup { display: flex; align-items: center; gap: 10px; }
    .brand-name { font-size: 13px; font-weight: 800; color: #1a2332; letter-spacing: 0.12em; text-transform: uppercase; }
    .brand-divider { width: 1px; height: 16px; background: #c4cdd8; }
    .brand-doc { font-size: 11px; font-weight: 600; color: #4a5568; letter-spacing: 0.02em; }
    .brand-tagline { font-size: 8.5px; font-weight: 600; color: #8b95a5; letter-spacing: 0.06em; text-transform: uppercase; }
    .page-footer { margin-top: auto; padding-top: 10px; border-top: 1px solid #e4e8ee; display: flex; justify-content: space-between; font-size: 7.5px; color: #8b95a5; }
    .footer-brand { font-weight: 700; color: #4a5568; }
    .page-body { flex: 1; }
    .cover-hero { margin-bottom: 28px; }
    .cover-eyebrow { font-size: 10px; font-weight: 800; color: #8b95a5; letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 8px; }
    .cover-title { font-size: 32px; font-weight: 300; color: #1a2332; margin: 0 0 8px; letter-spacing: -0.03em; line-height: 1.1; }
    .cover-subtitle { font-size: 12px; color: #5c6778; margin: 0; font-weight: 500; letter-spacing: 0.01em; }
    .project-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 24px; border-top: 1px solid #e4e8ee; }
    .meta-item { padding: 10px 0; border-bottom: 1px solid #e4e8ee; }
    .meta-label { display: block; font-size: 8px; font-weight: 700; color: #8b95a5; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
    .meta-value { display: block; font-size: 11px; font-weight: 600; color: #1a2332; }
    .hero-card { display: flex; gap: 28px; align-items: flex-start; padding: 20px; border: 1px solid #e4e8ee; border-radius: 6px; margin-bottom: 20px; }
    .hero-progress { flex-shrink: 0; text-align: center; }
    .hero-pct { font-size: 40px; font-weight: 800; color: #2563eb; line-height: 1; }
    .hero-pct span { font-size: 20px; }
    .hero-progress-label { font-size: 9px; color: #8b95a5; font-weight: 700; text-transform: uppercase; margin-top: 4px; }
    .hero-body { flex: 1; }
    .hero-summary { font-size: 11px; color: #333; line-height: 1.6; margin: 0; }
    .section-title { font-size: 15px; font-weight: 700; color: #1a2332; margin: 0 0 14px; }
    .page-intro { margin-top: 0; }
    .findings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .finding-card { border: 1px solid #e4e8ee; border-radius: 6px; padding: 10px 12px; }
    .finding-card h3 { font-size: 9px; font-weight: 700; color: #8b95a5; text-transform: uppercase; margin: 0 0 4px; letter-spacing: 0.04em; }
    .finding-card p { font-size: 12px; font-weight: 700; color: #1a2332; margin: 0; }
    .disclaimer { margin-top: 16px; font-size: 8px; color: #8b95a5; line-height: 1.5; }
    .disclaimer p { margin: 0 0 4px; }
    .avoid-break { break-inside: avoid; }
    .heatmap-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
    .legend-item { display: flex; align-items: center; gap: 5px; font-size: 8.5px; color: #4a5568; font-weight: 600; }
    .legend-dot { width: 8px; height: 8px; border-radius: 3px; display: inline-block; }
    .heatmap-frame { position: relative; width: 100%; border: 1px solid #e4e8ee; border-radius: 6px; overflow: hidden; }
    .heatmap-img { width: 100%; display: block; }
    .heatmap-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .coverage-note { margin-top: 10px; font-size: 8.5px; color: #4a5568; background: #f1f4f8; padding: 8px 10px; border-radius: 6px; line-height: 1.5; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export async function exportConstructionProgressPdf(snapshot: FloorProgressSnapshot): Promise<void> {
  const html = await buildConstructionProgressPdfHtml(snapshot);
  await exportHtmlToPdf(html, `Construction-Progress-${snapshot.floorName}`);
}
