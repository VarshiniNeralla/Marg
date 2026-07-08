# Automatic Room Extraction from Floor Plans — Design Study

**Status:** architecture investigation (no implementation)
**Date:** 2026-07-07
**Input reality:** dense, **colored, multi-layer CAD renders** (walls in multiple colors/thicknesses, heavy dimension lines, furniture, hatching, text, title blocks) — flattened PNG/PDF-rendered, **not vector CAD**.
**Goal:** resolve a capture pin's (x,y) to the correct room (and, when confidently readable, flat), on **arbitrary** architectural layouts, **without manual labeling**, precision > recall.

---

## 0. Why this study exists

Prior attempts extracted rooms by treating the plan as **pixel regions** and failed, all for the *same* root cause — the walls, once rasterized, are thin, of varying thickness, and **not watertight** (doorway/corner gaps), so any region method leaks or fragments:

| Attempt | Result | Root cause |
|---|---|---|
| Naive flood-fill from seed | Filled 97% of plan | Doorway gaps → one connected space |
| Watershed from LLM seeds | Open-plan rooms leaked | Same; seeds also unreliable |
| Free-space connected components | 1 blob (97.5%) | Non-watertight walls |
| Thick-wall masking + CC | 1 region (96–100%), 4 flats in 1 region | Morphology destroys thin walls; still not watertight |

**The correction that motivated this study:** those are all one family (pixel-region segmentation). They do **not** disprove the **wall-graph reconstruction** family, which is how professional/academic parsers actually work: detect wall *lines*, build a *graph*, close door gaps, extract graph *faces* as rooms.

---

## 1. Decisive new evidence (measured on the actual plans)

I ran the two core wall-line detectors on the real renders (`fp72964.png` 6677×6718, `fp72552.png` 2499×3037):

| Detector | fp72964 | fp72552 | What the overlay shows |
|---|---|---|---|
| **LSD** (`cv2.createLineSegmentDetector`) | 4170 segs, **445 wall-length** | 5174 segs, **859 wall-length** | Traces the **real** perimeter, core, and partition walls — plus dimension/furniture lines |
| **Probabilistic Hough** (`HoughLinesP`) | **217 wall-length** | **462 wall-length** | Outlines most room boundaries on the cleaner render |

**This is the pivotal finding:** line-based detection **recovers the wall geometry that pixel-region methods destroyed**, because it detects lines by gradient continuity and tolerates thin/varied strokes. The wall-graph family is **not dead on arrival on these plans** — it has real signal to work with.

**The remaining hard problems (also visible in the overlays):**
1. **Noise:** LSD/Hough also fire on dimension lines, dimension ticks, furniture edges, text underlines, hatching → the segment set must be **filtered to walls**.
2. **Closure:** rooms become closed loops only if **doorway gaps are bridged** and junctions are snapped — this is the make-or-break step.

---

## 2. Technique-by-technique assessment

Robustness legend: **Graceful** = degrades but usable with tuning/pre-filtering · **Fragile** = works clean, breaks on our input · **Hard-fail** = breaks *silently/catastrophically* on non-watertight input.

| # | Technique | Works on our raster CAD? | Library | Impl. complexity | Robustness | Topology-independent? | Removes flat-# OCR dep? | Scales to any layout? |
|---|---|---|---|---|---|---|---|---|
| 1 | Probabilistic Hough (`HoughLinesP`) | Detects lines but votes on **disconnected** clutter → false peaks | OpenCV core | Low call / Med post | **Fragile** | Yes | N/A (primitive) | Yes |
| 2 | **LSD / Fast Line Detector** | **Yes** — self-validates false alarms (a-contrario); best primitive here | OpenCV ≥4.5.4 core; FLD in contrib | Low | **Graceful** | Yes | N/A | Yes |
| 3 | Skeleton / medial axis (+`skan`) | Yes for centerline+thickness; **spurious spurs** on jagged/hatched edges | scikit-image + `skan` | Low call / Med prune | **Graceful-noisy** | Yes | N/A | Yes |
| 4 | Wall-graph construction | Only as good as segments; **snapping tolerance delicate** | Shapely `unary_union`→node, NetworkX | Moderate | **Fragile** | Yes | N/A | Yes |
| 5 | Junction detection (graph-degree, not Harris) | Graph-degree robust; Harris drowns in furniture/text corners | NetworkX degree / `cv2.cornerHarris` | Low–Med | **Graceful** (graph) / Fragile (Harris) | Yes | N/A | Yes |
| 6 | Door detection (arcs/symbols) | **Hard** — furniture/text → arc/symbol false positives | `HoughCircles`, template match, ORB | Moderate (much tuning) | **Fragile** | Yes | N/A | Partly |
| 7 | **Doorway closing / gap bridging** | **Decides success.** Morphology over-merges; directional bridging works | morphology (bad) / `skan`+Hungarian (good) | Morph Low / Directional High | Morph **Fragile** / Directional **Graceful** | Yes | N/A | Yes |
| 8 | Polygon extraction (faces=rooms) | `polygonize` **silently drops** a room per open gap; MCB wrong semantics | `shapely.ops.polygonize(_full)`; NetworkX planar faces | Low (polygonize) | **Hard-fail if not watertight** | Yes | N/A | Yes |
| 9 | Region growing constrained by wall graph | **Leaks** through any open door (the failure we already hit) | `skimage`/`cv2` flood, watershed+EDT | Low–Med | **Hard-fail if not watertight** | Yes | N/A | Yes |

**Reading the table:** the *detection* end (2,3) is **graceful** on our input — this is genuinely new and positive. The *closure* step (7) is the fulcrum. The *extraction* end (8,9) is **hard-fail unless closure is near-perfect** — and it fails *silently* (`shapely.polygonize` returns an empty collection for a non-closing ring; a single missing doorway makes that room vanish with no error). Steps 8/9 are the graph-form restatement of exactly why our watershed/flood attempts failed.

**Whole wall-graph pipeline vs the 7 criteria:**
- **Topology-independent:** ✅ Yes — faces of a wall graph are rooms regardless of 1/2/4/N-flat layout, corridor vs core, portrait/landscape.
- **Removes flat-number OCR dependency:** ✅ Yes — rooms come from geometry; flat numbers are optional labels attached afterward (via the strict "complete FLAT symbol" detector already built), else "Apartment_X".
- **Scales to any layout:** ✅ In principle — no quadrant/core assumptions.
- **Works on our messy colored CAD:** ⚠️ **Conditional** — only if (a) walls are separated from annotation/furniture linework, and (b) door gaps are bridged before face extraction. Both are substantial engineering; neither is turnkey; both are **style-sensitive** (the literature is unanimous that classical parsers need per-style tuning).

---

## 3. The critical sub-findings (from cited research)

- **LSD licensing** (often confused with SIFT/SURF patents): it was a **license** conflict (reference impl is AGPL-3.0), not a patent. LSD was **removed in OpenCV 3.4.6–3.4.15 and 4.1.0–4.5.3**, **restored ≥3.4.16 / ≥4.5.4**. Our installed **cv2 5.0 has working LSD** (verified). Fallback: Fast Line Detector (contrib) or EDLines.
- **`shapely.ops.polygonize` fails silently** on non-closed rings ("results in an empty GeometryCollection"). Use **`polygonize_full`** and inspect **dangles** — dangle clusters pointing at each other **localize the exact doorway gaps** to bridge. This is a usable QA signal.
- **`networkx.minimum_cycle_basis` is the wrong tool** for room faces — it returns a topological cycle basis (can enclose two rooms), not planar faces, and is expensive (O(m²n)). Use `polygonize` after noding, or DCEL half-edge face tracing.
- **Morphological closing cannot bridge doorways safely** — one global kernel radius can't both span a wide doorway and preserve thin walls / avoid merging adjacent rooms. **Directional endpoint-bridging** (connect endpoint pairs that are both close *and* have intersecting/colinear rays, solved as Hungarian assignment) bridges a real doorway without fusing parallel walls. This is the robust classical fix — and it's the piece missing from every failed attempt so far.
- **Junction-first optimizer** (how Liu 2017 / CubiCasa actually work) sidesteps gap-closing entirely by predicting typed junctions and assembling primitives under topological constraints — but that's the ML route.

---

## 4. Wall-graph (classical) vs ML vs Manual

| Dimension | **Classical wall-graph** (LSD → graph → directional gap-close → polygonize) | **CubiCasa5K** (reuse pretrained) | **Raster-to-vector ML** (Liu R2V / DeepFloorplan) | **Manual room mapping** |
|---|---|---|---|---|
| Accepts our raster CAD input | ✅ (with color/layer pre-separation) | ✅ RGB raster | ✅ raster | ✅ |
| Turnkey (pretrained/no training) | ✅ no training, but heavy bespoke code | ⚠️ weights exist, old stack | ⚠️ weights exist, older stacks | ✅ |
| Reported accuracy on **clean** data | style-dependent; classical benches ~95% CVC-FP / drop OOD | rooms **mIoU 57.5%**, icons 55.7% | R2V ~90% P/R; DeepFloorplan ~89% pixel (paper) | 100% (human) |
| Expected accuracy on **our colored CAD** | Unknown; **no system validated on colored multi-layer CAD**; OOD | **Degrades** (Finnish real-estate; colored = 276/5000 train) | **Degrades** (single clean style; "unsatisfactory on non-rectangular") | 100% |
| Topology-independent | ✅ | ✅ | ✅ | ✅ |
| Removes flat-# OCR dependency | ✅ | ✅ (predicts rooms) | ✅ | ✅ |
| Scales to arbitrary layouts | ✅ in principle | ⚠️ within trained distribution | ⚠️ within trained distribution | ✅ |
| **License (commercial use)** | ✅ all deps permissive (OpenCV/Shapely/NetworkX/skimage) | ❌ **CC BY-NC 4.0** — non-commercial | ❌ DeepFloorplan **GPL-3.0**; ✅ Liu R2V MIT | ✅ |
| Stack / deps weight | light (no torch) | PyTorch 1.0/Py3.6, ResNet-152 | TF1.10/Py2.7 (DeepFloorplan) or Torch7 (R2V) | none |
| Modern SOTA (HEAT/RoomFormer/…) | — | — | ❌ **wrong input** (point-cloud density maps, not images) | — |
| Effort to production | **High** (bespoke, style-tuned) | Medium (env port) + **license blocker** | Medium + license/stack friction | **Low** build, **high** per-plan human cost |
| Failure mode | silent room-drop if gap-close imperfect (QA-able via dangles) | OOD mispredictions | OOD mispredictions | none (but doesn't scale to volume) |

**Key ML reality:** there is **no turnkey ML** for this exact input. The only image-input models (CubiCasa, DeepFloorplan) are license-encumbered for commercial use, on old stacks, modest even on clean data, and documented to degrade on complex/out-of-distribution drawings — and our dense colored CAD *is* the OOD case. The modern SOTA transformers take **point-cloud density maps, not floor-plan images**, so they don't apply at all. Using ML well here means **fine-tuning on our own labeled CAD corpus**, not dropping in weights.

---

## 5. Recommendation

### The highest-leverage lever is the front-end nobody else had: color/layer separation

Every surveyed system — classical *and* ML — was built for **clean, single-style, flattened line-drawings** and degrades on colored multi-layer CAD for the *same* reason. But our input has something those systems didn't: **exploitable color/thickness/layer structure**. Walls, dimension lines, furniture, hatching, and text are often on distinct colors/weights in these renders. **Isolating the wall linework by color/thickness *before* any detection is the single highest-value step**, and it's precisely what turns the "conditional" wall-graph pipeline into a viable one — because it directly attacks noise (criterion 1) and makes gap-closing (criterion 7) tractable.

### Recommended architecture (production, no manual labeling)

**Primary: a classical wall-graph pipeline with a CAD-aware front-end**, in this order:

1. **Color/layer/thickness separation** → produce a clean wall-only mask (biggest lever; unique to our input; permissively licensed).
2. **LSD** (cv2 ≥ 4.5.4; we have 5.0) for wall-line primitives; merge collinear fragments, dedupe double-detected thick-wall edges. *(Skeleton+`skan` as an alternative when thickness varies wildly.)*
3. **Wall graph** via Shapely `unary_union` (noding) → NetworkX; junctions from node degree.
4. **Directional doorway gap-closing** (endpoint pairs close *and* colinear/facing → Hungarian assignment); place bridges where door detection gives evidence. **Never blind morphological closing.**
5. **Room faces** via `shapely.ops.polygonize`; use **`polygonize_full` dangles as automated QA** to flag unclosed rooms.
6. **OCR label assignment** (Step already validated: OCR reads room names verbatim at conf 0.96–1.0) → assign each label to the containing room polygon.
7. **Optional flat number** via the **strict complete-FLAT-symbol detector** (already built: reads the stacked "0X FLAT" arrow or returns unknown — zero false positives); else keep `Apartment_X`.
8. **Pin resolution:** exact point-in-polygon (room → its apartment); no room → Common Area or Pin N. Precision > recall throughout.

**Why this over ML:** it's the only path that is (a) commercially licensable end-to-end, (b) light-weight (no torch/TF), (c) topology-independent and flat-number-independent by construction, and (d) supported by the decisive evidence that LSD/Hough recover real walls on *these* plans. It is **high-effort and style-sensitive** — that is the honest cost.

### Guardrail / exit criterion (this is the part to respect)

The pipeline's viability hinges entirely on **Step 1 producing a clean, near-watertight wall layer**. Therefore, **build and validate Step 1 first, in isolation**, on a representative set (single-flat, multi-flat, portrait, landscape, colored, full-title-block). Decision gate:

- **If color/layer separation yields a clean wall mask** → proceed with the classical pipeline; it is the strongest production option.
- **If walls cannot be cleanly isolated** (color conventions inconsistent across the plan set) → **no downstream classical method will recover rooms reliably**, and the realistic path becomes **fine-tuning an ML model (CubiCasa-style architecture, MIT-licensed R2V backbone) on our own annotated CAD** — a data-collection + training project, not a drop-in.

**Fallback for coverage, not correctness:** wherever the automatic pipeline's QA (dangles / low OCR confidence / unresolved pin) signals uncertainty, **return Unknown** and optionally expose a lightweight manual room-mapping tool for those specific plans. Manual is 100% reliable but doesn't scale to volume, so it belongs as an uncertainty fallback, not the primary path.

### One-line recommendation

**Build the CAD-aware classical wall-graph pipeline, but gate the whole effort on a first, isolated proof that color/layer separation yields a clean wall mask on representative plans — that single result determines whether the strongest option is classical (light, licensable, topology-free) or a self-trained ML model (if the walls can't be cleanly isolated).**

---

## 5b. POC RESULT (2026-07-07) — geometry pipeline gated on Stage 1, which FAILED

Built the scoped geometry POC (color/line filter → LSD → merge → directional gap-close → wall graph → `polygonize_full` → overlay) and ran it on 3 real layouts (fp72964 square, fp72552 portrait, fp72311 full-title-block).

**Result: 0 room-sized polygons on all 3 plans.** The failure localizes precisely to **Stage 1 (wall isolation)** — and it invalidates the "color/layer separation is the high-leverage front-end" hypothesis from §5, in an informative way:

**Why Stage 1 failed (diagnosed against pixels, not guessed):** the §5 recommendation assumed walls could be isolated by color/thickness. Inspecting the actual render up close (`wall_color_crop.png`), a wall in these drawings is a **multi-colored composite band**: an olive/khaki *fill*, outlined by **blue AND red** lines, with **green** end-caps at door jambs — while room labels are black, furniture is orange, doors are grey dashed arcs, windows cyan/magenta. Measured composition of fp72552: dark pixels only 2.3% (mostly TEXT), saturated colored linework 6.9% spread across ≥4 strong hues (red, orange, blue, green). So:
- "Walls = dark/low-saturation ink" grabbed the **black text**, not the walls → near-empty mask → 10–74 merged segments (need ~hundreds to enclose ~15 rooms) → 0 rooms.
- There is **no simple color rule** for "wall": the plan uses color as a *layer/legend system* (the sheet's own legend lists 100/180/200/250/300mm walls — different thicknesses drawn differently), mixed with colored dimension/annotation layers. Separating walls needs the drawing's color convention, which is not encoded in the flattened raster and varies across renders (fp72964 is darker; fp72552/fp72311 are heavily colored).

**Implication (honest):** the highest-leverage step identified in §5 — clean color/layer wall isolation — is **itself the blocking problem**, not a tractable pre-step. The walls are multi-hue composite bands, not a separable color layer. Per the study's own decision gate (§5 guardrail): *"if walls cannot be cleanly isolated by color/layer, no downstream classical method will recover rooms reliably, and the realistic path becomes fine-tuning an ML model on our own annotated CAD."* The POC hit exactly that branch.

**Note on what did NOT fail:** LSD/Hough on the raw grayscale earlier recovered wall-length segments (§1), because gradient-based line detection fires on the wall *outlines* regardless of color. A future attempt could feed LSD the raw grayscale (not a color-filtered mask) and rely on filtering segments *after* detection — but that reintroduces the wall-vs-annotation separation problem at the segment level (dimension lines, furniture, and the colored outlines all produce segments), which is the same core difficulty. This is a candidate worth one more scoped experiment, but it is NOT a trivial fix and should not be attempted blindly.

**Verdict:** the geometry POC does not currently produce closed room polygons on these plans; the blocker is wall isolation from multi-colored composite linework. Recommendation stands: either (a) one more scoped experiment feeding LSD raw grayscale + post-detection wall/annotation classification, explicitly gated; or (b) accept that these particular colored CAD renders need a learned model trained on such drawings, or the vector source. Do not proceed to graph/polygonize integration until Stage 1 demonstrably yields a wall-dominated segment set.

---

## 6. Appendix — what each piece would import (all permissive)

- Line primitives: `cv2` (LSD/Hough) — Apache-2.0
- Skeleton/thickness: `scikit-image`, `skan` — BSD
- Geometry/graph: `shapely` (BSD), `networkx` (BSD), `numpy`/`scipy` (BSD)
- OCR (already in venv): `rapidocr_onnxruntime` — Apache-2.0 (no torch)
- **Avoid for commercial use:** CubiCasa5K weights (CC BY-NC), DeepFloorplan (GPL-3.0). Liu R2V is MIT but Torch7 and clean-style-trained.
