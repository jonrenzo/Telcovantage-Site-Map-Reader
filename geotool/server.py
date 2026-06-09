import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import List, Optional, Tuple

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .core import extract_cad_poles, transform_coordinate
from .geocode import geocode
from .overlay import (
    apply_affine_transform,
    generate_overlay_png,
    snap_and_discover_poles,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


def _backend_base_url() -> str:
    return (
        os.getenv("NEXT_PUBLIC_BACKEND_URL")
        or os.getenv("GEOTOOL_BACKEND_URL")
        or os.getenv("FLASK_API_URL")
        or "http://127.0.0.1:5050"
    ).rstrip("/")


def _backend_request(path: str, method: str = "GET", body: Optional[dict] = None):
    url = f"{_backend_base_url()}{path}"
    headers = {"Accept": "application/json"}
    payload = None

    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=payload, headers=headers, method=method)

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}, response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw), exc.code
        except json.JSONDecodeError:
            return {"ok": False, "error": raw or str(exc)}, exc.code
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot reach As-built backend at {_backend_base_url()}: {exc.reason}"
        ) from exc


def _normalize_path(path: Optional[str]) -> str:
    if not path:
        return ""
    return os.path.normcase(os.path.normpath(path.replace("/", os.sep)))


@app.get("/")
async def get_index():
    dirname = os.path.dirname(__file__)
    path = os.path.join(dirname, "index.html")
    with open(path, "r") as f:
        return HTMLResponse(content=f.read())


@app.get("/api/geocode")
async def api_geocode(loc: str):
    return geocode(loc)


class CadPole(BaseModel):
    id: int
    name: str
    cx: float
    cy: float


class MapRequest(BaseModel):
    dxf_path: Optional[str] = None
    anchors: List[Tuple[float, float]]
    cad_poles: List[CadPole] = []


class VisualMapRequest(BaseModel):
    dxf_path: str
    gps_bounds: dict
    cad_bounds: dict
    cad_poles: List[CadPole]


class GeoReferencePole(BaseModel):
    pole_id: Optional[int] = None
    name: Optional[str] = None
    layer: Optional[str] = None
    source: Optional[str] = None
    map_latitude: float
    map_longitude: float
    cad_x: float
    cad_y: float


class GeoReferenceSyncRequest(BaseModel):
    poles: List[GeoReferencePole]


@app.get("/api/get_overlay")
async def get_overlay(dxf_path: str):
    try:
        layers = ["road", "rdfin"]
        data = generate_overlay_png(dxf_path, layers)
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/asbuilt_poles")
async def get_asbuilt_poles(dxf_path: Optional[str] = None):
    try:
        status_payload, status_code = _backend_request("/api/v1/status")
        poles_payload, poles_code = _backend_request("/api/v1/poles")
    except RuntimeError as exc:
        return {"status": "error", "message": str(exc)}

    if status_code >= 400 or not status_payload.get("ok", False):
        return {
            "status": "error",
            "message": status_payload.get("error")
            or "Failed to read As-built session status.",
        }

    if poles_code >= 400 or not poles_payload.get("ok", False):
        return {
            "status": "error",
            "message": poles_payload.get("error")
            or "Failed to load poles from the As-built backend.",
        }

    status_data = status_payload.get("data", {})
    poles_data = poles_payload.get("data", {})
    active_dxf_path = poles_data.get("dxf_path") or status_data.get("dxf_path")

    warning = None
    if dxf_path and active_dxf_path:
        if _normalize_path(dxf_path) != _normalize_path(active_dxf_path):
            warning = (
                "GeoTool is attached to a different DXF than the active As-built "
                f"session. Requested: {dxf_path} | Active: {active_dxf_path}"
            )

    poles = [
        {
            "id": pole.get("pole_id"),
            "name": pole.get("name") or f"POLE_{pole.get('pole_id')}",
            "cx": pole.get("cx"),
            "cy": pole.get("cy"),
            "layer": pole.get("layer"),
            "source": pole.get("source"),
            "map_latitude": pole.get("map_latitude"),
            "map_longitude": pole.get("map_longitude"),
        }
        for pole in poles_data.get("poles", [])
    ]

    return {
        "status": "success",
        "dxf_path": active_dxf_path,
        "count": len(poles),
        "warning": warning,
        "poles": poles,
    }


@app.post("/api/asbuilt_poles/georeference")
async def sync_asbuilt_georeference(payload: GeoReferenceSyncRequest):
    body = (
        payload.model_dump()
        if hasattr(payload, "model_dump")
        else payload.dict()
    )

    try:
        backend_payload, backend_code = _backend_request(
            "/api/v1/poles/georeference", method="PATCH", body=body
        )
    except RuntimeError as exc:
        return {"status": "error", "message": str(exc)}

    if backend_code >= 400 or not backend_payload.get("ok", False):
        return {
            "status": "error",
            "message": backend_payload.get("error")
            or "Failed to sync georeferenced poles to the As-built backend.",
        }

    return {
        "status": "success",
        "data": backend_payload.get("data", {}),
    }


@app.post("/api/process_visual_map")
async def process_visual_map(payload: VisualMapRequest):
    if not payload.cad_poles:
        return {
            "status": "error",
            "message": "No poles received from As-built app.",
        }
        # Intercept text coordinates, snap them, AND discover nameless circles
    snapped_poles = snap_and_discover_poles(
        payload.dxf_path, payload.cad_poles, CadPole
    )

    mapped_poles = apply_affine_transform(
        snapped_poles, payload.cad_bounds, payload.gps_bounds
    )
    return {"status": "success", "poles": mapped_poles}


@app.post("/api/process_map")
async def process_map(payload: MapRequest):
    if not payload.cad_poles:
        return {
            "status": "error",
            "message": "No poles received from the As-built app. Please refresh or check connection.",
        }

    gps_coords = payload.anchors

    min_lat, max_lat = min(p[0] for p in gps_coords), max(p[0] for p in gps_coords)
    min_lon, max_lon = min(p[1] for p in gps_coords), max(p[1] for p in gps_coords)
    map_p1, map_p2 = (min_lat, min_lon), (max_lat, max_lon)

    # Discover nameless circles here too, just in case they skipped the visual overlay
    if payload.dxf_path:
        process_list = snap_and_discover_poles(
            payload.dxf_path, payload.cad_poles, CadPole
        )
    else:
        process_list = payload.cad_poles

    min_x, max_x = (
        min(p.cx for p in process_list),
        max(p.cx for p in process_list),
    )
    min_y, max_y = (
        min(p.cy for p in process_list),
        max(p.cy for p in process_list),
    )
    cad_p1, cad_p2 = (min_x, min_y), (max_x, max_y)

    mapped_poles = []
    for pole in process_list:
        lat, lon = transform_coordinate(
            (pole.cx, pole.cy), cad_p1, cad_p2, map_p1, map_p2
        )
        mapped_poles.append(
            {
                "id": pole.id,
                "name": pole.name,
                "lat": lat,
                "lon": lon,
                "cad_x": pole.cx,
                "cad_y": pole.cy,
            }
        )

    return {"status": "success", "poles": mapped_poles}
