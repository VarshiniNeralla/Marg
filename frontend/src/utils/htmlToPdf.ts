/**
 * Generic HTML-string -> PDF export pipeline, factored out of reportPdf.ts's
 * battle-tested native/web machinery so any report (not just the before/after
 * progress-analysis report) can reuse it without duplicating the html2canvas
 * + jsPDF + Capacitor Share sequence. reportPdf.ts's own exports are
 * unchanged — this module only extracts the type-agnostic pieces.
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** A4 width used for offscreen layout + html2canvas (≈96dpi CSS px). */
const A4_WIDTH_PX = 794;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

/**
 * Waits for every <img> under `root` to finish loading (success or error).
 * Each image is capped at `perImageTimeoutMs` so a single stalled request
 * (flaky mobile connection, slow Cloudinary fetch) can't hang report
 * generation indefinitely — reports with many evidence photos rely on this.
 */
export function waitForImages(root: ParentNode, perImageTimeoutMs = 10000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>(resolve => {
        const timer = setTimeout(resolve, perImageTimeoutMs);
        img.onload = () => { clearTimeout(timer); resolve(); };
        img.onerror = () => { clearTimeout(timer); resolve(); };
      });
    }),
  ).then(() => undefined);
}

/** Same base64-stripping convention as fileUploadQueue.ts's fileToBase64. */
export function blobToBase64(blob: Blob): Promise<string> {
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

function extractHtmlParts(html: string): { styles: string; bodyContent: string } {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  // Merge EVERY <style> block — body-embedded section styles used to be dropped
  // when only the first head <style> was kept.
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(m => m[1])
    .join('\n');
  const bodyContent = (bodyMatch?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');
  return { styles, bodyContent };
}

function mountOffscreenHtml(html: string): { container: HTMLDivElement; contentWrap: HTMLDivElement } {
  const { styles, bodyContent } = extractHtmlParts(html);
  const container = document.createElement('div');
  // Explicit A4 width — without it, position:fixed + left:-99999px shrink-wraps
  // and produces an ultra-narrow corrupted raster.
  container.style.cssText = [
    'position:fixed',
    'top:0',
    'left:-10000px',
    `width:${A4_WIDTH_PX}px`,
    'z-index:-1',
    'pointer-events:none',
    'background:#fff',
  ].join(';');
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  container.appendChild(styleEl);
  const contentWrap = document.createElement('div');
  contentWrap.style.cssText = `width:${A4_WIDTH_PX}px;`;
  contentWrap.innerHTML = bodyContent;
  container.appendChild(contentWrap);
  document.body.appendChild(container);

  // Match A4 width; height is capped by CSS. Prefer overflow:visible so packing
  // bugs surface as taller canvases (sliced) rather than silently clipped text.
  contentWrap.querySelectorAll('.print-page').forEach(el => {
    const page = el as HTMLElement;
    page.style.width = `${A4_WIDTH_PX}px`;
    page.style.maxWidth = `${A4_WIDTH_PX}px`;
    page.style.minWidth = `${A4_WIDTH_PX}px`;
    page.style.minHeight = `${Math.round(297 * 96 / 25.4)}px`;
    page.style.boxSizing = 'border-box';
    page.style.background = '#ffffff';
  });

  return { container, contentWrap };
}

/** Crop one A4-tall slice from a tall canvas — avoids black bars from negative-Y addImage. */
function sliceCanvas(source: HTMLCanvasElement, startY: number, sliceHeight: number): HTMLCanvasElement {
  const height = Math.max(1, Math.min(sliceHeight, source.height - startY));
  const slice = document.createElement('canvas');
  slice.width = source.width;
  slice.height = height;
  const ctx = slice.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(
      source,
      0, startY, source.width, height,
      0, 0, slice.width, height,
    );
  }
  return slice;
}

/**
 * Paint one `.print-page` into the PDF. Tall pages are sliced across multiple
 * A4 sheets at native aspect ratio — never squashed into a single 210×297 box
 * (that was the "long thin corrupted strip" bug).
 */
async function appendPrintPageToPdf(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  pageEl: HTMLElement,
  html2canvas: typeof import('html2canvas').default,
  isFirstPage: boolean,
): Promise<void> {
  const canvas = await html2canvas(pageEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    windowWidth: A4_WIDTH_PX,
    logging: false,
    scrollX: 0,
    scrollY: 0,
  });

  const imgWidthMm = PAGE_WIDTH_MM;
  const fullHeightMm = (canvas.height * imgWidthMm) / Math.max(canvas.width, 1);
  const pxPerMm = canvas.width / imgWidthMm;
  const pageHeightPx = Math.floor(PAGE_HEIGHT_MM * pxPerMm);

  // Pages are packed to ≤ A4. Capture at fixed size; only slice if something overflowed.
  if (fullHeightMm <= PAGE_HEIGHT_MM + 1.5) {
    if (!isFirstPage) pdf.addPage();
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidthMm, Math.min(fullHeightMm, PAGE_HEIGHT_MM));
    return;
  }

  let offsetY = 0;
  let firstSlice = true;
  while (offsetY < canvas.height - 1) {
    const slice = sliceCanvas(canvas, offsetY, pageHeightPx);
    const sliceHeightMm = (slice.height * imgWidthMm) / Math.max(slice.width, 1);
    const imgData = slice.toDataURL('image/jpeg', 0.92);
    if (!(isFirstPage && firstSlice)) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidthMm, sliceHeightMm);
    offsetY += pageHeightPx;
    firstSlice = false;
  }
}

async function renderHtmlToJsPdf(html: string): Promise<InstanceType<typeof import('jspdf').jsPDF>> {
  const { container, contentWrap } = mountOffscreenHtml(html);
  try {
    await waitForImages(container);
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');

    const pages = Array.from(contentWrap.querySelectorAll('.print-page')) as HTMLElement[];
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    if (pages.length === 0) {
      return pdf;
    }

    for (let i = 0; i < pages.length; i++) {
      await appendPrintPageToPdf(pdf, pages[i], html2canvas, i === 0);
    }
    return pdf;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Renders a full standalone HTML document string (with inlined <style>, one
 * or more `.print-page` sections) to a real PDF client-side and hands it to
 * Android's native Share sheet. Native-only — window.print() has no OS-level
 * "Save as PDF" destination inside a Capacitor WebView.
 */
async function exportHtmlToPdfNative(html: string, fileTitle: string): Promise<void> {
  const pdf = await renderHtmlToJsPdf(html);
  const pdfBlob = pdf.output('blob') as Blob;
  const base64 = await blobToBase64(pdfBlob);
  const fileName = `${fileTitle.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.pdf`;

  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });

  await Share.share({
    title: fileTitle,
    url: uri,
    dialogTitle: 'Share report',
  });
}

/**
 * Renders the report to a real PDF in-browser (same html2canvas + jsPDF
 * pipeline as the native path) and triggers a direct file download — no
 * window.print() dialog, no print-preview tab. A field/office user clicking
 * "PDF Report" wants the file, not another dialog to click through.
 */
async function exportHtmlToPdfWeb(html: string, fileTitle: string): Promise<void> {
  const pdf = await renderHtmlToJsPdf(html);
  const fileName = `${fileTitle.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.pdf`;
  pdf.save(fileName);
}

/** Dispatches to the native (Capacitor) or web download flow. Both paths now
 *  render the same client-side PDF and hand it straight to the OS (native
 *  Share sheet / browser download) — neither shows a preview first. */
export function exportHtmlToPdf(html: string, fileTitle: string): void | Promise<void> {
  if (Capacitor.isNativePlatform()) {
    return exportHtmlToPdfNative(html, fileTitle);
  }
  return exportHtmlToPdfWeb(html, fileTitle);
}
