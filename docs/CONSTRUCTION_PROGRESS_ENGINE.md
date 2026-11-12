# Construction Progress engine (v4.6-activity-rules)

How a floor's finishing progress is produced, where every number comes from, and what changed in this redesign.

## 1. Pipeline

```
360 photos --> rig views (6 per panorama) --> vision model (per room, per surface family)
   --> per-capture READINGS (state, band, indicators, explanation)            [vllm_provider.py]
   --> per (room, activity): resolve readings + choose evidence                [evidence_selection.py]
   --> sequence inference over the dependency graph                            [sequence_inference.py + activity_rules.py]
   --> merge component activities into the 14 core activities                 [vllm_provider._merge_components_per_unit]
   --> room -> flat -> floor numbers                                           [progress_aggregation.py]  (the ONLY place)
   --> snapshot (Mongo/DocumentDB)  --> dashboard / PDF / Excel / Drishti
```

The model never produces a percentage that reaches the screen. It answers with a **state** (`not_started`,
`in_progress`, `mostly_complete`, `completed`, `unable_to_determine`) and, for partial work, a **scope band**
(`1-25`, `26-50`, `51-75`, `76-99`). The server converts state + band into a number
(`pct_from_assessment`). A stray number from the model is clamped into its state's band.

## 2. Root causes found in the old engine

| Symptom | Root cause | Fix |
|---|---|---|
| Evidence photo does not show the activity | The merge kept the single **lowest-scoring** capture per room and used *that* capture as the evidence image (for 0 % it was a photo of the unfinished wall). | `evidence_selection.resolve_observations`: evidence = captures whose own reading shows the work (pct > 0, confidence >= 50), ranked by confidence, completeness, recency, de-duplicated, max 3. 0 % or unknown -> no evidence. |
| Old photo overrides newer work | No use of capture dates. | Readings older than 7 days than the newest reliable one are ignored for the value (kept as history). |
| "Could not tell" shown as 0 % | The model had to return a number; `not_visible` was dropped, uncertain answers became 0/low. | `unable_to_determine` is stored as unknown (never 0), flagged for review, and excluded from averages. |
| Inflated room/flat % | A room's % was the mean of only the activities that happened to be scored, so a room with 1-2 good readings looked 100 %, and a flat of such rooms looked complete. | Denominator is the room's *applicable* activities; coverage is reported separately; `completed` needs every applicable activity observed at 100 % (or manager-verified). |
| Same flat shows different % in different places | The calculation existed four times: provider, snapshot read-time heal, floor rollup, and the browser (`roomCompletionPct`, PDF, Excel). | One module, `progress_aggregation.py`. The service, list endpoint and read-path call it; the browser displays server fields. |
| Wrong/irrelevant "sequence" results | Hard-coded chains; "block-backward" **zeroed** later activities and a product rule zeroed Service Lines when doors were incomplete. | Configurable dependency graph (`activity_rules.DEPENDENCIES`). Conflicts are flagged for review, not silently overwritten. The door-shutter gate was removed. |
| Wrong dates (off by a day / hours) | MongoDB returns naive datetimes; they were serialised without a timezone, so browsers read them as local time. "Last inspection" was the newest capture on the whole floor, labelled "most recent AI analysis". | `iso_utc` on every date leaving the service (always `...Z`); `lastInspection` = newest capture among the photos actually scored; `analysedAt` is the analysis time. |
| "Images analyzed" overstated | Counted every capture on the floor, not the ones scored (latest per pin). | `imagesAnalyzed` = scored captures. |
| Heatmap never loaded | `<img src>` used the raw stored URL (`/media/...` needs the access token and absolute API base; on the tablet the origin is `https://localhost`), there was no `onError`, so the spinner never ended; room polygons were never drawn. | Resolved URL, error + retry state, SVG room overlay. |
| Overall floor "Completed" too easily | Based on floor-level activity averages. | Floor is completed only when every flat and every common region is. |

## 3. Methodology (all in `progress_aggregation.py`)

* **Activity** - observed (direct, inferred, manual) or unknown. Unknown is never 0.
* **Room** - `progressPct` (counted) = sum(observed %) / applicable activities. `estimatePct` = mean of observed.
  `coveragePct` = observed / applicable. Status: `completed` | `in_progress` | `not_started` | `awaiting_evidence` (< 50 % coverage) | `no_photos`.
* **Flat** - `completionPct` ("verified progress") = mean over **all required rooms** of the room's counted progress
  (unphotographed room = 0). `estimatePct`, `coveragePct`, `scopeStatus`, `lastInspection`. Completed only when every room is.
* **Floor** - flat finishing = mean of every flat (four flats -> each finished flat is 25 %). Common area is computed the
  same way over its regions and reported separately. The headline floor % blends them with the common area counted as one
  flat (`COMMON_AREA_FLAT_EQUIVALENTS`).
* **Manager review** - an override is stored next to the AI value (`aiCompletionPct`, `override{pct,reason,by,at}`,
  `detectionType: manual`). It is re-applied after every analysis (`ReviewCorrectionApplier.backfill_floor`) and counts as observed.

## 4. Activity rules (config, not code)

`activity_rules.py` holds, for each scoring-level activity: objects to find, started / partial / complete indicators,
what is NOT proof, when to answer `unable_to_determine`, the scope note and whether finished work is concealed.
`render_rule_block` injects them into every vision call. The `DEPENDENCIES` tuple is the configurable graph
(`infer = full | cap | none`). Edit these two structures to change detection or sequencing; no engine change needed.

## 5. Files

Backend (new): `activity_rules.py`, `evidence_selection.py`, `sequence_inference.py`, `progress_aggregation.py`.
Backend (changed): `vllm_provider.py` (prompt, parser, observation collection), `base.py` (additive fields),
`construction_progress_service.py` (single calculation, summaries, UTC dates), `review_correction_applier.py` (overrides),
`activities.py` (core catalogue), `precedence.py` (legacy chains kept only for old tests/snapshots).
Tests (new): `test_activity_rules`, `test_progress_aggregation`, `test_evidence_selection`, `test_sequence_inference`,
`test_assessment_pipeline`, `test_manual_override_and_dates`, plus updated `test_v4_4_area_scope`.

## 6. Known limits

* Accuracy against ground truth has not been measured; there is no labelled data yet. The reviews that managers save are the
  intended test set.
* "Cropped evidence preview" is not implemented: each evidence item carries the rig view names where the model saw the work
  (`views`) and always opens the exact original capture. A crop endpoint would need the derived-view images.
* Concealed work (screed, waterproofing, service lines) can only be verified while it is visible; afterwards it is inferred
  from later finishes and labelled as such.
