"""
Authentication module for TelcoVantage Planner API.
Handles login, token management, and retries.
"""

import requests
import time
import ssl
from requests.exceptions import SSLError
from app_python.planner_config import (
    PLANNER_API_BASE_URL,
    PLANNER_EMAIL,
    PLANNER_PASSWORD,
    PLANNER_HEADERS,
    API_TIMEOUT,
)

# Default delay between requests to avoid overwhelming ngrok tunnel
DEFAULT_REQUEST_DELAY = 0.3  # 300ms


class PlannerAuth:
    def __init__(self):
        self.token = None
        self.token_expires = 0  # Simple expiry tracking (assume tokens last 1 hour)

    def _login(self):
        """Perform login and get Bearer token."""
        url = f"{PLANNER_API_BASE_URL}/login"
        payload = {"email": PLANNER_EMAIL, "password": PLANNER_PASSWORD}
        headers = PLANNER_HEADERS.copy()

        try:
            response = requests.post(
                url, json=payload, headers=headers, timeout=API_TIMEOUT
            )
            response.raise_for_status()
            data = response.json()
            self.token = data["token"]
            self.token_expires = time.time() + 3600  # Assume 1 hour expiry
            return self.token
        except requests.exceptions.RequestException as e:
            raise Exception(f"Login failed: {e}")

    def get_token(self):
        """Get valid token, login if needed or expired."""
        if not self.token or time.time() > self.token_expires:
            self._login()
        return self.token

    def get_headers(self):
        """Get headers with Authorization token."""
        headers = PLANNER_HEADERS.copy()
        headers["Authorization"] = f"Bearer {self.get_token()}"
        return headers

    def make_request(self, method, endpoint, json=None, retries=3, request_delay=None):
        """Make authenticated request with retry on 401 and SSL error handling.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint path
            json: JSON payload for request
            retries: Number of retry attempts (default 3, increased to 4 for SSL errors)
            request_delay: Delay after successful request (default 300ms)
        """
        if request_delay is None:
            request_delay = DEFAULT_REQUEST_DELAY

        url = f"{PLANNER_API_BASE_URL}{endpoint}"
        max_retries = retries

        for attempt in range(max_retries + 1):  # +1 to allow extra retry for SSL
            try:
                headers = self.get_headers()
                response = requests.request(
                    method, url, json=json, headers=headers, timeout=API_TIMEOUT
                )
                if response.status_code == 401:
                    # Token invalid, re-login
                    self.token = None
                    if attempt < max_retries:
                        continue
                response.raise_for_status()

                # Add delay after successful request to avoid overwhelming ngrok
                if request_delay > 0:
                    time.sleep(request_delay)

                return response.json()
            except SSLError as e:
                # SSL errors need exponential backoff (common with free ngrok)
                if attempt >= max_retries:
                    raise Exception(f"SSL error after {attempt + 1} attempts: {e}")
                backoff_time = 2 ** (attempt + 1)  # 2s, 4s, 8s, 16s
                print(
                    f"[planner] SSL error, retrying in {backoff_time}s... (attempt {attempt + 1})"
                )
                time.sleep(backoff_time)
            except requests.exceptions.RequestException as e:
                if attempt >= max_retries:
                    raise Exception(f"Request failed after {attempt + 1} attempts: {e}")
                # Standard 1s wait for other errors
                time.sleep(1)

    def bulk_upload(
        self, payload: dict, compress: bool = False, retries: int = 3
    ) -> dict:
        """
        Upload bulk data (node + poles + pole_spans) to Planner API.

        Converts JSON payload to file and sends as multipart/form-data to /bulk-upload.

        Args:
            payload: Dict with project_id, node, poles, pole_spans
            compress: If True, gzip compress the JSON before upload
            retries: Number of retry attempts (default 3)

        Returns:
            API response dict with created/updated entities
        """
        import io
        import json as json_module
        import gzip

        # Convert payload to JSON bytes
        json_bytes = json_module.dumps(payload, indent=2).encode("utf-8")

        if compress:
            # Gzip compress the JSON
            buffer = io.BytesIO()
            with gzip.GzipFile(fileobj=buffer, mode="wb") as gz:
                gz.write(json_bytes)
            file_data = buffer.getvalue()
            filename = "bulk-upload.json.gz"
            content_type = "application/gzip"
        else:
            file_data = json_bytes
            filename = "bulk-upload.json"
            content_type = "application/json"

        url = f"{PLANNER_API_BASE_URL}/bulk-upload"
        max_retries = retries

        for attempt in range(max_retries + 1):
            try:
                headers = self.get_headers()
                # Remove Content-Type to let requests handle multipart boundary
                headers.pop("Content-Type", None)

                response = requests.post(
                    url,
                    headers=headers,
                    files={"file": (filename, file_data, content_type)},
                    timeout=API_TIMEOUT,
                )

                if response.status_code == 401:
                    # Token invalid, re-login
                    self.token = None
                    if attempt < max_retries:
                        continue

                response.raise_for_status()
                return response.json()

            except SSLError as e:
                if attempt >= max_retries:
                    raise Exception(
                        f"Bulk upload SSL error after {attempt + 1} attempts: {e}"
                    )
                backoff_time = 2 ** (attempt + 1)
                print(
                    f"[planner] Bulk upload SSL error, retrying in {backoff_time}s... (attempt {attempt + 1})"
                )
                time.sleep(backoff_time)

            except requests.exceptions.RequestException as e:
                if attempt >= max_retries:
                    raise Exception(
                        f"Bulk upload failed after {attempt + 1} attempts: {e}"
                    )
                time.sleep(1)


def get_projects():
    """Fetch list of projects from Planner API."""
    try:
        return auth.make_request("GET", "/projects")
    except Exception as e:
        raise Exception(f"Failed to fetch projects: {e}")


# Global auth instance
auth = PlannerAuth()
