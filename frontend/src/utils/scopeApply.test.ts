import { describe, expect, it } from 'vitest';
import { APPLY_OPTIONS, applyOption, scopeSummaryText } from './scopeApply';

describe('APPLY_OPTIONS', () => {
  it('offers this floor, the tower and the project, in that order', () => {
    expect(APPLY_OPTIONS.map(o => o.value)).toEqual(['floor', 'tower', 'project']);
  });

  it('names what the analyse button will do for each choice', () => {
    expect(applyOption('floor').analyseLabel).toBe('Save and analyse this floor');
    expect(applyOption('tower').analyseLabel).toBe('Save and analyse this tower');
    expect(applyOption('project').analyseLabel).toBe('Save and analyse the project');
  });

  it('uses no em dashes in the text', () => {
    for (const o of APPLY_OPTIONS) expect(`${o.title}${o.help}${o.analyseLabel}`).not.toContain('—');
  });
});

describe('scopeSummaryText', () => {
  it('says all, or how many', () => {
    expect(scopeSummaryText(21, 21)).toBe('All 21 activities will be checked');
    expect(scopeSummaryText(14, 21)).toBe('14 of 21 activities will be checked');
  });

  it('is empty until the catalogue is known', () => {
    expect(scopeSummaryText(0, 0)).toBe('');
  });
});
