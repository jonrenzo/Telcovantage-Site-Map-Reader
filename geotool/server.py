import os
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


@app.get("/api/get_overlay")
async def get_overlay(dxf_path: str):
    try:
        layers = ["road", "rdfin"]
        data = generate_overlay_png(dxf_path, layers)
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


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
