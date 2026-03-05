export interface Segment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface DigitResult {
    digit_id: number;
    value: string;
    corrected_value: string | null;
    confidence: number;
    needs_review: boolean;
    bbox: [number, number, number, number];
    center_x: number;
    center_y: number;
    crop_b64: string;
}

export interface DxfLayerData {
    name: string;
    visible: boolean;
    color: string;
    segmentCount: number;
}

export type PipelineStatus = "idle" | "processing" | "done" | "error";

export type FilterMode = "all" | "review" | "corrected";

export type Step = 1 | 2 | 3 | 4;