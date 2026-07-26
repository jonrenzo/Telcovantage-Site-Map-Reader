"""
scripts/strand_eval.py
──────────────────────
Eval harness for the strand-identifier OCR pipeline.

Subcommands
-----------
dump  — Run the candidate pipeline on a DXF/layer and write:
          • One PNG per candidate crop  (out_dir/<digit_id>.png)
          • labels.csv with columns: digit_id, predicted, confidence, actual

        Fill the 'actual' column in labels.csv (eyeball each <digit_id>.png),
        then run 'eval'.

eval  — Score the current recognizer against a filled labels.csv.
        Prints accuracy, average confidence, and the list of errors.

Usage
-----
    # 1. Dump crops from a DXF
    python scripts/strand_eval.py dump \
        --dxf uploads/my_drawing.dxf \
        --layer "CABLE_STRAND" \
        --out-dir eval_data/

    # 2. Fill eval_data/labels.csv   (just edit the 'actual' column)

    # 3. Evaluate old vs new
    python scripts/strand_eval.py eval \
        --labels eval_data/labels.csv \
        --dxf uploads/my_drawing.dxf \
        --layer "CABLE_STRAND"
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import sys
from pathlib import Path

# Make sure the project root is on sys.path so we can import server + recognizer
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

import cv2
import numpy as np


# ── helpers shared between dump and eval ──────────────────────────────────────

def _build_candidates(dxf_path: str, layers: list[str]):
    """Return (all_segments, candidates) using server.py's own pipeline."""
    import ezdxf
    from server import (
        extract_stroke_segments,
        cluster_segments,
        analyze_clusters,
        build_candidates_robust,
        CONNECT_TOL,
    )

    doc = ezdxf.readfile(dxf_path)
    all_segments = []
    for lyr in layers:
        segs = extract_stroke_segments(doc, lyr, include_circles=False)
        all_segments.extend(segs)

    from server import estimate_scale, cable_segment_indices
    scale = estimate_scale(all_segments)
    cable = cable_segment_indices(all_segments, scale=scale)
    clusters = cluster_segments(all_segments, tol=CONNECT_TOL * scale, ignore=cable)
    infos = analyze_clusters(all_segments, clusters, scale=scale)
    candidates = build_candidates_robust(all_segments, infos, scale=scale)
    return all_segments, candidates


def _render(all_segments, cand) -> np.ndarray:
    from server import render_crop
    return render_crop(all_segments, cand)


def _predict(crop_np: np.ndarray):
    from app_python.services.strand_recognizer import recognize
    return recognize(crop_np)


# ── dump ──────────────────────────────────────────────────────────────────────

def cmd_dump(args):
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    layers = [l.strip() for l in args.layer.split(",")]
    print(f"[dump] Loading DXF: {args.dxf}")
    all_segments, candidates = _build_candidates(args.dxf, layers)
    print(f"[dump] Found {len(candidates)} candidates.")

    rows = []
    for cand in candidates:
        crop = _render(all_segments, cand)
        png_path = out_dir / f"{cand.digit_id}.png"
        cv2.imwrite(str(png_path), crop)

        value, conf = _predict(crop)
        minx, miny, maxx, maxy = cand.bbox
        rows.append({
            "digit_id": cand.digit_id,
            # Stable key: any pipeline change renumbers digit_id, so eval
            # re-matches rows by this centre instead.
            "cx": round((minx + maxx) / 2, 4),
            "cy": round((miny + maxy) / 2, 4),
            "predicted": value if value else "?",
            "confidence": round(conf, 4),
            "actual": "",   # fill this in by eyeballing <digit_id>.png
        })

    csv_path = out_dir / "labels.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["digit_id", "cx", "cy", "predicted", "confidence", "actual"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"[dump] Wrote {len(rows)} crops to {out_dir}/")
    print(f"[dump] Fill 'actual' column in {csv_path}, then run: eval")


# ── eval ──────────────────────────────────────────────────────────────────────

def cmd_eval(args):
    csv_path = Path(args.labels)
    if not csv_path.exists():
        print(f"[eval] labels.csv not found: {csv_path}")
        sys.exit(1)

    with open(csv_path) as f:
        rows = list(csv.DictReader(f))

    labeled = [r for r in rows if r["actual"].strip()]
    if not labeled:
        print("[eval] No labeled rows found — fill the 'actual' column first.")
        sys.exit(1)

    print(f"[eval] Evaluating {len(labeled)} labeled crops...")

    layers = [l.strip() for l in args.layer.split(",")]
    all_segments, candidates = _build_candidates(args.dxf, layers)

    # Recognize the WHOLE drawing in one batch so the flip re-resolution can use
    # the drawing-wide dominant orientation, then score only the labeled rows.
    from app_python.services.strand_recognizer import recognize_batch
    crops = [_render(all_segments, c) for c in candidates]
    batch = recognize_batch(crops)
    pred_by_id = {c.digit_id: pc for c, pc in zip(candidates, batch)}

    def _nearest(cx: float, cy: float):
        """Nearest current candidate to a labelled row's stored centre."""
        best, best_d = None, float("inf")
        for c, pc in zip(candidates, batch):
            minx, miny, maxx, maxy = c.bbox
            d = math.hypot((minx + maxx) / 2 - cx, (miny + maxy) / 2 - cy)
            if d < best_d:
                best, best_d = (c, pc), d
        return best, best_d

    correct = 0
    conf_sum = 0.0
    errors: list[tuple[str, str, float]] = []   # (actual, predicted, conf)

    lost = 0
    for row in labeled:
        did = int(row["digit_id"])
        actual = row["actual"].strip()

        # Prefer the stable centre key; a renumbered digit_id would otherwise
        # score the wrong crop.
        entry = None
        if row.get("cx") and row.get("cy"):
            hit, d = _nearest(float(row["cx"]), float(row["cy"]))
            if hit is not None and d < 1.0:
                entry = hit[1]
            elif hit is None or d >= 1.0:
                # The candidate this label described no longer exists at all —
                # a recall regression, the failure the owner cares most about.
                lost += 1
                print(f"  id={did:>4}  actual={actual:>3}  LOST (no candidate within 1.0)")
                continue
        elif did in pred_by_id:
            entry = pred_by_id[did]
        else:
            print(f"  [warn] digit_id={did} not in DXF candidates — skipping")
            continue

        pred, conf = entry
        pred = pred.strip() if pred else "?"

        ok = (pred == actual)
        if ok:
            correct += 1
        else:
            errors.append((actual, pred, conf))
        conf_sum += conf

        print(
            f"  id={did:>4}  actual={actual:>3}  "
            f"pred={pred:>3}  conf={conf:.2f}  {'✓' if ok else '✗'}"
        )

    n = len(labeled)
    print()
    print("=" * 55)
    print(f"  Labeled samples : {n}")
    print(f"  Accuracy        : {correct}/{n} = {100*correct/n:.1f}%")
    print(f"  Lost candidates : {lost}  (labelled digits the pipeline no longer proposes)")
    print(f"  Avg confidence  : {conf_sum/max(n - lost, 1):.3f}")
    print("=" * 55)

    if errors:
        print("\nErrors (actual -> predicted @ conf):")
        for actual, predicted, conf in sorted(errors):
            print(f"  {actual:>3} -> {predicted:>3}  ({conf:.2f})")


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Strand OCR eval harness")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_dump = sub.add_parser("dump", help="Dump crops + old predictions to labels.csv")
    p_dump.add_argument("--dxf", required=True, help="Path to .dxf file")
    p_dump.add_argument("--layer", required=True, help="Layer name(s), comma-separated")
    p_dump.add_argument("--out-dir", default="eval_data", help="Output directory")

    p_eval = sub.add_parser("eval", help="Score old vs new on filled labels.csv")
    p_eval.add_argument("--labels", required=True, help="Path to labels.csv")
    p_eval.add_argument("--dxf", required=True, help="Path to .dxf file")
    p_eval.add_argument("--layer", required=True, help="Layer name(s), comma-separated")

    args = parser.parse_args()
    if args.cmd == "dump":
        cmd_dump(args)
    elif args.cmd == "eval":
        cmd_eval(args)


if __name__ == "__main__":
    main()
