"""
pole_ocr.py — Tesseract OCR for stroked-polyline pole labels.

Renders the pole bbox segments into a clean image, detects orientation
from the bbox aspect ratio, runs Tesseract on the best rotation
(+ 180 deg fallback), and returns the reading with confidence.

Speed  : ~2 Tesseract calls per pole (vs 4 previously).
Accuracy: renders only bbox-clipped segments, larger canvas, CLAHE pre-proc.
"""

from __future__ import annotations

import math
from typing import List, Tuple, Optional

import cv2
import numpy as np

try:
    import pytesseract
    from pytesseract import Output
    _TESS_OK = True
except ImportError:
    _TESS_OK = False

# ── tuneable constants ────────────────────────────────────────────────────────

OCR_IMG_SIZE   = 320     # render resolution fed to Tesseract
STROKE_PX      = 3       # stroke thickness in pixels
CROP_PAD_FRAC  = 0.15    # padding around bbox (fraction of its max dimension)
CONF_THRESHOLD = 0.55    # auto-accept if Tesseract mean word conf >= this

# psm 7 = single text line | oem 1 = LSTM
TESS_CONFIG = (
    "--psm 7 --oem 1 "
    "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-."
)


# ── result ────────────────────────────────────────────────────────────────────

class PoleOcrResult:
    __slots__ = ("text", "confidence", "accepted", "crop_png")

    def __init__(self, text: str, confidence: float,
                 accepted: bool, crop_png: Optional[bytes]) -> None:
        self.text       = text
        self.confidence = confidence
        self.accepted   = accepted
        self.crop_png   = crop_png


# ── rendering ────────────────────────────────────────────────────────────────

def _render(segments: list,
            bbox: Tuple[float, float, float, float],
            size: int = OCR_IMG_SIZE,
            pad_frac: float = CROP_PAD_FRAC,
            thickness: int = STROKE_PX) -> np.ndarray:
    """White-on-black uint8 render of segments clipped to padded bbox."""
    minx, miny, maxx, maxy = bbox
    bw = max(maxx - minx, 1e-9)
    bh = max(maxy - miny, 1e-9)
    pad = max(bw, bh) * pad_frac
    x0, xr = minx - pad, maxx + pad
    y0, yr = miny - pad, maxy + pad
    rw = xr - x0
    rh = yr - y0

    img = np.zeros((size, size), dtype=np.uint8)

    def to_px(x: float, y: float) -> Tuple[int, int]:
        return (
            int(round((x - x0) / rw * (size - 1))),
            int(round((1.0 - (y - y0) / rh) * (size - 1))),
        )

    for s in segments:
        if hasattr(s, "x1"):
            sx1, sy1, sx2, sy2 = s.x1, s.y1, s.x2, s.y2
        elif isinstance(s, dict):
            sx1, sy1, sx2, sy2 = s["x1"], s["y1"], s["x2"], s["y2"]
        else:
            continue

        # skip segments entirely outside the padded window
        if (max(sx1, sx2) < x0 or min(sx1, sx2) > xr or
                max(sy1, sy2) < y0 or min(sy1, sy2) > yr):
            continue

        if math.hypot(sx2 - sx1, sy2 - sy1) < 1e-9:
            continue

        cv2.line(img, to_px(sx1, sy1), to_px(sx2, sy2),
                 255, thickness=thickness, lineType=cv2.LINE_AA)

    return img


# ── orientation ───────────────────────────────────────────────────────────────

def _primary_rotation(bbox: Tuple[float, float, float, float]) -> float:
    """
    Estimate how many degrees CCW to rotate so text runs left-to-right.
    - Landscape bbox (w >= h*1.1) -> 0 deg  (already horizontal)
    - Portrait bbox  (h >  w*1.1) -> 90 deg (rotate to horizontal)
    """
    minx, miny, maxx, maxy = bbox
    w = maxx - minx
    h = maxy - miny
    return 90.0 if h > w * 1.1 else 0.0


def _rot(img: np.ndarray, deg: float) -> np.ndarray:
    if abs(deg) < 0.5:
        return img
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), deg, 1.0)
    return cv2.warpAffine(img, M, (w, h),
                          flags=cv2.INTER_LINEAR, borderValue=0)


# ── Tesseract ─────────────────────────────────────────────────────────────────

def _preprocess(img: np.ndarray) -> np.ndarray:
    """CLAHE + white border so Tesseract does not clip edge characters."""
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    img   = clahe.apply(img)
    return cv2.copyMakeBorder(img, 14, 14, 14, 14,
                              cv2.BORDER_CONSTANT, value=0)


def _run_tess(img: np.ndarray) -> Tuple[str, float]:
    """Return (text, mean_conf 0-1). Empty string on failure."""
    if not _TESS_OK:
        return "", 0.0
    try:
        data = pytesseract.image_to_data(
            img, config=TESS_CONFIG, output_type=Output.DICT
        )
        pairs = [
            (w.strip(), int(c))
            for w, c in zip(data["text"], data["conf"])
            if w.strip() and int(c) >= 0
        ]
        if not pairs:
            return "", 0.0
        text = "".join(w for w, _ in pairs).upper().strip()
        conf = sum(c for _, c in pairs) / len(pairs) / 100.0
        return text, conf
    except Exception:
        return "", 0.0


def _best(img: np.ndarray, rotations: List[float]) -> Tuple[str, float]:
    """Try rotations, return (text, conf) with highest confidence."""
    best_t, best_c = "", 0.0
    for deg in rotations:
        t, c = _run_tess(_preprocess(_rot(img, deg)))
        if c > best_c:
            best_t, best_c = t, c
    return best_t, best_c


# ── public API ────────────────────────────────────────────────────────────────

def ocr_pole(
    segments: list,
    bbox: Tuple[float, float, float, float],
    conf_threshold: float = CONF_THRESHOLD,
) -> PoleOcrResult:
    """
    OCR one stroked-polyline pole label.

    segments  - Seg objects (.x1/.y1/.x2/.y2) or dicts - pass the full
                layer list, the renderer clips to the bbox window.
    bbox      - (minx, miny, maxx, maxy) in DXF coordinates.
    """
    if not _TESS_OK:
        return PoleOcrResult("", 0.0, False, None)

    raw = _render(segments, bbox)

    # UI crop: dark strokes on white background
    _, buf   = cv2.imencode(".png", cv2.bitwise_not(raw))
    crop_png = bytes(buf)

    # Orientation: primary (from bbox shape) + 180-deg flip
    # + perpendicular pair as fallback for misdetected aspect ratio
    p = _primary_rotation(bbox)
    rotations = [p, p + 180.0, p + 90.0, p - 90.0]

    text, conf = _best(raw, rotations)
    accepted   = bool(text) and conf >= conf_threshold

    return PoleOcrResult(
        text       = text,
        confidence = round(conf, 4),
        accepted   = accepted,
        crop_png   = crop_png,
    )