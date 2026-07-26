"use client";

import { useState, useEffect } from "react";
import PsgcCascader, { type PsgcValue } from "./PsgcCascader";
import type {
  PoleTag,
  AsbuiltSite,
  AsbuiltNode,
  AsbuiltSubcontractor,
  AsbuiltTeam,
  AsbuiltExportResult,
  CableSpanExport,
  ManualNodeForm,
  VerifyNodeResponse,
  EquipmentShape,
} from "../types";

interface Props {
  cableSpans: CableSpanExport[];
  onClose: () => void;
  poleTags?: PoleTag[];
  equipmentShapes?: EquipmentShape[];
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

type SpanComponentCounts = {
  node: number;
  amplifier: number;
  extender: number;
  tsc: number;
  powersupply: number;
  ps_housing: number;
};

const EMPTY_COMPONENTS: SpanComponentCounts = {
  node: 0,
  amplifier: 0,
  extender: 0,
  tsc: 0,
  powersupply: 0,
  ps_housing: 0,
};

const COMPONENT_KEYS = Object.keys(
  EMPTY_COMPONENTS,
) as Array<keyof SpanComponentCounts>;

const COMPONENT_LABELS: Record<keyof SpanComponentCounts, string> = {
  node: "Node",
  amplifier: "Amplifier",
  extender: "Line Extender",
  tsc: "Taps / Splitters",
  powersupply: "Power Supply",
  ps_housing: "PS Housing",
};

const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  circle: "2 Way Tap",
  splitter: "Splitter",
  square: "4 Way Tap",
  hexagon: "8 Way Tap",
  node: "Node",
  amplifier: "Amplifier",
  rectangle: "Node / Amplifier",
  triangle: "Line Extender",
};

const EQUIPMENT_KIND_ORDER = [
  "circle",
  "splitter",
  "square",
  "hexagon",
  "node",
  "amplifier",
  "triangle",
];

type ResolvedAsbuiltSpan = {
  span_id: number;
  source_span_id?: number | null;
  from_pole_index: string;
  to_pole_index: string;
  strand_length: number;
  number_of_runs: number;
  components: SpanComponentCounts;
};

type PendingResolvedAsbuiltSpan = {
  span_id: number;
  source_span_id?: number | null;
  from_pole_index?: string;
  to_pole_index?: string;
  strand_length: number;
  number_of_runs: number;
  components: SpanComponentCounts;
};

type DuplicateNodeMatch = {
  node: AsbuiltNode;
  site: AsbuiltSite | null;
};

function getEquipmentDisplayKind(shape: EquipmentShape): string {
  if (shape.kind === "rectangle") {
    const layer = shape.layer.toLowerCase();
    if (layer.includes("node")) return "node";
    if (layer.includes("amp") || layer.includes("amplifier")) return "amplifier";
  }
  return shape.kind;
}

function getEquipmentComponentKey(
  shape: EquipmentShape,
): keyof SpanComponentCounts | null {
  const kind = getEquipmentDisplayKind(shape);
  if (kind === "node") return "node";
  if (kind === "amplifier") return "amplifier";
  if (kind === "triangle") return "extender";
  if (
    kind === "circle" ||
    kind === "square" ||
    kind === "hexagon" ||
    kind === "splitter"
  ) {
    return "tsc";
  }
  return null;
}

function sumComponentCounts(counts: SpanComponentCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function addComponentCounts(
  target: SpanComponentCounts,
  source: SpanComponentCounts,
): SpanComponentCounts {
  const next = { ...target };
  for (const key of COMPONENT_KEYS) {
    next[key] += source[key] ?? 0;
  }
  return next;
}

function buildEquipmentComponentPreview(shapes: EquipmentShape[]) {
  const components: SpanComponentCounts = { ...EMPTY_COMPONENTS };
  const byKind: Record<string, number> = {};

  for (const shape of shapes) {
    const componentKey = getEquipmentComponentKey(shape);
    if (!componentKey) continue;

    components[componentKey] += 1;
    const kind = getEquipmentDisplayKind(shape);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }

  return { components, byKind };
}

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)),
  );
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function normalizeSpanPairKey(fromIndex: string, toIndex: string): string {
  return [fromIndex, toIndex].sort().join("::");
}

function compareResolvedSpanPriority(
  left: ResolvedAsbuiltSpan,
  right: ResolvedAsbuiltSpan,
): number {
  if (left.number_of_runs !== right.number_of_runs) {
    return left.number_of_runs - right.number_of_runs;
  }
  if (left.strand_length !== right.strand_length) {
    return left.strand_length - right.strand_length;
  }
  return right.span_id - left.span_id;
}

function normalizeNodeId(value?: string | null): string {
  return (value || "").trim().toUpperCase();
}

function mergePoleCollections(
  cachedPoles: PoleTag[],
  apiPoles: PoleTag[],
): PoleTag[] {
  const merged = new Map<number, PoleTag>();

  for (const pole of apiPoles) {
    merged.set(pole.pole_id, pole);
  }

  for (const pole of cachedPoles) {
    const existing = merged.get(pole.pole_id);
    if (!existing) {
      merged.set(pole.pole_id, pole);
      continue;
    }

    merged.set(pole.pole_id, {
      ...existing,
      ...pole,
      map_latitude: pole.map_latitude ?? existing.map_latitude,
      map_longitude: pole.map_longitude ?? existing.map_longitude,
    });
  }

  return Array.from(merged.values());
}

export default function AsbuiltExportModal({
  cableSpans,
  onClose,
  poleTags = [],
  equipmentShapes = [],
  dxfPath,
}: Props) {
  const [step, setStep] = useState<Step>("gps_check");
  const [poles, setPoles] = useState<PoleTag[]>([]);
  const [sites, setSites] = useState<AsbuiltSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [nodes, setNodes] = useState<AsbuiltNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<AsbuiltNode | null>(null);
  const [subcontractors, setSubcontractors] = useState<AsbuiltSubcontractor[]>(
    [],
  );
  const [teams, setTeams] = useState<AsbuiltTeam[]>([]);
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState<
    number | null
  >(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [result, setResult] = useState<AsbuiltExportResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyNodeResponse | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSubcontractors, setLoadingSubcontractors] = useState(false);
  const [loadingTeams, setLoadingTeams] = useState(false);

  const [selectionMode, setSelectionMode] = useState<
    "existing" | "manual" | null
  >(null);
  const [manualForm, setManualForm] =
    useState<ManualNodeForm>(EMPTY_MANUAL_FORM);
  const [selectedSiteDuplicateManualNode, setSelectedSiteDuplicateManualNode] =
    useState<DuplicateNodeMatch | null>(null);
  const [checkingManualNodeId, setCheckingManualNodeId] = useState(false);

  // Shared PSGC area (region/province/city/barangay) used by BOTH the manual node
  // form and the existing-node path, so location is picked from dropdowns, not typed.
  const EMPTY_PSGC: PsgcValue = {
    region: "",
    province: "",
    city: "",
    barangay_name: "",
  };
  const [psgcArea, setPsgcArea] = useState<PsgcValue>(EMPTY_PSGC);

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
    }

    loadPoles(poleTags);
  }, [poleTags]);

  async function loadPoles(fallbackPoles: PoleTag[] = []) {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/poles");
      const json = await res.json();
      if (json.ok && Array.isArray(json.data?.poles)) {
        const poleList = mergePoleCollections(
          fallbackPoles,
          json.data.poles as PoleTag[],
        );
        setPoles(poleList);
        const allGps = poleList.every(
          (p) => p.map_latitude != null && p.map_longitude != null,
        );
        if (!allGps) {
          setStep("georef_warn");
        } else {
          setStep("site_select");
        }
      } else if (fallbackPoles.length > 0) {
        setPoles(fallbackPoles);
        const allGps = fallbackPoles.every(
          (p) => p.map_latitude != null && p.map_longitude != null,
        );
        setStep(allGps ? "site_select" : "georef_warn");
      } else {
        setError(json.error || "No pole data available.");
        setStep("error");
      }
    } catch (e: any) {
      if (fallbackPoles.length > 0) {
        setPoles(fallbackPoles);
        const allGps = fallbackPoles.every(
          (p) => p.map_latitude != null && p.map_longitude != null,
        );
        setStep(allGps ? "site_select" : "georef_warn");
      } else {
        setError(e.message || "Failed to load poles");
        setStep("error");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (step !== "site_select") return;
    if (sites.length > 0) return;
    loadSites();
  }, [step]);

  useEffect(() => {
    if (step !== "site_select") return;
    if (subcontractors.length > 0) return;
    loadSubcontractors();
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
      setSelectedSubcontractorId(null);
      setSelectedTeamId(null);
      setTeams([]);
      return;
    }
    setSelectedSubcontractorId(null);
    setSelectedTeamId(null);
    setTeams([]);
    loadNodes(selectedSiteId);
  }, [selectedSiteId]);

  async function fetchNodesForSite(areaId: number): Promise<AsbuiltNode[]> {
    const res = await fetch(`/api/v1/asbuilt/sites/${areaId}/nodes`);
    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.error || "Failed to load nodes");
    }
    const data = json.data;
    return (data?.nodes as AsbuiltNode[]) || [];
  }

  async function loadNodes(areaId: number) {
    setLoading(true);
    setNodes([]);
    setSelectedNode(null);
    setSelectionMode(null);
    try {
      const nodeList = await fetchNodesForSite(areaId);
      setNodes(nodeList);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function findDuplicateNodeInSelectedSite(
    nodeId: string,
  ): Promise<DuplicateNodeMatch | null> {
    const normalizedNodeId = normalizeNodeId(nodeId);
    if (!normalizedNodeId || !selectedSiteId) return null;

    const siteNodes = await fetchNodesForSite(selectedSiteId);
    const duplicate = siteNodes.find(
      (node) => normalizeNodeId(node.node_id) === normalizedNodeId,
    );
    if (!duplicate) return null;

    return {
      node: duplicate,
      site: sites.find((site) => site.id === selectedSiteId) ?? null,
    };
  }

  async function loadSubcontractors() {
    setLoadingSubcontractors(true);
    try {
      const res = await fetch("/api/v1/asbuilt/subcontractors");
      const json = await res.json();
      if (json.ok) {
        setSubcontractors(
          Array.isArray(json.data) ? (json.data as AsbuiltSubcontractor[]) : [],
        );
      } else {
        setError(json.error || "Failed to load subcontractors");
      }
    } catch (e: any) {
      setError(e.message || "Failed to load subcontractors");
    } finally {
      setLoadingSubcontractors(false);
    }
  }

  async function loadTeams(subcontractorId: number | null) {
    if (!subcontractorId) {
      setTeams([]);
      setSelectedTeamId(null);
      return;
    }

    setLoadingTeams(true);
    try {
      const res = await fetch(
        `/api/v1/asbuilt/teams?subcontractor_id=${subcontractorId}`,
      );
      const json = await res.json();
      if (json.ok) {
        const nextTeams = Array.isArray(json.data)
          ? (json.data as AsbuiltTeam[])
          : [];
        setTeams(nextTeams);
        setSelectedTeamId((current) =>
          nextTeams.some((team) => team.id === current) ? current : null,
        );
      } else {
        setError(json.error || "Failed to load teams");
      }
    } catch (e: any) {
      setError(e.message || "Failed to load teams");
    } finally {
      setLoadingTeams(false);
    }
  }

  useEffect(() => {
    loadTeams(selectedSubcontractorId);
  }, [selectedSubcontractorId]);

  useEffect(() => {
    if (selectionMode !== "existing" || !selectedNode) return;
    setSelectedSubcontractorId(selectedNode.subcontractor_id ?? null);
    setSelectedTeamId(selectedNode.team_id ?? null);
  }, [selectionMode, selectedNode]);

  useEffect(() => {
    const normalizedNodeId = normalizeNodeId(manualForm.node_id);
    if (selectionMode !== "manual" || !normalizedNodeId || sites.length === 0) {
      setSelectedSiteDuplicateManualNode(null);
      setCheckingManualNodeId(false);
      return;
    }

    let cancelled = false;
    setCheckingManualNodeId(true);
    setSelectedSiteDuplicateManualNode(null);
    const timer = setTimeout(async () => {
      try {
        const duplicate = await findDuplicateNodeInSelectedSite(manualForm.node_id);
        if (!cancelled) {
          setSelectedSiteDuplicateManualNode(duplicate);
        }
      } catch {
        if (!cancelled) {
          setSelectedSiteDuplicateManualNode(null);
        }
      } finally {
        if (!cancelled) {
          setCheckingManualNodeId(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectionMode, manualForm.node_id, selectedSiteId, sites]);

  function buildPoleCodeMap() {
    const nameToCode: Record<string, string> = {};
    const idToSequenceIndex: Record<number, string> = {};
    const nameToSequenceIndexes: Record<string, string[]> = {};
    const polesByName: Record<
      string,
      Array<{
        pole_id: number;
        name: string;
        sequenceIndex: string;
        cx: number;
        cy: number;
      }>
    > = {};
    const georeferencedPoles: Array<{
      pole_id: number;
      name: string;
      sequenceIndex: string;
      cx: number;
      cy: number;
    }> = [];

    let sequenceCounter = 0;
    for (const p of poles) {
      if (p.map_latitude == null || p.map_longitude == null) continue;
      const baseName = (p.name || "").trim().toUpperCase();
      if (!baseName) continue;

      sequenceCounter += 1;
      const sequenceIndex = `POLE-${String(sequenceCounter).padStart(4, "0")}`;
      nameToCode[baseName] = baseName;
      idToSequenceIndex[p.pole_id] = sequenceIndex;
      if (!nameToSequenceIndexes[baseName]) {
        nameToSequenceIndexes[baseName] = [];
      }
      nameToSequenceIndexes[baseName].push(sequenceIndex);
      const georeferencedPole = {
        pole_id: p.pole_id,
        name: baseName,
        sequenceIndex,
        cx: p.cx,
        cy: p.cy,
      };
      georeferencedPoles.push(georeferencedPole);
      if (!polesByName[baseName]) {
        polesByName[baseName] = [];
      }
      polesByName[baseName].push(georeferencedPole);
    }
    return {
      nameToCode,
      idToSequenceIndex,
      nameToSequenceIndexes,
      polesByName,
      georeferencedPoles,
    };
  }

  function getAreaData() {
    // Both manual and existing-node paths now pick location from the PSGC dropdowns.
    return {
      region: psgcArea.region,
      province: psgcArea.province,
      city: psgcArea.city,
      barangay_name: psgcArea.barangay_name,
    };
  }

  async function handleExport() {
    const targetNode =
      selectionMode === "manual"
        ? { node_id: manualForm.node_id, name: manualForm.node_name }
        : selectedNode;
    if (!targetNode || !targetNode.node_id || !targetNode.name) return;
    if (!selectedSiteId) return;

    if (selectionMode === "manual") {
      setCheckingManualNodeId(true);
      let duplicateNode: DuplicateNodeMatch | null = null;
      try {
        duplicateNode = await findDuplicateNodeInSelectedSite(targetNode.node_id);
      } catch (e: any) {
        setCheckingManualNodeId(false);
        setError(
          e?.message ||
            "Unable to validate whether this Node ID already exists. Please try again.",
        );
        setStep("error");
        return;
      }
      setCheckingManualNodeId(false);
      if (duplicateNode) {
        setError(
          `Node ID "${targetNode.node_id}" already exists` +
            `${duplicateNode.site ? ` in site "${duplicateNode.site.name}"` : ""} ` +
            `as "${duplicateNode.node.full_label || duplicateNode.node.name || duplicateNode.node.node_id}". ` +
            "Node IDs must be unique inside the selected site. For split nodes, use a distinct exact ID like LP-1234A, LP-1234B, or LP-1234C.",
        );
        setStep("error");
        return;
      }
    }

    setStep("posting");

    const areaData = getAreaData();
    const {
      nameToCode,
      idToSequenceIndex,
      nameToSequenceIndexes,
      polesByName,
      georeferencedPoles,
    } =
      buildPoleCodeMap();

    const asbuiltPoles = poles
      .filter((p) => {
        const baseName = (p.name || "").trim().toUpperCase();
        return (
          p.map_latitude != null &&
          p.map_longitude != null &&
          baseName.length > 0
        );
      })
      .map((p) => {
        const baseName = (p.name || "").trim().toUpperCase();
        return {
          pole_index: idToSequenceIndex[p.pole_id],
          pole_code: nameToCode[baseName],
          lat: p.map_latitude!,
          lng: p.map_longitude!,
        };
      });

    const uniqueIndexByName = new Map<string, string>();
    Object.entries(nameToSequenceIndexes).forEach(([name, indexes]) => {
      if (indexes.length === 1) uniqueIndexByName.set(name, indexes[0]);
    });

    const pickNearestPole = <
      T extends { sequenceIndex: string; cx: number; cy: number },
    >(
      candidates: T[],
      x: number | null | undefined,
      y: number | null | undefined,
    ): { sequenceIndex: string; dist: number } | null => {
      if (x == null || y == null) return null;
      let best: { sequenceIndex: string; dist: number } | null = null;
      for (const pole of candidates) {
        const dist = Math.hypot(pole.cx - x, pole.cy - y);
        if (!best || dist < best.dist) {
          best = { sequenceIndex: pole.sequenceIndex, dist };
        }
      }
      return best;
    };

    const collectNearestPoleCandidates = <
      T extends { sequenceIndex: string; cx: number; cy: number },
    >(
      candidates: T[],
      x: number | null | undefined,
      y: number | null | undefined,
      maxDistance = 80,
      limit = 4,
    ): string[] => {
      if (x == null || y == null) return [];
      return candidates
        .map((pole) => ({
          sequenceIndex: pole.sequenceIndex,
          dist: Math.hypot(pole.cx - x, pole.cy - y),
        }))
        .filter((candidate) => candidate.dist <= maxDistance)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, limit)
        .map((candidate) => candidate.sequenceIndex);
    };

    const nearestSequenceIndex = (
      x: number | null | undefined,
      y: number | null | undefined,
      maxDistance = 80,
    ): string | undefined => {
      const best = pickNearestPole(georeferencedPoles, x, y);
      return best && best.dist <= maxDistance ? best.sequenceIndex : undefined;
    };

    const raySequenceIndex = (
      endpointX: number | null | undefined,
      endpointY: number | null | undefined,
      inwardX: number | null | undefined,
      inwardY: number | null | undefined,
      candidateName: string | null | undefined,
    ): string | undefined => {
      if (
        endpointX == null ||
        endpointY == null ||
        inwardX == null ||
        inwardY == null
      ) {
        return undefined;
      }

      const dx = endpointX - inwardX;
      const dy = endpointY - inwardY;
      if (dx === 0 && dy === 0) return undefined;

      const rayMaxDistance = 150;
      const rayTolerance = 15;
      const magnitude = Math.hypot(dx, dy);
      const rayEndX = endpointX + (dx / magnitude) * rayMaxDistance;
      const rayEndY = endpointY + (dy / magnitude) * rayMaxDistance;
      const normalizedName = (candidateName || "").trim().toUpperCase();
      const candidates =
        polesByName[normalizedName]?.length
          ? polesByName[normalizedName]
          : georeferencedPoles;

      let best: { sequenceIndex: string; dist: number } | null = null;
      for (const pole of candidates) {
        const distanceToRay = pointToSegmentDistance(
          pole.cx,
          pole.cy,
          endpointX,
          endpointY,
          rayEndX,
          rayEndY,
        );
        if (distanceToRay > rayTolerance) continue;
        const distanceToEndpoint = Math.hypot(pole.cx - endpointX, pole.cy - endpointY);
        if (!best || distanceToEndpoint < best.dist) {
          best = { sequenceIndex: pole.sequenceIndex, dist: distanceToEndpoint };
        }
      }

      return best?.sequenceIndex;
    };

    const collectRayPoleCandidates = (
      endpointX: number | null | undefined,
      endpointY: number | null | undefined,
      inwardX: number | null | undefined,
      inwardY: number | null | undefined,
      candidateName: string | null | undefined,
      limit = 4,
    ): string[] => {
      if (
        endpointX == null ||
        endpointY == null ||
        inwardX == null ||
        inwardY == null
      ) {
        return [];
      }

      const dx = endpointX - inwardX;
      const dy = endpointY - inwardY;
      if (dx === 0 && dy === 0) return [];

      const rayMaxDistance = 150;
      const rayTolerance = 15;
      const magnitude = Math.hypot(dx, dy);
      const rayEndX = endpointX + (dx / magnitude) * rayMaxDistance;
      const rayEndY = endpointY + (dy / magnitude) * rayMaxDistance;
      const normalizedName = (candidateName || "").trim().toUpperCase();
      const candidates =
        polesByName[normalizedName]?.length
          ? polesByName[normalizedName]
          : georeferencedPoles;

      return candidates
        .map((pole) => ({
          sequenceIndex: pole.sequenceIndex,
          distanceToRay: pointToSegmentDistance(
            pole.cx,
            pole.cy,
            endpointX,
            endpointY,
            rayEndX,
            rayEndY,
          ),
          distanceToEndpoint: Math.hypot(pole.cx - endpointX, pole.cy - endpointY),
        }))
        .filter((candidate) => candidate.distanceToRay <= rayTolerance)
        .sort((a, b) => a.distanceToEndpoint - b.distanceToEndpoint)
        .slice(0, limit)
        .map((candidate) => candidate.sequenceIndex);
    };

    const buildSpanPoleCandidates = (
      poleId: number | null | undefined,
      poleName: string | null | undefined,
      poleX: number | null | undefined,
      poleY: number | null | undefined,
      endpointX: number | null | undefined,
      endpointY: number | null | undefined,
      oppositeEndpointX: number | null | undefined,
      oppositeEndpointY: number | null | undefined,
    ): string[] => {
      const candidates: string[] = [];
      const pushCandidate = (value: string | undefined) => {
        if (!value || candidates.includes(value)) return;
        candidates.push(value);
      };

      if (poleId != null && idToSequenceIndex[poleId]) {
        pushCandidate(idToSequenceIndex[poleId]);
      }

      const normalizedName = (poleName || "").trim().toUpperCase();
      const namedCandidates = normalizedName ? (polesByName[normalizedName] ?? []) : [];

      const byNamedPoleCoords = pickNearestPole(namedCandidates, poleX, poleY);
      if (byNamedPoleCoords && byNamedPoleCoords.dist <= 80) {
        pushCandidate(byNamedPoleCoords.sequenceIndex);
      }
      collectNearestPoleCandidates(namedCandidates, poleX, poleY).forEach(
        pushCandidate,
      );

      const byNamedEndpointCoords = pickNearestPole(
        namedCandidates,
        endpointX,
        endpointY,
      );
      if (byNamedEndpointCoords && byNamedEndpointCoords.dist <= 80) {
        pushCandidate(byNamedEndpointCoords.sequenceIndex);
      }
      collectNearestPoleCandidates(namedCandidates, endpointX, endpointY).forEach(
        pushCandidate,
      );

      const byPoleCoords = nearestSequenceIndex(poleX, poleY);
      pushCandidate(byPoleCoords);
      collectNearestPoleCandidates(georeferencedPoles, poleX, poleY).forEach(
        pushCandidate,
      );

      const byEndpointCoords = nearestSequenceIndex(endpointX, endpointY);
      pushCandidate(byEndpointCoords);
      collectNearestPoleCandidates(
        georeferencedPoles,
        endpointX,
        endpointY,
      ).forEach(pushCandidate);

      const byRay = raySequenceIndex(
        endpointX,
        endpointY,
        oppositeEndpointX,
        oppositeEndpointY,
        poleName,
      );
      pushCandidate(byRay);
      collectRayPoleCandidates(
        endpointX,
        endpointY,
        oppositeEndpointX,
        oppositeEndpointY,
        poleName,
      ).forEach(pushCandidate);

      if (!normalizedName) return candidates;

      const uniqueByName = uniqueIndexByName.get(normalizedName);
      pushCandidate(uniqueByName);

      const indexesByName = nameToSequenceIndexes[normalizedName] ?? [];
      indexesByName.forEach((sequenceIndex) => {
        pushCandidate(sequenceIndex);
      });

      return candidates;
    };

    const resolveDistinctSpanPoleIndexes = (
      fromCandidates: string[],
      toCandidates: string[],
    ): { fromIndex?: string; toIndex?: string } => {
      for (const fromIndex of fromCandidates) {
        const distinctTo = toCandidates.find((toIndex) => toIndex !== fromIndex);
        if (distinctTo) {
          return { fromIndex, toIndex: distinctTo };
        }
      }

      const fromIndex = fromCandidates[0];
      const toIndex = toCandidates.find((candidate) => candidate !== fromIndex);
      if (fromIndex || toIndex) {
        return { fromIndex, toIndex: toIndex ?? toCandidates[0] };
      }

      return {};
    };

    const unresolvedSpans: number[] = [];
    const unresolvedSpanDetails: string[] = [];
    const spanComponentMap = new Map<number, SpanComponentCounts>();

    const buildSpanGeometry = (span: CableSpanExport) => {
      const x1 = span.from_pole_x ?? span.from_x;
      const y1 = span.from_pole_y ?? span.from_y;
      const x2 = span.to_pole_x ?? span.to_x;
      const y2 = span.to_pole_y ?? span.to_y;
      if (
        x1 == null ||
        y1 == null ||
        x2 == null ||
        y2 == null ||
        !Number.isFinite(x1) ||
        !Number.isFinite(y1) ||
        !Number.isFinite(x2) ||
        !Number.isFinite(y2)
      ) {
        return null;
      }
      return { x1, y1, x2, y2 };
    };

    const candidateSpans = cableSpans
      .filter((s) => s.from_pole && s.to_pole)
      .map((span) => ({ spanId: span.span_id, geometry: buildSpanGeometry(span) }))
      .filter(
        (
          candidate,
        ): candidate is {
          spanId: number;
          geometry: { x1: number; y1: number; x2: number; y2: number };
        } => candidate.geometry != null,
      );

    for (const shape of equipmentShapes) {
      const componentKey = getEquipmentComponentKey(shape);
      if (!componentKey) continue;

      let closestSpanId: number | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of candidateSpans) {
        const distance = pointToSegmentDistance(
          shape.cx,
          shape.cy,
          candidate.geometry.x1,
          candidate.geometry.y1,
          candidate.geometry.x2,
          candidate.geometry.y2,
        );
        if (distance < closestDistance) {
          closestDistance = distance;
          closestSpanId = candidate.spanId;
        }
      }

      if (closestSpanId == null) continue;
      const counts = spanComponentMap.get(closestSpanId) ?? {
        ...EMPTY_COMPONENTS,
      };
      counts[componentKey] += 1;
      spanComponentMap.set(closestSpanId, counts);
    }

    const resolvedSpanCandidates: PendingResolvedAsbuiltSpan[] = cableSpans
      .filter((s) => s.from_pole && s.to_pole)
      .map((s) => {
        const fromCandidates = buildSpanPoleCandidates(
          s.from_pole_id,
          s.from_pole,
          s.from_pole_x,
          s.from_pole_y,
          s.from_x,
          s.from_y,
          s.to_x,
          s.to_y,
        );
        const toCandidates = buildSpanPoleCandidates(
          s.to_pole_id,
          s.to_pole,
          s.to_pole_x,
          s.to_pole_y,
          s.to_x,
          s.to_y,
          s.from_x,
          s.from_y,
        );
        const { fromIndex, toIndex } = resolveDistinctSpanPoleIndexes(
          fromCandidates,
          toCandidates,
        );
        if (!fromIndex || !toIndex || fromIndex === toIndex) {
          unresolvedSpans.push(s.span_id);
          const reason = !fromIndex && !toIndex
            ? "no from/to pole candidates"
            : !fromIndex
              ? "no from-pole candidate"
              : !toIndex
                ? "no to-pole candidate"
                : `both endpoints resolved to ${fromIndex}`;
          unresolvedSpanDetails.push(`${s.span_id} (${reason})`);
        }
        const components = spanComponentMap.get(s.span_id) ?? EMPTY_COMPONENTS;
        return {
          span_id: s.span_id,
          source_span_id: s.source_span_id ?? s.span_id,
          from_pole_index: fromIndex,
          to_pole_index: toIndex,
          strand_length: s.meter_value ?? s.total_length,
          number_of_runs: s.cable_runs || 1,
          components: { ...components },
        };
      })
      .filter(
        Boolean,
      );

    const resolvedSpans = resolvedSpanCandidates.filter(
      (span): span is ResolvedAsbuiltSpan =>
        typeof span.from_pole_index === "string" &&
        typeof span.to_pole_index === "string" &&
        span.from_pole_index !== span.to_pole_index,
    );

    const duplicateSpanGroups = new Map<string, ResolvedAsbuiltSpan[]>();
    for (const span of resolvedSpans) {
      const key = normalizeSpanPairKey(
        span.from_pole_index,
        span.to_pole_index,
      );
      const group = duplicateSpanGroups.get(key) ?? [];
      group.push(span);
      duplicateSpanGroups.set(key, group);
    }

    // Entries sharing a pole pair are one physical span drawn in pieces, so
    // their cable adds up. Keeping only the longest silently uploaded a
    // fraction of the real length — a 100 m run drawn in five pieces went up
    // as 20 m, and the loss was only ever visible in a console warning.
    const asbuiltSpans = Array.from(duplicateSpanGroups.values()).map((group) => {
      const base = group.reduce((best, candidate) =>
        compareResolvedSpanPriority(candidate, best) > 0 ? candidate : best,
      );
      return {
        ...base,
        strand_length: group.reduce((total, span) => total + span.strand_length, 0),
        number_of_runs: Math.max(...group.map((span) => span.number_of_runs)),
        components: group.reduce(
          (counts, span) => addComponentCounts(counts, span.components),
          { ...EMPTY_COMPONENTS },
        ),
      };
    });

    if (asbuiltPoles.length === 0) {
      setError(
        "No valid poles are ready for AsBuilt export. Make sure your pole names and GPS coordinates are complete.",
      );
      setStep("error");
      return;
    }

    const equipmentComponentTotal = sumComponentCounts(
      buildEquipmentComponentPreview(equipmentShapes).components,
    );
    const payloadComponentTotal = asbuiltSpans.reduce(
      (total, span) => total + sumComponentCounts(span.components),
      0,
    );

    if (equipmentComponentTotal > 0 && asbuiltSpans.length === 0) {
      setError(
        `${equipmentComponentTotal} equipment collectable(s) were detected, but no cable spans are ready for export. ` +
          "The backend stores collectables on span summaries, so exporting now would upload poles only and all expected component counts would stay at 0. " +
          "Run Auto-Connect Cables and make sure the modal shows spans before posting to AsBuilt IQ.",
      );
      setStep("error");
      return;
    }

    if (equipmentComponentTotal > 0 && payloadComponentTotal === 0) {
      setError(
        `${equipmentComponentTotal} equipment collectable(s) were detected, but none could be attached to exported spans. ` +
          "Run Auto-Connect Cables again so every collectable can attach to its nearest cable span before posting.",
      );
      setStep("error");
      return;
    }

    if (unresolvedSpans.length > 0) {
      setError(
        `Unable to resolve ${unresolvedSpans.length} span endpoint(s) to poles. ` +
          `Please re-run Insert Coordinates / Auto-Connect so every span has valid start and end poles. ` +
          `Affected span IDs: ${unresolvedSpans.slice(0, 15).join(", ")}${unresolvedSpans.length > 15 ? "..." : ""}. ` +
          `Diagnostics: ${unresolvedSpanDetails.slice(0, 8).join(", ")}${unresolvedSpanDetails.length > 8 ? "..." : ""}`,
      );
      setStep("error");
      return;
    }

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
    if (areaData.barangay_name) payload.barangay_name = areaData.barangay_name;
    if (selectedSubcontractorId) payload.subcontractor_id = selectedSubcontractorId;
    if (selectedTeamId) payload.team_id = selectedTeamId;

    try {
      const res = await fetch("/api/v1/asbuilt/import-by-sequence", {
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
  const componentPreview = buildEquipmentComponentPreview(equipmentShapes);
  const componentTotalCount = sumComponentCounts(componentPreview.components);
  const componentCategoryEntries = (
    Object.entries(componentPreview.components) as Array<
      [keyof SpanComponentCounts, number]
    >
  ).filter(([, count]) => count > 0);
  const equipmentKindEntries = EQUIPMENT_KIND_ORDER.map((kind) => [
    kind,
    componentPreview.byKind[kind] ?? 0,
  ] as const).filter(([, count]) => count > 0);
  const localDuplicateManualNode =
    selectionMode === "manual" && normalizeNodeId(manualForm.node_id)
      ? nodes.find(
          (node) =>
            normalizeNodeId(node.node_id) === normalizeNodeId(manualForm.node_id),
        ) ?? null
      : null;
  const duplicateManualNodeMatch =
    selectedSiteDuplicateManualNode ??
    (localDuplicateManualNode
      ? { node: localDuplicateManualNode, site: selectedSite ?? null }
      : null);
  const duplicateManualNode = duplicateManualNodeMatch?.node ?? null;
  const duplicateManualNodeSite = duplicateManualNodeMatch?.site ?? null;
  const hasDuplicateManualNode = duplicateManualNodeMatch != null;

  function resetToSiteSelect() {
    setSelectionMode(null);
    setSelectedNode(null);
    setManualForm(EMPTY_MANUAL_FORM);
    setPsgcArea(EMPTY_PSGC);
    setSelectedSubcontractorId(null);
    setSelectedTeamId(null);
    setTeams([]);
    setStep("site_select");
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-[#00704A]/[0.06] to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00875a] to-[#00704A] flex items-center justify-center shadow-sm ring-1 ring-[#00704A]/20">
              <svg
                className="w-5 h-5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-text leading-tight">
                Export to AsBuilt IQ
              </h2>
              <p className="text-xs text-muted">
                Push poles &amp; spans to the field tracker
              </p>
            </div>
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
                  onClick={() => loadPoles(poleTags)}
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
                      &middot; <strong>{componentTotalCount}</strong>{" "}
                      collectables
                    </span>
                  </div>
                  {componentTotalCount > 0 && spanCount === 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <strong>{componentTotalCount}</strong> collectables are
                      detected, but there are no connected spans ready for
                      export. Run <strong>Auto-Connect Cables</strong> first so
                      these counts can be saved to backend span summaries.
                    </div>
                  )}

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
                                className={`w-full px-3 py-2 rounded-lg border bg-white text-sm text-text focus:outline-none focus:ring-2 ${
                                  hasDuplicateManualNode
                                    ? "border-red-300 focus:ring-red-400"
                                    : "border-border focus:ring-accent"
                                }`}
                              />
                              {checkingManualNodeId && !hasDuplicateManualNode && (
                                <p className="mt-1 text-xs text-muted">
                                  Checking Node ID in this site...
                                </p>
                              )}
                              {hasDuplicateManualNode && (
                                <p className="mt-1 text-xs text-red-600">
                                  Node ID already exists in this site
                                  {duplicateManualNodeSite
                                    ? ` under ${duplicateManualNodeSite.name}`
                                    : ""}
                                  {duplicateManualNode
                                    ? `: ${
                                        duplicateManualNode.full_label ||
                                        duplicateManualNode.name ||
                                        duplicateManualNode.node_id
                                      }`
                                    : "."}
                                </p>
                              )}
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
                            <div className="col-span-2 pt-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                                  Location
                                </span>
                                <span className="h-px flex-1 bg-border" />
                              </div>
                              <PsgcCascader value={psgcArea} onChange={setPsgcArea} />
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
                      <div className="space-y-4">
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
                          <div className="flex justify-between text-sm">
                            <span className="text-muted">Collectables</span>
                            <span className="font-semibold text-text">
                              {componentTotalCount}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                                Equipment Collectables
                              </p>
                              <p className="text-xs text-emerald-700 mt-0.5">
                                Preview total for this node export
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-emerald-900">
                                {componentTotalCount}
                              </p>
                              <p className="text-[10px] text-emerald-700">
                                total
                              </p>
                            </div>
                          </div>

                          {componentTotalCount > 0 ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {componentCategoryEntries.map(([key, count]) => (
                                  <div
                                    key={key}
                                    className="rounded-lg bg-white/80 border border-emerald-100 px-3 py-2"
                                  >
                                    <p className="text-[10px] text-muted truncate">
                                      {COMPONENT_LABELS[key]}
                                    </p>
                                    <p className="text-sm font-bold text-text">
                                      {count}
                                    </p>
                                  </div>
                                ))}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {equipmentKindEntries.map(([kind, count]) => (
                                  <span
                                    key={kind}
                                    className="rounded-full bg-white/80 border border-emerald-100 px-2.5 py-1 text-[11px] text-emerald-800"
                                  >
                                    {EQUIPMENT_KIND_LABELS[kind] ?? kind}:{" "}
                                    <strong>{count}</strong>
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-emerald-700">
                              No equipment collectables are cached yet. Run the
                              Equipment scan first if this node should include
                              component counts.
                            </p>
                          )}
                        </div>

                        {/* PSGC location for an EXISTING backend node (manual mode
                            already has these dropdowns in its form above). */}
                        {selectionMode === "existing" && (
                          <div className="rounded-xl border border-border bg-white p-4 space-y-3">
                            <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                              Area / Location (PSGC)
                            </p>
                            <PsgcCascader value={psgcArea} onChange={setPsgcArea} />
                          </div>
                        )}

                        <div className="rounded-xl border border-border bg-white p-4 space-y-3">
                          <div>
                            <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                              Assignment &amp; Field Routing
                            </p>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-muted mb-1">
                                Subcontractor
                              </label>
                              <select
                                value={selectedSubcontractorId ?? ""}
                                onChange={(e) => {
                                  const value = e.target.value
                                    ? Number(e.target.value)
                                    : null;
                                  setSelectedSubcontractorId(value);
                                  setSelectedTeamId(null);
                                }}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
                              >
                                <option value="">
                                  {loadingSubcontractors
                                    ? "Loading subcontractors..."
                                    : "Unassigned"}
                                </option>
                                {subcontractors.map((subcon) => (
                                  <option key={subcon.id} value={subcon.id}>
                                    {subcon.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-muted mb-1">
                                Field Team
                              </label>
                              <select
                                value={selectedTeamId ?? ""}
                                onChange={(e) =>
                                  setSelectedTeamId(
                                    e.target.value ? Number(e.target.value) : null,
                                  )
                                }
                                disabled={!selectedSubcontractorId || loadingTeams}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                              >
                                <option value="">
                                  {!selectedSubcontractorId
                                    ? "Select subcon first"
                                    : loadingTeams
                                      ? "Loading teams..."
                                      : "Unassigned"}
                                </option>
                                {teams.map((team) => (
                                  <option key={team.id} value={team.id}>
                                    {team.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
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
                          (!manualForm.node_id ||
                            !manualForm.node_name ||
                            hasDuplicateManualNode))
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
                {gpsCount} poles, {spanCount} spans, {componentTotalCount}{" "}
                collectables
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
