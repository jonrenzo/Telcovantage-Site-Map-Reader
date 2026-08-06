# Launches the Flask backend on port 5050.
# Port 5000 is permanently held by Laravel Herd's HerdHelper service
# (registered in http.sys), so we run on 5050 instead.
# The Next.js frontend points here via NEXT_PUBLIC_BACKEND_URL in .env.local.

$env:PORT = "5050"
$env:ASBUILT_API_BASE_URL = "https://asbuilt.telcovantage.com/api/v1"
$env:PLANNER_API_BASE_URL = "https://asbuilt.telcovantage.com/api/v1"
python server.py
