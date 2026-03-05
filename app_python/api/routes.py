import os
import tempfile
import ezdxf
from flask import Blueprint, request, jsonify, current_app

from app_python.services.dxf_parser import extract_stroke_segments, list_layers
from app_python.services.boundary_service import build_boundary_mask, apply_boundary_filter
from app_python.services.shape_service import process_equipment_layer
from app_python.services.digit_service import cluster_segments, build_candidates
from app_python.visualization.plotters import plot_map_to_base64, plot_candidate_grid_to_base64

main_api = Blueprint('main_api', __name__)



@main_api.route('/process-dxf', methods=['POST'])
def process_dxf():
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    layer_name = request.form.get('layer', '0')
    process_type = request.form.get('type', 'digit') # 'digit', 'amplifier', 'node', 'extender'

    # 1. Save uploaded file to a temporary location safely
    fd, temp_path = tempfile.mkstemp(suffix=".dxf")
    try:
        with os.fdopen(fd, 'wb') as f:
            file.save(f)
        
        # Load DXF
        doc = ezdxf.readfile(temp_path)
        
        # 2. Build Boundary Mask (if enabled in config/request)
        boundary = None
        if not request.form.get('disable_boundary', False):
            boundary = build_boundary_mask(
                doc, 
                boundary_layer=current_app.config['BOUNDARY_LAYER'],
                snap_tol=current_app.config['CONNECT_TOL'], 
                close_max_gap=current_app.config['CONNECT_TOL'] * 6.0,
                min_area=current_app.config['BOUNDARY_MIN_AREA']
            )

        # 3. Extract core segments
        segments = extract_stroke_segments(doc, layer_name)
        if not segments:
            return jsonify({"error": f"No segments found on layer {layer_name}"}), 404

        # 4. Route logic based on processing type
        response_data = {"status": "success", "layer": layer_name, "counts": {}}
        
        if process_type in ['amplifier', 'node', 'extender', 'generic']:
            # Process Shapes
            shapes = process_equipment_layer(doc, layer_name, process_type, {})
            shapes = apply_boundary_filter(shapes, boundary, lambda s: (s.cx, s.cy))
            
            # Count shapes
            counts = {}
            for sh in shapes: counts[sh.kind] = counts.get(sh.kind, 0) + 1
            response_data["counts"] = counts
            
            # Plot
            response_data["image_map"] = plot_map_to_base64(segments, [], f"DXF Map - {process_type}", shapes=shapes, boundary=boundary)

        elif process_type == 'digit':
            # Digits Pipeline
            # Load config dynamically so you can pass overrides via API request later
            digit_config = {k.lower(): v for k, v in current_app.config.items() if isinstance(v, (int, float))}
            
            clusters = cluster_segments(segments, tol=digit_config['connect_tol'])
            candidates = build_candidates(segments, clusters, digit_config)
            candidates = apply_boundary_filter(candidates, boundary, lambda c: ((c.bbox[0]+c.bbox[2])/2, (c.bbox[1]+c.bbox[3])/2))
            
            response_data["counts"]["candidates"] = len(candidates)
            response_data["image_map"] = plot_map_to_base64(segments, candidates, f"DXF Map - Digits", boundary=boundary)
            response_data["image_grid"] = plot_candidate_grid_to_base64(segments, candidates, cols=current_app.config['GRID_COLS'])
            
        return jsonify(response_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        # Clean up the temporary file so we don't clog the server
        if os.path.exists(temp_path):
            os.remove(temp_path)

@main_api.route('/get-layers', methods=['POST'])
def get_layers():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    fd, temp_path = tempfile.mkstemp(suffix=".dxf")
    try:
        with os.fdopen(fd, 'wb') as f:
            file.save(f)
        
        # Load DXF and extract just the layer names
        doc = ezdxf.readfile(temp_path)
        layers = list_layers(doc)
        
        return jsonify({"layers": layers})
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)