"use client";

import { useState, useCallback } from "react";
import type { DigitResult, Segment, Step } from "./types";
import { usePipeline } from "./hooks/usePipeline";
import Header from "./components/Header";
import LoadScreen from "./components/LoadScreen";
import ProcessingScreen from "./components/ProcessingScreen";
import ReviewLayout from "./components/ReviewLayout";
import ExportDone from "./components/ExportDone";
import DxfViewer from "./components/dxf/DxfViewer";

type MapTab = "review" | "dxf";

export default function Home() {
  const [step,     setStep]     = useState<Step>(1);
  const [dxfPath,  setDxfPath]  = useState<string>("");
  const [results,  setResults]  = useState<DigitResult[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [mapTab,   setMapTab]   = useState<MapTab>("review");

  const pipeline = usePipeline();

  const handleStartProcessing = useCallback(
      async (opts: { dxfPath: string; layer: string }) => {
        setDxfPath(opts.dxfPath);
        setStep(2);
        await pipeline.run(opts);
      },
      [pipeline]
  );

  if (step === 2 && pipeline.status === "done" && pipeline.results.length > 0) {
    setResults(pipeline.results);
    setSegments(pipeline.segments);
    setStep(3);
  }

  if (step === 2 && pipeline.status === "error") {
    pipeline.reset();
    setStep(1);
  }

  const handleStartOver = useCallback(() => {
    pipeline.reset();
    setStep(1);
    setDxfPath("");
    setResults([]);
    setSegments([]);
    setMapTab("review");
  }, [pipeline]);

  return (
      <div className="flex flex-col h-screen overflow-hidden">
        <Header step={step} />

        {step === 1 && (
            <LoadScreen onStartProcessing={handleStartProcessing} />
        )}

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
                {([
                  { key: "review", label: "OCR Review", icon: "🔍" },
                  { key: "dxf",    label: "DXF Viewer", icon: "🗺️" },
                ] as { key: MapTab; label: string; icon: string }[]).map(({ key, label, icon }) => (
                    <button
                        key={key}
                        onClick={() => setMapTab(key)}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition-all
                  ${mapTab === key
                            ? "text-accent border-accent bg-accent-light"
                            : "text-muted border-transparent hover:text-[#1e293b] hover:bg-surface-2"}`}
                    >
                      <span>{icon}</span>
                      {label}
                    </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 flex overflow-hidden">
                <div className={`flex-1 flex overflow-hidden ${mapTab === "review" ? "" : "hidden"}`}>
                  <ReviewLayout
                      dxfPath={dxfPath}
                      results={results}
                      setResults={setResults}
                      segments={segments}
                      onExportDone={() => setStep(4)}
                  />
                </div>
                <div className={`flex-1 flex overflow-hidden ${mapTab === "dxf" ? "" : "hidden"}`}>
                  <DxfViewer dxfPath={dxfPath} />
                </div>
              </div>
            </div>
        )}

        {step === 4 && <ExportDone onStartOver={handleStartOver} />}
      </div>
  );
}