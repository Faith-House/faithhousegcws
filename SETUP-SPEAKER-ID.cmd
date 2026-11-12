@echo off
cd /d "%~dp0"
node setup-speaker-id.mjs
if errorlevel 1 pause
