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
  exporting?: boolean;
  fileName: string;
  manualMode: boolean;
  onToggleManual: () => void;
}

const FILTERS: { key: FilterMode; label: string }[] = [
  { key: "all", label: "All" },
  { key: "review", label: "⚠ Uncertain" },
  { key: "corrected", label: "✏ Fixed" },
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
                ${
                  selected
                    ? "bg-accent-light border-accent"
                    : result.manual
                      ? "border-[#ddd6fe] bg-[#f5f3ff]"
                      : result.corrected_value
                        ? "border-[#bbf7d0] bg-ok-light"
                        : result.needs_review
                          ? "border-[#fde68a] bg-review-light"
                          : "border-transparent hover:bg-surface-2"
                }`}
    >
      <span className="text-[10px] text-muted-2 min-w-[28px] font-mono">
        #{result.digit_id}
      </span>
      <span className="font-mono text-base font-semibold flex-1">{val}</span>

      {result.manual ? (
        <span className="text-[9px] bg-[#8b5cf6]/10 text-[#8b5cf6] px-1.5 py-0.5 rounded font-semibold">
          MANUAL
        </span>
      ) : result.corrected_value ? (
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
  results,
  filterMode,
  setFilterMode,
  selectedId,
  setSelectedId,
  onOpenReviewModal,
  onExport,
  exporting = false,
  fileName,
  manualMode,
  onToggleManual,
}: Props) {
  const filtered = results.filter((r) => {
    if (filterMode === "review") return r.needs_review;
    if (filterMode === "corrected") return !!r.corrected_value;
    return true;
  });

  const total = results.length;
  const toReview = results.filter(
    (r) => r.needs_review && !r.corrected_value,
  ).length;
  let sum = 0;
  results.forEach((r) => {
    const n = parseInt(r.corrected_value ?? r.value);
    if (!isNaN(n)) sum += n;
  });

  return (
    <aside className="w-80 h-full bg-surface border-r border-border flex flex-col overflow-hidden flex-shrink-0">
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-border flex-shrink-0">
        <h2 className="text-[0.95rem] font-bold">Drawing Results</h2>
        <p className="text-xs text-muted mt-0.5">{fileName}</p>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-2 p-3.5 border-b border-border flex-shrink-0">
        {[
          { val: total, label: "Total", color: "text-accent" },
          { val: toReview, label: "To Check", color: "text-review" },
          { val: sum || "—", label: "Sum", color: "text-ok" },
        ].map(({ val, label, color }) => (
          <div
            key={label}
            className="text-center py-2.5 px-1.5 rounded-lg bg-surface-2"
          >
            <div className={`text-xl font-bold font-mono ${color}`}>{val}</div>
            <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5">
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Action buttons ── */}
      <div className="flex gap-2 px-5 py-3 border-b border-border flex-shrink-0">
        <button
          disabled={toReview === 0}
          onClick={onOpenReviewModal}
          className="flex-1 py-2 text-xs font-semibold rounded-lg border-[1.5px]
                        bg-review-light text-review border-[#fde68a]
                        hover:bg-[#fef3c7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {toReview > 0 ? `⚠ Check ${toReview} Uncertain` : "✓ All confident"}
        </button>

        <button
          onClick={onExport}
          disabled={exporting}
          className="flex-1 py-2 text-xs font-semibold rounded-lg border-[1.5px]
                        bg-ok-light text-ok border-[#bbf7d0] hover:bg-[#dcfce7]
                        disabled:opacity-60 disabled:cursor-not-allowed transition-colors
                        flex items-center justify-center gap-1.5"
        >
          {exporting ? (
            <>
              <svg
                className="w-3.5 h-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Saving…
            </>
          ) : (
            <>⬇ Save to Excel</>
          )}
        </button>
      </div>

      {/* ── Add Manually button ── */}
      <div className="px-5 py-3 border-b border-border flex-shrink-0">
        <button
          onClick={onToggleManual}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold border-[1.5px] transition-colors ${
            manualMode
              ? "bg-[#8b5cf6] text-white border-[#8b5cf6]"
              : "bg-[#f5f3ff] text-[#8b5cf6] border-[#ddd6fe] hover:bg-[#ede9fe]"
          }`}
        >
          {manualMode ? (
            <>
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              Cancel — Click map to place
            </>
          ) : (
            <>
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Manually
            </>
          )}
        </button>
        {manualMode && (
          <p className="text-[10px] text-muted-2 text-center mt-1.5">
            Click anywhere on the map, then type the value
          </p>
        )}
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex border-b border-border px-5 flex-shrink-0">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilterMode(key)}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap
                            ${
                              filterMode === key
                                ? "text-accent border-accent"
                                : "text-muted border-transparent hover:text-[#1e293b]"
                            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Digit list — this is the only section that scrolls ── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 flex flex-col gap-1 min-h-0">
        {filtered.map((r) => (
          <DigitRow
            key={r.digit_id}
            result={r}
            selected={r.digit_id === selectedId}
            onClick={() =>
              setSelectedId(r.digit_id === selectedId ? null : r.digit_id)
            }
          />
        ))}
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs text-muted-2 text-center px-4">
            No digits match this filter
          </div>
        )}
      </div>
    </aside>
  );
}
