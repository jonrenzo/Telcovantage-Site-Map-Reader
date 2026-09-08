export interface BoundaryPoint {
  x: number;
  y: number;
}

export function isPointInPolygon(
  px: number,
  py: number,
  polygon: BoundaryPoint[] | null,
): boolean {
  if (!polygon || polygon.length < 3) return true;

  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;

    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) isInside = !isInside;
  }

  return isInside;
}

export function distanceToNearestSegment(
  px: number,
  py: number,
  segments: { x1: number; y1: number; x2: number; y2: number }[],
): number {
  let best = Infinity;
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - s.x1) * dx + (py - s.y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = s.x1 + t * dx;
    const cy = s.y1 + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

/** IDs (by index into `items`) whose nearest-segment distance is an outlier
 * relative to the rest — a robust, scale-independent way to flag "no wire
 * nearby" without a fixed-unit threshold (DXF files vary wildly in scale). */
export function findNoWireNearbyIndices<T>(
  items: T[],
  getXY: (item: T) => { x: number; y: number },
  segments: { x1: number; y1: number; x2: number; y2: number }[],
  outlierFactor = 6,
): Set<number> {
  const flagged = new Set<number>();
  if (!segments.length || items.length < 3) return flagged;

  const distances = items.map((item) => {
    const { x, y } = getXY(item);
    return distanceToNearestSegment(x, y, segments);
  });

  const sorted = [...distances].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return flagged;

  const threshold = median * outlierFactor;
  distances.forEach((d, i) => {
    if (d > threshold) flagged.add(i);
  });
  return flagged;
}
