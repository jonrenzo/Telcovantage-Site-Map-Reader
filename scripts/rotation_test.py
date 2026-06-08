"""
scripts/rotation_test.py
────────────────────────
Measure recognizer robustness to rotation. Synthesizes stroked numbers,
rotates them 0..350 in 10-degree steps, and reports what recognize() returns
at each angle. Surfaces the "fails at 200+ degrees" problem precisely.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np
from app_python.services.strand_recognizer import recognize, _deskew


def make_number(value: str, size: int = 128) -> np.ndarray:
    """White-on-black stroked number, roughly like render_crop output."""
    img = np.zeros((size, size), dtype=np.uint8)
    cv2.putText(img, value, (size // 6, int(size * 0.72)),
                cv2.FONT_HERSHEY_SIMPLEX, 2.2, 255, 3, cv2.LINE_AA)
    return img


def rotate_full(img: np.ndarray, deg: float) -> np.ndarray:
    """Rotate on an expanded square canvas (white-on-black, no clipping)."""
    h, w = img.shape[:2]
    diag = int(np.ceil(np.hypot(h, w)))
    canvas = np.zeros((diag, diag), dtype=np.uint8)
    oy, ox = (diag - h) // 2, (diag - w) // 2
    canvas[oy:oy + h, ox:ox + w] = img
    M = cv2.getRotationMatrix2D((diag / 2, diag / 2), deg, 1.0)
    return cv2.warpAffine(canvas, M, (diag, diag), borderValue=0)


def main():
    test_values = ["12", "42", "7", "53", "31"]
    angles = list(range(0, 360, 10))

    for val in test_values:
        base = make_number(val)
        correct = 0
        fails = []
        for deg in angles:
            rotated = rotate_full(base, deg)
            pred, conf = recognize(rotated)
            ok = (pred == val)
            if ok:
                correct += 1
            else:
                fails.append((deg, pred, round(conf, 2)))
        print(f"\nvalue={val!r}: {correct}/{len(angles)} correct")
        if fails:
            print("  fails: " + ", ".join(f"{d}deg->{p or '?'}({c})" for d, p, c in fails))


if __name__ == "__main__":
    main()
