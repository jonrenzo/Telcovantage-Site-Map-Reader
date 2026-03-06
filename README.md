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
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

This system processes DXF engineering drawings to:

1. **Read strand numbers** using a trained CNN (Convolutional Neural Network) model that extracts digit clusters from DXF geometry and classifies them.
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
- Color theme switcher (Default, Contrast, Neon, Pastel)
- Collapsible sidebar with filter tabs (All / Uncertain / Fixed)

### DXF Viewer
- Full drawing render across all layers
- Per-layer visibility toggle with color coding
- Segment count per layer
- Show all / Hide all layer controls
- Pan, zoom, and fit-to-screen controls

### Equipment Detection
- Automatic scan of targeted layers based on shape kind:
  | Shape | Equipment Type | Target Layers |
  |-------|---------------|---------------|
  | Circle | 2 Way Tap | Splitter, TapOff |
  | Square | 4 Way Tap | TapOff |
  | Hexagon | 8 Way Tap | TapOff |
  | Rectangle | Node | Node, Amplifier |
  | Triangle | Line Extender | Extender |
- Optional boundary layer detection with dashed polygon overlay
- Filter by shape kind and layer
- Hover tooltips showing shape ID, type, and layer name
- Live breakdown stats bar

### Export
- Excel file with three sheets:
  - **Digit Results** — full OCR table with confidence, corrections, coordinates
  - **Summary** — condensed digit ID to final value list with total
  - **Equipment** — shape kind summary counts + full shape inventory

---

## System Requirements

| Component | Requirement |
|-----------|-------------|
| Python | 3.10 or later |
| Node.js | 18 or later |
| AutoCAD | 2022–2026 (for PDF conversion only) |
| OS | Windows (AutoCAD dependency), Linux/Mac for DXF-only mode |

### Python Dependencies
```
flask
flask-cors
ezdxf
opencv-python
torch
torchvision
pillow
openpyxl
numpy
```

### Node.js Dependencies
Managed via `package.json` — installed automatically with `npm install`.

---

## Project Structure

```
project-root/
│
├── server.py                  # Flask backend — all API routes and pipeline logic
├── cad_digit_model.pt         # Trained CNN model (required)
├── requirements.txt           # Python dependencies
├── start.bat                  # One-click start for Windows
├── start.sh                   # One-click start for Mac/Linux
│
├── uploads/                   # Uploaded DXF/PDF files (auto-created)
│
├── app_python/                # Shape and boundary detection services
│   ├── __init__.py
│   ├── config.py
│   ├── core/
│   │   └── math_helpers.py
│   ├── models/
│   │   ├── equipment.py
│   │   └── geometry.py
│   └── services/
│       ├── dxf_parser.py
│       ├── shape_service.py
│       └── boundary_service.py
│
└── cad-ocr-frontend/          # Next.js frontend
    ├── next.config.ts
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx
    │   │   └── api/           # Next.js route handlers (proxy to Flask)
    │   │       ├── upload/
    │   │       ├── dxf_segments/
    │   │       ├── scan_equipment/
    │   │       ├── scan_status/
    │   │       └── scan_results/
    │   ├── components/
    │   │   ├── Header.tsx
    │   │   ├── LoadScreen.tsx
    │   │   ├── ProcessingScreen.tsx
    │   │   ├── ReviewLayout.tsx
    │   │   ├── ReviewSidebar.tsx
    │   │   ├── MapCanvas.tsx
    │   │   ├── DetailPanel.tsx
    │   │   ├── ReviewModal.tsx
    │   │   ├── ExportDone.tsx
    │   │   ├── dxf/
    │   │   │   ├── DxfViewer.tsx
    │   │   │   ├── DxfLayerPanel.tsx
    │   │   │   └── DxfToolbar.tsx
    │   │   └── equipment/
    │   │       ├── EquipmentLayout.tsx
    │   │       ├── EquipmentPanel.tsx
    │   │       └── EquipmentCanvas.tsx
    │   ├── hooks/
    │   │   └── usePipeline.ts
    │   └── types/
    │       └── index.ts
    └── package.json
```

---

## Installation

### 1. Clone or download the project

```bash
git clone <your-repo-url>
cd project-root
```

### 2. Set up the Python environment

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Place the model file

Copy `cad_digit_model.pt` into the project root (same folder as `server.py`).

### 4. Install frontend dependencies

```bash
cd cad-ocr-frontend
npm install
```

---

## Running the App

### Option A — Convenience scripts (recommended)

**Windows:**
```bat
start.bat
```

**Mac/Linux:**
```bash
chmod +x start.sh
./start.sh
```

These activate the venv and start the Flask server automatically.

### Option B — Manual (two terminals)

**Terminal 1 — Flask backend:**
```bash
# Activate venv first
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux

python server.py
```

**Terminal 2 — Next.js frontend:**
```bash
cd cad-ocr-frontend
npm run dev
```

Then open **http://localhost:3000** in your browser.

---

## Usage Guide

### Step 1 — Load Drawing
- Drag and drop a `.dxf` or `.pdf` file onto the upload area, or click to browse.
- If uploading a PDF, AutoCAD will automatically convert it to DXF (this may take 1–2 minutes).
- A progress bar shows the upload phases: uploading → converting → reading layers → checking model.
- Select the layer containing strand numbers from the dropdown.
- Click **Read Drawing** to start.

### Step 2 — Processing
- The system extracts segments, clusters them into digit candidates, and runs the CNN model on each.
- A progress bar shows how many digits have been read.

### Step 3 — Review (three tabs)

#### OCR Review
- Green markers = high confidence readings.
- Amber markers = uncertain readings (below 95% confidence) — these need checking.
- Blue markers = manually corrected values.
- Click any marker to open the **Detail Panel** and correct the value if needed.
- Click **⚠ Check Uncertain** in the sidebar to step through all flagged readings one by one.
- Use the **color theme** picker (top-left of map) to change marker colors.
- Collapse the sidebar with the **chevron button** for a fuller map view.

#### DXF Viewer
- Renders the full drawing with all layers.
- Click **Layers** to open the layer panel — toggle individual layers on/off.
- Use **All on / All off** for quick visibility control.

#### Equipment
- Automatically scans targeted layers when the tab opens.
- Use the **Shape Kind** chips to show/hide specific equipment types.
- Expand **Layers** to filter by individual source layers.
- Set a **Boundary Layer** and click **Re-scan** to apply a boundary filter.
- Hover over any shape marker to see its ID, type, and layer.

### Step 4 — Export
- Click **⬇ Save to Excel** in the OCR Review sidebar.
- The file is saved to the same folder as the drawing and downloaded automatically.
- The Excel file contains three sheets: Digit Results, Summary, and Equipment.

---

## API Reference

All endpoints are served by Flask on `http://localhost:5000`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload a DXF or PDF file |
| `POST` | `/api/layers` | Get list of layers from a DXF file |
| `GET` | `/api/check_model` | Check if the CNN model file exists |
| `POST` | `/api/run` | Start the OCR pipeline |
| `GET` | `/api/status` | Poll OCR pipeline progress |
| `GET` | `/api/results` | Get OCR results and segments |
| `POST` | `/api/export` | Apply corrections and export to Excel |
| `GET` | `/api/download` | Download the exported Excel file |
| `GET` | `/api/dxf_segments` | Get all segments grouped by layer |
| `POST` | `/api/scan_equipment` | Start equipment shape scan |
| `GET` | `/api/scan_status` | Poll equipment scan progress |
| `GET` | `/api/scan_results` | Get detected shapes and boundary |

---

## Configuration

### OCR Pipeline (`server.py`)

| Constant | Default | Description |
|----------|---------|-------------|
| `CONNECT_TOL` | `0.20` | Tolerance for connecting nearby segment endpoints |
| `MIN_TOTAL_LENGTH` | `0.30` | Minimum total stroke length for a digit candidate |
| `SALVAGE_DIST_FACTOR` | `0.40` | Controls line removal during cluster salvage |
| `MAX_ASPECT` | `8.0` | Maximum width/height ratio for a digit candidate |
| Confidence threshold | `0.95` | Readings below this are flagged for review |

### Boundary Detection (`server.py` → `BOUNDARY_CONFIG`)

| Key | Default | Description |
|-----|---------|-------------|
| `snap_tol` | `0.60` | Endpoint snapping tolerance |
| `close_max_gap` | `2.50` | Maximum gap to close between boundary segments |
| `min_area` | `1e-6` | Minimum polygon area to be considered a boundary |

### Equipment Layer Mapping

The system targets specific layer name keywords per shape kind:

| Shape | Keywords Matched |
|-------|-----------------|
| Circle (2 Way Tap) | `splitter`, `tapoff`, `tap-off`, `tap_off` |
| Square (4 Way Tap) | `tapoff`, `tap-off`, `tap_off` |
| Hexagon (8 Way Tap) | `tapoff`, `tap-off`, `tap_off` |
| Rectangle (Node) | `node`, `amplifier`, `amp` |
| Triangle (Line Extender) | `extender`, `extend` |

To adjust these, edit `KIND_LAYER_MAP` inside `_run_full_scan` in `server.py`.

---

## Troubleshooting

### "Upload failed: Unexpected end of JSON input"
PDF conversion via AutoCAD takes a long time. The Next.js upload route handler has a 300-second timeout — if conversion exceeds this, check that AutoCAD is not hanging or displaying a dialog box.

### "Model file not found"
Make sure `cad_digit_model.pt` is in the same directory as `server.py`. The app will show a red status indicator on the load screen if the model is missing.

### Boundary not detected
Check the Flask terminal output for `[boundary]` log lines. Common causes:
- Wrong layer name selected — the layer must contain closed or nearly-closed line geometry.
- Gaps too large — increase `close_max_gap` in `BOUNDARY_CONFIG`.
- Too few segments — the boundary layer needs at least 3 segments.

### "Unexpected token '<'" errors in the browser console
A Next.js API route is missing — the proxy returned an HTML 404 page instead of JSON. Create a route handler in `src/app/api/<endpoint>/route.ts` that forwards the request to `http://localhost:5000/api/<endpoint>`.

### No shapes detected in Equipment tab
Check the Flask terminal for `[scan]` log output. Verify your DXF layer names contain the expected keywords (`tapoff`, `node`, `amplifier`, etc.). Layer names are case-insensitive in the matcher.

### PDF conversion fails
AutoCAD must be installed (2022 or later) and the `accoreconsole.exe` path must match one of the candidates in `pdf_to_dxf_autocad()`. Add your installed version's path to the `accore_candidates` list if it isn't already there.

---

## Notes

- The `uploads/` folder is created automatically on first use. Do not delete it while the server is running.
- The venv folder should not be committed to version control — add `venv/` to `.gitignore`.
- All canvas views (OCR map, DXF viewer, equipment map) stay mounted when switching tabs so pan/zoom state is preserved.
- The Excel export filename is `<drawing_name>_results.xlsx` and is saved in the working directory where `server.py` is run.
