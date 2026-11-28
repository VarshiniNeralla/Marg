import type { BinFilter, BinKind, BinSort } from '@/services/recycleBinService';

export const BIN_PAGE_SIZE = 10;

export const KIND_LABEL: Record<BinKind, string> = {
  project: 'Project',
  floor_plan: 'Floor plan',
  tour: 'Tour',
  capture: 'Capture',
};

export const FILTER_OPTIONS: { value: BinFilter; label: string }[] = [
  { value: 'all', label: 'All items' },
  { value: 'project', label: 'Projects' },
  { value: 'floor_plan', label: 'Floor plans' },
  { value: 'tour', label: 'Tours' },
  { value: 'capture', label: 'Captures' },
];

export const SORT_OPTIONS: { value: BinSort; label: string }[] = [
  { value: 'newest', label: 'Recently deleted' },
  { value: 'oldest', label: 'Oldest deleted' },
  { value: 'expiring', label: 'Deleting soonest' },
  { value: 'name', label: 'Name (A to Z)' },
  { value: 'type', label: 'Type' },
];

/** "30 days left", "1 day left", "Deletes today". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'Deletes today';
  return `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
}

/** Items about to be removed are flagged so nobody is surprised. */
export function isExpiringSoon(daysLeft: number): boolean {
  return daysLeft <= 3;
}

/** "Showing 11-20 of 34", or "" when there is nothing to show. */
export function rangeText(page: number, pageSize: number, total: number): string {
  if (total <= 0) return '';
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return `Showing ${from}-${to} of ${total}`;
}

/** The sentence in the "empty the bin" confirmation. */
export function emptyBinWarning(total: number): string {
  const what = total === 1 ? '1 item' : `${total} items`;
  return `This permanently deletes ${what} from the Recycle Bin, together with their photos and files. You will not be able to restore them.`;
}
