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
    pole_id:  number;
    name:     string;
    cx:       number;
    cy:       number;
    bbox:     [number, number, number, number];
    layer:    string;
    crop_b64: string | null;
}