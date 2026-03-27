import { useState, useRef, useEffect } from "react";
import type { ExportType } from "../page";

const STEPS = ["Load Plan", "Reading", "Review"];

interface Props {
  step: number;
  onBack?: () => void;
  exporting: ExportType | null;
  onExport: (type: ExportType) => void;
}

export default function Header({ step, onBack, exporting, onExport }: Props) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    if (showExportMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  const exportOptions: { type: ExportType; label: string; desc: string }[] = [
    { type: "all", label: "Full Report", desc: "All data in one file" },
    { type: "ocr", label: "Digit Results", desc: "OCR only" },
    { type: "equipment", label: "Equipment", desc: "Shapes only" },
    { type: "poles", label: "Pole IDs", desc: "Poles only" },
    { type: "pdf", label: "DXF Drawing", desc: "PDF of the drawing" },
    { type: "polemaster", label: "Pole Master", desc: "Push to Planner API" },
  ];

  const isExporting = exporting !== null;

  return (
    <header className="bg-surface border-b border-border px-6 h-14 flex items-center gap-4 flex-shrink-0 shadow-sm">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-[#1e293b]
            px-2.5 py-1.5 rounded-lg hover:bg-surface-2 transition-colors border border-transparent
            hover:border-border flex-shrink-0"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back
        </button>
      )}

      <div className="flex items-center gap-2 text-accent text-[0.95rem] font-black font-family-sans">
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6M9 12h6M9 15h4" />
        </svg>
        AsBuiltIQ
      </div>

      <div className="flex-1" />

      <nav className="flex items-center">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <div key={n} className="flex items-center">
              <div className="flex items-center gap-2 px-3">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all duration-300
                    ${
                      done
                        ? "bg-ok border-ok text-white"
                        : active
                          ? "bg-accent border-accent text-white"
                          : "bg-surface border-border text-muted"
                    }`}
                >
                  {done ? "✓" : n}
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap transition-colors font-family-sans
                    ${
                      done
                        ? "text-ok"
                        : active
                          ? "text-accent font-semibold"
                          : "text-muted"
                    }`}
                >
                  {label}
                </span>
              </div>
              {n < STEPS.length && (
                <div
                  className={`w-8 h-0.5 transition-colors duration-300 ${
                    done ? "bg-ok" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* Export dropdown */}
      {step === 3 && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={isExporting}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border
                       bg-surface hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? (
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
                Export
                <svg
                  className={`w-3 h-3 transition-transform ${showExportMenu ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </>
            )}
          </button>

          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-border rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-surface-2">
                <p className="text-[10px] text-muted uppercase tracking-wider font-semibold">Export Options</p>
              </div>
              {exportOptions.map((opt) => (
                <button
                  key={opt.type}
                  onClick={() => {
                    onExport(opt.type);
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2.5 text-left hover:bg-surface-2 transition-colors flex items-start gap-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#1e293b]">{opt.label}</p>
                    <p className="text-[10px] text-muted">{opt.desc}</p>
                  </div>
                  {exporting === opt.type && (
                    <svg
                      className="w-3.5 h-3.5 animate-spin text-accent flex-shrink-0 mt-0.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
