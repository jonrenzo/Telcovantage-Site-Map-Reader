"use client";

import { useState, useCallback } from "react";
import type { DigitResult, Segment, FilterMode } from "../types";
import ReviewSidebar from "./ReviewSidebar";
import MapCanvas from "./MapCanvas";
import type { LabelMode } from "./MapCanvas";
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
    const [selectedId,    setSelectedId]    = useState<number | null>(null);
    const [filterMode,    setFilterMode]    = useState<FilterMode>("all");
    const [reviewOpen,    setReviewOpen]    = useState(false);
    const [sidebarOpen,   setSidebarOpen]   = useState(true);
    const [theme,         setTheme]         = useState<ColorTheme>("default");
    const [labelMode,     setLabelMode]     = useState<LabelMode>("strand");

    // Manual placement state
    const [manualMode,    setManualMode]    = useState(false);
    const [manualPending, setManualPending] = useState<{ cx: number; cy: number } | null>(null);
    const [manualValue,   setManualValue]   = useState("");

    const handleCorrection = useCallback((digitId: number, value: string | null) => {
        setResults((prev) =>
            prev.map((r) =>
                r.digit_id === digitId
                    ? { ...r, corrected_value: value, needs_review: false }
                    : r
            )
        );
    }, [setResults]);

    const handleDelete = useCallback((digitId: number) => {
        setResults((prev) => prev.filter((r) => r.digit_id !== digitId));
        setSelectedId(null);
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

    const handleManualPlace = useCallback((cx: number, cy: number) => {
        setManualPending({ cx, cy });
        setManualValue("");
    }, []);

    const confirmManual = useCallback(() => {
        if (!manualPending || !manualValue.trim()) return;

        const CROP_SIZE = 96;
        const PADDING   = 0.05;
        const offscreen = document.createElement("canvas");
        offscreen.width  = CROP_SIZE;
        offscreen.height = CROP_SIZE;
        const ctx = offscreen.getContext("2d");

        let cropB64: string | null = null;
        if (ctx) {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, CROP_SIZE, CROP_SIZE);

            const cx = manualPending.cx;
            const cy = manualPending.cy;
            const minX = cx - PADDING, maxX = cx + PADDING;
            const minY = cy - PADDING, maxY = cy + PADDING;
            const rangeX = maxX - minX;
            const rangeY = maxY - minY;

            const toPixel = (x: number, y: number) => ({
                px: ((x - minX) / rangeX) * CROP_SIZE,
                py: ((maxY - y) / rangeY) * CROP_SIZE,
            });

            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth   = 1.5;
            ctx.beginPath();
            for (const s of segments) {
                if (
                    Math.max(s.x1, s.x2) < minX || Math.min(s.x1, s.x2) > maxX ||
                    Math.max(s.y1, s.y2) < minY || Math.min(s.y1, s.y2) > maxY
                ) continue;
                const p1 = toPixel(s.x1, s.y1);
                const p2 = toPixel(s.x2, s.y2);
                ctx.moveTo(p1.px, p1.py);
                ctx.lineTo(p2.px, p2.py);
            }
            ctx.stroke();

            const center = toPixel(cx, cy);
            ctx.strokeStyle = "#8b5cf6";
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.moveTo(center.px - 6, center.py);
            ctx.lineTo(center.px + 6, center.py);
            ctx.moveTo(center.px, center.py - 6);
            ctx.lineTo(center.px, center.py + 6);
            ctx.stroke();

            cropB64 = offscreen.toDataURL("image/png").split(",")[1];
        }

        const newId = results.length > 0
            ? Math.max(...results.map((r) => r.digit_id)) + 1
            : 0;

        const newDigit: DigitResult = {
            digit_id:        newId,
            value:           manualValue.trim(),
            corrected_value: manualValue.trim(),
            confidence:      1.0,
            needs_review:    false,
            bbox:            [manualPending.cx, manualPending.cy, manualPending.cx, manualPending.cy],
            center_x:        manualPending.cx,
            center_y:        manualPending.cy,
            crop_b64:        cropB64,
            manual:          true,
        };

        setResults((prev) => [...prev, newDigit]);
        setManualPending(null);
        setManualValue("");
    }, [manualPending, manualValue, results, segments, setResults]);

    const cancelManual = useCallback(() => {
        setManualPending(null);
        setManualValue("");
    }, []);

    const selectedResult = results.find((r) => r.digit_id === selectedId) ?? null;
    const fileName = dxfPath.split(/[\\\/]/).pop() ?? "";

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
                        manualMode={manualMode}
                        onToggleManual={() => {
                            setManualMode((m) => !m);
                            setManualPending(null);
                            setManualValue("");
                            setSelectedId(null);
                        }}
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
                    onSelectDigit={manualMode ? () => {} : setSelectedId}
                    theme={THEMES[theme]}
                    manualMode={manualMode}
                    onManualPlace={handleManualPlace}
                    labelMode={labelMode}
                />

                {selectedResult && !manualMode && (
                    <DetailPanel
                        result={selectedResult}
                        onClose={() => setSelectedId(null)}
                        onSave={(val) => handleCorrection(selectedResult.digit_id, val || null)}
                        onDelete={handleDelete}
                    />
                )}

                {/* ── Manual placement popup ── */}
                {manualPending && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/10 backdrop-blur-[1px]">
                        <div className="bg-white rounded-xl shadow-2xl border border-border p-5 w-72">
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-semibold">Add Digit Manually</p>
                                <button
                                    onClick={cancelManual}
                                    className="w-5 h-5 rounded-full bg-surface-2 flex items-center justify-center text-muted text-xs hover:bg-border transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                            <p className="text-xs text-muted mb-3 font-mono">
                                ({manualPending.cx.toFixed(2)}, {manualPending.cy.toFixed(2)})
                            </p>
                            <input
                                autoFocus
                                type="text"
                                value={manualValue}
                                onChange={(e) => setManualValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && manualValue.trim()) confirmManual();
                                    if (e.key === "Escape") cancelManual();
                                }}
                                placeholder="Enter digit value…"
                                className="w-full border border-border rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-accent/30 font-mono"
                            />
                            <div className="flex gap-2">
                                <button onClick={cancelManual}
                                        className="flex-1 px-3 py-2 rounded-lg text-sm border border-border text-muted hover:bg-surface-2 transition-colors">
                                    Cancel
                                </button>
                                <button onClick={confirmManual} disabled={!manualValue.trim()}
                                        className="flex-1 px-3 py-2 rounded-lg text-sm bg-[#8b5cf6] text-white font-medium hover:bg-[#7c3aed] disabled:opacity-40 transition-colors">
                                    Confirm
                                </button>
                            </div>
                            <p className="text-[10px] text-muted-2 text-center mt-2">
                                Enter to confirm · Esc to cancel
                            </p>
                        </div>
                    </div>
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

                {/* ── Upper-left toolbar ── */}
                <div className="absolute top-4 left-16 z-10 flex items-center gap-2 flex-wrap">

                    {/* Label mode toggle */}
                    <div className="flex items-center bg-surface border border-border rounded-lg shadow-sm overflow-hidden h-8">
                        <button
                            onClick={() => setLabelMode("strand")}
                            title="Show strand values"
                            className={`flex items-center gap-1.5 px-3 h-full text-[11px] font-semibold transition-colors
                                ${labelMode === "strand"
                                ? "bg-accent text-white"
                                : "text-muted hover:bg-surface-2"}`}
                        >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                            </svg>
                            Strand
                        </button>

                        <div className="w-px h-4 bg-border" />

                        <button
                            onClick={() => setLabelMode("pole")}
                            title="Show pole IDs"
                            className={`flex items-center gap-1.5 px-3 h-full text-[11px] font-semibold transition-colors
                                ${labelMode === "pole"
                                ? "bg-[#f59e0b] text-white"
                                : "text-muted hover:bg-surface-2"}`}
                        >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="9" />
                                <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                            </svg>
                            Pole ID
                        </button>
                    </div>

                    {/* Pole mode notice */}
                    {labelMode === "pole" && (
                        <div className="flex items-center gap-1.5 bg-[#fef3c7] border border-[#fde68a] text-[#92400e]
                            rounded-lg px-2.5 h-8 text-[10px] font-semibold shadow-sm whitespace-nowrap">
                            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            Showing index — pole backend coming soon
                        </div>
                    )}

                    {/* Theme picker */}
                    <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-2 h-8 shadow-sm">
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
                </div>

                {/* ── Legend ── */}
                <div className="absolute bottom-4 left-4 bg-white/90 border border-border rounded-xl px-3.5 py-2.5 flex flex-col gap-2 shadow-sm backdrop-blur-sm">
                    {labelMode === "strand" ? (
                        <>
                            {[
                                { color: THEMES[theme].ok,       label: "Read correctly"     },
                                { color: THEMES[theme].review,    label: "Needs checking"     },
                                { color: THEMES[theme].corrected, label: "Manually corrected" },
                                { color: "#8b5cf6",               label: "Added manually"     },
                            ].map(({ color, label }) => (
                                <div key={label} className="flex items-center gap-2 text-xs">
                                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                                    {label}
                                </div>
                            ))}
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 text-xs">
                                <div className="w-3 h-3 rounded-full flex-shrink-0 bg-[#f59e0b]" />
                                Pole ID (index placeholder)
                            </div>
                            <p className="text-[10px] text-muted-2 leading-relaxed max-w-[150px]">
                                Real pole names will appear once the pole backend is connected.
                            </p>
                        </>
                    )}
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