export interface Segment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface DigitResult {
    digit_id:        number;
    value:           string;
    corrected_value: string | null;
    confidence:      number;
    needs_review:    boolean;
    bbox:            [number, number, number, number];
    center_x:        number;
    center_y:        number;
    crop_b64:        string | null;   // null for manually added entries
    manual?:         boolean;         // true for manually placed digits
    pole_id?:        string | null;   // assigned when pole backend is connected
}

export type PipelineStatus = "idle" | "processing" | "done" | "error";
export type FilterMode = "all" | "review" | "corrected";
export type Step = 1 | 2 | 3 | 4;
export type EquipmentType = "generic" | "amplifier" | "node" | "extender";

export interface EquipmentShape {
    shape_id: number;
    kind: "circle" | "triangle" | "square" | "rectangle" | "hexagon";
    bbox: [number, number, number, number];
    cx: number;
    cy: number;
    layer: string;
}

export interface BoundaryPoint {
    x: number;
    y: number;
}

export interface DxfLayerData {
    name: string;
    visible: boolean;
    color: string;
    segmentCount: number;
}

export interface PoleTag {
    pole_id:        number;
    name:           string;
    cx:             number;
    cy:             number;
    bbox:           [number, number, number, number];
    layer:          string;
    source:         string;
    crop_b64:       string | null;
    ocr_conf:       number  | null;
    needs_review:   boolean | null;
    map_latitude?:  number;
    map_longitude?: number;
}

export interface CableSpanExport {
    span_id: number;
    layer: string;
    bbox: [number, number, number, number];
    cx: number;
    cy: number;
    segment_count: number;
    total_length: number;
    meter_value?: number | null;
    cable_runs: number;
    from_pole?: string | null;
    to_pole?: string | null;
}

export interface AsbuiltSite {
    id:         number;
    name:       string;
    node_count: number;
}

export interface AsbuiltNode {
    id:          number;
    name:        string;
    full_label?: string;
    status?:     string;
    report_type?: string | null;
    pole_count?: number;
}

export interface AsbuiltExportResult {
    message: string;
    data?: {
        node:          { id: number; name: string; report_type: string };
        poles_created: string[];
        poles_updated: string[];
        spans_created: string[];
        spans_updated: string[];
        total_poles:   number;
        total_spans:   number;
        errors:        string[];
    };
}