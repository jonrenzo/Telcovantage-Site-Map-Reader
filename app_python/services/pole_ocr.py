"""
app_python/services/pole_ocr.py
────────────────────────────────
OCR for stroked (hand-drawn) pole ID labels using TrOCR.

Model: microsoft/trocr-base-printed
  - ViT image encoder + RoBERTa text decoder
  - Designed for printed/handwritten single-line text on a white background
  - ~334 MB download on first use, cached by HuggingFace in ~/.cache/huggingface

Call surface (unchanged from prior Tesseract version):
    result = ocr_pole(segments, bbox)
    result.text        → str  (recognised text, cleaned)
    result.confidence  → float  (0.0 – 1.0, mean per-token probability)
    result.accepted    → bool  (passes pole-ID regex + confidence gate)
    result.crop_png    → bytes | None  (PNG of the rendered crop)
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np

# ── lazy imports – loaded once on first call ──────────────────────────────────
_processor = None
_model = None
_device = None

# ── constants ─────────────────────────────────────────────────────────────────

MODEL_ID = "microsoft/trocr-base-printed"

# Image rasterisation
CROP_PX = 192  # output image size (square)
PAD_FRAC = 0.18  # padding as fraction of bbox dimension
LINE_PX = 4  # stroke thickness in pixels

# Acceptance gate
MIN_CONF = 0.60  # minimum mean token confidence to accept
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


def _load_model():
    global _processor, _model, _device

    if _model is not None:
        return

    import torch
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[pole_ocr] Loading TrOCR ({MODEL_ID}) on {_device} …")

    _processor = TrOCRProcessor.from_pretrained(MODEL_ID)
    _model = VisionEncoderDecoderModel.from_pretrained(MODEL_ID)
    _model.to(_device)
    _model.eval()

    print("[pole_ocr] TrOCR ready.")


# ── rasterisation helpers ─────────────────────────────────────────────────────


def _to_segs(raw_segments) -> List[_Seg]:
    """Accept either _Seg-like objects or dicts with x1/y1/x2/y2 keys."""
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
    Render stroked segments into a white-background, black-ink RGB image
    suitable for TrOCR (which expects printed text on a white background).

    Returns: uint8 ndarray (out_px, out_px, 3)
    """
    import cv2  # already in requirements via main pipeline

    minx, miny, maxx, maxy = bbox
    w = maxx - minx
    h = maxy - miny

    # Expand bbox by padding
    px = max(pad_frac * w, 1e-9)
    py = max(pad_frac * h, 1e-9)
    minx -= px
    maxx += px
    miny -= py
    maxy += py
    w2 = maxx - minx
    h2 = maxy - miny

    # White background (3-channel so TrOCR gets RGB)
    img = np.full((out_px, out_px, 3), 255, dtype=np.uint8)

    def to_px(x: float, y: float):
        px_ = int(round((x - minx) / w2 * (out_px - 1)))
        py_ = int(round((1.0 - (y - miny) / h2) * (out_px - 1)))
        return px_, py_

    # Draw black strokes
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


def _img_to_pil(img: np.ndarray):
    """Convert BGR numpy array to PIL RGB Image."""
    from PIL import Image

    # cv2 gives BGR; TrOCR expects RGB
    rgb = img[:, :, ::-1]
    return Image.fromarray(rgb, mode="RGB")


# ── confidence extraction ─────────────────────────────────────────────────────


def _decode_with_confidence(
    pixel_values, max_new_tokens: int = 16
) -> Tuple[str, float]:
    """
    Run TrOCR and return (text, mean_token_confidence).

    We use generate() with output_scores=True so we can read per-token
    softmax probabilities and average them as a confidence proxy.
    """
    import torch

    with torch.no_grad():
        out = _model.generate(
            pixel_values,
            max_new_tokens=max_new_tokens,
            output_scores=True,
            return_dict_in_generate=True,
        )

    # Decode text
    token_ids = out.sequences[0]
    text = _processor.tokenizer.decode(token_ids, skip_special_tokens=True)

    # Mean per-token probability (geometric mean of softmax maxima)
    if out.scores:
        probs = []
        for score_tensor in out.scores:
            p = torch.softmax(score_tensor[0], dim=-1)
            probs.append(float(p.max().item()))
        confidence = float(np.mean(probs))
    else:
        confidence = 0.0

    return text.strip(), confidence


# ── public API ────────────────────────────────────────────────────────────────


def _clean(text: str) -> str:
    """Strip whitespace and common OCR noise characters."""
    text = text.strip()
    # Remove leading/trailing punctuation that TrOCR sometimes hallucinates
    text = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", text)
    return text.upper()


def ocr_pole(
    segments,
    bbox: Tuple[float, float, float, float],
    *,
    min_conf: float = MIN_CONF,
    crop_px: int = CROP_PX,
    pad_frac: float = PAD_FRAC,
    line_px: int = LINE_PX,
    max_new_tokens: int = 16,
) -> OcrResult:
    """
    Rasterise the stroked segments inside `bbox` and run TrOCR.

    Parameters
    ----------
    segments  : iterable of Seg-like objects or dicts with x1/y1/x2/y2
    bbox      : (minx, miny, maxx, maxy) in DXF world coordinates
    min_conf  : minimum mean token confidence to mark result as accepted
    crop_px   : pixel size of the square crop image
    pad_frac  : padding fraction around bbox
    line_px   : stroke thickness for rasterisation
    max_new_tokens : max tokens to generate (pole IDs are short)

    Returns
    -------
    OcrResult with .text, .confidence, .accepted, .crop_png
    """
    _load_model()

    segs = _to_segs(segments)

    # Filter segments to only those inside or near the bbox
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

    # Rasterise
    img_np = _rasterise(segs, bbox, out_px=crop_px, pad_frac=pad_frac, line_px=line_px)
    pil_img = _img_to_pil(img_np)
    png_bytes = _img_to_png_bytes(img_np)

    # Run TrOCR
    import torch

    pixel_values = _processor(images=pil_img, return_tensors="pt").pixel_values
    pixel_values = pixel_values.to(_device)

    raw_text, confidence = _decode_with_confidence(
        pixel_values, max_new_tokens=max_new_tokens
    )
    cleaned = _clean(raw_text)

    # Accept only strings that look like valid pole IDs and meet confidence gate
    accepted = bool(cleaned and confidence >= min_conf and _POLEID_RE.match(cleaned))

    return OcrResult(
        text=cleaned if cleaned else raw_text.strip(),
        confidence=round(confidence, 4),
        accepted=accepted,
        crop_png=png_bytes or None,
    )
