/**
 * Floor naming for towers: basements, a ground floor, then Floor 1, 2, ...
 *
 * A floor's `number` is its position: basements are negative (-1 is the first level below ground),
 * the ground floor is 0, and the floors above are 1, 2, 3... The `label` is what people read.
 * "G+44" therefore means Ground Floor plus Floor 1 to Floor 44.
 */

export interface TowerLayout {
  /** Levels below ground. */
  basements: number;
  /** Whether the tower has a ground floor. */
  ground: boolean;
  /** Floors above the ground floor (the 44 in G+44). */
  above: number;
}

export const MAX_BASEMENTS = 10;
export const MAX_ABOVE = 200;

/** The label shown for a floor number: Basement 2, Ground Floor, Floor 7. */
export function floorLabel(n: number): string {
  if (n < 0) return `Basement ${-n}`;
  if (n === 0) return 'Ground Floor';
  return `Floor ${n}`;
}

const wholeNumber = (v: number, max: number): number =>
  Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;

/** Clean a layout typed into a form: whole numbers, within limits. */
export function normalizeLayout(l: TowerLayout): TowerLayout {
  return { basements: wholeNumber(l.basements, MAX_BASEMENTS), ground: Boolean(l.ground), above: wholeNumber(l.above, MAX_ABOVE) };
}

/** Every floor of a layout, lowest first: -B..-1, then 0 (if there is a ground floor), then 1..above. */
export function layoutFloors(layout: TowerLayout): { number: number; label: string }[] {
  const l = normalizeLayout(layout);
  const out: { number: number; label: string }[] = [];
  for (let n = -l.basements; n < 0; n++) out.push({ number: n, label: floorLabel(n) });
  if (l.ground) out.push({ number: 0, label: floorLabel(0) });
  for (let n = 1; n <= l.above; n++) out.push({ number: n, label: floorLabel(n) });
  return out;
}

/** Site shorthand for a layout, such as "G+44" or "2B+G+30". */
export function layoutSummary(layout: TowerLayout): string {
  const l = normalizeLayout(layout);
  const parts: string[] = [];
  if (l.basements > 0) parts.push(`${l.basements}B`);
  if (l.ground) parts.push('G');
  if (l.above > 0) parts.push(String(l.above));
  return parts.join('+');
}

/**
 * Sort position of a floor from its label, for lists that only have the name:
 * Basement 2 < Basement 1 < Ground Floor < Floor 1 < Floor 2. Names it cannot read go last.
 */
export function floorRank(label: string | null | undefined): number {
  const s = (label ?? '').trim().toLowerCase();
  if (!s) return Number.MAX_SAFE_INTEGER;
  if (/^(g|gf|ground)\b/.test(s)) return 0;
  const base = /^(basement|b)\s*-?(\d+)?$/.exec(s);
  if (base) return -(base[2] ? Number(base[2]) : 1);
  const num = /(\d+)/.exec(s);
  return num ? Number(num[1]) : Number.MAX_SAFE_INTEGER;
}
