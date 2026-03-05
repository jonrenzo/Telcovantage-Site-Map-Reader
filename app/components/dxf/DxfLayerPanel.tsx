"use client";

import type { DxfLayerData } from "../../types";

interface Props {
    layers: DxfLayerData[];
    onToggle: (name: string) => void;
    onShowAll: () => void;
    onHideAll: () => void;
}

export default function DxfLayerPanel({
                                          layers, onToggle, onShowAll, onHideAll,
                                      }: Props) {
    return (
        <div className="absolute top-16 left-4 z-10 w-64 bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-bold">Layers</h3>
                <div className="flex gap-1">
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

            {/* Layer list */}
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
                {layers.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-muted-2">
                        No layers loaded
                    </div>
                ) : (
                    layers.map((layer) => (
                        <div
                            key={layer.name}
                            onClick={() => onToggle(layer.name)}
                            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-b border-border/50 last:border-0
                ${layer.visible ? "hover:bg-surface-2" : "opacity-50 hover:bg-surface-2"}`}
                        >
                            {/* Color swatch + visibility indicator */}
                            <div className="relative flex-shrink-0">
                                <div
                                    className="w-3.5 h-3.5 rounded-sm border border-black/10"
                                    style={{ background: layer.visible ? layer.color : "#94a3b8" }}
                                />
                                {!layer.visible && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-full h-px bg-muted-2 rotate-45" />
                                    </div>
                                )}
                            </div>

                            {/* Name */}
                            <span className="flex-1 text-xs font-medium truncate">
                {layer.name}
              </span>

                            {/* Segment count */}
                            <span className="text-[10px] font-mono text-muted-2 flex-shrink-0">
                {layer.segmentCount.toLocaleString()}
              </span>

                            {/* Eye icon */}
                            <svg
                                className={`w-3.5 h-3.5 flex-shrink-0 transition-colors ${layer.visible ? "text-accent" : "text-muted-2"}`}
                                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            >
                                {layer.visible ? (
                                    <>
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </>
                                ) : (
                                    <>
                                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </>
                                )}
                            </svg>
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border bg-surface-2">
                <p className="text-[10px] text-muted-2 text-center">
                    Click a layer to toggle visibility
                </p>
            </div>
        </div>
    );
}