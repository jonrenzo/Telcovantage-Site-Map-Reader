"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { DxfLayerData } from "../../types";
import DxfToolbar from "./DxfToolbar";
import DxfLayerPanel from "./DxfLayerPanel";

interface RawSegment {
    x1: number; y1: number; x2: number; y2: number;
}

interface CableSpan {
    span_id: number;
    layer: string;
    bbox: [number, number, number, number];
    cx: number;
    cy: number;
    segment_count: number;
    total_length: number;
    segments: RawSegment[];
}

interface Props {
    dxfPath: string;
}

type CableRecoveryStatus =
    | "Recovered"
    | "Unrecovered or Partial"
    | "Missing";

// Deterministic per-layer color from name
function layerColor(name: string): string {
    const palette = [
        "#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed",
        "#0891b2", "#be185d", "#65a30d", "#ea580c", "#0284c7",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return palette[Math.abs(hash) % palette.length];
}

interface Viewport {
    x: number; y: number; scale: number;
}

function pointToSegmentDistance(
    px: number, py: number,
    x1: number, y1: number,
    x2: number, y2: number
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
    r: number
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

export default function DxfViewer({ dxfPath }: Props) {
    const canvasRef        = useRef<HTMLCanvasElement>(null);
    const vpRef            = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
    const panRef           = useRef({
        active: false,
        moved: false,
        start: { x: 0, y: 0 },
        vpStart: { x: 0, y: 0, scale: 1 }
    });

    const boundsRef        = useRef<{ minx: number; miny: number; maxx: number; maxy: number } | null>(null);
    const segmentsRef      = useRef<Record<string, RawSegment[]>>({});
    const layersRef        = useRef<DxfLayerData[]>([]);
    const cableSpansRef    = useRef<CableSpan[]>([]);
    const cableLayerRef    = useRef<string | null>(null);
    const hoveredSpanRef   = useRef<number | null>(null);
    const selectedSpanRef  = useRef<number | null>(null);
    const cableStatusRef   = useRef<Record<number, CableRecoveryStatus>>({});

    const [layers,         setLayers]         = useState<DxfLayerData[]>([]);
    const [layerPanelOpen, setLayerPanelOpen] = useState(true);
    const [loading,        setLoading]        = useState(true);
    const [error,          setError]          = useState<string | null>(null);
    const [hoveredSpanId,  setHoveredSpanId]  = useState<number | null>(null);
    const [selectedSpanId, setSelectedSpanId] = useState<number | null>(null);
    const [cableLayerName, setCableLayerName] = useState<string | null>(null);
    const [cableStatuses,  setCableStatuses]  = useState<Record<number, CableRecoveryStatus>>({});

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

    const worldToScreen = useCallback((wx: number, wy: number) => {
        const vp = vpRef.current;
        return {
            x: wx * vp.scale + vp.x,
            y: -wy * vp.scale + vp.y,
        };
    }, []);

    const setCableStatus = useCallback((spanId: number, status: CableRecoveryStatus) => {
        setCableStatuses((prev) => {
            const next = { ...prev, [spanId]: status };
            cableStatusRef.current = next;
            return next;
        });
    }, []);

    const clearCableStatus = useCallback((spanId: number) => {
        setCableStatuses((prev) => {
            const next = { ...prev };
            delete next[spanId];
            cableStatusRef.current = next;
            return next;
        });
    }, []);

    const findNearestCableSpan = useCallback((worldX: number, worldY: number): number | null => {
        const cableLayer = cableLayerRef.current;
        if (!cableLayer || !isLayerVisible(cableLayer)) return null;

        const spans = cableSpansRef.current;
        if (!spans.length) return null;

        const hoverTolWorld = 8 / Math.max(vpRef.current.scale, 1e-9);

        let bestId: number | null = null;
        let bestDist = Infinity;

        for (const span of spans) {
            const [minx, miny, maxx, maxy] = span.bbox;

            if (
                worldX < minx - hoverTolWorld ||
                worldX > maxx + hoverTolWorld ||
                worldY < miny - hoverTolWorld ||
                worldY > maxy + hoverTolWorld
            ) {
                continue;
            }

            for (const s of span.segments) {
                const d = pointToSegmentDistance(worldX, worldY, s.x1, s.y1, s.x2, s.y2);
                if (d < bestDist) {
                    bestDist = d;
                    bestId = span.span_id;
                }
            }
        }

        if (bestDist <= hoverTolWorld) return bestId;
        return null;
    }, [isLayerVisible]);

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const vp = vpRef.current;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(vp.x, vp.y);
        ctx.scale(vp.scale, -vp.scale);

        // Draw all visible layers normally
        for (const layer of layersRef.current) {
            if (!layer.visible) continue;
            const segs = segmentsRef.current[layer.name] ?? [];
            if (!segs.length) continue;

            ctx.strokeStyle = layer.color;
            ctx.lineWidth   = 0.8 / vp.scale;
            ctx.beginPath();
            for (const s of segs) {
                ctx.moveTo(s.x1, s.y1);
                ctx.lineTo(s.x2, s.y2);
            }
            ctx.stroke();
        }

        // Overlay cable highlights if cable layer is visible
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

            // 1) Draw persistent marker highlight for labeled spans
            for (const [idStr, status] of statusEntries) {
                const spanId = Number(idStr);
                const span = spanMap.get(spanId);
                if (!span) continue;

                const style = getStatusStyle(status);

                ctx.save();
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.strokeStyle = style.marker;
                ctx.lineWidth = 9.5 / vp.scale;
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

            // 2) Selected span emphasis
            if (selectedSpanRef.current !== null) {
                const span = spanMap.get(selectedSpanRef.current);
                if (span) {
                    const selectedStatus = cableStatusRef.current[selectedSpanRef.current];
                    const style = selectedStatus
                        ? getStatusStyle(selectedStatus)
                        : {
                            marker: "rgba(59, 130, 246, 0.18)",
                            stroke: "rgba(37, 99, 235, 0.95)",
                        };

                    ctx.save();
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.strokeStyle = style.marker;
                    ctx.lineWidth = 12 / vp.scale;
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

            // 3) Hover outline on top
            if (
                hoveredSpanRef.current !== null &&
                hoveredSpanRef.current !== selectedSpanRef.current
            ) {
                const span = spanMap.get(hoveredSpanRef.current);
                if (span) {
                    ctx.save();
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
                    ctx.lineWidth = 2.4 / vp.scale;
                    drawSpanPath(span);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }

        ctx.restore();

        // Draw label chips in screen space so text stays readable
        if (cableLayer && isLayerVisible(cableLayer)) {
            const spans = cableSpansRef.current;
            for (const span of spans) {
                const status = cableStatusRef.current[span.span_id];
                if (!status) continue;

                const style = getStatusStyle(status);
                const [minx, , , maxy] = span.bbox;
                const anchor = worldToScreen(minx, maxy);

                const text = status;
                const paddingX = 8;
                const paddingY = 5;
                const fontSize = 11;

                ctx.save();
                ctx.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
                const textWidth = ctx.measureText(text).width;
                const chipW = textWidth + paddingX * 2;
                const chipH = fontSize + paddingY * 2;

                let chipX = anchor.x + 8;
                let chipY = anchor.y - chipH - 8;

                chipX = Math.max(8, Math.min(chipX, canvas.width - chipW - 8));
                chipY = Math.max(8, Math.min(chipY, canvas.height - chipH - 8));

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
    }, [isLayerVisible, worldToScreen]);

    const fitView = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !boundsRef.current) return;
        const { minx, miny, maxx, maxy } = boundsRef.current;
        const W = canvas.width, H = canvas.height;
        const dw = maxx - minx, dh = maxy - miny;
        if (dw < 1e-9 || dh < 1e-9) return;
        const vp = vpRef.current;
        vp.scale = Math.min(W / dw, H / dh) * 0.88;
        vp.x = W / 2 - ((minx + maxx) / 2) * vp.scale;
        vp.y = H / 2 + ((miny + maxy) / 2) * vp.scale;
        redraw();
    }, [redraw]);

    // Load all layer segments and cable spans from backend
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

                let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
                for (const segs of Object.values(segData.segments) as RawSegment[][]) {
                    for (const s of segs) {
                        minx = Math.min(minx, s.x1, s.x2);
                        miny = Math.min(miny, s.y1, s.y2);
                        maxx = Math.max(maxx, s.x1, s.x2);
                        maxy = Math.max(maxy, s.y1, s.y2);
                    }
                }
                boundsRef.current = { minx, miny, maxx, maxy };

                const layerData: DxfLayerData[] = segData.layers.map((name: string) => ({
                    name,
                    visible: true,
                    color: layerColor(name),
                    segmentCount: (segData.segments[name] ?? []).length,
                }));

                layersRef.current = layerData;
                setLayers(layerData);

                cableSpansRef.current = cableData.spans ?? [];
                cableLayerRef.current = cableData.cable_layer ?? null;
                setCableLayerName(cableData.cable_layer ?? null);

                setLoading(false);
                setTimeout(fitView, 50);
            })
            .catch((e) => {
                setError(e.message);
                setLoading(false);
            });
    }, [dxfPath, fitView]);

    // Resize observer
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver(() => {
            canvas.width  = canvas.parentElement?.clientWidth  ?? 0;
            canvas.height = canvas.parentElement?.clientHeight ?? 0;
            redraw();
        });
        ro.observe(canvas.parentElement!);
        canvas.width  = canvas.parentElement?.clientWidth  ?? 0;
        canvas.height = canvas.parentElement?.clientHeight ?? 0;
        return () => ro.disconnect();
    }, [redraw]);

    const toggleLayer = useCallback((name: string) => {
        setLayers((prev) => {
            const next = prev.map((l) =>
                l.name === name ? { ...l, visible: !l.visible } : l
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
                }
            }

            redraw();
            return next;
        });
    }, [redraw]);

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

            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                panRef.current.moved = true;
            }

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

        const hitId = hoveredSpanRef.current;
        selectedSpanRef.current = hitId;
        setSelectedSpanId(hitId);
        redraw();
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
        const f  = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const vp = vpRef.current;
        vp.x     = e.nativeEvent.offsetX - f * (e.nativeEvent.offsetX - vp.x);
        vp.y     = e.nativeEvent.offsetY - f * (e.nativeEvent.offsetY - vp.y);
        vp.scale *= f;
        redraw();
    };

    const visibleCount = layers.filter((l) => l.visible).length;
    const cableVisible = isLayerVisible(cableLayerName);
    const selectedSpan = cableSpansRef.current.find((s) => s.span_id === selectedSpanId) ?? null;
    const hoveredSpan = cableSpansRef.current.find((s) => s.span_id === hoveredSpanId) ?? null;
    const selectedStatus =
        selectedSpanId !== null ? cableStatuses[selectedSpanId] ?? null : null;

    const statusCounts = {
        recovered: Object.values(cableStatuses).filter((s) => s === "Recovered").length,
        partial: Object.values(cableStatuses).filter((s) => s === "Unrecovered or Partial").length,
        missing: Object.values(cableStatuses).filter((s) => s === "Missing").length,
    };

    const canvasCursor =
        panRef.current.active
            ? "grabbing"
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
            />

            {!loading && !error && (
                <DxfToolbar
                    layerPanelOpen={layerPanelOpen}
                    onToggleLayerPanel={() => setLayerPanelOpen((o) => !o)}
                    onFit={fitView}
                    onZoomIn={() => { vpRef.current.scale *= 1.3; redraw(); }}
                    onZoomOut={() => { vpRef.current.scale /= 1.3; redraw(); }}
                    visibleCount={visibleCount}
                    totalCount={layers.length}
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

            {!loading && !error && cableLayerName && (
                <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
                    <div className="bg-surface/90 border border-border rounded-lg px-3 py-2 text-[11px] text-muted backdrop-blur-sm shadow-sm min-w-[250px]">
                        <div className="font-semibold text-[#1e293b]">Cable interaction</div>
                        <div>Layer: <span className="font-mono">{cableLayerName}</span></div>
                        <div>Status: {cableVisible ? "visible" : "hidden"}</div>
                        <div>Spans: {cableSpansRef.current.length.toLocaleString()}</div>
                        <div className="mt-1 text-[#334155]">
                            Tagged: {Object.keys(cableStatuses).length}
                        </div>
                        <div className="text-[#166534]">Recovered: {statusCounts.recovered}</div>
                        <div className="text-[#92400e]">Unrecovered/Partial: {statusCounts.partial}</div>
                        <div className="text-[#991b1b]">Missing: {statusCounts.missing}</div>
                    </div>

                    {hoveredSpan && (
                        <div className="bg-amber-50/95 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-900 backdrop-blur-sm shadow-sm min-w-[250px]">
                            <div className="font-semibold">Hovered cable span</div>
                            <div>ID: {hoveredSpan.span_id}</div>
                            <div>Segments: {hoveredSpan.segment_count}</div>
                            <div>Length: {hoveredSpan.total_length.toFixed(2)}</div>
                        </div>
                    )}

                    {selectedSpan && (
                        <div className="bg-white/95 border border-slate-200 rounded-lg px-3 py-3 text-[11px] text-slate-900 backdrop-blur-sm shadow-sm min-w-[280px]">
                            <div className="font-semibold text-[12px] mb-2">Selected cable span</div>
                            <div>ID: {selectedSpan.span_id}</div>
                            <div>Segments: {selectedSpan.segment_count}</div>
                            <div>Length: {selectedSpan.total_length.toFixed(2)}</div>
                            <div className="mt-2">
                                Current label:{" "}
                                <span className="font-semibold">
                                    {selectedStatus ?? "Not labeled"}
                                </span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    className="px-2.5 py-1 rounded-md border border-green-200 bg-green-50 text-green-800 hover:bg-green-100 transition"
                                    onClick={() => setCableStatus(selectedSpan.span_id, "Recovered")}
                                >
                                    Recovered
                                </button>

                                <button
                                    className="px-2.5 py-1 rounded-md border border-yellow-200 bg-yellow-50 text-yellow-800 hover:bg-yellow-100 transition"
                                    onClick={() => setCableStatus(selectedSpan.span_id, "Unrecovered or Partial")}
                                >
                                    Unrecovered or Partial
                                </button>

                                <button
                                    className="px-2.5 py-1 rounded-md border border-red-200 bg-red-50 text-red-800 hover:bg-red-100 transition"
                                    onClick={() => setCableStatus(selectedSpan.span_id, "Missing")}
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
                        </div>
                    )}
                </div>
            )}

            {!loading && !error && (
                <div className="absolute bottom-4 right-4 bg-surface/90 border border-border rounded-lg px-3 py-1.5 text-[10px] font-mono text-muted backdrop-blur-sm">
                    {Object.values(segmentsRef.current)
                        .flat()
                        .length.toLocaleString()} segments across {layers.length} layers
                </div>
            )}
        </div>
    );
}