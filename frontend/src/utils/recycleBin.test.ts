import { describe, expect, it } from 'vitest';
import { FILTER_OPTIONS, SORT_OPTIONS, daysLeftLabel, emptyBinWarning, isExpiringSoon, rangeText } from './recycleBin';

describe('recycle bin wording', () => {
  it('counts days left in plain words', () => {
    expect(daysLeftLabel(30)).toBe('30 days left');
    expect(daysLeftLabel(1)).toBe('1 day left');
    expect(daysLeftLabel(0)).toBe('Deletes today');
  });

  it('flags items that are about to be removed', () => {
    expect(isExpiringSoon(3)).toBe(true);
    expect(isExpiringSoon(4)).toBe(false);
  });

  it('shows which rows are on screen', () => {
    expect(rangeText(1, 10, 34)).toBe('Showing 1-10 of 34');
    expect(rangeText(4, 10, 34)).toBe('Showing 31-34 of 34');
    expect(rangeText(1, 10, 0)).toBe('');
  });

  it('the empty-bin warning says how many items and that it cannot be undone', () => {
    expect(emptyBinWarning(1)).toContain('1 item ');
    expect(emptyBinWarning(12)).toContain('12 items');
    expect(emptyBinWarning(12)).toContain('not be able to restore');
  });

  it('offers every kind and every sort the server accepts', () => {
    expect(FILTER_OPTIONS.map(o => o.value)).toEqual(['all', 'project', 'floor_plan', 'tour', 'capture']);
    expect(SORT_OPTIONS.map(o => o.value)).toEqual(['newest', 'oldest', 'expiring', 'name', 'type']);
  });
});
