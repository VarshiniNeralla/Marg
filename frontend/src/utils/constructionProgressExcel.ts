import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { blobToBase64 } from '@/utils/htmlToPdf';
import { ACTIVITY_STATUS_LABELS, type FloorProgressSnapshot } from '@/services/constructionProgressService';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export async function exportConstructionProgressExcel(
  snapshot: FloorProgressSnapshot,
  timeline: { snapshotDate: string; overallProgressPct: number }[],
): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SiteVision';
  workbook.created = new Date();

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ width: 28 }, { width: 40 }];
  const summaryRows: [string, string | number][] = [
    ['Project', snapshot.projectName],
    ['Tower', snapshot.towerName],
    ['Floor', snapshot.floorName],
    ['Overall Progress', `${Math.round(snapshot.overallProgressPct)}%`],
    ['AI Confidence', `${Math.round(snapshot.overallConfidencePct)}%`],
    ['Images Analyzed', snapshot.imagesAnalyzedCount],
    ['Rooms Completed', snapshot.summaryCards.roomsCompleted],
    ['Rooms Pending', snapshot.summaryCards.roomsPending],
    ['Activities Completed', snapshot.summaryCards.activitiesCompleted],
    ['Activities Pending', snapshot.summaryCards.activitiesPending],
    ['Last Inspection', formatDate(snapshot.summaryCards.lastInspection)],
    ['AI Summary', snapshot.executiveSummary],
  ];
  summary.addRow(['Field', 'Value']).font = { bold: true };
  summaryRows.forEach(row => summary.addRow(row));
  summary.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F8' } };
  });

  // ── Activities sheet ───────────────────────────────────────────────────────
  const activities = workbook.addWorksheet('Activities');
  activities.columns = [
    { header: 'Section', key: 'section', width: 12 },
    { header: 'Activity', key: 'name', width: 42 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Completion %', key: 'completion', width: 14 },
    { header: 'Confidence %', key: 'confidence', width: 14 },
    { header: 'Evidence Captures', key: 'evidence', width: 30 },
  ];
  activities.getRow(1).font = { bold: true };
  activities.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F8' } };
  });
  [...snapshot.activities]
    .sort((a, b) => (a.section === b.section ? a.sequenceIndex - b.sequenceIndex : a.section.localeCompare(b.section)))
    .forEach(a => {
      activities.addRow({
        section: a.section === 'flat' ? 'Flat' : 'Common Area',
        name: a.name,
        status: ACTIVITY_STATUS_LABELS[a.status],
        completion: Math.round(a.completionPct),
        confidence: a.confidencePct > 0 ? Math.round(a.confidencePct) : '',
        evidence: a.evidenceCaptureIds.join(', '),
      });
    });

  // ── Timeline sheet ─────────────────────────────────────────────────────────
  const timelineSheet = workbook.addWorksheet('Timeline');
  timelineSheet.columns = [
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Overall Progress %', key: 'pct', width: 20 },
  ];
  timelineSheet.getRow(1).font = { bold: true };
  timelineSheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F8' } };
  });
  timeline.forEach(point => {
    timelineSheet.addRow({ date: formatDate(point.snapshotDate), pct: Math.round(point.overallProgressPct) });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `Construction-Progress-${snapshot.floorName.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.xlsx`;

  if (Capacitor.isNativePlatform()) {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
    await Share.share({ title: fileName, url: uri, dialogTitle: 'Share activity report' });
  } else {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
