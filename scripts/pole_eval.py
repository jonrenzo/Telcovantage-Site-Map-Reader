"""
scripts/pole_eval.py
────────────────────
Eval harness for pole ID recognition — the pole-side mirror of strand_eval.py.

The audit that motivated this found the pipeline accepting 10 of 12 sampled
poles with only 4 actually right, every wrong one scoring 0.90+. Nothing in the
repo could say so. This harness makes that measurable.

Subcommands
-----------
dump  — Detect pole labels on a DXF and write:
          • One PNG per pole crop     (out_dir/<pole_id>.png)
          • labels.csv with columns: pole_id, cx, cy, predicted, confidence,
            accepted, actual
        Fill 'actual' by eyeballing each PNG (the true printed ID, or the
        literal word MISSING when the crop is not a pole label at all), then
        run 'eval'.

eval  — Re-run recognition and score against the filled labels.csv.
        Rows are matched by (cx, cy) — the label's centre in DXF coordinates —
        so detector changes that renumber or re-order poles cannot silently
        shift the scoring. Reports:
          accuracy   — exact ID matches among matched poles
          LOST       — labelled poles the detector no longer finds (recall
                       regressions; the failure that costs a span)
          wrong-but-accepted — misreads that passed the acceptance gate, the
                       most dangerous bucket because nobody reviews them

Usage
-----
    python scripts/pole_eval.py dump --dxf uploads/LP1709.dxf --out-dir eval_data/LP1709/poles
    # fill eval_data/LP1709/poles/labels.csv
    python scripts/pole_eval.py eval --dxf uploads/LP1709.dxf --labels eval_data/LP1709/poles/labels.csv
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))


def _detect_and_read(dxf_path: str):
    """Run the app's own detection + OCR. Returns [(label, OcrResult|None)]."""
    import ezdxf
    from server import (
        POLE_CONFIG,
        _find_pole_layer_names,
        extract_stroke_segments,
        list_layers,
    )
    import poleid as _poleid
    from app_python.services.pole_ocr import ocr_pole

    doc = ezdxf.readfile(dxf_path)
    layer_names = _find_pole_layer_names(list_layers(dxf_path))
    if not layer_names:
        print(f"[pole_eval] No pole layer found in {dxf_path}")
        sys.exit(1)

    out = []
    for layer in layer_names:
        layer_segs = extract_stroke_segments(doc, layer, include_circles=False)
        for lab, _circ in _poleid.find_pole_labels(doc, layer, config=POLE_CONFIG):
            if getattr(lab, "source", "") != "stroke":
                # DXF TEXT labels are read directly; OCR accuracy is a stroke
                # problem. Keep them in the dump anyway as trivially-correct
                # rows so recall is measured over everything.
                out.append((lab, None))
                continue
            bbox = tuple(lab.bbox) if lab.bbox else (lab.x, lab.y, lab.x, lab.y)
            segs = lab.segments if getattr(lab, "segments", None) else layer_segs
            result = ocr_pole(segs, bbox)
            out.append((lab, result))
    return out


def cmd_dump(args):
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pairs = _detect_and_read(args.dxf)
    print(f"[dump] {len(pairs)} pole labels detected")

    rows = []
    for i, (lab, result) in enumerate(pairs):
        if result is not None and result.crop_png:
            (out_dir / f"{i}.png").write_bytes(result.crop_png)
        rows.append({
            "pole_id": i,
            "cx": round(lab.x, 4),
            "cy": round(lab.y, 4),
            "predicted": (result.text if result else lab.text) or "?",
            "confidence": round(result.confidence, 4) if result else "",
            "accepted": (result.accepted if result else True),
            "actual": "",
        })

    csv_path = out_dir / "labels.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["pole_id", "cx", "cy", "predicted", "confidence", "accepted", "actual"],
        )
        w.writeheader()
        w.writerows(rows)
    print(f"[dump] Wrote {len(rows)} rows to {csv_path}")
    print("[dump] Fill 'actual' (true ID, or MISSING for a non-pole crop), then run eval.")


def cmd_eval(args):
    csv_path = Path(args.labels)
    with open(csv_path, encoding="utf-8") as f:
        labeled = [r for r in csv.DictReader(f) if r["actual"].strip()]
    if not labeled:
        print("[eval] No labelled rows - fill the 'actual' column first.")
        sys.exit(1)

    pairs = _detect_and_read(args.dxf)
    print(f"[eval] {len(pairs)} poles detected now; scoring {len(labeled)} labelled rows")

    correct = 0
    lost = 0
    wrong_accepted = []
    errors = []
    for row in labeled:
        actual = row["actual"].strip()
        cx, cy = float(row["cx"]), float(row["cy"])

        best, best_d = None, float("inf")
        for lab, result in pairs:
            d = math.hypot(lab.x - cx, lab.y - cy)
            if d < best_d:
                best, best_d = (lab, result), d

        if actual.upper() == "MISSING":
            # The labelled crop was clutter; nothing to score.
            continue
        if best is None or best_d > 1.0:
            lost += 1
            print(f"  ({cx:.2f},{cy:.2f})  actual={actual:>10s}  LOST - detector no longer finds this pole")
            continue

        lab, result = best
        pred = (result.text if result else lab.text) or "?"
        accepted = result.accepted if result else True
        ok = pred.strip().upper() == actual.upper()
        if ok:
            correct += 1
        else:
            errors.append((actual, pred, result.confidence if result else 1.0))
            if accepted:
                wrong_accepted.append((actual, pred))
        mark = "ok" if ok else ("WRONG-ACCEPTED" if accepted else "wrong->review")
        print(f"  ({cx:8.2f},{cy:8.2f})  actual={actual:>10s}  pred={pred:>10s}  {mark}")

    n = len([r for r in labeled if r["actual"].strip().upper() != "MISSING"])
    print()
    print("=" * 60)
    print(f"  Labelled poles     : {n}")
    print(f"  Correct            : {correct}/{n} = {100 * correct / max(n, 1):.1f}%")
    print(f"  LOST (recall)      : {lost}")
    print(f"  Wrong but ACCEPTED : {len(wrong_accepted)}   <- the dangerous bucket")
    print("=" * 60)
    for actual, pred in wrong_accepted:
        print(f"    accepted misread: {actual} -> {pred}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("dump")
    d.add_argument("--dxf", required=True)
    d.add_argument("--out-dir", required=True)
    d.set_defaults(fn=cmd_dump)

    e = sub.add_parser("eval")
    e.add_argument("--dxf", required=True)
    e.add_argument("--labels", required=True)
    e.set_defaults(fn=cmd_eval)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
