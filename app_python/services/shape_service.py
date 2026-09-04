import math
from typing import List, Tuple, Optional, Dict, Set
from app_python.models.equipment import EquipmentShape
from app_python.core.math_helpers import bbox_from_points, poly_area_signed
from app_python.services.dxf_parser import iter_spaces

# --- Internal Math & Geometry specific to shapes ---
def _angle(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> float:
    bax, bay = a[0] - b[0], a[1] - b[1]
    bcx, bcy = c[0] - b[0], c[1] - b[1]
    na, nc = math.hypot(bax, bay), math.hypot(bcx, bcy)
    if na < 1e-12 or nc < 1e-12:
        return 0.0
    dot = max(-1.0, min(1.0, (bax / na) * (bcx / nc) + (bay / na) * (bcy / nc)))
    return math.acos(dot)

def _simplify_collinear(pts: List[Tuple[float, float]], angle_tol_deg: float = 10.0) -> List[Tuple[float, float]]:
    if len(pts) < 4:
        return pts[:]
    tol = math.radians(angle_tol_deg)
    keep = []
    n = len(pts)
    for i in range(n):
        a, b, c = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
        if abs(math.pi - _angle(a, b, c)) > tol:
            keep.append(b)
    return keep if len(keep) >= 3 else pts[:]

def _is_right_angle(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float], tol_deg: float = 12.0) -> bool:
    return abs((math.pi / 2) - _angle(a, b, c)) <= math.radians(tol_deg)

def _side_lengths(pts: List[Tuple[float, float]]) -> List[float]:
    n = len(pts)
    return [math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]) for i in range(n)]

def _quad_passes_thickness_filter(lens: List[float], min_short_side: float, max_aspect: Optional[float]) -> bool:
    if len(lens) != 4:
        return True
    mn, mx = min(lens), max(lens)
    if mn < 1e-12 or mn < min_short_side:
        return False
    if max_aspect is not None and (mx / mn) > max_aspect:
        return False
    return True

def _classify_polygon(pts: List[Tuple[float, float]], min_area: float, min_rect_short_side: float = 0.0, max_rect_aspect: Optional[float] = None) -> Optional[str]:
    if len(pts) < 3 or abs(poly_area_signed(pts)) < min_area:
        return None

    for angle_tol in [10.0, 14.0]:
        simp = _simplify_collinear(pts, angle_tol_deg=angle_tol)
        n = len(simp)
        
        if n == 3: return "triangle"
        if n == 6: return "hexagon"
        if n == 4:
            if not all(_is_right_angle(simp[(i - 1) % 4], simp[i], simp[(i + 1) % 4]) for i in range(4)):
                continue
            lens = _side_lengths(simp)
            if min(lens) < 1e-12 or not _quad_passes_thickness_filter(lens, min_rect_short_side, max_rect_aspect):
                continue
            return "square" if (max(lens) / min(lens)) <= 1.12 else "rectangle"
    return None

def _extract_closed_poly_points(entity) -> Optional[List[Tuple[float, float]]]:
    t = entity.dxftype()
    if t == "LWPOLYLINE" and bool(entity.closed):
        pts = [(float(x), float(y)) for x, y, *_ in entity.get_points("xy")]
    elif t == "POLYLINE" and bool(entity.is_closed):
        pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in entity.vertices]
    else:
        return None

    if len(pts) >= 2 and (abs(pts[0][0] - pts[-1][0]) < 1e-12 and abs(pts[0][1] - pts[-1][1]) < 1e-12):
        pts = pts[:-1]
    return pts if len(pts) >= 3 else None

def _detect_dome_shapes(doc, layer_name: str) -> List[EquipmentShape]:
    """Amplifier/node icons drawn as a dome (one ARC cap) over a housing of
    parallel horizontal "fin" lines — not a closed polygon, so
    _classify_polygon never sees it and these equipment markers were
    invisible to the scanner (only the tap-off layer's plain CIRCLE markers
    got detected). Recognised here by shape signature instead: an ARC
    sweeping roughly like a dome (its chord close to horizontal), with two or
    more short, roughly-horizontal 2-point polylines sitting under it whose
    x-extent overlaps the arc's.
    """
    arcs = []
    h_lines = []
    for space in iter_spaces(doc):
        for e in space:
            if getattr(e.dxf, "layer", None) != layer_name:
                continue
            if e.dxftype() == "ARC":
                c = e.dxf.center
                r = float(e.dxf.radius)
                a0 = math.radians(float(e.dxf.start_angle))
                a1 = math.radians(float(e.dxf.end_angle))
                if a1 < a0:
                    a1 += 2 * math.pi
                span = a1 - a0
                # A dome cap: roughly a half-circle (not a full circle, not a
                # short tick), swept starting somewhere near the horizontal.
                if math.radians(100) <= span <= math.radians(200):
                    arcs.append((float(c.x), float(c.y), r))
            elif e.dxftype() == "LWPOLYLINE" and not bool(e.closed):
                pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")]
                if len(pts) == 2:
                    (x1, y1), (x2, y2) = pts
                    dx, dy = abs(x2 - x1), abs(y2 - y1)
                    if dx > 1e-9 and dy <= dx * 0.25:  # roughly horizontal
                        h_lines.append((min(x1, x2), max(x1, x2), (y1 + y2) / 2.0))

    if not arcs or not h_lines:
        return []

    shapes: List[EquipmentShape] = []
    used = [False] * len(h_lines)
    for cx, cy, r in arcs:
        minx, maxx = cx - r, cx + r
        miny, maxy = cy - 2.5 * r, cy + r
        members = []
        for i, (lx0, lx1, ly) in enumerate(h_lines):
            if used[i]:
                continue
            if lx1 < minx - r * 0.3 or lx0 > maxx + r * 0.3:
                continue
            if ly < miny or ly > maxy:
                continue
            members.append(i)
        if len(members) < 2:
            continue
        for i in members:
            used[i] = True
        xs = [cx - r, cx + r] + [x for i in members for x in h_lines[i][:2]]
        ys = [cy, cy - r] + [h_lines[i][2] for i in members]
        bbox = (min(xs), min(ys), max(xs), max(ys))
        shapes.append(
            EquipmentShape(-1, "dome", bbox, (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
        )
    return shapes


def _snap_key(p: Tuple[float, float], eps: float) -> Tuple[int, int]:
    eps = max(eps, 1e-12)
    return (int(round(p[0] / eps)), int(round(p[1] / eps)))

def _build_segment_graph(doc, layer_name: str, eps: float) -> Tuple[List[Tuple[float, float]], Dict[int, Set[int]]]:
    key_to_id, accum, adj = {}, {}, {}

    def get_id(p: Tuple[float, float]) -> int:
        k = _snap_key(p, eps)
        if k not in key_to_id:
            nid = len(key_to_id)
            key_to_id[k] = nid
            accum[nid], adj[nid] = [p], set()
        return key_to_id[k]

    def add_edge(a: Tuple[float, float], b: Tuple[float, float]):
        ia, ib = get_id(a), get_id(b)
        if ia != ib:
            adj[ia].add(ib)
            adj[ib].add(ia)
            accum[ia].append(a)
            accum[ib].append(b)

    for space in iter_spaces(doc):
        for e in space:
            if getattr(e.dxf, "layer", None) != layer_name: continue
            t = e.dxftype()
            if t == "LINE":
                add_edge((float(e.dxf.start.x), float(e.dxf.start.y)), (float(e.dxf.end.x), float(e.dxf.end.y)))
            elif t in ("LWPOLYLINE", "POLYLINE"):
                pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")] if t == "LWPOLYLINE" else [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
                if len(pts) >= 2:
                    for i in range(len(pts) - 1): add_edge(pts[i], pts[i + 1])
                    if (t == "LWPOLYLINE" and bool(e.closed)) or (t == "POLYLINE" and bool(e.is_closed)) and len(pts) > 2:
                        add_edge(pts[-1], pts[0])

    coords = [(sum(p[0] for p in ps) / len(ps), sum(p[1] for p in ps) / len(ps)) for nid, ps in accum.items()]
    return coords, adj

def _canonical_cycle(cycle: List[int]) -> Tuple[int, ...]:
    if len(cycle) < 3: return tuple(cycle)
    n = len(cycle)
    mins = min(range(n), key=lambda i: cycle[i])
    r1, r2 = tuple(cycle[(mins + i) % n] for i in range(n)), tuple(cycle[(mins - i) % n] for i in range(n))
    return r1 if r1 < r2 else r2

def _find_cycles_of_length(adj: Dict[int, Set[int]], L: int, max_cycles: int = 20000) -> Set[Tuple[int, ...]]:
    cycles, nodes = set(), sorted(adj.keys())
    for start in nodes:
        stack = [(start, [start])]
        while stack:
            cur, path = stack.pop()
            if len(cycles) >= max_cycles: return cycles
            if len(path) == L:
                if start in adj.get(cur, set()):
                    cyc = _canonical_cycle(path[:])
                    if min(cyc) == start: cycles.add(cyc)
                continue
            for nb in adj.get(cur, set()):
                if nb >= start and nb not in path:
                    stack.append((nb, path + [nb]))
    return cycles

# --- Core Equipment Logic ---
def extract_equipment_shapes(doc, layer_name: str, min_circle_r: float = 1e-5, min_poly_area: float = 1e-6, dedup_eps: float = 1e-4, cycle_eps: Optional[float] = None, min_rect_short_side: float = 0.05, max_rect_aspect: Optional[float] = 50.0) -> List[EquipmentShape]:
    shapes: List[EquipmentShape] = []

    # 1. Circle & Polyline check
    for space in iter_spaces(doc):
        for e in space:
            if getattr(e.dxf, "layer", None) != layer_name: continue
            if e.dxftype() == "CIRCLE":
                r = float(e.dxf.radius)
                if r >= min_circle_r:
                    c = e.dxf.center
                    shapes.append(EquipmentShape(-1, "circle", (c.x - r, c.y - r, c.x + r, c.y + r), float(c.x), float(c.y)))
            elif e.dxftype() in ("LWPOLYLINE", "POLYLINE"):
                pts = _extract_closed_poly_points(e)
                if pts:
                    kind = _classify_polygon(pts, min_area=min_poly_area, min_rect_short_side=min_rect_short_side, max_rect_aspect=max_rect_aspect)
                    if kind:
                        minx, miny, maxx, maxy = bbox_from_points(pts)
                        shapes.append(EquipmentShape(-1, kind, (minx, miny, maxx, maxy), (minx + maxx) / 2, (miny + maxy) / 2))

    # 2. Dome icons (ARC cap + housing fins) — not a closed polygon, so the
    # cycle/polygon classifiers below never see them.
    shapes.extend(_detect_dome_shapes(doc, layer_name))

    # 3. Graph cycle detection
    eps = cycle_eps if cycle_eps is not None else max(dedup_eps * 10.0, 1e-4)
    coords, adj = _build_segment_graph(doc, layer_name, eps=eps)
    for length in [3, 4, 6]:
        for cyc in _find_cycles_of_length(adj, length):
            pts = [coords[i] for i in cyc]
            kind = _classify_polygon(pts, min_area=min_poly_area, min_rect_short_side=min_rect_short_side, max_rect_aspect=max_rect_aspect)
            if kind:
                minx, miny, maxx, maxy = bbox_from_points(pts)
                shapes.append(EquipmentShape(-1, kind, (minx, miny, maxx, maxy), (minx + maxx) / 2, (miny + maxy) / 2))

    # 3. Deduplication and sorting
    if not shapes: return []
    shapes.sort(key=lambda s: (s.kind, s.cx, s.cy))
    dedup = [shapes[0]]
    for s in shapes[1:]:
        prev = dedup[-1]
        if not (s.kind == prev.kind and abs(s.cx - prev.cx) < dedup_eps and abs(s.cy - prev.cy) < dedup_eps):
            dedup.append(s)

    dedup.sort(key=lambda s: (-s.cy, s.cx))
    for i, s in enumerate(dedup): s.shape_id = i
    return dedup

# --- Business Logic Wrapper (Replaces the need for separate counter files) ---
def process_equipment_layer(doc, layer_name: str, equipment_type: str, kwargs: dict) -> List[EquipmentShape]:
    """
    equipment_type can be: "amplifier", "node", "extender", "generic"
    """
    shapes = extract_equipment_shapes(doc, layer_name, **kwargs)
    
    if equipment_type in ["amplifier", "node"]:
        # Keep outermost rectangles
        items = sorted([s for s in shapes if s.kind == "rectangle"], key=lambda s: -max(0.0, (s.bbox[2] - s.bbox[0]) * (s.bbox[3] - s.bbox[1])))
        keep = []
        for s in items:
            if not any((k.bbox[0] <= s.bbox[0] and k.bbox[1] <= s.bbox[1] and k.bbox[2] >= s.bbox[2] and k.bbox[3] >= s.bbox[3]) for k in keep):
                keep.append(s)
        shapes = sorted(keep, key=lambda s: (-s.cy, s.cx))
        
    elif equipment_type == "extender":
        shapes = sorted([s for s in shapes if s.kind == "triangle"], key=lambda s: (-s.cy, s.cx))
        
    for i, s in enumerate(shapes):
        s.shape_id = i
        
    return shapes