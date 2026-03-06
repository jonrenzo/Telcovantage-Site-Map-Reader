"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { EquipmentShape, BoundaryPoint, Segment } from "../../types";
import EquipmentPanel from "./EquipmentPanel";
import EquipmentCanvas from "./EquipmentCanvas";

interface Props {
    dxfPath: string;
    layers: string[];
    segments: Segment[];
}

type ScanStatus = "idle" | "processing" | "done" | "error";

export default function EquipmentLayout({ dxfPath, layers, segments }: Props) {
    const [shapes,        setShapes]        = useState<EquipmentShape[]>([]);
    const [boundary,      setBoundary]      = useState<BoundaryPoint[] | null>(null);
    const [selectedId,    setSelectedId]    = useState<number | null>(null);
    const [status,        setStatus]        = useState<ScanStatus>("idle");
    const [errorMsg,      setErrorMsg]      = useState<string | null>(null);
    const [progress,      setProgress]      = useState(0);
    const [total,         setTotal]         = useState(0);
    const [boundaryLayer, setBoundaryLayer] = useState("");
    const [visibleKinds,  setVisibleKinds]  = useState<Set<string>>(new Set());
    const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());
    const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
    const hasScanned = useRef(false);

    const startScan = useCallback(async (bLayer: string) => {
        if (pollRef.current) clearInterval(pollRef.current);
        setStatus("processing");
        setShapes([]);
        setBoundary(null);
        setSelectedId(null);
        setErrorMsg(null);
        setProgress(0);
        setTotal(0);

        const res  = await fetch("/api/scan_equipment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dxf_path: dxfPath, boundary_layer: bLayer || null }),
        });
        const data = await res.json();
        if (data.error) { setStatus("error"); setErrorMsg(data.error); return; }

        pollRef.current = setInterval(async () => {
            try {
                const sres  = await fetch("/api/scan_status");
                const sdata = await sres.json();
                setProgress(sdata.progress ?? 0);
                setTotal(sdata.total ?? 0);

                if (sdata.status === "done") {
                    clearInterval(pollRef.current!);
                    const rres  = await fetch("/api/scan_results");
                    const rdata = await rres.json();
                    const fetched: EquipmentShape[] = rdata.shapes ?? [];
                    setShapes(fetched);
                    setBoundary(rdata.boundary ?? null);
                    setStatus("done");
                    // Initialise filters to show everything
                    setVisibleKinds(new Set(fetched.map((s) => s.kind)));
                    setVisibleLayers(new Set(fetched.map((s) => s.layer)));
                } else if (sdata.status === "error") {
                    clearInterval(pollRef.current!);
                    setStatus("error");
                    setErrorMsg(sdata.error ?? "Unknown error");
                }
            } catch (_) {}
        }, 600);
    }, [dxfPath]);

    // Auto-scan once when component mounts
    useEffect(() => {
        if (!hasScanned.current && dxfPath) {
            hasScanned.current = true;
            startScan("");
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [dxfPath, startScan]);

    return (
        <div className="flex-1 flex overflow-hidden">
            <EquipmentPanel
                shapes={shapes}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                visibleKinds={visibleKinds}
                setVisibleKinds={setVisibleKinds}
                visibleLayers={visibleLayers}
                setVisibleLayers={setVisibleLayers}
                boundaryLayer={boundaryLayer}
                setBoundaryLayer={setBoundaryLayer}
                allLayers={layers}
                scanStatus={status}
                scanProgress={progress}
                scanTotal={total}
                onRescan={startScan}
            />

            <div className="flex-1 relative overflow-hidden bg-[#e8edf5]">
                {status === "error" && errorMsg && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-danger-light border border-[#fecaca] text-danger rounded-xl px-5 py-3 text-sm shadow-lg max-w-md text-center">
                        {errorMsg}
                    </div>
                )}

                {status === "idle" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
                        <div className="w-8 h-8 border-4 border-border border-t-accent rounded-full animate-spin-fast" />
                        <p className="text-sm text-muted">Starting scan…</p>
                    </div>
                )}

                {status === "processing" && shapes.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8 pointer-events-none">
                        <div className="w-8 h-8 border-4 border-border border-t-accent rounded-full animate-spin-fast" />
                        <p className="text-sm text-muted">Scanning all layers for shapes…</p>
                    </div>
                )}

                <EquipmentCanvas
                    segments={segments}
                    shapes={shapes}
                    boundary={boundary}
                    selectedId={selectedId}
                    visibleKinds={visibleKinds}
                    visibleLayers={visibleLayers}
                    onSelectShape={setSelectedId}
                />
            </div>
        </div>
    );
}