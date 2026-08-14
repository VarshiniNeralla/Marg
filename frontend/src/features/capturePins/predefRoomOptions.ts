/** Shared flat/room options for predefined capture-point annotation. */
export const PREDEF_FLAT_OPTIONS = [
  'Flat 01',
  'Flat 02',
  'Flat 03',
  'Flat 04',
  'Common Area',
] as const;

export const PREDEF_ROOM_OTHER = 'Others';

export const PREDEF_ROOM_OPTIONS_FLAT = [
  // Bedroom → Dress → Toilet sequence
  'Master Bedroom',
  'Dress (Master Bedroom)',
  'M. Toilet',
  'Bedroom-2',
  'Dress (Bedroom-2)',
  'Toilet-1',
  'Bedroom-3',
  'Dress (Bedroom-3)',
  'Toilet-2',
  'Bedroom-4',
  'Dress (Bedroom-4)',
  'Toilet-3',
  'Toilet-4',
  // Remaining spaces
  'Drawing',
  'Living / Dining',
  'Kitchen',
  'Utility',
  'Maid-01',
  'Maid-02',
  'Maid-03',
  'Maid-04',
  'Maid - Toilet',
  'Puja',
  'Store',
  'Sit Out',
  'Sit Out-1',
  'Sit Out-2',
  'Balcony',
  'Multi-Purpose',
  'PDR',
  'Handwash',
  'Dress',
  PREDEF_ROOM_OTHER,
] as const;

export const PREDEF_ROOM_OPTIONS_COMMON = [
  'Corridor',
  'Entrance Lobby',
  'Fire Lift',
  'Fire Shaft',
  'Lift Lobby',
  'Lobby',
  'Passage',
  'Service Lift',
  'Shaft',
  'Staircase',
  PREDEF_ROOM_OTHER,
] as const;

export function roomOptionsForFlat(flatName: string): string[] {
  if (flatName === 'Common Area') return [...PREDEF_ROOM_OPTIONS_COMMON];
  return [...PREDEF_ROOM_OPTIONS_FLAT];
}

/** True when the stored room is a custom “Others” value (not in the roster). */
export function isCustomRoomName(flatName: string, roomName: string): boolean {
  const options = roomOptionsForFlat(flatName).filter(r => r !== PREDEF_ROOM_OTHER);
  return Boolean(roomName) && !options.includes(roomName);
}
