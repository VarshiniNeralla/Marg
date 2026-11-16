import { beforeEach, describe, expect, it, vi } from 'vitest';

// The network layer is not part of this test: placing a point only has to update the store and queue its change.
vi.mock('./writeQueue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./writeQueue')>()),
  enqueueWrite: vi.fn(),
  flushWriteQueue: vi.fn(),
}));

import { useWorkflowStore } from './workflowStore';

const place = (over: Record<string, unknown> = {}) => useWorkflowStore.getState().createCapturePin({
  floorPlanId: 'fp1', floorId: 'f1', towerId: 't1', projectId: 'p1', x: 40, y: 55,
  flatName: 'Flat 01', roomName: 'Living', label: 'Living', isPredefined: true, source: 'predefined', ...over,
} as never);

describe('placing and labelling capture points', () => {
  beforeEach(() => { useWorkflowStore.setState({ capturePins: [] } as never); });

  it('places a labelled point at exactly the spot that was tapped', () => {
    const id = place();
    const pin = useWorkflowStore.getState().capturePins.find(p => p.id === id)!;
    expect([pin.x, pin.y, pin.flatName, pin.roomName]).toEqual([40, 55, 'Flat 01', 'Living']);
    expect(pin.serverSeen).toBe(false);
  });

  it('never adds a second copy of the same labelled point at the same spot (double tap on Save)', () => {
    const a = place();
    const b = place();
    expect(b).toBe(a);
    expect(useWorkflowStore.getState().capturePins).toHaveLength(1);
  });

  it('still allows different rooms, different spots, and the same room elsewhere on the plan', () => {
    place();
    place({ roomName: 'Kitchen', label: 'Kitchen' });          // different room, same spot
    place({ x: 70, y: 20 });                                     // same room, different spot
    expect(useWorkflowStore.getState().capturePins).toHaveLength(3);
  });

  it('keeps points of different plans apart', () => {
    place();
    place({ floorPlanId: 'fp2', floorId: 'f2' });
    expect(useWorkflowStore.getState().capturePins).toHaveLength(2);
  });

  it('relabelling a point keeps its position and its photos', () => {
    const id = place();
    useWorkflowStore.setState(s => ({ capturePins: s.capturePins.map(p => (p.id === id ? { ...p, captureIds: ['c1', 'c2'] } : p)) }) as never);
    useWorkflowStore.getState().updateCapturePinLocal(id, { flatName: 'Flat 02', roomName: 'Bedroom', label: 'Bedroom' } as never);
    const pin = useWorkflowStore.getState().capturePins.find(p => p.id === id)!;
    expect([pin.x, pin.y, pin.flatName, pin.roomName, pin.captureIds]).toEqual([40, 55, 'Flat 02', 'Bedroom', ['c1', 'c2']]);
  });
});
