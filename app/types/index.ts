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
    crop_b64:        string | null;
    manual?:         boolean;
    pole_id?:        string | null;
}

export type PipelineStatus = "idle" | "processing" | "done" | "error";
export type FilterMode = "all" | "review" | "corrected";
export type Step = 1 | 2 | 3 | 4;
export type EquipmentType = "generic" | "amplifier" | "node" | "extender";

export interface EquipmentShape {
    shape_id: number;
    kind: "circle" | "triangle" | "square" | "rectangle" | "hexagon" | "splitter";
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
    from_pole_id?: number | null;
    to_pole_id?: number | null;
    from_pole_x?: number | null;
    from_pole_y?: number | null;
    to_pole_x?: number | null;
    to_pole_y?: number | null;
    from_x?: number | null;
    from_y?: number | null;
    to_x?: number | null;
    to_y?: number | null;
}

export interface AsbuiltSite {
    id:         number;
    name:       string;
    node_count: number;
}

export interface AsbuiltNode {
    id:           number;
    node_id:      string;
    name:         string;
    full_label?:  string;
    status?:      string;
    report_type?: string | null;
    source_file?: string | null;
    pole_count?:  number;
    subcontractor_id?: number | null;
    subcontractor?: string | null;
    team_id?: number | null;
    team?: string | null;
}

export interface AsbuiltSubcontractor {
    id:   number;
    name: string;
}

export interface AsbuiltTeam {
    id:               number;
    name:             string;
    subcontractor_id: number;
}

export interface AsbuiltExportResult {
    message: string;
    data?: {
        node:          { id: number; node_id: string; name: string; report_type: string; source_file?: string };
        poles_created: string[];
        poles_updated: string[];
        spans_created: string[];
        spans_updated: string[];
        total_poles:   number;
        total_spans:   number;
        errors:        string[];
    };
}

export interface ManualNodeForm {
    node_id:       string;
    node_name:     string;
    region:        string;
    province:      string;
    city:          string;
    barangay_name: string;
}

export interface PoleAreaData {
    region:        string;
    province:      string;
    city:          string;
    barangay_name: string;
}

export interface AsbuiltPole {
    skycable_pole_id: number;
    pole_id:          number;
    pole_code:        string;
    sequence:         number;
    latitude:         number;
    longitude:        number;
    barangay_name?:   string;
    status:           string;
    date_start:       string | null;
    finished_at:      string | null;
    duration:         number | null;
}

export interface AsbuiltSpan {
    span_id:        number;
    from_pole_code: string;
    to_pole_code:   string;
    strand_length:  number;
    number_of_runs: number;
    expected_cable: number;
    status:         string;
    components: {
        node:         number;
        amplifier:    number;
        extender:     number;
        tsc:          number;
        powersupply:  number;
        ps_housing:   number;
    };
}

export interface VerifyNodeResponse {
    node: {
        id:            number;
        node_id:       string;
        name:          string;
        area:          string;
        region?:       string;
        province?:     string;
        city?:         string;
        barangay?:     string;
        report_type:   string;
        source_file:   string;
        status:        string;
    };
    poles: AsbuiltPole[];
    spans: AsbuiltSpan[];
}
