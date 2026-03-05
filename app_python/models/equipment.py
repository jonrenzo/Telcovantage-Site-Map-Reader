from dataclasses import dataclass
from typing import Tuple

@dataclass
class EquipmentShape:
    shape_id: int
    kind: str  # "circle" | "triangle" | "square" | "rectangle" | "hexagon"
    bbox: Tuple[float, float, float, float]
    cx: float
    cy: float

@dataclass
class TextLabel:
    text: str
    x: float
    y: float
    height: float

@dataclass
class CircleMarker:
    x: float
    y: float
    r: float