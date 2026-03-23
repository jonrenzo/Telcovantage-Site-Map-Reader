"""
CAD Digit OCR – Flask Backend
==============================
Serves the REST API consumed by the React frontend.

Usage:
    pip install flask flask-cors
    python server.py --port 5000
"""

import argparse
import base64
import io
import json
import math
import os
import shutil as _shutil
import subprocess
import tempfile
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import cv2
import ezdxf
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from flask import Blueprint, Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from PIL import Image
from torchvision import transforms

app = Flask(__name__, static_folder="frontend/dist", static_url_path="")
CORS(app)  # Allow React dev server to call API during development

# ── Public Integration API blueprint (routes defined later, registered at bottom) ─
public_api = Blueprint("public_api", __name__, url_prefix="/api/v1")


# ─────────────────────────────────────────────────────────────────────────────
# PDF → DXF  (AutoCAD)
# ─────────────────────────────────────────────────────────────────────────────


def pdf_to_dxf_autocad(pdf_path):
    pdf_path = Path(pdf_path).resolve()
    dxf_path = pdf_path.with_suffix(".dxf")

    accore_candidates = [
        r"C:\Program Files\Autodesk\AutoCAD 2026\accoreconsole.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2025\accoreconsole.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2024\accoreconsole.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2023\accoreconsole.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2022\accoreconsole.exe",
    ]
    accore = next((p for p in accore_candidates if Path(p).exists()), None)
    if accore is None:
        raise RuntimeError(
            "AutoCAD is not installed or not found. "
            "PDF conversion requires AutoCAD 2022 or later. "
            "Please convert your PDF to DXF manually and upload the DXF file instead."
        )

    script = f'''FILEDIA 0
-PDFIMPORT
FILE
"{pdf_path}"
1
0,0
1
0
DXFOUT
"{dxf_path}"
16
Version
2018
QUIT
'''
    with tempfile.NamedTemporaryFile(delete=False, suffix=".scr", mode="w") as f:
        f.write(script)
        script_path = f.name

    result = subprocess.run(
        [str(accore), "/s", script_path],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if not dxf_path.exists():
        raise RuntimeError("DXF was not created by AutoCAD.")

    return str(dxf_path)


# ─────────────────────────────────────────────────────────────────────────────
# DXF PIPELINE
# ─────────────────────────────────────────────────────────────────────────────

CONNECT_TOL = 0.20
MIN_TOTAL_LENGTH = 0.15
EPS_THIN = 0.03
LONG_DIM = 3.0
COMPLEX_MIN = 0.15
MIN_SEGS_FOR_DIGIT = 2
MAX_DOM_DIR = 0.88
MAX_ENDPOINTS_FOR_LINE = 2
ENDPOINT_TOL_SCALE = 1.0
W_FACTOR = 6.0
H_FACTOR = 6.0
LEN_FACTOR = 10.0
AREA_FACTOR = 18.0
MAX_ASPECT = 8.0
SALVAGE_DIST_FACTOR = 0.25
SALVAGE_LONG_SEG_FACTOR = 1.8
SALVAGE_ANGLE_TOL_DEG = 20.0

# Cable interaction grouping tolerance.
# Use a slightly larger tolerance than OCR clustering so cosmetic line breaks
# can still join into one clickable cable span.
CABLE_CONNECT_TOL = 0.10


@dataclass
class Seg:
    x1: float
    y1: float
    x2: float
    y2: float

    def p1(self):
        return (self.x1, self.y1)

    def p2(self):
        return (self.x2, self.y2)

    def length(self):
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)


@dataclass
class ClusterInfo:
    cluster_id: int
    seg_indices: List[int]
    bbox: Tuple[float, float, float, float]
    width: float
    height: float
    total_length: float
    kind: str


@dataclass
class Candidate:
    digit_id: int
    cluster_id: int
    seg_indices: List[int]
    bbox: Tuple[float, float, float, float]
    width: float
    height: float
    total_length: float


def _dist2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def _bbox_from_segments(segments, idxs):
    xs, ys = [], []
    for i in idxs:
        s = segments[i]
        xs += [s.x1, s.x2]
        ys += [s.y1, s.y2]
    return (min(xs), min(ys), max(xs), max(ys))


def _segmentize(pts, closed):
    segs = []
    for i in range(len(pts) - 1):
        segs.append(Seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
    if closed and len(pts) > 2:
        segs.append(Seg(pts[-1][0], pts[-1][1], pts[0][0], pts[0][1]))
    return segs


def list_layers(dxf_path):
    doc = ezdxf.readfile(dxf_path)
    return sorted(layer.dxf.name for layer in doc.layers)


POLE_LAYER_FILTER = ["pole"]


def extract_stroke_segments(doc, layer_name, include_circles=True):
    segments = []
    ARC_STEPS, SPLINE_STEPS, CIRCLE_STEPS = (
        24,
        30,
        36,
    )  # Add steps for circle approximation

    def iter_spaces():
        yield doc.modelspace()
        for layout in doc.layouts:
            if layout.name.lower() != "model":
                yield layout

    for space in iter_spaces():
        for e in space:
            if getattr(e.dxf, "layer", None) != layer_name:
                continue
            t = e.dxftype()
            if t == "LINE":
                p1, p2 = e.dxf.start, e.dxf.end
                segments.append(Seg(float(p1.x), float(p1.y), float(p2.x), float(p2.y)))
            elif t == "LWPOLYLINE":
                pts = [(float(x), float(y)) for x, y, *_ in e.get_points("xy")]
                segments.extend(_segmentize(pts, bool(e.closed)))
            elif t == "POLYLINE":
                pts = [
                    (float(v.dxf.location.x), float(v.dxf.location.y))
                    for v in e.vertices
                ]
                segments.extend(_segmentize(pts, bool(e.is_closed)))
            elif t == "ARC":
                c, r = e.dxf.center, float(e.dxf.radius)
                a0 = math.radians(float(e.dxf.start_angle))
                a1 = math.radians(float(e.dxf.end_angle))
                if a1 < a0:
                    a1 += 2 * math.pi
                angles = np.linspace(a0, a1, ARC_STEPS)
                pts = [
                    (float(c.x) + r * math.cos(a), float(c.y) + r * math.sin(a))
                    for a in angles
                ]
                segments.extend(_segmentize(pts, False))
            elif t == "CIRCLE":
                if any(x in layer_name.lower() for x in POLE_LAYER_FILTER):
                    continue
                c, r = e.dxf.center, float(e.dxf.radius)
                angles = np.linspace(0, 2 * math.pi, CIRCLE_STEPS, endpoint=False)
                pts = [
                    (float(c.x) + r * math.cos(a), float(c.y) + r * math.sin(a))
                    for a in angles
                ]
                segments.extend(_segmentize(pts, True))
            elif t == "SPLINE":
                try:
                    from ezdxf.math import BSpline

                    bs = BSpline.from_spline(e)
                    pts = [
                        (float(p.x), float(p.y))
                        for p in (bs.point(t) for t in np.linspace(0, 1, SPLINE_STEPS))
                    ]
                    segments.extend(_segmentize(pts, False))
                except Exception:
                    pass
    return segments


def cluster_segments(segments, tol):
    if not segments:
        return []
    tol2 = tol * tol
    cell_size = tol

    def cell_key(p):
        return (int(math.floor(p[0] / cell_size)), int(math.floor(p[1] / cell_size)))

    grid = {}
    endpoints = [(i, s.p1()) for i, s in enumerate(segments)] + [
        (i, s.p2()) for i, s in enumerate(segments)
    ]
    for si, p in endpoints:
        grid.setdefault(cell_key(p), []).append((si, p))
    adj = [[] for _ in range(len(segments))]
    for si, p in endpoints:
        ck = cell_key(p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for sj, q in grid.get((ck[0] + dx, ck[1] + dy), []):
                    if sj != si and _dist2(p, q) <= tol2:
                        adj[si].append(sj)
    visited = [False] * len(segments)
    clusters = []
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


def cluster_complexity(segments, idxs):
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
    return 1.0 - math.hypot(c, s)


def endpoint_count(segments, idxs, tol):
    cell = tol

    def key(p):
        return (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)))

    counts = {}
    for i in idxs:
        s = segments[i]
        for p in (s.p1(), s.p2()):
            k = key(p)
            counts[k] = counts.get(k, 0) + 1
    return sum(1 for v in counts.values() if v == 1)


def dominant_direction_ratio(segments, idxs, bins=12):
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
    return max(hist) / n if n > 0 else 1.0


def is_renderable_cluster(segments, info):
    if info.width * info.height < 1e-8:
        return False
    return any(segments[si].length() > 1e-6 for si in info.seg_indices)


def analyze_clusters(segments, clusters):
    infos = []
    ep_tol = CONNECT_TOL * ENDPOINT_TOL_SCALE
    for cid, idxs in enumerate(clusters):
        minx, miny, maxx, maxy = _bbox_from_segments(segments, idxs)
        w = maxx - minx
        h = maxy - miny
        total_len = sum(segments[i].length() for i in idxs)
        if total_len < MIN_TOTAL_LENGTH:
            continue
        comp = cluster_complexity(segments, idxs)
        dom = dominant_direction_ratio(segments, idxs)
        ep = endpoint_count(segments, idxs, tol=ep_tol)
        thin = min(w, h) < EPS_THIN
        longish = max(w, h) > LONG_DIM
        few = len(idxs) < MIN_SEGS_FOR_DIGIT
        if (
            (thin and longish and comp < COMPLEX_MIN)
            or (dom > MAX_DOM_DIR and ep <= MAX_ENDPOINTS_FOR_LINE)
            or (few and comp < COMPLEX_MIN)
        ):
            kind = "line"
        else:
            kind = "digit_candidate"
        infos.append(
            ClusterInfo(cid, idxs, (minx, miny, maxx, maxy), w, h, total_len, kind)
        )
    return infos


def _pca_main_axis(points):
    c = points.mean(axis=0)
    X = points - c
    C = (X.T @ X) / max(1, len(points) - 1)
    vals, vecs = np.linalg.eigh(C)
    d = vecs[:, np.argmax(vals)]
    return c, d / max(np.linalg.norm(d), 1e-12)


def _point_line_dist(p, c, d):
    v = p - c
    proj = np.dot(v, d) * d
    return float(np.linalg.norm(v - proj))


def salvage_remove_dominant_line(
    segments, idxs, connect_tol, dist_factor, long_seg_factor, angle_tol_deg
):
    if len(idxs) < 4:
        return [idxs]
    pts = []
    seg_lens = []
    for i in idxs:
        s = segments[i]
        pts += [[s.x1, s.y1], [s.x2, s.y2]]
        seg_lens.append(s.length())
    pts = np.array(pts, dtype=float)
    seg_lens = np.array(seg_lens, dtype=float)
    minx, miny, maxx, maxy = _bbox_from_segments(segments, idxs)
    thin_dim = max(1e-9, min(maxx - minx, maxy - miny))
    c, d = _pca_main_axis(pts)
    med_len = float(np.median(seg_lens))
    long_thr = max(med_len * long_seg_factor, med_len + 1e-9)
    ang_tol = math.radians(angle_tol_deg)
    keep = []
    removed = []
    for i in idxs:
        s = segments[i]
        L = s.length()
        mid = np.array([(s.x1 + s.x2) * 0.5, (s.y1 + s.y2) * 0.5], dtype=float)
        dist = _point_line_dist(mid, c, d)
        v = np.array([s.x2 - s.x1, s.y2 - s.y1], dtype=float)
        nv = np.linalg.norm(v)
        if nv < 1e-12:
            keep.append(i)
            continue
        cosang = float(abs(np.dot(v / nv, d)))
        cosang = max(-1.0, min(1.0, cosang))
        ang = math.acos(cosang)
        if dist <= dist_factor * thin_dim and ang <= ang_tol and L >= long_thr:
            removed.append(i)
        else:
            keep.append(i)
    if not removed:
        return [idxs]
    kept_segs = [segments[i] for i in keep]
    subclusters_local = cluster_segments(kept_segs, tol=connect_tol)
    subclusters = [[keep[j] for j in comp] for comp in subclusters_local]
    subclusters = [
        c
        for c in subclusters
        if sum(segments[i].length() for i in c) >= MIN_TOTAL_LENGTH
    ]
    return subclusters if subclusters else [idxs]


def build_candidates_robust(segments, infos):
    prelim = [
        i
        for i in infos
        if i.kind == "digit_candidate" and is_renderable_cluster(segments, i)
    ]
    if not prelim:
        return []
    areas = np.array([i.width * i.height for i in prelim], dtype=float)
    cutoff = np.quantile(areas, 0.80)
    small = [i for i in prelim if i.width * i.height <= cutoff]
    base = small if len(small) >= 10 else prelim
    med_w = float(np.median([i.width for i in base]))
    med_h = float(np.median([i.height for i in base]))
    med_len = float(np.median([i.total_length for i in base]))
    med_area = float(np.median([i.width * i.height for i in base]))

    def aspect_ok(w, h):
        return (
            max(w, h) / max(min(w, h), 1e-12) <= MAX_ASPECT
            if w > 1e-12 and h > 1e-12
            else False
        )

    final_infos = []
    salvaged = 0
    for i in prelim:
        area = i.width * i.height
        too_big = (
            i.width > med_w * W_FACTOR
            or i.height > med_h * H_FACTOR
            or i.total_length > med_len * LEN_FACTOR
            or area > med_area * AREA_FACTOR
            or not aspect_ok(i.width, i.height)
        )
        if not too_big:
            final_infos.append(i)
            continue
        subclusters = salvage_remove_dominant_line(
            segments,
            i.seg_indices,
            CONNECT_TOL * 0.9,
            SALVAGE_DIST_FACTOR,
            SALVAGE_LONG_SEG_FACTOR,
            SALVAGE_ANGLE_TOL_DEG,
        )
        for comp in subclusters:
            bx = _bbox_from_segments(segments, comp)
            w = bx[2] - bx[0]
            h = bx[3] - bx[1]
            tlen = sum(segments[j].length() for j in comp)
            if tlen < MIN_TOTAL_LENGTH:
                continue
            if (
                w > med_w * W_FACTOR
                or h > med_h * H_FACTOR
                or tlen > med_len * LEN_FACTOR
                or w * h > med_area * AREA_FACTOR
            ):
                continue
            if not aspect_ok(w, h):
                continue
            final_infos.append(
                ClusterInfo(i.cluster_id, comp, bx, w, h, tlen, "digit_candidate")
            )
            salvaged += 1
    final_infos = [x for x in final_infos if is_renderable_cluster(segments, x)]
    final_infos = sorted(
        final_infos,
        key=lambda c: (-((c.bbox[1] + c.bbox[3]) / 2), (c.bbox[0] + c.bbox[2]) / 2),
    )
    return [
        Candidate(
            did,
            info.cluster_id,
            info.seg_indices,
            info.bbox,
            info.width,
            info.height,
            info.total_length,
        )
        for did, info in enumerate(final_infos)
    ]


def render_crop(segments, cand, out_size=96, pad_frac=0.06, thickness=2):
    minx, miny, maxx, maxy = cand.bbox
    w = maxx - minx
    h = maxy - miny
    if w < 1e-9 or h < 1e-9:
        return np.zeros((out_size, out_size), dtype=np.uint8)
    padx = pad_frac * w
    pady = pad_frac * h
    minx2, maxx2 = minx - padx, maxx + padx
    miny2, maxy2 = miny - pady, maxy + pady
    w2 = maxx2 - minx2
    h2 = maxy2 - miny2
    img = np.zeros((out_size, out_size), dtype=np.uint8)

    def to_px(x, y):
        return (
            int(round((x - minx2) / w2 * (out_size - 1))),
            int(round((1.0 - (y - miny2) / h2) * (out_size - 1))),
        )

    for si in cand.seg_indices:
        s = segments[si]
        if s.length() <= 1e-6:
            continue
        cv2.line(
            img,
            to_px(s.x1, s.y1),
            to_px(s.x2, s.y2),
            255,
            thickness=thickness,
            lineType=cv2.LINE_AA,
        )
    return img


def img_to_b64(img_np):
    _, buf = cv2.imencode(".png", img_np)
    return base64.b64encode(buf).decode()


# ─────────────────────────────────────────────────────────────────────────────
# CABLE SPAN HELPERS
# ─────────────────────────────────────────────────────────────────────────────


def find_cable_layer_name(layers: List[str]) -> Optional[str]:
    """
    Prefer exact 'cable' match (case-insensitive), then fallback to the first
    layer containing 'cable'.
    """
    if not layers:
        return None

    lower_map = {layer.lower(): layer for layer in layers}
    if "cable" in lower_map:
        return lower_map["cable"]

    for layer in layers:
        if "cable" in layer.lower():
            return layer
    return None


def build_cable_spans(doc, cable_layer: str, connect_tol: float = CABLE_CONNECT_TOL):
    """
    Group cable layer segments into clickable spans.
    Each span is a connected cluster of cable segments using endpoint proximity.
    """
    segments = extract_stroke_segments(doc, cable_layer)
    if not segments:
        return []

    clusters = cluster_segments(segments, tol=connect_tol)
    spans = []

    for span_id, idxs in enumerate(clusters):
        if not idxs:
            continue
        total_len = sum(segments[i].length() for i in idxs)
        if total_len <= 1e-8:
            continue

        bbox = _bbox_from_segments(segments, idxs)
        minx, miny, maxx, maxy = bbox
        cx = (minx + maxx) / 2.0
        cy = (miny + maxy) / 2.0

        span_segments = []
        for i in idxs:
            s = segments[i]
            if s.length() <= 1e-8:
                continue
            span_segments.append(
                {
                    "x1": s.x1,
                    "y1": s.y1,
                    "x2": s.x2,
                    "y2": s.y2,
                }
            )

        if not span_segments:
            continue

        spans.append(
            {
                "span_id": span_id,
                "layer": cable_layer,
                "bbox": [minx, miny, maxx, maxy],
                "cx": cx,
                "cy": cy,
                "segment_count": len(span_segments),
                "total_length": total_len,
                "segments": span_segments,
                "from_pole": None,
                "to_pole": None,
            }
        )

    spans.sort(key=lambda s: (-s["cy"], s["cx"]))
    for i, s in enumerate(spans):
        s["span_id"] = i

    return spans


# ─────────────────────────────────────────────────────────────────────────────
# Cable span meter value mapping (OCR → span)
# ─────────────────────────────────────────────────────────────────────────────


def assign_meter_values_to_spans(spans, ocr_results, max_dist=None):
    """
    Map OCR digit results to cable spans by proximity.

    Parameters:
        spans : list of dicts from build_cable_spans()
        ocr_results : list of dicts with 'center_x', 'center_y', 'value', 'corrected_value'
        max_dist : optional max distance (world units) for association.
                    If None, automatically compute based on DXF scale.

    Returns:
        spans : list of dicts with new key 'meter_value' added
    """
    if not spans:
        return spans
    if not ocr_results:
        for s in spans:
            s["meter_value"] = None
        return spans

    # Auto-tune max_dist if not provided
    if max_dist is None:
        avg_size = sum(
            max(s["bbox"][2] - s["bbox"][0], s["bbox"][3] - s["bbox"][1]) for s in spans
        ) / len(spans)
        max_dist = avg_size * 0.5
        print(f"[meter_assign] Auto max_dist={max_dist:.4f}")

    for span in spans:
        cx, cy = span["cx"], span["cy"]
        nearest_digit = None
        nearest_dist = float("inf")

        for r in ocr_results:
            dx = cx - r.get("center_x", 0)
            dy = cy - r.get("center_y", 0)
            dist = (dx**2 + dy**2) ** 0.5

            if dist < nearest_dist and dist <= max_dist:
                nearest_dist = dist
                nearest_digit = r

        if nearest_digit:
            value = nearest_digit.get("corrected_value") or nearest_digit.get("value")
            try:
                span["meter_value"] = float(value)
            except Exception:
                span["meter_value"] = None
                print(
                    f"[meter_assign] Non-numeric value for span {span['span_id']}: {value}"
                )
        else:
            span["meter_value"] = None
            print(
                f"[meter_assign] No OCR digit near span {span['span_id']} (max_dist={max_dist})"
            )

        print(
            f"[meter_assign] span_id={span['span_id']} cx={cx:.3f} cy={cy:.3f} meter_value={span['meter_value']}"
        )

    return spans


# ─────────────────────────────────────────────────────────────────────────────
# CNN MODEL
# ─────────────────────────────────────────────────────────────────────────────


def load_model(model_path):
    ckpt = torch.load(model_path, map_location="cpu")
    num_classes = ckpt["num_classes"]
    sd = ckpt["state_dict"]
    fc_weight = sd["classifier.1.weight"]
    feature_flat = fc_weight.shape[1]
    feature_size = feature_flat // 128
    pool_side = int(feature_size**0.5)

    class _CadCNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(1, 32, 3, padding=1),
                nn.BatchNorm2d(32),
                nn.ReLU(),
                nn.Conv2d(32, 32, 3, padding=1),
                nn.BatchNorm2d(32),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(32, 64, 3, padding=1),
                nn.BatchNorm2d(64),
                nn.ReLU(),
                nn.Conv2d(64, 64, 3, padding=1),
                nn.BatchNorm2d(64),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(64, 128, 3, padding=1),
                nn.BatchNorm2d(128),
                nn.ReLU(),
                nn.AdaptiveAvgPool2d((pool_side, pool_side)),
            )
            self.classifier = nn.Sequential(
                nn.Flatten(),
                nn.Linear(feature_flat, 256),
                nn.ReLU(),
                nn.Dropout(0.4),
                nn.Linear(256, num_classes),
            )

        def forward(self, x):
            return self.classifier(self.features(x))

    model = _CadCNN()
    model.load_state_dict(sd)
    model.eval()
    return model, ckpt["idx2label"]


val_transform = transforms.Compose(
    [
        transforms.Resize((96, 96)),
        transforms.ToTensor(),
        transforms.Normalize((0.5,), (0.5,)),
    ]
)


def predict_image(model, idx2label, img_np):
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    img_np = clahe.apply(img_np)
    img = Image.fromarray(img_np)
    x = val_transform(img).unsqueeze(0)
    with torch.no_grad():
        logits = model(x)
        probs = F.softmax(logits / 1.5, dim=1)[0]
        idx = probs.argmax().item()
        conf = probs[idx].item()
    return idx2label[idx], round(float(conf), 4)


# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL STATE  (OCR pipeline)
# ─────────────────────────────────────────────────────────────────────────────

state = {
    "dxf_path": None,
    "model_path": None,
    "layer": None,
    "segments": [],
    "candidates": [],
    "results": [],
    "status": "idle",
    "progress": 0,
    "total": 0,
    "error": None,
}


def run_pipeline(dxf_path, layer, model_path):
    try:
        state["status"] = "processing"
        state["progress"] = 0
        state["error"] = None

        doc = ezdxf.readfile(dxf_path)
        segments = extract_stroke_segments(doc, layer, include_circles=False)
        state["segments"] = segments

        clusters = cluster_segments(segments, tol=CONNECT_TOL)
        infos = analyze_clusters(segments, clusters)
        candidates = build_candidates_robust(segments, infos)
        state["candidates"] = candidates
        state["total"] = len(candidates)

        model, idx2label = load_model(model_path)

        results = []
        for i, cand in enumerate(candidates):
            crop = render_crop(segments, cand)
            value, conf = predict_image(model, idx2label, crop)
            cx = (cand.bbox[0] + cand.bbox[2]) / 2
            cy = (cand.bbox[1] + cand.bbox[3]) / 2
            results.append(
                {
                    "digit_id": cand.digit_id,
                    "value": value,
                    "corrected_value": None,
                    "confidence": conf,
                    "needs_review": conf < 0.95,
                    "bbox": list(cand.bbox),
                    "center_x": cx,
                    "center_y": cy,
                    "crop_b64": img_to_b64(crop),
                }
            )
            state["progress"] = i + 1

        state["results"] = results
        state["status"] = "done"

    except Exception as e:
        import traceback

        traceback.print_exc()
        state["status"] = "error"
        state["error"] = str(e)


# ─────────────────────────────────────────────────────────────────────────────
# SHAPE / EQUIPMENT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

from app_python.services.boundary_service import (
    apply_boundary_filter,
    build_boundary_mask,
)
from app_python.services.shape_service import extract_equipment_shapes

SCAN_STATE = {
    "status": "idle",  # idle | processing | done | error
    "error": None,
    "shapes": [],
    "boundary": None,
    "progress": 0,
    "total": 0,
}

SHAPE_CONFIG = {
    "min_circle_r": 1e-5,
    "min_poly_area": 1e-6,
    "dedup_eps": 1e-4,
    "min_rect_short_side": 0.05,
    "max_rect_aspect": 50.0,
}

BOUNDARY_CONFIG = {
    "snap_tol": 0.60,
    "close_max_gap": 2.50,
    "min_area": 1e-6,
}


def _run_full_scan(dxf_path: str, boundary_layer: Optional[str]):
    try:
        SCAN_STATE.update(
            {
                "status": "processing",
                "error": None,
                "shapes": [],
                "boundary": None,
                "progress": 0,
                "total": 0,
            }
        )

        doc = ezdxf.readfile(dxf_path)
        layers = list_layers(dxf_path)

        # Map shape kinds to the layer name keywords where they live
        KIND_LAYER_MAP = {
            "circle": ["splitter", "tapoff", "tap-off", "tap_off"],
            "hexagon": ["tapoff", "tap-off", "tap_off"],
            "rectangle": ["node", "amplifier", "amp"],
            "square": ["tapoff", "tap-off", "tap_off"],
            "triangle": ["extender", "extend"],
        }

        # Build a set of (layer, kinds_to_keep) pairs — only scan layers that
        # match at least one keyword, and only keep the relevant shape kinds
        layer_kind_targets: Dict[str, List[str]] = {}
        for layer in layers:
            if boundary_layer and layer == boundary_layer:
                continue
            l_lower = layer.lower()
            kinds_for_layer = []
            for kind, keywords in KIND_LAYER_MAP.items():
                if any(kw in l_lower for kw in keywords):
                    kinds_for_layer.append(kind)
            if kinds_for_layer:
                layer_kind_targets[layer] = kinds_for_layer

        scan_layers = list(layer_kind_targets.keys())
        SCAN_STATE["total"] = len(scan_layers)

        print(
            f"[scan] Targeting {len(scan_layers)} relevant layers out of {len(layers)} total"
        )
        for l, kinds in layer_kind_targets.items():
            print(f"  {l} → {kinds}")

        all_shapes = []

        for i, layer in enumerate(scan_layers):
            allowed_kinds = set(layer_kind_targets[layer])
            try:
                shapes = extract_equipment_shapes(doc, layer, **SHAPE_CONFIG)
                for s in shapes:
                    if s.kind not in allowed_kinds:
                        continue
                    all_shapes.append(
                        {
                            "shape_id": -1,
                            "kind": s.kind,
                            "bbox": list(s.bbox),
                            "cx": s.cx,
                            "cy": s.cy,
                            "layer": layer,
                        }
                    )
            except Exception as e:
                print(f"[scan] Error on layer '{layer}': {e}")
            SCAN_STATE["progress"] = i + 1

        # Global dedup across layers (same kind + nearly same center)
        DEDUP_EPS = 0.5
        all_shapes.sort(key=lambda s: (s["kind"], s["cx"], s["cy"]))
        deduped = []
        for s in all_shapes:
            if not deduped:
                deduped.append(s)
                continue
            prev = deduped[-1]
            if (
                s["kind"] == prev["kind"]
                and abs(s["cx"] - prev["cx"]) < DEDUP_EPS
                and abs(s["cy"] - prev["cy"]) < DEDUP_EPS
            ):
                continue
            deduped.append(s)

        # Sort top-to-bottom, left-to-right and assign IDs
        deduped.sort(key=lambda s: (-s["cy"], s["cx"]))
        for i, s in enumerate(deduped):
            s["shape_id"] = i

        # Boundary (optional)
        boundary_pts = None
        if boundary_layer:
            try:
                boundary = build_boundary_mask(
                    doc, boundary_layer=boundary_layer, **BOUNDARY_CONFIG
                )
                if boundary:
                    boundary_pts = [{"x": p[0], "y": p[1]} for p in boundary.pts]
                    print(
                        f"[boundary] OK — {len(boundary.pts)} pts, area={boundary.area:.2f}"
                    )
                else:
                    print(f"[boundary] returned None for layer '{boundary_layer}'")
            except Exception as e:
                import traceback

                traceback.print_exc()
                print(f"[boundary] ERROR: {e}")

        SCAN_STATE.update(
            {
                "status": "done",
                "shapes": deduped,
                "boundary": boundary_pts,
            }
        )
        print(f"[scan] Done — {len(deduped)} shapes across {len(scan_layers)} layers")

    except Exception as e:
        import traceback

        traceback.print_exc()
        SCAN_STATE.update({"status": "error", "error": str(e)})


@app.route("/api/scan_equipment", methods=["POST"])
def api_scan_equipment():
    data = request.get_json()
    dxf_path = data.get("dxf_path", "") or state.get("dxf_path", "")
    boundary_layer = data.get("boundary_layer") or None

    if not dxf_path:
        return jsonify({"error": "No DXF loaded"}), 400

    t = threading.Thread(
        target=_run_full_scan,
        args=(dxf_path, boundary_layer),
        daemon=True,
    )
    t.start()
    return jsonify({"ok": True})


@app.route("/api/scan_status")
def api_scan_status():
    return jsonify(
        {
            "status": SCAN_STATE["status"],
            "error": SCAN_STATE["error"],
            "progress": SCAN_STATE["progress"],
            "total": SCAN_STATE["total"],
            "count": len(SCAN_STATE["shapes"]),
        }
    )


@app.route("/api/scan_results")
def api_scan_results():
    segs = [{"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2} for s in state["segments"]]
    return jsonify(
        {
            "shapes": SCAN_STATE["shapes"],
            "boundary": SCAN_STATE["boundary"],
            "segments": segs,
        }
    )


import poleid as _poleid
from app_python.services.pole_ocr import ocr_pole

POLE_STATE: Dict = {
    "status": "idle",  # idle | processing | done | error
    "error": None,
    "tags": [],
    "layer": None,
    "dxf_path": None,
    "progress": 0,
    "total": 0,
}

POLE_CONFIG = _poleid.PoleIdConfig(
    include_text=True,
    include_mtext=True,
    filter_text_by_regex=True,
    include_stroke=True,
    use_circle_markers=False,
    require_circle_match=False,
    max_dist_factor=4.0,
    default_text_height=0.25,
    stroke_connect_tol=0.20,
    stroke_min_total_length=0.30,
    stroke_min_segments=4,
    stroke_min_bbox_w=0.05,
    stroke_min_bbox_h=0.05,
    stroke_max_aspect=20.0,
    stroke_max_dom_dir=0.97,
    stroke_max_endpoints=24,
    stroke_placeholder_prefix="POLE",
)


OCR_WORKERS = 4  # parallel OCR calls — tune up if your CPU has more cores


def _run_pole_scan(dxf_path: str, layer_name: str) -> None:
    """
    Background thread: scan one layer for pole labels, then run OCR
    on all STR placeholder labels in parallel using a thread pool.

    Results are written to POLE_STATE["tags"] incrementally so the
    frontend can display poles as they finish (progressive rendering).
    """
    try:
        POLE_STATE.update(
            {
                "status": "processing",
                "error": None,
                "tags": [],
                "layer": layer_name,
                "progress": 0,
                "total": 0,
            }
        )

        doc = ezdxf.readfile(dxf_path)
        matches = _poleid.find_pole_labels(doc, layer_name, config=POLE_CONFIG)

        all_layer_segs = extract_stroke_segments(doc, layer_name)
        placeholder_prefix = (POLE_CONFIG.stroke_placeholder_prefix or "POLE").upper()

        # ── Build work list ───────────────────────────────────────────────────
        # Separate poles that need OCR from those that already have a real name.
        # Non-OCR poles are added to tags immediately; OCR poles are queued.

        tags = []  # final ordered result list
        tags_lock = threading.Lock()

        ocr_queue = []  # list of (pole_id, lab, bbox) needing OCR
        non_ocr = []  # list of ready tag dicts (text / mtext labels)

        for pole_id, (lab, _circ) in enumerate(matches):
            bbox = list(lab.bbox) if lab.bbox else [lab.x, lab.y, lab.x, lab.y]
            source = getattr(lab, "source", "unknown")
            display_name = _poleid.clean_label(lab.text)
            is_placeholder = display_name.upper().startswith(placeholder_prefix)

            if source == "stroke" and is_placeholder:
                ocr_queue.append((pole_id, lab, bbox, source))
            else:
                non_ocr.append(
                    {
                        "pole_id": pole_id,
                        "name": display_name,
                        "cx": round(lab.x, 4),
                        "cy": round(lab.y, 4),
                        "bbox": [round(v, 4) for v in bbox],
                        "layer": layer_name,
                        "source": source,
                        "crop_b64": None,
                        "ocr_conf": None,
                        "needs_review": False,
                    }
                )

        # Add non-OCR poles to state immediately so map shows them right away
        with tags_lock:
            tags.extend(non_ocr)
            POLE_STATE["tags"] = list(tags)
            POLE_STATE["total"] = len(matches)
            POLE_STATE["progress"] = len(non_ocr)

        # ── OCR worker function ───────────────────────────────────────────────

        def _ocr_one(args):
            pole_id, lab, bbox, source = args
            display_name = _poleid.clean_label(lab.text)
            crop_b64 = None
            ocr_conf = None
            needs_review = False

            try:
                label_segs = getattr(lab, "segments", None) or all_layer_segs
                result = ocr_pole(label_segs, tuple(bbox))

                if result.crop_png:
                    crop_b64 = base64.b64encode(result.crop_png).decode("ascii")
                ocr_conf = result.confidence

                if result.accepted and result.text:
                    display_name = result.text
                    needs_review = False
                else:
                    needs_review = True

            except Exception as ocr_err:
                needs_review = True
                print(f"[pole_ocr] POLE_{pole_id:03d} error: {ocr_err}")

            return {
                "pole_id": pole_id,
                "name": display_name,
                "cx": round(lab.x, 4),
                "cy": round(lab.y, 4),
                "bbox": [round(v, 4) for v in bbox],
                "layer": layer_name,
                "source": source,
                "crop_b64": crop_b64,
                "ocr_conf": ocr_conf,
                "needs_review": needs_review,
            }

        # ── Run OCR in parallel ───────────────────────────────────────────────

        if ocr_queue:
            with ThreadPoolExecutor(max_workers=OCR_WORKERS) as pool:
                futures = {pool.submit(_ocr_one, args): args for args in ocr_queue}

                for future in as_completed(futures):
                    try:
                        tag = future.result()
                    except Exception as e:
                        args = futures[future]
                        pole_id = args[0]
                        lab = args[1]
                        bbox = args[2]
                        source = args[3]
                        tag = {
                            "pole_id": pole_id,
                            "name": _poleid.clean_label(lab.text),
                            "cx": round(lab.x, 4),
                            "cy": round(lab.y, 4),
                            "bbox": [round(v, 4) for v in bbox],
                            "layer": layer_name,
                            "source": source,
                            "crop_b64": None,
                            "ocr_conf": None,
                            "needs_review": True,
                        }
                        print(f"[pole_scan] future error: {e}")

                    # Append result and update state progressively
                    with tags_lock:
                        tags.append(tag)
                        # Sort by pole_id so map order is stable
                        tags.sort(key=lambda t: t["pole_id"])
                        POLE_STATE["tags"] = list(tags)
                        POLE_STATE["progress"] = len(tags)

        # ── Final sort and done ───────────────────────────────────────────────

        tags.sort(key=lambda t: t["pole_id"])
        n_ocr = sum(1 for t in tags if t["ocr_conf"] is not None)
        n_ok = sum(
            1 for t in tags if t["ocr_conf"] is not None and not t["needs_review"]
        )

        POLE_STATE.update(
            {
                "status": "done",
                "tags": tags,
                "progress": len(tags),
            }
        )
        print(
            f"[pole_scan] Done — {len(tags)} poles on '{layer_name}' | "
            f"OCR attempted: {n_ocr}, accepted: {n_ok}"
        )

    except Exception as exc:
        import traceback

        traceback.print_exc()
        POLE_STATE.update({"status": "error", "error": str(exc)})


@app.route("/api/dxf_segments_no_circles")
def api_dxf_segments_no_circles():
    dxf_path = state.get("dxf_path")

    if not dxf_path:
        return jsonify({"error": "No DXF loaded"}), 400

    try:
        doc = ezdxf.readfile(dxf_path)
        layers = list_layers(dxf_path)

        all_segments = {}

        for layer in layers:
            segs = extract_stroke_segments(doc, layer, include_circles=False)

            all_segments[layer] = [
                {"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2} for s in segs
            ]

        return jsonify({"layers": layers, "segments": all_segments})

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/pole_tags")
def api_pole_tags():
    return jsonify(
        {
            "status": POLE_STATE["status"],
            "error": POLE_STATE["error"],
            "layer": POLE_STATE["layer"],
            "count": len(POLE_STATE["tags"]),
            "progress": POLE_STATE.get("progress", 0),
            "total": POLE_STATE.get("total", 0),
            "tags": POLE_STATE["tags"],
        }
    )


@app.route("/api/pole_tags/scan", methods=["POST"])
def api_pole_tags_scan():
    data = request.get_json()
    dxf_path = data.get("dxf_path", "") or state.get("dxf_path", "")
    layer_name = data.get("layer", "")

    if not dxf_path:
        return jsonify({"error": "No DXF loaded"}), 400
    if not layer_name:
        return jsonify({"error": "layer is required"}), 400

    t = threading.Thread(
        target=_run_pole_scan,
        args=(dxf_path, layer_name),
        daemon=True,
    )
    t.start()
    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────────────────────────
# EXPORT TO EXCEL
# ─────────────────────────────────────────────────────────────────────────────


def export_excel(results, dxf_path):
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    except ImportError:
        return None, "openpyxl not installed. Run: pip install openpyxl"

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Digit Results"

    header_fill = PatternFill("solid", fgColor="1A3A5C")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri")
    review_fill = PatternFill("solid", fgColor="FFF3CD")
    ok_fill = PatternFill("solid", fgColor="D4EDDA")
    sum_fill = PatternFill("solid", fgColor="E8EAF6")
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers = [
        "Digit ID",
        "Predicted Value",
        "Corrected Value",
        "Final Value",
        "Confidence %",
        "Needs Review",
        "Center X",
        "Center Y",
        "DXF File",
    ]
    col_widths = [10, 16, 16, 14, 14, 14, 12, 12, 30]

    for ci, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
        ws.column_dimensions[cell.column_letter].width = w

    ws.row_dimensions[1].height = 22
    dxf_name = Path(dxf_path).name
    total_sum = 0

    for ri, r in enumerate(results, 2):
        final_val = (
            r["corrected_value"] if r["corrected_value"] is not None else r["value"]
        )
        try:
            numeric = int(final_val)
            total_sum += numeric
        except:
            numeric = final_val

        row_data = [
            r["digit_id"],
            r["value"],
            r["corrected_value"] or "",
            final_val,
            round(r["confidence"] * 100, 1),
            "Yes" if r["needs_review"] else "No",
            round(r["center_x"], 4),
            round(r["center_y"], 4),
            dxf_name,
        ]
        fill = review_fill if r["needs_review"] else ok_fill
        for ci, val in enumerate(row_data, 1):
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.fill = fill
            cell.alignment = Alignment(horizontal="center")
            cell.border = border

    sum_row = len(results) + 2
    ws.cell(row=sum_row, column=1, value="TOTAL").font = Font(bold=True)
    sum_cell = ws.cell(row=sum_row, column=4, value=total_sum)
    sum_cell.font = Font(bold=True)
    for ci in range(1, len(headers) + 1):
        c = ws.cell(row=sum_row, column=ci)
        c.fill = sum_fill
        c.border = border

    # ── Sheet 2: Summary ─────────────────────────────────────────────────────
    ws2 = wb.create_sheet(title="Summary")
    h1 = ws2.cell(row=1, column=1, value="Digit ID")
    h2 = ws2.cell(row=1, column=2, value="Final Value")
    for cell in (h1, h2):
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
    ws2.column_dimensions["A"].width = 12
    ws2.column_dimensions["B"].width = 16
    ws2.row_dimensions[1].height = 22

    sum2 = 0
    for ri, r in enumerate(results, 2):
        final_val = (
            r["corrected_value"] if r["corrected_value"] is not None else r["value"]
        )
        try:
            sum2 += int(final_val)
        except:
            pass
        c1 = ws2.cell(row=ri, column=1, value=r["digit_id"])
        c2 = ws2.cell(row=ri, column=2, value=final_val)
        for c in (c1, c2):
            c.alignment = Alignment(horizontal="center")
            c.border = border

    tr = len(results) + 2
    for c in (
        ws2.cell(row=tr, column=1, value="TOTAL"),
        ws2.cell(row=tr, column=2, value=sum2),
    ):
        c.fill = sum_fill
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal="center")
        c.border = border

    # ── Sheet 3: Equipment ───────────────────────────────────────────────────
    shapes = SCAN_STATE.get("shapes", [])
    if shapes:
        ws3 = wb.create_sheet(title="Equipment")

        # Title
        title_cell = ws3.cell(row=1, column=1, value="Equipment Summary")
        title_cell.font = Font(bold=True, size=12, color="FFFFFF", name="Calibri")
        title_cell.fill = header_fill
        title_cell.alignment = Alignment(horizontal="center", vertical="center")
        ws3.merge_cells("A1:B1")
        ws3.row_dimensions[1].height = 22

        # Kind counts
        kind_counts: Dict[str, int] = {}
        for sh in shapes:
            kind_counts[sh["kind"]] = kind_counts.get(sh["kind"], 0) + 1

        ws3.cell(row=2, column=1, value="Shape Kind").font = header_font
        ws3.cell(row=2, column=2, value="Count").font = header_font
        for ci in [1, 2]:
            cell = ws3.cell(row=2, column=ci)
            cell.fill = header_fill
            cell.font = header_font
            cell.border = border
            cell.alignment = Alignment(horizontal="center")

        for ri, (kind, count) in enumerate(sorted(kind_counts.items()), 3):
            c1 = ws3.cell(row=ri, column=1, value=kind.capitalize())
            c2 = ws3.cell(row=ri, column=2, value=count)
            for c in (c1, c2):
                c.border = border
                c.alignment = Alignment(horizontal="center")

        total_row = len(kind_counts) + 3
        tc = ws3.cell(row=total_row, column=1, value="TOTAL")
        tc.font = Font(bold=True)
        tc.fill = sum_fill
        tc.border = border
        tc.alignment = Alignment(horizontal="center")
        tv = ws3.cell(row=total_row, column=2, value=len(shapes))
        tv.font = Font(bold=True)
        tv.fill = sum_fill
        tv.border = border
        tv.alignment = Alignment(horizontal="center")

        ws3.column_dimensions["A"].width = 16
        ws3.column_dimensions["B"].width = 10

        # Full shape list
        list_start = total_row + 2
        eq_headers = ["Shape ID", "Kind", "Layer", "Center X", "Center Y"]
        eq_widths = [10, 14, 30, 12, 12]

        for ci, (h, w) in enumerate(zip(eq_headers, eq_widths), 1):
            cell = ws3.cell(row=list_start, column=ci, value=h)
            cell.fill = header_fill
            cell.font = header_font
            cell.border = border
            cell.alignment = Alignment(horizontal="center")
            ws3.column_dimensions[cell.column_letter].width = w

        for ri, sh in enumerate(shapes, list_start + 1):
            row_data = [
                sh["shape_id"] + 1,
                sh["kind"].capitalize(),
                sh["layer"],
                round(sh["cx"], 4),
                round(sh["cy"], 4),
            ]
            for ci, val in enumerate(row_data, 1):
                cell = ws3.cell(row=ri, column=ci, value=val)
                cell.border = border
                cell.alignment = Alignment(horizontal="center")

    out_path = Path(dxf_path).stem + "_results.xlsx"
    wb.save(out_path)
    return out_path, None


def export_poles_excel(tags: list, dxf_path: str) -> tuple:
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    except ImportError:
        return None, "openpyxl not installed. Run: pip install openpyxl"

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Pole IDs"

    # ── Styles ────────────────────────────────────────────────────────────────
    header_fill = PatternFill("solid", fgColor="7C4A00")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri")
    row_fill = PatternFill("solid", fgColor="FEF3C7")
    total_fill = PatternFill("solid", fgColor="E8EAF6")
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # ── Header row ────────────────────────────────────────────────────────────
    headers = ["#", "Pole Name"]
    col_widths = [8, 28]

    for ci, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
        ws.column_dimensions[cell.column_letter].width = w
    ws.row_dimensions[1].height = 22
    ws.freeze_panes = "A2"

    # ── Data rows ─────────────────────────────────────────────────────────────
    for ri, tag in enumerate(tags, 2):
        row_data = [ri - 1, tag.get("name", "")]
        for ci, val in enumerate(row_data, 1):
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.fill = row_fill
            cell.alignment = Alignment(horizontal="center")
            cell.border = border

    # ── Total row ─────────────────────────────────────────────────────────────
    total_row = len(tags) + 2
    tc = ws.cell(row=total_row, column=1, value="TOTAL")
    tc.font = Font(bold=True)
    tc.fill = total_fill
    tc.border = border
    tc.alignment = Alignment(horizontal="center")

    tv = ws.cell(row=total_row, column=2, value=len(tags))
    tv.font = Font(bold=True)
    tv.fill = total_fill
    tv.border = border
    tv.alignment = Alignment(horizontal="center")

    out_path = Path(dxf_path).stem + "_pole_ids.xlsx"
    wb.save(out_path)
    return out_path, None


@app.route("/api/pole_tags/export", methods=["POST"])
def api_export_poles():
    dxf_path = state.get("dxf_path", "")
    tags = POLE_STATE.get("tags", [])

    if not tags:
        return jsonify({"error": "No pole tags to export. Run a scan first."}), 400

    path, err = export_poles_excel(tags, dxf_path or "pole_export")
    if err:
        return jsonify({"error": err}), 500
    return jsonify({"path": path})


def _find_pole_layer_name(layers: List[str]) -> Optional[str]:
    """
    Auto-detect the most likely pole label layer from the layer list.
    Checks for common naming patterns used in telecom DXF drawings.
    """
    patterns = ["pole", "poleid", "pole_id", "pole id", "tag", "label"]
    lower_map = {l.lower(): l for l in layers}

    # Exact match first
    for p in patterns:
        if p in lower_map:
            return lower_map[p]

    # Partial match
    for layer in layers:
        ll = layer.lower()
        for p in patterns:
            if p in ll:
                return layer

    return None


@app.route("/api/pole_tags/auto_scan", methods=["POST"])
def api_pole_tags_auto_scan():
    """
    Called automatically after a DXF is uploaded.
    Auto-detects the pole layer and starts a background scan immediately
    so results are ready by the time the user opens the Pole IDs tab.
    """
    data = request.get_json()
    dxf_path = data.get("dxf_path", "") or state.get("dxf_path", "")
    all_layers = data.get("layers", [])

    if not dxf_path:
        return jsonify({"error": "No DXF path provided"}), 400

    # Don't restart if already scanning or done for the same file
    if (
        POLE_STATE.get("status") in ("processing", "done")
        and POLE_STATE.get("dxf_path") == dxf_path
    ):
        return jsonify({"ok": True, "skipped": True, "layer": POLE_STATE.get("layer")})

    layer_name = _find_pole_layer_name(all_layers)
    if not layer_name:
        return jsonify(
            {"ok": False, "reason": "No pole layer detected in this drawing"}
        )

    # Store the dxf_path in POLE_STATE so we can check it above
    POLE_STATE["dxf_path"] = dxf_path

    t = threading.Thread(
        target=_run_pole_scan,
        args=(dxf_path, layer_name),
        daemon=True,
    )
    t.start()
    return jsonify({"ok": True, "layer": layer_name})


# ─────────────────────────────────────────────────────────────────────────────
# FLASK ROUTES  (internal — used by the Next.js frontend)
# ─────────────────────────────────────────────────────────────────────────────


@app.route("/")
def index():
    """Serve the built React app in production."""
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/status")
def api_status():
    return jsonify(
        {
            "status": state["status"],
            "progress": state["progress"],
            "total": state["total"],
            "error": state["error"],
        }
    )


@app.route("/api/results")
def api_results():
    segs = [{"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2} for s in state["segments"]]
    return jsonify({"results": state["results"], "segments": segs})


@app.route("/api/check_model")
def api_check_model():
    return jsonify({"ok": Path("cad_digit_model.pt").exists()})


# ─────────────────────────────────────────────────────────────────────────────
# FILE PLATFORM — persistent index (uploads/index.json)
# ─────────────────────────────────────────────────────────────────────────────

UPLOADS_DIR = Path("uploads")
INDEX_FILE = UPLOADS_DIR / "index.json"


def _read_index() -> dict:
    UPLOADS_DIR.mkdir(exist_ok=True)
    if not INDEX_FILE.exists():
        return {"folders": [], "files": []}
    try:
        return json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"folders": [], "files": []}


def _write_index(data: dict) -> None:
    UPLOADS_DIR.mkdir(exist_ok=True)
    INDEX_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _sync_index_sizes() -> dict:
    """
    Refresh file sizes / existence from disk and return the cleaned index.
    Also discovers any folders or files on disk that are not yet in the index,
    so that the file browser is populated on first load without requiring an upload.
    """
    data = _read_index()

    # ── 1. Drop missing files and refresh sizes ───────────────────────────────
    kept = []
    for f in data["files"]:
        p = Path(f["path"])
        if p.exists():
            f["size"] = p.stat().st_size
            kept.append(f)
    data["files"] = kept

    # ── 2. Discover subdirectories on disk not yet in the index ───────────────
    UPLOADS_DIR.mkdir(exist_ok=True)
    known_folders = set(data["folders"])
    for entry in UPLOADS_DIR.iterdir():
        if entry.is_dir() and entry.name not in known_folders:
            data["folders"].append(entry.name)
            known_folders.add(entry.name)

    # ── 3. Discover files inside known folders that are missing from the index ─
    indexed_paths = {f["path"] for f in data["files"]}
    for folder_name in data["folders"]:
        folder_dir = UPLOADS_DIR / folder_name
        if not folder_dir.exists():
            continue
        for file_entry in folder_dir.iterdir():
            if file_entry.is_file() and file_entry.suffix.lower() in (".dxf", ".pdf"):
                path_str = str(file_entry)
                if path_str not in indexed_paths:
                    data["files"].append(
                        {
                            "name": file_entry.name,
                            "path": path_str,
                            "size": file_entry.stat().st_size,
                            "modified": int(file_entry.stat().st_mtime),
                            "folder": folder_name,
                        }
                    )
                    indexed_paths.add(path_str)

    # ── 4. Discover root-level files not yet indexed ──────────────────────────
    for file_entry in UPLOADS_DIR.iterdir():
        if file_entry.is_file() and file_entry.suffix.lower() in (".dxf", ".pdf"):
            path_str = str(file_entry)
            if path_str not in indexed_paths:
                data["files"].append(
                    {
                        "name": file_entry.name,
                        "path": path_str,
                        "size": file_entry.stat().st_size,
                        "modified": int(file_entry.stat().st_mtime),
                        "folder": "",
                    }
                )
                indexed_paths.add(path_str)

    _write_index(data)
    return data


@app.route("/api/files/list", methods=["GET"])
def api_files_list():
    data = _sync_index_sizes()
    # Build per-folder file counts
    folder_counts: Dict[str, int] = {f: 0 for f in data["folders"]}
    for file in data["files"]:
        folder = file.get("folder", "")
        if folder and folder in folder_counts:
            folder_counts[folder] += 1
    folders_out = [
        {"name": name, "fileCount": cnt} for name, cnt in folder_counts.items()
    ]
    return jsonify({"folders": folders_out, "files": data["files"]})


@app.route("/api/files/mkdir", methods=["POST"])
def api_files_mkdir():
    body = request.get_json() or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    data = _read_index()
    if name not in data["folders"]:
        data["folders"].append(name)
        (UPLOADS_DIR / name).mkdir(parents=True, exist_ok=True)
        _write_index(data)
    return jsonify({"ok": True})


@app.route("/api/files/delete", methods=["POST"])
def api_files_delete():
    body = request.get_json() or {}
    path = (body.get("path") or "").strip()
    if not path:
        return jsonify({"error": "path is required"}), 400
    # Safety: only allow deleting inside the uploads directory
    try:
        Path(path).resolve().relative_to(UPLOADS_DIR.resolve())
    except ValueError:
        return jsonify({"error": "Invalid path"}), 400
    Path(path).unlink(missing_ok=True)
    data = _read_index()
    data["files"] = [f for f in data["files"] if f["path"] != path]
    _write_index(data)
    return jsonify({"ok": True})


@app.route("/api/files/rename", methods=["POST"])
def api_files_rename():
    body = request.get_json() or {}
    old_path_str = (body.get("path") or "").strip()
    new_name = (body.get("new_name") or "").strip()
    if not old_path_str or not new_name:
        return jsonify({"error": "path and new_name are required"}), 400
    old_path = Path(old_path_str)
    if not old_path.exists():
        return jsonify({"error": "File not found"}), 404
    # Preserve the original extension
    suffix = old_path.suffix or ".dxf"
    if not new_name.lower().endswith(suffix.lower()):
        new_name = new_name + suffix
    new_path = old_path.parent / new_name
    old_path.rename(new_path)
    data = _read_index()
    for f in data["files"]:
        if f["path"] == old_path_str:
            f["path"] = str(new_path)
            f["name"] = new_name
            break
    _write_index(data)
    return jsonify({"ok": True, "path": str(new_path)})


# /api/files/upload is an alias of /api/upload so the new LoadScreen
# can call either endpoint and both work identically.
@app.route("/api/upload", methods=["POST"])
@app.route("/api/files/upload", methods=["POST"])
def api_upload():
    try:
        file = request.files.get("file")
        if not file:
            return jsonify({"error": "No file provided"}), 400

        fname = Path(file.filename).name if file.filename else "uploaded.dxf"
        folder = (request.form.get("folder") or "").strip()

        UPLOADS_DIR.mkdir(exist_ok=True)

        # Place the file inside the chosen sub-folder (or root uploads dir)
        if folder:
            dest_dir = UPLOADS_DIR / folder
            dest_dir.mkdir(parents=True, exist_ok=True)
        else:
            dest_dir = UPLOADS_DIR

        save_path = str(dest_dir / fname)
        file.save(save_path)

        # PDF → DXF conversion
        if save_path.lower().endswith(".pdf"):
            try:
                dxf_path_str = pdf_to_dxf_autocad(save_path)
            except RuntimeError as e:
                return jsonify({"error": str(e)}), 400
            except Exception as e:
                import traceback

                traceback.print_exc()
                return jsonify({"error": "PDF conversion failed: " + str(e)}), 500
            # Remove the PDF, keep only the DXF
            Path(save_path).unlink(missing_ok=True)
            save_path = dxf_path_str
            fname = Path(save_path).name

        # Register in the persistent file index
        p = Path(save_path)
        data = _read_index()
        # Remove any stale entry with the same path before re-inserting
        data["files"] = [f for f in data["files"] if f["path"] != save_path]
        data["files"].append(
            {
                "name": fname,
                "path": save_path,
                "size": p.stat().st_size,
                "modified": int(p.stat().st_mtime),
                "folder": folder,
            }
        )
        _write_index(data)

        return jsonify({"path": save_path})

    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/layers", methods=["POST"])
def api_layers():
    data = request.get_json()
    dxf_path = data.get("dxf_path", "")
    try:
        layers = list_layers(dxf_path)
        return jsonify({"layers": layers})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/run", methods=["POST"])
def api_run():
    data = request.get_json()
    state["dxf_path"] = data["dxf_path"]
    state["layer"] = data["layer"]
    state["model_path"] = data["model_path"]
    t = threading.Thread(
        target=run_pipeline,
        args=(data["dxf_path"], data["layer"], data["model_path"]),
        daemon=True,
    )
    t.start()
    return jsonify({"ok": True})


@app.route("/api/export", methods=["POST"])
def api_export():
    data = request.get_json()
    corrections = data.get("corrections", {})
    partials = data.get("partials", {})

    # Apply OCR corrections
    for r in state["results"]:
        did = str(r["digit_id"])
        if did in corrections and corrections[did] is not None:
            r["corrected_value"] = corrections[did]

    # Pass partials to Excel export
    path, err = export_excel(state["results"], state["dxf_path"])
    if err:
        return jsonify({"error": err}), 500
    return jsonify({"path": path})


@app.route("/api/download")
def api_download():
    fpath = request.args.get("file", "")
    if not fpath or not Path(fpath).exists():
        return "File not found", 404
    return send_file(
        fpath,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=Path(fpath).name,
    )


@app.route("/api/dxf_segments")
def api_dxf_segments():
    dxf_path = state.get("dxf_path")
    hide_circles = request.args.get("hide_circles") == "1"
    if not dxf_path:
        return jsonify({"error": "No DXF loaded"}), 400
    try:
        doc = ezdxf.readfile(dxf_path)
        layers = list_layers(dxf_path)
        all_segments = {}
        for layer in layers:
            segs = extract_stroke_segments(doc, layer, include_circles=not hide_circles)
            all_segments[layer] = [
                {"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2} for s in segs
            ]
        return jsonify({"layers": layers, "segments": all_segments})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/cable_spans")
def api_cable_spans():
    dxf_path = state.get("dxf_path")
    if not dxf_path:
        return jsonify({"error": "No DXF loaded"}), 400

    try:
        doc = ezdxf.readfile(dxf_path)
        layers = list_layers(dxf_path)
        cable_layer = find_cable_layer_name(layers)

        if not cable_layer:
            return jsonify(
                {
                    "cable_layer": None,
                    "spans": [],
                    "message": "No cable layer found",
                }
            )

        spans = build_cable_spans(doc, cable_layer, connect_tol=CABLE_CONNECT_TOL)

        # Assign meter values
        spans = assign_meter_values_to_spans(spans, state.get("results", []))

        return jsonify(
            {
                "cable_layer": cable_layer,
                "count": len(spans),
                "spans": spans,
            }
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 400


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC INTEGRATION API  —  /api/v1/
# ─────────────────────────────────────────────────────────────────────────────
# All routes below are registered on the `public_api` Blueprint which is
# mounted at the /api/v1/ prefix.  External systems should use these endpoints.
# The internal routes above (no version prefix) are used by the React frontend.
# ─────────────────────────────────────────────────────────────────────────────


def _v1_ok(data: Any, status: int = 200):
    """Standard success envelope for v1 responses."""
    return jsonify({"ok": True, "data": data}), status


def _v1_err(message: str, status: int = 400):
    """Standard error envelope for v1 responses."""
    return jsonify({"ok": False, "error": message}), status


# ── GET /api/v1/health ────────────────────────────────────────────────────────


@public_api.route("/health", methods=["GET"])
def v1_health():
    """
    Liveness check. Always returns 200 when the server is running.

    Response data:
        service      : "strand-identifier"
        version      : "1.0.0"
        model_loaded : true | false
    """
    return _v1_ok(
        {
            "service": "strand-identifier",
            "version": "1.0.0",
            "model_loaded": Path("cad_digit_model.pt").exists(),
        }
    )


# ── GET /api/v1/status ────────────────────────────────────────────────────────


@public_api.route("/status", methods=["GET"])
def v1_status():
    """
    Full pipeline status snapshot — all three subsystems in one call.
    Poll this endpoint until the desired subsystem status is "done".

    Response data:
        dxf_path  : currently loaded file path, or null
        ocr       : { status, progress, total, error }
        equipment : { status, progress, total, count, error }
        poles     : { status, layer, progress, total, count, error }

    Status values: "idle" | "processing" | "done" | "error"
    """
    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "ocr": {
                "status": state.get("status", "idle"),
                "progress": state.get("progress", 0),
                "total": state.get("total", 0),
                "error": state.get("error"),
            },
            "equipment": {
                "status": SCAN_STATE.get("status", "idle"),
                "progress": SCAN_STATE.get("progress", 0),
                "total": SCAN_STATE.get("total", 0),
                "count": len(SCAN_STATE.get("shapes", [])),
                "error": SCAN_STATE.get("error"),
            },
            "poles": {
                "status": POLE_STATE.get("status", "idle"),
                "layer": POLE_STATE.get("layer"),
                "progress": POLE_STATE.get("progress", 0),
                "total": POLE_STATE.get("total", 0),
                "count": len(POLE_STATE.get("tags", [])),
                "error": POLE_STATE.get("error"),
            },
        }
    )


# ── GET /api/v1/ocr/results ───────────────────────────────────────────────────


@public_api.route("/ocr/results", methods=["GET"])
def v1_ocr_results():
    """
    All strand-digit OCR results for the currently loaded DXF.

    Query parameters:
        include_crops : "true"/"false"  (default "false") — include base64 crop PNGs
        needs_review  : "true"/"false"  (omit = return all) — filter by review status

    Response data:
        dxf_path : file path
        count    : number of results returned
        sum      : integer sum of all final_value fields
        results  : list of digit objects
    """
    if state.get("status") == "idle":
        return _v1_err("No OCR run has been started yet.", 404)
    if state.get("status") == "processing":
        return _v1_err(
            "OCR is still processing. Poll /api/v1/status for progress.", 202
        )
    if state.get("status") == "error":
        return _v1_err(f"OCR pipeline failed: {state.get('error')}", 500)

    include_crops = request.args.get("include_crops", "false").lower() == "true"
    filter_review = request.args.get("needs_review", "").lower()

    raw_results = list(state.get("results", []))

    if filter_review == "true":
        raw_results = [r for r in raw_results if r.get("needs_review")]
    elif filter_review == "false":
        raw_results = [r for r in raw_results if not r.get("needs_review")]

    output = []
    total_sum = 0
    for r in raw_results:
        final = r.get("corrected_value") or r.get("value", "")
        try:
            total_sum += int(final)
        except (ValueError, TypeError):
            pass

        output.append(
            {
                "digit_id": r.get("digit_id"),
                "value": r.get("value"),
                "corrected_value": r.get("corrected_value"),
                "final_value": final,
                "confidence": r.get("confidence"),
                "needs_review": r.get("needs_review"),
                "center_x": r.get("center_x"),
                "center_y": r.get("center_y"),
                "bbox": r.get("bbox"),
                "manual": r.get("manual", False),
                "crop_b64": r.get("crop_b64") if include_crops else None,
            }
        )

    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "count": len(output),
            "sum": total_sum,
            "results": output,
        }
    )


# ── GET /api/v1/ocr/segments ──────────────────────────────────────────────────


@public_api.route("/ocr/segments", methods=["GET"])
def v1_ocr_segments():
    """
    Raw DXF stroke segments from the most recent OCR scan.
    """
    raw_segs = state.get("segments", [])
    segments = [{"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2} for s in raw_segs]
    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "count": len(segments),
            "segments": segments,
        }
    )


# ── GET /api/v1/poles ─────────────────────────────────────────────────────────


@public_api.route("/poles", methods=["GET"])
def v1_poles():
    """
    All detected pole IDs for the currently loaded DXF.
    """
    status = POLE_STATE.get("status", "idle")
    if status == "idle":
        return _v1_err("No pole scan has been started yet.", 404)
    if status == "processing":
        return _v1_err("Pole scan is still running. Poll /api/v1/status.", 202)
    if status == "error":
        return _v1_err(f"Pole scan failed: {POLE_STATE.get('error')}", 500)

    include_crops = request.args.get("include_crops", "false").lower() == "true"
    filter_review = request.args.get("needs_review", "").lower()
    filter_source = request.args.get("source", "").lower()

    tags = list(POLE_STATE.get("tags", []))

    if filter_review == "true":
        tags = [t for t in tags if t.get("needs_review")]
    elif filter_review == "false":
        tags = [t for t in tags if not t.get("needs_review")]

    if filter_source in ("text", "mtext", "stroke"):
        tags = [t for t in tags if t.get("source") == filter_source]

    output = []
    for t in tags:
        output.append(
            {
                "pole_id": t.get("pole_id"),
                "name": t.get("name"),
                "cx": t.get("cx"),
                "cy": t.get("cy"),
                "bbox": t.get("bbox"),
                "layer": t.get("layer"),
                "source": t.get("source"),
                "ocr_conf": t.get("ocr_conf"),
                "needs_review": t.get("needs_review"),
                "crop_b64": t.get("crop_b64") if include_crops else None,
            }
        )

    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "layer": POLE_STATE.get("layer"),
            "count": len(output),
            "poles": output,
        }
    )


# ── GET /api/v1/equipment ─────────────────────────────────────────────────────


@public_api.route("/equipment", methods=["GET"])
def v1_equipment():
    """
    All detected equipment shapes for the currently loaded DXF.
    """
    status = SCAN_STATE.get("status", "idle")
    if status == "idle":
        return _v1_err("No equipment scan has been started yet.", 404)
    if status == "processing":
        return _v1_err("Equipment scan is still running. Poll /api/v1/status.", 202)
    if status == "error":
        return _v1_err(f"Equipment scan failed: {SCAN_STATE.get('error')}", 500)

    filter_kind = request.args.get("kind", "").lower()
    filter_layer = request.args.get("layer", "")

    all_shapes = SCAN_STATE.get("shapes", [])

    # Summary always on the full unfiltered set
    summary: Dict[str, int] = {}
    for s in all_shapes:
        summary[s["kind"]] = summary.get(s["kind"], 0) + 1

    filtered = list(all_shapes)
    if filter_kind:
        filtered = [s for s in filtered if s.get("kind") == filter_kind]
    if filter_layer:
        filtered = [s for s in filtered if s.get("layer") == filter_layer]

    output = [
        {
            "shape_id": s.get("shape_id"),
            "kind": s.get("kind"),
            "cx": s.get("cx"),
            "cy": s.get("cy"),
            "bbox": s.get("bbox"),
            "layer": s.get("layer"),
        }
        for s in filtered
    ]

    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "count": len(output),
            "summary": summary,
            "shapes": output,
        }
    )


# ── GET /api/v1/cable_spans ───────────────────────────────────────────────────


@public_api.route("/cable_spans", methods=["GET"])
def v1_cable_spans():
    """
    All cable spans for the currently loaded DXF, with OCR-matched meter values.
    """
    dxf_path = state.get("dxf_path")
    if not dxf_path:
        return _v1_err("No DXF has been loaded.", 404)

    include_segs = request.args.get("include_segments", "false").lower() == "true"

    try:
        doc = ezdxf.readfile(dxf_path)
        layers = list_layers(dxf_path)
        cable_layer = find_cable_layer_name(layers)

        if not cable_layer:
            return _v1_ok(
                {
                    "dxf_path": dxf_path,
                    "cable_layer": None,
                    "count": 0,
                    "spans": [],
                }
            )

        spans = build_cable_spans(doc, cable_layer, connect_tol=CABLE_CONNECT_TOL)
        spans = assign_meter_values_to_spans(spans, state.get("results", []))

        output = []
        for s in spans:
            output.append(
                {
                    "span_id": s["span_id"],
                    "layer": s.get("layer"),
                    "cx": s.get("cx"),
                    "cy": s.get("cy"),
                    "bbox": s.get("bbox"),
                    "total_length": s.get("total_length"),
                    "meter_value": s.get("meter_value"),
                    "cable_runs": s.get("cable_runs", 1),
                    "segment_count": s.get("segment_count"),
                    "from_pole": s.get("from_pole"),
                    "to_pole": s.get("to_pole"),
                    "segments": s.get("segments") if include_segs else None,
                }
            )

        return _v1_ok(
            {
                "dxf_path": dxf_path,
                "cable_layer": cable_layer,
                "count": len(output),
                "spans": output,
            }
        )

    except Exception as exc:
        import traceback

        traceback.print_exc()
        return _v1_err(str(exc), 500)


# ── POST /api/v1/export/ocr ───────────────────────────────────────────────────


@public_api.route("/export/ocr", methods=["POST"])
def v1_export_ocr():
    """
    Trigger an Excel export of OCR results and return a download URL.
    """
    if state.get("status") != "done":
        return _v1_err("OCR must complete before exporting.", 400)

    body = request.get_json(silent=True) or {}
    corrections = body.get("corrections", {})

    # Apply caller-supplied corrections
    for r in state.get("results", []):
        did = str(r["digit_id"])
        if did in corrections and corrections[did] is not None:
            r["corrected_value"] = corrections[did]

    path, err = export_excel(state["results"], state["dxf_path"])
    if err:
        return _v1_err(err, 500)

    return _v1_ok(
        {
            "download_url": f"/api/download?file={path}",
            "path": path,
        }
    )


# ── POST /api/v1/export/poles ─────────────────────────────────────────────────


@public_api.route("/export/poles", methods=["POST"])
def v1_export_poles():
    """
    Trigger an Excel export of pole IDs and return a download URL.
    """
    tags = POLE_STATE.get("tags", [])
    if not tags:
        return _v1_err("No pole tags to export. Run a scan first.", 400)

    body = request.get_json(silent=True) or {}
    overrides = body.get("overrides", {})

    # Apply caller-supplied name overrides without mutating server state
    export_tags = []
    for t in tags:
        pid_str = str(t.get("pole_id", ""))
        entry = dict(t)
        if pid_str in overrides:
            entry["name"] = overrides[pid_str]
        export_tags.append(entry)

    dxf_path = state.get("dxf_path") or "pole_export"
    path, err = export_poles_excel(export_tags, dxf_path)
    if err:
        return _v1_err(err, 500)

    return _v1_ok(
        {
            "download_url": f"/api/download?file={path}",
            "path": path,
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Run in dev mode (React runs separately on port 5173)",
    )
    args = parser.parse_args()

    print(f"\n{'=' * 50}")
    print(f"  CAD OCR – Flask Backend")
    print(f"  http://localhost:{args.port}")
    if args.dev:
        print(f"  React dev server: http://localhost:5173")
    print(f"{'=' * 50}\n")

    app.run(host="localhost", port=args.port, debug=False, threaded=True)


# ── Register blueprint now that all routes are defined ───────────────────────
app.register_blueprint(public_api)


# ── Pre-warm TrOCR at startup (before any worker threads spawn) ───────────────
def _prewarm_trocr():
    """Load TrOCR into the singleton once at startup, single-threaded."""
    try:
        from app_python.services.pole_ocr import _load_model

        print("[startup] Pre-warming TrOCR model...")
        _load_model()
        print("[startup] TrOCR pre-warm complete.")
    except Exception as e:
        print(f"[startup] TrOCR pre-warm failed (will retry on first scan): {e}")


_prewarm_trocr()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
    main()
