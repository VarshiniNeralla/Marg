/** Enterprise report branding — presentation layer only. */
export const BRAND_NAME = 'Prangan';
export const BRAND_TAGLINE = 'AI Powered Construction Progress Report';
export const BRAND_REPORT_TITLE = 'Construction Progress Report';
export const BRAND_REPORT_SUBTITLE = 'AI Assisted Construction Site Progress Analysis';
export const BRAND_FOOTER = 'Prangan • AI Powered Construction Intelligence';
export const REPORT_VERSION = '1.0';

export function confidenceLabel(confidence: number): 'High' | 'Moderate' | 'Limited' {
  if (confidence >= 85) return 'High';
  if (confidence >= 60) return 'Moderate';
  return 'Limited';
}

export function confidenceNarrative(confidence: number): string {
  if (confidence >= 85) {
    return 'High confidence based on clear visual evidence and consistent camera positioning between both inspections.';
  }
  if (confidence >= 60) {
    return 'Moderate confidence — primary elements are visible, although some areas were partially obscured or affected by varying light conditions.';
  }
  return 'Limited confidence due to visibility constraints; on-site verification is recommended before contractual or safety decisions.';
}
