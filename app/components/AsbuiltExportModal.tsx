"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  PoleTag,
  AsbuiltSite,
  AsbuiltNode,
  AsbuiltExportResult,
  CableSpanExport,
  ManualNodeForm,
  VerifyNodeResponse,
} from "../types";

interface Props {
  cableSpans: CableSpanExport[];
  onClose: () => void;
  poleTags?: PoleTag[];
  dxfPath?: string;
}

type Step =
  | "gps_check"
  | "georef_warn"
  | "site_select"
  | "posting"
  | "done"
  | "error";

const EMPTY_MANUAL_FORM: ManualNodeForm = {
  node_id: "",
  node_name: "",
  region: "",
  province: "",
  city: "",
  barangay_name: "",
};

export default function AsbuiltExportModal({
  cableSpans,
  onClose,
  poleTags = [],
  dxfPath,
}: Props) {
  const [step, setStep] = useState<Step>("gps_check");
  const [poles, setPoles] = useState<PoleTag[]>([]);
  const [sites, setSites] = useState<AsbuiltSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [nodes, setNodes] = useState<AsbuiltNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<AsbuiltNode | null>(null);
  const [result, setResult] = useState<AsbuiltExportResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyNodeResponse | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectionMode, setSelectionMode] = useState<
    "existing" | "manual" | null
  >(null);
  const [manualForm, setManualForm] =
    useState<ManualNodeForm>(EMPTY_MANUAL_FORM);

  const derivedNodeId = (() => {
    if (!dxfPath) return "";
    const name = dxfPath.split(/[/\\]/).pop() || dxfPath;
    return name.replace(/\.dxf$/i, "");
  })();

  useEffect(() => {
    if (poleTags.length > 0) {
      setPoles(poleTags);
      const allGps = poleTags.every(
        (p) => p.map_latitude != null && p.map_longitude != null,
      );
      if (!allGps) {
        setStep("georef_warn");
      } else {
        setStep("site_select");
      }
      setLoading(false);
    } else {
      loadPoles();
    }
  }, [poleTags]);

  async function loadPoles() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/poles");
      const json = await res.json();
      if (json.ok && Array.isArray(json.data?.poles)) {
        const poleList = json.data.poles as PoleTag[];
        setPoles(poleList);
        const allGps = poleList.every(
          (p) => p.map_latitude != null && p.map_longitude != null,
        );
        if (!allGps) {
          setStep("georef_warn");
        } else {
          setStep("site_select");
        }
      } else {
        setError(json.error || "No pole data available.");
        setStep("error");
      }
    } catch (e: any) {
      setError(e.message || "Failed to load poles");
      setStep("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (step !== "site_select") return;
    if (sites.length > 0) return;
    loadSites();
  }, [step]);

  async function loadSites() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/asbuilt/sites");
      const json = await res.json();
      if (json.ok) {
        const list = Array.isArray(json.data)
          ? (json.data as AsbuiltSite[])
          : [];
        setSites(list);
      } else {
        setError(json.error || "Failed to load sites");
        setStep("error");
      }
    } catch (e: any) {
      setError(e.message);
      setStep("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedSiteId) {
      setNodes([]);
      setSelectedNode(null);
      setSelectionMode(null);
      return;
    }
    loadNodes(selectedSiteId);
  }, [selectedSiteId]);

  async function loadNodes(areaId: number) {
    setLoading(true);
    setNodes([]);
    setSelectedNode(null);
    setSelectionMode(null);
    try {
      const res = await fetch(`/api/v1/asbuilt/sites/${areaId}/nodes`);
      const json = await res.json();
      if (json.ok) {
        const data = json.data;
        const nodeList = (data?.nodes as AsbuiltNode[]) || [];
        setNodes(nodeList);
      } else {
        setError(json.error || "Failed to load nodes");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function buildPoleCodeMap() {
    const seenNames = new Set<string>();
    const nameToCode: Record<string, string> = {};
    let dupCounter = 0;

    for (const p of poles) {
      if (p.map_latitude == null || p.map_longitude == null) continue;
      const baseName = (p.name || "").trim().toUpperCase();
      if (!baseName) continue;

      let poleCode = baseName;
      if (seenNames.has(baseName)) {
        dupCounter++;
        poleCode = `${baseName}-${dupCounter}`;
      }
      seenNames.add(baseName);
      nameToCode[baseName] = poleCode;
    }
    return nameToCode;
  }

  function getAreaData() {
    if (selectionMode === "manual") {
      return {
        region: manualForm.region,
        province: manualForm.province,
        city: manualForm.city,
        barangay_name: manualForm.barangay_name,
      };
    }
    return {
      region: "",
      province: "",
      city: "",
      barangay_name: "",
    };
  }

  async function handleExport() {
    const targetNode =
      selectionMode === "manual"
        ? { node_id: manualForm.node_id, name: manualForm.node_name }
        : selectedNode;
    if (!targetNode || !targetNode.node_id || !targetNode.name) return;
    if (!selectedSiteId) return;

    setStep("posting");

    const areaData = getAreaData();
    const nameToCode = buildPoleCodeMap();

    const asbuiltPoles = poles
      .filter((p) => p.map_latitude != null && p.map_longitude != null)
      .map((p) => {
        const baseName = (p.name || "").trim().toUpperCase();
        return {
          pole_code: nameToCode[baseName] || baseName,
          latitude: p.map_latitude!,
          longitude: p.map_longitude!,
          barangay_name: areaData.barangay_name,
        };
      });

    const asbuiltSpans = cableSpans
      .filter((s) => s.from_pole && s.to_pole)
      .map((s) => {
        const fromCode =
          nameToCode[s.from_pole!.toUpperCase()] ||
          s.from_pole!.toUpperCase();
        const toCode =
          nameToCode[s.to_pole!.toUpperCase()] || s.to_pole!.toUpperCase();
        return {
          from_pole_code: fromCode,
          to_pole_code: toCode,
          strand_length: s.total_length,
          number_of_runs: s.cable_runs || 1,
          components: {
            node: 0,
            amplifier: 0,
            extender: 0,
            tsc: 0,
            powersupply: 0,
            ps_housing: 0,
          },
        };
      });

    const payload: Record<string, any> = {
      node_id: targetNode.node_id,
      node_name: targetNode.name,
      area_id: selectedSiteId,
      poles: asbuiltPoles,
      spans: asbuiltSpans,
    };

    if (areaData.region) payload.region = areaData.region;
    if (areaData.province) payload.province = areaData.province;
    if (areaData.city) payload.city = areaData.city;


    try {
      const res = await fetch("/api/v1/asbuilt/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok) {
        setResult(json.data as AsbuiltExportResult);
        const nodeDbId = json.data?.data?.node?.id;
        if (nodeDbId) {
          try {
            const verifyRes = await fetch(
              `/api/v1/asbuilt/node/${nodeDbId}`,
            );
            const verifyJson = await verifyRes.json();
            if (verifyJson.ok) {
              setVerifyResult(verifyJson.data as VerifyNodeResponse);
            }
          } catch {
            // verify is optional — show result anyway
          }
        }
        setStep("done");
      } else {
        setError(json.error || "Export failed");
        setStep("error");
      }
    } catch (e: any) {
      setError(e.message);
      setStep("error");
    }
  }

  const gpsCount = poles.filter(
    (p) => p.map_latitude != null && p.map_longitude != null,
  ).length;
  const missingCount = poles.length - gpsCount;

  const selectedSite = sites.find((s) => s.id === selectedSiteId);
  const spanCount = cableSpans.filter((s) => s.from_pole && s.to_pole).length;

  function resetToSiteSelect() {
    setSelectionMode(null);
    setSelectedNode(null);
    setManualForm(EMPTY_MANUAL_FORM);
    setStep("site_select");
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#00704A] flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-text">
              Export to AsBuilt IQ
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-surface-2 transition-colors"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === "gps_check" && (
            <div className="flex items-center justify-center py-12">
              <svg
                className="w-6 h-6 animate-spin text-accent"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <span className="ml-3 text-sm text-muted">
                Loading pole data...
              </span>
            </div>
          )}

          {step === "georef_warn" && (
            <div className="space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg
                    className="w-5 h-5 text-amber-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-amber-800 mb-1">
                    GPS Coordinates Required
                  </h3>
                  <p className="text-sm text-amber-700 leading-relaxed">
                    {missingCount} of {poles.length} poles are missing GPS
                    coordinates. Use the{" "}
                    <strong>&quot;Insert Coordinates&quot;</strong> button in
                    the <strong> Pole IDs</strong> tab to georeference your
                    drawing first.
                  </p>
                  <div className="mt-4 bg-amber-100/50 rounded-lg p-3 text-sm text-amber-800 font-mono text-xs">
                    <p className="font-semibold mb-1">Quick steps:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Go to <strong>Pole IDs</strong> tab
                      </li>
                      <li>
                        Click{" "}
                        <strong>🌍 Insert Coordinates</strong> (bottom-right)
                      </li>
                      <li>Enter at least 2 anchor points in GeoTool</li>
                      <li>
                        Close GeoTool — GPS coords sync automatically
                      </li>
                      <li>Reopen this export modal</li>
                    </ol>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={loadPoles}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  Retry
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-border text-muted hover:text-text transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {step === "site_select" && (
            <div className="space-y-6">
              {loading && sites.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <svg
                    className="w-6 h-6 animate-spin text-accent"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  <span className="ml-3 text-sm text-muted">
                    Loading sites...
                  </span>
                </div>
              ) : (
                <>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
                    <svg
                      className="w-5 h-5 text-emerald-600 flex-shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span className="text-sm text-emerald-800">
                      <strong>{gpsCount}</strong> poles with GPS coordinates
                      ready &middot; <strong>{spanCount}</strong> spans
                    </span>
                  </div>

                  {/* Site selector */}
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                      Site / Area
                    </label>
                    <select
                      value={selectedSiteId ?? ""}
                      onChange={(e) => {
                        setSelectedSiteId(
                          e.target.value ? Number(e.target.value) : null,
                        );
                      }}
                      className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-sm font-medium text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent"
                    >
                      <option value="">
                        {loading && sites.length === 0
                          ? "Loading sites..."
                          : "Select a site..."}
                      </option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.node_count != null
                            ? ` (${s.node_count} nodes)`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Node selection section */}
                  {selectedSiteId && (
                    <>
                      {/* Mode toggle */}
                      {!selectionMode && (
                        <div className="space-y-3">
                          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                            Node
                          </label>
                          {loading && nodes.length === 0 ? (
                            <div className="flex items-center gap-2 py-2">
                              <svg
                                className="w-4 h-4 animate-spin text-accent"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                              >
                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                              </svg>
                              <span className="text-sm text-muted">
                                Loading nodes...
                              </span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-3">
                              <button
                                onClick={() => setSelectionMode("existing")}
                                className="p-4 rounded-xl border-2 border-border hover:border-accent hover:bg-blue-50 transition-all text-left"
                              >
                                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center mb-2">
                                  <svg
                                    className="w-5 h-5 text-blue-600"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                                  </svg>
                                </div>
                                <p className="font-semibold text-text text-sm">
                                  Select Existing Node
                                </p>
                                <p className="text-xs text-muted mt-1">
                                  Choose from {nodes.length} existing{" "}
                                  {nodes.length === 1 ? "node" : "nodes"}
                                </p>
                              </button>
                              <button
                                onClick={() => {
                                  setSelectionMode("manual");
                                  setManualForm((f) => ({
                                    ...f,
                                    node_id: f.node_id || derivedNodeId,
                                  }));
                                }}
                                className="p-4 rounded-xl border-2 border-border hover:border-emerald-500 hover:bg-emerald-50 transition-all text-left"
                              >
                                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center mb-2">
                                  <svg
                                    className="w-5 h-5 text-emerald-600"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <path d="M12 5v14M5 12h14" />
                                  </svg>
                                </div>
                                <p className="font-semibold text-text text-sm">
                                  Add Node Manually
                                </p>
                                <p className="text-xs text-muted mt-1">
                                  Create a new node under this area
                                </p>
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Existing node selector */}
                      {selectionMode === "existing" && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                              Existing Node
                            </label>
                            <button
                              onClick={() => setSelectionMode(null)}
                              className="text-xs text-accent hover:underline"
                            >
                              Back
                            </button>
                          </div>
                          {loading && nodes.length === 0 ? (
                            <div className="flex items-center gap-2 py-2">
                              <svg
                                className="w-4 h-4 animate-spin text-accent"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                              >
                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                              </svg>
                              <span className="text-sm text-muted">
                                Loading nodes...
                              </span>
                            </div>
                          ) : (
                            <select
                              value={selectedNode?.id ?? ""}
                              onChange={(e) => {
                                const id = e.target.value
                                  ? Number(e.target.value)
                                  : null;
                                setSelectedNode(
                                  id ? nodes.find((n) => n.id === id) || null : null,
                                );
                              }}
                              className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-sm font-medium text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent"
                            >
                              <option value="">Select a node...</option>
                              {nodes.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.full_label || n.name}
                                  {n.pole_count
                                    ? ` (${n.pole_count} poles)`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}

                      {/* Manual node form */}
                      {selectionMode === "manual" && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                              New Node Details
                            </label>
                            <button
                              onClick={() => {
                                setSelectionMode(null);
                                setManualForm(EMPTY_MANUAL_FORM);
                              }}
                              className="text-xs text-accent hover:underline"
                            >
                              Back
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2 sm:col-span-1">
                              <label className="block text-xs font-medium text-muted mb-1">
                                Node ID *
                              </label>
                              <input
                                type="text"
                                value={manualForm.node_id}
                                onChange={(e) =>
                                  setManualForm((f) => ({
                                    ...f,
                                    node_id: e.target.value,
                                  }))
                                }
                                placeholder='e.g. "TY1501"'
                                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                            <div className="col-span-2 sm:col-span-1">
                              <label className="block text-xs font-medium text-muted mb-1">
                                Node Name *
                              </label>
                              <input
                                type="text"
                                value={manualForm.node_name}
                                onChange={(e) =>
                                  setManualForm((f) => ({
                                    ...f,
                                    node_name: e.target.value,
                                  }))
                                }
                                placeholder='e.g. "BRGY. BALIBAGO"'
                                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-muted mb-1">
                                Region
                              </label>
                              <input
                                type="text"
                                value={manualForm.region}
                                onChange={(e) =>
                                  setManualForm((f) => ({
                                    ...f,
                                    region: e.target.value,
                                  }))
                                }
                                placeholder='e.g. "CALABARZON"'
                                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-muted mb-1">
                                Province
                              </label>
                              <input
                                type="text"
                                value={manualForm.province}
                                onChange={(e) =>
                                  setManualForm((f) => ({
                                    ...f,
                                    province: e.target.value,
                                  }))
                                }
                                placeholder='e.g. "LAGUNA"'
                                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-muted mb-1">
                                City
                              </label>
                              <input
                                type="text"
                                value={manualForm.city}
                                onChange={(e) =>
                                  setManualForm((f) => ({
                                    ...f,
                                    city: e.target.value,
                                  }))
                                }
                                placeholder='e.g. "STA. ROSA"'
                                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-muted mb-1">
                                Barangay Name
                              </label>
                              <input
                                type="text"
                                value={manualForm.barangay_name}
                                onChange={(e) =>
                                  setManualForm((f) => ({
                                    ...f,
                                    barangay_name: e.target.value,
                                  }))
                                }
                                placeholder='e.g. "Balibago"'
                                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Selection summary */}
                  {selectedSite &&
                    (selectionMode === "existing"
                      ? selectedNode
                      : selectionMode === "manual" &&
                          manualForm.node_id &&
                          manualForm.node_name) && (
                      <div className="bg-surface-2 rounded-xl px-4 py-3 space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted">Site</span>
                          <span className="font-semibold text-text">
                            {selectedSite.name}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted">Node</span>
                          <span className="font-semibold text-text">
                            {selectionMode === "existing"
                              ? selectedNode?.full_label || selectedNode?.name
                              : `${manualForm.node_id} (${manualForm.node_name})`}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted">Poles to send</span>
                          <span className="font-semibold text-text">
                            {gpsCount}
                          </span>
                        </div>
                      </div>
                    )}

                  {/* Post button */}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={onClose}
                      className="px-4 py-2 text-sm font-semibold rounded-lg border border-border text-muted hover:text-text transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleExport}
                      disabled={
                        !selectionMode ||
                        (selectionMode === "existing" && !selectedNode) ||
                        (selectionMode === "manual" &&
                          (!manualForm.node_id || !manualForm.node_name))
                      }
                      className="px-5 py-2 text-sm font-semibold rounded-lg bg-[#00704A] text-white hover:bg-[#005a3a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      Post to AsBuilt IQ
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === "posting" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <svg
                className="w-10 h-10 animate-spin text-[#00704A]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <p className="text-sm font-semibold text-text">
                Posting to AsBuilt IQ...
              </p>
              <p className="text-xs text-muted">
                {gpsCount} poles, {spanCount} spans
              </p>
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-6">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-5 h-5 text-emerald-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-800 mb-1">
                    Import Complete
                  </h3>
                  <p className="text-sm text-emerald-700">
                    {result.message}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-2 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-text">
                    {result.data?.total_poles ?? 0}
                  </p>
                  <p className="text-xs text-muted mt-1">Poles processed</p>
                  {result.data?.poles_created &&
                    result.data.poles_created.length > 0 && (
                      <p className="text-[10px] text-emerald-600 mt-1">
                        {result.data.poles_created.length} created
                      </p>
                    )}
                  {result.data?.poles_updated &&
                    result.data.poles_updated.length > 0 && (
                      <p className="text-[10px] text-amber-600 mt-0.5">
                        {result.data.poles_updated.length} updated
                      </p>
                    )}
                </div>
                <div className="bg-surface-2 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-text">
                    {result.data?.total_spans ?? 0}
                  </p>
                  <p className="text-xs text-muted mt-1">Spans</p>
                </div>
              </div>

              {/* Verify node state */}
              {verifyResult && (
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-surface-2 px-4 py-2 border-b border-border">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                      Node State
                    </p>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted">Node ID:</span>{" "}
                        <span className="font-semibold">
                          {verifyResult.node.node_id}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted">Name:</span>{" "}
                        <span className="font-semibold">
                          {verifyResult.node.name}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted">Area:</span>{" "}
                        {verifyResult.node.area}
                      </div>
                      <div>
                        <span className="text-muted">Status:</span>{" "}
                        <span className="font-semibold capitalize">
                          {verifyResult.node.status}
                        </span>
                      </div>
                      {verifyResult.node.barangay && (
                        <div className="col-span-2">
                          <span className="text-muted">Barangay:</span>{" "}
                          {verifyResult.node.barangay}
                        </div>
                      )}
                    </div>

                    {verifyResult.poles.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                          Uploaded Poles ({verifyResult.poles.length})
                        </p>
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {verifyResult.poles.map((pole) => (
                            <div
                              key={pole.pole_id}
                              className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-1.5 text-xs"
                            >
                              <span className="font-mono font-semibold">
                                {pole.pole_code}
                              </span>
                              <span className="text-muted">
                                {pole.latitude != null ? Number(pole.latitude).toFixed(5) : "—"},{" "}
                                {pole.longitude != null ? Number(pole.longitude).toFixed(5) : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {verifyResult.spans.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                          Uploaded Spans ({verifyResult.spans.length})
                        </p>
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {verifyResult.spans.map((span) => (
                            <div
                              key={span.span_id}
                              className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-1.5 text-xs"
                            >
                              <span className="font-mono">
                                {span.from_pole_code} → {span.to_pole_code}
                              </span>
                              <span className="text-muted">
                                {span.strand_length}m &middot;{" "}
                                {span.number_of_runs}x run
                                {span.number_of_runs > 1 ? "s" : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {result.data?.errors && result.data.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-red-700 mb-2">
                    Errors ({result.data.errors.length})
                  </p>
                  <ul className="space-y-1">
                    {result.data.errors.map((err: string, i: number) => (
                      <li key={i} className="text-xs text-red-600 font-mono">
                        {err}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-center gap-3">
                <button
                  onClick={resetToSiteSelect}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-border text-muted hover:text-text transition-colors"
                >
                  Post Another
                </button>
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#00704A] text-white hover:bg-[#005a3a] transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-6">
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-5 h-5 text-red-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-red-800 mb-1">
                    Export Failed
                  </h3>
                  <p className="text-sm text-red-700 font-mono">{error}</p>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={resetToSiteSelect}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-white hover:bg-blue-700 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-border text-muted hover:text-text transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
