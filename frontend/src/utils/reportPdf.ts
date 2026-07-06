import type { ProgressAnalysisReport, ProgressReportVisualMeta } from '@/services/progressAnalysisService';
import {
  normalizeProgressReport,
  SECTION_EMPTY_MESSAGES,
  BRAND_NAME,
  BRAND_TAGLINE,
  BRAND_REPORT_TITLE,
  BRAND_REPORT_SUBTITLE,
  BRAND_FOOTER,
  REPORT_VERSION,
  type NormalizedProgressReport,
} from '@/utils/reportNormalization';
import { confidenceNarrative } from '@/utils/reportBranding';
import { formatReportDate, formatReportDateRange, formatReportGeneratedAt } from '@/utils/reportFormat';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findingCard(title: string, items: string[], emptyText: string): string {
  const body = items.length
    ? `<ul class="finding-list">${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    : `<p class="finding-empty">${escapeHtml(emptyText)}</p>`;
  return `<div class="finding-card"><h3>${escapeHtml(title)}</h3>${body}</div>`;
}

function changeCards(changes: NormalizedProgressReport['changesDetected']): string {
  if (!changes.length) return '';
  return `
    <div class="findings-grid full-width">
      <div class="finding-card">
        <h3>Key Construction Changes</h3>
        ${changes.map(c => `
          <div class="change-item">
            <div class="change-badges">
              <span class="badge badge-${c.importance.toLowerCase()}">${escapeHtml(c.importance)}</span>
              ${c.category && c.category !== 'General' ? `<span class="badge badge-cat">${escapeHtml(c.category)}</span>` : ''}
            </div>
            <p>${escapeHtml(c.text)}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function pageFooter(pageNum: number, totalPages: number, generatedAt: string): string {
  return `
    <div class="page-footer">
      <span class="footer-brand">${escapeHtml(BRAND_FOOTER)}</span>
      <span class="footer-meta">Confidential · Generated Automatically · v${escapeHtml(REPORT_VERSION)} · ${escapeHtml(generatedAt)}</span>
      <span class="footer-page">Page ${pageNum} of ${totalPages}</span>
    </div>
  `;
}

function pageHeader(): string {
  return `
    <div class="page-header">
      <div class="brand-lockup">
        <span class="brand-name">${escapeHtml(BRAND_NAME)}</span>
        <span class="brand-divider"></span>
        <span class="brand-doc">${escapeHtml(BRAND_REPORT_TITLE)}</span>
      </div>
      <span class="brand-tagline">${escapeHtml(BRAND_TAGLINE)}</span>
    </div>
  `;
}

function pageShell(inner: string, pageNum: number, totalPages: number, generatedAt: string, isCover = false): string {
  return `
    <section class="print-page${isCover ? ' cover-page' : ''}">
      ${pageHeader()}
      <div class="page-body">${inner}</div>
      ${pageFooter(pageNum, totalPages, generatedAt)}
    </section>
  `;
}

export function buildReportPdfHtml(
  report: ProgressAnalysisReport,
  meta?: ProgressReportVisualMeta,
): string {
  const normalized = normalizeProgressReport(report);
  const generatedAt = meta?.generatedAt
    ? formatReportGeneratedAt(meta.generatedAt)
    : new Date().toLocaleString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
  const inspectionPeriod = formatReportDateRange(meta?.beforeDate, meta?.afterDate);
  const pct = normalized.overallProgress.percentage;
  const confidence = normalized.confidence;

  const hasFloorPlan = Boolean(meta?.floorPlanImageUrl);
  const hasPanoramas = Boolean(meta?.beforeImageUrl || meta?.afterImageUrl);

  const pinMarker = meta?.pinX != null && meta?.pinY != null
    ? `<div class="pin-marker" style="left:${meta.pinX}%;top:${meta.pinY}%"><span class="pin-dot"></span><span class="pin-ring"></span></div>`
    : '';

  const metaRows = [
    meta?.projectName ? { label: 'Project', value: meta.projectName } : null,
    meta?.tower ? { label: 'Tower', value: meta.tower } : null,
    meta?.floor ? { label: 'Floor', value: meta.floor } : null,
    meta?.pinName ? { label: 'Pin / Location', value: meta.pinName } : null,
    inspectionPeriod ? { label: 'Inspection Period', value: inspectionPeriod } : null,
    { label: 'Report Generated On', value: generatedAt },
  ].filter(Boolean) as { label: string; value: string }[];

  const coverPage = `
    <div class="cover-hero">
      <p class="cover-eyebrow">${escapeHtml(BRAND_NAME)}</p>
      <h1 class="cover-title">${escapeHtml(BRAND_REPORT_TITLE)}</h1>
      <p class="cover-subtitle">${escapeHtml(BRAND_REPORT_SUBTITLE)}</p>
    </div>

    <div class="project-meta">
      ${metaRows.map(r => `
        <div class="meta-item">
          <span class="meta-label">${escapeHtml(r.label)}</span>
          <span class="meta-value">${escapeHtml(r.value)}</span>
        </div>
      `).join('')}
    </div>

    <div class="hero-card avoid-break">
      <div class="hero-progress">
        <div class="hero-pct">${pct}<span>%</span></div>
        <div class="hero-progress-label">Overall Progress</div>
      </div>
      <div class="hero-body">
        <p class="hero-summary">${escapeHtml(normalized.overallProgress.description)}</p>
        <div class="hero-confidence">
          <span class="hero-conf-label">Analysis Confidence</span>
          <span class="hero-conf-value">${confidence}%</span>
          <span class="hero-conf-note">${escapeHtml(confidenceNarrative(confidence))}</span>
        </div>
      </div>
    </div>
  `;

  const visualsPage = `
    <div class="section exec-section avoid-break">
      <h2 class="section-title">Executive Summary</h2>
      <p class="exec-text">${escapeHtml(normalized.summary)}</p>
    </div>

    ${hasPanoramas ? `
      <div class="section comparison-section avoid-break">
        <h2 class="section-title">Before &amp; After Comparison</h2>
        <div class="comparison-stack">
          ${meta?.beforeImageUrl ? `
            <div class="comparison-frame">
              <div class="comparison-header">
                <span class="comparison-label before">Before</span>
                <span class="comparison-date">${escapeHtml(formatReportDate(meta.beforeDate))}</span>
              </div>
              <div class="comparison-image-wrap">
                <img src="${escapeHtml(meta.beforeImageUrl)}" alt="Before inspection capture" />
              </div>
              <div class="annotation-space"></div>
            </div>
          ` : ''}
          <div class="comparison-arrow" aria-hidden="true">↓</div>
          ${meta?.afterImageUrl ? `
            <div class="comparison-frame">
              <div class="comparison-header">
                <span class="comparison-label after">After</span>
                <span class="comparison-date">${escapeHtml(formatReportDate(meta.afterDate))}</span>
              </div>
              <div class="comparison-image-wrap">
                <img src="${escapeHtml(meta.afterImageUrl)}" alt="After inspection capture" />
              </div>
              <div class="annotation-space"></div>
            </div>
          ` : ''}
        </div>
      </div>
    ` : ''}

    ${hasFloorPlan ? `
      <div class="section floorplan-section avoid-break">
        <h2 class="section-title">Floor Plan — Inspected Location</h2>
        ${meta?.pinName ? `<p class="floorplan-caption">Selected pin: <strong>${escapeHtml(meta.pinName)}</strong></p>` : ''}
        <div class="floorplan-wrap">
          <img src="${escapeHtml(meta!.floorPlanImageUrl!)}" alt="Floor plan with inspected pin" class="floorplan-img" />
          ${pinMarker}
        </div>
      </div>
    ` : ''}
  `;

  const findingsPage = `
    <h2 class="section-title page-intro">Inspection Findings</h2>

    ${changeCards(normalized.changesDetected)}

    <div class="findings-grid">
      ${findingCard('Completed Work', normalized.completedWork, SECTION_EMPTY_MESSAGES.completedWork)}
      ${findingCard('New Work', normalized.newlyAdded, SECTION_EMPTY_MESSAGES.newlyAdded)}
      ${findingCard('Pending Work', normalized.pendingWork, SECTION_EMPTY_MESSAGES.pendingWork)}
      ${findingCard('Quality Observations', normalized.qualityObservations, SECTION_EMPTY_MESSAGES.qualityObservations)}
      ${findingCard('Safety Risks', normalized.risks, SECTION_EMPTY_MESSAGES.risks)}
      ${findingCard('Recommendations', normalized.recommendedNextSteps, SECTION_EMPTY_MESSAGES.recommendedNextSteps)}
    </div>

    <div class="confidence-card avoid-break">
      <div class="confidence-header">
        <span class="confidence-title">Analysis Confidence</span>
        <span class="confidence-pct">${confidence}%</span>
      </div>
      <div class="confidence-bar"><div class="confidence-fill" style="width:${confidence}%"></div></div>
      <p class="confidence-note">${escapeHtml(confidenceNarrative(confidence))}</p>
    </div>

    <div class="disclaimer avoid-break">
      <p>This report was generated automatically using AI-assisted construction image analysis under the ${escapeHtml(BRAND_NAME)} platform.</p>
      <p>Recommendations should be reviewed by a qualified site engineer before contractual, commercial, or safety decisions are made.</p>
    </div>
  `;

  const totalPages = 3;
  const body = [
    pageShell(coverPage, 1, totalPages, generatedAt, true),
    pageShell(visualsPage, 2, totalPages, generatedAt),
    pageShell(findingsPage, 3, totalPages, generatedAt),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(BRAND_REPORT_TITLE)}${meta?.projectName ? ` — ${escapeHtml(meta.projectName)}` : ''}</title>
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
      position: relative;
      width: 210mm;
      min-height: 297mm;
      padding: 14mm 18mm 20mm;
      page-break-after: always;
      break-after: page;
      display: flex;
      flex-direction: column;
    }
    .print-page:last-child { page-break-after: auto; }

    /* Header */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-bottom: 10px;
      margin-bottom: 18px;
      border-bottom: 1.5px solid #1a2332;
    }
    .brand-lockup { display: flex; align-items: center; gap: 10px; }
    .brand-name {
      font-size: 13px; font-weight: 800; color: #1a2332;
      letter-spacing: 0.12em; text-transform: uppercase;
    }
    .brand-divider { width: 1px; height: 16px; background: #c4cdd8; }
    .brand-doc { font-size: 11px; font-weight: 600; color: #4a5568; letter-spacing: 0.02em; }
    .brand-tagline { font-size: 8.5px; font-weight: 600; color: #8b95a5; letter-spacing: 0.06em; text-transform: uppercase; }

    /* Footer */
    .page-footer {
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #e4e8ee;
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
      gap: 2px 12px;
      font-size: 7.5px;
      color: #8b95a5;
      letter-spacing: 0.02em;
    }
    .footer-brand { grid-column: 1; font-weight: 700; color: #4a5568; }
    .footer-meta { grid-column: 1; }
    .footer-page { grid-column: 2; grid-row: 1 / 3; align-self: center; font-weight: 600; white-space: nowrap; }

    .page-body { flex: 1; }

    /* Cover */
    .cover-hero { margin-bottom: 28px; }
    .cover-eyebrow {
      font-size: 10px; font-weight: 800; color: #8b95a5;
      letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 8px;
    }
    .cover-title {
      font-size: 32px; font-weight: 300; color: #1a2332;
      margin: 0 0 8px; letter-spacing: -0.03em; line-height: 1.1;
    }
    .cover-subtitle {
      font-size: 12px; color: #5c6778; margin: 0; font-weight: 500;
      letter-spacing: 0.01em;
    }

    .project-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      margin-bottom: 24px;
      border-top: 1px solid #e4e8ee;
    }
    .meta-item {
      padding: 10px 0;
      border-bottom: 1px solid #e4e8ee;
    }
    .meta-label {
      display: block; font-size: 8px; font-weight: 700; color: #8b95a5;
      text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px;
    }
    .meta-value { display: block; font-size: 11px; font-weight: 600; color: #1a2332; }

    /* Hero progress card */
    .hero-card {
      display: flex; gap: 28px; align-items: flex-start;
      padding: 24px 28px;
      background: linear-gradient(135deg, #f7f9fb 0%, #eef2f6 100%);
      border: 1px solid #dce3eb;
      border-radius: 4px;
    }
    .hero-progress { text-align: center; flex-shrink: 0; min-width: 100px; }
    .hero-pct {
      font-size: 52px; font-weight: 200; color: #1a6b3c; line-height: 1;
      letter-spacing: -0.04em;
    }
    .hero-pct span { font-size: 22px; font-weight: 400; }
    .hero-progress-label {
      font-size: 8px; font-weight: 700; color: #5c6778;
      text-transform: uppercase; letter-spacing: 0.1em; margin-top: 6px;
    }
    .hero-body { flex: 1; }
    .hero-summary {
      font-size: 12px; line-height: 1.8; color: #2d3748; margin: 0 0 16px;
    }
    .hero-confidence {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px;
      padding-top: 14px; border-top: 1px solid #dce3eb;
    }
    .hero-conf-label {
      font-size: 8px; font-weight: 700; color: #8b95a5;
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .hero-conf-value { font-size: 18px; font-weight: 700; color: #1a2332; }
    .hero-conf-note { flex: 1 1 100%; font-size: 10px; color: #5c6778; line-height: 1.6; margin-top: 2px; }

    /* Sections */
    .section { margin-bottom: 22px; }
    .section-title {
      font-size: 11px; font-weight: 800; color: #1a2332;
      text-transform: uppercase; letter-spacing: 0.1em;
      margin: 0 0 12px; padding-bottom: 6px;
      border-bottom: 1px solid #e4e8ee;
    }
    .page-intro { margin-bottom: 18px; }
    .exec-text {
      font-size: 12.5px; line-height: 1.85; color: #2d3748; margin: 0;
    }

    /* Before / After */
    .comparison-stack { display: flex; flex-direction: column; gap: 6px; }
    .comparison-frame { border: 1px solid #dce3eb; border-radius: 4px; overflow: hidden; background: #0d1117; }
    .comparison-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; background: #f7f9fb; border-bottom: 1px solid #e4e8ee;
    }
    .comparison-label {
      font-size: 9px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    }
    .comparison-label.before { color: #1a4d8f; }
    .comparison-label.after { color: #1a6b3c; }
    .comparison-date { font-size: 9px; color: #5c6778; font-weight: 500; }
    .comparison-image-wrap { background: #0d1117; }
    .comparison-image-wrap img {
      width: 100%; height: 155px; object-fit: contain; display: block;
    }
    .annotation-space { height: 18px; background: #f7f9fb; border-top: 1px dashed #dce3eb; }
    .comparison-arrow {
      text-align: center; font-size: 18px; color: #8b95a5; line-height: 1; padding: 2px 0;
    }

    /* Floor plan */
    .floorplan-caption { font-size: 10px; color: #5c6778; margin: 0 0 10px; }
    .floorplan-wrap {
      position: relative; border: 1px solid #dce3eb; border-radius: 4px;
      overflow: hidden; background: #f7f9fb;
    }
    .floorplan-img { width: 100%; max-height: 200px; object-fit: contain; display: block; }
    .pin-marker {
      position: absolute; transform: translate(-50%, -50%);
      width: 28px; height: 28px;
    }
    .pin-dot {
      position: absolute; inset: 6px; border-radius: 50%;
      background: #1a4d8f; border: 2px solid #fff;
      box-shadow: 0 2px 8px rgba(26,77,143,0.45);
    }
    .pin-ring {
      position: absolute; inset: 0; border-radius: 50%;
      border: 2px solid rgba(26,77,143,0.35);
      animation: none;
    }

    /* Findings */
    .findings-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
      margin-bottom: 18px;
    }
    .findings-grid.full-width { grid-template-columns: 1fr; }
    .finding-card {
      padding: 14px 16px; background: #f7f9fb;
      border: 1px solid #e4e8ee; border-radius: 4px;
      break-inside: avoid; page-break-inside: avoid;
    }
    .finding-card h3 {
      font-size: 8.5px; font-weight: 800; color: #1a2332;
      text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px;
    }
    .finding-list { margin: 0; padding: 0 0 0 14px; }
    .finding-list li { font-size: 10px; line-height: 1.7; color: #2d3748; margin-bottom: 5px; }
    .finding-empty { font-size: 10px; line-height: 1.7; color: #5c6778; margin: 0; font-style: normal; }
    .change-item { margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e4e8ee; }
    .change-item:last-child { margin: 0; padding: 0; border: 0; }
    .change-item p { margin: 4px 0 0; font-size: 10px; line-height: 1.7; }
    .change-badges { display: flex; gap: 4px; flex-wrap: wrap; }
    .badge {
      display: inline-block; font-size: 7px; font-weight: 800;
      padding: 2px 6px; border-radius: 2px; letter-spacing: 0.06em; text-transform: uppercase;
    }
    .badge-high { background: #fde8e8; color: #b91c1c; }
    .badge-medium { background: #fef3e2; color: #b45309; }
    .badge-low { background: #eef2f6; color: #5c6778; }
    .badge-cat { background: #e8edf3; color: #4a5568; font-weight: 600; }

    /* Confidence */
    .confidence-card {
      padding: 16px 18px; margin-bottom: 16px;
      background: #f7f9fb; border: 1px solid #e4e8ee; border-radius: 4px;
    }
    .confidence-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .confidence-title {
      font-size: 8.5px; font-weight: 800; color: #1a2332;
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .confidence-pct { font-size: 22px; font-weight: 700; color: #1a2332; }
    .confidence-bar { height: 4px; background: #dce3eb; border-radius: 2px; overflow: hidden; margin-bottom: 8px; }
    .confidence-fill { height: 100%; background: #1a4d8f; border-radius: 2px; }
    .confidence-note { font-size: 10px; line-height: 1.65; color: #5c6778; margin: 0; }

    .disclaimer {
      padding: 12px 14px; background: #f7f9fb; border-left: 3px solid #c4cdd8;
    }
    .disclaimer p { font-size: 8.5px; line-height: 1.65; color: #8b95a5; margin: 0 0 4px; }
    .disclaimer p:last-child { margin: 0; }

    .avoid-break { break-inside: avoid; page-break-inside: avoid; }

    @media screen {
      body { background: #c4cdd8; padding: 24px 0; }
      .print-page { margin: 0 auto 24px; box-shadow: 0 4px 24px rgba(26,35,50,0.15); background: #fff; }
    }
    @media print {
      body { background: #fff; }
      .print-page { box-shadow: none; margin: 0; }
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function exportReportToPdf(
  report: ProgressAnalysisReport,
  meta?: ProgressReportVisualMeta,
): void {
  const html = buildReportPdfHtml(report, meta);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

export function formatReportAsText(
  report: ProgressAnalysisReport,
  meta?: ProgressReportVisualMeta,
): string {
  const n = normalizeProgressReport(report);
  const lines: string[] = [
    `${BRAND_NAME.toUpperCase()} — ${BRAND_REPORT_TITLE.toUpperCase()}`,
    BRAND_TAGLINE,
    '═'.repeat(52),
    '',
  ];

  if (meta?.projectName) lines.push(`Project: ${meta.projectName}`);
  if (meta?.tower) lines.push(`Tower: ${meta.tower}`);
  if (meta?.floor) lines.push(`Floor: ${meta.floor}`);
  if (meta?.pinName) lines.push(`Pin / Location: ${meta.pinName}`);
  if (meta?.beforeDate || meta?.afterDate) {
    lines.push(`Inspection period: ${formatReportDateRange(meta.beforeDate, meta.afterDate)}`);
  }
  lines.push('');

  lines.push('EXECUTIVE SUMMARY');
  lines.push(n.summary);
  lines.push('');

  lines.push(`OVERALL PROGRESS: ${n.overallProgress.percentage}%`);
  lines.push(n.overallProgress.description);
  lines.push('');
  lines.push(`ANALYSIS CONFIDENCE: ${n.confidence}%`);
  lines.push(confidenceNarrative(n.confidence));
  lines.push('');

  const section = (title: string, items: string[], empty: string) => {
    lines.push(title);
    if (!items.length) {
      lines.push(`  ${empty}`);
    } else {
      items.forEach(item => lines.push(`  • ${item}`));
    }
    lines.push('');
  };

  if (n.changesDetected.length) {
    lines.push('KEY CONSTRUCTION CHANGES');
    n.changesDetected.forEach(c => {
      lines.push(`  [${c.importance}] ${c.text}`);
    });
    lines.push('');
  }

  section('COMPLETED WORK', n.completedWork, SECTION_EMPTY_MESSAGES.completedWork);
  section('NEW WORK', n.newlyAdded, SECTION_EMPTY_MESSAGES.newlyAdded);
  section('PENDING WORK', n.pendingWork, SECTION_EMPTY_MESSAGES.pendingWork);
  section('QUALITY OBSERVATIONS', n.qualityObservations, SECTION_EMPTY_MESSAGES.qualityObservations);
  section('SAFETY RISKS', n.risks, SECTION_EMPTY_MESSAGES.risks);
  section('RECOMMENDATIONS', n.recommendedNextSteps, SECTION_EMPTY_MESSAGES.recommendedNextSteps);

  lines.push(`${BRAND_FOOTER} · v${REPORT_VERSION}`);

  return lines.join('\n');
}
