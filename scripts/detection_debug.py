"""
scripts/detection_debug.py
──────────────────────────
Explain WHY strand digits are/aren't detected as candidates (the stage BEFORE
OCR). Reports, per cluster on the strand layer:
  • dropped (total stroke length < MIN_TOTAL_LENGTH)
  • classified "line" (and which rule fired) → rejected
  • kept as digit_candidate

Usage:
  python scripts/detection_debug.py --dxf uploads/QC856.dxf --layer 'PDF_...$STRAND'
"""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ezdxf
from server import (
    extract_stroke_segments, cluster_segments, _bbox_from_segments,
    cluster_complexity, dominant_direction_ratio, endpoint_count,
    build_candidates_robust, analyze_clusters,
    CONNECT_TOL, MIN_TOTAL_LENGTH, EPS_THIN, LONG_DIM, COMPLEX_MIN,
    MIN_SEGS_FOR_DIGIT, MAX_DOM_DIR, MAX_ENDPOINTS_FOR_LINE, ENDPOINT_TOL_SCALE,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dxf", required=True)
    ap.add_argument("--layer", required=True)
    args = ap.parse_args()

    doc = ezdxf.readfile(args.dxf)
    segs = []
    for lyr in args.layer.split(","):
        segs.extend(extract_stroke_segments(doc, lyr.strip(), include_circles=False))
    print(f"stroke segments on layer: {len(segs)}")

    from server import estimate_scale
    scale = estimate_scale(segs)
    print(f"adaptive scale={scale:.3f}  connect_tol={CONNECT_TOL*scale:.4f} "
          f"(fixed was {CONNECT_TOL})")
    clusters = cluster_segments(segs, tol=CONNECT_TOL * scale)
    print(f"raw clusters: {len(clusters)}")

    ep_tol = CONNECT_TOL * ENDPOINT_TOL_SCALE
    n_short = n_line = 0
    line_reasons = {"thin_long_simple": 0, "dominant_dir": 0, "too_few_segs": 0}
    lengths = []
    dropped_examples = []

    for idxs in clusters:
        minx, miny, maxx, maxy = _bbox_from_segments(segs, idxs)
        w, h = maxx - minx, maxy - miny
        total_len = sum(segs[i].length() for i in idxs)
        lengths.append(total_len)
        if total_len < MIN_TOTAL_LENGTH:
            n_short += 1
            if len(dropped_examples) < 12:
                dropped_examples.append(
                    (round((minx+maxx)/2, 2), round((miny+maxy)/2, 2),
                     round(total_len, 3), len(idxs), "SHORT")
                )
            continue
        comp = cluster_complexity(segs, idxs)
        dom = dominant_direction_ratio(segs, idxs)
        ep = endpoint_count(segs, idxs, tol=ep_tol)
        thin = min(w, h) < EPS_THIN
        longish = max(w, h) > LONG_DIM
        few = len(idxs) < MIN_SEGS_FOR_DIGIT
        reason = None
        if thin and longish and comp < COMPLEX_MIN:
            reason = "thin_long_simple"
        elif dom > MAX_DOM_DIR and ep <= MAX_ENDPOINTS_FOR_LINE:
            reason = "dominant_dir"
        elif few and comp < COMPLEX_MIN:
            reason = "too_few_segs"
        if reason:
            n_line += 1
            line_reasons[reason] += 1
            if len(dropped_examples) < 12:
                dropped_examples.append(
                    (round((minx+maxx)/2, 2), round((miny+maxy)/2, 2),
                     round(total_len, 3), len(idxs), reason)
                )

    infos = analyze_clusters(segs, clusters)
    candidates = build_candidates_robust(segs, infos)

    lengths.sort()
    pct = lambda p: lengths[int(p * (len(lengths) - 1))] if lengths else 0
    print(f"\ncluster total-length distribution (MIN_TOTAL_LENGTH={MIN_TOTAL_LENGTH}):")
    print(f"  min={lengths[0]:.3f}  p10={pct(.1):.3f}  median={pct(.5):.3f}  "
          f"p90={pct(.9):.3f}  max={lengths[-1]:.3f}")
    print(f"\nREJECTED before OCR:")
    print(f"  dropped (too short, < {MIN_TOTAL_LENGTH}): {n_short}")
    print(f"  classified 'line': {n_line}  {line_reasons}")
    print(f"\nFINAL digit candidates (reach OCR): {len(candidates)}")
    print(f"\nsample rejected clusters (cx, cy, total_len, nsegs, reason):")
    for ex in dropped_examples:
        print("  ", ex)


if __name__ == "__main__":
    main()
