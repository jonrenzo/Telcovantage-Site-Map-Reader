"use client";

import { useState, useCallback } from "react";
import type { DigitResult, Segment, FilterMode } from "@/types";
import ReviewSidebar from "./ReviewSidebar";
import MapCanvas from "./MapCanvas";
import DetailPanel from "./DetailPanel";
import ReviewModal from "./ReviewModal";

export type ColorTheme = "default" | "contrast" | "neon" | "pastel";

export const THEMES: Record<ColorTheme, { ok: string; review: string; corrected: string; label: string }> = {
    default:  { ok: "#16a34a", review: "#d97706", corrected: "#2563eb", label: "Default"  },
    contrast: { ok: "#15803d", review: "#b45309", corrected: "#1d4ed8", label: "Contrast" },
    neon:     { ok: "#22ff7a", review: "#ffcc00", corrected: "#00cfff", label: "Neon"     },
    pastel:   { ok: "#6ee7b7", review: "#fcd34d", corrected: "#93c5fd", label: "Pastel"   },
};

interface Props {
    dxfPath: string;
    results: DigitResult[];
    setResults: React.Dispatch<React.SetStateAction<DigitResult[]>>;
    segments: Segment[];
    onExportDone: () => void;
}

export default function ReviewLayout({
                                         dxfPath, results, setResults, segments, onExportDone,
                                     }: Props) {
    const [selectedId,   setSelectedId]   = useState<number | null>(null);
    const [filterMode,   setFilterMode]   = useState<FilterMode>("all");
    const [reviewOpen,   setReviewOpen]   = useState(false);
    const [sidebarOpen,  setSidebarOpen]  = useState(true);
    const [theme,        setTheme]        = useState<ColorTheme>("default");

    const handleCorrection = useCallback((digitId: number, value: string | null) => {
        setResults((prev) =>
            prev.map((r) =>
                r.digit_id === digitId
                    ? { ...r, corrected_value: value, needs_review: false }
                    : r
            )
        );
    }, [setResults]);

    const handleExport = useCallback(async () => {
        const corrections: Record<number, string | null> = {};
        results.forEach((r) => { corrections[r.digit_id] = r.corrected_value; });
        const res  = await fetch("/api/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ corrections }),
        });
        const data = await res.json();
        if (data.error) { alert("Could not save: " + data.error); return; }
        window.location.href = "/api/download?file=" + encodeURIComponent(data.path);
        onExportDone();
    }, [results, onExportDone]);

    const selectedResult = results.find((r) => r.digit_id === selectedId) ?? null;
    const fileName = dxfPath.split(/[\\/]/).pop() ?? "";

    return (
        <div className="flex-1 flex overflow-hidden">

            {/* ── Sidebar ── */}
            <div className={`relative flex-shrink-0 transition-all duration-300 ease-in-out ${sidebarOpen ? "w-80" : "w-0"}`}>
                <div className={`absolute inset-0 transition-opacity duration-300 ${sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                    <ReviewSidebar
                        results={results}
                        filterMode={filterMode}
                        setFilterMode={setFilterMode}
                        selectedId={selectedId}
                        setSelectedId={setSelectedId}
                        onOpenReviewModal={() => setReviewOpen(true)}
                        onExport={handleExport}
                        fileName={fileName}
                    />
                </div>
            </div>

            {/* ── Map area ── */}
            <div className="flex-1 relative overflow-hidden bg-[#e8edf5]">
                <MapCanvas
                    segments={segments}
                    results={results}
                    filterMode={filterMode}
                    selectedId={selectedId}
                    onSelectDigit={setSelectedId}
                    theme={THEMES[theme]}
                />

                {selectedResult && (
                    <DetailPanel
                        result={selectedResult}
                        onClose={() => setSelectedId(null)}
                        onSave={(val) => handleCorrection(selectedResult.digit_id, val || null)}
                    />
                )}

                {/* ── Collapse toggle ── */}
                <button
                    onClick={() => setSidebarOpen((o) => !o)}
                    title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                    className="absolute top-4 left-4 z-10 w-8 h-8 bg-surface border border-border rounded-lg
            flex items-center justify-center shadow-sm hover:bg-surface-2 transition-colors"
                >
                    <svg
                        className={`w-4 h-4 text-muted transition-transform duration-300 ${sidebarOpen ? "" : "rotate-180"}`}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    >
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>

                {/* ── Theme picker ── */}
                <div className="absolute top-4 left-16 z-10 flex items-center gap-1 bg-surface border border-border rounded-lg px-2 py-1.5 shadow-sm">
                    {(Object.entries(THEMES) as [ColorTheme, typeof THEMES[ColorTheme]][]).map(([key, val]) => (
                        <button
                            key={key}
                            title={val.label}
                            onClick={() => setTheme(key)}
                            className={`w-5 h-5 rounded-full border-2 transition-all hover:scale-110
                ${theme === key ? "border-[#1e293b] scale-110" : "border-transparent"}`}
                            style={{ background: val.ok }}
                        />
                    ))}
                    <span className="text-[10px] text-muted ml-1 font-medium">{THEMES[theme].label}</span>
                </div>

                {/* ── Legend ── */}
                <div className="absolute bottom-4 left-4 bg-white/90 border border-border rounded-xl px-3.5 py-2.5 flex flex-col gap-2 shadow-sm backdrop-blur-sm">
                    {[
                        { color: THEMES[theme].ok,        label: "Read correctly"     },
                        { color: THEMES[theme].review,     label: "Needs checking"     },
                        { color: THEMES[theme].corrected,  label: "Manually corrected" },
                    ].map(({ color, label }) => (
                        <div key={label} className="flex items-center gap-2 text-xs">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                            {label}
                        </div>
                    ))}
                </div>
            </div>

            {reviewOpen && (
                <ReviewModal
                    results={results}
                    onCorrect={handleCorrection}
                    onClose={() => setReviewOpen(false)}
                />
            )}
        </div>
    );
}