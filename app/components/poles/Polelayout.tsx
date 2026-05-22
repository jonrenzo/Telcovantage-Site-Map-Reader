"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { PoleTag } from "../../types";
import type { FileCache } from "../../hooks/useSessionCache";
import PolePanel from "./Polepanel";

// --- NEW 1: Import the Math Utility ---
import { isPointInPolygon } from "../../page";

interface BoundaryPoint {
  x: number;
  y: number;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface LayerSegs {
  [layer: string]: Segment[];
}
interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface Props {
  dxfPath: string;
  allLayers: string[];
  layerSegments: LayerSegs;
  cachedData: FileCache | null;
  onCacheUpdate: (data: Partial<FileCache>) => void;
  isActive: boolean;
  // --- NEW 2: Boundary Props ---
  boundary: BoundaryPoint[] | null;
  isMaskEnabled: boolean;
}

function sourceLabel(tag: PoleTag): { text: string; color: string } {
  if (tag.source === "text")
    return { text: "Text entity", color: "bg-[#dbeafe] text-[#1d4ed8]" };
  if (tag.source === "mtext")
    return { text: "MText entity", color: "bg-[#dbeafe] text-[#1d4ed8]" };
  return { text: "Stroked polyline", color: "bg-[#f3e8ff] text-[#6b21a8]" };
}

export default function PoleLayout({
  dxfPath,
  allLayers,
  layerSegments,
  cachedData,
  onCacheUpdate,
  isActive,
  boundary, // NEW
  isMaskEnabled, // NEW
}: Props) {
  // ── Pole scan state ───────────────────────────────────────────────────────
  const [tags, setTags] = useState<PoleTag[]>([]);
  const [scanStatus, setScanStatus] = useState<
    "idle" | "processing" | "done" | "error"
  >("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedLayers, setScannedLayers] = useState<string[]>([]);
  const [previewLayer, setPreviewLayer] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);

  // ── All-layer segments fetched from backend ───────────────────────────────
  const [allLayerSegs, setAllLayerSegs] = useState<LayerSegs>({});

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showOnMap, setShowOnMap] = useState(true);
  const [rotations, setRotations] = useState<Record<number, number>>({});

  const cropRotation = selectedId !== null ? (rotations[selectedId] ?? 0) : 0;

  // ── Manual pole placement state ─────────────────────────────────────────
  const [manualMode, setManualMode] = useState(false);
  const [manualPending, setManualPending] = useState<{
    cx: number;
    cy: number;
  } | null>(null);
  const [manualValue, setManualValue] = useState("");

  function rotateCrop() {
    if (selectedId === null) return;
    setRotations((prev) => ({
      ...prev,
      [selectedId]: ((prev[selectedId] ?? 0) + 90) % 360,
    }));
  }

  function saveRotation() {
    if (selectedId === null || cropRotation === 0) return;
    const tag = tags.find((t) => t.pole_id === selectedId);
    if (!tag?.crop_b64) return;

    const img = new Image();
    img.onload = () => {
      const rad = (cropRotation * Math.PI) / 180;
      const swapped = cropRotation % 180 !== 0;
      const w = swapped ? img.height : img.width;
      const h = swapped ? img.width : img.height;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const newB64 = canvas.toDataURL("image/png").split(",")[1];
      setTags((prev) =>
        prev.map((t) =>
          t.pole_id === selectedId ? { ...t, crop_b64: newB64 } : t,
        ),
      );
      setRotations((prev) => {
        const n = { ...prev };
        delete n[selectedId];
        return n;
      });
    };
    img.src = `data:image/png;base64,${tag.crop_b64}`;
  }

  // --- NEW 3: Calculate Visible Tags based on Boundary ---
  const visibleTags = useMemo(() => {
    if (isMaskEnabled && boundary && boundary.length > 2) {
      return tags.filter((t) => isPointInPolygon(t.cx, t.cy, boundary));
    }
    return tags;
  }, [tags, isMaskEnabled, boundary]);

  // ── Canvas ────────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const panRef = useRef({
    active: false,
    start: { x: 0, y: 0 },
    vpStart: { x: 0, y: 0, scale: 1 },
  });
  const boundsRef = useRef<{
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
  } | null>(null);
  const hasFittedRef = useRef(false);

  // Use visibleTagsRef so the hit-tester only targets rendered poles
  const visibleTagsRef = useRef(visibleTags);
  const selectedIdRef = useRef(selectedId);
  const showOnMapRef = useRef(showOnMap);
  const boundaryRef = useRef(boundary);
  const maskEnabledRef = useRef(isMaskEnabled);

  useEffect(() => {
    visibleTagsRef.current = visibleTags;
  }, [visibleTags]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    showOnMapRef.current = showOnMap;
  }, [showOnMap]);
  useEffect(() => {
    boundaryRef.current = boundary;
  }, [boundary]);
  useEffect(() => {
    maskEnabledRef.current = isMaskEnabled;
  }, [isMaskEnabled]);

  const canvasSegments = useMemo(() => {
    const src = Object.keys(allLayerSegs).length ? allLayerSegs : layerSegments;
    return Object.values(src).flat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLayerSegs, JSON.stringify(Object.keys(layerSegments))]);

  // ── Fetch all layer segments from backend ─────────────────────────────────
  useEffect(() => {
    if (!dxfPath) return;
    fetch("/api/dxf_segments?hide_circles=1")
      .then((r) => r.json())
      .then((data) => {
        if (data.segments) setAllLayerSegs(data.segments);
      })
      .catch(() => {});
  }, [dxfPath]);

  // ── Restore from cache on mount if available, otherwise stay idle ────────
  useEffect(() => {
    if (cachedData?.poleDone) {
      setTags(cachedData.poleTags);
      setScannedLayers(
        cachedData.poleLayers ??
          (cachedData.poleLayer ? [cachedData.poleLayer] : []),
      );
      setScanStatus("done");
      setScanProgress(cachedData.poleTags.length);
      setScanTotal(cachedData.poleTags.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Poll while scanning ───────────────────────────────────────────────────
  useEffect(() => {
    if (scanStatus !== "processing") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/pole_tags");
        const data = await res.json();

        if (data.progress !== undefined) setScanProgress(data.progress);
        if (data.total !== undefined) setScanTotal(data.total);
        if (data.tags?.length) setTags(data.tags);

        if (data.status === "done") {
          setScanStatus("done");
          setTags(data.tags ?? []);
          const nextLayers =
            (Array.isArray(data.layers) ? data.layers : []).filter(
              (l: unknown): l is string =>
                typeof l === "string" && l.length > 0,
            ) || [];
          setScannedLayers(
            nextLayers.length > 0 ? nextLayers : data.layer ? [data.layer] : [],
          );
          clearInterval(timer);

          // Save completed scan to cache
          onCacheUpdate({
            poleTags: data.tags ?? [],
            poleLayer: data.layer,
            poleLayers:
              nextLayers.length > 0
                ? nextLayers
                : data.layer
                  ? [data.layer]
                  : [],
            poleDone: true,
          });
        } else if (data.status === "error") {
          setScanStatus("error");
          setScanError(data.error ?? "Unknown error");
          clearInterval(timer);
        }
      } catch {
        /* network blip */
      }
    }, 500);
    return () => clearInterval(timer);
  }, [scanStatus, onCacheUpdate]);

  // ── Trigger scan ──────────────────────────────────────────────────────────
  const handleScan = useCallback(
    async (layers: string[]) => {
      setScanStatus("processing");
      setScanError(null);
      setTags([]);
      setSelectedId(null);
      setScannedLayers([]);
      setScanProgress(0);
      setScanTotal(0);

      // Clear pole cache for this file so fresh results replace old ones
      onCacheUpdate({
        poleTags: [],
        poleLayer: null,
        poleLayers: [],
        poleDone: false,
      });

      try {
        await fetch("/api/pole_tags/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dxf_path: dxfPath, layers }),
        });
      } catch (e) {
        setScanStatus("error");
        setScanError(String(e));
      }
    },
    [dxfPath, onCacheUpdate],
  );

  // ── Rename handler — also updates cache ───────────────────────────────────
  const handleRenamePole = useCallback(
    (poleId: number, newName: string) => {
      setTags((prev) => {
        const updated = prev.map((t) =>
          t.pole_id === poleId
            ? { ...t, name: newName, needs_review: false }
            : t,
        );
        // ADD THIS: Tell DxfViewer the name changed
        window.postMessage(
          {
            type: "POLE_UPDATE",
            payload: {
              action: "UPDATE",
              pole: { pole_id: poleId, name: newName },
            },
          },
          "*",
        );
        // Keep cache in sync with renamed tags
        onCacheUpdate({ poleTags: updated });
        return updated;
      });
    },
    [onCacheUpdate],
  );

  // ── Add/Delete handlers ────────────────────────────────────────────────────
  const handleAddPole = useCallback(
    (cx: number, cy: number, name: string) => {
      const nextId =
        tags.length > 0 ? Math.max(...tags.map((t) => t.pole_id)) + 1 : 1;
      const newPole: PoleTag = {
        pole_id: nextId,
        name: name.toUpperCase(),
        cx,
        cy,
        bbox: [cx - 0.5, cy - 0.5, cx + 0.5, cy + 0.5] as [
          number,
          number,
          number,
          number,
        ],
        layer: scannedLayers[0] ?? "",
        source: "manual",
        crop_b64: null,
        ocr_conf: null,
        needs_review: false,
      };
      setTags((prev) => {
        const updated = [...prev, newPole];
        onCacheUpdate({ poleTags: updated });
        // ADD THIS: Tell DxfViewer a new pole exists
        window.postMessage(
          { type: "POLE_UPDATE", payload: { action: "ADD", pole: newPole } },
          "*",
        );
        return updated;
      });
      setManualPending(null);
      setManualValue("");
      setManualMode(false);
    },
    [tags, scannedLayers, onCacheUpdate],
  );

  const handleDeletePole = useCallback(
    (poleId: number) => {
      setTags((prev) => {
        const updated = prev.filter((t) => t.pole_id !== poleId);
        onCacheUpdate({ poleTags: updated });
        // ADD THIS: Tell DxfViewer to remove this pole
        window.postMessage(
          {
            type: "POLE_UPDATE",
            payload: { action: "DELETE", pole: { pole_id: poleId } },
          },
          "*",
        );
        return updated;
      });
      setSelectedId((prev) => (prev === poleId ? null : prev));
    },
    [onCacheUpdate],
  );

  // ── Canvas redraw ─────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const vp = vpRef.current;
    const currentBoundary = boundaryRef.current;
    const isMaskOn = maskEnabledRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(vp.x, vp.y);
    ctx.scale(vp.scale, -vp.scale);

    // Draw base segments
    ctx.strokeStyle = previewLayer
      ? "rgba(71,85,105,0.08)"
      : "rgba(71,85,105,0.18)";
    ctx.lineWidth = 0.8 / vp.scale;
    ctx.beginPath();
    for (const s of canvasSegments) {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();

    // Quick peek: emphasize hovered layer geometry
    if (previewLayer && allLayerSegs[previewLayer]?.length) {
      ctx.strokeStyle = "rgba(245,158,11,0.9)";
      ctx.lineWidth = 1.7 / vp.scale;
      ctx.beginPath();
      for (const s of allLayerSegs[previewLayer]) {
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
      }
      ctx.stroke();
    }

    // --- NEW 4: Draw the Boundary Polygon ---
    if (isMaskOn && currentBoundary && currentBoundary.length > 2) {
      ctx.save();
      ctx.strokeStyle = "rgba(16, 185, 129, 0.8)"; // Emerald 500
      ctx.lineWidth = 2.5 / vp.scale;
      ctx.setLineDash([15 / vp.scale, 10 / vp.scale]);

      ctx.beginPath();
      ctx.moveTo(currentBoundary[0].x, currentBoundary[0].y);
      for (let i = 1; i < currentBoundary.length; i++) {
        ctx.lineTo(currentBoundary[i].x, currentBoundary[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = "rgba(16, 185, 129, 0.02)";
      ctx.fill();
      ctx.restore();
    }

    // Draw Poles (Only drawing visibleTags)
    if (showOnMapRef.current) {
      const vTags = visibleTagsRef.current;
      const selId = selectedIdRef.current;
      const r = 12 / vp.scale;

      for (const tag of vTags) {
        const isPreviewMatch = !previewLayer || tag.layer === previewLayer;
        if (previewLayer && !isPreviewMatch) {
          continue;
        }
        const isSel = tag.pole_id === selId;
        const color = isSel ? "#d97706" : "#f59e0b";

        ctx.beginPath();
        ctx.arc(tag.cx, tag.cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = isSel ? color : color + "bb";
        ctx.fill();

        if (isSel) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2 / vp.scale;
          ctx.stroke();
        }

        if (vp.scale > 1.2) {
          ctx.save();
          ctx.translate(tag.cx, tag.cy + r * 1.6);
          ctx.scale(1, -1);
          ctx.fillStyle = isSel ? "#d97706" : "#f59e0b";
          ctx.font = `bold ${Math.min(0.2, Math.max(8, 10 / vp.scale))}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(tag.name || `POLE_${tag.pole_id}`, 0, 0);
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }, [allLayerSegs, canvasSegments, previewLayer]);

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasSegments.length) return;

    let minx = Infinity,
      miny = Infinity,
      maxx = -Infinity,
      maxy = -Infinity;
    for (const s of canvasSegments) {
      minx = Math.min(minx, s.x1, s.x2);
      miny = Math.min(miny, s.y1, s.y2);
      maxx = Math.max(maxx, s.x1, s.x2);
      maxy = Math.max(maxy, s.y1, s.y2);
    }
    boundsRef.current = { minx, miny, maxx, maxy };

    const W = canvas.width,
      H = canvas.height;
    const dw = maxx - minx,
      dh = maxy - miny;
    const scale = Math.min(W / dw, H / dh) * 0.88;
    const cx = (minx + maxx) / 2,
      cy = (miny + maxy) / 2;
    vpRef.current = { x: W / 2 - cx * scale, y: H / 2 + cy * scale, scale };
    redraw();
  }, [canvasSegments, redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      if (!hasFittedRef.current && canvasSegments.length) {
        fitView();
        hasFittedRef.current = true;
      } else {
        redraw();
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [fitView, redraw]);

  useEffect(() => {
    if (canvasSegments.length && !hasFittedRef.current) {
      fitView();
      hasFittedRef.current = true;
    } else {
      redraw();
    }
  }, [canvasSegments, fitView, redraw]);

  // Make sure changing mask state directly triggers redraw
  useEffect(() => {
    redraw();
  }, [
    visibleTags,
    selectedId,
    showOnMap,
    redraw,
    boundary,
    isMaskEnabled,
    previewLayer,
  ]);

  useEffect(() => {
    if (!isActive) return;
    const id = setTimeout(() => {
      if (canvasSegments.length) fitView();
      else redraw();
    }, 30);
    return () => clearTimeout(id);
  }, [isActive, fitView, redraw, canvasSegments.length]);

  // ── Georeferencing Sync Listener ──────────────────────────────────────────

  // Create a ref so our event listener always has the freshest tag data
  const tagsRef = useRef(tags);
  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  // ── Geotool popup communication ──────────────────────────────────────────

  // Respond to GEO_READY by sending pole data to the geotool popup
  useEffect(() => {
    function handleGeoReady(e: MessageEvent) {
      if (e.data?.type === "GEO_READY" && e.source) {
        const payload = tags.map((t) => ({
          id: t.pole_id,
          name: t.name || `POLE_${t.pole_id}`,
          cx: t.cx,
          cy: t.cy,
        }));
        (e.source as Window).postMessage(
          { type: "POLE_DATA", payload },
          { targetOrigin: "*" },
        );
      }
    }
    window.addEventListener("message", handleGeoReady);
    return () => window.removeEventListener("message", handleGeoReady);
  }, [tags]);

  // Receive GEO_COORDINATES back from geotool and update tags
  useEffect(() => {
    function handleGeoCoords(e: MessageEvent) {
      if (e.data?.type === "GEO_COORDINATES" && Array.isArray(e.data.payload)) {
        const coordMap = new Map(
          e.data.payload.map(
            (p: { cad_x: number; cad_y: number; lat: number; lon: number }) => {
              const key = `${p.cad_x},${p.cad_y}`;
              return [key, { map_latitude: p.lat, map_longitude: p.lon }];
            },
          ),
        );
        const updated = (prev: typeof tags) =>
          prev.map((t) => {
            const coords = coordMap.get(`${t.cx},${t.cy}`);
            return coords ? { ...t, ...coords } : t;
          });
        setTags(updated);

        const gpsPoles = updated(tags)
          .filter((p) => p.map_latitude != null && p.map_longitude != null)
          .map((p) => ({
            pole_id: p.pole_id,
            map_latitude: p.map_latitude,
            map_longitude: p.map_longitude,
          }));
        if (gpsPoles.length > 0) {
          fetch("/api/v1/poles/georeference", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ poles: gpsPoles }),
          }).catch(() => {});
        }
      }
    }
    window.addEventListener("message", handleGeoCoords);
    return () => window.removeEventListener("message", handleGeoCoords);
  }, []);

  // ── Pan & zoom ────────────────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const vp = vpRef.current;
      const delta = e.deltaY > 0 ? 0.85 : 1 / 0.85;
      vpRef.current = {
        x: mx - (mx - vp.x) * delta,
        y: my - (my - vp.y) * delta,
        scale: vp.scale * delta,
      };
      redraw();
    },
    [redraw],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      panRef.current = {
        active: true,
        start: { x: e.clientX, y: e.clientY },
        vpStart: { ...vpRef.current },
      };
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!panRef.current.active) return;
      const dx = e.clientX - panRef.current.start.x;
      const dy = e.clientY - panRef.current.start.y;
      vpRef.current = {
        ...panRef.current.vpStart,
        x: panRef.current.vpStart.x + dx,
        y: panRef.current.vpStart.y + dy,
      };
      redraw();
    },
    [redraw],
  );

  const handleMouseUp = useCallback(() => {
    panRef.current.active = false;
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (
        Math.abs(e.clientX - panRef.current.start.x) > 4 ||
        Math.abs(e.clientY - panRef.current.start.y) > 4
      )
        return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const vp = vpRef.current;
      const wx = (e.clientX - rect.left - vp.x) / vp.scale;
      const wy = -(e.clientY - rect.top - vp.y) / vp.scale;

      // If in manual mode, capture the click location for adding a pole
      if (manualMode) {
        setManualPending({ cx: wx, cy: wy });
        setManualValue("");
        return;
      }

      const r = Math.max(1.0, 12 / vp.scale);

      let closest: PoleTag | null = null;
      let bestD = Infinity;
      // Hit test against visibleTags
      for (const tag of visibleTagsRef.current) {
        const d = Math.hypot(tag.cx - wx, tag.cy - wy);
        if (d < r && d < bestD) {
          bestD = d;
          closest = tag;
        }
      }
      setSelectedId(closest ? closest.pole_id : null);
    },
    [manualMode],
  );

  // Safely grab the selected tag from the filtered array
  const selectedTag = visibleTags.find((t) => t.pole_id === selectedId) ?? null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex overflow-hidden">
      <PolePanel
        dxfPath={dxfPath}
        layers={allLayers}
        // --- NEW 6: Pass visibleTags to the Sidebar Panel ---
        tags={visibleTags}
        status={scanStatus}
        error={scanError}
        scannedLayers={scannedLayers}
        onScan={handleScan}
        onPreviewLayerChange={setPreviewLayer}
        selectedId={selectedId}
        onSelectTag={setSelectedId}
        showOnMap={showOnMap}
        onToggleShowOnMap={() => setShowOnMap((v) => !v)}
        scanProgress={scanProgress}
        scanTotal={scanTotal}
        onRenamePole={handleRenamePole}
        onDeletePole={handleDeletePole}
        manualMode={manualMode}
        onToggleManual={() => {
          setManualMode((m) => !m);
          setManualPending(null);
          setManualValue("");
          setSelectedId(null);
        }}
      />

      <div className="flex-1 relative bg-[#f8fafc] overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleCanvasClick}
        />

        <button
          onClick={fitView}
          title="Fit to view"
          className="absolute bottom-4 right-4 w-8 h-8 bg-white border border-border rounded-lg shadow-sm
                       flex items-center justify-center text-muted hover:text-text hover:shadow-md transition-all"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>

        {/* Manual mode indicator */}
        {manualMode && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-[#8b5cf6] text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
            Click on the map to place a new pole
          </div>
        )}

        {/* Insert Coordinates Button */}
        {scanStatus === "done" && tags.length > 0 && (
          <button
            onClick={() => {
              // Open FastAPI Georeferencing tool in a new tab
              window.open(
                `http://localhost:8000/?dxf_path=${encodeURIComponent(dxfPath)}`,
                "_blank",
              );
            }}
            className="absolute bottom-16 right-4 z-10 bg-indigo-600 shadow-lg px-4 py-2 rounded-lg font-semibold text-sm text-white hover:bg-indigo-700 transition-all flex items-center gap-2"
          >
            🌍 Insert Coordinates
          </button>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-white/90 border border-border rounded-lg px-3 py-2 shadow-sm text-[10px] text-muted space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#f59e0b]" />
            <span>Pole label</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[#1d4ed8] font-semibold">TXT</span>
            <span>Text entity</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[#6b21a8] font-semibold">STR</span>
            <span>Stroked polylines</span>
          </div>
        </div>

        {/* ── Manual pole placement popup ── */}
        {manualPending && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/10 backdrop-blur-[1px]">
            <div className="bg-white rounded-xl shadow-2xl border border-border p-5 w-72">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold">Add Pole Manually</p>
                <button
                  onClick={() => {
                    setManualPending(null);
                    setManualValue("");
                  }}
                  className="w-5 h-5 rounded-full bg-surface-2 flex items-center justify-center text-muted text-xs hover:bg-border transition-colors"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-muted mb-3 font-mono">
                ({manualPending.cx.toFixed(2)}, {manualPending.cy.toFixed(2)})
              </p>
              <input
                autoFocus
                type="text"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualValue.trim())
                    handleAddPole(
                      manualPending.cx,
                      manualPending.cy,
                      manualValue,
                    );
                  if (e.key === "Escape") {
                    setManualPending(null);
                    setManualValue("");
                  }
                }}
                placeholder="Enter pole name…"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/30 font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setManualPending(null);
                    setManualValue("");
                  }}
                  className="flex-1 px-3 py-2 rounded-lg text-sm border border-border text-muted hover:bg-surface-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    handleAddPole(
                      manualPending.cx,
                      manualPending.cy,
                      manualValue,
                    )
                  }
                  disabled={!manualValue.trim()}
                  className="flex-1 px-3 py-2 rounded-lg text-sm bg-[#f59e0b] text-white font-medium hover:bg-[#d97706] disabled:opacity-40 transition-colors"
                >
                  Confirm
                </button>
              </div>
              <p className="text-[10px] text-muted-2 text-center mt-2">
                Enter to confirm · Esc to cancel
              </p>
            </div>
          </div>
        )}

        {/* Selected pole detail panel */}
        {selectedTag && (
          <div className="absolute top-4 right-4 w-72 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
            <div className="bg-[#f59e0b] px-3 py-3 flex items-center gap-2">
              <svg
                className="w-4 h-4 text-white flex-shrink-0"
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
              <input
                key={selectedTag.pole_id}
                type="text"
                defaultValue={selectedTag.name || `POLE_${selectedTag.pole_id}`}
                id={`detail-name-${selectedTag.pole_id}`}
                className="flex-1 min-w-0 bg-white/20 text-white placeholder-white/60 font-mono text-sm font-bold
                                    rounded px-2 py-0.5 focus:outline-none focus:bg-white/30
                                    border border-transparent focus:border-white/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value
                      .trim()
                      .toUpperCase();
                    if (v) handleRenamePole(selectedTag.pole_id, v);
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === "Escape") {
                    (e.target as HTMLInputElement).value =
                      selectedTag.name || `POLE_${selectedTag.pole_id}`;
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim().toUpperCase();
                  if (v && v !== selectedTag.name)
                    handleRenamePole(selectedTag.pole_id, v);
                }}
              />
              <button
                onClick={() => setSelectedId(null)}
                className="w-6 h-6 rounded-full bg-white/20 text-white hover:bg-white/35 flex-shrink-0 flex items-center justify-center text-xs transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="bg-white border-b border-border relative flex items-center justify-center p-3 min-h-[120px]">
              {selectedTag.crop_b64 ? (
                <img
                  src={`data:image/png;base64,${selectedTag.crop_b64}`}
                  alt="pole name"
                  className="object-contain transition-transform duration-200"
                  style={{
                    imageRendering: "auto",
                    maxHeight: "160px",
                    maxWidth: "100%",
                    transform: `rotate(${cropRotation}deg)`,
                    ...(cropRotation % 180 !== 0
                      ? { maxHeight: "220px", maxWidth: "160px" }
                      : {}),
                  }}
                />
              ) : (
                <p className="text-[10px] text-muted italic">
                  {selectedTag.source === "stroke"
                    ? "No OCR crop available"
                    : selectedTag.name || `POLE_${selectedTag.pole_id}`}
                </p>
              )}

              {selectedTag.crop_b64 && (
                <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                  <button
                    onClick={rotateCrop}
                    title="Rotate 90°"
                    className="w-6 h-6 rounded-full bg-[#f59e0b]/90 hover:bg-[#d97706] text-white flex items-center justify-center shadow transition-colors"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M21 2v6h-6" />
                      <path d="M21 8A9 9 0 1 0 19 19" />
                    </svg>
                  </button>
                  {cropRotation !== 0 && (
                    <button
                      onClick={saveRotation}
                      title="Save rotation"
                      className="h-6 px-1.5 rounded-full bg-[#16a34a] hover:bg-[#15803d] text-white text-[9px] font-bold flex items-center shadow transition-colors"
                    >
                      Save
                    </button>
                  )}
                </div>
              )}

              <div className="absolute bottom-1.5 left-2 bg-[#f59e0b] text-white text-[9px] font-bold px-1.5 py-0.5 rounded font-mono">
                {selectedTag.name || `POLE_${selectedTag.pole_id}`}
              </div>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">
                  Source
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sourceLabel(selectedTag).color}`}
                >
                  {sourceLabel(selectedTag).text}
                </span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">
                  Coordinates
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      label: (selectedTag as any).map_longitude ? "LONG" : "X",
                      val: (selectedTag as any).map_longitude ?? selectedTag.cx,
                      isGps: !!(selectedTag as any).map_longitude,
                    },
                    {
                      label: (selectedTag as any).map_latitude ? "LAT" : "Y",
                      val: (selectedTag as any).map_latitude ?? selectedTag.cy,
                      isGps: !!(selectedTag as any).map_latitude,
                    },
                  ].map(({ label, val, isGps }) => (
                    <div
                      key={label}
                      className={`rounded-lg px-3 py-2 text-center ${isGps ? "bg-indigo-50 border border-indigo-100" : "bg-surface-2"}`}
                    >
                      <p
                        className={`text-[9px] uppercase tracking-wider mb-0.5 ${isGps ? "text-indigo-600 font-bold" : "text-muted"}`}
                      >
                        {label}
                      </p>
                      <p className="font-mono text-xs font-semibold">
                        {isGps ? val.toFixed(6) : val.toFixed(3)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">
                  Layer
                </span>
                <span className="font-mono text-xs bg-surface-2 px-2 py-0.5 rounded truncate max-w-[140px]">
                  {selectedTag.layer}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">
                  Index
                </span>
                <span className="font-mono text-xs text-muted">
                  #{selectedTag.pole_id}
                </span>
              </div>
              {selectedTag.ocr_conf !== null &&
                selectedTag.ocr_conf !== undefined && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">
                        OCR Confidence
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-semibold
                      ${
                        selectedTag.ocr_conf >= 0.8
                          ? "bg-[#dcfce7] text-[#15803d]"
                          : selectedTag.ocr_conf >= 0.6
                            ? "bg-[#fef9c3] text-[#92400e]"
                            : "bg-[#fee2e2] text-[#b91c1c]"
                      }`}
                      >
                        {Math.round(selectedTag.ocr_conf * 100)}%
                      </span>
                    </div>
                    {selectedTag.needs_review && (
                      <p className="text-[10px] text-[#b91c1c] flex items-center gap-1">
                        <span>⚠</span> Name needs review
                      </p>
                    )}
                  </>
                )}

              {/* ── Delete pole button ── */}
              <div className="h-px bg-border" />
              <button
                onClick={() => handleDeletePole(selectedTag.pole_id)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#dc2626] border border-[#fecaca] hover:bg-[#fef2f2] transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                Delete this pole
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
