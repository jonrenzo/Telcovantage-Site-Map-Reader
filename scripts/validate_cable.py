"""
scripts/validate_cable.py
─────────────────────────
Validate the cable-exclusion change WITHOUT re-labeling. Candidate digit_ids are
positional, so excluding cable shifts them and breaks the old labels.csv mapping.

Instead we match by POSITION:
  1. Rebuild OLD candidates (cable INCLUDED) -> map each labeled digit_id to its
     bbox center + actual value.
  2. Rebuild NEW candidates (cable EXCLUDED) -> recognize_batch -> (center, pred).
  3. Match each labeled old center to the nearest new center; compare pred vs
     actual. Report accuracy, plus how many digits were RECOVERED (new candidates
     with no old match) and LOST (labeled old with no new match).

Usage:
  python scripts/validate_cable.py --dxf uploads/test.dxf --layer 'PDF_s16$STRAND' --labels eval_data/labels.csv
"""
import argparse
import csv
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ezdxf
import numpy as np
from server import (
    extract_stroke_segments, estimate_scale, cable_segment_indices,
    cluster_segments, analyze_clusters, build_candidates_robust, CONNECT_TOL,
)
from app_python.services.strand_recognizer import recognize_batch
from scripts.strand_eval import _render


def build(dxf, layers, exclude_cable):
    doc = ezdxf.readfile(dxf)
    segs = []
    for lyr in layers:
        segs.extend(extract_stroke_segments(doc, lyr.strip(), include_circles=False))
    scale = estimate_scale(segs)
    ignore = cable_segment_indices(segs) if exclude_cable else set()
    clusters = cluster_segments(segs, tol=CONNECT_TOL * scale, ignore=ignore)
    infos = analyze_clusters(segs, clusters, scale=scale)
    cands = build_candidates_robust(segs, infos, scale=scale)
    return segs, cands


def center(c):
    return ((c.bbox[0] + c.bbox[2]) / 2.0, (c.bbox[1] + c.bbox[3]) / 2.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dxf", required=True)
    ap.add_argument("--layer", required=True)
    ap.add_argument("--labels", required=True)
    args = ap.parse_args()
    layers = args.layer.split(",")

    with open(args.labels) as f:
        labels = {int(r["digit_id"]): r["actual"].strip()
                  for r in csv.DictReader(f) if r["actual"].strip()}

    # OLD candidates (cable included) → labeled centers
    _, old = build(args.dxf, layers, exclude_cable=False)
    old_by_id = {c.digit_id: c for c in old}
    labeled = [(center(old_by_id[i]), v) for i, v in labels.items() if i in old_by_id]

    # NEW candidates (cable excluded) → predictions
    segs, new = build(args.dxf, layers, exclude_cable=True)
    crops = [_render(segs, c) for c in new]
    preds = recognize_batch(crops)
    new_pts = [center(c) for c in new]

    tol = 0.05 * (max(p[0] for p in new_pts) - min(p[0] for p in new_pts) + 1e-9)
    used = set()
    correct = matched = 0
    errors = []
    for (cx, cy), actual in labeled:
        # nearest new candidate
        d = [( (cx-px)**2+(cy-py)**2, j) for j,(px,py) in enumerate(new_pts)]
        d.sort()
        if not d or d[0][0] > tol*tol:
            errors.append((actual, "<LOST>"))
            continue
        j = d[0][1]; used.add(j)
        matched += 1
        pred = preds[j][0] or "?"
        if pred == actual:
            correct += 1
        else:
            errors.append((actual, pred))

    recovered = [j for j in range(len(new)) if j not in used]
    print(f"labeled old digits: {len(labeled)}")
    print(f"matched to a new candidate: {matched}")
    print(f"  correct: {correct}/{matched} = {100*correct/max(matched,1):.1f}%")
    print(f"LOST (old labeled, no new match): {sum(1 for a,p in errors if p=='<LOST>')}")
    print(f"RECOVERED/new (no old label, need eyeball): {len(recovered)} "
          f"-> ids {[new[j].digit_id for j in recovered][:20]}")
    print("errors (actual -> pred):")
    for a, p in sorted(errors):
        print(f"   {a:>3} -> {p}")


if __name__ == "__main__":
    main()
