@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required to start Jarvis.
  pause
  exit /b 1
)
node --env-file-if-exists=.env.local server.mjs
if errorlevel 1 pause
