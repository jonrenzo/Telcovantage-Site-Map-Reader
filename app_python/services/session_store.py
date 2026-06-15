"""
Server-side Supabase persistence for DXF processing results.

Mirrors the table schema and upsert patterns from the Next.js frontend
(app/hooks/useDatabase.ts, app/hooks/useAutoSave.ts) so that Python-written
rows are indistinguishable from browser-written ones.

All public functions are no-ops when the Supabase client is unavailable
(get_client() returns None), so the server works fully offline.
"""

import hashlib
from pathlib import Path
from typing import Optional

from app_python.services.supabase_client import get_client


# ── checksum ──────────────────────────────────────────────────────────────────

def compute_checksum(dxf_path: str) -> str:
    """Real SHA-256 of file bytes (replaces the filename-as-checksum the frontend uses)."""
    h = hashlib.sha256()
    with open(dxf_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# ── project / session ─────────────────────────────────────────────────────────

def get_or_create_project_session(
    dxf_path: str, checksum: str
) -> tuple[Optional[str], Optional[str], bool]:
    """
    Return (project_id, session_id, is_new).

    Matches on checksum first (catches re-uploads of the same file under a
    different name).  Falls back to exact path match to stay consistent with
    the frontend's getOrCreateSessionForFile logic.

    Returns (None, None, False) if Supabase is unavailable.
    """
    sb = get_client()
    if not sb:
        return None, None, False

    file_name = Path(dxf_path).name

    # 1. Find existing project by checksum
    res = sb.table("projects").select("id").eq("dxf_checksum", checksum).execute()
    project_id: Optional[str] = None
    if res.data:
        project_id = res.data[0]["id"]
    else:
        # 2. Fall back to path match (keeps consistency with frontend)
        res2 = sb.table("projects").select("id").eq("dxf_file_path", dxf_path).execute()
        if res2.data:
            project_id = res2.data[0]["id"]
            # Update the checksum now that we have a real one
            sb.table("projects").update({"dxf_checksum": checksum}).eq("id", project_id).execute()

    if not project_id:
        ins = sb.table("projects").insert({
            "dxf_file_name": file_name,
            "dxf_checksum": checksum,
            "dxf_file_path": dxf_path,
        }).execute()
        project_id = ins.data[0]["id"]

    # 3. Find the active session for this project
    res3 = (
        sb.table("sessions")
        .select("id")
        .eq("project_id", project_id)
        .eq("is_active", True)
        .execute()
    )
    if res3.data:
        # Session already exists — return it as not-new (has user edits potentially)
        return project_id, res3.data[0]["id"], False

    # 4. Create a fresh session
    ses = sb.table("sessions").insert({
        "project_id": project_id,
        "name": file_name,
        "is_active": True,
    }).execute()
    session_id = ses.data[0]["id"]
    return project_id, session_id, True


# ── edit-safety guard ─────────────────────────────────────────────────────────

def session_has_user_edits(session_id: str) -> bool:
    """
    Return True if this session has any user-authored changes:
      - corrected digit values or manually-added digits
      - corrected pole names or manually-added poles
      - any span operations (split/pair/merge/delete …)
    """
    sb = get_client()
    if not sb:
        return False

    digits = (
        sb.table("digit_results")
        .select("digit_id")
        .eq("session_id", session_id)
        .not_.is_("corrected_value", "null")
        .limit(1)
        .execute()
    )
    if digits.data:
        return True

    manual_digits = (
        sb.table("digit_results")
        .select("digit_id")
        .eq("session_id", session_id)
        .eq("manual", True)
        .limit(1)
        .execute()
    )
    if manual_digits.data:
        return True

    manual_poles = (
        sb.table("poles")
        .select("pole_id")
        .eq("session_id", session_id)
        .eq("source", "manual")
        .limit(1)
        .execute()
    )
    if manual_poles.data:
        return True

    ops = (
        sb.table("span_operations")
        .select("id")
        .eq("session_id", session_id)
        .limit(1)
        .execute()
    )
    if ops.data:
        return True

    return False


# ── result writers ─────────────────────────────────────────────────────────────

def save_digit_results(session_id: str, results: list) -> None:
    sb = get_client()
    if not sb or not results:
        return
    rows = [
        {
            "session_id": session_id,
            "digit_id": r["digit_id"],
            "value": r.get("value", ""),
            "corrected_value": r.get("corrected_value"),
            "confidence": r.get("confidence", 0.0),
            "needs_review": r.get("needs_review", False),
            "center_x": r.get("center_x", 0.0),
            "center_y": r.get("center_y", 0.0),
            "bbox": r.get("bbox", []),
            "manual": r.get("manual", False),
        }
        for r in results
    ]
    sb.table("digit_results").upsert(rows, on_conflict="session_id,digit_id").execute()


def save_poles(session_id: str, poles: list) -> None:
    sb = get_client()
    if not sb or not poles:
        return
    rows = [
        {
            "session_id": session_id,
            "pole_id": p["pole_id"],
            "name": p.get("name", ""),
            "corrected_name": p.get("corrected_name"),
            "cx": p.get("cx", 0.0),
            "cy": p.get("cy", 0.0),
            "bbox": p.get("bbox", []),
            "layer": p.get("layer", ""),
            "source": p.get("source", "text"),
            "ocr_conf": p.get("ocr_conf"),
            "needs_review": p.get("needs_review", False),
        }
        for p in poles
    ]
    sb.table("poles").upsert(rows, on_conflict="session_id,pole_id").execute()


def save_equipment_shapes(session_id: str, shapes: list) -> None:
    sb = get_client()
    if not sb or not shapes:
        return
    rows = [
        {
            "session_id": session_id,
            "shape_id": s["shape_id"],
            "kind": s.get("kind", ""),
            "layer": s.get("layer", ""),
            "cx": s.get("cx", 0.0),
            "cy": s.get("cy", 0.0),
            "bbox": s.get("bbox", []),
        }
        for s in shapes
    ]
    sb.table("equipment_shapes").upsert(rows, on_conflict="session_id,shape_id").execute()


def save_cable_spans(session_id: str, spans: list) -> None:
    """Save cable spans and their child segments."""
    sb = get_client()
    if not sb or not spans:
        return

    span_rows = []
    segment_rows_by_span: list[tuple[dict, list]] = []

    for sp in spans:
        row = {
            "session_id": session_id,
            "span_id": sp["span_id"],
            "layer": sp.get("layer", ""),
            "cx": sp.get("cx", 0.0),
            "cy": sp.get("cy", 0.0),
            "bbox": sp.get("bbox", []),
            "total_length": sp.get("total_length", 0.0),
            "meter_value": sp.get("meter_value"),
            "from_pole": sp.get("from_pole"),
            "to_pole": sp.get("to_pole"),
            "is_deleted": False,
        }
        span_rows.append(row)
        segment_rows_by_span.append((row, sp.get("segments", [])))

    result = sb.table("cable_spans").upsert(
        span_rows, on_conflict="session_id,span_id"
    ).execute()

    if not result.data:
        return

    # Build a map span_id → db row id so we can attach child segments
    span_db_ids = {r["span_id"]: r["id"] for r in result.data}

    seg_rows = []
    for span_row, segments in segment_rows_by_span:
        db_id = span_db_ids.get(span_row["span_id"])
        if not db_id:
            continue
        for idx, seg in enumerate(segments):
            seg_rows.append({
                "cable_span_id": db_id,
                "segment_index": idx,
                "x1": seg["x1"],
                "y1": seg["y1"],
                "x2": seg["x2"],
                "y2": seg["y2"],
            })

    if seg_rows:
        sb.table("cable_segments").upsert(
            seg_rows, on_conflict="cable_span_id,segment_index"
        ).execute()


def save_dxf_segments(session_id: str, segments_by_layer: dict) -> None:
    """
    segments_by_layer: {layer_name: [{x1,y1,x2,y2,is_hatch}, ...], ...}
    """
    sb = get_client()
    if not sb or not segments_by_layer:
        return
    rows = [
        {"session_id": session_id, "layer": layer, "segments": segs}
        for layer, segs in segments_by_layer.items()
    ]
    sb.table("dxf_segments").upsert(rows, on_conflict="session_id,layer").execute()


def save_session_config(
    session_id: str,
    *,
    strand_layer: Optional[str] = None,
    pole_layer: Optional[str] = None,
    equipment_layers: Optional[list] = None,
    ocr_done: bool = False,
    equipment_done: bool = False,
    poles_done: bool = False,
) -> None:
    sb = get_client()
    if not sb:
        return
    sb.table("session_config").upsert(
        {
            "session_id": session_id,
            "strand_layer": strand_layer,
            "pole_layer": pole_layer,
            "equipment_layers": equipment_layers or [],
            "ocr_done": ocr_done,
            "equipment_done": equipment_done,
            "poles_done": poles_done,
        },
        on_conflict="session_id",
    ).execute()


# ── convenience: save everything at once ─────────────────────────────────────

def save_full_results(
    session_id: str,
    *,
    digit_results: list,
    poles: list,
    equipment_shapes: list,
    cable_spans: list,
    dxf_segments_by_layer: dict,
    strand_layers: list,
    pole_layers: list,
    equipment_layers: list,
) -> None:
    """Write all precomputed results to Supabase in one call."""
    save_digit_results(session_id, digit_results)
    save_poles(session_id, poles)
    save_equipment_shapes(session_id, equipment_shapes)
    save_cable_spans(session_id, cable_spans)
    save_dxf_segments(session_id, dxf_segments_by_layer)
    save_session_config(
        session_id,
        strand_layer=strand_layers[0] if strand_layers else None,
        pole_layer=pole_layers[0] if pole_layers else None,
        equipment_layers=equipment_layers,
        ocr_done=bool(digit_results),
        equipment_done=bool(equipment_shapes),
        poles_done=bool(poles),
    )
    print(f"[session_store] saved session {session_id}: "
          f"{len(digit_results)} digits, {len(poles)} poles, "
          f"{len(equipment_shapes)} shapes, {len(cable_spans)} spans")
