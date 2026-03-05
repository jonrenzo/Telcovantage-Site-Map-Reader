"use client";

import { useState, useRef } from "react";
import type { EquipmentShape, EquipmentType } from "../../types";

const KIND_COLOR: Record<string, string> = {
    circle:    "#2563eb",
    square:    "#16a34a",
    rectangle: "#d97706",
    triangle:  "#dc2626",
    hexagon:   "#7c3aed",
};

const EQUIPMENT_TYPES: { value: EquipmentType; label: string; desc: string }[] = [
    { value: "generic",   label: "Generic",   desc: "All shapes"           },
    { value: "amplifier", label: "Amplifier", desc: "Outermost rectangles" },
    { value: "node",      label: "Node",      desc: "Outermost rectangles" },
    { value: "extender",  label: "Extender",  desc: "Triangles only"       },
];

interface Props {
    layers: string[];
    shapes: EquipmentShape[];
    selectedId: number | null;
    setSelectedId: (id: number | null) => void;
    status: "idle" | "processing" | "done" | "error";
    onRun: (opts: {
        layer: string;
        equipmentType: EquipmentType;
        boundaryLayer: string;
    }) => void;
}

export default function EquipmentPanel({
                                           layers, shapes, selectedId, setSelectedId, status, onRun,
                                       }: Props) {
    const [layer,          setLayer]          = useState(layers[0] ?? "");
    const [equipmentType,  setEquipmentType]  = useState<EquipmentType>("generic");
    const [boundaryLayer,  setBoundaryLayer]  = useState("");
    const [filterKind,     setFilterKind]     = useState<string>("all");

    // Group shapes by kind for summary
    const counts: Record<string, number> = {};
    for (const s of shapes) counts[s.kind] = (counts[s.kind] ?? 0) + 1;

    const filtered = filterKind === "all"
        ? shapes
        : shapes.filter((s) => s.kind === filterKind);

    const kinds = Array.from(new Set(shapes.map((s) => s.kind)));

    return (
        <aside className="w-80 bg-surface border-r border-border flex flex-col overflow-hidden shrink-0">
            {/* Header */}
            <div className="px-5 py-4 border-b border-border">
                <h2 className="text-[0.95rem] font-bold">Equipment Detection</h2>
                <p className="text-xs text-muted mt-0.5">Detect shapes and boundaries in a DXF layer</p>
            </div>

            {/* Config */}
            <div className="px-5 py-4 border-b border-border flex flex-col gap-3">
                {/* Layer */}
                <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                        Target Layer
                    </label>
                    <select
                        value={layer}
                        onChange={(e) => setLayer(e.target.value)}
                        className="w-full bg-surface-2 border-[1.5px] border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent cursor-pointer"
                    >
                        {layers.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                </div>

                {/* Equipment type */}
                <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                        Equipment Type
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                        {EQUIPMENT_TYPES.map(({ value, label, desc }) => (
                            <button
                                key={value}
                                onClick={() => setEquipmentType(value)}
                                className={`px-3 py-2 rounded-lg border-[1.5px] text-left transition-colors
                  ${equipmentType === value
                                    ? "bg-accent-light border-accent text-accent"
                                    : "bg-surface-2 border-border text-muted hover:border-accent/50"}`}
                            >
                                <div className="text-xs font-semibold">{label}</div>
                                <div className="text-[10px] opacity-70 mt-0.5">{desc}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Boundary layer (optional) */}
                <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                        Boundary Layer
                        <span className="ml-1 normal-case font-normal text-muted-2">(optional)</span>
                    </label>
                    <select
                        value={boundaryLayer}
                        onChange={(e) => setBoundaryLayer(e.target.value)}
                        className="w-full bg-surface-2 border-[1.5px] border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent cursor-pointer"
                    >
                        <option value="">— None —</option>
                        {layers.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                </div>

                {/* Run button */}
                <button
                    disabled={!layer || status === "processing"}
                    onClick={() => onRun({ layer, equipmentType, boundaryLayer })}
                    className="w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm
            flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors
            disabled:opacity-35 disabled:cursor-not-allowed"
                >
                    {status === "processing" ? (
                        <>
                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin-fast" />
                            Detecting…
                        </>
                    ) : (
                        <> ▶ Detect Equipment </>
                    )}
                </button>
            </div>

            {/* Summary chips */}
            {shapes.length > 0 && (
                <div className="px-5 py-3 border-b border-border">
                    <div className="flex flex-wrap gap-1.5">
                        <button
                            onClick={() => setFilterKind("all")}
                            className={`text-[10px] px-2.5 py-1 rounded-full font-semibold border transition-colors
                ${filterKind === "all"
                                ? "bg-[#1e293b] text-white border-[#1e293b]"
                                : "bg-surface-2 text-muted border-border hover:border-muted"}`}
                        >
                            All {shapes.length}
                        </button>
                        {kinds.map((kind) => (
                            <button
                                key={kind}
                                onClick={() => setFilterKind(kind === filterKind ? "all" : kind)}
                                className={`text-[10px] px-2.5 py-1 rounded-full font-semibold border capitalize transition-colors
                  ${filterKind === kind ? "text-white border-transparent" : "bg-surface-2 border-border hover:border-muted"}`}
                                style={filterKind === kind
                                    ? { background: KIND_COLOR[kind], borderColor: KIND_COLOR[kind], color: "#fff" }
                                    : { color: KIND_COLOR[kind] }}
                            >
                                {kind} {counts[kind]}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Shape list */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 flex flex-col gap-1">
                {status === "idle" && shapes.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                        <div className="text-4xl opacity-30">⬡</div>
                        <p className="text-xs text-muted-2 leading-relaxed">
                            Select a layer and equipment type, then run detection.
                        </p>
                    </div>
                )}

                {status === "processing" && (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <div className="w-8 h-8 border-3 border-border border-t-accent rounded-full animate-spin-fast" />
                        <p className="text-xs text-muted">Detecting shapes…</p>
                    </div>
                )}

                {filtered.map((shape) => (
                    <div
                        key={shape.shape_id}
                        onClick={() => setSelectedId(shape.shape_id === selectedId ? null : shape.shape_id)}
                        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all border-[1.5px]
              ${shape.shape_id === selectedId
                            ? "bg-accent-light border-accent"
                            : "border-transparent hover:bg-surface-2"}`}
                    >
                        <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ background: KIND_COLOR[shape.kind] ?? "#64748b" }}
                        />
                        <span className="text-[10px] text-muted-2 font-mono min-w-[24px]">#{shape.shape_id + 1}</span>
                        <span className="text-xs font-semibold flex-1 capitalize">{shape.kind}</span>
                        <span className="text-[10px] font-mono text-muted-2">
              {shape.cx.toFixed(1)}, {shape.cy.toFixed(1)}
            </span>
                    </div>
                ))}
            </div>
        </aside>
    );
}