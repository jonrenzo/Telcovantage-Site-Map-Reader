"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { CableSpanExport, DigitResult, Segment, Step } from "./types";
import { usePipeline } from "./hooks/usePipeline";
import { useSessionCache } from "./hooks/useSessionCache";
import Header from "./components/Header";
import LoadScreen from "./components/LoadScreen";
import ProcessingScreen from "./components/ProcessingScreen";
import ReviewLayout from "./components/ReviewLayout";
import DxfViewer from "./components/dxf/DxfViewer";
import EquipmentLayout from "./components/equipment/EquipmentLayout";
import PoleLayout from "./components/poles/Polelayout";
import AsbuiltExportModal from "./components/AsbuiltExportModal";

interface BoundaryPoint {
  x: number;
  y: number;
}

export function isPointInPolygon(
  px: number,
  py: number,
  polygon: BoundaryPoint[] | null,
): boolean {
  if (!polygon || polygon.length < 3) return true;

  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;

    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) isInside = !isInside;
  }
  return isInside;
}

type MapTab = "review" | "dxf" | "equipment" | "pole";
export type ExportType = "all" | "ocr" | "equipment" | "poles" | "pdf" | "polemaster" | "asbuilt" | "verification";

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [dxfPath, setDxfPath] = useState<string>("");
  const [layers, setLayers] = useState<string[]>([]);
  const [results, setResults] = useState<DigitResult[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [mapTab, setMapTab] = useState<MapTab>("review");
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [showAsbuiltModal, setShowAsbuiltModal] = useState(false);

  const [globalBoundary, setGlobalBoundary] = useState<BoundaryPoint[] | null>(
    null,
  );
  const [isMaskEnabled, setIsMaskEnabled] = useState<boolean>(true);
  const [cableSpans, setCableSpans] = useState<CableSpanExport[]>([]);

  const pdfExportRef = useRef<(() => void) | null>(null);
  const verificationExportRef = useRef<(() => void) | null>(null);

  const pipeline = usePipeline();
  const { getCache, setCache } = useSessionCache();

  const handleCacheUpdate = useCallback(
    (path: string, data: any) => {
      setCache(path, data);
      if (data.boundary !== undefined) {
        setGlobalBoundary(data.boundary);
      }
    },
    [setCache],
  );

  const handleStartProcessing = useCallback(
    // --- CHANGED: Expecting 'layers: string[]' instead of 'layer: string' ---
    async (opts: {
      dxfPath: string;
      layers: string[];
      allLayers: string[];
    }) => {
      const cached = getCache(opts.dxfPath);

      setDxfPath(opts.dxfPath);
      setLayers(opts.allLayers);

      if (cached && cached.results.length > 0) {
        setResults(cached.results);
        setSegments(cached.segments);

        if (cached.boundary) {
          setGlobalBoundary(cached.boundary);
        }

        setStep(3);
        return;
      }

      setStep(2);
      await pipeline.run(opts);
    },
    [pipeline, getCache],
  );

  useEffect(() => {
    if (
      step === 2 &&
      pipeline.status === "done" &&
      pipeline.results.length > 0
    ) {
      setResults(pipeline.results);
      setSegments(pipeline.segments);

      if (dxfPath) {
        setCache(dxfPath, {
          results: pipeline.results,
          segments: pipeline.segments,
        });
      }

      setStep(3);
    } else if (step === 2 && pipeline.status === "error") {
      pipeline.reset();
      setStep(1);
    }
  }, [
    step,
    pipeline.status,
    pipeline.results,
    pipeline.segments,
    pipeline,
    dxfPath,
    setCache,
  ]);

  useEffect(() => {
    if (step === 3 && dxfPath && results.length > 0) {
      setCache(dxfPath, { results });
    }
  }, [results, step, dxfPath, setCache]);

  const handleExport = useCallback(
    async (type: ExportType) => {
      if (exporting) return;

      if (type === "asbuilt") {
        setShowAsbuiltModal(true);
        return;
      }

      setExporting(type);

      try {
        if (type === "pdf") {
          pdfExportRef.current?.();
          setExporting(null);
          return;
        }

        if (type === "verification") {
          verificationExportRef.current?.();
          setExporting(null);
          return;
        }

        const corrections: Record<number, string | null> = {};

        const activeResults =
          isMaskEnabled && globalBoundary
            ? results.filter((r) =>
                isPointInPolygon(r.center_x, r.center_y, globalBoundary),
              )
            : results;

        activeResults.forEach((r) => {
          corrections[r.digit_id] = r.corrected_value;
        });

        let endpoint = "";
        let body: Record<string, unknown> = {};

        switch (type) {
          case "all":
            // Use cable spans from state (includes pole connections from DxfViewer)
            endpoint = "/api/export/all";
            body = { corrections, cable_spans: cableSpans };
            break;
          case "ocr":
            endpoint = "/api/export";
            body = { corrections };
            break;
          case "equipment":
            endpoint = "/api/export/equipment";
            break;
          case "poles":
            endpoint = "/api/v1/export/poles";
            body = { poles: getCache(dxfPath)?.poleTags ?? [] };
            break;
          case "polemaster":
            endpoint = "/api/export/polemaster";
            body = { corrections, cable_spans: cableSpans };
            console.log("[export] polemaster payload - total spans:", cableSpans.length);
            console.log("[export] sample (3):", cableSpans.slice(0, 3));
            {
              const nptNull = cableSpans.filter(
                (s) => (s.from_pole === "NPT" && s.from_pole_id == null) ||
                        (s.to_pole === "NPT" && s.to_pole_id == null),
              );
              if (nptNull.length) {
                console.warn(`[export] ${nptNull.length} NPT spans have null pole_id`);
              }
            }
            break;
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) {
          alert("Export failed: " + data.error);
          return;
        }
        
        // Handle polemaster response differently - it doesn't return a file
        if (type === "polemaster") {
          const result = data.result || {};
          console.log("[export] polemaster result:", result);
          if (result.error || result.success === false) {
            alert("Pole Master push failed: " + (result.error || "Unknown error"));
            return;
          }
          let message = `Pole Master Push Complete!\n\n` +
            `Node ID: ${result.node_id || 'N/A'}\n` +
            `Poles Created: ${result.poles_created || 0}`;
          
          if (result.poles_failed > 0) {
            message += ` (${result.poles_failed} failed)`;
          }
          
          message += `\nSpans Created: ${result.spans_created || 0}`;
          
          if (result.spans_failed > 0) {
            message += `\nSpans Failed: ${result.spans_failed}`;
          }
          if (result.spans_skipped_same_pole > 0) {
            message += `\nSpans Skipped (same pole): ${result.spans_skipped_same_pole}`;
          }
          if (result.spans_skipped_no_poles > 0) {
            message += `\nSpans Skipped (no pole connections): ${result.spans_skipped_no_poles}`;
          }
          if (result.spans_skipped_unresolved > 0) {
            message += `\nSpans Skipped (unresolved pole id/name): ${result.spans_skipped_unresolved}`;
          }
          if (result.duplicate_pole_names?.NPT) {
            message += `\nNPT instances in export: ${result.duplicate_pole_names.NPT}`;
          }
          if (result.failed_spans?.length > 0) {
            message += `\n\nFirst ${result.failed_spans.length} failed spans:`;
            result.failed_spans.forEach((f: { code: string; error: string }) => {
              message += `\n- ${f.code}: ${f.error}`;
            });
          }
          
          alert(message);
          return;
        }
        
        window.location.href =
          "/api/download?file=" + encodeURIComponent(data.path);
      } finally {
        setExporting(null);
      }
    },
    [exporting, results, isMaskEnabled, globalBoundary, cableSpans, dxfPath, getCache],
  );

  const handleSpansChange = useCallback((spans: CableSpanExport[]) => {
    setCableSpans(spans);
  }, []);

  const handleStartOver = useCallback(() => {
    pipeline.reset();
    setStep(1);
    setDxfPath("");
    setLayers([]);
    setResults([]);
    setSegments([]);
    setMapTab("review");
    setExporting(null);
    setGlobalBoundary(null);
    setIsMaskEnabled(true);
    setCableSpans([]);
  }, [pipeline]);

  const TABS = [
    { key: "review", label: "OCR Review", icon: "🔍" },
    { key: "dxf", label: "DXF Viewer", icon: "🗺️" },
    { key: "equipment", label: "Equipment", icon: "⚙️" },
    { key: "pole", label: "Pole IDs", icon: "🔵" },
  ] as const;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        step={step}
        onBack={step === 3 ? handleStartOver : undefined}
        exporting={exporting}
        onExport={handleExport}
      />

      {step === 1 && <LoadScreen onStartProcessing={handleStartProcessing} />}

      {step === 2 && (
        <ProcessingScreen
          progress={pipeline.progress}
          total={pipeline.total}
          status={pipeline.status}
          step={pipeline.step}
          stepLabel={pipeline.stepLabel}
        />
      )}

      {step === 3 && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-2 bg-surface border-b border-border flex-shrink-0">
            <div className="flex items-center gap-1">
              {TABS.map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setMapTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition-all
                          ${
                            mapTab === key
                              ? "text-accent border-accent bg-accent-light"
                              : "text-muted border-transparent hover:text-[#1e293b] hover:bg-surface-2"
                          }`}
                >
                  <span>{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {globalBoundary && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-muted">
                  Boundary Mask:
                </span>
                <button
                  onClick={() => setIsMaskEnabled(!isMaskEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 ${
                    isMaskEnabled ? "bg-green-500" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      isMaskEnabled ? "translate-x-4.5" : "translate-x-1"
                    }`}
                  />
                </button>
                <span className="text-[10px] font-mono text-muted w-8">
                  {isMaskEnabled ? "ON" : "OFF"}
                </span>
              </div>
            )}
          </div>

          <div className="flex-1 flex overflow-hidden">
            <div
              className={`flex-1 flex overflow-hidden ${mapTab === "review" ? "" : "hidden"}`}
            >
              <ReviewLayout
                dxfPath={dxfPath}
                results={results}
                setResults={setResults}
                segments={segments}
                boundary={globalBoundary}
                isMaskEnabled={isMaskEnabled}
              />
            </div>

            <div
              className={`flex-1 flex overflow-hidden ${mapTab === "dxf" ? "" : "hidden"}`}
            >
              <DxfViewer
                dxfPath={dxfPath}
                ocrResults={results}
                isActive={mapTab === "dxf"}
                onExportPdfRef={pdfExportRef}
                onExportVerificationRef={verificationExportRef}
                boundary={globalBoundary}
                isMaskEnabled={isMaskEnabled}
                onSpansChange={handleSpansChange}
                onCacheUpdate={(data) => handleCacheUpdate(dxfPath, data)}
              />
            </div>

            <div
              className={`flex-1 flex overflow-hidden ${mapTab === "equipment" ? "" : "hidden"}`}
            >
              <EquipmentLayout
                dxfPath={dxfPath}
                layers={layers}
                segments={segments}
                cachedData={getCache(dxfPath)}
                onCacheUpdate={(data) => handleCacheUpdate(dxfPath, data)}
                isActive={mapTab === "equipment"}
                boundary={globalBoundary}
                isMaskEnabled={isMaskEnabled}
              />
            </div>

            <div
              className={`flex-1 flex overflow-hidden ${mapTab === "pole" ? "" : "hidden"}`}
            >
              <PoleLayout
                dxfPath={dxfPath}
                allLayers={layers}
                layerSegments={{ all: segments }}
                cachedData={getCache(dxfPath)}
                onCacheUpdate={(data) => handleCacheUpdate(dxfPath, data)}
                isActive={mapTab === "pole"}
                boundary={globalBoundary}
                isMaskEnabled={isMaskEnabled}
              />
            </div>

          </div>
        </div>
      )}
      {showAsbuiltModal && (
        <AsbuiltExportModal
          cableSpans={cableSpans}
          poleTags={getCache(dxfPath)?.poleTags ?? []}
          equipmentShapes={getCache(dxfPath)?.shapes ?? []}
          dxfPath={dxfPath}
          onClose={() => setShowAsbuiltModal(false)}
        />
      )}
    </div>
  );
}
