import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@mui/icons-material', () => {
  const Icon = () => null;
  return {
    ApartmentRounded: Icon, MeetingRoomRounded: Icon, RefreshRounded: Icon,
    NotificationsActiveRounded: Icon, PictureAsPdfRounded: Icon, TableChartRounded: Icon,
  };
});

import FloorActionToolbar from './FloorActionToolbar';

const noop = () => {};

function render(over: Partial<React.ComponentProps<typeof FloorActionToolbar>> = {}): string {
  return renderToString(
    <MemoryRouter>
      <FloorActionToolbar
        floorId="f1" analyzing={false} backgroundRunning={false}
        onPdf={noop} onExcel={noop} onReanalyze={noop} onRunInBackground={noop}
        {...over}
      />
    </MemoryRouter>,
  );
}

describe('FloorActionToolbar', () => {
  it('renders the three groups and all six actions', () => {
    const html = render();
    for (const t of ['View', 'Analysis', 'Reports', 'Flat Finishing Works', 'Common Area Finishing',
      'Re-analyze', 'Run in Background', 'PDF Report', 'Excel Report']) {
      expect(html).toContain(t);
    }
  });

  it('links to the flats and common pages of the floor', () => {
    const html = render();
    expect(html).toContain('href="/construction-progress/f1/flats"');
    expect(html).toContain('href="/construction-progress/f1/common"');
  });

  it('is enabled when idle', () => {
    expect(render()).not.toContain('disabled=""');
  });

  it('disables analysis buttons and shows progress labels while analyzing', () => {
    const html = render({ analyzing: true });
    expect(html).toContain('Re-analyzing…');
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it('shows the background label while a background run is active', () => {
    const html = render({ backgroundRunning: true });
    expect(html).toContain('Running in background…');
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});
