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
import { formatReportDate, formatReportGeneratedAt } from '@/utils/reportFormat';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function floorPlanPageHtml(meta: ProgressReportVisualMeta): string {
  const url = escapeHtml(meta.floorPlanImageUrl!);
  const hasPin = meta.pinX != null && meta.pinY != null;

  const locationParts = [
    meta.projectName,
    meta.tower,
    meta.floor,
  ].filter(Boolean);
  return `
    <div class="floorplan-page-content">
      <h2 class="section-title floorplan-page-title">Floor Plan — Capture Point</h2>
      <div class="floorplan-context">
        ${locationParts.length ? `<p class="floorplan-location">${escapeHtml(locationParts.join(' · '))}</p>` : ''}
        ${meta.pinName ? `<p class="floorplan-caption"><strong>${escapeHtml(meta.pinName)}</strong></p>` : ''}
      </div>
      <div class="floorplan-stage">
        <div class="floorplan-wrap floorplan-wrap-full">
          <img src="${url}" alt="Floor plan" class="floorplan-img-full" />
          ${hasPin ? `<div class="floorplan-pin" data-pin-x="${meta.pinX}" data-pin-y="${meta.pinY}"><span class="floorplan-pin-core"></span></div>` : ''}
        </div>
      </div>
      <p class="floorplan-legend">Blue marker indicates the capture point referenced in this report.</p>
    </div>
  `;
}

const FLOOR_PLAN_INIT_SCRIPT = `
function initReportFloorPlans() {
  document.querySelectorAll('.floorplan-wrap-full').forEach(function(wrap) {
    var img = wrap.querySelector('.floorplan-img-full');
    var pin = wrap.querySelector('.floorplan-pin');
    if (!img) return;
    function layout() {
      var iw = img.naturalWidth;
      var ih = img.naturalHeight;
      if (!iw || !ih) return;
      wrap.style.aspectRatio = iw + ' / ' + ih;
      wrap.style.width = '100%';
      wrap.style.height = 'auto';
      wrap.style.maxHeight = '200mm';
      wrap.style.flex = '0 0 auto';
      if (pin) {
        var pinX = parseFloat(pin.getAttribute('data-pin-x'));
        var pinY = parseFloat(pin.getAttribute('data-pin-y'));
        if (!isNaN(pinX) && !isNaN(pinY)) {
          pin.style.left = pinX + '%';
          pin.style.top = pinY + '%';
          pin.style.display = 'block';
        }
      }
      wrap.setAttribute('data-floorplan-ready', '1');
    }
    if (img.complete && img.naturalWidth) layout();
    else img.addEventListener('load', layout);
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReportFloorPlans);
} else {
  initReportFloorPlans();
}
window.initReportFloorPlans = initReportFloorPlans;
`;

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

function pageShell(
  inner: string,
  pageNum: number,
  totalPages: number,
  generatedAt: string,
  variant?: 'cover' | 'floorplan',
): string {
  const extraClass = variant === 'cover' ? ' cover-page' : variant === 'floorplan' ? ' floorplan-page' : '';
  return `
    <section class="print-page${extraClass}">
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
  const pct = normalized.overallProgress.percentage;
  const hasFloorPlan = Boolean(meta?.floorPlanImageUrl);
  const hasPanoramas = Boolean(meta?.beforeImageUrl || meta?.afterImageUrl);

  const metaRows = [
    meta?.projectName ? { label: 'Project', value: meta.projectName } : null,
    meta?.tower ? { label: 'Tower', value: meta.tower } : null,
    meta?.floor ? { label: 'Floor', value: meta.floor } : null,
    meta?.pinName ? { label: 'Capture Point', value: meta.pinName } : null,
    meta?.beforeDate ? { label: 'Before Date', value: formatReportDate(meta.beforeDate) } : null,
    meta?.afterDate ? { label: 'After Date', value: formatReportDate(meta.afterDate) } : null,
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
        <div class="hero-progress-label">Visible Progress Change</div>
      </div>
      <div class="hero-body">
        <p class="hero-summary">${escapeHtml(normalized.overallProgress.description)}</p>
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

    <div class="disclaimer avoid-break">
      <p>This report was generated automatically using AI-assisted construction image analysis under the ${escapeHtml(BRAND_NAME)} platform.</p>
      <p>Recommendations should be reviewed by a qualified site engineer before contractual, commercial, or safety decisions are made.</p>
    </div>
  `;

  const pageContents: { html: string; variant?: 'cover' | 'floorplan' }[] = [
    { html: coverPage, variant: 'cover' },
    { html: visualsPage },
  ];
  if (hasFloorPlan && meta) {
    pageContents.push({ html: floorPlanPageHtml(meta), variant: 'floorplan' });
  }
  pageContents.push({ html: findingsPage });

  const totalPages = pageContents.length;
  const body = pageContents
    .map((page, index) => pageShell(page.html, index + 1, totalPages, generatedAt, page.variant))
    .join('');

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

    /* Floor plan — dedicated page */
    .floorplan-page .page-body {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .floorplan-page-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .floorplan-page-title { margin-bottom: 10px; }
    .floorplan-context { margin-bottom: 12px; }
    .floorplan-location {
      font-size: 11px; font-weight: 600; color: #1a2332; margin: 0 0 4px;
    }
    .floorplan-caption { font-size: 10px; color: #5c6778; margin: 0; }
    .floorplan-stage {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      width: 100%;
    }
    .floorplan-wrap {
      position: relative; border: 1px solid #dce3eb; border-radius: 4px;
      overflow: hidden; background: #f7f9fb;
    }
    .floorplan-wrap-full {
      width: 100%;
      max-height: 200mm;
      margin: 0 auto;
    }
    .floorplan-img-full {
      width: 100%;
      height: 100%;
      display: block;
      vertical-align: top;
    }
    .floorplan-pin {
      position: absolute;
      display: none;
      width: 22px;
      height: 22px;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .floorplan-pin::before {
      content: '';
      position: absolute;
      inset: -6px;
      border-radius: 50%;
      border: 2px solid rgba(26,77,143,0.35);
      background: rgba(26,77,143,0.12);
    }
    .floorplan-pin-core {
      position: absolute;
      inset: 3px;
      border-radius: 50%;
      background: #1a4d8f;
      border: 2.5px solid #ffffff;
      box-shadow: 0 2px 10px rgba(26,77,143,0.45);
    }
    .floorplan-legend {
      margin: 10px 0 0;
      font-size: 9px;
      color: #8b95a5;
      text-align: center;
      font-style: italic;
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
<body>${body}<script>${FLOOR_PLAN_INIT_SCRIPT}</script></body>
</html>`;
}

/** Waits for every <img> under `root` to finish loading (success or error). */
function waitForImages(root: ParentNode): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>(resolve => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    }),
  ).then(() => undefined);
}

/** Waits for the floor-plan pin overlay's inline layout script to finish
 *  positioning the pin marker (see FLOOR_PLAN_INIT_SCRIPT) — needed before
 *  rasterizing/printing so the pin isn't captured mid-layout or missing. */
function waitForFloorPlanLayout(root: ParentNode, runInit: () => void): Promise<void> {
  return new Promise(resolve => {
    let attempts = 0;
    const tick = () => {
      runInit();
      const floorImgs = Array.from(root.querySelectorAll('.floorplan-img-full')) as HTMLImageElement[];
      const wraps = Array.from(root.querySelectorAll('.floorplan-wrap-full'));
      const imgsReady = !floorImgs.length || floorImgs.every(img => img.complete && img.naturalWidth > 0);
      const layoutReady = wraps.length === 0 || wraps.every(w => w.getAttribute('data-floorplan-ready') === '1');
      if ((imgsReady && layoutReady) || attempts >= 60) resolve();
      else {
        attempts += 1;
        setTimeout(tick, 100);
      }
    };
    tick();
  });
}

/** Same base64-stripping convention as fileUploadQueue.ts's fileToBase64. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** Layout-positions the floor-plan pin marker inline, mirroring what
 *  FLOOR_PLAN_INIT_SCRIPT does inside the popup-window path — needed here
 *  because that script is injected as a <script> tag meant for a fresh
 *  document (via document.write), which doesn't execute when the same HTML
 *  is parsed into a hidden container in the CURRENT document instead. */
function layoutFloorPlanPins(root: ParentNode): void {
  root.querySelectorAll('.floorplan-wrap-full').forEach(wrap => {
    const img = wrap.querySelector('.floorplan-img-full') as HTMLImageElement | null;
    const pin = wrap.querySelector('.floorplan-pin') as HTMLElement | null;
    if (!img) return;
    const layout = () => {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih) return;
      const el = wrap as HTMLElement;
      el.style.aspectRatio = `${iw} / ${ih}`;
      el.style.width = '100%';
      el.style.height = 'auto';
      el.style.maxHeight = '200mm';
      el.style.flex = '0 0 auto';
      if (pin) {
        const pinX = parseFloat(pin.getAttribute('data-pin-x') ?? '');
        const pinY = parseFloat(pin.getAttribute('data-pin-y') ?? '');
        if (!isNaN(pinX) && !isNaN(pinY)) {
          pin.style.left = `${pinX}%`;
          pin.style.top = `${pinY}%`;
          pin.style.display = 'block';
        }
      }
      wrap.setAttribute('data-floorplan-ready', '1');
    };
    if (img.complete && img.naturalWidth) layout();
    else img.addEventListener('load', layout);
  });
}

/** Renders the report as a real PDF file client-side (html2canvas → jsPDF,
 *  one page image per .print-page section) and hands it to Android's native
 *  Share sheet. Used only on native — window.print() has no OS-level "Save
 *  as PDF" destination inside a Capacitor WebView, so the web print flow
 *  below silently does nothing there. */
async function exportReportToPdfNative(
  report: ProgressAnalysisReport,
  meta: ProgressReportVisualMeta | undefined,
  reportTitle: string,
): Promise<void> {
  const html = buildReportPdfHtml(report, meta);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  // Strip the trailing <script>FLOOR_PLAN_INIT_SCRIPT</script> — scripts set
  // via innerHTML never execute anyway; layoutFloorPlanPins() below does the
  // equivalent positioning directly against this container instead.
  const bodyContent = (bodyMatch?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/, '');

  const container = document.createElement('div');
  // Offscreen, not display:none — html2canvas cannot rasterize elements that
  // are display:none or otherwise not actually laid out/painted.
  container.style.cssText = 'position:fixed; top:0; left:-99999px; z-index:-1;';
  const styleEl = document.createElement('style');
  styleEl.textContent = styleMatch?.[1] ?? '';
  container.appendChild(styleEl);
  const contentWrap = document.createElement('div');
  contentWrap.innerHTML = bodyContent;
  container.appendChild(contentWrap);
  document.body.appendChild(container);

  try {
    await waitForImages(container);
    layoutFloorPlanPins(container);
    await waitForFloorPlanLayout(container, () => layoutFloorPlanPins(container));

    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');

    const pages = Array.from(contentWrap.querySelectorAll('.print-page')) as HTMLElement[];
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidthMm = 210;
    const pageHeightMm = 297;

    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
    }

    const pdfBlob = pdf.output('blob') as Blob;
    const base64 = await blobToBase64(pdfBlob);
    const fileName = `${reportTitle.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.pdf`;

    await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });

    await Share.share({
      title: reportTitle,
      url: uri,
      dialogTitle: 'Share progress report',
    });
  } finally {
    document.body.removeChild(container);
  }
}

function exportReportToPdfWeb(
  report: ProgressAnalysisReport,
  meta?: ProgressReportVisualMeta,
): void {
  const html = buildReportPdfHtml(report, meta);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();

  waitForImages(win.document)
    .then(() => waitForFloorPlanLayout(win.document, () => {
      const init = (win as Window & { initReportFloorPlans?: () => void }).initReportFloorPlans;
      if (typeof init === 'function') init();
    }))
    .then(() => {
      setTimeout(() => win.print(), 400);
    });
}

export function exportReportToPdf(
  report: ProgressAnalysisReport,
  meta?: ProgressReportVisualMeta,
): void | Promise<void> {
  if (Capacitor.isNativePlatform()) {
    return exportReportToPdfNative(report, meta, BRAND_REPORT_TITLE);
  }
  exportReportToPdfWeb(report, meta);
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
  if (meta?.pinName) lines.push(`Capture Point: ${meta.pinName}`);
  if (meta?.beforeDate) lines.push(`Before Date: ${formatReportDate(meta.beforeDate)}`);
  if (meta?.afterDate) lines.push(`After Date: ${formatReportDate(meta.afterDate)}`);
  lines.push('');

  lines.push('EXECUTIVE SUMMARY');
  lines.push(n.summary);
  lines.push('');

  lines.push(`VISIBLE PROGRESS CHANGE: ${n.overallProgress.percentage}%`);
  lines.push(n.overallProgress.description);
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
