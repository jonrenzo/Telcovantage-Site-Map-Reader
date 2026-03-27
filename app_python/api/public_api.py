"""
app_python/api/public_api.py
═════════════════════════════════════════════════════════════════════════════
Public Integration API  —  Strand Line and Equipment Identifier
─────────────────────────────────────────────────────────────────────────────

All endpoints are prefixed with  /api/v1/

Every response follows the envelope:
    {
        "ok":   true | false,
        "data": <payload>,       # present when ok=true
        "error": "<message>"     # present when ok=false
    }

Endpoints
─────────────────────────────────────────────────────────────────────────────
  GET  /api/v1/health
  GET  /api/v1/status
  GET  /api/v1/ocr/results
  GET  /api/v1/ocr/segments
  GET  /api/v1/poles
  GET  /api/v1/equipment
  GET  /api/v1/cable_spans
  POST /api/v1/export/ocr
  POST /api/v1/export/poles
  POST /api/v1/bulk               ← Bulk upload poles & spans to Planner API
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Blueprint, current_app, jsonify, request

# ── Blueprint ──────────────────────────────────────────────────────────────────
public_api = Blueprint("public_api", __name__, url_prefix="/api/v1")


# ── Helpers ───────────────────────────────────────────────────────────────────


def _ok(data: Any, status: int = 200):
    """Wrap a successful payload in the standard envelope."""
    return jsonify({"ok": True, "data": data}), status


def _err(message: str, status: int = 400):
    """Wrap an error message in the standard envelope."""
    return jsonify({"ok": False, "error": message}), status


def _get_state():
    """Retrieve the main OCR pipeline state dict from the Flask app context."""
    return current_app.config.get("PIPELINE_STATE", {})


def _get_scan_state():
    """Retrieve the equipment scan state dict from the Flask app context."""
    return current_app.config.get("SCAN_STATE", {})


def _get_pole_state():
    """Retrieve the pole scan state dict from the Flask app context."""
    return current_app.config.get("POLE_STATE", {})


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/health
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/health", methods=["GET"])
def health():
    """
    Liveness check — always returns 200 when the server is running.

    Response
    --------
    {
        "ok": true,
        "data": {
            "service": "strand-identifier",
            "version": "1.0.0",
            "model_loaded": true | false
        }
    }
    """
    model_ready = Path("cad_digit_model.pt").exists()
    return _ok(
        {
            "service": "strand-identifier",
            "version": "1.0.0",
            "model_loaded": model_ready,
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/status
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/status", methods=["GET"])
def status():
    """
    Full pipeline status snapshot — shows all three subsystems in one call.

    Response
    --------
    {
        "ok": true,
        "data": {
            "dxf_path": "uploads/drawing.dxf" | null,
            "ocr": {
                "status":   "idle"|"processing"|"done"|"error",
                "progress": 42,
                "total":    200,
                "error":    null | "<message>"
            },
            "equipment": {
                "status":   "idle"|"processing"|"done"|"error",
                "progress": 5,
                "total":    12,
                "count":    38,
                "error":    null | "<message>"
            },
            "poles": {
                "status":   "idle"|"processing"|"done"|"error",
                "layer":    "POLE" | null,
                "progress": 10,
                "total":    10,
                "count":    10,
                "error":    null | "<message>"
            }
        }
    }
    """
    state = _get_state()
    scan_state = _get_scan_state()
    pole_state = _get_pole_state()

    return _ok(
        {
            "dxf_path": state.get("dxf_path"),
            "ocr": {
                "status": state.get("status", "idle"),
                "progress": state.get("progress", 0),
                "total": state.get("total", 0),
                "error": state.get("error"),
            },
            "equipment": {
                "status": scan_state.get("status", "idle"),
                "progress": scan_state.get("progress", 0),
                "total": scan_state.get("total", 0),
                "count": len(scan_state.get("shapes", [])),
                "error": scan_state.get("error"),
            },
            "poles": {
                "status": pole_state.get("status", "idle"),
                "layer": pole_state.get("layer"),
                "progress": pole_state.get("progress", 0),
                "total": pole_state.get("total", 0),
                "count": len(pole_state.get("tags", [])),
                "error": pole_state.get("error"),
            },
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/ocr/results
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/ocr/results", methods=["GET"])
def ocr_results():
    """
    All OCR strand-digit results for the currently loaded DXF.

    Query Parameters
    ----------------
    include_crops : "true"|"false"  (default "false")
        When false, the base64 crop image is stripped to reduce payload size.
    needs_review  : "true"|"false"  (default – omit to return all)
        Filter to only uncertain/unreviewed readings.

    Response
    --------
    {
        "ok": true,
        "data": {
            "dxf_path": "uploads/drawing.dxf",
            "count": 127,
            "sum": 4320,
            "results": [
                {
                    "digit_id":        0,
                    "value":           "56",
                    "corrected_value": null | "56",
                    "final_value":     "56",
                    "confidence":      0.982,
                    "needs_review":    false,
                    "center_x":        143.22,
                    "center_y":        -87.45,
                    "bbox":            [141.1, -89.0, 145.3, -85.9],
                    "manual":          false,
                    "crop_b64":        null | "<base64 PNG>"
                },
                ...
            ]
        }
    }
    """
    state = _get_state()

    if state.get("status") not in ("done",):
        if state.get("status") == "idle":
            return _err("No OCR run has been started yet.", 404)
        if state.get("status") == "processing":
            return _err(
                "OCR is still processing. Check /api/v1/status for progress.", 202
            )
        if state.get("status") == "error":
            return _err(f"OCR pipeline failed: {state.get('error')}", 500)

    include_crops = request.args.get("include_crops", "false").lower() == "true"
    filter_review = request.args.get("needs_review", "").lower()

    raw_results = state.get("results", [])

    # Optional filter
    if filter_review == "true":
        raw_results = [r for r in raw_results if r.get("needs_review")]
    elif filter_review == "false":
        raw_results = [r for r in raw_results if not r.get("needs_review")]

    # Build output — compute final_value and optionally strip crop
    output = []
    total_sum = 0
    for r in raw_results:
        final = r.get("corrected_value") or r.get("value", "")
        try:
            total_sum += int(final)
        except (ValueError, TypeError):
            pass

        entry: Dict[str, Any] = {
            "digit_id": r.get("digit_id"),
            "value": r.get("value"),
            "corrected_value": r.get("corrected_value"),
            "final_value": final,
            "confidence": r.get("confidence"),
            "needs_review": r.get("needs_review"),
            "center_x": r.get("center_x"),
            "center_y": r.get("center_y"),
            "bbox": r.get("bbox"),
            "manual": r.get("manual", False),
            "crop_b64": r.get("crop_b64") if include_crops else None,
        }
        output.append(entry)

    return _ok(
        {
            "dxf_path": state.get("dxf_path"),
            "count": len(output),
            "sum": total_sum,
            "results": output,
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/ocr/segments
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/ocr/segments", methods=["GET"])
def ocr_segments():
    """
    Raw DXF stroke segments used for the most recent OCR scan.

    Useful for re-rendering the drawing on the consuming side.

    Response
    --------
    {
        "ok": true,
        "data": {
            "dxf_path": "uploads/drawing.dxf",
            "count": 8420,
            "segments": [
                {"x1": 0.0, "y1": 0.0, "x2": 1.5, "y2": 0.0},
                ...
            ]
        }
    }
    """
    state = _get_state()
    raw_segs = state.get("segments", [])

    segments = [{"x1": s.x1, "y1": s.y1, "x2": s.x2, "y2": s.y2} for s in raw_segs]

    return _ok(
        {
            "dxf_path": state.get("dxf_path"),
            "count": len(segments),
            "segments": segments,
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/poles
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/poles", methods=["GET"])
def poles():
    """
    All detected pole IDs for the currently loaded DXF.

    Query Parameters
    ----------------
    needs_review : "true"|"false"  (default – omit to return all)
    source       : "text"|"mtext"|"stroke"  (default – omit to return all)
    include_crops : "true"|"false"  (default "false")

    Response
    --------
    {
        "ok": true,
        "data": {
            "dxf_path": "uploads/drawing.dxf",
            "layer":    "POLE",
            "count":    45,
            "poles": [
                {
                    "pole_id":     0,
                    "name":        "T01",
                    "cx":          210.44,
                    "cy":          -103.22,
                    "bbox":        [209.0, -104.5, 211.8, -101.9],
                    "layer":       "POLE",
                    "source":      "stroke",
                    "ocr_conf":    0.96,
                    "needs_review": false,
                    "crop_b64":    null | "<base64 PNG>"
                },
                ...
            ]
        }
    }
    """
    pole_state = _get_pole_state()

    status = pole_state.get("status", "idle")
    if status == "idle":
        return _err("No pole scan has been started yet.", 404)
    if status == "processing":
        return _err("Pole scan is still running. Check /api/v1/status.", 202)
    if status == "error":
        return _err(f"Pole scan failed: {pole_state.get('error')}", 500)

    include_crops = request.args.get("include_crops", "false").lower() == "true"
    filter_review = request.args.get("needs_review", "").lower()
    filter_source = request.args.get("source", "").lower()

    tags = pole_state.get("tags", [])

    if filter_review == "true":
        tags = [t for t in tags if t.get("needs_review")]
    elif filter_review == "false":
        tags = [t for t in tags if not t.get("needs_review")]

    if filter_source in ("text", "mtext", "stroke"):
        tags = [t for t in tags if t.get("source") == filter_source]

    output = []
    for t in tags:
        entry = {
            "pole_id": t.get("pole_id"),
            "name": t.get("name"),
            "cx": t.get("cx"),
            "cy": t.get("cy"),
            "bbox": t.get("bbox"),
            "layer": t.get("layer"),
            "source": t.get("source"),
            "ocr_conf": t.get("ocr_conf"),
            "needs_review": t.get("needs_review"),
            "crop_b64": t.get("crop_b64") if include_crops else None,
        }
        output.append(entry)

    return _ok(
        {
            "dxf_path": _get_state().get("dxf_path"),
            "layer": pole_state.get("layer"),
            "count": len(output),
            "poles": output,
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/equipment
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/equipment", methods=["GET"])
def equipment():
    """
    All detected equipment shapes for the currently loaded DXF.

    Query Parameters
    ----------------
    kind  : "circle"|"square"|"hexagon"|"rectangle"|"triangle"
            (default – omit to return all kinds)
    layer : exact layer name to filter by (default – omit to return all layers)

    Shape → Equipment Mapping
    -------------------------
    circle    → 2-Way Tap / Splitter
    square    → 4-Way Tap
    hexagon   → 8-Way Tap
    rectangle → Node or Amplifier  (disambiguate by layer name)
    triangle  → Line Extender

    Response
    --------
    {
        "ok": true,
        "data": {
            "dxf_path": "uploads/drawing.dxf",
            "count":    58,
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
                },
                ...
            ]
        }
    }
    """
    scan_state = _get_scan_state()

    status = scan_state.get("status", "idle")
    if status == "idle":
        return _err("No equipment scan has been started yet.", 404)
    if status == "processing":
        return _err("Equipment scan is still running. Check /api/v1/status.", 202)
    if status == "error":
        return _err(f"Equipment scan failed: {scan_state.get('error')}", 500)

    filter_kind = request.args.get("kind", "").lower()
    filter_layer = request.args.get("layer", "")

    shapes = scan_state.get("shapes", [])

    if filter_kind:
        shapes = [s for s in shapes if s.get("kind") == filter_kind]
    if filter_layer:
        shapes = [s for s in shapes if s.get("layer") == filter_layer]

    # Build summary count
    summary: Dict[str, int] = {}
    for s in scan_state.get("shapes", []):  # summary always on full unfiltered set
        summary[s["kind"]] = summary.get(s["kind"], 0) + 1

    output = [
        {
            "shape_id": s.get("shape_id"),
            "kind": s.get("kind"),
            "cx": s.get("cx"),
            "cy": s.get("cy"),
            "bbox": s.get("bbox"),
            "layer": s.get("layer"),
        }
        for s in shapes
    ]

    return _ok(
        {
            "dxf_path": _get_state().get("dxf_path"),
            "count": len(output),
            "summary": summary,
            "shapes": output,
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/v1/cable_spans
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/cable_spans", methods=["GET"])
def cable_spans():
    """
    All cable spans for the currently loaded DXF, with strand meter values
    matched from OCR results.

    Query Parameters
    ----------------
    include_segments : "true"|"false"  (default "false")
        When true, includes the full list of raw segment coordinates per span.
        This can be a large payload; only enable when needed.

    Response
    --------
    {
        "ok": true,
        "data": {
            "dxf_path":    "uploads/drawing.dxf",
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
                    "meter_value":   null | 56.0,
                    "cable_runs":    1,
                    "segment_count": 12,
                    "from_pole":     "T01" | null,
                    "to_pole":       "T02" | null,
                    "segments":      null | [{"x1":…,"y1":…,"x2":…,"y2":…}, …]
                },
                ...
            ]
        }
    }
    """
    import ezdxf as _ezdxf

    state = _get_state()
    dxf_path = state.get("dxf_path")

    if not dxf_path:
        return _err("No DXF has been loaded.", 404)

    include_segs = request.args.get("include_segments", "false").lower() == "true"

    try:
        # Re-use the helper functions that live in server.py via the app config
        build_fn = current_app.config.get("FN_BUILD_CABLE_SPANS")
        assign_fn = current_app.config.get("FN_ASSIGN_METER_VALUES")
        layers_fn = current_app.config.get("FN_LIST_LAYERS")
        find_layer_fn = current_app.config.get("FN_FIND_CABLE_LAYER")

        if not all([build_fn, assign_fn, layers_fn, find_layer_fn]):
            return _err("Server helpers not registered. Restart the server.", 500)

        doc = _ezdxf.readfile(dxf_path)
        layers = layers_fn(dxf_path)
        cable_layer = find_layer_fn(layers)

        if not cable_layer:
            return _ok(
                {
                    "dxf_path": dxf_path,
                    "cable_layer": None,
                    "count": 0,
                    "spans": [],
                }
            )

        spans = build_fn(doc, cable_layer)
        spans = assign_fn(spans, state.get("results", []))

        output = []
        for s in spans:
            entry: Dict[str, Any] = {
                "span_id": s["span_id"],
                "layer": s.get("layer"),
                "cx": s.get("cx"),
                "cy": s.get("cy"),
                "bbox": s.get("bbox"),
                "total_length": s.get("total_length"),
                "meter_value": s.get("meter_value"),
                "cable_runs": s.get("cable_runs", 1),
                "segment_count": s.get("segment_count"),
                "from_pole": s.get("from_pole"),
                "to_pole": s.get("to_pole"),
                "segments": s.get("segments") if include_segs else None,
            }
            output.append(entry)

        return _ok(
            {
                "dxf_path": dxf_path,
                "cable_layer": cable_layer,
                "count": len(output),
                "spans": output,
            }
        )

    except Exception as exc:
        import traceback

        traceback.print_exc()
        return _err(str(exc), 500)


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/export/ocr
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/export/ocr", methods=["POST"])
def export_ocr():
    """
    Trigger an Excel export of OCR results and return a download URL.

    Request Body (JSON, optional)
    ------------------------------
    {
        "corrections": { "<digit_id>": "<corrected_value>", ... }
    }

    Corrections supplied here are merged on top of any already stored on
    the server — useful for pushing live UI edits before exporting.

    Response
    --------
    {
        "ok": true,
        "data": {
            "download_url": "/api/download?file=drawing_results.xlsx",
            "path":         "drawing_results.xlsx"
        }
    }
    """
    state = _get_state()

    if state.get("status") != "done":
        return _err("OCR must complete before exporting.", 400)

    body = request.get_json(silent=True) or {}
    corrections = body.get("corrections", {})

    # Apply any caller-supplied corrections
    for r in state.get("results", []):
        did = str(r["digit_id"])
        if did in corrections and corrections[did] is not None:
            r["corrected_value"] = corrections[did]

    export_fn = current_app.config.get("FN_EXPORT_EXCEL")
    if not export_fn:
        return _err("Export helper not registered. Restart the server.", 500)

    path, err = export_fn(state["results"], state["dxf_path"])
    if err:
        return _err(err, 500)

    return _ok(
        {
            "download_url": f"/api/download?file={path}",
            "path": path,
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/export/poles
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/export/poles", methods=["POST"])
def export_poles():
    """
    Trigger an Excel export of pole IDs and return a download URL.

    Request Body (JSON, optional)
    ------------------------------
    {
        "overrides": { "<pole_id>": "<corrected_name>", ... }
    }

    Overrides are merged on top of server-side names before exporting,
    so the caller can push UI renames without a separate round-trip.

    Response
    --------
    {
        "ok": true,
        "data": {
            "download_url": "/api/download?file=drawing_pole_ids.xlsx",
            "path":         "drawing_pole_ids.xlsx"
        }
    }
    """
    pole_state = _get_pole_state()
    state = _get_state()

    tags = pole_state.get("tags", [])
    if not tags:
        return _err("No pole tags to export. Run a scan first.", 400)

    body = request.get_json(silent=True) or {}
    overrides = body.get("overrides", {})

    # Apply caller-supplied name overrides (do not mutate server state)
    export_tags = []
    for t in tags:
        pid_str = str(t.get("pole_id", ""))
        entry = dict(t)
        if pid_str in overrides:
            entry["name"] = overrides[pid_str]
        export_tags.append(entry)

    export_fn = current_app.config.get("FN_EXPORT_POLES_EXCEL")
    if not export_fn:
        return _err("Export helper not registered. Restart the server.", 500)

    dxf_path = state.get("dxf_path") or "pole_export"
    path, err = export_fn(export_tags, dxf_path)
    if err:
        return _err(err, 500)

    return _ok(
        {
            "download_url": f"/api/download?file={path}",
            "path": path,
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/bulk
# ─────────────────────────────────────────────────────────────────────────────


@public_api.route("/bulk", methods=["POST"])
def bulk_post():
    """
    Bulk upload poles and spans from current session to TelcoVantage Planner API.

    This endpoint collects poles and cable spans from the current scan session,
    transforms them into the Planner API format, and uploads them as a single
    bulk request to the ngrok-exposed Planner API.

    Request Body (JSON)
    -------------------
    {
        "project_id": 1,                      # Required - Planner project ID
        "node": {                             # Required - Node configuration
            "node_id": "TY-5232",             # Required - Unique node identifier
            "node_name": "Taytay Area 1",     # Optional
            "city": "Taytay",                 # Optional
            "province": "Rizal",              # Optional
            "team": "Team Alpha",             # Optional
            "date_start": "2026-03-24",       # Optional (YYYY-MM-DD)
            "due_date": "2026-04-30"          # Optional (YYYY-MM-DD)
        },
        "compress": false                     # Optional - gzip compress upload
    }

    Poles and cable spans are automatically taken from the current scan session
    (POLE_STATE and cable span data). Equipment counts (amplifier, extender, tsc)
    are derived from SCAN_STATE.

    Response (201 Created)
    ----------------------
    {
        "ok": true,
        "data": {
            "message": "Bulk upload successful.",
            "node": { "id": 10, "node_id": "TY-5232", "action": "created" },
            "poles": [
                { "pole_code": "001", "id": 55, "action": "created" },
                ...
            ],
            "pole_spans": [
                { "pole_span_code": "TY-5232-001-002", "id": 200, "action": "created" },
                ...
            ],
            "summary": {
                "poles_count": 15,
                "pole_spans_count": 12
            }
        }
    }

    Error Responses
    ---------------
    400: Missing required fields or no session data
    500: Planner API error or server misconfiguration
    """
    import ezdxf as _ezdxf

    from app_python.services.planner_auth import auth
    from app_python.planner_config import ENABLE_PLANNER_INTEGRATION

    # ── Validate request body ─────────────────────────────────────────────────
    body = request.get_json(silent=True)
    if not body:
        return _err("Request body must be JSON", 400)

    project_id = body.get("project_id")
    if not project_id:
        return _err("project_id is required", 400)

    node_config = body.get("node")
    if not node_config or not node_config.get("node_id"):
        return _err("node.node_id is required", 400)

    node_id = node_config["node_id"]
    compress = body.get("compress", False)

    # ── Check Planner integration is enabled ──────────────────────────────────
    if not ENABLE_PLANNER_INTEGRATION:
        return _err("Planner API integration is disabled", 400)

    # ── Get session state ─────────────────────────────────────────────────────
    pole_state = _get_pole_state()
    scan_state = _get_scan_state()
    pipeline_state = _get_state()

    # Check pole scan has completed
    pole_status = pole_state.get("status", "idle")
    if pole_status == "idle":
        return _err("No pole scan has been started. Run pole scan first.", 400)
    if pole_status == "processing":
        return _err("Pole scan is still running. Wait for completion.", 400)
    if pole_status == "error":
        return _err(f"Pole scan failed: {pole_state.get('error')}", 400)

    tags = pole_state.get("tags", [])
    if not tags:
        return _err("No poles found in session. Run pole scan first.", 400)

    # ── Build poles list with sequential codes ────────────────────────────────
    poles = []
    pole_code_map = {}  # pole_name -> pole_code (e.g., "NPT1" -> "001")
    pole_code_counter = 1

    for tag in tags:
        pole_name = tag.get("corrected_name") or tag.get("name")
        if not pole_name:
            continue
        # Skip duplicates (use first occurrence)
        if pole_name in pole_code_map:
            continue

        pole_code = f"{pole_code_counter:03d}"
        pole_code_map[pole_name] = pole_code
        pole_code_counter += 1

        poles.append(
            {
                "pole_code": pole_code,
                "pole_name": pole_name,
                "map_latitude": tag.get("cy"),
                "map_longitude": tag.get("cx"),
            }
        )

    if not poles:
        return _err("No valid poles found in session.", 400)

    # ── Build cable spans (pole_spans) ────────────────────────────────────────
    pole_spans = []
    dxf_path = pipeline_state.get("dxf_path")

    if dxf_path:
        try:
            # Get helper functions from app config
            build_fn = current_app.config.get("FN_BUILD_CABLE_SPANS")
            assign_fn = current_app.config.get("FN_ASSIGN_METER_VALUES")
            layers_fn = current_app.config.get("FN_LIST_LAYERS")
            find_layer_fn = current_app.config.get("FN_FIND_CABLE_LAYER")

            if all([build_fn, assign_fn, layers_fn, find_layer_fn]):
                doc = _ezdxf.readfile(dxf_path)
                layers = layers_fn(dxf_path)
                cable_layer = find_layer_fn(layers)

                if cable_layer:
                    spans = build_fn(doc, cable_layer)
                    spans = assign_fn(spans, pipeline_state.get("results", []))

                    # Track pole pairs to generate unique span codes
                    pole_pair_counts = {}

                    for span in spans:
                        from_pole = span.get("from_pole")
                        to_pole = span.get("to_pole")

                        # Skip invalid spans
                        if not from_pole or not to_pole:
                            continue
                        if from_pole == to_pole:
                            continue
                        if (
                            from_pole not in pole_code_map
                            or to_pole not in pole_code_map
                        ):
                            continue

                        from_code = pole_code_map[from_pole]
                        to_code = pole_code_map[to_pole]

                        # Generate unique pole_span_code with index for duplicate pairs
                        pole_pair = tuple(sorted([from_code, to_code]))
                        occurrence = pole_pair_counts.get(pole_pair, 0) + 1
                        pole_pair_counts[pole_pair] = occurrence

                        if occurrence == 1:
                            pole_span_code = f"{node_id}-{from_code}-{to_code}"
                        else:
                            pole_span_code = (
                                f"{node_id}-{from_code}-{to_code}-{occurrence}"
                            )

                        pole_spans.append(
                            {
                                "from_pole_code": from_code,
                                "to_pole_code": to_code,
                                "pole_span_code": pole_span_code,
                                "length_meters": span.get("meter_value", 0) or 0,
                                "runs": span.get("cable_runs", 1),
                                "expected_cable": span.get("meter_value", 0) or 0,
                            }
                        )
        except Exception as e:
            # Log but continue - spans are optional
            print(f"[bulk] Warning: Could not build cable spans: {e}")

    # ── Calculate equipment counts from SCAN_STATE ────────────────────────────
    equipment_counts = {"amplifier": 0, "extender": 0, "tsc": 0}
    shapes = scan_state.get("shapes", [])

    for shape in shapes:
        kind = shape.get("kind", "")
        if kind in ("circle", "square", "hexagon"):
            equipment_counts["tsc"] += 1
        elif kind == "rectangle":
            equipment_counts["amplifier"] += 1
        elif kind == "triangle":
            equipment_counts["extender"] += 1

    # ── Build node data ───────────────────────────────────────────────────────
    total_strand_length = sum(s.get("length_meters", 0) for s in pole_spans)
    expected_cable = sum(s.get("expected_cable", 0) for s in pole_spans)

    node_data = {
        "node_id": node_id,
        "node_name": node_config.get("node_name"),
        "city": node_config.get("city"),
        "province": node_config.get("province"),
        "team": node_config.get("team"),
        "date_start": node_config.get("date_start"),
        "due_date": node_config.get("due_date"),
        "total_strand_length": total_strand_length,
        "expected_cable": expected_cable,
        "node_count": 1,
        **equipment_counts,
    }

    # Remove None values (let Planner API use defaults)
    node_data = {k: v for k, v in node_data.items() if v is not None}

    # ── Build final payload ───────────────────────────────────────────────────
    payload = {
        "project_id": project_id,
        "node": node_data,
        "poles": poles,
        "pole_spans": pole_spans,
    }

    # ── Upload to Planner API ─────────────────────────────────────────────────
    try:
        print(
            f"[bulk] Uploading to Planner API: {len(poles)} poles, {len(pole_spans)} spans"
        )
        result = auth.bulk_upload(payload, compress=compress)
        print(f"[bulk] Upload successful: {result.get('message', 'OK')}")
        return _ok(result.get("data", result)), 201

    except Exception as e:
        print(f"[bulk] Upload failed: {e}")
        return _err(f"Bulk upload failed: {str(e)}", 500)
