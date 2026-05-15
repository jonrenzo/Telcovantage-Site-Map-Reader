import requests
from app_python.planner_config import PLANNER_API_BASE_URL

ASBUILT_API_KEY = "asbuilt-iq-secret-key-2026"
API_TIMEOUT = 30

def _headers():
    return {
        "X-AsBuilt-Key": ASBUILT_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "ngrok-skip-browser-warning": "1",
    }

def get_sites():
    url = f"{PLANNER_API_BASE_URL}/asbuilt/sites"
    resp = requests.get(url, headers=_headers(), timeout=API_TIMEOUT)
    resp.raise_for_status()
    return resp.json()

def get_nodes(site_id: int):
    url = f"{PLANNER_API_BASE_URL}/asbuilt/sites/{site_id}/nodes"
    resp = requests.get(url, headers=_headers(), timeout=API_TIMEOUT)
    resp.raise_for_status()
    return resp.json()

def import_data(payload: dict):
    url = f"{PLANNER_API_BASE_URL}/asbuilt/import"
    resp = requests.post(url, json=payload, headers=_headers(), timeout=API_TIMEOUT)
    resp.raise_for_status()
    return resp.json()
