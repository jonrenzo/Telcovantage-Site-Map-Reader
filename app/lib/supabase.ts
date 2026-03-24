import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";

let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };

export interface Project {
  id: string;
  dxf_file_name: string;
  dxf_checksum: string | null;
  dxf_file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DigitResult {
  id?: string;
  session_id?: string;
  digit_id: number;
  value: string | null;
  corrected_value: string | null;
  confidence: number | null;
  needs_review: boolean;
  center_x: number | null;
  center_y: number | null;
  bbox: number[] | null;
  manual: boolean;
}

export interface CableSegment {
  id?: number;
  cable_span_id?: string;
  segment_index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CableSpan {
  id: string;
  session_id: string;
  original_span_id: number | null;
  span_id: number;
  layer: string | null;
  cx: number | null;
  cy: number | null;
  bbox: number[] | null;
  total_length: number | null;
  meter_value: number | null;
  cable_runs: number;
  from_pole: string | null;
  to_pole: string | null;
  is_deleted: boolean;
  parent_span_id: string | null;
  segments?: CableSegment[];
}

export interface SpanOperation {
  id: string;
  session_id: string;
  operation_type:
    | "split"
    | "pair"
    | "merge"
    | "cable_runs"
    | "restore"
    | "delete"
    | "status_update";
  span_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Pole {
  id: string;
  session_id: string;
  pole_id: number;
  name: string | null;
  corrected_name: string | null;
  cx: number | null;
  cy: number | null;
  bbox: number[] | null;
  layer: string | null;
  source: string | null;
  ocr_conf: number | null;
  needs_review: boolean;
}

export interface EquipmentShape {
  id: string;
  session_id: string;
  shape_id: number;
  kind: string;
  layer: string;
  cx: number;
  cy: number;
  bbox: number[] | null;
}

export interface TrashedSpan {
  id: string;
  session_id: string;
  original_span_id: number | null;
  span_data: CableSpan;
  status: string;
  partial_detail: Record<string, unknown> | null;
  trashed_at: string;
  restored_at: string | null;
}

// =====================================================
// NEW INTERFACES FOR PERSISTENT MAP STATE
// =====================================================

export interface BoundaryPoint {
  x: number;
  y: number;
}

export interface Boundary {
  id: string;
  session_id: string;
  polygon: BoundaryPoint[];
  created_at: string;
}

export interface SessionConfig {
  id: string;
  session_id: string;
  strand_layer: string | null;
  pole_layer: string | null;
  equipment_layers: string[] | null;
  mask_enabled: boolean;
  ocr_done: boolean;
  equipment_done: boolean;
  poles_done: boolean;
  updated_at: string;
}

export interface DxfSegmentData {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DxfSegmentCache {
  id: string;
  session_id: string;
  layer: string;
  segments: DxfSegmentData[];
  created_at: string;
}

// Summary info for the restore dialog
export interface SessionSummary {
  session: Session;
  project: Project;
  config: SessionConfig | null;
  counts: {
    digit_results: number;
    equipment_shapes: number;
    poles: number;
    cable_spans: number;
    has_boundary: boolean;
  };
}

export interface FullSession {
  session: Session;
  config: SessionConfig | null;
  digit_results: DigitResult[];
  cable_spans: CableSpan[];
  span_operations: SpanOperation[];
  poles: Pole[];
  equipment_shapes: EquipmentShape[];
  trashed_spans: TrashedSpan[];
  boundary: BoundaryPoint[] | null;
  dxf_segments: Record<string, DxfSegmentData[]>;
}
