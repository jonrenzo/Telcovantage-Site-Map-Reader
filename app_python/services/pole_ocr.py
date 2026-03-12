"""
pole_ocr.py — Free local OCR for stroked-polyline pole labels.

Primary:  Ollama + moondream2 (free local vision model, no API key)
Fallback: Tesseract (if Ollama is not running)

Setup (one-time):
    1. Install Ollama:  https://ollama.com/download
    2. Pull the model:  ollama pull moondream
    3. Ollama runs as a background service automatically after install.

No API keys. No internet required after setup.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
import urllib.request
import urllib.error
from typing import Tuple, Optional, List

import cv2
import numpy as np

# Optional Tesseract fallback
try:
    import pytesseract
    from pytesseract import Output as TessOutput
    _TESS_OK = True
except ImportError:
    _TESS_OK = False

# ── constants ────────────────────────────────────────────────────────────────

OCR_IMG_SIZE   = 400
STROKE_PX      = 4
CONF_THRESHOLD = 0.55

OLLAMA_URL     = "http://localhost:11434/api/generate"
OLLAMA_MODEL   = "moondream:1.8b"

TESS_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-."
TESS_MODES     = [
    f"--psm 8 --oem 1 -c tessedit_char_whitelist={TESS_WHITELIST}",
    f"--psm 7 --oem 1 -c tessedit_char_whitelist={TESS_WHITELIST}",
    f"--psm 6 --oem 1 -c tessedit_char_whitelist={TESS_WHITELIST}",
]

DEBUG_DIR: Optional[str] = None  # e.g. r"C:\Users\Vero\Downloads\pole_crops"


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
    """Keep only segments whose both endpoints are within the expanded bbox."""
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
    """Render label segments → white-on-black uint8 image."""
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

    return img


def _rot(img: np.ndarray, deg: float) -> np.ndarray:
    if abs(deg) < 0.5:
        return img
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), deg, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=0)


def _detect_rotation(img: np.ndarray,
                     bbox: Tuple[float, float, float, float]) -> float:
    """
    Detect the rotation needed to make text upright.

    Strategy:
      1. Try Tesseract OSD (--psm 0) — accurate when it works.
      2. Fall back to bbox aspect ratio: portrait bbox → 90°.

    Returns degrees to rotate CCW.
    """
    # Try OSD first
    if _TESS_OK:
        try:
            inverted = cv2.bitwise_not(img)
            scaled   = cv2.resize(inverted, (600, 600),
                                  interpolation=cv2.INTER_CUBIC)
            osd      = pytesseract.image_to_osd(
                scaled, config="--psm 0 --oem 0"
            )
            match = re.search(r"Rotate:\s*(\d+)", osd)
            if match:
                return float(int(match.group(1)))
        except Exception:
            pass

    # Fallback: portrait bbox → 90°
    minx, miny, maxx, maxy = bbox
    return 90.0 if (maxy - miny) > (maxx - minx) * 1.1 else 0.0


def _make_display_png(raw: np.ndarray, deg: float) -> bytes:
    """Upright, dark-on-white PNG for the UI and moondream."""
    oriented = _rot(raw, deg)
    inverted = cv2.bitwise_not(oriented)
    _, buf   = cv2.imencode(".png", inverted)
    return bytes(buf)


# ── Ollama moondream ──────────────────────────────────────────────────────────

MOONDREAM_PROMPT = (
    "Read the alphanumeric code in this image. "
    "It is a pole ID from a cable network engineering drawing, "
    "drawn as thick black strokes on a white background. "
    "The code contains only uppercase letters, digits, and hyphens "
    "(example formats: S6-131, T7-234, CC435-A04, NPT-05, 17-232). "
    "Reply with only the code, nothing else. "
    "If unreadable, reply: UNREADABLE"
)


def _ollama_available() -> bool:
    """Quick check — is Ollama running locally?"""
    try:
        req = urllib.request.Request(
            "http://localhost:11434/api/tags",
            method="GET"
        )
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            return resp.status == 200
    except Exception:
        return False


def _warmup_model() -> None:
    """
    Load the model into memory before the scan loop starts.
    First call to a vision model can take 10-30s while the weights
    load from disk. Warming up once means every subsequent call is fast.
    """
    print(f"[pole_ocr] Loading {OLLAMA_MODEL} into memory (one-time warmup)...")
    payload = json.dumps({
        "model":  OLLAMA_MODEL,
        "prompt": "hi",
        "stream": False,
        # keep_alive=600 keeps the model loaded for 10 minutes
        "keep_alive": 600,
    }).encode("utf-8")
    try:
        req = urllib.request.Request(
            OLLAMA_URL,
            data    = payload,
            headers = {"Content-Type": "application/json"},
            method  = "POST",
        )
        # Allow up to 60s for the initial model load
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
        print(f"[pole_ocr] {OLLAMA_MODEL} ready.")
    except Exception as e:
        print(f"[pole_ocr] Warmup failed: {e}")


def _call_ollama(png_bytes: bytes) -> Tuple[str, float]:
    """Send image to local Ollama moondream, return (text, conf)."""
    b64 = base64.standard_b64encode(png_bytes).decode("ascii")
    payload = json.dumps({
        "model":    OLLAMA_MODEL,
        "prompt":   MOONDREAM_PROMPT,
        "images":   [b64],
        "stream":   False,
        # Keep model loaded between calls — critical for scan performance
        "keep_alive": 600,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            OLLAMA_URL,
            data    = payload,
            headers = {"Content-Type": "application/json"},
            method  = "POST",
        )
        # 60s per call — after warmup each call should be 1-3s
        with urllib.request.urlopen(req, timeout=60) as resp:
            data     = json.loads(resp.read().decode("utf-8"))
            response = data.get("response", "").strip().upper()

            if not response or response == "UNREADABLE":
                return "", 0.0

            # Clean to valid pole ID characters only
            cleaned = re.sub(r"[^A-Z0-9\-\.]", "", response)
            if not cleaned:
                return "", 0.0

            # Confidence heuristic: pattern match = high conf
            has_pattern = bool(re.match(r"^[A-Z0-9]{1,6}-[A-Z0-9]{1,6}$", cleaned))
            conf = 0.85 if has_pattern else 0.65
            return cleaned, conf

    except urllib.error.URLError:
        return "", 0.0
    except Exception as e:
        print(f"[pole_ocr] Ollama error: {e}")
        return "", 0.0


# ── Tesseract fallback ────────────────────────────────────────────────────────

def _preprocess_tess(img: np.ndarray) -> np.ndarray:
    img = cv2.resize(img, (img.shape[1] * 2, img.shape[0] * 2),
                     interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(4, 4))
    img   = clahe.apply(img)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    img    = cv2.dilate(img, kernel, iterations=1)
    return cv2.copyMakeBorder(img, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=0)


def _run_tess(img: np.ndarray, config: str) -> Tuple[str, float]:
    if not _TESS_OK:
        return "", 0.0
    try:
        data  = pytesseract.image_to_data(img, config=config,
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


def _tess_best(raw: np.ndarray,
               rotations: List[float]) -> Tuple[str, float]:
    """Try all rotation × PSM combos, return best (text, conf)."""
    best_t, best_c = "", 0.0
    for deg in rotations:
        rotated = _rot(raw, deg)
        # Tesseract needs dark-on-white
        inverted = cv2.bitwise_not(rotated)
        proc     = _preprocess_tess(inverted)
        for cfg in TESS_MODES:
            t, c = _run_tess(proc, cfg)
            if c > best_c:
                best_t, best_c = t, c
    return best_t, best_c


# ── debug ────────────────────────────────────────────────────────────────────

def _debug_save(pole_id: int, png_bytes: bytes,
                text: str, conf: float, engine: str) -> None:
    if not DEBUG_DIR:
        return
    try:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        label = f"{text or 'NONE'}_{int(conf * 100)}pct_{engine}"
        with open(os.path.join(DEBUG_DIR, f"p{pole_id:03d}_{label}.png"), "wb") as f:
            f.write(png_bytes)
    except Exception as e:
        print(f"[pole_ocr debug] {e}")


_counter = 0


# ── public API ────────────────────────────────────────────────────────────────

# Cache Ollama availability check (checked once per process)
_ollama_checked: Optional[bool] = None


def ocr_pole(
    segments: list,
    bbox: Tuple[float, float, float, float],
    conf_threshold: float = CONF_THRESHOLD,
) -> PoleOcrResult:
    """
    OCR one stroked-polyline pole label.

    Tries Ollama moondream first (free local vision model).
    Falls back to Tesseract if Ollama is not running.

    segments  - full layer Seg list (filtered to bbox internally)
    bbox      - (minx, miny, maxx, maxy) in DXF coordinates
    """
    global _counter, _ollama_checked
    _counter += 1
    pole_id = _counter

    # 1. Filter + render
    tight = _filter_segments(segments, bbox, expand=0.05)
    if len(tight) < 3:
        tight = _filter_segments(segments, bbox, expand=0.30)

    raw = _render(tight, bbox)

    # 2. Detect rotation (OSD → bbox fallback) then make upright PNG
    deg      = _detect_rotation(raw, bbox)
    crop_png = _make_display_png(raw, deg)

    # 3. Check Ollama once per process startup
    if _ollama_checked is None:
        _ollama_checked = _ollama_available()
        if _ollama_checked:
            print("[pole_ocr] Ollama detected — using moondream vision model")
            _warmup_model()
        else:
            print("[pole_ocr] Ollama not running — falling back to Tesseract")
            if not _TESS_OK:
                print("[pole_ocr] WARNING: Neither Ollama nor Tesseract available!")

    # 4. Run OCR
    if _ollama_checked:
        text, conf = _call_ollama(crop_png)
        engine     = "moondream"
        if not text and _TESS_OK:
            rotations  = [deg, deg + 90.0, deg + 180.0, deg + 270.0]
            text, conf = _tess_best(raw, rotations)
            engine     = "tess-fallback"
    else:
        rotations  = [deg, deg + 90.0, deg + 180.0, deg + 270.0]
        text, conf = _tess_best(raw, rotations)
        engine     = "tesseract"

    _debug_save(pole_id, crop_png, text, conf, engine)
    print(f"[pole_ocr] #{pole_id:03d} [{engine}] → '{text}' conf={conf:.2f}")

    accepted = bool(text) and conf >= conf_threshold

    return PoleOcrResult(
        text       = text,
        confidence = round(conf, 4),
        accepted   = accepted,
        crop_png   = crop_png,
    )