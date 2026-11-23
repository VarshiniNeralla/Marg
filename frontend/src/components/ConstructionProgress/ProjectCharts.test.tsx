import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ActivityChart, CoverageScatter, StatusSplit, TowerChart } from './ProjectCharts';

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

  it('empty states render a message, not a broken chart', () => {
    expect(renderToString(<CoverageScatter floors={[]} />)).toContain('No analysed floors yet');
    expect(renderToString(<TowerChart towers={[]} />)).toContain('No towers yet');
  });
});
