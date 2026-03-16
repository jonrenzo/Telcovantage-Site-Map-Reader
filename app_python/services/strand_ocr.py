"""
app_python/services/strand_ocr.py
──────────────────────────────────
TrOCR-based OCR for strand digit clusters — optimised for speed.

Model: microsoft/trocr-base-handwritten

Performance approach
────────────────────
The old code ran TrOCR once per crop × once per rotation = N×4 sequential
forward passes.  This version collects ALL crops × ALL rotations into a
single batched generate() call, reducing wall time by ~4-8× on CPU.

Batch API (used by server.py):
    results = ocr_strand_batch(crops)          # list of uint8 grayscale arrays
    for text, conf in results: ...

Single-crop API (unchanged call surface):
    text, conf = ocr_strand_crop(crop_np)

Auto-rotation (PSM-0 equivalent)
─────────────────────────────────
All four 90° rotations of every crop are tried in one batched pass.
Best result per crop is selected by:
  1. Valid strand regex match preferred over non-match
  2. Highest confidence among equally-valid candidates
  3. Tie-break: 0° (upright) preferred
"""

from __future__ import annotations

import re
from typing import List, Tuple

import numpy as np

# ── lazy singletons ───────────────────────────────────────────────────────────
_processor = None
_model = None
_device = None

# ── constants ─────────────────────────────────────────────────────────────────
MODEL_ID = "microsoft/trocr-base-handwritten"

# 128 px is sufficient for simple 1-4 digit stroked numbers.
# (384 was over-engineered for this use case and slowed the ViT encoder 9x.)
TROCR_SIZE = 128

# Maximum images per generate() call.
# 32 works comfortably on 8 GB RAM; reduce to 16 if you hit OOM.
BATCH_SIZE = 32

# Confidence gate
MIN_CONF = 0.60

# Strand values: 1-4 digits, optional decimal
_STRAND_RE = re.compile(r"^\d{1,4}(?:\.\d{1,2})?$")

# Rotations to try. 0 is first so it wins tie-breaks.
_ROTATIONS = [0, 90, 180, 270]


# ── model loader (singleton) ──────────────────────────────────────────────────


def _load_model() -> None:
    global _processor, _model, _device

    if _model is not None:
        return

    import torch
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[strand_ocr] Loading TrOCR ({MODEL_ID}) on {_device} ...")

    _processor = TrOCRProcessor.from_pretrained(MODEL_ID)
    _model = VisionEncoderDecoderModel.from_pretrained(MODEL_ID)
    _model.to(_device)
    _model.eval()

    print("[strand_ocr] TrOCR ready.")


# ── image preparation ─────────────────────────────────────────────────────────


def _to_pil(crop_np: np.ndarray, rotation_deg: int = 0):
    """
    Invert a render_crop() grayscale image (white-on-black to black-on-white),
    apply rotation, resize to TROCR_SIZE, and convert to RGB PIL image.
    """
    import cv2
    from PIL import Image

    inverted = cv2.bitwise_not(crop_np)

    if rotation_deg == 90:
        inverted = cv2.rotate(inverted, cv2.ROTATE_90_CLOCKWISE)
    elif rotation_deg == 180:
        inverted = cv2.rotate(inverted, cv2.ROTATE_180)
    elif rotation_deg == 270:
        inverted = cv2.rotate(inverted, cv2.ROTATE_90_COUNTERCLOCKWISE)

    resized = cv2.resize(
        inverted, (TROCR_SIZE, TROCR_SIZE), interpolation=cv2.INTER_CUBIC
    )
    rgb = cv2.cvtColor(resized, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(rgb, mode="RGB")


# ── post-processing ───────────────────────────────────────────────────────────


def _clean(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^[^0-9]+|[^0-9.]+$", "", text)
    subs = {
        "O": "0",
        "o": "0",
        "l": "1",
        "I": "1",
        "S": "5",
        "s": "5",
        "B": "8",
        "G": "6",
        "g": "6",
        "Z": "2",
        "z": "2",
    }
    return "".join(subs.get(ch, ch) for ch in text)


def _is_valid(text: str) -> bool:
    return bool(text and _STRAND_RE.match(text))


# ── batched generate + confidence ─────────────────────────────────────────────


def _generate_batch(pixel_values, max_new_tokens: int = 6) -> List[Tuple[str, float]]:
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

    # out.sequences: (batch, seq_len)
    # out.scores:    tuple of (batch, vocab) tensors, one per generated token
    batch_size = pixel_values.shape[0]
    results = []

    for b in range(batch_size):
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


# ── public batch API ──────────────────────────────────────────────────────────


def ocr_strand_batch(
    crops: List[np.ndarray],
    *,
    auto_rotate: bool = True,
    batch_size: int = BATCH_SIZE,
    max_new_tokens: int = 6,
) -> List[Tuple[str, float]]:
    """
    Run TrOCR on a list of strand digit crops in one (or a few) batched
    generate() calls — much faster than calling ocr_strand_crop() in a loop.

    Parameters
    ----------
    crops        : list of uint8 grayscale ndarrays (render_crop format,
                   white strokes on black background)
    auto_rotate  : try all 4 rotations and pick the best (default True)
    batch_size   : max images per generate() call
    max_new_tokens: token budget per image (6 covers "9999.9")

    Returns
    -------
    List of (text, confidence) tuples, one per input crop.
    """
    if not crops:
        return []

    _load_model()

    rotations = _ROTATIONS if auto_rotate else [0]
    n = len(crops)
    n_rot = len(rotations)

    # ── Build all PIL images: n_crops x n_rotations ───────────────────────────
    # Layout: [crop0_rot0, crop0_rot1, ..., crop1_rot0, crop1_rot1, ...]
    all_pils = [_to_pil(crop, rot) for crop in crops for rot in rotations]

    # ── Run in sub-batches to cap memory ──────────────────────────────────────
    all_raw: List[Tuple[str, float]] = []
    total = len(all_pils)

    for start in range(0, total, batch_size):
        chunk = all_pils[start : start + batch_size]
        pixel_values = _processor(images=chunk, return_tensors="pt").pixel_values
        pixel_values = pixel_values.to(_device)
        all_raw.extend(_generate_batch(pixel_values, max_new_tokens))

    # ── Select best rotation per crop ─────────────────────────────────────────
    final: List[Tuple[str, float]] = []

    for i in range(n):
        best_text = ""
        best_conf = -1.0
        best_valid = False

        for j, rot in enumerate(rotations):
            raw_text, confidence = all_raw[i * n_rot + j]
            cleaned = _clean(raw_text)
            valid = _is_valid(cleaned)

            print(
                f"[strand_ocr] crop={i:>4}  rot={rot:>3}  "
                f"raw={raw_text!r:>10}  cleaned={cleaned!r:>7}  "
                f"conf={confidence:.3f}  valid={valid}"
            )

            # A valid match always beats an invalid one
            if valid and not best_valid:
                best_text, best_conf, best_valid = cleaned, confidence, True
            # Among same validity class, higher confidence wins
            elif valid == best_valid and confidence > best_conf:
                best_text, best_conf = cleaned, confidence

        # If nothing was valid, return empty string with the best raw confidence
        if not best_text:
            best_conf = max(all_raw[i * n_rot + j][1] for j in range(n_rot))

        final.append((best_text, round(best_conf, 4)))

    return final


# ── single-crop API (unchanged call surface) ──────────────────────────────────


def ocr_strand_crop(
    crop_np: np.ndarray,
    *,
    min_conf: float = MIN_CONF,
    auto_rotate: bool = True,
) -> Tuple[str, float]:
    """
    Run TrOCR on a single strand digit cluster crop.
    Delegates to ocr_strand_batch() internally for consistency.
    """
    results = ocr_strand_batch([crop_np], auto_rotate=auto_rotate)
    return results[0]


def is_confident(conf: float, min_conf: float = MIN_CONF) -> bool:
    """True if confidence is at or above the acceptance threshold."""
    return conf >= min_conf
