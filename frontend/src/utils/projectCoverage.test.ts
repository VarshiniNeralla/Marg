import { describe, expect, it } from 'vitest';
import { computeProjectCoverage } from './projectCoverage';

const pin = (floorId: string, captured: boolean) => ({ floorId, captureIds: captured ? ['c1'] : [] });

describe('computeProjectCoverage', () => {
  it('averages every floor, not every pin', () => {
    // floor A: 1 of 1 captured (100%); floor B: 1 of 10 (10%); floor C: no pins (0%).
    const pins = [pin('A', true), pin('B', true), ...Array.from({ length: 9 }, () => pin('B', false))];
    const r = computeProjectCoverage(['A', 'B', 'C'], pins);
    expect(r.score).toBe(37);              // (100 + 10 + 0) / 3, not 2 captured / 11 pins = 18%
    expect(r.floors).toBe(3);
    expect(r.startedFloors).toBe(2);
  });

  it('counts floors without a floor plan or capture points as 0%', () => {
    expect(computeProjectCoverage(['A', 'B'], [pin('A', true)]).score).toBe(50);
  });

  it('is 0 for a project with no floors or nothing captured', () => {
    expect(computeProjectCoverage([], []).score).toBe(0);
    expect(computeProjectCoverage(['A'], [pin('A', false)]).score).toBe(0);
  });

  it('ignores pins of floors outside the project', () => {
    expect(computeProjectCoverage(['A'], [pin('A', true), pin('Z', false)]).score).toBe(100);
  });
});
