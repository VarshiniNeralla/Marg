import { describe, expect, it } from 'vitest';
import { summaryDetail } from './ExecutiveSummaryPanel';

describe('summaryDetail', () => {
  it('drops the repeated percentage and photo-count sentence but keeps the findings', () => {
    const s = 'Based on 261 analyzed image(s), this floor is approximately 21% complete across the full finishing checklist. '
      + 'Screed Works, Service Lines, Service Lines are in progress. 3 activities could not be confirmed from the available photos.';
    const out = summaryDetail(s);
    expect(out).not.toContain('21%');
    expect(out).not.toContain('261');
    expect(out).toBe('Screed Works, Service Lines, Service Lines are in progress. 3 activities could not be confirmed from the available photos.');
  });

  it('leaves any other wording untouched, and never returns an empty summary', () => {
    expect(summaryDetail('12 image(s) were analyzed but no finishing activities could be confidently identified yet.'))
      .toBe('12 image(s) were analyzed but no finishing activities could be confidently identified yet.');
    const only = 'Based on 5 analyzed image(s), this floor is approximately 0% complete across the full finishing checklist.';
    expect(summaryDetail(only)).toBe(only);
    expect(summaryDetail('')).toBe('');
  });
});
