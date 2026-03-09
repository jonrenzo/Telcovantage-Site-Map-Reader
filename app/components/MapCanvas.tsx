"use client";

import { useRef, useEffect, useCallback } from "react";
import type { DigitResult, Segment, FilterMode } from "../types";

interface Theme {
    ok: string;
    review: string;
    corrected: string;
}

interface Props {
    segments: Segment[];
    results: DigitResult[];
    filterMode: FilterMode;
    selectedId: number | null;
    onSelectDigit: (id: number | null) => void;
    theme: Theme;
    manualMode: boolean;
    onManualPlace: (cx: number, cy: number) => void;
}

interface Viewport {
    x: number;
    y: number;
    scale: number;
}

export default function MapCanvas({
                                      segments, results, filterMode, selectedId, onSelectDigit, theme,
                                      manualMode, onManualPlace,
                                  }: Props) {
    const canvasRef  = useRef<HTMLCanvasElement>(null);
    const vpRef      = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
    const panRef     = useRef({ active: false, start: { x: 0, y: 0 }, vpStart: { x: 0, y: 0, scale: 1 } });
    const boundsRef  = useRef<{ minx: number; miny: number; maxx: number; maxy: number } | null>(null);

    const resultsRef    = useRef(results);
    const filterRef     = useRef(filterMode);
    const selectedIdRef = useRef(selectedId);
    const themeRef      = useRef(theme);
    const manualModeRef = useRef(manualMode);

    useEffect(() => { resultsRef.current    = results;     }, [results]);
    useEffect(() => { filterRef.current     = filterMode;  }, [filterMode]);
    useEffect(() => { selectedIdRef.current = selectedId;  }, [selectedId]);
    useEffect(() => { themeRef.current      = theme;       }, [theme]);
    useEffect(() => { manualModeRef.current = manualMode;  }, [manualMode]);

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx    = canvas.getContext("2d");
        if (!ctx) return;
        const vp     = vpRef.current;
        const res    = resultsRef.current;
        const filter = filterRef.current;
        const selId  = selectedIdRef.current;
        const t      = themeRef.current;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!segments.length) return;

        ctx.save();
        ctx.translate(vp.x, vp.y);
        ctx.scale(vp.scale, -vp.scale);

        // Segments
        ctx.strokeStyle = "rgba(71,85,105,0.3)";
        ctx.lineWidth   = 0.8 / vp.scale;
        ctx.beginPath();
        for (const s of segments) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
        ctx.stroke();

        // Markers
        const r = Math.max(0.5, 9 / vp.scale);
        for (const result of res) {
            if (filter === "review"    && !result.needs_review)    continue;
            if (filter === "corrected" && !result.corrected_value) continue;

            const { center_x: cx, center_y: cy } = result;
            const isSel = result.digit_id === selId;
            const val   = result.corrected_value ?? result.value;
            const color = result.manual
                ? "#8b5cf6"
                : result.corrected_value
                    ? t.corrected
                    : result.needs_review
                        ? t.review
                        : t.ok;

            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.fillStyle = isSel ? color : color + "cc";
            ctx.fill();
            if (isSel) {
                ctx.strokeStyle = "#fff";
                ctx.lineWidth   = 2 / vp.scale;
                ctx.stroke();
            }

            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(1, -1);
            ctx.fillStyle    = "#fff";
            ctx.font         = `600 ${9 / vp.scale}px Inter, sans-serif`;
            ctx.textAlign    = "center";
            ctx.textBaseline = "middle";

            ctx.fillText(val, 0, 0);
            ctx.restore();
        }

        ctx.restore();
    }, [segments]);

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

    useEffect(() => {
        if (!segments.length) return;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const s of segments) {
            minx = Math.min(minx, s.x1, s.x2); miny = Math.min(miny, s.y1, s.y2);
            maxx = Math.max(maxx, s.x1, s.x2); maxy = Math.max(maxy, s.y1, s.y2);
        }
        boundsRef.current = { minx, miny, maxx, maxy };
        setTimeout(fitView, 50);
    }, [segments, fitView]);

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

    useEffect(() => { redraw(); }, [redraw, results, filterMode, selectedId, theme]);

    function s2w(sx: number, sy: number) {
        const vp = vpRef.current;
        return { x: (sx - vp.x) / vp.scale, y: -(sy - vp.y) / vp.scale };
    }

    function hitTest(wx: number, wy: number) {
        const tol = 14 / vpRef.current.scale;
        for (const r of resultsRef.current) {
            if (Math.abs(wx - r.center_x) < tol && Math.abs(wy - r.center_y) < tol) return r;
        }
        return null;
    }

    const onMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        panRef.current = {
            active: true,
            start: { x: e.clientX, y: e.clientY },
            vpStart: { ...vpRef.current },
        };
    };

    const onMouseMove = (e: React.MouseEvent) => {
        const pan = panRef.current;
        if (!pan.active) return;
        vpRef.current.x = pan.vpStart.x + (e.clientX - pan.start.x);
        vpRef.current.y = pan.vpStart.y + (e.clientY - pan.start.y);
        redraw();
    };

    const onMouseUp = (e: React.MouseEvent) => {
        const pan = panRef.current;
        if (pan.active) {
            const dx = Math.abs(e.clientX - pan.start.x);
            const dy = Math.abs(e.clientY - pan.start.y);
            if (dx < 5 && dy < 5) {
                const p = s2w(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                if (manualModeRef.current) {
                    // In manual mode, place a new digit instead of selecting
                    onManualPlace(p.x, p.y);
                } else {
                    const hit = hitTest(p.x, p.y);
                    onSelectDigit(hit ? hit.digit_id : null);
                }
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

    return (
        <>
            <canvas
                ref={canvasRef}
                className={`absolute inset-0 ${manualMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onWheel={onWheel}
            />

            {/* Crosshair hint */}
            {manualMode && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-[#8b5cf6] text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
                    Click on the map to place a digit
                </div>
            )}

            <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
                {[
                    { label: "⊡", title: "Fit to screen", onClick: fitView },
                    { label: "+", title: "Zoom in",        onClick: () => { vpRef.current.scale *= 1.3; redraw(); } },
                    { label: "−", title: "Zoom out",       onClick: () => { vpRef.current.scale /= 1.3; redraw(); } },
                ].map(({ label, title, onClick }) => (
                    <button
                        key={label}
                        title={title}
                        onClick={onClick}
                        className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center text-sm hover:bg-surface-2 shadow-sm transition-colors"
                    >
                        {label}
                    </button>
                ))}
            </div>
        </>
    );
}