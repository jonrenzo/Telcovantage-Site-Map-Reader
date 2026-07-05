import os

import requests
from requests.exceptions import ConnectionError, Timeout

from app_python.planner_config import ASBUILT_API_BASE_URL

ASBUILT_API_KEY = "asbuilt-iq-secret-key-2026"
API_TIMEOUT = 30
IMPORT_API_TIMEOUT = 120
ASBUILT_API_FALLBACK_URL = (
    os.getenv("ASBUILT_API_FALLBACK_URL")
    or "https://lightgreen-koala-653522.hostingersite.com/api/v1"
).strip().rstrip("/")


def _headers():
    return {
        "X-AsBuilt-Key": ASBUILT_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "ngrok-skip-browser-warning": "1",
    }


def _candidate_base_urls() -> list[str]:
    urls: list[str] = []
    for url in (ASBUILT_API_BASE_URL, ASBUILT_API_FALLBACK_URL):
        normalized = (url or "").strip().rstrip("/")
        if normalized and normalized not in urls:
            urls.append(normalized)
    return urls


def _request(
    method: str,
    path: str,
    *,
    json: dict | None = None,
    timeout: int = API_TIMEOUT,
):
    last_error = None
    request_path = path if path.startswith("/") else f"/{path}"
    for base_url in _candidate_base_urls():
        url = f"{base_url}{request_path}"
        try:
            return requests.request(
                method,
                url,
                json=json,
                headers=_headers(),
                timeout=timeout,
            )
        except (ConnectionError, Timeout) as exc:
            last_error = exc
            print(f"[asbuilt] Connection failed for {url}: {exc}")
            continue
    if last_error is not None:
        raise last_error
    raise ConnectionError("No AsBuilt API base URL is configured.")

def get_sites():
    resp = _request("GET", "/asbuilt/sites")
    resp.raise_for_status()
    return resp.json()

def get_nodes(area_id: int):
    resp = _request("GET", f"/asbuilt/sites/{area_id}/nodes")
    resp.raise_for_status()
    return resp.json()

def get_node(node_id: int):
    resp = _request("GET", f"/asbuilt/node/{node_id}")
    resp.raise_for_status()
    return resp.json()


def get_subcontractors():
    resp = _request("GET", "/asbuilt/subcontractors")
    resp.raise_for_status()
    return resp.json()


def get_teams(subcontractor_id: int | None = None):
    path = "/asbuilt/teams"
    if subcontractor_id is not None:
        path = f"{path}?subcontractor_id={subcontractor_id}"
    resp = _request("GET", path)
    resp.raise_for_status()
    return resp.json()


def import_data_by_sequence(payload: dict):
    try:
        resp = _request(
            "POST",
            "/asbuilt/import-by-sequence",
            json=payload,
            timeout=IMPORT_API_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except (ConnectionError, Timeout) as exc:
        raise ConnectionError(
            "The AsBuilt sequence import server did not return a response in time. "
            "The request may still have reached AsBuilt, so check the Node ID before retrying."
        ) from exc


def import_data(payload: dict):
    try:
        resp = _request(
            "POST",
            "/asbuilt/import",
            json=payload,
            timeout=IMPORT_API_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except (ConnectionError, Timeout) as exc:
        raise ConnectionError(
            "The AsBuilt import server did not return a response in time. "
            "The request may still have reached AsBuilt, so check the Node ID before retrying."
        ) from exc
