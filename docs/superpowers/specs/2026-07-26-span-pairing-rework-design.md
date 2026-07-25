# Span Pairing Rework — Design

**Date:** 2026-07-26
**Systems:** `Telcovantage-Site-Map-Reader` (this repo) — reader-side rework only. `twinbackend` (Laravel) API contract is unchanged.
**Companion doc:** [As-is analysis](../../span-pairing/2026-07-26-as-is-analysis.md) — full problem breakdown with file references.
**Status:** Approved direction (Option 1 — linear referencing). This document is the buildable spec.

---

## 1. Problem (one paragraph)

The reader derives spans from **cable geometry** (connected segment clusters), but twinbackend defines a span as **the cable between two adjacent poles**. Broken CAD linework turns one physical span into many span IDs (5 fragments between P1–P2 → 5 uploaded spans); continuous linework turns many spans into one (one polyline through 5 poles → 1 span, middle poles invisible). Operators compensate with manual cut/merge tools in a 5,480-line viewer component, two export paths patch the duplicates in contradictory ways (Planner suffixes `-2`/`-3`; AsBuilt silently drops all but one and loses cable length), and teardown status colors are keyed to a positional `span_id` that changes on every renumber.

## 2. Decisions already made (with the user)

| Question | Answer |
|---|---|
| Pole placement vs cable line | **Offset** (near, not on the line) → snap radius must be calibrated per drawing, not hardcoded |
| Topology | **Linear chain only** — pole 1 → 2 → … → N. No branches, no loops |
| Scope | **Reader-side rework.** Upload already works; accuracy is the problem. No twinbackend schema/API changes |
| Manual editing after rework | **None.** Fully automatic derivation. Cut/merge tools removed. Viewer becomes render-only |
| Status colors | Driven by twinbackend teardown status; must appear identically in canvas and PDF export |

## 3. Root-cause fix

> Derive spans from **pole topology**, using cable geometry only to *order the poles*.

Span count becomes a function of pole count: **N poles on a run → exactly N−1 spans**, regardless of how the drafter broke the linework. Both failure modes (explosion and collapse) become impossible by construction.

## 4. Architecture

### 4.1 New module: `app_python/services/span_builder.py`

Single source of truth for span derivation. Pure functions, no Flask/global state, unit-testable in isolation.

```
build_cable_path(segments) -> CablePath
project_poles_onto_path(poles, path) -> list[PolePosition]      # t, offset per pole
derive_spans(pole_positions, path) -> list[DerivedSpan]          # N-1 spans
assign_lengths(spans, ocr_values, path) -> list[DerivedSpan]     # meter values + flags
build_node_spans(segments, poles, ocr_values) -> SpanBuildResult # orchestrator
```

**`build_cable_path`** — stitch all cable-layer segments of the drawing into **one ordered polyline path**:

1. Start from the existing `extract_stroke_segments` output (unchanged).
2. Greedy nearest-endpoint chaining: begin at the endpoint pair with the largest mutual separation (a path extremity), repeatedly append the segment whose nearest endpoint continues the path. Linear topology (decided above) makes this unambiguous — there is never a fork to choose between.
3. Gap bridging is **unlimited by distance but validated afterward**: the chain must consume all segments, and the total bridged-gap length must stay under a fraction of total path length (default 15%). Exceeding it is a validation error, not a silent guess.
4. Output: ordered list of points with cumulative arc length (`t` from 0 to `L`).

**`project_poles_onto_path`** — for each detected pole, compute the nearest point on the path → `(t, offset)`.

- Snap radius is **computed from the drawing**: `snap_radius = max(median(offsets) * 3, p90(offsets) * 1.5)`. No hardcoded `0.75` / `30` / `150` constants (the 40× disagreement between `CUT_TOLERANCE` and `BUFFER_RADIUS` is the current bug).
- Poles with `offset > snap_radius` are excluded from the run and **reported** (see §7), never silently dropped.

**`derive_spans`** — sort poles by `t`; each consecutive pair is one span. Span length = arc length between the two projections. `pole_index` is assigned in walk order: `POLE-0001` = first pole on the cable (replaces the current synthetic detection-order counter).

**`assign_lengths`** — each OCR meter value is matched to the span whose sub-path is nearest to the value's anchor point (replaces cluster-centroid matching). Rules:

- One value per span; one span per value (greedy nearest, then leftovers flagged).
- `strand_length = ocr_value` when matched, else arc length converted by the drawing's meter scale; source recorded as `"ocr" | "arc_length"`.
- A matched value whose anchor is farther than the median pole spacing from its sub-path → flagged, not used.

### 4.2 Stable span identity

```
span_key = f"{min(pole_index_a, pole_index_b)}::{max(pole_index_a, pole_index_b)}"
```

- Unordered → re-deriving with flipped segment order yields identical keys (kills the direction-flip duplicates twinbackend's `$isReversed` currently patches).
- Deterministic → same drawing, same keys, every run.
- This key becomes the identity used by: viewer selection/highlight state, status colors, recovery marks, and both export payload builders.
- The positional `span_id` remains only as a render handle inside one session; nothing durable keys on it anymore.

### 4.3 Data flow (after rework)

```
DXF upload
  └─ existing pipeline: extract segments, detect poles, OCR strand values
       └─ span_builder.build_node_spans()          ← NEW, in Python
            ├─ GET /api/v1/cable_spans             → viewer renders (read-only)
            ├─ AsBuilt export payload              → POST /asbuilt/import-by-sequence
            └─ Planner export payload              → push_to_planner()
                 (both payloads built from the SAME DerivedSpan list — one function,
                  `serialize_spans_for_export()`, consumed by both paths)

twinbackend (unchanged)
  └─ teardown lifecycle → span.status
       └─ GET /asbuilt/node/{id}                   → reader Sync Status
            └─ match by (from_pole_index, to_pole_index) unordered
                 └─ canvas colors + PDF export colors
```

### 4.4 Viewer changes (`DxfViewer.tsx`)

The viewer stops deriving or editing topology. It renders what Python derived.

**Removed** (net deletion of roughly 1,500–2,000 lines):

| Item | Location | Why safe to delete |
|---|---|---|
| `autoConnectPoles` (BUFFER_RADIUS 30, ray-cast 150/15) | DxfViewer.tsx:2448 | Derivation assigns poles |
| `normalizeSpansToPoleBreaks` + `applyPoleBreakNormalization` | DxfViewer.tsx:1482, 2321 | N−1 by construction |
| Cut-at-pole / merge-with-neighbor tools + `splitHistoryRef` | DxfViewer.tsx:3067–3400 | Nothing to cut or merge |
| `source_span_id` + `collapseCableSpansForExport` | DxfViewer.tsx:764 | No fragments to re-collapse |
| Duplicate-pair drop + `compareResolvedSpanPriority` | AsbuiltExportModal.tsx:1074, 208 | Duplicates impossible |
| Synthetic `POLE-0001` detection-order counter | AsbuiltExportModal.tsx:583 | Walk-order index from Python |
| `-2`/`-3` span-code suffixing | server.py:1374 | Duplicate keys are a hard error now |

**Kept:** pan/zoom/layers, pole add/edit/delete (still needed — pole detection can miss; any pole change triggers **re-derivation via API call**, not local geometry surgery), span selection/hover, Recovered/Partial/Missing recovery marking (re-keyed to `span_key`), PDF export.

### 4.5 Status sync → colors → PDF

1. After a successful AsBuilt import, persist the returned node DB id with the session (`session_store`).
2. **Sync Status**: viewer button + refresh-on-tab-focus → reader Flask proxies `GET /asbuilt/node/{id}` (via existing `asbuilt_api.get_node`) → response spans matched to local spans by unordered `(from_pole_index, to_pole_index)`.
3. Color map (canvas and PDF both read the same `Record<span_key, status>`):
   - `pending` → blue (default), `in_progress` → amber, `completed` → **red**, `superseded`/`cancelled` → gray dashed.
4. `exportToPdf` (DxfViewer.tsx:4267) gets no logic of its own — it renders from the same status map. Screen and PDF can never disagree.
5. Unmatched backend spans (e.g. node edited after import) are listed in the sync result panel — visible, never silent.

## 5. Export contract (unchanged wire format)

`POST /asbuilt/import-by-sequence` payload keeps its exact shape (`poles[].pole_index`, `spans[].from_pole_index/to_pole_index/strand_length/number_of_runs/components`). What changes is only **how the values are computed**:

- `pole_index` = walk order on the cable.
- Spans = consecutive pairs; lengths aggregated from the full sub-path (no more 100 m → 20 m loss).
- Component counts attach to the span whose sub-path is nearest to each equipment shape (same nearest-sub-path primitive as OCR matching).
- Planner path (`push_to_planner`) consumes the same serialized list; occurrence-suffix logic deleted.

## 6. Invariants (enforced, not assumed)

1. `len(spans) == len(poles_on_run) − 1` — else upload is **blocked**.
2. Every `span_key` unique — a duplicate is a derivation bug and raises.
3. `sum(bridged gaps) / path length ≤ 0.15` — else validation error naming the largest gap and its coordinates.
4. Re-running derivation on the same inputs is byte-identical (sorted, no randomness).

## 7. Error handling — the validation report

`build_node_spans` returns `SpanBuildResult { spans, warnings, errors }`. The export modal shows it **before** upload:

- **Errors (block upload):** stitching consumed < 100% of segments; invariant 1–3 violations; zero poles projected.
- **Warnings (allow upload, require acknowledgment):** pole excluded by snap radius (highlighted on canvas); OCR value unmatched or too far (span falls back to arc length, labeled); equipment shape unattributable to any span.
- Nothing goes to `console.warn` alone. Every dropped or substituted datum appears in the report.

## 8. Testing

Pure-function unit tests (`tests/test_span_builder.py`, pytest):

1. **Fragmentation:** 5 disconnected collinear fragments between 2 poles → exactly 1 span, full summed length.
2. **Collapse:** 1 continuous polyline through 5 poles → exactly 4 spans, correct per-segment lengths.
3. **Offset poles:** poles 0.5–3 units off the line → all projected, correct order.
4. **Direction stability:** reverse every segment and shuffle input order → identical `span_key` set.
5. **Snap exclusion:** one pole 50 units away → excluded + warning, remaining N−1 spans intact.
6. **Gap validation:** a 40% gap → stitching error, upload blocked.
7. **OCR matching:** values anchored mid-span → correct span; orphan value → flagged.
8. **Golden test:** one real production DXF checked in (or referenced), snapshot of derived spans; any diff fails CI.

Viewer-side: existing manual flows die, so the remaining surface is thin — a Playwright/manual checklist covering render, status sync colors, and PDF parity is sufficient.

## 9. Out of scope

- twinbackend schema, migrations, or endpoint changes (including re-import of already-imported nodes — existing `node_id` uniqueness rejection stands).
- Migration/repair of nodes already uploaded with exploded spans.
- Branch/loop topologies (explicitly excluded by decision above; stitching raises an error if the drawing is not chainable as one path).
- Multi-run detection changes (`number_of_runs` keeps its current source).

## 10. Rollout

1. Land `span_builder.py` + tests behind the existing endpoints (`/api/v1/cable_spans` switches to it — the response shape gains `span_key`, `from_pole_index`, `to_pole_index`, `length_source`).
2. Switch both export payload builders to `serialize_spans_for_export()`.
3. Delete viewer editing code + `server.py` suffix logic + AsBuilt dedupe.
4. Add Sync Status + color/PDF wiring.
5. Verify against the golden DXF and one live node round-trip (import → teardown in twinbackend staging → sync → red line in canvas and PDF).
