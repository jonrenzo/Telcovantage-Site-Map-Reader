import { type ToolName, equipmentTypeNames } from "./tools";

// Base URL for Flask API - will be proxied through Next.js
const API_BASE = process.env.FLASK_API_URL || "http://127.0.0.1:5000";

interface ApiResponse<T = unknown> {
  ok?: boolean;
  data?: T;
  error?: string;
  [key: string]: unknown;
}

async function fetchApi<T = unknown>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Tool execution functions
export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>
): Promise<unknown> {
  try {
    switch (name) {
      case "get_uploaded_files":
        return await getUploadedFiles(args.folder as string | undefined);

      case "count_uploaded_files":
        return await countUploadedFiles(args.folder as string | undefined);

      case "get_session_summary":
        return await getSessionSummary();

      case "get_ocr_results":
        return await getOcrResults(
          args.needs_review as boolean | undefined,
          args.min_confidence as number | undefined
        );

      case "calculate_total_strand_meters":
        return await calculateTotalStrandMeters();

      case "get_poles":
        return await getPoles(
          args.needs_review as boolean | undefined,
          args.source as string | undefined
        );

      case "get_equipment":
        return await getEquipment(
          args.kind as string | undefined,
          args.layer as string | undefined
        );

      case "get_cable_spans":
        return await getCableSpans(
          args.from_pole as string | undefined,
          args.to_pole as string | undefined
        );

      case "get_scan_status":
        return await getScanStatus();

      case "export_results":
        return await exportResults(args.format as string);

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// Get list of uploaded files
async function getUploadedFiles(folder?: string) {
  const data = await fetchApi<ApiResponse>("/api/files/list");

  // Data structure: { folders: [...], files: [...] }
  interface FileEntry {
    name: string;
    path: string;
    size: number;
    modified: number;
    folder: string;
  }

  const files = (data.files || []) as FileEntry[];
  const filteredFiles = folder
    ? files.filter(
        (f) => f.folder?.toLowerCase() === folder.toLowerCase()
      )
    : files;

  return {
    total: filteredFiles.length,
    folders: data.folders || [],
    files: filteredFiles.map((f) => ({
      name: f.name,
      folder: f.folder || "root",
      size: formatFileSize(f.size),
      modified: new Date(f.modified * 1000).toLocaleDateString(),
    })),
  };
}

// Count uploaded files
async function countUploadedFiles(folder?: string) {
  const data = await fetchApi<ApiResponse>("/api/files/list");

  interface FileEntry {
    folder: string;
  }

  const files = (data.files || []) as FileEntry[];
  const folders = (data.folders || []) as string[];

  if (folder) {
    const count = files.filter(
      (f) => f.folder?.toLowerCase() === folder.toLowerCase()
    ).length;
    return { folder, count };
  }

  // Count by folder
  const folderCounts: Record<string, number> = { root: 0 };
  folders.forEach((f) => (folderCounts[f] = 0));

  files.forEach((f) => {
    const key = f.folder || "root";
    folderCounts[key] = (folderCounts[key] || 0) + 1;
  });

  return {
    total: files.length,
    byFolder: folderCounts,
  };
}

// Get session summary (calls the new endpoint)
async function getSessionSummary() {
  const data = await fetchApi<ApiResponse>("/api/chat/summary");

  if (data.ok && data.data) {
    return data.data;
  }

  // Fallback: construct from individual endpoints
  const [filesData, ocrStatus, poleStatus, equipStatus] = await Promise.all([
    fetchApi<ApiResponse>("/api/files/list"),
    fetchApi<ApiResponse>("/api/status"),
    fetchApi<ApiResponse>("/api/pole_tags"),
    fetchApi<ApiResponse>("/api/scan_status"),
  ]);

  interface FileEntry {
    name: string;
  }

  return {
    files: {
      total: ((filesData.files || []) as FileEntry[]).length,
      folders: filesData.folders || [],
    },
    current_file: ocrStatus.dxf_path || null,
    ocr: {
      status: ocrStatus.status || "idle",
      count: ((ocrStatus.results || []) as unknown[]).length,
    },
    poles: {
      status: poleStatus.status || "idle",
      count: ((poleStatus.tags || []) as unknown[]).length,
    },
    equipment: {
      status: equipStatus.status || "idle",
      count: ((equipStatus.shapes || []) as unknown[]).length,
    },
  };
}

// Get OCR results
async function getOcrResults(needsReview?: boolean, minConfidence?: number) {
  const data = await fetchApi<ApiResponse>("/api/results");

  interface OcrResult {
    digit_id: number;
    value: string;
    corrected_value: string | null;
    confidence: number;
    needs_review: boolean;
    center_x: number;
    center_y: number;
  }

  let results = (data.results || []) as OcrResult[];

  if (needsReview !== undefined) {
    results = results.filter((r) => r.needs_review === needsReview);
  }

  if (minConfidence !== undefined) {
    results = results.filter((r) => r.confidence >= minConfidence);
  }

  return {
    count: results.length,
    total_in_scan: ((data.results || []) as unknown[]).length,
    results: results.slice(0, 20).map((r) => ({
      id: r.digit_id,
      value: r.corrected_value || r.value,
      original_value: r.value,
      confidence: Math.round(r.confidence * 100) + "%",
      needs_review: r.needs_review,
    })),
    truncated: results.length > 20,
  };
}

// Calculate total strand meters
async function calculateTotalStrandMeters() {
  const data = await fetchApi<ApiResponse>("/api/results");

  interface OcrResult {
    value: string;
    corrected_value: string | null;
  }

  const results = (data.results || []) as OcrResult[];

  let total = 0;
  let validCount = 0;
  let invalidCount = 0;

  results.forEach((r) => {
    const value = r.corrected_value || r.value;
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 0) {
      total += num;
      validCount++;
    } else {
      invalidCount++;
    }
  });

  return {
    total_strand_meters: total,
    valid_readings: validCount,
    invalid_readings: invalidCount,
    average: validCount > 0 ? Math.round(total / validCount) : 0,
  };
}

// Get poles
async function getPoles(needsReview?: boolean, source?: string) {
  const data = await fetchApi<ApiResponse>("/api/pole_tags");

  interface PoleTag {
    pole_id: number;
    name: string;
    corrected_name?: string;
    source: string;
    needs_review: boolean;
    ocr_conf?: number;
  }

  let poles = (data.tags || []) as PoleTag[];

  if (needsReview !== undefined) {
    poles = poles.filter((p) => p.needs_review === needsReview);
  }

  if (source) {
    poles = poles.filter(
      (p) => p.source?.toLowerCase() === source.toLowerCase()
    );
  }

  return {
    count: poles.length,
    total_in_scan: ((data.tags || []) as unknown[]).length,
    poles: poles.slice(0, 20).map((p) => ({
      id: p.pole_id,
      name: p.corrected_name || p.name,
      source: p.source,
      needs_review: p.needs_review,
      confidence: p.ocr_conf ? Math.round(p.ocr_conf * 100) + "%" : "N/A",
    })),
    truncated: poles.length > 20,
  };
}

// Get equipment
async function getEquipment(kind?: string, layer?: string) {
  const data = await fetchApi<ApiResponse>("/api/scan_results");

  interface EquipmentShape {
    shape_id: number;
    kind: string;
    layer: string;
    cx: number;
    cy: number;
  }

  let shapes = (data.shapes || []) as EquipmentShape[];

  if (kind) {
    shapes = shapes.filter(
      (s) => s.kind?.toLowerCase() === kind.toLowerCase()
    );
  }

  if (layer) {
    shapes = shapes.filter(
      (s) => s.layer?.toLowerCase() === layer.toLowerCase()
    );
  }

  // Group by kind
  const byKind: Record<string, number> = {};
  shapes.forEach((s) => {
    byKind[s.kind] = (byKind[s.kind] || 0) + 1;
  });

  // Add human-readable names
  const summary = Object.entries(byKind).map(([k, count]) => ({
    shape: k,
    equipment_type: equipmentTypeNames[k] || k,
    count,
  }));

  return {
    count: shapes.length,
    total_in_scan: ((data.shapes || []) as unknown[]).length,
    by_type: summary,
    shapes: shapes.slice(0, 20).map((s) => ({
      id: s.shape_id,
      type: equipmentTypeNames[s.kind] || s.kind,
      shape: s.kind,
      layer: s.layer,
    })),
    truncated: shapes.length > 20,
  };
}

// Get cable spans
async function getCableSpans(fromPole?: string, toPole?: string) {
  const data = await fetchApi<ApiResponse>("/api/cable_spans");

  interface CableSpan {
    span_id: number;
    from_pole: string | null;
    to_pole: string | null;
    meter_value: number | null;
    total_length: number;
    layer: string;
  }

  let spans = (data.spans || []) as CableSpan[];

  if (fromPole) {
    spans = spans.filter(
      (s) => s.from_pole?.toLowerCase() === fromPole.toLowerCase()
    );
  }

  if (toPole) {
    spans = spans.filter(
      (s) => s.to_pole?.toLowerCase() === toPole.toLowerCase()
    );
  }

  const withMeterValue = spans.filter((s) => s.meter_value !== null);
  const withPoleAssignments = spans.filter((s) => s.from_pole && s.to_pole);

  return {
    count: spans.length,
    total_in_scan: ((data.spans || []) as unknown[]).length,
    with_meter_values: withMeterValue.length,
    with_pole_assignments: withPoleAssignments.length,
    spans: spans.slice(0, 20).map((s) => ({
      id: s.span_id,
      from_pole: s.from_pole || "unassigned",
      to_pole: s.to_pole || "unassigned",
      meter_value: s.meter_value,
      length: s.total_length ? Math.round(s.total_length * 100) / 100 : null,
    })),
    truncated: spans.length > 20,
  };
}

// Get scan status
async function getScanStatus() {
  const [ocrStatus, poleStatus, equipStatus] = await Promise.all([
    fetchApi<ApiResponse>("/api/status"),
    fetchApi<ApiResponse>("/api/pole_tags"),
    fetchApi<ApiResponse>("/api/scan_status"),
  ]);

  return {
    current_file: ocrStatus.dxf_path || "No file loaded",
    ocr: {
      status: ocrStatus.status || "idle",
      progress:
        ocrStatus.status === "processing"
          ? `${ocrStatus.progress}/${ocrStatus.total}`
          : null,
      step: ocrStatus.step_label || null,
    },
    poles: {
      status: poleStatus.status || "idle",
      count: ((poleStatus.tags || []) as unknown[]).length,
    },
    equipment: {
      status: equipStatus.status || "idle",
      count: ((equipStatus.shapes || []) as unknown[]).length,
    },
  };
}

// Export results
async function exportResults(format: string) {
  const endpoint =
    format === "all"
      ? "/api/export/all"
      : format === "equipment"
        ? "/api/export/equipment"
        : format === "poles"
          ? "/api/export/poles"
          : "/api/export";

  const data = await fetchApi<ApiResponse>(endpoint, {
    method: "POST",
    body: JSON.stringify({}),
  });

  if (data.error) {
    return { success: false, error: data.error };
  }

  return {
    success: true,
    message: `Successfully exported ${format} results`,
    file: data.path || data.filename || "export.xlsx",
  };
}

// Utility function
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
