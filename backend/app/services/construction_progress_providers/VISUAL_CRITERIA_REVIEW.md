# Visual criteria review (T5)

**Status: PENDING full site-engineer sign-off — do not treat as production ground truth.**

The strings in `visual_criteria.py` are DRAFT only. They are fed to the vision
model as the definition of each finishing activity. Incorrect criteria actively
teach wrong answers, which is worse than empty criteria.

## Floor 1 calibration pass (2026-08-11)

Source: My Home Apas · Tower 1 · Floor 1 · Flat 02 manual reviews
(`manual_review.json` — Bedroom-2 + Master Bedroom), prompt version bumped to
`v3-floor1-calibration`.

Activities tightened from human deltas:
- Over-scored near-done → Wall Punning, Putty 1st/2nd (prefer `mostly_complete`)
- Over-scored partial → Vitrified Flooring, Electrical Wiring, Window/SLD, FC Boxing
- Materials-not-fixed → Window glass leaning; empty gang box ≠ modular switches
- Under-scored early doors → Internal door frames / shutters (`early` when visible)

## v4 evidence engine (2026-08-11)

Prompt version: `v4-evidence-engine`. Reviews extracted to `manual_review_afterv4.json`
(11 reviews, pins 1–11).

Engine changes:
- Continuous `completion_pct` from direct observable scope (no arbitrary 50%)
- Precedence fill-forward **disabled**; block-backward + MEP door gate kept
- Multi-capture merge uses **min** (incompleteness wins), not max

## v4.1 false-ceiling strict ID (2026-08-11)

Prompt version: `v4.1-false-ceiling`.

Smooth / white / punned / plastered / painted / concrete ceilings must NOT be
scored as False Ceiling Framing or Boxing. Require visible GI/MS grid, hangers,
channels (framing) or installed gypsum/cement boards / boxing (boxing). Otherwise 0%.

## v4.2 stage-aware (2026-08-11)

Prompt version: `v4.2-stage-aware`. Calibration: `manual_review_afterv4.json` (11 pins).

Tightened: Wall Punning scope anchors; Putty 1st/2nd stage ID (white ≠ putty);
Electrical Wiring scope hierarchy; door frame≠enclosure / shutter≠presence;
combined Window/Utility/SLD component counting; Ceiling Punning not penalized for
MEP; evidence↔score reconcile (insufficiency admissions cap %; no-boards → boxing 0).

## v4.3 visual-scope (2026-08-11)

Prompt version: `v4.3-visual-scope`.

Core: activity-specific physical evidence → observable completed scope ratio
(not "room looks finished"). Internal `evidence_class` with hard zeros for
MATERIAL_PRESENT_ONLY / RELATED_INFRASTRUCTURE_ONLY / putty INSUFFICIENT_STAGE.
White/smooth alone → Putty 0%; wiring boxes≠high %; FC localized frame≠100%;
status "completed" only at 100%.

## Review checklist

- [ ] Every `flat.*` and `common.*` entry checked against site practice
- [x] Floor-1 Flat 02 problem activities rechecked against manual review reasons
- [ ] In-progress vs complete look is distinguishable on a photo
- [ ] "Where to look" matches the surface the capture actually shows
- [ ] Confusable pairs (putty 1↔2, primer↔final, normal↔deep clean) explicitly contrasted
- [ ] Concealed activities noted as often not visible after later finishes

## Sign-off

| Field | Value |
|-------|-------|
| Reviewed by | *(pending full sign-off)* |
| Reviewed on | *(pending)* |
| Notes | Floor-1 Flat 02 calibration applied 2026-08-11; remaining activities still DRAFT |

Until this table is filled with full sign-off, keep the module docstring and each criterion marked **DRAFT**.
