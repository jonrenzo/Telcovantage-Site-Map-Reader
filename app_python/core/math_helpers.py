import math
from typing import List, Tuple
from app_python.models.geometry import Seg

def dist2(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return dx * dx + dy * dy

def bbox_from_segments(segments: List[Seg], idxs: List[int]) -> Tuple[float, float, float, float]:
    xs = []
    ys = []
    for i in idxs:
        s = segments[i]
        xs.extend([s.x1, s.x2])
        ys.extend([s.y1, s.y2])
    if not xs or not ys:
        return (0.0, 0.0, 0.0, 0.0)
    return (min(xs), min(ys), max(xs), max(ys))

def bbox_from_points(pts: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
    if not pts:
        return (0.0, 0.0, 0.0, 0.0)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))

def poly_area_signed(pts: List[Tuple[float, float]]) -> float:
    if len(pts) < 3:
        return 0.0
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return 0.5 * a

def point_on_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float, eps: float) -> bool:
    if px < min(ax, bx) - eps or px > max(ax, bx) + eps or py < min(ay, by) - eps or py > max(ay, by) + eps:
        return False
    vx = bx - ax
    vy = by - ay
    wx = px - ax
    wy = py - ay
    cross = vx * wy - vy * wx
    if abs(cross) > eps * (abs(vx) + abs(vy) + 1.0):
        return False
    dot = wx * vx + wy * vy
    if dot < -eps:
        return False
    if dot > (vx * vx + vy * vy) + eps:
        return False
    return True

def point_in_or_on_polygon(x: float, y: float, poly: List[Tuple[float, float]], *, eps: float = 1e-9) -> bool:
    n = len(poly)
    if n < 3:
        return False

    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if point_on_segment(x, y, x1, y1, x2, y2, eps=eps):
            return True

    inside = False
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            denom = (y2 - y1)
            if abs(denom) < 1e-18:
                continue
            xint = x1 + (x2 - x1) * (y - y1) / denom
            if x < xint:
                inside = not inside
    return inside