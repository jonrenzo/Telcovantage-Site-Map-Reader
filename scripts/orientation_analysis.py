"""
scripts/orientation_analysis.py
───────────────────────────────
Validate the batch-orientation heuristic BEFORE implementing it.

For each labeled crop, sweep all angles and record, per angle, the best valid
read. Then report:
  • Histogram of the "winning angle" (angle giving the highest-confidence valid
    two-digit read) across all crops → the drawing's dominant orientation.
  • For each error crop: the angle where the CORRECT label appears (+conf) vs the
    angle where the PREDICTED (wrong) value appears (+conf).

If correct labels cluster at one dominant angle and the flip errors' correct
reading sits at that same angle (while the wrong flip sits ~180 away), the
heuristic will work.
"""
import sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import csv
import cv2
import numpy as np
import app_python.services.strand_recognizer as sr
from scripts.strand_eval import _build_candidates, _render

DXF = "uploads/LP1709.dxf"
LAYER = ["PDF_S102$STRAND"]
LABELS = "eval_LP1709/labels.csv"


def per_angle_reads(crop):
    """Return {deg: (text, conf)} best read at each sweep angle (thickness 4)."""
    out = {}
    for deg in sr._SWEEP_ANGLES:
        variant = sr._render_variant(sr._rotate_wb(crop, deg), sr._THICKNESS_FAST)
        text, conf = sr._easyocr_read(variant)
        out[deg] = (text, conf)
    return out


def winning_angle(reads):
    """Angle of the highest-confidence valid 2-digit read."""
    best_deg, best_conf = None, -1.0
    for deg, (t, c) in reads.items():
        if sr._is_valid(t) and len(t) >= 2 and c > best_conf:
            best_deg, best_conf = deg, c
    return best_deg, best_conf


def main():
    with open(LABELS) as f:
        rows = [r for r in csv.DictReader(f) if r["actual"].strip()]
    segs, cands = _build_candidates(DXF, LAYER)
    by_id = {c.digit_id: c for c in cands}

    win_hist = Counter()
    errors = []
    for r in rows:
        did = int(r["digit_id"])
        actual = r["actual"].strip()
        if did not in by_id:
            continue
        crop = _render(segs, by_id[did])
        reads = per_angle_reads(crop)
        wdeg, wconf = winning_angle(reads)
        if wdeg is not None:
            win_hist[wdeg] += 1

        pred, _ = sr.recognize(crop)
        if pred != actual:
            # angle where the correct label appears (best conf)
            corr = [(d, c) for d, (t, c) in reads.items() if t == actual]
            corr_best = max(corr, key=lambda x: x[1]) if corr else (None, 0.0)
            pred_at = [(d, c) for d, (t, c) in reads.items() if t == pred]
            pred_best = max(pred_at, key=lambda x: x[1]) if pred_at else (None, 0.0)
            errors.append((did, actual, pred, corr_best, pred_best, wdeg))

    print("\n=== Winning-angle histogram (dominant orientation) ===")
    for deg in sorted(win_hist):
        print(f"  deg={deg:>3}: {'#' * win_hist[deg]} ({win_hist[deg]})")

    print("\n=== Error crops: where is the CORRECT reading? ===")
    for did, actual, pred, cb, pb, wdeg in errors:
        print(f"  id={did:>3} actual={actual:>3} pred={pred:>3} | "
              f"correct '{actual}' @deg={cb[0]}({cb[1]:.2f})  "
              f"pred '{pred}' @deg={pb[0]}({pb[1]:.2f})")


if __name__ == "__main__":
    main()
