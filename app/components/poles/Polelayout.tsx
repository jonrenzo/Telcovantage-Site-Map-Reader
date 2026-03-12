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
    layerSegments: LayerSegs;
}

function sourceLabel(tag: PoleTag): { text: string; color: string } {
    if (tag.source === "text")  return { text: "Text entity",      color: "bg-[#dbeafe] text-[#1d4ed8]" };
    if (tag.source === "mtext") return { text: "MText entity",     color: "bg-[#dbeafe] text-[#1d4ed8]" };
    return                             { text: "Stroked polyline", color: "bg-[#f3e8ff] text-[#6b21a8]" };
}

export default function PoleLayout({ dxfPath, allLayers, layerSegments }: Props) {
    // ── Pole scan state ───────────────────────────────────────────────────────
    const [tags,         setTags]         = useState<PoleTag[]>([]);
    const [scanStatus,   setScanStatus]   = useState<"idle"|"processing"|"done"|"error">("idle");
    const [scanError,    setScanError]    = useState<string | null>(null);
    const [scannedLayer, setScannedLayer] = useState<string | null>(null);
    const [scanProgress, setScanProgress] = useState(0);
    const [scanTotal,    setScanTotal]    = useState(0);

    // ── All-layer segments fetched from backend ───────────────────────────────
    const [allLayerSegs, setAllLayerSegs] = useState<LayerSegs>({});

    // ── UI state ──────────────────────────────────────────────────────────────
    const [selectedId,   setSelectedId]   = useState<number | null>(null);
    const [showOnMap,    setShowOnMap]    = useState(true);
    // per-pole preview rotation (degrees, multiples of 90) — reset on new selection
    const [rotations,    setRotations]    = useState<Record<number, number>>({});

    const cropRotation = selectedId !== null ? (rotations[selectedId] ?? 0) : 0;

    function rotateCrop() {
        if (selectedId === null) return;
        setRotations((prev) => ({
            ...prev,
            [selectedId]: ((prev[selectedId] ?? 0) + 90) % 360,
        }));
    }

    // Bake current rotation into crop_b64 using an offscreen canvas
    function saveRotation() {
        if (selectedId === null || cropRotation === 0) return;
        const tag = tags.find((t) => t.pole_id === selectedId);
        if (!tag?.crop_b64) return;

        const img = new Image();
        img.onload = () => {
            const rad     = (cropRotation * Math.PI) / 180;
            const swapped = cropRotation % 180 !== 0;
            const w       = swapped ? img.height : img.width;
            const h       = swapped ? img.width  : img.height;

            const canvas  = document.createElement("canvas");
            canvas.width  = w;
            canvas.height = h;
            const ctx     = canvas.getContext("2d")!;
            ctx.translate(w / 2, h / 2);
            ctx.rotate(rad);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);

            const newB64 = canvas.toDataURL("image/png").split(",")[1];
            setTags((prev) =>
                prev.map((t) =>
                    t.pole_id === selectedId ? { ...t, crop_b64: newB64 } : t
                )
            );
            // Clear the preview rotation for this pole since it's now baked in
            setRotations((prev) => { const n = { ...prev }; delete n[selectedId]; return n; });
        };
        img.src = `data:image/png;base64,${tag.crop_b64}`;
    }

    // ── Canvas ────────────────────────────────────────────────────────────────
    const canvasRef    = useRef<HTMLCanvasElement>(null);
    const vpRef        = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
    const panRef       = useRef({ active: false, start: { x: 0, y: 0 }, vpStart: { x: 0, y: 0, scale: 1 } });
    const boundsRef    = useRef<{ minx: number; miny: number; maxx: number; maxy: number } | null>(null);
    const hasFittedRef = useRef(false);

    const HIDE_CIRCLES = true;

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

    // ── Fetch all layer segments from backend ─────────────────────────────────
    useEffect(() => {
        if (!dxfPath) return;
        fetch("/api/dxf_segments?hide_circles=1")
            .then((r) => r.json())
            .then((data) => {
                if (data.segments) setAllLayerSegs(data.segments);
            })
            .catch(() => { /* silently fall back to prop segments */ });
    }, [dxfPath]);

    // ── Poll while scanning ───────────────────────────────────────────────────
    useEffect(() => {
        if (scanStatus !== "processing") return;
        const timer = setInterval(async () => {
            try {
                const res  = await fetch("/api/pole_tags");
                const data = await res.json();

                // Update progress counters during scan
                if (data.progress !== undefined) setScanProgress(data.progress);
                if (data.total    !== undefined) setScanTotal(data.total);

                // Stream tags into map as they arrive — don't wait for "done"
                if (data.tags?.length) setTags(data.tags);

                if (data.status === "done") {
                    setScanStatus("done");
                    setTags(data.tags ?? []);
                    setScannedLayer(data.layer);
                    clearInterval(timer);
                } else if (data.status === "error") {
                    setScanStatus("error");
                    setScanError(data.error ?? "Unknown error");
                    clearInterval(timer);
                }
            } catch { /* network blip */ }
        }, 500);
        return () => clearInterval(timer);
    }, [scanStatus]);

    // ── Trigger scan ──────────────────────────────────────────────────────────
    const handleScan = useCallback(async (layer: string) => {
        setScanStatus("processing");
        setScanError(null);
        setTags([]);
        setSelectedId(null);
        setScanProgress(0);
        setScanTotal(0);
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

    // ── Rename handler (client-side only, no server round-trip) ──────────────
    const handleRenamePole = useCallback((poleId: number, newName: string) => {
        setTags((prev) =>
            prev.map((t) =>
                t.pole_id === poleId
                    ? { ...t, name: newName, needs_review: false }
                    : t
            )
        );
    }, []);

    // ── Canvas redraw ─────────────────────────────────────────────────────────
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
                    ctx.fillStyle    = isSel ? "#d97706" : "#f59e0b";
                    ctx.font         = `bold ${Math.min(.2, Math.max(8, 10 / vp.scale))}px monospace`;
                    ctx.textAlign    = "center";
                    ctx.textBaseline = "top";
                    ctx.fillText(tag.name || `POLE_${tag.pole_id}`, 0, 0);
                    ctx.restore();
                }
            }
        }

        ctx.restore();
    }, [canvasSegments]);

    // ── Fit view to segments ──────────────────────────────────────────────────
    const fitView = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !canvasSegments.length) return;

        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const s of canvasSegments) {
            minx = Math.min(minx, s.x1, s.x2);
            miny = Math.min(miny, s.y1, s.y2);
            maxx = Math.max(maxx, s.x1, s.x2);
            maxy = Math.max(maxy, s.y1, s.y2);
        }
        boundsRef.current = { minx, miny, maxx, maxy };

        const W = canvas.width, H = canvas.height;
        const dw = maxx - minx, dh = maxy - miny;
        const scale = Math.min(W / dw, H / dh) * 0.88;
        const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
        vpRef.current = { x: W / 2 - cx * scale, y: H / 2 + cy * scale, scale };
        redraw();
    }, [canvasSegments, redraw]);

    // ── Resize observer ───────────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver(() => {
            canvas.width  = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            if (!hasFittedRef.current && canvasSegments.length) {
                fitView();
                hasFittedRef.current = true;
            } else {
                redraw();
            }
        });
        ro.observe(canvas);
        return () => ro.disconnect();
    }, [fitView, redraw]);

    // ── Auto-fit when segments first load ─────────────────────────────────────
    useEffect(() => {
        if (canvasSegments.length && !hasFittedRef.current) {
            fitView();
            hasFittedRef.current = true;
        } else {
            redraw();
        }
    }, [canvasSegments, fitView, redraw]);

    // ── Redraw when tags / selection / visibility change ──────────────────────
    useEffect(() => { redraw(); }, [tags, selectedId, showOnMap, redraw]);

    // ── Pan & zoom ────────────────────────────────────────────────────────────
    const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect  = canvas.getBoundingClientRect();
        const mx    = e.clientX - rect.left;
        const my    = e.clientY - rect.top;
        const vp    = vpRef.current;
        const delta = e.deltaY > 0 ? 0.85 : 1 / 0.85;
        const nx    = mx - (mx - vp.x) * delta;
        const ny    = my - (my - vp.y) * delta;
        vpRef.current = { x: nx, y: ny, scale: vp.scale * delta };
        redraw();
    }, [redraw]);

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        panRef.current = {
            active:  true,
            start:   { x: e.clientX, y: e.clientY },
            vpStart: { ...vpRef.current },
        };
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!panRef.current.active) return;
        const dx = e.clientX - panRef.current.start.x;
        const dy = e.clientY - panRef.current.start.y;
        vpRef.current = {
            ...panRef.current.vpStart,
            x: panRef.current.vpStart.x + dx,
            y: panRef.current.vpStart.y + dy,
        };
        redraw();
    }, [redraw]);

    const handleMouseUp = useCallback(() => {
        panRef.current.active = false;
    }, []);

    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (Math.abs(e.clientX - panRef.current.start.x) > 4 ||
            Math.abs(e.clientY - panRef.current.start.y) > 4) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const vp   = vpRef.current;
        const wx   = (e.clientX - rect.left - vp.x) / vp.scale;
        const wy   = -(e.clientY - rect.top  - vp.y) / vp.scale;
        const r    = Math.max(1.0, 12 / vp.scale);

        let closest: PoleTag | null = null;
        let bestD = Infinity;
        for (const tag of tagsRef.current) {
            const d = Math.hypot(tag.cx - wx, tag.cy - wy);
            if (d < r && d < bestD) { bestD = d; closest = tag; }
        }
        setSelectedId(closest ? closest.pole_id : null);
    }, []);

    const selectedTag = tags.find((t) => t.pole_id === selectedId) ?? null;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex-1 flex overflow-hidden">
            {/* Left panel */}
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
                scanProgress={scanProgress}
                scanTotal={scanTotal}
                onRenamePole={handleRenamePole}
            />

            {/* Map canvas */}
            <div className="flex-1 relative bg-[#f8fafc] overflow-hidden">
                <canvas
                    ref={canvasRef}
                    className="w-full h-full cursor-grab active:cursor-grabbing"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onClick={handleCanvasClick}
                />

                {/* Fit button */}
                <button
                    onClick={fitView}
                    title="Fit to view"
                    className="absolute bottom-4 right-4 w-8 h-8 bg-white border border-border rounded-lg shadow-sm
                        flex items-center justify-center text-muted hover:text-text hover:shadow-md transition-all"
                >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                    </svg>
                </button>

                {/* Legend */}
                <div className="absolute bottom-4 left-4 bg-white/90 border border-border rounded-lg px-3 py-2 shadow-sm text-[10px] text-muted space-y-1">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-[#f59e0b]" />
                        <span>Pole label</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[#1d4ed8] font-semibold">TXT</span>
                        <span>Text entity</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[#6b21a8] font-semibold">STR</span>
                        <span>Stroked polylines</span>
                    </div>
                </div>

                {/* Selected pole detail panel */}
                {selectedTag && (
                    <div className="absolute top-4 right-4 w-72 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
                        {/* Header — name is directly editable */}
                        <div className="bg-[#f59e0b] px-3 py-3 flex items-center gap-2">
                            <svg className="w-4 h-4 text-white flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="9" />
                                <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                            </svg>
                            <input
                                key={selectedTag.pole_id}
                                type="text"
                                defaultValue={selectedTag.name || `POLE_${selectedTag.pole_id}`}
                                id={`detail-name-${selectedTag.pole_id}`}
                                className="flex-1 min-w-0 bg-white/20 text-white placeholder-white/60 font-mono text-sm font-bold
                                    rounded px-2 py-0.5 focus:outline-none focus:bg-white/30
                                    border border-transparent focus:border-white/50"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        const v = (e.target as HTMLInputElement).value.trim().toUpperCase();
                                        if (v) handleRenamePole(selectedTag.pole_id, v);
                                        (e.target as HTMLInputElement).blur();
                                    }
                                    if (e.key === "Escape") {
                                        (e.target as HTMLInputElement).value = selectedTag.name || `POLE_${selectedTag.pole_id}`;
                                        (e.target as HTMLInputElement).blur();
                                    }
                                }}
                                onBlur={(e) => {
                                    const v = e.target.value.trim().toUpperCase();
                                    if (v && v !== selectedTag.name) handleRenamePole(selectedTag.pole_id, v);
                                }}
                            />
                            <button
                                onClick={() => setSelectedId(null)}
                                className="w-6 h-6 rounded-full bg-white/20 text-white hover:bg-white/35 flex-shrink-0
                                    flex items-center justify-center text-xs transition-colors"
                            >✕</button>
                        </div>

                        {/* Pole name preview with manual rotation */}
                        <div className="bg-white border-b border-border relative flex items-center justify-center p-3 min-h-[120px]">
                            {selectedTag.crop_b64 ? (
                                <img
                                    src={`data:image/png;base64,${selectedTag.crop_b64}`}
                                    alt="pole name"
                                    className="object-contain transition-transform duration-200"
                                    style={{
                                        imageRendering: "auto",
                                        maxHeight: "160px",
                                        maxWidth: "100%",
                                        transform: `rotate(${cropRotation}deg)`,
                                        ...(cropRotation % 180 !== 0 ? { maxHeight: "220px", maxWidth: "160px" } : {}),
                                    }}
                                />
                            ) : (
                                <p className="text-[10px] text-muted italic">
                                    {selectedTag.source === "stroke"
                                        ? "No OCR crop available"
                                        : selectedTag.name || `POLE_${selectedTag.pole_id}`}
                                </p>
                            )}

                            {selectedTag.crop_b64 && (
                                <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                                    {/* Rotate 90° */}
                                    <button
                                        onClick={rotateCrop}
                                        title="Rotate 90°"
                                        className="w-6 h-6 rounded-full bg-[#f59e0b]/90 hover:bg-[#d97706]
                                            text-white flex items-center justify-center shadow transition-colors"
                                    >
                                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M21 2v6h-6"/>
                                            <path d="M21 8A9 9 0 1 0 19 19"/>
                                        </svg>
                                    </button>
                                    {/* Save rotation — only shown when rotation is non-zero */}
                                    {cropRotation !== 0 && (
                                        <button
                                            onClick={saveRotation}
                                            title="Save rotation"
                                            className="h-6 px-1.5 rounded-full bg-[#16a34a] hover:bg-[#15803d]
                                                text-white text-[9px] font-bold flex items-center shadow transition-colors"
                                        >
                                            Save
                                        </button>
                                    )}
                                </div>
                            )}

                            <div className="absolute bottom-1.5 left-2 bg-[#f59e0b] text-white text-[9px] font-bold px-1.5 py-0.5 rounded font-mono">
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

                            {/* OCR confidence — only for STR poles */}
                            {selectedTag.ocr_conf !== null && selectedTag.ocr_conf !== undefined && (
                                <>
                                    <div className="h-px bg-border" />
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">OCR Confidence</span>
                                        <span className={`text-[10px] px-2 py-0.5 rounded font-semibold
                                            ${selectedTag.ocr_conf >= 0.80 ? "bg-[#dcfce7] text-[#15803d]"
                                            : selectedTag.ocr_conf >= 0.60 ? "bg-[#fef9c3] text-[#92400e]"
                                                : "bg-[#fee2e2] text-[#b91c1c]"}`}>
                                            {Math.round(selectedTag.ocr_conf * 100)}%
                                        </span>
                                    </div>
                                    {selectedTag.needs_review && (
                                        <p className="text-[10px] text-[#b91c1c] flex items-center gap-1">
                                            <span>⚠</span> Name needs review
                                        </p>
                                    )}
                                </>
                            )}

                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}