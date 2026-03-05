import re
from typing import List, Optional, Tuple, Any
import numpy as np

from app_python.models.equipment import TextLabel, CircleMarker
from app_python.services.dxf_parser import iter_spaces

_POLEID_RE = re.compile(r"^(?:NPT|[A-Z]{0,2}\d+(?:-\d+)?)$", re.IGNORECASE)

def clean_label(s: str) -> str:
    s = (s or "").strip().replace("\\P", " ")
    return re.sub(r"\s+", " ", s).strip()

def is_pole_id(s: str) -> bool:
    return bool(_POLEID_RE.match(clean_label(s)))

def extract_text_labels(doc, layer_name: str) -> List[TextLabel]:
    labels: List[TextLabel] = []
    for space in iter_spaces(doc):
        for e in space:
            if getattr(e.dxf, "layer", None) != layer_name: continue
            t = e.dxftype()
            if t == "TEXT":
                txt = clean_label(e.dxf.text)
                if txt: labels.append(TextLabel(txt, float(e.dxf.insert.x), float(e.dxf.insert.y), float(getattr(e.dxf, "height", 0.0) or 0.0)))
            elif t == "MTEXT":
                try: txt = clean_label(e.text)
                except Exception: txt = clean_label(getattr(e.dxf, "text", "") or "")
                if txt: labels.append(TextLabel(txt, float(e.dxf.insert.x), float(e.dxf.insert.y), float(getattr(e.dxf, "char_height", 0.0) or 0.0)))
    return labels

def extract_circle_markers(doc, layer_name: str) -> List[CircleMarker]:
    circles: List[CircleMarker] = []
    for space in iter_spaces(doc):
        for e in space:
            if getattr(e.dxf, "layer", None) != layer_name: continue
            if e.dxftype() == "CIRCLE":
                circles.append(CircleMarker(float(e.dxf.center.x), float(e.dxf.center.y), float(e.dxf.radius)))
    return circles

def match_poleids_to_circles(labels: List[TextLabel], circles: List[CircleMarker], max_dist_factor: float = 4.0, default_text_height: float = 0.25) -> List[Tuple[TextLabel, Optional[CircleMarker]]]:
    out: List[Tuple[TextLabel, Optional[CircleMarker]]] = []
    if not circles:
        return [(lab, None) for lab in labels if is_pole_id(lab.text)]

    for lab in labels:
        if not is_pole_id(lab.text): continue
        th = lab.height if lab.height > 1e-9 else default_text_height
        best, best_d2 = None, 1e18
        
        for c in circles:
            d2 = (lab.x - c.x)**2 + (lab.y - c.y)**2
            if d2 < best_d2:
                best_d2, best = d2, c

        if best is None:
            out.append((lab, None))
            continue

        gate = max_dist_factor * max(th, best.r, 1e-6)
        out.append((lab, best if best_d2 <= gate * gate else None))
    return out