import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { RoomProgress } from '@/services/constructionProgressService';

vi.mock('@mui/icons-material', () => {
  const Icon = () => null;
  return {
    ExpandMoreRounded: Icon, PushPinRounded: Icon, BedroomParentRounded: Icon, KitchenRounded: Icon, WcRounded: Icon,
    BalconyRounded: Icon, WeekendRounded: Icon, DoorFrontRounded: Icon, Inventory2Rounded: Icon, CheckroomRounded: Icon,
    SelfImprovementRounded: Icon, DeckRounded: Icon, LocalLaundryServiceRounded: Icon, HomeRounded: Icon,
    TableRestaurantRounded: Icon, ElectricalServicesRounded: Icon, PhotoLibraryRounded: Icon,
  };
});

import RoomProgressCard from './RoomProgressCard';

const room: RoomProgress = {
  roomName: 'Kitchen', isComplete: false, activities: [], pinNumbers: [3, 4], capturesCount: 2,
  progressPct: 30, coveragePct: 85, observedActivities: 12, applicableActivities: 14, scopeStatus: 'in_progress',
  lastInspection: '2026-11-10T08:30:00Z',
};

describe('RoomProgressCard', () => {
  it('shows status, verified percentage, coverage chip, pins and the not-observed line', () => {
    const html = renderToString(<RoomProgressCard room={room} onOpenEvidence={() => {}} />).replace(/<!-- -->/g, '');
    expect(html).toContain('Work in progress');
    expect(html).toContain('30%');
    expect(html).toContain('12 of 14 activities observed');
    expect(html).toContain('Pins 3, 4');
    expect(html).toContain('Activities not observed: 2');
    expect(html).toContain('Last inspection');
  });

  it('does not invent a percentage for an old snapshot', () => {
    const html = renderToString(
      <RoomProgressCard room={{ roomName: 'Hall', isComplete: false, activities: [] }} onOpenEvidence={() => {}} />,
    );
    expect(html).not.toContain('0%');
    expect(html).toContain('No photos');
  });
});
