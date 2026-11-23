import { describe, expect, it } from 'vitest';
import { needsRerun, sameSet, scopeDiff, toggleId } from './scopeDiff';
import { activityDisplayName, CORE_ACTIVITY_IDS, isLegacyActivityId } from './activityNames';

const ALL = ['a', 'b', 'c'];

describe('scopeDiff', () => {
  it('treats a missing analysed list as everything', () => {
    expect(scopeDiff(ALL, undefined, ALL).changed).toBe(false);
    expect(scopeDiff(['a'], null, ALL)).toEqual({ added: [], removed: ['b', 'c'], changed: true });
  });
  it('finds added and removed ids', () => {
    expect(scopeDiff(['a', 'c', 'd'], ['a', 'b', 'c'], ALL)).toEqual({ added: ['d'], removed: ['b'], changed: true });
  });
  it('ignores order', () => {
    expect(scopeDiff(['c', 'b', 'a'], ['a', 'b', 'c'], ALL).changed).toBe(false);
  });
  it('asks for a rerun when the server flag or the diff says so', () => {
    const same = scopeDiff(ALL, ALL, ALL);
    expect(needsRerun(false, same)).toBe(false);
    expect(needsRerun(true, same)).toBe(true);
    expect(needsRerun(undefined, scopeDiff(['a'], ALL, ALL))).toBe(true);
  });
  it('toggles and compares sets', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('activity names', () => {
  it('has the new core ids with the right names', () => {
    expect(activityDisplayName('flat.putty_39')).toBe('Putty');
    expect(activityDisplayName('flat.paint_40')).toBe('Paint');
    expect(activityDisplayName('flat.gypsum_41')).toBe('Gypsum Works');
    expect(activityDisplayName('flat.railing_42')).toBe('Railing');
    expect(activityDisplayName('flat.windows_43')).toBe('Windows');
    expect(activityDisplayName('common.putty_10')).toBe('Putty');
    expect(activityDisplayName('common.paint_11')).toBe('Paint');
    expect(CORE_ACTIVITY_IDS).toHaveLength(21);
  });
  it('renames Door Shutters even from an old stored name', () => {
    expect(activityDisplayName('flat.core_door_shutters_temporary', 'Door Shutters (Temporary)')).toBe('Door Shutters');
  });
  it('keeps old ids readable and out of the core list', () => {
    expect(isLegacyActivityId('flat.putty_1st_coat_25')).toBe(true);
    expect(CORE_ACTIVITY_IDS).not.toContain('flat.putty_1st_coat_25');
    expect(activityDisplayName('common.primer_1st_coat_paint_6')).toBe('Primer and paint (old)');
    expect(activityDisplayName('unknown.id')).toBe('unknown.id');
  });
});
