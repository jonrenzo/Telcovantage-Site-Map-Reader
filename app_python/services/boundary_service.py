import math
from typing import Any, Dict, List, Optional, Set, Tuple

from app_python.core.math_helpers import (
    bbox_from_points,
    dist2,
    point_in_or_on_polygon,
    poly_area_signed,
)
from app_python.models.equipment import CircleMarker, EquipmentShape, TextLabel
from app_python.models.geometry import BoundaryMask, Seg
from app_python.services.dxf_parser import extract_stroke_segments


def _union_find(n: int):
    parent, size = list(range(n)), [1] * n

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int):
        ra, rb = find(a), find(b)
        if ra != rb:
            if size[ra] < size[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            size[ra] += size[rb]

    return find, union


def build_boundary_mask(
    doc, boundary_layer: str, snap_tol: float, close_max_gap: float, min_area: float
) -> Optional[BoundaryMask]:
    segs = [
        s for s in extract_stroke_segments(doc, boundary_layer) if s.length() > 1e-12
    ]
    if len(segs) < 3:
        return None

    # Snapping endpoints
    endpoints, seg_end_idx = [], []
    for s in segs:
        i1 = len(endpoints)
        endpoints.append(s.p1())
        i2 = len(endpoints)
        endpoints.append(s.p2())
        seg_end_idx.append((i1, i2))

    tol2, cell = max(snap_tol, 1e-12) ** 2, max(snap_tol, 1e-12)
    grid = {}
    for i, p in enumerate(endpoints):
        grid.setdefault(
            (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell))), []
        ).append(i)

    find, union = _union_find(len(endpoints))
    for i, p in enumerate(endpoints):
        ck = (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)))
        for dx, dy in [(x, y) for x in (-1, 0, 1) for y in (-1, 0, 1)]:
            for j in grid.get((ck[0] + dx, ck[1] + dy), []):
                if j > i and dist2(p, endpoints[j]) <= tol2:
                    union(i, j)

    root_to_cid, pt2cid, clusters = {}, [0] * len(endpoints), {}
    for i in range(len(endpoints)):
        r = find(i)
        if r not in root_to_cid:
            root_to_cid[r] = len(root_to_cid)
        cid = root_to_cid[r]
        pt2cid[i] = cid
        clusters.setdefault(cid, []).append(i)

    coords = [
        (
            sum(endpoints[i][0] for i in idxs) / len(idxs),
            sum(endpoints[i][1] for i in idxs) / len(idxs),
        )
        for cid, idxs in clusters.items()
    ]
    adj, edges = {i: set() for i in range(len(coords))}, set()

    for i1, i2 in seg_end_idx:
        a, b = pt2cid[i1], pt2cid[i2]
        if a != b:
            u, v = (a, b) if a < b else (b, a)
            if (u, v) not in edges:
                edges.add((u, v))
                adj[u].add(v)
                adj[v].add(u)

    if len(coords) < 3:
        return None

        # Connected Components & Gap Closing
    seen, comps = set(), []
    for n in adj.keys():
        if n in seen:
            continue
        stack, comp = [n], set()
        seen.add(n)
        while stack:
            cur = stack.pop()
            comp.add(cur)
            for nb in adj.get(cur, set()):
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        comps.append(comp)

    if not comps:
        return None

    # FIX 1: Sort by Bounding Box AREA, not just width
    main_comp = max(
        comps,
        key=lambda c: (lambda bx: (bx[2] - bx[0]) * (bx[3] - bx[1]))(
            bbox_from_points([coords[i] for i in c])
        ),
    )

    ep_before = sum(1 for n in main_comp if len(adj.get(n, set())) == 1)

    # Simplified gap closer
    ep_nodes = [n for n in main_comp if len(adj.get(n, set())) == 1]
    added = 0
    if len(ep_nodes) >= 2:
        rem = ep_nodes[:]
        while len(rem) >= 2:
            best_i, best_j, best_d = (
                0,
                1,
                math.hypot(
                    coords[rem[1]][0] - coords[rem[0]][0],
                    coords[rem[1]][1] - coords[rem[0]][1],
                ),
            )
            for i in range(len(rem)):
                for j in range(i + 1, len(rem)):
                    d = math.hypot(
                        coords[rem[j]][0] - coords[rem[i]][0],
                        coords[rem[j]][1] - coords[rem[i]][1],
                    )
                    if d < best_d:
                        best_d, best_i, best_j = d, i, j
            a, b = rem.pop(max(best_i, best_j)), rem.pop(min(best_i, best_j))
            if close_max_gap > 0 and best_d > close_max_gap:
                continue
            u, v = min(a, b), max(a, b)
            if (u, v) not in edges:
                edges.add((u, v))
                adj[u].add(v)
                adj[v].add(u)
                added += 1

    # FIX 2: Prune dangling edges (overshoots) so the face tracer doesn't get stuck
    changed = True
    while changed:
        changed = False
        for n in list(adj.keys()):
            if len(adj[n]) <= 1:
                for nb in list(adj.get(n, set())):
                    if n in adj[nb]:
                        adj[nb].remove(n)
                del adj[n]
                changed = True

    # If the pruning ate the entire graph (meaning it was just a line, no closed shapes), abort
    if not adj:
        return None

    # Extract Face Cycles
    nbrs = {
        u: sorted(
            list(nbs),
            key=lambda v: math.atan2(
                coords[v][1] - coords[u][1], coords[v][0] - coords[u][0]
            ),
        )
        for u, nbs in adj.items()
    }
    used, cycles = set(), {}
    for u in list(adj.keys()):
        for v in list(adj.get(u, set())):
            if (u, v) in used:
                continue
            start, cur_u, cur_v, path = (u, v), u, v, []
            for _ in range(30000):
                used.add((cur_u, cur_v))
                path.append(cur_u)
                lst = nbrs.get(cur_v, [])
                if len(lst) < 2:
                    break
                w = lst[lst.index(cur_u) - 1] if cur_u in lst else None
                if w is None:
                    break
                cur_u, cur_v = cur_v, w
                if (cur_u, cur_v) == start:
                    break
            if len(path) >= 3:
                poly = [coords[i] for i in path]
                a = abs(poly_area_signed(poly))
                if a >= min_area:
                    mins = min(range(len(path)), key=lambda i: path[i])
                    r1 = tuple(path[(mins + i) % len(path)] for i in range(len(path)))
                    r2 = tuple(path[(mins - i) % len(path)] for i in range(len(path)))
                    cycles[min(r1, r2)] = list(path)

    if not cycles:
        return None
    best_poly, best_area = None, 0.0
    for cyc in cycles.values():
        poly = [coords[i] for i in cyc]
        a = abs(poly_area_signed(poly))
        if a > best_area:
            best_area, best_poly = a, poly

    if not best_poly or len(best_poly) < 3:
        return None
    return BoundaryMask(
        pts=best_poly,
        bbox=bbox_from_points(best_poly),
        area=best_area,
        snap_tol_used=snap_tol,
        close_max_gap_used=close_max_gap,
        endpoints_before=ep_before,
        endpoints_after=ep_before - added * 2,
        added_edges=added,
    )


# Filter Helpers
def apply_boundary_filter(
    items: List[Any], boundary: Optional[BoundaryMask], extract_coords
) -> List[Any]:
    if not boundary:
        return items
    bx0, by0, bx1, by1 = boundary.bbox
    return [
        i
        for i in items
        if bx0 <= extract_coords(i)[0] <= bx1
        and by0 <= extract_coords(i)[1] <= by1
        and point_in_or_on_polygon(
            extract_coords(i)[0], extract_coords(i)[1], boundary.pts
        )
    ]
