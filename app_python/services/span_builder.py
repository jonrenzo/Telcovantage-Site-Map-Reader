"""Pole-topology span derivation.

The old derivation asked "which cable segments are connected?" and called each
connected cluster a span. That answer depends on how the drafter drew the line,
so broken linework produced many span ids for one physical span and continuous
linework hid the poles in the middle of a run.

This module asks the question the backend actually cares about: "which poles are
adjacent along the cable?" Cable geometry is used only to *order* the poles. A
span is then the sub-path between two consecutive poles, so N poles on a run
always yield exactly N-1 spans no matter how the linework was drafted.

Pipeline::

    prepare_segments        strand linework only, all cable layers merged
    build_cable_path        chain fragments into one ordered polyline
    project_poles_onto_path place each pole on the path by arc length
    classify_parallel_runs  leftovers that run alongside are extra cable runs
    derive_spans            consecutive poles become spans
    assign_lengths          OCR strand values matched to sub-paths

Everything here is a pure function over plain data - no Flask, no globals, no
drawing I/O. Segments are duck-typed: any object with ``x1 y1 x2 y2``,
``is_hatch``, ``color`` and ``length()`` works (``server.Seg`` does).

See docs/superpowers/specs/2026-07-26-span-pairing-rework-design.md
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# CALIBRATION FACTORS
#
# Every threshold is a *factor* applied to a statistic measured from the drawing
# itself. The bug this module replaces was two hardcoded absolutes that
# disagreed by 40x (CUT_TOLERANCE 0.75 vs BUFFER_RADIUS 30), so no absolute
# distance constant is allowed here.
# ─────────────────────────────────────────────────────────────────────────────

#: A segment longer than this multiple of the median stroke length is cable, not
#: a digit stroke. Mirrors server.CABLE_SEG_FACTOR so both agree.
CABLE_SEG_FACTOR = 20.0

#: Cable colour is only trusted to identify strand linework when it covers at
#: most this fraction of the layer (otherwise it is also the digit colour).
CABLE_COLOR_MINORITY = 0.6

#: Endpoints closer than this multiple of the median segment length are the same
#: point (fragment welding).
WELD_FACTOR = 0.01

#: A bridge may never exceed this fraction of the median pole spacing. A real
#: drafting break is far shorter than a pole-to-pole span; a gap approaching one
#: is the space between two separate cable runs. This cap is the *anchor* — gap
#: statistics may only tighten it, never raise it, because a limit calibrated on
#: the very gaps it polices always admits them.
BRIDGE_POLE_SPACING_CAP = 0.35

#: With gap evidence this plentiful, the observed gap distribution is allowed to
#: tighten the cap below it.
BRIDGE_GAP_FACTOR = 4.0
MIN_GAPS_FOR_MEDIAN = 3

#: Fallback anchor when pole spacing is unknown, as a multiple of median
#: segment length.
BRIDGE_FLOOR_FACTOR = 1.5

#: An accepted bridge longer than this fraction of the median pole spacing is
#: reported, so a stitch is never invisible even when it is allowed.
BRIDGE_NOTICE_RATIO = 0.25

#: Total bridged length as a fraction of the path. This is only a backstop
#: against a path that is mostly invented — the per-gap limit above is what
#: actually keeps separate runs apart. Drawings converted from PDF are drafted
#: as short strokes with real gaps between them, so 20-30% bridging is normal
#: and blocking on it would reject every real drawing.
BRIDGED_RATIO_NOTICE = 0.20
MAX_BRIDGED_RATIO = 0.50

#: A fragment running alongside the chain within this multiple of the median
#: pole spacing is a parallel run, not a continuation.
PARALLEL_TOL_FACTOR = 0.30

#: Points sampled along a fragment when testing it for parallelism.
PARALLEL_SAMPLES = 7

#: Leftover linework shorter than this fraction of the chain is stray marks or
#: text the digit filter could not separate — not a second cable run. Calling it
#: one would block the upload with a misleading error.
IGNORABLE_FRAGMENT_RATIO = 0.02

#: A second cable run must cover at least this much of a pole span before it
#: counts as a run. Below that it is one stray dash of the main line, and
#: counting it would inflate number_of_runs on the upload.
MIN_RUN_SPACING_RATIO = 0.5

#: Pole snap radius, derived from the pole offset distribution.
SNAP_MEDIAN_FACTOR = 3.0
SNAP_P90_FACTOR = 1.5

#: With fewer than this many poles the offset distribution is meaningless.
SNAP_MIN_POLES = 5
SNAP_SPACING_FALLBACK = 0.25

#: Consecutive poles closer than this multiple of the *median* spacing are
#: probably the same pole detected twice. Calibrating on the minimum would be
#: vacuous — the minimum is realised by the pair under test.
SAME_T_FACTOR = 0.5

#: A span shorter than this fraction of the median span length is degenerate.
MIN_SPAN_RATIO = 0.01

#: An OCR value anchored further than this multiple of the median span length
#: from a span's sub-path is not that span's label.
OCR_MATCH_FACTOR = 1.0


# ─────────────────────────────────────────────────────────────────────────────
# DATA SHAPES
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Note:
    """A warning or error, carrying enough detail to act on."""

    code: str
    message: str
    detail: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.detail}


@dataclass
class CablePath:
    """One cable run, stitched into a single ordered polyline.

    ``points[i]`` connects to ``points[i + 1]``. ``cum[i]`` is the arc length
    from the start of the path to ``points[i]``, so ``cum[-1]`` is the total
    length. An edge whose index is in ``bridges`` spans a drafting gap rather
    than real linework. ``runs`` holds ``(t0, t1, extra_count)`` intervals
    covered by parallel cable.
    """

    points: List[Tuple[float, float]]
    cum: List[float]
    bridges: List[int] = field(default_factory=list)
    runs: List[Tuple[float, float, int]] = field(default_factory=list)

    @property
    def total_length(self) -> float:
        return self.cum[-1] if self.cum else 0.0

    def bridged_length(self) -> float:
        return sum(self.cum[i + 1] - self.cum[i] for i in self.bridges)

    def runs_at(self, t0: float, t1: float) -> int:
        """How many parallel cable runs cover [t0, t1].

        A run counts only when it covers the majority of the interval, so a stub
        of parallel linework near one pole does not inflate the whole span.
        """
        if t1 <= t0:
            return 1
        extra = 0
        for r0, r1, count in self.runs:
            overlap = min(t1, r1) - max(t0, r0)
            if overlap > 0.5 * (t1 - t0):
                extra = max(extra, count)
        return 1 + extra


@dataclass
class PolePosition:
    pole_id: Any
    name: str
    cx: float
    cy: float
    t: float
    offset: float
    snapped: bool
    pole_index: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pole_id": self.pole_id,
            "name": self.name,
            "pole_index": self.pole_index,
            "cx": round(self.cx, 6),
            "cy": round(self.cy, 6),
            "t": round(self.t, 6),
            "offset": round(self.offset, 6),
            "snapped": self.snapped,
        }


EMPTY_COMPONENTS = {
    "node": 0,
    "amplifier": 0,
    "extender": 0,
    "tsc": 0,
    "powersupply": 0,
    "ps_housing": 0,
}


@dataclass
class DerivedSpan:
    span_key: str
    from_pole_index: str
    to_pole_index: str
    from_ref: Dict[str, Any]
    to_ref: Dict[str, Any]
    t_start: float
    t_end: float
    arc_length: float
    strand_length: float
    length_source: str  # "ocr" | "arc_length"
    cable_runs: int
    segments: List[Dict[str, Any]]
    cx: float
    cy: float
    bbox: List[float]
    layer: Optional[str]
    span_id: int
    components: Dict[str, int] = field(default_factory=lambda: dict(EMPTY_COMPONENTS))

    def to_dict(self) -> Dict[str, Any]:
        """Serialise for the API.

        ``from_pole``/``to_pole`` stay pole-name strings and ``total_length`` /
        ``meter_value`` stay present because the Excel export and the chat tool
        read exactly those fields. The richer pole records live alongside them
        under ``from_pole_ref``/``to_pole_ref``, which is what the exporters
        join on.
        """
        return {
            "span_id": self.span_id,
            "span_key": self.span_key,
            # Legacy shape — existing consumers read these verbatim.
            "from_pole": self.from_ref.get("name"),
            "to_pole": self.to_ref.get("name"),
            "from_pole_id": self.from_ref.get("pole_id"),
            "to_pole_id": self.to_ref.get("pole_id"),
            "total_length": round(self.arc_length, 4),
            "meter_value": (
                round(self.strand_length, 4) if self.length_source == "ocr" else None
            ),
            # New shape.
            "from_pole_index": self.from_pole_index,
            "to_pole_index": self.to_pole_index,
            "from_pole_ref": self.from_ref,
            "to_pole_ref": self.to_ref,
            "arc_length": round(self.arc_length, 4),
            "strand_length": round(self.strand_length, 4),
            "length_source": self.length_source,
            "cable_runs": self.cable_runs,
            "segments": self.segments,
            "segment_count": len(self.segments),
            "cx": round(self.cx, 6),
            "cy": round(self.cy, 6),
            "bbox": [round(v, 6) for v in self.bbox],
            "layer": self.layer,
            "components": dict(self.components),
        }


@dataclass
class SpanBuildResult:
    spans: List[DerivedSpan] = field(default_factory=list)
    poles: List[PolePosition] = field(default_factory=list)
    path: Optional[CablePath] = None
    warnings: List[Note] = field(default_factory=list)
    errors: List[Note] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self, include_path: bool = False) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "ok": self.ok,
            "count": len(self.spans),
            "spans": [s.to_dict() for s in self.spans],
            "poles": [p.to_dict() for p in self.poles],
            "warnings": [w.to_dict() for w in self.warnings],
            "errors": [e.to_dict() for e in self.errors],
        }
        if include_path and self.path:
            data["path"] = {
                "points": [[round(x, 6), round(y, 6)] for x, y in self.path.points],
                "total_length": round(self.path.total_length, 4),
                "bridged_length": round(self.path.bridged_length(), 4),
                "runs": [[r0, r1, c] for r0, r1, c in self.path.runs],
            }
        return data


# ─────────────────────────────────────────────────────────────────────────────
# GEOMETRY PRIMITIVES
# ─────────────────────────────────────────────────────────────────────────────


def _median(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2.0


def _percentile(values: Sequence[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    pos = (len(s) - 1) * pct
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(s) - 1)
    frac = pos - lo
    return s[lo] * (1 - frac) + s[hi] * frac


def _dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _point_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> Tuple[float, float]:
    """Distance from P to segment AB, and how far along AB the foot sits (0..1)."""
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    if denom <= 1e-18:
        return math.hypot(px - ax, py - ay), 0.0
    u = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
    return math.hypot(px - (ax + u * dx), py - (ay + u * dy)), u


def project_point_onto_path(
    px: float, py: float, path: CablePath
) -> Tuple[float, float]:
    """Nearest point on the path to P. Returns (arc length t, distance)."""
    best_dist = float("inf")
    best_t = 0.0
    pts = path.points
    for i in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        d, u = _point_to_segment(px, py, ax, ay, bx, by)
        if d < best_dist:
            best_dist = d
            best_t = path.cum[i] + u * (path.cum[i + 1] - path.cum[i])
    return best_t, best_dist


def slice_path(path: CablePath, t0: float, t1: float) -> List[Dict[str, Any]]:
    """The polyline between two arc-length positions, as drawable segments.

    Splits mid-segment at the endpoints so a span's geometry starts and ends
    exactly at the pole projections rather than at the nearest vertex.
    """
    if t1 <= t0:
        return []
    out: List[Dict[str, Any]] = []
    pts, cum = path.points, path.cum
    bridge_set = set(path.bridges)

    for i in range(len(pts) - 1):
        seg_t0, seg_t1 = cum[i], cum[i + 1]
        if seg_t1 <= t0 or seg_t0 >= t1:
            continue
        seg_len = seg_t1 - seg_t0
        if seg_len <= 1e-12:
            continue
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        u0 = max(0.0, (t0 - seg_t0) / seg_len)
        u1 = min(1.0, (t1 - seg_t0) / seg_len)
        if u1 - u0 <= 1e-12:
            continue
        entry: Dict[str, Any] = {
            "x1": round(ax + u0 * (bx - ax), 6),
            "y1": round(ay + u0 * (by - ay), 6),
            "x2": round(ax + u1 * (bx - ax), 6),
            "y2": round(ay + u1 * (by - ay), 6),
        }
        if i in bridge_set:
            entry["bridged"] = True
        out.append(entry)
    return out


def _cumulative(pts: Sequence[Tuple[float, float]]) -> List[float]:
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + _dist(pts[i], pts[i + 1]))
    return cum


def _bbox_of(pts: Sequence[Tuple[float, float]]) -> List[float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)]


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — SEGMENT PREPARATION
# ─────────────────────────────────────────────────────────────────────────────


def prepare_segments(
    segments_by_layer: Dict[str, List[Any]],
    warnings: Optional[List[Note]] = None,
) -> List[Any]:
    """Merge every cable layer into one pool of strand-only linework.

    ``extract_stroke_segments`` runs per layer, so merging is an explicit step
    rather than something the caller can be assumed to have done. Hatch
    boundaries and digit strokes live on these same layers and would make the
    chain unconsumable, so they are filtered out here.
    """
    warnings = warnings if warnings is not None else []
    pool: List[Any] = []
    for layer in sorted(segments_by_layer):
        for s in segments_by_layer[layer]:
            if getattr(s, "is_hatch", False):
                continue
            if s.length() <= 1e-9:
                continue
            try:
                if getattr(s, "layer_name", None) is None:
                    s.layer_name = layer
            except Exception:
                pass
            pool.append(s)

    if not pool:
        return pool

    keep, discriminative = _strand_segment_indices(pool)
    if not keep:
        return pool
    if not discriminative:
        # Cable and digits share a colour, so the only separator left is raw
        # length — which keeps the long runs but throws away every short corner
        # piece, shattering the path at each bend. Keeping everything and
        # letting the chainer cope is the lesser evil.
        warnings.append(
            Note(
                "digit_filter_unavailable",
                "Cable and text share a colour on the cable layers, so digit strokes could not be separated.",
                {"segments": len(pool)},
            )
        )
        return pool

    dropped = len(pool) - len(keep)
    if dropped:
        warnings.append(
            Note(
                "segments_filtered",
                f"Excluded {dropped} non-strand segments (digits/symbols) from the cable layers.",
                {"dropped": dropped, "kept": len(keep)},
            )
        )
    return [pool[i] for i in sorted(keep)]


def _strand_segment_indices(segments: Sequence[Any]) -> Tuple[set, bool]:
    """Indices of the strand linework, plus whether colour was discriminative.

    Mirrors ``server.cable_segment_indices`` so this module and the digit
    pipeline agree on what counts as cable. The caller reads an empty set, or
    ``discriminative=False``, as "keep everything".
    """
    lens = [s.length() for s in segments if s.length() > 1e-9]
    if not lens:
        return set(), False
    med = _median(lens)
    if med <= 0:
        return set(), False
    seeds = [i for i, s in enumerate(segments) if s.length() > CABLE_SEG_FACTOR * med]
    if not seeds:
        return set(), False

    cable_color, _ = Counter(
        getattr(segments[i], "color", 256) for i in seeds
    ).most_common(1)[0]
    same_color = {
        i for i, s in enumerate(segments) if getattr(s, "color", 256) == cable_color
    }
    if len(same_color) <= CABLE_COLOR_MINORITY * len(segments):
        return same_color, True
    return set(seeds), False


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — PATH STITCHING
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class _Fragment:
    """A run of segments that are physically connected in the drawing."""

    points: List[Tuple[float, float]]
    length: float
    index: int = 0

    @property
    def start(self) -> Tuple[float, float]:
        return self.points[0]

    @property
    def end(self) -> Tuple[float, float]:
        return self.points[-1]

    def reversed_(self) -> "_Fragment":
        return _Fragment(list(reversed(self.points)), self.length, self.index)


def _build_fragments(segments: Sequence[Any], weld_tol: float) -> List[_Fragment]:
    """Group touching segments into ordered polylines."""
    n = len(segments)
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    cell = max(weld_tol, 1e-9)

    def key(p: Tuple[float, float]) -> Tuple[int, int]:
        return (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)))

    endpoints: List[Tuple[int, Tuple[float, float]]] = []
    for i, s in enumerate(segments):
        endpoints.append((i, (s.x1, s.y1)))
        endpoints.append((i, (s.x2, s.y2)))

    grid: Dict[Tuple[int, int], List[Tuple[int, Tuple[float, float]]]] = {}
    for i, p in endpoints:
        grid.setdefault(key(p), []).append((i, p))

    for i, p in endpoints:
        kx, ky = key(p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j, q in grid.get((kx + dx, ky + dy), ()):
                    if j != i and _dist(p, q) <= weld_tol:
                        union(i, j)

    groups: Dict[int, List[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    fragments: List[_Fragment] = []
    for root in sorted(groups):
        pts = _walk_group([segments[i] for i in groups[root]], weld_tol)
        if len(pts) < 2:
            continue
        length = sum(_dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        if length <= 1e-12:
            continue
        fragments.append(_Fragment(pts, length))

    # Canonical order: longest first, then by position — the seed and every
    # tie-break downstream depend on this being total and input-order
    # independent.
    fragments.sort(key=lambda f: (-f.length, f.start[0], f.start[1], f.end[0], f.end[1]))
    for i, f in enumerate(fragments):
        f.index = i
    return fragments


def _walk_group(segs: Sequence[Any], weld_tol: float) -> List[Tuple[float, float]]:
    """Order one connected group's segments into a single point sequence."""
    if not segs:
        return []

    cell = max(weld_tol, 1e-9)

    def node(p: Tuple[float, float]) -> Tuple[int, int]:
        return (int(round(p[0] / cell)), int(round(p[1] / cell)))

    degree: Dict[Tuple[int, int], int] = {}
    for s in segs:
        for p in ((s.x1, s.y1), (s.x2, s.y2)):
            k = node(p)
            degree[k] = degree.get(k, 0) + 1

    candidates = [
        (s.x1, s.y1) for s in segs if degree.get(node((s.x1, s.y1)), 0) == 1
    ] + [(s.x2, s.y2) for s in segs if degree.get(node((s.x2, s.y2)), 0) == 1]
    if candidates:
        start = min(candidates)
    else:
        # Closed loop — no free end. Start at the lexicographically smallest
        # point so the walk is still deterministic.
        start = min(
            [(s.x1, s.y1) for s in segs] + [(s.x2, s.y2) for s in segs]
        )

    remaining = list(segs)
    pts = [start]
    cursor = start
    while remaining:
        best = None  # (distance, list index, next point)
        for i, s in enumerate(remaining):
            for a, b in (((s.x1, s.y1), (s.x2, s.y2)), ((s.x2, s.y2), (s.x1, s.y1))):
                d = _dist(cursor, a)
                if d <= weld_tol and (best is None or d < best[0]):
                    best = (d, i, b)
        if best is None:
            break
        remaining.pop(best[1])
        pts.append(best[2])
        cursor = best[2]
    return pts


def _outward_tangent(
    chain: Sequence[Tuple[float, float]], at_tail: bool
) -> Optional[Tuple[float, float]]:
    """Unit vector pointing out of the chain at one of its ends."""
    if len(chain) < 2:
        return None
    a, b = (chain[-2], chain[-1]) if at_tail else (chain[1], chain[0])
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    if n <= 1e-12:
        return None
    return dx / n, dy / n


def _continues_forward(
    tangent: Optional[Tuple[float, float]], dx: float, dy: float
) -> bool:
    """Is the next piece ahead of the chain rather than doubling back?

    The cable is drawn as dashes, so the next dash is always a short hop in
    roughly the direction of travel. A piece that sits behind or beside the tip
    belongs to something else — usually a second cable run drawn alongside.
    The tolerance is wide (about 110 degrees) so that corners in the route still
    read as forward.
    """
    if tangent is None:
        return True
    n = math.hypot(dx, dy)
    if n <= 1e-12:
        return True
    return (tangent[0] * dx + tangent[1] * dy) / n > -0.34


def _point_at_length(
    pts: Sequence[Tuple[float, float]], target: float
) -> Tuple[float, float]:
    acc = 0.0
    for i in range(len(pts) - 1):
        d = _dist(pts[i], pts[i + 1])
        if acc + d >= target:
            u = (target - acc) / d if d > 0 else 0.0
            return (
                pts[i][0] + u * (pts[i + 1][0] - pts[i][0]),
                pts[i][1] + u * (pts[i + 1][1] - pts[i][1]),
            )
        acc += d
    return pts[-1]


def _parallel_span(
    frag: _Fragment, path: CablePath, tol: float
) -> Optional[Tuple[float, float]]:
    """If the fragment runs alongside the path, the (t0, t1) stretch it covers.

    Every sampled point must sit within ``tol`` of the path, and the samples
    must spread along it — a fragment that merely touches at one end is a
    continuation, not a second run.
    """
    if frag.length <= 0 or len(path.points) < 2:
        return None
    ts: List[float] = []
    for k in range(PARALLEL_SAMPLES):
        target = frag.length * k / (PARALLEL_SAMPLES - 1)
        p = _point_at_length(frag.points, target)
        t, d = project_point_onto_path(p[0], p[1], path)
        if d > tol:
            return None
        ts.append(t)
    t0, t1 = min(ts), max(ts)
    if t1 - t0 < 0.5 * frag.length:
        return None
    return t0, t1


def _doubles_back(
    frag: _Fragment, path: CablePath, tol: float, end_margin: float
) -> bool:
    """Would taking this fragment re-cover ground the chain already holds?

    The next dash in a route always projects onto the *tip* of the chain built
    so far. A second cable drawn alongside projects into its middle. That is the
    difference between a continuation and a parallel run, and it is the one test
    that does not misfire on a winding dashed route — unlike judging by distance
    alone, which reads the very next dash as parallel.
    """
    if len(path.points) < 2 or path.total_length <= 0:
        return False
    interior = 0
    for k in range(PARALLEL_SAMPLES):
        target = frag.length * k / (PARALLEL_SAMPLES - 1)
        p = _point_at_length(frag.points, target)
        t, d = project_point_onto_path(p[0], p[1], path)
        if d > tol:
            return False
        if end_margin <= t <= path.total_length - end_margin:
            interior += 1
    return interior * 2 > PARALLEL_SAMPLES


def _bridge_limit(
    fragments: Sequence[_Fragment], med_seg: float, pole_spacing: float
) -> float:
    """How far the chain may jump to reach the next fragment.

    The anchor is pole spacing, which is independent of the gaps being policed.
    Calibrating purely on the gap distribution is self-defeating: with two clean
    runs there is exactly one gap, its own median admits it, and the two runs
    fuse silently. Gap statistics may only tighten this anchor.
    """
    anchor = (
        pole_spacing * BRIDGE_POLE_SPACING_CAP
        if pole_spacing > 0
        else med_seg * BRIDGE_FLOOR_FACTOR
    )
    gaps = _fragment_gaps(fragments)
    if len(gaps) >= MIN_GAPS_FOR_MEDIAN:
        med_gap = _median(gaps)
        if med_gap > 0:
            return min(anchor, BRIDGE_GAP_FACTOR * med_gap)
    return anchor


def _fragment_gaps(fragments: Sequence[_Fragment]) -> List[float]:
    """Nearest-neighbour distance from each fragment end to any other fragment."""
    ends: List[Tuple[int, Tuple[float, float]]] = []
    for f in fragments:
        ends.append((f.index, f.start))
        ends.append((f.index, f.end))
    gaps: List[float] = []
    for i, p in ends:
        best = min((_dist(p, q) for j, q in ends if j != i), default=float("inf"))
        if best < float("inf"):
            gaps.append(best)
    return gaps


def build_cable_path(
    segments: Sequence[Any],
    pole_spacing: float = 0.0,
    warnings: Optional[List[Note]] = None,
    errors: Optional[List[Note]] = None,
) -> Tuple[Optional[CablePath], List[_Fragment]]:
    """Chain strand linework into one ordered path.

    Returns the path and any fragments left over. Leftovers are *not* an error
    yet — they may be parallel cable runs, which only the completed path can
    confirm. ``classify_parallel_runs`` makes that call.
    """
    warnings = warnings if warnings is not None else []
    errors = errors if errors is not None else []

    if not segments:
        errors.append(Note("no_segments", "No cable linework found on the cable layers."))
        return None, []

    med_seg = _median([s.length() for s in segments])
    weld_tol = max(med_seg * WELD_FACTOR, 1e-9)

    fragments = _build_fragments(segments, weld_tol)
    if not fragments:
        errors.append(
            Note("no_fragments", "Cable linework could not be ordered into polylines.")
        )
        return None, []

    limit = _bridge_limit(fragments, med_seg, pole_spacing)
    parallel_tol = (
        pole_spacing * PARALLEL_TOL_FACTOR if pole_spacing > 0 else med_seg * 2.0
    )

    chain = list(fragments[0].points)
    used = {fragments[0].index}
    deferred: set = set()
    bridges: List[int] = []
    accepted_gaps: List[float] = []

    while True:
        head, tail = chain[0], chain[-1]
        tail_tangent = _outward_tangent(chain, at_tail=True)
        head_tangent = _outward_tangent(chain, at_tail=False)
        best = None  # (gap, frag index, at_end, oriented)

        for frag in fragments:
            if frag.index in used or frag.index in deferred:
                continue
            for oriented in (frag, frag.reversed_()):
                d_tail = _dist(tail, oriented.start)
                if d_tail <= weld_tol or _continues_forward(
                    tail_tangent,
                    oriented.start[0] - tail[0],
                    oriented.start[1] - tail[1],
                ):
                    cand = (d_tail, frag.index, True, oriented)
                    if best is None or cand[:2] < best[:2]:
                        best = cand
                d_head = _dist(head, oriented.end)
                if d_head <= weld_tol or _continues_forward(
                    head_tangent,
                    oriented.end[0] - head[0],
                    oriented.end[1] - head[1],
                ):
                    cand = (d_head, frag.index, False, oriented)
                    if best is None or cand[:2] < best[:2]:
                        best = cand

        if best is None or best[0] > limit:
            break

        gap, idx, at_end, oriented = best

        # Only the winning candidate is worth the projection test — running it
        # over every fragment on every step would dominate the runtime on a
        # drawing with a thousand dashes.
        if _doubles_back(
            fragments[idx],
            CablePath(points=chain, cum=_cumulative(chain)),
            parallel_tol,
            limit,
        ):
            deferred.add(idx)
            continue

        used.add(idx)
        welded = gap <= weld_tol
        if not welded:
            accepted_gaps.append(gap)

        if at_end:
            if not welded:
                bridges.append(len(chain) - 1)
            chain.extend(oriented.points[1:] if welded else oriented.points)
        else:
            prefix = list(oriented.points[:-1] if welded else oriented.points)
            bridges = [b + len(prefix) for b in bridges]
            if not welded:
                bridges.append(len(prefix) - 1)
            chain = prefix + chain

    # Canonical direction: the extremity with the smaller (x, y) is t = 0, so
    # the walk order — and therefore every pole_index and span_key — does not
    # depend on which end the chaining happened to start from.
    if (chain[-1][0], chain[-1][1]) < (chain[0][0], chain[0][1]):
        n = len(chain)
        chain = list(reversed(chain))
        bridges = sorted(n - 2 - b for b in bridges)

    path = CablePath(points=chain, cum=_cumulative(chain), bridges=sorted(bridges))

    if pole_spacing > 0:
        long_bridges = [g for g in accepted_gaps if g > BRIDGE_NOTICE_RATIO * pole_spacing]
        if long_bridges:
            warnings.append(
                Note(
                    "long_bridge",
                    f"Stitched {len(long_bridges)} wide gap(s) in the cable linework — check those stretches.",
                    {
                        "gaps": [round(g, 4) for g in sorted(long_bridges, reverse=True)],
                        "bridge_limit": round(limit, 4),
                    },
                )
            )

    bridged = path.bridged_length()
    ratio = bridged / path.total_length if path.total_length > 0 else 0.0
    if ratio > MAX_BRIDGED_RATIO:
        errors.append(
            Note(
                "excessive_bridging",
                f"{ratio:.0%} of the stitched path is bridged gaps (limit {MAX_BRIDGED_RATIO:.0%}). "
                "The cable linework is too fragmented to trust.",
                {
                    "bridged_length": round(bridged, 4),
                    "total_length": round(path.total_length, 4),
                },
            )
        )
        return None, []
    if ratio > BRIDGED_RATIO_NOTICE:
        warnings.append(
            Note(
                "fragmented_linework",
                f"{ratio:.0%} of the cable had to be stitched across gaps — span lengths in those "
                "stretches are measured across the breaks.",
                {
                    "bridged_length": round(bridged, 4),
                    "total_length": round(path.total_length, 4),
                },
            )
        )

    if len(chain) > 2 and _dist(chain[0], chain[-1]) <= weld_tol:
        errors.append(
            Note(
                "closed_loop",
                "The cable forms a closed loop. Ring topology is outside the linear-chain model.",
                {"bbox": _bbox_of(chain)},
            )
        )
        return None, []

    leftovers = [f for f in fragments if f.index not in used]
    return path, leftovers


def parallel_tolerance(pole_spacing: float, med_seg: float) -> float:
    """How far off the line a second cable run may sit."""
    return pole_spacing * PARALLEL_TOL_FACTOR if pole_spacing > 0 else med_seg * 2.0


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — POLE PROJECTION
# ─────────────────────────────────────────────────────────────────────────────


def project_poles_onto_path(
    poles: Sequence[Dict[str, Any]],
    path: CablePath,
    warnings: Optional[List[Note]] = None,
) -> List[PolePosition]:
    """Place every pole on the path by arc length.

    Poles are drawn beside the cable, not on it, so the snap radius is measured
    from this drawing's own offset distribution instead of being a constant.
    Poles beyond it are excluded from the run and reported.
    """
    warnings = warnings if warnings is not None else []
    if not poles or not path or len(path.points) < 2:
        return []

    raw: List[Tuple[Dict[str, Any], float, float]] = []
    for p in poles:
        cx, cy = p.get("cx"), p.get("cy")
        if cx is None or cy is None:
            continue
        t, d = project_point_onto_path(float(cx), float(cy), path)
        raw.append((p, t, d))
    if not raw:
        return []

    offsets = [d for _, _, d in raw]
    if len(raw) >= SNAP_MIN_POLES:
        snap_radius = max(
            _median(offsets) * SNAP_MEDIAN_FACTOR,
            _percentile(offsets, 0.9) * SNAP_P90_FACTOR,
        )
    else:
        snap_radius = (path.total_length / max(1, len(raw))) * SNAP_SPACING_FALLBACK
    if snap_radius <= 0:
        snap_radius = max(offsets) if offsets else 0.0

    positions: List[PolePosition] = []
    excluded: List[Dict[str, Any]] = []
    for p, t, d in raw:
        pos = PolePosition(
            pole_id=p.get("pole_id"),
            name=p.get("name") or p.get("pole_name") or "",
            cx=float(p["cx"]),
            cy=float(p["cy"]),
            t=t,
            offset=d,
            snapped=d <= snap_radius,
        )
        positions.append(pos)
        if not pos.snapped:
            excluded.append(
                {"pole_id": pos.pole_id, "name": pos.name, "offset": round(d, 4)}
            )

    if excluded:
        warnings.append(
            Note(
                "poles_off_path",
                f"{len(excluded)} pole(s) sit further than {snap_radius:.3f} from the cable and were left out of the run.",
                {"poles": excluded, "snap_radius": round(snap_radius, 6)},
            )
        )
    return positions


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — PARALLEL RUNS
# ─────────────────────────────────────────────────────────────────────────────


def classify_parallel_runs(
    leftovers: Sequence[_Fragment],
    path: CablePath,
    parallel_tol: float,
    min_run_length: float = 0.0,
    warnings: Optional[List[Note]] = None,
    errors: Optional[List[Note]] = None,
) -> CablePath:
    """Decide what the unchained fragments are.

    Multi-run cable is drawn as a second line beside the first. Whether a
    fragment is that, or the start of an entirely separate cable run, can only
    be judged against the *completed* path — judging it mid-chain misreads the
    next dash in the route as a parallel line. This is the sole source of
    ``number_of_runs`` now that the manual pairing tool is gone.
    """
    warnings = warnings if warnings is not None else []
    errors = errors if errors is not None else []
    if not leftovers:
        return path

    ignorable = IGNORABLE_FRAGMENT_RATIO * path.total_length
    alongside: List[Tuple[float, float]] = []
    unconsumed: List[_Fragment] = []
    stray: List[_Fragment] = []
    for frag in leftovers:
        interval = _parallel_span(frag, path, parallel_tol)
        if interval is not None:
            alongside.append(interval)
        elif frag.length <= ignorable:
            # Too short to be a cable run — leader lines, text the digit filter
            # could not separate, stray marks. Blocking the upload over these
            # would be wrong, and calling them "a second run" would be a lie.
            stray.append(frag)
        else:
            unconsumed.append(frag)

    # A second cable run is a *length* of cable. Individual dashes of one merge
    # into a long stretch; a lone unchained dash of the main run does not, and
    # must not inflate number_of_runs.
    runs = _merge_run_intervals(alongside, min_run_length)
    covered = [(a, b) for a, b, _ in runs]
    orphan_alongside = sum(
        1 for t0, t1 in alongside if not any(a <= t0 and t1 <= b for a, b in covered)
    )

    if stray or orphan_alongside:
        warnings.append(
            Note(
                "ignored_linework",
                f"Ignored {len(stray) + orphan_alongside} short piece(s) of linework on the cable "
                "layers that are not part of the run.",
                {
                    "count": len(stray) + orphan_alongside,
                    "total_length": round(sum(f.length for f in stray), 4),
                },
            )
        )

    if unconsumed:
        errors.append(
            Note(
                "not_chainable",
                f"The cable linework forms {len(unconsumed) + 1} separate runs. This drawing has more "
                "than one cable run, which is outside the linear-chain model — split it into one node per run.",
                {
                    "components": [_bbox_of(f.points) for f in unconsumed],
                    "unconsumed_fragments": len(unconsumed),
                },
            )
        )
        return path

    path.runs = runs
    if runs:
        warnings.append(
            Note(
                "parallel_runs",
                f"Detected {len(runs)} stretch(es) of parallel cable — those spans upload with more than one run.",
                {"runs": [[round(a, 4), round(b, 4), c] for a, b, c in runs]},
            )
        )
    return path


def _merge_run_intervals(
    intervals: Sequence[Tuple[float, float]], min_run_length: float
) -> List[Tuple[float, float, int]]:
    """Merge alongside-stretches into runs, counting how many lines stack up.

    Overlap depth is the run count: three lines side by side over one stretch is
    three extra runs, not three separate one-run stretches.
    """
    if not intervals:
        return []

    events: List[Tuple[float, int]] = []
    for t0, t1 in intervals:
        events.append((t0, 1))
        events.append((t1, -1))
    events.sort()

    merged: List[Tuple[float, float, int]] = []
    depth = 0
    start = 0.0
    peak = 0
    for t, delta in events:
        if depth == 0:
            start = t
            peak = 0
        depth += delta
        peak = max(peak, depth)
        if depth == 0:
            if t - start >= min_run_length:
                merged.append((start, t, peak))
    return merged


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — SPAN DERIVATION
# ─────────────────────────────────────────────────────────────────────────────


def pole_index(order: int) -> str:
    """Walk-order label. Zero-padded so lexicographic order matches walk order."""
    return f"POLE-{order:04d}"


def make_span_key(index_a: str, index_b: str) -> str:
    """Direction-free span identity. Same drawing, same key, every derivation."""
    lo, hi = (index_a, index_b) if index_a <= index_b else (index_b, index_a)
    return f"{lo}::{hi}"


def derive_spans(
    positions: Sequence[PolePosition],
    path: CablePath,
    layer: Optional[str] = None,
    warnings: Optional[List[Note]] = None,
    errors: Optional[List[Note]] = None,
) -> List[DerivedSpan]:
    """Consecutive poles along the path become spans. N poles -> N-1 spans."""
    warnings = warnings if warnings is not None else []
    errors = errors if errors is not None else []

    on_path = [p for p in positions if p.snapped]
    if len(on_path) < 2:
        errors.append(
            Note(
                "insufficient_poles",
                f"Only {len(on_path)} pole(s) could be placed on the cable — at least 2 are needed to form a span.",
                {"poles_on_path": len(on_path)},
            )
        )
        return []

    # Total ordering: arc length, then offset, then id — nothing left to chance,
    # so the same inputs always produce the same walk order.
    ordered = sorted(on_path, key=lambda p: (p.t, p.offset, str(p.pole_id)))
    for i, p in enumerate(ordered):
        p.pole_index = pole_index(i + 1)

    spacings = [ordered[i + 1].t - ordered[i].t for i in range(len(ordered) - 1)]
    # Calibrate on the median, not the minimum: the minimum is realised by the
    # very pair under test, which would make the check vacuous.
    same_t_threshold = _median([s for s in spacings if s > 0]) * SAME_T_FACTOR

    spans: List[DerivedSpan] = []
    for i in range(len(ordered) - 1):
        a, b = ordered[i], ordered[i + 1]
        arc = b.t - a.t

        if same_t_threshold > 0 and arc < same_t_threshold:
            warnings.append(
                Note(
                    "duplicate_pole_suspected",
                    f"Poles '{a.name}' and '{b.name}' sit almost on top of each other on the cable.",
                    {"pole_a": a.name, "pole_b": b.name, "arc_length": round(arc, 6)},
                )
            )

        segs = slice_path(path, a.t, b.t)
        if segs:
            pts = [(s["x1"], s["y1"]) for s in segs]
            pts.append((segs[-1]["x2"], segs[-1]["y2"]))
        else:
            pts = [(a.cx, a.cy), (b.cx, b.cy)]
        bbox = _bbox_of(pts)

        spans.append(
            DerivedSpan(
                span_key=make_span_key(a.pole_index, b.pole_index),
                from_pole_index=a.pole_index,
                to_pole_index=b.pole_index,
                from_ref=_pole_ref(a),
                to_ref=_pole_ref(b),
                t_start=a.t,
                t_end=b.t,
                arc_length=arc,
                strand_length=arc,
                length_source="arc_length",
                cable_runs=path.runs_at(a.t, b.t),
                segments=segs,
                cx=(bbox[0] + bbox[2]) / 2.0,
                cy=(bbox[1] + bbox[3]) / 2.0,
                bbox=bbox,
                layer=layer,
                span_id=i,
            )
        )

    med_span = _median([s.arc_length for s in spans])
    if med_span > 0:
        degenerate = [s for s in spans if s.arc_length < MIN_SPAN_RATIO * med_span]
        if degenerate:
            errors.append(
                Note(
                    "degenerate_span",
                    f"{len(degenerate)} span(s) are effectively zero length — resolve the duplicate poles first.",
                    {"span_keys": [s.span_key for s in degenerate]},
                )
            )

    if len(spans) != len(ordered) - 1:
        errors.append(
            Note(
                "span_count_invariant",
                f"Derived {len(spans)} spans from {len(ordered)} poles; expected {len(ordered) - 1}.",
                {"poles": len(ordered), "spans": len(spans)},
            )
        )

    dupes = [k for k, c in Counter(s.span_key for s in spans).items() if c > 1]
    if dupes:
        errors.append(
            Note(
                "duplicate_span_key",
                "The same span was derived more than once — this is a derivation bug, not a drawing problem.",
                {"span_keys": dupes},
            )
        )
    return spans


def _pole_ref(p: PolePosition) -> Dict[str, Any]:
    return {
        "pole_id": p.pole_id,
        "name": p.name,
        "pole_index": p.pole_index,
        "cx": round(p.cx, 6),
        "cy": round(p.cy, 6),
        "t": round(p.t, 6),
        "offset": round(p.offset, 6),
    }


# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — LENGTHS
# ─────────────────────────────────────────────────────────────────────────────


def assign_lengths(
    spans: List[DerivedSpan],
    ocr_values: Sequence[Dict[str, Any]],
    path: CablePath,
    warnings: Optional[List[Note]] = None,
    max_match_dist: Optional[float] = None,
) -> List[DerivedSpan]:
    """Attach each OCR'd strand length to the span whose sub-path it labels.

    The old matcher compared a value against a cluster's centroid, which drifts
    badly when the cluster is only a fragment of the real span. Matching against
    the sub-path is what lets a span that was drawn in pieces still find its own
    number.
    """
    warnings = warnings if warnings is not None else []
    if not spans or not ocr_values:
        return spans

    if max_match_dist is None:
        max_match_dist = _median([s.arc_length for s in spans]) * OCR_MATCH_FACTOR

    numeric: List[Tuple[int, float, float, float]] = []
    for vi, r in enumerate(ocr_values):
        raw = r.get("corrected_value") or r.get("value")
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        vx, vy = r.get("center_x"), r.get("center_y")
        if vx is None or vy is None:
            continue
        numeric.append((vi, float(vx), float(vy), value))

    # Score every (value, span) pair, then assign best-first so one value cannot
    # claim two spans and one span cannot collect two values.
    candidates: List[Tuple[float, int, int, float]] = []
    for vi, vx, vy, value in numeric:
        t, _ = project_point_onto_path(vx, vy, path)
        for si, span in enumerate(spans):
            d = _distance_to_span(vx, vy, span, t)
            if d <= max_match_dist:
                candidates.append((d, vi, si, value))
    candidates.sort(key=lambda c: (c[0], c[1], c[2]))

    used_values: set = set()
    used_spans: set = set()
    for _, vi, si, value in candidates:
        if vi in used_values or si in used_spans:
            continue
        used_values.add(vi)
        used_spans.add(si)
        spans[si].strand_length = value
        spans[si].length_source = "ocr"

    unlabelled = [s.span_key for i, s in enumerate(spans) if i not in used_spans]
    if unlabelled:
        warnings.append(
            Note(
                "span_without_meter_value",
                f"{len(unlabelled)} span(s) had no strand length nearby — their length is measured off the drawing instead.",
                {"span_keys": unlabelled},
            )
        )

    orphans = [vi for vi, _, _, _ in numeric if vi not in used_values]
    if orphans:
        warnings.append(
            Note(
                "orphan_meter_value",
                f"{len(orphans)} strand length(s) could not be matched to any span.",
                {"count": len(orphans)},
            )
        )
    return spans


def _distance_to_span(px: float, py: float, span: DerivedSpan, t: float) -> float:
    """Distance from a point to a span's sub-path.

    The arc-length position acts as a gate: a value that projects outside this
    span's stretch of cable is not its label, however close it happens to sit to
    a bend in the line.
    """
    if t < span.t_start:
        outside = span.t_start - t
    elif t > span.t_end:
        outside = t - span.t_end
    else:
        outside = 0.0
    best = min(
        (
            _point_to_segment(px, py, s["x1"], s["y1"], s["x2"], s["y2"])[0]
            for s in span.segments
        ),
        default=float("inf"),
    )
    if best == float("inf"):
        return float("inf")
    return math.hypot(best, outside)


# ─────────────────────────────────────────────────────────────────────────────
# ORCHESTRATOR
# ─────────────────────────────────────────────────────────────────────────────


def build_node_spans(
    segments_by_layer: Dict[str, List[Any]],
    poles: Sequence[Dict[str, Any]],
    ocr_values: Sequence[Dict[str, Any]] = (),
) -> SpanBuildResult:
    """Derive one node's spans from its drawing.

    ``segments_by_layer`` maps each cable layer to the segments extracted from
    it (call ``extract_stroke_segments(doc, layer, include_circles=False)``).
    ``poles`` are the detected pole tags: ``pole_id``, ``name``, ``cx``, ``cy``.
    """
    result = SpanBuildResult()

    segments = prepare_segments(segments_by_layer, result.warnings)
    if not segments:
        result.errors.append(
            Note("no_segments", "No cable linework found on the cable layers.")
        )
        return result

    # Pole spacing anchors both the bridge limit and the parallel tolerance. It
    # comes from pole coordinates alone, so it is available before the path
    # exists — no circular dependency on the projection step.
    pole_spacing = _median_pole_spacing(poles)
    med_seg = _median([s.length() for s in segments])
    parallel_tol = parallel_tolerance(pole_spacing, med_seg)

    path, leftovers = build_cable_path(
        segments, pole_spacing, result.warnings, result.errors
    )
    if path is None:
        return result

    path = classify_parallel_runs(
        leftovers,
        path,
        parallel_tol,
        min_run_length=(
            pole_spacing * MIN_RUN_SPACING_RATIO
            if pole_spacing > 0
            else path.total_length * IGNORABLE_FRAGMENT_RATIO
        ),
        warnings=result.warnings,
        errors=result.errors,
    )
    if result.errors:
        return result
    result.path = path

    result.poles = project_poles_onto_path(poles, path, result.warnings)

    layer = getattr(segments[0], "layer_name", None)
    result.spans = derive_spans(
        result.poles, path, layer=layer, warnings=result.warnings, errors=result.errors
    )
    if not result.spans:
        return result

    assign_lengths(result.spans, ocr_values, path, result.warnings)
    return result


def _median_pole_spacing(poles: Sequence[Dict[str, Any]]) -> float:
    """Typical distance between a pole and its nearest neighbour."""
    pts = [
        (float(p["cx"]), float(p["cy"]))
        for p in poles
        if p.get("cx") is not None and p.get("cy") is not None
    ]
    if len(pts) < 2:
        return 0.0
    nn: List[float] = []
    for i, a in enumerate(pts):
        best = min((_dist(a, b) for j, b in enumerate(pts) if i != j), default=float("inf"))
        if best < float("inf"):
            nn.append(best)
    return _median(nn)


def serialize_spans_for_export(result: SpanBuildResult) -> List[Dict[str, Any]]:
    """The one shape both export paths consume.

    Planner and AsBuilt built their payloads separately before, which is why the
    same drawing could upload different totals to each. They read this instead.
    """
    return [s.to_dict() for s in result.spans]
