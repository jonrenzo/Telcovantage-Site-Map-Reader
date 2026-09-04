"""
app_python/services/strand_recognizer.py
──────────────────────────────────────────
Fast + accurate strand-identifier recognizer for integers 1-75.

Design goals
------------
FAST    — EasyOCR only by default (TrOCR is opt-in; it is 10-20x slower on CPU).
          Arbitrary rotation is handled by a single geometric DESKEW instead of
          brute-forcing 24 angles through OCR.  A two-pass escalation keeps the
          common (easy) case cheap and only spends extra compute on hard crops.
ACCURATE — Aspect-ratio-preserving rasterization (fixes silent squish), stroke
          healing (morphological close + thickness escalation), and
          domain-constrained voting over the 75 valid values.

Pipeline per crop
-----------------
  1. Deskew the glyph (minAreaRect) so text is upright — 1 cheap CPU op.
  2. Render a healed variant (uniform scale, centered, close kernel).
  3. Pass A (fast): OCR the deskewed render at the 4 cardinal rotations.
     If a valid 1-75 value wins with strong vote share → return immediately.
  4. Pass B (escalate, only if A was weak): add raw (non-deskewed) cardinals
     and extra stroke thicknesses, then vote again.
  5. (Optional) TrOCR votes if STRAND_USE_TROCR=1.

Public API
----------
    from app_python.services.strand_recognizer import recognize
    value, conf = recognize(crop_np)
    # crop_np: uint8 grayscale from render_crop() (white strokes, black bg)
    # value:   "1".."75" or "" ; conf: vote-share 0.0-1.0
"""

from __future__ import annotations

import os
import re
import threading
from collections import Counter, defaultdict
from typing import Dict, List, Set, Tuple

import cv2
import numpy as np

# ── constants ─────────────────────────────────────────────────────────────────

# Strand lengths run up to ~500 m on backbone drawings (BCR405 carries 278,
# 135, 434). The old 1..75 / two-digit cap made every one of those labels
# unrepresentable — the read was thrown away before anyone saw it.
STRAND_MAX = int(os.environ.get("STRAND_MAX_METERS", "500"))
VALID_VALUES: frozenset = frozenset(range(1, STRAND_MAX + 1))
_STRAND_RE = re.compile(r"^\d{1,3}$")

_ROTATIONS = [0, 90, 180, 270]
_TROCR_SIZE = 128

# Stroke thicknesses: pass A uses the first; pass B adds the rest.
_THICKNESS_FAST = 4
_THICKNESS_EXTRA = [2, 6]
_CLOSE_KERNEL_PX = 3

# Pass A returns immediately when the best single deskewed read is at least this
# confident (raw EasyOCR confidence) and valid — the clean-upright-digit case.
FAST_ACCEPT_RAW_CONF = 0.80

# TrOCR is opt-in (slow on CPU). Set STRAND_USE_TROCR=1 to enable.
USE_TROCR_DEFAULT = os.environ.get("STRAND_USE_TROCR", "0") == "1"

# ── singletons ────────────────────────────────────────────────────────────────

_easyocr_lock = threading.Lock()
_easyocr_reader = None

_trocr_lock = threading.Lock()
_trocr_processor = None
_trocr_model = None
_trocr_device = None


# ── validity / cleaning ───────────────────────────────────────────────────────

def _is_valid(text: str) -> bool:
    if not text or not _STRAND_RE.match(text):
        return False
    try:
        return int(text) in VALID_VALUES
    except ValueError:
        return False


def _clean(text: str) -> str:
    """Strip non-digits, apply common OCR digit substitutions."""
    text = text.strip()
    subs = {"O": "0", "o": "0", "l": "1", "I": "1", "S": "5", "s": "5",
            "B": "8", "G": "6", "g": "6", "Z": "2", "z": "2"}
    text = "".join(subs.get(ch, ch) for ch in text)
    return re.sub(r"[^0-9]", "", text)


# ── L1: deskew + aspect-preserving render ─────────────────────────────────────

def _deskew(crop_np: np.ndarray) -> np.ndarray:
    """
    Rotate a white-on-black crop so the glyph's dominant axis is horizontal.
    Handles arbitrary rotation with a single cheap geometric op (no OCR sweep).
    Returns a white-on-black image (same convention as input).
    """
    ys, xs = np.where(crop_np > 127)
    if len(xs) < 5:
        return crop_np

    pts = np.column_stack([xs, ys]).astype(np.float32)
    (_, _), (_, _), angle = cv2.minAreaRect(pts)
    # Normalize to the smallest rotation [-45, 45]. OpenCV's angle convention
    # differs across versions (<4.5 returns [-90,0); >=4.5 returns [0,90)),
    # so handle both ends — otherwise the deskew rotates the wrong way.
    if angle > 45:
        angle -= 90
    elif angle < -45:
        angle += 90

    if abs(angle) < 1.0:
        return crop_np

    h, w = crop_np.shape[:2]
    # Rotate on an expanded canvas so nothing is clipped, then re-tighten later.
    diag = int(np.ceil(np.hypot(h, w)))
    canvas = np.zeros((diag, diag), dtype=np.uint8)
    oy, ox = (diag - h) // 2, (diag - w) // 2
    canvas[oy:oy + h, ox:ox + w] = crop_np
    M = cv2.getRotationMatrix2D((diag / 2, diag / 2), angle, 1.0)
    return cv2.warpAffine(canvas, M, (diag, diag), flags=cv2.INTER_CUBIC, borderValue=0)


def _render_variant(
    crop_np: np.ndarray,
    thickness: int,
    out_px: int = _TROCR_SIZE,
    morph_close: bool = True,
) -> np.ndarray:
    """
    Re-render `crop_np` (white-on-black) at `thickness` with a SINGLE uniform
    scale factor (aspect-ratio preserved), centered, then invert to a clean
    black-glyph-on-white image ready for OCR.
    """
    ys, xs = np.where(crop_np > 127)
    if len(xs) == 0:
        return np.full((out_px, out_px), 255, dtype=np.uint8)

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    glyph_w = max(x1 - x0 + 1, 1)
    glyph_h = max(y1 - y0 + 1, 1)

    pad = max(out_px // 8, thickness + 4)
    available = out_px - 2 * pad
    scale = available / max(glyph_w, glyph_h)
    new_w = max(int(glyph_w * scale), 1)
    new_h = max(int(glyph_h * scale), 1)

    glyph = crop_np[y0:y1 + 1, x0:x1 + 1]
    resized = cv2.resize(glyph, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    _, resized = cv2.threshold(resized, 127, 255, cv2.THRESH_BINARY)

    if thickness > 2:
        k = max(thickness - 2, 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        resized = cv2.dilate(resized, kernel)

    if morph_close:
        kc = cv2.getStructuringElement(cv2.MORPH_RECT, (_CLOSE_KERNEL_PX, _CLOSE_KERNEL_PX))
        resized = cv2.morphologyEx(resized, cv2.MORPH_CLOSE, kc)

    canvas = np.zeros((out_px, out_px), dtype=np.uint8)
    off_x = max((out_px - new_w) // 2, 0)
    off_y = max((out_px - new_h) // 2, 0)
    h_p = min(new_h, out_px - off_y)
    w_p = min(new_w, out_px - off_x)
    canvas[off_y:off_y + h_p, off_x:off_x + w_p] = resized[:h_p, :w_p]
    return cv2.bitwise_not(canvas)   # black glyph on white


def _rotate(img: np.ndarray, deg: int) -> np.ndarray:
    if deg == 0:
        return img
    if deg == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if deg == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)


def _rotate_wb(crop_wb: np.ndarray, deg: float) -> np.ndarray:
    """
    Rotate a white-on-black crop by an arbitrary angle on an expanded square
    canvas (no clipping, black fill). Used for the coarse full-circle sweep so
    rotation coverage does NOT depend on deskew succeeding.
    """
    if deg % 360 == 0:
        return crop_wb
    h, w = crop_wb.shape[:2]
    diag = int(np.ceil(np.hypot(h, w)))
    canvas = np.zeros((diag, diag), dtype=np.uint8)
    oy, ox = (diag - h) // 2, (diag - w) // 2
    canvas[oy:oy + h, ox:ox + w] = crop_wb
    M = cv2.getRotationMatrix2D((diag / 2, diag / 2), deg, 1.0)
    return cv2.warpAffine(canvas, M, (diag, diag), flags=cv2.INTER_CUBIC, borderValue=0)


# Coarse full-circle sweep angles (degrees). EasyOCR tolerates ~±15deg, so 30deg
# steps guarantee at least one near-upright sample for ANY input rotation.
_SWEEP_ANGLES = list(range(0, 360, 30))


# ── L3 engine A: EasyOCR ──────────────────────────────────────────────────────

def _load_easyocr():
    global _easyocr_reader
    if _easyocr_reader is not None:
        return _easyocr_reader
    with _easyocr_lock:
        if _easyocr_reader is not None:
            return _easyocr_reader
        import easyocr

        # Same device policy as every other model in the app. This was
        # hardcoded gpu=False, leaving the GPU idle while a full-drawing scan
        # took 88 s on CPU (~7 s on the same box's GPU).
        try:
            import torch

            use_gpu = torch.cuda.is_available()
        except Exception:
            use_gpu = False
        print(f"[strand_recognizer] Loading EasyOCR (gpu={use_gpu})...")
        _easyocr_reader = easyocr.Reader(["en"], gpu=use_gpu)
        print("[strand_recognizer] EasyOCR ready.")
    return _easyocr_reader


# Labels on the distance layer are digits followed by a unit suffix
# ("38m"), not bare numbers. A digit-only allowlist can't recognise the "m"
# as a letter, so it forces that glyph into the closest digit shape instead
# — "38m" came back "380", which still passes the 1-500 valid-value check
# and silently corrupts the reading. Allowing "m"/"M" lets EasyOCR read it
# correctly; _clean() already strips non-digit characters afterward, so the
# stored value is still the bare number.
_ALLOWLIST = "0123456789mM"


def _easyocr_read(img_bw: np.ndarray) -> Tuple[str, float]:
    """Run EasyOCR on a black-on-white image. Returns (cleaned_text, conf)."""
    reader = _load_easyocr()
    padded = cv2.copyMakeBorder(img_bw, 16, 16, 16, 16, cv2.BORDER_CONSTANT, value=255)
    ph, pw = padded.shape[:2]
    try:
        results = reader.recognize(
            padded, horizontal_list=[[0, pw, 0, ph]], free_list=[],
            allowlist=_ALLOWLIST, detail=1,
        )
    except Exception:
        results = reader.readtext(padded, allowlist=_ALLOWLIST, detail=1, paragraph=False)

    if not results:
        return "", 0.0
    best = max(results, key=lambda x: x[2])
    return _clean(best[1]), float(best[2])


def _easyocr_best_rot(src_bw: np.ndarray) -> Tuple[str, float]:
    """
    Read a rendered variant at all 4 cardinal rotations and return the single
    best VALID (text, conf). Discards wrong-orientation garbage instead of
    letting it vote — only the correct orientation should survive.
    """
    best_text, best_conf = "", 0.0
    for rot in _ROTATIONS:
        text, conf = _easyocr_read(_rotate(src_bw, rot))
        if _is_valid(text) and conf > best_conf:
            best_text, best_conf = text, conf
    return best_text, best_conf


# Segmentation votes get a bonus — when a wide glyph is split into two clean
# single digits, that structural read is usually more reliable than the whole-
# glyph read that collapsed two digits into one.


def _segment_two_digits(img_bw: np.ndarray, min_sub_conf: float = 0.40):
    """
    Recover a two-digit value when EasyOCR collapsed it to one digit.

    img_bw must be an upright black-glyph-on-white render. If the ink is wider
    than it is tall (two side-by-side digits), split at the vertical-projection
    valley, recognise each half as a single digit, and recombine. Returns
    (combined_text, mean_conf) if the result is a valid 1-75 value, else None.
    """
    ink = (img_bw < 127).astype(np.uint8)
    cols = ink.sum(axis=0)
    rows = ink.sum(axis=1)
    nz_c = np.where(cols > 0)[0]
    nz_r = np.where(rows > 0)[0]
    if len(nz_c) < 4 or len(nz_r) < 2:
        return None

    x0, x1 = int(nz_c[0]), int(nz_c[-1])
    y0, y1 = int(nz_r[0]), int(nz_r[-1])
    w, h = x1 - x0, y1 - y0
    if h <= 0 or (w / h) < 1.1:        # too tall → single digit, don't split
        return None

    # Deepest ink valley in the central band is the inter-digit gap.
    lo, hi = x0 + int(w * 0.30), x0 + int(w * 0.70)
    if hi <= lo:
        return None
    valley = lo + int(np.argmin(cols[lo:hi + 1]))

    parts = [img_bw[y0:y1 + 1, x0:valley], img_bw[y0:y1 + 1, valley:x1 + 1]]
    digits, confs = [], []
    for part in parts:
        if part.shape[1] < 3:
            return None
        rendered = _render_variant(cv2.bitwise_not(part), _THICKNESS_FAST)
        t, c = _easyocr_read(rendered)
        if len(t) == 1 and t.isdigit() and c >= min_sub_conf:
            digits.append(t)
            confs.append(c)
        else:
            return None

    combined = "".join(digits)
    if _is_valid(combined):
        return combined, float(np.mean(confs))
    return None


# ── L3 engine B: TrOCR (opt-in) ───────────────────────────────────────────────

def _load_trocr():
    global _trocr_processor, _trocr_model, _trocr_device
    if _trocr_model is not None:
        return
    with _trocr_lock:
        if _trocr_model is not None:
            return
        import torch
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
        _trocr_device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[strand_recognizer] Loading TrOCR (handwritten) on {_trocr_device}...")
        _trocr_processor = TrOCRProcessor.from_pretrained("microsoft/trocr-base-handwritten")
        _trocr_model = VisionEncoderDecoderModel.from_pretrained("microsoft/trocr-base-handwritten")
        _trocr_model.to(_trocr_device)
        _trocr_model.eval()
        print("[strand_recognizer] TrOCR ready.")


def _trocr_read_batch(imgs_bw: List[np.ndarray]) -> List[Tuple[str, float]]:
    import torch
    import torch.nn.functional as F
    from PIL import Image

    pils = [Image.fromarray(cv2.cvtColor(i, cv2.COLOR_GRAY2RGB), mode="RGB") for i in imgs_bw]
    pixel_values = _trocr_processor(images=pils, return_tensors="pt").pixel_values.to(_trocr_device)
    with torch.no_grad():
        out = _trocr_model.generate(
            pixel_values, max_new_tokens=6, output_scores=True, return_dict_in_generate=True
        )
    res = []
    for b in range(pixel_values.shape[0]):
        text = _trocr_processor.tokenizer.decode(out.sequences[b], skip_special_tokens=True).strip()
        if out.scores:
            probs = [float(F.softmax(s[b], dim=-1).max().item()) for s in out.scores]
            conf = float(np.mean(probs))
        else:
            conf = 0.0
        res.append((_clean(text), conf))
    return res


# ── L4: domain-constrained selection ──────────────────────────────────────────

# How much a single extra agreeing read is worth when scoring. Kept SMALL so the
# single highest-confidence read dominates and agreement only breaks near-ties —
# wrong-orientation reads (lower confidence) must never out-accumulate the one
# correct upright read (which EasyOCR returns at ~1.0 confidence).
_AGREE_W = 0.05


# A two-digit read this confident is trusted over any one-digit read — a lone
# digit usually means EasyOCR dropped the other one. Below this, a 2-digit read
# is treated as a possible hallucination and one-digit reads stay in contention
# (so genuine single-digit strand IDs are not forced into two digits).
_TWO_DIGIT_MIN = 0.55


def _select_from(reads: List[Tuple[str, float, int]]) -> Tuple[str, float]:
    """
    Pick the best strand value from a pool of (value, conf, angle) reads.

    Value score = max_conf(value) + _AGREE_W*(count-1). A confident TWO-digit
    value is preferred over any one-digit value (a single digit usually means a
    dropped digit). Within a length class the most-confident read wins, with
    light agreement credit as a tie-break. Reported confidence is the winner's
    max confidence, discounted when it was seen only once. The angle is ignored
    here — it is used later by the batch flip re-resolution.
    """
    max_conf: Dict[str, float] = defaultdict(float)
    count: Dict[str, int] = defaultdict(int)
    for value, conf, _ in reads:
        if _is_valid(value) and conf > 0:
            max_conf[value] = max(max_conf[value], conf)
            count[value] += 1
    if not max_conf:
        return "", 0.0

    def score(v: str) -> float:
        return max_conf[v] + _AGREE_W * (count[v] - 1)

    two_digit = [v for v in max_conf if len(v) >= 2]
    # Prefer the two-digit pool only if its best member is confident enough.
    pool = max_conf.keys()
    if two_digit and max(max_conf[v] for v in two_digit) >= _TWO_DIGIT_MIN:
        pool = two_digit

    best = max(pool, key=score)
    conf = max_conf[best] * (1.0 if count[best] >= 2 else 0.85)
    return best, round(min(conf, 1.0), 4)


def _winner_angle(reads: List[Tuple[str, float, int]], value: str):
    """Sweep angle giving the highest-confidence read of `value` (or None)."""
    best_a, best_c = None, -1.0
    for v, c, a in reads:
        if v == value and c > best_c:
            best_a, best_c = a, c
    return best_a


# ── public API ────────────────────────────────────────────────────────────────

def _collect_reads(
    crop_np: np.ndarray, use_trocr: bool = USE_TROCR_DEFAULT
) -> List[Tuple[str, float, int]]:
    """
    Sweep the raw crop through a full-circle set of orientations, render and read
    each, and return every VALID read as (value, conf, angle). Thicker stroke
    healing is only added when the base sweep is still uncertain.
    """
    _load_easyocr()
    reads: List[Tuple[str, float, int]] = []

    def _sweep(thickness: int) -> None:
        for deg in _SWEEP_ANGLES:
            variant = _render_variant(_rotate_wb(crop_np, deg), thickness)
            text, conf = _easyocr_read(variant)
            if _is_valid(text):
                reads.append((text, conf, deg))
            # Recover a dropped digit when a wide glyph reads as one digit.
            if len(text) <= 1:
                seg = _segment_two_digits(variant)
                if seg:
                    reads.append((seg[0], seg[1], deg))

    _sweep(_THICKNESS_FAST)
    if _select_from(reads)[1] < 0.60:
        for t in _THICKNESS_EXTRA:
            _sweep(t)

    if use_trocr:
        _load_trocr()
        imgs = [_render_variant(_rotate_wb(crop_np, d), _THICKNESS_FAST) for d in _SWEEP_ANGLES]
        for (text, c), d in zip(_trocr_read_batch(imgs), _SWEEP_ANGLES):
            if _is_valid(text):
                reads.append((text, c, d))
    return reads


def recognize(
    crop_np: np.ndarray,
    *,
    use_trocr: bool = USE_TROCR_DEFAULT,
    fast_accept: float = FAST_ACCEPT_RAW_CONF,
) -> Tuple[str, float]:
    """
    Recognize a single strand identifier (integer 1-75) from a render_crop()
    grayscale image (white strokes on black). Returns (value_str, confidence).

    Strategy: rotate the raw crop through a full-circle coarse sweep, render and
    read each orientation, and SELECT the single most-confident valid read (the
    true upright orientation gives EasyOCR its highest confidence). When a read
    collapses to one digit on a wide glyph, segmentation recovers the dropped
    digit. For drawing-wide flip-ambiguity resolution use recognize_batch().
    """
    return _select_from(_collect_reads(crop_np, use_trocr))


# ── batch orientation re-resolution ───────────────────────────────────────────
#
# A single crop cannot tell "19" from "61" — both are valid 1-75 and one is the
# other rotated 180 degrees. But a whole drawing can: nearly all labels share an
# "up" direction, so the correct reading sits at the dominant sweep orientation
# while the wrong flip sits ~180 degrees away on the sparsely-populated side.

_FLIP_ANGLE_TOL = 45       # within this of 180-apart counts as a flip pair
_FLIP_DENSITY_MARGIN = 3   # dominant side must beat the flip side by this many
_FLIP_MIN_CONF = 0.95      # only re-resolve toward a VERY confident flip-partner
# Rationale: a genuine flip ambiguity is a CLEAR glyph that reads ~1.0 both ways,
# so the partner must be near-certain AND strictly beat the current winner. This
# leaves degraded glyphs (everything ~0.78) and minority-orientation labels
# (partner less confident than the winner) untouched.


def _angle_density(hist: "Counter", angle: int) -> int:
    """Number of confident winners whose orientation is within tol of `angle`."""
    return sum(
        n for a, n in hist.items()
        if min((a - angle) % 360, (angle - a) % 360) <= _FLIP_ANGLE_TOL
    )


def _reresolve_flip(reads, value, conf, hist):
    """Switch to a flip-partner reading only if it sits on the dominant side."""
    if not value or len(value) < 2:
        return value, conf
    a_v = _winner_angle(reads, value)
    if a_v is None:
        return value, conf
    flip = (a_v + 180) % 360

    # Best alternative two-digit value read near the flipped orientation.
    alt: Dict[str, Tuple[float, int]] = {}
    for v, c, a in reads:
        if v == value or len(v) < 2:
            continue
        if min((a - flip) % 360, (flip - a) % 360) <= _FLIP_ANGLE_TOL:
            if c > alt.get(v, (0.0, 0))[0]:
                alt[v] = (c, a)

    for v, (c, a) in alt.items():
        if (c >= _FLIP_MIN_CONF
                and c > conf
                and _angle_density(hist, a) >= _angle_density(hist, a_v) + _FLIP_DENSITY_MARGIN):
            print(f"[strand_recognizer] flip-fix: {value!r}@{a_v}({conf:.2f}) -> "
                  f"{v!r}@{a}({c:.2f})  density {_angle_density(hist, a_v)} -> "
                  f"{_angle_density(hist, a)}")
            return v, round(c, 4)
    return value, conf


def recognize_batch(
    crops: List[np.ndarray],
    *,
    use_trocr: bool = USE_TROCR_DEFAULT,
    progress_cb=None,
) -> List[Tuple[str, float]]:
    """
    Recognize many crops from ONE drawing, using the drawing-wide dominant
    orientation to fix 180-degree flip ambiguities (e.g. 19 vs 61) that a single
    crop cannot. Returns a list of (value, conf) aligned with `crops`.

    progress_cb(done, total), if given, is called after each crop is read — the
    sweep is the slow part, so this drives the UI progress bar.
    """
    all_reads = []
    n = len(crops)
    for i, crop in enumerate(crops):
        all_reads.append(_collect_reads(crop, use_trocr))
        if progress_cb is not None:
            progress_cb(i + 1, n)
    results = [_select_from(r) for r in all_reads]

    # Orientation signal: the angle of every confident two-digit winner.
    hist: Counter = Counter()
    for reads, (val, conf) in zip(all_reads, results):
        if val and len(val) >= 2 and conf >= 0.90:
            a = _winner_angle(reads, val)
            if a is not None:
                hist[a] += 1
    if not hist:
        return results

    return [
        _reresolve_flip(reads, val, conf, hist)
        for reads, (val, conf) in zip(all_reads, results)
    ]


def prewarm() -> None:
    """Load engine singletons at startup. EasyOCR always; TrOCR only if enabled."""
    _load_easyocr()
    if USE_TROCR_DEFAULT:
        try:
            _load_trocr()
        except Exception as e:
            print(f"[strand_recognizer] TrOCR prewarm failed: {e}")
