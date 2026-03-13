"""
pole_ocr.py — Tesseract OCR for stroked-polyline pole labels.

Renders the label segments to a clean 800×800 white-on-black image,
runs Tesseract OSD to detect if 180° rotation is needed, then reads
the text with Tesseract.

Requirements:
    pip install pytesseract opencv-python numpy Pillow
    Install Tesseract: https://github.com/UB-Mannheim/tesseract/wiki
"""

from __future__ import annotations

import math
import os
from abc import ABC, abstractmethod
from typing import Tuple, Optional

import cv2
import numpy as np

try:
    import pytesseract
    from pytesseract import Output as TessOutput
    _TESS_OK = True
except ImportError:
    _TESS_OK = False
    print("[pole_ocr] WARNING: pytesseract not installed — OCR will be skipped")

try:
    from PIL import Image
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    import torch
    _TROCR_OK = True
except ImportError:
    _TROCR_OK = False
    print("[pole_ocr] WARNING: TrOCR dependencies not installed — TrOCR OCR will be skipped")

# ── constants ────────────────────────────────────────────────────────────────

OCR_IMG_SIZE   = 800
STROKE_PX      = 6
CONF_THRESHOLD = 0.55

DEBUG_DIR: Optional[str] = None  # e.g. r"C:\Users\Vero\Downloads\pole_crops"
POLE_OCR_ENGINE = os.getenv("POLE_OCR_ENGINE", "tesseract").strip().lower()
TROCR_MODEL_NAME = os.getenv("POLE_TROCR_MODEL", "microsoft/trocr-base-printed")


# ── result ────────────────────────────────────────────────────────────────────

class PoleOcrResult:
    __slots__ = ("text", "confidence", "accepted", "crop_png")

    def __init__(self, text: str, confidence: float,
                 accepted: bool, crop_png: Optional[bytes]) -> None:
        self.text       = text
        self.confidence = confidence
        self.accepted   = accepted
        self.crop_png   = crop_png


# ── segment filtering ─────────────────────────────────────────────────────────

def _filter_segments(segments: list,
                     bbox: Tuple[float, float, float, float],
                     expand: float = 0.05) -> list:
    minx, miny, maxx, maxy = bbox
    bw = maxx - minx
    bh = maxy - miny
    x0, x1 = minx - bw * expand, maxx + bw * expand
    y0, y1 = miny - bh * expand, maxy + bh * expand
    out = []
    for s in segments:
        if hasattr(s, "x1"):
            sx1, sy1, sx2, sy2 = s.x1, s.y1, s.x2, s.y2
        elif isinstance(s, dict):
            sx1, sy1, sx2, sy2 = s["x1"], s["y1"], s["x2"], s["y2"]
        else:
            continue
        if (x0 <= sx1 <= x1 and y0 <= sy1 <= y1 and
                x0 <= sx2 <= x1 and y0 <= sy2 <= y1):
            out.append(s)
    return out


# ── rendering ────────────────────────────────────────────────────────────────

def _render(segments: list,
            bbox: Tuple[float, float, float, float],
            size: int = OCR_IMG_SIZE,
            thickness: int = STROKE_PX) -> np.ndarray:
    """Render label segments → white strokes on black background."""
    minx, miny, maxx, maxy = bbox
    bw = max(maxx - minx, 1e-9)
    bh = max(maxy - miny, 1e-9)
    m  = 0.12
    x0, xr = minx - bw * m, maxx + bw * m
    y0, yr = miny - bh * m, maxy + bh * m
    rw, rh = xr - x0, yr - y0

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
        if math.hypot(sx2 - sx1, sy2 - sy1) < 1e-9:
            continue
        cv2.line(img, to_px(sx1, sy1), to_px(sx2, sy2),
                 255, thickness=thickness, lineType=cv2.LINE_AA)

    return img  # white strokes on black


def _rot(img: np.ndarray, deg: float) -> np.ndarray:
    if abs(deg) < 0.5:
        return img
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), deg, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=0)


def _to_png(img: np.ndarray, deg: float = 0.0) -> bytes:
    """Rotate + invert to dark-on-white + encode as PNG bytes for UI display."""
    oriented = _rot(img, deg)
    inverted = cv2.bitwise_not(oriented)   # black strokes on white — same as OCR Review
    _, buf   = cv2.imencode(".png", inverted)
    return bytes(buf)


def _primary_deg(bbox: Tuple[float, float, float, float]) -> float:
    # No automatic rotation — render segments as-is.
    # Use the inline rename to correct any misread names.
    return 0.0


# ── OCR backends ──────────────────────────────────────────────────────────────


def _preprocess(img: np.ndarray) -> np.ndarray:
    """Upscale + sharpen for better Tesseract accuracy."""
    img = cv2.resize(img, (img.shape[1] * 2, img.shape[0] * 2),
                     interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(4, 4))
    img = clahe.apply(img)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    img = cv2.dilate(img, kernel, iterations=1)
    return cv2.copyMakeBorder(img, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=0)


class OcrBackend(ABC):
    @abstractmethod
    def read_text(self, image: np.ndarray) -> Tuple[str, float]:
        """Return (uppercase_text, confidence_in_0_1)."""


class TesseractBackend(OcrBackend):
    TESS_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-."
    TESS_MODES = [
        f"--psm 8 --oem 1 -c tessedit_char_whitelist={TESS_WHITELIST}",
        f"--psm 7 --oem 1 -c tessedit_char_whitelist={TESS_WHITELIST}",
        f"--psm 6 --oem 1 -c tessedit_char_whitelist={TESS_WHITELIST}",
    ]

    @staticmethod
    def _run_tess(img: np.ndarray, config: str) -> Tuple[str, float]:
        if not _TESS_OK:
            return "", 0.0
        try:
            data = pytesseract.image_to_data(img, config=config,
                                             output_type=TessOutput.DICT)
            pairs = [(w.strip(), int(c))
                     for w, c in zip(data["text"], data["conf"])
                     if w.strip() and int(c) >= 0]
            if not pairs:
                return "", 0.0
            text = "".join(w for w, _ in pairs).upper().strip()
            conf = sum(c for _, c in pairs) / len(pairs) / 100.0
            return text, conf
        except Exception:
            return "", 0.0

    def read_text(self, image: np.ndarray) -> Tuple[str, float]:
        proc = _preprocess(image)
        best_t, best_c = "", 0.0
        for cfg in self.TESS_MODES:
            t, c = self._run_tess(proc, cfg)
            if c > best_c:
                best_t, best_c = t, c
        return best_t, best_c


class TrOCRBackend(OcrBackend):
    _processor = None
    _model = None
    _device = None

    @classmethod
    def _ensure_model(cls) -> bool:
        if not _TROCR_OK:
            return False
        if cls._model is not None and cls._processor is not None:
            return True
        try:
            cls._processor = TrOCRProcessor.from_pretrained(TROCR_MODEL_NAME)
            cls._model = VisionEncoderDecoderModel.from_pretrained(TROCR_MODEL_NAME)
            cls._device = "cuda" if torch.cuda.is_available() else "cpu"
            cls._model.to(cls._device)
            cls._model.eval()
            return True
        except Exception as exc:
            print(f"[pole_ocr] WARNING: failed to initialize TrOCR ({exc})")
            cls._processor = None
            cls._model = None
            cls._device = None
            return False

    def read_text(self, image: np.ndarray) -> Tuple[str, float]:
        if not self._ensure_model():
            return "", 0.0
        try:
            rgb = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
            pil_image = Image.fromarray(rgb)
            pixel_values = self._processor(images=pil_image, return_tensors="pt").pixel_values
            pixel_values = pixel_values.to(self._device)
            with torch.no_grad():
                generated = self._model.generate(
                    pixel_values,
                    return_dict_in_generate=True,
                    output_scores=True,
                )
            decoded = self._processor.batch_decode(
                generated.sequences,
                skip_special_tokens=True,
            )
            text = (decoded[0] if decoded else "").upper().strip()
            conf = 0.0
            if getattr(generated, "scores", None):
                token_probs = []
                for score_tensor, token_id in zip(generated.scores, generated.sequences[0][1:]):
                    probs = torch.softmax(score_tensor[0], dim=-1)
                    token_probs.append(float(probs[token_id].item()))
                if token_probs:
                    conf = float(sum(token_probs) / len(token_probs))
            return text, conf
        except Exception as exc:
            print(f"[pole_ocr] WARNING: TrOCR inference failed ({exc})")
            return "", 0.0


_TESSERACT_BACKEND = TesseractBackend()
_TROCR_BACKEND = TrOCRBackend()


def _select_backend() -> Tuple[str, OcrBackend]:
    engine = POLE_OCR_ENGINE
    if engine == "trocr":
        return "trocr", _TROCR_BACKEND
    if engine != "tesseract":
        print(f"[pole_ocr] WARNING: unknown POLE_OCR_ENGINE '{engine}', falling back to tesseract")
    return "tesseract", _TESSERACT_BACKEND


# ── debug ────────────────────────────────────────────────────────────────────

def _debug_save(pole_id: int, png_bytes: bytes,
                text: str, conf: float) -> None:
    if not DEBUG_DIR:
        return
    try:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        label = f"{text or 'NONE'}_{int(conf * 100)}pct"
        with open(os.path.join(DEBUG_DIR, f"p{pole_id:03d}_{label}.png"), "wb") as f:
            f.write(png_bytes)
    except Exception as e:
        print(f"[pole_ocr debug] {e}")


_counter = 0


# ── public API ────────────────────────────────────────────────────────────────

def ocr_pole(
    segments: list,
    bbox: Tuple[float, float, float, float],
    conf_threshold: float = CONF_THRESHOLD,
) -> PoleOcrResult:
    """
    OCR one stroked-polyline pole label using the selected OCR backend.

    segments  - full layer segment list (filtered to bbox internally)
    bbox      - (minx, miny, maxx, maxy) in DXF coordinates
    """
    global _counter
    _counter += 1
    pole_id = _counter

    # 1. Filter segments to bbox
    tight = _filter_segments(segments, bbox, expand=0.05)
    if len(tight) < 3:
        tight = _filter_segments(segments, bbox, expand=0.30)
    raw = _render(tight, bbox)

    # 2. Primary orientation from bbox aspect ratio
    base_deg = _primary_deg(bbox)

    # 3. Build display PNG (black strokes on white — same as OCR Review tab)
    crop_png = _to_png(raw, base_deg)

    # 4. Read with selected OCR backend
    backend_name, backend = _select_backend()
    ocr_input = cv2.bitwise_not(_rot(raw, base_deg))
    text, conf = backend.read_text(ocr_input)

    _debug_save(pole_id, crop_png, text, conf)
    print(f"[pole_ocr] #{pole_id:03d} [{backend_name}] → '{text}' conf={conf:.2f}")

    accepted = bool(text) and conf >= conf_threshold

    return PoleOcrResult(
        text       = text,
        confidence = round(conf, 4),
        accepted   = accepted,
        crop_png   = crop_png,
    )
