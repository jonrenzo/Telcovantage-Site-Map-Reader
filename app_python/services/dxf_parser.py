import math
import numpy as np
import ezdxf
from typing import List, Tuple, Dict
from app_python.models.geometry import Seg

def iter_spaces(doc):
    """Yields modelspace and all layout spaces except named 'Model'."""
    yield doc.modelspace()
    for layout in doc.layouts:
        if layout.name.lower() != "model":
            yield layout

def list_layers(doc) -> List[str]:
    """Returns a sorted list of all layer names in the DXF."""
    return sorted(layer.dxf.name for layer in doc.layers)

def segmentize_polyline_points(pts: List[Tuple[float, float]], closed: bool) -> List[Seg]:
    """Converts a list of points into a list of Seg objects."""
    segs = []
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

def extract_stroke_segments(doc, layer_name: str) -> List[Seg]:
    """Extracts lines, arcs, polylines, and splines from a specific layer."""
    segments: List[Seg] = []
    seen_types: Dict[str, int] = {}
    spline_failures = 0
    spline_total = 0

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

    for space in iter_spaces(doc):
        for e in space:
            if getattr(e.dxf, "layer", None) != layer_name:
                continue

            t = e.dxftype()
            seen_types[t] = seen_types.get(t, 0) + 1

            if t == "LINE":
                p1, p2 = e.dxf.start, e.dxf.end
                segments.append(Seg(float(p1.x), float(p1.y), float(p2.x), float(p2.y)))

            elif t == "LWPOLYLINE":
                pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")]
                segments.extend(segmentize_polyline_points(pts, closed=bool(e.closed)))

            elif t == "POLYLINE":
                pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
                segments.extend(segmentize_polyline_points(pts, closed=bool(e.is_closed)))

            elif t == "ARC":
                c, r = e.dxf.center, float(e.dxf.radius)
                a0, a1 = math.radians(float(e.dxf.start_angle)), math.radians(float(e.dxf.end_angle))
                if a1 < a0:
                    a1 += 2 * math.pi
                steps = arc_steps_for(r, a0, a1)
                angles = np.linspace(a0, a1, steps)
                pts = [(float(c.x) + r * math.cos(a), float(c.y) + r * math.sin(a)) for a in angles]
                segments.extend(segmentize_polyline_points(pts, closed=False))

            elif t == "SPLINE":
                spline_total += 1
                try:
                    from ezdxf.math import BSpline
                    bs = BSpline.from_spline(e)
                    ts0 = np.linspace(0, 1, 12)
                    rough = [(float(p.x), float(p.y)) for p in (bs.point(t) for t in ts0)]
                    steps = spline_steps_for_bbox(rough)
                    ts = np.linspace(0, 1, steps)
                    pts = [(float(p.x), float(p.y)) for p in (bs.point(t) for t in ts)]
                    segments.extend(segmentize_polyline_points(pts, closed=False))
                except Exception:
                    spline_failures += 1

    # In a real Flask app, you'd want to use the standard `logging` module here instead of print.
    print(f"Entity types found on layer '{layer_name}': {seen_types}")
    if spline_total:
        print(f"SPLINE sampling: total={spline_total} failures={spline_failures}")
    return segments