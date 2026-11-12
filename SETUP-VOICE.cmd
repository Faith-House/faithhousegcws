@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or later before setting up the voice.
  pause
  exit /b 1
)
echo Installing the local neural voice software...
call npm.cmd ci
if errorlevel 1 (
  pause
  exit /b 1
)
node setup-neural-voice.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo Voice setup complete. Start Jarvis using START.cmd.
pause
