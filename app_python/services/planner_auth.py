"""
Authentication module for TelcoVantage Planner API.
Handles login, token management, and retries.
"""

import requests
import time
from app_python.planner_config import (
    PLANNER_API_BASE_URL,
    PLANNER_EMAIL,
    PLANNER_PASSWORD,
    PLANNER_HEADERS,
    API_TIMEOUT,
)


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

    def make_request(self, method, endpoint, json=None, retries=3):
        """Make authenticated request with retry on 401."""
        url = f"{PLANNER_API_BASE_URL}{endpoint}"
        for attempt in range(retries):
            try:
                headers = self.get_headers()
                response = requests.request(
                    method, url, json=json, headers=headers, timeout=API_TIMEOUT
                )
                if response.status_code == 401:
                    # Token invalid, re-login
                    self.token = None
                    if attempt < retries - 1:
                        continue
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                if attempt == retries - 1:
                    raise Exception(f"Request failed after {retries} attempts: {e}")
                time.sleep(1)  # Wait before retry


def get_projects():
    """Fetch list of projects from Planner API."""
    try:
        return auth.make_request("GET", "/projects")
    except Exception as e:
        raise Exception(f"Failed to fetch projects: {e}")


# Global auth instance
auth = PlannerAuth()
