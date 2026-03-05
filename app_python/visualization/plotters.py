import io
import base64
import math
import numpy as np
import matplotlib
# CRITICAL: Force matplotlib to not use any Xwindows/GUI backend. 
# This prevents the Flask server from crashing.
matplotlib.use('Agg') 
import matplotlib.pyplot as plt

from typing import List, Optional, Tuple
from app_python.models.geometry import Seg, Candidate, BoundaryMask
from app_python.models.equipment import EquipmentShape, TextLabel, CircleMarker

def _fig_to_base64(fig) -> str:
    """Converts a matplotlib figure to a base64 encoded PNG string."""
    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')

def _circle_polyline_xy(x: float, y: float, r: float, steps: int = 80):
    theta = np.linspace(0, 2 * np.pi, steps)
    return x + r * np.cos(theta), y + r * np.sin(theta)

def plot_map_to_base64(
    segments: List[Seg],
    candidates: List[Candidate],
    title: str,
    pole_matches: Optional[List[Tuple[TextLabel, Optional[CircleMarker]]]] = None,
    shapes: Optional[List[EquipmentShape]] = None,
    boundary: Optional[BoundaryMask] = None,
) -> str:
    fig, ax = plt.subplots(figsize=(12, 8))

    for s in segments:
        ax.plot([s.x1, s.x2], [s.y1, s.y2], linewidth=0.5, alpha=0.25)

    if boundary is not None and len(boundary.pts) >= 3:
        xs = [p[0] for p in boundary.pts] + [boundary.pts[0][0]]
        ys = [p[1] for p in boundary.pts] + [boundary.pts[0][1]]
        ax.plot(xs, ys, linewidth=1.8, alpha=0.9)

    for c in candidates:
        minx, miny, maxx, maxy = c.bbox
        ax.plot([minx, maxx, maxx, minx, minx], [miny, miny, maxy, maxy, miny], linewidth=1.5)
        ax.text((minx + maxx) / 2, (miny + maxy) / 2, str(c.digit_id), fontsize=8, ha="center", va="center")

    if shapes:
        for sh in shapes:
            minx, miny, maxx, maxy = sh.bbox
            ax.plot([minx, maxx, maxx, minx, minx], [miny, miny, maxy, maxy, miny], linewidth=1.5, alpha=0.9)
            ax.text(sh.cx, sh.cy, f"{sh.kind}:{sh.shape_id}", fontsize=7, ha="center", va="center")

    if pole_matches:
        for lab, circ in pole_matches:
            ax.text(lab.x, lab.y, lab.text, fontsize=8, ha="left", va="center")
            if circ is not None:
                xs, ys = _circle_polyline_xy(circ.x, circ.y, circ.r)
                ax.plot(xs, ys, linewidth=1.0, alpha=0.9)

    ax.set_title(title)
    ax.set_aspect("equal", adjustable="box")
    ax.grid(True, alpha=0.2)
    plt.tight_layout()
    
    return _fig_to_base64(fig)

def plot_candidate_grid_to_base64(segments: List[Seg], candidates: List[Candidate], cols: int = 12) -> Optional[str]:
    if not candidates: return None

    n = len(candidates)
    cols = max(1, int(cols))
    rows = int(math.ceil(n / cols))

    fig, axes = plt.subplots(rows, cols, figsize=(max(10, cols * 1.1), max(6, rows * 1.0)))
    if n == 1: axes = np.array([axes])
    axes = np.array(axes).reshape(rows, cols)

    for k in range(rows * cols):
        r, c = divmod(k, cols)
        ax = axes[r, c]
        ax.axis("off")
        if k >= n: continue

        cand = candidates[k]
        minx, miny, maxx, maxy = cand.bbox
        w, h = maxx - minx, maxy - miny
        if w < 1e-9 or h < 1e-9:
            ax.text(0.5, 0.5, "EMPTY", ha="center", va="center", fontsize=10)
            continue

        pad = 0.05
        for si in cand.seg_indices:
            s = segments[si]
            if s.length() > 1e-6:
                ax.plot([(s.x1 - minx) / w, (s.x2 - minx) / w], [(s.y1 - miny) / h, (s.y2 - miny) / h], linewidth=1.0)

        ax.set_xlim(-pad, 1 + pad)
        ax.set_ylim(-pad, 1 + pad)
        ax.set_title(f"id {cand.digit_id}", fontsize=8)

    fig.suptitle("Digit candidates")
    plt.tight_layout()
    return _fig_to_base64(fig)