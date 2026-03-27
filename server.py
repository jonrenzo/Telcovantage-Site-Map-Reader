"""
CAD Digit OCR – Flask Backend
==============================
Serves the REST API consumed by the React frontend.

Changes from original:
  - CNN predict_image() replaced with EasyOCR (fixes overconfidence + domain mismatch)
  - EasyOCR runs full 8-rotation sweep per crop (0,90,180,270,45,135,225,315)
    with fast-accept at >= 0.85 confidence on cardinal angles
  - run_pipeline() now reports sub-step progress (extract/cluster/candidates/ocr)
  - Live digit counter + ETA written to state after every single crop
  - api_check_model() updated — no longer requires cad_digit_model.pt
  - _prewarm_trocr() replaced with _prewarm_ocr() for EasyOCR
  - Dead CNN code (load_model, predict_image, val_transform) removed
  - UPDATED: Arrays support for multi-layer OCR processing and multi-layer Cable span building
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
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import cv2
import ezdxf
import numpy as np
from flask import Blueprint, Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from PIL import Image

from app_python.planner_config import DEFAULT_PROJECT_ID, ENABLE_PLANNER_INTEGRATION
from app_python.services.planner_auth import auth

app = Flask(__name__, static_folder="frontend/dist", static_url_path="")
CORS(app)

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
        r"C:\Program Files\Autodesk\AutoCAD 2021\accoreconsole.exe",
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
# DXF PIPELINE CONSTANTS
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
CABLE_CONNECT_TOL = 0.10


# ─────────────────────────────────────────────────────────────────────────────
# DATA CLASSES
# ─────────────────────────────────────────────────────────────────────────────


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


# ─────────────────────────────────────────────────────────────────────────────
# EASYOCR SINGLETON + MULTI-ROTATION INFERENCE
# ─────────────────────────────────────────────────────────────────────────────

import re as _re

_easyocr_reader = None
_easyocr_lock = threading.Lock()

_OCR_ROTATION_PAIRS = [
    (0, 180),
    (90, 270),
    (15, 195),
    (30, 210),
    (45, 225),
    (60, 240),
    (75, 255),
    (105, 285),
    (120, 300),
    (135, 315),
    (150, 330),
    (165, 345),
]

_FAST_ACCEPT_CONF = 0.95
_MIN_CONF = 0.98
_MAX_STRAND_VALUE = 75
_STRAND_RE = _re.compile(r"^\d{1,2}$")


def _is_valid_strand(text: str) -> bool:
    if not text or not _STRAND_RE.match(text):
        return False
    try:
        return int(text) <= _MAX_STRAND_VALUE
    except ValueError:
        return False


def _load_easyocr():
    global _easyocr_reader
    if _easyocr_reader is not None:
        return _easyocr_reader

    with _easyocr_lock:
        if _easyocr_reader is not None:
            return _easyocr_reader

        import easyocr

        print("[ocr] Loading EasyOCR reader (first-time download may take ~30s)...")
        _easyocr_reader = easyocr.Reader(["en"], gpu=False)
        print("[ocr] EasyOCR ready.")

    return _easyocr_reader


def _rotate_crop(img: np.ndarray, degrees: int) -> np.ndarray:
    if degrees == 0:
        return img
    if degrees == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if degrees == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    if degrees == 270:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)

    from PIL import Image as _PILImage

    orig_h, orig_w = img.shape[:2]
    pil = _PILImage.fromarray(img)
    rotated = pil.rotate(-degrees, resample=_PILImage.BICUBIC, expand=True, fillcolor=0)
    rotated = rotated.resize((orig_w, orig_h), _PILImage.BICUBIC)
    return np.array(rotated)


def _easyocr_on_prepared(img: np.ndarray) -> Tuple[str, float]:
    reader = _load_easyocr()
    h, w = img.shape[:2]

    try:
        results = reader.recognize(
            img,
            horizontal_list=[[0, w, 0, h]],
            free_list=[],
            allowlist="0123456789",
            detail=1,
        )
    except Exception:
        results = reader.readtext(
            img,
            allowlist="0123456789",
            detail=1,
            paragraph=False,
        )

    if not results:
        return "", 0.0

    best = max(results, key=lambda x: x[2])
    text = best[1].strip()
    conf = float(best[2])

    if not _is_valid_strand(text):
        return text, conf * 0.5

    return text, conf


def predict_with_easyocr(crop_np: np.ndarray) -> Tuple[str, float]:
    CONF_GAP_THRESHOLD = 0.08
    STRONG_PAIR_CONF = 0.80

    best_text = ""
    best_conf = 0.0
    best_valid = False
    strong_winners: List[Tuple[str, float]] = []

    def _run_angle(degrees: int) -> Tuple[str, float, bool]:
        rotated = _rotate_crop(crop_np, degrees)
        inverted = cv2.bitwise_not(rotated)
        padded = cv2.copyMakeBorder(
            inverted, 16, 16, 16, 16, cv2.BORDER_CONSTANT, value=255
        )
        text, conf = _easyocr_on_prepared(padded)
        valid = _is_valid_strand(text)
        return text, conf, valid

    def _better(t1, c1, v1, t2, c2, v2) -> bool:
        if v2 and not v1:
            return True
        if not v2:
            return False
        if len(t2) == 2 and len(t1) != 2:
            return True
        if len(t2) != 2 and len(t1) == 2:
            return False
        return c2 > c1

    for deg_a, deg_b in _OCR_ROTATION_PAIRS:
        ta, ca, va = _run_angle(deg_a)
        tb, cb, vb = _run_angle(deg_b)

        pt, pc, pv = (tb, cb, vb) if _better(ta, ca, va, tb, cb, vb) else (ta, ca, va)
        if not pv:
            continue

        if len(pt) == 2 and pc >= STRONG_PAIR_CONF:
            strong_winners.append((pt, pc))

        if not best_valid:
            best_text, best_conf, best_valid = pt, pc, True
        else:
            if _better(best_text, best_conf, True, pt, pc, True):
                if len(pt) == 2 and len(best_text) != 2:
                    best_text, best_conf = pt, pc
                elif len(pt) == len(best_text) and pc > best_conf + CONF_GAP_THRESHOLD:
                    best_text, best_conf = pt, pc

        if best_valid and len(best_text) == 2 and best_conf >= _FAST_ACCEPT_CONF:
            break

    if len(strong_winners) >= 2:
        unique_vals = set(t for t, _ in strong_winners)
        if len(unique_vals) > 1:
            best_conf = min(best_conf, 0.40)

    return best_text, round(best_conf, 4)


# ─────────────────────────────────────────────────────────────────────────────
# DXF GEOMETRY HELPERS
# ─────────────────────────────────────────────────────────────────────────────


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
    ARC_STEPS, SPLINE_STEPS, CIRCLE_STEPS = 24, 30, 36

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


def _split_by_gap(segments, info, med_w, med_h):
    mids_x = []
    mids_y = []
    for i in info.seg_indices:
        s = segments[i]
        mids_x.append((s.x1 + s.x2) / 2.0)
        mids_y.append((s.y1 + s.y2) / 2.0)

    if len(mids_x) < 4:
        return [info]

    def find_best_gap(values, total_dim):
        sv = sorted(values)
        best_gap = -1.0
        best_split = None
        for k in range(1, len(sv)):
            gap = sv[k] - sv[k - 1]
            if gap > best_gap:
                best_gap = gap
                best_split = (sv[k] + sv[k - 1]) / 2.0
        if best_split is None or best_gap < total_dim * 0.20:
            return None, -1.0
        return best_split, best_gap

    def do_split(axis_values, axis, threshold):
        a_idxs, b_idxs = [], []
        for k, i in enumerate(info.seg_indices):
            if axis_values[k] < threshold:
                a_idxs.append(i)
            else:
                b_idxs.append(i)
        results = []
        for half in (a_idxs, b_idxs):
            if len(half) < 2:
                continue
            bx = _bbox_from_segments(segments, half)
            w = bx[2] - bx[0]
            h = bx[3] - bx[1]
            tlen = sum(segments[j].length() for j in half)
            if tlen < MIN_TOTAL_LENGTH or w < 1e-9 or h < 1e-9:
                continue
            results.append(
                ClusterInfo(info.cluster_id, half, bx, w, h, tlen, "digit_candidate")
            )
        return results if len(results) == 2 else [info]

    if info.height > med_h * 1.5:
        split_y, gap_y = find_best_gap(mids_y, info.height)
        if split_y is not None:
            result = do_split(mids_y, "y", split_y)
            if len(result) == 2:
                return result

    if info.width > med_w * 3.0:
        split_x, gap_x = find_best_gap(mids_x, info.width)
        if split_x is not None:
            result = do_split(mids_x, "x", split_x)
            if len(result) == 2:
                return result

    return [info]


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
            for split in _split_by_gap(segments, i, med_w, med_h):
                final_infos.append(split)
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
            for split in _split_by_gap(
                segments,
                ClusterInfo(i.cluster_id, comp, bx, w, h, tlen, "digit_candidate"),
                med_w,
                med_h,
            ):
                final_infos.append(split)
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


def render_crop(segments, cand, out_size=128, pad_frac=0.15, thickness=2):
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


def find_cable_layer_names(layers: List[str]) -> List[str]:
    """Finds and returns ALL layers that contain 'cable' in their name."""
    if not layers:
        return []
    matched = []
    for layer in layers:
        if "cable" in layer.lower():
            matched.append(layer)
    return matched


def build_cable_spans(
    doc, cable_layers: List[str], connect_tol: float = CABLE_CONNECT_TOL
):
    """Build spans across MULTIPLE cable layers."""
    spans = []
    global_span_id = 0

    for cable_layer in cable_layers:
        segments = extract_stroke_segments(doc, cable_layer)
        if not segments:
            continue

        clusters = cluster_segments(segments, tol=connect_tol)

        for idxs in clusters:
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
                span_segments.append({"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2})

            if not span_segments:
                continue

            spans.append(
                {
                    "span_id": global_span_id,
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
            global_span_id += 1

    spans.sort(key=lambda s: (-s["cy"], s["cx"]))
    for i, s in enumerate(spans):
        s["span_id"] = i

    return spans


def assign_meter_values_to_spans(spans, ocr_results, max_dist=None):
    if not spans:
        return spans
    if not ocr_results:
        for s in spans:
            s["meter_value"] = None
        return spans

    if max_dist is None:
        avg_size = sum(
            max(s["bbox"][2] - s["bbox"][0], s["bbox"][3] - s["bbox"][1]) for s in spans
        ) / len(spans)
        max_dist = avg_size * 0.5

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
        else:
            span["meter_value"] = None

    return spans


# ─────────────────────────────────────────────────────────────────────────────
# PLANNER INTEGRATION
# ─────────────────────────────────────────────────────────────────────────────


def push_to_planner(
    dxf_path: str,
    poles: list,
    spans: list,
    equipment: list,
    ocr_results: list,
    project_id: int,
) -> dict:
    """
    Push processed CAD data to TelcoVantage Planner API using bulk upload.

    Sends a single JSON file containing node + poles + pole_spans to the
    /bulk-upload endpoint instead of making individual POST requests.

    Args:
        dxf_path: Path to the DXF file
        poles: List of pole data from POLE_STATE
        spans: List of cable spans from build_cable_spans
        equipment: List of equipment shapes from SCAN_STATE
        ocr_results: OCR results for meter values
        project_id: Planner project ID

    Returns:
        Dict with success status and created counts
    """
    if not ENABLE_PLANNER_INTEGRATION:
        print("[planner] Integration disabled, skipping push.")
        return {"skipped": True, "reason": "Planner integration disabled"}

    try:
        print(f"[planner] Starting bulk push for {dxf_path}")

        # 1. Derive node_id from DXF filename (e.g., "TY-2026" from filename)
        dxf_name = Path(dxf_path).stem if dxf_path else "CAD_NODE"
        node_id = dxf_name.split("_")[0] if "_" in dxf_name else dxf_name
        if not node_id:
            node_id = "CAD_NODE"

        # 2. Calculate equipment counts
        equipment_counts = {"amplifier": 0, "extender": 0, "tsc": 0}
        for shape in equipment:
            kind = shape.get("kind", "")
            if kind in ("circle", "square", "hexagon"):
                equipment_counts["tsc"] += 1
            elif kind == "rectangle":
                equipment_counts["amplifier"] += 1
            elif kind == "triangle":
                equipment_counts["extender"] += 1

        # 3. Assign OCR meter values to spans
        spans = assign_meter_values_to_spans(spans, ocr_results)

        # 4. Build poles list with sequential codes
        poles_list = []
        pole_code_map = {}  # pole_name -> pole_code
        pole_counter = 1

        for pole in poles:
            pole_name = (pole.get("corrected_name") or pole.get("name", "")).strip()
            if not pole_name:
                continue
            # Skip duplicates (use first occurrence)
            if pole_name in pole_code_map:
                continue

            pole_code = f"{pole_counter:03d}"
            pole_code_map[pole_name] = pole_code
            pole_counter += 1

            poles_list.append(
                {
                    "pole_code": pole_code,
                    "pole_name": pole_name,
                    "map_latitude": pole.get("cy"),
                    "map_longitude": pole.get("cx"),
                }
            )

        print(f"[planner] Built {len(poles_list)} poles for upload")

        # 5. Build pole_spans list
        pole_spans = []
        pole_pair_counts = {}  # Track occurrences for unique span codes
        spans_skipped = 0

        for span in spans:
            from_pole = span.get("from_pole")
            to_pole = span.get("to_pole")

            # Skip invalid spans
            if not from_pole or not to_pole:
                spans_skipped += 1
                continue
            if from_pole == to_pole:
                spans_skipped += 1
                continue
            if from_pole not in pole_code_map or to_pole not in pole_code_map:
                spans_skipped += 1
                continue

            from_code = pole_code_map[from_pole]
            to_code = pole_code_map[to_pole]

            # Generate unique pole_span_code with index for duplicate pairs
            pole_pair = tuple(sorted([from_code, to_code]))
            occurrence = pole_pair_counts.get(pole_pair, 0) + 1
            pole_pair_counts[pole_pair] = occurrence

            if occurrence == 1:
                pole_span_code = f"{node_id}-{from_code}-{to_code}"
            else:
                pole_span_code = f"{node_id}-{from_code}-{to_code}-{occurrence}"

            pole_spans.append(
                {
                    "from_pole_code": from_code,
                    "to_pole_code": to_code,
                    "pole_span_code": pole_span_code,
                    "length_meters": span.get("meter_value", 0) or 0,
                    "runs": span.get("cable_runs", 1),
                    "expected_cable": span.get("meter_value", 0) or 0,
                }
            )

        print(
            f"[planner] Built {len(pole_spans)} pole spans for upload ({spans_skipped} skipped)"
        )

        # 6. Build node data
        total_strand_length = sum(s.get("length_meters", 0) for s in pole_spans)
        node_data = {
            "node_id": node_id,
            "node_name": node_id,
            "total_strand_length": total_strand_length,
            "expected_cable": total_strand_length,
            "node_count": 1,
            "date_start": datetime.now().strftime("%Y-%m-%d"),
            **equipment_counts,
        }

        # 7. Build payload
        payload = {
            "project_id": project_id,
            "node": node_data,
            "poles": poles_list,
            "pole_spans": pole_spans,
        }

        print(
            f"[planner] Uploading bulk payload: {len(poles_list)} poles, {len(pole_spans)} spans"
        )

        # 8. Upload via bulk endpoint
        result = auth.bulk_upload(payload)

        print(f"[planner] Bulk upload successful: {result.get('message', 'OK')}")

        # 9. Return result summary
        data = result.get("data", result)
        summary = data.get("summary", {})

        return {
            "success": True,
            "node_id": data.get("node", {}).get("id"),
            "node_action": data.get("node", {}).get("action", "created"),
            "poles_created": summary.get("poles_count", len(poles_list)),
            "spans_created": summary.get("pole_spans_count", len(pole_spans)),
            "spans_skipped": spans_skipped,
        }

    except Exception as e:
        print(f"[planner] Bulk push failed: {e}")
        import traceback

        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL STATE  (OCR pipeline)
# ─────────────────────────────────────────────────────────────────────────────

state = {
    "dxf_path": None,
    "model_path": None,
    "layers": [],
    "segments": [],
    "candidates": [],
    "results": [],
    "status": "idle",
    "progress": 0,
    "total": 0,
    "error": None,
    "step": 0,
    "step_label": "",
    "ocr_start_time": None,
}


# ─────────────────────────────────────────────────────────────────────────────
# POST-OCR VALIDATION
# ─────────────────────────────────────────────────────────────────────────────


def _post_ocr_validate(results: list) -> list:
    from collections import Counter

    value_counts = Counter(
        r.get("corrected_value") or r.get("value", "") for r in results
    )

    flagged = 0
    for r in results:
        if r.get("needs_review"):
            continue

        val = r.get("corrected_value") or r.get("value", "")
        conf = r.get("confidence", 0.0)
        freq = value_counts.get(val, 0)

        is_single_digit = val.isdigit() and len(val) == 1 and val != "0"
        if is_single_digit and freq < 3:
            r["needs_review"] = True
            flagged += 1
            continue

        if freq == 1 and conf < 0.80:
            r["needs_review"] = True
            flagged += 1
            continue

        if is_single_digit and conf < 0.90:
            r["needs_review"] = True
            flagged += 1

    return results


# ─────────────────────────────────────────────────────────────────────────────
# OCR PIPELINE
# ─────────────────────────────────────────────────────────────────────────────


def run_pipeline(dxf_path, layers, model_path):
    try:
        state.update(
            {
                "status": "processing",
                "progress": 0,
                "total": 0,
                "error": None,
                "step": 1,
                "step_label": "Extracting stroke segments…",
                "ocr_start_time": None,
                "results": [],
            }
        )

        # ── Step 1: Extract segments from ALL chosen layers ────────────────
        doc = ezdxf.readfile(dxf_path)
        all_segments = []
        for lyr in layers:
            segs = extract_stroke_segments(doc, lyr, include_circles=False)
            all_segments.extend(segs)

        state["segments"] = all_segments

        # ── Step 2: Cluster ───────────────────────────────────────────────
        state.update({"step": 2, "step_label": "Grouping into digit clusters…"})
        clusters = cluster_segments(all_segments, tol=CONNECT_TOL)
        infos = analyze_clusters(all_segments, clusters)

        # ── Step 3: Build candidates ──────────────────────────────────────
        state.update({"step": 3, "step_label": "Identifying digit candidates…"})
        candidates = build_candidates_robust(all_segments, infos)
        state["candidates"] = candidates
        state["total"] = len(candidates)

        if not candidates:
            state.update(
                {
                    "status": "done",
                    "step": 4,
                    "step_label": "Done — no candidates found",
                }
            )
            return

        crops = [render_crop(all_segments, cand) for cand in candidates]

        # ── Step 4: OCR ───────────────────────────────────────────────────
        state.update(
            {
                "step": 4,
                "step_label": f"Reading digit 0 of {len(candidates)}…",
                "ocr_start_time": time.time(),
            }
        )

        results = []

        for i, (cand, crop) in enumerate(zip(candidates, crops)):
            value, conf = predict_with_easyocr(crop)

            cx = (cand.bbox[0] + cand.bbox[2]) / 2
            cy = (cand.bbox[1] + cand.bbox[3]) / 2

            needs_review = (not value) or (conf < _MIN_CONF)

            results.append(
                {
                    "digit_id": cand.digit_id,
                    "value": value if value else "?",
                    "corrected_value": None,
                    "confidence": round(conf, 4),
                    "needs_review": needs_review,
                    "bbox": list(cand.bbox),
                    "center_x": cx,
                    "center_y": cy,
                    "crop_b64": img_to_b64(crop),
                }
            )

            done = i + 1
            elapsed = time.time() - state["ocr_start_time"]
            rate = done / elapsed if elapsed > 0 else 0
            remaining = len(candidates) - done
            eta_secs = int(remaining / rate) if rate > 0 else 0

            if eta_secs >= 60:
                eta_str = f"{eta_secs // 60}m {eta_secs % 60}s remaining"
            elif eta_secs > 0:
                eta_str = f"~{eta_secs}s remaining"
            else:
                eta_str = "almost done…"

            state.update(
                {
                    "results": list(results),
                    "progress": done,
                    "step_label": f"Reading digit {done} of {len(candidates)} — {eta_str}",
                }
            )

        results = _post_ocr_validate(results)

        state.update(
            {
                "status": "done",
                "step": 4,
                "step_label": "Done",
                "results": results,
            }
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        state.update({"status": "error", "error": str(e)})


# ─────────────────────────────────────────────────────────────────────────────
# SHAPE / EQUIPMENT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

from app_python.services.boundary_service import (
    apply_boundary_filter,
    build_boundary_mask,
)
from app_python.services.shape_service import extract_equipment_shapes

SCAN_STATE = {
    "status": "idle",
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

        KIND_LAYER_MAP = {
            "circle": ["splitter", "tapoff", "tap-off", "tap_off"],
            "hexagon": ["tapoff", "tap-off", "tap_off"],
            "rectangle": ["node", "amplifier", "amp"],
            "square": ["tapoff", "tap-off", "tap_off"],
            "triangle": ["extender", "extend"],
        }

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
                pass
            SCAN_STATE["progress"] = i + 1

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

        deduped.sort(key=lambda s: (-s["cy"], s["cx"]))
        for i, s in enumerate(deduped):
            s["shape_id"] = i

        boundary_pts = None
        if boundary_layer:
            try:
                boundary = build_boundary_mask(
                    doc, boundary_layer=boundary_layer, **BOUNDARY_CONFIG
                )
                if boundary:
                    boundary_pts = [{"x": p[0], "y": p[1]} for p in boundary.pts]
            except Exception as e:
                pass

        SCAN_STATE.update(
            {
                "status": "done",
                "shapes": deduped,
                "boundary": boundary_pts,
            }
        )

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


# ─────────────────────────────────────────────────────────────────────────────
# POLE DETECTION
# ─────────────────────────────────────────────────────────────────────────────
import poleid as _poleid
from app_python.services.pole_ocr import ocr_pole

POLE_STATE: Dict = {
    "status": "idle",
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

OCR_WORKERS = 4


def _run_pole_scan(dxf_path: str, layer_name: str) -> None:
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

        tags = []
        tags_lock = threading.Lock()
        ocr_queue = []
        non_ocr = []

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

        with tags_lock:
            tags.extend(non_ocr)
            POLE_STATE["tags"] = list(tags)
            POLE_STATE["total"] = len(matches)
            POLE_STATE["progress"] = len(non_ocr)

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

            except Exception:
                needs_review = True

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

        if ocr_queue:
            with ThreadPoolExecutor(max_workers=OCR_WORKERS) as pool:
                futures = {pool.submit(_ocr_one, args): args for args in ocr_queue}
                for future in as_completed(futures):
                    try:
                        tag = future.result()
                    except Exception:
                        args = futures[future]
                        tag = {
                            "pole_id": args[0],
                            "name": _poleid.clean_label(args[1].text),
                            "cx": round(args[1].x, 4),
                            "cy": round(args[1].y, 4),
                            "bbox": [round(v, 4) for v in args[2]],
                            "layer": layer_name,
                            "source": args[3],
                            "crop_b64": None,
                            "ocr_conf": None,
                            "needs_review": True,
                        }
                    with tags_lock:
                        tags.append(tag)
                        tags.sort(key=lambda t: t["pole_id"])
                        POLE_STATE["tags"] = list(tags)
                        POLE_STATE["progress"] = len(tags)

        tags.sort(key=lambda t: t["pole_id"])
        POLE_STATE.update(
            {
                "status": "done",
                "tags": tags,
                "progress": len(tags),
            }
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
# EQUIPMENT KIND → NAME MAPPING
# ─────────────────────────────────────────────────────────────────────────────


def kind_to_equipment_name(kind: str, layer: str = "") -> str:
    if kind == "circle":
        return "2-Way Tap"
    if kind == "square":
        return "4-Way Tap"
    if kind == "hexagon":
        return "8-Way Tap"
    if kind == "triangle":
        return "Line Extender"
    if kind == "rectangle":
        l = layer.lower()
        if "node" in l:
            return "Node"
        if "amp" in l or "amplifier" in l:
            return "Amplifier"
        return "Node/Amplifier"
    return kind.capitalize()


def _make_excel_styles():
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    return {
        "header_fill": PatternFill("solid", fgColor="1A3A5C"),
        "header_font": Font(bold=True, color="FFFFFF", name="Calibri"),
        "review_fill": PatternFill("solid", fgColor="FFF3CD"),
        "ok_fill": PatternFill("solid", fgColor="D4EDDA"),
        "sum_fill": PatternFill("solid", fgColor="E8EAF6"),
        "thin": Side(style="thin", color="CCCCCC"),
    }


def _make_border(styles):
    b = styles["thin"]
    from openpyxl.styles import Border

    return Border(left=b, right=b, top=b, bottom=b)


def _write_header_row(ws, headers, col_widths, styles):
    from openpyxl.styles import Alignment

    border = _make_border(styles)
    for ci, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.fill = styles["header_fill"]
        cell.font = styles["header_font"]
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
        ws.column_dimensions[cell.column_letter].width = w
    ws.row_dimensions[1].height = 22


def _write_footer_row(ws, row_num, cols, styles):
    from openpyxl.styles import Alignment, Font

    border = _make_border(styles)
    for col, val in cols:
        c = ws.cell(row=row_num, column=col, value=val)
        c.font = Font(bold=True)
        c.fill = styles["sum_fill"]
        c.border = border
        c.alignment = Alignment(horizontal="center")
    return c


def export_excel(results, dxf_path):
    try:
        import openpyxl
        from openpyxl.styles import Alignment
    except ImportError:
        return None, "openpyxl not installed."

    styles = _make_excel_styles()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Digit Results"
    border = _make_border(styles)
    dxf_name = Path(dxf_path).name
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
    _write_header_row(ws, headers, col_widths, styles)

    total_sum = 0
    for ri, r in enumerate(results, 2):
        final_val = (
            r["corrected_value"] if r["corrected_value"] is not None else r["value"]
        )
        try:
            total_sum += int(final_val)
        except Exception:
            pass
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
        fill = styles["review_fill"] if r["needs_review"] else styles["ok_fill"]
        for ci, val in enumerate(row_data, 1):
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.fill = fill
            cell.alignment = Alignment(horizontal="center")
            cell.border = border

    sum_row = len(results) + 2
    ws.cell(row=sum_row, column=1, value="TOTAL").font = styles["header_font"]
    sum_cell = ws.cell(row=sum_row, column=4, value=total_sum)
    sum_cell.font = styles["header_font"]
    for ci in range(1, len(headers) + 1):
        c = ws.cell(row=sum_row, column=ci)
        c.fill = styles["sum_fill"]
        c.border = border

    ws2 = wb.create_sheet(title="Summary")
    _write_header_row(ws2, ["Digit ID", "Final Value"], [12, 16], styles)

    for ri, r in enumerate(results, 2):
        final_val = (
            r["corrected_value"] if r["corrected_value"] is not None else r["value"]
        )
        c1 = ws2.cell(row=ri, column=1, value=r["digit_id"])
        c2 = ws2.cell(row=ri, column=2, value=final_val)
        for c in (c1, c2):
            c.alignment = Alignment(horizontal="center")
            c.border = border

    tr = len(results) + 2
    _write_footer_row(ws2, tr, [(1, "TOTAL"), (2, total_sum)], styles)

    out_path = os.path.join(os.getcwd(), Path(dxf_path).stem + "_results.xlsx")
    wb.save(out_path)
    return out_path, None


def export_equipment_excel(shapes: list, dxf_path: str) -> tuple:
    try:
        import openpyxl
        from openpyxl.styles import Alignment
    except ImportError:
        return None, "openpyxl not installed."

    styles = _make_excel_styles()
    border = _make_border(styles)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Equipment"

    title_cell = ws.cell(row=1, column=1, value="Equipment Summary")
    title_cell.font = styles["header_font"]
    title_cell.fill = styles["header_fill"]
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.merge_cells("A1:B1")
    ws.row_dimensions[1].height = 22

    kind_counts: Dict[str, int] = {}
    for sh in shapes:
        ek = kind_to_equipment_name(sh["kind"], sh.get("layer", ""))
        kind_counts[ek] = kind_counts.get(ek, 0) + 1

    ws.cell(row=2, column=1, value="Equipment").fill = styles["header_fill"]
    ws.cell(row=2, column=1, value="Equipment").font = styles["header_font"]
    ws.cell(row=2, column=1).border = border
    ws.cell(row=2, column=1).alignment = Alignment(horizontal="center")
    ws.cell(row=2, column=2, value="Count").fill = styles["header_fill"]
    ws.cell(row=2, column=2, value="Count").font = styles["header_font"]
    ws.cell(row=2, column=2).border = border
    ws.cell(row=2, column=2).alignment = Alignment(horizontal="center")

    for ri, (ek, count) in enumerate(sorted(kind_counts.items()), 3):
        c1 = ws.cell(row=ri, column=1, value=ek)
        c2 = ws.cell(row=ri, column=2, value=count)
        for c in (c1, c2):
            c.border = border
            c.alignment = Alignment(horizontal="center")

    total_row = len(kind_counts) + 3
    _write_footer_row(ws, total_row, [(1, "TOTAL"), (2, len(shapes))], styles)

    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 10

    list_start = total_row + 2
    eq_headers = ["#", "Equipment", "Shape", "Layer", "Center X", "Center Y"]
    eq_widths = [8, 18, 12, 30, 12, 12]
    for ci, (h, w) in enumerate(zip(eq_headers, eq_widths), 1):
        cell = ws.cell(row=list_start, column=ci, value=h)
        cell.fill = styles["header_fill"]
        cell.font = styles["header_font"]
        cell.border = border
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[cell.column_letter].width = w

    for ri, sh in enumerate(shapes, list_start + 1):
        row_data = [
            sh["shape_id"] + 1,
            kind_to_equipment_name(sh["kind"], sh.get("layer", "")),
            sh["kind"].capitalize(),
            sh.get("layer", ""),
            round(sh["cx"], 4),
            round(sh["cy"], 4),
        ]
        for ci, val in enumerate(row_data, 1):
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.border = border
            cell.alignment = Alignment(horizontal="center")

    out_path = os.path.join(os.getcwd(), Path(dxf_path).stem + "_equipment.xlsx")
    wb.save(out_path)
    return out_path, None


def export_all_excel(
    results: list, shapes: list, poles: list, cable_spans: list, dxf_path: str
) -> tuple:
    try:
        import openpyxl
        from openpyxl.styles import Alignment
    except ImportError:
        return None, "openpyxl not installed."

    styles = _make_excel_styles()
    border = _make_border(styles)
    wb = openpyxl.Workbook()
    dxf_name = Path(dxf_path).stem

    # ── Sheet 1: OCR Results
    ws1 = wb.active
    ws1.title = "OCR Results"
    _write_header_row(
        ws1,
        [
            "Digit ID",
            "Predicted Value",
            "Corrected Value",
            "Final Value",
            "Confidence %",
            "Needs Review",
            "Center X",
            "Center Y",
        ],
        [10, 16, 16, 14, 14, 14, 12, 12],
        styles,
    )
    total_sum = 0
    for ri, r in enumerate(results, 2):
        final_val = (
            r["corrected_value"] if r["corrected_value"] is not None else r["value"]
        )
        try:
            total_sum += int(final_val)
        except:
            pass
        row_data = [
            r["digit_id"],
            r["value"],
            r["corrected_value"] or "",
            final_val,
            round(r["confidence"] * 100, 1),
            "Yes" if r["needs_review"] else "No",
            round(r["center_x"], 4),
            round(r["center_y"], 4),
        ]
        fill = styles["review_fill"] if r["needs_review"] else styles["ok_fill"]
        for ci, val in enumerate(row_data, 1):
            cell = ws1.cell(row=ri, column=ci, value=val)
            cell.fill = fill
            cell.alignment = Alignment(horizontal="center")
            cell.border = border
    sum_row = len(results) + 2
    _write_footer_row(
        ws1,
        sum_row,
        [(1, "TOTAL"), (4, total_sum), (8, dxf_name + "_results.xlsx")],
        styles,
    )

    # ── Sheet 2: Equipment
    if shapes:
        ws2 = wb.create_sheet(title="Equipment")
        title_cell = ws2.cell(row=1, column=1, value="Equipment Summary")
        title_cell.font = styles["header_font"]
        title_cell.fill = styles["header_fill"]
        title_cell.alignment = Alignment(horizontal="center", vertical="center")
        ws2.merge_cells("A1:B1")
        ws2.row_dimensions[1].height = 22

        kind_counts: Dict[str, int] = {}
        for sh in shapes:
            ek = kind_to_equipment_name(sh["kind"], sh.get("layer", ""))
            kind_counts[ek] = kind_counts.get(ek, 0) + 1

        ws2.cell(row=2, column=1, value="Equipment").fill = styles["header_fill"]
        ws2.cell(row=2, column=1, value="Equipment").font = styles["header_font"]
        ws2.cell(row=2, column=1).border = border
        ws2.cell(row=2, column=1).alignment = Alignment(horizontal="center")
        ws2.cell(row=2, column=2, value="Count").fill = styles["header_fill"]
        ws2.cell(row=2, column=2, value="Count").font = styles["header_font"]
        ws2.cell(row=2, column=2).border = border
        ws2.cell(row=2, column=2).alignment = Alignment(horizontal="center")

        for ri, (ek, count) in enumerate(sorted(kind_counts.items()), 3):
            c1 = ws2.cell(row=ri, column=1, value=ek)
            c2 = ws2.cell(row=ri, column=2, value=count)
            for c in (c1, c2):
                c.border = border
                c.alignment = Alignment(horizontal="center")

        eq_total_row = len(kind_counts) + 3
        _write_footer_row(ws2, eq_total_row, [(1, "TOTAL"), (2, len(shapes))], styles)
        ws2.column_dimensions["A"].width = 20
        ws2.column_dimensions["B"].width = 10

        list_start = eq_total_row + 2
        eq_headers = ["#", "Equipment", "Shape", "Layer", "Center X", "Center Y"]
        eq_widths = [8, 18, 12, 30, 12, 12]
        for ci, (h, w) in enumerate(zip(eq_headers, eq_widths), 1):
            cell = ws2.cell(row=list_start, column=ci, value=h)
            cell.fill = styles["header_fill"]
            cell.font = styles["header_font"]
            cell.border = border
            cell.alignment = Alignment(horizontal="center")
            ws2.column_dimensions[cell.column_letter].width = w

        for ri, sh in enumerate(shapes, list_start + 1):
            row_data = [
                sh["shape_id"] + 1,
                kind_to_equipment_name(sh["kind"], sh.get("layer", "")),
                sh["kind"].capitalize(),
                sh.get("layer", ""),
                round(sh["cx"], 4),
                round(sh["cy"], 4),
            ]
            for ci, val in enumerate(row_data, 1):
                cell = ws2.cell(row=ri, column=ci, value=val)
                cell.border = border
                cell.alignment = Alignment(horizontal="center")

    # ── Sheet 3: Poles
    if poles:
        ws3 = wb.create_sheet(title="Poles")
        import openpyxl

        pole_fill = openpyxl.styles.PatternFill("solid", fgColor="FEF3C7")
        _write_header_row(
            ws3,
            ["#", "Pole Name", "Layer", "Source", "Confidence", "X", "Y"],
            [8, 28, 20, 10, 12, 12, 12],
            styles,
        )
        ws3.freeze_panes = "A2"

        for ri, tag in enumerate(poles, 2):
            row_data = [
                ri - 1,
                tag.get("name", ""),
                tag.get("layer", ""),
                tag.get("source", ""),
                f"{round(tag.get('ocr_conf', 0) * 100, 1)}%"
                if tag.get("ocr_conf") is not None
                else "—",
                round(tag.get("cx", 0), 4),
                round(tag.get("cy", 0), 4),
            ]
            for ci, val in enumerate(row_data, 1):
                cell = ws3.cell(row=ri, column=ci, value=val)
                cell.fill = pole_fill
                cell.alignment = Alignment(horizontal="center")
                cell.border = border
        pole_total_row = len(poles) + 2
        _write_footer_row(ws3, pole_total_row, [(1, "TOTAL"), (2, len(poles))], styles)

    # ── Sheet 4: Cable Spans
    if cable_spans:
        ws4 = wb.create_sheet(title="Cable Spans")
        _write_header_row(
            ws4,
            [
                "Span #",
                "From Pole",
                "To Pole",
                "Layer",
                "Length",
                "Meter Value",
                "Center X",
                "Center Y",
            ],
            [10, 12, 12, 20, 12, 14, 12, 12],
            styles,
        )
        for ri, span in enumerate(cable_spans, 2):
            row_data = [
                span.get("span_id", ri - 2) + 1,
                span.get("from_pole", ""),
                span.get("to_pole", ""),
                span.get("layer", ""),
                round(span.get("total_length", 0), 4),
                span.get("meter_value") if span.get("meter_value") is not None else "—",
                round(span.get("cx", 0), 4),
                round(span.get("cy", 0), 4),
            ]
            for ci, val in enumerate(row_data, 1):
                cell = ws4.cell(row=ri, column=ci, value=val)
                cell.alignment = Alignment(horizontal="center")
                cell.border = border
        span_total_row = len(cable_spans) + 2
        _write_footer_row(
            ws4,
            span_total_row,
            [(1, "TOTAL"), (5, sum(s.get("total_length", 0) for s in cable_spans))],
            styles,
        )

    out_path = os.path.join(os.getcwd(), dxf_name + "_full_report.xlsx")
    wb.save(out_path)
    print(f"[export] Excel saved to {out_path}")
    return out_path, None


def export_poles_excel(tags: list, dxf_path: str) -> tuple:
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    except ImportError:
        return None, "openpyxl not installed."

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Pole IDs"

    header_fill = PatternFill("solid", fgColor="7C4A00")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri")
    row_fill = PatternFill("solid", fgColor="FEF3C7")
    total_fill = PatternFill("solid", fgColor="E8EAF6")
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

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

    for ri, tag in enumerate(tags, 2):
        row_data = [ri - 1, tag.get("name", "")]
        for ci, val in enumerate(row_data, 1):
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.fill = row_fill
            cell.alignment = Alignment(horizontal="center")
            cell.border = border

    total_row = len(tags) + 2
    for col, val in [(1, "TOTAL"), (2, len(tags))]:
        c = ws.cell(row=total_row, column=col, value=val)
        c.font = Font(bold=True)
        c.fill = total_fill
        c.border = border
        c.alignment = Alignment(horizontal="center")

    out_path = os.path.join(os.getcwd(), Path(dxf_path).stem + "_pole_ids.xlsx")
    wb.save(out_path)
    return out_path, None


def _find_pole_layer_name(layers: List[str]) -> Optional[str]:
    patterns = ["pole", "poleid", "pole_id", "pole id", "tag", "label"]
    lower_map = {l.lower(): l for l in layers}
    for p in patterns:
        if p in lower_map:
            return lower_map[p]
    for layer in layers:
        ll = layer.lower()
        for p in patterns:
            if p in ll:
                return layer
    return None


@app.route("/api/pole_tags/auto_scan", methods=["POST"])
def api_pole_tags_auto_scan():
    data = request.get_json()
    dxf_path = data.get("dxf_path", "") or state.get("dxf_path", "")
    all_layers = data.get("layers", [])

    if not dxf_path:
        return jsonify({"error": "No DXF path provided"}), 400

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

    POLE_STATE["dxf_path"] = dxf_path

    t = threading.Thread(
        target=_run_pole_scan,
        args=(dxf_path, layer_name),
        daemon=True,
    )
    t.start()
    return jsonify({"ok": True, "layer": layer_name})


# ─────────────────────────────────────────────────────────────────────────────
# FLASK ROUTES
# ─────────────────────────────────────────────────────────────────────────────


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/status")
def api_status():
    return jsonify(
        {
            "status": state["status"],
            "progress": state["progress"],
            "total": state["total"],
            "error": state["error"],
            "step": state.get("step", 0),
            "step_label": state.get("step_label", ""),
        }
    )


@app.route("/api/results")
def api_results():
    segs = [{"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2} for s in state["segments"]]
    return jsonify({"results": state["results"], "segments": segs})


@app.route("/api/check_model")
def api_check_model():
    try:
        import easyocr

        return jsonify(
            {"ok": True, "engine": "easyocr", "cached": _easyocr_reader is not None}
        )
    except ImportError:
        return jsonify(
            {"ok": False, "engine": "easyocr", "error": "easyocr not installed"}
        )


# ─────────────────────────────────────────────────────────────────────────────
# FILE PLATFORM
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
    data = _read_index()
    kept = []
    for f in data["files"]:
        p = Path(f["path"])
        if p.exists():
            f["size"] = p.stat().st_size
            kept.append(f)
    data["files"] = kept
    _write_index(data)
    return data


@app.route("/api/files/list", methods=["GET"])
def api_files_list():
    data = _sync_index_sizes()
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

        if folder:
            dest_dir = UPLOADS_DIR / folder
            dest_dir.mkdir(parents=True, exist_ok=True)
        else:
            dest_dir = UPLOADS_DIR

        save_path = str(dest_dir / fname)
        file.save(save_path)

        if save_path.lower().endswith(".pdf"):
            try:
                dxf_path_str = pdf_to_dxf_autocad(save_path)
            except RuntimeError as e:
                return jsonify({"error": str(e)}), 400
            except Exception as e:
                import traceback

                traceback.print_exc()
                return jsonify({"error": "PDF conversion failed: " + str(e)}), 500
            Path(save_path).unlink(missing_ok=True)
            save_path = dxf_path_str
            fname = Path(save_path).name

        p = Path(save_path)
        data = _read_index()
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


# <-- UPDATED TO ACCEPT 'LAYERS' LIST -->
@app.route("/api/run", methods=["POST"])
def api_run():
    data = request.get_json()
    state["dxf_path"] = data["dxf_path"]

    layers = data.get("layers", [])
    if not layers and "layer" in data:
        layers = [data["layer"]]

    state["layers"] = layers
    state["model_path"] = data.get("model_path", "")
    t = threading.Thread(
        target=run_pipeline,
        args=(data["dxf_path"], state["layers"], state["model_path"]),
        daemon=True,
    )
    t.start()
    return jsonify({"ok": True})


@app.route("/api/export", methods=["POST"])
def api_export():
    data = request.get_json() or {}
    corrections = data.get("corrections", {})
    for r in state["results"]:
        did = str(r["digit_id"])
        if did in corrections and corrections[did] is not None:
            r["corrected_value"] = corrections[did]
    path, err = export_excel(state["results"], state["dxf_path"])
    if err:
        return jsonify({"error": err}), 500
    return jsonify({"path": path})


@app.route("/api/export/equipment", methods=["POST"])
def api_export_equipment():
    shapes = SCAN_STATE.get("shapes", [])
    if not shapes:
        return jsonify({"error": "No equipment found. Run a scan first."}), 400
    path, err = export_equipment_excel(
        shapes, state.get("dxf_path") or "equipment_export"
    )
    if err:
        return jsonify({"error": err}), 500
    return jsonify({"path": path})


@app.route("/api/export/all", methods=["POST"])
def api_export_all():
    data = request.get_json() or {}
    corrections = data.get("corrections", {})
    for r in state["results"]:
        did = str(r["digit_id"])
        if did in corrections and corrections[did] is not None:
            r["corrected_value"] = corrections[did]
    shapes = SCAN_STATE.get("shapes", [])
    poles = POLE_STATE.get("tags", [])
    cable_spans = data.get("cable_spans", [])
    path, err = export_all_excel(
        state["results"],
        shapes,
        poles,
        cable_spans,
        state.get("dxf_path") or "full_report",
    )
    if err:
        return jsonify({"error": err}), 500

    return jsonify({"path": path})


@app.route("/api/export/polemaster", methods=["POST"])
def api_export_polemaster():
    """Push data to TelcoVantage Planner API (Pole Master)."""
    data = request.get_json() or {}
    corrections = data.get("corrections", {})

    # Apply corrections to OCR results
    for r in state["results"]:
        did = str(r["digit_id"])
        if did in corrections and corrections[did] is not None:
            r["corrected_value"] = corrections[did]

    shapes = SCAN_STATE.get("shapes", [])
    poles = POLE_STATE.get("tags", [])
    cable_spans = data.get("cable_spans", [])
    project_id = data.get("project_id")

    print(
        f"[polemaster] ENABLE_PLANNER_INTEGRATION: {ENABLE_PLANNER_INTEGRATION}, project_id: {project_id}"
    )
    print(f"[polemaster] Received {len(cable_spans)} cable spans, {len(poles)} poles")

    # Log sample span data for debugging
    if cable_spans:
        sample = cable_spans[0]
        print(
            f"[polemaster] Sample span: from_pole={sample.get('from_pole')}, to_pole={sample.get('to_pole')}"
        )

    if not ENABLE_PLANNER_INTEGRATION:
        return jsonify({"error": "Planner integration is disabled"}), 400

    if project_id is None:
        project_id = DEFAULT_PROJECT_ID
        print(f"[polemaster] Using default project_id: {project_id}")

    if project_id is None:
        return jsonify(
            {"error": "No project_id provided and no default configured"}
        ), 400

    try:
        push_result = push_to_planner(
            state.get("dxf_path"),
            poles,
            cable_spans,
            shapes,
            state.get("results", []),
            int(project_id),
        )
        return jsonify({"success": True, "result": push_result})
    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


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


# <-- UPDATED TO SUPPORT MULTIPLE CABLE LAYERS -->
@app.route("/api/cable_spans")
def api_cable_spans():
    dxf_path = state.get("dxf_path")
    if not dxf_path:
        return jsonify({"error": "No DXF loaded"}), 400
    try:
        doc = ezdxf.readfile(dxf_path)
        layers = list_layers(dxf_path)
        cable_layers = find_cable_layer_names(layers)

        if not cable_layers:
            return jsonify(
                {"cable_layers": [], "spans": [], "message": "No cable layers found"}
            )

        spans = build_cable_spans(doc, cable_layers, connect_tol=CABLE_CONNECT_TOL)
        spans = assign_meter_values_to_spans(spans, state.get("results", []))

        return jsonify(
            {
                "cable_layers": cable_layers,
                "count": len(spans),
                "spans": spans,
            }
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 400


@app.route("/api/planner/projects")
def api_planner_projects():
    """Fetch list of projects from Planner API."""
    try:
        from app_python.services.planner_auth import get_projects

        projects = get_projects()
        return jsonify({"projects": projects})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC INTEGRATION API  —  /api/v1/
# ─────────────────────────────────────────────────────────────────────────────


def _v1_ok(data: Any, status: int = 200):
    return jsonify({"ok": True, "data": data}), status


def _v1_err(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


@public_api.route("/health", methods=["GET"])
def v1_health():
    try:
        import easyocr  # noqa

        engine_ok = True
    except ImportError:
        engine_ok = False
    return _v1_ok(
        {
            "service": "strand-identifier",
            "version": "1.0.0",
            "engine": "easyocr",
            "engine_ready": engine_ok,
        }
    )


@public_api.route("/status", methods=["GET"])
def v1_status():
    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "ocr": {
                "status": state.get("status", "idle"),
                "progress": state.get("progress", 0),
                "total": state.get("total", 0),
                "step": state.get("step", 0),
                "step_label": state.get("step_label", ""),
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


@public_api.route("/ocr/results", methods=["GET"])
def v1_ocr_results():
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


@public_api.route("/ocr/segments", methods=["GET"])
def v1_ocr_segments():
    raw_segs = state.get("segments", [])
    segments = [{"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2} for s in raw_segs]
    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "count": len(segments),
            "segments": segments,
        }
    )


@public_api.route("/poles", methods=["GET"])
def v1_poles():
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

    output = [
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
        for t in tags
    ]

    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "layer": POLE_STATE.get("layer"),
            "count": len(output),
            "poles": output,
        }
    )


@public_api.route("/equipment", methods=["GET"])
def v1_equipment():
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
    summary: Dict[str, int] = {}
    for s in all_shapes:
        summary[s["kind"]] = summary.get(s["kind"], 0) + 1

    filtered = list(all_shapes)
    if filter_kind:
        filtered = [s for s in filtered if s.get("kind") == filter_kind]
    if filter_layer:
        filtered = [s for s in filtered if s.get("layer") == filter_layer]

    return _v1_ok(
        {
            "dxf_path": state.get("dxf_path"),
            "count": len(filtered),
            "summary": summary,
            "shapes": [
                {
                    "shape_id": s.get("shape_id"),
                    "kind": s.get("kind"),
                    "cx": s.get("cx"),
                    "cy": s.get("cy"),
                    "bbox": s.get("bbox"),
                    "layer": s.get("layer"),
                }
                for s in filtered
            ],
        }
    )


# <-- UPDATED TO SUPPORT MULTIPLE CABLE LAYERS -->
@public_api.route("/cable_spans", methods=["GET"])
def v1_cable_spans():
    dxf_path = state.get("dxf_path")
    if not dxf_path:
        return _v1_err("No DXF has been loaded.", 404)

    include_segs = request.args.get("include_segments", "false").lower() == "true"

    try:
        doc = ezdxf.readfile(dxf_path)
        layers = list_layers(dxf_path)
        cable_layers = find_cable_layer_names(layers)

        if not cable_layers:
            return _v1_ok(
                {"dxf_path": dxf_path, "cable_layers": [], "count": 0, "spans": []}
            )

        spans = build_cable_spans(doc, cable_layers, connect_tol=CABLE_CONNECT_TOL)
        spans = assign_meter_values_to_spans(spans, state.get("results", []))

        return _v1_ok(
            {
                "dxf_path": dxf_path,
                "cable_layers": cable_layers,
                "count": len(spans),
                "spans": [
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
                    for s in spans
                ],
            }
        )

    except Exception as exc:
        import traceback

        traceback.print_exc()
        return _v1_err(str(exc), 500)


@public_api.route("/export/ocr", methods=["POST"])
def v1_export_ocr():
    if state.get("status") != "done":
        return _v1_err("OCR must complete before exporting.", 400)
    body = request.get_json(silent=True) or {}
    corrections = body.get("corrections", {})
    for r in state.get("results", []):
        did = str(r["digit_id"])
        if did in corrections and corrections[did] is not None:
            r["corrected_value"] = corrections[did]
    path, err = export_excel(state["results"], state["dxf_path"])
    if err:
        return _v1_err(err, 500)
    return _v1_ok({"download_url": f"/api/download?file={path}", "path": path})


@public_api.route("/export/poles", methods=["POST"])
def v1_export_poles():
    tags = POLE_STATE.get("tags", [])
    if not tags:
        return _v1_err("No pole tags to export. Run a scan first.", 400)
    body = request.get_json(silent=True) or {}
    overrides = body.get("overrides", {})
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
    return _v1_ok({"download_url": f"/api/download?file={path}", "path": path})


# ─────────────────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────────────────


def _prewarm_ocr():
    try:
        print("[startup] Pre-warming EasyOCR...")
        _load_easyocr()
        print("[startup] EasyOCR ready.")
    except Exception as e:
        print(f"[startup] EasyOCR pre-warm failed: {e}")

    try:
        from app_python.services.pole_ocr import _load_model as _load_pole

        print("[startup] Pre-warming pole TrOCR model...")
        _load_pole()
        print("[startup] Pole TrOCR ready.")
    except Exception as e:
        print(f"[startup] Pole TrOCR pre-warm failed: {e}")


app.register_blueprint(public_api)
_prewarm_ocr()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--dev", action="store_true")
    args = parser.parse_args()

    print(f"\n{'=' * 50}")
    print(f"  CAD OCR – Flask Backend  (EasyOCR engine)")
    print(f"  http://localhost:{args.port}")
    if args.dev:
        print(f"  React dev server: http://localhost:5173")
    print(f"{'=' * 50}\n")

    app.run(host="localhost", port=args.port, debug=True, threaded=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
    main()
