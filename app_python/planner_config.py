"""
Configuration for TelcoVantage Planner API integration.
"""

import os


def _clean_url_env(name: str, default: str) -> str:
    return (os.getenv(name, default) or default).strip().rstrip("/")

# AsBuilt IQ API settings
ASBUILT_API_BASE_URL = _clean_url_env(
    "ASBUILT_API_BASE_URL",
    "https://lightgreen-koala-653522.hostingersite.com/api/v1",
)

# Planner API settings (legacy). Kept as a separate symbol because planner_auth
# imports it during Flask startup even when Planner integration is not used.
PLANNER_API_BASE_URL = _clean_url_env(
    "PLANNER_API_BASE_URL",
    ASBUILT_API_BASE_URL,
)

# Authentication credentials (set via environment variables)
PLANNER_EMAIL = os.getenv("PLANNER_EMAIL", "renzo.toledo@telcovantage.com")
PLANNER_PASSWORD = os.getenv("PLANNER_PASSWORD", "TELCOVANTAGE@2026!")

# Default project ID to use (set via env or change as needed)
DEFAULT_PROJECT_ID = int(os.getenv("PLANNER_DEFAULT_PROJECT_ID", "1"))

# Headers for all requests
PLANNER_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "ngrok-skip-browser-warning": "true",  # For ngrok URLs
}

# Timeout for API requests (seconds)
API_TIMEOUT = 30

# Enable/disable integration
ENABLE_PLANNER_INTEGRATION = (
    os.getenv("ENABLE_PLANNER_INTEGRATION", "true").lower() == "true"
)
