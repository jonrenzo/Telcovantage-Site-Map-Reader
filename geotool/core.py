import math

import ezdxf


def extract_cad_poles(dxf_filepath, layer_keywords):
    doc = ezdxf.readfile(dxf_filepath)
    msp = doc.modelspace()
    local_coordinates = []
    safe_keywords = [kw.lower() for kw in layer_keywords]

    for circle in msp.query("CIRCLE"):
        layer_name = circle.dxf.layer.lower()
        if any(keyword in layer_name for keyword in safe_keywords):
            local_coordinates.append((circle.dxf.center.x, circle.dxf.center.y))
    return local_coordinates


def transform_coordinate(point, cad_p1, cad_p2, map_p1, map_p2):
    dx_cad = cad_p2[0] - cad_p1[0]
    dy_cad = cad_p2[1] - cad_p1[1]
    dx_map = map_p2[1] - map_p1[1]
    dy_map = map_p2[0] - map_p1[0]

    dist_cad = math.hypot(dx_cad, dy_cad)
    dist_map = math.hypot(dx_map, dy_map)
    scale = dist_map / dist_cad

    angle_cad = math.atan2(dy_cad, dx_cad)
    angle_map = math.atan2(dy_map, dx_map)
    angle_diff = angle_map - angle_cad

    vx = point[0] - cad_p1[0]
    vy = point[1] - cad_p1[1]

    new_x = (vx * math.cos(angle_diff) - vy * math.sin(angle_diff)) * scale
    new_y = (vx * math.sin(angle_diff) + vy * math.cos(angle_diff)) * scale

    final_lon = map_p1[1] + new_x
    final_lat = map_p1[0] + new_y
    return (final_lat, final_lon)
