"""
Configuration for TelcoVantage Planner API integration.
"""

import os

# Planner API settings
PLANNER_API_BASE_URL = os.getenv(
    "PLANNER_API_BASE_URL",
    "https://disguisedly-enarthrodial-kristi.ngrok-free.dev/api/v1",
)

# Authentication credentials (set via environment variables)
PLANNER_EMAIL = os.getenv("PLANNER_EMAIL")
PLANNER_PASSWORD = os.getenv("PLANNER_PASSWORD")

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
