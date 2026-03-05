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
import subprocess
import tempfile
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import cv2
import ezdxf
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from PIL import Image
from torchvision import transforms

app = Flask(__name__, static_folder="frontend/dist", static_url_path="")
CORS(app)  # Allow React dev server to call API during development


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
        check=True, capture_output=True, text=True, timeout=120
    )

    if not dxf_path.exists():
        raise RuntimeError("DXF was not created by AutoCAD.")

    return str(dxf_path)


# ─────────────────────────────────────────────────────────────────────────────
# DXF PIPELINE
# ─────────────────────────────────────────────────────────────────────────────

CONNECT_TOL             = 0.20
MIN_TOTAL_LENGTH        = 0.30
EPS_THIN                = 0.05
LONG_DIM                = 3.0
COMPLEX_MIN             = 0.15
MIN_SEGS_FOR_DIGIT      = 3
MAX_DOM_DIR             = 0.88
MAX_ENDPOINTS_FOR_LINE  = 2
ENDPOINT_TOL_SCALE      = 1.0
W_FACTOR                = 4.0
H_FACTOR                = 4.0
LEN_FACTOR              = 6.0
AREA_FACTOR             = 12.0
MAX_ASPECT              = 8.0
SALVAGE_DIST_FACTOR     = 0.40
SALVAGE_LONG_SEG_FACTOR = 2.5
SALVAGE_ANGLE_TOL_DEG   = 15.0


@dataclass
class Seg:
    x1: float; y1: float; x2: float; y2: float
    def p1(self): return (self.x1, self.y1)
    def p2(self): return (self.x2, self.y2)
    def length(self): return math.hypot(self.x2-self.x1, self.y2-self.y1)


@dataclass
class ClusterInfo:
    cluster_id: int
    seg_indices: List[int]
    bbox: Tuple[float,float,float,float]
    width: float; height: float; total_length: float; kind: str


@dataclass
class Candidate:
    digit_id: int; cluster_id: int; seg_indices: List[int]
    bbox: Tuple[float,float,float,float]
    width: float; height: float; total_length: float


def _dist2(a, b):
    return (a[0]-b[0])**2 + (a[1]-b[1])**2

def _bbox_from_segments(segments, idxs):
    xs, ys = [], []
    for i in idxs:
        s = segments[i]
        xs += [s.x1, s.x2]; ys += [s.y1, s.y2]
    return (min(xs), min(ys), max(xs), max(ys))

def _segmentize(pts, closed):
    segs = []
    for i in range(len(pts)-1):
        segs.append(Seg(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]))
    if closed and len(pts) > 2:
        segs.append(Seg(pts[-1][0], pts[-1][1], pts[0][0], pts[0][1]))
    return segs


def list_layers(dxf_path):
    doc = ezdxf.readfile(dxf_path)
    return sorted(layer.dxf.name for layer in doc.layers)


def extract_stroke_segments(doc, layer_name):
    segments = []
    ARC_STEPS, SPLINE_STEPS = 24, 30

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
                pts = [(float(x), float(y)) for x,y,*_ in e.get_points("xy")]
                segments.extend(_segmentize(pts, bool(e.closed)))
            elif t == "POLYLINE":
                pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
                segments.extend(_segmentize(pts, bool(e.is_closed)))
            elif t == "ARC":
                c, r = e.dxf.center, float(e.dxf.radius)
                a0 = math.radians(float(e.dxf.start_angle))
                a1 = math.radians(float(e.dxf.end_angle))
                if a1 < a0: a1 += 2*math.pi
                angles = np.linspace(a0, a1, ARC_STEPS)
                pts = [(float(c.x)+r*math.cos(a), float(c.y)+r*math.sin(a)) for a in angles]
                segments.extend(_segmentize(pts, False))
            elif t == "SPLINE":
                try:
                    from ezdxf.math import BSpline
                    bs = BSpline.from_spline(e)
                    pts = [(float(p.x), float(p.y)) for p in (bs.point(t) for t in np.linspace(0,1,SPLINE_STEPS))]
                    segments.extend(_segmentize(pts, False))
                except Exception:
                    pass
    return segments


def cluster_segments(segments, tol):
    if not segments: return []
    tol2 = tol*tol; cell_size = tol
    def cell_key(p): return (int(math.floor(p[0]/cell_size)), int(math.floor(p[1]/cell_size)))
    grid = {}
    endpoints = [(i, s.p1()) for i,s in enumerate(segments)] + [(i, s.p2()) for i,s in enumerate(segments)]
    for si, p in endpoints:
        grid.setdefault(cell_key(p), []).append((si, p))
    adj = [[] for _ in range(len(segments))]
    for si, p in endpoints:
        ck = cell_key(p)
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                for sj, q in grid.get((ck[0]+dx, ck[1]+dy), []):
                    if sj != si and _dist2(p,q) <= tol2:
                        adj[si].append(sj)
    visited = [False]*len(segments); clusters = []
    for i in range(len(segments)):
        if visited[i]: continue
        stack=[i]; visited[i]=True; comp=[]
        while stack:
            cur=stack.pop(); comp.append(cur)
            for nb in adj[cur]:
                if not visited[nb]: visited[nb]=True; stack.append(nb)
        clusters.append(comp)
    return clusters


def cluster_complexity(segments, idxs):
    ang = []
    for i in idxs:
        s = segments[i]; dx=s.x2-s.x1; dy=s.y2-s.y1
        if abs(dx)<1e-12 and abs(dy)<1e-12: continue
        a = math.atan2(dy,dx); a=(a+math.pi)%math.pi; ang.append(a)
    if len(ang)<=1: return 0.0
    c=sum(math.cos(2*a) for a in ang)/len(ang)
    s=sum(math.sin(2*a) for a in ang)/len(ang)
    return 1.0 - math.hypot(c,s)


def endpoint_count(segments, idxs, tol):
    cell=tol
    def key(p): return (int(math.floor(p[0]/cell)), int(math.floor(p[1]/cell)))
    counts = {}
    for i in idxs:
        s=segments[i]
        for p in (s.p1(), s.p2()):
            k=key(p); counts[k]=counts.get(k,0)+1
    return sum(1 for v in counts.values() if v==1)


def dominant_direction_ratio(segments, idxs, bins=12):
    hist=[0]*bins; n=0
    for i in idxs:
        s=segments[i]; dx=s.x2-s.x1; dy=s.y2-s.y1
        if abs(dx)<1e-12 and abs(dy)<1e-12: continue
        a=math.atan2(dy,dx); a=(a+math.pi)%math.pi
        b=int((a/math.pi)*bins)%bins; hist[b]+=1; n+=1
    return max(hist)/n if n>0 else 1.0


def is_renderable_cluster(segments, info):
    if info.width*info.height < 1e-8: return False
    return any(segments[si].length()>1e-6 for si in info.seg_indices)


def analyze_clusters(segments, clusters):
    infos = []
    ep_tol = CONNECT_TOL * ENDPOINT_TOL_SCALE
    for cid, idxs in enumerate(clusters):
        minx,miny,maxx,maxy = _bbox_from_segments(segments, idxs)
        w=maxx-minx; h=maxy-miny
        total_len = sum(segments[i].length() for i in idxs)
        if total_len < MIN_TOTAL_LENGTH: continue
        comp=cluster_complexity(segments, idxs)
        dom=dominant_direction_ratio(segments, idxs)
        ep=endpoint_count(segments, idxs, tol=ep_tol)
        thin=min(w,h)<EPS_THIN; longish=max(w,h)>LONG_DIM; few=len(idxs)<MIN_SEGS_FOR_DIGIT
        if (thin and longish and comp<COMPLEX_MIN) or (dom>MAX_DOM_DIR and ep<=MAX_ENDPOINTS_FOR_LINE) or (few and comp<COMPLEX_MIN):
            kind="line"
        else:
            kind="digit_candidate"
        infos.append(ClusterInfo(cid, idxs, (minx,miny,maxx,maxy), w, h, total_len, kind))
    return infos


def _pca_main_axis(points):
    c=points.mean(axis=0); X=points-c
    C=(X.T@X)/max(1,len(points)-1)
    vals,vecs=np.linalg.eigh(C); d=vecs[:,np.argmax(vals)]
    return c, d/max(np.linalg.norm(d),1e-12)

def _point_line_dist(p,c,d):
    v=p-c; proj=np.dot(v,d)*d; return float(np.linalg.norm(v-proj))

def salvage_remove_dominant_line(segments, idxs, connect_tol, dist_factor, long_seg_factor, angle_tol_deg):
    if len(idxs)<6: return [idxs]
    pts=[]; seg_lens=[]
    for i in idxs:
        s=segments[i]; pts+=[[s.x1,s.y1],[s.x2,s.y2]]; seg_lens.append(s.length())
    pts=np.array(pts,dtype=float); seg_lens=np.array(seg_lens,dtype=float)
    minx,miny,maxx,maxy=_bbox_from_segments(segments,idxs)
    thin_dim=max(1e-9,min(maxx-minx,maxy-miny))
    c,d=_pca_main_axis(pts)
    med_len=float(np.median(seg_lens))
    long_thr=max(med_len*long_seg_factor, med_len+1e-9)
    ang_tol=math.radians(angle_tol_deg)
    keep=[]; removed=[]
    for i in idxs:
        s=segments[i]; L=s.length()
        mid=np.array([(s.x1+s.x2)*0.5,(s.y1+s.y2)*0.5],dtype=float)
        dist=_point_line_dist(mid,c,d)
        v=np.array([s.x2-s.x1,s.y2-s.y1],dtype=float); nv=np.linalg.norm(v)
        if nv<1e-12: keep.append(i); continue
        cosang=float(abs(np.dot(v/nv,d))); cosang=max(-1.0,min(1.0,cosang))
        ang=math.acos(cosang)
        if dist<=dist_factor*thin_dim and ang<=ang_tol and L>=long_thr: removed.append(i)
        else: keep.append(i)
    if not removed: return [idxs]
    kept_segs=[segments[i] for i in keep]
    subclusters_local=cluster_segments(kept_segs, tol=connect_tol)
    subclusters=[[keep[j] for j in comp] for comp in subclusters_local]
    subclusters=[c for c in subclusters if sum(segments[i].length() for i in c)>=MIN_TOTAL_LENGTH]
    return subclusters if subclusters else [idxs]


def build_candidates_robust(segments, infos):
    prelim=[i for i in infos if i.kind=="digit_candidate" and is_renderable_cluster(segments,i)]
    if not prelim: return []
    areas=np.array([i.width*i.height for i in prelim],dtype=float)
    cutoff=np.quantile(areas,0.80)
    small=[i for i in prelim if i.width*i.height<=cutoff]
    base=small if len(small)>=10 else prelim
    med_w=float(np.median([i.width for i in base]))
    med_h=float(np.median([i.height for i in base]))
    med_len=float(np.median([i.total_length for i in base]))
    med_area=float(np.median([i.width*i.height for i in base]))
    def aspect_ok(w,h):
        return max(w,h)/max(min(w,h),1e-12)<=MAX_ASPECT if w>1e-12 and h>1e-12 else False
    final_infos=[]; salvaged=0
    for i in prelim:
        area=i.width*i.height
        too_big=(i.width>med_w*W_FACTOR or i.height>med_h*H_FACTOR or
                 i.total_length>med_len*LEN_FACTOR or area>med_area*AREA_FACTOR or
                 not aspect_ok(i.width,i.height))
        if not too_big: final_infos.append(i); continue
        subclusters=salvage_remove_dominant_line(segments,i.seg_indices,CONNECT_TOL*0.9,
                                                  SALVAGE_DIST_FACTOR,SALVAGE_LONG_SEG_FACTOR,SALVAGE_ANGLE_TOL_DEG)
        for comp in subclusters:
            bx=_bbox_from_segments(segments,comp)
            w=bx[2]-bx[0]; h=bx[3]-bx[1]; tlen=sum(segments[j].length() for j in comp)
            if tlen<MIN_TOTAL_LENGTH: continue
            if w>med_w*W_FACTOR or h>med_h*H_FACTOR or tlen>med_len*LEN_FACTOR or w*h>med_area*AREA_FACTOR: continue
            if not aspect_ok(w,h): continue
            final_infos.append(ClusterInfo(i.cluster_id,comp,bx,w,h,tlen,"digit_candidate")); salvaged+=1
    final_infos=[x for x in final_infos if is_renderable_cluster(segments,x)]
    final_infos=sorted(final_infos,key=lambda c:(-((c.bbox[1]+c.bbox[3])/2),(c.bbox[0]+c.bbox[2])/2))
    return [Candidate(did,info.cluster_id,info.seg_indices,info.bbox,info.width,info.height,info.total_length)
            for did,info in enumerate(final_infos)]


def render_crop(segments, cand, out_size=96, pad_frac=0.06, thickness=2):
    minx,miny,maxx,maxy=cand.bbox; w=maxx-minx; h=maxy-miny
    if w<1e-9 or h<1e-9: return np.zeros((out_size,out_size),dtype=np.uint8)
    padx=pad_frac*w; pady=pad_frac*h
    minx2,maxx2=minx-padx,maxx+padx; miny2,maxy2=miny-pady,maxy+pady
    w2=maxx2-minx2; h2=maxy2-miny2
    img=np.zeros((out_size,out_size),dtype=np.uint8)
    def to_px(x,y):
        return (int(round((x-minx2)/w2*(out_size-1))),
                int(round((1.0-(y-miny2)/h2)*(out_size-1))))
    for si in cand.seg_indices:
        s=segments[si]
        if s.length()<=1e-6: continue
        cv2.line(img, to_px(s.x1,s.y1), to_px(s.x2,s.y2), 255, thickness=thickness, lineType=cv2.LINE_AA)
    return img


def img_to_b64(img_np):
    _, buf = cv2.imencode('.png', img_np)
    return base64.b64encode(buf).decode()


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
    pool_side = int(feature_size ** 0.5)

    class _CadCNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(1,32,3,padding=1), nn.BatchNorm2d(32), nn.ReLU(),
                nn.Conv2d(32,32,3,padding=1), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
                nn.Conv2d(32,64,3,padding=1), nn.BatchNorm2d(64), nn.ReLU(),
                nn.Conv2d(64,64,3,padding=1), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2),
                nn.Conv2d(64,128,3,padding=1), nn.BatchNorm2d(128), nn.ReLU(),
                nn.AdaptiveAvgPool2d((pool_side, pool_side))
            )
            self.classifier = nn.Sequential(
                nn.Flatten(), nn.Linear(feature_flat, 256), nn.ReLU(),
                nn.Dropout(0.4), nn.Linear(256, num_classes)
            )
        def forward(self, x): return self.classifier(self.features(x))

    model = _CadCNN()
    model.load_state_dict(sd)
    model.eval()
    return model, ckpt["idx2label"]


val_transform = transforms.Compose([
    transforms.Resize((96,96)),
    transforms.ToTensor(),
    transforms.Normalize((0.5,),(0.5,)),
])


def predict_image(model, idx2label, img_np):
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    img_np = clahe.apply(img_np)
    img = Image.fromarray(img_np)
    x = val_transform(img).unsqueeze(0)
    with torch.no_grad():
        logits = model(x)
        probs = F.softmax(logits/1.5, dim=1)[0]
        idx = probs.argmax().item()
        conf = probs[idx].item()
    return idx2label[idx], round(float(conf), 4)


# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL STATE
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
        segments = extract_stroke_segments(doc, layer)
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
            cx = (cand.bbox[0]+cand.bbox[2])/2
            cy = (cand.bbox[1]+cand.bbox[3])/2
            results.append({
                "digit_id": cand.digit_id,
                "value": value,
                "corrected_value": None,
                "confidence": conf,
                "needs_review": conf < 0.95,
                "bbox": list(cand.bbox),
                "center_x": cx,
                "center_y": cy,
                "crop_b64": img_to_b64(crop),
            })
            state["progress"] = i + 1

        state["results"] = results
        state["status"] = "done"

    except Exception as e:
        import traceback; traceback.print_exc()
        state["status"] = "error"
        state["error"] = str(e)


# ─────────────────────────────────────────────────────────────────────────────
# EXPORT TO EXCEL
# ─────────────────────────────────────────────────────────────────────────────

def export_excel(results, dxf_path):
    try:
        import openpyxl
        from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    except ImportError:
        return None, "openpyxl not installed. Run: pip install openpyxl"

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Digit Results"

    header_fill = PatternFill("solid", fgColor="1A3A5C")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri")
    review_fill = PatternFill("solid", fgColor="FFF3CD")
    ok_fill     = PatternFill("solid", fgColor="D4EDDA")
    sum_fill    = PatternFill("solid", fgColor="E8EAF6")
    thin = Side(style='thin', color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers = ["Digit ID", "Predicted Value", "Corrected Value", "Final Value",
               "Confidence %", "Needs Review", "Center X", "Center Y", "DXF File"]
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
        final_val = r["corrected_value"] if r["corrected_value"] is not None else r["value"]
        try: numeric = int(final_val); total_sum += numeric
        except: numeric = final_val

        row_data = [
            r["digit_id"], r["value"], r["corrected_value"] or "", final_val,
            round(r["confidence"]*100, 1), "Yes" if r["needs_review"] else "No",
            round(r["center_x"], 4), round(r["center_y"], 4), dxf_name,
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
    for ci in range(1, len(headers)+1):
        c = ws.cell(row=sum_row, column=ci)
        c.fill = sum_fill
        c.border = border

    # Sheet 2: Summary
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
        final_val = r["corrected_value"] if r["corrected_value"] is not None else r["value"]
        try: sum2 += int(final_val)
        except: pass
        c1 = ws2.cell(row=ri, column=1, value=r["digit_id"])
        c2 = ws2.cell(row=ri, column=2, value=final_val)
        for c in (c1, c2):
            c.alignment = Alignment(horizontal="center")
            c.border = border

    tr = len(results) + 2
    for c in (ws2.cell(row=tr, column=1, value="TOTAL"), ws2.cell(row=tr, column=2, value=sum2)):
        c.fill = sum_fill
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal="center")
        c.border = border

    out_path = Path(dxf_path).stem + "_results.xlsx"
    wb.save(out_path)
    return out_path, None


# ─────────────────────────────────────────────────────────────────────────────
# FLASK ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the built React app in production."""
    return send_from_directory(app.static_folder, "index.html")

@app.route("/api/status")
def api_status():
    return jsonify({
        "status": state["status"],
        "progress": state["progress"],
        "total": state["total"],
        "error": state["error"],
    })

@app.route("/api/results")
def api_results():
    segs = [{"x1":s.x1,"y1":s.y1,"x2":s.x2,"y2":s.y2} for s in state["segments"]]
    return jsonify({"results": state["results"], "segments": segs})

@app.route("/api/check_model")
def api_check_model():
    return jsonify({"ok": Path("cad_digit_model.pt").exists()})

@app.route("/api/upload", methods=["POST"])
def api_upload():
    try:
        file = request.files.get("file")
        if not file:
            return jsonify({"error": "No file provided"}), 400

        fname = Path(file.filename).name if file.filename else "uploaded.dxf"

        uploads_dir = Path("uploads")
        uploads_dir.mkdir(exist_ok=True)

        save_path = str(uploads_dir / fname)
        file.save(save_path)

        if save_path.lower().endswith(".pdf"):
            try:
                dxf_path = pdf_to_dxf_autocad(save_path)
                return jsonify({"path": dxf_path, "converted_from": save_path})
            except RuntimeError as e:
                return jsonify({"error": str(e)}), 400
            except Exception as e:
                import traceback; traceback.print_exc()
                return jsonify({"error": "PDF conversion failed: " + str(e)}), 500

        return jsonify({"path": save_path})
    except Exception as e:
        import traceback; traceback.print_exc()
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
        daemon=True
    )
    t.start()
    return jsonify({"ok": True})

@app.route("/api/export", methods=["POST"])
def api_export():
    data = request.get_json()
    corrections = data.get("corrections", {})
    for r in state["results"]:
        did = str(r["digit_id"])
        if did in corrections and corrections[did] is not None:
            r["corrected_value"] = corrections[did]
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
        download_name=Path(fpath).name
    )


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--dev", action="store_true",
                        help="Run in dev mode (React runs separately on port 5173)")
    args = parser.parse_args()

    print(f"\n{'='*50}")
    print(f"  CAD OCR – Flask Backend")
    print(f"  http://localhost:{args.port}")
    if args.dev:
        print(f"  React dev server: http://localhost:5173")
    print(f"{'='*50}\n")

    app.run(host="localhost", port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
