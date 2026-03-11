"use client";

import { useState, useMemo } from "react";
import type { DxfLayerData } from "../../types";

interface Props {
    layers: DxfLayerData[];
    onToggle: (name: string) => void;
    onShowAll: () => void;
    onHideAll: () => void;
}

// ── Group definitions ────────────────────────────────────────────────────────
interface LayerGroup {
    key: string;
    label: string;
    icon: string;
    color: string;           // accent color for the group header
    bgColor: string;         // header background
    match: (name: string) => boolean;
}

const GROUPS: LayerGroup[] = [
    {
        key: "equipment",
        label: "Equipment",
        icon: "⚙",
        color: "#2563eb",
        bgColor: "#eff6ff",
        match: (n) => {
            const l = n.toLowerCase();
            return l.includes("ampli") || l.includes("extender") || l.includes("extend") ||
                l.includes("node") || l.includes("pole") || l.includes("power");
        },
    },
    {
        key: "tsc",
        label: "Cable Strand",
        icon: "📡",
        color: "#7c3aed",
        bgColor: "#f5f3ff",
        match: (n) => {
            const l = n.toLowerCase();
            return l.includes("strand") || l.includes("cable")
        }
    },
    {
        key: "tapoffs",
        label: "Tapoffs / Splitters",
        icon: "⬡",
        color: "#16a34a",
        bgColor: "#f0fdf4",
        match: (n) => {
            const l = n.toLowerCase();
            return l.includes("tapoff") || l.includes("tap-off") || l.includes("tap_off") ||
                l.includes("splitter");
        },
    },
];

// Everything not matched by the above falls into "Other"
const OTHER_GROUP: LayerGroup = {
    key: "other",
    label: "Other Layers",
    icon: "◻",
    color: "#64748b",
    bgColor: "#f8fafc",
    match: () => true,
};

function classifyLayers(layers: DxfLayerData[]) {
    const buckets: Record<string, DxfLayerData[]> = {};
    const assigned = new Set<string>();

    for (const g of GROUPS) {
        buckets[g.key] = [];
    }
    buckets[OTHER_GROUP.key] = [];

    for (const layer of layers) {
        let placed = false;
        for (const g of GROUPS) {
            if (g.match(layer.name)) {
                buckets[g.key].push(layer);
                assigned.add(layer.name);
                placed = true;
                break;
            }
        }
        if (!placed) {
            buckets[OTHER_GROUP.key].push(layer);
        }
    }

    return buckets;
}

// ── Sub-component: a single layer row ────────────────────────────────────────
function LayerRow({
                      layer,
                      onToggle,
                  }: {
    layer: DxfLayerData;
    onToggle: () => void;
}) {
    return (
        <div
            onClick={onToggle}
            className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors
                border-b border-border/40 last:border-0
                ${layer.visible ? "hover:bg-surface-2" : "opacity-40 hover:bg-surface-2"}`}
        >
            {/* Color swatch */}
            <div className="relative flex-shrink-0">
                <div
                    className="w-3 h-3 rounded-sm border border-black/10"
                    style={{ background: layer.visible ? layer.color : "#94a3b8" }}
                />
                {!layer.visible && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-full h-px bg-muted-2 rotate-45" />
                    </div>
                )}
            </div>

            {/* Name */}
            <span className="flex-1 text-xs font-medium truncate" title={layer.name}>
                {layer.name}
            </span>

            {/* Segment count */}
            <span className="text-[10px] font-mono text-muted-2 flex-shrink-0 tabular-nums">
                {layer.segmentCount.toLocaleString()}
            </span>

            {/* Eye icon */}
            <svg
                className={`w-3 h-3 flex-shrink-0 transition-colors ${layer.visible ? "text-accent" : "text-muted-2"}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
                {layer.visible ? (
                    <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                    </>
                ) : (
                    <>
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                )}
            </svg>
        </div>
    );
}

// ── Sub-component: a collapsible group ───────────────────────────────────────
function LayerGroupSection({
                               group,
                               layers,
                               onToggle,
                               onShowGroup,
                               onHideGroup,
                               defaultOpen,
                           }: {
    group: LayerGroup;
    layers: DxfLayerData[];
    onToggle: (name: string) => void;
    onShowGroup: () => void;
    onHideGroup: () => void;
    defaultOpen: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    if (layers.length === 0) return null;

    const visibleCount = layers.filter((l) => l.visible).length;
    const allVisible   = visibleCount === layers.length;
    const noneVisible  = visibleCount === 0;

    return (
        <div className="border-b border-border last:border-0">
            {/* Group header */}
            <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none transition-colors hover:brightness-95"
                style={{ background: group.bgColor }}
                onClick={() => setOpen((o) => !o)}
            >
                {/* Collapse chevron */}
                <svg
                    className="w-3 h-3 flex-shrink-0 transition-transform duration-200"
                    style={{
                        color: group.color,
                        transform: open ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                >
                    <path d="M9 18l6-6-6-6" />
                </svg>

                {/* Icon + label */}
                <span className="text-xs mr-0.5" aria-hidden>{group.icon}</span>
                <span
                    className="text-xs font-semibold flex-1"
                    style={{ color: group.color }}
                >
                    {group.label}
                </span>

                {/* Visible count badge */}
                <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded-full font-semibold"
                    style={{
                        background: noneVisible ? "#f1f5f9" : group.bgColor,
                        color: noneVisible ? "#94a3b8" : group.color,
                        border: `1px solid ${noneVisible ? "#e2e8f0" : group.color + "33"}`,
                    }}
                >
                    {visibleCount}/{layers.length}
                </span>

                {/* Group show/hide buttons — stop propagation so they don't toggle collapse */}
                <div
                    className="flex gap-1 ml-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        title="Show all in group"
                        onClick={onShowGroup}
                        disabled={allVisible}
                        className="w-5 h-5 rounded flex items-center justify-center transition-colors
                            hover:bg-white/60 disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ color: group.color }}
                    >
                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    </button>
                    <button
                        title="Hide all in group"
                        onClick={onHideGroup}
                        disabled={noneVisible}
                        className="w-5 h-5 rounded flex items-center justify-center transition-colors
                            hover:bg-white/60 disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ color: group.color }}
                    >
                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Layer rows — animated expand/collapse */}
            {open && (
                <div>
                    {layers.map((layer) => (
                        <LayerRow
                            key={layer.name}
                            layer={layer}
                            onToggle={() => onToggle(layer.name)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DxfLayerPanel({ layers, onToggle, onShowAll, onHideAll }: Props) {
    const buckets = useMemo(() => classifyLayers(layers), [layers]);

    const allGroups = [...GROUPS, OTHER_GROUP];

    // Callbacks: show/hide all layers in a group
    const handleShowGroup = (groupKey: string) => {
        for (const layer of buckets[groupKey] ?? []) {
            if (!layer.visible) onToggle(layer.name);
        }
    };
    const handleHideGroup = (groupKey: string) => {
        for (const layer of buckets[groupKey] ?? []) {
            if (layer.visible) onToggle(layer.name);
        }
    };

    const totalVisible = layers.filter((l) => l.visible).length;

    return (
        <div className="absolute top-16 left-4 z-10 w-72 bg-surface border border-border rounded-xl shadow-xl overflow-hidden flex flex-col">
            {/* ── Header ── */}
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-surface flex-shrink-0">
                <div>
                    <h3 className="text-sm font-bold leading-none">Layers</h3>
                    <p className="text-[10px] text-muted mt-0.5">
                        {totalVisible} of {layers.length} visible
                    </p>
                </div>
                <div className="flex gap-1.5">
                    <button
                        onClick={onShowAll}
                        className="text-[10px] px-2 py-1 rounded-md bg-accent-light text-accent font-semibold hover:bg-blue-100 transition-colors"
                    >
                        All on
                    </button>
                    <button
                        onClick={onHideAll}
                        className="text-[10px] px-2 py-1 rounded-md bg-surface-2 text-muted font-semibold hover:bg-border transition-colors"
                    >
                        All off
                    </button>
                </div>
            </div>

            {/* ── Groups ── */}
            <div className="overflow-y-auto scrollbar-thin max-h-[70vh]">
                {layers.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-muted-2">
                        No layers loaded
                    </div>
                ) : (
                    allGroups.map((group) => (
                        <LayerGroupSection
                            key={group.key}
                            group={group}
                            layers={buckets[group.key] ?? []}
                            onToggle={onToggle}
                            onShowGroup={() => handleShowGroup(group.key)}
                            onHideGroup={() => handleHideGroup(group.key)}
                            // Equipment and TSC open by default, others collapsed
                            defaultOpen={group.key === "tsc"}
                        />
                    ))
                )}
            </div>

            {/* ── Footer ── */}
            <div className="px-4 py-2 border-t border-border bg-surface-2 flex-shrink-0">
                <p className="text-[10px] text-muted-2 text-center">
                    Click a layer to toggle · Use group buttons to show/hide all
                </p>
            </div>
        </div>
    );
}