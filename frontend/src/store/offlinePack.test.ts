import { describe, expect, it } from 'vitest';
import {
  floorStatus, keysToDownload, leavingCoverageWarnings, mediaKey, orphanKeys, planMediaKeys, savedFileName, shortHash,
  summariseTowers, type PlanLike,
} from './offlinePack';

const plan = (id: string, floorId: string, fileUrl: string | null, rawPdfUrl?: string): PlanLike => ({ id, floorId, towerId: 't1', fileUrl, rawPdfUrl });

describe('mediaKey', () => {
  it('ignores the server name and the login token, so the saved copy is found whatever token is held', () => {
    const a = mediaKey('https://sitevision.sitesurelabs.com/media/floorplans/abc.png?access_token=AAA');
    const b = mediaKey('/media/floorplans/abc.png?access_token=BBB');
    const c = mediaKey('https://other.host/media/floorplans/abc.png');
    expect(a).toBe('/media/floorplans/abc.png');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('keeps other query parameters (they can change which file is meant)', () => {
    expect(mediaKey('/media/x.pdf?v=2&access_token=T')).toBe('/media/x.pdf?v=2');
  });

  it('only the app\'s own media can be saved', () => {
    expect(mediaKey('https://res.cloudinary.com/demo/image/upload/plan.png')).toBeNull();
    expect(mediaKey('')).toBeNull();
    expect(mediaKey(null)).toBeNull();
    expect(mediaKey(undefined)).toBeNull();
  });
});

describe('planMediaKeys / floorStatus', () => {
  it('a plan needs its image and its pdf', () => {
    expect(planMediaKeys(plan('p', 'f', '/media/a.png', '/media/a.pdf'))).toEqual(['/media/a.png', '/media/a.pdf']);
  });

  it('is available only when every needed file is saved', () => {
    const p = plan('p', 'f', '/media/a.png', '/media/a.pdf');
    expect(floorStatus(p, new Set(['/media/a.png']))).toBe('needs-download');
    expect(floorStatus(p, new Set(['/media/a.png', '/media/a.pdf']))).toBe('available');
    expect(floorStatus(p, new Set())).toBe('needs-download');
  });

  it('no plan, or a plan hosted elsewhere, is reported honestly', () => {
    expect(floorStatus(undefined, new Set())).toBe('no-plan');
    expect(floorStatus(plan('p', 'f', 'https://res.cloudinary.com/x/plan.png'), new Set())).toBe('unsupported');
    expect(floorStatus(plan('p', 'f', null), new Set())).toBe('no-plan');
  });

  it('reads the image from mediaAssets when fileUrl is absent', () => {
    const p: PlanLike = { id: 'p', floorId: 'f', mediaAssets: [{ original_url: '/media/z.png' }] };
    expect(planMediaKeys(p)).toEqual(['/media/z.png']);
  });
});

describe('tower summaries and the leaving-coverage warning', () => {
  const towers = [{ id: 't1', name: 'Tower A' }, { id: 't2', name: 'Tower B' }];
  const floors = [
    { id: 'f1', towerId: 't1' }, { id: 'f2', towerId: 't1' },
    { id: 'g1', towerId: 't2' }, { id: 'g2', towerId: 't2' }, { id: 'g3', towerId: 't2' }, { id: 'g4', towerId: 't2' },
  ];
  const plans: Record<string, PlanLike> = {
    f1: plan('p1', 'f1', '/media/1.png'),
    f2: plan('p2', 'f2', '/media/2.png'),
    g1: plan('p3', 'g1', '/media/3.png'),
    g2: plan('p4', 'g2', '/media/4.png'),
    g3: plan('p5', 'g3', '/media/5.png'),
    // g4 has no plan: ignored
  };
  const saved = new Set(['/media/1.png', '/media/2.png']);
  const sums = summariseTowers(towers, floors, id => plans[id], saved);

  it('counts floors with a plan per tower', () => {
    expect(sums).toEqual([
      { towerId: 't1', towerName: 'Tower A', floors: 2, available: 2, needsDownload: 0 },
      { towerId: 't2', towerName: 'Tower B', floors: 3, available: 0, needsDownload: 3 },
    ]);
  });

  it('warns in the plan\'s own words, only for towers that need it', () => {
    expect(leavingCoverageWarnings(sums)).toEqual(['3 floors in Tower B are not downloaded']);
    expect(leavingCoverageWarnings([{ towerId: 't', towerName: 'Tower C', floors: 1, available: 0, needsDownload: 1 }])).toEqual(['1 floor in Tower C is not downloaded']);
    expect(leavingCoverageWarnings([sums[0]])).toEqual([]);
  });
});

describe('keysToDownload / orphanKeys', () => {
  it('floors sharing one plan image download it once', () => {
    const shared = plan('p', 'x', '/media/shared.png');
    const keys = keysToDownload(['f1', 'f2', 'f3'], () => shared, new Set());
    expect(keys).toEqual(['/media/shared.png']);
  });

  it('skips what is already saved', () => {
    const keys = keysToDownload(['f1'], () => plan('p', 'f1', '/media/a.png', '/media/a.pdf'), new Set(['/media/a.png']));
    expect(keys).toEqual(['/media/a.pdf']);
  });

  it('a replaced plan leaves its old file as an orphan to clean up', () => {
    expect(orphanKeys(['/media/old.png', '/media/new.png'], new Set(['/media/new.png']))).toEqual(['/media/old.png']);
  });
});

describe('saved file names', () => {
  it('keep the extension so the viewer can tell pdf from image', () => {
    expect(savedFileName('/media/floorplans/abc.PDF?v=1', 'h')).toBe('h.pdf');
    expect(savedFileName('/media/floorplans/abc.png', 'h')).toBe('h.png');
    expect(savedFileName('/media/floorplans/noext', 'h')).toBe('h');
  });

  it('the hash is stable and differs for different keys', () => {
    expect(shortHash('/media/a.png')).toBe(shortHash('/media/a.png'));
    expect(shortHash('/media/a.png')).not.toBe(shortHash('/media/b.png'));
  });
});

describe('looksLikePlanFile', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it('accepts PNG, JPEG, PDF and WebP', async () => {
    const { looksLikePlanFile } = await import('./offlinePack');
    expect(looksLikePlanFile(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0))).toBe(true);
    expect(looksLikePlanFile(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(looksLikePlanFile(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(true);
    expect(looksLikePlanFile(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe(true);
  });
  it('rejects an HTML error page or an empty file', async () => {
    const { looksLikePlanFile } = await import('./offlinePack');
    expect(looksLikePlanFile(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(false);
    expect(looksLikePlanFile(new Uint8Array(0))).toBe(false);
  });
});
