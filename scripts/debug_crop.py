"""Debug a single candidate crop: show every sweep-angle read + segmentation."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np
import app_python.services.strand_recognizer as sr

# Rebuild candidates so we can fetch a crop by digit_id
from scripts.strand_eval import _build_candidates, _render

DXF = "uploads/test.dxf"
LAYER = ["PDF_s16$STRAND"]
ids = [int(a) for a in sys.argv[1:]] or [18, 51, 1]

segs, cands = _build_candidates(DXF, LAYER)
by_id = {c.digit_id: c for c in cands}

for did in ids:
    crop = _render(segs, by_id[did])
    print(f"\n===== digit_id={did} =====")
    deskewed = sr._deskew(crop)
    for deg in sr._SWEEP_ANGLES:
        variant = sr._render_variant(sr._rotate_wb(crop, deg), sr._THICKNESS_FAST)
        text, conf = sr._easyocr_read(variant)
        seg = sr._segment_two_digits(variant) if len(text) <= 1 else None
        print(f"  deg={deg:>3}  read={text!r:>6} ({conf:.2f})   seg={seg}")
    print("  FINAL:", sr.recognize(crop))
