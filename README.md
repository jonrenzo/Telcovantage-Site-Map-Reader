# Strand Line and Equipment Identifier

A full-stack engineering tool for automatically reading strand numbers and detecting equipment shapes from DXF/PDF CAD drawings. Built with a Flask backend (Python CNN model) and a Next.js 15 + TypeScript + Tailwind CSS frontend.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [System Requirements](#system-requirements)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [Usage Guide](#usage-guide)
- [Integration API (v1)](#integration-api-v1)
- [Internal API Reference](#internal-api-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

This system processes DXF engineering drawings to:

1. **Read strand numbers** using a trained CNN model that extracts digit clusters from DXF geometry and classifies them.
2. **Detect equipment shapes** (taps, nodes, extenders) across relevant layers using geometric pattern recognition.
3. **Export results** to a formatted Excel file with digit readings, equipment counts, and summaries.

Uploaded PDFs are automatically converted to DXF using AutoCAD before processing.

---

## Features

### OCR Review
- Automatic digit detection and reading from a selected DXF layer
- Confidence threshold flagging — readings below 95% confidence are flagged for human review
- Interactive pan/zoom canvas with clickable digit markers
- Card-by-card review modal for uncertain readings
- Manual correction with inline editing

### DXF Viewer
- Full drawing render across all layers
- Per-layer visibility toggle with color coding
- Pan, zoom, and fit-to-screen controls

### Equipment Detection
- Automatic scan of targeted layers based on shape kind

### Pole ID Detection
- Automatic TrOCR-based OCR for stroked and text-entity pole labels
- Two-pass rotation sweep for labels at any orientation

### Export
- Excel file with Digit Results, Summary, and Equipment sheets

---

## System Requirements

| Component | Requirement |
|-----------|-------------|
| Python | 3.10 or later |
| Node.js | 18 or later |
| AutoCAD | 2022–2026 (for PDF conversion only) |
| OS | Windows (AutoCAD dependency), Linux/Mac for DXF-only mode |

---

## Project Structure

```
project-root/
├── server.py                         # Flask backend — all API routes
├── app_python/
│   ├── api/
│   │   ├── routes.py                 # Legacy internal API
│   │   └── public_api.py             # ← NEW: Integration API v1
│   └── services/
│       ├── pole_ocr.py
│       ├── strand_ocr.py
│       └── ...
└── app/                              # Next.js frontend
```

---

## Installation

```bash
python -m venv venv
venv\Scripts\activate          # Windows
source venv/bin/activate       # Mac/Linux
pip install -r requirements.txt
cd cad-ocr-frontend && npm install
```

---

## Running the App

**Windows:**
```bat
start.bat
```

**Mac/Linux:**
```bash
./start.sh
```

Open **http://localhost:3000** in your browser.

---

## Usage Guide

1. Upload a `.dxf` or `.pdf` file from the Load screen.
2. Select the strand layer and click **Read Drawing**.
3. Review OCR results, correct uncertain readings.
4. Use the **Pole IDs** tab to detect and name pole labels.
5. Use the **Equipment** tab to detect taps, nodes, and extenders.
6. Export results to Excel.

---

## Integration API (v1)

This system exposes a stable, versioned REST API at `/api/v1/` for consumption by external systems (billing systems, GIS platforms, network inventory tools, etc.).

### Applying the API to your server

The integration API lives in `app_python/api/public_api.py`. Three small edits to `server.py` activate it — see `server_patch.py` for exact copy-paste instructions.

### Base URL

| Environment | Base URL |
|-------------|----------|
| Local dev   | `http://localhost:5000` |
| Render (prod) | `https://<your-render-slug>.onrender.com` |

All v1 routes are prefixed: **`/api/v1/`**

### Response Envelope

Every response — success or failure — uses this envelope:

```json
// Success
{
    "ok":   true,
    "data": { ... }
}

// Error
{
    "ok":    false,
    "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200  | Success |
| 202  | Accepted — operation still in progress, poll `/api/v1/status` |
| 400  | Bad request / precondition not met |
| 404  | Resource not found / no scan run yet |
| 500  | Server-side error |

---

### Endpoints

---

#### `GET /api/v1/health`

Liveness check. Always returns 200 when the server is up.

**Response**
```json
{
    "ok": true,
    "data": {
        "service":      "strand-identifier",
        "version":      "1.0.0",
        "model_loaded": true
    }
}
```

---

#### `GET /api/v1/status`

Full pipeline status snapshot for all three subsystems in one call. Use this to poll until processing completes before fetching results.

**Response**
```json
{
    "ok": true,
    "data": {
        "dxf_path": "uploads/site_plan.dxf",
        "ocr": {
            "status":   "done",
            "progress": 127,
            "total":    127,
            "error":    null
        },
        "equipment": {
            "status":   "done",
            "progress": 12,
            "total":    12,
            "count":    58,
            "error":    null
        },
        "poles": {
            "status":   "done",
            "layer":    "POLE",
            "progress": 45,
            "total":    45,
            "count":    45,
            "error":    null
        }
    }
}
```

**`status` values:** `"idle"` | `"processing"` | `"done"` | `"error"`

---

#### `GET /api/v1/ocr/results`

All strand-digit OCR results for the currently loaded DXF.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include_crops` | `true`/`false` | `false` | Include base64 PNG crops. Increases payload ~10×. |
| `needs_review` | `true`/`false` | *(omit)* | Filter to uncertain readings only (`true`) or confident readings only (`false`). |

**Response**
```json
{
    "ok": true,
    "data": {
        "dxf_path": "uploads/site_plan.dxf",
        "count":    127,
        "sum":      4320,
        "results": [
            {
                "digit_id":        0,
                "value":           "56",
                "corrected_value": null,
                "final_value":     "56",
                "confidence":      0.982,
                "needs_review":    false,
                "center_x":        143.22,
                "center_y":        -87.45,
                "bbox":            [141.1, -89.0, 145.3, -85.9],
                "manual":          false,
                "crop_b64":        null
            }
        ]
    }
}
```

**Field notes**
- `final_value` — use this field for calculations; it prefers `corrected_value` over the raw OCR `value`.
- `sum` — integer sum of all `final_value` fields (non-numeric values are skipped).
- `center_x` / `center_y` — DXF world coordinates; Y-axis is **inverted** (more negative = higher on drawing).
- `bbox` — `[minX, minY, maxX, maxY]` in DXF world coordinates.

**Error responses**
- `404` — No OCR run started yet.
- `202` — OCR is still processing.
- `500` — Pipeline error.

---

#### `GET /api/v1/ocr/segments`

Raw DXF stroke segments from the most recent OCR scan. Useful for re-rendering the drawing on the consuming side without fetching the full DXF file.

**Response**
```json
{
    "ok": true,
    "data": {
        "dxf_path": "uploads/site_plan.dxf",
        "count":    8420,
        "segments": [
            {"x1": 0.0, "y1": 0.0, "x2": 1.5,  "y2": 0.0},
            {"x1": 1.5, "y1": 0.0, "x2": 1.5,  "y2": 2.0}
        ]
    }
}
```

---

#### `GET /api/v1/poles`

All detected pole IDs for the currently loaded DXF.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `needs_review` | `true`/`false` | *(omit)* | Filter by review status. |
| `source` | `text`\|`mtext`\|`stroke` | *(omit)* | Filter by detection source. |
| `include_crops` | `true`/`false` | `false` | Include base64 PNG OCR crops. |

**Response**
```json
{
    "ok": true,
    "data": {
        "dxf_path": "uploads/site_plan.dxf",
        "layer":    "POLE",
        "count":    45,
        "poles": [
            {
                "pole_id":      0,
                "name":         "T01",
                "cx":           210.44,
                "cy":           -103.22,
                "bbox":         [209.0, -104.5, 211.8, -101.9],
                "layer":        "POLE",
                "source":       "stroke",
                "ocr_conf":     0.96,
                "needs_review": false,
                "crop_b64":     null
            }
        ]
    }
}
```

**Field notes**
- `source` — `"text"` / `"mtext"` = directly read from a CAD text entity (high reliability); `"stroke"` = recognised via TrOCR from drawn strokes (may need review).
- `ocr_conf` — `null` for text/mtext sources; `0.0–1.0` for stroke sources.
- `needs_review` — `true` when OCR confidence is below threshold or the result did not match the pole-ID pattern.

---

#### `GET /api/v1/equipment`

All detected equipment shapes for the currently loaded DXF.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `kind` | `circle`\|`square`\|`hexagon`\|`rectangle`\|`triangle` | *(omit)* | Filter by shape type. |
| `layer` | string | *(omit)* | Filter by exact DXF layer name. |

**Shape → Equipment mapping**

| Shape kind | Equipment type |
|------------|----------------|
| `circle`    | 2-Way Tap / Splitter |
| `square`    | 4-Way Tap |
| `hexagon`   | 8-Way Tap |
| `rectangle` | Node or Amplifier *(check `layer` to disambiguate)* |
| `triangle`  | Line Extender |

**Response**
```json
{
    "ok": true,
    "data": {
        "dxf_path": "uploads/site_plan.dxf",
        "count": 58,
        "summary": {
            "circle":    12,
            "square":     8,
            "hexagon":    5,
            "rectangle": 22,
            "triangle":  11
        },
        "shapes": [
            {
                "shape_id": 0,
                "kind":     "rectangle",
                "cx":       145.3,
                "cy":       -92.1,
                "bbox":     [143.0, -94.0, 147.6, -90.2],
                "layer":    "NODE"
            }
        ]
    }
}
```

**Field notes**
- `summary` — counts for the **full unfiltered** dataset regardless of query parameters. Useful for building dashboards without making multiple calls.
- `shape_id` — stable for a given scan session; resets on re-scan.

---

#### `GET /api/v1/cable_spans`

All cable spans with strand meter values matched from OCR results.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include_segments` | `true`/`false` | `false` | Include the full list of raw coordinate segments per span. Can be a large payload. |

**Response**
```json
{
    "ok": true,
    "data": {
        "dxf_path":    "uploads/site_plan.dxf",
        "cable_layer": "cable",
        "count":       83,
        "spans": [
            {
                "span_id":       0,
                "layer":         "cable",
                "cx":            210.5,
                "cy":            -88.3,
                "bbox":          [205.0, -90.0, 216.0, -86.6],
                "total_length":  14.82,
                "meter_value":   56.0,
                "cable_runs":    1,
                "segment_count": 12,
                "from_pole":     "T01",
                "to_pole":       "T02",
                "segments":      null
            }
        ]
    }
}
```

**Field notes**
- `total_length` — physical DXF unit length of the span's stroke geometry.
- `meter_value` — OCR-matched strand value in metres, or `null` if no OCR result was close enough to this span.
- `cable_runs` — number of parallel cables in this span (set when the user uses the "pair" feature in the DXF Viewer).
- `from_pole` / `to_pole` — populated when the user connects poles in the DXF Viewer; `null` otherwise.

---

#### `POST /api/v1/export/ocr`

Trigger an Excel export of OCR results and get back a download URL.

**Request Body (JSON, optional)**
```json
{
    "corrections": {
        "3":  "72",
        "14": "108"
    }
}
```
`corrections` is a map of `digit_id → corrected_value` (both as strings). These are merged on top of any corrections already stored on the server, which allows external UIs to push live edits before exporting.

**Response**
```json
{
    "ok": true,
    "data": {
        "download_url": "/api/download?file=site_plan_results.xlsx",
        "path":         "site_plan_results.xlsx"
    }
}
```

Download the file with:
```
GET <base_url>/api/download?file=site_plan_results.xlsx
```

---

#### `POST /api/v1/export/poles`

Trigger an Excel export of pole IDs and get back a download URL.

**Request Body (JSON, optional)**
```json
{
    "overrides": {
        "0":  "T01",
        "1":  "T02"
    }
}
```
`overrides` is a map of `pole_id (as string) → corrected_name`. These are applied for this export only — server state is not mutated.

**Response**
```json
{
    "ok": true,
    "data": {
        "download_url": "/api/download?file=site_plan_pole_ids.xlsx",
        "path":         "site_plan_pole_ids.xlsx"
    }
}
```

---

#### `POST /api/v1/bulk`

Bulk upload poles and cable spans from the current scan session to the TelcoVantage Planner API.

This endpoint collects all detected poles and cable spans, transforms them to the Planner API format, and uploads them in a single bulk request via the ngrok-exposed Planner API.

**Prerequisites**
- Pole scan must be completed (`GET /api/v1/status` → `data.poles.status === "done"`)
- Planner API integration must be enabled in `planner_config.py`

**Request Body (JSON)**
```json
{
    "project_id": 1,
    "node": {
        "node_id": "TY-5232",
        "node_name": "Taytay Area 1",
        "city": "Taytay",
        "province": "Rizal",
        "team": "Team Alpha",
        "date_start": "2026-03-24",
        "due_date": "2026-04-30"
    },
    "compress": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | integer | **Yes** | Planner project ID |
| `node.node_id` | string | **Yes** | Unique node identifier (e.g., `"TY-5232"`) |
| `node.node_name` | string | No | Human-readable node name |
| `node.city` | string | No | City location |
| `node.province` | string | No | Province/state |
| `node.team` | string | No | Assigned team |
| `node.date_start` | string | No | Start date (`YYYY-MM-DD`) |
| `node.due_date` | string | No | Due date (`YYYY-MM-DD`) |
| `compress` | boolean | No | Gzip compress the upload (default: `false`) |

**What gets uploaded**
- **Poles**: All detected pole tags from `POLE_STATE`, with sequential codes (`001`, `002`, `003`...)
- **Pole Spans**: All cable spans with valid `from_pole`/`to_pole` connections
- **Equipment Counts**: Aggregated from `SCAN_STATE` (amplifiers, extenders, TSCs)
- **Strand Totals**: Summed from OCR meter values

**Response (201 Created)**
```json
{
    "ok": true,
    "data": {
        "node": {
            "id": 10,
            "node_id": "TY-5232",
            "action": "created"
        },
        "poles": [
            { "pole_code": "001", "id": 55, "action": "created" },
            { "pole_code": "002", "id": 56, "action": "created" }
        ],
        "pole_spans": [
            { "pole_span_code": "TY-5232-001-002", "id": 200, "action": "created" },
            { "pole_span_code": "TY-5232-002-003", "id": 201, "action": "created" }
        ],
        "summary": {
            "poles_count": 15,
            "pole_spans_count": 12
        }
    }
}
```

**Field notes**
- `action` — Either `"created"` or `"updated"`. Re-uploading the same data is safe (upsert behavior).
- `pole_code` — Sequential codes generated from pole order (`001`, `002`, etc.).
- `pole_span_code` — Format: `{node_id}-{from_code}-{to_code}` (e.g., `TY-5232-001-002`).

**Error responses**
- `400` — Missing required fields, no pole scan data, or Planner integration disabled.
- `500` — Planner API request failed.

**Example**
```bash
curl -X POST http://localhost:5000/api/v1/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": 1,
    "node": {
      "node_id": "TY-5232",
      "node_name": "Taytay Area 1",
      "city": "Taytay",
      "province": "Rizal"
    }
  }'
```

---

### Typical Integration Workflow

The recommended sequence for a consuming system is:

```
1. Upload DXF file
   POST /api/upload   { file: <binary> }
   → { path: "uploads/site_plan.dxf" }

2. Run OCR pipeline
   POST /api/run   { dxf_path, layer, model_path }

3. Poll until done
   GET /api/v1/status
   → { data.ocr.status: "processing" }  ← keep polling
   → { data.ocr.status: "done" }        ← proceed

4. Fetch results
   GET /api/v1/ocr/results
   GET /api/v1/poles
   GET /api/v1/equipment
   GET /api/v1/cable_spans

5. Export to Excel (optional)
   POST /api/v1/export/ocr   { corrections: { "3": "72" } }
   GET  /api/download?file=site_plan_results.xlsx

6. Bulk upload to Planner API (optional)
   POST /api/v1/bulk   { project_id: 1, node: { node_id: "TY-5232", ... } }
   → { data.summary.poles_count: 15, data.summary.pole_spans_count: 12 }
```

---

### CORS

CORS is enabled for all origins by default (`flask-cors`). In production, tighten this in `server.py`:

```python
CORS(app, origins=["https://your-consuming-system.example.com"])
```

---

### Authentication

The API has no built-in authentication. If you need to secure it, place a reverse proxy (nginx, Caddy) in front of the server and handle auth there, or use an API gateway.

---

## Internal API Reference

These are the original routes used by the Next.js frontend. External systems should use the `/api/v1/` endpoints above instead.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload a DXF or PDF file |
| `POST` | `/api/layers` | Get list of layers from a DXF file |
| `GET`  | `/api/check_model` | Check if the CNN model file exists |
| `POST` | `/api/run` | Start the OCR pipeline |
| `GET`  | `/api/status` | Poll OCR pipeline progress |
| `GET`  | `/api/results` | Get OCR results and segments |
| `POST` | `/api/export` | Apply corrections and export to Excel |
| `GET`  | `/api/download` | Download the exported Excel file |
| `GET`  | `/api/dxf_segments` | Get all segments grouped by layer |
| `POST` | `/api/scan_equipment` | Start equipment shape scan |
| `GET`  | `/api/scan_status` | Poll equipment scan progress |
| `GET`  | `/api/scan_results` | Get detected shapes and boundary |
| `GET`  | `/api/pole_tags` | Get all pole tags |
| `POST` | `/api/pole_tags/scan` | Start pole scan on a specific layer |
| `POST` | `/api/pole_tags/auto_scan` | Auto-detect pole layer and scan |
| `POST` | `/api/pole_tags/export` | Export pole tags to Excel |
| `GET`  | `/api/cable_spans` | Get cable spans with meter values |

---

## Configuration

### OCR Pipeline (`server.py`)

| Constant | Default | Description |
|----------|---------|-------------|
| `CONNECT_TOL` | `0.20` | Tolerance for connecting nearby segment endpoints |
| `MIN_TOTAL_LENGTH` | `0.15` | Minimum total stroke length for a digit candidate |
| `SALVAGE_DIST_FACTOR` | `0.25` | Controls line removal during cluster salvage |
| `MAX_ASPECT` | `8.0` | Maximum width/height ratio for a digit candidate |
| Confidence threshold | `0.95` | Readings below this are flagged for review |

### Boundary Detection

| Key | Default | Description |
|-----|---------|-------------|
| `snap_tol` | `0.60` | Endpoint snapping tolerance |
| `close_max_gap` | `2.50` | Maximum gap to close between boundary segments |
| `min_area` | `1e-6` | Minimum polygon area to be considered a boundary |

### Equipment Layer Mapping

| Shape | Keywords Matched |
|-------|-----------------|
| Circle (2 Way Tap) | `splitter`, `tapoff`, `tap-off`, `tap_off` |
| Square (4 Way Tap) | `tapoff`, `tap-off`, `tap_off` |
| Hexagon (8 Way Tap) | `tapoff`, `tap-off`, `tap_off` |
| Rectangle (Node/Amp) | `node`, `amplifier`, `amp` |
| Triangle (Extender) | `extender`, `extend` |

---

## Troubleshooting

### "Upload failed: Unexpected end of JSON input"
PDF conversion via AutoCAD takes a long time. If conversion exceeds the timeout, check that AutoCAD is not hanging or displaying a dialog box.

### "Model file not found"
Make sure `cad_digit_model.pt` is in the same directory as `server.py`.

### Boundary not detected
Check the Flask terminal output for `[boundary]` log lines. Common causes: wrong layer name, gaps too large (increase `close_max_gap`), too few segments.

### "Unexpected token '<'" errors in the browser console
A Next.js API route is missing — create a route handler in `src/app/api/<endpoint>/route.ts`.

### No shapes detected in Equipment tab
Verify your DXF layer names contain the expected keywords (`tapoff`, `node`, `amplifier`, etc.).

### `/api/v1/ocr/results` returns 202
The OCR pipeline has not finished. Poll `/api/v1/status` until `data.ocr.status === "done"`.
