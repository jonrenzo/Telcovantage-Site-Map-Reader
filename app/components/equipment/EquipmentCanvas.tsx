"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { EquipmentShape, BoundaryPoint, Segment } from "../../types";

interface Props {
    segments: Segment[];
    shapes: EquipmentShape[];
    boundary: BoundaryPoint[] | null;
    selectedId: number | null;
    visibleKinds: Set<string>;
    visibleLayers: Set<string>;
    onSelectShape: (id: number | null) => void;
}

interface Viewport { x: number; y: number; scale: number; }

const KIND_COLOR: Record<string, string> = {
    circle:    "#2563eb",
    square:    "#16a34a",
    rectangle: "#d97706",
    triangle:  "#dc2626",
    hexagon:   "#7c3aed",
};

const KIND_LABEL: Record<string, string> = {
    circle:    "2 Way Tap",
    square:    "4 Way Tap",
    hexagon:   "8 Way Tap",
    rectangle: "Node",
    triangle:  "Line Extender",
};

export default function EquipmentCanvas({
                                            segments, shapes, boundary, selectedId,
                                            visibleKinds, visibleLayers, onSelectShape,
                                        }: Props) {
    const canvasRef  = useRef<HTMLCanvasElement>(null);
    const vpRef      = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
    const panRef     = useRef({ active: false, start: { x: 0, y: 0 }, vpStart: { x: 0, y: 0, scale: 1 } });
    const boundsRef  = useRef<{ minx: number; miny: number; maxx: number; maxy: number } | null>(null);
    const shapesRef      = useRef(shapes);
    const selectedRef    = useRef(selectedId);
    const visKindsRef    = useRef(visibleKinds);
    const visLayersRef   = useRef(visibleLayers);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

    useEffect(() => { shapesRef.current    = shapes;        }, [shapes]);
    useEffect(() => { selectedRef.current  = selectedId;    }, [selectedId]);
    useEffect(() => { visKindsRef.current  = visibleKinds;  }, [visibleKinds]);
    useEffect(() => { visLayersRef.current = visibleLayers; }, [visibleLayers]);

    const visibleShapes = useCallback(() =>
        shapesRef.current.filter(
            (s) => visKindsRef.current.has(s.kind) && visLayersRef.current.has(s.layer)
        ), []);

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

        // Segments
        if (segments.length) {
            ctx.strokeStyle = "rgba(71,85,105,0.2)";
            ctx.lineWidth   = 0.8 / vp.scale;
            ctx.beginPath();
            for (const s of segments) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
            ctx.stroke();
        }

        // Boundary
        if (boundary && boundary.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(boundary[0].x, boundary[0].y);
            for (const p of boundary.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.closePath();
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth   = 2.5 / vp.scale;
            ctx.setLineDash([8 / vp.scale, 4 / vp.scale]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(245,158,11,0.05)";
            ctx.fill();
        }

        // Shapes
        for (const shape of visibleShapes()) {
            const isSel = shape.shape_id === selectedRef.current;
            const color = KIND_COLOR[shape.kind] ?? "#64748b";
            const [x0, y0, x1, y1] = shape.bbox;
            const w = x1 - x0, h = y1 - y0;
            const r = Math.max(0.5, Math.min(w, h) * 0.5);

            ctx.save();
            ctx.translate(shape.cx, shape.cy);
            ctx.scale(1, -1);

            ctx.beginPath();
            if (shape.kind === "circle") {
                ctx.arc(0, 0, r, 0, Math.PI * 2);
            } else if (shape.kind === "triangle") {
                ctx.moveTo(0, -r);
                ctx.lineTo(r * 0.866, r * 0.5);
                ctx.lineTo(-r * 0.866, r * 0.5);
                ctx.closePath();
            } else if (shape.kind === "hexagon") {
                for (let i = 0; i < 6; i++) {
                    const a = (Math.PI / 3) * i - Math.PI / 6;
                    i === 0 ? ctx.moveTo(r * Math.cos(a), r * Math.sin(a))
                        : ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
                }
                ctx.closePath();
            } else if (shape.kind === "square") {
                ctx.rect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
            } else if (shape.kind === "rectangle") {
                ctx.rect(-r, -r * 0.6, r * 2, r * 1.2);
            } else {
                ctx.arc(0, 0, r, 0, Math.PI * 2);
            }

            ctx.fillStyle   = isSel ? color : color + "33";
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth   = (isSel ? 2.5 : 1.5) / vp.scale;
            ctx.stroke();

            ctx.fillStyle    = "#fff";
            ctx.font         = `100 ${Math.max(.50, r * 0.35)}px Montserrat, sans-serif`;
            ctx.textAlign    = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(shape.shape_id + 1), 0, 0);

            ctx.restore();
        }

        ctx.restore();
    }, [segments, boundary, visibleShapes]);

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

    useEffect(() => { redraw(); }, [redraw, shapes, boundary, selectedId, visibleKinds, visibleLayers]);

    function s2w(sx: number, sy: number) {
        const vp = vpRef.current;
        return { x: (sx - vp.x) / vp.scale, y: -(sy - vp.y) / vp.scale };
    }

    function hitTest(wx: number, wy: number) {
        const tol = 16 / vpRef.current.scale;
        for (const s of visibleShapes()) {
            if (Math.abs(wx - s.cx) < tol && Math.abs(wy - s.cy) < tol) return s;
        }
        return null;
    }

    const onMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        panRef.current = { active: true, start: { x: e.clientX, y: e.clientY }, vpStart: { ...vpRef.current } };
    };

    const onMouseMove = (e: React.MouseEvent) => {
        if (panRef.current.active) {
            vpRef.current.x = panRef.current.vpStart.x + (e.clientX - panRef.current.start.x);
            vpRef.current.y = panRef.current.vpStart.y + (e.clientY - panRef.current.start.y);
            redraw();
            setTooltip(null);
            return;
        }
        const p   = s2w(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        const hit = hitTest(p.x, p.y);
        if (hit) {
            setTooltip({
                x: e.nativeEvent.offsetX + 12,
                y: e.nativeEvent.offsetY - 10,
                text: `#${hit.shape_id + 1} · ${hit.kind} · ${hit.layer}`,
            });
        } else {
            setTooltip(null);
        }
    };

    const onMouseUp = (e: React.MouseEvent) => {
        const pan = panRef.current;
        if (pan.active) {
            const dx = Math.abs(e.clientX - pan.start.x);
            const dy = Math.abs(e.clientY - pan.start.y);
            if (dx < 5 && dy < 5) {
                const p   = s2w(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                const hit = hitTest(p.x, p.y);
                onSelectShape(hit ? hit.shape_id : null);
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

    const visible = visibleShapes();
    const kindBreakdown = visible.reduce<Record<string, number>>((acc, s) => {
        acc[s.kind] = (acc[s.kind] ?? 0) + 1; return acc;
    }, {});

    return (
        <>
            <canvas
                ref={canvasRef}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={() => setTooltip(null)}
                onWheel={onWheel}
            />

            {/* Tooltip */}
            {tooltip && (
                <div
                    className="absolute z-30 bg-[#1e293b] text-white text-[10px] font-mono px-2 py-1 rounded-lg pointer-events-none shadow-lg"
                    style={{ left: tooltip.x, top: tooltip.y }}
                >
                    {tooltip.text}
                </div>
            )}

            {/* Stats bar */}
            {visible.length > 0 && (
                <div className="absolute top-4 right-4 bg-surface/90 border border-border rounded-xl px-4 py-2 flex items-center gap-2.5 shadow-sm backdrop-blur-sm flex-wrap max-w-md">
                    {Object.entries(kindBreakdown).map(([kind, count]) => (
                        <div key={kind} className="flex items-center gap-1.5 text-xs">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: KIND_COLOR[kind] }} />
                            <span className="font-semibold">{count}</span>
                            <span className="text-muted">{KIND_LABEL[kind] ?? kind}</span>
                        </div>
                    ))}
                    {Object.keys(kindBreakdown).length > 1 && (
                        <>
                            <div className="w-px h-4 bg-border" />
                            <span className="text-xs font-bold text-accent">{visible.length} total</span>
                        </>
                    )}
                </div>
            )}

            {/* Zoom controls */}
            <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
                {[
                    { label: "⊡", title: "Fit to screen", onClick: fitView },
                    { label: "+", title: "Zoom in",  onClick: () => { vpRef.current.scale *= 1.3; redraw(); } },
                    { label: "−", title: "Zoom out", onClick: () => { vpRef.current.scale /= 1.3; redraw(); } },
                ].map(({ label, title, onClick }) => (
                    <button key={label} title={title} onClick={onClick}
                            className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center text-sm hover:bg-surface-2 shadow-sm transition-colors">
                        {label}
                    </button>
                ))}
            </div>

            {/* Legend */}
            <div className="absolute bottom-4 left-4 bg-white/90 border border-border rounded-xl px-3.5 py-2.5 flex flex-col gap-1.5 shadow-sm backdrop-blur-sm">
                {Object.entries(KIND_COLOR).map(([kind, color]) => (
                    <div key={KIND_LABEL[kind] ?? kind} className="flex items-center gap-2 text-xs">
                        <svg width="14" height="14" viewBox="-7 -7 14 14" className="flex-shrink-0">
                            {kind === "circle" && (
                                <circle cx="0" cy="0" r="5.5" fill={color} />
                            )}
                            {kind === "triangle" && (
                                <polygon points="0,-6 5.2,3 -5.2,3" fill={color} />
                            )}
                            {kind === "hexagon" && (
                                <polygon points={
                                    Array.from({length:6}, (_,i) => {
                                        const a = (Math.PI/3)*i - Math.PI/6;
                                        return `${(6*Math.cos(a)).toFixed(2)},${(6*Math.sin(a)).toFixed(2)}`;
                                    }).join(" ")
                                } fill={color} />
                            )}
                            {kind === "square" && (
                                <rect x="-5" y="-5" width="10" height="10" fill={color} />
                            )}
                            {kind === "rectangle" && (
                                <rect x="-6.5" y="-4" width="13" height="8" fill={color} />
                            )}
                        </svg>
                        {kind}
                    </div>
                ))}
                <div className="flex items-center gap-2 text-xs mt-0.5 pt-1.5 border-t border-border">
                    <div className="w-3 border-t-2 border-dashed border-[#f59e0b]" />
                    Boundary
                </div>
            </div>
        </>
    );
}