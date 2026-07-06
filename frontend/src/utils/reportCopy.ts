import { ensureSentence } from '@/utils/reportNormalization';
import { confidenceNarrative } from '@/utils/reportBranding';

const GENERIC_SUMMARY_PATTERNS = [
  /no significant construction progress/i,
  /no visible construction progress/i,
  /no measurable progress/i,
  /no changes detected/i,
  /no visible changes/i,
];

const GENERIC_PROGRESS_PATTERNS = [
  /no visible changes/i,
  /no progress detected/i,
  /no changes or progress/i,
];

export const SECTION_EMPTY_MESSAGES = {
  completedWork:
    'No completed scope was identified within the visible inspection area during this interval.',
  newlyAdded:
    'No newly installed components, materials, or finishes were observed between the reference captures.',
  removedItems:
    'No material removals or demobilised items were recorded in the compared field of view.',
  pendingWork:
    'No outstanding pending activities were evident from the available panoramic imagery.',
  qualityObservations:
    'No quality concerns or workmanship deviations were observed in the visible inspection zone.',
  risks:
    'No immediate safety risks were identified from the available site imagery.',
  recommendedNextSteps:
    'Continue routine monitoring at this location during subsequent site walks and capture cycles.',
  changesDetected:
    'No discernible construction changes were observed between the reference inspection dates.',
} as const;

export function polishExecutiveSummary(raw: string, progressPct: number): string {
  const text = raw.trim();
  const isGeneric = GENERIC_SUMMARY_PATTERNS.some(p => p.test(text));
  if (isGeneric || (progressPct <= 5 && text.length < 200)) {
    return (
      'Based on the comparison of both inspections, no measurable construction progress was identified during the inspection interval. ' +
      'Structural elements, wall condition, ceiling slab, and visible MEP installations remain visually consistent. ' +
      'No newly installed or removed components were observed within the compared field of view.'
    );
  }
  return ensureSentence(text);
}

export function polishProgressDescription(raw: string, progressPct: number): string {
  const text = raw.trim();
  const isGeneric = GENERIC_PROGRESS_PATTERNS.some(p => p.test(text));
  if (!text || isGeneric || progressPct <= 5) {
    return (
      'The inspected location shows no discernible advancement in structural, architectural, or MEP scope between the reference dates. ' +
      'Visible surfaces and temporary site conditions remain substantially unchanged.'
    );
  }
  return ensureSentence(text);
}

export function polishFallbackSummary(): string {
  return (
    'This report presents a structured comparison of two panoramic site captures at the same pin location. ' +
    'Findings are limited to visually verifiable evidence within the compared imagery.'
  );
}

export { confidenceNarrative };
