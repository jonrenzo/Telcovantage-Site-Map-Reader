"use client";

import { useState, useEffect, useRef } from "react";
import type { PoleTag } from "../../types";

interface Props {
  dxfPath: string;
  layers: string[];
  tags: PoleTag[];
  status: "idle" | "processing" | "done" | "error";
  error: string | null;
  scannedLayer: string | null;
  onScan: (layer: string) => void;
  selectedId: number | null;
  onSelectTag: (id: number | null) => void;
  showOnMap: boolean;
  onToggleShowOnMap: () => void;
  scanProgress: number;
  scanTotal: number;
  onRenamePole: (poleId: number, newName: string) => void;
}

type SortMode = "name" | "position";

function confBadge(conf: number | null): { label: string; cls: string } | null {
  if (conf === null || conf === undefined) return null;
  const pct = Math.round(conf * 100);
  if (conf >= 0.8)
    return { label: `${pct}%`, cls: "bg-[#dcfce7] text-[#15803d]" };
  if (conf >= 0.6)
    return { label: `${pct}%`, cls: "bg-[#fef9c3] text-[#92400e]" };
  return { label: `${pct}%`, cls: "bg-[#fee2e2] text-[#b91c1c]" };
}

export default function PolePanel({
  dxfPath,
  layers,
  tags,
  status,
  error,
  scannedLayer,
  onScan,
  selectedId,
  onSelectTag,
  showOnMap,
  onToggleShowOnMap,
  scanProgress,
  scanTotal,
  onRenamePole,
}: Props) {
  const [selectedLayer, setSelectedLayer] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("position");
  const [exporting, setExporting] = useState(false);

  // per-row edit draft (only one active at a time)
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  // Auto-select a pole layer on mount
  useEffect(() => {
    if (!selectedLayer) {
      const poleLayer = layers.find((l) => /pole|tag|label/i.test(l));
      if (poleLayer) setSelectedLayer(poleLayer);
      else if (layers.length) setSelectedLayer(layers[0]);
    }
  }, [layers, selectedLayer]);

  // Focus the edit input when it appears
  useEffect(() => {
    if (editId !== null) editRef.current?.focus();
  }, [editId]);

  // ── Export handler ────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!tags.length || exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/pole_tags/export", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        alert("Export failed: " + data.error);
        return;
      }
      // Trigger download via the existing /api/download endpoint
      window.location.href =
        "/api/download?file=" + encodeURIComponent(data.path);
    } catch (e) {
      alert("Export failed: " + String(e));
    } finally {
      setExporting(false);
    }
  };

  const filtered = tags.filter(
    (t) => !search || t.name.toLowerCase().includes(search.toLowerCase()),
  );
  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name);
    return b.cy - a.cy || a.cx - b.cx;
  });

  const isScanning = status === "processing";
  const strTags = tags.filter((t) => t.source === "stroke");
  const ocrDone = strTags.filter((t) => t.ocr_conf !== null);
  const ocrAccepted = ocrDone.filter((t) => !t.needs_review);

  function commitEdit(poleId: number) {
    const v = editDraft.trim().toUpperCase();
    if (v) onRenamePole(poleId, v);
    setEditId(null);
  }

  function startEdit(tag: PoleTag, e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    setEditId(tag.pole_id);
    setEditDraft(tag.name || "");
  }

  return (
    <div className="w-72 border-r border-border bg-surface flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#f59e0b]/15 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-[#f59e0b]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="9" />
                <circle
                  cx="12"
                  cy="12"
                  r="2.5"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold">Pole IDs</span>
          </div>

          <button
            onClick={onToggleShowOnMap}
            title={showOnMap ? "Hide poles on map" : "Show poles on map"}
            className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors
                            ${
                              showOnMap
                                ? "bg-[#f59e0b] text-white"
                                : "bg-surface-2 text-muted border border-border"
                            }`}
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              {showOnMap ? (
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              ) : (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              )}
            </svg>
            Visible
          </button>
        </div>

        {/* Layer selector + Scan */}
        <div className="flex gap-2">
          <select
            value={selectedLayer}
            onChange={(e) => setSelectedLayer(e.target.value)}
            disabled={isScanning}
            className="flex-1 bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-xs
                            focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/30 min-w-0 truncate"
          >
            {layers.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            onClick={() => selectedLayer && onScan(selectedLayer)}
            disabled={isScanning || !selectedLayer}
            className="px-3 py-1.5 bg-[#f59e0b] hover:bg-[#d97706] text-white text-xs font-semibold
                            rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isScanning ? (
              <svg
                className="w-3.5 h-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              "Scan"
            )}
          </button>
        </div>

        {/* Error */}
        {status === "error" && error && (
          <p className="mt-2 text-[10px] text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] rounded-lg px-2 py-1.5">
            {error}
          </p>
        )}

        {/* Progress bar */}
        {status === "processing" && scanTotal > 0 && (
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-muted mb-1">
              <span>
                Reading pole IDs…{" "}
                <span className="font-mono text-[#f59e0b]">
                  {scanProgress}/{scanTotal}
                </span>
              </span>
              <span className="font-mono">
                {Math.round((scanProgress / scanTotal) * 100)}%
              </span>
            </div>
            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#f59e0b] rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round((scanProgress / scanTotal) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
        {status === "processing" && scanTotal === 0 && (
          <p className="mt-2 text-[10px] text-muted animate-pulse">
            Detecting poles…
          </p>
        )}

        {/* Done stats */}
        {status === "done" && scannedLayer && (
          <div className="mt-2 flex flex-col gap-0.5">
            <p className="text-[10px] text-[#16a34a]">
              Found {tags.length} pole{tags.length !== 1 ? "s" : ""} on{" "}
              <span className="font-mono">{scannedLayer}</span>
            </p>
            {ocrDone.length > 0 && (
              <p className="text-[10px] text-muted">
                OCR: {ocrAccepted.length}/{ocrDone.length} names resolved
                {ocrDone.length - ocrAccepted.length > 0 && (
                  <span className="text-[#dc2626] ml-1">
                    ({ocrDone.length - ocrAccepted.length} need review)
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {/* ── Export to Excel button ── */}
        {tags.length > 0 && (
          <button
            onClick={handleExport}
            disabled={exporting || isScanning}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold
                            rounded-lg border-[1.5px] transition-colors
                            bg-ok-light text-ok border-[#bbf7d0] hover:bg-[#dcfce7]
                            disabled:opacity-50 disabled:cursor-not-allowed"
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
                Exporting…
              </>
            ) : (
              <>
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                ⬇ Export {tags.length} Pole{tags.length !== 1 ? "s" : ""} to
                Excel
              </>
            )}
          </button>
        )}
      </div>

      {/* ── Search + Sort ───────────────────────────────────────────── */}
      {tags.length > 0 && (
        <div className="px-3 pt-2.5 pb-1.5 flex gap-1.5 flex-shrink-0">
          <input
            type="text"
            placeholder="Search pole name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs
                            focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/30 min-w-0"
          />
          <div className="flex items-center bg-surface-2 border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setSortMode("name")}
              className={`px-2 py-1.5 text-[10px] font-semibold transition-colors
                                ${sortMode === "name" ? "bg-[#f59e0b] text-white" : "text-muted hover:bg-surface"}`}
            >
              A-Z
            </button>
            <button
              onClick={() => setSortMode("position")}
              className={`px-2 py-1.5 text-[10px] font-semibold transition-colors
                                ${sortMode === "position" ? "bg-[#f59e0b] text-white" : "text-muted hover:bg-surface"}`}
            >
              ↕
            </button>
          </div>
        </div>
      )}

      {/* ── Scrollable pole list ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Empty states */}
        {status === "idle" && tags.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-[#f59e0b]/10 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-[#f59e0b]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="12" cy="12" r="9" />
                <circle
                  cx="12"
                  cy="12"
                  r="2.5"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              Select a layer and press <strong>Scan</strong> to detect pole IDs.
            </p>
          </div>
        )}

        {status === "processing" && tags.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <svg
              className="w-8 h-8 text-[#f59e0b] animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <p className="text-xs text-muted">Scanning + running OCR…</p>
          </div>
        )}

        {status === "done" && sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <p className="text-xs text-muted">
              {search
                ? "No poles match your search."
                : "No pole labels found on this layer."}
            </p>
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-[10px] text-[#f59e0b] hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        )}

        {/* Pole rows */}
        {sorted.map((tag) => {
          const isSelected = tag.pole_id === selectedId;
          const badge = confBadge(tag.ocr_conf ?? null);
          const isReview = tag.needs_review === true;
          const isEditing = editId === tag.pole_id;

          return (
            <div
              key={tag.pole_id}
              className={`border-b border-border/50 transition-colors
                                ${
                                  isSelected
                                    ? "bg-[#fef3c7] border-l-2 border-l-[#f59e0b]"
                                    : isReview
                                      ? "bg-[#fff7ed] border-l-2 border-l-[#fbbf24]/40"
                                      : "hover:bg-surface-2"
                                }`}
            >
              {/* ── Row summary ── */}
              <div
                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer"
                onClick={() => onSelectTag(isSelected ? null : tag.pole_id)}
              >
                {/* Dot */}
                <div
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0
                                    ${isSelected ? "bg-[#d97706]" : isReview ? "bg-[#f97316]" : "bg-[#f59e0b]"}`}
                />

                {/* Name / edit input */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      ref={editRef}
                      type="text"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commitEdit(tag.pole_id);
                        if (e.key === "Escape") setEditId(null);
                      }}
                      onBlur={() => commitEdit(tag.pole_id)}
                      className="w-full font-mono text-xs font-semibold bg-white border border-[#f59e0b]
                                                rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
                    />
                  ) : (
                    <p
                      className={`font-mono text-xs font-semibold truncate ${isReview ? "text-[#92400e]" : ""}`}
                    >
                      {tag.name || `POLE_${tag.pole_id}`}
                    </p>
                  )}
                  <p className="text-[9px] text-muted-2 font-mono">
                    ({tag.cx.toFixed(2)}, {tag.cy.toFixed(2)})
                  </p>
                </div>

                {/* Badges + edit trigger */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {badge && (
                    <span
                      className={`text-[9px] px-1 py-0.5 rounded font-semibold ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  )}
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-semibold
                                        ${
                                          tag.source === "text" ||
                                          tag.source === "mtext"
                                            ? "bg-[#dbeafe] text-[#1d4ed8]"
                                            : "bg-[#f3e8ff] text-[#6b21a8]"
                                        }`}
                  >
                    {tag.source === "text"
                      ? "TXT"
                      : tag.source === "mtext"
                        ? "MTXT"
                        : "STR"}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Edit pole name"
                    onClick={(e) => startEdit(tag, e)}
                    onKeyDown={(e) => e.key === "Enter" && startEdit(tag, e)}
                    className="text-[9px] text-muted hover:text-[#f59e0b] transition-colors cursor-pointer select-none ml-0.5"
                  >
                    ✏
                  </span>
                </div>
              </div>

              {/* ── Expanded: crop image + inline rename ── */}
              {isSelected && (
                <div className="px-3 pb-3 flex flex-col gap-2">
                  {/* OCR crop image */}
                  {tag.crop_b64 ? (
                    <div className="rounded-lg overflow-hidden border border-border bg-white">
                      <img
                        src={`data:image/png;base64,${tag.crop_b64}`}
                        alt="pole name crop"
                        className="w-full object-contain"
                        style={{ imageRendering: "auto", maxHeight: "160px" }}
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-surface-2 flex items-center justify-center h-16">
                      <p className="text-[10px] text-muted italic">
                        {tag.source === "stroke"
                          ? "No crop available"
                          : tag.name}
                      </p>
                    </div>
                  )}

                  {/* Confidence + review warning */}
                  {tag.ocr_conf !== null && tag.ocr_conf !== undefined && (
                    <div className="flex items-center gap-2">
                      {(() => {
                        const b = confBadge(tag.ocr_conf!);
                        return b ? (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${b.cls}`}
                          >
                            {b.label} confidence
                          </span>
                        ) : null;
                      })()}
                      {tag.needs_review && (
                        <span className="text-[9px] text-[#b91c1c] font-semibold">
                          ⚠ Needs review
                        </span>
                      )}
                    </div>
                  )}

                  {/* Inline rename */}
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      key={tag.pole_id}
                      defaultValue={tag.name}
                      id={`inline-rename-${tag.pole_id}`}
                      placeholder="Type correct name…"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          const v = (e.target as HTMLInputElement).value
                            .trim()
                            .toUpperCase();
                          if (v) onRenamePole(tag.pole_id, v);
                        }
                      }}
                      className="flex-1 font-mono text-xs border border-border rounded-lg px-2 py-1.5
                                                focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/40 bg-white min-w-0"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const input = document.getElementById(
                          `inline-rename-${tag.pole_id}`,
                        ) as HTMLInputElement;
                        const v = input?.value.trim().toUpperCase();
                        if (v) onRenamePole(tag.pole_id, v);
                      }}
                      className="px-2.5 py-1.5 bg-[#f59e0b] hover:bg-[#d97706] text-white text-xs
                                                font-semibold rounded-lg transition-colors flex-shrink-0"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      {tags.length > 0 && (
        <div className="px-3 py-2 border-t border-border text-[10px] text-muted flex-shrink-0 flex justify-between">
          <span>
            {sorted.length} / {tags.length} poles
          </span>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-[#f59e0b] hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
