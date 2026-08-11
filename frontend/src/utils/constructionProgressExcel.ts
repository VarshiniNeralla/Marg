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
    ['Coverage %', typeof snapshot.summaryCards.coveragePct === 'number' ? `${Math.round(snapshot.summaryCards.coveragePct)}%` : ''],
    ['AI Confidence', `${Math.round(snapshot.overallConfidencePct)}%`],
    ['Images Analyzed', snapshot.imagesAnalyzedCount],
    ['Rooms Completed', snapshot.summaryCards.roomsCompleted],
    ['Rooms In Progress', snapshot.summaryCards.roomsInProgress],
    ['Rooms Not Started', snapshot.summaryCards.roomsNotStarted],
    ['Activities Completed', snapshot.summaryCards.activitiesCompleted],
    ['Activities In Progress', snapshot.summaryCards.activitiesInProgress],
    ['Activities Not Started', snapshot.summaryCards.activitiesNotStarted],
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
        status: ACTIVITY_STATUS_LABELS[a.status] ?? a.status,
        completion: Math.round(a.completionPct),
        confidence: a.confidencePct > 0 ? Math.round(a.confidencePct) : '',
      });
    });

  // ── Flat Finishing sheet (per-room / per-activity) ─────────────────────────
  const flatSheet = workbook.addWorksheet('Flat Finishing');
  flatSheet.columns = [
    { header: 'Flat', key: 'flat', width: 18 },
    { header: 'Room', key: 'room', width: 22 },
    { header: 'Room Complete', key: 'roomComplete', width: 14 },
    { header: 'Room Progress %', key: 'roomPct', width: 14 },
    { header: 'Pins', key: 'pins', width: 14 },
    { header: 'Captures', key: 'captures', width: 10 },
    { header: 'Activity', key: 'activity', width: 42 },
    { header: 'Activity %', key: 'activityPct', width: 12 },
    { header: 'Evidence', key: 'evidence', width: 48 },
  ];
  flatSheet.getRow(1).font = { bold: true };
  flatSheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F8' } };
  });
  (snapshot.flatProgress ?? []).forEach(flat => {
    flat.rooms.forEach(room => {
      const scorable = room.activities.filter(a => a.status !== 'not_observable');
      const roomPct = room.isComplete
        ? 100
        : scorable.length === 0
          ? (room.activities.length > 0 ? 100 : 0)
          : Math.min(99, Math.round(scorable.reduce((n, a) => n + a.completionPct, 0) / scorable.length));
      if (room.activities.length === 0) {
        flatSheet.addRow({
          flat: flat.flatName,
          room: room.roomName,
          roomComplete: room.isComplete ? 'Yes' : 'No',
          roomPct,
          pins: (room.pinNumbers ?? []).join(', '),
          captures: room.capturesCount ?? 0,
          activity: '',
          activityPct: '',
          evidence: '',
        });
        return;
      }
      room.activities.forEach(a => {
        flatSheet.addRow({
          flat: flat.flatName,
          room: room.roomName,
          roomComplete: room.isComplete ? 'Yes' : 'No',
          roomPct,
          pins: (room.pinNumbers ?? []).join(', '),
          captures: room.capturesCount ?? 0,
          activity: a.activityName,
          activityPct: Math.round(a.completionPct),
          evidence: a.evidence ?? '',
        });
      });
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
