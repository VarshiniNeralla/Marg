import { shadows as s } from './tokens';

// MUI expects an array of 25 shadow strings (indices 0–24).
// We map our canonical scale to meaningful MUI elevation levels.
export const muiShadows: [
  "none", string, string, string, string,
  string, string, string, string, string,
  string, string, string, string, string,
  string, string, string, string, string,
  string, string, string, string, string,
] = [
  'none',    // 0 — flat
  s.sm,      // 1 — subtle lift (inputs, chips)
  s.sm,      // 2
  s.md,      // 3 — cards
  s.md,      // 4
  s.md,      // 5
  s.lg,      // 6 — floating panels
  s.lg,      // 7
  s.lg,      // 8
  s.xl,      // 9 — modals / dialogs
  s.xl,      // 10
  s.xl,      // 11
  s.xl,      // 12
  s.xl,      // 13
  s.xl,      // 14
  s.xl,      // 15
  s.xl,      // 16
  s.xl,      // 17
  s.xl,      // 18
  s.xl,      // 19
  s.xl,      // 20
  s.xl,      // 21
  s.xl,      // 22
  s.xl,      // 23
  s.xl,      // 24
];
