import type { ScopeApplyTo } from '@/services/constructionProgressService';

export interface ApplyOption {
  value: ScopeApplyTo;
  title: string;
  /** One plain line on what happens when the user picks it. */
  help: string;
  /** Text of the "save and analyse" button for this choice. */
  analyseLabel: string;
}

/** Where a chosen activity list applies, and what "Save and analyse" will then do. Order = order on screen. */
export const APPLY_OPTIONS: ApplyOption[] = [
  {
    value: 'floor',
    title: 'This floor',
    help: 'The list is saved for this floor and this floor is analysed.',
    analyseLabel: 'Save and analyse this floor',
  },
  {
    value: 'tower',
    title: 'All floors in this tower',
    help: 'The list is saved for every floor in this tower and every floor with photos is analysed.',
    analyseLabel: 'Save and analyse this tower',
  },
  {
    value: 'project',
    title: 'The entire project',
    help: 'The list is saved for every floor in the project and every floor with photos is analysed.',
    analyseLabel: 'Save and analyse the project',
  },
];

export function applyOption(value: ScopeApplyTo): ApplyOption {
  return APPLY_OPTIONS.find(o => o.value === value) ?? APPLY_OPTIONS[0];
}

/** Short text for the empty floor screen: how many activities the next analysis will check. */
export function scopeSummaryText(selected: number, total: number): string {
  if (total <= 0) return '';
  if (selected >= total) return `All ${total} activities will be checked`;
  return `${selected} of ${total} activities will be checked`;
}
