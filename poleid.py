import math
import re
from dataclasses import dataclass
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


@dataclass
class CircleMarker:
    x: float
    y: float
    r: float


@dataclass
class Seg:
    x1: float
    y1: float
    x2: float
    y2: float

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

    # Circle handling
    use_circle_markers: bool = False
    require_circle_match: bool = False
    max_dist_factor: float = 4.0
    default_text_height: float = 0.25


_POLEID_RE = re.compile(r"^(?:NPT|[A-Z]{0,2}\d+(?:-\d+)?)$", re.IGNORECASE)


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
                )
            )

    return labels


def extract_circle_markers_from_entities(entities: List[Any]) -> List[CircleMarker]:
    circles: List[CircleMarker] = []
    for e in entities:
        if e.dxftype() == "CIRCLE":
            c = e.dxf.center
            r = float(e.dxf.radius)
            circles.append(CircleMarker(float(c.x), float(c.y), r))
    return circles


def match_poleids_to_circles(
    labels: List[TextLabel],
    circles: List[CircleMarker],
    max_dist_factor: float = 4.0,
    default_text_height: float = 0.25,
) -> List[Tuple[TextLabel, Optional[CircleMarker]]]:
    out: List[Tuple[TextLabel, Optional[CircleMarker]]] = []

    if not circles:
        for lab in labels:
            out.append((lab, None))
        return out

    for lab in labels:
        th = lab.height if lab.height > 1e-9 else default_text_height

        best = None
        best_d2 = 1e18
        for c in circles:
            dx = lab.x - c.x
            dy = lab.y - c.y
            d2 = dx * dx + dy * dy
            if d2 < best_d2:
                best_d2 = d2
                best = c

        if best is None:
            out.append((lab, None))
            continue

        gate = max_dist_factor * max(th, best.r, 1e-6)
        out.append((lab, best if best_d2 <= gate * gate else None))

    return out


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


def _extract_stroke_segments_from_entities(entities: List[Any]) -> List[Seg]:
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

        if t == "LINE":
            p1 = e.dxf.start
            p2 = e.dxf.end
            segments.append(Seg(float(p1.x), float(p1.y), float(p2.x), float(p2.y)))

        elif t == "LWPOLYLINE":
            pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")]
            segments.extend(_segmentize_polyline_points(pts, closed=bool(e.closed)))

        elif t == "POLYLINE":
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


def _build_stroke_pole_labels_from_entities(
    entities: List[Any],
    *,
    config: PoleIdConfig,
) -> List[TextLabel]:
    segments = _extract_stroke_segments_from_entities(entities)
    if not segments:
        return []

    clusters = _cluster_segments(segments, tol=config.stroke_connect_tol)
    out: List[TextLabel] = []

    for idxs in clusters:
        if len(idxs) < config.stroke_min_segments:
            continue

        bbox = _bbox_from_segments(segments, idxs)
        minx, miny, maxx, maxy = bbox
        w = maxx - minx
        h = maxy - miny
        total_len = sum(segments[i].length() for i in idxs)

        if total_len < config.stroke_min_total_length:
            continue
        if w < config.stroke_min_bbox_w:
            continue
        if h < config.stroke_min_bbox_h:
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
        out.append(
            TextLabel(
                text="",
                x=cx,
                y=cy,
                height=max(h, config.default_text_height),
                bbox=bbox,
                source="stroke",
            )
        )

    out.sort(key=lambda lab: (-lab.y, lab.x))
    for i, lab in enumerate(out):
        lab.text = f"{config.stroke_placeholder_prefix}_{i:03d}"

    return out


def find_pole_labels(
    doc,
    layer_name: str,
    *,
    config: Optional[PoleIdConfig] = None,
) -> List[Tuple[TextLabel, Optional[CircleMarker]]]:
    config = config or PoleIdConfig()
    entities = _layer_entities(doc, layer_name)

    labels: List[TextLabel] = []

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

    labels = _dedupe_labels(labels, tol=max(config.stroke_connect_tol * 0.75, 1e-6))

    if not config.use_circle_markers:
        return [(lab, None) for lab in labels]

    circles = extract_circle_markers_from_entities(entities)
    matches = match_poleids_to_circles(
        labels=labels,
        circles=circles,
        max_dist_factor=config.max_dist_factor,
        default_text_height=config.default_text_height,
    )

    if config.require_circle_match:
        matches = [(lab, circ) for lab, circ in matches if circ is not None]

    return matches