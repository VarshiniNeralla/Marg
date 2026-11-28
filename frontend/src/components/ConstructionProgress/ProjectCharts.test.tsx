import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ActivityChart, CoverageScatter, ProgressCoverageChart, StatusSplit, TowerChart } from './ProjectCharts';

describe('ProjectCharts', () => {
  it('tower chart shows each tower with a rounded percent', () => {
    const html = renderToString(
      <TowerChart towers={[{ towerId: 't1', towerName: 'Tower A', floors: 5, progressPct: 42.4, completed: 1, inProgress: 2, notStarted: 1, noPhotos: 1 }]} />,
    );
    expect(html).toContain('Tower A');
    expect(html).toContain('42%');
  });

  it('activity chart uses the new core names and the renamed door shutters', () => {
    const html = renderToString(
      <ActivityChart activities={[
        { activityId: 'flat.putty_39', name: 'Putty', progressPct: 30, floorsObserved: 4 },
        { activityId: 'flat.core_door_shutters_temporary', name: 'Door Shutters (Temporary)', progressPct: 10, floorsObserved: 2 },
      ]} />,
    );
    expect(html).toContain('Putty');
    expect(html).toContain('Door Shutters');
    expect(html).not.toContain('(Temporary)');
  });

  it('status split lists all four counts', () => {
    const html = renderToString(
      <StatusSplit totals={{ floors: 10, analysed: 6, completed: 2, inProgress: 3, notStarted: 1, noPhotos: 4, progressPct: 30 }} />,
    );
    for (const t of ['Completed', 'In progress', 'Not started', 'No photos']) expect(html).toContain(t);
  });

  it('progress and coverage chart labels both bars of each analysed floor and skips unanalysed ones', () => {
    const floor = (floorId: string, floorName: string, status: 'in_progress' | 'no_photos', progressPct: number, coveragePct: number) =>
      ({ floorId, floorName, towerId: 't', towerName: 'T1', status, progressPct, coveragePct });
    const html = renderToString(
      <ProgressCoverageChart floors={[floor('1', 'Floor 2', 'in_progress', 21.6, 30.2), floor('2', 'Floor 9', 'no_photos', 0, 0)]} />,
    );
    expect(html).toContain('Progress (work done)');
    expect(html).toContain('Coverage (rooms photographed)');
    expect(html).toContain('Floor 2');
    expect(html).toContain('>22<');
    expect(html).toContain('>30<');
    expect(html).not.toContain('Floor 9');
    expect(renderToString(<ProgressCoverageChart floors={[]} />)).toContain('No analysed floors yet');
  });

  it('empty states render a message, not a broken chart', () => {
    expect(renderToString(<CoverageScatter floors={[]} />)).toContain('No analysed floors yet');
    expect(renderToString(<TowerChart towers={[]} />)).toContain('No towers yet');
  });
});
