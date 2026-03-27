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
}

interface CableSpan {
  span_id: number;
  layer: string;
  bbox: [number, number, number, number];
  cx: number;
  cy: number;
  segment_count: number;
  total_length: number;
  meterValue?: number | null;
  cable_runs: number;
  segments: RawSegment[];
  from_pole?: string;
  to_pole?: string;
}

interface CableSpanExport {
  span_id: number;
  layer: string;
  bbox: [number, number, number, number];
  cx: number;
  cy: number;
  segment_count: number;
  total_length: number;
  meter_value?: number | null;
  cable_runs: number;
  from_pole?: string | null;
  to_pole?: string | null;
}

interface Props {
  dxfPath: string;
  ocrResults: any[];
  isActive: boolean;
  onExportPdfRef?: React.MutableRefObject<(() => void) | null>;
  boundary: BoundaryPoint[] | null;
  isMaskEnabled: boolean;
  onSpansChange?: (spans: CableSpanExport[]) => void;
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
  onExportPdfRef,
  boundary,
  isMaskEnabled,
  onSpansChange,
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
  const selectedSpanRef = useRef<number | null>(null);
  const cableStatusRef = useRef<Record<number, CableRecoveryStatus>>({});
  const ocrMeterValuesRef = useRef<{ x: number; y: number; value: number }[]>(
    [],
  );
  const splitHistoryRef = useRef<
    { prev: CableSpan[]; prevDeleted?: DeletedSpanData[] }[]
  >([]);
  const fileCacheRef = useRef<Record<string, FileDataCache>>({});
  const nextSpanIdRef = useRef<number>(1);
  const exportPdfFnRef = useRef<(() => void) | null>(null);

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

  const [cableSpans, setCableSpans] = useState<CableSpan[]>([]);
  const [layers, setLayers] = useState<DxfLayerData[]>([]);
  const [layerPanelOpen, setLayerPanelOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [cableDataVersion, setCableDataVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSpanId, setHoveredSpanId] = useState<number | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<number | null>(null);

  // UPDATED TO ARRAY FOR MULTIPLE LAYERS
  const [cableLayerNames, setCableLayerNames] = useState<string[]>([]);

  const [cableStatuses, setCableStatuses] = useState<
    Record<number, CableRecoveryStatus>
  >({});

  // Helper to notify parent of span changes
  const notifySpansChange = useCallback((spans: CableSpan[]) => {
    if (!onSpansChange) return;
    const exportSpans: CableSpanExport[] = spans.map((s) => ({
      span_id: s.span_id,
      layer: s.layer,
      bbox: s.bbox,
      cx: s.cx,
      cy: s.cy,
      segment_count: s.segment_count,
      total_length: s.total_length,
      meter_value: s.meterValue ?? null,
      cable_runs: s.cable_runs,
      from_pole: s.from_pole ?? null,
      to_pole: s.to_pole ?? null,
    }));
    onSpansChange(exportSpans);
  }, [onSpansChange]);

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
        const statusEntries = Object.entries(cableStatusRef.current);

        const drawSpanPath = (span: CableSpan) => {
          ctx.beginPath();
          for (const seg of span.segments) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
          }
        };

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
            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
            ctx.lineWidth = (2.4 + ((span.cable_runs || 1) - 1) * 4) / vp.scale;
            drawSpanPath(span);
            ctx.stroke();
            ctx.restore();
          }
        }
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

      // 4. Draw Poles
      if (opts.showPoles) {
        ctx.save();
        const r = 12 / vp.scale;
        for (const pole of polesRef.current) {
          if (!isLayerVisible(pole.layer)) continue;

          // SKIP IF OUTSIDE BOUNDARY
          if (
            isMaskOn &&
            currentBoundary &&
            !isPointInPolygon(pole.cx, pole.cy, currentBoundary)
          )
            continue;

          ctx.beginPath();
          ctx.arc(pole.cx, pole.cy, r, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(245, 158, 11, 0.85)";
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2 / vp.scale;
          ctx.stroke();

          if (vp.scale > 0.8) {
            ctx.save();
            ctx.translate(pole.cx, pole.cy + r * 1.2);
            ctx.scale(1, -1);
            ctx.fillStyle = "#d97706";
            ctx.font = `bold ${Math.max(0.2, 0.5 / vp.scale)}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(pole.name || `POLE_${pole.pole_id}`, 0, 0);
            ctx.restore();
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

  const autoConnectPoles = useCallback(() => {
    if (!polesRef.current.length || !cableSpansRef.current.length) return;
    const BUFFER_RADIUS = 30,
      RAY_MAX_DIST = 150,
      RAY_TOLERANCE = 15;

    const newSpans = cableSpansRef.current.map((span) => {
      if (span.segments.length === 0) return span;
      const firstSeg = span.segments[0],
        lastSeg = span.segments[span.segments.length - 1];
      const ptA = { x: firstSeg.x1, y: firstSeg.y1 },
        ptA_in = { x: firstSeg.x2, y: firstSeg.y2 };
      const ptB = { x: lastSeg.x2, y: lastSeg.y2 },
        ptB_in = { x: lastSeg.x1, y: lastSeg.y1 };

      const findPoleForEndpoint = (
        pt: { x: number; y: number },
        pt_in: { x: number; y: number },
      ) => {
        let closestPole: PoleTag | null = null,
          minDist = Infinity;
        for (const pole of polesRef.current) {
          if (
            maskEnabledRef.current &&
            boundaryRef.current &&
            !isPointInPolygon(pole.cx, pole.cy, boundaryRef.current)
          )
            continue;
          const dist = Math.hypot(pole.cx - pt.x, pole.cy - pt.y);
          if (dist < BUFFER_RADIUS && dist < minDist) {
            minDist = dist;
            closestPole = pole;
          }
        }
        if (closestPole) return closestPole.name;
        if (pt.x === pt_in.x && pt.y === pt_in.y) return null;

        const angle = Math.atan2(pt.y - pt_in.y, pt.x - pt_in.x);
        const rayEndX = pt.x + Math.cos(angle) * RAY_MAX_DIST,
          rayEndY = pt.y + Math.sin(angle) * RAY_MAX_DIST;
        closestPole = null;
        minDist = Infinity;

        for (const pole of polesRef.current) {
          if (
            maskEnabledRef.current &&
            boundaryRef.current &&
            !isPointInPolygon(pole.cx, pole.cy, boundaryRef.current)
          )
            continue;
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
        return closestPole ? closestPole.name : undefined;
      };

      return {
        ...span,
        from_pole: findPoleForEndpoint(ptA, ptA_in) || span.from_pole,
        to_pole: findPoleForEndpoint(ptB, ptB_in) || span.to_pole,
      };
    });

    splitHistoryRef.current.push({
      prev: cableSpansRef.current.map((s) => ({ ...s })),
      prevDeleted: deletedSpansRef.current.map((d) => ({ ...d })),
    });
    cableSpansRef.current = newSpans;
    setCableSpans(newSpans);
    notifySpansChange(newSpans);
    redraw();
  }, [redraw, notifySpansChange]);

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
    };
  }, []);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/pole_tags");
        const data = await res.json();
        if (data.status) setPoleScanStatus(data.status);
        if (data.status === "done" && data.tags) {
          polesRef.current = data.tags;
          setPoles(data.tags);
          if (showPolesRef.current) redraw();
        }
      } catch (e) {}
    }, 2000);
    return () => clearInterval(poll);
  }, [redraw]);

  const togglePoles = () => {
    const next = !showPoles;
    setShowPoles(next);
    showPolesRef.current = next;
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
      const hoverTolWorld = 8 / Math.max(vpRef.current.scale, 1e-9);

      for (const span of cableSpansRef.current) {
        if (!isLayerVisible(span.layer)) continue;

        if (
          maskEnabledRef.current &&
          boundaryRef.current &&
          !isPointInPolygon(span.cx, span.cy, boundaryRef.current)
        )
          continue;

        const [mnx, mny, mxx, mxy] = span.bbox;
        if (
          worldX < mnx - hoverTolWorld ||
          worldX > mxx + hoverTolWorld ||
          worldY < mny - hoverTolWorld ||
          worldY > mxy + hoverTolWorld
        )
          continue;

        for (const s of span.segments) {
          const d = pointToSegmentDistance(
            worldX,
            worldY,
            s.x1,
            s.y1,
            s.x2,
            s.y2,
          );
          if (d < bestDist) {
            bestDist = d;
            bestId = span.span_id;
          }
        }
      }
      return bestDist <= hoverTolWorld ? bestId : null;
    },
    [isLayerVisible],
  );

  const splitCableSpan = useCallback(
    (spanId: number, cursorWorld?: { x: number; y: number }) => {
      const spans = cableSpansRef.current;
      const spanIndex = spans.findIndex((s) => s.span_id === spanId);
      if (spanIndex === -1) return;
      const span = spans[spanIndex];
      const segs = span.segments;
      if (segs.length < 2) return;
      let splitIndex: number | null = Math.floor(segs.length / 2);

      if (cursorWorld) {
        let minDist = Infinity;
        let closestIdx = splitIndex;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const d = pointToSegmentDistance(
            cursorWorld.x,
            cursorWorld.y,
            s.x1,
            s.y1,
            s.x2,
            s.y2,
          );
          if (d < minDist) {
            minDist = d;
            closestIdx = i;
          }
        }
        splitIndex = findSafeCutIndex(
          segs,
          closestIdx,
          cursorWorld.x,
          cursorWorld.y,
        );
      }
      if (
        splitIndex === null ||
        splitIndex < 0 ||
        splitIndex >= segs.length - 1
      )
        return;

      const firstHalf = segs.slice(0, splitIndex + 1);
      const secondHalf = segs.slice(splitIndex + 1);
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

      const m1 = computeSpanMetrics(firstHalf);
      const m2 = computeSpanMetrics(secondHalf);
      const newSpan1: CableSpan = {
        ...span,
        span_id: newId1,
        segments: firstHalf,
        segment_count: firstHalf.length,
        from_pole: span.from_pole,
        to_pole: undefined,
        ...m1,
        meterValue: getNearestMeterValue(m1.cx, m1.cy),
      };
      const newSpan2: CableSpan = {
        ...span,
        span_id: newId2,
        segments: secondHalf,
        segment_count: secondHalf.length,
        from_pole: undefined,
        to_pole: span.to_pole,
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
    },
    [redraw, partialDetails],
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
            const m1 = computeSpanMetrics(firstHalf);
            const m2 = computeSpanMetrics(secondHalf);
            const span1: CableSpan = {
              ...span,
              span_id: nextSpanIdRef.current++,
              segments: firstHalf,
              segment_count: firstHalf.length,
              from_pole: span.from_pole,
              to_pole: undefined,
              ...m1,
              meterValue: getNearestMeterValue(m1.cx, m1.cy),
            };
            const span2: CableSpan = {
              ...span,
              span_id: nextSpanIdRef.current++,
              segments: secondHalf,
              segment_count: secondHalf.length,
              from_pole: undefined,
              to_pole: span.to_pole,
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
  }, [partialDetails, redraw, notifySpansChange]);

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
          const newSegments = [...targetSpan.segments, ...neighbor.segments];
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
            segment_count: newSegments.length,
            from_pole: targetSpan.from_pole || neighbor.from_pole,
            to_pole: targetSpan.to_pole || neighbor.to_pole,
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
    const newSegments = [...mainSpan.segments];
    pairedSpansToMerge.forEach((ps) => newSegments.push(...ps.segments));
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
        segment_count: newSegments.length,
        cable_runs: (mainSpan.cable_runs || 1) + totalRunsToAdd,
        bbox: m.bbox,
        cx: m.cx,
        cy: m.cy,
      };
    } else {
      mergedSpan = {
        ...mainSpan,
        segments: newSegments,
        segment_count: newSegments.length,
        bbox: m.bbox,
        cx: m.cx,
        cy: m.cy,
        total_length: mainSpan.total_length,
        meterValue: mainSpan.meterValue,
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
    cableSpansRef.current = [];
    cableLayersRef.current = [];
    cableStatusRef.current = {};
    deletedSpansRef.current = [];
    setDeletedSpans([]);
    setCableLayerNames([]);
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
        const spans: CableSpan[] = (cableData.spans ?? []).map((s: any) => ({
          ...s,
          cable_runs: s.cable_runs || 1,
        }));
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
      selectedSpanRef.current = null;
      setHoveredSpanId(null);
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
        hoveredSpanRef.current !== null ? "flex" : "none";
      tooltipRef.current.style.left = `${e.clientX + 15}px`;
      tooltipRef.current.style.top = `${e.clientY + 15}px`;
    }
    const { x, y } = screenToWorld(sx, sy);
    const hitId = findNearestCableSpan(x, y);
    if (hitId !== hoveredSpanRef.current) {
      hoveredSpanRef.current = hitId;
      setHoveredSpanId(hitId);
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
                ? { from_pole: clickedPole.name }
                : { to_pole: clickedPole.name }),
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
    if (hoveredSpanRef.current !== null) {
      hoveredSpanRef.current = null;
      setHoveredSpanId(null);
      redraw();
    }
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

  const canvasCursor = panRef.current.active
    ? "grabbing"
    : poleConnectModeRef.current !== "idle"
      ? "crosshair"
      : pairingModeRef.current
        ? "crosshair"
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

      {hoveredSpanData && !panRef.current.active && (
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
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Layer:</span>
            <span className="font-mono text-white truncate max-w-[120px]">
              {hoveredSpanData.layer}
            </span>
          </div>
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

      {!loading && !error && poleScanStatus === "done" && (
        <button
          onClick={autoConnectPoles}
          className="absolute bottom-[8.5rem] right-6 z-10 bg-white/95 backdrop-blur border border-blue-200 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm text-blue-700 hover:bg-blue-50 transition-all flex items-center gap-2"
        >
          ⚡ Auto-Connect Cables
        </button>
      )}

      {!loading && !error && (
        <button
          onClick={togglePoles}
          disabled={poleScanStatus !== "done"}
          className={`absolute bottom-[4.5rem] right-6 z-10 bg-white/95 backdrop-blur border border-slate-200 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm flex items-center gap-2 transition-all ${poleScanStatus !== "done" ? "opacity-50 cursor-not-allowed" : "text-slate-700 hover:bg-slate-50"}`}
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
      )}

      {!loading && !error && (
        <button
          onClick={toggleActives}
          disabled={activesLoading}
          className="absolute bottom-6 right-6 z-10 bg-white/95 backdrop-blur border border-slate-200 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-2"
        >
          {activesLoading ? (
            <div className="w-4 h-4 border-2 border-slate-300 border-t-purple-500 rounded-full animate-spin" />
          ) : showActives ? (
            "👁️ Hide Actives"
          ) : (
            "🔌 Show Actives"
          )}
        </button>
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
              <div>Layer: {selectedSpan.layer}</div>
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
