"use client";

import { useState, useMemo } from "react";
import type { EquipmentShape } from "../../types";

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

interface Props {
    shapes: EquipmentShape[];
    selectedId: number | null;
    setSelectedId: (id: number | null) => void;
    visibleKinds: Set<string>;
    setVisibleKinds: (kinds: Set<string>) => void;
    visibleLayers: Set<string>;
    setVisibleLayers: (layers: Set<string>) => void;
    boundaryLayer: string;
    setBoundaryLayer: (l: string) => void;
    allLayers: string[];
    scanStatus: "idle" | "processing" | "done" | "error";
    scanProgress: number;
    scanTotal: number;
    onRescan: (boundaryLayer: string) => void;
}

export default function EquipmentPanel({
                                           shapes, selectedId, setSelectedId,
                                           visibleKinds, setVisibleKinds,
                                           visibleLayers, setVisibleLayers,
                                           boundaryLayer, setBoundaryLayer,
                                           allLayers, scanStatus, scanProgress, scanTotal,
                                           onRescan,
                                       }: Props) {
    const [layerSearch, setLayerSearch] = useState("");
    const [showLayers,  setShowLayers]  = useState(false);

    const allKinds = useMemo(() => {
        const k = new Set(shapes.map((s) => s.kind));
        return Array.from(k).sort();
    }, [shapes]);

    const kindCounts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const s of shapes) c[s.kind] = (c[s.kind] ?? 0) + 1;
        return c;
    }, [shapes]);

    const layerCounts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const s of shapes) c[s.layer] = (c[s.layer] ?? 0) + 1;
        return c;
    }, [shapes]);

    const shapeLayers = useMemo(() =>
            Array.from(new Set(shapes.map((s) => s.layer))).sort(),
        [shapes]);

    const filtered = useMemo(() =>
            shapes.filter(
                (s) => visibleKinds.has(s.kind) && visibleLayers.has(s.layer)
            ),
        [shapes, visibleKinds, visibleLayers]);

    const filteredLayers = shapeLayers.filter((l) =>
        l.toLowerCase().includes(layerSearch.toLowerCase())
    );

    const toggleKind = (kind: string) => {
        const next = new Set(visibleKinds);
        next.has(kind) ? next.delete(kind) : next.add(kind);
        setVisibleKinds(next);
    };

    const toggleLayer = (layer: string) => {
        const next = new Set(visibleLayers);
        next.has(layer) ? next.delete(layer) : next.add(layer);
        setVisibleLayers(next);
    };

    const pct = scanTotal > 0 ? Math.round((scanProgress / scanTotal) * 100) : 0;

    return (
        <aside className="w-80 bg-surface border-r border-border flex flex-col overflow-hidden flex-shrink-0">
            {/* Header */}
            <div className="px-5 py-4 border-b border-border">
                <h2 className="text-[0.95rem] font-bold">Equipment Detection</h2>
                <p className="text-xs text-muted mt-0.5">
                    {scanStatus === "done"
                        ? `${shapes.length} shapes found across ${shapeLayers.length} layers`
                        : scanStatus === "processing"
                            ? "Scanning all layers…"
                            : "Auto-scans when tab opens"}
                </p>
            </div>

            {/* Scan progress */}
            {scanStatus === "processing" && (
                <div className="px-5 py-3 border-b border-border">
                    <div className="flex justify-between text-xs text-muted mb-1.5">
                        <span>Scanning layers…</span>
                        <span className="font-mono">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-accent rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <p className="text-[10px] text-muted-2 mt-1.5">
                        {scanProgress} of {scanTotal} layers scanned
                    </p>
                </div>
            )}

            {/* Boundary + rescan */}
            <div className="px-5 py-3 border-b border-border flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                    Boundary Layer
                    <span className="ml-1 normal-case font-normal text-muted-2">(optional)</span>
                </label>
                <select
                    value={boundaryLayer}
                    onChange={(e) => setBoundaryLayer(e.target.value)}
                    className="w-full bg-surface-2 border-[1.5px] border-border rounded-lg px-3 py-2 text-xs outline-none focus:border-accent cursor-pointer"
                >
                    <option value="">— None —</option>
                    {allLayers.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <button
                    disabled={scanStatus === "processing"}
                    onClick={() => onRescan(boundaryLayer)}
                    className="w-full py-2 bg-surface-2 border border-border text-muted text-xs font-semibold
            rounded-lg hover:bg-border hover:text-[#1e293b] transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                    {scanStatus === "processing" ? (
                        <>
                            <div className="w-3 h-3 border-2 border-muted/30 border-t-muted rounded-full animate-spin-fast" />
                            Scanning…
                        </>
                    ) : "↺ Re-scan"}
                </button>
            </div>

            {/* Kind filters */}
            {allKinds.length > 0 && (
                <div className="px-5 py-3 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Shape Kind</span>
                        <div className="flex gap-1.5">
                            <button
                                onClick={() => setVisibleKinds(new Set(allKinds))}
                                className="text-[10px] text-accent hover:underline"
                            >All</button>
                            <span className="text-muted-2 text-[10px]">·</span>
                            <button
                                onClick={() => setVisibleKinds(new Set())}
                                className="text-[10px] text-muted hover:underline"
                            >None</button>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {allKinds.map((kind) => {
                            const active = visibleKinds.has(kind);
                            return (
                                <button
                                    key={kind}
                                    onClick={() => toggleKind(kind)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
                    border-[1.5px] transition-all capitalize
                    ${active ? "text-white border-transparent" : "bg-surface-2 border-border text-muted"}`}
                                    style={active ? { background: KIND_COLOR[kind], borderColor: KIND_COLOR[kind] } : {}}
                                >
                  <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: active ? "#fff" : KIND_COLOR[kind] }}
                  />
                                    {KIND_LABEL[kind] ?? kind}
                                    <span className={`text-[10px] ${active ? "opacity-70" : "text-muted-2"}`}>
                    {kindCounts[kind]}
                  </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Layer filters */}
            {shapeLayers.length > 0 && (
                <div className="px-5 py-3 border-b border-border">
                    <button
                        onClick={() => setShowLayers((o) => !o)}
                        className="flex items-center justify-between w-full mb-2"
                    >
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Layers ({visibleLayers.size}/{shapeLayers.length} visible)
            </span>
                        <svg
                            className={`w-3.5 h-3.5 text-muted transition-transform ${showLayers ? "rotate-180" : ""}`}
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        >
                            <path d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>

                    {showLayers && (
                        <>
                            <input
                                type="text"
                                placeholder="Search layers…"
                                value={layerSearch}
                                onChange={(e) => setLayerSearch(e.target.value)}
                                className="w-full bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-accent mb-2"
                            />
                            <div className="flex gap-1.5 mb-2">
                                <button
                                    onClick={() => setVisibleLayers(new Set(shapeLayers))}
                                    className="text-[10px] text-accent hover:underline"
                                >All on</button>
                                <span className="text-muted-2 text-[10px]">·</span>
                                <button
                                    onClick={() => setVisibleLayers(new Set())}
                                    className="text-[10px] text-muted hover:underline"
                                >All off</button>
                            </div>
                            <div className="max-h-36 overflow-y-auto scrollbar-thin flex flex-col gap-0.5">
                                {filteredLayers.map((layer) => (
                                    <label
                                        key={layer}
                                        className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-surface-2 transition-colors"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={visibleLayers.has(layer)}
                                            onChange={() => toggleLayer(layer)}
                                            className="accent-accent w-3 h-3 flex-shrink-0"
                                        />
                                        <span className="text-xs truncate flex-1">{layer}</span>
                                        <span className="text-[10px] font-mono text-muted-2 flex-shrink-0">
                      {layerCounts[layer] ?? 0}
                    </span>
                                    </label>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Result list */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 flex flex-col gap-1">
                {scanStatus === "idle" && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                        <div className="text-4xl opacity-20">⬡◻△</div>
                        <p className="text-xs text-muted-2 leading-relaxed">
                            Opening this tab starts the scan automatically.
                        </p>
                    </div>
                )}

                {scanStatus === "processing" && shapes.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <div className="w-7 h-7 border-[3px] border-border border-t-accent rounded-full animate-spin-fast" />
                        <p className="text-xs text-muted">Finding shapes…</p>
                    </div>
                )}

                {filtered.map((shape) => (
                    <div
                        key={shape.shape_id}
                        onClick={() =>
                            setSelectedId(shape.shape_id === selectedId ? null : shape.shape_id)
                        }
                        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all border-[1.5px]
              ${shape.shape_id === selectedId
                            ? "bg-accent-light border-accent"
                            : "border-transparent hover:bg-surface-2"}`}
                    >
                        <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ background: KIND_COLOR[shape.kind] ?? "#64748b" }}
                        />
                        <span className="text-[10px] text-muted-2 font-mono min-w-[24px]">
              #{shape.shape_id + 1}
            </span>
                        <span className="text-xs font-semibold flex-1">{KIND_LABEL[shape.kind] ?? shape.kind}</span>
                        <span className="text-[10px] text-muted-2 truncate max-w-[80px]">{shape.layer}</span>
                    </div>
                ))}
            </div>

            {/* Footer stats */}
            {scanStatus === "done" && (
                <div className="px-5 py-2.5 border-t border-border bg-surface-2 flex items-center justify-between">
                    <span className="text-[10px] text-muted">Showing</span>
                    <span className="text-xs font-bold font-mono text-accent">{filtered.length}</span>
                    <span className="text-[10px] text-muted">of {shapes.length} shapes</span>
                </div>
            )}
        </aside>
    );
}