"use client";

import { useRef, useEffect, useCallback } from "react";
import type { EquipmentShape, BoundaryPoint, Segment } from "../../types";

interface Props {
    segments: Segment[];
    shapes: EquipmentShape[];
    boundary: BoundaryPoint[] | null;
    selectedId: number | null;
    onSelectShape: (id: number | null) => void;
}

interface Viewport {
    x: number;
    y: number;
    scale: number;
}

const KIND_COLOR: Record<string, string> = {
    circle:    "#2563eb",
    square:    "#16a34a",
    rectangle: "#d97706",
    triangle:  "#dc2626",
    hexagon:   "#7c3aed",
};

export default function EquipmentCanvas({
                                            segments, shapes, boundary, selectedId, onSelectShape,
                                        }: Props) {
    const canvasRef  = useRef<HTMLCanvasElement>(null);
    const vpRef      = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
    const panRef     = useRef({ active: false, start: { x: 0, y: 0 }, vpStart: { x: 0, y: 0, scale: 1 } });
    const boundsRef  = useRef<{ minx: number; miny: number; maxx: number; maxy: number } | null>(null);

    const shapesRef   = useRef(shapes);
    const selectedRef = useRef(selectedId);
    useEffect(() => { shapesRef.current   = shapes;     }, [shapes]);
    useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

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
            ctx.strokeStyle = "rgba(71,85,105,0.25)";
            ctx.lineWidth   = 0.8 / vp.scale;
            ctx.beginPath();
            for (const s of segments) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
            ctx.stroke();
        }

        // Boundary polygon
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
            ctx.fillStyle = "rgba(245,158,11,0.06)";
            ctx.fill();
        }

        // Shape markers
        for (const shape of shapesRef.current) {
            const isSel  = shape.shape_id === selectedRef.current;
            const color  = KIND_COLOR[shape.kind] ?? "#64748b";
            const [x0, y0, x1, y1] = shape.bbox;
            const w = x1 - x0, h = y1 - y0;
            const r = Math.max(0.5, Math.min(w, h) * 0.5);

            ctx.save();
            ctx.translate(shape.cx, shape.cy);
            ctx.scale(1, -1); // un-flip for drawing

            // Filled shape indicator
            ctx.beginPath();
            if (shape.kind === "circle") {
                ctx.arc(0, 0, r, 0, Math.PI * 2);
            } else if (shape.kind === "triangle") {
                ctx.moveTo(0, -r); ctx.lineTo(r * 0.866, r * 0.5); ctx.lineTo(-r * 0.866, r * 0.5);
                ctx.closePath();
            } else if (shape.kind === "hexagon") {
                for (let i = 0; i < 6; i++) {
                    const a = (Math.PI / 3) * i - Math.PI / 6;
                    i === 0 ? ctx.moveTo(r * Math.cos(a), r * Math.sin(a))
                        : ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
                }
                ctx.closePath();
            } else {
                // square / rectangle — draw as circle marker for clarity
                ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
            }

            ctx.fillStyle   = isSel ? color : color + "33";
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth   = (isSel ? 2.5 : 1.5) / vp.scale;
            ctx.stroke();

            // Label
            ctx.fillStyle    = isSel ? "#fff" : "#fff";
            ctx.font         = `600 ${Math.max(4, r * 0.7)}px Inter, sans-serif`;
            ctx.textAlign    = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(shape.shape_id + 1), 0, 0);

            ctx.restore();
        }

        ctx.restore();
    }, [segments, boundary]);

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

    useEffect(() => { redraw(); }, [redraw, shapes, boundary, selectedId]);

    function s2w(sx: number, sy: number) {
        const vp = vpRef.current;
        return { x: (sx - vp.x) / vp.scale, y: -(sy - vp.y) / vp.scale };
    }

    function hitTest(wx: number, wy: number) {
        const tol = 16 / vpRef.current.scale;
        for (const s of shapesRef.current) {
            if (Math.abs(wx - s.cx) < tol && Math.abs(wy - s.cy) < tol) return s;
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
        if (!panRef.current.active) return;
        vpRef.current.x = panRef.current.vpStart.x + (e.clientX - panRef.current.start.x);
        vpRef.current.y = panRef.current.vpStart.y + (e.clientY - panRef.current.start.y);
        redraw();
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

    return (
        <>
            <canvas
                ref={canvasRef}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onWheel={onWheel}
            />
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
                    <div key={kind} className="flex items-center gap-2 text-xs capitalize">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                        {kind}
                    </div>
                ))}
                <div className="flex items-center gap-2 text-xs mt-0.5 pt-1.5 border-t border-border">
                    <div className="w-3 h-0.5 flex-shrink-0 bg-[#f59e0b]" style={{ borderTop: "2px dashed #f59e0b" }} />
                    Boundary
                </div>
            </div>
        </>
    );
}