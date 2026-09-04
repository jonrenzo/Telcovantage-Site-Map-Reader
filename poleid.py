import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np


@dataclass
class TextLabel:
    text: str
    x: float
    y: float
    height: float
    bbox: Optional[Tuple[float, float, float, float]] = None
    source: str = "text"
    # The label's own strokes. Without these, OCR callers fall back to
    # rasterising the whole layer around the bbox, which drags the pole circle
    # and neighbouring labels into every crop.
    segments: List["Seg"] = field(default_factory=list)
    # DXF layer this label's own geometry came from. A drafter can split a
    # pole's marker (circle) and its tag (text) across two different layers
    # that happen to share a naming pattern like "...POLE NUMBER" and
    # "...POLEPED" — callers matching across several pooled layers need this
    # to know which layer to re-query for a fallback OCR crop.
    layer: str = ""


@dataclass
class CircleMarker:
    x: float
    y: float
    r: float
    layer: str = ""


@dataclass
class Seg:
    x1: float
    y1: float
    x2: float
    y2: float
    layer: str = ""

    def p1(self) -> Tuple[float, float]:
        return (self.x1, self.y1)

    def p2(self) -> Tuple[float, float]:
        return (self.x2, self.y2)

    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)


@dataclass
class PoleIdConfig:
    # CAD text support
    include_text: bool = True
    include_mtext: bool = True
    filter_text_by_regex: bool = True

    # Stroke-based pole-name support
    include_stroke: bool = True
    stroke_connect_tol: float = 0.20
    stroke_min_total_length: float = 0.30
    stroke_min_segments: int = 4
    stroke_min_bbox_w: float = 0.05
    stroke_min_bbox_h: float = 0.05
    stroke_max_aspect: float = 20.0
    stroke_max_dom_dir: float = 0.97
    stroke_max_endpoints: int = 24
    stroke_placeholder_prefix: str = "POLE"
    # Some drawings draw every character of a label as its own disconnected
    # polyline — a gap wider than stroke_connect_tol but still clearly one
    # word. See _merge_baseline_clusters.
    stroke_baseline_merge: bool = True
    stroke_baseline_valign_factor: float = 0.5
    stroke_baseline_gap_factor: float = 1.5

    # Circle handling
    use_circle_markers: bool = False
    require_circle_match: bool = False
    max_dist_factor: float = 4.0
    default_text_height: float = 0.25


# Prefixes vary per site (IML, CUB, CVSY, ...) with no fixed length rule; the
# old two-letter cap silently dropped valid 3+-letter-prefix IDs like
# "IML-115" before they ever reached circle-matching. Mirrors the fix already
# applied to app_python/services/pole_ocr.py's _POLEID_RE — including the
# optional hyphen between the letter prefix and the number, without which
# "IML-115"/"CUB-508" still wouldn't match (the letters run straight into
# "-", not into a digit).
_POLEID_RE = re.compile(r"^(?:NPT|[A-Z]{0,5}-?\d+(?:-\d+)?)$", re.IGNORECASE)


def clean_label(s: str) -> str:
    s = (s or "").strip()
    s = s.replace("\\P", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def is_pole_id(s: str) -> bool:
    return bool(_POLEID_RE.match(clean_label(s)))


def _iter_spaces(doc):
    yield doc.modelspace()
    for layout in doc.layouts:
        if layout.name.lower() != "model":
            yield layout


def _layer_entities(doc, layer_name: str) -> List[Any]:
    out: List[Any] = []
    for space in _iter_spaces(doc):
        for e in space:
            if getattr(e.dxf, "layer", None) == layer_name:
                out.append(e)
    return out


def _estimate_text_bbox(x: float, y: float, text: str, h: float) -> Tuple[float, float, float, float]:
    hh = max(h, 0.25)
    ww = max(hh * 0.6, len(text) * hh * 0.6)
    return (x, y - 0.5 * hh, x + ww, y + 0.5 * hh)


def extract_text_labels_from_entities(
    entities: List[Any],
    *,
    include_text: bool = True,
    include_mtext: bool = True,
) -> List[TextLabel]:
    labels: List[TextLabel] = []
    for e in entities:
        t = e.dxftype()

        if t == "TEXT" and include_text:
            txt = clean_label(e.dxf.text)
            if not txt:
                continue
            ins = e.dxf.insert
            h = float(getattr(e.dxf, "height", 0.0) or 0.0)
            x = float(ins.x)
            y = float(ins.y)
            labels.append(
                TextLabel(
                    txt,
                    x,
                    y,
                    h,
                    bbox=_estimate_text_bbox(x, y, txt, h),
                    source="text",
                    layer=str(getattr(e.dxf, "layer", "") or ""),
                )
            )

        elif t == "MTEXT" and include_mtext:
            try:
                txt = clean_label(e.text)
            except Exception:
                txt = clean_label(getattr(e.dxf, "text", "") or "")
            if not txt:
                continue
            ins = e.dxf.insert
            h = float(getattr(e.dxf, "char_height", 0.0) or 0.0)
            x = float(ins.x)
            y = float(ins.y)
            labels.append(
                TextLabel(
                    txt,
                    x,
                    y,
                    h,
                    bbox=_estimate_text_bbox(x, y, txt, h),
                    source="mtext",
                    layer=str(getattr(e.dxf, "layer", "") or ""),
                )
            )

    return labels


def _approx_circle_from_closed_poly(
    pts: List[Tuple[float, float]],
    min_vertices: int = 8,
    max_radius_rel_std: float = 0.15,
) -> Optional[Tuple[float, float, float]]:
    """(cx, cy, r) if a closed polygon's vertices approximate a circle.

    Some drawings draw a pole's circle marker as a many-sided closed
    LWPOLYLINE (a drafting-software circle approximation) instead of a true
    CIRCLE entity — invisible to a CIRCLE-only scan, so that pole's marker
    (and anything matched to it) silently didn't exist as far as the matcher
    was concerned. A regular polygon with enough vertices and a tight,
    near-constant centroid distance reads as a circle; anything with sharp
    corners or few vertices (a rectangle, a triangle, real linework) does
    not.
    """
    n = len(pts)
    if n < min_vertices:
        return None
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    dists = [math.hypot(p[0] - cx, p[1] - cy) for p in pts]
    mean_r = sum(dists) / n
    if mean_r < 1e-9:
        return None
    variance = sum((d - mean_r) ** 2 for d in dists) / n
    rel_std = math.sqrt(variance) / mean_r
    if rel_std > max_radius_rel_std:
        return None
    return (cx, cy, mean_r)


def extract_circle_markers_from_entities(entities: List[Any]) -> List[CircleMarker]:
    circles: List[CircleMarker] = []
    for e in entities:
        t = e.dxftype()
        if t == "CIRCLE":
            c = e.dxf.center
            r = float(e.dxf.radius)
            circles.append(
                CircleMarker(
                    float(c.x),
                    float(c.y),
                    r,
                    layer=str(getattr(e.dxf, "layer", "") or ""),
                )
            )
        elif t == "LWPOLYLINE" and bool(e.closed):
            pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")]
            approx = _approx_circle_from_closed_poly(pts)
            if approx:
                cx, cy, r = approx
                circles.append(
                    CircleMarker(cx, cy, r, layer=str(getattr(e.dxf, "layer", "") or ""))
                )
        elif t == "POLYLINE" and bool(e.is_closed):
            pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
            approx = _approx_circle_from_closed_poly(pts)
            if approx:
                cx, cy, r = approx
                circles.append(
                    CircleMarker(cx, cy, r, layer=str(getattr(e.dxf, "layer", "") or ""))
                )
    return circles


def match_poleids_to_circles(
    labels: List[TextLabel],
    circles: List[CircleMarker],
    max_dist_factor: float = 4.0,
    default_text_height: float = 0.25,
) -> List[Tuple[TextLabel, Optional[CircleMarker]]]:
    """Pair each label with the circle it names.

    Exclusive greedy assignment: every (label, circle) pair within the
    distance gate is a candidate, closest first, and a candidate is only
    taken if neither side has already been claimed. A plain nearest-circle-
    per-label match lets two different poles' circles and labels cross-match
    in a tight cluster (e.g. a circle-with-X sitting next to a plain circle),
    which then reads as two circles sharing one name downstream. Exclusivity
    prevents that: once a circle is claimed by its true nearest label, it's
    no longer available to a second, more distant label.
    """
    if not circles:
        return [(lab, None) for lab in labels]

    candidates: List[Tuple[float, int, int]] = []
    for li, lab in enumerate(labels):
        th = lab.height if lab.height > 1e-9 else default_text_height
        for ci, c in enumerate(circles):
            # Nearest point on the label's own bbox, not its centroid — a
            # wide multi-character word's centroid sits proportionally
            # farther from an adjacent marker than a short one's would,
            # which under-counted a label's true (edge) distance to the
            # circle it names as its width grew.
            if lab.bbox is not None:
                bx0, by0, bx1, by1 = lab.bbox
                dx = max(bx0 - c.x, 0.0, c.x - bx1)
                dy = max(by0 - c.y, 0.0, c.y - by1)
            else:
                dx = lab.x - c.x
                dy = lab.y - c.y
            d2 = dx * dx + dy * dy
            gate = max_dist_factor * max(th, c.r, 1e-6)
            if d2 <= gate * gate:
                candidates.append((d2, li, ci))

    candidates.sort(key=lambda t: t[0])

    assigned_label: Set[int] = set()
    assigned_circle: Set[int] = set()
    match: Dict[int, CircleMarker] = {}
    for d2, li, ci in candidates:
        if li in assigned_label or ci in assigned_circle:
            continue
        assigned_label.add(li)
        assigned_circle.add(ci)
        match[li] = circles[ci]

    return [(lab, match.get(li)) for li, lab in enumerate(labels)]


def match_poleids_to_circles_from_entities(
    *,
    entities: List[Any],
    max_dist_factor: float = 4.0,
    default_text_height: float = 0.25,
) -> List[Tuple[TextLabel, Optional[CircleMarker]]]:
    labels = extract_text_labels_from_entities(entities)
    labels = [lab for lab in labels if is_pole_id(lab.text)]
    circles = extract_circle_markers_from_entities(entities)
    return match_poleids_to_circles(
        labels=labels,
        circles=circles,
        max_dist_factor=max_dist_factor,
        default_text_height=default_text_height,
    )


def extract_text_labels(
    doc,
    layer_name: str,
    *,
    include_text: bool = True,
    include_mtext: bool = True,
) -> List[TextLabel]:
    return extract_text_labels_from_entities(
        _layer_entities(doc, layer_name),
        include_text=include_text,
        include_mtext=include_mtext,
    )


def extract_circle_markers(doc, layer_name: str) -> List[CircleMarker]:
    return extract_circle_markers_from_entities(_layer_entities(doc, layer_name))


def circle_polyline_xy(circ: CircleMarker, steps: int = 80):
    theta = np.linspace(0, 2 * np.pi, steps)
    xs = circ.x + circ.r * np.cos(theta)
    ys = circ.y + circ.r * np.sin(theta)
    return xs, ys


def _dist2(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return dx * dx + dy * dy


def _bbox_from_segments(segments: List[Seg], idxs: List[int]) -> Tuple[float, float, float, float]:
    xs = []
    ys = []
    for i in idxs:
        s = segments[i]
        xs.extend([s.x1, s.x2])
        ys.extend([s.y1, s.y2])
    if not xs or not ys:
        return (0.0, 0.0, 0.0, 0.0)
    return (min(xs), min(ys), max(xs), max(ys))


def _segmentize_polyline_points(pts: List[Tuple[float, float]], closed: bool) -> List[Seg]:
    segs: List[Seg] = []
    if len(pts) < 2:
        return segs
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        segs.append(Seg(x1, y1, x2, y2))
    if closed and len(pts) > 2:
        x1, y1 = pts[-1]
        x2, y2 = pts[0]
        segs.append(Seg(x1, y1, x2, y2))
    return segs


def _segment_intersection(
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    p3: Tuple[float, float],
    p4: Tuple[float, float],
) -> Optional[Tuple[float, float]]:
    """Intersection point of segments p1-p2 and p3-p4, or None if they don't cross."""
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    x4, y4 = p4
    d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(d) < 1e-12:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d
    u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / d
    if not (0.0 <= t <= 1.0 and 0.0 <= u <= 1.0):
        return None
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))


def _line_like_endpoints(e: Any) -> Optional[Tuple[Tuple[float, float], Tuple[float, float]]]:
    """(p1, p2) for a LINE, or a 2-vertex open LWPOLYLINE drawn as a line."""
    t = e.dxftype()
    if t == "LINE":
        return (
            (float(e.dxf.start.x), float(e.dxf.start.y)),
            (float(e.dxf.end.x), float(e.dxf.end.y)),
        )
    if t == "LWPOLYLINE" and not bool(e.closed):
        pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")]
        if len(pts) == 2:
            return (pts[0], pts[1])
    return None


def _circle_marker_polygon_ids(entities: List[Any]) -> Set[int]:
    """id() of closed LWPOLYLINE/POLYLINE entities that approximate a circle.

    Their ring segments aren't label lettering — excluded from the stroke
    pool the same way a true CIRCLE entity already is (see
    _extract_stroke_segments_from_entities), so a many-sided circle
    approximation doesn't get treated as (or merged into) candidate text.
    """
    ids: Set[int] = set()
    for e in entities:
        t = e.dxftype()
        if t == "LWPOLYLINE" and bool(e.closed):
            pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")]
        elif t == "POLYLINE" and bool(e.is_closed):
            pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
        else:
            continue
        if _approx_circle_from_closed_poly(pts):
            ids.add(id(e))
    return ids


def _circle_x_mark_line_ids(entities: List[Any], circles: List[CircleMarker]) -> Set[int]:
    """Line-like entities that form the "X" through a circle marker's center.

    A circle-with-X pole symbol is drawn as a circle (a true CIRCLE entity,
    or a many-sided closed polyline approximating one) plus two crossing
    lines (LINE entities, or 2-vertex open polylines drawn as a line).
    Those lines aren't the marker's name — they're part of the marker itself
    — but nothing in the DXF ties them to the circle, so left alone they
    fall into the generic stroke pool and can get unioned by proximity into
    a neighbouring label's cluster, corrupting its OCR. Excluding them here
    keeps the marker's own X out of every label's stroke cluster.
    """
    if not circles:
        return set()

    lines = [e for e in entities if _line_like_endpoints(e) is not None]
    if len(lines) < 2:
        return set()

    excluded: Set[int] = set()
    for circ in circles:
        center = (circ.x, circ.y)
        candidates = [
            e
            for e in lines
            if id(e) not in excluded
            and _dist2(
                tuple(
                    (a + b) / 2.0 for a, b in zip(*_line_like_endpoints(e))
                ),
                center,
            )
            <= (circ.r * 1.5) ** 2
        ]
        if len(candidates) < 2:
            continue

        found = False
        for i in range(len(candidates)):
            if found:
                break
            for j in range(i + 1, len(candidates)):
                a, b = candidates[i], candidates[j]
                p1, p2 = _line_like_endpoints(a)
                p3, p4 = _line_like_endpoints(b)

                pt = _segment_intersection(p1, p2, p3, p4)
                if pt is None or _dist2(pt, center) > (circ.r * 0.6) ** 2:
                    continue

                a_ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
                b_ang = math.atan2(p4[1] - p3[1], p4[0] - p3[0])
                diff = abs((a_ang - b_ang + math.pi) % (2 * math.pi) - math.pi)
                diff = min(diff, math.pi - diff)
                if diff < math.radians(30):
                    # Near-parallel lines crossing at the center aren't an X.
                    continue

                excluded.add(id(a))
                excluded.add(id(b))
                found = True
                break

    return excluded


def _extract_stroke_segments_from_entities(entities: List[Any]) -> List[Seg]:
    circles = extract_circle_markers_from_entities(entities)
    excluded_line_ids = _circle_x_mark_line_ids(entities, circles)
    excluded_line_ids |= _circle_marker_polygon_ids(entities)
    segments: List[Seg] = []

    def arc_steps_for(r: float, a0: float, a1: float) -> int:
        ang = abs(a1 - a0)
        arc_len = max(0.0, r * ang)
        return int(max(12, min(120, arc_len / 0.25)))

    def spline_steps_for_bbox(pts: List[Tuple[float, float]]) -> int:
        if len(pts) < 2:
            return 30
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        diag = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
        return int(max(20, min(160, diag / 0.20)))

    for e in entities:
        t = e.dxftype()

        if t in ("TEXT", "MTEXT", "CIRCLE"):
            # IMPORTANT:
            # CIRCLE is intentionally ignored for pole-name stroke recognition.
            continue

        layer = str(getattr(e.dxf, "layer", "") or "")
        before = len(segments)

        if t == "LINE":
            if id(e) in excluded_line_ids:
                continue
            p1 = e.dxf.start
            p2 = e.dxf.end
            segments.append(Seg(float(p1.x), float(p1.y), float(p2.x), float(p2.y)))

        elif t == "LWPOLYLINE":
            if id(e) in excluded_line_ids:
                continue
            pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")]
            segments.extend(_segmentize_polyline_points(pts, closed=bool(e.closed)))

        elif t == "POLYLINE":
            if id(e) in excluded_line_ids:
                continue
            pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
            segments.extend(_segmentize_polyline_points(pts, closed=bool(e.is_closed)))

        elif t == "ARC":
            c = e.dxf.center
            r = float(e.dxf.radius)
            a0 = math.radians(float(e.dxf.start_angle))
            a1 = math.radians(float(e.dxf.end_angle))
            if a1 < a0:
                a1 += 2 * math.pi
            steps = arc_steps_for(r, a0, a1)
            angles = np.linspace(a0, a1, steps)
            pts = [(float(c.x) + r * math.cos(a), float(c.y) + r * math.sin(a)) for a in angles]
            segments.extend(_segmentize_polyline_points(pts, closed=False))

        elif t == "SPLINE":
            try:
                from ezdxf.math import BSpline

                bs = BSpline.from_spline(e)
                ts0 = np.linspace(0, 1, 12)
                rough = [(float(p.x), float(p.y)) for p in (bs.point(t) for t in ts0)]
                steps = spline_steps_for_bbox(rough)
                ts = np.linspace(0, 1, steps)
                pts = [(float(p.x), float(p.y)) for p in (bs.point(t) for t in ts)]
                segments.extend(_segmentize_polyline_points(pts, closed=False))
            except Exception:
                pass

        for s in segments[before:]:
            s.layer = layer

    return [s for s in segments if s.length() > 1e-12]


def _cluster_segments(segments: List[Seg], tol: float) -> List[List[int]]:
    if not segments:
        return []

    tol2 = tol * tol
    cell_size = max(tol, 1e-12)

    def cell_key(p):
        return (int(math.floor(p[0] / cell_size)), int(math.floor(p[1] / cell_size)))

    grid: Dict[Tuple[int, int], List[Tuple[int, Tuple[float, float]]]] = {}
    endpoints = []
    for i, s in enumerate(segments):
        endpoints.append((i, s.p1()))
        endpoints.append((i, s.p2()))

    for seg_i, p in endpoints:
        grid.setdefault(cell_key(p), []).append((seg_i, p))

    adj: List[Set[int]] = [set() for _ in range(len(segments))]
    neighbor_cells = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]

    for seg_i, p in endpoints:
        ck = cell_key(p)
        for dx, dy in neighbor_cells:
            nk = (ck[0] + dx, ck[1] + dy)
            for seg_j, q in grid.get(nk, []):
                if seg_j == seg_i:
                    continue
                if _dist2(p, q) <= tol2:
                    adj[seg_i].add(seg_j)
                    adj[seg_j].add(seg_i)

    visited = [False] * len(segments)
    clusters: List[List[int]] = []
    for i in range(len(segments)):
        if visited[i]:
            continue
        stack = [i]
        visited[i] = True
        comp = []
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nb in adj[cur]:
                if not visited[nb]:
                    visited[nb] = True
                    stack.append(nb)
        clusters.append(comp)

    return clusters


def _cluster_complexity(segments: List[Seg], idxs: List[int]) -> float:
    ang = []
    for i in idxs:
        s = segments[i]
        dx = s.x2 - s.x1
        dy = s.y2 - s.y1
        if abs(dx) < 1e-12 and abs(dy) < 1e-12:
            continue
        a = math.atan2(dy, dx)
        a = (a + math.pi) % math.pi
        ang.append(a)

    if len(ang) <= 1:
        return 0.0

    c = sum(math.cos(2 * a) for a in ang) / len(ang)
    s = sum(math.sin(2 * a) for a in ang) / len(ang)
    r = math.hypot(c, s)
    return 1.0 - r


def _dominant_direction_ratio(segments: List[Seg], idxs: List[int], bins: int = 12) -> float:
    hist = [0] * bins
    n = 0
    for i in idxs:
        s = segments[i]
        dx = s.x2 - s.x1
        dy = s.y2 - s.y1
        if abs(dx) < 1e-12 and abs(dy) < 1e-12:
            continue
        a = math.atan2(dy, dx)
        a = (a + math.pi) % math.pi
        b = int((a / math.pi) * bins) % bins
        hist[b] += 1
        n += 1
    if n == 0:
        return 1.0
    return max(hist) / n


def _endpoint_count(segments: List[Seg], idxs: List[int], tol: float) -> int:
    tol = max(tol, 1e-12)
    tol2 = tol * tol
    cell = tol

    def key(p):
        return (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)))

    pts: List[Tuple[float, float]] = []
    for i in idxs:
        s = segments[i]
        pts.append(s.p1())
        pts.append(s.p2())

    if not pts:
        return 0

    grid: Dict[Tuple[int, int], List[int]] = {}
    for pi, p in enumerate(pts):
        grid.setdefault(key(p), []).append(pi)

    neighbor_cells = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]

    parent = list(range(len(pts)))
    size = [1] * len(pts)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if size[ra] < size[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        size[ra] += size[rb]

    for pi, p in enumerate(pts):
        ck = key(p)
        for dx, dy in neighbor_cells:
            nk = (ck[0] + dx, ck[1] + dy)
            for pj in grid.get(nk, []):
                if pj <= pi:
                    continue
                if _dist2(p, pts[pj]) <= tol2:
                    union(pi, pj)

    counts: Dict[int, int] = {}
    for pi in range(len(pts)):
        r = find(pi)
        counts[r] = counts.get(r, 0) + 1

    return sum(1 for v in counts.values() if v == 1)


def _dedupe_labels(labels: List[TextLabel], tol: float) -> List[TextLabel]:
    if not labels:
        return labels

    out: List[TextLabel] = []
    tol2 = tol * tol

    for lab in labels:
        keep = True
        for prev in out:
            if _dist2((lab.x, lab.y), (prev.x, prev.y)) <= tol2:
                keep = False
                break
        if keep:
            out.append(lab)

    return out


def _merge_baseline_clusters(
    segments: List[Seg],
    clusters: List[List[int]],
    valign_factor: float,
    gap_factor: float,
) -> List[List[int]]:
    """Union same-baseline, closely-spaced raw clusters before the
    segment-count/size filters run.

    Some drawings draw every character of a label as its own disconnected
    polyline, with a real (if small) gap to its neighbour — too wide for the
    primary connect-tolerance clustering above to bridge (that tolerance has
    to stay tight, or it would merge genuinely different nearby labels), but
    clearly still the same word. A single character often has too few
    strokes to pass the segment-count floor on its own and would otherwise
    be silently dropped entirely; merging by baseline alignment and a gap
    sized off each fragment's own text height (not the drawing's global
    connect-tolerance scale) lets it join its word before that floor is
    ever checked. Gated by height, not distance alone, so it can't reach
    past one line of text into an unrelated label sitting further down.
    """
    n = len(clusters)
    if n < 2:
        return clusters

    boxes = [_bbox_from_segments(segments, idxs) for idxs in clusters]
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        bx = boxes[i]
        icy = 0.5 * (bx[1] + bx[3])
        for j in range(i + 1, n):
            by = boxes[j]
            gap = (by[0] - bx[2]) if by[0] >= bx[0] else (bx[0] - by[2])
            h = max(bx[3] - bx[1], by[3] - by[1], 1e-9)
            if gap <= 0 or gap > gap_factor * h:
                continue
            jcy = 0.5 * (by[1] + by[3])
            if abs(icy - jcy) <= valign_factor * h:
                union(i, j)

    groups: Dict[int, List[int]] = {}
    for i, idxs in enumerate(clusters):
        groups.setdefault(find(i), []).extend(idxs)
    return list(groups.values())


def _build_stroke_pole_labels_from_entities(
    entities: List[Any],
    *,
    config: PoleIdConfig,
) -> List[TextLabel]:
    segments = _extract_stroke_segments_from_entities(entities)
    if not segments:
        return []

    # The connect tolerance and the size floors below were calibrated for one
    # drawing scale; drawings arrive at many. Measure this drawing's own median
    # stroke and scale every distance by the same factor — the strand pipeline
    # already works this way, and its reference (median stroke 0.0125) matches
    # the drawing these defaults were tuned on. Clamped, because a layer
    # dominated by long non-label linework would otherwise inflate the factor
    # and merge neighbouring labels into one.
    lens = sorted(s.length() for s in segments if s.length() > 1e-9)
    if lens:
        mid = len(lens) // 2
        med = lens[mid] if len(lens) % 2 else (lens[mid - 1] + lens[mid]) / 2.0
        scale = min(4.0, max(0.1, med / 0.0125))
    else:
        scale = 1.0

    clusters = _cluster_segments(segments, tol=config.stroke_connect_tol * scale)
    if config.stroke_baseline_merge:
        clusters = _merge_baseline_clusters(
            segments,
            clusters,
            valign_factor=config.stroke_baseline_valign_factor,
            gap_factor=config.stroke_baseline_gap_factor,
        )
    out: List[TextLabel] = []

    for idxs in clusters:
        if len(idxs) < config.stroke_min_segments:
            continue

        bbox = _bbox_from_segments(segments, idxs)
        minx, miny, maxx, maxy = bbox
        w = maxx - minx
        h = maxy - miny
        total_len = sum(segments[i].length() for i in idxs)

        if total_len < config.stroke_min_total_length * scale:
            continue
        if w < config.stroke_min_bbox_w * scale:
            continue
        if h < config.stroke_min_bbox_h * scale:
            continue

        aspect = max(w / max(h, 1e-9), h / max(w, 1e-9))
        if aspect > config.stroke_max_aspect:
            continue

        dom = _dominant_direction_ratio(segments, idxs)
        ep = _endpoint_count(segments, idxs, tol=config.stroke_connect_tol)
        comp = _cluster_complexity(segments, idxs)

        # Reject obvious single-line clutter
        if dom > config.stroke_max_dom_dir and ep <= 2 and comp < 0.08:
            continue

        if ep > config.stroke_max_endpoints:
            continue

        cx = 0.5 * (minx + maxx)
        cy = 0.5 * (miny + maxy)
        layer_counts: Dict[str, int] = {}
        for i in idxs:
            layer_counts[segments[i].layer] = layer_counts.get(segments[i].layer, 0) + 1
        cluster_layer = max(layer_counts, key=layer_counts.get) if layer_counts else ""
        out.append(
            TextLabel(
                text="",
                x=cx,
                y=cy,
                height=max(h, config.default_text_height),
                bbox=bbox,
                source="stroke",
                segments=[segments[i] for i in idxs],
                layer=cluster_layer,
            )
        )

    out.sort(key=lambda lab: (-lab.y, lab.x))
    for i, lab in enumerate(out):
        lab.text = f"{config.stroke_placeholder_prefix}_{i:03d}"

    return out


def find_pole_labels(
    doc,
    layer_name,
    *,
    config: Optional[PoleIdConfig] = None,
) -> List[Tuple[TextLabel, Optional[CircleMarker]]]:
    """Find pole labels and pair them with their circle markers.

    ``layer_name`` may be a single layer name or a list of them. A drafter
    often splits a pole's marker (circle) and its tag (text/stroke lettering)
    across two different layers that both happen to match the "pole" naming
    pattern (e.g. "...POLE NUMBER" for the tag and "...POLEPED" for the
    marker) — passing every candidate layer here lets a label on one layer
    pair with a circle on another. Text/stroke extraction still runs once per
    layer, so clustering never merges geometry across layers; only the final
    circle match is pooled.
    """
    config = config or PoleIdConfig()
    layer_names = [layer_name] if isinstance(layer_name, str) else list(layer_name)

    labels: List[TextLabel] = []
    circles: List[CircleMarker] = []

    for ln in layer_names:
        entities = _layer_entities(doc, ln)

        if config.include_text or config.include_mtext:
            text_labels = extract_text_labels_from_entities(
                entities,
                include_text=config.include_text,
                include_mtext=config.include_mtext,
            )
            if config.filter_text_by_regex:
                text_labels = [lab for lab in text_labels if is_pole_id(lab.text)]
            labels.extend(text_labels)

        if config.include_stroke:
            stroke_labels = _build_stroke_pole_labels_from_entities(entities, config=config)
            labels.extend(stroke_labels)

        if config.use_circle_markers:
            circles.extend(extract_circle_markers_from_entities(entities))

    labels = _dedupe_labels(labels, tol=max(config.stroke_connect_tol * 0.75, 1e-6))

    if not config.use_circle_markers:
        return [(lab, None) for lab in labels]

    matches = match_poleids_to_circles(
        labels=labels,
        circles=circles,
        max_dist_factor=config.max_dist_factor,
        default_text_height=config.default_text_height,
    )

    if config.require_circle_match:
        matches = [(lab, circ) for lab, circ in matches if circ is not None]

    return matches