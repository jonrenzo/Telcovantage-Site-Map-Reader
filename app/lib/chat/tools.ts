// Tool definitions for the chatbot
// These define what functions the AI can call to get data

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  optional?: boolean;
  enum?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export const tools: Tool[] = [
  // File queries
  {
    name: "get_uploaded_files",
    description:
      "List all uploaded DXF/PDF files in the system, optionally filtered by folder name",
    parameters: {
      folder: {
        type: "string",
        description: "Filter files by folder name (e.g., 'SKY', 'Globe')",
        optional: true,
      },
    },
  },
  {
    name: "count_uploaded_files",
    description:
      "Count total number of uploaded files, optionally filtered by folder",
    parameters: {
      folder: {
        type: "string",
        description: "Filter by folder name",
        optional: true,
      },
    },
  },

  // Session summary
  {
    name: "get_session_summary",
    description:
      "Get a quick overview of the current session: currently loaded file, counts of all detected items (OCR results, poles, equipment), and scan statuses",
    parameters: {},
  },

  // OCR Results
  {
    name: "get_ocr_results",
    description:
      "Get OCR digit detection results (strand meter values) from the current scan",
    parameters: {
      needs_review: {
        type: "boolean",
        description: "If true, only return results that need human review",
        optional: true,
      },
      min_confidence: {
        type: "number",
        description:
          "Minimum confidence threshold (0.0-1.0) to filter results",
        optional: true,
      },
    },
  },
  {
    name: "calculate_total_strand_meters",
    description:
      "Calculate the total sum of all detected strand meter values from the OCR scan",
    parameters: {},
  },

  // Poles
  {
    name: "get_poles",
    description:
      "Get detected pole tags from the current scan, with optional filtering",
    parameters: {
      needs_review: {
        type: "boolean",
        description: "If true, only return poles that need human review",
        optional: true,
      },
      source: {
        type: "string",
        description: "Filter by detection source",
        optional: true,
        enum: ["text", "mtext", "stroke"],
      },
    },
  },

  // Equipment
  {
    name: "get_equipment",
    description:
      "Get detected equipment shapes (taps, nodes, amplifiers, etc.) from the current scan",
    parameters: {
      kind: {
        type: "string",
        description: "Filter by equipment shape type",
        optional: true,
        enum: ["circle", "square", "hexagon", "rectangle", "triangle"],
      },
      layer: {
        type: "string",
        description: "Filter by DXF layer name",
        optional: true,
      },
    },
  },

  // Cable Spans
  {
    name: "get_cable_spans",
    description:
      "Get cable span data including connections between poles and assigned meter values",
    parameters: {
      from_pole: {
        type: "string",
        description: "Filter spans starting from this pole",
        optional: true,
      },
      to_pole: {
        type: "string",
        description: "Filter spans ending at this pole",
        optional: true,
      },
    },
  },

  // Scan status
  {
    name: "get_scan_status",
    description:
      "Check the current status of OCR, pole, and equipment scans (idle, processing, done, error)",
    parameters: {},
  },

  // Actions
  {
    name: "export_results",
    description:
      "Export scan results to an Excel file. Returns download information.",
    parameters: {
      format: {
        type: "string",
        description: "What to export",
        optional: false,
        enum: ["ocr", "equipment", "poles", "all"],
      },
    },
  },
];

export type ToolName = (typeof tools)[number]["name"];

// Equipment type mapping for display
export const equipmentTypeNames: Record<string, string> = {
  circle: "2-Way Tap / Splitter",
  square: "4-Way Tap",
  hexagon: "8-Way Tap",
  rectangle: "Node / Amplifier",
  triangle: "Line Extender",
};
