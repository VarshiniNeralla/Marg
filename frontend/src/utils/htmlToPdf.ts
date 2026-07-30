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

/**
 * Renders a full standalone HTML document string (with inlined <style>, one
 * or more `.print-page` sections) to a real PDF client-side and hands it to
 * Android's native Share sheet. Native-only — window.print() has no OS-level
 * "Save as PDF" destination inside a Capacitor WebView.
 */
async function exportHtmlToPdfNative(html: string, fileTitle: string): Promise<void> {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
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
  } finally {
    document.body.removeChild(container);
  }
}

function exportHtmlToPdfWeb(html: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();

  waitForImages(win.document).then(() => {
    setTimeout(() => win.print(), 400);
  });
}

/** Dispatches to the native (Capacitor) or web print flow, matching
 *  reportPdf.ts's exportReportToPdf branching convention exactly. */
export function exportHtmlToPdf(html: string, fileTitle: string): void | Promise<void> {
  if (Capacitor.isNativePlatform()) {
    return exportHtmlToPdfNative(html, fileTitle);
  }
  exportHtmlToPdfWeb(html);
}
