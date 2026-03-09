@echo off
echo ============================================
echo   Strand Line and Equipment Identifier
echo ============================================
echo.

:: Start Flask backend in a new window
echo Starting Flask backend...
start "Flask Backend" cmd /k "call venv\Scripts\activate && python server.py"

:: Wait a moment for Flask to initialize
timeout /t 3 /nobreak >nul

:: Start Next.js frontend in a new window
echo Starting Next.js frontend...
start "Next.js Frontend" cmd /k "npm run dev"

echo.
echo Both servers are starting in separate windows.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:5000
echo.
pause