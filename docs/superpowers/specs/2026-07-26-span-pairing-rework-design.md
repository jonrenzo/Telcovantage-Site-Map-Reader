# Span Pairing Rework — Design (v2)

**Date:** 2026-07-26 (v2 — revised after multi-lens spec review; 18 findings addressed)
**Systems:** `Telcovantage-Site-Map-Reader` (this repo) — reader-side rework only. `twinbackend` (Laravel) wire contract is unchanged.
**Companion doc:** [As-is analysis](../../span-pairing/2026-07-26-as-is-analysis.md).
**Status:** Awaiting user approval.

---

## 1. Problem (one paragraph)

The reader derives spans from **cable geometry** (connected segment clusters), but twinbackend defines a span as **the cable between two adjacent poles**. Broken CAD linework turns one physical span into many span IDs; continuous linework turns many spans into one. Operators compensate with manual cut/merge tools, two export paths patch duplicates in contradictory ways (Planner suffixes `-2`/`-3`; AsBuilt silently drops all but one and loses cable length), and status colors are keyed to a positional `span_id` that changes on every renumber.

## 2. Decisions

| Question | Answer |
|---|---|
| Pole placement vs cable line | **Offset** → snap radius calibrated per drawing, never hardcoded |
| Topology | **Linear chain only** — one run per node drawing. No branches, no loops. A drawing that genuinely contains >1 disconnected run is out of domain and must **fail loudly**, never be silently fused |
| Scope | **Reader-side rework.** twinbackend wire contract unchanged |
| Manual editing after rework | **None** (topology). Cut/merge/pairing tools removed. Viewer renders derived spans |
| `number_of_runs` | Its only current source is the manual "runs" pairing tool being deleted, so it needs a new source: **automatic parallel-run detection** in the stitcher (§4.1). No manual override. *(Alternative if the team objects: upload constant 1 and accept the `expected_cable` change — requires explicit sign-off.)* |
| Status colors | Driven by twinbackend teardown status; canvas and PDF read the same map |

## 3. Root-cause fix

> Derive spans from **pole topology**, using cable geometry only to *order the poles*.

N poles on the run → exactly N−1 spans, regardless of how the linework was drafted. Explosion and collapse both become impossible by construction.

## 4. Architecture

### 4.0 Endpoint reality (read before touching anything)

There are **three** `cable_spans` implementations today:

| Route | Location | Reality |
|---|---|---|
| `/api/cable_spans` | [server.py:3658](../../../server.py#L3658) | **What the viewer actually uses** — `DxfViewer.tsx:3648` → Next proxy `app/api/cable_spans/route.ts` → Flask. Also used by the chat tool (`app/lib/chat/execute-tool.ts:364`) |
| `/api/v1/cable_spans` | [server.py:4125](../../../server.py#L4125) | Live v1 route. `server.py` defines its **own** `public_api` blueprint (line 60, registered line 4760) |
| `app_python/api/public_api.py:575` | dead | **Unregistered duplicate blueprint — dead code.** Never imported by server.py. Delete it as part of this work; do not implement there |

Both **live** routes switch to `span_builder`. The response of each keeps its current envelope (flat legacy / `{ok, data}` v1) and gains the new span fields (§6).

### 4.1 New module: `app_python/services/span_builder.py`

Single source of truth for derivation. Pure functions, no Flask/global state.

```
prepare_segments(doc, cable_layers)                  -> list[Segment]      # filtered, merged pool
build_cable_path(segments)                           -> CablePath          # one chain + parallel-run spans
project_poles_onto_path(poles, path)                 -> list[PolePosition]
derive_spans(pole_positions, path)                   -> list[DerivedSpan]
assign_lengths(spans, ocr_values, path)              -> list[DerivedSpan]
build_node_spans(doc, layers, poles, ocr_values)     -> SpanBuildResult    # orchestrator
```

**`prepare_segments`** — the stitcher's input must be *strand* linework only:

- Merge segments from **all** matched cable layers (`find_cable_layer_names`, keywords `cable`/`tx56`) into one pool — `extract_stroke_segments` is per-layer, so the merge is an explicit step.
- Exclude circles (`include_circles=False`), hatch segments (`is_hatch`), and digit strokes (reuse `cable_segment_indices` / scale-based classification at [server.py:174](../../../server.py#L174)) — digits and symbols share these layers and would otherwise make the chain unconsumable or zig-zag.

**`build_cable_path`** — stitch the pool into **one ordered polyline**:

1. Greedy nearest-endpoint chaining. **Deterministic start:** of the two path extremities, the one with the lexicographically smaller `(x, y)` is `t = 0`. Same inputs (any order, any segment orientation) → same path direction, same walk order.
2. **Parallel-run classification:** a segment whose projection onto the already-built chain lies within `snap_radius` for both endpoints (it parallels a sub-path instead of extending the chain) is classified as an **additional run** over that sub-path, not a chain extension. This is how multi-run cable drawn as parallel lines is consumed, and it is the new source of `number_of_runs` (per-span: `1 + max` parallel count over its sub-path).
3. **Gap bridging is bounded per gap:** a chain may only bridge to a segment within `bridge_limit = k_b × median(inter-fragment gap)` (default `k_b = 4`), calibrated per drawing. When no remaining segment is within the limit, chaining stops and the leftovers are **unconsumed** — which is the concrete, reachable mechanism behind the "not chainable as one path" error. Two well-separated runs can never be fused by one cheap jump.
4. Secondary check (kept, explicitly secondary): `sum(bridged gaps) / path length ≤ 0.15`.
5. If the pool forms K>1 components under the bridge limit → **error** naming each component's bounding box (out of domain per §2).

**`project_poles_onto_path`** — nearest point on the path per pole → `(t, offset)`.

- `snap_radius = max(median(offsets) × 3, p90(offsets) × 1.5)`; with fewer than 5 poles fall back to `median(pole spacing) × 0.25`. No hardcoded absolutes (the current bug is a 40× disagreement between `CUT_TOLERANCE = 0.75` and `BUFFER_RADIUS = 30`).
- `offset > snap_radius` → excluded from the run and **reported** (§8), never silently dropped.

**`derive_spans`** — sort poles by `t`; consecutive pairs become spans; span length = arc length between projections.

- **Tie-break:** sort by `(t, offset, pole_id)` — deterministic under invariant 4.
- Two poles within `same_t_threshold = 0.5 × min pole spacing` of each other → flagged as suspected duplicate pole; the pair still derives but carries a warning, and a zero/near-zero-length span (`< 1% of median span length`) blocks upload until resolved.
- `pole_index` **exact format, stated once:** the string `POLE-####`, zero-padded to 4 digits, walk order starting at `POLE-0001` at `t = 0`. This exact string is used verbatim in: the wire payload, `span_key` (lexicographic min/max — correct through 9999 poles), and status-sync matching.

**`assign_lengths`** — each OCR meter value matches the span whose **sub-path** is nearest to the value's anchor (greedy one-to-one; replaces cluster-centroid matching).

- `strand_length = ocr_value` when matched (`length_source: "ocr"`), else arc length × drawing meter scale (`length_source: "arc_length"`).
- A match farther than the median pole spacing from its sub-path → flagged, not used. Orphan values → flagged.

### 4.2 Stable span identity — and its limits

```
span_key = f"{min(pole_index_a, pole_index_b)}::{max(pole_index_a, pole_index_b)}"   # e.g. "POLE-0003::POLE-0004"
```

- Unordered + deterministic start (§4.1.1) → same drawing, same keys, byte-identical, regardless of input order or segment orientation.
- **Known limit:** `pole_index` is walk order, so adding/deleting a pole shifts every index after it — `span_key` is stable *per derivation*, not across pole edits. Therefore durable client-side state (recovery marks, unsynced statuses) is keyed by the **unordered pair of stable client `pole_id`s**, and remapped to fresh `span_key`s after every re-derivation. Marks whose pole pair no longer forms a span surface in the validation report — never silently dropped.
- Positional `span_id` remains only as a per-session render handle.

### 4.3 Data flow

```
DXF upload
  └─ existing pipeline: extract segments, detect poles, OCR
       └─ span_builder.build_node_spans()                       ← Python, single source of truth
            ├─ GET /api/cable_spans (legacy, via Next proxy)     → viewer renders (read-only)
            ├─ GET /api/v1/cable_spans                           → external consumers
            ├─ POST /api/v1/cable_spans/derive                   → re-derivation (below)
            └─ serialize_spans_for_export()                      → both export payloads (§5)

twinbackend (unchanged)
  └─ teardown lifecycle → span.status
       └─ GET /asbuilt/node/{id} → reader Sync Status (§4.5) → canvas + PDF colors
```

**Re-derivation contract** (pole edits are kept; topology editing is not):

- `POST /api/v1/cable_spans/derive` with body `{ poles: [full current pole list — detected + manual adds/edits/deletes, each with stable client pole_id, name, cx, cy], corrections: {digit_id: value} }`.
- Server replaces the session's pole set, applies OCR corrections, runs `build_node_spans`, returns the full serialized `SpanBuildResult` (§6). GET routes serve the last derivation.
- **Trigger rule:** the viewer calls it after every pole add/edit/delete and every OCR digit correction. Both export endpoints re-run `build_node_spans` server-side after applying their `corrections` map — never a cached pre-correction list — so canvas and export lengths cannot disagree.
- **Reconciliation:** after each response, the viewer remaps durable state via the pole-id-pair rule (§4.2).

### 4.4 Viewer changes (`DxfViewer.tsx`)

**Removed:**

| Item | Location | Note |
|---|---|---|
| `autoConnectPoles` (BUFFER_RADIUS 30 / ray 150) | DxfViewer.tsx:2448 | derivation assigns poles |
| `normalizeSpansToPoleBreaks` + `applyPoleBreakNormalization` | :1482, :2321 | N−1 by construction |
| Cut/merge/**runs-pairing** multi-action machinery | `startMultiAction`/`handleConfirmMultiAction` :3441–3520, pairing UI ~:5337–5420, cut handlers :3067–3260 | runs pairing shares this machinery; its replacement is §4.1.2 |
| `splitHistoryRef` + undo (Ctrl+Z) | declared :1272; pushed :2558, :2760, :2809, :3469; undo :3362–3402 | **Span delete/restore is also removed** (a derived span isn't deletable — fix the poles instead), so the whole history stack goes |
| `source_span_id` + `collapseCableSpansForExport` | :764 | nothing to re-collapse |
| Duplicate-pair drop + `compareResolvedSpanPriority` | AsbuiltExportModal.tsx:1074, :208 | duplicates impossible |
| Synthetic detection-order `POLE-0001` counter | AsbuiltExportModal.tsx:583 | walk-order index from Python |
| `-2`/`-3` span-code suffixing | server.py:1374 | duplicate key = hard error |

**Kept:** pan/zoom/layers, pole add/edit/delete (triggers `POST …/derive`), span selection/hover, recovery marking (re-keyed, §4.5), PDF export, boundary mask.

**Other consumers of the span list (must keep working):** `notifySpansChange` emits the serialized `DerivedSpan` list **verbatim** (no collapse step) → `page.tsx:441` `/api/export/all` (Excel), chat tool `get_cable_spans`, boundary-mask/layer-visibility filtering. `DerivedSpan` therefore retains `cx/cy/bbox/layer` (§6).

### 4.5 Status sync → colors → PDF

1. **Node id persistence:** the import modal, on success, `POST /api/v1/session/asbuilt_node` `{node_db_id}`; new `sessions.asbuilt_node_db_id` column + `session_store.save_asbuilt_node_id()`. When Supabase is offline the UI shows "sync unavailable — node id not persisted" (session_store's silent-no-op contract is not acceptable here, per §8's no-silence rule).
2. **Sync:** button in the DXF toolbar next to Export PDF, four states (idle + last-synced time / loading / error / disabled-"Not imported yet" when no node id). Refresh on `visibilitychange → visible`, throttled to ≥30 s. Flask proxies `GET /asbuilt/node/{id}` via existing `asbuilt_api.get_node`.
3. **Matching:** the current twinbackend controller returns `from_pole_index`/`to_pole_index` per span (verified: `AsBuiltController.php:269–288`). **Primary match:** unordered `(from_pole_index, to_pole_index)` — byte-equal to the `POLE-####` strings the reader uploaded. **Fallback** (older deployed backends whose spans carry only `from_pole_code`/`to_pole_code` — the stale reader-side `AsbuiltSpan` type at `app/types/index.ts:165` reflects this): join `pole_code → poles[].sequence` in walk order; duplicate adjacent code pairs are assigned k-th backend occurrence → k-th local pair (deterministic because the reader generated the upload and manual editing is gone). Anything still ambiguous or count-mismatched → **unmatched panel**, never silently colored. Update the stale `AsbuiltSpan` interface to include the index fields as optional.
4. **Color composition rule — teardown owns the stroke:** span line color and marker glow on canvas **and** PDF come exclusively from the teardown map: `pending` blue, `in_progress`/`pending_teardown` amber, `completed` **red**, `superseded`/`cancelled` gray dashed, unknown → blue + listed in the sync panel. Recovery marking (Recovered/Partial/Missing) **loses its stroke role** and becomes a chip/badge channel only (its existing chip styles), re-keyed per §4.2. This resolves the red-means-completed vs red-means-Missing collision. PDF summary totals (recovered/unrecovered/missing meters) remain computed from recovery marks; the PDF line-color legend switches to the teardown palette with a separate legend row for recovery chips.
5. **Pole coloring — both ends ("kabilaan"):** the sync response's `poles[]` array carries per-pole `status`/`date_start`/`finished_at` (SkycablePole auto-derives: `cleared_at` set → `completed`, `date_start` set → `in_progress`). Matched to local poles by `pole_index` (`POLE-####`). The two pole markers of a span change color with the same palette as spans: `pending` default, `in_progress` amber, `completed` red. A pole is red only when the backend says so (all its spans done), so partially-torn poles stay amber — the operator sees exactly which end is finished. Applies to canvas and PDF both.
6. `exportToPdf` reads all three maps (teardown span map → line colors; pole map → marker colors; recovery → chips + totals) and has no logic of its own.

### 4.6 Session persistence (Supabase)

- `cable_spans` table gains `span_key`, `from_pole_index`, `to_pole_index`, `length_source`; numeric `span_id` demoted to render handle.
- **Restore always re-derives:** the `initialCableSpans` early-return at `DxfViewer.tsx:3605` is replaced — restored sessions call the derive endpoint; stored span rows are cache/display-only until it returns. Pre-rework sessions therefore can never render stale cluster spans.
- `span_operations` write paths for split/pair/merge (`useDatabase.ts:376–462`) retire with the tools. Recovery statuses move off `span_operations` to span_key-keyed storage (re-keyed upsert in `saveCableSpanStatuses`); old `span_id`-keyed status rows are ignored on restore — **documented accepted loss**, since re-derivation renumbers.
- `session_store.session_has_user_edits` drops `span_operations` as an edit signal.

## 5. Export contract (wire format unchanged)

- **AsBuilt:** payload assembly moves fully client-side-*thin*: the modal fetches derived spans + poles from the reader (`GET /api/cable_spans`) and merges only user selections (site, PSGC, subcontractor, team, node id) before POSTing `/api/v1/asbuilt/import-by-sequence`. `pole_index` and `sequence` are the walk-order `POLE-####` strings; lengths and components come from the derivation, never recomputed in TS.
- **Planner:** `/api/export/polemaster` **stops accepting `cable_spans` in the request body** (today: server.py:3548); it sources spans server-side from the session's last derivation. `push_to_planner`'s name/pole_id resolution maze (server.py:1126–1392) collapses to a direct walk: `pole_index → pole` (the derivation already knows both endpoints' pole records, including `pole_code`/name).
- Component counts attach to the span whose sub-path is nearest to each equipment shape (same primitive as OCR matching).
- Both paths consume `serialize_spans_for_export()` output (§6). Occurrence-suffix logic deleted.

## 6. Data shapes

```python
Segment       = {x1, y1, x2, y2, layer, is_hatch}                    # existing
CablePath     = {points: [(x, y)], cum_t: [float], total_length,
                 bridged_gaps: [{from_pt, to_pt, length}],
                 runs: [{t_start, t_end, count}]}                    # parallel-run intervals
PolePosition  = {pole_id, name, cx, cy, t, offset, snapped: bool}
DerivedSpan   = {span_key, from_pole_index, to_pole_index,           # "POLE-####" strings
                 from_pole: {pole_id, name, cx, cy, lat?, lng?},     # full refs — both exporters join here
                 to_pole:   {…},
                 strand_length, length_source: "ocr"|"arc_length",
                 cable_runs,                                          # from §4.1.2
                 components: {node, amplifier, extender, tsc, powersupply, ps_housing},
                 segments: [ {x1,y1,x2,y2} ],                        # sub-path slice; mid-segment splits at
                                                                     # pole projections; bridged gaps included
                                                                     # and marked {bridged: true}
                 cx, cy, bbox, layer,                                # render/hit-test/mask — kept
                 span_id}                                            # per-session render handle
SpanBuildResult = {spans: [DerivedSpan], path: CablePath,
                  warnings: [Warning], errors: [Error]}
```

`serialize_spans_for_export()` returns `DerivedSpan` verbatim (it *is* the export shape); exporters project out the fields their wire needs.

## 7. Invariants (enforced)

1. `len(spans) == len(snapped poles) − 1` — else upload **blocked**.
2. Every `span_key` unique — duplicate raises (derivation bug).
3. Per-gap bridge limit (§4.1.3) is primary; aggregate `≤ 15%` secondary; unconsumed segments → "not chainable" error with component bounding boxes.
4. Same inputs → byte-identical output (deterministic start, total tie-breaking, no randomness).

## 8. Error handling — validation report

`SpanBuildResult.{warnings, errors}` shown in the export modal **before** upload:

- **Errors (block):** unconsumed segments / K>1 components; invariant violations; zero snapped poles; near-zero-length span (§4.1 derive_spans).
- **Warnings (allow, require acknowledgment):** snap-excluded pole (highlighted on canvas); OCR value unmatched/too-far (span labeled `arc_length`); orphan OCR value; suspected duplicate pole; equipment shape unattributable; parallel-run detection applied (`cable_runs > 1` shown per span).
- **Acknowledgment flow:** one confirm listing all current warnings; any re-derivation that changes the warning set resets it; acknowledged state is session-local, not sent to twinbackend.
- Nothing goes to `console.warn` alone.

## 9. Testing

`tests/test_span_builder.py` (pytest, pure functions):

1. 5 disconnected collinear fragments between 2 poles → 1 span, full summed length.
2. 1 polyline through 5 poles → 4 spans, correct per-span lengths.
3. Offset poles (0.5–3 units) → all projected, correct order.
4. Reverse every segment **and** shuffle input order → identical `span_key` set **and identical `pole_index` assignment** (deterministic start makes this non-vacuous).
5. Pole 50 units away → excluded + warning; remaining N−1 intact.
6. Two far-apart runs → K>1 "not chainable" error naming both components; no phantom bridge.
7. Two parallel polylines between the same pole pair → 1 span, `cable_runs = 2`, stitching passes.
8. OCR mid-span → correct span; orphan value → flagged.
9. Two poles at same `t` → deterministic order, duplicate-pole warning.
10. Sync matching with duplicated pole codes (two poles named `PL-001`) → all spans resolved via fallback join; ambiguous leftover → unmatched.
11. **Golden test:** a real production DXF (or an anonymized derivative with identical geometry) **checked into the repo**; snapshot lists `span_key`, endpoint coordinates, length, `length_source`, `cable_runs` per span; any diff fails CI. No reference-only escape hatch.

Viewer side: manual/Playwright checklist — render, re-derivation on pole edit, status sync states, canvas/PDF color parity (spans **and** end-pole markers), Excel export still working.

## 10. Out of scope

- twinbackend schema/endpoints/migrations; repair of already-imported exploded nodes; re-import over an existing `node_id`.
- Branch/loop topologies (hard error per §4.1.5).
- Manual `number_of_runs` editing (replaced by §4.1.2 auto-detection — see §2 for the fallback decision if auto-detection is rejected).

## 11. Rollout

1. Land `span_builder.py` + tests. Switch **both live routes** (`/api/cable_spans` server.py:3658 and `/api/v1/cable_spans` server.py:4125) to it; delete the dead `app_python/api/public_api.py`. Responses gain the §6 fields in their existing envelopes.
2. Add `POST /api/v1/cable_spans/derive` + session node-id endpoint/column.
3. Switch both export payload builders to `serialize_spans_for_export()`; `/api/export/polemaster` stops reading spans from the request body.
4. Delete viewer editing machinery (§4.4 table), re-key recovery marks, wire restore-always-re-derives.
5. Add Sync Status + color composition + PDF wiring; update the stale `AsbuiltSpan` interface.
6. Verify golden DXF + one live round-trip (import → teardown in twinbackend staging → sync → red line on canvas and PDF).
