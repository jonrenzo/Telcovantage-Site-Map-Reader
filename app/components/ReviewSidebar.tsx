"use client";

import type { DigitResult, FilterMode } from "../types";

interface Props {
    results: DigitResult[];
    filterMode: FilterMode;
    setFilterMode: (mode: FilterMode) => void;
    selectedId: number | null;
    setSelectedId: (id: number | null) => void;
    onOpenReviewModal: () => void;
    onExport: () => void;
    fileName: string;
}

const FILTERS: { key: FilterMode; label: string }[] = [
    { key: "all",       label: "All" },
    { key: "review",    label: "Uncertain" },
    { key: "corrected", label: "Fixed" },
];

function DigitRow({
                      result,
                      selected,
                      onClick,
                  }: {
    result: DigitResult;
    selected: boolean;
    onClick: () => void;
}) {
    const val = result.corrected_value ?? result.value;

    return (
        <div
            onClick={onClick}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all border-[1.5px]
        ${selected ? "bg-accent-light border-accent"
                : result.corrected_value ? "border-[#bbf7d0] bg-ok-light"
                    : result.needs_review ? "border-[#fde68a] bg-review-light"
                        : "border-transparent hover:bg-surface-2"}`}
        >
      <span className="text-[10px] text-muted-2 min-w-[28px] font-mono">
        #{result.digit_id}
      </span>
            <span className="font-mono text-base font-semibold flex-1">{val}</span>
            {result.corrected_value ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-accent font-semibold whitespace-nowrap">
          ✏ Fixed
        </span>
            ) : result.needs_review ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#fef3c7] text-review font-semibold whitespace-nowrap">
          ⚠ Check
        </span>
            ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#dcfce7] text-ok font-semibold whitespace-nowrap">
          ✓
        </span>
            )}
        </div>
    );
}

export default function ReviewSidebar({
                                          results, filterMode, setFilterMode, selectedId, setSelectedId,
                                          onOpenReviewModal, onExport, fileName,
                                      }: Props) {
    const filtered = results.filter((r) => {
        if (filterMode === "review")    return r.needs_review;
        if (filterMode === "corrected") return !!r.corrected_value;
        return true;
    });

    const total    = results.length;
    const toReview = results.filter((r) => r.needs_review && !r.corrected_value).length;
    let sum = 0;
    results.forEach((r) => {
        const n = parseInt(r.corrected_value ?? r.value);
        if (!isNaN(n)) sum += n;
    });

    return (
        <aside className="w-80 bg-surface border-r border-border flex flex-col overflow-hidden flex-shrink-0">
            {/* Header */}
            <div className="px-5 py-4 border-b border-border">
                <h2 className="text-[0.95rem] font-bold">Drawing Results</h2>
                <p className="text-muted mt-0.5 text-base">{fileName}</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 p-3.5 border-b border-border">
                {[
                    { val: total,        label: "Total",    color: "text-accent" },
                    { val: toReview,     label: "To Check", color: "text-review" },
                    { val: sum || "—",   label: "Sum",      color: "text-ok" },
                ].map(({ val, label, color }) => (
                    <div key={label} className="text-center py-2.5 px-1.5 rounded-lg bg-surface-2">
                        <div className={`text-xl font-extrabold font-mono ${color}`}>{val}</div>
                        <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5 font-bold">
                            {label}
                        </div>
                    </div>
                ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 px-5 py-3 border-b border-border">
                <button
                    disabled={toReview === 0}
                    onClick={onOpenReviewModal}
                    className="flex-1 py-2 text-xs font-semibold rounded-lg border-[1.5px]
            bg-review-light text-review border-[#fde68a]
            hover:bg-[#fef3c7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {toReview > 0 ? `Check ${toReview} Uncertain` : "✓ All confident"}
                </button>
                <button
                    onClick={onExport}
                    className="flex-1 py-2 text-xs font-semibold rounded-lg border-[1.5px]
            bg-ok-light text-ok border-[#bbf7d0] hover:bg-[#dcfce7] transition-colors"
                >
                    Save to Excel
                </button>
            </div>

            {/* Filter tabs */}
            <div className="flex border-b border-border px-5">
                {FILTERS.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setFilterMode(key)}
                        className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap
              ${filterMode === key
                            ? "text-accent border-accent"
                            : "text-muted border-transparent hover:text-[#1e293b]"}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Digit list */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 flex flex-col gap-1">
                {filtered.map((r) => (
                    <DigitRow
                        key={r.digit_id}
                        result={r}
                        selected={r.digit_id === selectedId}
                        onClick={() => setSelectedId(r.digit_id === selectedId ? null : r.digit_id)}
                    />
                ))}
            </div>
        </aside>
    );
}