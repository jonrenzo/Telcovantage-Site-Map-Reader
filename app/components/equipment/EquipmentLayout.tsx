"use client";

import { useState, useCallback, useRef } from "react";
import type { EquipmentShape, BoundaryPoint, Segment, EquipmentType } from "../../types";
import EquipmentPanel from "./EquipmentPanel";
import EquipmentCanvas from "./EquipmentCanvas";

interface Props {
    dxfPath: string;
    layers: string[];
    segments: Segment[];
}

type DetectStatus = "idle" | "processing" | "done" | "error";

export default function EquipmentLayout({ dxfPath, layers, segments }: Props) {
    const [shapes,     setShapes]     = useState<EquipmentShape[]>([]);
    const [boundary,   setBoundary]   = useState<BoundaryPoint[] | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [status,     setStatus]     = useState<DetectStatus>("idle");
    const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleRun = useCallback(async (opts: {
        layer: string;
        equipmentType: EquipmentType;
        boundaryLayer: string;
    }) => {
        setStatus("processing");
        setShapes([]);
        setBoundary(null);
        setSelectedId(null);
        setErrorMsg(null);

        const res  = await fetch("/api/detect_shapes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                dxf_path:       dxfPath,
                layer:          opts.layer,
                equipment_type: opts.equipmentType,
                boundary_layer: opts.boundaryLayer || null,
            }),
        });
        const data = await res.json();
        if (data.error) { setStatus("error"); setErrorMsg(data.error); return; }

        // Poll for completion
        pollRef.current = setInterval(async () => {
            try {
                const sres  = await fetch("/api/shape_status");
                const sdata = await sres.json();

                if (sdata.status === "done") {
                    clearInterval(pollRef.current!);
                    const rres  = await fetch("/api/shape_results");
                    const rdata = await rres.json();
                    setShapes(rdata.shapes ?? []);
                    setBoundary(rdata.boundary ?? null);
                    setStatus("done");
                } else if (sdata.status === "error") {
                    clearInterval(pollRef.current!);
                    setStatus("error");
                    setErrorMsg(sdata.error ?? "Unknown error");
                }
            } catch (_) {}
        }, 600);
    }, [dxfPath]);

    return (
        <div className="flex-1 flex overflow-hidden">
            <EquipmentPanel
                layers={layers}
                shapes={shapes}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                status={status}
                onRun={handleRun}
            />

            <div className="flex-1 relative overflow-hidden bg-[#e8edf5]">
                {/* Error banner */}
                {status === "error" && errorMsg && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-danger-light border border-[#fecaca] text-danger rounded-xl px-5 py-3 text-sm shadow-lg">
                        {errorMsg}
                    </div>
                )}

                {/* Empty state */}
                {status === "idle" && shapes.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
                        <div className="text-5xl opacity-20">⬡◻△</div>
                        <p className="text-sm text-muted-2 leading-relaxed max-w-xs">
                            Configure detection settings on the left and click Run to identify equipment shapes.
                        </p>
                    </div>
                )}

                <EquipmentCanvas
                    segments={segments}
                    shapes={shapes}
                    boundary={boundary}
                    selectedId={selectedId}
                    onSelectShape={setSelectedId}
                />

                {/* Stats bar */}
                {status === "done" && (
                    <div className="absolute top-4 right-4 bg-surface/90 border border-border rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-sm backdrop-blur-sm">
                        <span className="text-xs text-muted">Found</span>
                        <span className="font-mono font-bold text-accent text-sm">{shapes.length}</span>
                        <span className="text-xs text-muted">shapes</span>
                        {boundary && (
                            <>
                                <div className="w-px h-4 bg-border" />
                                <span className="text-xs text-[#f59e0b] font-semibold">⬡ Boundary detected</span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}