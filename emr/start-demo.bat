@echo off
rem Double-click this file on Windows to start the EMR demo (fake data only).
cd /d "%~dp0"
node -v >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Please install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
echo Starting the demo. When you see "EMR prototype is running", open http://localhost:3000 in your browser.
node server.js --demo
pause
