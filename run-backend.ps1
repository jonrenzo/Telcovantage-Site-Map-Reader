# Launches the Flask backend on port 5050.
# Port 5000 is permanently held by Laravel Herd's HerdHelper service
# (registered in http.sys), so we run on 5050 instead.
# The Next.js frontend points here via NEXT_PUBLIC_BACKEND_URL in .env.local.

# Unlike Next.js, Flask/python don't auto-load .env.local — read it here so
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (and anything else added there)
# reach the backend process too.
$envFile = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $key, $value = $line.Split("=", 2)
            $key = $key.Trim()
            $value = $value.Trim()
            if ($key -and $value) {
                [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
            }
        }
    }
}

$env:PORT = "5050"
$env:ASBUILT_API_BASE_URL = "https://asbuilt.telcovantage.com/api/v1"
$env:PLANNER_API_BASE_URL = "https://asbuilt.telcovantage.com/api/v1"
python server.py
