/**
 * Names for activity ids. The server sends names with every assessment, so this list is only a
 * fallback (and the way old snapshots stay readable after the core list changed).
 * Core list = what the AI scores now. Legacy ids left the core list but still appear in stored snapshots.
 */
export const CORE_ACTIVITY_NAMES: Record<string, string> = {
  'flat.floor_screed_1': 'Screed Works',
  'flat.core_service_lines': 'Service Lines',
  'flat.core_punning': 'Punning Works',
  'flat.gypsum_41': 'Gypsum Works',
  'flat.waterproofing_8': 'Waterproofing Works',
  'flat.toilet_utility_balcony_flooring_14': 'Toilet Flooring Works',
  'flat.toilet_utility_dado_15': 'Toilet Dado Works',
  'flat.vitrified_flooring_16': 'Vitrified Flooring Works',
  'flat.internal_door_frames_18': 'Internal Door Frames',
  'flat.core_door_shutters_temporary': 'Door Shutters',
  'flat.windows_43': 'Windows',
  'flat.railing_42': 'Railing',
  'flat.false_ceiling_boxing_24': 'False Ceiling Boxing',
  'flat.electrical_wiring_23': 'Electrical Wiring',
  'flat.putty_39': 'Putty',
  'flat.paint_40': 'Paint',
  'common.mep_works_fire_fighting_electrical_0': 'Service Lines',
  'common.wall_punning_works_1': 'Punning Works',
  'common.false_ceiling_works_2': 'False Ceiling Boxing',
  'common.putty_10': 'Putty',
  'common.paint_11': 'Paint',
};

/** Ids that are no longer scored. Kept so old snapshots and reviews still show a readable name. */
export const LEGACY_ACTIVITY_NAMES: Record<string, string> = {
  'flat.putty_1st_coat_25': 'Putty (1st coat, old)',
  'flat.putty_2nd_coat_26': 'Putty (2nd coat, old)',
  'flat.primer_1st_coat_paint_27': 'Primer and paint (old)',
  'common.putty_1st_coat_4': 'Putty (1st coat, old)',
  'common.putty_2nd_coat_5': 'Putty (2nd coat, old)',
  'common.primer_1st_coat_paint_6': 'Primer and paint (old)',
};

export const CORE_ACTIVITY_IDS: string[] = Object.keys(CORE_ACTIVITY_NAMES);

export function isLegacyActivityId(id: string): boolean {
  return id in LEGACY_ACTIVITY_NAMES;
}

/** Best name for an activity: the server's own name first, then the core or legacy table, then the raw id. */
export function activityDisplayName(id: string, serverName?: string | null): string {
  if (serverName && serverName.trim()) {
    // Old snapshots carry the old long names; show the current wording for the renamed one.
    if (serverName === 'Door Shutters (Temporary)') return 'Door Shutters';
    return serverName;
  }
  return CORE_ACTIVITY_NAMES[id] ?? LEGACY_ACTIVITY_NAMES[id] ?? id;
}
