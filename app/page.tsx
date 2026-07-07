"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { CableSpanExport, DigitResult, EquipmentShape, PoleTag, Segment, Step } from "./types";
import { usePipeline } from "./hooks/usePipeline";
import { useSessionCache } from "./hooks/useSessionCache";
import { useDatabase } from "./hooks/useDatabase";
import { useAutoSave } from "./hooks/useAutoSave";
import { supabase } from "./lib/supabase";
import type { SessionSummary, FullSession, Pole as DbPole, EquipmentShape as DbEquipmentShape } from "./lib/supabase";
import Header from "./components/Header";
import LoadScreen from "./components/LoadScreen";
import ProcessingScreen from "./components/ProcessingScreen";
import ReviewLayout from "./components/ReviewLayout";
import DxfViewer from "./components/dxf/DxfViewer";
import EquipmentLayout from "./components/equipment/EquipmentLayout";
import PoleLayout from "./components/poles/Polelayout";
import AsbuiltExportModal from "./components/AsbuiltExportModal";
import SessionRestoreDialog from "./components/SessionRestoreDialog";

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
  const [restoredDxfSegments, setRestoredDxfSegments] = useState<Record<string, { x1: number; y1: number; x2: number; y2: number }[]> | null>(null);
  const [restoredCableSpans, setRestoredCableSpans] = useState<any[] | null>(null);

  const pdfExportRef = useRef<(() => void) | null>(null);
  const verificationExportRef = useRef<(() => void) | null>(null);
  const autoZeroOcrRef = useRef<((results: DigitResult[]) => DigitResult[]) | null>(null);
  const resultsRef = useRef<DigitResult[]>([]);
  useEffect(() => { resultsRef.current = results; }, [results]);

  const pipeline = usePipeline();
  const { getCache, setCache } = useSessionCache();
  const db = useDatabase();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // keep useAutoSave wired for the interval-based fallback only
  useAutoSave({ sessionId });

  // Restore-from-Supabase dialog state
  const [restoreSummary, setRestoreSummary] = useState<SessionSummary | null>(null);
  const [pendingOpts, setPendingOpts] = useState<{
    dxfPath: string;
    layers: string[];
    allLayers: string[];
  } | null>(null);

  // Keep ref in sync so async save callbacks always read the latest sessionId
  // without needing to be in a useCallback dep array.
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const resolveSessionId = useCallback(async (path: string) => {
    if (!db) return;
    try {
      const existing = await db.checkForExistingSession(path);
      if (existing) {
        console.log("[session] reusing existing session:", existing.session.id);
        sessionIdRef.current = existing.session.id;
        setSessionId(existing.session.id);
      } else {
        const { session } = await db.getOrCreateSessionForFile(path);
        console.log("[session] created new session:", session.id);
        sessionIdRef.current = session.id;
        setSessionId(session.id);
      }
    } catch (e) {
      console.warn("[session] could not resolve session:", e);
    }
  }, [db]);

  const handleCacheUpdate = useCallback(
    (path: string, data: any) => {
      setCache(path, data);
      if (data.boundary !== undefined) {
        setGlobalBoundary(data.boundary);
      }
      // Direct persist — use ref so we always see the current sessionId
      // without depending on closure capture timing.
      const sid = sessionIdRef.current;
      console.log("[cache-update] sid=", sid, "poleTags=", data.poleTags?.length ?? 0, "shapes=", data.shapes?.length ?? 0);
      if (!sid || !db) {
        console.warn("[cache-update] skipping save — no sessionId or db");
        return;
      }

      setSaveStatus("saving");
      setSaveError(null);

      const saves: Promise<unknown>[] = [];

      if (data.poleTags && data.poleTags.length > 0) {
        const dbPoles: DbPole[] = (data.poleTags as PoleTag[]).map((p) => ({
          id: "",
          session_id: sid,
          pole_id: p.pole_id,
          name: p.name,
          corrected_name: null,
          cx: p.cx,
          cy: p.cy,
          bbox: p.bbox,
          layer: p.layer,
          source: p.source,
          ocr_conf: p.ocr_conf ?? null,
          needs_review: p.needs_review ?? false,
        }));
        saves.push(db.savePoles(sid, dbPoles));
      }

      if (data.shapes && data.shapes.length > 0) {
        const dbShapes: DbEquipmentShape[] = (data.shapes as EquipmentShape[]).map((s, idx) => ({
          id: "",
          session_id: sid,
          shape_id: s.shape_id ?? idx,
          kind: s.kind,
          layer: s.layer,
          cx: s.cx,
          cy: s.cy,
          bbox: s.bbox,
        }));
        saves.push(db.saveEquipmentShapes(sid, dbShapes));
      }

      if (data.boundary && data.boundary.length > 0) {
        saves.push(db.saveBoundary(sid, data.boundary));
      }

      if (saves.length > 0) {
        Promise.all(saves)
          .then(() => setSaveStatus("saved"))
          .catch((e) => {
            console.error("[save]", e);
            setSaveStatus("error");
            setSaveError(e instanceof Error ? e.message : "Save failed");
          });
      } else {
        setSaveStatus("idle");
      }
    },
    [setCache, db],
  );

  const handleStartProcessing = useCallback(
    async (opts: {
      dxfPath: string;
      layers: string[];
      allLayers: string[];
    }) => {
      const cached = getCache(opts.dxfPath);

      setDxfPath(opts.dxfPath);
      setLayers(opts.allLayers);

      // 1. Fast path: local session cache
      if (cached && cached.results.length > 0) {
        setResults(cached.results);
        setSegments(cached.segments);
        if (cached.boundary) setGlobalBoundary(cached.boundary);
        resolveSessionId(opts.dxfPath);
        setStep(3);
        return;
      }

      // 2. Durable path: check Supabase for a saved session
      if (supabase && db) {
        try {
          const summary = await db.getSessionSummary(opts.dxfPath);
          const hasSavedData = summary && (
            summary.counts.digit_results > 0 ||
            summary.counts.poles > 0 ||
            summary.counts.equipment_shapes > 0 ||
            summary.counts.cable_spans > 0
          );
          if (hasSavedData) {
            sessionIdRef.current = summary!.session.id;
            setSessionId(summary!.session.id);
            setPendingOpts(opts);
            setRestoreSummary(summary!);
            return;
          }
        } catch {
          // Supabase unavailable or no session — fall through to pipeline
        }
      }

      resolveSessionId(opts.dxfPath);
      setStep(2);
      await pipeline.run(opts);
    },
    [pipeline, getCache, db, resolveSessionId],
  );

  const handleRestoreLoad = useCallback(async () => {
    if (!restoreSummary || !pendingOpts || !db) return;
    setRestoreSummary(null);

    try {
      const full: FullSession = await db.loadSession(restoreSummary.session.id);
      console.log("[restore] session:", restoreSummary.session.id, "poles:", full.poles.length, "equipment:", full.equipment_shapes.length, "digits:", full.digit_results.length);

      // Map Supabase DigitResult → app DigitResult
      const results: DigitResult[] = full.digit_results.map((r) => ({
        digit_id: r.digit_id,
        value: r.value ?? "?",
        corrected_value: r.corrected_value,
        confidence: r.confidence ?? 0,
        needs_review: r.needs_review,
        bbox: (r.bbox ?? [0, 0, 0, 0]) as [number, number, number, number],
        center_x: r.center_x ?? 0,
        center_y: r.center_y ?? 0,
        crop_b64: null,
        manual: r.manual,
      }));

      // Pick segments for the strand layer (for ReviewLayout)
      const strandLayer = full.config?.strand_layer;
      const segments: Segment[] = strandLayer && full.dxf_segments[strandLayer]
        ? full.dxf_segments[strandLayer]
        : Object.values(full.dxf_segments)[0] ?? [];

      // Map Supabase Pole → PoleTag
      const poleTags: PoleTag[] = full.poles.map((p) => ({
        pole_id: p.pole_id,
        name: p.corrected_name ?? p.name ?? "UNKNOWN",
        cx: p.cx ?? 0,
        cy: p.cy ?? 0,
        bbox: (p.bbox ?? [0, 0, 0, 0]) as [number, number, number, number],
        layer: p.layer ?? "",
        source: p.source ?? "text",
        crop_b64: null,
        ocr_conf: p.ocr_conf,
        needs_review: p.needs_review,
      }));

      // Map Supabase EquipmentShape → app EquipmentShape
      const shapes: EquipmentShape[] = full.equipment_shapes.map((e) => ({
        shape_id: e.shape_id,
        kind: e.kind as EquipmentShape["kind"],
        bbox: (e.bbox ?? [0, 0, 0, 0]) as [number, number, number, number],
        cx: e.cx,
        cy: e.cy,
        layer: e.layer,
      }));

      // Map Supabase CableSpan → DxfViewer CableSpan format
      const restoredSpans = full.cable_spans.map((s) => ({
        span_id: s.span_id,
        layer: s.layer ?? "",
        bbox: (s.bbox ?? [0, 0, 0, 0]) as [number, number, number, number],
        cx: s.cx ?? 0,
        cy: s.cy ?? 0,
        segment_count: s.segments?.length ?? 0,
        total_length: s.total_length ?? 0,
        meterValue: s.meter_value,
        cable_runs: s.cable_runs ?? 1,
        segments: (s.segments ?? []).map((seg) => ({
          x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
        })),
        from_pole: s.from_pole ?? undefined,
        to_pole: s.to_pole ?? undefined,
      }));

      if (full.boundary) setGlobalBoundary(full.boundary);

      // Always seed cache with saved poles/equipment/boundary so tabs have
      // them even if we need to run the OCR pipeline for fresh digits.
      setCache(pendingOpts.dxfPath, {
        poleTags,
        poleLayer: full.config?.pole_layer ?? null,
        poleLayers: full.config?.pole_layer ? [full.config.pole_layer] : [],
        poleDone: full.poles.length > 0,
        shapes,
        boundary: full.boundary ?? null,
        equipmentDone: full.equipment_shapes.length > 0,
      });

      sessionIdRef.current = restoreSummary.session.id;
      setSessionId(restoreSummary.session.id);

      // If no saved OCR digits, run the pipeline so the Review tab has data.
      // Poles/equipment are already in cache and will appear after step 3.
      if (full.digit_results.length === 0) {
        console.log("[restore] no saved digits — running OCR pipeline with pre-loaded poles");
        setStep(2);
        await pipeline.run(pendingOpts);
        return;
      }

      // Full restore: everything came from DB.
      setCache(pendingOpts.dxfPath, { results, segments });
      console.log("[restore] cache written — poleDone:", full.poles.length > 0, "path:", pendingOpts.dxfPath, "dxfPath state:", dxfPath);
      setRestoredDxfSegments(full.dxf_segments);
      setRestoredCableSpans(restoredSpans);
      setResults(results);
      setSegments(segments);
      setStep(3);
    } catch (err) {
      console.error("[restore] failed to load session:", err);
      setStep(2);
      await pipeline.run(pendingOpts);
    } finally {
      setPendingOpts(null);
    }
  }, [restoreSummary, pendingOpts, db, pipeline, setCache]);

  const handleRestoreRescan = useCallback(async () => {
    if (!pendingOpts) return;
    const opts = pendingOpts;
    setRestoreSummary(null);
    setPendingOpts(null);
    setStep(2);
    await pipeline.run(opts);
  }, [pendingOpts, pipeline]);

  const handleRestoreCancel = useCallback(() => {
    setRestoreSummary(null);
    setPendingOpts(null);
  }, []);

  const handleAutoZeroOcr = useCallback(() => {
    if (autoZeroOcrRef.current) {
      const updated = autoZeroOcrRef.current(resultsRef.current);
      setResults(updated);
    }
  }, []);

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
    setRestoredDxfSegments(null);
    setRestoredCableSpans(null);
    sessionIdRef.current = null;
    setSessionId(null);
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

      {restoreSummary && (
        <SessionRestoreDialog
          summary={restoreSummary}
          onLoadSaved={handleRestoreLoad}
          onRescanFresh={handleRestoreRescan}
          onCancel={handleRestoreCancel}
        />
      )}

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

            <div className="flex items-center gap-4 mb-2">
              {sessionId && saveStatus !== "idle" && (
                <div
                  className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    saveStatus === "saving"
                      ? "bg-amber-50 text-amber-600"
                      : saveStatus === "saved"
                        ? "bg-green-50 text-green-600"
                        : "bg-red-50 text-red-600"
                  }`}
                  title={saveStatus === "error" ? (saveError ?? "Save failed") : undefined}
                >
                  {saveStatus === "saving" && (
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved" : "⚠ Save failed"}
                </div>
              )}
              {globalBoundary && (
                <div className="flex items-center gap-2">
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
                onAutoZeroOcr={handleAutoZeroOcr}
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
                initialSegments={restoredDxfSegments ?? undefined}
                initialCableSpans={restoredCableSpans ?? undefined}
                onInitialDataConsumed={() => {
                  setRestoredDxfSegments(null);
                  setRestoredCableSpans(null);
                }}
                autoZeroOcrRef={autoZeroOcrRef}
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
