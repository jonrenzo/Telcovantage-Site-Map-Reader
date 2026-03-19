"use client";

import { useRef, useEffect, useCallback, useState } from "react";

import type { DxfLayerData, EquipmentShape } from "../../types";

import DxfToolbar from "./DxfToolbar";

import DxfLayerPanel from "./DxfLayerPanel";

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

interface Props {
  dxfPath: string;

  ocrResults: any[];
  isActive: boolean;
}

interface PartialDetail {
  recovered?: number;
}

type CableRecoveryStatus = "Recovered" | "Unrecovered or Partial" | "Missing";

// ── Per-file data cache ────────────────────────────────────────────────────
// Keyed by dxfPath. Stores the raw fetched data so switching back to a
// previously loaded file never re-fetches from the server (which may have
// moved on to a different file's state).
interface FileDataCache {
  segments: Record<string, RawSegment[]>;
  layers: string[];
  bounds: { minx: number; miny: number; maxx: number; maxy: number };
  cableLayer: string | null;
  spans: CableSpan[];
}

// Deterministic per-layer color from name

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

    case "Unrecovered or Partial":
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

export default function DxfViewer({ dxfPath, ocrResults, isActive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  const segmentsRef = useRef<Record<string, RawSegment[]>>({});

  const layersRef = useRef<DxfLayerData[]>([]);

  const cableSpansRef = useRef<CableSpan[]>([]);

  const cableLayerRef = useRef<string | null>(null);

  const hoveredSpanRef = useRef<number | null>(null);

  const selectedSpanRef = useRef<number | null>(null);

  const cableStatusRef = useRef<Record<number, CableRecoveryStatus>>({});
  const ocrMeterValuesRef = useRef<{ x: number; y: number; value: number }[]>(
    [],
  );
  const splitHistoryRef = useRef<{ prev: CableSpan[] }[]>([]);

  // ── Per-file cache: prevents re-fetching when switching back to a file ──
  const fileCacheRef = useRef<Record<string, FileDataCache>>({});

  const [partialDetails, setPartialDetails] = useState<
    Record<number, PartialDetail>
  >({});

  // Pairing State

  const pairingModeRef = useRef(false);

  const pairedSpanIdsRef = useRef<number[]>([]);

  const [pairingMode, setPairingMode] = useState(false);

  const [mainPairingSpanId, setMainPairingSpanId] = useState<number | null>(
    null,
  );

  const [pairedSpanIds, setPairedSpanIds] = useState<number[]>([]);

  const [confirmPairingOpen, setConfirmPairingOpen] = useState(false);

  // Chips Toggle State

  const [showChips, setShowChips] = useState(true);

  const showChipsRef = useRef(true);

  // Actives Toggle State

  const [showActives, setShowActives] = useState(false);

  const [activesLoading, setActivesLoading] = useState(false);

  const showActivesRef = useRef(false);

  const activeShapesRef = useRef<any[]>([]);

  const activesPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poles Toggle & Connect State

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

  const [cableLayerName, setCableLayerName] = useState<string | null>(null);

  const [cableStatuses, setCableStatuses] = useState<
    Record<number, CableRecoveryStatus>
  >({});

  const computeCableLengthSummary = () => {
    let totalRecovered = 0;

    let totalUnrecovered = 0;

    let totalMissing = 0;

    let totalLength = 0;

    let totalStrandLength = 0;

    for (const span of cableSpansRef.current) {
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
      } else if (status === "Unrecovered or Partial") {
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

  const isLayerVisible = useCallback((name: string | null) => {
    if (!name) return false;

    const layer = layersRef.current.find((l) => l.name === name);

    return !!layer?.visible;
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const vp = vpRef.current;

    return {
      x: (sx - vp.x) / vp.scale,

      y: -(sy - vp.y) / vp.scale,
    };
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

      ctx.save();

      ctx.translate(vp.x, vp.y);

      ctx.scale(vp.scale, -vp.scale);

      // 1. Draw base DXF layers

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

      // 2. Draw active cable spans highlights

      const cableLayer = cableLayerRef.current;

      if (cableLayer && isLayerVisible(cableLayer)) {
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

          if (!span) continue;
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

          if (span) {
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

        // Pairing mode highlights

        if (opts.showHover && pairingModeRef.current) {
          for (const pid of pairedSpanIdsRef.current) {
            const span = spanMap.get(pid);

            if (span) {
              ctx.save();

              ctx.lineCap = "round";

              ctx.lineJoin = "round";

              ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";

              ctx.lineWidth = 10 / vp.scale;

              drawSpanPath(span);

              ctx.stroke();

              ctx.strokeStyle = "rgba(147, 51, 234, 0.95)";

              ctx.lineWidth = 2.4 / vp.scale;

              drawSpanPath(span);

              ctx.stroke();

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

          if (span) {
            ctx.save();

            ctx.lineCap = "round";

            ctx.lineJoin = "round";

            ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";

            const runs = span.cable_runs || 1;

            ctx.lineWidth = (2.4 + (runs - 1) * 4) / vp.scale;

            drawSpanPath(span);

            ctx.stroke();

            ctx.restore();
          }
        }
      }

      // 3. Draw Equipment Actives if toggled on

      if (opts.showActives) {
        ctx.save();

        for (const shape of activeShapesRef.current) {
          const str = `${shape.kind} ${shape.layer}`.toLowerCase();

          let fillColor = "rgba(156, 163, 175, 0.4)";

          let strokeColor = "rgba(100, 116, 139, 0.9)";

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

            for (let i = 1; i < shape.points.length; i++) {
              ctx.lineTo(shape.points[i][0], shape.points[i][1]);
            }

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

      // 4. Draw Poles if toggled on

      if (opts.showPoles) {
        ctx.save();

        const r = 12 / vp.scale;

        for (const pole of polesRef.current) {
          ctx.beginPath();

          ctx.arc(pole.cx, pole.cy, r, 0, 2 * Math.PI);

          ctx.fillStyle = "rgba(245, 158, 11, 0.85)"; // Amber

          ctx.fill();

          ctx.strokeStyle = "#fff";

          ctx.lineWidth = 2 / vp.scale;

          ctx.stroke();

          // Label

          if (vp.scale > 0.8) {
            ctx.save();

            ctx.translate(pole.cx, pole.cy + r * 1.2);

            ctx.scale(1, -1);

            ctx.fillStyle = "#d97706";

            ctx.font = `bold ${Math.max(0.5, 1 / vp.scale)}px monospace`;

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

      if (opts.showChips && cableLayer && isLayerVisible(cableLayer)) {
        const spans = cableSpansRef.current;

        for (const span of spans) {
          const status = cableStatusRef.current[span.span_id];

          if (!status) continue;
          const style = getStatusStyle(status);

          const anchor = worldToScreenLocal(span.cx, span.cy);

          let text = status;

          const paddingX = 8;

          const paddingY = 5;

          const fontSize = 11;

          ctx.save();

          ctx.font = `600 ${fontSize}px Inter, Arial, sans-serif`;

          const textWidth = ctx.measureText(text).width;

          const chipW = textWidth + paddingX * 2;

          const chipH = fontSize + paddingY * 2;

          let chipX = anchor.x - chipW / 2;

          let chipY = anchor.y - chipH - 8;

          chipX = Math.max(8, Math.min(chipX, width - chipW - 8));

          chipY = Math.max(8, Math.min(chipY, height - chipH - 8));

          ctx.fillStyle = style.chipFill;

          ctx.strokeStyle = style.chipBorder;

          ctx.lineWidth = 1;
          drawRoundedRect(ctx, chipX, chipY, chipW, chipH, 8);

          ctx.fill();

          ctx.stroke();
          ctx.fillStyle = style.chipText;

          ctx.textBaseline = "middle";

          ctx.fillText(text, chipX + paddingX, chipY + chipH / 2);

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

  // Fetch and toggle Equipment Actives

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

            const fetched: any[] = rdata.shapes ?? [];

            const actives = fetched.filter((s) => {
              const str = `${s.kind} ${s.layer}`.toLowerCase();

              return (
                str.includes("amp") ||
                str.includes("node") ||
                str.includes("extender")
              );
            });

            activeShapesRef.current = actives;

            setActivesLoading(false);

            setShowActives(true);

            showActivesRef.current = true;

            redraw();
          } else if (sdata.status === "error") {
            clearInterval(poll);

            setActivesLoading(false);

            console.error(sdata.error);
          }
        } catch (e) {
          // Ignore network hiccups
        }
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

  // Poll for Poles Status

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/pole_tags");

        const data = await res.json();

        if (data.status) {
          setPoleScanStatus(data.status);
        }

        if (data.status === "done" && data.tags) {
          polesRef.current = data.tags;

          setPoles(data.tags);

          if (showPolesRef.current) redraw();
        }
      } catch (e) {
        // Ignore network errors
      }
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
      cableStatusRef.current = {
        ...cableStatusRef.current,

        [spanId]: status,
      };

      setCableStatuses(cableStatusRef.current);
      if (status === "Unrecovered or Partial") {
        setPartialDetails((prev) => {
          if (prev[spanId]) return prev;

          return { ...prev, [spanId]: { recovered: 0 } };
        });
      }
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

  const findNearestCableSpan = useCallback(
    (worldX: number, worldY: number): number | null => {
      const cableLayer = cableLayerRef.current;

      if (!cableLayer || !isLayerVisible(cableLayer)) return null;
      const spans = cableSpansRef.current;

      if (!spans.length) return null;

      const hoverTolWorld = 8 / Math.max(vpRef.current.scale, 1e-9);

      let bestId: number | null = null;

      let bestDist = Infinity;

      for (const span of spans) {
        const [mnx, mny, mxx, mxy] = span.bbox;
        if (
          worldX < mnx - hoverTol ||
          worldX > mxx + hoverTol ||
          worldY < mny - hoverTol ||
          worldY > mxy + hoverTol
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

      if (bestDist <= hoverTolWorld) return bestId;

      return null;
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

      let splitIndex = Math.floor(segs.length / 2);

      if (cursorWorld) {
        let minDist = Infinity;

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

            splitIndex = i;
          }
        }
      }

      const firstHalf = segs.slice(0, splitIndex + 1);

      const secondHalf = segs.slice(splitIndex + 1);
      const newId1 = Math.max(...spans.map((s) => s.span_id)) + 1;

      const newId2 = newId1 + 1;

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

        cable_runs: span.cable_runs,

        from_pole: span.from_pole, // Keep original from

        to_pole: undefined,

        ...m1,

        meterValue: getNearestMeterValue(m1.cx, m1.cy),
      };
      const newSpan2: CableSpan = {
        ...span,

        span_id: newId2,

        segments: secondHalf,

        segment_count: secondHalf.length,

        cable_runs: span.cable_runs,

        from_pole: undefined,

        to_pole: span.to_pole, // Keep original to

        ...m2,

        meterValue: getNearestMeterValue(m2.cx, m2.cy),
      };

      const newSpans = [
        ...spans.slice(0, spanIndex),

        newSpan1,

        newSpan2,

        ...spans.slice(spanIndex + 1),
      ];
      splitHistoryRef.current.push({ prev: spans.map((s) => ({ ...s })) });
      cableSpansRef.current = newSpans;

      setCableSpans(newSpans);

      const prevStatus = cableStatusRef.current[spanId];

      if (prevStatus) {
        setCableStatuses((prev) => {
          const next = { ...prev, [newId1]: prevStatus, [newId2]: prevStatus };

          cableStatusRef.current = next;

          return next;
        });
        if (prevStatus === "Unrecovered or Partial" && partialDetails[spanId]) {
          setPartialDetails((prev) => ({
            ...prev,

            [newId1]: { ...prev[spanId] },

            [newId2]: { ...prev[spanId] },
          }));
        }
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

    let nextId = Math.max(...currentSpans.map((s) => s.span_id)) + 1;

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
        if (
          minDist < searchTol &&
          splitIdx >= 1 &&
          splitIdx < span.segments.length - 2
        ) {
          madeCuts = true;
          const firstHalf = span.segments.slice(0, splitIdx + 1);

          const secondHalf = span.segments.slice(splitIdx + 1);
          const m1 = computeSpanMetrics(firstHalf);

          const m2 = computeSpanMetrics(secondHalf);
          const span1: CableSpan = {
            ...span,

            span_id: nextId++,

            segments: firstHalf,

            segment_count: firstHalf.length,

            cable_runs: span.cable_runs,

            from_pole: span.from_pole,

            to_pole: undefined,

            ...m1,

            meterValue: getNearestMeterValue(m1.cx, m1.cy),
          };
          const span2: CableSpan = {
            ...span,

            span_id: nextId++,

            segments: secondHalf,

            segment_count: secondHalf.length,

            cable_runs: span.cable_runs,

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

            if (
              prevStatus === "Unrecovered or Partial" &&
              partialDetails[span.span_id]
            ) {
              setPartialDetails((prev) => ({
                ...prev,

                [span1.span_id]: { ...prev[span.span_id] },

                [span2.span_id]: { ...prev[span.span_id] },
              }));
            }
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
      });

      cableSpansRef.current = newSpans;

      setCableSpans(newSpans);

      redraw();
    }
  }, [partialDetails, redraw]);

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
          });
          const newSegments = [...targetSpan.segments, ...neighbor.segments];

          const nextId =
            Math.max(...cableSpansRef.current.map((s) => s.span_id), 0) + 1;
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

            cable_runs: targetSpan.cable_runs,

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

    selectedSpanRef.current = null;

    setSelectedSpanId(null);

    redraw();
  }, [redraw]);

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
          cancelPairing();
        }
      }
    };

    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);
  }, [undoSplit, redoSplit]);

  // OCR meter value sync
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
        status === "Unrecovered or Partial" &&
        span.meterValue !== undefined &&
        span.meterValue !== null
      ) {
        return span;
      }

      let nearest = null;

      let nearestDist = Infinity;

      for (const r of safeOcrResults) {
        const dx = span.cx - r.center_x;

        const dy = span.cy - r.center_y;

        const dist = Math.hypot(dx, dy);

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

    redraw();
  }, [ocrResults, cableDataVersion, redraw]);

  const startPairing = () => {
    if (selectedSpanId === null) return;

    pairingModeRef.current = true;

    setPairingMode(true);

    setMainPairingSpanId(selectedSpanId);

    pairedSpanIdsRef.current = [];

    setPairedSpanIds([]);

    redraw();
  };

  const promptFinishPairing = () => {
    if (pairedSpanIdsRef.current.length === 0) {
      cancelPairing();

      return;
    }

    setConfirmPairingOpen(true);
  };

  const handleConfirmPairing = () => {
    if (mainPairingSpanId === null) return;

    const mainSpan = cableSpansRef.current.find(
      (s) => s.span_id === mainPairingSpanId,
    );

    if (!mainSpan) return;
    splitHistoryRef.current.push({
      prev: cableSpansRef.current.map((s) => ({ ...s })),
    });
    const pIds = pairedSpanIdsRef.current;

    const pairedSpansToMerge = cableSpansRef.current.filter((s) =>
      pIds.includes(s.span_id),
    );

    const newSegments = [...mainSpan.segments];

    pairedSpansToMerge.forEach((ps) => newSegments.push(...ps.segments));

    const m = computeSpanMetrics(newSegments);
    const totalRunsToAdd = toMerge.reduce(
      (sum, s) => sum + (s.cable_runs || 1),

      0,
    );
    const mergedSpan: CableSpan = {
      ...mainSpan,

      segments: newSegments,

      segment_count: newSegments.length,

      cable_runs: (mainSpan.cable_runs || 1) + totalRunsToAdd,

      ...m,
    };
    const newSpans = cableSpansRef.current.filter(
      (s) => s.span_id !== mainSpan.span_id && !pIds.includes(s.span_id),
    );

    newSpans.push(mergedSpan);
    cableSpansRef.current = newSpans;

    setCableSpans(newSpans);
    cancelPairing();
  };

  const cancelPairing = () => {
    pairingModeRef.current = false;

    setPairingMode(false);

    setMainPairingSpanId(null);

    pairedSpanIdsRef.current = [];

    setPairedSpanIds([]);

    setConfirmPairingOpen(false);

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

  // ── Re-fit when tab becomes visible ──────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const id = setTimeout(() => fitView(), 50);
    return () => clearTimeout(id);
  }, [isActive, fitView]);

  // ── Load data for dxfPath — uses per-file cache to avoid stale server data ──
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

    cableLayerRef.current = null;

    cableStatusRef.current = {};

    setCableLayerName(null);

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

        cableLayerRef.current = cableData.cable_layer ?? null;

        setCableLayerName(cableData.cable_layer ?? null);

        setCableDataVersion((v) => v + 1);
        setLoading(false);

        setTimeout(fitView, 50);
      })

      .catch((e) => {
        setError(e.message);

        setLoading(false);
      });
  }, [dxfPath, fitView]);

  // ResizeObserver
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

        const cableLayer = cableLayerRef.current;

        if (cableLayer === name) {
          const visible = next.find((l) => l.name === name)?.visible ?? false;

          if (!visible) {
            hoveredSpanRef.current = null;

            selectedSpanRef.current = null;

            setHoveredSpanId(null);

            setSelectedSpanId(null);

            cancelPairing();
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

      cancelPairing();

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

      redraw();

      return;
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

    // Pole Connect Mode Interaction

    if (
      showPolesRef.current &&
      poleConnectModeRef.current !== "idle" &&
      selectedSpanRef.current !== null
    ) {
      const r = 20 / vpRef.current.scale; // Clicking radius

      let clickedPole = null;

      let bestDist = Infinity;

      for (const p of polesRef.current) {
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
          if (s.span_id === spanId) {
            return {
              ...s,

              ...(mode === "from"
                ? { from_pole: clickedPole.name }
                : { to_pole: clickedPole.name }),
            };
          }

          return s;
        });

        cableSpansRef.current = newSpans;

        setCableSpans(newSpans);

        // Advance connection mode dynamically

        const nextMode = mode === "from" ? "to" : "idle";

        poleConnectModeRef.current = nextMode;

        setPoleConnectMode(nextMode);

        redraw();

        return; // Prevent triggering span selection logic
      }
    }

    // Standard Selection Behavior

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

      // Reset connection mode if selecting a different span entirely

      setPoleConnectMode("idle");

      poleConnectModeRef.current = "idle";

      redraw();
    }
  };

  const onMouseLeave = () => {
    panRef.current.active = false;

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

    const spanCount = cableSpansRef.current.length;

    const layerName = cableLayerRef.current ?? "—";

    const dateStr = new Date().toLocaleString();

    let totalRecovered = 0;

    let totalUnrecovered = 0;

    let totalMissing = 0;

    let pdfTotalStrandLength = 0;

    let pdfTotalLength = 0;

    Object.entries(statuses).forEach(([id, status]) => {
      const spanId = +id;

      const span = cableSpansRef.current.find((s) => s.span_id === spanId);

      if (!span) return;
      const runs = span.cable_runs || 1;

      const strandLen = span.meterValue ?? span.total_length ?? 0;

      pdfTotalStrandLength += strandLen;

      pdfTotalLength += strandLen * runs;

      if (status === "Recovered") {
        totalRec += strandLen * runs;
      } else if (status === "Missing") {
        totalMiss += strandLen * runs;
      } else if (status === "Unrecovered or Partial") {
        const detail = partialDetails[spanId] ?? { recovered: 0 };

        const safeRecovered = Math.min(detail.recovered ?? 0, strandLen);

        const calcUnrecovered = strandLen - safeRecovered;

        totalRecovered += safeRecovered * runs;

        totalUnrecovered += calcUnrecovered * runs;
      }
    });

    const spanRows = Object.entries(statuses)

      .sort((a, b) => Number(a[0]) - Number(b[0]))

      .map(([id, status]) => {
        const span = cableSpansRef.current.find(
          (s) => s.span_id === Number(id),
        );

        const colorMap: Record<string, string> = {
          Recovered: "#166534",

          "Unrecovered or Partial": "#92400e",

          Missing: "#991b1b",
        };

        const bgMap: Record<string, string> = {
          Recovered: "#dcfce7",

          "Unrecovered or Partial": "#fef9c3",

          Missing: "#fee2e2",
        };
        const strandLen = span?.meterValue ?? span?.total_length ?? 0;

        const runs = span?.cable_runs || 1;

        const actualLen = strandLen * runs;

        const fromPole = span?.from_pole || "—";

        const toPole = span?.to_pole || "—";

        let lengthText = strandLen.toFixed(2);

        if (status === "Unrecovered or Partial" && span) {
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

    <div class="subtitle">Generated: ${dateStr} &nbsp;|&nbsp; Layer: ${layerName} &nbsp;|&nbsp; Total spans: ${spanCount.toLocaleString()} &nbsp;|&nbsp; Tagged: ${Object.keys(statuses).length}</div>



    <div class="summary">

      <span class="chip chip-green">✓ Recovered: ${totalRecovered.toFixed(2)} m</span>

      <span class="chip chip-yellow">⚠ Unrecovered / Partial: ${totalUnrecovered.toFixed(2)} m</span>

      <span class="chip chip-red">✕ Missing: ${totalMissing.toFixed(2)} m</span>

      <span class="chip chip-slate">Total Strand: ${pdfTotalStrandLength.toFixed(2)} m</span>

      <span class="chip chip-slate">Total Actual: ${pdfTotalLength.toFixed(2)} m</span>

    </div>



    <div class="legend-box">

      <strong style="color: #0f172a;">Drawing Legend:</strong>

      <div class="legend-item">

        <span class="legend-line" style="background: rgba(22, 163, 74, 0.95); box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.22);"></span> Recovered

      </div>

      <div class="legend-item">

        <span class="legend-line" style="background: rgba(217, 119, 6, 0.95); box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.24);"></span> Unrecovered / Partial

      </div>

      <div class="legend-item">

        <span class="legend-line" style="background: rgba(220, 38, 38, 0.95); box-shadow: 0 0 0 4px rgba(248, 113, 113, 0.22);"></span> Missing

      </div>

      ${
        showActivesRef.current
          ? `

      <div class="legend-item">

        <span class="legend-line" style="background: rgba(249, 115, 22, 0.4); border: 2px solid rgba(234, 88, 12, 0.9); height: 12px; border-radius: 2px;"></span> Amplifier

      </div>

      <div class="legend-item">

        <span class="legend-line" style="background: rgba(59, 130, 246, 0.4); border: 2px solid rgba(37, 99, 235, 0.9); height: 12px; border-radius: 2px;"></span> Node

      </div>

      <div class="legend-item">

        <span class="legend-line" style="background: rgba(239, 68, 68, 0.4); border: 2px solid rgba(220, 38, 38, 0.9); height: 12px; border-radius: 2px;"></span> Extender

      </div>

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

    ${
      spanRows
        ? `<table>

      <thead><tr>

        <th>Span ID</th><th>Status</th><th>Strand Length</th><th>Runs</th><th>Actual Length</th><th>Poles (From -> To)</th><th>Segments</th>

      </tr></thead>

      <tbody>${spanRows}</tbody>

    </table>`
        : "<p style='color:#64748b;font-size:14px'>No spans have been tagged yet.</p>"
    }

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
  }, [cableStatuses, partialDetails, renderScene]);

  const visibleCount = layers.filter((l) => l.visible).length;

  const selectedSpan =
    cableSpansRef.current.find((s) => s.span_id === selectedSpanId) ?? null;

  const selectedStatus =
    selectedSpanId !== null ? (cableStatuses[selectedSpanId] ?? null) : null;
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

      {/* Poles Toggle Button */}

      {!loading && !error && (
        <button
          onClick={togglePoles}
          disabled={poleScanStatus !== "done"}
          className={`absolute bottom-[4.5rem] right-6 z-10 bg-white/95 backdrop-blur border border-slate-200 shadow-lg px-5 py-2.5 rounded-full font-semibold text-sm flex items-center gap-2 transition-all ${
            poleScanStatus !== "done"
              ? "opacity-50 cursor-not-allowed"
              : "text-slate-700 hover:bg-slate-50"
          }`}
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

      {/* Actives Toggle Button */}

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

      {!loading && !error && cableLayerName && (
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
          <div className="bg-surface/90 border border-border rounded-lg px-3 py-2 text-[11px] text-muted backdrop-blur-sm shadow-sm min-w-[250px]">
            <div className="font-semibold text-[#1e293b]">
              Cable interaction
            </div>

            <div>
              Layer: <span className="font-mono">{cableLayerName}</span>
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
                <span>Selected cable span</span>

                {pairingMode && (
                  <span className="text-[10px] font-normal bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                    Pairing Mode Active
                  </span>
                )}
              </div>

              <div>ID: {selectedSpan.span_id}</div>

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

              {selectedStatus === "Unrecovered or Partial" && (
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

              {selectedStatus === "Unrecovered or Partial" && (
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

              {/* ── Pole Connections ── */}

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
                  className={`w-full py-1.5 rounded text-[11px] font-medium border transition-colors ${
                    poleConnectMode !== "idle"
                      ? "bg-blue-500 hover:bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white hover:bg-slate-100 text-slate-700 border-slate-200"
                  }`}
                  onClick={() => {
                    const nextMode =
                      poleConnectMode === "idle" ? "from" : "idle";

                    setPoleConnectMode(nextMode);

                    poleConnectModeRef.current = nextMode;
                  }}
                >
                  {poleConnectMode !== "idle"
                    ? "Cancel Connection Mode"
                    : "🔌 Connect Poles"}
                </button>
              </div>

              {/* ── End Pole Connections ── */}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className={`w-full mb-1 px-2.5 py-1.5 rounded-md border transition font-medium flex justify-center items-center shadow-sm ${pairingMode ? "border-purple-300 bg-purple-500 text-white hover:bg-purple-600" : "border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100"}`}
                  onClick={pairingMode ? promptFinishPairing : startPairing}
                >
                  {pairingMode ? "Finish (Enter)" : "🔗 Select Cable runs"}
                </button>
                {!pairingMode && (
                  <>
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
                        setCableStatus(
                          selectedSpan.span_id,

                          "Unrecovered or Partial",
                        )
                      }
                    >
                      Unrecovered or Partial
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
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirm Pairing Modal */}

      {confirmPairingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-lg p-6 w-[320px]">
            <h3 className="font-semibold mb-3 text-sm">Confirm Pairing</h3>

            <p className="text-xs text-slate-600 mb-4">
              Are you sure you want to pair {pairedSpanIds.length} span(s) to
              the main cable ID {mainPairingSpanId}? They will share the same ID
              and length.
            </p>

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm transition"
                onClick={cancelPairing}
              >
                Cancel
              </button>

              <button
                className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white rounded text-sm transition"
                onClick={handleConfirmPairing}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
