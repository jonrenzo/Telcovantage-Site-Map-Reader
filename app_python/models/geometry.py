import math
from dataclasses import dataclass
from typing import List, Tuple

@dataclass
class Seg:
    x1: float
    y1: float
    x2: float
    y2: float

    def p1(self) -> Tuple[float, float]:
        return (self.x1, self.y1)

    def p2(self) -> Tuple[float, float]:
        return (self.x2, self.y2)

    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

@dataclass
class ClusterInfo:
    cluster_id: int
    seg_indices: List[int]
    bbox: Tuple[float, float, float, float]
    width: float
    height: float
    total_length: float
    kind: str

@dataclass
class Candidate:
    digit_id: int
    cluster_id: int
    seg_indices: List[int]
    bbox: Tuple[float, float, float, float]
    width: float
    height: float
    total_length: float

@dataclass
class BoundaryMask:
    pts: List[Tuple[float, float]]
    bbox: Tuple[float, float, float, float]
    area: float
    snap_tol_used: float
    close_max_gap_used: float
    endpoints_before: int
    endpoints_after: int
    added_edges: int