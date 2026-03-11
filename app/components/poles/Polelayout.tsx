"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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

export default function PoleLayout({ dxfPath, allLayers, layerSegments }: Props) {
    // ── Pole scan state ────────────────────────────────────────────────────
    const [tags,          setTags]          = useState<PoleTag[]>([]);
    const [scanStatus,    setScanStatus]    = useState<"idle"|"processing"|"done"|"error">("idle");
    const [scanError,     setScanError]     = useState<string | null>(null);
    const [scannedLayer,  setScannedLayer]  = useState<string | null>(null);

    // ── UI state ──────────────────────────────────────────────────────────
    const [selectedId,   setSelectedId]   = useState<number | null>(null);
    const [showOnMap,    setShowOnMap]    = useState(true);

    // ── Canvas ────────────────────────────────────────────────────────────
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const vpRef     = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
    const panRef    = useRef({ active: false, start: { x: 0, y: 0 }, vpStart: { x: 0, y: 0, scale: 1 } });
    const boundsRef = useRef<{ minx: number; miny: number; maxx: number; maxy: number } | null>(null);

    // Keep refs so redraw always has current values without re-creating it
    const tagsRef        = useRef(tags);
    const selectedIdRef  = useRef(selectedId);
    const showOnMapRef   = useRef(showOnMap);
    useEffect(() => { tagsRef.current       = tags;       }, [tags]);
    useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
    useEffect(() => { showOnMapRef.current  = showOnMap;  }, [showOnMap]);

    // ── All DXF segments flattened ─────────────────────────────────────────
    const allSegments = Object.values(layerSegments).flat();

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
            } catch {
                /* network blip — keep polling */
            }
        }, 800);
        return () => clearInterval(timer);
    }, [scanStatus]);

    // ── Trigger scan ───────────────────────────────────────────────────────
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

    // ── Canvas redraw ──────────────────────────────────────────────────────
    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const vp  = vpRef.current;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(vp.x, vp.y);
        ctx.scale(vp.scale, -vp.scale);

        // Background DXF segments — faint
        ctx.strokeStyle = "rgba(71,85,105,0.18)";
        ctx.lineWidth   = 0.8 / vp.scale;
        ctx.beginPath();
        for (const s of allSegments) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
        ctx.stroke();

        // Pole markers
        if (showOnMapRef.current) {
            const tags   = tagsRef.current;
            const selId  = selectedIdRef.current;
            const r      = Math.max(0.4, 8 / vp.scale);

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

                // Label pill when zoomed in enough
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
    }, [allSegments]);

    const fitView = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !boundsRef.current) return;
        const { minx, miny, maxx, maxy } = boundsRef.current;
        const W = canvas.width, H = canvas.height;
        const dw = maxx - minx, dh = maxy - miny;
        if (dw < 1e-9 || dh < 1e-9) return;
        const vp  = vpRef.current;
        vp.scale  = Math.min(W / dw, H / dh) * 0.88;
        vp.x      = W / 2 - ((minx + maxx) / 2) * vp.scale;
        vp.y      = H / 2 + ((miny + maxy) / 2) * vp.scale;
        redraw();
    }, [redraw]);

    // Compute bounds from all segments
    useEffect(() => {
        if (!allSegments.length) return;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const s of allSegments) {
            minx = Math.min(minx, s.x1, s.x2); miny = Math.min(miny, s.y1, s.y2);
            maxx = Math.max(maxx, s.x1, s.x2); maxy = Math.max(maxy, s.y1, s.y2);
        }
        boundsRef.current = { minx, miny, maxx, maxy };
        setTimeout(fitView, 50);
    }, [allSegments, fitView]);

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

    useEffect(() => { redraw(); }, [redraw, tags, selectedId, showOnMap]);

    // Pan to a selected pole
    useEffect(() => {
        if (selectedId === null) return;
        const tag = tags.find((t) => t.pole_id === selectedId);
        if (!tag) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const vp = vpRef.current;
        vp.x = canvas.width  / 2 - tag.cx * vp.scale;
        vp.y = canvas.height / 2 + tag.cy * vp.scale;
        redraw();
    }, [selectedId, tags, redraw]);

    // ── Canvas interaction ─────────────────────────────────────────────────
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

            {/* Canvas */}
            <div className="flex-1 relative overflow-hidden bg-[#e8edf5]">
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 cursor-grab active:cursor-grabbing"
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onWheel={onWheel}
                />

                {/* Selected pole info card */}
                {selectedTag && (
                    <div className="absolute top-4 right-4 bg-white border border-border rounded-xl shadow-xl p-4 w-56 z-20">
                        <div className="flex items-center justify-between mb-2">
                            <p className="font-mono font-bold text-sm">{selectedTag.name || `POLE_${selectedTag.pole_id}`}</p>
                            <button
                                onClick={() => setSelectedId(null)}
                                className="w-5 h-5 rounded-full bg-surface-2 flex items-center justify-center text-muted text-xs hover:bg-border"
                            >✕</button>
                        </div>
                        <div className="text-[10px] text-muted font-mono space-y-0.5">
                            <p>X: {selectedTag.cx.toFixed(3)}</p>
                            <p>Y: {selectedTag.cy.toFixed(3)}</p>
                            <p>Layer: {selectedTag.layer}</p>
                            <p>Source: {(selectedTag as any).source ?? "—"}</p>
                        </div>
                        {selectedTag.crop_b64 && (
                            <img
                                src={`data:image/png;base64,${selectedTag.crop_b64}`}
                                alt="pole crop"
                                className="mt-3 w-full bg-black rounded-lg"
                                style={{ imageRendering: "pixelated" }}
                            />
                        )}
                    </div>
                )}

                {/* Zoom controls */}
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

                {/* Legend */}
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