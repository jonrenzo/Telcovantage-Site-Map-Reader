import base64
import io
import math

import ezdxf
import matplotlib.pyplot as plt
import numpy as np
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend


def generate_overlay_png(dxf_filepath, target_layers):
    """Renders specific DXF layers to a high-res transparent PNG."""
    doc = ezdxf.readfile(dxf_filepath)
    msp = doc.modelspace()

    # 1. Filter out unwanted layers using PARTIAL matching and FORCE COLOR
    safe_keywords = [kw.lower() for kw in target_layers]

    for entity in list(msp):
        layer_name = entity.dxf.layer.lower()
        if not any(keyword in layer_name for keyword in safe_keywords):
            entity.destroy()
        else:
            # Override the entity's color to Magenta (Color Index 6)
            try:
                entity.dxf.color = 6
                entity.dxf.lineweight = 50
            except Exception:
                pass

    # 2. Get exact bounding box of the remaining entities
    extents = bbox.extents(msp)
    if not extents.has_data:
        raise ValueError("No entities found! Check your layer names.")

    min_x, min_y = extents.extmin.x, extents.extmin.y
    max_x, max_y = extents.extmax.x, extents.extmax.y

    # Calculate the exact aspect ratio of the CAD bounding box
    width = max_x - min_x
    height = max_y - min_y
    aspect = height / width

    # Create the figure dynamically based on the aspect ratio
    fig_width = 10
    fig_height = 10 * aspect

    fig = plt.figure(figsize=(fig_width, fig_height), dpi=400)  # 4K resolution
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()

    # 3. Render to Matplotlib FIRST
    ctx = RenderContext(doc)
    out = MatplotlibBackend(ax)
    Frontend(ctx, out).draw_layout(msp, finalize=True)

    # 4. Enforce exact mathematical limits AFTER drawing to strip invisible margins
    ax.set_xlim(min_x, max_x)
    ax.set_ylim(min_y, max_y)

    # 5. Save to Base64 (strictly disabling bbox_inches='tight' which adds margins)
    buf = io.BytesIO()
    fig.savefig(
        buf,
        format="png",
        transparent=True,
        facecolor="none",
        pad_inches=0,
        bbox_inches=None,
    )
    plt.close(fig)

    png_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return {
        "image": f"data:image/png;base64,{png_base64}",
        "bounds": {
            "top_left": [min_x, max_y],
            "top_right": [max_x, max_y],
            "bottom_left": [min_x, min_y],
        },
    }


def apply_affine_transform(poles, cad_bounds, gps_bounds):
    """Maps CAD coordinates to GPS coordinates using a 3-point affine transformation."""
    cad_pts = np.array(
        [
            [cad_bounds["top_left"][0], cad_bounds["top_left"][1], 1],
            [cad_bounds["top_right"][0], cad_bounds["top_right"][1], 1],
            [cad_bounds["bottom_left"][0], cad_bounds["bottom_left"][1], 1],
        ]
    )

    gps_lats = np.array(
        [
            gps_bounds["top_left"][0],
            gps_bounds["top_right"][0],
            gps_bounds["bottom_left"][0],
        ]
    )
    gps_lons = np.array(
        [
            gps_bounds["top_left"][1],
            gps_bounds["top_right"][1],
            gps_bounds["bottom_left"][1],
        ]
    )

    A_lat = np.linalg.solve(cad_pts, gps_lats)
    A_lon = np.linalg.solve(cad_pts, gps_lons)

    mapped_poles = []
    for pole in poles:
        p_vec = np.array([pole.cx, pole.cy, 1])
        new_lat = np.dot(A_lat, p_vec)
        new_lon = np.dot(A_lon, p_vec)

        mapped_poles.append(
            {
                "id": pole.id,
                "name": pole.name,
                "lat": float(new_lat),
                "lon": float(new_lon),
                "cad_x": pole.cx,
                "cad_y": pole.cy,
            }
        )

    return mapped_poles


def snap_and_discover_poles(dxf_filepath, cad_poles, pole_model):
    """Snaps text to circles AND discovers unclaimed circles as new NPT poles."""
    doc = ezdxf.readfile(dxf_filepath)
    msp = doc.modelspace()

    # 1. Gather all circle coordinates from target layers
    circle_centers = []
    for entity in msp.query("CIRCLE"):
        if not hasattr(entity.dxf, "layer"):
            continue
        layer_name = entity.dxf.layer.lower()

        # Target layers containing pole, npt, or stp
        if "pole" in layer_name or "npt" in layer_name or "stp" in layer_name:
            circle_centers.append((entity.dxf.center.x, entity.dxf.center.y))

    if not circle_centers:
        return cad_poles

    claimed_circles = set()

    # 2. Let existing named poles claim their nearest physical circle
    for pole in cad_poles:
        min_dist = float("inf")
        nearest_idx = -1

        for idx, (cx, cy) in enumerate(circle_centers):
            dist = math.hypot(pole.cx - cx, pole.cy - cy)
            if dist < min_dist:
                min_dist = dist
                nearest_idx = idx

        # Snap the text coordinate to the circle and mark it as claimed
        if nearest_idx != -1:
            pole.cx = circle_centers[nearest_idx][0]
            pole.cy = circle_centers[nearest_idx][1]
            claimed_circles.add(nearest_idx)

    # 3. Process the remaining UNCLAIMED circles into NPTs
    # Find the highest existing ID so we don't cause database conflicts
    existing_ids = {p.id for p in cad_poles}
    next_id = max(existing_ids) + 1 if existing_ids else 10000

    enriched_poles = list(cad_poles)

    for idx, (cx, cy) in enumerate(circle_centers):
        if idx not in claimed_circles:
            # FIX: Lowered the threshold to 0.001 to stop it from deleting circles that are just close together
            is_duplicate = any(
                math.hypot(cx - p.cx, cy - p.cy) < 0.001 for p in enriched_poles
            )

            if not is_duplicate:
                # Create a brand new pole object for the nameless circle
                new_pole = pole_model(
                    id=next_id, name="NPT", cx=cx, cy=cy
                )
                enriched_poles.append(new_pole)
                next_id += 1

    return enriched_poles
