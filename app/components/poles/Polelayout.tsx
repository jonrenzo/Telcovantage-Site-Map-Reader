"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { PoleTag } from "../../types";
import PolePanel from "./Polepanel";

interface Segment { x1: number; y1: number; x2: number; y2: number; }
interface LayerSegs { [layer: string]: Segment[]; }
interface Viewport { x: number; y: number; scale: number; }

interface Props {
    dxfPath: string;
    allLayers: string[];
    layerSegments: LayerSegs; // kept for API compat, used as fallback
}

const CROP_SIZE = 220;
const CROP_PAD  = 0.5; // fraction of bbox half-size to pad around the pole

/** Render DXF segments around a pole into a data URL using an offscreen canvas */
function renderPoleCrop(tag: PoleTag, allSegments: Segment[]): string {
    const [bx0, by0, bx1, by1] = tag.bbox;
    const bw   = Math.max(bx1 - bx0, 0.01);
    const bh   = Math.max(by1 - by0, 0.01);
    const half = Math.max(bw, bh) * (0.5 + CROP_PAD);
    const minX = tag.cx - half, maxX = tag.cx + half;
    const minY = tag.cy - half, maxY = tag.cy + half;
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;

    const toPixel = (x: number, y: number) => ({
        px: ((x - minX) / rangeX) * CROP_SIZE,
        py: ((maxY - y) / rangeY) * CROP_SIZE,
    });

    const offscreen = document.createElement("canvas");
    offscreen.width  = CROP_SIZE;
    offscreen.height = CROP_SIZE;
    const ctx = offscreen.getContext("2d")!;

    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, CROP_SIZE, CROP_SIZE);

    // All DXF segments in crop window — grey
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    for (const s of allSegments) {
        if (
            Math.max(s.x1, s.x2) < minX || Math.min(s.x1, s.x2) > maxX ||
            Math.max(s.y1, s.y2) < minY || Math.min(s.y1, s.y2) > maxY
        ) continue;
        const p1 = toPixel(s.x1, s.y1);
        const p2 = toPixel(s.x2, s.y2);
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p2.px, p2.py);
    }
    ctx.stroke();

    // Amber dashed bbox around the detected label
    const tl = toPixel(bx0, by1);
    const br = toPixel(bx1, by0);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(tl.px, tl.py, br.px - tl.px, br.py - tl.py);
    ctx.setLineDash([]);

    // Amber dot at pole center
    // const center = toPixel(tag.cx, tag.cy);
    // ctx.beginPath();
    // ctx.arc(center.px, center.py, 5, 0, 2 * Math.PI);
    // ctx.fillStyle   = "#f59e0b";
    // ctx.fill();
    // ctx.strokeStyle = "#fff";
    // ctx.lineWidth   = 1.5;
    // ctx.stroke();

    // Pole name label above the dot
    ctx.fillStyle    = "#fbbf24";
    ctx.font         = "bold 11px Inter, sans-serif";
    ctx.textAlign    = "center";
    ctx.textBaseline = "bottom";
    //ctx.fillText(tag.name || `POLE_${tag.pole_id}`, center.px, Math.max(center.py - 9, 13));

    return offscreen.toDataURL("image/png");
}

export default function PoleLayout({ dxfPath, allLayers, layerSegments }: Props) {
    // ── Pole scan state ────────────────────────────────────────────────────
    const [tags,         setTags]         = useState<PoleTag[]>([]);
    const [scanStatus,   setScanStatus]   = useState<"idle"|"processing"|"done"|"error">("idle");
    const [scanError,    setScanError]    = useState<string | null>(null);
    const [scannedLayer, setScannedLayer] = useState<string | null>(null);

    // ── All-layer segments fetched from backend ────────────────────────────
    const [allLayerSegs, setAllLayerSegs] = useState<LayerSegs>({});

    // ── UI state ──────────────────────────────────────────────────────────
    const [selectedId,  setSelectedId]  = useState<number | null>(null);
    const [showOnMap,   setShowOnMap]   = useState(true);
    const [cropDataUrl, setCropDataUrl] = useState<string | null>(null);

    // ── Canvas ────────────────────────────────────────────────────────────
    const canvasRef    = useRef<HTMLCanvasElement>(null);
    const vpRef        = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
    const panRef       = useRef({ active: false, start: { x: 0, y: 0 }, vpStart: { x: 0, y: 0, scale: 1 } });
    const boundsRef    = useRef<{ minx: number; miny: number; maxx: number; maxy: number } | null>(null);
    const hasFittedRef = useRef(false);

    const tagsRef       = useRef(tags);
    const selectedIdRef = useRef(selectedId);
    const showOnMapRef  = useRef(showOnMap);
    useEffect(() => { tagsRef.current       = tags;       }, [tags]);
    useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
    useEffect(() => { showOnMapRef.current  = showOnMap;  }, [showOnMap]);

    // Segments for canvas background — use all-layer data once loaded, else fallback prop
    const canvasSegments = useMemo(() => {
        const src = Object.keys(allLayerSegs).length ? allLayerSegs : layerSegments;
        return Object.values(src).flat();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allLayerSegs, JSON.stringify(Object.keys(layerSegments))]);

    // Segments for crop — always use all-layer data once available
    const cropSegments = useMemo(
        () => Object.values(allLayerSegs).flat(),
        [allLayerSegs]
    );

    // ── Fetch all layer segments from backend ─────────────────────────────
    useEffect(() => {
        if (!dxfPath) return;
        fetch("/api/dxf_segments")
            .then((r) => r.json())
            .then((data) => {
                if (data.segments) setAllLayerSegs(data.segments);
            })
            .catch(() => { /* silently fall back to prop segments */ });
    }, [dxfPath]);

    // ── Generate crop when selected pole changes ───────────────────────────
    useEffect(() => {
        if (selectedId === null) { setCropDataUrl(null); return; }
        const tag = tagsRef.current.find((t) => t.pole_id === selectedId);
        if (!tag) { setCropDataUrl(null); return; }
        const segs = cropSegments.length ? cropSegments : canvasSegments;
        setTimeout(() => setCropDataUrl(renderPoleCrop(tag, segs)), 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, cropSegments]);

    // ── Poll while scanning ────────────────────────────────────────────────
    useEffect(() => {
        if (scanStatus !== "processing") return;
        const timer = setInterval(async () => {
            try {
                const res  = await fetch("/api/pole_tags");
                const data = await res.json();
                setScanStatus(data.status);
                if (data.status === "done") {
                    setTags(data.tags ?? []);
                    setScannedLayer(data.layer);
                    clearInterval(timer);
                } else if (data.status === "error") {
                    setScanError(data.error ?? "Unknown error");
                    clearInterval(timer);
                }
            } catch { /* network blip */ }
        }, 800);
        return () => clearInterval(timer);
    }, [scanStatus]);

    // ── Trigger scan ──────────────────────────────────────────────────────
    const handleScan = useCallback(async (layer: string) => {
        setScanStatus("processing");
        setScanError(null);
        setTags([]);
        setSelectedId(null);
        try {
            await fetch("/api/pole_tags/scan", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ dxf_path: dxfPath, layer }),
            });
        } catch (e) {
            setScanStatus("error");
            setScanError(String(e));
        }
    }, [dxfPath]);

    // ── Canvas redraw ─────────────────────────────────────────────────────
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

        // All background segments
        ctx.strokeStyle = "rgba(71,85,105,0.18)";
        ctx.lineWidth   = 0.8 / vp.scale;
        ctx.beginPath();
        for (const s of canvasSegments) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
        ctx.stroke();

        // Pole markers
        if (showOnMapRef.current) {
            const tags  = tagsRef.current;
            const selId = selectedIdRef.current;
            const r     = Math.max(0.4, 8 / vp.scale);

            for (const tag of tags) {
                const isSel = tag.pole_id === selId;
                const color = isSel ? "#d97706" : "#f59e0b";

                ctx.beginPath();
                ctx.arc(tag.cx, tag.cy, r, 0, 2 * Math.PI);
                ctx.fillStyle = isSel ? color : color + "bb";
                ctx.fill();

                if (isSel) {
                    ctx.strokeStyle = "#fff";
                    ctx.lineWidth   = 2 / vp.scale;
                    ctx.stroke();
                }

                if (vp.scale > 1.2) {
                    ctx.save();
                    ctx.translate(tag.cx, tag.cy + r * 1.6);
                    ctx.scale(1, -1);
                    ctx.fillStyle    = isSel ? "#1c1917" : "#78716c";
                    ctx.font         = `600 ${8 / vp.scale}px Inter, sans-serif`;
                    ctx.textAlign    = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(tag.name || `POLE_${tag.pole_id}`, 0, 0);
                    ctx.restore();
                }
            }
        }

        ctx.restore();
    }, [canvasSegments]);

    // ── Fit view ──────────────────────────────────────────────────────────
    const fitView = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !boundsRef.current) return;
        const { minx, miny, maxx, maxy } = boundsRef.current;
        const W = canvas.width, H = canvas.height;
        const dw = maxx - minx, dh = maxy - miny;
        if (dw < 1e-9 || dh < 1e-9) return;
        const vp = vpRef.current;
        vp.scale = Math.min(W / dw, H / dh) * 0.88;
        vp.x     = W / 2 - ((minx + maxx) / 2) * vp.scale;
        vp.y     = H / 2 + ((miny + maxy) / 2) * vp.scale;
        redraw();
    }, [redraw]);

    useEffect(() => {
        if (!canvasSegments.length) return;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const s of canvasSegments) {
            minx = Math.min(minx, s.x1, s.x2); miny = Math.min(miny, s.y1, s.y2);
            maxx = Math.max(maxx, s.x1, s.x2); maxy = Math.max(maxy, s.y1, s.y2);
        }
        boundsRef.current = { minx, miny, maxx, maxy };
        if (!hasFittedRef.current) {
            hasFittedRef.current = true;
            setTimeout(fitView, 50);
        }
    }, [canvasSegments, fitView]);

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

    useEffect(() => { redraw(); }, [redraw, tags, selectedId, showOnMap, canvasSegments]);

    // Pan to selected pole — scale never changes
    useEffect(() => {
        if (selectedId === null) return;
        const tag = tagsRef.current.find((t) => t.pole_id === selectedId);
        if (!tag) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const vp = vpRef.current;
        vp.x = canvas.width  / 2 - tag.cx * vp.scale;
        vp.y = canvas.height / 2 + tag.cy * vp.scale;
        redraw();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    // ── Canvas interaction ────────────────────────────────────────────────
    function s2w(sx: number, sy: number) {
        const vp = vpRef.current;
        return { x: (sx - vp.x) / vp.scale, y: -(sy - vp.y) / vp.scale };
    }

    function hitTest(wx: number, wy: number): PoleTag | null {
        const tol = 14 / vpRef.current.scale;
        for (const t of tagsRef.current) {
            if (Math.abs(wx - t.cx) < tol && Math.abs(wy - t.cy) < tol) return t;
        }
        return null;
    }

    const onMouseDown = (e: React.MouseEvent) => {
        panRef.current = { active: true, start: { x: e.clientX, y: e.clientY }, vpStart: { ...vpRef.current } };
    };
    const onMouseMove = (e: React.MouseEvent) => {
        if (!panRef.current.active) return;
        vpRef.current.x = panRef.current.vpStart.x + (e.clientX - panRef.current.start.x);
        vpRef.current.y = panRef.current.vpStart.y + (e.clientY - panRef.current.start.y);
        redraw();
    };
    const onMouseUp = (e: React.MouseEvent) => {
        if (panRef.current.active) {
            const dx = Math.abs(e.clientX - panRef.current.start.x);
            const dy = Math.abs(e.clientY - panRef.current.start.y);
            if (dx < 5 && dy < 5) {
                const p   = s2w(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                const hit = hitTest(p.x, p.y);
                setSelectedId(hit ? (hit.pole_id === selectedId ? null : hit.pole_id) : null);
            }
        }
        panRef.current.active = false;
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

    const selectedTag = tags.find((t) => t.pole_id === selectedId) ?? null;
    const sourceLabel = (tag: PoleTag) => {
        const src = (tag as any).source;
        if (src === "text")  return { text: "TEXT entity",     color: "bg-[#dbeafe] text-[#1d4ed8]" };
        if (src === "mtext") return { text: "MTEXT entity",    color: "bg-[#dbeafe] text-[#1d4ed8]" };
        return                      { text: "Stroked polyline", color: "bg-[#f3e8ff] text-[#6b21a8]" };
    };

    return (
        <div className="flex-1 flex overflow-hidden">
            <PolePanel
                dxfPath={dxfPath}
                layers={allLayers}
                tags={tags}
                status={scanStatus}
                error={scanError}
                scannedLayer={scannedLayer}
                onScan={handleScan}
                selectedId={selectedId}
                onSelectTag={setSelectedId}
                showOnMap={showOnMap}
                onToggleShowOnMap={() => setShowOnMap((v) => !v)}
            />

            {/* ── Canvas area ── */}
            <div className="flex-1 relative overflow-hidden bg-[#e8edf5]">
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 cursor-grab active:cursor-grabbing"
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onWheel={onWheel}
                />

                {/* ── Pole detail panel ── */}
                {selectedTag && (
                    <div className="absolute top-4 right-4 w-64 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden z-20">
                        {/* Header */}
                        <div className="px-4 py-3 flex items-center justify-between bg-[#f59e0b]">
                            <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="9" />
                                    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                                </svg>
                                <h3 className="text-sm font-bold text-white font-mono tracking-wide">
                                    {selectedTag.name || `POLE_${selectedTag.pole_id}`}
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelectedId(null)}
                                className="w-6 h-6 rounded-full bg-white/20 text-white hover:bg-white/35 flex items-center justify-center text-xs transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        {/* DXF crop preview */}
                        <div className="bg-[#1e293b] relative">
                            {cropDataUrl ? (
                                <img
                                    src={cropDataUrl}
                                    alt="pole area"
                                    className="w-full block"
                                    style={{ imageRendering: "auto" }}
                                />
                            ) : (
                                <div className="w-full h-40 flex items-center justify-center">
                                    <svg className="w-5 h-5 text-slate-500 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                                    </svg>
                                </div>
                            )}
                            <div className="absolute bottom-2 left-2 bg-[#f59e0b]/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded font-mono">
                                {selectedTag.name || `POLE_${selectedTag.pole_id}`}
                            </div>
                        </div>

                        {/* Info rows */}
                        <div className="p-4 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">Source</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sourceLabel(selectedTag).color}`}>
                                    {sourceLabel(selectedTag).text}
                                </span>
                            </div>

                            <div className="h-px bg-border" />

                            <div className="flex flex-col gap-1.5">
                                <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">Coordinates</span>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-surface-2 rounded-lg px-3 py-2 text-center">
                                        <p className="text-[9px] text-muted uppercase tracking-wider mb-0.5">X</p>
                                        <p className="font-mono text-xs font-semibold">{selectedTag.cx.toFixed(3)}</p>
                                    </div>
                                    <div className="bg-surface-2 rounded-lg px-3 py-2 text-center">
                                        <p className="text-[9px] text-muted uppercase tracking-wider mb-0.5">Y</p>
                                        <p className="font-mono text-xs font-semibold">{selectedTag.cy.toFixed(3)}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-border" />

                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">Layer</span>
                                <span className="font-mono text-xs bg-surface-2 px-2 py-0.5 rounded truncate max-w-[140px]">
                                    {selectedTag.layer}
                                </span>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">Index</span>
                                <span className="font-mono text-xs text-muted">#{selectedTag.pole_id}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Zoom controls ── */}
                <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
                    {[
                        { label: "⊡", title: "Fit to screen", onClick: fitView },
                        { label: "+", title: "Zoom in",        onClick: () => { vpRef.current.scale *= 1.3; redraw(); } },
                        { label: "−", title: "Zoom out",       onClick: () => { vpRef.current.scale /= 1.3; redraw(); } },
                    ].map(({ label, title, onClick }) => (
                        <button key={label} title={title} onClick={onClick}
                                className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center text-sm hover:bg-surface-2 shadow-sm transition-colors">
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── Legend ── */}
                <div className="absolute bottom-4 left-4 bg-white/90 border border-border rounded-xl px-3.5 py-2.5 shadow-sm backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-xs mb-1">
                        <div className="w-3 h-3 rounded-full bg-[#f59e0b]" />
                        Pole label
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                        <span className="text-[9px] bg-[#dbeafe] text-[#1d4ed8] px-1 rounded font-semibold">TXT</span>
                        Text entity
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                        <span className="text-[9px] bg-[#f3e8ff] text-[#6b21a8] px-1 rounded font-semibold">STR</span>
                        Stroked polylines
                    </div>
                </div>
            </div>
        </div>
    );
}