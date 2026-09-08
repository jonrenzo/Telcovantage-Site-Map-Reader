"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
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

/** Shortest distance from (px, py) to the nearest of a list of line segments. */
export function distanceToNearestSegment(
  px: number,
  py: number,
  segments: { x1: number; y1: number; x2: number; y2: number }[],
): number {
  let best = Infinity;
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - s.x1) * dx + (py - s.y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = s.x1 + t * dx;
    const cy = s.y1 + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

/** IDs (by index into `items`) whose nearest-segment distance is an outlier
 * relative to the rest — a robust, scale-independent way to flag "no wire
 * nearby" without a fixed-unit threshold (DXF files vary wildly in scale). */
export function findNoWireNearbyIndices<T>(
  items: T[],
  getXY: (item: T) => { x: number; y: number },
  segments: { x1: number; y1: number; x2: number; y2: number }[],
  outlierFactor = 6,
): Set<number> {
  const flagged = new Set<number>();
  if (!segments.length || items.length < 3) return flagged;

  const distances = items.map((item) => {
    const { x, y } = getXY(item);
    return distanceToNearestSegment(x, y, segments);
  });

  const sorted = [...distances].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return flagged;

  const threshold = median * outlierFactor;
  distances.forEach((d, i) => {
    if (d > threshold) flagged.add(i);
  });
  return flagged;
}

type MapTab = "review" | "dxf" | "equipment" | "pole";
export type ExportType = "all" | "ocr" | "equipment" | "poles" | "pdf" | "polemaster" | "asbuilt" | "verification";

export default function Home() {
  const routeParams = useParams<{ site?: string }>();
  const router = useRouter();
  const autoLoadAttemptedRef = useRef(false);

  const [step, setStep] = useState<Step>(1);
  const [dxfPath, setDxfPath] = useState<string>("");
  const [layers, setLayers] = useState<string[]>([]);
  const [results, setResults] = useState<DigitResult[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [mapTab, setMapTab] = useState<MapTab>("review");
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [showAsbuiltModal, setShowAsbuiltModal] = useState(false);
  // Set once the node reaches AsBuilt IQ; the map uses it to pull teardown
  // status back and repaint completed spans red.
  const [asbuiltNodeId, setAsbuiltNodeId] = useState<number | null>(null);

  const [globalBoundary, setGlobalBoundary] = useState<BoundaryPoint[] | null>(
    null,
  );
  const [isMaskEnabled, setIsMaskEnabled] = useState<boolean>(true);
  const [cableSpans, setCableSpans] = useState<CableSpanExport[]>([]);
  const [restoredDxfSegments, setRestoredDxfSegments] = useState<Record<string, { x1: number; y1: number; x2: number; y2: number }[]> | null>(null);
  const [restoredCableSpans, setRestoredCableSpans] = useState<any[] | null>(null);
  const [restoredPoles, setRestoredPoles] = useState<any[] | null>(null);

  const pdfExportRef = useRef<(() => void) | null>(null);
  const verificationExportRef = useRef<(() => void) | null>(null);

  const pipeline = usePipeline();
  const { getCache, setCache } = useSessionCache();
  const db = useDatabase();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const autoSave = useAutoSave({ sessionId });

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
      // Real content checksum, not the path — without this, lookups fall
      // back to path-matching alone, and once any duplicate project row
      // exists for that path, `.single()` errors on every future lookup and
      // silently creates yet another duplicate. Checksum-first breaks that
      // loop since it's the actually-unique key.
      let checksum: string | undefined;
      try {
        const csRes = await fetch(
          `/api/precompute/status?dxf_path=${encodeURIComponent(path)}`,
        );
        const csData = await csRes.json();
        checksum = csData?.checksum || undefined;
      } catch {
        // fall through to path-only matching below
      }

      const existing = await db.checkForExistingSession(path, checksum);
      if (existing) {
        console.log("[session] reusing existing session:", existing.session.id);
        sessionIdRef.current = existing.session.id;
        setSessionId(existing.session.id);
      } else {
        const { session } = await db.getOrCreateSessionForFile(path, checksum);
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

      if (data.poleTags !== undefined) {
        const currentPoleTags = data.poleTags as PoleTag[];
        // Reconcile deletes too — savePoles only upserts, so a pole removed
        // locally (via DXF Viewer or the Pole IDs list) used to linger in
        // Supabase forever. This removes anything no longer present.
        saves.push(
          db.deletePolesNotIn(
            sid,
            currentPoleTags.map((p) => p.pole_id),
          ),
        );
        if (currentPoleTags.length > 0) {
          const dbPoles: DbPole[] = currentPoleTags.map((p) => ({
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

      // Reflect the open file in the URL (e.g. /LPA115) so the address bar
      // itself shows which site is loaded — bookmarkable/shareable, and
      // typing that URL directly re-opens the same file (see the auto-load
      // effect below).
      const fileBaseName = (opts.dxfPath.split(/[\\/]/).pop() || "").replace(
        /\.dxf$/i,
        "",
      );
      if (fileBaseName) {
        router.replace(`/${encodeURIComponent(fileBaseName)}`);
      }

      // Reset before hydrating — otherwise a previously opened file's node
      // link (and its teardown/redline statuses) would keep painting over
      // whatever file is opened next.
      setAsbuiltNodeId(null);
      fetch("/api/files/list")
        .then((r) => r.json())
        .then((data) => {
          const entry = (data.files ?? []).find(
            (f: { path: string; asbuilt_node_id?: number | null }) =>
              f.path === opts.dxfPath,
          );
          if (entry?.asbuilt_node_id) setAsbuiltNodeId(entry.asbuilt_node_id);
        })
        .catch(() => {});

      // 1. Fast path: local session cache
      if (cached && cached.results.length > 0) {
        setResults(cached.results);
        setSegments(cached.segments);
        if (cached.boundary) setGlobalBoundary(cached.boundary);
        resolveSessionId(opts.dxfPath);
        setStep(3);
        return;
      }

      // The backend keys everything by content checksum (SHA-256), not local
      // path — the same file re-uploaded from a different PC has a different
      // path but the same checksum, so this is what actually makes restore
      // work across machines.
      let checksum: string | undefined;
      try {
        const csRes = await fetch(
          `/api/precompute/status?dxf_path=${encodeURIComponent(opts.dxfPath)}`,
        );
        const csData = await csRes.json();
        checksum = csData?.checksum || undefined;
      } catch {
        // Backend unreachable for this — fall back to path-based lookup below
      }

      // 2. Durable path: check Supabase for a saved session
      if (supabase && db) {
        try {
          const summary = await db.getSessionSummary(opts.dxfPath, checksum);
          const hasSavedData = summary && (
            summary.counts.digit_results > 0 ||
            summary.counts.poles > 0 ||
            summary.counts.equipment_shapes > 0 ||
            summary.counts.cable_spans > 0
          );
          if (hasSavedData) {
            sessionIdRef.current = summary!.session.id;
            setSessionId(summary!.session.id);
            if (summary!.project.asbuilt_node_id) {
              setAsbuiltNodeId(summary!.project.asbuilt_node_id);
            }
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
    [pipeline, getCache, db, resolveSessionId, router],
  );

  // Deep-link: opening /LPA115 directly resolves that name against the local
  // file list and opens it the same way picking it from LoadScreen would —
  // same restore-from-cache/Supabase path, no special-casing needed.
  useEffect(() => {
    const siteSlug = routeParams?.site;
    if (!siteSlug || autoLoadAttemptedRef.current) return;
    autoLoadAttemptedRef.current = true;

    (async () => {
      try {
        const decoded = decodeURIComponent(siteSlug).toLowerCase();
        const listRes = await fetch("/api/files/list");
        const listData = await listRes.json();
        const match = (listData.files ?? []).find((f: { name: string }) => {
          const base = f.name.replace(/\.dxf$/i, "").toLowerCase();
          return base === decoded;
        });
        if (!match) {
          console.warn(`[deep-link] no local file matches "${siteSlug}"`);
          return;
        }

        const layersRes = await fetch("/api/layers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dxf_path: match.path }),
        });
        const layersData = await layersRes.json();
        if (layersData.error) {
          console.warn("[deep-link] could not read layers:", layersData.error);
          return;
        }

        await handleStartProcessing({
          dxfPath: match.path,
          layers: layersData.layers as string[],
          allLayers: layersData.layers as string[],
        });
      } catch (err) {
        console.warn("[deep-link] auto-load failed:", err);
      }
    })();
  }, [routeParams, handleStartProcessing]);

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
        // Restored poles only count as a finished scan if at least one was
        // actually read — the headless precompute stores unread placeholders,
        // and marking those "done" hid the fact that no OCR ever ran.
        poleDone: full.poles.some((p: any) => !p.needs_review),
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
      setRestoredPoles(poleTags);
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
      // Corrections/deletes/manual adds used to live only in this in-memory
      // cache — lost on reload, and never reached Supabase at all. Queue a
      // debounced save so edits actually persist (and survive opening the
      // same file on a different PC).
      if (sessionIdRef.current) {
        autoSave.queueSave({ results });
      }
    }
  }, [results, step, dxfPath, setCache, autoSave]);

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
    const sid = sessionIdRef.current;
    if (sid && db) {
      const dbSpans = spans.map((s) => ({
        span_id: s.span_id,
        layer: s.layer ?? "",
        bbox: (s.bbox ?? [0, 0, 0, 0]) as number[],
        cx: s.cx ?? 0,
        cy: s.cy ?? 0,
        total_length: s.total_length ?? 0,
        meter_value: s.meter_value ?? null,
        cable_runs: s.cable_runs ?? 1,
        from_pole: s.from_pole ?? null,
        to_pole: s.to_pole ?? null,
        segments: (s as any).segments ?? (s as any).display_segments ?? [],
      }));
      db.saveCableSpans(sid, dbSpans).catch((e) => console.warn("[DB] saveCableSpans failed", e));
    }
  }, [db]);

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
    setRestoredPoles(null);
    sessionIdRef.current = null;
    setSessionId(null);
    setAsbuiltNodeId(null);
    // Clear the deep-link URL too — otherwise a refresh from the file list
    // would re-trigger the auto-load effect and jump straight back into
    // whichever file was last open instead of staying on "My Drawings".
    autoLoadAttemptedRef.current = false;
    router.replace("/");
  }, [pipeline, router]);

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
              />
            </div>

            <div
              className={`flex-1 flex overflow-hidden ${mapTab === "dxf" ? "" : "hidden"}`}
            >
              <DxfViewer
                dxfPath={dxfPath}
                ocrResults={results}
                isActive={mapTab === "dxf"}
                asbuiltNodeId={asbuiltNodeId}
                onExportPdfRef={pdfExportRef}
                onExportVerificationRef={verificationExportRef}
                boundary={globalBoundary}
                isMaskEnabled={isMaskEnabled}
                onSpansChange={handleSpansChange}
                onCacheUpdate={(data) => handleCacheUpdate(dxfPath, data)}
                initialSegments={restoredDxfSegments ?? undefined}
                initialCableSpans={restoredCableSpans ?? undefined}
                initialPoles={restoredPoles ?? undefined}
                onInitialDataConsumed={() => {
                  setRestoredDxfSegments(null);
                  setRestoredCableSpans(null);
                  setRestoredPoles(null);
                }}
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
                onViewReport={() => setMapTab("dxf")}
                initialPoles={restoredPoles ?? undefined}
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
          onNodeImported={setAsbuiltNodeId}
        />
      )}
    </div>
  );
}
