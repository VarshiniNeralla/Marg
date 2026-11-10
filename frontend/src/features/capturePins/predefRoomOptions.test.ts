import { describe, expect, it } from 'vitest';
import { PREDEF_FLAT_OPTIONS, flatOptionsForProject, roomOptionsForFlat } from './predefRoomOptions';

describe('flatOptionsForProject', () => {
  it('keeps the standard 4 flats + Common Area for every other project', () => {
    for (const name of ['My Home Udyan', 'My Home Grava', 'Project A', '', undefined, null]) {
      expect(flatOptionsForProject(name)).toEqual([...PREDEF_FLAT_OPTIONS]);
    }
  });

  it('gives My Home Vipina 10 flats then Common Area', () => {
    const opts = flatOptionsForProject('My Home Vipina');
    expect(opts).toEqual([
      'Flat 01', 'Flat 02', 'Flat 03', 'Flat 04', 'Flat 05',
      'Flat 06', 'Flat 07', 'Flat 08', 'Flat 09', 'Flat 10', 'Common Area',
    ]);
    expect(flatOptionsForProject('my home vipina  ')).toEqual(opts);   // case/spacing tolerant
  });

  it('every Vipina flat offers the normal flat room list and Common Area keeps its own', () => {
    expect(roomOptionsForFlat('Flat 10')).toEqual(roomOptionsForFlat('Flat 01'));
    expect(roomOptionsForFlat('Common Area')).not.toEqual(roomOptionsForFlat('Flat 01'));
  });
});
