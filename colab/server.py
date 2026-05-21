"""
colab/server.py — Standalone TrOCR GPU inference server for Google Colab.

Endpoints:
  POST /ocr/pole    — Run TrOCR-printed on stroked pole label geometry
  POST /ocr/strand  — Run TrOCR-handwritten on digit cluster crops
  GET  /health      — Device and model status

Usage (in Colab):
  pip install fastapi uvicorn pyngrok
  python colab/server.py &
  ngrok.forward(8000)
"""

from __future__ import annotations

import io
import math
import re
import base64
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="TrOCR GPU Server")

# ── lazy model singletons ──────────────────────────────────────────────────────
_printed_processor = None
_printed_model = None
_handwritten_processor = None
_handwritten_model = None
_device = None

# ── constants (mirrors pole_ocr.py + strand_ocr.py) ────────────────────────────
POLE_MODEL_ID = "microsoft/trocr-base-printed"
STRAND_MODEL_ID = "microsoft/trocr-base-handwritten"

POLE_CROP_PX = 192
POLE_PAD_FRAC = 0.18
POLE_LINE_PX = 4
POLE_MIN_CONF = 0.60
POLE_BATCH_SIZE = 16
POLE_MAX_TOKENS = 16
POLE_ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315]
POLE_FAST_CONF_THRESHOLD = 0.95
_POLEID_RE = re.compile(r"^(?:NPT|[A-Z]{0,2}\d+(?:-\d+)?)$", re.IGNORECASE)

STRAND_TROCR_SIZE = 128
STRAND_BATCH_SIZE = 32
STRAND_MIN_CONF = 0.60
STRAND_ROTATIONS = [0, 90, 180, 270]
_STRAND_RE = re.compile(r"^\d{1,4}(?:\.\d{1,2})?$")

# ── data structures ────────────────────────────────────────────────────────────


class _Seg:
    __slots__ = ("x1", "y1", "x2", "y2")
    def __init__(self, x1, y1, x2, y2):
        self.x1, self.y1, self.x2, self.y2 = x1, y1, x2, y2
    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)


@dataclass
class OcrResult:
    text: str
    confidence: float
    accepted: bool
    crop_png: Optional[str] = None  # base64-encoded PNG


# ── request/response models ────────────────────────────────────────────────────


class PoleOcrRequest(BaseModel):
    segments: list
    bbox: list
    min_conf: float = POLE_MIN_CONF
    crop_px: int = POLE_CROP_PX
    pad_frac: float = POLE_PAD_FRAC
    line_px: int = POLE_LINE_PX
    auto_rotate: bool = True


class StrandOcrRequest(BaseModel):
    crops: list  # list of base64-encoded PNG bytes
    auto_rotate: bool = True


class OcrResponse(BaseModel):
    text: str
    confidence: float
    accepted: bool
    crop_png: Optional[str] = None


class StrandOcrResponse(BaseModel):
    results: list  # list of [text, confidence]


class HealthResponse(BaseModel):
    status: str
    device: str
    pole_model_loaded: bool
    strand_model_loaded: bool


# ── model loaders ──────────────────────────────────────────────────────────────


def _ensure_device():
    global _device
    if _device is not None:
        return
    import torch
    if torch.cuda.is_available():
        _device = "cuda"
        print(f"[server] CUDA available: {torch.cuda.get_device_name(0)}")
    else:
        _device = "cpu"
        print("[server] WARNING: No CUDA — running on CPU (slow in Colab!)")


def _load_pole_model():
    global _printed_processor, _printed_model
    if _printed_model is not None:
        return
    _ensure_device()
    import torch
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    print(f"[server] Loading {POLE_MODEL_ID} on {_device} ...")
    _printed_processor = TrOCRProcessor.from_pretrained(POLE_MODEL_ID)
    _printed_model = VisionEncoderDecoderModel.from_pretrained(
        POLE_MODEL_ID, low_cpu_mem_usage=False, ignore_mismatched_sizes=True
    )
    _printed_model.to(_device)
    _printed_model.eval()
    print("[server] Pole TrOCR ready.")


def _load_strand_model():
    global _handwritten_processor, _handwritten_model
    if _handwritten_model is not None:
        return
    _ensure_device()
    import torch
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    print(f"[server] Loading {STRAND_MODEL_ID} on {_device} ...")
    _handwritten_processor = TrOCRProcessor.from_pretrained(STRAND_MODEL_ID)
    _handwritten_model = VisionEncoderDecoderModel.from_pretrained(STRAND_MODEL_ID)
    _handwritten_model.to(_device)
    _handwritten_model.eval()
    print("[server] Strand TrOCR ready.")


# ── pole OCR helpers (mirrors pole_ocr.py) ─────────────────────────────────────


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
    out_px: int = POLE_CROP_PX,
    pad_frac: float = POLE_PAD_FRAC,
    line_px: int = POLE_LINE_PX,
) -> np.ndarray:
    minx, miny, maxx, maxy = bbox
    w = maxx - minx
    h = maxy - miny
    px = max(pad_frac * w, 1e-9)
    py = max(pad_frac * h, 1e-9)
    minx -= px; maxx += px; miny -= py; maxy += py
    w2 = maxx - minx; h2 = maxy - miny
    img = np.full((out_px, out_px, 3), 255, dtype=np.uint8)

    def to_px(x: float, y: float):
        return int(round((x - minx) / w2 * (out_px - 1))), \
               int(round((1.0 - (y - miny) / h2) * (out_px - 1)))

    for s in segments:
        if s.length() <= 1e-9: continue
        cv2.line(img, to_px(s.x1, s.y1), to_px(s.x2, s.y2), (0, 0, 0), thickness=line_px, lineType=cv2.LINE_AA)
    return img


def _img_to_pil(img_rgb: np.ndarray, rotation_deg: float = 0):
    from PIL import Image as PILImage
    deg = int(rotation_deg) % 360
    if deg == 0:
        return PILImage.fromarray(img_rgb, mode="RGB")
    if deg == 90:
        return PILImage.fromarray(cv2.rotate(img_rgb, cv2.ROTATE_90_CLOCKWISE), mode="RGB")
    if deg == 180:
        return PILImage.fromarray(cv2.rotate(img_rgb, cv2.ROTATE_180), mode="RGB")
    if deg == 270:
        return PILImage.fromarray(cv2.rotate(img_rgb, cv2.ROTATE_90_COUNTERCLOCKWISE), mode="RGB")
    pil = PILImage.fromarray(img_rgb, mode="RGB")
    return pil.rotate(-deg, resample=PILImage.BILINEAR, expand=True, fillcolor=(255, 255, 255))


def _generate_batch(model, processor, pixel_values, max_new_tokens: int):
    import torch
    import torch.nn.functional as F
    with torch.no_grad():
        out = model.generate(
            pixel_values, max_new_tokens=max_new_tokens,
            output_scores=True, return_dict_in_generate=True,
        )
    results = []
    for b in range(pixel_values.shape[0]):
        token_ids = out.sequences[b]
        text = processor.tokenizer.decode(token_ids, skip_special_tokens=True).strip()
        if out.scores:
            probs = [float(F.softmax(step[b], dim=-1).max().item()) for step in out.scores]
            conf = float(np.mean(probs))
        else:
            conf = 0.0
        results.append((text, conf))
    return results


def _run_angles(model, processor, img_rgb: np.ndarray, angles: list, max_new_tokens: int, batch_size: int):
    from PIL import Image as PILImage
    pils = [_img_to_pil(img_rgb, a) for a in angles]
    all_raw = []
    for start in range(0, len(pils), batch_size):
        chunk = pils[start:start + batch_size]
        pixel_values = processor(images=chunk, return_tensors="pt").pixel_values.to(_device)
        all_raw.extend(_generate_batch(model, processor, pixel_values, max_new_tokens))
    return all_raw


# ── pole OCR post-processing ──────────────────────────────────────────────────

_PREFIX_SUBS = {"1": "T", "l": "T", "L": "T", "I": "T", "7": "T", "|": "T"}


def _clean(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", text)
    return text.upper()


def _is_valid(text: str) -> bool:
    return bool(text and _POLEID_RE.match(text))


def _fix_pole_id(text: str) -> str:
    if not text: return text
    if text[0] in _PREFIX_SUBS:
        candidate = _PREFIX_SUBS[text[0]] + text[1:]
        if _is_valid(candidate):
            return candidate
    if _is_valid(text): return text
    mid_subs = {"0": "O", "O": "0", "1": "I", "I": "1", "5": "S", "S": "5"}
    for i, ch in enumerate(text):
        if i == 0: continue
        if ch in mid_subs:
            candidate = text[:i] + mid_subs[ch] + text[i + 1:]
            if _is_valid(candidate): return candidate
    return text


# ── strand OCR helpers (mirrors strand_ocr.py) ────────────────────────────────


def _to_pil(crop_bytes: bytes, rotation_deg: int = 0):
    from PIL import Image as PILImage
    nparr = np.frombuffer(crop_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
    inverted = cv2.bitwise_not(img)
    if rotation_deg == 90:
        inverted = cv2.rotate(inverted, cv2.ROTATE_90_CLOCKWISE)
    elif rotation_deg == 180:
        inverted = cv2.rotate(inverted, cv2.ROTATE_180)
    elif rotation_deg == 270:
        inverted = cv2.rotate(inverted, cv2.ROTATE_90_COUNTERCLOCKWISE)
    resized = cv2.resize(inverted, (STRAND_TROCR_SIZE, STRAND_TROCR_SIZE), interpolation=cv2.INTER_CUBIC)
    rgb = cv2.cvtColor(resized, cv2.COLOR_GRAY2RGB)
    return PILImage.fromarray(rgb, mode="RGB")


def _strand_clean(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^[^0-9]+|[^0-9.]+$", "", text)
    subs = {"O": "0", "o": "0", "l": "1", "I": "1", "S": "5", "s": "5", "B": "8", "G": "6", "g": "6", "Z": "2", "z": "2"}
    return "".join(subs.get(ch, ch) for ch in text)


def _strand_is_valid(text: str) -> bool:
    return bool(text and _STRAND_RE.match(text))


# ── endpoints ──────────────────────────────────────────────────────────────────


@app.post("/ocr/pole", response_model=OcrResponse)
def ocr_pole_endpoint(req: PoleOcrRequest):
    _load_pole_model()
    segs = _to_segs(req.segments)
    bbox = tuple(req.bbox)
    minx, miny, maxx, maxy = bbox
    margin = max((maxx - minx), (maxy - miny)) * 0.5
    segs = [s for s in segs if not (
        max(s.x1, s.x2) < minx - margin or min(s.x1, s.x2) > maxx + margin
        or max(s.y1, s.y2) < miny - margin or min(s.y1, s.y2) > maxy + margin
    )]
    img_rgb = _rasterise(segs, bbox, out_px=req.crop_px, pad_frac=req.pad_frac, line_px=req.line_px)

    # Encode crop PNG as base64
    ok, buf = cv2.imencode(".png", img_rgb)
    crop_b64 = base64.b64encode(bytes(buf)).decode("ascii") if ok else None

    # Pass 1: upright only
    pass1 = _run_angles(_printed_model, _printed_processor, img_rgb, [0], POLE_MAX_TOKENS, POLE_BATCH_SIZE)
    p1_text = _fix_pole_id(_clean(pass1[0][0]))
    p1_conf = pass1[0][1]
    p1_valid = _is_valid(p1_text)

    if not req.auto_rotate or (p1_valid and p1_conf >= POLE_FAST_CONF_THRESHOLD):
        best_text, best_conf, best_valid = p1_text, p1_conf, p1_valid
    else:
        all_raw = _run_angles(_printed_model, _printed_processor, img_rgb, POLE_ROTATIONS, POLE_MAX_TOKENS, POLE_BATCH_SIZE)
        best_text = ""; best_conf = -1.0; best_valid = False
        for rot, (raw_text, confidence) in zip(POLE_ROTATIONS, all_raw):
            cleaned = _fix_pole_id(_clean(raw_text))
            valid = _is_valid(cleaned)
            if valid and not best_valid:
                best_text, best_conf, best_valid = cleaned, confidence, True
            elif valid == best_valid and confidence > best_conf:
                best_text, best_conf = cleaned, confidence
        if not best_text:
            best_conf = max(r[1] for r in all_raw) if all_raw else 0.0

    accepted = bool(best_text and best_conf >= req.min_conf and best_valid)
    return OcrResponse(text=best_text, confidence=round(best_conf, 4), accepted=accepted, crop_png=crop_b64)


@app.post("/ocr/strand", response_model=StrandOcrResponse)
def ocr_strand_endpoint(req: StrandOcrRequest):
    _load_strand_model()
    rotations = STRAND_ROTATIONS if req.auto_rotate else [0]
    n = len(req.crops)
    n_rot = len(rotations)

    # Decode all base64 crops → PIL images for all rotations
    all_pils = []
    for b64_str in req.crops:
        crop_bytes = base64.b64decode(b64_str)
        for rot in rotations:
            all_pils.append(_to_pil(crop_bytes, rot))

    # Run batched inference
    all_raw = []
    for start in range(0, len(all_pils), STRAND_BATCH_SIZE):
        chunk = all_pils[start:start + STRAND_BATCH_SIZE]
        pixel_values = _handwritten_processor(images=chunk, return_tensors="pt").pixel_values.to(_device)
        all_raw.extend(_generate_batch(_handwritten_model, _handwritten_processor, pixel_values, 6))

    # Select best per crop
    final = []
    for i in range(n):
        best_text = ""; best_conf = -1.0; best_valid = False
        for j, rot in enumerate(rotations):
            raw_text, confidence = all_raw[i * n_rot + j]
            cleaned = _strand_clean(raw_text)
            valid = _strand_is_valid(cleaned)
            if valid and not best_valid:
                best_text, best_conf, best_valid = cleaned, confidence, True
            elif valid == best_valid and confidence > best_conf:
                best_text, best_conf = cleaned, confidence
        if not best_text:
            best_conf = max(all_raw[i * n_rot + j][1] for j in range(n_rot))
        final.append([best_text, round(best_conf, 4)])

    return StrandOcrResponse(results=final)


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        device=_device or "not initialized",
        pole_model_loaded=_printed_model is not None,
        strand_model_loaded=_handwritten_model is not None,
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
