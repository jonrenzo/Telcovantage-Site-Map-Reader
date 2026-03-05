import math
import numpy as np
from typing import List, Tuple, Dict

from app_python.models.geometry import Seg, ClusterInfo, Candidate
from app_python.core.math_helpers import dist2, bbox_from_segments

def cluster_segments(segments: List[Seg], tol: float) -> List[List[int]]:
    if not segments: return []
    tol2, cell_size = tol * tol, max(tol, 1e-12)
    grid, endpoints = {}, []
    
    for i, s in enumerate(segments):
        endpoints.extend([(i, s.p1()), (i, s.p2())])

    for seg_i, p in endpoints:
        grid.setdefault((int(math.floor(p[0] / cell_size)), int(math.floor(p[1] / cell_size))), []).append((seg_i, p))

    adj = [set() for _ in range(len(segments))]
    for seg_i, p in endpoints:
        ck = (int(math.floor(p[0] / cell_size)), int(math.floor(p[1] / cell_size)))
        for dx, dy in [(x, y) for x in (-1,0,1) for y in (-1,0,1)]:
            for seg_j, q in grid.get((ck[0] + dx, ck[1] + dy), []):
                if seg_j != seg_i and dist2(p, q) <= tol2:
                    adj[seg_i].add(seg_j); adj[seg_j].add(seg_i)

    visited, clusters = [False] * len(segments), []
    for i in range(len(segments)):
        if visited[i]: continue
        stack, comp = [i], []
        visited[i] = True
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nb in adj[cur]:
                if not visited[nb]:
                    visited[nb] = True; stack.append(nb)
        clusters.append(comp)
    return clusters

def _pca_main_axis(points: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    c = points.mean(axis=0)
    X = points - c
    C = (X.T @ X) / max(1, len(points) - 1)
    vals, vecs = np.linalg.eigh(C)
    d = vecs[:, np.argmax(vals)]
    return c, d / (np.linalg.norm(d) + 1e-12)

def build_candidates(segments: List[Seg], clusters: List[List[int]], config: dict) -> List[Candidate]:
    infos = []
    # 1. Base Analysis
    for cid, idxs in enumerate(clusters):
        minx, miny, maxx, maxy = bbox_from_segments(segments, idxs)
        w, h, total_len = maxx - minx, maxy - miny, sum(segments[i].length() for i in idxs)
        if total_len < config['min_total_length']: continue

        # Complexity / Dominance
        ang = [(math.atan2(segments[i].y2 - segments[i].y1, segments[i].x2 - segments[i].x1) + math.pi) % math.pi for i in idxs if abs(segments[i].x2 - segments[i].x1) >= 1e-12 or abs(segments[i].y2 - segments[i].y1) >= 1e-12]
        comp = 1.0 - math.hypot(sum(math.cos(2*a) for a in ang)/len(ang), sum(math.sin(2*a) for a in ang)/len(ang)) if len(ang)>1 else 0.0
        
        hist = [0] * 12
        for a in ang: hist[int((a / math.pi) * 12) % 12] += 1
        dom = max(hist) / len(ang) if ang else 1.0

        kind = "digit_candidate"
        if (min(w, h) < config['eps_thin'] and max(w, h) > config['long_dim'] and comp < config['complex_min']) or (dom > config['max_dom_dir']) or (len(idxs) < config['min_segs_for_digit'] and comp < config['complex_min']):
            kind = "line"

        infos.append(ClusterInfo(cid, idxs, (minx, miny, maxx, maxy), w, h, total_len, kind))

    prelim = [i for i in infos if i.kind == "digit_candidate" and (i.width * i.height >= 1e-8) and any(segments[si].length() > 1e-6 for si in i.seg_indices)]
    if not prelim: return []

    # 2. Salvage Logic
    cutoff = np.quantile([i.width * i.height for i in prelim], 0.80)
    base = [i for i in prelim if (i.width * i.height) <= cutoff] if len([i for i in prelim if (i.width * i.height) <= cutoff]) >= 10 else prelim
    med_w, med_h, med_len, med_area = np.median([i.width for i in base]), np.median([i.height for i in base]), np.median([i.total_length for i in base]), np.median([i.width * i.height for i in base])

    final_infos = []
    for i in prelim:
        a = i.width * i.height
        aspect_ok = max(i.width/i.height, i.height/i.width) <= config['max_aspect'] if min(i.width, i.height) > 1e-12 else False
        
        if not ((i.width > med_w * config['w_factor']) or (i.height > med_h * config['h_factor']) or (i.total_length > med_len * config['len_factor']) or (a > med_area * config['area_factor']) or not aspect_ok):
            final_infos.append(i)
            continue

        # Attempt to salvage by removing dominant lines
        if len(i.seg_indices) >= 6:
            pts, lens = [], []
            for j in i.seg_indices:
                pts.extend([[segments[j].x1, segments[j].y1], [segments[j].x2, segments[j].y2]])
                lens.append(segments[j].length())
            c, d = _pca_main_axis(np.array(pts, dtype=float))
            long_thr = max(float(np.median(lens)) * config['salvage_long_seg_factor'], float(np.median(lens)) + 1e-9)
            
            keep = []
            for j in i.seg_indices:
                s = segments[j]
                mid = np.array([(s.x1+s.x2)*0.5, (s.y1+s.y2)*0.5])
                perp = np.linalg.norm((mid - c) - np.dot(mid - c, d) * d)
                v = np.array([s.x2-s.x1, s.y2-s.y1])
                nv = np.linalg.norm(v)
                if nv < 1e-12: keep.append(j); continue
                ang_val = math.acos(max(-1.0, min(1.0, abs(np.dot(v/nv, d)))))
                if not (perp <= config['salvage_dist_factor'] * max(1e-9, min(i.width, i.height)) and ang_val <= math.radians(config['salvage_angle_tol_deg']) and s.length() >= long_thr):
                    keep.append(j)

            if len(keep) != len(i.seg_indices):
                for comp in cluster_segments([segments[j] for j in keep], config['connect_tol'] * 0.9):
                    comp_idxs = [keep[j] for j in comp]
                    minx, miny, maxx, maxy = bbox_from_segments(segments, comp_idxs)
                    cw, ch, clen = maxx-minx, maxy-miny, sum(segments[k].length() for k in comp_idxs)
                    caspect = max(cw/ch, ch/cw) <= config['max_aspect'] if min(cw, ch) > 1e-12 else False
                    if clen >= config['min_total_length'] and cw <= med_w * config['w_factor'] and ch <= med_h * config['h_factor'] and clen <= med_len * config['len_factor'] and cw*ch <= med_area * config['area_factor'] and caspect:
                        final_infos.append(ClusterInfo(i.cluster_id, comp_idxs, (minx, miny, maxx, maxy), cw, ch, clen, "digit_candidate"))

    final_infos = sorted([x for x in final_infos if any(segments[si].length() > 1e-6 for si in x.seg_indices)], key=lambda c: (-((c.bbox[1] + c.bbox[3]) / 2), (c.bbox[0] + c.bbox[2]) / 2))
    return [Candidate(i, f.cluster_id, f.seg_indices, f.bbox, f.width, f.height, f.total_length) for i, f in enumerate(final_infos)]