"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { DxfLayerData } from "../../types";
import DxfToolbar from "./DxfToolbar";
import DxfLayerPanel from "./DxfLayerPanel";

interface RawSegment {
    x1: number; y1: number; x2: number; y2: number;
}

interface Props {
    dxfPath: string;
}

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

export default function DxfViewer({ dxfPath }: Props) {
    const canvasRef        = useRef<HTMLCanvasElement>(null);
    const vpRef            = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
    const panRef           = useRef({ active: false, start: { x: 0, y: 0 }, vpStart: { x: 0, y: 0, scale: 1 } });
    const boundsRef        = useRef<{ minx: number; miny: number; maxx: number; maxy: number } | null>(null);
    const segmentsRef      = useRef<Record<string, RawSegment[]>>({});
    const layersRef        = useRef<DxfLayerData[]>([]);

    const [layers,         setLayers]         = useState<DxfLayerData[]>([]);
    const [layerPanelOpen, setLayerPanelOpen] = useState(true);
    const [loading,        setLoading]        = useState(true);
    const [error,          setError]          = useState<string | null>(null);

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

        ctx.restore();
    }, []);

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

    // Load all layer segments from backend
    useEffect(() => {
        if (!dxfPath) return;
        setLoading(true);
        setError(null);

        fetch("/api/dxf_segments")
            .then((r) => r.json())
            .then((data) => {
                if (data.error) { setError(data.error); setLoading(false); return; }

                segmentsRef.current = data.segments;

                // Compute global bounds across all layers
                let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
                for (const segs of Object.values(data.segments) as RawSegment[][]) {
                    for (const s of segs) {
                        minx = Math.min(minx, s.x1, s.x2); miny = Math.min(miny, s.y1, s.y2);
                        maxx = Math.max(maxx, s.x1, s.x2); maxy = Math.max(maxy, s.y1, s.y2);
                    }
                }
                boundsRef.current = { minx, miny, maxx, maxy };

                const layerData: DxfLayerData[] = data.layers.map((name: string) => ({
                    name,
                    visible: true,
                    color: layerColor(name),
                    segmentCount: (data.segments[name] ?? []).length,
                }));

                layersRef.current = layerData;
                setLayers(layerData);
                setLoading(false);
                setTimeout(fitView, 50);
            })
            .catch((e) => { setError(e.message); setLoading(false); });
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
            redraw();
            return next;
        });
    }, [redraw]);

    const onMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        panRef.current = {
            active: true,
            start: { x: e.clientX, y: e.clientY },
            vpStart: { ...vpRef.current },
        };
    };

    const onMouseMove = (e: React.MouseEvent) => {
        if (!panRef.current.active) return;
        vpRef.current.x = panRef.current.vpStart.x + (e.clientX - panRef.current.start.x);
        vpRef.current.y = panRef.current.vpStart.y + (e.clientY - panRef.current.start.y);
        redraw();
    };

    const onMouseUp = () => { panRef.current.active = false; };

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

    return (
        <div className="flex-1 relative overflow-hidden bg-[#e8edf5]">
            {/* Loading */}
            {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20 bg-[#e8edf5]">
                    <div className="w-10 h-10 border-4 border-border border-t-accent rounded-full animate-spin-fast" />
                    <p className="text-sm text-muted">Loading DXF layers…</p>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="absolute inset-0 flex items-center justify-center z-20">
                    <div className="bg-danger-light border border-[#fecaca] text-danger rounded-xl px-6 py-4 text-sm">
                        {error}
                    </div>
                </div>
            )}

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onWheel={onWheel}
            />

            {/* Toolbar */}
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

            {/* Layer panel */}
            {layerPanelOpen && !loading && !error && (
                <DxfLayerPanel
                    layers={layers}
                    onToggle={toggleLayer}
                    onShowAll={showAll}
                    onHideAll={hideAll}
                />
            )}

            {/* Segment count */}
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