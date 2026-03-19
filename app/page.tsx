"use client";

import { useState, useCallback, useEffect } from "react";
import type { DigitResult, Segment, Step } from "./types";
import { usePipeline } from "./hooks/usePipeline";
import { useSessionCache } from "./hooks/useSessionCache";
import Header from "./components/Header";
import LoadScreen from "./components/LoadScreen";
import ProcessingScreen from "./components/ProcessingScreen";
import ReviewLayout from "./components/ReviewLayout";
import DxfViewer from "./components/dxf/DxfViewer";
import EquipmentLayout from "./components/equipment/EquipmentLayout";
import PoleLayout from "./components/poles/Polelayout";

type MapTab = "review" | "dxf" | "equipment" | "pole";

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [dxfPath, setDxfPath] = useState<string>("");
  const [layers, setLayers] = useState<string[]>([]);
  const [results, setResults] = useState<DigitResult[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [mapTab, setMapTab] = useState<MapTab>("review");

  const pipeline = usePipeline();
  const { getCache, setCache } = useSessionCache();

  const handleStartProcessing = useCallback(
    async (opts: { dxfPath: string; layer: string; allLayers: string[] }) => {
      const cached = getCache(opts.dxfPath);

      setDxfPath(opts.dxfPath);
      setLayers(opts.allLayers);

      if (cached && cached.results.length > 0) {
        // ── Restore from cache — skip the OCR pipeline entirely ──────────────
        setResults(cached.results);
        setSegments(cached.segments);
        setStep(3);
        return;
      }

      // ── Fresh file — run the full pipeline ───────────────────────────────
      setStep(2);
      await pipeline.run(opts);
    },
    [pipeline, getCache],
  );

  // When the pipeline finishes, save results to cache and advance to step 3
  useEffect(() => {
    if (
      step === 2 &&
      pipeline.status === "done" &&
      pipeline.results.length > 0
    ) {
      setResults(pipeline.results);
      setSegments(pipeline.segments);

      // Persist OCR results so re-opening this file skips re-processing
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

  // Keep cache up to date whenever the user edits OCR results
  useEffect(() => {
    if (step === 3 && dxfPath && results.length > 0) {
      setCache(dxfPath, { results });
    }
  }, [results, step, dxfPath, setCache]);

  const handleStartOver = useCallback(() => {
    // Do NOT wipe the cache — that's the whole point
    pipeline.reset();
    setStep(1);
    setDxfPath("");
    setLayers([]);
    setResults([]);
    setSegments([]);
    setMapTab("review");
  }, [pipeline]);

  const TABS = [
    { key: "review", label: "OCR Review", icon: "🔍" },
    { key: "dxf", label: "DXF Viewer", icon: "🗺️" },
    { key: "equipment", label: "Equipment", icon: "⚙️" },
    { key: "pole", label: "Pole IDs", icon: "🔵" },
  ] as const;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header step={step} onBack={step === 3 ? handleStartOver : undefined} />

      {step === 1 && <LoadScreen onStartProcessing={handleStartProcessing} />}

      {step === 2 && (
        <ProcessingScreen
          progress={pipeline.progress}
          total={pipeline.total}
          status={pipeline.status}
        />
      )}

      {step === 3 && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 pt-2 bg-surface border-b border-border flex-shrink-0">
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

          {/* Tab content */}
          <div className="flex-1 flex overflow-hidden">
            <div
              className={`flex-1 flex overflow-hidden ${mapTab === "review" ? "" : "hidden"}`}
            >
              <ReviewLayout
                dxfPath={dxfPath}
                results={results}
                setResults={setResults}
                segments={segments}
              />
            </div>
            <div
              className={`flex-1 flex overflow-hidden ${mapTab === "dxf" ? "" : "hidden"}`}
            >
              <DxfViewer
                dxfPath={dxfPath}
                ocrResults={results}
                isActive={mapTab === "dxf"}
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
                onCacheUpdate={(data) => setCache(dxfPath, data)}
                isActive={mapTab === "equipment"}
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
                onCacheUpdate={(data) => setCache(dxfPath, data)}
                isActive={mapTab === "pole"}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
