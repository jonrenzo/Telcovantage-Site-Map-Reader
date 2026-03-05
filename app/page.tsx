"use client";

import { useState, useCallback } from "react";
import type { DigitResult, Segment, Step } from "./types";
import { usePipeline } from "./hooks/usePipeline";
import Header from "./components/Header";
import LoadScreen from "./components/LoadScreen";
import ProcessingScreen from "./components/ProcessingScreen";
import ReviewLayout from "./components/ReviewLayout";
import ExportDone from "./components/ExportDone";

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [dxfPath, setDxfPath] = useState<string>("");
  const [results, setResults] = useState<DigitResult[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);

  const pipeline = usePipeline();

  const handleStartProcessing = useCallback(
      async (opts: { dxfPath: string; layer: string }) => {
        setDxfPath(opts.dxfPath);
        setStep(2);
        await pipeline.run(opts);
      },
      [pipeline]
  );

  // Transition from step 2 → 3 once pipeline is done
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
            <ReviewLayout
                dxfPath={dxfPath}
                results={results}
                setResults={setResults}
                segments={segments}
                onExportDone={() => setStep(4)}
            />
        )}

        {step === 4 && <ExportDone onStartOver={handleStartOver} />}
      </div>
  );
}