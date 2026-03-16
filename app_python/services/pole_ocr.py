"""
app_python/services/pole_ocr.py
────────────────────────────────
OCR for stroked pole ID labels using TrOCR with auto-rotation.

Model: microsoft/trocr-base-printed
  - ViT image encoder + RoBERTa text decoder
  - ~334 MB download on first use, cached by HuggingFace in ~/.cache/huggingface

Auto-rotation
─────────────
Pole labels appear at any orientation in DXF drawings. All four 90-degree
rotations of each crop are tried in a single batched generate() call.
Best result is selected by:
  1. Valid pole-ID regex match preferred over non-match
  2. Highest confidence among equally-valid candidates
  3. Tie-break: 0 degrees (upright) preferred

Call surface (unchanged from prior version):
    result = ocr_pole(segments, bbox)
    result.text        -> str   (recognised text, cleaned)
    result.confidence  -> float (0.0 - 1.0, mean per-token probability)
    result.accepted    -> bool  (passes pole-ID regex + confidence gate)
    result.crop_png    -> bytes | None  (PNG of the rendered crop, 0-deg orientation)
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np

# ── lazy singletons ───────────────────────────────────────────────────────────
_processor = None
_model = None
_device = None

# ── constants ─────────────────────────────────────────────────────────────────
MODEL_ID = "microsoft/trocr-base-printed"

CROP_PX = 192  # rasterisation output size (square)
PAD_FRAC = 0.18  # padding as fraction of bbox dimension
LINE_PX = 4  # stroke thickness in pixels
MIN_CONF = 0.60  # acceptance gate
BATCH_SIZE = 16  # max images per generate() call (4 rotations × N poles)
MAX_TOKENS = 16  # max tokens per image (pole IDs are short strings)

# 8-angle sweep: cardinals + 45-degree diagonals.
# Covers the ~315-degree (-45-degree) orientation that DXF pole labels
# commonly appear in, which TrOCR cannot read upright.
_ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315]
_POLEID_RE = re.compile(r"^(?:NPT|[A-Z]{0,2}\d+(?:-\d+)?)$", re.IGNORECASE)


# ── data classes ──────────────────────────────────────────────────────────────


@dataclass
class _Seg:
    x1: float
    y1: float
    x2: float
    y2: float

    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)


@dataclass
class OcrResult:
    text: str
    confidence: float
    accepted: bool
    crop_png: Optional[bytes] = field(default=None, repr=False)


# ── model loader (singleton) ──────────────────────────────────────────────────


def _load_model() -> None:
    global _processor, _model, _device

    if _model is not None:
        return

    import torch
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[pole_ocr] Loading TrOCR ({MODEL_ID}) on {_device} ...")

    _processor = TrOCRProcessor.from_pretrained(MODEL_ID)
    _model = VisionEncoderDecoderModel.from_pretrained(MODEL_ID)
    _model.to(_device)
    _model.eval()

    print("[pole_ocr] TrOCR ready.")


# ── rasterisation helpers ─────────────────────────────────────────────────────


def _to_segs(raw_segments) -> List[_Seg]:
    out = []
    for s in raw_segments:
        if isinstance(s, dict):
            out.append(_Seg(s["x1"], s["y1"], s["x2"], s["y2"]))
        else:
            out.append(_Seg(float(s.x1), float(s.y1), float(s.x2), float(s.y2)))
    return out


def _rasterise(
    segments: List[_Seg],
    bbox: Tuple[float, float, float, float],
    out_px: int = CROP_PX,
    pad_frac: float = PAD_FRAC,
    line_px: int = LINE_PX,
) -> np.ndarray:
    """
    Render stroked segments as black ink on white background (RGB).
    TrOCR expects printed text on a white background.
    """
    import cv2

    minx, miny, maxx, maxy = bbox
    w = maxx - minx
    h = maxy - miny

    px = max(pad_frac * w, 1e-9)
    py = max(pad_frac * h, 1e-9)
    minx -= px
    maxx += px
    miny -= py
    maxy += py
    w2 = maxx - minx
    h2 = maxy - miny

    img = np.full((out_px, out_px, 3), 255, dtype=np.uint8)

    def to_px(x: float, y: float):
        px_ = int(round((x - minx) / w2 * (out_px - 1)))
        py_ = int(round((1.0 - (y - miny) / h2) * (out_px - 1)))
        return px_, py_

    for s in segments:
        if s.length() <= 1e-9:
            continue
        cv2.line(
            img,
            to_px(s.x1, s.y1),
            to_px(s.x2, s.y2),
            (0, 0, 0),
            thickness=line_px,
            lineType=cv2.LINE_AA,
        )

    return img


def _img_to_png_bytes(img: np.ndarray) -> bytes:
    import cv2

    ok, buf = cv2.imencode(".png", img)
    return bytes(buf) if ok else b""


def _img_to_pil(img_rgb: np.ndarray, rotation_deg: float = 0):
    """
    Convert an RGB uint8 ndarray to a PIL Image with arbitrary rotation.

    Cardinal angles (0, 90, 180, 270) use cv2.rotate for lossless quality.
    All other angles (e.g. 45, 135, 315) use PIL rotate with expand=True so
    diagonal rotations don't clip the content; white fills the new corners.
    """
    import cv2
    from PIL import Image

    deg = int(rotation_deg) % 360

    if deg == 0:
        return Image.fromarray(img_rgb, mode="RGB")
    if deg == 90:
        return Image.fromarray(cv2.rotate(img_rgb, cv2.ROTATE_90_CLOCKWISE), mode="RGB")
    if deg == 180:
        return Image.fromarray(cv2.rotate(img_rgb, cv2.ROTATE_180), mode="RGB")
    if deg == 270:
        return Image.fromarray(
            cv2.rotate(img_rgb, cv2.ROTATE_90_COUNTERCLOCKWISE), mode="RGB"
        )

    # Arbitrary angle: PIL rotates counter-clockwise, so negate for clockwise convention
    pil = Image.fromarray(img_rgb, mode="RGB")
    return pil.rotate(
        -deg, resample=Image.BILINEAR, expand=True, fillcolor=(255, 255, 255)
    )


# ── batched inference ─────────────────────────────────────────────────────────


def _generate_batch(
    pixel_values, max_new_tokens: int = MAX_TOKENS
) -> List[Tuple[str, float]]:
    """
    Run model.generate() on a batch of pixel_values.
    Returns list of (decoded_text, mean_token_confidence) per image.
    """
    import torch
    import torch.nn.functional as F

    with torch.no_grad():
        out = _model.generate(
            pixel_values,
            max_new_tokens=max_new_tokens,
            output_scores=True,
            return_dict_in_generate=True,
        )

    results = []
    for b in range(pixel_values.shape[0]):
        token_ids = out.sequences[b]
        text = _processor.tokenizer.decode(token_ids, skip_special_tokens=True).strip()

        if out.scores:
            probs = [
                float(F.softmax(step[b], dim=-1).max().item()) for step in out.scores
            ]
            conf = float(np.mean(probs))
        else:
            conf = 0.0

        results.append((text, conf))

    return results


# ── post-processing ───────────────────────────────────────────────────────────


def _clean(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", text)
    return text.upper()


def _is_valid(text: str) -> bool:
    return bool(text and _POLEID_RE.match(text))


# ── public API ────────────────────────────────────────────────────────────────

# Confidence threshold above which a 0-degree read is trusted immediately,
# skipping the rotation sweep entirely.
FAST_CONF_THRESHOLD = 0.95


def _run_angles(
    img_rgb: np.ndarray, angles: List[float], max_new_tokens: int
) -> List[Tuple[str, float]]:
    """Build PIL crops for each angle, run batched inference, return raw results."""
    pils = [_img_to_pil(img_rgb, a) for a in angles]
    all_raw: List[Tuple[str, float]] = []
    for start in range(0, len(pils), BATCH_SIZE):
        chunk = pils[start : start + BATCH_SIZE]
        pixel_values = _processor(images=chunk, return_tensors="pt").pixel_values
        pixel_values = pixel_values.to(_device)
        all_raw.extend(_generate_batch(pixel_values, max_new_tokens))
    return all_raw


def _pick_best(
    angles: List[float], raw_results: List[Tuple[str, float]]
) -> Tuple[str, float, bool]:
    """Select the best (text, conf, valid) from a list of angle results."""
    best_text = ""
    best_conf = -1.0
    best_valid = False

    for rot, (raw_text, confidence) in zip(angles, raw_results):
        cleaned = _clean(raw_text)
        valid = _is_valid(cleaned)

        print(
            f"[pole_ocr]  rot={rot:>5}  raw={raw_text!r:>14}  "
            f"cleaned={cleaned!r:>10}  conf={confidence:.3f}  valid={valid}"
        )

        if valid and not best_valid:
            best_text, best_conf, best_valid = cleaned, confidence, True
        elif valid == best_valid and confidence > best_conf:
            best_text, best_conf = cleaned, confidence

    if not best_text:
        best_conf = max(r[1] for r in raw_results) if raw_results else 0.0

    return best_text, best_conf, best_valid


def ocr_pole(
    segments,
    bbox: Tuple[float, float, float, float],
    *,
    min_conf: float = MIN_CONF,
    crop_px: int = CROP_PX,
    pad_frac: float = PAD_FRAC,
    line_px: int = LINE_PX,
    max_new_tokens: int = MAX_TOKENS,
    auto_rotate: bool = True,
) -> OcrResult:
    """
    Rasterise stroked segments inside bbox and run TrOCR.

    Two-pass strategy (when auto_rotate=True):
      Pass 1 — try 0-degrees only (fast).
      Pass 2 — if pass 1 confidence < FAST_CONF_THRESHOLD or result is not a
               valid pole ID, run the full 8-angle sweep (0, 45, 90 ... 315)
               and pick the best result across all orientations.

    This means poles that are already upright cost a single forward pass,
    while rotated or uncertain poles trigger the full sweep automatically.

    Parameters
    ----------
    segments      : iterable of Seg-like objects or dicts with x1/y1/x2/y2
    bbox          : (minx, miny, maxx, maxy) in DXF world coordinates
    min_conf      : minimum confidence to mark result as accepted
    crop_px       : pixel size of the square rasterised crop
    pad_frac      : padding fraction around bbox
    line_px       : stroke thickness for rasterisation
    max_new_tokens: token budget per image
    auto_rotate   : if True (default), use two-pass strategy described above.
                    Set False to only run the upright (0-degree) orientation.

    Returns
    -------
    OcrResult with .text, .confidence, .accepted, .crop_png
    crop_png is always the 0-degree render so the UI preview is consistent.
    """
    _load_model()

    segs = _to_segs(segments)

    # Spatial filter — keep only segments near the bbox
    minx, miny, maxx, maxy = bbox
    margin = max((maxx - minx), (maxy - miny)) * 0.5
    segs = [
        s
        for s in segs
        if not (
            max(s.x1, s.x2) < minx - margin
            or min(s.x1, s.x2) > maxx + margin
            or max(s.y1, s.y2) < miny - margin
            or min(s.y1, s.y2) > maxy + margin
        )
    ]

    # Rasterise once at native orientation (RGB, white bg)
    img_rgb = _rasterise(segs, bbox, out_px=crop_px, pad_frac=pad_frac, line_px=line_px)
    png_bytes = _img_to_png_bytes(img_rgb)

    # ── Pass 1: upright only ──────────────────────────────────────────────────
    pass1 = _run_angles(img_rgb, [0], max_new_tokens)
    p1_text = _clean(pass1[0][0])
    p1_conf = pass1[0][1]
    p1_valid = _is_valid(p1_text)

    print(
        f"[pole_ocr] pass1  rot=0  raw={pass1[0][0]!r}  cleaned={p1_text!r}  "
        f"conf={p1_conf:.3f}  valid={p1_valid}"
    )

    # Accept immediately if confident and valid
    if auto_rotate is False or (p1_valid and p1_conf >= FAST_CONF_THRESHOLD):
        if p1_valid and p1_conf >= FAST_CONF_THRESHOLD:
            print(f"[pole_ocr] -> fast-accept  text={p1_text!r}  conf={p1_conf:.3f}")
        best_text, best_conf, best_valid = p1_text, p1_conf, p1_valid
    else:
        # ── Pass 2: full 8-angle sweep ────────────────────────────────────────
        print(
            f"[pole_ocr] pass1 not confident (conf={p1_conf:.3f}, valid={p1_valid})"
            f" — running rotation sweep"
        )
        all_angles = _ROTATIONS  # [0, 45, 90, 135, 180, 225, 270, 315]
        all_raw = _run_angles(img_rgb, all_angles, max_new_tokens)
        best_text, best_conf, best_valid = _pick_best(all_angles, all_raw)

    print(
        f"[pole_ocr] -> best text={best_text!r}  conf={best_conf:.3f}  valid={best_valid}"
    )

    accepted = bool(best_text and best_conf >= min_conf and best_valid)

    return OcrResult(
        text=best_text if best_text else _clean(all_raw[0][0]),
        confidence=round(best_conf, 4),
        accepted=accepted,
        crop_png=png_bytes or None,
    )
