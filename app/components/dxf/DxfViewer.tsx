"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { DxfLayerData, EquipmentShape } from "../../types";
import DxfToolbar from "./DxfToolbar";
import DxfLayerPanel from "./DxfLayerPanel";
import { isPointInPolygon } from "../../page";

interface BoundaryPoint {
  x: number;
  y: number;
}

interface RawSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PoleTag {
  pole_id: number;
  name: string;
  cx: number;
  cy: number;
  bbox: number[];
  layer: string;
  source: string;
  map_latitude?: number;
  map_longitude?: number;
}

interface CableSpan {
  span_id: number;
  source_span_id?: number | null;
  layer: string;
  bbox: [number, number, number, number];
  cx: number;
  cy: number;
  segment_count: number;
  total_length: number;
  meterValue?: number | null;
  cable_runs: number;
  segments: RawSegment[];
  display_segments?: RawSegment[];
  from_pole?: string;
  to_pole?: string;
  from_pole_id?: number;
  to_pole_id?: number;
  /** Direction-free identity from the derivation, e.g. "POLE-0003::POLE-0004". */
  span_key?: string;
  from_pole_index?: string;
  to_pole_index?: string;
}

/** The lifecycle twinbackend runs a span through as the lineman tears it down. */
type TeardownStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "superseded";

/**
 * Teardown owns the line colour on the canvas and in the PDF alike.
 *
 * Recovery marking keeps its own palette for chips, but a span can be both
 * Recovered and completed, and only one of them can own the stroke. Red means
 * the lineman is done with it — which is what the field asked to see.
 */
function getTeardownStyle(status: TeardownStatus) {
  switch (status) {
    case "completed":
      return {
        marker: "rgba(220, 38, 38, 0.22)",
        stroke: "rgba(220, 38, 38, 0.95)",
        pole: {
          fill: "rgba(220, 38, 38, 0.9)",
          stroke: "#fee2e2",
          text: "#7f1d1d",
        },
      };
    case "in_progress":
      return {
        marker: "rgba(245, 158, 11, 0.22)",
        stroke: "rgba(217, 119, 6, 0.95)",
        pole: {
          fill: "rgba(217, 119, 6, 0.9)",
          stroke: "#fef3c7",
          text: "#78350f",
        },
      };
    case "cancelled":
    case "superseded":
      return {
        marker: "rgba(148, 163, 184, 0.18)",
        stroke: "rgba(100, 116, 139, 0.8)",
        pole: {
          fill: "rgba(100, 116, 139, 0.75)",
          stroke: "#e2e8f0",
          text: "#334155",
        },
      };
    default:
      return {
        marker: "rgba(59, 130, 246, 0.16)",
        stroke: "rgba(37, 99, 235, 0.9)",
        pole: {
          fill: "rgba(37, 99, 235, 0.85)",
          stroke: "#dbeafe",
          text: "#1e3a8a",
        },
      };
  }
}

interface CableSpanExport {
  span_id: number;
  source_span_id?: number | null;
  layer: string;
  bbox: [number, number, number, number];
  cx: number;
  cy: number;
  segment_count: number;
  total_length: number;
  meter_value?: number | null;
  cable_runs: number;
  display_segments?: RawSegment[];
  from_pole?: string | null;
  to_pole?: string | null;
  from_pole_id?: number | null;
  to_pole_id?: number | null;
  from_pole_x?: number | null;
  from_pole_y?: number | null;
  to_pole_x?: number | null;
  to_pole_y?: number | null;
  from_x?: number | null;
  from_y?: number | null;
  to_x?: number | null;
  to_y?: number | null;
}

interface Props {
  dxfPath: string;
  ocrResults: any[];
  isActive: boolean;
  /** Set once the node exists in AsBuilt IQ; enables teardown status sync. */
  asbuiltNodeId?: number | null;
  onExportPdfRef?: React.MutableRefObject<(() => void) | null>;
  onExportVerificationRef?: React.MutableRefObject<(() => void) | null>;
  boundary: BoundaryPoint[] | null;
  isMaskEnabled: boolean;
  onSpansChange?: (spans: CableSpanExport[]) => void;
  onCacheUpdate?: (data: { poleTags?: PoleTag[]; poleDone?: boolean }) => void;
  initialSegments?: Record<string, RawSegment[]>;
  initialCableSpans?: CableSpan[];
  onInitialDataConsumed?: () => void;
}

interface PartialDetail {
  recovered?: number;
}

type CableRecoveryStatus = "Recovered" | "Partial" | "Missing";

interface DeletedSpanData {
  span: CableSpan;
  status?: CableRecoveryStatus;
  partialDetail?: PartialDetail;
}

interface FileDataCache {
  segments: Record<string, RawSegment[]>;
  layers: string[];
  bounds: { minx: number; miny: number; maxx: number; maxy: number };
  cableLayers: string[];
  spans: CableSpan[];
}

type PoleBreakOptions = {
  targetSpanIds?: number[] | Set<number> | null;
  anchorPoint?: { x: number; y: number } | null;
  anchorPoleIds?: number[] | Set<number> | null;
  anchorRadius?: number;
  preserveExistingAssignments?: boolean;
};

function layerColor(name: string): string {
  const palette = [
    "#2563eb",
    "#16a34a",
    "#d97706",
    "#dc2626",
    "#7c3aed",
    "#0891b2",
    "#be185d",
    "#65a30d",
    "#ea580c",
    "#0284c7",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

function computeSpanMetrics(segments: RawSegment[]) {
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity;
  let sumX = 0,
    sumY = 0,
    count = 0;
  let length = 0;

  for (const s of segments) {
    minx = Math.min(minx, s.x1, s.x2);
    miny = Math.min(miny, s.y1, s.y2);
    maxx = Math.max(maxx, s.x1, s.x2);
    maxy = Math.max(maxy, s.y1, s.y2);
    sumX += s.x1 + s.x2;
    sumY += s.y1 + s.y2;
    count += 2;
    length += Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  }

  return {
    bbox: [minx, miny, maxx, maxy] as [number, number, number, number],
    cx: count > 0 ? sumX / count : 0,
    cy: count > 0 ? sumY / count : 0,
    total_length: length,
  };
}

type SpanEndpoint = {
  pt: { x: number; y: number };
  inward: { x: number; y: number };
};

function findSpanEndpoints(segments: RawSegment[], tol = 0.5): [SpanEndpoint, SpanEndpoint] | null {
  if (segments.length === 0) return null;

  const buckets = new Map<
    string,
    {
      x: number;
      y: number;
      count: number;
      inward: { x: number; y: number };
    }
  >();

  const addEndpoint = (
    x: number,
    y: number,
    inward: { x: number; y: number },
  ) => {
    const key = `${Math.round(x / tol)},${Math.round(y / tol)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.x = (existing.x * existing.count + x) / (existing.count + 1);
      existing.y = (existing.y * existing.count + y) / (existing.count + 1);
      existing.count += 1;
    } else {
      buckets.set(key, { x, y, count: 1, inward });
    }
  };

  for (const segment of segments) {
    addEndpoint(segment.x1, segment.y1, { x: segment.x2, y: segment.y2 });
    addEndpoint(segment.x2, segment.y2, { x: segment.x1, y: segment.y1 });
  }

  const allPoints = Array.from(buckets.values()).map((bucket) => ({
    pt: { x: bucket.x, y: bucket.y },
    inward: bucket.inward,
  }));
  const openEndpoints = Array.from(buckets.values())
    .filter((bucket) => bucket.count === 1)
    .map((bucket) => ({
      pt: { x: bucket.x, y: bucket.y },
      inward: bucket.inward,
    }));

  const candidates = openEndpoints.length >= 2 ? openEndpoints : allPoints;
  if (candidates.length < 2) return null;

  let bestA = candidates[0];
  let bestB = candidates[1];
  let bestDist = -1;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const dist = Math.hypot(a.pt.x - b.pt.x, a.pt.y - b.pt.y);
      if (dist > bestDist) {
        bestDist = dist;
        bestA = a;
        bestB = b;
      }
    }
  }

  return [bestA, bestB];
}

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;

  if (len2 < 1e-12) {
    const ddx = px - x1;
    const ddy = py - y1;
    return Math.hypot(ddx, ddy);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function projectPointOntoSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;

  if (len2 < 1e-12) {
    return {
      t: 0,
      x: x1,
      y: y1,
      distance: Math.hypot(px - x1, py - y1),
      segmentLength: 0,
    };
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = x1 + t * dx;
  const y = y1 + t * dy;

  return {
    t,
    x,
    y,
    distance: Math.hypot(px - x, py - y),
    segmentLength: Math.hypot(dx, dy),
  };
}

function projectPointOntoPath(
  px: number,
  py: number,
  segments: RawSegment[],
) {
  let best:
    | {
        segmentIndex: number;
        t: number;
        x: number;
        y: number;
        distance: number;
        progress: number;
        segmentLength: number;
      }
    | null = null;
  let walked = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const projection = projectPointOntoSegment(
      px,
      py,
      seg.x1,
      seg.y1,
      seg.x2,
      seg.y2,
    );
    const progress = walked + projection.segmentLength * projection.t;
    if (!best || projection.distance < best.distance) {
      best = {
        segmentIndex: i,
        t: projection.t,
        x: projection.x,
        y: projection.y,
        distance: projection.distance,
        progress,
        segmentLength: projection.segmentLength,
      };
    }
    walked += projection.segmentLength;
  }

  return best ? { ...best, totalLength: walked } : null;
}

function areSegmentsConnected(
  s1: RawSegment,
  s2: RawSegment,
  tol = 0.5,
): boolean {
  return (
    Math.hypot(s1.x2 - s2.x1, s1.y2 - s2.y1) < tol ||
    Math.hypot(s1.x2 - s2.x2, s1.y2 - s2.y2) < tol ||
    Math.hypot(s1.x1 - s2.x1, s1.y1 - s2.y1) < tol ||
    Math.hypot(s1.x1 - s2.x2, s1.y1 - s2.y2) < tol
  );
}

function orderConnectedSegments(segments: RawSegment[], tol = 0.5): RawSegment[] {
  if (segments.length <= 1) return segments.slice();

  const keyForPoint = (x: number, y: number) =>
    `${Math.round(x / tol)},${Math.round(y / tol)}`;

  const adjacency = new Map<
    string,
    Array<{ idx: number; atStart: boolean }>
  >();

  segments.forEach((seg, idx) => {
    const startKey = keyForPoint(seg.x1, seg.y1);
    const endKey = keyForPoint(seg.x2, seg.y2);
    const startList = adjacency.get(startKey) ?? [];
    startList.push({ idx, atStart: true });
    adjacency.set(startKey, startList);

    const endList = adjacency.get(endKey) ?? [];
    endList.push({ idx, atStart: false });
    adjacency.set(endKey, endList);
  });

  const degreeOneNode =
    Array.from(adjacency.entries()).find(([, list]) => list.length === 1)?.[0] ??
    null;

  const used = new Set<number>();
  const ordered: RawSegment[] = [];
  let currentKey = degreeOneNode ?? keyForPoint(segments[0].x1, segments[0].y1);

  const appendSegmentFromEntry = (entry: { idx: number; atStart: boolean }) => {
    const seg = segments[entry.idx];
    const oriented = entry.atStart
      ? { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 }
      : { x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1 };
    ordered.push(oriented);
    used.add(entry.idx);
    currentKey = keyForPoint(oriented.x2, oriented.y2);
  };

  while (used.size < segments.length) {
    const nextEntry = (adjacency.get(currentKey) ?? []).find(
      (entry) => !used.has(entry.idx),
    );

    if (nextEntry) {
      appendSegmentFromEntry(nextEntry);
      continue;
    }

    const nextUnusedIdx = segments.findIndex((_, idx) => !used.has(idx));
    if (nextUnusedIdx === -1) break;

    const nextUnused = segments[nextUnusedIdx];
    currentKey = keyForPoint(nextUnused.x1, nextUnused.y1);
    appendSegmentFromEntry({ idx: nextUnusedIdx, atStart: true });
  }

  if (ordered.length !== segments.length) {
    ordered.splice(0, ordered.length, ...segments);
  }

  let connectedPairs = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    if (areSegmentsConnected(ordered[i], ordered[i + 1], tol)) {
      connectedPairs += 1;
    }
  }

  const connectionRatio =
    ordered.length > 1 ? connectedPairs / (ordered.length - 1) : 1;
  if (connectionRatio >= 0.65) {
    return ordered;
  }

  const endpoints = findSpanEndpoints(segments, tol);
  if (!endpoints) {
    return ordered;
  }

  const [startEndpoint, endEndpoint] = endpoints;
  const dirX = endEndpoint.pt.x - startEndpoint.pt.x;
  const dirY = endEndpoint.pt.y - startEndpoint.pt.y;
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen < 1e-9) {
    return ordered;
  }

  const ux = dirX / dirLen;
  const uy = dirY / dirLen;

  return segments
    .map((seg) => {
      const startProj =
        (seg.x1 - startEndpoint.pt.x) * ux + (seg.y1 - startEndpoint.pt.y) * uy;
      const endProj =
        (seg.x2 - startEndpoint.pt.x) * ux + (seg.y2 - startEndpoint.pt.y) * uy;
      const oriented =
        startProj <= endProj
          ? { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 }
          : { x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1 };
      const midProj =
        ((oriented.x1 + oriented.x2) / 2 - startEndpoint.pt.x) * ux +
        ((oriented.y1 + oriented.y2) / 2 - startEndpoint.pt.y) * uy;
      return { seg: oriented, midProj };
    })
    .sort((a, b) => a.midProj - b.midProj)
    .map((entry) => entry.seg);
}

function orderedSpanEndpointsFromSegments(
  orderedSegments: RawSegment[],
): [SpanEndpoint, SpanEndpoint] | null {
  if (orderedSegments.length === 0) return null;

  const first = orderedSegments[0];
  const last = orderedSegments[orderedSegments.length - 1];

  return [
    {
      pt: { x: first.x1, y: first.y1 },
      inward: { x: first.x2, y: first.y2 },
    },
    {
      pt: { x: last.x2, y: last.y2 },
      inward: { x: last.x1, y: last.y1 },
    },
  ];
}

function getOrderedSpanEndpoints(
  segments: RawSegment[],
  tol = 0.5,
): [SpanEndpoint, SpanEndpoint] | null {
  const orderedSegments = orderConnectedSegments(segments, tol);
  return orderedSpanEndpointsFromSegments(orderedSegments);
}

function splitBranchingSegments(
  segments: RawSegment[],
  tol = 0.5,
  straightContinueAngleDeg = 135,
): RawSegment[][] {
  const validSegments = segments.filter(
    (seg) => Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) > 1e-9,
  );
  if (validSegments.length <= 1) return validSegments.length ? [validSegments] : [];

  const keyForPoint = (x: number, y: number) =>
    `${Math.round(x / tol)},${Math.round(y / tol)}`;

  const edgeNodes = new Map<number, { a: string; b: string }>();
  const nodeIncidents = new Map<string, number[]>();

  validSegments.forEach((seg, idx) => {
    const a = keyForPoint(seg.x1, seg.y1);
    const b = keyForPoint(seg.x2, seg.y2);
    edgeNodes.set(idx, { a, b });
    nodeIncidents.set(a, [...(nodeIncidents.get(a) ?? []), idx]);
    nodeIncidents.set(b, [...(nodeIncidents.get(b) ?? []), idx]);
  });

  const vectorFromNode = (edge: number, node: string) => {
    const nodes = edgeNodes.get(edge);
    const seg = validSegments[edge];
    if (!nodes || !seg) return { x: 0, y: 0 };
    return node === nodes.a
      ? { x: seg.x2 - seg.x1, y: seg.y2 - seg.y1 }
      : { x: seg.x1 - seg.x2, y: seg.y1 - seg.y2 };
  };

  const angleBetween = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    const lenA = Math.hypot(a.x, a.y);
    const lenB = Math.hypot(b.x, b.y);
    if (lenA <= 1e-9 || lenB <= 1e-9) return 180;
    const dot = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (lenA * lenB)));
    return (Math.acos(dot) * 180) / Math.PI;
  };

  const branchNodes = new Set<string>();
  for (const [node, incident] of nodeIncidents.entries()) {
    if (incident.length !== 2) {
      branchNodes.add(node);
      continue;
    }
    const angle = angleBetween(
      vectorFromNode(incident[0], node),
      vectorFromNode(incident[1], node),
    );
    if (angle < straightContinueAngleDeg) {
      branchNodes.add(node);
    }
  }
  if (branchNodes.size === 0) {
    return [orderConnectedSegments(validSegments, tol)];
  }

  const visited = new Set<number>();
  const paths: RawSegment[][] = [];

  const walkPath = (startNode: string, startEdge: number): RawSegment[] => {
    const path: RawSegment[] = [];
    let currentNode = startNode;
    let currentEdge = startEdge;

    while (!visited.has(currentEdge)) {
      const nodes = edgeNodes.get(currentEdge);
      const seg = validSegments[currentEdge];
      if (!nodes || !seg) break;

      visited.add(currentEdge);
      const oriented =
        currentNode === nodes.a
          ? { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 }
          : { x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1 };
      path.push(oriented);

      const nextNode = currentNode === nodes.a ? nodes.b : nodes.a;
      if (branchNodes.has(nextNode)) break;

      const nextEdge = (nodeIncidents.get(nextNode) ?? []).find(
        (edge) => !visited.has(edge),
      );
      if (nextEdge == null) break;

      currentNode = nextNode;
      currentEdge = nextEdge;
    }

    return path;
  };

  for (const node of branchNodes) {
    for (const edge of nodeIncidents.get(node) ?? []) {
      if (visited.has(edge)) continue;
      const path = walkPath(node, edge);
      if (path.length > 0) paths.push(path);
    }
  }

  validSegments.forEach((_, edge) => {
    if (visited.has(edge)) return;
    const startNode = edgeNodes.get(edge)?.a;
    if (!startNode) return;
    const path = walkPath(startNode, edge);
    if (path.length > 0) paths.push(path);
  });

  return paths.length ? paths : [orderConnectedSegments(validSegments, tol)];
}

function findSafeCutIndex(
  segs: RawSegment[],
  clickedIndex: number,
  cursorX: number,
  cursorY: number,
): number | null {
  let startIdx = clickedIndex;
  let endIdx = clickedIndex;
  const tol = 0.5;

  while (
    startIdx > 0 &&
    areSegmentsConnected(segs[startIdx], segs[startIdx - 1], tol)
  ) {
    startIdx--;
  }
  while (
    endIdx < segs.length - 1 &&
    areSegmentsConnected(segs[endIdx], segs[endIdx + 1], tol)
  ) {
    endIdx++;
  }
  if (startIdx === 0 && endIdx === segs.length - 1) return clickedIndex;

  const sStart = segs[startIdx];
  const sEnd = segs[endIdx];
  const distToStart = pointToSegmentDistance(
    cursorX,
    cursorY,
    sStart.x1,
    sStart.y1,
    sStart.x2,
    sStart.y2,
  );
  const distToEnd = pointToSegmentDistance(
    cursorX,
    cursorY,
    sEnd.x1,
    sEnd.y1,
    sEnd.x2,
    sEnd.y2,
  );

  if (startIdx === 0) return endIdx;
  if (endIdx === segs.length - 1) return startIdx - 1;

  return distToStart < distToEnd ? startIdx - 1 : endIdx;
}

function drawSolidSegments(ctx: CanvasRenderingContext2D, segments: RawSegment[]) {
  ctx.beginPath();
  for (const seg of segments) {
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
  }
}

function distanceToSolidSegments(x: number, y: number, segments: RawSegment[]) {
  if (segments.length === 0) return Infinity;
  let best = Infinity;
  for (const seg of segments) {
    best = Math.min(
      best,
      pointToSegmentDistance(x, y, seg.x1, seg.y1, seg.x2, seg.y2),
    );
  }
  return best;
}

function displaySegmentsForLogicalSegments(
  displaySegments: RawSegment[] | undefined,
  logicalSegments: RawSegment[],
  tolerance = 0.1,
): RawSegment[] {
  if (!displaySegments?.length) return logicalSegments;

  const filtered = displaySegments.filter((displaySeg) => {
    const mx = (displaySeg.x1 + displaySeg.x2) / 2;
    const my = (displaySeg.y1 + displaySeg.y2) / 2;
    return logicalSegments.some(
      (logicalSeg) =>
        pointToSegmentDistance(
          mx,
          my,
          logicalSeg.x1,
          logicalSeg.y1,
          logicalSeg.x2,
          logicalSeg.y2,
        ) <= tolerance,
    );
  });

  return filtered.length ? filtered : logicalSegments;
}

function spanVisibleSegments(span: Pick<CableSpan, "display_segments" | "segments">) {
  return span.display_segments?.length ? span.display_segments : span.segments;
}

const EXPORT_POLE_PATH_RADIUS = 1.5;
const EXPORT_POLE_ENDPOINT_RADIUS = 2.5;

function buildCableSpanExport(span: CableSpan, poles: PoleTag[]): CableSpanExport {
  const endpoints = getOrderedSpanEndpoints(span.segments);
  const fromEndpoint = endpoints?.[0];
  const toEndpoint = endpoints?.[1];
  const fromPole =
    span.from_pole_id != null
      ? poles.find((p) => p.pole_id === span.from_pole_id)
      : null;
  const toPole =
    span.to_pole_id != null
      ? poles.find((p) => p.pole_id === span.to_pole_id)
      : null;

  return {
    span_id: span.span_id,
    source_span_id: span.source_span_id ?? span.span_id,
    layer: span.layer,
    bbox: span.bbox,
    cx: span.cx,
    cy: span.cy,
    segment_count: span.segment_count,
    total_length: span.total_length,
    meter_value: span.meterValue ?? null,
    cable_runs: span.cable_runs,
    display_segments: span.display_segments,
    from_pole: span.from_pole ?? null,
    to_pole: span.to_pole ?? null,
    from_pole_id: span.from_pole_id ?? null,
    to_pole_id: span.to_pole_id ?? null,
    from_pole_x: fromPole?.cx ?? null,
    from_pole_y: fromPole?.cy ?? null,
    to_pole_x: toPole?.cx ?? null,
    to_pole_y: toPole?.cy ?? null,
    from_x: fromEndpoint?.pt.x ?? null,
    from_y: fromEndpoint?.pt.y ?? null,
    to_x: toEndpoint?.pt.x ?? null,
    to_y: toEndpoint?.pt.y ?? null,
  };
}

function collapseCableSpansForExport(
  spans: CableSpan[],
  poles: PoleTag[],
): CableSpanExport[] {
  const poleById = new Map(poles.map((pole) => [pole.pole_id, pole]));
  const spansBySource = new Map<number, CableSpan[]>();

  for (const span of spans) {
    const sourceId = span.source_span_id ?? span.span_id;
    const group = spansBySource.get(sourceId) ?? [];
    group.push(span);
    spansBySource.set(sourceId, group);
  }

  const nearestPoleToEndpoint = (x: number, y: number): PoleTag | null => {
    let bestPole: PoleTag | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const pole of poles) {
      const distance = Math.hypot(pole.cx - x, pole.cy - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPole = pole;
      }
    }
    return bestDistance <= EXPORT_POLE_ENDPOINT_RADIUS ? bestPole : null;
  };

  const collapsed: CableSpanExport[] = [];

  for (const [sourceId, group] of spansBySource.entries()) {
    if (group.length === 1) {
      collapsed.push(buildCableSpanExport(group[0], poles));
      continue;
    }

    const base = group.reduce((best, span) =>
      span.span_id < best.span_id ? span : best,
    );
    const logicalSegments = group.flatMap((span) => span.segments ?? []);
    if (!logicalSegments.length) {
      collapsed.push(...group.map((span) => buildCableSpanExport(span, poles)));
      continue;
    }

    const displaySegments = group.flatMap((span) => span.display_segments ?? []);
    const visibleSegments = displaySegments.length
      ? displaySegments
      : logicalSegments;
    const orderedLogicalSegments = orderConnectedSegments(logicalSegments);
    const orderedVisibleSegments = orderConnectedSegments(visibleSegments);
    const metrics = computeSpanMetrics(orderedLogicalSegments);
    const endpoints =
      orderedSpanEndpointsFromSegments(orderedVisibleSegments) ??
      orderedSpanEndpointsFromSegments(orderedLogicalSegments);

    type PoleProgress = {
      pole: PoleTag;
      progress: number;
      distance: number;
      assigned: boolean;
    };

    const candidates = new Map<number, PoleProgress>();
    const addCandidate = (pole: PoleTag | null | undefined, assigned: boolean) => {
      if (!pole) return;
      const projection = projectPointOntoPath(
        pole.cx,
        pole.cy,
        orderedLogicalSegments,
      );
      if (!projection) return;
      const maxDistance = assigned
        ? Math.max(EXPORT_POLE_PATH_RADIUS, EXPORT_POLE_ENDPOINT_RADIUS)
        : EXPORT_POLE_PATH_RADIUS;
      if (projection.distance > maxDistance) return;

      const existing = candidates.get(pole.pole_id);
      if (
        !existing ||
        (assigned && !existing.assigned) ||
        projection.distance < existing.distance
      ) {
        candidates.set(pole.pole_id, {
          pole,
          progress: projection.progress,
          distance: projection.distance,
          assigned,
        });
      }
    };

    for (const span of group) {
      addCandidate(
        span.from_pole_id != null ? poleById.get(span.from_pole_id) : null,
        true,
      );
      addCandidate(
        span.to_pole_id != null ? poleById.get(span.to_pole_id) : null,
        true,
      );
    }

    for (const pole of poles) {
      addCandidate(pole, false);
    }

    const sortedCandidates = Array.from(candidates.values()).sort(
      (a, b) => a.progress - b.progress,
    );
    let fromPole: PoleTag | null = sortedCandidates[0]?.pole ?? null;
    let toPole: PoleTag | null =
      sortedCandidates.length > 1
        ? sortedCandidates[sortedCandidates.length - 1].pole
        : null;

    if ((!fromPole || !toPole || fromPole.pole_id === toPole.pole_id) && endpoints) {
      fromPole = nearestPoleToEndpoint(endpoints[0].pt.x, endpoints[0].pt.y);
      toPole = nearestPoleToEndpoint(endpoints[1].pt.x, endpoints[1].pt.y);
    }

    if (fromPole && toPole && fromPole.pole_id === toPole.pole_id) {
      toPole = null;
    }

    collapsed.push({
      span_id: sourceId,
      source_span_id: sourceId,
      layer: base.layer,
      bbox: metrics.bbox,
      cx: metrics.cx,
      cy: metrics.cy,
      segment_count: orderedLogicalSegments.length,
      total_length: metrics.total_length,
      meter_value: null,
      cable_runs: Math.max(...group.map((span) => span.cable_runs || 1)),
      display_segments: displaySegments.length ? orderedVisibleSegments : undefined,
      from_pole: fromPole?.name ?? null,
      to_pole: toPole?.name ?? null,
      from_pole_id: fromPole?.pole_id ?? null,
      to_pole_id: toPole?.pole_id ?? null,
      from_pole_x: fromPole?.cx ?? null,
      from_pole_y: fromPole?.cy ?? null,
      to_pole_x: toPole?.cx ?? null,
      to_pole_y: toPole?.cy ?? null,
      from_x: endpoints?.[0].pt.x ?? null,
      from_y: endpoints?.[0].pt.y ?? null,
      to_x: endpoints?.[1].pt.x ?? null,
      to_y: endpoints?.[1].pt.y ?? null,
    });
  }

  return collapsed;
}

function boundsFromSegments(
  segments: RawSegment[],
  fallback: [number, number, number, number],
): [number, number, number, number] {
  if (!segments.length) return fallback;
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const s of segments) {
    minx = Math.min(minx, s.x1, s.x2);
    miny = Math.min(miny, s.y1, s.y2);
    maxx = Math.max(maxx, s.x1, s.x2);
    maxy = Math.max(maxy, s.y1, s.y2);
  }
  return [minx, miny, maxx, maxy];
}

function logicalSegmentsFromVisibleSegments(
  visibleSegments: RawSegment[],
  tol = 0.5,
): RawSegment[] {
  const ordered = orderConnectedSegments(visibleSegments, tol);
  if (!ordered.length) return [];

  const logical: RawSegment[] = [];
  let currentX = ordered[0].x1;
  let currentY = ordered[0].y1;

  for (const seg of ordered) {
    const gap = Math.hypot(seg.x1 - currentX, seg.y1 - currentY);
    if (logical.length > 0 && gap > 0.02) {
      logical.push({
        x1: currentX,
        y1: currentY,
        x2: seg.x1,
        y2: seg.y1,
      });
    }
    logical.push(seg);
    currentX = seg.x2;
    currentY = seg.y2;
  }

  return logical;
}

const STRAIGHT_DASH_ANGLE_TOLERANCE = (4 * Math.PI) / 180;
const STRAIGHT_DASH_OFFSET_TOLERANCE = 0.18;
const STRAIGHT_DASH_MAX_GAP = 1.6;
const STRAIGHT_DASH_MIN_LENGTH = 0.05;

function normalizeLineAngle(angle: number) {
  let normalized = angle % Math.PI;
  if (normalized < 0) normalized += Math.PI;
  return normalized;
}

function lineAngleDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % Math.PI;
  return Math.min(diff, Math.PI - diff);
}

type StraightSpanCandidate = {
  span: CableSpan;
  displaySegments: RawSegment[];
  angle: number;
  offset: number;
  start: number;
  end: number;
};

function straightSpanCandidate(span: CableSpan): StraightSpanCandidate | null {
  const displaySegments = spanVisibleSegments(span).filter(
    (seg) => Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) >= STRAIGHT_DASH_MIN_LENGTH,
  );
  if (!displaySegments.length) return null;

  const ordered = orderConnectedSegments(displaySegments);
  const endpoints = orderedSpanEndpointsFromSegments(ordered);
  if (!endpoints) return null;

  let x1 = endpoints[0].pt.x;
  let y1 = endpoints[0].pt.y;
  let x2 = endpoints[1].pt.x;
  let y2 = endpoints[1].pt.y;
  let dx = x2 - x1;
  let dy = y2 - y1;
  if (dx < 0 || (Math.abs(dx) < 1e-9 && dy < 0)) {
    [x1, x2] = [x2, x1];
    [y1, y2] = [y2, y1];
    dx = -dx;
    dy = -dy;
  }

  const length = Math.hypot(dx, dy);
  if (length < STRAIGHT_DASH_MIN_LENGTH) return null;

  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const angle = normalizeLineAngle(Math.atan2(uy, ux));
  const projections = ordered.flatMap((seg) => [
    seg.x1 * ux + seg.y1 * uy,
    seg.x2 * ux + seg.y2 * uy,
  ]);
  const offsets = ordered.flatMap((seg) => [
    seg.x1 * nx + seg.y1 * ny,
    seg.x2 * nx + seg.y2 * ny,
  ]);

  return {
    span,
    displaySegments,
    angle,
    offset: offsets.reduce((sum, value) => sum + value, 0) / offsets.length,
    start: Math.min(...projections),
    end: Math.max(...projections),
  };
}

function mergeStraightDashedSpans(spans: CableSpan[]): CableSpan[] {
  const byLayer = new Map<string, StraightSpanCandidate[]>();
  const passthrough: CableSpan[] = [];

  for (const span of spans) {
    const candidate = straightSpanCandidate(span);
    if (!candidate) {
      passthrough.push(span);
      continue;
    }
    const layerCandidates = byLayer.get(span.layer) ?? [];
    layerCandidates.push(candidate);
    byLayer.set(span.layer, layerCandidates);
  }

  const buildMergedSpan = (candidates: StraightSpanCandidate[]) => {
    if (candidates.length === 1) return candidates[0].span;

    const orderedCandidates = [...candidates].sort((a, b) => a.start - b.start);
    const orderedDisplay = orderConnectedSegments(
      orderedCandidates.flatMap((candidate) => candidate.displaySegments),
    );
    const logicalSegments = logicalSegmentsFromVisibleSegments(orderedDisplay);
    if (!logicalSegments.length) return orderedCandidates[0].span;

    const base = orderedCandidates.reduce((best, candidate) =>
      candidate.span.span_id < best.span.span_id ? candidate : best,
    ).span;
    const firstSpan = orderedCandidates[0].span;
    const lastSpan = orderedCandidates[orderedCandidates.length - 1].span;
    const metrics = computeSpanMetrics(logicalSegments);

    return {
      ...base,
      span_id: base.span_id,
      source_span_id: base.source_span_id ?? base.span_id,
      segments: logicalSegments,
      display_segments: orderedDisplay,
      segment_count: logicalSegments.length,
      cable_runs: Math.max(
        ...orderedCandidates.map((candidate) => candidate.span.cable_runs || 1),
      ),
      from_pole: firstSpan.from_pole ?? base.from_pole,
      to_pole: lastSpan.to_pole ?? base.to_pole,
      from_pole_id: firstSpan.from_pole_id ?? base.from_pole_id,
      to_pole_id: lastSpan.to_pole_id ?? base.to_pole_id,
      meterValue:
        orderedCandidates.find((candidate) => candidate.span.meterValue != null)
          ?.span.meterValue ?? base.meterValue,
      ...metrics,
    };
  };

  const merged: CableSpan[] = [...passthrough];

  for (const candidates of byLayer.values()) {
    const sorted = [...candidates].sort((a, b) => {
      const angleDiff = a.angle - b.angle;
      if (Math.abs(angleDiff) > 1e-6) return angleDiff;
      const offsetDiff = a.offset - b.offset;
      if (Math.abs(offsetDiff) > 1e-6) return offsetDiff;
      return a.start - b.start;
    });

    const clusters: StraightSpanCandidate[][] = [];
    for (const candidate of sorted) {
      let target: StraightSpanCandidate[] | null = null;
      for (const cluster of clusters) {
        const reference = cluster[0];
        const minStart = Math.min(...cluster.map((item) => item.start));
        const maxEnd = Math.max(...cluster.map((item) => item.end));
        const gap =
          candidate.start > maxEnd
            ? candidate.start - maxEnd
            : minStart > candidate.end
              ? minStart - candidate.end
              : 0;
        if (
          lineAngleDistance(candidate.angle, reference.angle) <=
            STRAIGHT_DASH_ANGLE_TOLERANCE &&
          Math.abs(candidate.offset - reference.offset) <=
            STRAIGHT_DASH_OFFSET_TOLERANCE &&
          gap <= STRAIGHT_DASH_MAX_GAP
        ) {
          target = cluster;
          break;
        }
      }

      if (target) {
        target.push(candidate);
      } else {
        clusters.push([candidate]);
      }
    }

    for (const cluster of clusters) {
      const orderedCluster = [...cluster].sort((a, b) => a.start - b.start);
      let run: StraightSpanCandidate[] = [];
      let previous: StraightSpanCandidate | null = null;
      for (const candidate of orderedCluster) {
        if (
          previous &&
          candidate.start - previous.end > STRAIGHT_DASH_MAX_GAP
        ) {
          merged.push(buildMergedSpan(run));
          run = [];
        }
        run.push(candidate);
        previous = candidate;
      }
      if (run.length) merged.push(buildMergedSpan(run));
    }
  }

  return merged;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function getStatusStyle(status: CableRecoveryStatus) {
  switch (status) {
    case "Recovered":
      return {
        marker: "rgba(34, 197, 94, 0.22)",
        stroke: "rgba(22, 163, 74, 0.95)",
        chipFill: "rgba(220, 252, 231, 0.96)",
        chipBorder: "rgba(134, 239, 172, 1)",
        chipText: "#166534",
      };
    case "Partial":
      return {
        marker: "rgba(250, 204, 21, 0.24)",
        stroke: "rgba(217, 119, 6, 0.95)",
        chipFill: "rgba(254, 249, 195, 0.97)",
        chipBorder: "rgba(253, 224, 71, 1)",
        chipText: "#92400e",
      };
    case "Missing":
      return {
        marker: "rgba(248, 113, 113, 0.22)",
        stroke: "rgba(220, 38, 38, 0.95)",
        chipFill: "rgba(254, 226, 226, 0.97)",
        chipBorder: "rgba(252, 165, 165, 1)",
        chipText: "#991b1b",
      };
    default:
      return {
        marker: "rgba(59, 130, 246, 0.18)",
        stroke: "rgba(37, 99, 235, 0.95)",
        chipFill: "rgba(219, 234, 254, 0.96)",
        chipBorder: "rgba(147, 197, 253, 1)",
        chipText: "#1d4ed8",
      };
  }
}

export default function DxfViewer({
  dxfPath,
  ocrResults,
  isActive,
  asbuiltNodeId,
  onExportPdfRef,
  onExportVerificationRef,
  boundary,
  isMaskEnabled,
  onSpansChange,
  onCacheUpdate,
  initialSegments,
  initialCableSpans,
  onInitialDataConsumed,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });

  const panRef = useRef({
    active: false,
    moved: false,
    start: { x: 0, y: 0 },
    vpStart: { x: 0, y: 0, scale: 1 },
  });

  const boundsRef = useRef<{
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
  } | null>(null);

  const boundaryRef = useRef(boundary);
  const maskEnabledRef = useRef(isMaskEnabled);
  useEffect(() => {
    boundaryRef.current = boundary;
  }, [boundary]);
  useEffect(() => {
    maskEnabledRef.current = isMaskEnabled;
  }, [isMaskEnabled]);

  const segmentsRef = useRef<Record<string, RawSegment[]>>({});
  const layersRef = useRef<DxfLayerData[]>([]);
  const cableSpansRef = useRef<CableSpan[]>([]);

  // UPDATED TO ARRAY FOR MULTIPLE LAYERS
  const cableLayersRef = useRef<string[]>([]);

  const hoveredSpanRef = useRef<number | null>(null);
  const hoveredPoleRef = useRef<number | null>(null);
  const selectedSpanRef = useRef<number | null>(null);
  const cableStatusRef = useRef<Record<number, CableRecoveryStatus>>({});
  // Teardown state from twinbackend, keyed by span_key rather than the
  // positional span_id — that number changes whenever spans are re-derived,
  // which is how status colours used to land on the wrong line.
  const teardownStatusRef = useRef<Record<string, TeardownStatus>>({});
  const polePhaseRef = useRef<Record<number, TeardownStatus>>({});
  const asbuiltNodeIdRef = useRef<number | null>(null);
  const lastSyncAtRef = useRef<number>(0);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<{
    matched: number;
    unmatched: number;
    at: Date;
  } | null>(null);
  const ocrMeterValuesRef = useRef<{ x: number; y: number; value: number }[]>(
    [],
  );
  const splitHistoryRef = useRef<
    { prev: CableSpan[]; prevDeleted?: DeletedSpanData[] }[]
  >([]);
  const fileCacheRef = useRef<Record<string, FileDataCache>>({});
  const nextSpanIdRef = useRef<number>(1);
  const exportPdfFnRef = useRef<(() => void) | null>(null);
  const poleBreakFingerprintRef = useRef<string>("");

  const hasAutoConnectedRef = useRef(false);
  const autoConnectPolesRef = useRef<
    (options?: { preserveExistingAssignments?: boolean }) => void
  >(() => {});

  useEffect(() => {
    if (onExportPdfRef) {
      onExportPdfRef.current = () => exportPdfFnRef.current?.();
    }
  }, [onExportPdfRef]);

  const [partialDetails, setPartialDetails] = useState<
    Record<number, PartialDetail>
  >({});
  const deletedSpansRef = useRef<DeletedSpanData[]>([]);
  const [deletedSpans, setDeletedSpans] = useState<DeletedSpanData[]>([]);
  const [spanToDelete, setSpanToDelete] = useState<number | null>(null);
  const [showTrashPanel, setShowTrashPanel] = useState(false);

  const pairingModeRef = useRef(false);
  const pairedSpanIdsRef = useRef<number[]>([]);
  const [pairingMode, setPairingMode] = useState(false);
  const [mainPairingSpanId, setMainPairingSpanId] = useState<number | null>(
    null,
  );
  const [pairedSpanIds, setPairedSpanIds] = useState<number[]>([]);
  const [confirmPairingOpen, setConfirmPairingOpen] = useState(false);
  const multiActionRef = useRef<"runs" | "merge" | null>(null);
  const [multiAction, setMultiAction] = useState<"runs" | "merge" | null>(null);
  const [showChips, setShowChips] = useState(true);
  const showChipsRef = useRef(true);
  const [showActives, setShowActives] = useState(false);
  const [activesLoading, setActivesLoading] = useState(false);
  const showActivesRef = useRef(false);
  const activeShapesRef = useRef<any[]>([]);
  const activesPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showPoles, setShowPoles] = useState(false);
  const showPolesRef = useRef(false);
  const [poles, setPoles] = useState<PoleTag[]>([]);
  const polesRef = useRef<PoleTag[]>([]);
  const [poleScanStatus, setPoleScanStatus] = useState<string>("idle");
  const [poleConnectMode, setPoleConnectMode] = useState<
    "idle" | "from" | "to"
  >("idle");
  const poleConnectModeRef = useRef<"idle" | "from" | "to">("idle");
  const [poleEditMode, setPoleEditMode] = useState<"idle" | "add" | "delete">(
    "idle",
  );
  const poleEditModeRef = useRef<"idle" | "add" | "delete">("idle");
  const [autoCutMode, setAutoCutMode] = useState<"idle" | "pickSpan" | "pickPole">(
    "idle",
  );
  const autoCutModeRef = useRef<"idle" | "pickSpan" | "pickPole">("idle");
  const [cutHereMode, setCutHereMode] = useState(false);
  const cutHereModeRef = useRef(false);
  const pendingAutoCutRef = useRef<{
    spanId: number;
    sourceSpanId: number;
    cutPoleIds: number[];
  } | null>(null);

  const [cableSpans, setCableSpans] = useState<CableSpan[]>([]);
  const [layers, setLayers] = useState<DxfLayerData[]>([]);
  const [layerPanelOpen, setLayerPanelOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [cableDataVersion, setCableDataVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSpanId, setHoveredSpanId] = useState<number | null>(null);
  const [hoveredPoleId, setHoveredPoleId] = useState<number | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<number | null>(null);
  const [autoCutNotice, setAutoCutNotice] = useState<string | null>(null);
  const autoCutNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // UPDATED TO ARRAY FOR MULTIPLE LAYERS
  const [cableLayerNames, setCableLayerNames] = useState<string[]>([]);

  const [cableStatuses, setCableStatuses] = useState<
    Record<number, CableRecoveryStatus>
  >({});

  const showAutoCutNotice = useCallback((message: string) => {
    setAutoCutNotice(message);
    if (autoCutNoticeTimerRef.current) {
      clearTimeout(autoCutNoticeTimerRef.current);
    }
    autoCutNoticeTimerRef.current = setTimeout(() => {
      setAutoCutNotice(null);
      autoCutNoticeTimerRef.current = null;
    }, 2600);
  }, []);

  const ensureGeoToolLayer = useCallback((poleList: PoleTag[]) => {
    const hasGeoToolNpt = poleList.some(
      (pole) => pole.layer === "geotool_npt" || pole.source === "geotool_npt",
    );
    if (!hasGeoToolNpt) return;

    const hasGeoLayer = layersRef.current.some(
      (layer) => layer.name === "geotool_npt",
    );
    if (!hasGeoLayer) {
      const geoLayer: DxfLayerData = {
        name: "geotool_npt",
        visible: true,
        color: "#f59e0b",
        segmentCount: poleList.filter(
          (pole) => pole.layer === "geotool_npt" || pole.source === "geotool_npt",
        ).length,
      };
      layersRef.current = [...layersRef.current, geoLayer];
      setLayers([...layersRef.current]);
    }
  }, []);

  function mergeBackendGeoPoles(backendTags: PoleTag[]) {
    const incoming = backendTags.filter(
      (tag) =>
        tag.layer === "geotool_npt" ||
        tag.source === "geotool_npt" ||
        (tag.map_latitude != null && tag.map_longitude != null),
    );
    if (!incoming.length) return false;

    const coordKey = (pole: { cx: number; cy: number }) =>
      `${pole.cx.toFixed(4)},${pole.cy.toFixed(4)}`;

    const nextPoles = [...polesRef.current];
    const byId = new Map<number, number>();
    const byCoord = new Map<string, number>();
    nextPoles.forEach((pole, idx) => {
      byId.set(pole.pole_id, idx);
      byCoord.set(coordKey(pole), idx);
    });

    let changed = false;

    incoming.forEach((tag) => {
      const idx = byId.get(tag.pole_id) ?? byCoord.get(coordKey(tag));
      if (idx == null) {
        nextPoles.push(tag);
        const newIdx = nextPoles.length - 1;
        byId.set(tag.pole_id, newIdx);
        byCoord.set(coordKey(tag), newIdx);
        changed = true;
        return;
      }

      const existing = nextPoles[idx];
      const merged = {
        ...existing,
        ...tag,
        name: tag.name || existing.name,
        layer: tag.layer || existing.layer,
        source: tag.source || existing.source,
        map_latitude: tag.map_latitude ?? existing.map_latitude,
        map_longitude: tag.map_longitude ?? existing.map_longitude,
      };

      if (
        merged.name !== existing.name ||
        merged.layer !== existing.layer ||
        merged.source !== existing.source ||
        merged.cx !== existing.cx ||
        merged.cy !== existing.cy ||
        merged.map_latitude !== existing.map_latitude ||
        merged.map_longitude !== existing.map_longitude
      ) {
        nextPoles[idx] = merged;
        byCoord.set(coordKey(merged), idx);
        changed = true;
      }
    });

    const hasGeoToolNpt = nextPoles.some(
      (pole) => pole.layer === "geotool_npt" || pole.source === "geotool_npt",
    );
    const dedupedPoles = hasGeoToolNpt
      ? nextPoles.filter(
          (pole) =>
            !(
              pole.name === "NPT" &&
              pole.source !== "geotool_npt" &&
              (pole.map_latitude == null || pole.map_longitude == null)
            ),
        )
      : nextPoles;

    if (dedupedPoles.length !== nextPoles.length) {
      changed = true;
    }
    if (!changed) return false;

    ensureGeoToolLayer(dedupedPoles);
    polesRef.current = dedupedPoles;
    setPoles(dedupedPoles);
    onCacheUpdate?.({ poleTags: dedupedPoles, poleDone: true });
    if (showPolesRef.current) redraw();
    return true;
  }

  const normalizeSpansToPoleBreaks = useCallback((
    spans: CableSpan[],
    options?: PoleBreakOptions,
  ) => {
    const CUT_TOLERANCE = 0.75;
    const ENDPOINT_GUARD = 0.2;
    const MIN_PART_LENGTH = 0.05;
    const targetSpanIds = options?.targetSpanIds
      ? new Set(options.targetSpanIds)
      : null;
    const anchorPoleIds = options?.anchorPoleIds
      ? new Set(options.anchorPoleIds)
      : null;
    const anchorPoint = options?.anchorPoint ?? null;
    const anchorRadius = options?.anchorRadius ?? 140;
    const preserveExistingAssignments =
      options?.preserveExistingAssignments === true;

    const getNearestMeterValue = (cx: number, cy: number) => {
      let nearest: { x: number; y: number; value: number } | null = null;
      let minDist = Infinity;
      for (const v of ocrMeterValuesRef.current) {
        const dist = Math.hypot(cx - v.x, cy - v.y);
        if (dist < minDist) {
          minDist = dist;
          nearest = v;
        }
      }
      return nearest ? nearest.value : null;
    };

    let changed = false;
    const normalized: CableSpan[] = [];
    const nextStatuses = { ...cableStatusRef.current };
    const nextPartialDetails = { ...partialDetails };
    let statusChanged = false;
    let partialChanged = false;

    for (const span of spans) {
      const matchesTarget =
        !targetSpanIds ||
        targetSpanIds.has(span.span_id) ||
        (span.source_span_id != null && targetSpanIds.has(span.source_span_id));
      if (!matchesTarget) {
        normalized.push(span);
        continue;
      }

      if (
        preserveExistingAssignments &&
        (span.from_pole_id != null || span.from_pole) &&
        (span.to_pole_id != null || span.to_pole)
      ) {
        normalized.push(span);
        continue;
      }

      if (span.segments.length === 0) {
        normalized.push(span);
        continue;
      }

      const visibleSegments = spanVisibleSegments(span);
      const orderedSegments = orderConnectedSegments(span.segments);
      const endpoints = getOrderedSpanEndpoints(visibleSegments);
      if (!endpoints) {
        normalized.push(span);
        continue;
      }

      const [endpointA, endpointB] = endpoints;
      const totalLength = orderedSegments.reduce(
        (sum, seg) => sum + Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1),
        0,
      );
      if (totalLength < MIN_PART_LENGTH * 2) {
        normalized.push(span);
        continue;
      }

      const cuts: Array<{
        segmentIndex: number;
        t: number;
        x: number;
        y: number;
        progress: number;
        pole: PoleTag;
      }> = [];

      for (const pole of polesRef.current) {
        if (
          maskEnabledRef.current &&
          boundaryRef.current &&
          !isPointInPolygon(pole.cx, pole.cy, boundaryRef.current)
        ) {
          continue;
        }

        if (
          pole.pole_id === span.from_pole_id ||
          pole.pole_id === span.to_pole_id
        ) {
          continue;
        }

        if (anchorPoint || anchorPoleIds) {
          const isExplicitAnchor = anchorPoleIds?.has(pole.pole_id) ?? false;
          const isNearAnchor = anchorPoint
            ? Math.hypot(pole.cx - anchorPoint.x, pole.cy - anchorPoint.y) <=
              anchorRadius
            : false;
          if (!isExplicitAnchor && !isNearAnchor) {
            continue;
          }
        }

        const distToA = Math.hypot(pole.cx - endpointA.pt.x, pole.cy - endpointA.pt.y);
        const distToB = Math.hypot(pole.cx - endpointB.pt.x, pole.cy - endpointB.pt.y);
        if (distToA < ENDPOINT_GUARD || distToB < ENDPOINT_GUARD) {
          continue;
        }

        const isExplicitAnchor = anchorPoleIds?.has(pole.pole_id) ?? false;
        const maxCutDistance = isExplicitAnchor
          ? Math.max(CUT_TOLERANCE, 1.5)
          : CUT_TOLERANCE;
        const visibleProjection = projectPointOntoPath(
          pole.cx,
          pole.cy,
          orderConnectedSegments(visibleSegments),
        );
        if (!visibleProjection || visibleProjection.distance > maxCutDistance) {
          continue;
        }

        const pathProjection = projectPointOntoPath(
          pole.cx,
          pole.cy,
          orderedSegments,
        );
        if (
          !pathProjection ||
          pathProjection.progress <= ENDPOINT_GUARD ||
          totalLength - pathProjection.progress <= ENDPOINT_GUARD
        ) {
          continue;
        }

        const best = { ...pathProjection, pole };
        // Do NOT reject cuts that land near a segment endpoint. Poles very often
        // sit exactly on a polyline vertex/junction (t≈0 or t≈1). The span-level
        // ENDPOINT_GUARD above already keeps cuts away from the span's two ends, so
        // a vertex cut here is valid — and is exactly what lets a junction pole
        // split the cable.
        cuts.push(best);
      }

      if (!cuts.length) {
        normalized.push(span);
        continue;
      }

      cuts.sort((a, b) => a.progress - b.progress);
      const uniqueCuts = cuts.filter((cut, index) => {
        if (index === 0) return true;
        const prev = cuts[index - 1];
        return (
          cut.segmentIndex !== prev.segmentIndex ||
          Math.abs(cut.t - prev.t) > 0.05 ||
          Math.abs(cut.progress - prev.progress) > ENDPOINT_GUARD / 2
        );
      });

      const cutsBySegment = new Map<number, typeof uniqueCuts>();
      uniqueCuts.forEach((cut) => {
        const existing = cutsBySegment.get(cut.segmentIndex) ?? [];
        existing.push(cut);
        cutsBySegment.set(cut.segmentIndex, existing);
      });

      const partSegments: RawSegment[][] = [];
      const boundaryPoles: PoleTag[] = [];
      let currentPart: RawSegment[] = [];

      for (let i = 0; i < orderedSegments.length; i++) {
        const seg = orderedSegments[i];
        const segCuts = [...(cutsBySegment.get(i) ?? [])].sort(
          (a, b) => a.t - b.t,
        );

        let startX = seg.x1;
        let startY = seg.y1;

        for (const cut of segCuts) {
          if (Math.hypot(cut.x - startX, cut.y - startY) >= MIN_PART_LENGTH) {
            currentPart.push({
              x1: startX,
              y1: startY,
              x2: cut.x,
              y2: cut.y,
            });
          }
          if (currentPart.length > 0) {
            partSegments.push(currentPart);
            currentPart = [];
          }
          boundaryPoles.push(cut.pole);
          startX = cut.x;
          startY = cut.y;
        }

        if (
          Math.hypot(seg.x2 - startX, seg.y2 - startY) >= MIN_PART_LENGTH
        ) {
          currentPart.push({
            x1: startX,
            y1: startY,
            x2: seg.x2,
            y2: seg.y2,
          });
        }
      }

      if (currentPart.length > 0) {
        partSegments.push(currentPart);
      }

      if (partSegments.length < 2) {
        normalized.push(span);
        continue;
      }

      changed = true;
      const prevStatus = cableStatusRef.current[span.span_id];
      if (prevStatus) {
        delete nextStatuses[span.span_id];
        statusChanged = true;
      }
      if (partialDetails[span.span_id]) {
        delete nextPartialDetails[span.span_id];
        partialChanged = true;
      }

      partSegments.forEach((segments, index) => {
        const metrics = computeSpanMetrics(segments);
        const newSpanId = nextSpanIdRef.current++;
        const isFirst = index === 0;
        const isLast = index === partSegments.length - 1;
        const boundaryFromPole = !isFirst ? boundaryPoles[index - 1] : null;
        const boundaryToPole = !isLast ? boundaryPoles[index] : null;
        const newSpan: CableSpan = {
          ...span,
          span_id: newSpanId,
          source_span_id: span.source_span_id ?? span.span_id,
          segments,
          display_segments: displaySegmentsForLogicalSegments(
            span.display_segments,
            segments,
          ),
          segment_count: segments.length,
          from_pole: isFirst
            ? span.from_pole
            : boundaryFromPole?.name ?? undefined,
          to_pole: isLast
            ? span.to_pole
            : boundaryToPole?.name ?? undefined,
          from_pole_id: isFirst
            ? span.from_pole_id
            : boundaryFromPole?.pole_id,
          to_pole_id: isLast
            ? span.to_pole_id
            : boundaryToPole?.pole_id,
          ...metrics,
          meterValue: getNearestMeterValue(metrics.cx, metrics.cy),
        };
        normalized.push(newSpan);

        if (prevStatus) {
          nextStatuses[newSpanId] = prevStatus;
          statusChanged = true;
        }
        if (prevStatus === "Partial" && partialDetails[span.span_id]) {
          nextPartialDetails[newSpanId] = { ...partialDetails[span.span_id] };
          partialChanged = true;
        }
      });
    }

    if (statusChanged) {
      cableStatusRef.current = nextStatuses;
      setCableStatuses(nextStatuses);
    }
    if (partialChanged) {
      setPartialDetails(nextPartialDetails);
    }

    return { spans: normalized, changed };
  }, [partialDetails]);

  // Helper to notify parent of span changes
  const notifySpansChange = useCallback(
    (spans: CableSpan[]) => {
      if (!onSpansChange) return;
      const exportSpans = collapseCableSpansForExport(spans, polesRef.current);
      onSpansChange(exportSpans);
    },
    [onSpansChange],
  );

  const isLayerVisible = useCallback((name: string | null) => {
    if (!name) return false;
    return !!layersRef.current.find((l) => l.name === name)?.visible;
  }, []);

  // Compute Totals Respecting Boundary Mask AND Visibility
  const computeCableLengthSummary = () => {
    let totalRecovered = 0,
      totalUnrecovered = 0,
      totalMissing = 0,
      totalLength = 0,
      totalStrandLength = 0;

    for (const span of cableSpansRef.current) {
      if (!isLayerVisible(span.layer)) continue;

      if (
        isMaskEnabled &&
        boundary &&
        !isPointInPolygon(span.cx, span.cy, boundary)
      )
        continue;

      const runs = span.cable_runs || 1;
      const strandLength = span.meterValue ?? span.total_length ?? 0;
      const actualLength = strandLength * runs;

      totalStrandLength += strandLength;
      totalLength += actualLength;

      const status = cableStatuses[span.span_id];
      if (status === "Recovered") {
        totalRecovered += strandLength * runs;
      } else if (status === "Missing") {
        totalMissing += strandLength * runs;
      } else if (status === "Partial") {
        const detail = partialDetails[span.span_id] ?? { recovered: 0 };
        const safeRecovered = Math.min(detail.recovered ?? 0, strandLength);
        const calcUnrecovered = strandLength - safeRecovered;
        totalRecovered += safeRecovered * runs;
        totalUnrecovered += calcUnrecovered * runs;
      }
    }
    return {
      totalRecovered,
      totalUnrecovered,
      totalMissing,
      totalLength,
      totalStrandLength,
    };
  };

  const {
    totalRecovered,
    totalUnrecovered,
    totalMissing,
    totalLength,
    totalStrandLength,
  } = computeCableLengthSummary();

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const vp = vpRef.current;
    return { x: (sx - vp.x) / vp.scale, y: -(sy - vp.y) / vp.scale };
  }, []);

  const renderScene = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      vp: Viewport,
      width: number,
      height: number,
      opts: {
        showChips: boolean;
        showHover: boolean;
        showActives: boolean;
        showPoles: boolean;
      },
    ) => {
      ctx.clearRect(0, 0, width, height);

      const worldToScreenLocal = (wx: number, wy: number) => ({
        x: wx * vp.scale + vp.x,
        y: -wy * vp.scale + vp.y,
      });

      const isMaskOn = maskEnabledRef.current;
      const currentBoundary = boundaryRef.current;

      ctx.save();
      ctx.translate(vp.x, vp.y);
      ctx.scale(vp.scale, -vp.scale);

      // 1. Draw base DXF layers (We don't mask raw geometry, only the entities)
      for (const layer of layersRef.current) {
        if (!layer.visible) continue;
        const segs = segmentsRef.current[layer.name] ?? [];
        if (!segs.length) continue;

        ctx.strokeStyle = layer.color;
        ctx.lineWidth = 0.8 / vp.scale;
        ctx.beginPath();
        for (const s of segs) {
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
        }
        ctx.stroke();
      }

      // Draw the Boundary Polygon
      if (isMaskOn && currentBoundary && currentBoundary.length > 2) {
        ctx.save();
        ctx.strokeStyle = "rgba(16, 185, 129, 0.8)";
        ctx.lineWidth = 2.5 / vp.scale;
        ctx.setLineDash([15 / vp.scale, 10 / vp.scale]);

        ctx.beginPath();
        ctx.moveTo(currentBoundary[0].x, currentBoundary[0].y);
        for (let i = 1; i < currentBoundary.length; i++) {
          ctx.lineTo(currentBoundary[i].x, currentBoundary[i].y);
        }
        ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = "rgba(16, 185, 129, 0.02)";
        ctx.fill();
        ctx.restore();
      }

      // 2. Draw active cable spans highlights
      if (cableLayersRef.current.length > 0) {
        const spans = cableSpansRef.current;
        const spanMap = new Map(spans.map((s) => [s.span_id, s]));
        const highlightedPoles = new Map<
          number,
          { fill: string; stroke: string; text: string }
        >();
        const statusEntries = Object.entries(cableStatusRef.current);

        const drawSpanPath = (span: CableSpan) => {
          drawSolidSegments(ctx, span.segments);
        };

        // Teardown status, straight from twinbackend. Drawn before the recovery
        // pass so a manual recovery mark still shows on top when there is one,
        // and it colours both end poles as well as the line — a pole turns red
        // only once the backend says every span on it is done.
        for (const span of cableSpansRef.current) {
          const key = span.span_key;
          if (!key) continue;
          const status = teardownStatusRef.current[key];
          if (!status || !isLayerVisible(span.layer)) continue;
          if (
            isMaskOn &&
            currentBoundary &&
            !isPointInPolygon(span.cx, span.cy, currentBoundary)
          )
            continue;

          const style = getTeardownStyle(status);
          const runs = span.cable_runs || 1;

          ctx.save();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = style.marker;
          ctx.lineWidth = (9.5 + (runs - 1) * 12) / vp.scale;
          drawSpanPath(span);
          ctx.stroke();
          ctx.strokeStyle = style.stroke;
          ctx.lineWidth = 2.2 / vp.scale;
          drawSpanPath(span);
          ctx.stroke();
          ctx.restore();

          for (const poleId of [span.from_pole_id, span.to_pole_id]) {
            if (poleId == null) continue;
            const poleStatus = polePhaseRef.current[poleId] ?? status;
            highlightedPoles.set(poleId, getTeardownStyle(poleStatus).pole);
          }
        }

        // Render statuses
        for (const [idStr, status] of statusEntries) {
          const spanId = Number(idStr);
          const span = spanMap.get(spanId);
          if (!span || !isLayerVisible(span.layer)) continue;

          // SKIP IF OUTSIDE BOUNDARY
          if (
            isMaskOn &&
            currentBoundary &&
            !isPointInPolygon(span.cx, span.cy, currentBoundary)
          )
            continue;

          const style = getStatusStyle(status);
          const runs = span.cable_runs || 1;
          const markerWidth = (9.5 + (runs - 1) * 12) / vp.scale;

          ctx.save();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = style.marker;
          ctx.lineWidth = markerWidth;
          drawSpanPath(span);
          ctx.stroke();
          ctx.restore();

          ctx.save();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = style.stroke;
          ctx.lineWidth = 1.8 / vp.scale;
          drawSpanPath(span);
          ctx.stroke();
          ctx.restore();
        }

        // Selected Span Emphasis
        if (opts.showHover && selectedSpanRef.current !== null) {
          const span = spanMap.get(selectedSpanRef.current);
          if (
            span &&
            isLayerVisible(span.layer) &&
            !(
              isMaskOn &&
              currentBoundary &&
              !isPointInPolygon(span.cx, span.cy, currentBoundary)
            )
          ) {
            const selectedStatus =
              cableStatusRef.current[selectedSpanRef.current];
            const style = selectedStatus
              ? getStatusStyle(selectedStatus)
              : {
                  marker: "rgba(59, 130, 246, 0.18)",
                  stroke: "rgba(37, 99, 235, 0.95)",
                };
            const poleStyle = {
              fill: selectedStatus
                ? style.marker.replace(/0\.\d+\)/, "0.9)")
                : "rgba(59, 130, 246, 0.85)",
              stroke: style.stroke,
              text: selectedStatus ? style.stroke : "#1d4ed8",
            };
            const runs = span.cable_runs || 1;
            const markerWidth = (12 + (runs - 1) * 12) / vp.scale;

            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = style.marker;
            ctx.lineWidth = markerWidth;
            drawSpanPath(span);
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = 2.8 / vp.scale;
            drawSpanPath(span);
            ctx.stroke();
            ctx.restore();

            if (span.from_pole_id != null) {
              highlightedPoles.set(span.from_pole_id, poleStyle);
            }
            if (span.to_pole_id != null) {
              highlightedPoles.set(span.to_pole_id, poleStyle);
            }
          }
        }

        // Pairing / Merge mode highlights
        if (opts.showHover && pairingModeRef.current) {
          for (const pid of pairedSpanIdsRef.current) {
            const span = spanMap.get(pid);

            if (
              span &&
              isLayerVisible(span.layer) &&
              !(
                isMaskOn &&
                currentBoundary &&
                !isPointInPolygon(span.cx, span.cy, currentBoundary)
              )
            ) {
              ctx.save();
              ctx.lineCap = "round";
              ctx.lineJoin = "round";

              if (multiActionRef.current === "runs") {
                ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
                ctx.lineWidth = 10 / vp.scale;
                drawSpanPath(span);
                ctx.stroke();

                ctx.strokeStyle = "rgba(147, 51, 234, 0.95)";
                ctx.lineWidth = 2.4 / vp.scale;
                drawSpanPath(span);
                ctx.stroke();
              } else {
                ctx.strokeStyle = "rgba(59, 130, 246, 0.6)";
                ctx.lineWidth = 10 / vp.scale;
                drawSpanPath(span);
                ctx.stroke();

                ctx.strokeStyle = "rgba(37, 99, 235, 0.95)";
                ctx.lineWidth = 2.4 / vp.scale;
                drawSpanPath(span);
                ctx.stroke();
              }

              ctx.restore();
            }
          }
        }

        // Hover Effect
        if (
          opts.showHover &&
          hoveredSpanRef.current !== null &&
          hoveredSpanRef.current !== selectedSpanRef.current &&
          !pairedSpanIdsRef.current.includes(hoveredSpanRef.current)
        ) {
          const span = spanMap.get(hoveredSpanRef.current);
          if (
            span &&
            isLayerVisible(span.layer) &&
            !(
              isMaskOn &&
              currentBoundary &&
              !isPointInPolygon(span.cx, span.cy, currentBoundary)
            )
          ) {
            const poleStyle = {
              fill: "rgba(245, 158, 11, 0.9)",
              stroke: "#f59e0b",
              text: "#b45309",
            };
            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
            ctx.lineWidth = (2.4 + ((span.cable_runs || 1) - 1) * 4) / vp.scale;
            drawSpanPath(span);
            ctx.stroke();
            ctx.restore();

            if (span.from_pole_id != null) {
              highlightedPoles.set(span.from_pole_id, poleStyle);
            }
            if (span.to_pole_id != null) {
              highlightedPoles.set(span.to_pole_id, poleStyle);
            }
          }
        }

        // 4. Draw Poles
        if (opts.showPoles) {
          ctx.save();
          const r = 12 / vp.scale;
          for (const pole of polesRef.current) {
            if (!isLayerVisible(pole.layer)) continue;

            if (
              isMaskOn &&
              currentBoundary &&
              !isPointInPolygon(pole.cx, pole.cy, currentBoundary)
            )
              continue;

            const highlight = highlightedPoles.get(pole.pole_id);
            const isHoveredPole = hoveredPoleRef.current === pole.pole_id;
            const fillStyle = isHoveredPole
              ? "rgba(59, 130, 246, 0.92)"
              : (highlight?.fill ?? "rgba(245, 158, 11, 0.85)");
            const strokeStyle = isHoveredPole
              ? "#dbeafe"
              : (highlight?.stroke ?? "#fff");
            const textStyle = isHoveredPole
              ? "#1d4ed8"
              : (highlight?.text ?? "#d97706");

            ctx.beginPath();
            ctx.arc(pole.cx, pole.cy, r, 0, 2 * Math.PI);
            ctx.fillStyle = fillStyle;
            ctx.fill();
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = (isHoveredPole ? 4 : highlight ? 3 : 2) / vp.scale;
            ctx.stroke();

            // Force the pole label to render at all useful zoom levels so
            // inserted NPTs never show as a bare, unreadable circle.
            if (vp.scale > 0.05) {
              ctx.save();
              ctx.translate(pole.cx, pole.cy + r * 1.2);
              ctx.scale(1, -1);
              ctx.fillStyle = textStyle;
              ctx.font = `bold ${Math.max(0.2, 0.5 / vp.scale)}px monospace`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(pole.name || `POLE_${pole.pole_id}`, 0, 0);
              ctx.restore();
            }
          }
          ctx.restore();
        }
      } else if (opts.showPoles) {
        ctx.save();
        const r = 12 / vp.scale;
        for (const pole of polesRef.current) {
          if (!isLayerVisible(pole.layer)) continue;

          if (
            isMaskOn &&
            currentBoundary &&
            !isPointInPolygon(pole.cx, pole.cy, currentBoundary)
          )
            continue;

          const isHoveredPole = hoveredPoleRef.current === pole.pole_id;
          ctx.beginPath();
          ctx.arc(pole.cx, pole.cy, r, 0, 2 * Math.PI);
          ctx.fillStyle = isHoveredPole
            ? "rgba(59, 130, 246, 0.92)"
            : "rgba(245, 158, 11, 0.85)";
          ctx.fill();
          ctx.strokeStyle = isHoveredPole ? "#dbeafe" : "#fff";
          ctx.lineWidth = (isHoveredPole ? 4 : 2) / vp.scale;
          ctx.stroke();

          // Force the pole label to render at all useful zoom levels.
          if (vp.scale > 0.05) {
            ctx.save();
            ctx.translate(pole.cx, pole.cy + r * 1.2);
            ctx.scale(1, -1);
            ctx.fillStyle = isHoveredPole ? "#1d4ed8" : "#d97706";
            ctx.font = `bold ${Math.max(0.2, 0.5 / vp.scale)}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(pole.name || `POLE_${pole.pole_id}`, 0, 0);
            ctx.restore();
          }
        }
        ctx.restore();
      }
      // 3. Draw Equipment Actives
      if (opts.showActives) {
        ctx.save();
        for (const shape of activeShapesRef.current) {
          if (!isLayerVisible(shape.layer)) continue;

          // SKIP IF OUTSIDE BOUNDARY
          if (
            isMaskOn &&
            currentBoundary &&
            !isPointInPolygon(
              shape.cx ?? shape.bbox[0],
              shape.cy ?? shape.bbox[1],
              currentBoundary,
            )
          )
            continue;

          const str = `${shape.kind} ${shape.layer}`.toLowerCase();
          let fillColor = "rgba(156, 163, 175, 0.4)",
            strokeColor = "rgba(100, 116, 139, 0.9)";
          if (str.includes("extender")) {
            fillColor = "rgba(239, 68, 68, 0.4)";
            strokeColor = "rgba(220, 38, 38, 0.9)";
          } else if (str.includes("amp")) {
            fillColor = "rgba(249, 115, 22, 0.4)";
            strokeColor = "rgba(234, 88, 12, 0.9)";
          } else if (str.includes("node")) {
            fillColor = "rgba(59, 130, 246, 0.4)";
            strokeColor = "rgba(37, 99, 235, 0.9)";
          }

          ctx.fillStyle = fillColor;
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 2.5 / vp.scale;

          if (shape.points?.length > 0) {
            ctx.beginPath();
            ctx.moveTo(shape.points[0][0], shape.points[0][1]);
            for (let i = 1; i < shape.points.length; i++)
              ctx.lineTo(shape.points[i][0], shape.points[i][1]);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else if (shape.bbox) {
            const [minx, miny, maxx, maxy] = shape.bbox;
            ctx.fillRect(minx, miny, maxx - minx, maxy - miny);
            ctx.strokeRect(minx, miny, maxx - minx, maxy - miny);
          }
        }
        ctx.restore();
      }

      ctx.restore();

      // 5. Draw Chips (Screen space)
      if (opts.showChips) {
        for (const span of cableSpansRef.current) {
          if (!isLayerVisible(span.layer)) continue;

          // SKIP IF OUTSIDE BOUNDARY
          if (
            isMaskOn &&
            currentBoundary &&
            !isPointInPolygon(span.cx, span.cy, currentBoundary)
          )
            continue;

          const status = cableStatusRef.current[span.span_id];
          if (!status) continue;

          const style = getStatusStyle(status);
          const anchor = worldToScreenLocal(span.cx, span.cy);
          const paddingX = 8,
            paddingY = 5,
            fontSize = 11;

          ctx.save();
          ctx.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
          const textWidth = ctx.measureText(status).width;
          const chipW = textWidth + paddingX * 2,
            chipH = fontSize + paddingY * 2;
          let chipX = Math.max(
            8,
            Math.min(anchor.x - chipW / 2, width - chipW - 8),
          );
          let chipY = Math.max(
            8,
            Math.min(anchor.y - chipH - 8, height - chipH - 8),
          );

          ctx.fillStyle = style.chipFill;
          ctx.strokeStyle = style.chipBorder;
          ctx.lineWidth = 1;
          drawRoundedRect(ctx, chipX, chipY, chipW, chipH, 8);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = style.chipText;
          ctx.textBaseline = "middle";
          ctx.fillText(status, chipX + paddingX, chipY + chipH / 2);
          ctx.restore();
        }
      }
    },
    [isLayerVisible],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderScene(ctx, vpRef.current, canvas.width, canvas.height, {
      showChips: showChipsRef.current,
      showHover: true,
      showActives: showActivesRef.current,
      showPoles: showPolesRef.current,
    });
  }, [renderScene]);

  const applyPoleBreakNormalization = useCallback(
    (
      options?: PoleBreakOptions & {
        autoConnectAfter?: boolean;
        preserveExistingAssignments?: boolean;
      },
    ) => {
      if (!cableSpansRef.current.length) {
        if (options?.autoConnectAfter) {
          autoConnectPolesRef.current({
            preserveExistingAssignments: options.preserveExistingAssignments,
          });
        }
        return false;
      }

      const { spans: normalizedSpans, changed } = normalizeSpansToPoleBreaks(
        cableSpansRef.current,
        {
          targetSpanIds: options?.targetSpanIds ?? null,
          anchorPoint: options?.anchorPoint ?? null,
          anchorPoleIds: options?.anchorPoleIds ?? null,
          anchorRadius: options?.anchorRadius,
          preserveExistingAssignments: options?.preserveExistingAssignments,
        },
      );

      if (changed) {
        cableSpansRef.current = normalizedSpans;
        setCableSpans(normalizedSpans);
        notifySpansChange(normalizedSpans);
        hoveredSpanRef.current = null;
        selectedSpanRef.current = null;
        setHoveredSpanId(null);
        setSelectedSpanId(null);
        cancelMultiAction();
        redraw();
      }

      if (options?.autoConnectAfter) {
        setTimeout(() => {
          autoConnectPolesRef.current({
            preserveExistingAssignments: options.preserveExistingAssignments,
          });
        }, 0);
      }

      return changed;
    },
    [normalizeSpansToPoleBreaks, notifySpansChange, redraw],
  );

    const applyPoleUpdate = useCallback(
      (
        action: "ADD" | "UPDATE" | "DELETE",
        pole: Partial<PoleTag> & { pole_id: number },
      options?: {
        autoConnectAfter?: boolean;
        preserveExistingAssignments?: boolean;
      },
      ) => {
      let updatedPoles = [...polesRef.current];

      if (action === "ADD") {
        updatedPoles.push(pole as PoleTag);
      } else if (action === "UPDATE") {
        updatedPoles = updatedPoles.map((p) =>
          p.pole_id === pole.pole_id ? { ...p, ...pole } : p,
        );

        if (pole.name) {
          const renamedId = pole.pole_id;
          const newSpans = cableSpansRef.current.map((span) => {
            let updated = { ...span };
            if (updated.from_pole_id === renamedId) updated.from_pole = pole.name;
            if (updated.to_pole_id === renamedId) updated.to_pole = pole.name;
            return updated;
          });
          cableSpansRef.current = newSpans;
          setCableSpans(newSpans);
          notifySpansChange(newSpans);
        }
      } else if (action === "DELETE") {
        updatedPoles = updatedPoles.filter((p) => p.pole_id !== pole.pole_id);

        const deletedId = pole.pole_id;
        const newSpans = cableSpansRef.current.map((span) => {
          let updated = { ...span };
          if (updated.from_pole_id === deletedId) {
            updated.from_pole = undefined;
            updated.from_pole_id = undefined;
          }
          if (updated.to_pole_id === deletedId) {
            updated.to_pole = undefined;
            updated.to_pole_id = undefined;
          }
          return updated;
        });
        cableSpansRef.current = newSpans;
        setCableSpans(newSpans);
        notifySpansChange(newSpans);
      }

      ensureGeoToolLayer(updatedPoles);
      polesRef.current = updatedPoles;
      setPoles(updatedPoles);
      onCacheUpdate?.({ poleTags: updatedPoles, poleDone: true });

      if (options?.autoConnectAfter && cableSpansRef.current.length > 0) {
        hasAutoConnectedRef.current = false;
        applyPoleBreakNormalization({
          autoConnectAfter: true,
          preserveExistingAssignments: options.preserveExistingAssignments,
        });
      } else {
        redraw();
      }
    },
    [
      applyPoleBreakNormalization,
      ensureGeoToolLayer,
      notifySpansChange,
      onCacheUpdate,
      redraw,
    ],
  );

  const autoConnectPoles = useCallback((
    options?: { preserveExistingAssignments?: boolean },
  ) => {
    if (!polesRef.current.length || !cableSpansRef.current.length) return;
    const preserveExistingAssignments =
      options?.preserveExistingAssignments === true;
    const BUFFER_RADIUS = 30;
    const RAY_MAX_DIST = 150;
    const RAY_TOLERANCE = 15;

    const previousSpans = cableSpansRef.current.map((s) => ({ ...s }));
    const previousDeleted = deletedSpansRef.current.map((d) => ({ ...d }));
    const spansForConnection = cableSpansRef.current;

    const newSpans = spansForConnection.map((span) => {
      const hasExistingFrom = !!(span.from_pole_id != null || span.from_pole);
      const hasExistingTo = !!(span.to_pole_id != null || span.to_pole);
      if (preserveExistingAssignments && hasExistingFrom && hasExistingTo) {
        return span;
      }

      if (span.segments.length === 0) return span;
      const endpoints = findSpanEndpoints(span.segments);
      if (!endpoints) return span;
      const [endpointA, endpointB] = endpoints;
      const ptA = endpointA.pt;
      const ptA_in = endpointA.inward;
      const ptB = endpointB.pt;
      const ptB_in = endpointB.inward;

      const findPoleForEndpoint = (
        pt: { x: number; y: number },
        pt_in: { x: number; y: number },
      ): PoleTag | null => {
        let closestPole: PoleTag | null = null;
        let minDist = Infinity;

        for (const pole of polesRef.current) {
          if (
            maskEnabledRef.current &&
            boundaryRef.current &&
            !isPointInPolygon(pole.cx, pole.cy, boundaryRef.current)
          ) {
            continue;
          }

          const dist = Math.hypot(pole.cx - pt.x, pole.cy - pt.y);
          if (dist < BUFFER_RADIUS && dist < minDist) {
            minDist = dist;
            closestPole = pole;
          }
        }

        if (closestPole) return closestPole;

        if (pt.x === pt_in.x && pt.y === pt_in.y) return null;

        const angle = Math.atan2(pt.y - pt_in.y, pt.x - pt_in.x);
        const rayEndX = pt.x + Math.cos(angle) * RAY_MAX_DIST;
        const rayEndY = pt.y + Math.sin(angle) * RAY_MAX_DIST;
        closestPole = null;
        minDist = Infinity;

        for (const pole of polesRef.current) {
          if (
            maskEnabledRef.current &&
            boundaryRef.current &&
            !isPointInPolygon(pole.cx, pole.cy, boundaryRef.current)
          ) {
            continue;
          }

          const distToRay = pointToSegmentDistance(
            pole.cx,
            pole.cy,
            pt.x,
            pt.y,
            rayEndX,
            rayEndY,
          );
          if (distToRay < RAY_TOLERANCE) {
            const distToPole = Math.hypot(pole.cx - pt.x, pole.cy - pt.y);
            if (distToPole < minDist) {
              minDist = distToPole;
              closestPole = pole;
            }
          }
        }

        return closestPole;
      };

      const fromResult =
        preserveExistingAssignments && hasExistingFrom
          ? null
          : findPoleForEndpoint(ptA, ptA_in);
      const toResult =
        preserveExistingAssignments && hasExistingTo
          ? null
          : findPoleForEndpoint(ptB, ptB_in);

      return {
        ...span,
        from_pole: fromResult?.name ?? span.from_pole,
        from_pole_id: fromResult?.pole_id ?? span.from_pole_id,
        to_pole: toResult?.name ?? span.to_pole,
        to_pole_id: toResult?.pole_id ?? span.to_pole_id,
      };
    });

    splitHistoryRef.current.push({
      prev: previousSpans,
      prevDeleted: previousDeleted,
    });
    cableSpansRef.current = newSpans;
    setCableSpans(newSpans);
    notifySpansChange(newSpans);
    redraw();
  }, [redraw, notifySpansChange]);

  useEffect(() => {
    autoConnectPolesRef.current = autoConnectPoles;
  }, [autoConnectPoles]);

  /**
   * Pull teardown state for a node that has already been uploaded.
   *
   * Spans are matched on the unordered pole-index pair, which is byte-equal to
   * what the reader itself uploaded, so a span reported the other way round
   * still finds its line. Anything that fails to match is counted and shown
   * rather than quietly left uncoloured.
   */
  const syncTeardownStatus = useCallback(async (nodeDbId?: number) => {
    const nodeId = nodeDbId ?? asbuiltNodeIdRef.current;
    if (nodeId == null) return { matched: 0, unmatched: 0 };
    asbuiltNodeIdRef.current = nodeId;

    setSyncState("loading");
    try {
      const res = await fetch(`/api/v1/asbuilt/node/${nodeId}`);
      if (!res.ok) throw new Error(`Status sync failed (${res.status})`);
      const body = await res.json();
      const node = body?.data ?? body;

      const byKey = new Map<string, CableSpan>();
      for (const span of cableSpansRef.current) {
        if (span.span_key) byKey.set(span.span_key, span);
      }

      const spanStatuses: Record<string, TeardownStatus> = {};
      let matched = 0;
      let unmatched = 0;
      for (const remote of node?.spans ?? []) {
        const a = remote.from_pole_index;
        const b = remote.to_pole_index;
        if (!a || !b) {
          unmatched += 1;
          continue;
        }
        const key = a <= b ? `${a}::${b}` : `${b}::${a}`;
        if (!byKey.has(key)) {
          unmatched += 1;
          continue;
        }
        spanStatuses[key] = (remote.status ?? "pending") as TeardownStatus;
        matched += 1;
      }

      // Poles carry their own phase: cleared only once the backend has seen
      // every span on them finished, so a half-torn pole stays amber.
      const poleStatuses: Record<number, TeardownStatus> = {};
      const localByIndex = new Map<string, number>();
      for (const span of cableSpansRef.current) {
        if (span.from_pole_index && span.from_pole_id != null)
          localByIndex.set(span.from_pole_index, span.from_pole_id);
        if (span.to_pole_index && span.to_pole_id != null)
          localByIndex.set(span.to_pole_index, span.to_pole_id);
      }
      for (const remote of node?.poles ?? []) {
        const poleId = localByIndex.get(remote.pole_index);
        if (poleId == null) continue;
        poleStatuses[poleId] =
          remote.status === "completed"
            ? "completed"
            : remote.status === "in_progress"
              ? "in_progress"
              : "pending";
      }

      teardownStatusRef.current = spanStatuses;
      polePhaseRef.current = poleStatuses;
      setSyncState("idle");
      setSyncSummary({ matched, unmatched, at: new Date() });
      redraw();
      return { matched, unmatched };
    } catch (err) {
      setSyncState("error");
      setSyncError(err instanceof Error ? err.message : String(err));
      return { matched: 0, unmatched: 0 };
    }
  }, [redraw]);

  useEffect(() => {
    if (asbuiltNodeId == null) return;
    asbuiltNodeIdRef.current = asbuiltNodeId;
    lastSyncAtRef.current = Date.now();
    void syncTeardownStatus(asbuiltNodeId);
  }, [asbuiltNodeId, syncTeardownStatus]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (asbuiltNodeIdRef.current == null) return;
      const since = Date.now() - lastSyncAtRef.current;
      // Coming back to the tab is a good moment to refresh, but not a reason to
      // hammer the backend when the user is flicking between windows.
      if (since < 30_000) return;
      lastSyncAtRef.current = Date.now();
      void syncTeardownStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [syncTeardownStatus]);

  const toggleActives = async () => {
    if (showActives) {
      setShowActives(false);
      showActivesRef.current = false;
      redraw();
      return;
    }
    if (activeShapesRef.current.length > 0) {
      setShowActives(true);
      showActivesRef.current = true;
      redraw();
      return;
    }

    setActivesLoading(true);
    try {
      const res = await fetch("/api/scan_equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dxf_path: dxfPath, boundary_layer: null }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const poll = setInterval(async () => {
        try {
          const sres = await fetch("/api/scan_status");
          const sdata = await sres.json();
          if (sdata.status === "done") {
            clearInterval(poll);
            const rres = await fetch("/api/scan_results");
            const rdata = await rres.json();
            activeShapesRef.current = (rdata.shapes ?? []).filter((s: any) => {
              const str = `${s.kind} ${s.layer}`.toLowerCase();
              return (
                str.includes("amp") ||
                str.includes("node") ||
                str.includes("extender")
              );
            });
            setActivesLoading(false);
            setShowActives(true);
            showActivesRef.current = true;
            redraw();
          } else if (sdata.status === "error") {
            clearInterval(poll);
            setActivesLoading(false);
            console.error(sdata.error);
          }
        } catch (e) {}
      }, 600);
      activesPollRef.current = poll;
    } catch (err) {
      console.error(err);
      setActivesLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (activesPollRef.current) clearInterval(activesPollRef.current);
      if (autoCutNoticeTimerRef.current) {
        clearTimeout(autoCutNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/pole_tags");
        const data = await res.json();

        if (data.status) {
          if (data.status === "processing" || data.status === "idle") {
            hasAutoConnectedRef.current = false; // Reset lock for new scans
          }
          setPoleScanStatus(data.status);
        }

        // CRITICAL FIX: Only overwrite local poles if the backend is actively
        // processing a NEW scan, or on the exact moment it finishes.
        // Once finished, we ignore the backend tags so manual edits are preserved.
        if (
          data.status === "processing" ||
          (data.status === "done" && poleScanStatus !== "done")
        ) {
          if (data.tags) {
            ensureGeoToolLayer(data.tags);
            polesRef.current = data.tags;
            setPoles(data.tags);
            onCacheUpdate?.({
              poleTags: data.tags,
              poleDone: data.status === "done",
            });
            if (showPolesRef.current) redraw();
          }
        } else if (data.status === "done" && data.tags) {
          const merged = mergeBackendGeoPoles(data.tags);
          if (merged) {
            // autoConnectAfter so spans terminating at a freshly-merged NPT get
            // their from/to pole assigned (otherwise NPT spans stay unlabeled).
            applyPoleBreakNormalization({ autoConnectAfter: true });
          }
        }
      } catch (e) {}
    }, 2000);
    return () => clearInterval(poll);
  }, [
    ensureGeoToolLayer,
    applyPoleBreakNormalization,
    mergeBackendGeoPoles,
    onCacheUpdate,
    poleScanStatus,
    redraw,
  ]); // Added poleScanStatus to dependencies

  // ADD THIS NEW USEEFFECT
  useEffect(() => {
    if (
      poleScanStatus === "done" &&
      poles.length > 0 &&
      cableSpans.length > 0 &&
      !hasAutoConnectedRef.current
    ) {
      // 1. Lock immediately to prevent race conditions
      hasAutoConnectedRef.current = true;

      // 2. Use a slight timeout so the UI paints the loaded poles
      // before blocking the main thread with distance calculations
      setTimeout(() => {
        autoConnectPoles();
      }, 50);
    }
  }, [poleScanStatus, poles.length, cableSpans.length, autoConnectPoles]);

  const togglePoles = () => {
    const next = !showPoles;
    setShowPoles(next);
    showPolesRef.current = next;
    if (!next) {
      hoveredPoleRef.current = null;
      setHoveredPoleId(null);
      pendingAutoCutRef.current = null;
      autoCutModeRef.current = "idle";
      setAutoCutMode("idle");
      cutHereModeRef.current = false;
      setCutHereMode(false);
      poleEditModeRef.current = "idle";
      setPoleEditMode("idle");
    }
    redraw();
  };

  const setCableStatus = useCallback(
    (spanId: number, status: CableRecoveryStatus) => {
      cableStatusRef.current = { ...cableStatusRef.current, [spanId]: status };
      setCableStatuses(cableStatusRef.current);
      if (status === "Partial")
        setPartialDetails((prev) => {
          if (prev[spanId]) return prev;
          return { ...prev, [spanId]: { recovered: 0 } };
        });
      redraw();
    },
    [redraw],
  );

  const clearCableStatus = useCallback(
    (spanId: number) => {
      const next = { ...cableStatusRef.current };
      delete next[spanId];
      cableStatusRef.current = next;
      setCableStatuses(next);
      redraw();
    },
    [redraw],
  );

  const confirmDeleteSpan = useCallback(() => {
    if (spanToDelete === null) return;
    const targetSpan = cableSpansRef.current.find(
      (s) => s.span_id === spanToDelete,
    );
    if (!targetSpan) {
      setSpanToDelete(null);
      return;
    }
    splitHistoryRef.current.push({
      prev: cableSpansRef.current.map((s) => ({ ...s })),
      prevDeleted: deletedSpansRef.current.map((d) => ({ ...d })),
    });
    deletedSpansRef.current = [
      ...deletedSpansRef.current,
      {
        span: targetSpan,
        status: cableStatusRef.current[spanToDelete],
        partialDetail: partialDetails[spanToDelete],
      },
    ];
    setDeletedSpans(deletedSpansRef.current);
    const newSpans = cableSpansRef.current.filter(
      (s) => s.span_id !== spanToDelete,
    );
    cableSpansRef.current = newSpans;
    setCableSpans(newSpans);
    notifySpansChange(newSpans);
    setCableStatuses((prev) => {
      const next = { ...prev };
      delete next[spanToDelete];
      cableStatusRef.current = next;
      return next;
    });
    setPartialDetails((prev) => {
      const next = { ...prev };
      delete next[spanToDelete];
      return next;
    });
    if (selectedSpanRef.current === spanToDelete) {
      selectedSpanRef.current = null;
      setSelectedSpanId(null);
    }
    if (hoveredSpanRef.current === spanToDelete) {
      hoveredSpanRef.current = null;
      setHoveredSpanId(null);
    }
    setSpanToDelete(null);
    redraw();
  }, [spanToDelete, partialDetails, redraw]);

  const restoreSpan = useCallback(
    (spanId: number) => {
      const trashIndex = deletedSpansRef.current.findIndex(
        (d) => d.span.span_id === spanId,
      );
      if (trashIndex === -1) return;
      const dataToRestore = deletedSpansRef.current[trashIndex];
      splitHistoryRef.current.push({
        prev: cableSpansRef.current.map((s) => ({ ...s })),
        prevDeleted: deletedSpansRef.current.map((d) => ({ ...d })),
      });
      const newTrash = [...deletedSpansRef.current];
      newTrash.splice(trashIndex, 1);
      deletedSpansRef.current = newTrash;
      setDeletedSpans(newTrash);
      const newSpans = [...cableSpansRef.current, dataToRestore.span];
      cableSpansRef.current = newSpans;
      setCableSpans(newSpans);
      notifySpansChange(newSpans);
      if (dataToRestore.status)
        setCableStatuses((prev) => {
          const next = { ...prev, [spanId]: dataToRestore.status! };
          cableStatusRef.current = next;
          return next;
        });
      if (dataToRestore.partialDetail)
        setPartialDetails((prev) => ({
          ...prev,
          [spanId]: dataToRestore.partialDetail!,
        }));
      if (newTrash.length === 0) setShowTrashPanel(false);
      redraw();
    },
    [redraw],
  );

  const findNearestCableSpan = useCallback(
    (worldX: number, worldY: number): number | null => {
      if (cableLayersRef.current.length === 0) return null;

      let bestId: number | null = null,
        bestDist = Infinity;
      const hoverTolWorld = Math.max(
        8 / Math.max(vpRef.current.scale, 1e-9),
        18,
      );

      for (const span of cableSpansRef.current) {
        if (!isLayerVisible(span.layer)) continue;

        if (
          maskEnabledRef.current &&
          boundaryRef.current &&
          !isPointInPolygon(span.cx, span.cy, boundaryRef.current)
        )
          continue;

        const hitSegments = span.segments;
        const [mnx, mny, mxx, mxy] = boundsFromSegments(hitSegments, span.bbox);
        if (
          worldX < mnx - hoverTolWorld ||
          worldX > mxx + hoverTolWorld ||
          worldY < mny - hoverTolWorld ||
          worldY > mxy + hoverTolWorld
        )
          continue;

        const d = distanceToSolidSegments(worldX, worldY, hitSegments);
        if (d < bestDist) {
          bestDist = d;
          bestId = span.span_id;
        }
      }
      return bestDist <= hoverTolWorld ? bestId : null;
    },
    [isLayerVisible],
  );

  const findNearestPole = useCallback(
    (
      worldX: number,
      worldY: number,
      radius = 20 / Math.max(vpRef.current.scale, 1e-9),
    ) => {
      let best: PoleTag | null = null;
      let bestDist = Infinity;
      for (const pole of polesRef.current) {
        if (!isLayerVisible(pole.layer)) continue;
        if (
          maskEnabledRef.current &&
          boundaryRef.current &&
          !isPointInPolygon(pole.cx, pole.cy, boundaryRef.current)
        ) {
          continue;
        }
        const dist = Math.hypot(pole.cx - worldX, pole.cy - worldY);
        if (dist < radius && dist < bestDist) {
          best = pole;
          bestDist = dist;
        }
      }
      return best;
    },
    [isLayerVisible],
  );

  // Find the detected pole nearest a cut point (respecting the boundary mask) so
  // a freshly cut span can pair to the pole sitting at the cut, instantly.
  const findPoleNearCut = useCallback(
    (x: number, y: number, radius = 60): PoleTag | null => {
      let best: PoleTag | null = null;
      let bestDist = Infinity;
      for (const pole of polesRef.current) {
        if (
          maskEnabledRef.current &&
          boundaryRef.current &&
          !isPointInPolygon(pole.cx, pole.cy, boundaryRef.current)
        ) {
          continue;
        }
        const d = Math.hypot(pole.cx - x, pole.cy - y);
        if (d < radius && d < bestDist) {
          bestDist = d;
          best = pole;
        }
      }
      return best;
    },
    [],
  );

  const splitCableSpan = useCallback(
    (
      spanId: number,
      cursorWorld?: { x: number; y: number },
      forcedCutPole?: PoleTag | null,
      options?: {
        preserveOuterPoleIds?: number[] | Set<number>;
        cutPoleRadius?: number;
      },
    ) => {
      const spans = cableSpansRef.current;
      const spanIndex = spans.findIndex((s) => s.span_id === spanId);
      if (spanIndex === -1) return false;
      const span = spans[spanIndex];
      const segs = orderConnectedSegments(span.segments);
      if (segs.length === 0) return false;

      const totalLength = segs.reduce(
        (sum, s) => sum + Math.hypot(s.x2 - s.x1, s.y2 - s.y1),
        0,
      );
      if (totalLength <= 0.1) return false;

      const fallbackSegment = segs[Math.floor(segs.length / 2)];
      const targetPoint =
        cursorWorld ??
        {
          x: (fallbackSegment.x1 + fallbackSegment.x2) / 2,
          y: (fallbackSegment.y1 + fallbackSegment.y2) / 2,
        };

      let best:
        | {
            segmentIndex: number;
            t: number;
            x: number;
            y: number;
            progress: number;
            distance: number;
          }
        | null = null;
      let walked = 0;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const projection = projectPointOntoSegment(
          targetPoint.x,
          targetPoint.y,
          s.x1,
          s.y1,
          s.x2,
          s.y2,
        );
        const progress = walked + projection.segmentLength * projection.t;
        if (!best || projection.distance < best.distance) {
          best = {
            segmentIndex: i,
            t: projection.t,
            x: projection.x,
            y: projection.y,
            progress,
            distance: projection.distance,
          };
        }
        walked += projection.segmentLength;
      }

      if (!best || best.progress <= 0.05 || totalLength - best.progress <= 0.05) {
        return false;
      }

      const MIN_SEGMENT_LENGTH = 0.05;
      const firstHalf: RawSegment[] = [];
      const secondHalf: RawSegment[] = [];
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (i < best.segmentIndex) {
          firstHalf.push(s);
          continue;
        }
        if (i > best.segmentIndex) {
          secondHalf.push(s);
          continue;
        }

        const firstLength = Math.hypot(best.x - s.x1, best.y - s.y1);
        const secondLength = Math.hypot(s.x2 - best.x, s.y2 - best.y);
        if (firstLength >= MIN_SEGMENT_LENGTH) {
          firstHalf.push({ x1: s.x1, y1: s.y1, x2: best.x, y2: best.y });
        }
        if (secondLength >= MIN_SEGMENT_LENGTH) {
          secondHalf.push({ x1: best.x, y1: best.y, x2: s.x2, y2: s.y2 });
        }
      }

      if (firstHalf.length === 0 || secondHalf.length === 0) {
        return false;
      }

      const newId1 = nextSpanIdRef.current++;
      const newId2 = nextSpanIdRef.current++;

      const getNearestMeterValue = (cx: number, cy: number) => {
        let nearest: { x: number; y: number; value: number } | null = null;
        let minDist = Infinity;
        for (const v of ocrMeterValuesRef.current) {
          const dist = Math.hypot(cx - v.x, cy - v.y);
          if (dist < minDist) {
            minDist = dist;
            nearest = v;
          }
        }
        return nearest ? nearest.value : null;
      };

      const cutPole =
        forcedCutPole ?? findPoleNearCut(best.x, best.y, options?.cutPoleRadius ?? 1.5);
      const preserveOuterPoleIds = options?.preserveOuterPoleIds
        ? new Set(options.preserveOuterPoleIds)
        : null;
      const keepOuterPole = (poleId?: number) =>
        !preserveOuterPoleIds || (poleId != null && preserveOuterPoleIds.has(poleId));

      const m1 = computeSpanMetrics(firstHalf);
      const m2 = computeSpanMetrics(secondHalf);
      const newSpan1: CableSpan = {
        ...span,
        span_id: newId1,
        source_span_id: span.source_span_id ?? span.span_id,
        segments: firstHalf,
        display_segments: displaySegmentsForLogicalSegments(
          span.display_segments,
          firstHalf,
        ),
        segment_count: firstHalf.length,
        from_pole: keepOuterPole(span.from_pole_id) ? span.from_pole : undefined,
        to_pole: cutPole?.name ?? undefined,
        from_pole_id: keepOuterPole(span.from_pole_id)
          ? span.from_pole_id
          : undefined,
        to_pole_id: cutPole?.pole_id,
        ...m1,
        meterValue: getNearestMeterValue(m1.cx, m1.cy),
      };
      const newSpan2: CableSpan = {
        ...span,
        span_id: newId2,
        source_span_id: span.source_span_id ?? span.span_id,
        segments: secondHalf,
        display_segments: displaySegmentsForLogicalSegments(
          span.display_segments,
          secondHalf,
        ),
        segment_count: secondHalf.length,
        from_pole: cutPole?.name ?? undefined,
        to_pole: keepOuterPole(span.to_pole_id) ? span.to_pole : undefined,
        from_pole_id: cutPole?.pole_id,
        to_pole_id: keepOuterPole(span.to_pole_id)
          ? span.to_pole_id
          : undefined,
        ...m2,
        meterValue: getNearestMeterValue(m2.cx, m2.cy),
      };

      const newSpans = [
        ...spans.slice(0, spanIndex),
        newSpan1,
        newSpan2,
        ...spans.slice(spanIndex + 1),
      ];
      splitHistoryRef.current.push({
        prev: spans.map((s) => ({ ...s })),
        prevDeleted: deletedSpansRef.current.map((d) => ({ ...d })),
      });
      cableSpansRef.current = newSpans;
      setCableSpans(newSpans);
      notifySpansChange(newSpans);

      const prevStatus = cableStatusRef.current[spanId];
      if (prevStatus) {
        setCableStatuses((prev) => {
          const next = { ...prev, [newId1]: prevStatus, [newId2]: prevStatus };
          cableStatusRef.current = next;
          return next;
        });
        if (prevStatus === "Partial" && partialDetails[spanId])
          setPartialDetails((prev) => ({
            ...prev,
            [newId1]: { ...prev[spanId] },
            [newId2]: { ...prev[spanId] },
          }));
      }
      selectedSpanRef.current = newId1;
      setSelectedSpanId(newId1);
      hoveredSpanRef.current = null;
      setHoveredSpanId(null);
      redraw();
      return true;
    },
    [redraw, partialDetails, findPoleNearCut],
  );

  const cutAdjacentSpans = useCallback(() => {
    const targetId = selectedSpanRef.current;
    if (targetId === null) return;
    const currentSpans = cableSpansRef.current;
    const refSpan = currentSpans.find((s) => s.span_id === targetId);
    if (!refSpan || refSpan.segments.length < 2) return;

    const segs = refSpan.segments;
    const ptA = { x: segs[0].x1, y: segs[0].y1 };
    const ptB = { x: segs[segs.length - 1].x2, y: segs[segs.length - 1].y2 };
    const searchTol = 50 / Math.max(vpRef.current.scale, 1e-9);
    let newSpans = [...currentSpans];
    let madeCuts = false;

    const getNearestMeterValue = (cx: number, cy: number) => {
      let nearest: { x: number; y: number; value: number } | null = null;
      let minDist = Infinity;
      for (const v of ocrMeterValuesRef.current) {
        const dist = Math.hypot(cx - v.x, cy - v.y);
        if (dist < minDist) {
          minDist = dist;
          nearest = v;
        }
      }
      return nearest ? nearest.value : null;
    };

    const trySplitAtPoint = (targetPt: { x: number; y: number }) => {
      const resultSpans: CableSpan[] = [];
      for (const span of newSpans) {
        if (span.span_id === refSpan.span_id) {
          resultSpans.push(span);
          continue;
        }
        let minDist = Infinity;
        let splitIdx = -1;
        for (let i = 0; i < span.segments.length; i++) {
          const s = span.segments[i];
          const d = pointToSegmentDistance(
            targetPt.x,
            targetPt.y,
            s.x1,
            s.y1,
            s.x2,
            s.y2,
          );
          if (d < minDist) {
            minDist = d;
            splitIdx = i;
          }
        }
        if (minDist < searchTol) {
          const safeIdx = findSafeCutIndex(
            span.segments,
            splitIdx,
            targetPt.x,
            targetPt.y,
          );
          if (
            safeIdx !== null &&
            safeIdx >= 0 &&
            safeIdx < span.segments.length - 1
          ) {
            madeCuts = true;
            const firstHalf = span.segments.slice(0, safeIdx + 1);
            const secondHalf = span.segments.slice(safeIdx + 1);
            const cutPole = findPoleNearCut(targetPt.x, targetPt.y);
            const m1 = computeSpanMetrics(firstHalf);
            const m2 = computeSpanMetrics(secondHalf);
            const span1: CableSpan = {
              ...span,
              span_id: nextSpanIdRef.current++,
              segments: firstHalf,
              display_segments: displaySegmentsForLogicalSegments(
                span.display_segments,
                firstHalf,
              ),
              segment_count: firstHalf.length,
              from_pole: span.from_pole,
              to_pole: cutPole?.name ?? undefined,
              from_pole_id: span.from_pole_id,
              to_pole_id: cutPole?.pole_id,
              ...m1,
              meterValue: getNearestMeterValue(m1.cx, m1.cy),
            };
            const span2: CableSpan = {
              ...span,
              span_id: nextSpanIdRef.current++,
              segments: secondHalf,
              display_segments: displaySegmentsForLogicalSegments(
                span.display_segments,
                secondHalf,
              ),
              segment_count: secondHalf.length,
              from_pole: cutPole?.name ?? undefined,
              to_pole: span.to_pole,
              from_pole_id: cutPole?.pole_id,
              to_pole_id: span.to_pole_id,
              ...m2,
              meterValue: getNearestMeterValue(m2.cx, m2.cy),
            };
            resultSpans.push(span1, span2);
            const prevStatus = cableStatusRef.current[span.span_id];
            if (prevStatus) {
              setCableStatuses((prev) => {
                const next = {
                  ...prev,
                  [span1.span_id]: prevStatus,
                  [span2.span_id]: prevStatus,
                };
                cableStatusRef.current = next;
                return next;
              });
              if (prevStatus === "Partial" && partialDetails[span.span_id])
                setPartialDetails((prev) => ({
                  ...prev,
                  [span1.span_id]: { ...prev[span.span_id] },
                  [span2.span_id]: { ...prev[span.span_id] },
                }));
            }
          } else {
            resultSpans.push(span);
          }
        } else {
          resultSpans.push(span);
        }
      }
      newSpans = resultSpans;
    };
    trySplitAtPoint(ptA);
    trySplitAtPoint(ptB);
    if (madeCuts) {
      splitHistoryRef.current.push({
        prev: currentSpans.map((s) => ({ ...s })),
        prevDeleted: deletedSpansRef.current.map((d) => ({ ...d })),
      });
      cableSpansRef.current = newSpans;
      setCableSpans(newSpans);
      notifySpansChange(newSpans);
      redraw();
    }
  }, [partialDetails, redraw, notifySpansChange, findPoleNearCut]);

  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x, y } = screenToWorld(sx, sy);
    const hitId = findNearestCableSpan(x, y);
    if (hitId === null) return;
    const targetSpan = cableSpansRef.current.find((s) => s.span_id === hitId);
    if (targetSpan && targetSpan.segments.length > 0) {
      const searchTol = 30 / Math.max(vpRef.current.scale, 1e-9);
      const firstSeg = targetSpan.segments[0];
      const lastSeg = targetSpan.segments[targetSpan.segments.length - 1];
      const nearStart =
        Math.hypot(x - firstSeg.x1, y - firstSeg.y1) < searchTol;
      const nearEnd = Math.hypot(x - lastSeg.x2, y - lastSeg.y2) < searchTol;
      if (nearStart || nearEnd) {
        const neighbor = cableSpansRef.current.find((s) => {
          if (s.span_id === hitId || s.segments.length === 0) return false;
          const nFirst = s.segments[0];
          const nLast = s.segments[s.segments.length - 1];
          const distToStart = nearStart
            ? Math.hypot(firstSeg.x1 - nLast.x2, firstSeg.y1 - nLast.y2)
            : Math.hypot(lastSeg.x2 - nFirst.x1, lastSeg.y2 - nFirst.y1);
          const distToEnd = nearStart
            ? Math.hypot(firstSeg.x1 - nFirst.x1, firstSeg.y1 - nFirst.y1)
            : Math.hypot(lastSeg.x2 - nLast.x2, lastSeg.y2 - nLast.y2);
          return distToStart < searchTol || distToEnd < searchTol;
        });
        if (neighbor) {
          splitHistoryRef.current.push({
            prev: cableSpansRef.current.map((s) => ({ ...s })),
            prevDeleted: deletedSpansRef.current.map((d) => ({ ...d })),
          });
          const newSegments = orderConnectedSegments([
            ...targetSpan.segments,
            ...neighbor.segments,
          ]);
          const nextId = nextSpanIdRef.current++;
          const m = computeSpanMetrics(newSegments);
          let nearestOcr = null;
          let minDist = Infinity;
          for (const v of ocrMeterValuesRef.current) {
            const dist = Math.hypot(m.cx - v.x, m.cy - v.y);
            if (dist < minDist) {
              minDist = dist;
              nearestOcr = v.value;
            }
          }
          const mergedSpan: CableSpan = {
            ...targetSpan,
            span_id: nextId,
            segments: newSegments,
            display_segments: [
              ...(targetSpan.display_segments?.length
                ? targetSpan.display_segments
                : targetSpan.segments),
              ...(neighbor.display_segments?.length
                ? neighbor.display_segments
                : neighbor.segments),
            ],
            segment_count: newSegments.length,
            from_pole: targetSpan.from_pole || neighbor.from_pole,
            to_pole: targetSpan.to_pole || neighbor.to_pole,
            from_pole_id: targetSpan.from_pole_id ?? neighbor.from_pole_id,
            to_pole_id: targetSpan.to_pole_id ?? neighbor.to_pole_id,
            ...m,
            meterValue: nearestOcr ?? undefined,
          };
          const newSpans = cableSpansRef.current.filter(
            (s) => s.span_id !== hitId && s.span_id !== neighbor.span_id,
          );
          newSpans.push(mergedSpan);
          cableSpansRef.current = newSpans;
          setCableSpans(newSpans);
          notifySpansChange(newSpans);
          setSelectedSpanId(nextId);
          redraw();
          return;
        }
      }
    }
    splitCableSpan(hitId, { x, y });
  };

  const undoSplit = useCallback(() => {
    const history = splitHistoryRef.current;
    if (!history.length) return;
    const last = history.pop();
    if (!last) return;
    cableSpansRef.current = last.prev;
    setCableSpans([...last.prev]);
    notifySpansChange([...last.prev]);
    if (last.prevDeleted) {
      deletedSpansRef.current = last.prevDeleted;
      setDeletedSpans([...last.prevDeleted]);
    }
    selectedSpanRef.current = null;
    setSelectedSpanId(null);
    redraw();
  }, [redraw, notifySpansChange]);

  const redoSplit = useCallback(() => {}, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        undoSplit();
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        redoSplit();
      }
      if (pairingModeRef.current && e.key === "Enter") {
        e.preventDefault();
        if (pairedSpanIdsRef.current.length > 0) {
          setConfirmPairingOpen(true);
        } else {
          cancelMultiAction();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undoSplit, redoSplit]);

  useEffect(() => {
    if (!cableSpansRef.current.length) return;
    const safeOcr = ocrResults || [];
    ocrMeterValuesRef.current = safeOcr.map((r) => ({
      x: r.center_x,
      y: r.center_y,
      value: parseFloat(r.corrected_value ?? r.value) || 0,
    }));
    cableSpansRef.current = cableSpansRef.current.map((span) => {
      const status = cableStatusRef.current[span.span_id];
      if (
        status === "Partial" &&
        span.meterValue !== undefined &&
        span.meterValue !== null
      )
        return span;
      let nearest = null;
      let nearestDist = Infinity;
      for (const r of safeOcr) {
        const dist = Math.hypot(span.cx - r.center_x, span.cy - r.center_y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = r;
        }
      }
      return {
        ...span,
        meterValue: nearest
          ? parseFloat(nearest.corrected_value ?? nearest.value) || null
          : null,
      };
    });
    setCableSpans([...cableSpansRef.current]);
    notifySpansChange([...cableSpansRef.current]);
    redraw();
  }, [ocrResults, cableDataVersion, redraw, notifySpansChange]);

  const startMultiAction = (action: "runs" | "merge") => {
    const normalized = applyPoleBreakNormalization();
    if (normalized) return;
    if (selectedSpanId === null) return;
    pairingModeRef.current = true;
    setPairingMode(true);
    setMainPairingSpanId(selectedSpanId);
    pairedSpanIdsRef.current = [];
    setPairedSpanIds([]);
    multiActionRef.current = action;
    setMultiAction(action);
    redraw();
  };
  const promptFinishMultiAction = () => {
    if (pairedSpanIdsRef.current.length === 0) {
      cancelMultiAction();
      return;
    }
    setConfirmPairingOpen(true);
  };

  const handleConfirmMultiAction = () => {
    if (mainPairingSpanId === null) return;
    const action = multiActionRef.current;
    const mainSpan = cableSpansRef.current.find(
      (s) => s.span_id === mainPairingSpanId,
    );
    if (!mainSpan) return;
    splitHistoryRef.current.push({
      prev: cableSpansRef.current.map((s) => ({ ...s })),
      prevDeleted: deletedSpansRef.current.map((d) => ({ ...d })),
    });
    const pIds = pairedSpanIdsRef.current;
    const pairedSpansToMerge = cableSpansRef.current.filter((s) =>
      pIds.includes(s.span_id),
    );
    const newSegments = orderConnectedSegments([
      ...mainSpan.segments,
      ...pairedSpansToMerge.flatMap((ps) => ps.segments),
    ]);
    const m = computeSpanMetrics(newSegments);
    let mergedSpan: CableSpan;
    if (action === "runs") {
      const totalRunsToAdd = pairedSpansToMerge.reduce(
        (sum, s) => sum + (s.cable_runs || 1),
        0,
      );
      mergedSpan = {
        ...mainSpan,
        segments: newSegments,
        display_segments: [
          ...(mainSpan.display_segments?.length
            ? mainSpan.display_segments
            : mainSpan.segments),
          ...pairedSpansToMerge.flatMap((ps) =>
            ps.display_segments?.length ? ps.display_segments : ps.segments,
          ),
        ],
        segment_count: newSegments.length,
        cable_runs: (mainSpan.cable_runs || 1) + totalRunsToAdd,
        bbox: m.bbox,
        cx: m.cx,
        cy: m.cy,
      };
    } else {
      // Physically combine the spans and SUM their lengths (as the dialog says).
      const allMerged = [mainSpan, ...pairedSpansToMerge];
      const summedLength = allMerged.reduce(
        (sum, s) => sum + (s.total_length || 0),
        0,
      );
      const hasMeter = allMerged.some((s) => s.meterValue != null);
      const summedMeter = hasMeter
        ? allMerged.reduce(
            (sum, s) => sum + (s.meterValue ?? s.total_length ?? 0),
            0,
          )
        : null;
      mergedSpan = {
        ...mainSpan,
        segments: newSegments,
        display_segments: [
          ...(mainSpan.display_segments?.length
            ? mainSpan.display_segments
            : mainSpan.segments),
          ...pairedSpansToMerge.flatMap((ps) =>
            ps.display_segments?.length ? ps.display_segments : ps.segments,
          ),
        ],
        segment_count: newSegments.length,
        bbox: m.bbox,
        cx: m.cx,
        cy: m.cy,
        total_length: summedLength,
        meterValue: summedMeter,
      };
    }
    const newSpans = cableSpansRef.current.filter(
      (s) => s.span_id !== mainSpan.span_id && !pIds.includes(s.span_id),
    );
    newSpans.push(mergedSpan);
    cableSpansRef.current = newSpans;
    setCableSpans(newSpans);
    notifySpansChange(newSpans);
    cancelMultiAction();
  };

  const cancelMultiAction = () => {
    pairingModeRef.current = false;
    setPairingMode(false);
    setMainPairingSpanId(null);
    pairedSpanIdsRef.current = [];
    setPairedSpanIds([]);
    setConfirmPairingOpen(false);
    multiActionRef.current = null;
    setMultiAction(null);
    redraw();
  };

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !boundsRef.current) return;
    const { minx, miny, maxx, maxy } = boundsRef.current;
    const W = canvas.width,
      H = canvas.height;
    const dw = maxx - minx,
      dh = maxy - miny;
    if (dw < 1e-9 || dh < 1e-9) return;
    const vp = vpRef.current;
    vp.scale = Math.min(W / dw, H / dh) * 0.88;
    vp.x = W / 2 - ((minx + maxx) / 2) * vp.scale;
    vp.y = H / 2 + ((miny + maxy) / 2) * vp.scale;
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!isActive) return;
    const id = setTimeout(() => fitView(), 50);
    return () => clearTimeout(id);
  }, [isActive, fitView]);

  useEffect(() => {
    if (!dxfPath) return;
    setLoading(true);
    setError(null);
    setHoveredSpanId(null);
    setSelectedSpanId(null);
    setCableStatuses({});
    hoveredSpanRef.current = null;
    selectedSpanRef.current = null;
    cutHereModeRef.current = false;
    setCutHereMode(false);
    pendingAutoCutRef.current = null;
    autoCutModeRef.current = "idle";
    setAutoCutMode("idle");
    cableSpansRef.current = [];
    cableLayersRef.current = [];
    cableStatusRef.current = {};
    deletedSpansRef.current = [];
    setDeletedSpans([]);
    setCableLayerNames([]);

    hasAutoConnectedRef.current = false;

    // Restore mode: use pre-loaded segment and cable span data from Supabase
    if (initialSegments && Object.keys(initialSegments).length > 0) {
      segmentsRef.current = initialSegments;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const segs of Object.values(initialSegments)) {
        for (const s of segs) {
          minx = Math.min(minx, s.x1, s.x2);
          miny = Math.min(miny, s.y1, s.y2);
          maxx = Math.max(maxx, s.x1, s.x2);
          maxy = Math.max(maxy, s.y1, s.y2);
        }
      }
      boundsRef.current = { minx, miny, maxx, maxy };
      const layerData: DxfLayerData[] = Object.keys(initialSegments).map((name) => ({
        name,
        visible: true,
        color: layerColor(name),
        segmentCount: (initialSegments[name] ?? []).length,
      }));
      layersRef.current = layerData;
      setLayers(layerData);

      const spans: CableSpan[] = (initialCableSpans ?? []).map((s) => ({
        ...s,
        cable_runs: s.cable_runs || 1,
      }));
      const maxId = spans.reduce((max, s) => Math.max(max, s.span_id), 0);
      nextSpanIdRef.current = maxId + 1;
      cableSpansRef.current = spans;
      setCableSpans(spans);
      notifySpansChange(spans);
      const cableLayers = [...new Set(spans.map((s) => s.layer).filter((l): l is string => Boolean(l)))];
      cableLayersRef.current = cableLayers;
      setCableLayerNames(cableLayers);
      setCableDataVersion((v) => v + 1);
      setLoading(false);
      onInitialDataConsumed?.();
      setTimeout(fitView, 50);
      return;
    }

    Promise.all([
      fetch("/api/dxf_segments").then((r) => r.json()),
      fetch("/api/cable_spans").then((r) => r.json()),
    ])
      .then(([segData, cableData]) => {
        if (segData.error) {
          setError(segData.error);
          setLoading(false);
          return;
        }
        if (cableData.error) {
          setError(cableData.error);
          setLoading(false);
          return;
        }
        segmentsRef.current = segData.segments;
        let minx = Infinity,
          miny = Infinity,
          maxx = -Infinity,
          maxy = -Infinity;
        for (const segs of Object.values(segData.segments) as RawSegment[][]) {
          for (const s of segs) {
            minx = Math.min(minx, s.x1, s.x2);
            miny = Math.min(miny, s.y1, s.y2);
            maxx = Math.max(maxx, s.x1, s.x2);
            maxy = Math.max(maxy, s.y1, s.y2);
          }
        }
        boundsRef.current = { minx, miny, maxx, maxy };
        const layerData: DxfLayerData[] = segData.layers.map(
          (name: string) => ({
            name,
            visible: true,
            color: layerColor(name),
            segmentCount: (segData.segments[name] ?? []).length,
          }),
        );
        layersRef.current = layerData;
        setLayers(layerData);
        const rawSpans: CableSpan[] = (cableData.spans ?? []).map((s: any) => ({
          ...s,
          source_span_id: s.source_span_id ?? s.original_span_id ?? s.span_id,
          cable_runs: s.cable_runs || 1,
        }));
        const spans = rawSpans;
        const maxId = spans.reduce((max, s) => Math.max(max, s.span_id), 0);
        nextSpanIdRef.current = maxId + 1;
        cableSpansRef.current = spans;
        setCableSpans(spans);
        notifySpansChange(spans);
        cableLayersRef.current = cableData.cable_layers ?? [];
        setCableLayerNames(cableData.cable_layers ?? []);
        setCableDataVersion((v) => v + 1);
        setLoading(false);
        setTimeout(fitView, 50);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [dxfPath, fitView, notifySpansChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.parentElement?.clientWidth ?? 0;
      canvas.height = canvas.parentElement?.clientHeight ?? 0;
      redraw();
    });
    ro.observe(canvas.parentElement!);
    canvas.width = canvas.parentElement?.clientWidth ?? 0;
    canvas.height = canvas.parentElement?.clientHeight ?? 0;
    return () => ro.disconnect();
  }, [redraw]);

  const toggleLayer = useCallback(
    (name: string) => {
      setLayers((prev) => {
        const next = prev.map((l) =>
          l.name === name ? { ...l, visible: !l.visible } : l,
        );
        layersRef.current = next;
        const cableLayers = cableLayersRef.current;
        if (cableLayers.includes(name)) {
          const visible = next.find((l) => l.name === name)?.visible ?? false;
          if (!visible) {
            hoveredSpanRef.current = null;
            selectedSpanRef.current = null;
            setHoveredSpanId(null);
            setSelectedSpanId(null);
            cancelMultiAction();
          }
        }
        redraw();
        return next;
      });
    },
    [redraw],
  );

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // 1. Existing Georeferencing Logic
      if (event.data?.type === "GEO_COORDINATES") {
        const geoData = event.data.payload as any[];
        const TOLERANCE = 5.0;
        const nextPoles = polesRef.current.map((pole) => ({ ...pole }));
        const byId = new Map<number, number>();
        nextPoles.forEach((pole, idx) => {
          byId.set(pole.pole_id, idx);
        });

        const matchedGeo = new Set<number>();
        const findNearestPoleIndex = (cadX: number, cadY: number) => {
          let bestIdx = -1;
          let bestDist = Infinity;
          nextPoles.forEach((pole, idx) => {
            const dist = Math.hypot(pole.cx - cadX, pole.cy - cadY);
            if (dist < TOLERANCE && dist < bestDist) {
              bestDist = dist;
              bestIdx = idx;
            }
          });
          return bestIdx;
        };

        geoData.forEach((geoPoint: any, idx: number) => {
          if (geoPoint?.map_latitude == null || geoPoint?.map_longitude == null) {
            return;
          }

          const hasNumericPoleId = typeof geoPoint.pole_id === "number";
          let poleIdx = hasNumericPoleId
            ? (byId.get(geoPoint.pole_id) ?? -1)
            : -1;

          if (!hasNumericPoleId && poleIdx < 0) {
            poleIdx = findNearestPoleIndex(geoPoint.cad_x, geoPoint.cad_y);
          }

          if (poleIdx >= 0) {
            matchedGeo.add(idx);
            nextPoles[poleIdx] = {
              ...nextPoles[poleIdx],
              map_latitude: geoPoint.map_latitude,
              map_longitude: geoPoint.map_longitude,
            };
          }
        });

        const nptPoles = geoData
          .filter((_: any, idx: number) => !matchedGeo.has(idx))
          .filter((g: any) => g.map_latitude != null && g.map_longitude != null)
          .filter((g: any) => {
            const hasNumericPoleId = typeof g.pole_id === "number";
            if (hasNumericPoleId) {
              return byId.get(g.pole_id) == null;
            }
            return findNearestPoleIndex(g.cad_x, g.cad_y) < 0;
          })
          .map((g: any) => ({
            pole_id: g.pole_id,
            name: g.name || "NPT",
            cx: g.cad_x,
            cy: g.cad_y,
            bbox: [0, 0, 0, 0] as [number, number, number, number],
            layer: "geotool_npt",
            source: "geotool_npt",
            ocr_conf: 1.0,
            needs_review: false,
            crop_b64: null,
            map_latitude: g.map_latitude,
            map_longitude: g.map_longitude,
          }));

        // Remove OCR-detected "NPT" text annotations when GeoTool NPTs exist
        // Text labels like "NPT" are annotations, not actual poles — the GeoTool
        // discovers the real NPT circle symbols as separate poles at proper positions.
        const dedupedUpdated =
          nptPoles.length > 0
            ? nextPoles.filter(
                (p) =>
                  !(
                    p.name === "NPT" &&
                    p.source !== "geotool_npt" &&
                    (p.map_latitude == null || p.map_longitude == null)
                  ),
              )
            : nextPoles;
        const allPoles = [...dedupedUpdated, ...nptPoles];
        ensureGeoToolLayer(allPoles);
        polesRef.current = allPoles;
        setPoles(allPoles);
        onCacheUpdate?.({ poleTags: allPoles, poleDone: true });

        const gpsPoles = allPoles
          .filter((p) => p.map_latitude != null && p.map_longitude != null)
          .map((p) => ({
            pole_id: p.pole_id,
            name: p.name,
            layer: p.layer,
            source: p.source,
            map_latitude: p.map_latitude,
            map_longitude: p.map_longitude,
            cad_x: p.cx,
            cad_y: p.cy,
          }));
        if (gpsPoles.length > 0) {
          try {
            const res = await fetch("/api/v1/poles/georeference", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ poles: gpsPoles }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || data?.error) {
              throw new Error(data?.error || `HTTP ${res.status}`);
            }
          } catch (err) {
            console.error("Georeference PATCH failed:", err);
            alert("Failed to sync NPTs to server. NPT spans will be skipped until the sync succeeds.");
            return;
          }
        }

        applyPoleBreakNormalization({
          autoConnectAfter: true,
          preserveExistingAssignments: true,
        });

        alert("Coordinates successfully synced from Georeferencing tool!");
        redraw();
      }

      // 2. Real-Time Pole Updates & Cascading Span Updates
      if (event.data?.type === "POLE_UPDATE") {
        const { action, pole } = event.data.payload;
        applyPoleUpdate(action, pole);
      }

      if (event.data?.type === "POLES_SYNC") {
        const payloadPoles = Array.isArray(event.data?.payload?.poles)
          ? (event.data.payload.poles as PoleTag[])
          : [];
        if (!payloadPoles.length) return;

        ensureGeoToolLayer(payloadPoles);
        polesRef.current = payloadPoles;
        setPoles(payloadPoles);
        setPoleScanStatus("done");
        onCacheUpdate?.({ poleTags: payloadPoles, poleDone: true });
        if (showPolesRef.current) redraw();

        if (cableSpansRef.current.length > 0) {
          hasAutoConnectedRef.current = false;
          applyPoleBreakNormalization({
            autoConnectAfter: true,
            preserveExistingAssignments: true,
          });
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    applyPoleBreakNormalization,
    applyPoleUpdate,
    ensureGeoToolLayer,
    onCacheUpdate,
    redraw,
  ]);

  const showAll = useCallback(() => {
    setLayers((prev) => {
      const next = prev.map((l) => ({ ...l, visible: true }));
      layersRef.current = next;
      redraw();
      return next;
    });
  }, [redraw]);

  const hideAll = useCallback(() => {
    setLayers((prev) => {
      const next = prev.map((l) => ({ ...l, visible: false }));
      layersRef.current = next;
      hoveredSpanRef.current = null;
      hoveredPoleRef.current = null;
      selectedSpanRef.current = null;
      setHoveredSpanId(null);
      setHoveredPoleId(null);
      setSelectedSpanId(null);
      cancelMultiAction();
      redraw();
      return next;
    });
  }, [redraw]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    panRef.current = {
      active: true,
      moved: false,
      start: { x: e.clientX, y: e.clientY },
      vpStart: { ...vpRef.current },
    };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.start.x;
      const dy = e.clientY - panRef.current.start.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panRef.current.moved = true;
      vpRef.current.x = panRef.current.vpStart.x + dx;
      vpRef.current.y = panRef.current.vpStart.y + dy;
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
      redraw();
      return;
    }
    if (tooltipRef.current) {
      tooltipRef.current.style.display =
        hoveredPoleRef.current !== null || hoveredSpanRef.current !== null
          ? "flex"
          : "none";
      tooltipRef.current.style.left = `${e.clientX + 15}px`;
      tooltipRef.current.style.top = `${e.clientY + 15}px`;
    }
    const { x, y } = screenToWorld(sx, sy);
    const poleHit =
      showPolesRef.current &&
      poleEditModeRef.current === "idle" &&
      !cutHereModeRef.current &&
      autoCutModeRef.current !== "pickSpan"
        ? findNearestPole(x, y)
        : null;
    const poleHitId = poleHit?.pole_id ?? null;
    let poleHoverChanged = false;
    if (poleHitId !== hoveredPoleRef.current) {
      hoveredPoleRef.current = poleHitId;
      setHoveredPoleId(poleHitId);
      poleHoverChanged = true;
    }

    if (poleHitId !== null) {
      if (hoveredSpanRef.current !== null) {
        hoveredSpanRef.current = null;
        setHoveredSpanId(null);
      }
      redraw();
      return;
    }

    const hitId = findNearestCableSpan(x, y);
    if (hitId !== hoveredSpanRef.current) {
      hoveredSpanRef.current = hitId;
      setHoveredSpanId(hitId);
      redraw();
      return;
    }

    if (poleHoverChanged) {
      redraw();
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const didMove = panRef.current.moved;
    panRef.current.active = false;
    if (e.button !== 0) return;
    if (didMove) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x, y } = screenToWorld(sx, sy);

    if (cutHereModeRef.current) {
      const targetSpanId = findNearestCableSpan(x, y);
      if (targetSpanId == null) {
        showAutoCutNotice("Click directly on the blue cable where you want to cut.");
        return;
      }
      const changed = splitCableSpan(targetSpanId, { x, y }, null, {
        cutPoleRadius: 1.5,
      });
      if (!changed) {
        showAutoCutNotice(
          "That point is too close to the span end. Click slightly inside the cable segment.",
        );
        return;
      }
      cutHereModeRef.current = false;
      setCutHereMode(false);
      showAutoCutNotice("Span cut at clicked point.");
      return;
    }

    if (autoCutModeRef.current === "pickSpan") {
      const targetSpanId = findNearestCableSpan(x, y);
      if (targetSpanId == null) {
        showAutoCutNotice("Click directly on the cable span you want to auto-cut.");
        return;
      }
      const targetSpan = cableSpansRef.current.find(
        (span) => span.span_id === targetSpanId,
      );
      pendingAutoCutRef.current = {
        spanId: targetSpanId,
        sourceSpanId: targetSpan?.source_span_id ?? targetSpanId,
        cutPoleIds: [],
      };
      selectedSpanRef.current = targetSpanId;
      setSelectedSpanId(targetSpanId);
      autoCutModeRef.current = "pickPole";
      setAutoCutMode("pickPole");
      showAutoCutNotice("Line selected. Click each pole along this line to split it.");
      redraw();
      return;
    }

    if (autoCutModeRef.current === "pickPole") {
      const clickedPole = findNearestPole(x, y);
      const pending = pendingAutoCutRef.current;
      if (!pending) {
        autoCutModeRef.current = "idle";
        setAutoCutMode("idle");
        return;
      }
      if (!clickedPole) {
        showAutoCutNotice("Click the nearby pole that should guide the cut area.");
        return;
      }
      const targetSourceId = pending.sourceSpanId;
      let targetSpanId = pending.spanId;
      let bestSpanDistance = Infinity;
      for (const span of cableSpansRef.current) {
        const sourceId = span.source_span_id ?? span.span_id;
        if (sourceId !== targetSourceId) continue;
        for (const segment of spanVisibleSegments(span)) {
          const distance = pointToSegmentDistance(
            clickedPole.cx,
            clickedPole.cy,
            segment.x1,
            segment.y1,
            segment.x2,
            segment.y2,
          );
          if (distance < bestSpanDistance) {
            bestSpanDistance = distance;
            targetSpanId = span.span_id;
          }
        }
      }
      const changed = splitCableSpan(
        targetSpanId,
        { x: clickedPole.cx, y: clickedPole.cy },
        clickedPole,
        { preserveOuterPoleIds: pending.cutPoleIds },
      );
      if (!changed) {
        showAutoCutNotice(
          "No cut point found near that pole. Try clicking the exact pole circle closest to the line.",
        );
        return;
      }
      pendingAutoCutRef.current = {
        spanId: targetSpanId,
        sourceSpanId: targetSourceId,
        cutPoleIds: Array.from(
          new Set([...pending.cutPoleIds, clickedPole.pole_id]),
        ),
      };
      autoCutModeRef.current = "pickPole";
      setAutoCutMode("pickPole");
      showAutoCutNotice("Cut added. Click another pole on the same line, or press Cancel.");
      redraw();
      return;
    }

    if (showPolesRef.current && poleEditModeRef.current === "add") {
      const existingPole = findNearestPole(x, y);
      if (existingPole) {
        alert(`A pole already exists near this location: ${existingPole.name}`);
        return;
      }

      const enteredName = window.prompt("Enter pole name", "NPT");
      if (enteredName == null) return;
      const trimmedName = enteredName.trim().toUpperCase() || "NPT";
      const nextPoleId =
        polesRef.current.length > 0
          ? Math.max(...polesRef.current.map((pole) => pole.pole_id)) + 1
          : 1;
      const newPole: PoleTag = {
        pole_id: nextPoleId,
        name: trimmedName,
        cx: x,
        cy: y,
        bbox: [x - 0.75, y - 0.75, x + 0.75, y + 0.75],
        layer: "geotool_npt",
        source: trimmedName === "NPT" ? "geotool_npt" : "manual_dxf",
      };
      applyPoleUpdate("ADD", newPole, { autoConnectAfter: true });
      poleEditModeRef.current = "idle";
      setPoleEditMode("idle");
      return;
    }

    if (showPolesRef.current && poleEditModeRef.current === "delete") {
      const clickedPole = findNearestPole(x, y);
      if (!clickedPole) {
        alert("No pole found at that location.");
        return;
      }
      if (!window.confirm(`Delete pole "${clickedPole.name}"?`)) {
        return;
      }
      applyPoleUpdate("DELETE", clickedPole);
      poleEditModeRef.current = "idle";
      setPoleEditMode("idle");
      return;
    }

    if (
      showPolesRef.current &&
      poleConnectModeRef.current !== "idle" &&
      selectedSpanRef.current !== null
    ) {
      const r = 20 / vpRef.current.scale;
      let clickedPole = null;
      let bestDist = Infinity;
      for (const p of polesRef.current) {
        if (!isLayerVisible(p.layer)) continue;
        if (
          maskEnabledRef.current &&
          boundaryRef.current &&
          !isPointInPolygon(p.cx, p.cy, boundaryRef.current)
        )
          continue;
        const dist = Math.hypot(p.cx - x, p.cy - y);
        if (dist < r && dist < bestDist) {
          bestDist = dist;
          clickedPole = p;
        }
      }
      if (clickedPole) {
        const spanId = selectedSpanRef.current;
        const mode = poleConnectModeRef.current;
        const newSpans = cableSpansRef.current.map((s) => {
          if (s.span_id === spanId)
            return {
              ...s,
              ...(mode === "from"
                ? { from_pole: clickedPole.name, from_pole_id: clickedPole.pole_id }
                : { to_pole: clickedPole.name, to_pole_id: clickedPole.pole_id }),
            };
          return s;
        });
        cableSpansRef.current = newSpans;
        setCableSpans(newSpans);
        notifySpansChange(newSpans);
        const nextMode = mode === "from" ? "to" : "idle";
        poleConnectModeRef.current = nextMode;
        setPoleConnectMode(nextMode);
        redraw();
        return;
      }
    }

    const hitId = hoveredSpanRef.current;
    if (pairingModeRef.current) {
      if (hitId !== null && hitId !== mainPairingSpanId) {
        const current = pairedSpanIdsRef.current;
        if (current.includes(hitId)) {
          pairedSpanIdsRef.current = current.filter((id) => id !== hitId);
        } else {
          pairedSpanIdsRef.current = [...current, hitId];
        }
        setPairedSpanIds(pairedSpanIdsRef.current);
        redraw();
      }
    } else {
      selectedSpanRef.current = hitId;
      setSelectedSpanId(hitId);
      setPoleConnectMode("idle");
      poleConnectModeRef.current = "idle";
      redraw();
    }
  };

  const onMouseLeave = () => {
    panRef.current.active = false;
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    if (hoveredPoleRef.current !== null) {
      hoveredPoleRef.current = null;
      setHoveredPoleId(null);
    }
    if (hoveredSpanRef.current !== null) {
      hoveredSpanRef.current = null;
      setHoveredSpanId(null);
      redraw();
      return;
    }
    redraw();
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const vp = vpRef.current;
    vp.x = e.nativeEvent.offsetX - f * (e.nativeEvent.offsetX - vp.x);
    vp.y = e.nativeEvent.offsetY - f * (e.nativeEvent.offsetY - vp.y);
    vp.scale *= f;
    redraw();
  };

  const exportToPdf = useCallback(() => {
    exportPdfFnRef.current = exportToPdf;
    if (!boundsRef.current) return;
    const { minx, miny, maxx, maxy } = boundsRef.current;
    const dw = maxx - minx;
    const dh = maxy - miny;
    if (dw <= 0 || dh <= 0) return;
    const W = 4500;
    const H = (dh / dw) * W;
    const offCanvas = document.createElement("canvas");
    offCanvas.width = W;
    offCanvas.height = H;
    const ctx = offCanvas.getContext("2d");
    if (!ctx) return;
    const exportVp = { x: 0, y: 0, scale: 1 };
    exportVp.scale = Math.min(W / dw, H / dh) * 0.96;
    exportVp.x = W / 2 - ((minx + maxx) / 2) * exportVp.scale;
    exportVp.y = H / 2 + ((miny + maxy) / 2) * exportVp.scale;

    renderScene(ctx, exportVp, W, H, {
      showChips: false,
      showHover: false,
      showActives: showActivesRef.current,
      showPoles: showPolesRef.current,
    });

    const imageData = offCanvas.toDataURL("image/png");
    const statuses = cableStatusRef.current;
    const layerName = cableLayersRef.current.length
      ? cableLayersRef.current.join(", ")
      : "—";
    const dateStr = new Date().toLocaleString();

    let pdfTotalRecovered = 0,
      pdfTotalUnrecovered = 0,
      pdfTotalMissing = 0,
      pdfTotalStrandLength = 0,
      pdfTotalLength = 0;
    let spanCount = 0;

    Object.entries(statuses).forEach(([id, status]) => {
      const spanId = +id;
      const span = cableSpansRef.current.find((s) => s.span_id === spanId);
      if (!span || !isLayerVisible(span.layer)) return;

      if (
        maskEnabledRef.current &&
        boundaryRef.current &&
        !isPointInPolygon(span.cx, span.cy, boundaryRef.current)
      )
        return;

      spanCount++;
      const runs = span.cable_runs || 1;
      const strandLen = span.meterValue ?? span.total_length ?? 0;
      pdfTotalStrandLength += strandLen;
      pdfTotalLength += strandLen * runs;

      if (status === "Recovered") {
        pdfTotalRecovered += strandLen * runs;
      } else if (status === "Missing") {
        pdfTotalMissing += strandLen * runs;
      } else if (status === "Partial") {
        const detail = partialDetails[spanId] ?? { recovered: 0 };
        const safeRecovered = Math.min(detail.recovered ?? 0, strandLen);
        const calcUnrecovered = strandLen - safeRecovered;
        pdfTotalRecovered += safeRecovered * runs;
        pdfTotalUnrecovered += calcUnrecovered * runs;
      }
    });

    const spanRows = Object.entries(statuses)
      .filter(([id]) => {
        const span = cableSpansRef.current.find(
          (s) => s.span_id === Number(id),
        );
        if (!span || !isLayerVisible(span.layer)) return false;
        if (
          maskEnabledRef.current &&
          boundaryRef.current &&
          !isPointInPolygon(span.cx, span.cy, boundaryRef.current)
        )
          return false;
        return true;
      })
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, status]) => {
        const span = cableSpansRef.current.find(
          (s) => s.span_id === Number(id),
        );
        const colorMap: Record<string, string> = {
          Recovered: "#166534",
          Partial: "#92400e",
          Missing: "#991b1b",
        };
        const bgMap: Record<string, string> = {
          Recovered: "#dcfce7",
          Partial: "#fef9c3",
          Missing: "#fee2e2",
        };
        const strandLen = span?.meterValue ?? span?.total_length ?? 0;
        const runs = span?.cable_runs || 1;
        const actualLen = strandLen * runs;
        const fromPole = span?.from_pole || "—";
        const toPole = span?.to_pole || "—";
        let lengthText = strandLen.toFixed(2);
        if (status === "Partial" && span) {
          const detail = partialDetails[span.span_id] ?? { recovered: 0 };
          const safeRecovered = Math.min(detail.recovered ?? 0, strandLen);
          const calcUnrecovered = strandLen - safeRecovered;
          lengthText += ` (R:${safeRecovered.toFixed(2)} / U:${calcUnrecovered.toFixed(2)})`;
        }

        return `<tr>
                <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${id}</td>
                <td style="padding:6px 12px;border:1px solid #e2e8f0;background:${bgMap[status] ?? "#f1f5f9"};color:${colorMap[status] ?? "#1e293b"};font-weight:600">${status}</td>
                <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${lengthText}</td>
                <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${runs}</td>
                <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${actualLen.toFixed(2)}</td>
                <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${fromPole} -> ${toPole}</td>
                <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${span ? span.segment_count : "—"}</td>
            </tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Cable Recovery Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Inter, Arial, sans-serif; color: #1e293b; background: #fff; }
  @page { size: A3 landscape; margin: 15mm; }
  .page-break { break-before: page; page-break-before: always; }
  .header-section { margin-bottom: 20px; }
  h1  { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
  .subtitle { font-size: 14px; color: #64748b; margin-bottom: 20px; }
  .summary { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .chip { padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; border: 1px solid; }
  .chip-green  { background:#dcfce7; color:#166534; border-color:#86efac; }
  .chip-yellow { background:#fef9c3; color:#92400e; border-color:#fde047; }
  .chip-red    { background:#fee2e2; color:#991b1b; border-color:#fca5a5; }
  .chip-slate  { background:#f1f5f9; color:#334155; border-color:#cbd5e1; }
  .legend-box { display: flex; align-items: center; gap: 20px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .legend-item { display: flex; align-items: center; gap: 8px; color: #334155; font-weight: 500; }
  .legend-line { width: 32px; height: 6px; border-radius: 3px; display: inline-block; }
  .image-container { width: 100%; height: 70vh; display: flex; justify-content: center; align-items: center; overflow: hidden; }
  img { max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { background: #f8fafc; padding: 10px 12px; border: 1px solid #e2e8f0; text-align: left; font-weight: 600; color: #475569; }
  h2 { font-size: 20px; margin-bottom: 16px; }
</style>
</head>
<body>
  <div class="header-section">
    <h1>Cable Recovery Status Report</h1>
    <div class="subtitle">Generated: ${dateStr} &nbsp;|&nbsp; Layers: ${layerName} &nbsp;|&nbsp; Total spans: ${spanCount.toLocaleString()} &nbsp;|&nbsp; Tagged: ${Object.keys(statuses).length}</div>

    <div class="summary">
      <span class="chip chip-green">✓ Recovered: ${pdfTotalRecovered.toFixed(2)} m</span>
      <span class="chip chip-yellow">⚠ Partial: ${pdfTotalUnrecovered.toFixed(2)} m</span>
      <span class="chip chip-red">✕ Missing: ${pdfTotalMissing.toFixed(2)} m</span>
      <span class="chip chip-slate">Total Strand: ${pdfTotalStrandLength.toFixed(2)} m</span>
      <span class="chip chip-slate">Total Actual: ${pdfTotalLength.toFixed(2)} m</span>
    </div>

    <div class="legend-box">
      <strong style="color: #0f172a;">Drawing Legend:</strong>
      <div class="legend-item"><span class="legend-line" style="background: rgba(22, 163, 74, 0.95); box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.22);"></span> Recovered</div>
      <div class="legend-item"><span class="legend-line" style="background: rgba(217, 119, 6, 0.95); box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.24);"></span> Partial</div>
      <div class="legend-item"><span class="legend-line" style="background: rgba(220, 38, 38, 0.95); box-shadow: 0 0 0 4px rgba(248, 113, 113, 0.22);"></span> Missing</div>
      ${
        showActivesRef.current
          ? `
      <div class="legend-item"><span class="legend-line" style="background: rgba(249, 115, 22, 0.4); border: 2px solid rgba(234, 88, 12, 0.9); height: 12px; border-radius: 2px;"></span> Amplifier</div>
      <div class="legend-item"><span class="legend-line" style="background: rgba(59, 130, 246, 0.4); border: 2px solid rgba(37, 99, 235, 0.9); height: 12px; border-radius: 2px;"></span> Node</div>
      <div class="legend-item"><span class="legend-line" style="background: rgba(239, 68, 68, 0.4); border: 2px solid rgba(220, 38, 38, 0.9); height: 12px; border-radius: 2px;"></span> Extender</div>
      `
          : ""
      }
    </div>
  </div>

  <div class="image-container">
    <img src="${imageData}" alt="DXF Full Extent Export" />
  </div>

  <div class="page-break">
    <h2>Span Data Details</h2>
    ${spanRows ? `<table><thead><tr><th>Span ID</th><th>Status</th><th>Strand Length</th><th>Runs</th><th>Actual Length</th><th>Poles (From -> To)</th><th>Segments</th></tr></thead><tbody>${spanRows}</tbody></table>` : "<p style='color:#64748b;font-size:14px'>No spans have been tagged yet.</p>"}
  </div>
</body>
</html>`;

    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const imgEl = doc.querySelector("img");
    const doPrint = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 2000);
    };
    if (imgEl) {
      imgEl.onload = doPrint;
      if (imgEl.complete) doPrint();
    } else {
      doPrint();
    }
  }, [cableStatuses, partialDetails, renderScene, isLayerVisible]);

  const exportVerificationPdf = useCallback(() => {
    if (!boundsRef.current) return;
    const { minx, miny, maxx, maxy } = boundsRef.current;
    const dw = maxx - minx;
    const dh = maxy - miny;
    if (dw <= 0 || dh <= 0) return;
    const W = 4500;
    const H = (dh / dw) * W;
    const offCanvas = document.createElement("canvas");
    offCanvas.width = W;
    offCanvas.height = H;
    const ctx = offCanvas.getContext("2d");
    if (!ctx) return;
    const exportVp = { x: 0, y: 0, scale: 1 };
    exportVp.scale = Math.min(W / dw, H / dh) * 0.96;
    exportVp.x = W / 2 - ((minx + maxx) / 2) * exportVp.scale;
    exportVp.y = H / 2 + ((miny + maxy) / 2) * exportVp.scale;

    // Render verification scene
    const worldToScreen = (wx: number, wy: number) => ({
      x: wx * exportVp.scale + exportVp.x,
      y: -wy * exportVp.scale + exportVp.y,
    });

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(exportVp.x, exportVp.y);
    ctx.scale(exportVp.scale, -exportVp.scale);

    // 1. Draw ALL DXF layers in black
    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      const segs = segmentsRef.current[layer.name] ?? [];
      if (!segs.length) continue;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 0.6 / exportVp.scale;
      ctx.beginPath();
      for (const s of segs) {
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
      }
      ctx.stroke();
    }

    // 2. Draw cable spans in red
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const span of cableSpansRef.current) {
      if (!isLayerVisible(span.layer)) continue;
      const runs = span.cable_runs || 1;
      const renderSegments = span.display_segments?.length
        ? span.display_segments
        : span.segments;

      ctx.save();
      ctx.strokeStyle = "rgba(220, 38, 38, 0.25)";
      ctx.lineWidth = (8 + (runs - 1) * 8) / exportVp.scale;
      ctx.beginPath();
      for (const seg of renderSegments) {
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
      }
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "rgba(220, 38, 38, 0.95)";
      ctx.lineWidth = 1.5 / exportVp.scale;
      ctx.beginPath();
      for (const seg of renderSegments) {
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // 3. Draw strand value labels in screen space (skip null/zero values)
    ctx.save();
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const span of cableSpansRef.current) {
      if (!isLayerVisible(span.layer)) continue;
      const value = span.meterValue;
      if (!value) continue;

      const label = `${value.toFixed(1)}m`;
      const sp = worldToScreen(span.cx, span.cy);

      const metrics = ctx.measureText(label);
      const pad = 3;
      const rw = metrics.width + pad * 2;
      const rh = 14 + pad * 2;
      const rx = sp.x - rw / 2;
      const ry = sp.y - rh / 2;

      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.strokeStyle = "rgba(22, 163, 74, 0.5)";
      ctx.lineWidth = 1;
      const rad = 4;
      ctx.beginPath();
      ctx.moveTo(rx + rad, ry);
      ctx.lineTo(rx + rw - rad, ry);
      ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rad);
      ctx.lineTo(rx + rw, ry + rh - rad);
      ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rad, ry + rh);
      ctx.lineTo(rx + rad, ry + rh);
      ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rad);
      ctx.lineTo(rx, ry + rad);
      ctx.quadraticCurveTo(rx, ry, rx + rad, ry);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#16a34a";
      ctx.fillText(label, sp.x, sp.y);
    }
    ctx.restore();

    const imageData = offCanvas.toDataURL("image/png");
    const layerName = cableLayersRef.current.length
      ? cableLayersRef.current.join(", ")
      : "—";
    const dateStr = new Date().toLocaleString();

    let totalSpans = 0;
    const spanRows: string[] = [];
    for (const span of cableSpansRef.current) {
      if (!isLayerVisible(span.layer)) continue;
      const value = span.meterValue;
      if (!value) continue;
      totalSpans++;
      const runs = span.cable_runs || 1;
      const actualLen = value * runs;
      spanRows.push(`<tr>
        <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${span.span_id}</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${value.toFixed(1)}</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${runs}</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0;font-family:monospace">${actualLen.toFixed(1)}</td>
      </tr>`);
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Cable Span Verification Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Inter, Arial, sans-serif; color: #1e293b; background: #fff; }
  @page { size: A3 landscape; margin: 15mm; }
  .page-break { break-before: page; page-break-before: always; }
  .header-section { margin-bottom: 20px; }
  h1  { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
  .subtitle { font-size: 14px; color: #64748b; margin-bottom: 20px; }
  .legend-box { display: flex; align-items: center; gap: 20px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .legend-item { display: flex; align-items: center; gap: 8px; color: #334155; font-weight: 500; }
  .legend-line { width: 32px; height: 4px; border-radius: 2px; display: inline-block; }
  .legend-label { background: #16a34a; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  .image-container { width: 100%; height: 70vh; display: flex; justify-content: center; align-items: center; overflow: hidden; }
  img { max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { background: #f8fafc; padding: 10px 12px; border: 1px solid #e2e8f0; text-align: left; font-weight: 600; color: #475569; }
  h2 { font-size: 20px; margin-bottom: 16px; }
</style>
</head>
<body>
  <div class="header-section">
    <h1>Cable Span Verification Report</h1>
    <div class="subtitle">Generated: ${dateStr} &nbsp;|&nbsp; Layers: ${layerName} &nbsp;|&nbsp; Spans with values: ${totalSpans.toLocaleString()}</div>

    <div class="legend-box">
      <strong style="color: #0f172a;">Legend:</strong>
      <div class="legend-item"><span class="legend-line" style="background: #000;"></span> DXF drawing lines</div>
      <div class="legend-item"><span class="legend-line" style="background: #dc2626; height: 8px; border-radius: 3px;"></span> Cable span</div>
      <div class="legend-item"><span class="legend-label">123.4m</span> Strand value</div>
    </div>
  </div>

  <div class="image-container">
    <img src="${imageData}" alt="Verification Map" />
  </div>

  <div class="page-break">
    <h2>Span Data</h2>
    ${spanRows.length ? `<table><thead><tr><th>Span ID</th><th>Strand Value (m)</th><th>Cable Runs</th><th>Actual Length (m)</th></tr></thead><tbody>${spanRows.join("")}</tbody></table>` : "<p style='color:#64748b;font-size:14px'>No spans with strand values.</p>"}
  </div>
</body>
</html>`;

    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const imgEl = doc.querySelector("img");
    const doPrint = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 2000);
    };
    if (imgEl) {
      imgEl.onload = doPrint;
      if (imgEl.complete) doPrint();
    } else {
      doPrint();
    }
  }, [isLayerVisible]);

  useEffect(() => {
    if (onExportVerificationRef) {
      onExportVerificationRef.current = exportVerificationPdf;
    }
  }, [onExportVerificationRef, exportVerificationPdf]);

  const visibleCount = layers.filter((l) => l.visible).length;
  const selectedSpan =
    cableSpansRef.current.find((s) => s.span_id === selectedSpanId) ?? null;
  const selectedStatus =
    selectedSpanId !== null ? (cableStatuses[selectedSpanId] ?? null) : null;
  const hoveredSpanData =
    hoveredSpanId !== null
      ? cableSpansRef.current.find((s) => s.span_id === hoveredSpanId)
      : null;
  const hoveredSpanStatus =
    hoveredSpanId !== null ? cableStatuses[hoveredSpanId] : null;
  const hoveredPoleData =
    hoveredPoleId !== null
      ? polesRef.current.find((pole) => pole.pole_id === hoveredPoleId) ?? null
      : null;
  const canvasCursor = panRef.current.active
    ? "grabbing"
    : cutHereModeRef.current
      ? "crosshair"
    : autoCutModeRef.current !== "idle"
      ? "crosshair"
      : poleEditModeRef.current !== "idle"
      ? "crosshair"
      : poleConnectModeRef.current !== "idle"
      ? "crosshair"
      : pairingModeRef.current
        ? "crosshair"
        : hoveredPoleId !== null
          ? "pointer"
        : hoveredSpanId !== null
          ? "pointer"
          : "grab";

  return (
    <div className="flex-1 relative overflow-hidden bg-[#e8edf5]">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20 bg-[#e8edf5]">
          <div className="w-10 h-10 border-4 border-border border-t-accent rounded-full animate-spin-fast" />
          <p className="text-sm text-muted">Loading DXF layers…</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="bg-danger-light border border-[#fecaca] text-danger rounded-xl px-6 py-4 text-sm">
            {error}
          </div>
        </div>
      )}

      {hoveredPoleData && !panRef.current.active && (
        <div
          ref={tooltipRef}
          className="fixed z-50 pointer-events-none bg-slate-900/95 backdrop-blur-md text-slate-200 p-3 rounded-lg shadow-xl text-xs flex flex-col gap-1.5 border border-slate-700/50 min-w-[220px] transition-opacity duration-150"
          style={{ left: 0, top: 0, display: "none" }}
        >
          <div className="font-semibold text-[13px] text-white mb-1 border-b border-slate-700 pb-1.5">
            Pole Details
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">ID:</span>
            <span className="font-mono text-white">
              {hoveredPoleData.pole_id}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Name:</span>
            <span className="font-mono text-white">
              {hoveredPoleData.name || `POLE_${hoveredPoleData.pole_id}`}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Layer:</span>
            <span className="font-mono text-white truncate max-w-[120px]">
              {hoveredPoleData.layer}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Source:</span>
            <span className="font-mono text-white">
              {hoveredPoleData.source}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">CAD:</span>
            <span className="font-mono text-white">
              {hoveredPoleData.cx.toFixed(2)}, {hoveredPoleData.cy.toFixed(2)}
            </span>
          </div>
          {(hoveredPoleData.map_latitude != null ||
            hoveredPoleData.map_longitude != null) && (
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">GPS:</span>
              <span className="font-mono text-white">
                {hoveredPoleData.map_latitude?.toFixed(6) ?? "?"},{" "}
                {hoveredPoleData.map_longitude?.toFixed(6) ?? "?"}
              </span>
            </div>
          )}
        </div>
      )}

      {!hoveredPoleData && hoveredSpanData && !panRef.current.active && (
        <div
          ref={tooltipRef}
          className="fixed z-50 pointer-events-none bg-slate-900/95 backdrop-blur-md text-slate-200 p-3 rounded-lg shadow-xl text-xs flex flex-col gap-1.5 border border-slate-700/50 min-w-[220px] transition-opacity duration-150"
          style={{ left: 0, top: 0, display: "none" }}
        >
          <div className="font-semibold text-[13px] text-white mb-1 border-b border-slate-700 pb-1.5">
            Span Details
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">ID:</span>
            <span className="font-mono text-white">
              {hoveredSpanData.span_id}
            </span>
          </div>
          {/*<div className="flex justify-between gap-4">
            <span className="text-slate-400">Layer:</span>
            <span className="font-mono text-white truncate max-w-[120px]">
              {hoveredSpanData.layer}
            </span>
          </div>*/}
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Pole Connection:</span>
            <span className="font-mono text-white">
              {hoveredSpanData.from_pole || "?"} &rarr;{" "}
              {hoveredSpanData.to_pole || "?"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Strand length:</span>
            <span className="font-mono text-white">
              {(
                hoveredSpanData.meterValue ?? hoveredSpanData.total_length
              ).toFixed(2)}{" "}
              meters
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Cable runs:</span>
            <span className="font-mono text-white">
              {hoveredSpanData.cable_runs}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Actual length:</span>
            <span className="font-mono text-white">
              {(
                (hoveredSpanData.meterValue ?? hoveredSpanData.total_length) *
                (hoveredSpanData.cable_runs || 1)
              ).toFixed(2)}{" "}
              meters
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Current label:</span>
            <span
              className={`font-semibold ${hoveredSpanStatus === "Recovered" ? "text-green-400" : hoveredSpanStatus === "Partial" ? "text-yellow-400" : hoveredSpanStatus === "Missing" ? "text-red-400" : "text-slate-300"}`}
            >
              {hoveredSpanStatus ?? "Not labeled"}
            </span>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: canvasCursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      />

      {!loading && !error && (
        <DxfToolbar
          layerPanelOpen={layerPanelOpen}
          onToggleLayerPanel={() => setLayerPanelOpen((o) => !o)}
          onFit={fitView}
          onZoomIn={() => {
            vpRef.current.scale *= 1.3;
            redraw();
          }}
          onZoomOut={() => {
            vpRef.current.scale /= 1.3;
            redraw();
          }}
          visibleCount={visibleCount}
          totalCount={layers.length}
          onExportPdf={exportToPdf}
          onSyncStatus={
            asbuiltNodeId != null ? () => void syncTeardownStatus() : undefined
          }
          syncState={syncState}
          syncLabel={
            syncError
              ? syncError
              : syncSummary
                ? `${syncSummary.matched} span(s) matched, ${syncSummary.unmatched} unmatched — ${syncSummary.at.toLocaleTimeString()}`
                : undefined
          }
        />
      )}

      {layerPanelOpen && !loading && !error && (
        <DxfLayerPanel
          layers={layers}
          onToggle={toggleLayer}
          onShowAll={showAll}
          onHideAll={hideAll}
        />
      )}

      {!loading && !error && (
        <div
          className={`absolute bottom-6 z-10 flex flex-col items-end gap-4 ${selectedSpan ? "right-[23rem]" : "right-6"}`}
        >
          {poleScanStatus === "done" && (
            <>
              <button
                onClick={() => {
                  pendingAutoCutRef.current = null;
                  autoCutModeRef.current = "idle";
                  setAutoCutMode("idle");
                  cutHereModeRef.current = false;
                  setCutHereMode(false);
                  showPolesRef.current = true;
                  setShowPoles(true);
                  poleEditModeRef.current =
                    poleEditMode === "add" ? "idle" : "add";
                  setPoleEditMode((prev) => (prev === "add" ? "idle" : "add"));
                  redraw();
                }}
                className={`w-52 justify-center bg-white/95 backdrop-blur border shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm transition-all flex items-center gap-2 ${poleEditMode === "add" ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
              >
                ➕ Add Pole
              </button>
              <button
                onClick={() => {
                  pendingAutoCutRef.current = null;
                  autoCutModeRef.current = "idle";
                  setAutoCutMode("idle");
                  cutHereModeRef.current = false;
                  setCutHereMode(false);
                  showPolesRef.current = true;
                  setShowPoles(true);
                  poleEditModeRef.current =
                    poleEditMode === "delete" ? "idle" : "delete";
                  setPoleEditMode((prev) =>
                    prev === "delete" ? "idle" : "delete",
                  );
                  redraw();
                }}
                className={`w-52 justify-center bg-white/95 backdrop-blur border shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm transition-all flex items-center gap-2 ${poleEditMode === "delete" ? "border-red-300 text-red-700 hover:bg-red-50" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
              >
                🗑️ Delete Pole
              </button>
              <button
                onClick={() => {
                  window.open(
                    `http://localhost:8000/?dxf_path=${encodeURIComponent(dxfPath)}`,
                    "_blank",
                  );
                }}
                className="w-52 justify-center bg-indigo-600 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm text-white hover:bg-indigo-700 transition-all flex items-center gap-2"
              >
                🌍 Insert Coordinates
              </button>
              <button
                onClick={() => autoConnectPoles()}
                className="w-52 justify-center bg-white/95 backdrop-blur border border-blue-200 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm text-blue-700 hover:bg-blue-50 transition-all flex items-center gap-2"
              >
                ⚡ Auto-Connect Cables
              </button>
              <button
                onClick={() => {
                  const next = !cutHereModeRef.current;
                  pendingAutoCutRef.current = null;
                  autoCutModeRef.current = "idle";
                  setAutoCutMode("idle");
                  poleEditModeRef.current = "idle";
                  setPoleEditMode("idle");
                  cutHereModeRef.current = next;
                  setCutHereMode(next);
                  if (next) {
                    showAutoCutNotice(
                      "Cut Here mode: click the blue cable exactly where it should split.",
                    );
                  }
                  redraw();
                }}
                className={`w-52 justify-center bg-white/95 backdrop-blur border shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm transition-all flex items-center gap-2 ${cutHereMode ? "border-sky-300 text-sky-700 hover:bg-sky-50" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
              >
                {cutHereMode ? "✖ Cancel Cut Here" : "✂ Cut Here"}
              </button>
              <button
                onClick={() => {
                  if (autoCutModeRef.current === "idle") {
                    cutHereModeRef.current = false;
                    setCutHereMode(false);
                    poleEditModeRef.current = "idle";
                    setPoleEditMode("idle");
                    pendingAutoCutRef.current = null;
                    autoCutModeRef.current = "pickSpan";
                    setAutoCutMode("pickSpan");
                  } else {
                    pendingAutoCutRef.current = null;
                    autoCutModeRef.current = "idle";
                    setAutoCutMode("idle");
                  }
                }}
                className="w-52 justify-center bg-white/95 backdrop-blur border border-rose-200 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm text-rose-700 hover:bg-rose-50 transition-all flex items-center gap-2"
              >
                {autoCutMode === "idle"
                  ? "✂️ Auto Cut Spans"
                  : autoCutMode === "pickSpan"
                    ? "✖ Cancel Auto Cut"
                    : "✖ Cancel Pole Pick"}
              </button>
            </>
          )}

          <button
            onClick={togglePoles}
            disabled={poleScanStatus !== "done"}
            className={`w-52 justify-center bg-white/95 backdrop-blur border border-slate-200 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm flex items-center gap-2 transition-all ${poleScanStatus !== "done" ? "opacity-50 cursor-not-allowed" : "text-slate-700 hover:bg-slate-50"}`}
          >
            {poleScanStatus === "processing" ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-300 border-t-amber-500 rounded-full animate-spin" />
                Scanning Poles...
              </>
            ) : showPoles ? (
              "📍 Hide Poles"
            ) : (
              "📍 Display Poles"
            )}
          </button>
          <button
            onClick={toggleActives}
            disabled={activesLoading}
            className="w-52 justify-center bg-white/95 backdrop-blur border border-slate-200 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-2"
          >
            {activesLoading ? (
              <div className="w-4 h-4 border-2 border-slate-300 border-t-purple-500 rounded-full animate-spin" />
            ) : showActives ? (
              "👁️ Hide Actives"
            ) : (
              "🔌 Show Actives"
            )}
          </button>
        </div>
      )}

      {!loading &&
        !error &&
        (poleEditMode !== "idle" || autoCutMode !== "idle" || cutHereMode) && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-white/95 backdrop-blur border border-slate-200 shadow-lg px-4 py-2 rounded-full text-sm font-semibold text-slate-700">
          {cutHereMode
            ? "Cut Here mode: click the exact spot on the blue cable"
            : autoCutMode === "pickSpan"
            ? "Auto Cut mode: click the cable line you want to cut"
            : autoCutMode === "pickPole"
              ? "Auto Cut mode: now click the nearby pole that should guide the cut"
            : poleEditMode === "add"
            ? "Add Pole mode: click on the DXF viewer to place a pole"
            : "Delete Pole mode: click an existing pole to remove it"}
        </div>
      )}

      {!loading && !error && autoCutNotice && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 bg-amber-50/95 backdrop-blur border border-amber-200 shadow-lg px-4 py-2 rounded-full text-sm font-semibold text-amber-800">
          {autoCutNotice}
        </div>
      )}

      {deletedSpans.length > 0 && !loading && !error && (
        <div className="absolute bottom-6 left-6 z-10 flex flex-col gap-2">
          {showTrashPanel && (
            <div className="bg-white/95 backdrop-blur border border-slate-200 shadow-lg rounded-xl p-3 w-64 max-h-[300px] overflow-y-auto mb-2 animate-in fade-in slide-in-from-bottom-2">
              <h3 className="font-semibold text-xs text-slate-700 mb-2 px-1">
                Deleted Spans
              </h3>
              <div className="flex flex-col gap-1">
                {deletedSpans.map((ds) => (
                  <div
                    key={ds.span.span_id}
                    className="flex justify-between items-center text-[11px] bg-slate-50 border border-slate-100 rounded px-2 py-1.5"
                  >
                    <span className="font-mono text-slate-600">
                      ID: {ds.span.span_id}
                    </span>
                    <button
                      onClick={() => restoreSpan(ds.span.span_id)}
                      className="text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => setShowTrashPanel(!showTrashPanel)}
            className="bg-white/95 backdrop-blur border border-red-200 shadow-lg px-4 py-2.5 rounded-full font-semibold text-sm text-red-600 hover:bg-red-50 transition-all flex items-center gap-2 w-fit"
          >
            🗑️ Trash ({deletedSpans.length})
          </button>
        </div>
      )}

      {!loading && !error && cableLayerNames.length > 0 && (
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
          <div className="bg-surface/90 border border-border rounded-lg px-3 py-2 text-[11px] text-muted backdrop-blur-sm shadow-sm min-w-[250px]">
            <div className="font-semibold text-[#1e293b]">
              Cable interaction
            </div>
            <div>
              {/*Layers:{" "}
              <span className="font-mono">{cableLayerNames.join(", ")}</span>*/}
            </div>
            <div className="text-[#166534]">
              Recovered: {totalRecovered.toFixed(2)} m
            </div>
            <div className="text-[#92400e]">
              Unrecovered/Partial: {totalUnrecovered.toFixed(2)} m
            </div>
            <div className="text-[#991b1b]">
              Missing: {totalMissing.toFixed(2)} m
            </div>
            <div className="text-[#64748b]">
              Total Strand length: {totalStrandLength.toFixed(2)} m
            </div>
            <div className="text-[#64748b]">
              Total Cables: {totalLength.toFixed(2)} m
            </div>
            <label className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-200 cursor-pointer hover:text-slate-800 transition-colors">
              <input
                type="checkbox"
                className="w-3 h-3 cursor-pointer"
                checked={showChips}
                onChange={(e) => {
                  const isChecked = e.target.checked;
                  setShowChips(isChecked);
                  showChipsRef.current = isChecked;
                  redraw();
                }}
              />
              <span className="font-medium">Show Status Labels</span>
            </label>
          </div>

          {selectedSpan && (
            <div className="bg-white/95 border border-slate-200 rounded-lg px-3 py-3 text-[11px] text-slate-900 backdrop-blur-sm shadow-sm min-w-[280px]">
              <div className="font-semibold text-[12px] mb-2 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span>Selected cable span</span>
                  <button
                    onClick={() => setSpanToDelete(selectedSpan.span_id)}
                    className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-colors"
                    title="Delete Cable Span"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
                {pairingMode && (
                  <span
                    className={`text-[10px] font-normal px-1.5 py-0.5 rounded ${multiAction === "runs" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}
                  >
                    {multiAction === "runs"
                      ? "Selecting Runs Active"
                      : "Merge Mode Active"}
                  </span>
                )}
              </div>
              <div>ID: {selectedSpan.span_id}</div>

              {/*<div>Layer: {selectedSpan.layer}</div>*/}
              <div>
                Strand length:{" "}
                {selectedSpan.meterValue?.toFixed(2) ??
                  selectedSpan.total_length.toFixed(2)}{" "}
                meters
              </div>
              <div>Cable runs: {selectedSpan.cable_runs}</div>
              <div className="font-semibold text-slate-700 mt-1">
                Actual Cable length:{" "}
                {(
                  (selectedSpan.meterValue ?? selectedSpan.total_length) *
                  selectedSpan.cable_runs
                ).toFixed(2)}{" "}
                meters
              </div>
              <div className="mt-2">
                Current label:{" "}
                <span className="font-semibold">
                  {selectedStatus ?? "Not labeled"}
                </span>
              </div>
              {selectedStatus === "Partial" && (
                <div className="mt-1 text-[11px]">
                  R:{" "}
                  {Math.min(
                    partialDetails[selectedSpan.span_id]?.recovered ?? 0,
                    selectedSpan.meterValue ?? selectedSpan.total_length,
                  ).toFixed(2)}{" "}
                  / U:{" "}
                  {Math.max(
                    0,
                    (selectedSpan.meterValue ?? selectedSpan.total_length) -
                      (partialDetails[selectedSpan.span_id]?.recovered ?? 0),
                  ).toFixed(2)}
                </div>
              )}

              {selectedStatus === "Partial" && (
                <div className="mt-2 bg-slate-50 p-2.5 rounded border border-slate-200 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase">
                      Recovered (m) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-[80px] border px-1.5 py-1 rounded text-[11px] outline-none focus:border-purple-400"
                      placeholder="0.00"
                      value={
                        partialDetails[selectedSpan.span_id]?.recovered ===
                        undefined
                          ? ""
                          : partialDetails[selectedSpan.span_id]?.recovered
                      }
                      onChange={(e) => {
                        const strandLen =
                          selectedSpan.meterValue ?? selectedSpan.total_length;
                        let val = parseFloat(e.target.value);
                        if (isNaN(val)) val = 0;
                        if (val > strandLen) val = strandLen;
                        if (val < 0) val = 0;
                        setPartialDetails((prev) => ({
                          ...prev,
                          [selectedSpan.span_id]: { recovered: val },
                        }));
                      }}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase">
                      Unrecovered (m)
                    </label>
                    <span className="text-[11px] font-mono font-medium text-slate-700 bg-slate-200/50 px-2 py-1 rounded">
                      {Math.max(
                        0,
                        (selectedSpan.meterValue ?? selectedSpan.total_length) -
                          (partialDetails[selectedSpan.span_id]?.recovered ??
                            0),
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-2 bg-slate-50 p-2.5 rounded border border-slate-200 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">
                    Pole Connection
                  </label>
                  {poleConnectMode !== "idle" && (
                    <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded animate-pulse">
                      Select '{poleConnectMode}' pole...
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 bg-white border px-2 py-1.5 rounded text-[10px] flex flex-col overflow-hidden">
                    <span className="text-slate-400 font-semibold mb-0.5">
                      FROM
                    </span>
                    <span className="font-mono text-slate-700 truncate">
                      {selectedSpan.from_pole || "—"}
                    </span>
                  </div>
                  <div className="flex-1 bg-white border px-2 py-1.5 rounded text-[10px] flex flex-col overflow-hidden">
                    <span className="text-slate-400 font-semibold mb-0.5">
                      TO
                    </span>
                    <span className="font-mono text-slate-700 truncate">
                      {selectedSpan.to_pole || "—"}
                    </span>
                  </div>
                </div>
                <button
                  className={`w-full py-1.5 rounded text-[11px] font-medium border transition-colors ${poleConnectMode !== "idle" ? "bg-blue-500 hover:bg-blue-600 text-white border-blue-600 shadow-sm" : "bg-white hover:bg-slate-100 text-slate-700 border-slate-200"}`}
                  onClick={() => {
                    const nextMode =
                      poleConnectMode === "idle" ? "from" : "idle";
                    setPoleConnectMode(nextMode);
                    poleConnectModeRef.current = nextMode;
                  }}
                >
                  {poleConnectMode !== "idle"
                    ? "Cancel Connection Mode"
                    : "🔌 Connect Poles Manually"}
                </button>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {!pairingMode ? (
                  <div className="flex gap-2">
                    <button
                      className="flex-1 px-2.5 py-1.5 rounded-md border border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100 transition font-medium flex justify-center items-center shadow-sm"
                      onClick={() => startMultiAction("runs")}
                    >
                      🔗 Select Cable runs
                    </button>
                    <button
                      className="flex-1 px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 transition font-medium flex justify-center items-center shadow-sm"
                      onClick={() => startMultiAction("merge")}
                    >
                      ➕ Merge Cables
                    </button>
                  </div>
                ) : (
                  <button
                    className={`w-full px-2.5 py-1.5 rounded-md border transition font-medium flex justify-center items-center shadow-sm text-white ${multiAction === "runs" ? "border-purple-300 bg-purple-500 hover:bg-purple-600" : "border-blue-300 bg-blue-500 hover:bg-blue-600"}`}
                    onClick={promptFinishMultiAction}
                  >
                    {multiAction === "runs"
                      ? "Finish Selecting Runs (Enter)"
                      : "Finish Merging (Enter)"}
                  </button>
                )}
                {!pairingMode && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    <button
                      className="px-2.5 py-1 rounded-md border border-green-200 bg-green-50 text-green-800 hover:bg-green-100 transition"
                      onClick={() =>
                        setCableStatus(selectedSpan.span_id, "Recovered")
                      }
                    >
                      Recovered
                    </button>
                    <button
                      className="px-2.5 py-1 rounded-md border border-yellow-200 bg-yellow-50 text-yellow-800 hover:bg-yellow-100 transition"
                      onClick={() =>
                        setCableStatus(selectedSpan.span_id, "Partial")
                      }
                    >
                      Partial
                    </button>
                    <button
                      className="px-2.5 py-1 rounded-md border border-red-200 bg-red-50 text-red-800 hover:bg-red-100 transition"
                      onClick={() =>
                        setCableStatus(selectedSpan.span_id, "Missing")
                      }
                    >
                      Missing
                    </button>
                    <button
                      className="px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition"
                      onClick={() => clearCableStatus(selectedSpan.span_id)}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {confirmPairingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-lg p-6 w-[320px]">
            <h3 className="font-semibold mb-3 text-sm">
              {multiAction === "runs" ? "Confirm Cable Runs" : "Confirm Merge"}
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              {multiAction === "runs"
                ? `Are you sure you want to pair ${pairedSpanIds.length} span(s) to the main cable ID ${mainPairingSpanId}? They will share the same ID and retain the main cable's length.`
                : `Are you sure you want to merge ${pairedSpanIds.length} span(s) into the main cable ID ${mainPairingSpanId}? This will physically combine them and sum their lengths.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm transition"
                onClick={cancelMultiAction}
              >
                Cancel
              </button>
              <button
                className={`px-3 py-1.5 text-white rounded text-sm transition ${multiAction === "runs" ? "bg-purple-500 hover:bg-purple-600" : "bg-blue-500 hover:bg-blue-600"}`}
                onClick={handleConfirmMultiAction}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {spanToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl p-6 w-[320px] animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 p-2 rounded-full text-red-600">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m10.29 3.86 4.64 8M14.5 21H9.5a2 2 0 0 1-2-2V7.5h9V19a2 2 0 0 1-2 2zM5 7.5h14M10 3.5h4a2 2 0 0 1 2 2v2H8v-2a2 2 0 0 1 2-2z" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-800">
                Delete Cable Span?
              </h3>
            </div>
            <p className="text-xs text-slate-600 mb-6 leading-relaxed">
              Are you sure you want to delete Span ID{" "}
              <span className="font-mono bg-slate-100 px-1 rounded">
                {spanToDelete}
              </span>
              ? This will remove it from the map completely.
              <br />
              <br />
              <span className="text-[10px] text-slate-400 font-medium">
                You can recover it later from the Trash bin.
              </span>
            </p>
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition"
                onClick={() => setSpanToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg text-xs transition shadow-sm shadow-red-200"
                onClick={confirmDeleteSpan}
              >
                Delete Span
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
